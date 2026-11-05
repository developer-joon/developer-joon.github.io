#!/usr/bin/env python3
"""Build immutable v2 public artifacts from a complete approved research series."""

import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import stat
import sys
import tempfile
from collections import Counter
from collections.abc import Mapping, Sequence
from datetime import date, datetime, timezone
from pathlib import Path
from types import MappingProxyType
from urllib.parse import urlparse

COMPANY_ID = re.compile(r"^(?:KR-CRN-[0-9]{13}|US-CIK[0-9]{10})$")
FORBIDDEN_KEY = re.compile(r"score|rank|percentile|coverage(?:_percent)?", re.IGNORECASE)
UNKNOWN_MARKERS = (
    "not stated", "not publicly specified", "not established", "unspecified",
    "출처에 명시되지 않음", "확인 불가",
)
NONABSENCE_NOTICE = "이번 조사에서 게시 가능한 공식 복지 근거를 확보하지 못했습니다. 복지가 없다는 뜻이 아닙니다."


def freeze_snapshot(value):
    if isinstance(value, dict):
        return MappingProxyType({key: freeze_snapshot(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(freeze_snapshot(item) for item in value)
    if isinstance(value, tuple):
        return tuple(freeze_snapshot(item) for item in value)
    return value


def thaw_snapshot(value):
    """Create plain JSON containers without exposing the validated snapshot."""
    if isinstance(value, Mapping):
        return {key: thaw_snapshot(item) for key, item in value.items()}
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [thaw_snapshot(item) for item in value]
    return value


def canonical_bytes(value):
    return json.dumps(thaw_snapshot(value), ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8") + b"\n"


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


def read_jsonl_bytes(raw, label):
    rows = []
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError(f"{label}: invalid UTF-8: {exc}") from None
    for number, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line, object_pairs_hook=reject_duplicate_keys)
        except (json.JSONDecodeError, ValueError) as exc:
            raise ValueError(f"{label}:{number}: {exc}") from exc
        if not isinstance(value, dict):
            raise ValueError(f"{label}:{number}: row must be an object")
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


def utc_time(value, label):
    return parse_time(value, label).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def taxonomy_contract(taxonomy):
    if not isinstance(taxonomy, dict):
        raise ValueError("taxonomy must be an object")
    categories = taxonomy.get("categories")
    types = taxonomy.get("benefit_types")
    mappings = taxonomy.get("dol_form_5500_mappings")
    if taxonomy.get("taxonomy_version") != "benefit-taxonomy-v1":
        raise ValueError("unsupported taxonomy version")
    category_fields = {"id", "label_ko", "order"}
    type_fields = {"id", "category_id", "label_ko"}
    mapping_fields = {"field", "code", "benefit_type_id", "label_en", "forced_status", "evidence_semantics"}
    if (not isinstance(categories, list) or len(categories) != 10
            or any(not isinstance(item, dict) or set(item) != category_fields
                   or not isinstance(item.get("id"), str) or not item["id"]
                   or not isinstance(item.get("label_ko"), str) or not item["label_ko"]
                   or isinstance(item.get("order"), bool) or not isinstance(item.get("order"), int)
                   for item in categories)
            or [item["order"] for item in categories] != list(range(1, 11))):
        raise ValueError("taxonomy must contain ten canonically ordered categories")
    if (not isinstance(types, list) or any(
            not isinstance(item, dict) or set(item) not in (type_fields, type_fields | {"baseline_kind"})
            or any(not isinstance(item.get(field), str) or not item[field]
                   for field in type_fields)
            or ("baseline_kind" in item and (not isinstance(item["baseline_kind"], str) or not item["baseline_kind"]))
            for item in types)
            or not isinstance(mappings, list) or any(
                not isinstance(item, dict) or set(item) != mapping_fields
                or any(not isinstance(item.get(field), str) or not item[field]
                       for field in mapping_fields)
                for item in mappings)):
        raise ValueError("taxonomy types and DOL mappings must be object arrays")
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


def _assemble_inputs(root, taxonomy, taxonomy_sha256, v2_snapshot=None):
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
    if v2_snapshot is None:
        v2_snapshot = {
            ledger: (root / filename).read_bytes()
            for ledger, filename in series.V2_LEDGER_FILES.items()
        }
    v2_records = {
        ledger: read_jsonl_bytes(v2_snapshot[ledger], series.V2_LEDGER_FILES[ledger])
        for ledger in series.V2_LEDGER_FILES
    }
    cells = v2_records["cells"]
    cells_by_company = {}
    for cell in cells:
        cells_by_company.setdefault(cell["company_id"], {})[cell["category_id"]] = cell
    expected_categories = {item["id"] for item in taxonomy["categories"]}
    if (len(cells) != 20000 or set(cells_by_company) != set(company_map)
            or any(set(company_cells) != expected_categories
                   for company_cells in cells_by_company.values())):
        raise ValueError("v2 artifact requires exact 2,000-company × 10-category explicit cell equality")
    state_counts = Counter(cell["state"] for cell in cells)
    expected_states = ("official_verified", "reference", "community_report", "no_public_info")
    if set(state_counts) - set(expected_states):
        raise ValueError("v2 artifact contains an unsupported cell state")
    ledger_sha256 = {
        series.V2_LEDGER_FILES[ledger]: sha256(raw)
        for ledger, raw in v2_snapshot.items()
    }
    v2_indexes = {
        ledger: unique_map(v2_records[ledger], series.V2_ID_FIELDS[ledger], f"v2 {ledger}")
        for ledger in ("attempts", "official_claims", "references", "community_reports", "sources")
    }
    return (companies, company_map, claims_by_company, gaps_by_company, source_map, assignment_map,
            claim_reviews, protocol_binding, cells_by_company,
            {state: state_counts.get(state, 0) for state in expected_states}, ledger_sha256,
            v2_indexes)


def validate_inputs(root, taxonomy, taxonomy_sha256):
    """Validate a standalone publication request without any caller-provided bypass."""
    root = Path(root)
    series = load_verifier().company_benefits_series
    series.validate_complete_v2_progress(root)
    return _assemble_inputs(root, taxonomy, taxonomy_sha256)


def validate_approved_v2_projection_inputs(root, taxonomy, taxonomy_sha256):
    """Validate and project only immutable approved batches from an in-progress v2 series."""
    root = Path(root)
    series = load_verifier().company_benefits_series
    progress = read_json(root / "series-progress.json")
    if series.progress_contract_version(progress) != "2" or progress.get("status") != "in_progress":
        raise ValueError("approved v2 additive projection requires in-progress v2 progress")
    companies = read_jsonl(root / "companies.jsonl")
    batches = read_jsonl(root / "series-batches.jsonl")
    if len(companies) != 2000 or len(batches) != 80:
        raise ValueError("approved v2 projection requires the canonical 2,000-company/80-batch partition")
    company_map = unique_map(companies, "company_id", "companies ledger")
    if [company_id for batch in batches for company_id in batch.get("company_ids", [])] != list(company_map):
        raise ValueError("series batches must bind the exact canonical company sequence")
    entries = {entry.get("batch_id"): entry for entry in progress["batches"]}
    if len(entries) != 80 or set(entries) != {batch.get("batch_id") for batch in batches}:
        raise ValueError("progress must exactly bind all canonical batches")
    approved_batches = [batch for batch in batches if entries[batch["batch_id"]]["status"] == "approved"]
    if not approved_batches or len(approved_batches) == 80:
        raise ValueError("additive projection requires a non-empty incomplete approved checkpoint")
    approved_ids = [company_id for batch in approved_batches for company_id in batch["company_ids"]]
    approved_set = set(approved_ids)
    if len(approved_set) != len(approved_ids):
        raise ValueError("approved batches overlap company membership")
    records = series.read_v2_batch_records(root)
    expected = {ledger: [] for ledger in series.V2_LEDGER_FILES}
    for batch in approved_batches:
        sliced = series.v2_batch_slice(records, batch)
        entry = entries[batch["batch_id"]]
        if len(sliced["cells"]) != 250 or series.v2_cell_set_sha256(sliced["cells"]) != entry["cell_set_sha256"]:
            raise ValueError(f"{batch['batch_id']}: approved projection cell binding mismatch")
        if series.v2_ledger_sha256(sliced) != entry["v2_ledger_sha256"]:
            raise ValueError(f"{batch['batch_id']}: approved projection ledger hash mismatch")
        series.validate_v2_package_records(sliced, batch, root)
        for ledger in expected:
            expected[ledger].extend(sliced[ledger])
    for ledger in expected:
        field = series.V2_ID_FIELDS[ledger]
        actual_ids = {record.get(field) for record in records[ledger]}
        expected_ids = {record.get(field) for record in expected[ledger]}
        if actual_ids != expected_ids or len(actual_ids) != len(records[ledger]):
            raise ValueError(f"{series.V2_LEDGER_FILES[ledger]} contains pending, duplicate, or unbound records")
    cells = records["cells"]
    if len(cells) != len(approved_ids) * 10 or any(cell.get("company_id") not in approved_set for cell in cells):
        raise ValueError("approved projection requires exactly 250 cells per approved batch with no pending leakage")
    expected_categories = {item["id"] for item in taxonomy["categories"]}
    cells_by_company = {}
    for cell in cells:
        target = cells_by_company.setdefault(cell["company_id"], {})
        if cell["category_id"] in target:
            raise ValueError("approved projection contains a duplicate company/category cell")
        target[cell["category_id"]] = cell
    if set(cells_by_company) != approved_set or any(set(value) != expected_categories for value in cells_by_company.values()):
        raise ValueError("approved projection company/category join is not exact")
    state_counts = Counter(cell["state"] for cell in cells)
    states = ("official_verified", "reference", "community_report", "no_public_info")
    if set(state_counts) - set(states):
        raise ValueError("approved projection contains unsupported cell state")
    protocol_path = root / "population-protocol.json"
    effective_path = root / "population" / "effective-selection-manifest.json"
    protocol = read_json(protocol_path)
    protocol_binding = {
        "protocol_id": protocol["protocol_id"], "protocol_version": protocol["version"],
        "protocol_sha256": sha256(protocol_path.read_bytes()),
        "effective_selection_sha256": sha256(effective_path.read_bytes()),
    }
    indexes = {ledger: unique_map(records[ledger], series.V2_ID_FIELDS[ledger], f"v2 {ledger}")
               for ledger in ("attempts", "official_claims", "references", "community_reports", "sources")}
    selected = [company_map[company_id] for company_id in approved_ids]
    inputs = (selected, company_map, {}, {}, {}, {}, {}, protocol_binding, cells_by_company,
              {state: state_counts.get(state, 0) for state in states},
              {filename: sha256((root / filename).read_bytes()) for filename in series.V2_LEDGER_FILES.values()}, indexes)
    metadata = {
        "projection_kind": "approved_v2_additive", "projection_status": "in_progress",
        "approved_batch_count": len(approved_batches), "total_batch_count": 80,
        "projected_company_count": len(selected), "total_company_count": 2000,
        "cell_count": len(cells),
        "cell_state_counts": {state: state_counts.get(state, 0) for state in states},
        "population_sequences": {company_id: index for index, company_id in enumerate(company_map, 1)},
    }
    return freeze_snapshot(inputs), freeze_snapshot(metadata)


def _capture_regular_file(path, label):
    path = Path(path)
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode):
        raise ValueError(f"{label} must be a regular file")
    return path.read_bytes(), stat.S_IMODE(metadata.st_mode)


def _capture_research_tree(root):
    """Capture every verifier-visible research file without following links."""
    root = Path(root)
    snapshot = {}
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"publication research snapshot rejects symlink: {path.relative_to(root)}")
        if path.is_dir():
            continue
        relative = path.relative_to(root)
        snapshot[relative] = _capture_regular_file(path, relative.as_posix())
    current = set()
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"publication research snapshot rejects symlink: {path.relative_to(root)}")
        if path.is_dir():
            continue
        relative = path.relative_to(root)
        _capture_regular_file(path, relative.as_posix())
        current.add(relative)
    if current != set(snapshot):
        raise ValueError("publication research tree changed while snapshotting")
    for relative, (raw, mode) in snapshot.items():
        if _capture_regular_file(root / relative, relative.as_posix()) != (raw, mode):
            raise ValueError("publication research tree changed while snapshotting")
    return snapshot


