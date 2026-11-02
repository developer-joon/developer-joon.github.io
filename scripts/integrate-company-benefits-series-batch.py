#!/usr/bin/env python3
"""Validate and deterministically merge one approved benefits-series batch."""

import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
import re
import shutil
import sys
import tempfile
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import company_benefits_series as series

FILES = (
    "sources.jsonl", "claims.jsonl", "reviews.jsonl", "gaps.jsonl", "checks.jsonl",
    *series.V2_LEDGER_FILES.values(),
)
ALLOWED_FILES = {"batch.json", *FILES}
TARGETS = {
    "sources.jsonl": "source-registry.jsonl",
    "claims.jsonl": "benefit-claims.jsonl",
    "reviews.jsonl": "reviews.jsonl",
    "gaps.jsonl": "series-research-gaps.jsonl",
    "checks.jsonl": "series-prepublication-checks.jsonl",
    **{filename: filename for filename in series.V2_LEDGER_FILES.values()},
}
V2_TARGETS = {filename: filename for filename in series.V2_LEDGER_FILES.values()}
ID_FIELDS = {
    "sources.jsonl": "source_id", "claims.jsonl": "claim_id", "reviews.jsonl": "review_id",
    "gaps.jsonl": "audit_id", "checks.jsonl": "source_id",
    **{filename: series.V2_ID_FIELDS[ledger] for ledger, filename in series.V2_LEDGER_FILES.items()},
}
LEDGER_TARGETS = tuple(V2_TARGETS.values()) + ("series-progress.json", "series-batches.jsonl")
IMMUTABLE_LEGACY_FILES = ("sources.jsonl", "claims.jsonl", "reviews.jsonl", "gaps.jsonl")
TRANSACTION_DIRNAME = ".company-benefits-series-batch-transaction"
COMMITTED_TRANSACTION_DIRNAME = ".company-benefits-series-batch-committed"
TRANSACTION_SCHEMA_VERSION = "1"


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
    if not isinstance(records, list) or any(not isinstance(item, dict) for item in records):
        raise ValueError(f"{label} records must be objects")
    values = [item.get(field) for item in records]
    if (any(not isinstance(value, str) or not value for value in values)
            or len(values) != len(set(values))):
        raise ValueError(f"{label} requires unique nonempty {field} values")
    return dict(zip(values, records))


def _raw_record_map(path, records, field, label):
    """Index parsed records by ID while retaining their exact JSON line bytes."""
    path = Path(path)
    raw = path.read_bytes() if path.is_file() else b""
    raw_records = [line for line in raw.splitlines() if line.strip()]
    record_map = _unique_map(records, field, label)
    if len(raw_records) != len(records):
        raise ValueError(f"{label} raw record count mismatch")
    return {record[field]: raw for record, raw in zip(records, raw_records)}, record_map


def validate_record_collisions(name, incoming_path, existing_path, incoming_records, existing_records):
    """Allow legacy duplicate IDs only when the complete raw records are byte-identical."""
    field = ID_FIELDS[name]
    incoming_raw, incoming_by_id = _raw_record_map(incoming_path, incoming_records, field, name)
    existing_raw, existing_by_id = _raw_record_map(existing_path, existing_records, field, f"existing {name}")
    overlaps = set(incoming_by_id) & set(existing_by_id)
    if overlaps and name not in IMMUTABLE_LEGACY_FILES:
        raise ValueError(f"cross-batch {field} collision")
    if any(incoming_raw[item_id] != existing_raw[item_id] for item_id in overlaps):
        raise ValueError(f"cross-batch {field} collision")


def expected_check_source_ids(claims, gaps, source_map):
    source_ids = set()
    for item in claims:
        for source_id in item.get("source_ids", []) + item.get("searched_source_ids", []):
            source = source_map.get(source_id)
            if not source or not source.get("url"):
                raise ValueError(f"missing source binding for check coverage: {source_id}")
            source_ids.add(source_id)
    for gap in gaps:
        source_ids.update(series.validate_gap_source_routes(gap, source_map))
    return source_ids


