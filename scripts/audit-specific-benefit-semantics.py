#!/usr/bin/env python3
"""Emit deterministic audit signals for specific-benefit evidence records.

These bounded heuristics block automatic promotion. They are audit signals, not
semantic proof, and an unflagged record is not certified as a verified benefit.
"""

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path


RECORD_KINDS = ("references", "community_reports")
ID_FIELDS = {
    "references": "reference_id",
    "community_reports": "community_report_id",
}
META_PHRASES = ("public source reports", "fetched public page contains")
SCOPED_STATUSES = {"exact_entity", "bounded_entity"}
RECORD_KEY_LIMIT = 100


class AuditInputError(ValueError):
    """Raised when an input projection cannot be safely audited."""


def _validate_object_list(payload, relative_path, field, required=False):
    if field not in payload:
        if required:
            raise AuditInputError(f"{relative_path}: missing required field '{field}'")
        return []
    values = payload[field]
    if not isinstance(values, list):
        raise AuditInputError(f"{relative_path}: field '{field}' must be an array")
    for index, value in enumerate(values):
        if not isinstance(value, dict):
            raise AuditInputError(f"{relative_path}: field '{field}[{index}]' must be an object")
    return values


def _normalized_statement(value):
    return " ".join(str(value or "").split()).casefold()


def _is_page_or_body_dump(statement):
    text = str(statement or "")
    nonempty_lines = sum(1 for line in text.splitlines() if line.strip())
    return len(text) >= 1200 or nonempty_lines >= 20


def _is_unscoped(kind, record):
    if kind == "references":
        scope = record.get("scope")
        status = scope.get("status") if isinstance(scope, dict) else None
    else:
        status = record.get("scope_status")
    return str(status or "").casefold() not in SCOPED_STATUSES


def _source_url(kind, record):
    if kind == "references":
        return str(record.get("source_locator") or "")
    snapshot = record.get("frozen_snapshot")
    return str(snapshot.get("locator") or "") if isinstance(snapshot, dict) else ""


def _signal(record_keys):
    keys = sorted(set(record_keys))
    total_count = len(keys)
    return {
        "count": total_count,
        "total_count": total_count,
        "record_keys": keys[:RECORD_KEY_LIMIT],
        "truncated": total_count > RECORD_KEY_LIMIT,
    }


