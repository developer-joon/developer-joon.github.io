#!/usr/bin/env python3
"""Validate and deterministically merge one approved benefits-series batch."""

import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import company_benefits_series as series

FILES = ("sources.jsonl", "claims.jsonl", "reviews.jsonl", "gaps.jsonl", "checks.jsonl")
ALLOWED_FILES = {"batch.json", *FILES}
TARGETS = {
    "sources.jsonl": "source-registry.jsonl",
    "claims.jsonl": "benefit-claims.jsonl",
    "reviews.jsonl": "reviews.jsonl",
    "gaps.jsonl": "series-research-gaps.jsonl",
    "checks.jsonl": "series-prepublication-checks.jsonl",
}
ID_FIELDS = {
    "sources.jsonl": "source_id", "claims.jsonl": "claim_id", "reviews.jsonl": "review_id",
    "gaps.jsonl": "audit_id", "checks.jsonl": "url",
}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def parse_timestamp(value, label):
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError
        return parsed
    except ValueError as exc:
        raise ValueError(f"invalid {label} timestamp") from exc


def _unique_map(records, field, label):
    values = [item.get(field) for item in records]
    if any(value in (None, "") for value in values) or len(values) != len(set(values)):
        raise ValueError(f"{label} requires unique nonempty {field} values")
    return dict(zip(values, records))


def expected_check_urls(claims, gaps, source_map):
    urls = set()
    for item in claims:
        for source_id in item.get("source_ids", []) + item.get("searched_source_ids", []):
            source = source_map.get(source_id)
            if not source or not source.get("url"):
                raise ValueError(f"missing source binding for check coverage: {source_id}")
            urls.add(source["url"])
    for gap in gaps:
        for source_id in gap.get("searched_official_source_ids", []):
            source = source_map.get(source_id)
            if not source or not source.get("url"):
                raise ValueError(f"missing gap source binding for check coverage: {source_id}")
            urls.add(source["url"])
        for url in gap.get("searched_official_urls", []):
            if not isinstance(url, str) or not url.startswith("https://"):
                raise ValueError("gap searched official URL must use HTTPS")
            urls.add(url)
    return urls


def merge_checks(existing, incoming, latest_review_by_url, expected_urls=None):
    """Upsert URL checks only when a shared-source recheck is newer and compatible."""
    merged = _unique_map(existing, "url", "existing checks")
    incoming_map = _unique_map(incoming, "url", "incoming checks")
    expected_urls = set(latest_review_by_url) if expected_urls is None else set(expected_urls)
    if set(incoming_map) != expected_urls:
        raise ValueError("incoming checks do not match source bindings")
    for url, check in incoming_map.items():
        checked = parse_timestamp(check.get("checked_at"), "check checked_at")
        reviewed = parse_timestamp(latest_review_by_url[url], "latest review") if url in latest_review_by_url else None
        if reviewed and checked <= reviewed:
            raise ValueError(f"{url}: check must follow review chronology")
        previous = merged.get(url)
        if previous is not None:
            if check.get("content_sha256") != previous.get("content_sha256"):
                raise ValueError(f"{url}: conflicting shared URL content hash")
            if check.get("marker") != previous.get("marker") or check.get("marker_confirmed") is not True:
                raise ValueError(f"{url}: conflicting shared URL marker")
            if checked <= parse_timestamp(previous.get("checked_at"), "existing check checked_at"):
                raise ValueError(f"{url}: shared URL check must be strictly newer")
        merged[url] = check
    return [merged[key] for key in sorted(merged)]