def _materialize_snapshot(snapshot, destination):
    destination = Path(destination)
    for relative, (raw, mode) in snapshot.items():
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        target.chmod(mode)


def publication_gate(research_root, taxonomy_path, as_of, freeze_anchor_receipt,
                     effective_selection_receipt):
    """Validate one byte snapshot and return recursively immutable inputs."""
    root = Path(research_root)
    series = load_verifier().company_benefits_series
    snapshot = _capture_research_tree(root)
    policy_relative = Path("research-coverage-policies.json")
    if policy_relative not in snapshot:
        raise ValueError("publication snapshot is missing research-coverage-policies.json")
    progress_relative = Path("series-progress.json")
    if progress_relative not in snapshot:
        raise ValueError("publication snapshot is missing series-progress.json")
    progress_raw = snapshot[progress_relative][0]
    progress = json.loads(progress_raw.decode("utf-8"), object_pairs_hook=reject_duplicate_keys)
    if series.progress_contract_version(progress) != "2":
        raise ValueError("v2 artifact publication requires explicit progress_version=2")
    taxonomy_path = Path(taxonomy_path)
    taxonomy_raw, _ = _capture_regular_file(taxonomy_path, "taxonomy")
    receipts = {}
    for name, path in (("freeze", freeze_anchor_receipt), ("effective", effective_selection_receipt)):
        if path is not None:
            receipts[name] = _capture_regular_file(path, f"{name} receipt")

    with tempfile.TemporaryDirectory(prefix="company-benefits-publication-snapshot-") as directory:
        snapshot_base = Path(directory)
        snapshot_root = snapshot_base / "research"
        _materialize_snapshot(snapshot, snapshot_root)
        snapshot_receipts = {}
        for name, value in receipts.items():
            target = snapshot_base / "external" / f"{name}.json"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(value[0])
            target.chmod(value[1])
            snapshot_receipts[name] = target
        verify_active_ledgers(
            snapshot_root, as_of, snapshot_receipts.get("freeze"), snapshot_receipts.get("effective")
        )
        taxonomy = json.loads(taxonomy_raw.decode("utf-8"), object_pairs_hook=reject_duplicate_keys)
        taxonomy_contract(taxonomy)
        v2_snapshot = {
            ledger: snapshot[Path(filename)][0]
            for ledger, filename in series.V2_LEDGER_FILES.items()
        }
        v2_records = {
            ledger: read_jsonl_bytes(v2_snapshot[ledger], series.V2_LEDGER_FILES[ledger])
            for ledger in series.V2_LEDGER_FILES
        }
        series.validate_complete_v2_progress(snapshot_root, records=v2_records)
        inputs = _assemble_inputs(
            snapshot_root, taxonomy, hashlib.sha256(taxonomy_raw).hexdigest(), v2_snapshot
        )
    return freeze_snapshot(taxonomy), freeze_snapshot(inputs)


