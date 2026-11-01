import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RESEARCH = ROOT / "docs" / "research" / "company-benefits"
POLICY = json.loads((RESEARCH / "research-coverage-policies.json").read_text(encoding="utf-8"))
CATEGORIES = (
    "leave", "family", "health", "growth", "housing",
    "commute", "remote", "retirement", "meals", "inclusion",
)
V2_FILES = {
    "cells": "company-category-cells.jsonl",
    "attempts": "research-attempts.jsonl",
    "official_claims": "official-claims-v2.jsonl",
    "references": "reference-records.jsonl",
    "community_reports": "community-benefit-reports.jsonl",
    "sources": "sources-v2.jsonl",
}


def canonical_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def receipt(record):
    record = dict(record)
    record["receipt_content_sha256"] = hashlib.sha256(canonical_bytes(record)).hexdigest()
    return record


def no_public_info_records(batch, companies):
    company_map = {company["company_id"]: company for company in companies}
    cells = []
    attempts = []
    serial = 0
    for company_id in batch["company_ids"]:
        company = company_map[company_id]
        for category_id in CATEGORIES:
            cell_id = f"cell::{company_id}::{category_id}"
            attempt_ids = []
            for route_id in POLICY["category_routes"][category_id]:
                route_kind = POLICY["routes"][route_id]["route_kind"]
                attempt_id = f"attempt::{company_id}::{category_id}::{route_id}"
                attempt_ids.append(attempt_id)
                token = hashlib.sha256(attempt_id.encode("utf-8")).hexdigest()
                attempts.append(receipt({
                    "attempt_id": attempt_id, "cell_id": cell_id, "company_id": company_id,
                    "category_id": category_id, "jurisdiction": company["jurisdiction"],
                    "coverage_policy_id": POLICY["policy_id"], "route_id": route_id,
                    "route_kind": route_kind, "query_or_locator": f"bounded query {company_id} {category_id} {route_id}",
                    "started_at": "2026-11-01T01:00:00Z", "completed_at": "2026-11-01T01:01:00Z",
                    "result": "no_result", "source_ids": [], "raw_response_sha256": token,
                    "capture_locator": f"https://captures.invalid/v2/{serial}",
                    "collector_version": "benefits-collector/2.0.0",
                }))
                serial += 1
            cells.append({
                "cell_id": cell_id, "company_id": company_id, "category_id": category_id,
                "jurisdiction": company["jurisdiction"], "state": "no_public_info",
                "coverage_policy_id": POLICY["policy_id"], "attempt_ids": attempt_ids,
                "official_claim_ids": [], "reference_ids": [], "community_report_ids": [],
                "reliability": "none", "currentness": "unknown", "scope_status": "unresolved",
                "conflict_status": "none", "publication_eligibility": "discovery_only",
                "coverage_complete": True, "assessed_at": "2026-11-01T01:02:03Z",
            })
    attempts.sort(key=lambda item: (
        batch["company_ids"].index(item["company_id"]), CATEGORIES.index(item["category_id"]), item["route_id"]
    ))
    return {
        "cells": cells, "attempts": attempts, "official_claims": [],
        "references": [], "community_reports": [], "sources": [],
    }


def write_records(directory, records, jsonl_bytes):
    directory = Path(directory)
    hashes = {}
    for ledger, filename in V2_FILES.items():
        raw = jsonl_bytes(records[ledger])
        (directory / filename).write_bytes(raw)
        hashes[filename] = hashlib.sha256(raw).hexdigest()
    return hashes
