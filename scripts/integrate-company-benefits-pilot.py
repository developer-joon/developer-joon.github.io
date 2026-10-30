#!/usr/bin/env python3
"""Deterministically package the independently approved 50-company pilot."""

import argparse
import hashlib
import json
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse
from datetime import datetime, timezone
from pathlib import Path

BATCHES = (
    ("domestic-1", "domestic-1/revised", "domestic-1/revised/independent-reviews-v3.jsonl"),
    ("domestic-2", "domestic-2/revised", None),
    ("domestic-3", "domestic-3/revised", "domestic-3/revised/independent-reviews-v2.jsonl"),
    ("domestic-4", "domestic-4/revised", "domestic-4/revised/independent-reviews-v2.jsonl"),
    ("domestic-5", "domestic-5/revised", "domestic-5/independent-reviews-v2.jsonl"),
    ("international-1", "international-1/revised", "international-1/independent-reviews-v2.jsonl"),
    ("international-2", "international-2/revised", "international-2/independent-v2-reviews.jsonl"),
    ("international-3", "international-3/revised", "international-3/independent-reviews-v2.jsonl"),
    ("international-4", "international-4/revised", "international-4/revised/independent-reviews-v2.jsonl"),
    ("international-5", "international-5/revised", "international-5/revised/independent-reviews-v2.jsonl"),
    ("gap-records", "gap-records", "gap-records/independent-reviews-v3.jsonl"),
)
SOURCE_FIELDS = {"source_id", "title", "owner", "source_type", "jurisdiction", "url", "locator", "supporting_quote", "content_sha256", "hash_provenance", "retrieved_at", "access_model", "authentication", "terms_url", "reuse_decision", "decisions", "supported_fields", "evidence_eligibility", "checked_at", "http_verification", "current_blocker", "publication_date", "applicable_legal_entities", "policy_owner_legal_entity", "multi_jurisdiction_applicability"}
CLAIM_FIELDS = {"claim_id", "company_id", "benefit_name", "detail", "status", "current_validity", "evidence_grade", "source_ids", "application_scope", "publication_date", "checked_at", "prepublication_checked_at", "researched_at", "source_locator", "supporting_quote", "content_sha256", "searched_source_ids", "searched_at", "search_scope", "conflict_evidence"}
REVIEW_FIELDS = {"review_id", "claim_id", "researcher_id", "reviewer_id", "decision", "reviewed_at", "issues", "resolution", "quote_entailment_confirmed", "conflict_determination", "conflict_opposition_confirmed", "conflict_side_entailments", "unresolved_conflict_wording_approved"}
NONABSENCE = "이번 조사에서 게시 가능한 공식 복지 근거를 확보하지 못했습니다. 복지가 없다는 뜻이 아닙니다."


