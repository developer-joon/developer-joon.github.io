#!/usr/bin/env python3
"""Build immutable v2 public artifacts from a complete approved research series."""

import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import sys
import tempfile
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlparse

COMPANY_ID = re.compile(r"^(?:KR-CRN-[0-9]{13}|US-CIK[0-9]{10})$")
FORBIDDEN_KEY = re.compile(r"score|rank|percentile|coverage(?:_percent)?", re.IGNORECASE)
UNKNOWN_MARKERS = (
    "not stated", "not publicly specified", "not established", "unspecified",
    "출처에 명시되지 않음", "확인 불가",
)
NONABSENCE_NOTICE = "이번 조사에서 게시 가능한 공식 복지 근거를 확보하지 못했습니다. 복지가 없다는 뜻이 아닙니다."


def canonical_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8") + b"\n"


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def reject_duplicate_keys(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError(f"duplicate JSON key: {key}")
        value[key] = item
    return value


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=reject_duplicate_keys)


def read_jsonl(path):
    rows = []
    for number, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line, object_pairs_hook=reject_duplicate_keys)
        except (json.JSONDecodeError, ValueError) as exc:
            raise ValueError(f"{Path(path).name}:{number}: {exc}") from exc
        if not isinstance(value, dict):
            raise ValueError(f"{Path(path).name}:{number}: row must be an object")
        rows.append(value)
    return rows


def unique_map(rows, field, label):
    result = {}
    for row in rows:
        key = row.get(field)
        if not isinstance(key, str) or not key or key in result:
            raise ValueError(f"{label} requires unique nonempty {field}")
        result[key] = row
    return result


def parse_time(value, label):
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError
        return parsed
    except (TypeError, ValueError):
        raise ValueError(f"invalid {label}") from None


def taxonomy_contract(taxonomy):
    categories = taxonomy.get("categories")
    types = taxonomy.get("benefit_types")
    mappings = taxonomy.get("dol_form_5500_mappings")
    if taxonomy.get("taxonomy_version") != "benefit-taxonomy-v1":
        raise ValueError("unsupported taxonomy version")
    if not isinstance(categories, list) or len(categories) != 10 or [item.get("order") for item in categories] != list(range(1, 11)):
        raise ValueError("taxonomy must contain ten canonically ordered categories")
    category_ids = [item.get("id") for item in categories]
    type_ids = [item.get("id") for item in types or []]
    if len(set(category_ids)) != 10 or len(type_ids) != 45 or len(set(type_ids)) != 45:
        raise ValueError("taxonomy category/type cardinality mismatch")
    if {item.get("category_id") for item in types} != set(category_ids):
        raise ValueError("taxonomy benefit type category reference mismatch")
    pairs = [(item.get("field"), item.get("code")) for item in mappings or []]
    if len(pairs) != 9 or len(set(pairs)) != 9 or any(
        item.get("benefit_type_id") not in set(type_ids)
        or item.get("forced_status") != "bounded"
        or item.get("evidence_semantics") != "historical_named_plan_feature_only"
        for item in mappings
    ):
        raise ValueError("DOL mappings must remain unique, bounded historical named-plan evidence")


def load_assignment_validator():
    path = Path(__file__).with_name("validate-benefit-taxonomy-assignments.py")
    spec = importlib.util.spec_from_file_location("benefit_taxonomy_assignments", path)
    if spec is None or spec.loader is None:
        raise ValueError("cannot load taxonomy assignment validator")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_verifier():
    path = Path(__file__).with_name("verify-company-benefits-ledger.py")
    spec = importlib.util.spec_from_file_location("company_benefits_artifact_verifier", path)
    if spec is None or spec.loader is None:
        raise ValueError("cannot load company-benefits ledger verifier")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def verify_active_ledgers(research_root, as_of, freeze_anchor_receipt, effective_selection_receipt):
    errors = load_verifier().verify_workspace(
        Path(research_root), as_of=as_of,
        freeze_anchor_receipt=freeze_anchor_receipt,
        effective_selection_receipt=effective_selection_receipt,
    )
    if errors:
        raise ValueError("active ledger verification failed:\n" + "\n".join(errors))