def merge_checks(existing, incoming, latest_review_by_source_id, expected_source_ids=None):
    """Upsert source checks only when the same source_id tuple is newer and unchanged."""
    merged = _unique_map(existing, "source_id", "existing checks")
    incoming_map = _unique_map(incoming, "source_id", "incoming checks")
    expected_source_ids = set(latest_review_by_source_id) if expected_source_ids is None else set(expected_source_ids)
    if set(incoming_map) != expected_source_ids:
        raise ValueError("incoming checks do not match source bindings")
    for source_id, check in incoming_map.items():
        checked = parse_timestamp(check.get("checked_at"), "check checked_at")
        reviewed = parse_timestamp(latest_review_by_source_id[source_id], "latest review") if source_id in latest_review_by_source_id else None
        if reviewed and checked <= reviewed:
            raise ValueError(f"{source_id}: check must follow review chronology")
        previous = merged.get(source_id)
        if previous is not None:
            current_tuple = {key: value for key, value in check.items() if key != "checked_at"}
            previous_tuple = {key: value for key, value in previous.items() if key != "checked_at"}
            if current_tuple != previous_tuple:
                raise ValueError(f"{source_id}: conflicting source check tuple")
            if checked <= parse_timestamp(previous.get("checked_at"), "existing check checked_at"):
                raise ValueError(f"{source_id}: source check must be strictly newer")
        merged[source_id] = check
    return [merged[key] for key in sorted(merged)]


