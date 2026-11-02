#!/usr/bin/env python3
"""Prepare and ingest non-authoritative web-search bridge artifacts."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import stat
import sys
import unicodedata
import urllib.parse
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Mapping, Sequence

from jsonschema import Draft202012Validator, FormatChecker

try:
    from scripts.company_benefits_collectors import (
        CaptureStore,
        CollectorError,
        CompanyAuthority,
        SecurityError,
        TransientFetchError,
        ROUTES,
        _default_resolver,
        _assert_no_secrets,
        _atomic_json,
        canonical_route_id,
        validate_public_https_url,
    )
except ImportError:  # direct script execution
    from company_benefits_collectors import (
        CaptureStore,
        CollectorError,
        CompanyAuthority,
        SecurityError,
        TransientFetchError,
        ROUTES,
        _default_resolver,
        _assert_no_secrets,
        _atomic_json,
        canonical_route_id,
        validate_public_https_url,
    )


ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / "docs" / "research" / "company-benefits"
SCHEMA = RESEARCH / "schema"
MAX_RAW_TOOL_RESPONSE_BYTES = 2_000_000
MAX_RESULT_TITLE_CHARS = 500
MAX_RESULT_DESCRIPTION_CHARS = 4_000
MAX_RESULTS_HARD_LIMIT = 20
MAX_DIRECT_CONTENT_CHARS = 500_000
MAX_DIRECT_TITLE_CHARS = 500
HASH_PATTERN = re.compile(r"[0-9a-f]{64}")
CATEGORY_TERMS: Mapping[str, tuple[str, ...]] = {
    "leave": ("휴가", "연차", "특별휴가"),
    "family": ("가족지원", "육아", "출산", "경조사"),
    "health": ("건강검진", "의료비", "보험"),
    "growth": ("교육지원", "자기계발", "학습"),
    "housing": ("주거지원", "기숙사", "주택자금"),
    "commute": ("통근지원", "교통비", "차량지원"),
    "remote": ("재택근무", "유연근무", "원격근무"),
    "retirement": ("퇴직연금", "퇴직금", "노후지원"),
    "meals": ("식사", "식대", "구내식당"),
    "inclusion": ("장애인", "다양성", "포용", "여성지원"),
}
SEARCH_ROUTES = ("official-government", "company-recruiting-media", "other-public-web")
ROUTE_QUERY_SUFFIXES: Mapping[str, tuple[str, ...]] = {
    "official-government": ("공식", "회사", "채용", "정부"),
    "company-recruiting-media": ("채용", "복리후생"),
    "other-public-web": ("복지",),
}


def _canonical_json(value: object) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode("utf-8")


def content_hash_without(value: Mapping[str, object], field: str) -> str:
    return hashlib.sha256(_canonical_json({key: item for key, item in value.items() if key != field})).hexdigest()


def finalize_manifest(value: Mapping[str, object]) -> dict[str, object]:
    manifest = dict(value)
    manifest["artifact_content_sha256"] = content_hash_without(manifest, "artifact_content_sha256")
    return manifest


def _validate_timestamp(value: str) -> None:
    if re.fullmatch(r"20\d\d-\d\d-\d\dT\d\d:\d\d:\d\dZ", value) is None:
        raise CollectorError("timestamp must be UTC RFC3339 seconds")


def _normalized_name(value: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", value).strip())


def _derived_korean_alias(legal_name: str) -> str:
    alias = _normalized_name(legal_name)
    alias = re.sub(r"^\s*\((?:주|유)\)\s*", "", alias)
    alias = re.sub(r"\s*\((?:주|유)\)\s*$", "", alias)
    alias = re.sub(r"^\s*(?:주식회사|유한회사)\s+", "", alias)
    alias = re.sub(r"\s+(?:주식회사|유한회사)\s*$", "", alias)
    return _normalized_name(alias)


def safe_search_aliases(
    company: CompanyAuthority, companies: Mapping[str, CompanyAuthority]
) -> tuple[str, ...]:
    """Return exact legal display name plus collision-free legal-designator alias."""
    original = _normalized_name(company.legal_name)
    canonical_owners = {
        item.company_id for item in companies.values()
        if _normalized_name(item.legal_name) == original
    }
    if canonical_owners != {company.company_id}:
        raise CollectorError("canonical legal name collision prevents safe search planning")
    if company.jurisdiction != "KR":
        return (original,)
    derived = _derived_korean_alias(original)
    if not derived or derived == original:
        return (original,)
    colliding = {
        item.company_id for item in companies.values()
        if _derived_korean_alias(item.legal_name).casefold() == derived.casefold()
    }
    return (original, derived) if colliding == {company.company_id} else (original,)


def _localized_query(alias: str, route_id: str, category_id: str | None) -> str:
    if route_id not in SEARCH_ROUTES:
        raise CollectorError("search route is not supported by localized planner")
    terms = CATEGORY_TERMS.get(category_id, ()) if category_id else ()
    if category_id is not None and not terms:
        raise CollectorError(f"unknown benefit category: {category_id}")
    return " ".join((f'"{alias}"', *terms, *ROUTE_QUERY_SUFFIXES[route_id]))


def _query_entry(
    company: CompanyAuthority,
    aliases: tuple[str, ...],
    route_id: str,
    category_id: str | None,
) -> dict[str, object]:
    stage = "category-gap" if category_id else "broad-discovery"
    category_scope = category_id or "broad"
    return {
        "query_id": f"search-query::{company.company_id}::{category_scope}::{route_id}",
        "company_id": company.company_id,
        "legal_name": company.legal_name,
        "search_aliases": list(aliases),
        "category_id": category_scope,
        "category_terms": list(CATEGORY_TERMS.get(category_scope, ())),
        "jurisdiction": company.jurisdiction,
        "route_id": route_id,
        "route_kind": ROUTES[route_id].route_kind,
        "query_stage": stage,
        "execution_status": "deferred" if category_id else "ready",
        "query_or_locator": _localized_query(aliases[-1], route_id, category_id),
        "tool_name": "web_search",
        "max_results": 5,
        "candidate_policy": (
            "explicit-category-support-review-only" if category_id is None
            else "required-route-receipt-for-unresolved-cell"
        ),
        "entity_acceptance": "exact-alias-review-required",
        "authoritative_use_prohibited": True,
    }


def plan_company_queries(
    company: CompanyAuthority, companies: Mapping[str, CompanyAuthority]
) -> list[dict[str, object]]:
    aliases = safe_search_aliases(company, companies)
    entries = [_query_entry(company, aliases, route_id, None) for route_id in SEARCH_ROUTES]
    entries.extend(
        _query_entry(company, aliases, route_id, category_id)
        for category_id in CATEGORY_TERMS
        for route_id in SEARCH_ROUTES
    )
    return entries


def build_split_manifests(
    companies: Mapping[str, CompanyAuthority],
    company_ids: Sequence[str],
    *, batch_id: str,
    source_requests_sha256: str,
    created_at: str,
) -> list[dict[str, object]]:
    if len(company_ids) != 25 or len(set(company_ids)) != 25:
        raise CollectorError("split planning requires exactly 25 unique companies")
    if any(company_id not in companies for company_id in company_ids):
        raise CollectorError("split planning contains an unknown company")
    if HASH_PATTERN.fullmatch(source_requests_sha256) is None:
        raise CollectorError("source request hash is malformed")
    _validate_timestamp(created_at)
    manifests: list[dict[str, object]] = []
    for unit_number in range(5):
        owned = list(company_ids[unit_number * 5:(unit_number + 1) * 5])
        entries = [entry for company_id in owned for entry in plan_company_queries(companies[company_id], companies)]
        manifests.append(finalize_manifest({
            "artifact_type": "company-benefits-search-query-manifest",
            "format_version": 2,
            "batch_id": batch_id,
            "unit_id": f"{batch_id}-acquisition-{unit_number + 1:02d}",
            "created_at": created_at,
            "source_requests_sha256": source_requests_sha256,
            "company_count": len(owned),
            "cell_count": len(owned) * len(CATEGORY_TERMS),
            "company_ids": owned,
            "broad_query_count": sum(entry["query_stage"] == "broad-discovery" for entry in entries),
            "deferred_query_count": sum(entry["query_stage"] == "category-gap" for entry in entries),
            "entry_count": len(entries),
            "entries": entries,
        }))
    validate_split_manifests(manifests, company_ids)
    return manifests


def validate_split_manifests(
    manifests: Sequence[Mapping[str, object]], expected_company_ids: Sequence[str]
) -> dict[str, int]:
    if len(manifests) != 5:
        raise CollectorError("split aggregation requires exactly five units")
    owners: dict[str, str] = {}
    cells: set[tuple[str, str]] = set()
    for manifest in manifests:
        unit_id = manifest.get("unit_id")
        company_ids = manifest.get("company_ids")
        entries = manifest.get("entries")
        if not isinstance(unit_id, str) or not isinstance(company_ids, list) or len(company_ids) != 5:
            raise CollectorError("split unit ownership is malformed")
        if not isinstance(entries, list):
            raise CollectorError("split unit entries are malformed")
        for company_id in company_ids:
            if not isinstance(company_id, str):
                raise CollectorError("split company id is malformed")
            if company_id in owners:
                raise CollectorError(f"duplicate company ownership: {company_id}")
            owners[company_id] = unit_id
            for category_id in CATEGORY_TERMS:
                cells.add((company_id, category_id))
        expected_ids = {
            f"search-query::{company_id}::{scope}::{route_id}"
            for company_id in company_ids
            for scope in ("broad", *CATEGORY_TERMS)
            for route_id in SEARCH_ROUTES
        }
        actual_ids = {entry.get("query_id") for entry in entries if isinstance(entry, dict)}
        if actual_ids != expected_ids or len(entries) != len(expected_ids):
            raise CollectorError(f"split unit query coverage mismatch: {unit_id}")
    if set(owners) != set(expected_company_ids) or len(owners) != 25 or len(cells) != 250:
        raise CollectorError("split aggregation does not cover exactly 25 companies and 250 cells")
    return {"company_count": len(owners), "cell_count": len(cells), "unit_count": len(manifests)}


def validate_no_public_info_coverage(
    entries: Sequence[Mapping[str, object]], receipt_query_ids: Sequence[str],
    company_id: str, category_id: str,
) -> None:
    required = {
        str(entry["query_id"]) for entry in entries
        if entry.get("company_id") == company_id
        and entry.get("category_id") == category_id
        and entry.get("query_stage") == "category-gap"
    }
    if len(required) != len(SEARCH_ROUTES) or not required.issubset(set(receipt_query_ids)):
        raise CollectorError("incomplete category-specific route receipts for no_public_info")


def _locator_query(locator: str) -> str:
    try:
        values = urllib.parse.parse_qs(
            urllib.parse.urlsplit(locator).query, keep_blank_values=True, strict_parsing=True
        ).get("q", [])
    except ValueError as exc:
        raise CollectorError(f"locator query cannot be parsed: {exc}") from exc
    if len(values) != 1:
        raise CollectorError("locator must contain exactly one q query parameter")
    return values[0]


def build_query_manifest(
    requests: object,
    companies: Mapping[str, CompanyAuthority],
    *,
    source_requests_sha256: str,
    created_at: str,
) -> dict[str, object]:
    if not isinstance(requests, list) or not requests:
        raise CollectorError("source requests must be a non-empty array")
    if HASH_PATTERN.fullmatch(source_requests_sha256) is None:
        raise CollectorError("source request hash is malformed")
    _validate_timestamp(created_at)
    entries: list[dict[str, object]] = []
    seen: set[str] = set()
    for index, request in enumerate(requests):
        if not isinstance(request, dict):
            raise CollectorError(f"source request[{index}] must be an object")
        if set(request) != {"company_id", "category_id", "route_ids", "locators"}:
            raise CollectorError(f"source request[{index}] fields are not canonical")
        company_id = request.get("company_id")
        category_id = request.get("category_id")
        route_ids = request.get("route_ids")
        locators = request.get("locators")
        if company_id not in companies or not isinstance(category_id, str):
            raise CollectorError(f"source request[{index}] has unknown scope")
        if not isinstance(route_ids, list) or not route_ids or len(route_ids) != len(set(route_ids)):
            raise CollectorError(f"source request[{index}] routes are malformed")
        if not isinstance(locators, dict) or set(locators) != set(route_ids):
            raise CollectorError(f"source request[{index}] locators are incomplete")
        company = companies[str(company_id)]
        if category_id not in CATEGORY_TERMS:
            raise CollectorError(f"source request[{index}] category is not canonical")
        aliases = safe_search_aliases(company, companies)
        for route_id in route_ids:
            if route_id not in SEARCH_ROUTES or canonical_route_id(str(route_id)) != route_id:
                raise CollectorError(f"source request[{index}] route is not canonical")
            entry = _query_entry(company, aliases, route_id, category_id)
            locator = locators.get(route_id)
            if not isinstance(locator, str) or _locator_query(locator) != entry["query_or_locator"]:
                raise CollectorError(f"source request[{index}] locator query semantics drifted")
            query_id = str(entry["query_id"])
            if query_id in seen:
                raise CollectorError(f"duplicate bridge query: {query_id}")
            seen.add(query_id)
            entries.append(entry)
    return finalize_manifest({
        "artifact_type": "company-benefits-search-query-manifest",
        "format_version": 2,
        "created_at": created_at,
        "source_requests_sha256": source_requests_sha256,
        "entry_count": len(entries),
        "entries": entries,
    })


def _schema(name: str) -> dict[str, object]:
    try:
        value = json.loads((SCHEMA / name).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise CollectorError(f"cannot load bridge schema {name}: {exc}") from exc
    if not isinstance(value, dict):
        raise CollectorError(f"bridge schema {name} is malformed")
    return value


def _validate_schema(name: str, value: object) -> None:
    errors = sorted(
        Draft202012Validator(_schema(name), format_checker=FormatChecker()).iter_errors(value),
        key=lambda error: list(error.absolute_path),
    )
    if errors:
        raise CollectorError(f"{name} validation failed: {errors[0].message}")


def _validate_manifest_bindings(manifest: Mapping[str, object]) -> list[dict[str, object]]:
    entries = manifest.get("entries")
    if not isinstance(entries, list) or manifest.get("entry_count") != len(entries):
        raise CollectorError("query manifest entry count mismatch")
    validated: list[dict[str, object]] = []
    seen: set[str] = set()
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise CollectorError(f"query manifest entry[{index}] is malformed")
        company_id = entry.get("company_id")
        category_id = entry.get("category_id")
        route_id = entry.get("route_id")
        if not all(isinstance(item, str) for item in (company_id, category_id, route_id)):
            raise CollectorError(f"query manifest entry[{index}] scope is malformed")
        assert isinstance(company_id, str) and isinstance(category_id, str) and isinstance(route_id, str)
        expected_id = f"search-query::{company_id}::{category_id}::{route_id}"
        if entry.get("query_id") != expected_id:
            raise CollectorError(f"query manifest entry[{index}] scope binding mismatch")
        if route_id not in ROUTES or canonical_route_id(route_id) != route_id:
            raise CollectorError(f"query manifest entry[{index}] route is not canonical")
        if entry.get("route_kind") != ROUTES[route_id].route_kind:
            raise CollectorError(f"query manifest entry[{index}] route kind mismatch")
        if entry.get("query_stage") is not None:
            stage = entry.get("query_stage")
            aliases = entry.get("search_aliases")
            legal_name = entry.get("legal_name")
            if (
                stage not in ("broad-discovery", "category-gap")
                or not isinstance(aliases, list) or not aliases
                or not all(isinstance(alias, str) and alias for alias in aliases)
                or not isinstance(legal_name, str)
                or aliases[0] != _normalized_name(legal_name)
            ):
                raise CollectorError(f"query manifest entry[{index}] entity aliases are malformed")
            planned_category = None if stage == "broad-discovery" else category_id
            if (stage == "broad-discovery") != (category_id == "broad"):
                raise CollectorError(f"query manifest entry[{index}] stage binding mismatch")
            expected_terms = list(CATEGORY_TERMS.get(category_id, ()))
            if entry.get("category_terms") != expected_terms:
                raise CollectorError(f"query manifest entry[{index}] category terms mismatch")
            expected_query = _localized_query(aliases[-1], route_id, planned_category)
            if (
                entry.get("query_or_locator") != expected_query
                or company_id in expected_query
                or " OR " in expected_query
            ):
                raise CollectorError(f"query manifest entry[{index}] localized query semantics drifted")
            expected_status = "ready" if stage == "broad-discovery" else "deferred"
            expected_policy = (
                "explicit-category-support-review-only" if stage == "broad-discovery"
                else "required-route-receipt-for-unresolved-cell"
            )
            if (
                entry.get("execution_status") != expected_status
                or entry.get("candidate_policy") != expected_policy
                or entry.get("entity_acceptance") != "exact-alias-review-required"
            ):
                raise CollectorError(f"query manifest entry[{index}] review boundary mismatch")
        if expected_id in seen:
            raise CollectorError(f"duplicate query manifest entry: {expected_id}")
        seen.add(expected_id)
        validated.append(entry)
    return validated


def _response_without_result_urls(value: Mapping[str, object]) -> dict[str, object]:
    """Copy a response for secret scanning without treating URLs as record secrets."""
    copied = json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))
    data = copied.get("data")
    web = data.get("web") if isinstance(data, dict) else None
    if isinstance(web, list):
        for result in web:
            if isinstance(result, dict) and "url" in result:
                result["url"] = "https://omitted.invalid/"
    return copied


def _url_omission_reason(
    url: str, resolver: Callable[[str, int], Sequence[str]]
) -> tuple[str | None, str | None]:
    if len(url) > 4000:
        return "url_out_of_bounds", None
    try:
        scheme = urllib.parse.urlsplit(url).scheme.lower()
    except ValueError:
        return "malformed_url", None
    bounded_scheme = scheme if re.fullmatch(r"[a-z][a-z0-9+.-]{0,31}", scheme) else None
    if scheme != "https":
        return "non_https_url", bounded_scheme
    try:
        return None, validate_public_https_url(url, resolver=resolver)
    except TransientFetchError:
        return "url_resolution_failed", bounded_scheme
    except SecurityError as exc:
        message = str(exc)
        if "credential" in message:
            return "credential_like_url", bounded_scheme
        if "non-public" in message or "localhost" in message:
            return "private_url", bounded_scheme
        if "bounded string" in message:
            return "url_out_of_bounds", bounded_scheme
        return "malformed_url", bounded_scheme


def _parse_tool_response(
    raw: bytes, max_results: int, resolver: Callable[[str, int], Sequence[str]]
) -> tuple[dict[str, object], list[dict[str, object]], list[dict[str, object]]]:
    if not raw or len(raw) > MAX_RAW_TOOL_RESPONSE_BYTES:
        raise CollectorError("raw tool response exceeds byte bound or is empty")
    try:
        value = json.loads(raw.decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise CollectorError(f"raw tool response is not strict UTF-8 JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise CollectorError("raw tool response must be an object")
    _assert_no_secrets(_response_without_result_urls(value))
    data = value.get("data")
    web = data.get("web") if isinstance(data, dict) else None
    if not isinstance(web, list):
        raise CollectorError("raw tool response lacks data.web results")
    if len(web) > max_results or len(web) > MAX_RESULTS_HARD_LIMIT:
        raise CollectorError("raw tool response exceeds result count bound")
    validated: list[dict[str, object]] = []
    omitted: list[dict[str, object]] = []
    supplied_positions = [
        result.get("position") if isinstance(result, dict) else None for result in web
    ]
    duplicate_positions = {
        position for position, count in Counter(
            position for position in supplied_positions
            if isinstance(position, int) and not isinstance(position, bool)
        ).items() if count > 1
    }
    for index, result_value in enumerate(web):
        original_position = index + 1
        reason: str | None = None
        scheme: str | None = None
        if not isinstance(result_value, dict):
            reason = "malformed_result"
            result: Mapping[str, object] = {}
        else:
            result = result_value
        supplied_position = result.get("position")
        if reason is None and supplied_position is not None:
            if (
                not isinstance(supplied_position, int) or isinstance(supplied_position, bool)
                or supplied_position < 1 or supplied_position > max_results
            ):
                reason = "invalid_position"
            else:
                original_position = supplied_position
                if supplied_position in duplicate_positions:
                    reason = "duplicate_position"
        url = result.get("url")
        title = result.get("title")
        description = result.get("description")
        if reason is None and not all(isinstance(item, str) for item in (url, title, description)):
            reason = "malformed_result"
        if reason is None:
            assert isinstance(url, str) and isinstance(title, str) and isinstance(description, str)
            if not title or len(title) > MAX_RESULT_TITLE_CHARS:
                reason = "title_out_of_bounds"
            elif len(description) > MAX_RESULT_DESCRIPTION_CHARS:
                reason = "description_out_of_bounds"
        canonical_url: str | None = None
        if reason is None:
            assert isinstance(url, str)
            reason, url_value = _url_omission_reason(url, resolver)
            if reason is None:
                canonical_url = url_value
            else:
                scheme = url_value
        if reason is not None:
            diagnostic: dict[str, object] = {
                "original_position": original_position,
                "reason_code": reason,
            }
            if isinstance(url, str):
                diagnostic["unsafe_url_sha256"] = hashlib.sha256(url.encode("utf-8")).hexdigest()
            if scheme:
                diagnostic["url_scheme"] = scheme
            omitted.append(diagnostic)
            continue
        assert canonical_url is not None and isinstance(title, str) and isinstance(description, str)
        validated.append({
            "result_order": original_position,
            "url": canonical_url,
            "title": title,
            "description": description,
            "review_status": "unreviewed_lead",
        })
    return value, validated, omitted


def reconcile_executed_routes(
    executed_query_ids: Sequence[str],
    acquisitions: Sequence[Mapping[str, object]],
    true_tool_failures: Mapping[str, str],
) -> dict[str, object]:
    """Prove every executed query has one complete receipt or an explicit tool failure."""
    if len(executed_query_ids) != len(set(executed_query_ids)):
        raise CollectorError("executed route list contains duplicate query ids")
    receipts: dict[str, Mapping[str, object]] = {}
    for receipt in acquisitions:
        _validate_schema("search-tool-acquisition.schema.json", receipt)
        query_id = receipt.get("query_id")
        if not isinstance(query_id, str) or query_id in receipts:
            raise CollectorError("acquisition receipts contain absent or duplicate query ids")
        if receipt.get("artifact_content_sha256") != content_hash_without(
            receipt, "artifact_content_sha256"
        ):
            raise CollectorError(f"acquisition receipt content hash mismatch: {query_id}")
        retained = receipt.get("retained_result_count")
        dropped = receipt.get("dropped_result_count")
        total = receipt.get("total_result_count")
        reasons = receipt.get("omission_reason_totals")
        if (
            not isinstance(retained, int) or not isinstance(dropped, int)
            or not isinstance(total, int) or not isinstance(reasons, dict)
            or total != retained + dropped
            or receipt.get("validated_result_count") != retained
            or sum(reasons.values()) != dropped
        ):
            raise CollectorError(f"acquisition receipt count mismatch: {query_id}")
        if receipt.get("acquisition_status") != "complete_with_omissions":
            raise CollectorError(f"acquisition receipt is not complete: {query_id}")
        receipts[query_id] = receipt
    executed = set(executed_query_ids)
    if not set(receipts).issubset(executed) or not set(true_tool_failures).issubset(executed):
        raise CollectorError("receipt or tool failure is not bound to an executed route")
    overlap = set(receipts) & set(true_tool_failures)
    if overlap:
        raise CollectorError(f"executed route has both receipt and tool failure: {min(overlap)}")
    missing = executed - set(receipts) - set(true_tool_failures)
    if missing:
        raise CollectorError(f"executed routes lack complete receipts: {', '.join(sorted(missing))}")
    failures = [
        {"query_id": query_id, "reason_code": true_tool_failures[query_id]}
        for query_id in sorted(true_tool_failures)
    ]
    return {
        "status": "complete_with_tool_failures" if failures else "complete",
        "executed_route_count": len(executed_query_ids),
        "complete_receipt_count": len(receipts),
        "true_tool_failure_count": len(failures),
        "true_tool_failures": failures,
    }


def ingest_tool_response(
    manifest: Mapping[str, object],
    query_id: str,
    raw: bytes,
    *,
    capture_root: Path,
    capture_base_url: str,
    recorded_at: str,
    resolver: Callable[[str, int], Sequence[str]],
    query_manifest_sha256: str | None = None,
) -> dict[str, object]:
    _validate_schema("search-acquisition-query-manifest.schema.json", manifest)
    if manifest.get("artifact_content_sha256") != content_hash_without(manifest, "artifact_content_sha256"):
        raise CollectorError("query manifest content hash mismatch")
    entries = _validate_manifest_bindings(manifest)
    _validate_timestamp(recorded_at)
    matched = [entry for entry in entries if isinstance(entry, dict) and entry.get("query_id") == query_id]
    if len(matched) != 1:
        raise CollectorError("query id is absent or duplicated in manifest")
    entry = matched[0]
    max_results = entry.get("max_results")
    if not isinstance(max_results, int):
        raise CollectorError("query result bound is malformed")
    parsed, validated, omitted = _parse_tool_response(raw, max_results, resolver)
    raw_sha256 = hashlib.sha256(raw).hexdigest()
    envelope = {
        "capture_version": 1,
        "capture_type": "company-benefits-search-tool-response",
        "query": entry,
        "executed_query": entry["query_or_locator"],
        "tool_name": "web_search",
        "recorded_at": recorded_at,
        "retrieved_at": recorded_at,
        "response_metadata": {
            key: parsed[key] for key in ("backend", "served_by")
            if isinstance(parsed.get(key), str) and 0 < len(str(parsed[key])) <= 500
        },
        "raw_tool_response_sha256": raw_sha256,
        "raw_tool_response_base64": base64.b64encode(raw).decode("ascii"),
        "validated_results": validated,
        "omitted_results": omitted,
        "review_boundary": {
            "status": "review_pending",
            "authoritative_receipts_created": False,
            "notice": "Search snippets are discovery leads only; independent source retrieval and cell review are required.",
        },
    }
    with CaptureStore(capture_root, capture_base_url, repository_root=ROOT) as store:
        capture_sha256, capture_locator = store.put(envelope)
    manifest_sha256 = query_manifest_sha256 or hashlib.sha256(_canonical_json(manifest)).hexdigest()
    if HASH_PATTERN.fullmatch(manifest_sha256) is None:
        raise CollectorError("query manifest file hash is malformed")
    acquisition = {
        "artifact_type": "company-benefits-search-tool-acquisition",
        "format_version": 2,
        "query_manifest_sha256": manifest_sha256,
        "query_id": query_id,
        "tool_name": "web_search",
        "recorded_at": recorded_at,
        "raw_tool_response_sha256": raw_sha256,
        "capture_sha256": capture_sha256,
        "capture_locator": capture_locator,
        "validated_result_count": len(validated),
        "acquisition_status": "complete_with_omissions",
        "total_result_count": len(validated) + len(omitted),
        "retained_result_count": len(validated),
        "dropped_result_count": len(omitted),
        "omission_reason_totals": dict(sorted(Counter(
            str(item["reason_code"]) for item in omitted
        ).items())),
        "review_status": "review_pending",
        "authoritative_receipts_created": False,
    }
    acquisition["artifact_content_sha256"] = content_hash_without(acquisition, "artifact_content_sha256")
    _validate_schema("search-tool-acquisition.schema.json", acquisition)
    return acquisition


def ingest_direct_page_response(
    locator: str,
    raw: bytes,
    *,
    company_id: str,
    category_id: str,
    route_id: str,
    tool_name: str,
    backend: str,
    recorded_at: str,
    capture_root: Path,
    capture_base_url: str,
    resolver: Callable[[str, int], Sequence[str]],
) -> dict[str, object]:
    """Ingest one exact direct public-page retrieval as a review-pending lead."""
    _validate_timestamp(recorded_at)
    if not all(
        isinstance(value, str) and 0 < len(value) <= 500
        for value in (company_id, category_id, route_id, tool_name, backend)
    ):
        raise CollectorError("direct acquisition binding metadata is malformed")
    if route_id not in ROUTES or canonical_route_id(route_id) != route_id:
        raise CollectorError("direct acquisition route is not canonical")
    canonical_locator = validate_public_https_url(locator, resolver=resolver)
    if not raw or len(raw) > MAX_RAW_TOOL_RESPONSE_BYTES:
        raise CollectorError("raw direct retrieval exceeds byte bound or is empty")
    try:
        response = json.loads(raw.decode("utf-8", errors="strict"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise CollectorError(f"raw direct retrieval is not strict UTF-8 JSON: {exc}") from exc
    _assert_no_secrets(response)
    results = response.get("results") if isinstance(response, dict) else None
    if not isinstance(results, list) or len(results) != 1 or not isinstance(results[0], dict):
        raise CollectorError("direct retrieval must contain exactly one result")
    result = results[0]
    url, title, content, error = (
        result.get("url"), result.get("title"), result.get("content"), result.get("error")
    )
    if error is not None or not all(isinstance(value, str) for value in (url, title, content)):
        raise CollectorError("direct retrieval result is incomplete or failed")
    assert isinstance(url, str) and isinstance(title, str) and isinstance(content, str)
    canonical_result_url = validate_public_https_url(url, resolver=resolver)
    if canonical_result_url != canonical_locator:
        raise CollectorError("direct retrieval result URL does not match exact locator")
    if not title or len(title) > MAX_DIRECT_TITLE_CHARS:
        raise CollectorError("direct retrieval title is out of bounds")
    if not content or len(content) > MAX_DIRECT_CONTENT_CHARS:
        raise CollectorError("direct retrieval content is out of bounds")
    content_bytes = content.encode("utf-8")
    raw_sha256 = hashlib.sha256(raw).hexdigest()
    cell_id = f"cell::{company_id}::{category_id}"
    attempt_id = f"attempt::{company_id}::{category_id}::{route_id}"
    envelope = {
        "capture_version": 1,
        "capture_type": "company-benefits-direct-page-response",
        "attempt_id": attempt_id,
        "cell_id": cell_id,
        "route_id": route_id,
        "locator": canonical_locator,
        "tool_name": tool_name,
        "backend": backend,
        "recorded_at": recorded_at,
        "retrieved_at": recorded_at,
        "raw_tool_response_sha256": raw_sha256,
        "raw_tool_response_base64": base64.b64encode(raw).decode("ascii"),
        "bounded_content": content,
        "bounded_content_sha256": hashlib.sha256(content_bytes).hexdigest(),
        "review_boundary": {
            "status": "review_pending",
            "authoritative_receipts_created": False,
            "notice": "Direct retrieval is an unreviewed source lead; evidence approval is separate.",
        },
    }
    with CaptureStore(capture_root, capture_base_url, repository_root=ROOT) as store:
        capture_sha256, capture_locator = store.put(envelope)
    acquisition = {
        "artifact_type": "company-benefits-direct-page-acquisition",
        "format_version": 2,
        "acquisition_status": "complete",
        "company_id": company_id,
        "category_id": category_id,
        "cell_id": cell_id,
        "route_id": route_id,
        "route_kind": ROUTES[route_id].route_kind,
        "locator": canonical_locator,
        "tool_name": tool_name,
        "backend": backend,
        "retrieved_at": recorded_at,
        "raw_tool_response_sha256": raw_sha256,
        "capture_sha256": capture_sha256,
        "capture_locator": capture_locator,
        "result": {
            "kind": "direct_source",
            "review_status": "unreviewed_lead",
            "url": canonical_result_url,
            "title": title,
            "content_sha256": hashlib.sha256(content_bytes).hexdigest(),
            "content_bytes": len(content_bytes),
        },
        "review_status": "review_pending",
        "authoritative_receipts_created": False,
    }
    acquisition["artifact_content_sha256"] = content_hash_without(
        acquisition, "artifact_content_sha256"
    )
    _validate_schema("direct-page-acquisition.schema.json", acquisition)
    return acquisition


def load_canonical_companies(path: Path) -> dict[str, CompanyAuthority]:
    try:
        protocol = json.loads((RESEARCH / "population-protocol.json").read_text(encoding="utf-8"))
        seed = protocol["canonical_selection"]["seed"]
        schema = json.loads((SCHEMA / "company.schema.json").read_text(encoding="utf-8"))
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError, json.JSONDecodeError, KeyError, TypeError) as exc:
        raise CollectorError(f"cannot load canonical companies: {exc}") from exc
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    companies: dict[str, CompanyAuthority] = {}
    for number, line in enumerate(lines, 1):
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise CollectorError(f"invalid company line {number}: {exc}") from exc
        errors = list(validator.iter_errors(value))
        if errors:
            raise CollectorError(f"company line {number} fails schema: {errors[0].message}")
        fields = (seed, value.get("jurisdiction"), value.get("registry_id"), value.get("legal_name"))
        if not all(isinstance(item, str) and item.strip() for item in fields):
            raise CollectorError(f"company line {number} lacks canonical identity")
        normalized = [unicodedata.normalize("NFC", str(item)).strip() for item in fields]
        normalized[3] = re.sub(r"\s+", " ", normalized[3])
        expected = hashlib.sha256(json.dumps(normalized, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
        if value.get("selection_hash") != expected or value.get("selected_reporting_legal_entity") != value.get("legal_name"):
            raise CollectorError(f"company line {number} has substituted authority")
        company_id = value["company_id"]
        if company_id in companies:
            raise CollectorError(f"duplicate canonical company: {company_id}")
        companies[company_id] = CompanyAuthority(
            company_id=company_id,
            jurisdiction=value["jurisdiction"],
            legal_name=value["legal_name"],
            canonical_legal_entity=value["selected_reporting_legal_entity"],
        )
    return companies


def load_batch_company_ids(path: Path, batch_id: str) -> list[str]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as exc:
        raise CollectorError(f"cannot load series batches: {exc}") from exc
    matches: list[object] = []
    for number, line in enumerate(lines, 1):
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise CollectorError(f"invalid series batch line {number}: {exc}") from exc
        if isinstance(value, dict) and value.get("batch_id") == batch_id:
            matches.append(value.get("company_ids"))
    if len(matches) != 1 or not isinstance(matches[0], list):
        raise CollectorError(f"series batch {batch_id} is absent, duplicated, or malformed")
    company_ids = matches[0]
    if not all(isinstance(item, str) for item in company_ids):
        raise CollectorError(f"series batch {batch_id} has malformed company ids")
    return [str(item) for item in company_ids]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _read_bytes(path: Path, limit: int) -> bytes:
    descriptor = -1
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise CollectorError(f"input is not a regular file: {path}")
        chunks: list[bytes] = []
        total = 0
        while total <= limit:
            chunk = os.read(descriptor, min(64 * 1024, limit + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
        raw = b"".join(chunks)
    except OSError as exc:
        raise CollectorError(f"input is not a safe regular file {path}: {exc}") from exc
    finally:
        if descriptor >= 0:
            os.close(descriptor)
    if len(raw) > limit:
        raise CollectorError(f"input exceeds byte bound: {path}")
    return raw


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    export = subparsers.add_parser("export")
    export.add_argument("requests", type=Path)
    export.add_argument("output", type=Path)
    export.add_argument("--companies", type=Path, default=RESEARCH / "companies.jsonl")
    export.add_argument("--created-at", default=None)
    ingest = subparsers.add_parser("ingest")
    ingest.add_argument("manifest", type=Path)
    ingest.add_argument("query_id")
    ingest.add_argument("raw_response", type=Path)
    ingest.add_argument("output", type=Path)
    ingest.add_argument("--capture-root", type=Path, required=True)
    ingest.add_argument("--capture-base-url", default="https://captures.invalid/search-tool/sha256/")
    ingest.add_argument("--recorded-at", default=None)
    direct = subparsers.add_parser("ingest-direct")
    direct.add_argument("locator")
    direct.add_argument("raw_response", type=Path)
    direct.add_argument("output", type=Path)
    direct.add_argument("--company-id", required=True)
    direct.add_argument("--category-id", required=True)
    direct.add_argument("--route-id", required=True)
    direct.add_argument("--tool-name", required=True)
    direct.add_argument("--backend", required=True)
    direct.add_argument("--capture-root", type=Path, required=True)
    direct.add_argument("--capture-base-url", default="https://captures.invalid/direct-page/sha256/")
    direct.add_argument("--recorded-at", default=None)
    split = subparsers.add_parser("split")
    split.add_argument("batch_id")
    split.add_argument("output_dir", type=Path)
    split.add_argument("--companies", type=Path, default=RESEARCH / "companies.jsonl")
    split.add_argument("--batches", type=Path, default=RESEARCH / "series-batches.jsonl")
    split.add_argument("--created-at", default=None)
    validate = subparsers.add_parser("validate-splits")
    validate.add_argument("batch_id")
    validate.add_argument("manifests", type=Path, nargs=5)
    validate.add_argument("--batches", type=Path, default=RESEARCH / "series-batches.jsonl")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "export":
            raw = _read_bytes(args.requests, 16 * 1024 * 1024)
            requests = json.loads(raw.decode("utf-8", errors="strict"))
            manifest = build_query_manifest(
                requests, load_canonical_companies(args.companies),
                source_requests_sha256=hashlib.sha256(raw).hexdigest(),
                created_at=args.created_at or _now(),
            )
            _validate_schema("search-acquisition-query-manifest.schema.json", manifest)
            _atomic_json(args.output, manifest)
            print(f"wrote {manifest['entry_count']} non-authoritative search queries to {args.output}")
        elif args.command == "ingest":
            manifest_raw = _read_bytes(args.manifest, 16 * 1024 * 1024)
            manifest = json.loads(manifest_raw.decode("utf-8", errors="strict"))
            raw = _read_bytes(args.raw_response, MAX_RAW_TOOL_RESPONSE_BYTES)
            acquisition = ingest_tool_response(
                manifest, args.query_id, raw,
                capture_root=args.capture_root,
                capture_base_url=args.capture_base_url,
                recorded_at=args.recorded_at or _now(),
                resolver=_default_resolver,
                query_manifest_sha256=hashlib.sha256(manifest_raw).hexdigest(),
            )
            _atomic_json(args.output, acquisition)
            print(f"wrote review-pending acquisition with {acquisition['validated_result_count']} leads to {args.output}")
        elif args.command == "ingest-direct":
            raw = _read_bytes(args.raw_response, MAX_RAW_TOOL_RESPONSE_BYTES)
            acquisition = ingest_direct_page_response(
                args.locator, raw, company_id=args.company_id,
                category_id=args.category_id, route_id=args.route_id,
                tool_name=args.tool_name, backend=args.backend,
                recorded_at=args.recorded_at or _now(), capture_root=args.capture_root,
                capture_base_url=args.capture_base_url, resolver=_default_resolver,
            )
            _atomic_json(args.output, acquisition)
            print(f"wrote review-pending direct acquisition for {acquisition['cell_id']} to {args.output}")
        elif args.command == "split":
            batches_raw = _read_bytes(args.batches, 16 * 1024 * 1024)
            company_ids = load_batch_company_ids(args.batches, args.batch_id)
            manifests = build_split_manifests(
                load_canonical_companies(args.companies), company_ids,
                batch_id=args.batch_id,
                source_requests_sha256=hashlib.sha256(batches_raw).hexdigest(),
                created_at=args.created_at or _now(),
            )
            args.output_dir.mkdir(parents=True, exist_ok=True)
            for manifest in manifests:
                _validate_schema("search-acquisition-query-manifest.schema.json", manifest)
                _validate_manifest_bindings(manifest)
                _atomic_json(args.output_dir / f'{manifest["unit_id"]}.json', manifest)
            print(f"wrote 5 disjoint units covering 25 companies and 250 cells to {args.output_dir}")
        else:
            manifests = []
            for path in args.manifests:
                value = json.loads(_read_bytes(path, 16 * 1024 * 1024).decode("utf-8", errors="strict"))
                _validate_schema("search-acquisition-query-manifest.schema.json", value)
                _validate_manifest_bindings(value)
                if value.get("artifact_content_sha256") != content_hash_without(value, "artifact_content_sha256"):
                    raise CollectorError(f"split manifest content hash mismatch: {path}")
                manifests.append(value)
            summary = validate_split_manifests(
                manifests, load_batch_company_ids(args.batches, args.batch_id)
            )
            print(json.dumps(summary, sort_keys=True))
    except (CollectorError, OSError, UnicodeError, json.JSONDecodeError) as exc:
        print(f"search bridge failed: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
