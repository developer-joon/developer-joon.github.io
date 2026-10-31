#!/usr/bin/env python3
"""Generate deterministic, review-pending benefit taxonomy assignment requests."""

import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

GENERATOR_ID = "deterministic-benefit-taxonomy-generator-v1"
UNCLASSIFIED_REASON = "no_unambiguous_taxonomy_match"

# Exact phrases are matched only in the claim's bound proposition/quote bytes. They
# intentionally do not use company names, claim IDs, or taxonomy-gap inference.
EXACT_TEXT_MAPPINGS = (
    ("사내 동호회 운영", "recreation-clubs-retreat"),
    ("경조사비 지급", "family-events"),
    ("특별휴가 부여", "family-event-leave"),
    ("생일축하용 백화점 상품권", "welfare-points-gifts"),
    ("LPG연료비 지원", "transport-allowance"),
    ("원거리 거주자들을 위한 기숙사제공", "dormitory-company-housing"),
    ("건강검진 실시", "health-screening"),
    ("단체 생명보험", "life-insurance"),
)


def compact_json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def request_sha256(request_payload):
    """Hash the canonical request payload before the digest field is added."""
    return hashlib.sha256(compact_json(request_payload).encode("utf-8")).hexdigest()


def parse_timestamp(value, label):
    try:
        timestamp = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if timestamp.tzinfo is None:
            raise ValueError
        return timestamp
    except (TypeError, ValueError):
        raise ValueError(f"{label} timestamp is invalid") from None


def record_lines(path):
    raw = Path(path).read_bytes()
    if b"\r" in raw:
        raise ValueError(f"{path}: JSONL must use LF line endings")
    result = []
    for line_number, line in enumerate(raw.splitlines(), 1):
        if not line.strip():
            continue
        value = json.loads(line.decode("utf-8"))
        result.append((value, hashlib.sha256(line).hexdigest(), line_number))
    return result


def unique_index(records, key, label):
    result = {}
    for record in records:
        value = record[0].get(key)
        if not isinstance(value, str) or not value or value in result:
            raise ValueError(f"{label}: {key} must be present and unique")
        result[value] = record
    return result


def classify_claim(claim, taxonomy):
    type_order = {item["id"]: index for index, item in enumerate(taxonomy["benefit_types"])}
    known_types = set(type_order)
    dol_mappings = {item["code"]: item for item in taxonomy.get("dol_form_5500_mappings", [])}
    evidence = claim.get("source_evidence", [])
    if not isinstance(evidence, list) or not evidence:
        raise ValueError(f"{claim.get('claim_id')}: source_evidence is required")

    assigned = set()
    row_codes = set()
    definition_codes = set()
    for item in evidence:
        proposition = item.get("proposition", "")
        role = item.get("role", "")
        codes = set(re.findall(r"\bcode ([0-9][A-Z])\b", proposition, flags=re.IGNORECASE))
        codes = {code.upper() for code in codes}
        if role in {"exact_dol_named_plan_row", "plan_feature_row"}:
            row_codes.update(codes)
        if role in {"exact_dol_code_definition", "code_definition"}:
            for code in codes:
                mapping = dol_mappings.get(code)
                if mapping and mapping.get("label_en") in proposition:
                    definition_codes.add(code)

    exact_dol_codes = row_codes & definition_codes
    if row_codes or definition_codes:
        if len(exact_dol_codes) != 1 or row_codes != exact_dol_codes or definition_codes != exact_dol_codes:
            raise ValueError(f"{claim.get('claim_id')}: DOL evidence does not establish one exact mapped code")
        code = next(iter(exact_dol_codes))
        mapping = dol_mappings.get(code)
        if mapping is None:
            return []
        assigned.add(mapping["benefit_type_id"])
    else:
        bound_text = "\n".join(
            str(item.get(field, ""))
            for item in evidence
            for field in ("proposition", "supporting_quote")
        )
        for phrase, type_id in EXACT_TEXT_MAPPINGS:
            if phrase in bound_text:
                assigned.add(type_id)

    unknown = assigned - known_types
    if unknown:
        raise ValueError(f"{claim.get('claim_id')}: generator references unknown taxonomy types {sorted(unknown)}")
    return sorted(assigned, key=type_order.__getitem__)