def audit_projection(projection_directory):
    projection = Path(projection_directory)
    if not projection.exists():
        raise AuditInputError("input path does not exist")
    if not projection.is_dir():
        raise AuditInputError("input path must be a directory")
    companies_directory = projection / "companies" if (projection / "companies").is_dir() else projection
    shard_paths = sorted(
        companies_directory.rglob("*.json"),
        key=lambda path: path.relative_to(companies_directory).as_posix(),
    )
    if not shard_paths:
        raise AuditInputError("input directory contains no .json shards")

    shards = []
    company_names = {}
    verified_benefit_inventory_present = False
    raw_verified_benefit_count = 0
    for path in shard_paths:
        relative_path = path.relative_to(companies_directory).as_posix()
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            raise AuditInputError(f"{relative_path}: invalid JSON") from error
        except (OSError, UnicodeError) as error:
            raise AuditInputError(f"{relative_path}: unable to read shard") from error
        if not isinstance(payload, dict):
            raise AuditInputError(f"{relative_path}: top-level payload must be an object")
        if "company" not in payload:
            raise AuditInputError(f"{relative_path}: missing required field 'company'")
        if not isinstance(payload["company"], dict):
            raise AuditInputError(f"{relative_path}: field 'company' must be an object")
        company = payload["company"]
        for field in ("company_id", "legal_name"):
            qualified_field = f"company.{field}"
            if field not in company:
                raise AuditInputError(f"{relative_path}: missing required field '{qualified_field}'")
            if not isinstance(company[field], str) or not company[field].strip():
                raise AuditInputError(
                    f"{relative_path}: field '{qualified_field}' must be a nonblank string"
                )
        for field in RECORD_KINDS:
            _validate_object_list(payload, relative_path, field, required=True)
        inventory = _validate_object_list(payload, relative_path, "verified_benefits")

        shards.append((relative_path, payload))
        company_id = company["company_id"]
        legal_name = company["legal_name"].strip()
        company_names[company_id] = legal_name
        if "verified_benefits" in payload:
            verified_benefit_inventory_present = True
        raw_verified_benefit_count += len(inventory)

    records = []
    for relative_path, payload in shards:
        shard_company_id = str(payload.get("company", {}).get("company_id") or "")
        for kind in RECORD_KINDS:
            values = payload.get(kind, [])
            for index, record in enumerate(values):
                record_id = str(record.get(ID_FIELDS[kind]) or f"index-{index:06d}")
                key = f"{relative_path}:{kind}:{record_id}"
                records.append(
                    {
                        "key": key,
                        "kind": kind,
                        "company_id": str(record.get("company_id") or shard_company_id),
                        "category_id": str(record.get("category_id") or ""),
                        "statement": str(record.get("statement") or ""),
                        "source_url": _source_url(kind, record),
                        "record": record,
                    }
                )
    records.sort(key=lambda item: item["key"])

    page_dumps = {item["key"] for item in records if _is_page_or_body_dump(item["statement"])}
    producer_meta = {
        item["key"]
        for item in records
        if any(phrase in item["statement"].casefold() for phrase in META_PHRASES)
    }

    same_category_groups = defaultdict(list)
    company_statement_groups = defaultdict(list)
    for item in records:
        normalized = _normalized_statement(item["statement"])
        if normalized:
            same_category_groups[(item["company_id"], item["category_id"], normalized)].append(item)
            company_statement_groups[(item["company_id"], normalized)].append(item)
    duplicates = {
        item["key"]
        for items in same_category_groups.values()
        if len(items) > 1
        for item in items
    }
    cross_category_replays = {
        item["key"]
        for items in company_statement_groups.values()
        if len({item["category_id"] for item in items}) > 1
        for item in items
    }

    url_groups = defaultdict(list)
    for item in records:
        if item["source_url"]:
            url_groups[item["source_url"]].append(item)
    reused_urls = {
        item["key"]
        for items in url_groups.values()
        if len({item["category_id"] for item in items}) > 1
        for item in items
    }

    unrelated_company = set()
    for item in records:
        text = item["statement"].casefold()
        for company_id, legal_name in company_names.items():
            if company_id != item["company_id"] and len(legal_name) >= 4 and legal_name.casefold() in text:
                unrelated_company.add(item["key"])
                break

    unresolved_scope = {
        item["key"]
        for item in records
        if _is_unscoped(item["kind"], item["record"])
    }
    invalid_or_unscoped = set().union(
        page_dumps,
        producer_meta,
        duplicates,
        cross_category_replays,
        reused_urls,
        unrelated_company,
        unresolved_scope,
    )

    inventory_status = "present" if verified_benefit_inventory_present else "absent"

    return {
        "schema_version": 1,
        "audit_kind": "specific_benefit_semantic_audit",
        "projection_directory": projection.name,
        "raw_evidence_record_count": len(records),
        "raw_verified_benefit_count": raw_verified_benefit_count,
        "verified_benefit_inventory": inventory_status,
        "eligible_verified_proposition_count": 0,
        "audit_policy": {
            "automatic_promotion": "blocked_by_any_signal",
            "page_or_body_dump_rule": "statement has at least 1200 characters or 20 non-empty lines",
            "scope_rule": "exact_entity and bounded_entity are scoped; group_only, unresolved, missing, and unknown values are unscoped",
            "eligible_proposition_rule": "Task 1 reports verified_benefits inventory presence and raw item count but keeps eligible_verified_proposition_count at zero because no exact approved-contract validator exists yet",
            "record_key_limit_per_signal": RECORD_KEY_LIMIT,
            "limitations": "Bounded heuristics are audit signals that block automatic promotion; they do not certify unflagged text as semantically valid.",
        },
        "audit_signals": {
            "page_or_body_dump": _signal(page_dumps),
            "producer_meta_statement": _signal(producer_meta),
            "same_company_category_duplicate_statement": _signal(duplicates),
            "same_company_cross_category_statement_replay": _signal(cross_category_replays),
            "source_url_reused_across_categories": _signal(reused_urls),
            "unrelated_company_text": _signal(unrelated_company),
            "unresolved_or_missing_scope": _signal(unresolved_scope),
            "conservative_invalid_or_unscoped_union": _signal(invalid_or_unscoped),
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("projection_directory", type=Path)
    args = parser.parse_args()
    try:
        report = audit_projection(args.projection_directory)
    except AuditInputError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
