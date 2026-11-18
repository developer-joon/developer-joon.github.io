#!/usr/bin/env python3
"""Read-only verifier for exact reviewed benefit release checkpoints.

The canonical integration ledger supplied by ``--series-batches`` is the
trust root for batch membership and effective/replacement lineage. The
disjoint ``--series-batch-approvals`` ledger is the trust root for immutable
package and review identities. Protocol-2 checkpoints also rerun the production
package validator over every complete retained promoted package before any
release count is accepted.
"""

import argparse
import hashlib
import importlib.util
import json
import os
import re
import stat
import sys
from collections import Counter
from pathlib import Path, PurePosixPath

sys.path.insert(0, str(Path(__file__).resolve().parent))
import company_benefits_series as series

HASH = re.compile(r"^[0-9a-f]{64}$")
BATCH_ID = re.compile(r"^(domestic|international)-(0[1-9]|[1-3][0-9]|40)$")

CHECKPOINT_FIELDS = {"schema_version", "artifact_kind", "release_kind", "batches"}
LINEAGE_FIELDS = {
    "company_list_sha256", "effective_sequence_sha256", "replacement_events_sha256",
}
REVIEW_IDENTITY_FIELDS = {"reviewed_candidate_sha256", "reviewer_receipt_sha256"}
APPROVAL_IDENTITY_FIELDS = {"package_sha256", *REVIEW_IDENTITY_FIELDS}
APPROVAL_FIELDS = {"approval_version", "batch_id", "status", *APPROVAL_IDENTITY_FIELDS}
PACKAGE_FIELDS = {
    "approval_version", "batch_id", "status", "company_ids", "package_path", "package_sha256",
    *REVIEW_IDENTITY_FIELDS, *LINEAGE_FIELDS,
}
PACKAGE_MANIFEST_FIELDS = {
    "schema_version", "batch_id", *LINEAGE_FIELDS, "status", "approved_at",
    "reviewer_id", "artifacts", "review_audit",
}
ARTIFACT_FIELDS = {
    "sources.jsonl", "claims.jsonl", "reviews.jsonl", "gaps.jsonl", "checks.jsonl",
    "company-category-cells.jsonl", "research-attempts.jsonl", "official-claims-v2.jsonl",
    "reference-records.jsonl", "community-benefit-reports.jsonl", "sources-v2.jsonl",
}
CURRENT_ARTIFACT_FIELDS = ARTIFACT_FIELDS | {
    "verified-benefits.jsonl", "company-category-outcomes.jsonl",
}
CANDIDATE_ARTIFACT_FIELDS = (ARTIFACT_FIELDS - {"reviews.jsonl", "checks.jsonl"}) | {
    "review-requests.jsonl",
}
CURRENT_CANDIDATE_ARTIFACT_FIELDS = CANDIDATE_ARTIFACT_FIELDS | {
    "verified-benefit-candidates.jsonl", "company-category-outcomes.jsonl",
}
REVIEW_ARTIFACT_FIELDS = {"reviews.jsonl", "checks.jsonl"}
REVIEW_AUDIT_FIELDS = {
    "candidate_manifest_sha256", "candidate_manifest", "candidate_artifacts",
    "review_bundle_sha256", "review_bundle", "review_artifacts",
}
CURRENT_REVIEW_AUDIT_FIELDS = REVIEW_AUDIT_FIELDS | {
    "reviewed_candidate_sha256", "reviewer_receipt_sha256", "reviewer_receipt",
}
RELEASE_BATCH_COUNTS = {"gold": 2, "normal": 4}
MAX_CHECKPOINT_BYTES = 1024 * 1024
MAX_SERIES_BATCHES_BYTES = 1024 * 1024
MAX_SERIES_BATCH_APPROVALS_BYTES = 1024 * 1024
MAX_COMPANY_LEDGER_BYTES = 16 * 1024 * 1024
MAX_PACKAGE_MANIFEST_BYTES = 4 * 1024 * 1024
MAX_CANONICAL_LEDGER_BYTES = 64 * 1024 * 1024