def fixture_marker(value):
    if isinstance(value, dict):
        if value.get("fixture") is True:
            return True
        return any(fixture_marker(item) for item in value.values())
    if isinstance(value, list):
        return any(fixture_marker(item) for item in value)
    if isinstance(value, str):
        folded = value.casefold()
        return folded.startswith("example-") or "fictional fixture" in folded or "synthetic fixture" in folded
    return False


def _assemble_inputs(root, taxonomy, taxonomy_sha256):
    series = load_verifier().company_benefits_series
    progress = read_json(root / "series-progress.json")
    if series.progress_contract_version(progress) != "2":
        raise ValueError("v2 artifact publication requires explicit progress_version=2")
    entries = progress.get("batches")
    if progress.get("status") != "complete" or progress.get("total_companies") != 2000 or progress.get("total_batches") != 80:
        raise ValueError("series progress must be complete for exactly 2,000 companies and 80 batches")
    if not isinstance(entries, list) or len(entries) != 80 or any(item.get("status") != "approved" for item in entries):
        raise ValueError("all 80 series batches must be approved")
    if any(not item.get("reviewer_ids") or not item.get("approved_at") for item in entries):
        raise ValueError("approved batches require approval time and reviewer identity")

    companies = read_jsonl(root / "companies.jsonl")
    if len(companies) != 2000:
        raise ValueError("active companies ledger must contain exactly 2,000 companies")
    company_map = unique_map(companies, "company_id", "companies ledger")
    if any(not COMPANY_ID.fullmatch(company_id) for company_id in company_map):
        if any(company_id.startswith("example-") for company_id in company_map):
            raise ValueError("fixture company ID leaked into production input")
        raise ValueError("production company ID must be KR-CRN-* or US-CIK*")
    if fixture_marker(companies):
        raise ValueError("fixture marker leaked into production companies")

    batches = read_jsonl(root / "series-batches.jsonl")
    if len(batches) != 80:
        raise ValueError("series batch ledger must contain exactly 80 batches")
    batch_ids = [company_id for batch in batches for company_id in batch.get("company_ids", [])]
    if len(batch_ids) != 2000 or len(set(batch_ids)) != 2000 or batch_ids != list(company_map):
        raise ValueError("series batches must bind the exact canonical 2,000-company sequence")
    claims = read_jsonl(root / "benefit-claims.jsonl")
    if any(row.get("publishable") is False or "record_type" in row or "record" in row for row in claims):
        raise ValueError("historical/nonpublishable wrapper cannot enter active claims")
    claim_map = unique_map(claims, "claim_id", "active claims")
    if not claims:
        raise ValueError("production generation requires active approved claims")
    if fixture_marker(claims):
        raise ValueError("fixture marker leaked into active claims")

    gaps = read_jsonl(root / "series-research-gaps.jsonl")
    gap_map = unique_map(gaps, "audit_id", "research gaps")
    reviews = read_jsonl(root / "reviews.jsonl")
    sources = read_jsonl(root / "source-registry.jsonl")
    source_map = unique_map(sources, "source_id", "source registry")
    checks = read_jsonl(root / "series-prepublication-checks.jsonl")
    check_map = unique_map(checks, "source_id", "prepublication checks")

    claim_reviews = {}
    gap_reviews = {}
    for review in reviews:
        target = review.get("claim_id") or review.get("record_id")
        target_map = claim_reviews if review.get("claim_id") else gap_reviews
        if not target or target in target_map:
            raise ValueError("reviews require exact one-to-one claim or gap targets")
        if review.get("decision") != "approved" or review.get("researcher_id") == review.get("reviewer_id") or review.get("quote_entailment_confirmed") is not True:
            raise ValueError(f"{target}: review must be approved and independent")
        parse_time(review.get("reviewed_at"), f"{target} reviewed_at")
        target_map[target] = review
    if set(claim_reviews) != set(claim_map) or set(gap_reviews) != set(gap_map):
        raise ValueError("approved claim/gap review coverage must be exact")

    claims_by_company = {}
    for claim in claims:
        company_id = claim.get("company_id")
        if company_id not in company_map:
            raise ValueError(f"{claim.get('claim_id')}: claim company is not active")
        claims_by_company.setdefault(company_id, []).append(claim)
    gaps_by_company = {}
    for gap in gaps:
        company_id = gap.get("company_id")
        if company_id not in company_map or gap.get("audit_id") != f"company-gap::{company_id}":
            raise ValueError("gap must exactly bind one active company")
        if "복지가 없다는 뜻이 아닙니다" not in gap.get("nonabsence_wording", ""):
            raise ValueError(f"{gap.get('audit_id')}: gap must carry Korean non-absence wording")
        gaps_by_company.setdefault(company_id, []).append(gap)
    for company_id in company_map:
        if bool(claims_by_company.get(company_id)) == bool(gaps_by_company.get(company_id)) or len(gaps_by_company.get(company_id, [])) > 1:
            raise ValueError(f"{company_id}: company must have claims or exactly one approved gap")
    progress_by_batch = {item.get("batch_id"): item for item in entries}
    if len(progress_by_batch) != 80 or set(progress_by_batch) != {item.get("batch_id") for item in batches}:
        raise ValueError("series progress must exactly cover canonical batches")
    for batch in batches:
        entry = progress_by_batch[batch["batch_id"]]
        company_ids = batch.get("company_ids", [])
        claim_count = sum(len(claims_by_company.get(company_id, [])) for company_id in company_ids)
        gap_count = sum(len(gaps_by_company.get(company_id, [])) for company_id in company_ids)
        if entry.get("claim_count") != claim_count or entry.get("no_claim_count") != gap_count:
            raise ValueError(f"{batch['batch_id']}: approved progress counts do not match active claims/gaps")

    used_source_ids = set()
    for claim in claims:
        source_ids = claim.get("source_ids", []) + claim.get("searched_source_ids", [])
        if not isinstance(source_ids, list) or not source_ids:
            raise ValueError(f"{claim.get('claim_id')}: claim requires bound source IDs")
        used_source_ids.update(source_ids)
    for gap in gaps:
        used_source_ids.update(series.validate_gap_source_routes(gap, source_map))
    if set(check_map) != used_source_ids:
        raise ValueError("prepublication checks must exactly cover all used sources")
    for source_id in used_source_ids:
        source = source_map.get(source_id)
        check = check_map.get(source_id)
        if source is None:
            raise ValueError(f"unknown source ID: {source_id}")
        if check is None:
            raise ValueError(f"{source_id}: missing prepublication check")
        parsed = urlparse(str(source.get("url", "")))
        if parsed.scheme != "https" or parsed.username or parsed.password:
            raise ValueError(f"{source_id}: source URL must be credential-free HTTPS")
        if check.get("url") != source.get("url"):
            raise ValueError(f"{source_id}: prepublication check URL binding mismatch")
        if source.get("record_type") == "nonpublishable_metadata":
            observation = source.get("access_observation", {})
            if any(check.get(field) != observation.get(field) for field in ("status", "final_url", "access_wall")):
                raise ValueError(f"{source_id}: metadata-only route check mismatch")
        else:
            expected_final = source.get("http_verification", {}).get("final_url", source.get("url"))
            if (check.get("status") != 200 or check.get("final_url") != expected_final
                    or check.get("marker_confirmed") is not True
                    or check.get("content_sha256") != source.get("content_sha256")):
                raise ValueError(f"{source_id}: approved successful exact prepublication check required")
        checked = parse_time(check.get("checked_at"), f"{source_id} checked_at")
        targets = [claim_reviews[claim["claim_id"]] for claim in claims if source_id in claim.get("source_ids", []) + claim.get("searched_source_ids", [])]
        targets += [gap_reviews[gap["audit_id"]] for gap in gaps if source_id in gap.get("searched_official_source_ids", [])]
        if any(checked <= parse_time(review["reviewed_at"], "reviewed_at") for review in targets):
            raise ValueError(f"{source_id}: source check must follow independent review")

    assignments = read_jsonl(root / "benefit-taxonomy-assignments.jsonl")
    requests = read_jsonl(root / "benefit-taxonomy-assignment-requests.jsonl")
    assignment_validator = load_assignment_validator()
    assignment_map = assignment_validator.validate_assignments(
        assignments,
        requests,
        assignment_validator.read_jsonl_records(root / "benefit-claims.jsonl"),
        assignment_validator.read_jsonl_records(root / "source-registry.jsonl"),
        assignment_validator.read_jsonl_records(root / "reviews.jsonl"),
        assignment_validator.read_jsonl_records(root / "series-prepublication-checks.jsonl"),
        taxonomy,
        taxonomy_sha256,
    )
    if set(assignment_map) != set(claim_map):
        raise ValueError("approved taxonomy outcomes must exactly cover every active claim")
    protocol_path = root / "population-protocol.json"
    effective_path = root / "population" / "effective-selection-manifest.json"
    protocol = read_json(protocol_path)
    protocol_binding = {
        "protocol_id": protocol["protocol_id"],
        "protocol_version": protocol["version"],
        "protocol_sha256": sha256(protocol_path.read_bytes()),
        "effective_selection_sha256": sha256(effective_path.read_bytes()),
    }
    return (companies, company_map, claims_by_company, gaps_by_company, source_map, assignment_map,
            claim_reviews, protocol_binding)