def approved_projection_gate(research_root, taxonomy_path, as_of, freeze_anchor_receipt,
                             effective_selection_receipt):
    """Validate one captured in-progress checkpoint without weakening the complete gate."""
    root = Path(research_root)
    snapshot = _capture_research_tree(root)
    taxonomy_raw, _ = _capture_regular_file(taxonomy_path, "taxonomy")
    receipts = {}
    for name, path in (("freeze", freeze_anchor_receipt), ("effective", effective_selection_receipt)):
        if path is not None:
            receipts[name] = _capture_regular_file(path, f"{name} receipt")
    with tempfile.TemporaryDirectory(prefix="company-benefits-projection-snapshot-") as directory:
        base = Path(directory)
        snapshot_root = base / "research"
        _materialize_snapshot(snapshot, snapshot_root)
        snapshot_receipts = {}
        for name, value in receipts.items():
            target = base / "external" / f"{name}.json"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(value[0])
            target.chmod(value[1])
            snapshot_receipts[name] = target
        verify_active_ledgers(snapshot_root, as_of, snapshot_receipts.get("freeze"),
                              snapshot_receipts.get("effective"))
        taxonomy = json.loads(taxonomy_raw.decode("utf-8"), object_pairs_hook=reject_duplicate_keys)
        taxonomy_contract(taxonomy)
        inputs, metadata = validate_approved_v2_projection_inputs(
            snapshot_root, taxonomy, hashlib.sha256(taxonomy_raw).hexdigest()
        )
    return freeze_snapshot(taxonomy), inputs, metadata