def generate(research_root, requested_at):
    root = Path(research_root)
    requested = parse_timestamp(requested_at, "request creation")
    taxonomy_path = root / "benefit-taxonomy-v1.json"
    taxonomy_bytes = taxonomy_path.read_bytes()
    taxonomy = json.loads(taxonomy_bytes.decode("utf-8"))
    taxonomy_sha256 = hashlib.sha256(taxonomy_bytes).hexdigest()
    if taxonomy.get("artifact_kind") != "benefit_taxonomy":
        raise ValueError("taxonomy artifact kind is invalid")

    claims = record_lines(root / "benefit-claims.jsonl")
    sources = unique_index(record_lines(root / "source-registry.jsonl"), "source_id", "sources")
    checks = unique_index(record_lines(root / "series-prepublication-checks.jsonl"), "source_id", "checks")
    review_records = record_lines(root / "reviews.jsonl")
    claim_reviews = {}
    for record in review_records:
        claim_id = record[0].get("claim_id")
        if claim_id is None:
            continue
        if claim_id in claim_reviews:
            raise ValueError(f"{claim_id}: duplicate claim review")
        claim_reviews[claim_id] = record

    claim_ids = [record[0].get("claim_id") for record in claims]
    if any(not isinstance(value, str) or not value for value in claim_ids) or len(claim_ids) != len(set(claim_ids)):
        raise ValueError("active claim IDs must be present and unique")

    requests = []
    for claim, claim_digest, _ in sorted(claims, key=lambda item: item[0]["claim_id"]):
        claim_id = claim["claim_id"]
        source_ids = claim.get("source_ids")
        if not isinstance(source_ids, list) or not source_ids or len(source_ids) != len(set(source_ids)):
            raise ValueError(f"{claim_id}: source IDs must be nonempty and unique")
        searched_source_ids = claim.get("searched_source_ids", [])
        if not isinstance(searched_source_ids, list):
            raise ValueError(f"{claim_id}: searched source IDs must be a list")
        bound_source_ids = source_ids + searched_source_ids
        if len(bound_source_ids) != len(set(bound_source_ids)):
            raise ValueError(f"{claim_id}: all bound source IDs must be unique")
        missing_sources = [source_id for source_id in bound_source_ids if source_id not in sources]
        missing_checks = [source_id for source_id in bound_source_ids if source_id not in checks]
        if missing_sources or missing_checks:
            raise ValueError(f"{claim_id}: missing bound source/check records")
        review = claim_reviews.get(claim_id)
        if review is None:
            raise ValueError(f"{claim_id}: missing factual claim review")
        bound_timestamps = [
            parse_timestamp(review[0].get("reviewed_at"), f"{claim_id}: factual review"),
            *(
                parse_timestamp(checks[source_id][0].get("checked_at"), f"{claim_id}: prepublication check {source_id}")
                for source_id in bound_source_ids
            ),
        ]
        if any(requested <= timestamp for timestamp in bound_timestamps):
            raise ValueError(
                f"{claim_id}: request creation must be strictly after every bound factual review/check timestamp"
            )

        type_ids = classify_claim(claim, taxonomy)
        assignment = (
            {"state": "classified", "benefit_type_ids": type_ids}
            if type_ids
            else {
                "state": "unclassified",
                "benefit_type_ids": [],
                "reason_code": UNCLASSIFIED_REASON,
            }
        )
        request = {
            "request_id": f"benefit-taxonomy-assignment::{claim_id}",
            "claim_id": claim_id,
            "taxonomy_version": taxonomy["taxonomy_version"],
            "taxonomy_sha256": taxonomy_sha256,
            "assignment": assignment,
            "bindings": {
                "record_byte_contract": "exact_utf8_jsonl_record_excluding_lf_terminator",
                "claim_record_sha256": claim_digest,
                "source_records": [
                    {"source_id": source_id, "record_sha256": sources[source_id][1]}
                    for source_id in bound_source_ids
                ],
                "factual_review_record": {
                    "review_id": review[0]["review_id"],
                    "record_sha256": review[1],
                },
                "prepublication_check_records": [
                    {"source_id": source_id, "record_sha256": checks[source_id][1]}
                    for source_id in bound_source_ids
                ],
            },
            "requested_by": GENERATOR_ID,
            "requested_at": requested_at,
            "review_status": "review_pending",
        }
        request["request_sha256"] = request_sha256(request)
        requests.append(request)

    type_map = {item["id"]: item for item in taxonomy["benefit_types"]}
    category_counts = Counter()
    type_counts = Counter()
    reason_counts = Counter()
    for request in requests:
        assignment = request["assignment"]
        if assignment["state"] == "unclassified":
            reason_counts[assignment["reason_code"]] += 1
            continue
        type_ids = assignment["benefit_type_ids"]
        type_counts.update(type_ids)
        category_counts.update({type_map[type_id]["category_id"] for type_id in type_ids})

    category_order = [item["id"] for item in taxonomy["categories"]]
    type_order = [item["id"] for item in taxonomy["benefit_types"]]
    audit = {
        "artifact_kind": "benefit_taxonomy_assignment_audit",
        "taxonomy_version": taxonomy["taxonomy_version"],
        "taxonomy_sha256": taxonomy_sha256,
        "review_status": "review_pending",
        "count_semantics": {
            "category": "distinct classified claims assigned to at least one type in the category",
            "type": "distinct classified claims assigned to the type",
            "unclassified": "active claims with no unambiguous matching taxonomy type",
        },
        "total_active_claims": len(requests),
        "classified_claims": sum(row["assignment"]["state"] == "classified" for row in requests),
        "unclassified_claims": sum(row["assignment"]["state"] == "unclassified" for row in requests),
        "counts_by_category": {key: category_counts[key] for key in category_order},
        "counts_by_type": {key: type_counts[key] for key in type_order},
        "unclassified_by_reason": dict(sorted(reason_counts.items())),
    }
    return requests, audit


def write_jsonl(path, rows):
    Path(path).write_text("".join(compact_json(row) + "\n" for row in rows), encoding="utf-8", newline="\n")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("research_root")
    parser.add_argument("--output", required=True)
    parser.add_argument("--audit-summary", required=True, help="Path outside the repository for the audit summary")
    parser.add_argument("--requested-at", required=True, help="Explicit timezone-aware request creation timestamp")
    args = parser.parse_args(argv)
    try:
        requests, audit = generate(args.research_root, args.requested_at)
        write_jsonl(args.output, requests)
        Path(args.audit_summary).write_text(compact_json(audit) + "\n", encoding="utf-8", newline="\n")
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        print(f"pending taxonomy assignment generation failed: {exc}", file=sys.stderr)
        return 1
    print(
        f"Generated {len(requests)} review-pending requests: "
        f"{audit['classified_claims']} classified, {audit['unclassified_claims']} unclassified."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
