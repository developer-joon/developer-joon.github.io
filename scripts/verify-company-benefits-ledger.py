#!/usr/bin/env python3
"""Fail-closed validation for company-benefits research ledgers."""

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from datetime import date, datetime
from pathlib import Path

CLAIM_STATUSES = {"confirmed", "limited", "past", "name_only", "unknown", "conflict"}
EVIDENCE_GRADES = {"A", "B", "none"}
EVIDENCED_STATUSES = {"confirmed", "limited", "past", "name_only"}
SOURCE_DECISIONS = ("extract", "quote", "retention", "snapshot", "attribution")
PROHIBITED_POPULATION_FILES = {
    "domestic-eligible.jsonl", "international-eligible.jsonl",
    "domestic-selected.jsonl", "international-selected.jsonl",
    "domestic-effective-selected.jsonl", "international-effective-selected.jsonl",
    "effective-selection-events.jsonl", "freeze-manifest.json",
    "effective-selection-manifest.json",
}
RANKING_PATTERNS = (
    re.compile(r"세계\s*매출\s*순위"),
    re.compile(r"매출\s*(?:상위|순위)\s*\d"),
    re.compile(r"(?:global|world|revenue)\s+(?:revenue\s+)?rank(?:ing)?", re.I),
)


def read_json(path, errors):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"{path}: invalid JSON: {exc}")
        return None


def read_jsonl(path, errors):
    if not path.exists():
        return []
    records = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            errors.append(f"{path}:{line_number}: invalid JSON: {exc}")
            continue
        if not isinstance(value, dict):
            errors.append(f"{path}:{line_number}: record must be an object")
            continue
        records.append(value)
    return records


def find_file(root, name):
    direct = root / name
    if direct.exists():
        return direct
    matches = sorted(root.rglob(name))
    return matches[0] if matches else direct


def parse_day(value, field, record_id, errors):
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        errors.append(f"{record_id}: invalid {field}")
        return None


def required(record, fields, kind, record_id, errors):
    for field in fields:
        if field not in record or record[field] in (None, ""):
            label = f"{kind} {field}" if kind else field
            errors.append(f"{record_id}: missing {label}")


def canonical_values(protocol, company):
    def norm(value, collapse=False):
        value = unicodedata.normalize("NFC", value).strip()
        return re.sub(r"\s+", " ", value) if collapse else value

    seed = protocol.get("canonical_selection", {}).get("seed")
    fields = (seed, company.get("jurisdiction"), company.get("registry_id"), company.get("legal_name"))
    if not all(isinstance(v, str) and v.strip() for v in fields):
        return None
    return [norm(fields[0]), norm(fields[1]), norm(fields[2]), norm(fields[3], True)]


