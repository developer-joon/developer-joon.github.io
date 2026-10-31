#!/usr/bin/env python3
"""Validate hash-bound, independently reviewed benefit taxonomy assignments."""

import argparse
import hashlib
import json
import sys
from datetime import datetime
from pathlib import Path

FIELDS = {
    "claim_id", "benefit_type_ids", "taxonomy_version", "claim_content_sha256",
    "researcher_id", "reviewer_id", "reviewed_at", "decision",
}


def canonical_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def claim_sha256(claim):
    return hashlib.sha256(canonical_bytes(claim)).hexdigest()


def validate_assignments(assignments, claims, taxonomy):
    """Return assignments by claim ID, or fail before any claim can enter UI data."""
    if taxonomy.get("artifact_kind") != "benefit_taxonomy":
        raise ValueError("taxonomy artifact kind is invalid")
    version = taxonomy.get("taxonomy_version")
    type_order = [item.get("id") for item in taxonomy.get("benefit_types", [])]
    if not type_order or len(type_order) != len(set(type_order)):
        raise ValueError("taxonomy benefit type IDs must be unique")
    known_types = set(type_order)
    order = {value: index for index, value in enumerate(type_order)}
    result = {}
    for assignment in assignments:
        if not isinstance(assignment, dict) or set(assignment) != FIELDS:
            raise ValueError("taxonomy assignment schema mismatch")
        claim_id = assignment.get("claim_id")
        if claim_id in result:
            raise ValueError(f"{claim_id}: duplicate taxonomy assignment")
        claim = claims.get(claim_id)
        if not isinstance(claim, dict):
            raise ValueError(f"{claim_id}: taxonomy assignment targets no active claim")
        if claim.get("publishable") is False or "record_type" in claim or "record" in claim:
            raise ValueError(f"{claim_id}: historical/nonpublishable claim assignment is prohibited")
        if claim.get("status") == "unknown":
            raise ValueError(f"{claim_id}: unknown result cannot receive an evidenced taxonomy assignment")
        if assignment.get("decision") != "approved":
            raise ValueError(f"{claim_id}: taxonomy assignment is not approved")
        researcher = assignment.get("researcher_id")
        reviewer = assignment.get("reviewer_id")
        if not isinstance(researcher, str) or not researcher.strip() or not isinstance(reviewer, str) or not reviewer.strip() or researcher == reviewer:
            raise ValueError(f"{claim_id}: taxonomy assignment requires independent review")
        try:
            reviewed = datetime.fromisoformat(str(assignment.get("reviewed_at")).replace("Z", "+00:00"))
            researched = datetime.fromisoformat(str(claim.get("researched_at")).replace("Z", "+00:00"))
            if reviewed.tzinfo is None or researched.tzinfo is None or reviewed <= researched:
                raise ValueError
        except (TypeError, ValueError):
            raise ValueError(f"{claim_id}: taxonomy review must follow the bound claim research") from None
        if assignment.get("taxonomy_version") != version:
            raise ValueError(f"{claim_id}: taxonomy version mismatch")
        if assignment.get("claim_content_sha256") != claim_sha256(claim):
            raise ValueError(f"{claim_id}: claim content hash mismatch")
        type_ids = assignment.get("benefit_type_ids")
        if not isinstance(type_ids, list) or not type_ids or len(type_ids) != len(set(type_ids)):
            raise ValueError(f"{claim_id}: benefit type IDs must be nonempty and unique")
        if any(value not in known_types for value in type_ids):
            raise ValueError(f"{claim_id}: unknown benefit type ID")
        if type_ids != sorted(type_ids, key=order.__getitem__):
            raise ValueError(f"{claim_id}: benefit type IDs must follow taxonomy order")
        result[claim_id] = assignment
    return result


def read_jsonl(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("assignments")
    parser.add_argument("--claims", required=True)
    parser.add_argument("--taxonomy", required=True)
    args = parser.parse_args(argv)
    try:
        claims = read_jsonl(args.claims)
        claim_map = {item.get("claim_id"): item for item in claims}
        if len(claim_map) != len(claims):
            raise ValueError("active claim IDs must be unique")
        taxonomy = json.loads(Path(args.taxonomy).read_text(encoding="utf-8"))
        validated = validate_assignments(read_jsonl(args.assignments), claim_map, taxonomy)
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        print(f"taxonomy assignment validation failed: {exc}", file=sys.stderr)
        return 1
    print(f"Validated {len(validated)} approved taxonomy assignments.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
