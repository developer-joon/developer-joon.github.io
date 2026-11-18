#!/usr/bin/env python3
"""Compile explicit independent-review decisions for a protocol-2 candidate."""

import argparse
import ctypes
import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import company_benefits_series as series
import review_metadata_validation as review_metadata

INPUT_FILES = {"decision.json", "dispositions.jsonl", "checks.jsonl"}
OUTPUT_FILES = {"review-bundle.json", "reviews.jsonl", "checks.jsonl",
                "reviewed-candidate.json", "reviewer-receipt.json"}
MAX_INPUT_FILE_BYTES = 16 * 1024 * 1024
MAX_INPUT_TOTAL_BYTES = 32 * 1024 * 1024
STATUSES = {"approved", "rework", "rejected"}


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _renameat2(left_fd, left_name, right_fd, right_name, flags, message):
    libc = ctypes.CDLL(None, use_errno=True)
    renameat2 = getattr(libc, "renameat2", None)
    if renameat2 is None:
        raise RuntimeError(message)
    renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    renameat2.restype = ctypes.c_int
    if renameat2(left_fd, os.fsencode(left_name), right_fd, os.fsencode(right_name), flags) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), f"{left_name} -> {right_name}")


def _atomic_noreplace(left_fd, left_name, right_fd, right_name):
    _renameat2(left_fd, left_name, right_fd, right_name, 1,
               "atomic review publication requires Linux renameat2")


def _reject_overwrite(*_args):
    raise ValueError("independent-review output already exists; overwrite is prohibited")


def _canonical_json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"),
                      allow_nan=False).encode("utf-8")


def _sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def validate_with_promoter(candidate_package, review_dir, validator, promoter, status):
    """Use the promotion ingress validator as the single review authority."""
    return promoter.validate_external_review(
        candidate_package, review_dir, validator,
        require_approval=status == "approved", expected_status=status,
    )


