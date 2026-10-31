#!/usr/bin/env python3
"""Validate hash-bound, independently reviewed benefit taxonomy assignments."""

import argparse
import hashlib
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import NamedTuple

FIELDS = {
    "request_id", "request_sha256", "claim_id", "assignment",
    "taxonomy_version", "taxonomy_sha256", "bindings", "researcher_id",
    "reviewer_id", "reviewed_at", "decision",
}
REQUEST_FIELDS = {
    "request_id", "claim_id", "taxonomy_version", "taxonomy_sha256",
    "assignment", "bindings", "requested_by", "review_status", "request_sha256",
    "requested_at",
}
BINDING_FIELDS = {
    "record_byte_contract", "claim_record_sha256", "source_records",
    "factual_review_record", "prepublication_check_records",
}
SHA256_FIELDS = {"source_id", "record_sha256"}
UNCLASSIFIED_REASONS = {
    "no_unambiguous_taxonomy_match", "insufficient_claim_specific_evidence",
}
BYTE_CONTRACT = "exact_utf8_jsonl_record_excluding_lf_terminator"
REQUESTER = "deterministic-benefit-taxonomy-generator-v1"


class JsonlRecord(NamedTuple):
    value: dict
    sha256: str
    line_number: int


def canonical_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def claim_sha256(claim):
    return hashlib.sha256(canonical_bytes(claim)).hexdigest()


def request_sha256(request):
    payload = {key: value for key, value in request.items() if key != "request_sha256"}
    return hashlib.sha256(canonical_bytes(payload)).hexdigest()


def file_sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def parse_timestamp(value, label):
    try:
        timestamp = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if timestamp.tzinfo is None:
            raise ValueError
        return timestamp
    except (TypeError, ValueError):
        raise ValueError(f"{label} timestamp is invalid") from None