def validate_inputs(root, taxonomy, taxonomy_sha256):
    """Validate a standalone publication request without any caller-provided bypass."""
    root = Path(root)
    series = load_verifier().company_benefits_series
    series.validate_complete_v2_progress(root)
    return _assemble_inputs(root, taxonomy, taxonomy_sha256)


def publication_gate(research_root, taxonomy_path, as_of, freeze_anchor_receipt,
                     effective_selection_receipt):
    """Own the complete validation and input-loading operation before output."""
    root = Path(research_root)
    verify_active_ledgers(
        root, as_of, freeze_anchor_receipt, effective_selection_receipt
    )
    taxonomy_path = Path(taxonomy_path)
    taxonomy = read_json(taxonomy_path)
    taxonomy_contract(taxonomy)
    inputs = _assemble_inputs(
        root, taxonomy, hashlib.sha256(taxonomy_path.read_bytes()).hexdigest()
    )
    return taxonomy, inputs


def bounded_claim(claim):
    if claim.get("status") != "confirmed" or claim.get("current_validity") not in {"current", "undated_current"} or claim.get("evidence_grade") not in {"A", "B"}:
        return True
    scope = claim.get("application_scope", {})
    values = [*scope.get("countries", []), *scope.get("legal_entities", []), *scope.get("roles", []), *scope.get("employment_types", []), scope.get("tenure_condition", "")]
    return any(marker in str(value).casefold() for value in values for marker in UNKNOWN_MARKERS)