def compile_review(candidate_dir, input_dir, output_dir, research_root, *, lint_only=False):
    scripts = Path(__file__).resolve().parent
    validator = _load(scripts / "validate-company-benefits-series-candidate.py",
                      "independent_review_candidate_contract")
    promoter = _load(scripts / "promote-company-benefits-series-candidate.py",
                     "independent_review_promotion_contract")
    package = validator.validate_candidate(candidate_dir, research_root)
    if not package.get("current_format"):
        raise ValueError("independent-review compiler requires an immutable protocol-2 candidate")

    raw = series.read_bounded_regular_files(
        input_dir, INPUT_FILES, MAX_INPUT_FILE_BYTES, MAX_INPUT_TOTAL_BYTES,
        "independent-review compiler input",
    )
    try:
        decision = json.loads(raw["decision.json"])
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("independent-review decision is invalid JSON") from exc
    decision_fields = {"schema_version", "candidate_manifest_sha256", "reviewer_id",
                       "status", "reviewed_at", "approved_at"}
    if (not isinstance(decision, dict) or set(decision) != decision_fields
            or decision.get("schema_version") != "1"
            or raw["decision.json"] != _canonical_json(decision)):
        raise ValueError("independent-review decision schema or canonical bytes are invalid")
    status = decision.get("status")
    reviewer = decision.get("reviewer_id")
    researcher = package["manifest"]["researcher_id"]
    if status not in STATUSES:
        raise ValueError("independent-review status must be approved, rework, or rejected")
    if not isinstance(reviewer, str) or not reviewer.strip() or reviewer == researcher:
        raise ValueError("reviewer identity must be explicit and independent of the researcher")
    if decision.get("candidate_manifest_sha256") != package["manifest_sha256"]:
        raise ValueError("review input candidate manifest hash does not match immutable candidate bytes")

    reviews = validator.read_jsonl_bytes(raw["dispositions.jsonl"], "dispositions.jsonl")
    checks = validator.read_jsonl_bytes(raw["checks.jsonl"], "checks.jsonl")
    contract = validator._load_verifier().company_benefits_series
    if not reviews:
        raise ValueError("explicit reviewer dispositions must not be empty")
    if any(review.get("reviewer_id") != reviewer for review in reviews):
        raise ValueError("every disposition must carry the explicit package reviewer identity")
    decisions = [review.get("decision") for review in reviews]
    review_instants = [contract.parse_canonical_rfc3339(
        review.get("reviewed_at"), "disposition reviewed_at"
    ) for review in reviews]
    receipt_instant = contract.parse_canonical_rfc3339(
        decision.get("reviewed_at"), "decision reviewed_at"
    )
    if receipt_instant != max(review_instants):
        raise ValueError("decision reviewed_at must equal the latest explicit disposition time")
    approval_instant = contract.parse_canonical_rfc3339(
        decision.get("approved_at"), "decision approved_at"
    )
    if receipt_instant >= approval_instant:
        raise ValueError("latest review must strictly precede the approval boundary")
    if status == "approved" and any(value != "approved" for value in decisions):
        raise ValueError("approved status requires every explicit disposition to be approved")
    if status == "rework" and ("changes_required" not in decisions or "rejected" in decisions):
        raise ValueError("rework status requires an explicit changes_required disposition")
    if status == "rejected" and "rejected" not in decisions:
        raise ValueError("rejected status requires an explicit rejected disposition")
    for check in checks:
        review_metadata.validate_review_metadata_observation(
            check.get("url"), check, review_status=status, label="source-check",
        )
        checked = contract.parse_canonical_rfc3339(check.get("checked_at"),
                                                   "source-check checked_at")
        if checked <= max(review_instants) or checked >= approval_instant:
            raise ValueError("every source check must strictly follow all reviews and precede approval")

    candidate_payload = [
        {key: value for key, value in benefit.items() if key != "review"}
        for benefit in sorted(package["proposition_candidates"], key=lambda item: item["benefit_id"])
    ]
    if not candidate_payload:
        raise ValueError("protocol-2 reviewed candidate must contain at least one proposition")
    candidate_raw = contract.canonical_json_bytes(candidate_payload)
    candidate_sha = _sha256(candidate_raw)
    receipt = {
        "schema_version": "1", "status": status, "reviewer_id": reviewer,
        "reviewed_candidate_sha256": candidate_sha, "reviewed_at": decision["reviewed_at"],
    }
    receipt_raw = _canonical_json(receipt)
    reviews_raw = contract.jsonl_bytes(reviews)
    checks_raw = contract.jsonl_bytes(checks)
    bundle = {
        "schema_version": "2",
        "candidate_manifest_sha256": package["manifest_sha256"],
        "candidate_artifacts": package["manifest"]["artifacts"],
        "promotion_reviewer_id": reviewer,
        "approved_at": decision["approved_at"],
        "artifacts": {"reviews.jsonl": _sha256(reviews_raw),
                      "checks.jsonl": _sha256(checks_raw)},
        "reviewed_candidate_path": "reviewed-candidate.json",
        "reviewed_candidate_sha256": candidate_sha,
        "reviewer_receipt_path": "reviewer-receipt.json",
        "reviewer_receipt_sha256": _sha256(receipt_raw),
    }
    output_dir = Path(output_dir)
    with series.create_output_staging(output_dir, "independent-review-compile-") as staging:
        staging.write_bytes("review-bundle.json", _canonical_json(bundle))
        staging.write_bytes("reviews.jsonl", reviews_raw)
        staging.write_bytes("checks.jsonl", checks_raw)
        staging.write_bytes("reviewed-candidate.json", candidate_raw)
        staging.write_bytes("reviewer-receipt.json", receipt_raw)
        if set(staging.names()) != OUTPUT_FILES:
            raise ValueError("independent-review compiler did not create the exact canonical file set")
        staging.validate_binding()
        validate_with_promoter(package, staging.path, validator, promoter, status)
        staging.validate_binding()
        if not lint_only:
            series.publish_directory_atomically(staging, _reject_overwrite, _atomic_noreplace)
    return {"status": status, "reviewer_id": reviewer,
            "candidate_manifest_sha256": package["manifest_sha256"]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidate_dir", type=Path)
    parser.add_argument("input_dir", type=Path,
                        help="directory containing decision.json, dispositions.jsonl, and checks.jsonl")
    parser.add_argument("output_dir", type=Path,
                        help="new external review directory under a pre-existing private parent")
    parser.add_argument("--research-root", type=Path,
                        default=Path("docs/research/company-benefits"))
    parser.add_argument("--lint-only", action="store_true",
                        help="validate the complete review without publishing output")
    args = parser.parse_args(argv)
    result = compile_review(args.candidate_dir, args.input_dir, args.output_dir,
                            args.research_root, lint_only=args.lint_only)
    print(f"validated independent review: {result['status']}" if args.lint_only
          else f"compiled independent review: {result['status']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