def read_jsonl_records(path):
    raw = Path(path).read_bytes()
    if b"\r" in raw:
        raise ValueError(f"{path}: JSONL must use LF line endings")
    records = []
    for line_number, line in enumerate(raw.splitlines(), 1):
        if not line.strip():
            continue
        value = json.loads(line.decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError(f"{path}:{line_number}: JSONL record must be an object")
        records.append(JsonlRecord(value, hashlib.sha256(line).hexdigest(), line_number))
    return records


def record_index(records, key, label, include_missing=False):
    result = {}
    for record in records:
        value = record.value.get(key)
        if value is None and include_missing:
            continue
        if not isinstance(value, str) or not value or value in result:
            raise ValueError(f"{label}: {key} must be present and unique")
        result[value] = record
    return result


def validate_sha_bindings(actual, expected, claim_id, label):
    if not isinstance(actual, list) or actual != expected:
        raise ValueError(f"{claim_id}: {label} hash bindings mismatch")
    if any(not isinstance(item, dict) or set(item) != SHA256_FIELDS for item in actual):
        raise ValueError(f"{claim_id}: {label} binding schema mismatch")


def validate_assignment_requests(requests, claims, sources, reviews, checks, taxonomy, taxonomy_sha256):
    """Validate exact-byte-bound pending requests and require complete active-claim coverage."""
    if taxonomy.get("artifact_kind") != "benefit_taxonomy":
        raise ValueError("taxonomy artifact kind is invalid")
    version = taxonomy.get("taxonomy_version")
    type_order = [item.get("id") for item in taxonomy.get("benefit_types", [])]
    if not type_order or len(type_order) != len(set(type_order)):
        raise ValueError("taxonomy benefit type IDs must be unique")
    known_types = set(type_order)
    order = {value: index for index, value in enumerate(type_order)}

    claim_map = record_index(claims, "claim_id", "active claims")
    source_map = record_index(sources, "source_id", "sources")
    check_map = record_index(checks, "source_id", "prepublication checks")
    review_map = record_index(reviews, "claim_id", "claim reviews", include_missing=True)
    result = {}
    request_ids = set()
    for request in requests:
        if (
            not isinstance(request, dict)
            or set(request) != REQUEST_FIELDS
        ):
            raise ValueError("taxonomy assignment request schema mismatch")
        claim_id = request.get("claim_id")
        if claim_id in result:
            raise ValueError(f"{claim_id}: duplicate taxonomy assignment request")
        claim_record = claim_map.get(claim_id)
        if claim_record is None:
            raise ValueError(f"{claim_id}: request targets no active claim")
        claim = claim_record.value
        if claim.get("publishable") is False or "record_type" in claim or "record" in claim:
            raise ValueError(f"{claim_id}: historical/nonpublishable claim request is prohibited")
        if request.get("request_id") != f"benefit-taxonomy-assignment::{claim_id}":
            raise ValueError(f"{claim_id}: request ID mismatch")
        if request["request_id"] in request_ids:
            raise ValueError(f"{claim_id}: duplicate request ID")
        request_ids.add(request["request_id"])
        if request.get("request_sha256") != request_sha256(request):
            raise ValueError(f"{claim_id}: request SHA-256 mismatch")
        if request.get("review_status") != "review_pending":
            raise ValueError(f"{claim_id}: request must remain review_pending")
        if request.get("requested_by") != REQUESTER:
            raise ValueError(f"{claim_id}: requester identity mismatch")
        requested = parse_timestamp(request["requested_at"], f"{claim_id}: request creation")
        if request.get("taxonomy_version") != version or request.get("taxonomy_sha256") != taxonomy_sha256:
            raise ValueError(f"{claim_id}: taxonomy binding mismatch")

        bindings = request.get("bindings")
        if not isinstance(bindings, dict) or set(bindings) != BINDING_FIELDS:
            raise ValueError(f"{claim_id}: binding schema mismatch")
        if bindings.get("record_byte_contract") != BYTE_CONTRACT:
            raise ValueError(f"{claim_id}: record byte contract mismatch")
        if bindings.get("claim_record_sha256") != claim_record.sha256:
            raise ValueError(f"{claim_id}: claim record hash mismatch")

        source_ids = claim.get("source_ids")
        if not isinstance(source_ids, list) or not source_ids or len(source_ids) != len(set(source_ids)):
            raise ValueError(f"{claim_id}: claim source IDs must be nonempty and unique")
        searched_source_ids = claim.get("searched_source_ids", [])
        if not isinstance(searched_source_ids, list):
            raise ValueError(f"{claim_id}: searched source IDs must be a list")
        bound_source_ids = source_ids + searched_source_ids
        if len(bound_source_ids) != len(set(bound_source_ids)):
            raise ValueError(f"{claim_id}: all bound source IDs must be unique")
        if any(source_id not in source_map or source_id not in check_map for source_id in bound_source_ids):
            raise ValueError(f"{claim_id}: missing source or check record")
        expected_sources = [
            {"source_id": source_id, "record_sha256": source_map[source_id].sha256}
            for source_id in bound_source_ids
        ]
        expected_checks = [
            {"source_id": source_id, "record_sha256": check_map[source_id].sha256}
            for source_id in bound_source_ids
        ]
        validate_sha_bindings(bindings.get("source_records"), expected_sources, claim_id, "source records")
        validate_sha_bindings(
            bindings.get("prepublication_check_records"), expected_checks, claim_id, "prepublication check records"
        )

        review_record = review_map.get(claim_id)
        if review_record is None:
            raise ValueError(f"{claim_id}: missing factual review record")
        review = review_record.value
        if review.get("decision") != "approved" or review.get("researcher_id") == review.get("reviewer_id"):
            raise ValueError(f"{claim_id}: factual review is not independently approved")
        expected_review = {"review_id": review.get("review_id"), "record_sha256": review_record.sha256}
        if bindings.get("factual_review_record") != expected_review:
            raise ValueError(f"{claim_id}: factual review record hash binding mismatch")
        bound_timestamps = [
            parse_timestamp(review.get("reviewed_at"), f"{claim_id}: factual review"),
            *(
                parse_timestamp(
                    check_map[source_id].value.get("checked_at"),
                    f"{claim_id}: prepublication check {source_id}",
                )
                for source_id in bound_source_ids
            ),
        ]
        if any(requested <= timestamp for timestamp in bound_timestamps):
            raise ValueError(
                f"{claim_id}: request creation must be strictly after every bound factual review/check timestamp"
            )

        assignment = request.get("assignment")
        if not isinstance(assignment, dict):
            raise ValueError(f"{claim_id}: assignment must be an object")
        state = assignment.get("state")
        type_ids = assignment.get("benefit_type_ids")
        if state == "classified":
            if set(assignment) != {"state", "benefit_type_ids"}:
                raise ValueError(f"{claim_id}: classified assignment schema mismatch")
            if not isinstance(type_ids, list) or not type_ids or len(type_ids) != len(set(type_ids)):
                raise ValueError(f"{claim_id}: classified benefit types must be nonempty and unique")
            if any(type_id not in known_types for type_id in type_ids):
                raise ValueError(f"{claim_id}: unknown benefit type ID")
            if type_ids != sorted(type_ids, key=order.__getitem__):
                raise ValueError(f"{claim_id}: benefit type IDs must follow taxonomy order")
        elif state == "unclassified":
            if set(assignment) != {"state", "benefit_type_ids", "reason_code"}:
                raise ValueError(f"{claim_id}: unclassified assignment schema mismatch")
            if type_ids != [] or assignment.get("reason_code") not in UNCLASSIFIED_REASONS:
                raise ValueError(f"{claim_id}: invalid unclassified assignment")
        else:
            raise ValueError(f"{claim_id}: invalid assignment state")
        result[claim_id] = request

    if set(result) != set(claim_map):
        missing = sorted(set(claim_map) - set(result))
        extra = sorted(set(result) - set(claim_map))
        raise ValueError(f"pending requests must exactly cover active claims; missing={missing}, extra={extra}")
    return result


def validate_assignments(assignments, requests, claims, sources, reviews, checks, taxonomy, taxonomy_sha256):
    """Validate approvals as exact, independent decisions on current requests."""
    request_map = validate_assignment_requests(
        requests, claims, sources, reviews, checks, taxonomy, taxonomy_sha256
    )
    review_map = record_index(reviews, "claim_id", "claim reviews", include_missing=True)
    check_map = record_index(checks, "source_id", "prepublication checks")
    requests_by_id = {request["request_id"]: request for request in request_map.values()}
    category_order = [item.get("id") for item in taxonomy.get("categories", [])]
    type_categories = {
        item.get("id"): item.get("category_id") for item in taxonomy.get("benefit_types", [])
    }
    result = {}
    used_request_ids = set()
    for assignment in assignments:
        if not isinstance(assignment, dict) or set(assignment) != FIELDS:
            raise ValueError("taxonomy assignment schema mismatch")
        request_id = assignment.get("request_id")
        request = requests_by_id.get(request_id)
        if request is None:
            raise ValueError(f"{request_id}: orphan taxonomy assignment request")
        if request_id in used_request_ids:
            raise ValueError(f"{request_id}: duplicate approved request")
        used_request_ids.add(request_id)

        claim_id = assignment.get("claim_id")
        if claim_id in result:
            raise ValueError(f"{claim_id}: duplicate taxonomy assignment")
        if claim_id != request["claim_id"]:
            raise ValueError(f"{claim_id}: approved claim does not match request")
        if assignment.get("request_sha256") != request["request_sha256"]:
            raise ValueError(f"{claim_id}: request SHA-256 mismatch")
        if (
            assignment.get("taxonomy_version") != request["taxonomy_version"]
            or assignment.get("taxonomy_sha256") != request["taxonomy_sha256"]
        ):
            raise ValueError(f"{claim_id}: taxonomy binding mismatch")

        approved_bindings = assignment.get("bindings")
        if not isinstance(approved_bindings, dict) or set(approved_bindings) != BINDING_FIELDS:
            raise ValueError(f"{claim_id}: binding schema mismatch")
        requested_bindings = request["bindings"]
        if approved_bindings.get("claim_record_sha256") != requested_bindings["claim_record_sha256"]:
            raise ValueError(f"{claim_id}: claim record hash binding mismatch")
        if approved_bindings.get("source_records") != requested_bindings["source_records"]:
            raise ValueError(f"{claim_id}: source records hash bindings mismatch")
        if approved_bindings.get("factual_review_record") != requested_bindings["factual_review_record"]:
            raise ValueError(f"{claim_id}: factual review record hash binding mismatch")
        if approved_bindings.get("prepublication_check_records") != requested_bindings["prepublication_check_records"]:
            raise ValueError(f"{claim_id}: prepublication check records hash bindings mismatch")
        if approved_bindings.get("record_byte_contract") != requested_bindings["record_byte_contract"]:
            raise ValueError(f"{claim_id}: record byte contract mismatch")

        producer = assignment.get("researcher_id")
        reviewer = assignment.get("reviewer_id")
        if producer != request["requested_by"]:
            raise ValueError(f"{claim_id}: request producer identity mismatch")
        if (
            not isinstance(reviewer, str) or not reviewer.strip()
            or reviewer == request["requested_by"]
        ):
            raise ValueError(f"{claim_id}: taxonomy assignment requires independent review")
        if assignment.get("decision") != "approved":
            raise ValueError(f"{claim_id}: taxonomy assignment is not approved")
        reviewed = parse_timestamp(assignment.get("reviewed_at"), f"{claim_id}: taxonomy review")
        requested = parse_timestamp(request["requested_at"], f"{claim_id}: request creation")
        if reviewed <= requested:
            raise ValueError(f"{claim_id}: taxonomy review must be strictly after request creation")
        factual_review = review_map[claim_id].value
        bound_timestamps = [
            parse_timestamp(factual_review.get("reviewed_at"), f"{claim_id}: factual review"),
            *(
                parse_timestamp(
                    check_map[item["source_id"]].value.get("checked_at"),
                    f"{claim_id}: prepublication check {item['source_id']}",
                )
                for item in request["bindings"]["prepublication_check_records"]
            ),
        ]
        if any(reviewed <= timestamp for timestamp in bound_timestamps):
            raise ValueError(
                f"{claim_id}: taxonomy review must be strictly after every bound factual review/check timestamp"
            )

        reviewed_decision = request["assignment"]
        outcome = assignment.get("assignment")
        if reviewed_decision["state"] == "classified":
            expected_types = reviewed_decision["benefit_type_ids"]
            expected_categories = [
                category_id for category_id in category_order
                if category_id in {type_categories[type_id] for type_id in expected_types}
            ]
            expected_outcome = {
                "state": "assigned",
                "category_ids": expected_categories,
                "benefit_type_ids": expected_types,
            }
            if outcome != expected_outcome:
                raise ValueError(f"{claim_id}: approved outcome differs from reviewed decision")
        else:
            if not isinstance(outcome, dict) or set(outcome) != {"state", "reason"}:
                raise ValueError(f"{claim_id}: unclassified outcome schema mismatch")
            if outcome.get("state") != "unclassified" or outcome.get("reason") != reviewed_decision["reason_code"]:
                raise ValueError(f"{claim_id}: unclassified outcome must equal reviewed reason code")
        result[claim_id] = assignment
    if used_request_ids != set(requests_by_id):
        missing = sorted(set(requests_by_id) - used_request_ids)
        extra = sorted(used_request_ids - set(requests_by_id))
        raise ValueError(
            f"approved assignments must exactly cover pending requests; missing={missing}, extra={extra}"
        )
    return result


def read_jsonl(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("assignments")
    parser.add_argument("--claims", required=True)
    parser.add_argument("--taxonomy", required=True)
    parser.add_argument("--pending-requests", action="store_true")
    parser.add_argument("--requests")
    parser.add_argument("--sources")
    parser.add_argument("--reviews")
    parser.add_argument("--checks")
    args = parser.parse_args(argv)
    try:
        taxonomy = json.loads(Path(args.taxonomy).read_text(encoding="utf-8"))
        if args.pending_requests:
            if not args.sources or not args.reviews or not args.checks:
                raise ValueError("pending request validation requires --sources, --reviews, and --checks")
            validated = validate_assignment_requests(
                read_jsonl(args.assignments),
                read_jsonl_records(args.claims),
                read_jsonl_records(args.sources),
                read_jsonl_records(args.reviews),
                read_jsonl_records(args.checks),
                taxonomy,
                file_sha256(args.taxonomy),
            )
            label = "review-pending taxonomy assignment requests"
        else:
            if not args.requests or not args.sources or not args.reviews or not args.checks:
                raise ValueError("approved assignment validation requires --requests, --sources, --reviews, and --checks")
            validated = validate_assignments(
                read_jsonl(args.assignments),
                read_jsonl(args.requests),
                read_jsonl_records(args.claims),
                read_jsonl_records(args.sources),
                read_jsonl_records(args.reviews),
                read_jsonl_records(args.checks),
                taxonomy,
                file_sha256(args.taxonomy),
            )
            label = "approved taxonomy assignments"
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        print(f"taxonomy assignment validation failed: {exc}", file=sys.stderr)
        return 1
    print(f"Validated {len(validated)} {label}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