def unknown_projection(value, fallback):
    if isinstance(value, str) and value.strip():
        return value
    if isinstance(value, dict):
        reason = value.get("reason")
        if isinstance(reason, str) and reason.strip():
            return {"kind": "unknown", "reason": reason}
    return {"kind": "unknown", "reason": fallback}


def build_company(company, population_sequence, claims, gap, taxonomy, assignments, source_map):
    type_map = {item["id"]: item for item in taxonomy["benefit_types"]}
    category_ids = [item["id"] for item in taxonomy["categories"]]
    projections = []
    category_claims = {category_id: [] for category_id in category_ids}
    for claim in sorted(claims, key=lambda item: item["claim_id"]):
        if claim.get("status") == "unknown":
            continue
        assignment = assignments[claim["claim_id"]]["assignment"]
        if assignment["state"] == "unclassified":
            continue
        type_ids = assignment["benefit_type_ids"]
        categories = list(dict.fromkeys(type_map[type_id]["category_id"] for type_id in type_ids))
        limitations = []
        if bounded_claim(claim):
            limitations.append("scope_or_research_limit")
        if claim.get("current_validity") == "historical":
            limitations.append("historical_evidence")
        evidence_rows = []
        for evidence in claim.get("source_evidence", []):
            source = source_map[evidence["source_id"]]
            evidence_rows.append({
                **evidence,
                "source": {
                    "title": source["title"],
                    "owner": source["owner"],
                    "source_type": source["source_type"],
                    "jurisdiction": source["jurisdiction"],
                    "url": source["url"],
                    "final_owner_domain": source.get("final_owner_domain") or urlparse(source["url"]).hostname,
                    "publication_date": source.get("publication_date"),
                    "checked_at": source["checked_at"],
                    "evidence_eligibility": source["evidence_eligibility"],
                },
            })
        projection = {
            "claim_id": claim["claim_id"],
            "benefit_type_ids": type_ids,
            "category_ids": categories,
            "benefit_name": claim["benefit_name"],
            "detail": claim["detail"],
            "research_status": claim["status"],
            "current_validity": claim["current_validity"],
            "evidence_grade": claim["evidence_grade"],
            "application_scope": claim["application_scope"],
            "limitation_codes": limitations,
            "publication_date": claim.get("publication_date"),
            "checked_at": claim["prepublication_checked_at"],
            "source_evidence": evidence_rows,
        }
        projections.append(projection)
        for category_id in categories:
            category_claims[category_id].append((claim, type_ids, limitations))
    unknown = next((claim for claim in claims if claim.get("status") == "unknown"), None)
    outcomes = []
    for category_id in category_ids:
        evidence = category_claims[category_id]
        if evidence:
            claim_ids = list(dict.fromkeys(item[0]["claim_id"] for item in evidence))
            type_ids = list(dict.fromkeys(type_id for _, assigned, _ in evidence for type_id in assigned if type_map[type_id]["category_id"] == category_id))
            limitations = list(dict.fromkeys(code for _, _, codes in evidence for code in codes))
            scopes = [item[0]["application_scope"] for item in evidence]
            outcomes.append({
                "kind": "evidenced",
                "category_id": category_id,
                "status": "bounded" if limitations or any(bounded_claim(item[0]) for item in evidence) else "confirmed",
                "claim_count": len(claim_ids),
                "benefit_type_count": len(type_ids),
                "scope": {
                    "countries": list(dict.fromkeys(value for scope in scopes for value in scope["countries"])),
                    "legal_entities": list(dict.fromkeys(value for scope in scopes for value in scope["legal_entities"])),
                    "roles": list(dict.fromkeys(value for scope in scopes for value in scope["roles"])),
                    "employment_types": list(dict.fromkeys(value for scope in scopes for value in scope["employment_types"])),
                    "tenure_conditions": list(dict.fromkeys(scope["tenure_condition"] for scope in scopes)),
                },
                "limitation_codes": limitations,
                "last_checked_at": max(item[0]["prepublication_checked_at"] for item in evidence),
            })
        else:
            searched_ids = (unknown or {}).get("searched_source_ids", []) or (gap or {}).get("searched_official_source_ids", [])
            outcomes.append({
                "kind": "insufficient_evidence",
                "category_id": category_id,
                "reason_code": (gap or {}).get("reason_code", "searched_not_found" if unknown else "not_researched"),
                "nonabsence_notice": NONABSENCE_NOTICE,
                "searched_source_ids": searched_ids,
                "searched_at": (unknown or {}).get("searched_at", (gap or {}).get("searched_at")),
            })
    listing = {
        "company_id": company["company_id"],
        "population_sequence": population_sequence,
        "legal_name": company["legal_name"],
        "display_name": company.get("display_name") or company["legal_name"],
        "scope": company["scope"],
        "jurisdiction": company["jurisdiction"],
        "incorporation_country": company.get("incorporation_country") or company["jurisdiction"],
        "registered_head_office_country": company.get("registered_head_office_country") or company["jurisdiction"],
        "selected_reporting_legal_entity": company.get("selected_reporting_legal_entity") or company["legal_name"],
        "sector": company.get("sector", "non_financial"),
        "category_outcomes": outcomes,
    }
    detail_company = {
        "company_id": company["company_id"],
        "population_sequence": population_sequence,
        "legal_name": company["legal_name"],
        "scope": company["scope"],
        "jurisdiction": company["jurisdiction"],
        "registry_id": company.get("registry_id") or company["company_id"],
        "selected_reporting_legal_entity": company.get("selected_reporting_legal_entity") or company["legal_name"],
        "incorporation_country": company.get("incorporation_country") or company["jurisdiction"],
        "registered_head_office_country": company.get("registered_head_office_country") or company["jurisdiction"],
        "financial_consolidation_parent": unknown_projection(company.get("financial_consolidation_parent"), "Population evidence does not establish the financial consolidation parent."),
        "ultimate_parent": unknown_projection(company.get("ultimate_parent"), "Population evidence does not establish the ultimate parent."),
        "benefit_policy_owner": unknown_projection(company.get("benefit_policy_owner"), "Population evidence does not establish the benefit policy owner."),
        "sector": company.get("sector", "non_financial"),
        "employment_evidence_scope": company.get("employment_evidence_scope", ""),
        "employment_boundary_note": company.get("employment_boundary_note", ""),
    }
    return {"listing": listing, "company": detail_company, "category_outcomes": outcomes, "claims": projections}