def bounded_claim(claim):
    if claim.get("status") != "confirmed" or claim.get("current_validity") not in {"current", "undated_current"} or claim.get("evidence_grade") not in {"A", "B"}:
        return True
    scope = claim.get("application_scope", {})
    values = [*scope.get("countries", []), *scope.get("legal_entities", []), *scope.get("roles", []), *scope.get("employment_types", []), scope.get("tenure_condition", "")]
    return any(marker in str(value).casefold() for value in values for marker in UNKNOWN_MARKERS)


def unknown_projection(value, fallback):
    if isinstance(value, str) and value.strip():
        return value
    if isinstance(value, Mapping):
        reason = value.get("reason")
        if isinstance(reason, str) and reason.strip():
            return {"kind": "unknown", "reason": reason}
    return {"kind": "unknown", "reason": fallback}


def public_v2_record(record, timestamp_fields=()):
    projected = {
        key: value for key, value in record.items()
        if key not in {"moderation"}
    }
    for field in timestamp_fields:
        if field in projected:
            projected[field] = utc_time(projected[field], field)
    if isinstance(projected.get("frozen_snapshot"), Mapping):
        projected["frozen_snapshot"] = dict(projected["frozen_snapshot"])
        projected["frozen_snapshot"]["frozen_at"] = utc_time(
            projected["frozen_snapshot"]["frozen_at"], "frozen_at"
        )
    return projected