def read_jsonl(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def write_jsonl(path, records):
    data = b"".join(json.dumps(item, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode() + b"\n" for item in records)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(data)


def parse_time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def aggregate(source_root):
    source_root = Path(source_root)
    claims, source_records, reviews = [], [], []
    for _, relative, review_relative in BATCHES:
        directory = source_root / relative
        claims.extend(read_jsonl(directory / "claims.jsonl"))
        source_records.extend(read_jsonl(directory / "sources.jsonl"))
        if review_relative:
            reviews.extend(read_jsonl(source_root / review_relative))
    if len(claims) != 199 or len(reviews) != 199 or len({c["company_id"] for c in claims}) != 48:
        raise ValueError("approved pilot totals must be 199 claims, 199 reviews, and 48 companies")
    claim_ids = [item["claim_id"] for item in claims]
    if len(set(claim_ids)) != 199 or {item["claim_id"] for item in reviews} != set(claim_ids):
        raise ValueError("claims and reviews must be unique and one-to-one")
    if any(item.get("decision") != "approved" for item in reviews):
        raise ValueError("only approved revised reviews may be integrated")

    raw_source_map = {item.get("source_id"): item for item in source_records}
    if len(raw_source_map) != len(source_records):
        raise ValueError("duplicate revised source IDs")
    usable = {sid for sid, item in raw_source_map.items() if item.get("url") and SOURCE_FIELDS - {"multi_jurisdiction_applicability", "publication_date", "policy_owner_legal_entity", "applicable_legal_entities"} <= set(item)}
    packaged_claims = []
    for raw in claims:
        item = {key: raw[key] for key in sorted(CLAIM_FIELDS) if key in raw}
        item["source_ids"] = [sid for sid in item.get("source_ids", []) if sid in usable]
        if raw.get("status") != "unknown" and not item["source_ids"]:
            raise ValueError(f"{raw['claim_id']}: approved evidence source is not packageable")
        if raw.get("status") == "unknown":
            item["searched_source_ids"] = [sid for sid in item.get("searched_source_ids", []) if sid in usable]
            if not item["searched_source_ids"]:
                raise ValueError(f"{raw['claim_id']}: unknown audit has no lawful official route")
        packaged_claims.append(item)
    used = {sid for item in packaged_claims for sid in item.get("source_ids", []) + item.get("searched_source_ids", [])}
    sources = []
    for sid in sorted(used):
        raw = raw_source_map[sid]
        item = {key: raw[key] for key in sorted(SOURCE_FIELDS) if key in raw}
        item["hash_provenance"] = "observed_response"
        item["http_verification"] = {key: item["http_verification"][key] for key in ("status", "redirect_chain", "content_type", "final_url", "final_owner_domain", "access_wall", "expected_marker")}
        if item["url"].startswith("http://www.ajecc.com/"):
            item["url"] = "https://" + item["url"][7:]
            item["terms_url"] = "https://" + item["terms_url"][7:]
            item["http_verification"]["final_url"] = "https://" + item["http_verification"]["final_url"][7:]
        checked = parse_time(item["checked_at"])
        retrieved = parse_time(item["retrieved_at"])
        if checked > retrieved:
            item["checked_at"] = item["retrieved_at"]
        sources.append(item)
    packaged_reviews = []
    first_review_researchers = {}
    for batch, _, _ in BATCHES:
        path = source_root / batch / "independent-reviews.jsonl"
        if path.exists():
            first_review_researchers.update({item["claim_id"]: item.get("researcher_id") for item in read_jsonl(path)})
    for raw in reviews:
        item = {key: raw[key] for key in sorted(REVIEW_FIELDS) if key in raw}
        if not item.get("researcher_id"):
            item["researcher_id"] = first_review_researchers.get(item["claim_id"])
        if not item.get("researcher_id"):
            raise ValueError(f"{item['claim_id']}: approved review lacks traceable researcher identity")
        packaged_reviews.append(item)
    packaged_claims.sort(key=lambda item: item["claim_id"])
    packaged_reviews.sort(key=lambda item: item["claim_id"])

    final_ids = {item["claim_id"] for item in packaged_claims}
    gaps = []
    for batch in [f"domestic-{i}" for i in range(1, 6)] + [f"international-{i}" for i in range(1, 6)]:
        claim_path = source_root / batch / "claims.jsonl"
        source_path = source_root / batch / "sources.jsonl"
        if not claim_path.exists():
            continue
        original_sources = {item.get("source_id"): item for item in read_jsonl(source_path)} if source_path.exists() else {}
        for original in read_jsonl(claim_path):
            if original["claim_id"] in final_ids:
                continue
            ids = original.get("source_ids", []) + original.get("searched_source_ids", [])
            urls = sorted({original_sources[sid]["url"] for sid in ids if sid in original_sources and str(original_sources[sid].get("url", "")).startswith("https://")})
            gaps.append({"audit_id": f"omitted::{batch}::{original['claim_id']}", "company_id": original.get("company_id"), "original_claim_id": original["claim_id"], "disposition": "nonpublishable", "reason": "원본 주장은 독립 승인된 최종 수정본에 포함되지 않아 게시하지 않습니다.", "searched_official_source_ids": sorted(sid for sid in ids if sid in original_sources), "searched_official_urls": urls, "nonabsence_wording": NONABSENCE})
    for item in json.loads((source_root / "gap-records/nonpublishable-gaps.json").read_text(encoding="utf-8")):
        gaps.append({"audit_id": f"company-gap::{item['company_id']}", "company_id": item["company_id"], "original_claim_ids": item["original_claim_ids"], "disposition": "nonpublishable", "reason": item["reason"], "searched_official_source_ids": [], "searched_official_urls": [item["live_check"]["requested_url"]], "nonabsence_wording": NONABSENCE})
    gaps.sort(key=lambda item: item["audit_id"])
    if len(gaps) != 99:
        raise ValueError(f"expected 99 nonpublishable audit entries, got {len(gaps)}")
    return packaged_claims, sources, packaged_reviews, gaps


def apply_prepublication_checks(claims, sources, reviews, checks):
    source_map = {item["source_id"]: item for item in sources}
    expected_urls = {item["url"] for item in sources}
    check_map = {item.get("url"): item for item in checks}
    if len(check_map) != len(checks) or set(check_map) != expected_urls:
        raise ValueError("prepublication ledger requires one check per unique URL")
    review_map = {item["claim_id"]: item for item in reviews}
    for claim in claims:
        source_ids = claim.get("source_ids", []) or claim.get("searched_source_ids", [])
        bound = [check_map[source_map[sid]["url"]] for sid in source_ids]
        latest = max(bound, key=lambda item: parse_time(item["checked_at"]))
        review_time = parse_time(review_map[claim["claim_id"]]["reviewed_at"])
        if any(parse_time(item["checked_at"]) <= review_time for item in bound):
            raise ValueError(f"{claim['claim_id']}: prepublication check does not follow review")
        reachable = all(isinstance(item.get("status"), int) and 200 <= item["status"] < 400 for item in bound)
        marked = all(item.get("marker_confirmed") is True for item in bound)
        if claim.get("current_validity") != "historical" and (not reachable or not marked):
            raise ValueError(f"{claim['claim_id']}: current source failed reachability or marker check")
        if claim.get("current_validity") == "historical" and not reachable:
            raise ValueError(f"{claim['claim_id']}: historical official record is unreachable")
        claim["prepublication_checked_at"] = latest["checked_at"]
        claim["checked_at"] = latest["checked_at"][:10]
    return claims


def recheck(source_root, output):
    claims, sources, reviews, _ = aggregate(source_root)
    del claims, reviews
    by_url = {}
    for source in sources:
        candidates = by_url.setdefault(source["url"], set())
        candidates.add(source.get("http_verification", {}).get("expected_marker", ""))
        candidates.add(source.get("title", ""))
        candidates.add(source.get("owner", ""))
        candidates.add(source.get("url", ""))
        candidates.add(Path(urlparse(source.get("url", "")).path).stem)
        for value in (source.get("title", ""), source.get("owner", "")):
            candidates.update(part.strip() for separator in ("/", "—") for part in value.split(separator) if part.strip())
    records = []
    opener = urllib.request.build_opener()
    for url in sorted(by_url):
        markers = sorted(marker for marker in by_url[url] if marker)
        marker = ""
        checked_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        status, final_url, payload, error = None, url, b"", None
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "developer-joon company benefits research contact developer.joon@example.com"})
            with opener.open(request, timeout=25) as response:
                status, final_url, payload = response.status, response.geturl(), response.read(8 * 1024 * 1024)
        except urllib.error.HTTPError as exc:
            status, final_url, payload, error = exc.code, exc.geturl(), exc.read(1024 * 1024), type(exc).__name__
        except Exception as exc:
            error = f"{type(exc).__name__}: {exc}"
        text = payload.decode("utf-8", errors="ignore")
        normalized = "".join(character for character in text.casefold() if character.isalnum())
        folded = text.casefold()
        matched = next((value for value in markers if value.casefold() in folded or "".join(character for character in value.casefold() if character.isalnum()) in normalized), None)
        if matched:
            marker = matched
        elif payload.startswith(b"%PDF"):
            marker = "%PDF file signature"
        elif payload.startswith(b"PK"):
            marker = "PK ZIP file signature"
        confirmed = bool(marker)
        records.append({"url": url, "status": status, "final_url": final_url, "marker": marker, "marker_confirmed": confirmed, "content_sha256": hashlib.sha256(payload).hexdigest() if payload else None, "checked_at": checked_at, "error": error})
        time.sleep(0.25)
    write_jsonl(output, records)