def validate_review_audit(manifest, batch, records, research_root):
    """Reconstruct and revalidate the exact candidate and independent-review contracts."""
    audit = manifest.get("review_audit")
    audit_fields = {"candidate_manifest_sha256", "candidate_manifest", "candidate_artifacts",
                    "review_bundle_sha256", "review_bundle", "review_artifacts"}
    if not isinstance(audit, dict) or set(audit) != audit_fields:
        raise ValueError("v2 package requires an exact candidate/promotion review_audit")
    candidate_manifest = audit.get("candidate_manifest")
    review_bundle = audit.get("review_bundle")
    if not isinstance(candidate_manifest, dict) or not isinstance(review_bundle, dict):
        raise ValueError("review_audit must retain the candidate manifest and review bundle")
    candidate_raw = series.json_bytes(candidate_manifest)
    review_raw = series.json_bytes(review_bundle)
    if (sha256(candidate_raw) != audit.get("candidate_manifest_sha256")
            or candidate_manifest.get("artifacts") != audit.get("candidate_artifacts")
            or sha256(review_raw) != audit.get("review_bundle_sha256")
            or review_bundle.get("artifacts") != audit.get("review_artifacts")):
        raise ValueError("review_audit manifest or bundle hash binding mismatch")
    for field in ("batch_id", "company_list_sha256", "effective_sequence_sha256", "replacement_events_sha256"):
        if candidate_manifest.get(field) != manifest.get(field):
            raise ValueError(f"review_audit candidate batch binding mismatch: {field}")
    if (review_bundle.get("promotion_reviewer_id") != manifest.get("reviewer_id")
            or review_bundle.get("approved_at") != manifest.get("approved_at")):
        raise ValueError("review_audit promotion identity or approval timestamp mismatch")

    candidate_claims = []
    for claim in records["claims.jsonl"]:
        candidate_claim = dict(claim)
        candidate_claim.pop("prepublication_checked_at", None)
        candidate_claims.append(candidate_claim)
    claims_by_company = {}
    for claim in candidate_claims:
        claims_by_company.setdefault(claim.get("company_id"), []).append(claim)
    gaps_by_company = {}
    for gap in records["gaps.jsonl"]:
        gaps_by_company.setdefault(gap.get("company_id"), []).append(gap)
    researcher = candidate_manifest.get("researcher_id")
    requests = []
    for company_id in batch["company_ids"]:
        for claim in claims_by_company.get(company_id, []):
            target = claim.get("claim_id")
            author = claim.get("researcher_id", researcher)
            requests.append({"request_id": f"review-request::claim::{target}", "target_type": "claim",
                             "target_id": target, "researcher_id": author,
                             "status": "pending_independent_review"})
        for gap in gaps_by_company.get(company_id, []):
            target = gap.get("audit_id")
            requests.append({"request_id": f"review-request::gap::{target}", "target_type": "gap",
                             "target_id": target, "researcher_id": gap.get("researcher_id", researcher),
                             "status": "pending_independent_review"})

    candidate_values = {
        "sources.jsonl": records["sources.jsonl"], "claims.jsonl": candidate_claims,
        "gaps.jsonl": records["gaps.jsonl"], "review-requests.jsonl": requests,
        **{filename: records[filename] for filename in series.V2_LEDGER_FILES.values()},
    }
    with tempfile.TemporaryDirectory(prefix="benefits-review-audit-") as directory:
        base = Path(directory)
        candidate_dir, review_dir = base / "candidate", base / "review"
        candidate_dir.mkdir()
        review_dir.mkdir()
        (candidate_dir / "candidate.json").write_bytes(candidate_raw)
        for name, values in candidate_values.items():
            (candidate_dir / name).write_bytes(series.jsonl_bytes(values))
        (review_dir / "review-bundle.json").write_bytes(review_raw)
        for name in ("reviews.jsonl", "checks.jsonl"):
            (review_dir / name).write_bytes(series.jsonl_bytes(records[name]))
        candidate_validator = _load_script(Path(__file__).with_name("validate-company-benefits-series-candidate.py"),
                                           "integrated_candidate_audit_validator")
        package = candidate_validator.validate_candidate(candidate_dir, research_root)
        promoter = _load_script(Path(__file__).with_name("promote-company-benefits-series-candidate.py"),
                                "integrated_review_audit_validator")
        review = promoter.validate_external_review(package, review_dir, candidate_validator)
    check_map = {check["source_id"]: check for check in review["checks"]}
    expected_claims = []
    for claim in candidate_claims:
        promoted = dict(claim)
        if claim.get("status") != "unknown":
            bound = [check_map[source_id] for source_id in claim.get("source_ids", [])]
            if not bound:
                raise ValueError(f"{claim.get('claim_id')}: reviewed factual claim has no source check")
            promoted["prepublication_checked_at"] = max(
                bound, key=lambda check: parse_timestamp(check["checked_at"], "check checked_at")
            )["checked_at"]
        expected_claims.append(promoted)
    if expected_claims != records["claims.jsonl"]:
        raise ValueError("review_audit candidate claims do not produce the exact promoted claims")
    return audit


