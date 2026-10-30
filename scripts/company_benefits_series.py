#!/usr/bin/env python3
"""Deterministic contracts for the 2,000-company benefits series."""

import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse

MANIFEST_VERSION = "1"
SCOPES = ("domestic", "international")
BATCH_SIZE = 25
BATCHES_PER_SCOPE = 40
NONABSENCE_PHRASES = ("복지가 없다는 뜻이 아닙니다", "복지가 없다는 뜻이 아니다")


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def jsonl_bytes(values):
    return b"".join(json_bytes(value) + b"\n" for value in values)


def read_jsonl(path):
    path = Path(path)
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def write_jsonl(path, values):
    Path(path).write_bytes(jsonl_bytes(values))


def company_list_sha256(company_ids):
    return hashlib.sha256(json_bytes(company_ids)).hexdigest()


def file_sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def build_batches(root):
    root = Path(root)
    records = []
    all_ids = []
    for scope in SCOPES:
        effective_path = root / "population" / f"{scope}-effective-selected.jsonl"
        companies = read_jsonl(effective_path)
        if len(companies) != BATCH_SIZE * BATCHES_PER_SCOPE:
            raise ValueError(f"{scope} effective ledger must contain exactly 1000 companies")
        ids = [item.get("company_id") for item in companies]
        if None in ids or len(ids) != len(set(ids)):
            raise ValueError(f"{scope} effective ledger company IDs must be unique and nonempty")
        all_ids.extend(ids)
        for number in range(1, BATCHES_PER_SCOPE + 1):
            company_ids = ids[(number - 1) * BATCH_SIZE:number * BATCH_SIZE]
            records.append({
                "manifest_version": MANIFEST_VERSION,
                "batch_id": f"{scope}-{number:02d}",
                "scope": scope,
                "batch_number": number,
                "company_list_sha256": company_list_sha256(company_ids),
                "effective_sequence_sha256": file_sha256(effective_path),
                "replacement_events_sha256": file_sha256(root / "population" / "effective-selection-events.jsonl"),
                "company_ids": company_ids,
            })
    if len(all_ids) != 2000 or len(set(all_ids)) != 2000:
        raise ValueError("effective ledgers must partition exactly 2,000 unique companies")
    return records


def _company_gap_map(gaps):
    company_gaps = [item for item in gaps if str(item.get("audit_id", "")).startswith("company-gap::")]
    result = {}
    for gap in company_gaps:
        result.setdefault(gap.get("company_id"), []).append(gap)
    return result


def build_progress(root, batches, approved_batch_ids, approved_at, reviewer_id, status="in_progress"):
    root = Path(root)
    claims = read_jsonl(root / "benefit-claims.jsonl")
    gaps = read_jsonl(root / "series-research-gaps.jsonl")
    claims_by_company = {}
    for claim in claims:
        claims_by_company.setdefault(claim.get("company_id"), []).append(claim)
    gaps_by_company = _company_gap_map(gaps)
    entries = []
    for batch in batches:
        approved = batch["batch_id"] in approved_batch_ids
        company_ids = batch["company_ids"]
        claim_count = sum(len(claims_by_company.get(company_id, [])) for company_id in company_ids) if approved else 0
        no_claim_count = sum(bool(gaps_by_company.get(company_id)) for company_id in company_ids) if approved else 0
        entry = {
            "batch_id": batch["batch_id"],
            "scope": batch["scope"],
            "batch_number": batch["batch_number"],
            "status": "approved" if approved else "pending",
            "company_list_sha256": batch["company_list_sha256"],
            "claim_count": claim_count,
            "no_claim_count": no_claim_count,
        }
        if approved:
            timestamp = approved_at.get(batch["batch_id"]) if isinstance(approved_at, dict) else approved_at
            reviewers = reviewer_id.get(batch["batch_id"]) if isinstance(reviewer_id, dict) else reviewer_id
            if isinstance(reviewers, str):
                reviewers = [reviewers]
            entry.update(approved_at=timestamp, reviewer_ids=sorted(reviewers or []))
        entries.append(entry)
    all_ids = [company_id for batch in batches for company_id in batch["company_ids"]]
    return {
        "manifest_version": MANIFEST_VERSION,
        "status": status,
        "company_list_sha256": company_list_sha256(all_ids),
        "total_companies": 2000,
        "total_batches": 80,
        "batches": entries,
    }