def load_package(input_dir, research_root):
    input_dir, research_root = Path(input_dir), Path(research_root)
    actual = {path.name for path in input_dir.iterdir()}
    if actual != ALLOWED_FILES or any(not path.is_file() for path in input_dir.iterdir()):
        raise ValueError("unexpected input or evidence file; package must contain only batch.json and five JSONL artifacts")
    try:
        manifest = json.loads((input_dir / "batch.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid batch manifest: {exc}") from exc
    expected_manifest_fields = {"schema_version", "batch_id", "company_list_sha256", "effective_sequence_sha256",
                                "replacement_events_sha256", "status", "approved_at", "reviewer_id", "artifacts"}
    if set(manifest) != expected_manifest_fields or manifest.get("schema_version") != "1":
        raise ValueError("batch manifest schema mismatch")
    if manifest.get("status") != "approved" or not manifest.get("reviewer_id"):
        raise ValueError("only explicitly approved batches with reviewer identity may be integrated")
    parse_timestamp(manifest.get("approved_at"), "approved_at")
    batches = {item["batch_id"]: item for item in series.read_jsonl(research_root / "series-batches.jsonl")}
    batch = batches.get(manifest.get("batch_id"))
    if batch is None or manifest.get("company_list_sha256") != batch.get("company_list_sha256"):
        raise ValueError("batch identity or company-list SHA does not match canonical manifest")
    if (manifest.get("effective_sequence_sha256") != batch.get("effective_sequence_sha256")
            or manifest.get("replacement_events_sha256") != batch.get("replacement_events_sha256")):
        raise ValueError("batch effective sequence or replacement-event binding is stale")
    progress = json.loads((research_root / "series-progress.json").read_text(encoding="utf-8"))
    current = next((item for item in progress["batches"] if item["batch_id"] == batch["batch_id"]), None)
    if current is None or current.get("status") != "pending":
        raise ValueError("batch is not pending")

    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, dict) or set(artifacts) != set(FILES):
        raise ValueError("batch manifest must hash all five exact artifacts")
    records = {}
    for name in FILES:
        raw = (input_dir / name).read_bytes()
        if artifacts.get(name) != sha256(raw):
            raise ValueError(f"artifact hash mismatch: {name}")
        records[name] = series.read_jsonl(input_dir / name)
        _unique_map(records[name], ID_FIELDS[name], name)
        serialized = json.dumps(records[name], ensure_ascii=False)
        if "evidence_path" in serialized or "evidence_file" in serialized or any(item.get("hash_provenance") == "retained_file" for item in records[name]):
            raise ValueError("evidence files and retained-file provenance are prohibited")

    existing = {name: series.read_jsonl(research_root / target) for name, target in TARGETS.items()}
    for name in ("sources.jsonl", "claims.jsonl", "reviews.jsonl", "gaps.jsonl"):
        field = ID_FIELDS[name]
        incoming_ids = {item[field] for item in records[name]}
        existing_ids = {item.get(field) for item in existing[name]}
        if incoming_ids & existing_ids:
            raise ValueError(f"cross-batch {field} collision")
    company_ids = set(batch["company_ids"])
    claims = records["claims.jsonl"]
    gaps = records["gaps.jsonl"]
    if any(item.get("company_id") not in company_ids for item in claims + gaps):
        raise ValueError("claim or gap company is outside batch")
    claims_by_company = {}
    for claim in claims:
        claims_by_company.setdefault(claim.get("company_id"), []).append(claim)
    gaps_by_company = {}
    for gap in gaps:
        if not str(gap.get("audit_id", "")).startswith("company-gap::"):
            raise ValueError("external batch gaps must be explicit company-gap records")
        gaps_by_company.setdefault(gap.get("company_id"), []).append(gap)
    for company_id in company_ids:
        company_claims = claims_by_company.get(company_id, [])
        company_gaps = gaps_by_company.get(company_id, [])
        if bool(company_claims) == bool(company_gaps) or len(company_gaps) > 1:
            raise ValueError("approved input must account for all 25 companies by claims or exactly one gap")
        if company_gaps and not any(phrase in company_gaps[0].get("nonabsence_wording", "") for phrase in series.NONABSENCE_PHRASES):
            raise ValueError("company gap lacks mandatory Korean non-absence wording")

    existing_claim_ids = {item.get("claim_id") for item in existing["claims.jsonl"]}
    claim_map = _unique_map(claims, "claim_id", "claims")
    gap_map = _unique_map(gaps, "audit_id", "gaps")
    review_map, outcome_review_map = {}, {}
    for review in records["reviews.jsonl"]:
        claim_id, record_id = review.get("claim_id"), review.get("record_id")
        if bool(claim_id) == bool(record_id):
            raise ValueError("review must use exactly one tagged claim_id or record_id target")
        target, mapping = (claim_id, review_map) if claim_id else (record_id, outcome_review_map)
        if target in mapping:
            raise ValueError("review target coverage must be exactly once with no cross-type duplicates")
        mapping[target] = review
    if set(review_map) != set(claim_map):
        raise ValueError("claim review coverage must bind every incoming claim exactly once with no orphans")
    if set(outcome_review_map) != set(gap_map):
        raise ValueError("outcome review coverage must bind every gap/nonclaim record exactly once with no orphans")
    if set(review_map) & set(outcome_review_map):
        raise ValueError("cross-type duplicate review targets are prohibited")
    for claim_id, review in review_map.items():
        if review.get("decision") != "approved" or review.get("researcher_id") == review.get("reviewer_id"):
            raise ValueError(f"{claim_id}: unapproved or self-approved review")
        reviewed = parse_timestamp(review.get("reviewed_at"), "reviewed_at")
        prepub = parse_timestamp(claim_map[claim_id].get("prepublication_checked_at"), "prepublication_checked_at")
        if prepub <= reviewed:
            raise ValueError(f"{claim_id}: stale or pre-review prepublication check")
    for record_id, review in outcome_review_map.items():
        if review.get("decision") != "approved" or review.get("researcher_id") == review.get("reviewer_id"):
            raise ValueError(f"{record_id}: unapproved or self-approved outcome review")
        parse_timestamp(review.get("reviewed_at"), "outcome reviewed_at")
    if set(claim_map) & existing_claim_ids:
        raise ValueError("cross-batch claim_id collision")

    source_map = {item.get("source_id"): item for item in existing["sources.jsonl"] + records["sources.jsonl"]}
    used_ids = {source_id for claim in claims for source_id in claim.get("source_ids", []) + claim.get("searched_source_ids", [])}
    if None in source_map or used_ids - set(source_map):
        raise ValueError("claim has missing source bindings")
    for claim in claims:
        if claim.get("status") != "unknown":
            evidence_ids = [item.get("source_id") for item in claim.get("source_evidence", [])]
            if len(evidence_ids) != len(set(evidence_ids)) or set(evidence_ids) != set(claim.get("source_ids", [])):
                raise ValueError(f"{claim.get('claim_id')}: missing one-to-one source evidence bindings")
    expected_urls = expected_check_urls(claims, gaps, source_map)
    check_map = _unique_map(records["checks.jsonl"], "url", "checks")
    if set(check_map) != expected_urls:
        raise ValueError("checks must bind every used official URL exactly once")
    latest_review_by_url = {}
    for claim in claims:
        reviewed = parse_timestamp(review_map[claim["claim_id"]].get("reviewed_at"), "reviewed_at")
        for source_id in claim.get("source_ids", []) + claim.get("searched_source_ids", []):
            url = source_map[source_id]["url"]
            current = latest_review_by_url.get(url)
            if current is None or reviewed > parse_timestamp(current, "latest review"):
                latest_review_by_url[url] = review_map[claim["claim_id"]]["reviewed_at"]
            checked = parse_timestamp(check_map[url].get("checked_at"), "check checked_at")
            if checked <= reviewed or checked.isoformat() != parse_timestamp(claim.get("prepublication_checked_at"), "prepublication_checked_at").isoformat():
                raise ValueError(f"{claim['claim_id']}: stale, pre-review, or unbound prepublication check")
    for record_id, review in outcome_review_map.items():
        reviewed_at = review["reviewed_at"]
        for url in expected_check_urls([], [gap_map[record_id]], source_map):
            current = latest_review_by_url.get(url)
            if current is None or parse_timestamp(reviewed_at, "outcome reviewed_at") > parse_timestamp(current, "latest review"):
                latest_review_by_url[url] = reviewed_at
    merge_checks(existing["checks.jsonl"], records["checks.jsonl"], latest_review_by_url, expected_urls)
    return manifest, batch, records