def load_package(input_dir, research_root, validate_immutable_legacy_collisions=True):
    input_dir, research_root = Path(input_dir), Path(research_root)
    actual = {path.name for path in input_dir.iterdir()}
    if actual != ALLOWED_FILES or any(not path.is_file() for path in input_dir.iterdir()):
        raise ValueError("unexpected input or evidence file; package must contain only batch.json and eleven JSONL artifacts")
    try:
        manifest = json.loads((input_dir / "batch.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid batch manifest: {exc}") from exc
    expected_manifest_fields = {"schema_version", "batch_id", "company_list_sha256", "effective_sequence_sha256",
                                "replacement_events_sha256", "status", "approved_at", "reviewer_id", "artifacts"}
    if set(manifest) != expected_manifest_fields | {"review_audit"} or manifest.get("schema_version") != "1":
        raise ValueError("batch manifest schema mismatch; v2 packages require review_audit")
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
    series.validate_persisted_v2_hashes(research_root, list(batches.values()), progress, v2_transition=True)
    current = next((item for item in progress["batches"] if item["batch_id"] == batch["batch_id"]), None)
    if current is None or current.get("status") != "pending" or current.get("cell_count", 0) != 0:
        raise ValueError("v2 batch is not pending or already contains v2 cells")

    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, dict) or set(artifacts) != set(FILES):
        raise ValueError("batch manifest must hash all eleven exact artifacts")

    records = {}
    for name in FILES:
        raw = (input_dir / name).read_bytes()
        if artifacts.get(name) != sha256(raw):
            raise ValueError(f"artifact hash mismatch: {name}")
        records[name] = series.read_jsonl(input_dir / name)

    v2_records = {ledger: records[filename] for ledger, filename in series.V2_LEDGER_FILES.items()}
    series.validate_v2_record_structure(v2_records, batch)
    for name in FILES:
        _unique_map(records[name], ID_FIELDS[name], name)
        serialized = json.dumps(records[name], ensure_ascii=False)
        if "evidence_path" in serialized or "evidence_file" in serialized or any(item.get("hash_provenance") == "retained_file" for item in records[name]):
            raise ValueError("evidence files and retained-file provenance are prohibited")

    verifier = _load_script(Path(__file__).with_name("verify-company-benefits-ledger.py"), "series_package_verifier")
    source_errors = []
    verifier.validate_sources(records["sources.jsonl"], source_errors)
    if source_errors:
        raise ValueError("incoming source schema validation failed:\n" + "\n".join(source_errors))
    series.validate_v2_package_records(v2_records, batch, research_root)
    validate_review_audit(manifest, batch, records, research_root)

    existing = {name: series.read_jsonl(research_root / target) for name, target in TARGETS.items()}
    collision_files = list(series.V2_LEDGER_FILES.values())
    if validate_immutable_legacy_collisions:
        collision_files[:0] = IMMUTABLE_LEGACY_FILES
    for name in collision_files:
        validate_record_collisions(
            name, input_dir / name, research_root / TARGETS[name], records[name], existing[name]
        )
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
        claim = claim_map[claim_id]
        if claim.get("status") != "unknown":
            prepub = parse_timestamp(claim.get("prepublication_checked_at"), "prepublication_checked_at")
            if prepub <= reviewed:
                raise ValueError(f"{claim_id}: stale or pre-review prepublication check")
    for record_id, review in outcome_review_map.items():
        if review.get("decision") != "approved" or review.get("researcher_id") == review.get("reviewer_id"):
            raise ValueError(f"{record_id}: unapproved or self-approved outcome review")
        parse_timestamp(review.get("reviewed_at"), "outcome reviewed_at")
    source_map = {item.get("source_id"): item for item in existing["sources.jsonl"] + records["sources.jsonl"]}
    used_ids = {source_id for claim in claims for source_id in claim.get("source_ids", []) + claim.get("searched_source_ids", [])}
    if None in source_map or used_ids - set(source_map):
        raise ValueError("claim has missing source bindings")
    metadata_claim_sources = {source_id for source_id in used_ids if source_map[source_id].get("record_type") == "nonpublishable_metadata"}
    if metadata_claim_sources:
        raise ValueError("nonpublishable metadata sources cannot support claim or unknown-claim records")
    for claim in claims:
        if claim.get("status") != "unknown":
            if any(source_map[source_id].get("hash_provenance") == series.IDENTITY_PROVENANCE
                   for source_id in claim.get("source_ids", [])):
                raise ValueError(f"{claim.get('claim_id')}: official identity projections cannot support benefit claim prose")
            evidence_ids = [item.get("source_id") for item in claim.get("source_evidence", [])]
            if len(evidence_ids) != len(set(evidence_ids)) or set(evidence_ids) != set(claim.get("source_ids", [])):
                raise ValueError(f"{claim.get('claim_id')}: missing one-to-one source evidence bindings")
    expected_source_ids = expected_check_source_ids(claims, gaps, source_map)
    check_map = _unique_map(records["checks.jsonl"], "source_id", "checks")
    if set(check_map) != expected_source_ids:
        raise ValueError("checks must bind every used official source_id exactly once")
    for source_id, check in check_map.items():
        verifier.company_benefits_series.validate_source_check(check, source_map[source_id])
    latest_review_by_source_id = {}
    for claim in claims:
        reviewed = parse_timestamp(review_map[claim["claim_id"]].get("reviewed_at"), "reviewed_at")
        bound_check_times = []
        for source_id in claim.get("source_ids", []) + claim.get("searched_source_ids", []):
            current = latest_review_by_source_id.get(source_id)
            if current is None or reviewed > parse_timestamp(current, "latest review"):
                latest_review_by_source_id[source_id] = review_map[claim["claim_id"]]["reviewed_at"]
            checked = parse_timestamp(check_map[source_id].get("checked_at"), "check checked_at")
            if checked <= reviewed:
                raise ValueError(f"{claim['claim_id']}: stale or pre-review prepublication check")
            if source_id in claim.get("source_ids", []):
                bound_check_times.append(checked)
        if claim.get("status") != "unknown":
            prepub = parse_timestamp(claim.get("prepublication_checked_at"), "prepublication_checked_at")
            if not bound_check_times or prepub != max(bound_check_times):
                raise ValueError(f"{claim['claim_id']}: prepublication timestamp is not the exact latest successful bound check")
    for record_id, review in outcome_review_map.items():
        reviewed_at = review["reviewed_at"]
        for source_id in expected_check_source_ids([], [gap_map[record_id]], source_map):
            current = latest_review_by_source_id.get(source_id)
            if current is None or parse_timestamp(reviewed_at, "outcome reviewed_at") > parse_timestamp(current, "latest review"):
                latest_review_by_source_id[source_id] = reviewed_at
    merge_checks(existing["checks.jsonl"], records["checks.jsonl"], latest_review_by_source_id, expected_source_ids)
    return manifest, batch, records