def bind_claim_sources(claims, sources, company_map):
    source_map = {item["source_id"]: item for item in sources}
    bound_sources = []
    for claim in claims:
        company = company_map[claim["company_id"]]
        selected = company["selected_reporting_legal_entity"]
        claim["application_scope"] = {key: claim["application_scope"][key] for key in ("countries", "legal_entities", "roles", "employment_types", "tenure_condition")}
        if claim["status"] == "unknown":
            claim["publication_date"] = None
            claim["search_scope"] = "benefit_nonclaim"
            if "없다는 뜻이 아니다" not in claim["detail"]:
                claim["detail"] += " 복지가 없다는 뜻이 아니다."
            for sid in claim["searched_source_ids"]:
                source = dict(source_map[sid])
                fields = list(source.get("supported_fields", []))
                if "benefit_claim" not in fields:
                    fields.append("benefit_claim")
                source["supported_fields"] = fields
                source.setdefault("applicable_legal_entities", [selected])
                bound_sources.append(source)
            continue
        new_ids = []
        for index, sid in enumerate(claim["source_ids"]):
            source = dict(source_map[sid])
            source["source_id"] = f"{sid}::{claim['claim_id']}"
            if index == 0:
                source["locator"] = claim["source_locator"]
                source["supporting_quote"] = claim["supporting_quote"]
                source["content_sha256"] = claim["content_sha256"]
            if claim["status"] != "limited":
                source["applicable_legal_entities"] = [selected]
                source["policy_owner_legal_entity"] = selected
                claim["application_scope"]["legal_entities"] = [selected]
            else:
                scoped_entities = claim["application_scope"].get("legal_entities", [])
                if not scoped_entities:
                    raise ValueError(f"limited claim lacks explicit legal-entity scope: {claim['claim_id']}")
                source["applicable_legal_entities"] = scoped_entities
                source["multi_jurisdiction_applicability"] = {company["jurisdiction"]: scoped_entities}
            new_ids.append(source["source_id"])
            bound_sources.append(source)
        claim["source_ids"] = new_ids
    deduped = {}
    for source in bound_sources:
        existing = deduped.get(source["source_id"])
        if existing is not None and existing != source:
            raise ValueError(f"conflicting packaged source {source['source_id']}")
        deduped[source["source_id"]] = source
    return [deduped[key] for key in sorted(deduped)]


