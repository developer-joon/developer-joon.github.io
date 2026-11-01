#!/usr/bin/env python3
"""Collect bounded route attempts into a discovery artifact for independent review."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

from company_benefits_collectors import (
    BatchCheckpoint,
    CaptureStore,
    CollectorError,
    CompanyAuthority,
    FetchPolicy,
    ROUTES,
    SecureHTTPTransport,
    _atomic_json,
    batch_input_sha256,
    canonical_route_id,
    collect_batch,
)


ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / "docs" / "research" / "company-benefits"
DEFAULT_CAPTURE_ROOT = Path.home() / ".cache" / "company-benefits-v2" / "captures"
DEFAULT_CHECKPOINT = Path.home() / ".cache" / "company-benefits-v2" / "checkpoint.json"
CATEGORIES = {
    "leave", "family", "health", "growth", "housing",
    "commute", "remote", "retirement", "meals", "inclusion",
}


def _read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise CollectorError(f"cannot read JSON from {path}: {exc}") from exc


def _canonical_companies(path: Path) -> dict[str, dict[str, object]]:
    companies: dict[str, dict[str, object]] = {}
    try:
        schema = json.loads((RESEARCH / "schema" / "company.schema.json").read_text(encoding="utf-8"))
        protocol = json.loads((RESEARCH / "population-protocol.json").read_text(encoding="utf-8"))
        seed = protocol["canonical_selection"]["seed"]
    except (OSError, UnicodeError, json.JSONDecodeError, KeyError, TypeError) as exc:
        raise CollectorError(f"cannot load canonical company authority contracts: {exc}") from exc
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as exc:
        raise CollectorError(f"cannot read canonical company ledger: {exc}") from exc
    for number, line in enumerate(lines, 1):
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise CollectorError(f"invalid canonical company ledger line {number}: {exc}") from exc
        if not isinstance(value, dict) or not isinstance(value.get("company_id"), str):
            raise CollectorError(f"invalid canonical company ledger line {number}")
        errors = list(validator.iter_errors(value))
        if errors:
            raise CollectorError(
                f"canonical company ledger line {number} fails company.schema.json: {errors[0].message}"
            )
        fields = (seed, value.get("jurisdiction"), value.get("registry_id"), value.get("legal_name"))
        if not all(isinstance(item, str) and item.strip() for item in fields):
            raise CollectorError(f"canonical company ledger line {number} lacks hash identity fields")
        normalized = [
            unicodedata.normalize("NFC", str(item)).strip() for item in fields
        ]
        normalized[3] = re.sub(r"\s+", " ", normalized[3])
        expected_hash = hashlib.sha256(json.dumps(
            normalized, ensure_ascii=False, separators=(",", ":"), allow_nan=False
        ).encode("utf-8")).hexdigest()
        if value.get("selection_hash") != expected_hash:
            raise CollectorError(f"canonical company ledger line {number} has a selection_hash mismatch")
        if value.get("selected_reporting_legal_entity") != value.get("legal_name"):
            raise CollectorError(f"canonical company ledger line {number} has a substituted legal entity")
        company_id = value["company_id"]
        if company_id in companies:
            raise CollectorError(f"duplicate canonical company: {company_id}")
        companies[company_id] = value
    return companies


def _expand_requests(requests, companies: dict[str, dict[str, object]], max_items: int):
    if not isinstance(requests, list) or not requests:
        raise CollectorError("input must be a non-empty JSON array")
    items = []
    seen = set()
    for index, request in enumerate(requests):
        if not isinstance(request, dict):
            raise CollectorError(f"input[{index}] must be an object")
        allowed = {"company_id", "category_id", "route_ids", "locators"}
        unknown = sorted(set(request) - allowed)
        if unknown:
            raise CollectorError(f"input[{index}] has unknown fields: {unknown}")
        company_id = request.get("company_id")
        category_id = request.get("category_id")
        route_ids = request.get("route_ids")
        if company_id not in companies:
            raise CollectorError(f"input[{index}] company is absent from canonical ledger")
        if category_id not in CATEGORIES:
            raise CollectorError(f"input[{index}] has invalid category_id")
        if not isinstance(route_ids, list) or not route_ids or any(route not in ROUTES for route in route_ids):
            raise CollectorError(f"input[{index}] has invalid route_ids")
        if len(route_ids) != len(set(route_ids)):
            raise CollectorError(f"input[{index}] has duplicate route_ids")
        locators = request.get("locators", {})
        if not isinstance(locators, dict) or any(key not in route_ids or not isinstance(value, str) for key, value in locators.items()):
            raise CollectorError(f"input[{index}] has invalid locators")
        canonical = companies[company_id]
        legal_name = canonical.get("legal_name")
        legal_entity = canonical.get("selected_reporting_legal_entity")
        jurisdiction = canonical.get("jurisdiction")
        if not all(isinstance(value, str) and value for value in (legal_name, legal_entity, jurisdiction)):
            raise CollectorError(f"canonical company is incomplete: {company_id}")
        assert isinstance(legal_name, str)
        assert isinstance(legal_entity, str)
        assert isinstance(jurisdiction, str)
        authority = CompanyAuthority(
            company_id=company_id,
            jurisdiction=jurisdiction,
            legal_name=legal_name,
            canonical_legal_entity=legal_entity,
        )
        for route_id in route_ids:
            key = (company_id, category_id, canonical_route_id(route_id))
            if key in seen:
                raise CollectorError(f"duplicate attempt scope: {key}")
            seen.add(key)
            items.append({
                "company": authority,
                "category_id": category_id,
                "route_id": route_id,
                "locator": locators.get(route_id),
            })
    if len(items) > max_items:
        raise CollectorError(f"expanded input exceeds --max-items ({len(items)} > {max_items})")
    return items


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="JSON array of canonical company/category/route requests")
    parser.add_argument("output", type=Path, help="collector discovery artifact JSON to write atomically")
    parser.add_argument("--coverage-policy", type=Path, default=RESEARCH / "research-coverage-policies.json")
    parser.add_argument("--capture-root", type=Path, default=DEFAULT_CAPTURE_ROOT,
                        help="repository-external content-addressed capture directory")
    parser.add_argument("--capture-base-url", default="https://captures.invalid/sha256/")
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    parser.add_argument("--max-items", type=int, default=250)
    parser.add_argument("--max-redirects", type=int, default=4)
    parser.add_argument("--max-response-bytes", type=int, default=2_000_000)
    parser.add_argument("--max-decoded-bytes", type=int, default=4_000_000)
    parser.add_argument("--connect-timeout", type=float, default=5.0)
    parser.add_argument("--read-timeout", type=float, default=10.0)
    parser.add_argument("--dns-timeout", type=float, default=3.0)
    parser.add_argument("--total-timeout", type=float, default=30.0)
    parser.add_argument("--retries", type=int, default=2)
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.max_items < 1 or args.max_items > 1000:
            raise CollectorError("--max-items must be between 1 and 1000")
        requests = _read_json(args.input)
        companies = _canonical_companies(RESEARCH / "companies.jsonl")
        items = _expand_requests(requests, companies, args.max_items)
        policy_contract = _read_json(args.coverage_policy)
        input_hash = batch_input_sha256(items)
        checkpoint = BatchCheckpoint(args.checkpoint, input_hash)
        package = collect_batch(
            items,
            transport=SecureHTTPTransport(),
            capture_store=CaptureStore(args.capture_root, args.capture_base_url, repository_root=ROOT),
            checkpoint=checkpoint,
            policy=FetchPolicy(
                max_redirects=args.max_redirects,
                max_wire_bytes=args.max_response_bytes,
                max_decoded_bytes=args.max_decoded_bytes,
                connect_timeout=args.connect_timeout,
                read_timeout=args.read_timeout,
                dns_timeout=args.dns_timeout,
                total_timeout=args.total_timeout,
                retries=args.retries,
            ),
            now=_now,
            coverage_policy=policy_contract,
        )
        _atomic_json(args.output, package)
    except CollectorError as exc:
        print(f"collection failed: {exc}", file=sys.stderr)
        return 2
    attempts = package.get("attempts")
    sources = package.get("sources")
    attempt_count = len(attempts) if isinstance(attempts, list) else 0
    source_count = len(sources) if isinstance(sources, list) else 0
    print(
        f"wrote discovery artifact with {attempt_count} attempt receipts and "
        f"{source_count} discovered sources to {args.output}; independent cell review is required"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