def _load_script(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def integrate_batch(input_dir, research_root, freeze_anchor_receipt, effective_selection_receipt=None,
                    as_of=None, dry_run=False):
    input_dir, research_root = Path(input_dir), Path(research_root)
    manifest, batch, incoming = load_package(input_dir, research_root)
    with tempfile.TemporaryDirectory(prefix="company-benefits-series-") as directory:
        staged = Path(directory) / "research"
        shutil.copytree(research_root, staged)
        for name, target in TARGETS.items():
            current = series.read_jsonl(staged / target)
            if name == "checks.jsonl":
                claims = incoming["claims.jsonl"]
                reviews = {item["claim_id"]: item for item in incoming["reviews.jsonl"]}
                source_map = {item["source_id"]: item for item in series.read_jsonl(staged / "source-registry.jsonl")}
                latest = {}
                for claim in claims:
                    for source_id in claim.get("source_ids", []) + claim.get("searched_source_ids", []):
                        url = source_map[source_id]["url"]
                        reviewed_at = reviews[claim["claim_id"]]["reviewed_at"]
                        if url not in latest or parse_timestamp(reviewed_at, "reviewed_at") > parse_timestamp(latest[url], "reviewed_at"):
                            latest[url] = reviewed_at
                gap_map = {item["audit_id"]: item for item in incoming["gaps.jsonl"]}
                for review in incoming["reviews.jsonl"]:
                    record_id = review.get("record_id")
                    if not record_id:
                        continue
                    for url in expected_check_urls([], [gap_map[record_id]], source_map):
                        reviewed_at = review["reviewed_at"]
                        if url not in latest or parse_timestamp(reviewed_at, "outcome reviewed_at") > parse_timestamp(latest[url], "reviewed_at"):
                            latest[url] = reviewed_at
                expected = expected_check_urls(claims, incoming["gaps.jsonl"], source_map)
                values = merge_checks(current, incoming[name], latest, expected)
            else:
                field = ID_FIELDS[name]
                values = sorted(current + incoming[name], key=lambda item: item[field])
            series.write_jsonl(staged / target, values)
        progress = json.loads((staged / "series-progress.json").read_text(encoding="utf-8"))
        approved_entries = {item["batch_id"]: item for item in progress["batches"] if item["status"] == "approved"}
        approved = set(approved_entries) | {batch["batch_id"]}
        approval_times = {key: value["approved_at"] for key, value in approved_entries.items()}
        reviewer_ids = {key: value["reviewer_ids"] for key, value in approved_entries.items()}
        approval_times[batch["batch_id"]] = manifest["approved_at"]
        reviewer_ids[batch["batch_id"]] = [manifest["reviewer_id"]]
        _, new_progress = series.materialize_contract(staged, approved, approval_times, reviewer_ids, progress["status"])
        verifier = _load_script(Path(__file__).with_name("verify-company-benefits-ledger.py"), "series_verifier")
        errors = verifier.verify_workspace(staged, as_of=as_of, freeze_anchor_receipt=freeze_anchor_receipt,
                                           effective_selection_receipt=effective_selection_receipt)
        if errors:
            raise ValueError("staged series verification failed:\n" + "\n".join(errors))
        renderer = _load_script(Path(__file__).with_name("render-company-benefits-drafts.py"), "series_renderer")
        renderer.render_batch(staged, staged / "drafts", batch["scope"], batch["batch_number"], as_of=as_of,
                              freeze_anchor_receipt=freeze_anchor_receipt,
                              effective_selection_receipt=effective_selection_receipt)
        if not dry_run:
            for target in set(TARGETS.values()) | {"series-progress.json", "series-batches.jsonl"}:
                os.replace(staged / target, research_root / target)
            draft = f"{batch['batch_id']}.md"
            (research_root / "drafts").mkdir(exist_ok=True)
            os.replace(staged / "drafts" / draft, research_root / "drafts" / draft)
    return new_progress


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_dir", type=Path, help="directory containing batch.json and five JSONL artifacts")
    parser.add_argument("--research-root", type=Path, default=Path("docs/research/company-benefits"))
    parser.add_argument("--freeze-anchor-receipt", type=Path, default=os.environ.get("COMPANY_BENEFITS_FREEZE_ANCHOR_RECEIPT"), required=False)
    parser.add_argument("--effective-selection-receipt", type=Path, default=os.environ.get("COMPANY_BENEFITS_EFFECTIVE_SELECTION_RECEIPT"))
    parser.add_argument("--as-of", type=lambda value: datetime.fromisoformat(value).date())
    parser.add_argument("--dry-run", action="store_true", help="validate, stage, verify, and render without changing the research root")
    args = parser.parse_args(argv)
    if args.freeze_anchor_receipt is None:
        parser.error("--freeze-anchor-receipt or COMPANY_BENEFITS_FREEZE_ANCHOR_RECEIPT is required")
    progress = integrate_batch(args.input_dir, args.research_root, args.freeze_anchor_receipt,
                               args.effective_selection_receipt, args.as_of, args.dry_run)
    approved = sum(item["status"] == "approved" for item in progress["batches"])
    print(f"validated {approved}/80 approved batches" + (" (dry run)" if args.dry_run else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