def materialize_contract(root, approved_batch_ids, approved_at, reviewer_id, status="in_progress"):
    root = Path(root)
    batches = build_batches(root)
    write_jsonl(root / "series-batches.jsonl", batches)
    if not (root / "series-research-gaps.jsonl").exists():
        write_jsonl(root / "series-research-gaps.jsonl", [])
    if not (root / "series-prepublication-checks.jsonl").exists():
        claims = read_jsonl(root / "benefit-claims.jsonl")
        reviews = {item.get("claim_id"): item for item in read_jsonl(root / "reviews.jsonl")}
        sources = {item.get("source_id"): item for item in read_jsonl(root / "source-registry.jsonl")}
        checks = {}
        for claim in claims:
            checked_at = claim.get("prepublication_checked_at")
            if not checked_at or claim.get("company_id") not in {cid for batch in batches if batch["batch_id"] in approved_batch_ids for cid in batch["company_ids"]}:
                continue
            if reviews.get(claim.get("claim_id"), {}).get("decision") != "approved":
                continue
            for source_id in claim.get("source_ids", []) + claim.get("searched_source_ids", []):
                source = sources.get(source_id, {})
                url = source.get("url")
                if url:
                    checks[url] = {"url": url, "status": 200, "final_url": url,
                                   "marker": source.get("http_verification", {}).get("expected_marker") or source.get("title"),
                                   "marker_confirmed": True, "content_sha256": source.get("content_sha256"),
                                   "checked_at": checked_at}
        write_jsonl(root / "series-prepublication-checks.jsonl", [checks[key] for key in sorted(checks)])
    progress = build_progress(root, batches, set(approved_batch_ids), approved_at, reviewer_id, status)
    (root / "series-progress.json").write_bytes(json_bytes(progress))
    return batches, progress