def _load_script(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def claim_review_map(reviews):
    """Index claim-targeted reviews while leaving gap outcome reviews separate."""
    return {item["claim_id"]: item for item in reviews if item.get("claim_id")}


def _fsync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _write_file_durable(path, raw, exclusive=False):
    flags = os.O_WRONLY | os.O_CREAT | (os.O_EXCL if exclusive else os.O_TRUNC)
    descriptor = os.open(path, flags, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
    except BaseException:
        try:
            os.close(descriptor)
        except OSError:
            pass
        raise


def _journal_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")


def _read_transaction_journal(transaction_dir):
    journal_path = Path(transaction_dir) / "journal.json"
    try:
        value = json.loads(journal_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError("batch transaction journal is missing or invalid; refusing unsafe cleanup") from exc
    if (not isinstance(value, dict) or value.get("schema_version") != TRANSACTION_SCHEMA_VERSION
            or value.get("status") not in {"preparing", "ready"} or not isinstance(value.get("entries"), list)
            or not isinstance(value.get("created_directories"), list)):
        raise RuntimeError("batch transaction journal schema is invalid; refusing unsafe cleanup")
    return value


def _remove_transaction_directory(research_root, transaction_dir):
    shutil.rmtree(transaction_dir)
    _fsync_directory(research_root)


def _cleanup_committed_transaction(research_root):
    committed = Path(research_root) / COMMITTED_TRANSACTION_DIRNAME
    if not committed.exists():
        return
    if committed.is_symlink() or not committed.is_dir():
        raise RuntimeError("committed batch transaction path is not an owned directory")
    allowed = re.compile(r"(?:journal\.json|journal\.next|(?:backup|proposed|restore)-\d{2})")
    children = list(committed.iterdir())
    if any(not child.is_file() or child.is_symlink() or not allowed.fullmatch(child.name) for child in children):
        raise RuntimeError("committed batch transaction contains an unowned file")
    shutil.rmtree(committed)
    _fsync_directory(research_root)


def recover_transaction(research_root):
    """Finish rollback of an interrupted, durably journaled batch transaction."""
    research_root = Path(research_root)
    _cleanup_committed_transaction(research_root)
    transaction_dir = research_root / TRANSACTION_DIRNAME
    if not transaction_dir.exists():
        return
    if transaction_dir.is_symlink() or not transaction_dir.is_dir():
        raise RuntimeError("batch transaction path is not an owned directory")
    try:
        journal = _read_transaction_journal(transaction_dir)
    except RuntimeError:
        children = list(transaction_dir.iterdir())
        if all(path.name == "journal.json" and path.is_file() and not path.is_symlink() for path in children):
            _remove_transaction_directory(research_root, transaction_dir)
            return
        raise
    if journal["status"] == "preparing":
        if journal["entries"] or journal["created_directories"]:
            raise RuntimeError("preparing batch transaction journal contains unexpected state")
        _remove_transaction_directory(research_root, transaction_dir)
        return
    rollback_transaction(research_root, journal)


def _validated_transaction_entries(research_root, transaction_dir, journal):
    entries = journal["entries"]
    target_names = [entry.get("target") for entry in entries if isinstance(entry, dict)]
    if (len(target_names) != len(LEDGER_TARGETS) + 1 or tuple(target_names[:-1]) != LEDGER_TARGETS
            or not re.fullmatch(r"drafts/(?:domestic|international)-\d{2}\.md", str(target_names[-1]))):
        raise RuntimeError("batch transaction journal target set is invalid")
    if journal["created_directories"] not in ([], ["drafts"]):
        raise RuntimeError("batch transaction journal created-directory set is invalid")
    targets = []
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict) or set(entry) != {"target", "backup", "proposed", "prior_sha256", "proposed_sha256"}:
            raise RuntimeError("batch transaction journal entry is invalid")
        relative = Path(entry["target"])
        if relative.is_absolute() or ".." in relative.parts or relative.as_posix() != entry["target"]:
            raise RuntimeError("batch transaction journal target is unsafe")
        if entry["backup"] not in (None, f"backup-{index:02d}") or entry["proposed"] != f"proposed-{index:02d}":
            raise RuntimeError("batch transaction journal owned-file binding is invalid")
        if entry["prior_sha256"] is not None and entry["backup"] is None:
            raise RuntimeError("batch transaction journal backup binding is invalid")
        for field in ("prior_sha256", "proposed_sha256"):
            value = entry[field]
            if value is not None and not re.fullmatch(r"[0-9a-f]{64}", value):
                raise RuntimeError("batch transaction journal digest is invalid")
        target = research_root / relative
        proposed = transaction_dir / entry["proposed"]
        backup = transaction_dir / entry["backup"] if entry["backup"] else None
        if proposed.exists() and sha256(proposed.read_bytes()) != entry["proposed_sha256"]:
            raise RuntimeError("batch transaction proposed bytes are corrupt")
        if backup is not None and (not backup.is_file() or sha256(backup.read_bytes()) != entry["prior_sha256"]):
            raise RuntimeError("batch transaction backup bytes are corrupt")
        targets.append((entry, target, backup))
    return targets


def rollback_transaction(research_root, journal=None):
    """Restore all transaction targets without overwriting unknown concurrent bytes."""
    research_root = Path(research_root)
    transaction_dir = research_root / TRANSACTION_DIRNAME
    journal = journal or _read_transaction_journal(transaction_dir)
    if journal.get("status") != "ready":
        raise RuntimeError("batch transaction is not ready for rollback")
    targets = _validated_transaction_entries(research_root, transaction_dir, journal)

    # Validate the entire rollback before touching any target.
    for entry, target, _ in targets:
        if target.exists():
            if not target.is_file() or target.is_symlink():
                raise RuntimeError(f"unexpected concurrent target type blocks rollback: {entry['target']}")
            current = sha256(target.read_bytes())
            if current not in {entry["prior_sha256"], entry["proposed_sha256"]}:
                raise RuntimeError(f"unexpected concurrent bytes block rollback: {entry['target']}")
        elif entry["prior_sha256"] is not None:
            raise RuntimeError(f"unexpected missing target blocks rollback: {entry['target']}")

    synced_directories = set()
    for index in range(len(targets) - 1, -1, -1):
        entry, target, backup = targets[index]
        prior_sha = entry["prior_sha256"]
        current_sha = sha256(target.read_bytes()) if target.exists() else None
        if prior_sha is None:
            if current_sha == entry["proposed_sha256"]:
                target.unlink()
                synced_directories.add(target.parent)
            continue
        if current_sha == prior_sha:
            continue
        restore = transaction_dir / f"restore-{index:02d}"
        _write_file_durable(restore, backup.read_bytes())
        os.replace(restore, target)
        synced_directories.add(target.parent)
    for directory in sorted(synced_directories, key=str):
        _fsync_directory(directory)
    _remove_transaction_directory(research_root, transaction_dir)
    for relative in sorted(journal["created_directories"], key=lambda value: len(Path(value).parts), reverse=True):
        directory = research_root / relative
        try:
            directory.rmdir()
        except OSError:
            pass
    _fsync_directory(research_root)


def commit_staged_outputs(research_root, replacements):
    """Durably promote staged outputs as one recoverable file transaction."""
    research_root = Path(research_root)
    recover_transaction(research_root)
    transaction_dir = research_root / TRANSACTION_DIRNAME
    transaction_dir.mkdir(mode=0o700)
    journal_path = transaction_dir / "journal.json"
    preparing = {"schema_version": TRANSACTION_SCHEMA_VERSION, "status": "preparing",
                 "entries": [], "created_directories": []}
    ready = False
    journal = None
    try:
        _fsync_directory(research_root)
        _write_file_durable(journal_path, _journal_bytes(preparing), exclusive=True)
        _fsync_directory(transaction_dir)
        entries = []
        created_directories = []
        seen_targets = set()
        for index, (source, relative_value) in enumerate(replacements):
            source = Path(source)
            relative = Path(relative_value)
            if (not source.is_file() or source.is_symlink() or relative.is_absolute() or ".." in relative.parts
                    or relative.as_posix() != str(relative_value) or relative in seen_targets):
                raise ValueError("transaction replacements require unique safe relative file targets")
            seen_targets.add(relative)
            target = research_root / relative
            missing = []
            parent = target.parent
            while parent != research_root and not parent.exists():
                missing.append(parent.relative_to(research_root).as_posix())
                parent = parent.parent
            if not parent.exists() or parent.is_symlink() or not parent.is_dir():
                raise ValueError(f"transaction target parent is unsafe: {relative}")
            for item in reversed(missing):
                if item not in created_directories:
                    created_directories.append(item)
            if target.exists() and (not target.is_file() or target.is_symlink()):
                raise ValueError(f"transaction target is not a regular file: {relative}")
            proposed_raw = source.read_bytes()
            proposed_name = f"proposed-{index:02d}"
            _write_file_durable(transaction_dir / proposed_name, proposed_raw, exclusive=True)
            prior_sha = None
            backup_name = None
            if target.exists():
                prior_raw = target.read_bytes()
                prior_sha = sha256(prior_raw)
                backup_name = f"backup-{index:02d}"
                _write_file_durable(transaction_dir / backup_name, prior_raw, exclusive=True)
            entries.append({"target": relative.as_posix(), "backup": backup_name, "proposed": proposed_name,
                            "prior_sha256": prior_sha, "proposed_sha256": sha256(proposed_raw)})
        journal = {"schema_version": TRANSACTION_SCHEMA_VERSION, "status": "ready",
                   "entries": entries, "created_directories": created_directories}
        _validated_transaction_entries(research_root, transaction_dir, journal)
        journal_temporary = transaction_dir / "journal.next"
        _write_file_durable(journal_temporary, _journal_bytes(journal), exclusive=True)
        os.replace(journal_temporary, journal_path)
        _fsync_directory(transaction_dir)
        ready = True
        for relative in created_directories:
            (research_root / relative).mkdir()
            _fsync_directory((research_root / relative).parent)
        for entry in entries:
            target = research_root / entry["target"]
            if target.exists():
                if not target.is_file() or target.is_symlink() or sha256(target.read_bytes()) != entry["prior_sha256"]:
                    raise RuntimeError(f"concurrent target change blocks commit: {entry['target']}")
            elif entry["prior_sha256"] is not None:
                raise RuntimeError(f"concurrent target removal blocks commit: {entry['target']}")
            os.replace(transaction_dir / entry["proposed"], target)
            _fsync_directory(target.parent)
        committed = research_root / COMMITTED_TRANSACTION_DIRNAME
        os.replace(transaction_dir, committed)
        _fsync_directory(research_root)
        _cleanup_committed_transaction(research_root)
    except BaseException:
        committed = research_root / COMMITTED_TRANSACTION_DIRNAME
        if ready and transaction_dir.exists():
            if journal is None:
                raise RuntimeError("ready transaction has no journal")
            rollback_transaction(research_root, journal)
        elif committed.exists():
            _cleanup_committed_transaction(research_root)
        elif transaction_dir.exists():
            _remove_transaction_directory(research_root, transaction_dir)
        raise


def _integrate_batch_locked(input_dir, research_root, freeze_anchor_receipt, effective_selection_receipt=None,
                            as_of=None, dry_run=False):
    input_dir, research_root = Path(input_dir), Path(research_root)
    manifest, batch, incoming = load_package(input_dir, research_root)
    with tempfile.TemporaryDirectory(prefix="company-benefits-series-") as directory:
        staged = Path(directory) / "research"
        shutil.copytree(research_root, staged)
        # The v1 projections are immutable refreeze audit inputs while v2 is in
        # progress. They validate the package but are never merged or promoted.
        for name, target in V2_TARGETS.items():
            current = series.read_jsonl(staged / target)
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
            draft = f"drafts/{batch['batch_id']}.md"
            replacements = [(staged / target, target) for target in LEDGER_TARGETS]
            replacements.append((staged / draft, draft))
            commit_staged_outputs(research_root, replacements)
    return new_progress


def integrate_batch(input_dir, research_root, freeze_anchor_receipt, effective_selection_receipt=None,
                    as_of=None, dry_run=False):
    """Serialize recovery, validation, staging, and commit on the research root."""
    research_root = Path(research_root)
    if research_root.is_symlink():
        raise ValueError("research root symlinks are prohibited")
    research_root = research_root.resolve(strict=True)
    lock_descriptor = os.open(research_root, os.O_RDONLY | os.O_DIRECTORY)
    try:
        try:
            fcntl.flock(lock_descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ValueError("another company-benefits batch integration is in progress") from exc
        recover_transaction(research_root)
        return _integrate_batch_locked(input_dir, research_root, freeze_anchor_receipt,
                                       effective_selection_receipt, as_of, dry_run)
    finally:
        os.close(lock_descriptor)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_dir", type=Path, help="directory containing batch.json and eleven JSONL artifacts")
    parser.add_argument("--research-root", type=Path, default=Path("docs/research/company-benefits"))
    parser.add_argument("--freeze-anchor-receipt", type=Path, default=os.environ.get("COMPANY_BENEFITS_FREEZE_ANCHOR_RECEIPT"), required=False)
    parser.add_argument("--effective-selection-receipt", type=Path, default=os.environ.get("COMPANY_BENEFITS_EFFECTIVE_SELECTION_RECEIPT"))
    parser.add_argument("--as-of", type=lambda value: datetime.fromisoformat(value).date())
    parser.add_argument("--dry-run", action="store_true", help="validate, stage, verify, and render without changing the research root")
    args = parser.parse_args(argv)
    if args.freeze_anchor_receipt is None:
        parser.error("--freeze-anchor-receipt or COMPANY_BENEFITS_FREEZE_ANCHOR_RECEIPT is required")
    try:
        progress = integrate_batch(args.input_dir, args.research_root, args.freeze_anchor_receipt,
                                   args.effective_selection_receipt, args.as_of, args.dry_run)
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"batch integration failed: {exc}", file=sys.stderr)
        return 1
    approved = sum(item["status"] == "approved" for item in progress["batches"])
    print(f"validated {approved}/80 approved batches" + (" (dry run)" if args.dry_run else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