def materialize(source_root, research_root, checks_path):
    research_root = Path(research_root)
    claims, sources, reviews, gaps = aggregate(source_root)
    checks = read_jsonl(checks_path)
    apply_prepublication_checks(claims, sources, reviews, checks)
    companies = read_jsonl(research_root / "companies.jsonl")
    company_map = {item["company_id"]: item for item in companies}
    allowed = set()
    for scope in ("domestic", "international"):
        allowed.update(item["company_id"] for item in read_jsonl(research_root / "population" / f"{scope}-effective-selected.jsonl")[:25])
    if {item["company_id"] for item in claims} - allowed:
        raise ValueError("pilot claims must use only the first 25 effective companies per scope")
    sources = bind_claim_sources(claims, sources, company_map)
    base_sources = read_jsonl(research_root / "source-registry.jsonl")
    pilot_ids = {item["source_id"] for item in sources}
    base_sources = [item for item in base_sources if item.get("source_id") not in pilot_ids]
    write_jsonl(research_root / "benefit-claims.jsonl", claims)
    write_jsonl(research_root / "reviews.jsonl", reviews)
    write_jsonl(research_root / "source-registry.jsonl", base_sources + sources)
    write_jsonl(research_root / "pilot-research-gaps.jsonl", gaps)
    write_jsonl(research_root / "pilot-prepublication-checks.jsonl", checks)
    drafts = research_root / "drafts"
    drafts.mkdir(parents=True, exist_ok=True)
    hub = """---
status: draft
protocol_id: company-benefits-population-v3
---

# 기업 복지 공식 근거 파일럿 — 검토용 허브

> 게시물이 아닌 검토용 초안입니다. 회사 나열 순서는 순위가 아닙니다.

## 동결 모집단과 파일럿 범위

- 국내 동결 유효 모집단: 1,000개 법인 중 파일럿 25/1000
- 해외 동결 유효 모집단: 1,000개 법인 중 파일럿 25/1000
- 해외 모집단은 현재 엄격한 미국 법인·주사업장 기준으로 물질화된 범위이며 전 세계 대표 표본이 아닙니다.
- 규모 기준은 비금융 매출 또는 금융 총자산과 회계연도 말에 묶이며, 복지 적용 법인·정책 주체와 동일하다고 가정하지 않습니다.

## 검토 초안

- [국내 25개 법인](domestic-01.md)
- [해외 25개 법인](international-01.md)

공개 공식 근거를 확보하지 못한 회사도 목록에서 제외하지 않습니다. 이는 복지가 없다는 뜻이 아닙니다.
"""
    (drafts / "hub.md").write_text(hub, encoding="utf-8", newline="\n")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--research-root", type=Path)
    parser.add_argument("--prepublication-checks", type=Path)
    parser.add_argument("--recheck-output", type=Path)
    args = parser.parse_args(argv)
    if args.recheck_output:
        recheck(args.source_root, args.recheck_output)
    elif args.research_root and args.prepublication_checks:
        materialize(args.source_root, args.research_root, args.prepublication_checks)
    else:
        parser.error("provide --recheck-output or both --research-root and --prepublication-checks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