def _unique_map(records, field, label):
    if not isinstance(records, list) or any(not isinstance(record, dict) for record in records):
        raise ValueError(f"{label} must be an array of objects")
    result = {}
    for record in records:
        value = record.get(field)
        if not isinstance(value, str) or not value or value in result:
            raise ValueError(f"{label} contains a missing or duplicate {field}")
        result[value] = record
    return result


def _approval_map(records):
    approvals = _unique_map(records, "batch_id", "canonical batch approvals")
    replay_hashes = {field: set() for field in ("package_sha256", "reviewer_receipt_sha256")}
    for batch_id, approval in approvals.items():
        if set(approval) != APPROVAL_FIELDS:
            raise ValueError(f"{batch_id}: canonical approval fields do not match the strict contract")
        if not BATCH_ID.fullmatch(batch_id):
            raise ValueError(f"{batch_id}: canonical approval batch ID is malformed")
        if approval.get("approval_version") != "1" or approval.get("status") != "approved":
            raise ValueError(f"{batch_id}: canonical approval version or status is invalid")
        for field in APPROVAL_IDENTITY_FIELDS:
            if not isinstance(approval.get(field), str) or not HASH.fullmatch(approval[field]):
                raise ValueError(f"{batch_id}: canonical approval identity is malformed: {field}")
        for field, observed in replay_hashes.items():
            digest = approval[field]
            if digest in observed:
                raise ValueError(f"{batch_id}: canonical approval replayed {field}")
            observed.add(digest)
    return approvals


def _safe_relative_parts(relative, label):
    if not isinstance(relative, str) or not relative or "\\" in relative:
        raise ValueError(f"{label} path is malformed")
    parsed = PurePosixPath(relative)
    if parsed.is_absolute() or str(parsed) != relative or any(part in {"", ".", ".."} for part in parsed.parts):
        raise ValueError(f"{label} path escapes its bounded root")
    return parsed.parts


def _open_directory_nofollow(path):
    path = Path(path)
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    if path.is_absolute():
        opened = [os.open("/", flags)]
        parts = path.parts[1:]
    else:
        opened = [os.open(".", flags)]
        parts = path.parts
    try:
        for part in parts:
            if part in {"", "."}:
                continue
            opened.append(os.open(part, flags, dir_fd=opened[-1]))
        return opened.pop()
    finally:
        for descriptor in reversed(opened):
            os.close(descriptor)


def _read_bounded_regular(root, relative, limit, label):
    parts = _safe_relative_parts(relative, label)
    opened = []
    try:
        directory_fd = _open_directory_nofollow(root)
        opened.append(directory_fd)
        for part in parts[:-1]:
            directory_fd = os.open(
                part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                dir_fd=directory_fd,
            )
            opened.append(directory_fd)
        file_fd = os.open(
            parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
            dir_fd=directory_fd,
        )
        opened.append(file_fd)
        metadata = os.fstat(file_fd)
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError(f"{label} must be a regular file")
        if metadata.st_size > limit:
            raise ValueError(f"{label} exceeds the bounded byte limit")
        chunks = []
        remaining = metadata.st_size
        while remaining:
            chunk = os.read(file_fd, min(remaining, 1024 * 1024))
            if not chunk:
                raise ValueError(f"{label} changed during bounded read")
            chunks.append(chunk)
            remaining -= len(chunk)
        final_metadata = os.fstat(file_fd)
        stable_fields = ("st_dev", "st_ino", "st_mode", "st_size", "st_mtime_ns", "st_ctime_ns")
        if any(getattr(final_metadata, field) != getattr(metadata, field) for field in stable_fields):
            raise ValueError(f"{label} changed during bounded read")
        path_metadata = os.stat(parts[-1], dir_fd=directory_fd, follow_symlinks=False)
        if any(getattr(path_metadata, field) != getattr(metadata, field) for field in stable_fields):
            raise ValueError(f"{label} path changed during bounded read")
        return b"".join(chunks)
    except OSError as exc:
        raise ValueError(f"{label} path is not a safe regular file") from exc
    finally:
        for descriptor in reversed(opened):
            os.close(descriptor)