def canonical_hash(protocol, company):
    values = canonical_values(protocol, company)
    if values is None:
        return None
    payload = json.dumps(values, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def source_is_eligible(source):
    if source.get("evidence_eligibility") not in {"A", "B"}:
        return False
    if source.get("access_model") not in {"public_keyless", "public_api_key"}:
        return False
    decisions = source.get("decisions", {})
    return decisions.get("extract") == "allowed" and decisions.get("quote") == "allowed" and decisions.get("attribution") in {"allowed", "required"}


def validate_sources(sources, errors):
    seen = set()
    result = {}
    required_fields = ("source_id", "owner", "source_type", "jurisdiction", "url", "access_model", "authentication", "terms_url", "reuse_decision", "decisions", "supported_fields", "evidence_eligibility", "checked_at", "http_verification")
    for index, source in enumerate(sources, 1):
        source_id = source.get("source_id") or f"source[{index}]"
        required(source, required_fields, "source", source_id, errors)
        if "current_blocker" not in source:
            errors.append(f"{source_id}: missing source current_blocker")
        if source_id in seen:
            errors.append(f"duplicate source_id: {source_id}")
        seen.add(source_id)
        result[source_id] = source
        decisions = source.get("decisions", {})
        for decision in SOURCE_DECISIONS:
            if decision not in decisions:
                errors.append(f"{source_id}: missing source decision {decision}")
        auth = source.get("authentication", {})
        for field in ("api_key", "login", "fee"):
            if field not in auth:
                errors.append(f"{source_id}: missing authentication decision {field}")
        http = source.get("http_verification", {})
        for field in ("status", "redirect_chain", "content_type", "final_url", "final_owner_domain", "access_wall", "expected_marker"):
            if field not in http:
                errors.append(f"{source_id}: missing http_verification {field}")
    return result


def validate_companies(protocol, companies, source_map, errors):
    seen = set()
    for index, company in enumerate(companies, 1):
        company_id = company.get("company_id") or f"company[{index}]"
        required(company, ("company_id", "jurisdiction", "scope", "registry_id", "legal_name", "selected_employer_legal_entity", "registered_head_office_country", "benefit_policy_owner", "entity_status", "sector", "scale_metric", "selection_hash"), "", company_id, errors)
        if company_id in seen:
            errors.append(f"duplicate company_id: {company_id}")
        seen.add(company_id)
        jurisdiction = company.get("jurisdiction")
        if not isinstance(jurisdiction, str) or not re.fullmatch(r"[A-Z]{2}", jurisdiction):
            errors.append(f"{company_id}: invalid jurisdiction")
        scope = company.get("scope")
        office = company.get("registered_head_office_country")
        if scope == "domestic" and office != "KR":
            errors.append(f"{company_id}: domestic scope requires KR registered head office")
        if scope == "international" and office == "KR":
            errors.append(f"{company_id}: international scope excludes KR registered head office")
        if scope not in {"domestic", "international"}:
            errors.append(f"{company_id}: invalid scope")
        if company.get("entity_status") != "active":
            errors.append(f"{company_id}: invalid entity status")
        metric = company.get("scale_metric", {})
        expected_type = "total_assets" if company.get("sector") == "financial" else "revenue"
        if metric.get("type") != expected_type:
            errors.append(f"{company_id}: invalid scale metric type")
        required(metric, ("type", "value", "currency", "band", "fiscal_year_end", "financial_scope", "source_ids"), "scale metric", company_id, errors)
        for source_id in metric.get("source_ids", []):
            if source_id not in source_map:
                errors.append(f"{company_id}: unknown scale source {source_id}")
        expected_hash = canonical_hash(protocol, company)
        if expected_hash is None or company.get("selection_hash") != expected_hash:
            errors.append(f"{company_id}: selection_hash mismatch")
    return seen


def validate_claims(claims, companies, source_map, as_of, errors):
    seen = set()
    claim_ids = set()
    for index, claim in enumerate(claims, 1):
        claim_id = claim.get("claim_id") or f"claim[{index}]"
        required(claim, ("claim_id", "company_id", "benefit_name", "detail", "status", "evidence_grade", "source_ids", "application_scope", "checked_at"), "", claim_id, errors)
        if claim_id in seen:
            errors.append(f"duplicate claim_id: {claim_id}")
        seen.add(claim_id)
        claim_ids.add(claim_id)
        if claim.get("company_id") not in companies:
            errors.append(f"{claim_id}: unknown company_id")
        status = claim.get("status")
        if status not in CLAIM_STATUSES:
            errors.append(f"{claim_id}: invalid status")
        grade = claim.get("evidence_grade")
        if grade not in EVIDENCE_GRADES:
            errors.append(f"{claim_id}: invalid evidence grade")
        eligible = [sid for sid in claim.get("source_ids", []) if sid in source_map and source_is_eligible(source_map[sid])]
        required_count = 2 if status == "conflict" else (1 if status in EVIDENCED_STATUSES else 0)
        if len(set(eligible)) < required_count:
            noun = "sources" if required_count == 2 else "source"
            errors.append(f"{claim_id}: {status} requires at least {'two' if required_count == 2 else 'one'} eligible A/B {noun}")
        if status == "unknown":
            if grade != "none" or claim.get("source_ids"):
                errors.append(f"{claim_id}: unknown must be a non-claim without evidence grade")
            if not claim.get("searched_source_ids"):
                errors.append(f"{claim_id}: unknown requires searched_source_ids")
            if "없다는 뜻이 아니다" not in claim.get("detail", ""):
                errors.append(f"{claim_id}: unknown wording must not imply absence")
        else:
            required(claim, ("publication_date", "prepublication_checked_at", "source_locator", "supporting_quote", "content_sha256"), "claim", claim_id, errors)
            if not re.fullmatch(r"[0-9a-f]{64}", str(claim.get("content_sha256", ""))):
                errors.append(f"{claim_id}: invalid content_sha256")
        app = claim.get("application_scope", {})
        for field in ("countries", "legal_entities", "roles", "employment_types", "tenure_condition"):
            if app.get(field) in (None, "", []):
                errors.append(f"{claim_id}: missing application_scope.{field}")
        published = parse_day(claim.get("publication_date"), "publication_date", claim_id, errors)
        checked = parse_day(claim.get("checked_at"), "checked_at", claim_id, errors)
        prepub = parse_day(claim.get("prepublication_checked_at"), "prepublication_checked_at", claim_id, errors)
        if status in {"confirmed", "limited", "name_only"} and published and (as_of - published).days > 731:
            errors.append(f"{claim_id}: source is older than 24 months")
        if status in EVIDENCED_STATUSES | {"conflict"} and not published and checked and (as_of - checked).days > 30:
            errors.append(f"{claim_id}: undated source was not checked within 30 days")
        if status in EVIDENCED_STATUSES | {"conflict"} and prepub and (as_of - prepub).days > 14:
            errors.append(f"{claim_id}: prepublication check is older than 14 days")
    return claim_ids


def validate_reviews(reviews, claim_ids, errors):
    seen = set()
    reviewed = set()
    for index, review in enumerate(reviews, 1):
        review_id = review.get("review_id") or f"review[{index}]"
        required(review, ("review_id", "claim_id", "researcher_id", "reviewer_id", "decision", "reviewed_at", "resolution"), "review", review_id, errors)
        if "issues" not in review or not isinstance(review.get("issues"), list):
            errors.append(f"{review_id}: missing review issues")
        if review_id in seen:
            errors.append(f"duplicate review_id: {review_id}")
        seen.add(review_id)
        if review.get("claim_id") not in claim_ids:
            errors.append(f"{review_id}: unknown claim_id")
        else:
            reviewed.add(review.get("claim_id"))
        if review.get("researcher_id") == review.get("reviewer_id"):
            errors.append(f"{review_id}: review self-approval is prohibited")
    for claim_id in claim_ids - reviewed:
        errors.append(f"{claim_id}: missing independent review")


def validate_corrections(corrections, claim_ids, errors):
    seen = set()
    for index, correction in enumerate(corrections, 1):
        correction_id = correction.get("correction_id") or f"correction[{index}]"
        required(correction, ("correction_id", "claim_id", "status", "received_at", "official_source_ids", "decision", "decided_by", "decided_at"), "correction", correction_id, errors)
        if correction_id in seen:
            errors.append(f"duplicate correction_id: {correction_id}")
        seen.add(correction_id)
        if correction.get("claim_id") not in claim_ids:
            errors.append(f"{correction_id}: unknown claim_id")


def validate_ranking_language(root, errors):
    for path in sorted(root.rglob("*.md")):
        if path.name in {"methodology.md", "population-protocol.md"}:
            continue
        text = path.read_text(encoding="utf-8")
        for pattern in RANKING_PATTERNS:
            if pattern.search(text):
                errors.append(f"{path}: prohibited ranking language")
                break


def validate_manifests(root, protocol_path, errors):
    manifest_path = find_file(root, "freeze-manifest.json")
    if not manifest_path.exists():
        return
    manifest = read_json(manifest_path, errors)
    if not isinstance(manifest, dict):
        return
    actual_protocol_hash = hashlib.sha256(protocol_path.read_bytes()).hexdigest()
    if manifest.get("protocol_sha256") != actual_protocol_hash:
        errors.append(f"{manifest_path}: protocol_sha256 mismatch")
    for item in manifest.get("ledger_hashes", []):
        relative = item.get("path") if isinstance(item, dict) else None
        expected = item.get("sha256") if isinstance(item, dict) else None
        ledger_path = root / relative if relative else None
        if ledger_path is None or not ledger_path.is_file():
            errors.append(f"{manifest_path}: missing frozen ledger {relative}")
        elif not re.fullmatch(r"[0-9a-f]{64}", str(expected or "")) or hashlib.sha256(ledger_path.read_bytes()).hexdigest() != expected:
            errors.append(f"{manifest_path}: frozen ledger hash mismatch for {relative}")


def verify_workspace(root, as_of=None):
    root = Path(root)
    as_of = as_of or date.today()
    errors = []
    protocol_path = find_file(root, "population-protocol.json")
    protocol = read_json(protocol_path, errors) if protocol_path.exists() else None
    if not isinstance(protocol, dict):
        errors.append("missing population protocol")
        return errors
    status = protocol.get("status")
    if status != "approved":
        errors.append(f"protocol status is {status or 'missing'}; approved protocol required")
    approval = protocol.get("approval")
    if status == "approved" and (not isinstance(approval, dict) or not approval.get("approved_by") or not approval.get("approved_at")):
        errors.append("approved protocol is missing explicit approval")
    if status != "approved":
        for name in PROHIBITED_POPULATION_FILES:
            for path in root.rglob(name):
                errors.append(f"prohibited population artifact while protocol is blocked: {path}")

    sources = read_jsonl(find_file(root, "source-registry.jsonl"), errors)
    if not sources:
        sources = read_jsonl(find_file(root, "sources.jsonl"), errors)
    source_map = validate_sources(sources, errors)
    companies = read_jsonl(find_file(root, "companies.jsonl"), errors)
    claims = read_jsonl(find_file(root, "benefit-claims.jsonl"), errors)
    reviews = read_jsonl(find_file(root, "reviews.jsonl"), errors)
    corrections = read_jsonl(find_file(root, "corrections.jsonl"), errors)
    company_ids = validate_companies(protocol, companies, source_map, errors)
    claim_ids = validate_claims(claims, company_ids, source_map, as_of, errors)
    validate_reviews(reviews, claim_ids, errors)
    validate_corrections(corrections, claim_ids, errors)
    validate_manifests(root, protocol_path, errors)
    validate_ranking_language(root, errors)
    return errors


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", default="docs/research/company-benefits")
    parser.add_argument("--as-of", type=date.fromisoformat)
    args = parser.parse_args(argv)
    errors = verify_workspace(Path(args.root), args.as_of)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print("company-benefits ledger verification passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