def public_v2_source(source):
    fields = {
        "source_id", "source_tier", "title", "url", "retrieved_at", "content_sha256",
        "reliability", "currentness", "scope_status", "scope", "conflict_status",
        "publication_eligibility",
    }
    return {
        key: (utc_time(value, key) if key == "retrieved_at" else value)
        for key, value in source.items() if key in fields
    }


def public_legacy_source(source):
    return {
        key: (utc_time(source[key], key) if key == "checked_at" else source[key])
        for key in (
            "source_id", "title", "owner", "source_type", "jurisdiction", "url",
            "locator", "publication_date", "checked_at", "evidence_eligibility",
        ) if key in source
    }


def merged_scope(records):
    fields = ("countries", "legal_entities", "roles", "employment_types")
    result = {field: [] for field in fields}
    result["tenure_conditions"] = []
    for record in records:
        scope = record.get("scope", {})
        for field in fields:
            for value in scope.get(field, []):
                if value not in result[field]:
                    result[field].append(value)
    return result


def build_company(company, population_sequence, claims, gap, taxonomy, assignments, source_map, cells,
                  v2_indexes=None):
    v2_indexes = v2_indexes or {
        "attempts": {}, "official_claims": {}, "references": {},
        "community_reports": {}, "sources": {},
    }
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
                    "checked_at": utc_time(source["checked_at"], "source checked_at"),
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
            "checked_at": utc_time(claim["prepublication_checked_at"], "claim checked_at"),
            "source_evidence": evidence_rows,
        }
        projections.append(projection)
        for category_id in categories:
            category_claims[category_id].append((claim, type_ids, limitations))
    outcomes = []
    for category_id in category_ids:
        cell = cells.get(category_id)
        if cell is None:
            raise ValueError(f"{company['company_id']}:{category_id}: missing explicit cell")
        official_records = [v2_indexes["official_claims"][record_id] for record_id in cell["official_claim_ids"]]
        reference_records = [v2_indexes["references"][record_id] for record_id in cell["reference_ids"]]
        community_records = [v2_indexes["community_reports"][record_id] for record_id in cell["community_report_ids"]]
        evidence_records = [*official_records, *reference_records, *community_records]
        evidence_count = sum(len(cell[field]) for field in (
            "official_claim_ids", "reference_ids", "community_report_ids"
        ))
        evidence_ids = [*cell["official_claim_ids"], *cell["reference_ids"], *cell["community_report_ids"]]
        if len(evidence_ids) != len(set(evidence_ids)):
            raise ValueError(f"{company['company_id']}:{category_id}: evidence IDs must be unique")
        attempts = [v2_indexes["attempts"][attempt_id] for attempt_id in cell["attempt_ids"]]
        searched_source_ids = sorted({
            source_id for attempt in attempts for source_id in attempt.get("source_ids", [])
        })
        assessed_at = utc_time(cell["assessed_at"], "cell assessed_at")
        outcome = {
            key: cell[key] for key in (
                "category_id", "state", "reliability", "currentness", "scope_status",
                "conflict_status", "publication_eligibility",
                "official_claim_ids", "reference_ids", "community_report_ids",
            )
        }
        outcome["assessed_at"] = assessed_at
        limitation_codes = []
        if cell["scope_status"] != "exact_entity":
            limitation_codes.append("scope_limit")
        if cell["currentness"] != "current":
            limitation_codes.append("currentness_limit")
        if cell["conflict_status"] != "none":
            limitation_codes.append("conflicting_evidence")
        if cell["state"] in {"reference", "community_report"}:
            limitation_codes.append("lower_tier_evidence")
        status = ("insufficient_evidence" if cell["state"] == "no_public_info"
                  else "confirmed" if cell["scope_status"] == "exact_entity"
                  and cell["reliability"] in {"high", "medium"} else "bounded")
        outcome.update({
            "kind": "insufficient_evidence" if cell["state"] == "no_public_info" else "evidenced",
            "status": status,
            "claim_count": evidence_count,
            "benefit_type_count": (0 if cell["state"] == "no_public_info" else
                                   len({type_id for _, type_ids, _ in category_claims[category_id] for type_id in type_ids})),
            "scope": merged_scope(evidence_records),
            "limitation_codes": limitation_codes, "last_checked_at": assessed_at,
            "searched_source_ids": searched_source_ids,
            "source_tiers": sorted({record["source_tier"] for record in evidence_records}),
            "official_claim_count": len(official_records),
            "reference_count": len(reference_records),
            "community_report_count": len(community_records),
        })
        if cell["state"] == "no_public_info":
            outcome["nonabsence_notice"] = NONABSENCE_NOTICE
            outcome.update(
                reason_code="searched_not_found",
                searched_at=assessed_at,
            )
        outcomes.append(outcome)
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
    official_claims = [
        public_v2_record(record) for record in v2_indexes["official_claims"].values()
        if record.get("company_id") == company["company_id"]
    ]
    references = [
        public_v2_record(record, ("checked_at",)) for record in v2_indexes["references"].values()
        if record.get("company_id") == company["company_id"]
    ]
    community_reports = [
        public_v2_record(record) for record in v2_indexes["community_reports"].values()
        if record.get("company_id") == company["company_id"]
    ]
    v2_source_ids = {
        source_id for record in [*official_claims, *references, *community_reports]
        for source_id in record.get("source_ids", [record.get("source_id")]) if source_id
    }
    company_attempts = [
        attempt for attempt in v2_indexes["attempts"].values()
        if attempt.get("company_id") == company["company_id"]
    ]
    v2_source_ids.update(
        source_id for attempt in company_attempts for source_id in attempt.get("source_ids", [])
    )
    public_sources = [public_legacy_source(source_map[item["source_id"]]) for item in projections for item in item["source_evidence"]]
    public_sources.extend(
        public_v2_source(v2_indexes["sources"][source_id])
        for source_id in sorted(v2_source_ids)
    )
    source_inventory = {}
    for source in public_sources:
        source_id = source["source_id"]
        if source_id in source_inventory and source_inventory[source_id] != source:
            raise ValueError(f"conflicting company source projection: {source_id}")
        source_inventory[source_id] = source
    public_sources = [source_inventory[source_id] for source_id in sorted(source_inventory)]
    return {
        "listing": listing, "company": detail_company, "category_outcomes": outcomes,
        "claims": projections, "official_claims": official_claims, "references": references,
        "community_reports": community_reports, "sources": public_sources,
    }


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
    if isinstance(value, Mapping):
        for key, child in value.items():
            if FORBIDDEN_KEY.search(key):
                raise ValueError(f"prohibited numeric/ranking key at {path}.{key}")
            scan_forbidden_keys(child, f"{path}.{key}")
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        for index, child in enumerate(value):
            scan_forbidden_keys(child, f"{path}[{index}]")