def public_taxonomy(taxonomy):
    return {
        "artifact_kind": "benefit_taxonomy",
        "taxonomy_version": taxonomy["taxonomy_version"],
        "language": taxonomy.get("language", "ko-KR"),
        "categories": taxonomy["categories"],
        "benefit_types": taxonomy["benefit_types"],
        "dol_form_5500_mappings": taxonomy["dol_form_5500_mappings"],
    }


def scan_forbidden_keys(value, path="$"):
    if isinstance(value, dict):
        for key, child in value.items():
            if FORBIDDEN_KEY.search(key):
                raise ValueError(f"prohibited numeric/ranking key at {path}.{key}")
            scan_forbidden_keys(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            scan_forbidden_keys(child, f"{path}[{index}]")


def emit_artifacts(output_root, data_version, generated_at, taxonomy, inputs):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", data_version):
        raise ValueError("data version is unsafe")
    parse_time(generated_at, "generated_at")
    (companies, _, claims_by_company, gaps_by_company, source_map, assignments,
     claim_reviews, protocol_binding) = inputs
    output_root = Path(output_root)
    output_root.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{output_root.name}-", dir=output_root.parent))
    descriptors = {}

    def write_version(relative, value, record_count):
        scan_forbidden_keys(value)
        raw = canonical_bytes(value)
        target = staging / data_version / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        descriptor = {
            "url": f"community/data/company-benefits/{data_version}/{relative.as_posix()}",
            "sha256": sha256(raw),
            "record_count": record_count,
            "byte_count": len(raw),
        }
        descriptors[relative.as_posix()] = descriptor
        return descriptor

    try:
        details = {}
        listing = []
        for population_sequence, company in enumerate(companies, 1):
            company_id = company["company_id"]
            detail = build_company(
                company, population_sequence,
                claims_by_company.get(company_id, []),
                (gaps_by_company.get(company_id) or [None])[0],
                taxonomy,
                assignments,
                source_map,
            )
            details[company_id] = detail
            listing.append(detail["listing"])
        listing_descriptors = []
        for index in range(40):
            rows = listing[index * 50:(index + 1) * 50]
            relative = Path("listings") / f"companies-{index + 1:02d}.json"
            payload = {
                "schema_version": 1,
                "artifact_kind": "company_listing_chunk",
                "data_version": data_version,
                "taxonomy_version": taxonomy["taxonomy_version"],
                "chunk_index": index + 1,
                "sequence_start": index * 50 + 1,
                "sequence_end": index * 50 + 50,
                "companies": rows,
            }
            descriptor = write_version(relative, payload, len(rows))
            listing_descriptors.append({
                **descriptor,
                "chunk_index": index + 1,
                "first_sequence": index * 50 + 1,
                "last_sequence": index * 50 + 50,
            })
        shard_descriptors = {}
        for company_id, detail in details.items():
            relative = Path("companies") / f"{company_id}.json"
            payload = {
                "schema_version": 1,
                "artifact_kind": "company_detail",
                "data_version": data_version,
                "taxonomy_version": taxonomy["taxonomy_version"],
                "company": detail["company"],
                "category_outcomes": detail["category_outcomes"],
                "claims": detail["claims"],
            }
            shard_descriptors[company_id] = {"company_id": company_id, **write_version(relative, payload, 1)}
        used_source_ids = sorted({
            source_id
            for detail in details.values()
            for source_id in (
                [item["source_id"] for claim in detail["claims"] for item in claim["source_evidence"]]
                + [source_id for outcome in detail["category_outcomes"] if outcome["kind"] == "insufficient_evidence" for source_id in outcome["searched_source_ids"]]
            )
        })
        public_sources = [{
            key: source_map[source_id].get(key)
            for key in ("source_id", "title", "owner", "url", "locator", "publication_date", "checked_at")
            if key in source_map[source_id]
        } for source_id in used_source_ids]
        sources_descriptor = write_version(Path("sources.json"), {"data_version": data_version, "sources": public_sources}, len(public_sources))
        methodology = {
            "schema_version": 1,
            "artifact_kind": "company_benefits_methodology",
            "data_version": data_version,
            "taxonomy_version": taxonomy["taxonomy_version"],
            "title": "기업 복지 근거 공개 방법론",
            "paragraphs": [
                "모든 기업은 승인된 독립 검토를 거친 claim 또는 근거 부족 기록으로 설명합니다.",
                NONABSENCE_NOTICE,
                "개인 조건은 생성 산출물에 저장하지 않으며 비교는 한 번에 최대 4개 기업으로 제한합니다.",
            ],
        }
        methodology_descriptor = write_version(Path("methodology.json"), methodology, len(methodology["paragraphs"]))
        taxonomy_payload = {"data_version": data_version, **public_taxonomy(taxonomy)}
        taxonomy_descriptor = write_version(Path("taxonomy.json"), taxonomy_payload, len(taxonomy["benefit_types"]))
        manifest = {
            "schema_version": 2,
            "artifact_kind": "company_benefits_manifest",
            "data_version": data_version,
            "fixture": False,
            "generated_at": generated_at,
            "protocol": protocol_binding,
            "taxonomy_version": taxonomy["taxonomy_version"],
            "company_count": 2000,
            "listing_chunk_size": 50,
            "listing_chunk_count": 40,
            "category_count": 10,
            "listing_chunks": listing_descriptors,
            "company_shards": shard_descriptors,
            "sources": sources_descriptor,
            "methodology": methodology_descriptor,
            "taxonomy": taxonomy_descriptor,
        }
        scan_forbidden_keys(manifest)
        (staging / "manifest.json").write_bytes(canonical_bytes(manifest))
        if output_root.exists():
            if any(output_root.iterdir()):
                raise ValueError("output root already exists and is not empty")
            output_root.rmdir()
        os.replace(staging, output_root)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--research-root", required=True)
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--taxonomy", required=True)
    parser.add_argument("--data-version", required=True)
    parser.add_argument("--generated-at", required=True)
    parser.add_argument("--as-of", required=True, type=date.fromisoformat)
    parser.add_argument("--freeze-anchor-receipt", required=True, type=Path)
    parser.add_argument("--effective-selection-receipt", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        taxonomy, inputs = publication_gate(
            args.research_root, args.taxonomy, args.as_of,
            args.freeze_anchor_receipt, args.effective_selection_receipt,
        )
        emit_artifacts(args.output_root, args.data_version, args.generated_at, taxonomy, inputs)
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        print(f"production artifact generation failed: {exc}", file=sys.stderr)
        return 1
    print("Generated immutable v2 artifacts for 2,000 companies in 40 listing chunks.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