def _read_json_bytes(raw, label):
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"{label} is invalid JSON") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a JSON object")
    return value


def _read_jsonl_bytes(raw, label):
    records = []
    try:
        lines = raw.decode("utf-8").splitlines()
    except UnicodeDecodeError as exc:
        raise ValueError(f"{label} is not UTF-8") from exc
    for line_number, line in enumerate(lines, 1):
        if not line.strip():
            raise ValueError(f"{label}:{line_number}: blank JSONL line")
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{label}:{line_number}: invalid JSON") from exc
        if not isinstance(record, dict):
            raise ValueError(f"{label}:{line_number}: record must be an object")
        records.append(record)
    return records


def _sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def _load_production_integrator():
    path = Path(__file__).with_name("integrate-company-benefits-series-batch.py")
    spec = importlib.util.spec_from_file_location("checkpoint_package_integrator", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load production package validator")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _company_list_sha256(company_ids):
    raw = json.dumps(company_ids, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return _sha256(raw)


def _verify_hash_object(value, expected_fields, label):
    if not isinstance(value, dict) or set(value) != expected_fields:
        raise ValueError(f"{label} fields do not match the production schema")
    if any(not isinstance(digest, str) or not HASH.fullmatch(digest) for digest in value.values()):
        raise ValueError(f"{label} contains a malformed hash")


def _verify_production_package_manifest(manifest, batch_id):
    label = f"{batch_id}: package manifest"
    if set(manifest) != PACKAGE_MANIFEST_FIELDS:
        raise ValueError(f"{label} fields do not match the production schema")
    try:
        approved_at_instant = series.parse_canonical_rfc3339(
            manifest.get("approved_at"), f"{label} approved_at",
        )
    except ValueError as exc:
        raise ValueError(f"{label} approved_at is not a production date-time") from exc
    if not isinstance(manifest.get("reviewer_id"), str) or not manifest["reviewer_id"]:
        raise ValueError(f"{label} reviewer_id is invalid")
    version = manifest.get("schema_version")
    if version not in {"1", "2"}:
        raise ValueError(f"{label} schema version is invalid")
    current = version == "2"
    _verify_hash_object(
        manifest.get("artifacts"), CURRENT_ARTIFACT_FIELDS if current else ARTIFACT_FIELDS,
        f"{label} artifacts",
    )
    review_audit = manifest.get("review_audit")
    if not isinstance(review_audit, dict) or set(review_audit) != (
            CURRENT_REVIEW_AUDIT_FIELDS if current else REVIEW_AUDIT_FIELDS):
        raise ValueError(f"{label} review_audit fields do not match the production schema")
    for field in ("candidate_manifest_sha256", "review_bundle_sha256"):
        if not isinstance(review_audit.get(field), str) or not HASH.fullmatch(review_audit[field]):
            raise ValueError(f"{label} review_audit contains a malformed hash")
    for field in ("candidate_manifest", "review_bundle"):
        if not isinstance(review_audit.get(field), dict):
            raise ValueError(f"{label} review_audit {field} must be an object")
    _verify_hash_object(
        review_audit.get("candidate_artifacts"),
        CURRENT_CANDIDATE_ARTIFACT_FIELDS if current else CANDIDATE_ARTIFACT_FIELDS,
        f"{label} review_audit candidate_artifacts",
    )
    _verify_hash_object(
        review_audit.get("review_artifacts"), REVIEW_ARTIFACT_FIELDS,
        f"{label} review_audit review_artifacts",
    )
    if current:
        receipt = review_audit.get("reviewer_receipt")
        receipt_fields = {"schema_version", "status", "reviewer_id", "reviewed_candidate_sha256", "reviewed_at"}
        if (not isinstance(receipt, dict) or set(receipt) != receipt_fields
                or receipt.get("schema_version") != "1" or receipt.get("status") != "approved"
                or receipt.get("reviewer_id") != manifest.get("reviewer_id")
                or receipt.get("reviewed_candidate_sha256") != review_audit.get("reviewed_candidate_sha256")):
            raise ValueError(f"{label} retained reviewer receipt contract is invalid")
        receipt_raw = json.dumps(
            receipt, ensure_ascii=False, separators=(",", ":"), allow_nan=False,
        ).encode("utf-8")
        if _sha256(receipt_raw) != review_audit.get("reviewer_receipt_sha256"):
            raise ValueError(f"{label} retained reviewer receipt byte/hash binding is invalid")
        try:
            reviewed_at_instant = series.parse_canonical_rfc3339(
                receipt.get("reviewed_at"), f"{label} reviewer receipt reviewed_at",
            )
        except ValueError as exc:
            raise ValueError(f"{label} reviewer receipt reviewed_at is not a production date-time") from exc
        if reviewed_at_instant >= approved_at_instant:
            raise ValueError(f"{label} review must precede package approval")


def _verify_canonical_lineage(descriptor, canonical, canonical_root):
    batch_id = descriptor["batch_id"]
    company_ids = descriptor["company_ids"]
    if descriptor["company_list_sha256"] != _company_list_sha256(company_ids):
        raise ValueError(f"{batch_id}: company-list lineage hash differs from canonical membership bytes")
    for field in LINEAGE_FIELDS:
        if descriptor[field] != canonical.get(field):
            raise ValueError(f"{batch_id}: {field} differs from canonical batch lineage")

    scope = canonical.get("scope")
    batch_number = canonical.get("batch_number")
    if scope not in {"domestic", "international"} or type(batch_number) is not int or batch_number < 1:
        raise ValueError(f"{batch_id}: canonical batch scope or number is malformed")
    effective_relative = f"population/{scope}-effective-selected.jsonl"
    effective_raw = _read_bounded_regular(
        canonical_root, effective_relative, MAX_CANONICAL_LEDGER_BYTES,
        f"{batch_id} canonical effective sequence",
    )
    events_raw = _read_bounded_regular(
        canonical_root, "population/effective-selection-events.jsonl",
        MAX_CANONICAL_LEDGER_BYTES, f"{batch_id} canonical replacement events",
    )
    if _sha256(effective_raw) != descriptor["effective_sequence_sha256"]:
        raise ValueError(f"{batch_id}: effective sequence lineage hash does not match canonical bytes")
    if _sha256(events_raw) != descriptor["replacement_events_sha256"]:
        raise ValueError(f"{batch_id}: replacement-event lineage hash does not match canonical bytes")
    effective = _read_jsonl_bytes(effective_raw, f"{batch_id} canonical effective sequence")
    start = (batch_number - 1) * 25
    actual_ids = [record.get("company_id") for record in effective[start:start + 25]]
    if actual_ids != company_ids:
        raise ValueError(f"{batch_id}: package membership differs from canonical effective sequence")


def _verify_package_descriptor(descriptor, canonical, approval, package_root, *, canonical_root=None):
    batch_id = descriptor["batch_id"]
    package_path = descriptor["package_path"]
    if PurePosixPath(package_path).name != "batch.json":
        raise ValueError(f"{batch_id}: package path must name the existing batch.json manifest")
    raw = _read_bounded_regular(
        package_root, package_path, MAX_PACKAGE_MANIFEST_BYTES,
        f"{batch_id} package manifest",
    )
    if _sha256(raw) != descriptor["package_sha256"] or descriptor["package_sha256"] != approval["package_sha256"]:
        raise ValueError(f"{batch_id}: package SHA-256 does not match exact batch.json bytes")
    manifest = _read_json_bytes(raw, f"{batch_id} package manifest")
    _verify_production_package_manifest(manifest, batch_id)
    if manifest.get("schema_version") not in {"1", "2"} or manifest.get("batch_id") != batch_id or manifest.get("status") != "approved":
        raise ValueError(f"{batch_id}: package manifest identity or approval status mismatch")
    for field in LINEAGE_FIELDS:
        if manifest.get(field) != descriptor[field] or manifest.get(field) != canonical.get(field):
            raise ValueError(f"{batch_id}: package manifest {field} lineage mismatch")
    if manifest.get("schema_version") == "2":
        review_audit = manifest["review_audit"]
        for field in REVIEW_IDENTITY_FIELDS:
            if review_audit.get(field) != approval[field]:
                raise ValueError(
                    f"{batch_id}: canonical approval identity mismatch with review_audit: {field}"
                )
        if canonical_root is not None:
            package_dir = Path(package_root).joinpath(*PurePosixPath(package_path).parts[:-1])
            validated_manifest, validated_batch, _ = _load_production_integrator().load_package(
                package_dir, canonical_root, retained_approval=approval,
            )
            if (validated_manifest != manifest or validated_batch.get("batch_id") != batch_id
                    or validated_batch.get("company_ids") != descriptor["company_ids"]
                    or validated_batch.get("scope") != canonical.get("scope")):
                raise ValueError(f"{batch_id}: validated retained package metadata differs from descriptor")



def verify_checkpoint(checkpoint, canonical_batches, canonical_approvals, companies, *, canonical_root, package_root):
    """Verify a checkpoint without mutating or publishing any artifact."""
    if not isinstance(checkpoint, dict) or set(checkpoint) != CHECKPOINT_FIELDS:
        raise ValueError("checkpoint fields do not match the release contract")
    if checkpoint.get("schema_version") != 1 or checkpoint.get("artifact_kind") != "benefit_release_checkpoint":
        raise ValueError("checkpoint schema or artifact kind is invalid")
    release_kind = checkpoint.get("release_kind")
    if release_kind not in RELEASE_BATCH_COUNTS:
        raise ValueError("checkpoint release_kind must be gold or normal")
    descriptors = checkpoint.get("batches")
    expected_batch_count = RELEASE_BATCH_COUNTS[release_kind]
    if not isinstance(descriptors, list) or len(descriptors) != expected_batch_count:
        raise ValueError(f"{release_kind} checkpoint requires exactly {expected_batch_count} approved batches")

    canonical_by_id = _unique_map(canonical_batches, "batch_id", "canonical batches")
    approval_by_id = _approval_map(canonical_approvals)
    orphan_approvals = sorted(set(approval_by_id) - set(canonical_by_id))
    if orphan_approvals:
        raise ValueError("canonical approval ledger contains a batch outside the canonical batch ledger")
    companies_by_id = _unique_map(companies, "company_id", "canonical companies")
    selected_ids = []
    # Empty independently reviewed candidate sets canonically have identical
    # bytes across batches. Package and receipt identities must still be unique.
    replay_hashes = {field: set() for field in ("package_sha256", "reviewer_receipt_sha256")}
    selected_batch_ids = set()
    for descriptor in descriptors:
        if not isinstance(descriptor, dict) or set(descriptor) != PACKAGE_FIELDS:
            raise ValueError("malformed package descriptor")
        batch_id = descriptor.get("batch_id")
        if not isinstance(batch_id, str) or not batch_id or batch_id in selected_batch_ids:
            raise ValueError("duplicate or malformed batch descriptor")
        selected_batch_ids.add(batch_id)
        canonical = canonical_by_id.get(batch_id)
        approval = approval_by_id.get(batch_id)
        if approval is None:
            raise ValueError(f"{batch_id}: canonical approval row is missing")
        if descriptor.get("approval_version") != approval.get("approval_version"):
            raise ValueError(f"{batch_id}: canonical approval version mismatch")
        if descriptor.get("status") != approval.get("status"):
            raise ValueError(f"{batch_id}: checkpoint package does not match canonical approved status")
        for field in (*LINEAGE_FIELDS, *replay_hashes):
            digest = descriptor.get(field)
            if not isinstance(digest, str) or not HASH.fullmatch(digest):
                raise ValueError(f"{batch_id}: malformed package descriptor hash")
        for field, observed in replay_hashes.items():
            digest = descriptor[field]
            if digest in observed:
                raise ValueError(f"{batch_id}: copied or replayed package descriptor")
            observed.add(digest)

        for field in APPROVAL_IDENTITY_FIELDS:
            if descriptor[field] != approval[field]:
                raise ValueError(f"{batch_id}: canonical approval identity mismatch: {field}")
        company_ids = descriptor.get("company_ids")
        canonical_ids = canonical.get("company_ids") if canonical else None
        if (not isinstance(canonical_ids, list) or len(canonical_ids) != 25
                or any(not isinstance(company_id, str) or not company_id for company_id in canonical_ids)
                or len(set(canonical_ids)) != 25):
            raise ValueError(f"{batch_id}: canonical batch membership is malformed")
        if company_ids != canonical_ids:
            raise ValueError(f"{batch_id}: package membership differs from the canonical 25-company batch")
        _verify_canonical_lineage(descriptor, canonical, canonical_root)
        _verify_package_descriptor(
            descriptor, canonical, approval, package_root,
            canonical_root=canonical_root,
        )
        selected_ids.extend(canonical_ids)

    if len(selected_ids) != expected_batch_count * 25 or len(set(selected_ids)) != len(selected_ids):
        raise ValueError("checkpoint company membership has a duplicate or wrong count")
    missing = [company_id for company_id in selected_ids if company_id not in companies_by_id]
    if missing:
        raise ValueError("checkpoint membership contains a company outside the canonical company ledger")
    jurisdictions = Counter(companies_by_id[company_id].get("jurisdiction") for company_id in selected_ids)
    if any(jurisdiction not in {"KR", "US"} for jurisdiction in jurisdictions):
        raise ValueError("checkpoint company jurisdiction is malformed")
    if release_kind == "gold" and jurisdictions != Counter({"KR": 25, "US": 25}):
        raise ValueError("gold checkpoint requires exactly 25 KR and 25 US companies")
    if release_kind == "normal" and len(selected_ids) != 100:
        raise ValueError("normal checkpoint requires exactly 100 companies")
    return {
        "batch_count": expected_batch_count,
        "company_count": len(selected_ids),
        "jurisdictions": dict(sorted(jurisdictions.items())),
    }


def _read_cli_input(path, limit, label):
    path = Path(path)
    return _read_bounded_regular(path.parent, path.name, limit, label)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument(
        "--series-batches", required=True, type=Path,
        help="authoritative canonical membership and lineage ledger",
    )
    parser.add_argument(
        "--series-batch-approvals", required=True, type=Path,
        help="authoritative canonical package and review identity ledger",
    )
    parser.add_argument("--companies", required=True, type=Path)
    parser.add_argument("--package-root", required=True, type=Path)
    args = parser.parse_args(argv)
    checkpoint = _read_json_bytes(
        _read_cli_input(args.checkpoint, MAX_CHECKPOINT_BYTES, "checkpoint"), "checkpoint",
    )
    canonical_batches = _read_jsonl_bytes(
        _read_cli_input(
            args.series_batches, MAX_SERIES_BATCHES_BYTES, "canonical batch ledger",
        ),
        "canonical batch ledger",
    )
    canonical_approvals = _read_jsonl_bytes(
        _read_cli_input(
            args.series_batch_approvals,
            MAX_SERIES_BATCH_APPROVALS_BYTES,
            "canonical approval ledger",
        ),
        "canonical approval ledger",
    )
    companies = _read_jsonl_bytes(
        _read_cli_input(args.companies, MAX_COMPANY_LEDGER_BYTES, "canonical companies"),
        "canonical companies",
    )
    result = verify_checkpoint(
        checkpoint,
        canonical_batches,
        canonical_approvals,
        companies,
        canonical_root=args.series_batches.parent,
        package_root=args.package_root,
    )
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ValueError as exc:
        raise SystemExit(f"error: {exc}") from None