def emit_artifacts(output_root, data_version, generated_at, taxonomy, inputs,
                   projection_metadata=None, base_artifact_root=None):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", data_version):
        raise ValueError("data version is unsafe")
    generated_at = utc_time(generated_at, "generated_at")
    (companies, _, claims_by_company, gaps_by_company, source_map, assignments,
     claim_reviews, protocol_binding, cells_by_company, state_counts, ledger_sha256,
     v2_indexes) = inputs
    output_root = Path(output_root)
    output_root.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{output_root.name}-", dir=output_root.parent))
    descriptors = {}
    base_manifest = None
    try:
        if projection_metadata is not None:
            if base_artifact_root is None:
                raise ValueError("additive projection requires a base artifact root")
            base_artifact_root = Path(base_artifact_root)
            base_manifest_path = base_artifact_root / "manifest.json"
            base_manifest = read_json(base_manifest_path)
            if (base_manifest.get("artifact_protocol") != "v1"
                    or base_manifest.get("approved_v2_projection") is not None
                    or base_manifest.get("data_version") != projection_metadata["base_data_version"]
                    or sha256(base_manifest_path.read_bytes()) != projection_metadata["base_manifest_sha256"]):
                raise ValueError("additive projection base manifest must exactly bind the unmodified active v1 lineage")
            for path in base_artifact_root.rglob("*"):
                metadata = path.lstat()
                if path.is_symlink() or (not stat.S_ISDIR(metadata.st_mode) and not stat.S_ISREG(metadata.st_mode)):
                    raise ValueError(f"unsafe base artifact entry: {path.relative_to(base_artifact_root)}")
            shutil.copytree(base_artifact_root, staging, dirs_exist_ok=True)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise

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
        sequence_map = (projection_metadata or {}).get("population_sequences", {})
        for generated_sequence, company in enumerate(companies, 1):
            company_id = company["company_id"]
            population_sequence = sequence_map.get(company_id, generated_sequence)
            detail = build_company(
                company, population_sequence,
                claims_by_company.get(company_id, []),
                (gaps_by_company.get(company_id) or [None])[0],
                taxonomy,
                assignments,
                source_map,
                cells_by_company.get(company_id, {}),
                v2_indexes,
            )
            details[company_id] = detail
            listing.append(detail["listing"])
        listing_descriptors = []
        chunk_count = (len(listing) + 49) // 50
        for index in range(chunk_count):
            rows = listing[index * 50:(index + 1) * 50]
            relative = Path("listings") / f"companies-{index + 1:02d}.json"
            payload = {
                "schema_version": 1,
                "artifact_kind": "company_listing_chunk",
                "artifact_protocol": "vNext",
                "data_version": data_version,
                "taxonomy_version": taxonomy["taxonomy_version"],
                "chunk_index": index + 1,
                "sequence_start": rows[0]["population_sequence"],
                "sequence_end": rows[-1]["population_sequence"],
                "companies": rows,
            }
            descriptor = write_version(relative, payload, len(rows))
            listing_descriptors.append({
                **descriptor,
                "chunk_index": index + 1,
                "first_sequence": rows[0]["population_sequence"],
                "last_sequence": rows[-1]["population_sequence"],
            })
        shard_descriptors = {}
        for company_id, detail in details.items():
            relative = Path("companies") / f"{company_id}.json"
            payload = {
                "schema_version": 1,
                "artifact_kind": "company_detail",
                "artifact_protocol": "vNext",
                "data_version": data_version,
                "taxonomy_version": taxonomy["taxonomy_version"],
                "company": detail["company"],
                "category_outcomes": detail["category_outcomes"],
                "claims": detail["claims"],
                "official_claims": detail["official_claims"],
                "references": detail["references"],
                "community_reports": detail["community_reports"],
                "sources": detail["sources"],
            }
            shard_descriptors[company_id] = {"company_id": company_id, **write_version(relative, payload, 1)}
        source_inventory = {}
        for detail in details.values():
            for source in detail["sources"]:
                existing = source_inventory.get(source["source_id"])
                if existing is not None and existing != source:
                    raise ValueError(f"conflicting public source projection: {source['source_id']}")
                source_inventory[source["source_id"]] = source
        public_sources = [source_inventory[source_id] for source_id in sorted(source_inventory)]
        sources_descriptor = write_version(Path("sources.json"), {"schema_version": 1, "artifact_kind": "company_benefits_sources", "data_version": data_version, "sources": public_sources}, len(public_sources))
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
        generated_manifest = {
            "schema_version": 2,
            "artifact_kind": "company_benefits_manifest",
            "artifact_protocol": "vNext",
            "data_version": data_version,
            "fixture": False,
            "generated_at": generated_at,
            "protocol": protocol_binding,
            "taxonomy_version": taxonomy["taxonomy_version"],
            "company_count": len(companies),
            "listing_chunk_size": 50,
            "listing_chunk_count": chunk_count,
            "category_count": 10,
            "cell_count": len(companies) * 10,
            "cell_state_counts": state_counts,
            "ledger_sha256": ledger_sha256,
            "listing_chunks": listing_descriptors,
            "company_shards": shard_descriptors,
            "sources": sources_descriptor,
            "methodology": methodology_descriptor,
            "taxonomy": taxonomy_descriptor,
        }
        if projection_metadata is None:
            manifest = generated_manifest
        else:
            projection = {
                key: value for key, value in projection_metadata.items()
                if key != "population_sequences"
            }
            projection.update({
                "base_data_version": base_manifest["data_version"], "data_version": data_version,
                "listing_chunk_size": 50, "listing_chunk_count": chunk_count,
                "ledger_sha256": ledger_sha256, "listing_chunks": listing_descriptors,
                "company_shards": shard_descriptors, "sources": sources_descriptor,
                "methodology": methodology_descriptor, "taxonomy": taxonomy_descriptor,
            })
            manifest = {**base_manifest, "approved_v2_projection": projection}
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
    parser.add_argument("--mode", choices=("complete-v2", "approved-v2-projection"), default="complete-v2")
    parser.add_argument("--base-artifact-root", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.mode == "complete-v2":
            taxonomy, inputs = publication_gate(
                args.research_root, args.taxonomy, args.as_of,
                args.freeze_anchor_receipt, args.effective_selection_receipt,
            )
            emit_artifacts(args.output_root, args.data_version, args.generated_at, taxonomy, inputs)
        else:
            if args.base_artifact_root is None:
                raise ValueError("approved-v2-projection mode requires --base-artifact-root")
            taxonomy, inputs, metadata = approved_projection_gate(
                args.research_root, args.taxonomy, args.as_of,
                args.freeze_anchor_receipt, args.effective_selection_receipt,
            )
            base_manifest_path = args.base_artifact_root / "manifest.json"
            base_manifest = read_json(base_manifest_path)
            metadata = freeze_snapshot({
                **metadata, "base_data_version": base_manifest.get("data_version"),
                "base_manifest_sha256": sha256(base_manifest_path.read_bytes()),
            })
            emit_artifacts(args.output_root, args.data_version, args.generated_at, taxonomy, inputs,
                           metadata, args.base_artifact_root)
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        print(f"production artifact generation failed: {exc}", file=sys.stderr)
        return 1
    if args.mode == "complete-v2":
        print("Generated immutable v2 artifacts for 2,000 companies in 40 listing chunks.")
    else:
        print("Generated immutable additive approved-v2 projection; active v1 lineage unchanged.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
