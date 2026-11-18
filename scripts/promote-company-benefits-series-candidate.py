#!/usr/bin/env python3
"""Promote a protocol-2 candidate using repository-external reviews."""

import argparse
import copy
import ctypes
import hashlib
import importlib.util
import json
import os
import re
import stat
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import company_benefits_series as series
import review_metadata_validation as review_metadata

FINAL_FILES = (
    "sources.jsonl", "claims.jsonl", "reviews.jsonl", "gaps.jsonl", "checks.jsonl",
    "company-category-cells.jsonl", "research-attempts.jsonl", "official-claims-v2.jsonl",
    "reference-records.jsonl", "community-benefit-reports.jsonl", "sources-v2.jsonl",
)
REVIEW_FILES = {"review-bundle.json", "reviews.jsonl", "checks.jsonl"}
CURRENT_REVIEW_FILES = {*REVIEW_FILES, "reviewed-candidate.json", "reviewer-receipt.json"}
HASH = re.compile(r"^[0-9a-f]{64}$")
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
MAX_REVIEW_ARTIFACT_BYTES = 16 * 1024 * 1024
# Current independent review ingress is exactly five files. Keep an aggregate
# bound in addition to the 16 MiB per-file limit to prevent multiplicative use.
MAX_REVIEW_TOTAL_BYTES = 32 * 1024 * 1024


def _renameat2(left_fd, left_name, right_fd, right_name, flags, message):
    libc = ctypes.CDLL(None, use_errno=True)
    renameat2 = getattr(libc, "renameat2", None)
    if renameat2 is None:
        raise RuntimeError(message)
    renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    renameat2.restype = ctypes.c_int
    if renameat2(left_fd, os.fsencode(left_name), right_fd, os.fsencode(right_name), flags) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), f"{left_name} <-> {right_name}")


def _atomic_exchange(left_fd, left_name, right_fd, right_name):
    _renameat2(left_fd, left_name, right_fd, right_name, 2,
               "atomic promotion replacement requires Linux renameat2")


def _atomic_noreplace(left_fd, left_name, right_fd, right_name):
    _renameat2(left_fd, left_name, right_fd, right_name, 1,
               "atomic promotion publication requires Linux renameat2")


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _timestamp(value, label):
    return series.parse_canonical_rfc3339(value, label)


def _external_directory(path):
    path = Path(path)
    try:
        resolved = path.resolve(strict=True)
    except OSError as exc:
        raise ValueError(f"independent review directory is invalid: {exc}") from exc
    lexical = Path(os.path.abspath(path))
    repository = REPOSITORY_ROOT.resolve()
    if path.is_symlink() or lexical.is_relative_to(repository) or resolved.is_relative_to(repository):
        raise ValueError("independent review artifacts must be repository-external and not symlink-aliased")
    return resolved


def _read_external_regular(directory, relative, limit=None, total_budget=None):
    """Read one repository-external regular file without following links or blocking on devices."""
    limit = MAX_REVIEW_ARTIFACT_BYTES if limit is None else limit
    if not isinstance(relative, str) or not relative or Path(relative).name != relative:
        raise ValueError("external review artifact path must be one bounded file name")
    directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    descriptor = None
    try:
        descriptor = os.open(relative, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                             dir_fd=directory_fd)
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise ValueError("external review artifact must be a bounded regular file")
        if total_budget is not None and total_budget[0] + before.st_size > MAX_REVIEW_TOTAL_BYTES:
            raise ValueError("external review package exceeds aggregate bounded byte limit")
        chunks = []
        remaining = before.st_size
        while remaining:
            chunk = os.read(descriptor, min(remaining, 1024 * 1024))
            if not chunk:
                raise ValueError("external review artifact changed during bounded read")
            chunks.append(chunk)
            remaining -= len(chunk)
        after = os.fstat(descriptor)
        path_state = os.stat(relative, dir_fd=directory_fd, follow_symlinks=False)
        stable = ("st_dev", "st_ino", "st_mode", "st_size", "st_mtime_ns", "st_ctime_ns")
        if any(getattr(before, field) != getattr(after, field)
               or getattr(before, field) != getattr(path_state, field) for field in stable):
            raise ValueError("external review artifact changed during bounded read")
        raw = b"".join(chunks)
        if total_budget is not None:
            total_budget[0] += len(raw)
        return raw
    except OSError as exc:
        raise ValueError("external review artifact is not a safe regular file") from exc
    finally:
        if descriptor is not None:
            os.close(descriptor)
        os.close(directory_fd)