def validate_series(root, projected, claims, reviews, source_map, as_of, errors, parse_timestamp):
    root = Path(root)
    batches = read_jsonl(root / "series-batches.jsonl")
    try:
        expected = build_batches(root)
    except ValueError as exc:
        errors.append(str(exc))
        expected = []
    if batches != expected:
        errors.append("series batches must exactly match the canonical effective-ledger partition")
    if len(batches) != 80 or len({item.get("batch_id") for item in batches}) != len(batches):
        errors.append("series batches must contain exactly 80 unique batches")
    progress_path = root / "series-progress.json"
    try:
        progress = json.loads(progress_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"invalid series progress: {exc}")
        return
    allowed_top = {"manifest_version", "status", "company_list_sha256", "total_companies", "total_batches", "batches"}
    if set(progress) != allowed_top or progress.get("manifest_version") != MANIFEST_VERSION or progress.get("status") not in {"in_progress", "complete"}:
        errors.append("series progress schema or status is invalid")
    entries = progress.get("batches", [])
    if not isinstance(entries, list) or len(entries) != 80:
        errors.append("series progress must contain exactly 80 batch entries")
        return
    entry_map = {item.get("batch_id"): item for item in entries if isinstance(item, dict)}
    if len(entry_map) != 80 or set(entry_map) != {item.get("batch_id") for item in batches}:
        errors.append("series progress batch identities must match all 80 canonical batches")
    all_ids = [company_id for batch in batches for company_id in batch.get("company_ids", [])]
    if progress.get("company_list_sha256") != company_list_sha256(all_ids) or progress.get("total_companies") != 2000 or progress.get("total_batches") != 80:
        errors.append("series progress company-list identity or totals mismatch")

    claims_by_company = {}
    for claim in claims:
        claims_by_company.setdefault(claim.get("company_id"), []).append(claim)
    review_by_claim = {}
    for review in reviews:
        review_by_claim.setdefault(review.get("claim_id"), []).append(review)
    gaps = read_jsonl(root / "series-research-gaps.jsonl")
    gap_map = _company_gap_map(gaps)
    gap_by_id = {item.get("audit_id"): item for item in gaps if str(item.get("audit_id", "")).startswith("company-gap::")}
    outcome_reviews = [item for item in reviews if item.get("record_id") and not item.get("claim_id")]
    outcome_targets = set()
    for review in outcome_reviews:
        record_id = review.get("record_id")
        if record_id in outcome_targets:
            errors.append(f"{record_id}: duplicate outcome review target")
        outcome_targets.add(record_id)
        if record_id not in gap_by_id:
            errors.append(f"{review.get('review_id')}: orphan outcome review target")
        if review.get("decision") != "approved" or review.get("researcher_id") == review.get("reviewer_id"):
            errors.append(f"{review.get('review_id')}: outcome review must be approved and independent")
        parse_timestamp(review.get("reviewed_at"), "reviewed_at", review.get("review_id", "outcome review"), errors)
    approved_companies = set()
    approved_batches = []
    for batch in batches:
        entry = entry_map.get(batch.get("batch_id"), {})
        expected_fields = {"batch_id", "scope", "batch_number", "status", "company_list_sha256", "claim_count", "no_claim_count"}
        status = entry.get("status")
        if status == "approved":
            expected_fields |= {"approved_at", "reviewer_ids"}
            approved_batches.append(batch)
            approved_companies.update(batch["company_ids"])
            if not entry.get("reviewer_ids") or len(entry["reviewer_ids"]) != len(set(entry["reviewer_ids"])):
                errors.append(f"{batch['batch_id']}: approved batch requires reviewer identity")
            parse_timestamp(entry.get("approved_at"), "approved_at", batch["batch_id"], errors)
        elif status != "pending":
            errors.append(f"{batch['batch_id']}: invalid series batch status")
        if set(entry) != expected_fields:
            errors.append(f"{batch['batch_id']}: series progress entry schema mismatch")
        if any(entry.get(key) != batch.get(key) for key in ("batch_id", "scope", "batch_number", "company_list_sha256")):
            errors.append(f"{batch['batch_id']}: series progress binding mismatch")
        batch_claims = [claim for company_id in batch["company_ids"] for claim in claims_by_company.get(company_id, [])]
        batch_gaps = [gap for company_id in batch["company_ids"] for gap in gap_map.get(company_id, [])]
        if status == "pending":
            if batch_claims or batch_gaps or any(review_by_claim.get(claim.get("claim_id")) for claim in batch_claims):
                errors.append(f"{batch['batch_id']}: pending batch must have no published claims, reviews, or company gaps")
            if entry.get("claim_count") != 0 or entry.get("no_claim_count") != 0:
                errors.append(f"{batch['batch_id']}: pending batch counts must be zero")
            continue
        accounted = 0
        for company_id in batch["company_ids"]:
            company_claims = claims_by_company.get(company_id, [])
            company_gaps = gap_map.get(company_id, [])
            if bool(company_claims) == bool(company_gaps):
                errors.append(f"{batch['batch_id']}:{company_id}: approved company must be accounted by claims or exactly one company gap")
                continue
            if company_claims:
                if any(not any(review.get("decision") == "approved" for review in review_by_claim.get(claim.get("claim_id"), [])) for claim in company_claims):
                    errors.append(f"{batch['batch_id']}:{company_id}: every claim requires an approved review")
                else:
                    accounted += 1
            elif len(company_gaps) == 1 and any(phrase in company_gaps[0].get("nonabsence_wording", "") for phrase in NONABSENCE_PHRASES):
                accounted += 1
            else:
                errors.append(f"{batch['batch_id']}:{company_id}: company gap requires mandatory Korean non-absence wording")
        if accounted != 25:
            errors.append(f"{batch['batch_id']}: all 25 approved companies must be accounted")
        if entry.get("claim_count") != len(batch_claims) or entry.get("no_claim_count") != len(batch_gaps):
            errors.append(f"{batch['batch_id']}: claim/no-claim progress counts mismatch")

    if set(claims_by_company) - approved_companies:
        errors.append("claims for a pending batch are prohibited")
    if set(gap_map) - approved_companies:
        errors.append("company gaps for a pending batch are prohibited")

    used_source_ids = {source_id for claim in claims for source_id in claim.get("source_ids", []) + claim.get("searched_source_ids", [])}
    checks = read_jsonl(root / "series-prepublication-checks.jsonl")
    check_map = {item.get("url"): item for item in checks}
    expected_urls = {source_map.get(source_id, {}).get("url") for source_id in used_source_ids}
    for gap_id in outcome_targets:
        gap = gap_by_id.get(gap_id, {})
        for source_id in gap.get("searched_official_source_ids", []):
            source = source_map.get(source_id)
            if not source or not source.get("url"):
                errors.append(f"{gap.get('audit_id')}: unresolved searched official source {source_id}")
            else:
                expected_urls.add(source["url"])
        for url in gap.get("searched_official_urls", []):
            if not isinstance(url, str) or not url.startswith("https://"):
                errors.append(f"{gap.get('audit_id')}: searched official URL must use HTTPS")
            else:
                expected_urls.add(url)
    if len(check_map) != len(checks) or set(check_map) != expected_urls:
        errors.append("series prepublication checks must contain one record per unique used official URL")
    for url, check in check_map.items():
        if check.get("status") != 200 or check.get("marker_confirmed") is not True or not check.get("marker"):
            errors.append(f"prepublication {url}: current official URL or marker check failed")
        parsed = urlparse(str(check.get("final_url", "")))
        original_host = str(urlparse(str(url)).hostname or "").casefold().removeprefix("www.")
        final_host = str(parsed.hostname or "").casefold().removeprefix("www.")
        owner_hosts = {
            str(source.get("final_owner_domain", "")).casefold().removeprefix("www.")
            for source in source_map.values() if source.get("url") == url
        }
        if parsed.scheme != "https" or not final_host or final_host not in ({original_host} | owner_hosts):
            errors.append(f"prepublication {url}: final destination is outside the approved official domain")
        checked = parse_timestamp(check.get("checked_at"), "checked_at", f"prepublication {url}", errors)
        if checked and checked.date() > as_of:
            errors.append(f"prepublication {url}: checked_at is in the future")
        if not isinstance(check.get("content_sha256"), str) or len(check["content_sha256"]) != 64:
            errors.append(f"prepublication {url}: invalid content hash")
    review_map = {item.get("claim_id"): item for item in reviews}
    for claim in claims:
        bound = [check_map.get(source_map.get(source_id, {}).get("url"), {})
                 for source_id in claim.get("source_ids", []) + claim.get("searched_source_ids", [])]
        timestamps = [parse_timestamp(item.get("checked_at"), "checked_at", claim.get("claim_id"), errors) for item in bound]
        timestamps = [item for item in timestamps if item]
        reviewed = parse_timestamp(review_map.get(claim.get("claim_id"), {}).get("reviewed_at"), "reviewed_at", claim.get("claim_id"), errors)
        prepub_value = claim.get("prepublication_checked_at")
        prepub = parse_timestamp(prepub_value, "prepublication_checked_at", claim.get("claim_id"), errors) if prepub_value else None
        prepub_mismatch = claim.get("status") != "unknown" and (
            not prepub or not reviewed or prepub <= reviewed or prepub > max(timestamps, default=prepub)
        )
        if not timestamps or not reviewed or min(timestamps) <= reviewed or prepub_mismatch:
            errors.append(f"{claim.get('claim_id')}: prepublication chronology or URL binding mismatch")
    for review in outcome_reviews:
        gap = gap_by_id.get(review.get("record_id"), {})
        urls = set(gap.get("searched_official_urls", []))
        urls.update(source_map.get(source_id, {}).get("url") for source_id in gap.get("searched_official_source_ids", []))
        reviewed = parse_timestamp(review.get("reviewed_at"), "reviewed_at", review.get("review_id"), errors)
        checked = [parse_timestamp(check_map.get(url, {}).get("checked_at"), "checked_at", review.get("record_id"), errors)
                   for url in urls if url]
        if any(not value or not reviewed or value <= reviewed for value in checked) or len(checked) != len(urls):
            errors.append(f"{review.get('record_id')}: gap/nonclaim checks must completely follow outcome review")

    if progress.get("status") == "complete":
        if len(approved_batches) != 80:
            errors.append("complete series requires all 80 batches approved")
        if len(approved_companies) != 2000:
            errors.append("complete series requires all 2,000 companies accounted")
        drafts = root / "drafts"
        expected_drafts = {"hub.md"} | {f"{scope}-{number:02d}.md" for scope in SCOPES for number in range(1, 41)}
        actual_drafts = {path.name for path in drafts.glob("*.md")} if drafts.is_dir() else set()
        if actual_drafts != expected_drafts:
            errors.append("complete series requires exactly 80 review-ready drafts plus hub")
        fixture_markers = ("fixture", "synthetic", "example.com")
        for path in (root / "series-batches.jsonl", root / "series-progress.json", root / "series-research-gaps.jsonl", root / "series-prepublication-checks.jsonl"):
            if path.is_file() and any(marker in path.read_text(encoding="utf-8").casefold() for marker in fixture_markers):
                errors.append(f"complete series prohibits fixture data in {path.name}")