def verify_external_review_bytes(review_dir, candidate_name, reviewed_candidate_sha256,
                                 receipt_name, reviewer_receipt_sha256, compiler_identity,
                                 total_budget=None, require_approval=True,
                                 expected_status=None):
    """Recompute candidate and reviewer-receipt identities from the actual external bytes."""
    review_dir = _external_directory(review_dir)
    candidate_raw = _read_external_regular(
        review_dir, candidate_name, total_budget=total_budget,
    )
    if hashlib.sha256(candidate_raw).hexdigest() != reviewed_candidate_sha256:
        raise ValueError("reviewed candidate SHA-256 does not match actual candidate bytes")
    receipt_raw = _read_external_regular(
        review_dir, receipt_name, total_budget=total_budget,
    )
    if hashlib.sha256(receipt_raw).hexdigest() != reviewer_receipt_sha256:
        raise ValueError("reviewer receipt SHA-256 does not match actual receipt bytes")
    try:
        receipt = json.loads(receipt_raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("reviewer receipt is invalid JSON") from exc
    fields = {"schema_version", "status", "reviewer_id", "reviewed_candidate_sha256", "reviewed_at"}
    allowed_statuses = {"approved"} if require_approval else {"approved", "rework", "rejected"}
    if (not isinstance(receipt, dict) or set(receipt) != fields
            or receipt.get("schema_version") != "1"
            or receipt.get("status") not in allowed_statuses
            or expected_status is not None and receipt.get("status") != expected_status):
        raise ValueError("reviewer receipt schema or approval status is invalid")
    if receipt_raw != json.dumps(receipt, ensure_ascii=False, separators=(",", ":"),
                                 allow_nan=False).encode("utf-8"):
        raise ValueError("reviewer receipt must use canonical JSON bytes")
    reviewer = receipt.get("reviewer_id")
    if not isinstance(reviewer, str) or not reviewer.strip() or reviewer == compiler_identity:
        raise ValueError("reviewer receipt identity must be independent of the compiler")
    if receipt.get("reviewed_candidate_sha256") != reviewed_candidate_sha256:
        raise ValueError("reviewer receipt candidate hash binding mismatch")
    reviewed_at = _timestamp(receipt.get("reviewed_at"), "receipt reviewed_at")
    return {"receipt": receipt, "reviewed_candidate_sha256": reviewed_candidate_sha256,
            "reviewer_receipt_sha256": reviewer_receipt_sha256,
            "candidate_raw": candidate_raw, "receipt_raw": receipt_raw,
            "reviewed_at_instant": reviewed_at}


def _review_source_ids(kind, target, claim_map, gap_map, source_map):
    record = claim_map[target] if kind == "claim" else gap_map[target]
    source_ids = record.get("source_ids", []) + record.get("searched_source_ids", []) if kind == "claim" else record.get("searched_official_source_ids", [])
    if kind == "gap" and record.get("searched_official_urls"):
        raise ValueError(f"{target}: post-review checks require source_id records; raw searched URLs must be migrated")
    for source_id in source_ids:
        source = source_map.get(source_id)
        if not source or not source.get("url"):
            raise ValueError(f"{target}: unresolved source URL")
    return set(source_ids)


def validate_external_review(package, review_dir, validator, *, require_approval=True,
                             expected_status=None):
    """Validate the promotion review contract without writing or integrating output."""
    review_dir = _external_directory(review_dir)
    expected_files = CURRENT_REVIEW_FILES if package.get("current_format") else REVIEW_FILES
    if {path.name for path in review_dir.iterdir()} != expected_files or any(not path.is_file() for path in review_dir.iterdir()):
        raise ValueError("external review package must contain the exact format-specific regular-file set")
    total_budget = [0]
    try:
        bundle_raw = _read_external_regular(
            review_dir, "review-bundle.json", total_budget=total_budget,
        )
        bundle = json.loads(bundle_raw)
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("invalid external review bundle") from exc
    bundle_fields = {"schema_version", "candidate_manifest_sha256", "candidate_artifacts",
                     "promotion_reviewer_id", "approved_at", "artifacts"}
    current_fields = bundle_fields | {"reviewed_candidate_path", "reviewed_candidate_sha256",
                                      "reviewer_receipt_path", "reviewer_receipt_sha256"}
    expected_fields = current_fields if package.get("current_format") else bundle_fields
    expected_version = "2" if package.get("current_format") else "1"
    if set(bundle) != expected_fields or bundle.get("schema_version") != expected_version:
        raise ValueError("external review bundle schema mismatch")
    canonical_bundle = json.dumps(bundle, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if bundle_raw != canonical_bundle:
        raise ValueError("external review bundle must use canonical JSON bytes")
    if (bundle.get("candidate_manifest_sha256") != package["manifest_sha256"]
            or bundle.get("candidate_artifacts") != package["manifest"]["artifacts"]):
        raise ValueError("external review candidate hash binding mismatch; old approval transfer is prohibited")
    reviewer = bundle.get("promotion_reviewer_id")
    if not isinstance(reviewer, str) or not reviewer.strip() or reviewer == package["manifest"]["researcher_id"]:
        raise ValueError("promotion reviewer must be identified and independent")
    approved_at = _timestamp(bundle.get("approved_at"), "approved_at")
    reviewed_bytes = None
    if package.get("current_format"):
        reviewed_bytes = verify_external_review_bytes(
            review_dir, bundle["reviewed_candidate_path"], bundle["reviewed_candidate_sha256"],
            bundle["reviewer_receipt_path"], bundle["reviewer_receipt_sha256"],
            package["manifest"]["researcher_id"], total_budget=total_budget,
            require_approval=require_approval, expected_status=expected_status,
        )
        if reviewed_bytes["receipt"]["reviewer_id"] != reviewer:
            raise ValueError("review receipt and promotion reviewer identities differ")
        if reviewed_bytes["reviewed_at_instant"] >= approved_at:
            raise ValueError("receipt review must precede promotion approval")
        candidate_payload = [
            {key: value for key, value in benefit.items() if key != "review"}
            for benefit in sorted(package["proposition_candidates"], key=lambda item: item["benefit_id"])
        ]
        expected_candidate_raw = validator._load_verifier().company_benefits_series.canonical_json_bytes(
            candidate_payload
        )
        if reviewed_bytes["candidate_raw"] != expected_candidate_raw:
            raise ValueError("actual reviewed candidate bytes differ from the candidate package")
    artifacts = bundle.get("artifacts")
    if not isinstance(artifacts, dict) or set(artifacts) != {"reviews.jsonl", "checks.jsonl"}:
        raise ValueError("external review bundle must hash exact review artifacts")
    review_artifact_raw = {
        name: _read_external_regular(review_dir, name, total_budget=total_budget)
        for name in artifacts
    }
    for name in artifacts:
        if not HASH.fullmatch(str(artifacts[name])) or artifacts[name] != validator.sha256(review_artifact_raw[name]):
            raise ValueError(f"external review artifact hash mismatch: {name}")

    reviews = validator.read_jsonl_bytes(review_artifact_raw["reviews.jsonl"], "reviews.jsonl")
    verifier = validator._load_verifier()
    checks = validator.read_jsonl_bytes(review_artifact_raw["checks.jsonl"], "checks.jsonl")
    claim_schema = verifier.load_schema("review.schema.json")
    outcome_schema = verifier.load_schema("outcome-review.schema.json")
    targets = [(kind, target) for kind, target, _ in package["targets"]]
    researchers = {(kind, target): researcher for kind, target, researcher in package["targets"]}
    actual_targets = []
    review_times = {}
    review_ids = set()
    errors = []
    for review in reviews:
        review_id = review.get("review_id")
        if not isinstance(review_id, str) or not review_id or review_id in review_ids:
            raise ValueError("duplicate or missing independent review_id")
        review_ids.add(review_id)
        has_claim, has_record = bool(review.get("claim_id")), bool(review.get("record_id"))
        if has_claim == has_record:
            raise ValueError("review must have exactly one claim or gap target; cross-target reviews are prohibited")
        kind, target = ("claim", review.get("claim_id")) if has_claim else ("gap", review.get("record_id"))
        actual_targets.append((kind, target))
        if (kind, target) not in researchers:
            raise ValueError(f"{review_id}: orphan independent review target")
        verifier.validate_structure(review, claim_schema if kind == "claim" else outcome_schema, review_id, errors)
        if (review.get("researcher_id") != researchers[(kind, target)]
                or (package.get("current_format") and review.get("reviewer_id") != reviewer)
                or review.get("reviewer_id") == review.get("researcher_id")):
            raise ValueError(f"{review_id}: review must be independently authored and bind the candidate researcher")
        for field in ("source_entailment_reviews", "conflict_side_entailments"):
            entailments = review.get(field, [])
            for entailment in entailments if isinstance(entailments, list) else []:
                if (not isinstance(entailment, dict)
                        or entailment.get("reviewer_id") != review.get("reviewer_id")
                        or entailment.get("reviewer_id") == researchers[(kind, target)]):
                    raise ValueError(
                        f"{review_id}: every nested entailment reviewer must be the independent package reviewer"
                    )
        if require_approval and (review.get("decision") != "approved"
                                 or review.get("quote_entailment_confirmed") is not True):
            raise ValueError(f"{review_id}: review must be approved with explicit entailment before promotion")
        reviewed = _timestamp(review.get("reviewed_at"), "reviewed_at")
        if reviewed >= approved_at:
            raise ValueError(f"{review_id}: review must precede promotion approval")
        review_times[(kind, target)] = reviewed
    if actual_targets != targets or len(actual_targets) != len(set(actual_targets)):
        raise ValueError("independent review coverage must be exact one-to-one in canonical order with no missing, duplicate, or orphan targets")
    if errors:
        raise ValueError("independent review schema validation failed:\n" + "\n".join(errors))
    decisions = [review.get("decision") for review in reviews]
    review_status = reviewed_bytes["receipt"]["status"] if reviewed_bytes else "approved"
    if review_status == "approved" and any(decision != "approved" for decision in decisions):
        raise ValueError("approved review receipt requires every disposition to be approved")
    if review_status == "rework" and ("changes_required" not in decisions or "rejected" in decisions):
        raise ValueError("rework review receipt requires an explicit changes_required disposition")
    if review_status == "rejected" and "rejected" not in decisions:
        raise ValueError("rejected review receipt requires an explicit rejected disposition")

    records = package["records"]
    source_map = {item["source_id"]: item for item in records["sources.jsonl"]}
    claim_map = {item["claim_id"]: item for item in records["claims.jsonl"]}
    gap_map = {item["audit_id"]: item for item in records["gaps.jsonl"]}
    expected_source_ids = set()
    latest_review = {}
    for kind, target in targets:
        for source_id in _review_source_ids(kind, target, claim_map, gap_map, source_map):
            expected_source_ids.add(source_id)
            latest_review[source_id] = max(latest_review.get(source_id, review_times[(kind, target)]),
                                           review_times[(kind, target)])
    check_source_ids = verifier.company_benefits_series.source_check_map(checks)
    if set(check_source_ids) != expected_source_ids:
        raise ValueError("post-review checks must exactly cover every candidate source_id; missing and orphan checks are prohibited")
    check_contract = verifier.company_benefits_series
    for check in checks:
        source_id = check.get("source_id")
        review_metadata.validate_review_metadata_observation(
            check.get("url"), check, review_status=review_status,
            label=f"{source_id}: source-check",
        )
        check_contract.validate_source_check(check, source_map[source_id],
                                             package["legacy_sources"].get(source_id))
        checked = _timestamp(check.get("checked_at"), "check checked_at")
        if checked <= latest_review[source_id]:
            raise ValueError(f"{source_id}: post-review check must follow every bound independent review")
        if checked >= approved_at:
            raise ValueError(f"{source_id}: post-review check must precede promotion approval")

    return {"bundle": bundle, "reviews": reviews, "checks": checks, "verifier": verifier,
            "reviewed_bytes": reviewed_bytes}


def promote(candidate_dir, review_dir, output_dir, research_root):
    validator = _load(Path(__file__).with_name("validate-company-benefits-series-candidate.py"), "candidate_contract")
    package = validator.validate_candidate(candidate_dir, research_root)
    review = validate_external_review(package, review_dir, validator)
    bundle, reviews, checks, verifier = (review[key] for key in ("bundle", "reviews", "checks", "verifier"))
    records = package["records"]
    reviewer = bundle["promotion_reviewer_id"]

    output_dir = Path(output_dir)
    check_map = {check["source_id"]: check for check in checks}
    promoted_claims = copy.deepcopy(records["claims.jsonl"])
    for claim in promoted_claims:
        if claim.get("status") == "unknown":
            continue
        bound_checks = [check_map[source_id] for source_id in claim.get("source_ids", [])]
        if not bound_checks:
            raise ValueError(f"{claim.get('claim_id')}: factual claim has no successful post-review source check")
        latest = max(bound_checks, key=lambda check: _timestamp(check["checked_at"], "check checked_at"))
        claim["prepublication_checked_at"] = latest["checked_at"]
    values = {
        "sources.jsonl": records["sources.jsonl"], "claims.jsonl": promoted_claims,
        "reviews.jsonl": reviews, "gaps.jsonl": records["gaps.jsonl"], "checks.jsonl": checks,
    }
    for name in validator.V2_FILES:
        values[name] = records[name]
    final_files = FINAL_FILES
    reviewed_bytes = review.get("reviewed_bytes")
    if package.get("current_format"):
        if reviewed_bytes is None:
            raise ValueError("current promotion is missing verified external review bytes")
        receipt = reviewed_bytes["receipt"]
        review_binding = {
            "reviewer_receipt_sha256": reviewed_bytes["reviewer_receipt_sha256"],
            "reviewed_candidate_sha256": reviewed_bytes["reviewed_candidate_sha256"],
            "reviewed_at": receipt["reviewed_at"],
        }
        verified_benefits = [
            {**candidate, "review": {"status": "independently_reviewed", **review_binding}}
            for candidate in package["proposition_candidates"]
        ]
        evidence = [*records["official-claims-v2.jsonl"], *records["reference-records.jsonl"],
                    *records["community-benefit-reports.jsonl"]]
        verifier.company_benefits_series.validate_verified_benefits(
            verified_benefits, evidence, review_binding if verified_benefits else None
        )
        values["verified-benefits.jsonl"] = verified_benefits
        values["company-category-outcomes.jsonl"] = package["cell_outcomes"]
        final_files = (*FINAL_FILES, "verified-benefits.jsonl", "company-category-outcomes.jsonl")
    with series.create_output_staging(output_dir, "benefits-promotion-") as staging:
        staged = staging.path
        final_hashes = {}
        for name in final_files:
            raw = verifier.company_benefits_series.jsonl_bytes(values[name])
            staging.write_bytes(name, raw)
            final_hashes[name] = validator.sha256(raw)
        manifest = {
            "schema_version": "2" if package.get("current_format") else "1", "batch_id": package["manifest"]["batch_id"],
            "company_list_sha256": package["manifest"]["company_list_sha256"],
            "effective_sequence_sha256": package["manifest"]["effective_sequence_sha256"],
            "replacement_events_sha256": package["manifest"]["replacement_events_sha256"],
            "status": "approved", "approved_at": bundle["approved_at"], "reviewer_id": reviewer,
            "artifacts": final_hashes,
            "review_audit": {"candidate_manifest_sha256": package["manifest_sha256"],
                             "candidate_manifest": package["manifest"],
                             "candidate_artifacts": package["manifest"]["artifacts"],
                             "review_bundle_sha256": validator.sha256(json.dumps(
                                 bundle, ensure_ascii=False, separators=(",", ":"), allow_nan=False
                             ).encode("utf-8")),
                             "review_bundle": bundle,
                             "review_artifacts": bundle["artifacts"]},
        }
        if package.get("current_format"):
            if reviewed_bytes is None:
                raise ValueError("current promotion is missing verified external review bytes")
            manifest["review_audit"].update(
                reviewed_candidate_sha256=reviewed_bytes["reviewed_candidate_sha256"],
                reviewer_receipt_sha256=reviewed_bytes["reviewer_receipt_sha256"],
                reviewer_receipt=reviewed_bytes["receipt"],
            )
        staging.write_bytes("batch.json", verifier.company_benefits_series.json_bytes(manifest))
        integrator = _load(Path(__file__).with_name("integrate-company-benefits-series-batch.py"), "candidate_promotion_integrator")
        if package.get("current_format"):
            approval = integrator.canonical_approval_row(
                manifest["batch_id"], staging.read_bytes("batch.json"),
                reviewed_bytes["reviewed_candidate_sha256"], reviewed_bytes["reviewer_receipt_sha256"],
            )
            staging.write_bytes(
                "series-batch-approval.jsonl",
                verifier.company_benefits_series.jsonl_bytes([approval])
            )
            inventory = staging.names()
            checksum_lines = [f"{validator.sha256(staging.read_bytes(name))}  {name}\n"
                              for name in inventory]
            staging.write_text("SHA256SUMS", "".join(checksum_lines))
        staging.validate_binding()
        integrator.load_package(staged, research_root)
        staging.validate_binding()
        series.publish_directory_atomically(
            staging, _atomic_exchange, _atomic_noreplace,
        )
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidate_dir", type=Path)
    parser.add_argument("review_dir", type=Path)
    parser.add_argument("output_dir", type=Path,
                        help="approved package directory; its full parent chain must pre-exist")
    parser.add_argument("--research-root", type=Path, default=Path("docs/research/company-benefits"))
    args = parser.parse_args(argv)
    manifest = promote(args.candidate_dir, args.review_dir, args.output_dir, args.research_root)
    print(f"promoted approved package {manifest['batch_id']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
