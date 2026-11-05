#!/usr/bin/env python3
"""Validate a benefits-v2 evidence package across all of its ledgers."""

import argparse
import hashlib
import json
import os
import re
import stat
import sys
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from jsonschema import Draft202012Validator, FormatChecker
from jsonschema.exceptions import SchemaError


ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / "docs" / "research" / "company-benefits"
SCHEMA_ROOT = RESEARCH / "schema"
SCHEMAS = {
    "cells": "company-category-cell.schema.json",
    "attempts": "research-attempt.schema.json",
    "official_claims": "official-claim-v2.schema.json",
    "references": "reference-record.schema.json",
    "community_reports": "community-benefit-report.schema.json",
    "sources": "source-v2.schema.json",
}
ID_FIELDS = {
    "cells": "cell_id",
    "attempts": "attempt_id",
    "official_claims": "claim_id",
    "references": "reference_id",
    "community_reports": "community_report_id",
    "sources": "source_id",
}
PACKAGE_FIELDS = {"coverage_policy", *ID_FIELDS}
OFFICIAL_TIER = "official_government"
ACCEPTABLE_EMPTY_RESULTS = {"no_result", "ineligible_source"}
BENEFIT_CATEGORY_ORDER = (
    "leave", "family", "health", "growth", "housing",
    "commute", "remote", "retirement", "meals", "inclusion",
)
BENEFIT_CATEGORIES = set(BENEFIT_CATEGORY_ORDER)
MANDATORY_COVERAGE_ROUTES = {
    "official-government",
    "company-recruiting-media",
    "other-public-web",
}
SCOPE_STATUS_BEST_TO_WORST = ("exact_entity", "bounded_entity", "group_only", "unresolved")
CURRENTNESS_BEST_TO_WORST = ("current", "historical", "unknown")
CONFLICT_SEVERITY = {"none": 0, "disclosed": 1, "contradictory": 2}
CELL_PUBLICATION_ELIGIBILITY = {
    "official_verified": "official_claim",
    "reference": "reference_only",
    "community_report": "community_only",
    "no_public_info": "discovery_only",
}
COMMUNITY_HOST_SUFFIXES = (
    "blind.com", "glassdoor.com", "jobplanet.co.kr", "teamblind.com",
)
CATEGORY_NEGATIVE_PATTERNS = {
    "remote": (
        ("flexible scheduling", "flexible hours", "flextime", "유연근무", "시차출퇴근"),
        ("remote work", "work from home", "telecommut", "재택근무", "원격근무"),
    ),
    "health": (
        ("pre-employment health screening", "pre-employment medical", "채용검진", "채용 건강검진"),
        (
            "annual employee health", "employee health check", "medical insurance",
            "임직원 건강검진", "임직원에 대한 건강검진", "정기 건강검진",
            "의료 건강검진", "의료비 지원",
        ),
    ),
    "retirement": (
        ("national pension", "statutory pension", "국민연금", "4대보험", "four major social insurance"),
        ("employer retirement plan", "retirement savings", "401(k)", "퇴직연금", "퇴직금"),
    ),
    "inclusion": (
        ("csr", "donation", "charitable giving", "applicant preference", "기부", "지원자 우대", "채용 우대"),
        ("employee resource group", "erg", "workplace inclusion", "employee inclusion", "다양성", "포용", "직원 장애 지원"),
    ),
}


def _read_authoritative_text(repo_root, path):
    """Read one regular repository file without following symlinks."""
    root = Path(repo_root)
    candidate = Path(path)
    if ".." in root.parts or ".." in candidate.parts:
        raise OSError("authoritative paths must not contain parent traversal")
    root = root.absolute()
    candidate = candidate.absolute()
    try:
        relative = candidate.relative_to(root)
    except ValueError as exc:
        raise OSError(f"authoritative path escapes repository root: {candidate}") from exc
    if not relative.parts:
        raise OSError("authoritative path must name a file")
    directory_flags = os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0)
    directory_fd = os.open(root, directory_flags)
    try:
        for part in relative.parts[:-1]:
            next_fd = os.open(part, directory_flags, dir_fd=directory_fd)
            os.close(directory_fd)
            directory_fd = next_fd
        leaf = relative.parts[-1]
        metadata = os.stat(leaf, dir_fd=directory_fd, follow_symlinks=False)
        if not stat.S_ISREG(metadata.st_mode):
            raise OSError(f"authoritative path is not a regular file: {candidate}")
        file_flags = (
            os.O_RDONLY
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_NONBLOCK", 0)
        )
        file_fd = os.open(leaf, file_flags, dir_fd=directory_fd)
        try:
            if not stat.S_ISREG(os.fstat(file_fd).st_mode):
                raise OSError(f"authoritative path changed type while opening: {candidate}")
            with os.fdopen(file_fd, "r", encoding="utf-8") as handle:
                file_fd = None
                return handle.read()
        finally:
            if file_fd is not None:
                os.close(file_fd)
    finally:
        os.close(directory_fd)


def _local_schema_reference_errors(schema):
    errors = []

    def resolve(keyword, reference):
        if reference == "#":
            return
        if not reference.startswith("#/"):
            errors.append(f"external or anchored {keyword} is not allowed: {reference}")
            return
        target = schema
        for raw_part in reference[2:].split("/"):
            part = raw_part.replace("~1", "/").replace("~0", "~")
            if not isinstance(target, dict) or part not in target:
                errors.append(f"unresolved {keyword}: {reference}")
                return
            target = target[part]
        if not isinstance(target, (dict, bool)):
            errors.append(f"{keyword} target is not a schema: {reference}")

    def walk(value):
        if isinstance(value, dict):
            for keyword in ("$ref", "$dynamicRef"):
                reference = value.get(keyword)
                if isinstance(reference, str):
                    resolve(keyword, reference)
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    walk(schema)
    return sorted(set(errors))


def _schema_validators(repo_root, errors):
    schema_root = (
        Path(repo_root)
        / "docs"
        / "research"
        / "company-benefits"
        / "schema"
    )
    validators = {}
    for ledger, filename in SCHEMAS.items():
        try:
            schema = json.loads(
                _read_authoritative_text(repo_root, schema_root / filename)
            )
            Draft202012Validator.check_schema(schema)
            reference_errors = _local_schema_reference_errors(schema)
            if reference_errors:
                errors.extend(
                    f"authoritative schema {filename} has invalid reference: {error}"
                    for error in reference_errors
                )
                continue
        except (OSError, UnicodeError, json.JSONDecodeError, SchemaError, TypeError, ValueError) as exc:
            errors.append(f"authoritative schema {filename} is invalid: {exc}")
            continue
        validators[ledger] = (filename, Draft202012Validator(schema, format_checker=FormatChecker()))
    return validators


def _index(records, id_field, ledger, errors):
    result = {}
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            errors.append(f"{ledger}[{index}]: record must be an object")
            continue
        record_id = record.get(id_field)
        if not isinstance(record_id, str) or not record_id:
            errors.append(f"{ledger}[{index}]: missing {id_field}")
            continue
        if record_id in result:
            errors.append(f"duplicate {id_field}: {record_id}")
            continue
        result[record_id] = record
    return result


def _same_cell(record, cell, include_jurisdiction=False):
    fields = ["cell_id", "company_id", "category_id"]
    if include_jurisdiction:
        fields.append("jurisdiction")
    return all(record.get(field) == cell.get(field) for field in fields)


def _same_scope(left, right):
    dimensions = ("countries", "legal_entities", "roles", "employment_types")
    return (
        isinstance(left, dict)
        and isinstance(right, dict)
        and all(
            isinstance(left.get(field), list)
            and isinstance(right.get(field), list)
            and sorted(left[field]) == sorted(right[field])
            for field in dimensions
        )
    )


def _canonical_evidence_id(prefix, record):
    return f"{prefix}::{record.get('company_id')}::{record.get('category_id')}::{record.get('source_id')}"


def _canonical_official_claim_id(record):
    payload = {
        "company_id": record.get("company_id"),
        "category_id": record.get("category_id"),
        "source_ids": sorted(record.get("source_ids", [])),
    }
    encoded = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return f"official::{hashlib.sha256(encoded).hexdigest()}"


def _has_canonical_exact_entity(record, status, canonical_legal_entity):
    scope = record.get("scope") if isinstance(record, dict) else None
    return (
        status != "exact_entity"
        or canonical_legal_entity is None
        or (isinstance(scope, dict) and scope.get("legal_entities") == [canonical_legal_entity])
    )


def _covers_jurisdiction(record, jurisdiction):
    scope = record.get("scope") if isinstance(record, dict) else None
    countries = scope.get("countries") if isinstance(scope, dict) else None
    return isinstance(countries, list) and jurisdiction in countries


def _receipt_content_sha256(receipt):
    payload = {key: value for key, value in receipt.items() if key != "receipt_content_sha256"}
    encoded = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _hostname(url):
    try:
        return (urlparse(url).hostname or "").lower().rstrip(".")
    except (TypeError, ValueError):
        return ""


def _is_community_host(host):
    return any(
        host == suffix or host.endswith(f".{suffix}")
        for suffix in COMMUNITY_HOST_SUFFIXES
    )


def _source_host_tier_error(source):
    host = _hostname(source.get("url"))
    tier = source.get("source_tier")
    if tier == "community_employee_review" and not _is_community_host(host):
        return "community source tier is incompatible with host"
    return None


def _capture_sha256(locator):
    """Extract only an explicit capture SHA-256, never guess from arbitrary text."""
    if not isinstance(locator, str):
        return None
    try:
        parsed = urlparse(locator)
        query = parse_qs(parsed.query)
    except ValueError:
        return None
    for key in ("sha256", "capture_sha256"):
        values = query.get(key, [])
        if len(values) == 1 and re.fullmatch(r"[0-9a-f]{64}", values[0]):
            return values[0]
    match = re.search(r"(?:^|/)sha256/([0-9a-f]{64})(?:/|$)", parsed.path)
    return match.group(1) if match else None


def _contains_semantic_term(text, term):
    if term == "telecommut":
        return re.search(r"(?<!\w)telecommut\w*", text) is not None
    folded_term = term.casefold()
    if re.search(r"[가-힣]", folded_term):
        return folded_term in text
    return re.search(rf"(?<!\w){re.escape(folded_term)}(?!\w)", text) is not None


def _category_semantic_error(record):
    """Catch narrow known negatives; this is not automated semantic entailment."""
    rule = CATEGORY_NEGATIVE_PATTERNS.get(record.get("category_id"))
    if rule is None or record.get("publication_eligibility") not in {
        "eligible", "reference_only",
    }:
        return None
    negative_terms, counterevidence_terms = rule
    text = " ".join(
        value.casefold()
        for field in ("statement", "supporting_quote")
        for value in [record.get(field)]
        if isinstance(value, str)
    )
    if any(_contains_semantic_term(text, term) for term in negative_terms) and not any(
        _contains_semantic_term(text, term) for term in counterevidence_terms
    ):
        return "high-confidence category mismatch without explicit counterevidence"
    return None


def _company_ledger(repo_root, errors):
    companies = {}
    path = (
        Path(repo_root)
        / "docs"
        / "research"
        / "company-benefits"
        / "companies.jsonl"
    )
    try:
        lines = _read_authoritative_text(repo_root, path).splitlines()
    except (OSError, UnicodeError) as exc:
        errors.append(f"canonical company ledger cannot be read: {exc}")
        return companies
    for line_number, line in enumerate(lines, 1):
        try:
            company = json.loads(line)
        except json.JSONDecodeError as exc:
            errors.append(f"canonical company ledger line {line_number} is invalid: {exc}")
            continue
        company_id = company.get("company_id") if isinstance(company, dict) else None
        jurisdiction = company.get("jurisdiction") if isinstance(company, dict) else None
        legal_entity = (
            company.get("selected_reporting_legal_entity")
            if isinstance(company, dict)
            else None
        )
        if not isinstance(company_id, str) or not company_id:
            errors.append(f"canonical company ledger line {line_number} lacks company_id")
        elif not isinstance(jurisdiction, str) or len(jurisdiction) != 2:
            errors.append(
                f"canonical company ledger line {line_number} lacks valid jurisdiction"
            )
        elif not isinstance(legal_entity, str) or not legal_entity:
            errors.append(
                f"canonical company ledger line {line_number} lacks "
                "selected_reporting_legal_entity"
            )
        elif company_id in companies:
            errors.append(f"canonical company ledger has duplicate company_id: {company_id}")
        else:
            companies[company_id] = company
    return companies


def _valid_shared_bulk_binding(receipt, allowed_sources):
    binding = receipt.get("shared_bulk_result_binding")
    if not isinstance(binding, dict):
        return False
    source_id = binding.get("source_id")
    rule = allowed_sources.get(source_id)
    return (
        isinstance(rule, dict)
        and rule.get("require_per_entity_result_binding") is True
        and receipt.get("route_id") in rule.get("allowed_route_ids", [])
        and source_id in receipt.get("source_ids", [])
        and binding.get("company_id") == receipt.get("company_id")
        and binding.get("category_id") == receipt.get("category_id")
        and isinstance(binding.get("result_locator"), str)
        and bool(binding.get("result_locator"))
        and isinstance(binding.get("result_sha256"), str)
    )


def _most_conservative(values, best_to_worst):
    ranks = {value: index for index, value in enumerate(best_to_worst)}
    known = [value for value in values if value in ranks]
    return max(known, key=lambda value: ranks[value]) if known else None


def _coverage_policy_errors(policy):
    errors = []
    if not isinstance(policy, dict):
        return ["canonical coverage policy must be an object"]
    if not isinstance(policy.get("policy_id"), str) or not policy["policy_id"]:
        errors.append("canonical coverage policy has invalid policy_id")
    routes = policy.get("routes")
    if not isinstance(routes, dict):
        errors.append("canonical coverage policy routes must be an object")
        routes = {}
    else:
        for route_id, route in sorted(routes.items(), key=lambda item: str(item[0])):
            if not isinstance(route_id, str) or not isinstance(route, dict):
                errors.append(f"canonical coverage policy has invalid route: {route_id!r}")
            elif not isinstance(route.get("route_kind"), str):
                errors.append(f"canonical coverage policy route lacks route_kind: {route_id}")
    category_routes = policy.get("category_routes")
    if not isinstance(category_routes, dict):
        errors.append("canonical coverage policy category_routes must be an object")
    else:
        for category, route_ids in sorted(
            category_routes.items(), key=lambda item: str(item[0])
        ):
            if not isinstance(category, str) or not isinstance(route_ids, list):
                errors.append(
                    f"canonical coverage policy has invalid category routes: {category!r}"
                )
                continue
            if not route_ids:
                errors.append(
                    f"canonical coverage policy category has no required routes: {category}"
                )
            if any(not isinstance(route_id, str) for route_id in route_ids):
                errors.append(
                    f"canonical coverage policy category has non-string route: {category}"
                )
            elif len(route_ids) != len(set(route_ids)):
                errors.append(
                    f"canonical coverage policy category has duplicate route: {category}"
                )
            for route_id in route_ids:
                if isinstance(route_id, str) and route_id not in routes:
                    errors.append(
                        f"canonical coverage policy category references unknown route: "
                        f"{category}/{route_id}"
                    )
            valid_route_ids = {
                route_id for route_id in route_ids if isinstance(route_id, str)
            }
            missing_mandatory = sorted(
                MANDATORY_COVERAGE_ROUTES - valid_route_ids
            )
            if missing_mandatory:
                errors.append(
                    f"canonical coverage policy category lacks mandatory routes: "
                    f"{category}/{missing_mandatory}"
                )
        category_keys = {
            category for category in category_routes if isinstance(category, str)
        }
        if category_keys != BENEFIT_CATEGORIES:
            missing = sorted(BENEFIT_CATEGORIES - category_keys)
            extra = sorted(category_keys - BENEFIT_CATEGORIES)
            errors.append(
                "canonical coverage policy category set mismatch; "
                f"missing={missing}, extra={extra}"
            )
    shared = policy.get("shared_bulk_source_policy")
    if not isinstance(shared, dict):
        errors.append("canonical shared bulk source policy must be an object")
    else:
        if not isinstance(shared.get("default_allow_reuse"), bool):
            errors.append("canonical shared bulk default_allow_reuse must be boolean")
        shared_sources = shared.get("sources")
        if not isinstance(shared_sources, dict):
            errors.append("canonical shared bulk sources must be an object")
        else:
            for source_id, rule in sorted(
                shared_sources.items(), key=lambda item: str(item[0])
            ):
                if not isinstance(source_id, str) or not isinstance(rule, dict):
                    errors.append(
                        f"canonical shared bulk source rule is invalid: {source_id!r}"
                    )
                    continue
                allowed = rule.get("allowed_route_ids")
                if not isinstance(allowed, list) or any(
                    not isinstance(route_id, str) for route_id in allowed
                ):
                    errors.append(
                        f"canonical shared bulk source has invalid allowed_route_ids: "
                        f"{source_id}"
                    )
                elif any(route_id not in routes for route_id in allowed):
                    errors.append(
                        f"canonical shared bulk source references unknown route: {source_id}"
                    )
                if rule.get("require_per_entity_result_binding") is not True:
                    errors.append(
                        f"canonical shared bulk source must require per-entity binding: "
                        f"{source_id}"
                    )
    return errors


def _canonical_batch_company_ids(repo_root, batch_id):
    """Return one batch's authoritative company order from series-batches.jsonl."""
    path = (
        Path(repo_root) / "docs" / "research" / "company-benefits"
        / "series-batches.jsonl"
    )
    try:
        rows = [json.loads(line) for line in _read_authoritative_text(repo_root, path).splitlines()]
    except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError) as exc:
        return None, f"canonical batch manifest is invalid: {exc}"
    matches = [row for row in rows if isinstance(row, dict) and row.get("batch_id") == batch_id]
    if len(matches) != 1:
        return None, "validation context batch_id must resolve exactly once in canonical batch manifest"
    company_ids = matches[0].get("company_ids")
    if (not isinstance(company_ids, list) or len(company_ids) != 25
            or any(not isinstance(value, str) or not value for value in company_ids)
            or len(set(company_ids)) != 25):
        return None, "canonical batch manifest must contain exactly 25 unique company_ids"
    return company_ids, None


def _membership_errors(cells, validation_context, repo_root):
    """Validate an explicitly declared batch or unit Cartesian product."""
    if validation_context is None:
        return []
    if not isinstance(validation_context, dict) or set(validation_context) != {
        "mode", "batch_id", "company_ids"
    }:
        return ["validation context must contain exactly mode, batch_id, and company_ids"]
    mode = validation_context.get("mode")
    batch_id = validation_context.get("batch_id")
    company_ids = validation_context.get("company_ids")
    if mode not in {"batch", "unit"}:
        return ["validation context mode must be batch or unit"]
    if (not isinstance(company_ids, list) or not company_ids
            or any(not isinstance(company_id, str) or not company_id for company_id in company_ids)
            or len(company_ids) != len(set(company_ids))):
        return ["validation context company_ids must be a nonempty array of unique strings"]
    if not isinstance(batch_id, str) or not batch_id:
        return ["validation context batch_id must be a nonempty string"]
    canonical_company_ids, canonical_error = _canonical_batch_company_ids(repo_root, batch_id)
    if canonical_error or canonical_company_ids is None:
        return [canonical_error or "canonical batch manifest is unavailable"]
    if mode == "batch":
        if len(company_ids) != 25:
            return ["batch validation context must contain exactly 25 company_ids"]
        if company_ids != canonical_company_ids:
            return ["batch validation context does not match canonical batch manifest order"]
    else:
        if len(company_ids) > 5:
            return ["unit validation context may contain at most five company_ids"]
        start = canonical_company_ids.index(company_ids[0]) if company_ids[0] in canonical_company_ids else -1
        if (start < 0 or start // 5 != (start + len(company_ids) - 1) // 5
                or canonical_company_ids[start:start + len(company_ids)] != company_ids):
            return ["unit validation context must be a canonical ordered slice of one five-company unit"]

    expected_order = [
        (company_id, category_id)
        for company_id in company_ids
        for category_id in BENEFIT_CATEGORY_ORDER
    ]
    actual_order = [
        (cell.get("company_id"), cell.get("category_id"))
        for cell in cells
        if isinstance(cell, dict)
    ]
    expected = set(expected_order)
    actual = set(actual_order)
    errors = []
    if len(actual_order) != len(actual):
        errors.append("duplicate company/category cells are prohibited")
    missing = sorted(expected - actual)
    extra = sorted(actual - expected, key=lambda pair: (str(pair[0]), str(pair[1])))
    if missing:
        errors.append(f"missing canonical cell: {missing[0][0]}::{missing[0][1]}")
    if extra:
        errors.append(f"unexpected canonical cell: {extra[0][0]}::{extra[0][1]}")
    if len(actual_order) != len(expected_order) or actual != expected:
        dimensions = "25 companies x 10 categories" if mode == "batch" else (
            f"{len(company_ids)} companies x 10 categories"
        )
        errors.append(f"cells must equal the exact canonical {dimensions} set")
    if actual_order != expected_order:
        errors.append("cells must be in canonical company/category order")
    return errors


def validate_package(package, repo_root=ROOT, prepromotion=False, validation_context=None):
    """Return deterministic, human-readable validation errors for one package."""
    errors = []
    if not isinstance(package, dict):
        return ["package must be an object"]
    unknown = sorted(set(package) - PACKAGE_FIELDS)
    missing = sorted(PACKAGE_FIELDS - set(package))
    if unknown:
        errors.append(f"package has unknown fields: {', '.join(unknown)}")
    if missing:
        errors.append(f"package is missing fields: {', '.join(missing)}")
    for ledger in ID_FIELDS:
        if not isinstance(package.get(ledger), list):
            errors.append(f"package {ledger} must be an array")
    policy = package.get("coverage_policy")
    if not isinstance(policy, dict):
        errors.append("package coverage_policy must be an object")
    if errors:
        return errors
    policy = package["coverage_policy"]
    errors.extend(_membership_errors(package["cells"], validation_context, repo_root))

    validators = _schema_validators(repo_root, errors)
    if len(validators) != len(SCHEMAS):
        return sorted(errors)
    valid_records = {ledger: [] for ledger in ID_FIELDS}
    for ledger, (filename, validator) in validators.items():
        for index, record in enumerate(package[ledger]):
            try:
                record_errors = sorted(
                    validator.iter_errors(record), key=lambda item: list(item.path)
                )
            except Exception as exc:
                errors.append(
                    f"authoritative schema {filename} cannot validate records: "
                    f"{type(exc).__name__}: {exc}"
                )
                continue
            for error in record_errors:
                location = ".".join(str(part) for part in error.path)
                suffix = f".{location}" if location else ""
                errors.append(f"{filename}:{ledger}[{index}]{suffix}: schema {error.message}")
            if not record_errors:
                valid_records[ledger].append(record)

    indexes = {
        ledger: _index(valid_records[ledger], id_field, ledger, errors)
        for ledger, id_field in ID_FIELDS.items()
    }
    companies = _company_ledger(repo_root, errors)
    policy_path = (
        Path(repo_root)
        / "docs"
        / "research"
        / "company-benefits"
        / "research-coverage-policies.json"
    )
    try:
        canonical_policy = json.loads(_read_authoritative_text(repo_root, policy_path))
    except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError) as exc:
        errors.append(f"canonical coverage policy is invalid: {exc}")
        return sorted(errors)
    policy_errors = _coverage_policy_errors(canonical_policy)
    if policy_errors:
        errors.extend(policy_errors)
        return sorted(errors)
    if policy != canonical_policy:
        errors.append("package coverage_policy does not match canonical coverage policy")
    policy = canonical_policy
    policy_id = policy.get("policy_id")
    routes = policy.get("routes") if isinstance(policy.get("routes"), dict) else {}
    category_routes = policy.get("category_routes") if isinstance(policy.get("category_routes"), dict) else {}
    shared_policy = policy.get("shared_bulk_source_policy")
    allowed_shared_sources = (
        shared_policy.get("sources", {})
        if isinstance(shared_policy, dict)
        and shared_policy.get("default_allow_reuse") is False
        and isinstance(shared_policy.get("sources"), dict)
        else {}
    )
    if not isinstance(policy_id, str) or not policy_id:
        errors.append("coverage policy is missing policy_id")

    attempt_use = Counter()
    official_use = Counter()
    reference_use = Counter()
    community_use = Counter()
    source_use = Counter()

    for cell_id, cell in indexes["cells"].items():
        company = companies.get(cell.get("company_id"))
        if company is None:
            errors.append(f"{cell_id}: company is absent from canonical company ledger")
        elif cell.get("jurisdiction") != company.get("jurisdiction"):
            errors.append(
                f"{cell_id}: jurisdiction differs from canonical company ledger; "
                f"expected {company.get('jurisdiction')}"
            )
        expected_cell_id = f"cell::{cell.get('company_id')}::{cell.get('category_id')}"
        if cell_id != expected_cell_id:
            errors.append(f"{cell_id}: noncanonical cell_id; expected {expected_cell_id}")
        if cell.get("coverage_policy_id") != policy_id:
            errors.append(f"{cell_id}: coverage policy binding mismatch")
        expected_publication = CELL_PUBLICATION_ELIGIBILITY.get(cell.get("state"))
        if cell.get("publication_eligibility") != expected_publication:
            errors.append(
                f"{cell_id}: publication eligibility for {cell.get('state')} must be "
                f"{expected_publication}"
            )
        required_route_order = category_routes.get(cell.get("category_id"), [])
        expected_attempt_ids = sorted(
            cell.get("attempt_ids", []),
            key=lambda attempt_id: (
                required_route_order.index(
                    indexes["attempts"].get(attempt_id, {}).get("route_id")
                )
                if indexes["attempts"].get(attempt_id, {}).get("route_id")
                in required_route_order
                else len(required_route_order),
                attempt_id,
            ),
        )
        if prepromotion and cell.get("attempt_ids") != expected_attempt_ids:
            errors.append(f"{cell_id}: attempt_ids must be in canonical route order")
        for field in ("official_claim_ids", "reference_ids", "community_report_ids"):
            if prepromotion and cell.get(field) != sorted(cell.get(field, [])):
                errors.append(f"{cell_id}: {field} must be in canonical order")

        bound_attempts = []
        for attempt_id in cell.get("attempt_ids", []):
            attempt_use[attempt_id] += 1
            receipt = indexes["attempts"].get(attempt_id)
            if receipt is None:
                errors.append(f"{cell_id}: missing attempt {attempt_id}")
                continue
            bound_attempts.append(receipt)
            try:
                expected_receipt_hash = _receipt_content_sha256(receipt)
            except UnicodeError as exc:
                errors.append(
                    f"{attempt_id}: receipt cannot be canonically encoded: {exc}"
                )
                expected_receipt_hash = None
            if receipt.get("receipt_content_sha256") != expected_receipt_hash:
                errors.append(f"{attempt_id}: receipt content hash mismatch")
            if (
                "shared_bulk_result_binding" in receipt
                and not _valid_shared_bulk_binding(receipt, allowed_shared_sources)
            ):
                errors.append(f"{attempt_id}: shared bulk result binding mismatch")
            if not _same_cell(receipt, cell, include_jurisdiction=True) or receipt.get("coverage_policy_id") != policy_id:
                errors.append(f"{attempt_id}: attempt binding mismatch for {cell_id}")
            if prepromotion and receipt.get("source_ids") != sorted(receipt.get("source_ids", [])):
                errors.append(f"{attempt_id}: source_ids must be in canonical order")
            expected_attempt_id = f"attempt::{cell.get('company_id')}::{cell.get('category_id')}::{receipt.get('route_id')}"
            if attempt_id != expected_attempt_id:
                errors.append(f"{attempt_id}: noncanonical attempt_id; expected {expected_attempt_id}")
            route = routes.get(receipt.get("route_id"))
            if not isinstance(route, dict):
                errors.append(f"{attempt_id}: route is not registered by coverage policy")
            elif route.get("route_kind") != receipt.get("route_kind"):
                errors.append(f"{attempt_id}: route kind mismatch")
            for source_id in receipt.get("source_ids", []):
                source_use[source_id] += 1
                source = indexes["sources"].get(source_id)
                if source is None:
                    errors.append(f"{attempt_id}: missing source {source_id}")
                elif source.get("source_tier") != receipt.get("route_kind"):
                    errors.append(f"{attempt_id}: source tier mismatch for {source_id}")

        discovered_source_ids = {
            source_id for receipt in bound_attempts for source_id in receipt.get("source_ids", [])
        }
        linked_source_ids = set()
        backing_conflicts = []
        backing_scope_statuses = []
        backing_currentness = []
        eligible_official_evidence = False
        for claim_id in cell.get("official_claim_ids", []):
            official_use[claim_id] += 1
            claim = indexes["official_claims"].get(claim_id)
            if claim is None:
                errors.append(f"{cell_id}: missing official claim {claim_id}")
                continue
            if not _same_cell(claim, cell, include_jurisdiction=True):
                errors.append(f"{claim_id}: official claim binding mismatch for {cell_id}")
            expected_claim_id = _canonical_official_claim_id(claim)
            if claim_id != expected_claim_id:
                errors.append(f"{claim_id}: noncanonical claim_id; expected {expected_claim_id}")
            if claim.get("source_tier") != OFFICIAL_TIER:
                errors.append(f"{claim_id}: official claim source tier mismatch")
            if prepromotion and claim.get("source_ids") != sorted(claim.get("source_ids", [])):
                errors.append(f"{claim_id}: source_ids must be in canonical order")
            if claim.get("publication_eligibility") != "eligible":
                errors.append(f"{claim_id}: official claim must be publication eligible")
            backing_conflicts.append((claim_id, claim.get("conflict_status")))
            backing_scope_statuses.append(claim.get("scope_status"))
            canonical_legal_entity = (
                company.get("selected_reporting_legal_entity") if company is not None else None
            )
            if not _has_canonical_exact_entity(
                claim, claim.get("scope_status"), canonical_legal_entity
            ):
                errors.append(f"{claim_id}: legal entity differs from canonical company ledger")
            if not _covers_jurisdiction(claim, cell.get("jurisdiction")):
                errors.append(f"{claim_id}: evidence does not cover cell jurisdiction {cell.get('jurisdiction')}")
            for source_id in claim.get("source_ids", []):
                linked_source_ids.add(source_id)
                source_use[source_id] += 1
                source = indexes["sources"].get(source_id)
                if source is None:
                    errors.append(f"{claim_id}: missing source {source_id}")
                elif source.get("source_tier") != OFFICIAL_TIER:
                    errors.append(f"{claim_id}: source tier mismatch for {source_id}")
                elif not _same_scope(claim.get("scope", {}), source.get("scope", {})):
                    errors.append(f"{claim_id}: source scope mismatch for {source_id}")
                if source is not None and not _covers_jurisdiction(source, cell.get("jurisdiction")):
                    errors.append(f"{source_id}: source does not cover cell jurisdiction {cell.get('jurisdiction')}")
                if source_id not in discovered_source_ids:
                    errors.append(
                        f"{claim_id}: source {source_id} was not discovered by an attempt bound to {cell_id}"
                    )
                if source is not None:
                    backing_conflicts.append((source_id, source.get("conflict_status")))
                if source is not None:
                    backing_scope_statuses.append(source.get("scope_status"))
                    backing_currentness.append(source.get("currentness"))
                if source is not None and not _has_canonical_exact_entity(
                    source, source.get("scope_status"), canonical_legal_entity
                ):
                    errors.append(f"{source_id}: legal entity differs from canonical company ledger")
                if (
                    source is not None
                    and claim.get("publication_eligibility") == "eligible"
                    and claim.get("source_tier") == OFFICIAL_TIER
                    and claim.get("scope_status") == "exact_entity"
                    and _covers_jurisdiction(claim, cell.get("jurisdiction"))
                    and source.get("publication_eligibility") == "eligible"
                    and source.get("source_tier") == OFFICIAL_TIER
                    and source.get("scope_status") == "exact_entity"
                    and _covers_jurisdiction(source, cell.get("jurisdiction"))
                ):
                    eligible_official_evidence = True

        eligible_reference_evidence = False
        for reference_id in cell.get("reference_ids", []):
            reference_use[reference_id] += 1
            reference = indexes["references"].get(reference_id)
            if reference is None:
                errors.append(f"{cell_id}: missing reference {reference_id}")
                continue
            if not _same_cell(reference, cell):
                errors.append(f"{reference_id}: reference binding mismatch for {cell_id}")
            semantic_error = _category_semantic_error(reference) if prepromotion else None
            if semantic_error:
                errors.append(f"{reference_id}: {semantic_error}")
            expected_reference_id = _canonical_evidence_id("reference", reference)
            if reference_id != expected_reference_id:
                errors.append(f"{reference_id}: noncanonical reference_id; expected {expected_reference_id}")
            if not _covers_jurisdiction(reference, cell.get("jurisdiction")):
                errors.append(f"{reference_id}: evidence does not cover cell jurisdiction {cell.get('jurisdiction')}")
            source_id = reference.get("source_id")
            linked_source_ids.add(source_id)
            source_use[source_id] += 1
            source = indexes["sources"].get(source_id)
            if source is None:
                errors.append(f"{reference_id}: missing source {source_id}")
            elif source.get("source_tier") != reference.get("source_tier"):
                errors.append(f"{reference_id}: source tier mismatch for {source_id}")
            elif not _same_scope(reference.get("scope", {}), source.get("scope", {})):
                errors.append(f"{reference_id}: source scope mismatch for {source_id}")
            if source is not None and not _covers_jurisdiction(source, cell.get("jurisdiction")):
                errors.append(f"{source_id}: source does not cover cell jurisdiction {cell.get('jurisdiction')}")
            if source_id not in discovered_source_ids:
                errors.append(
                    f"{reference_id}: source {source_id} was not discovered by an attempt bound to {cell_id}"
                )
            backing_conflicts.append((reference_id, reference.get("conflict_status")))
            backing_scope_statuses.append(reference.get("scope", {}).get("status"))
            backing_currentness.append(reference.get("currentness"))
            canonical_legal_entity = (
                company.get("selected_reporting_legal_entity") if company is not None else None
            )
            if not _has_canonical_exact_entity(
                reference, reference.get("scope", {}).get("status"), canonical_legal_entity
            ):
                errors.append(f"{reference_id}: legal entity differs from canonical company ledger")
            if source is not None:
                backing_conflicts.append((source_id, source.get("conflict_status")))
                if not _has_canonical_exact_entity(
                    source, source.get("scope_status"), canonical_legal_entity
                ):
                    errors.append(f"{source_id}: legal entity differs from canonical company ledger")
            if source is not None:
                backing_scope_statuses.append(source.get("scope_status"))
                backing_currentness.append(source.get("currentness"))
            reference_eligibility = reference.get("publication_eligibility")
            source_eligibility = source.get("publication_eligibility") if source is not None else None
            if reference.get("source_tier") == OFFICIAL_TIER:
                if reference_eligibility != "reference_only" or source_eligibility != "reference_only":
                    errors.append(f"{reference_id}: government reference must be reference_only")
                if (
                    reference.get("scope", {}).get("status") == "exact_entity"
                    or (source is not None and source.get("scope_status") == "exact_entity")
                ):
                    errors.append(
                        f"{reference_id}: government reference must use conservative non-exact scope"
                    )
            if (
                reference_eligibility in {"eligible", "reference_only"}
                and source is not None
                and source_eligibility in {"eligible", "reference_only"}
            ):
                eligible_reference_evidence = True

        eligible_community_evidence = False
        for report_id in cell.get("community_report_ids", []):
            community_use[report_id] += 1
            report = indexes["community_reports"].get(report_id)
            if report is None:
                errors.append(f"{cell_id}: missing community report {report_id}")
                continue
            if not _same_cell(report, cell):
                errors.append(f"{report_id}: community report binding mismatch for {cell_id}")
            semantic_error = _category_semantic_error(report) if prepromotion else None
            if semantic_error:
                errors.append(f"{report_id}: {semantic_error}")
            expected_report_id = _canonical_evidence_id("community", report)
            if report_id != expected_report_id:
                errors.append(f"{report_id}: noncanonical community_report_id; expected {expected_report_id}")
            if not _covers_jurisdiction(report, cell.get("jurisdiction")):
                errors.append(f"{report_id}: evidence does not cover cell jurisdiction {cell.get('jurisdiction')}")
            if report.get("publication_eligibility") != "eligible":
                errors.append(f"{report_id}: community report must be eligible")
            moderation = report.get("moderation")
            if not isinstance(moderation, dict) or moderation.get("status") != "approved":
                errors.append(f"{report_id}: community report must be approved")
            if not isinstance(report.get("frozen_snapshot"), dict):
                errors.append(f"{report_id}: community report must have a frozen snapshot")
            source_id = report.get("source_id")
            linked_source_ids.add(source_id)
            source_use[source_id] += 1
            source = indexes["sources"].get(source_id)
            if source is None:
                errors.append(f"{report_id}: missing source {source_id}")
            elif source.get("source_tier") != report.get("source_tier"):
                errors.append(f"{report_id}: source tier mismatch for {source_id}")
            elif not _same_scope(report.get("scope", {}), source.get("scope", {})):
                errors.append(f"{report_id}: source scope mismatch for {source_id}")
            if source is not None and not _covers_jurisdiction(source, cell.get("jurisdiction")):
                errors.append(f"{source_id}: source does not cover cell jurisdiction {cell.get('jurisdiction')}")
            if source_id not in discovered_source_ids:
                errors.append(
                    f"{report_id}: source {source_id} was not discovered by an attempt bound to {cell_id}"
                )
            backing_conflicts.append((report_id, report.get("conflict_status")))
            backing_scope_statuses.append(report.get("scope_status"))
            backing_currentness.append(report.get("currentness"))
            canonical_legal_entity = (
                company.get("selected_reporting_legal_entity") if company is not None else None
            )
            if not _has_canonical_exact_entity(
                report, report.get("scope_status"), canonical_legal_entity
            ):
                errors.append(f"{report_id}: legal entity differs from canonical company ledger")
            if source is not None:
                backing_conflicts.append((source_id, source.get("conflict_status")))
                if not _has_canonical_exact_entity(
                    source, source.get("scope_status"), canonical_legal_entity
                ):
                    errors.append(f"{source_id}: legal entity differs from canonical company ledger")
            if source is not None:
                backing_scope_statuses.append(source.get("scope_status"))
                backing_currentness.append(source.get("currentness"))
            if (
                report.get("publication_eligibility") == "eligible"
                and isinstance(moderation, dict)
                and moderation.get("status") == "approved"
                and isinstance(report.get("frozen_snapshot"), dict)
                and source is not None
                and source.get("publication_eligibility") == "eligible"
            ):
                eligible_community_evidence = True

        if cell.get("state") == "reference" and not eligible_reference_evidence:
            errors.append(f"{cell_id}: reference state requires eligible reference and source")
        if cell.get("state") == "community_report" and not eligible_community_evidence:
            errors.append(f"{cell_id}: community_report requires eligible report and source")
        ranked_conflicts = [
            (evidence_id, status)
            for evidence_id, status in backing_conflicts
            if status in CONFLICT_SEVERITY
        ]
        if ranked_conflicts:
            maximum_conflict = max(
                (status for _, status in ranked_conflicts),
                key=lambda status: CONFLICT_SEVERITY[status],
            )
            evidence_id = min(
                evidence_id
                for evidence_id, status in ranked_conflicts
                if status == maximum_conflict
            )
            cell_conflict = cell.get("conflict_status")
            if CONFLICT_SEVERITY.get(cell_conflict, -1) < CONFLICT_SEVERITY[maximum_conflict]:
                if cell_conflict == "none":
                    errors.append(
                        f"{cell_id}: cell conflict_status none hides backing conflict; "
                        f"understates backing conflict {maximum_conflict} on {evidence_id}"
                    )
                else:
                    errors.append(
                        f"{cell_id}: cell conflict_status {cell_conflict} understates backing "
                        f"conflict {maximum_conflict} on {evidence_id}"
                    )

        canonical_legal_entity = (
            company.get("selected_reporting_legal_entity") if company is not None else None
        )
        for source_id in sorted(discovered_source_ids):
            discovered_source = indexes["sources"].get(source_id)
            if discovered_source is None:
                continue
            if not _has_canonical_exact_entity(
                discovered_source,
                discovered_source.get("scope_status"),
                canonical_legal_entity,
            ):
                errors.append(f"{source_id}: legal entity differs from canonical company ledger")
            if (
                discovered_source.get("publication_eligibility") in {"eligible", "reference_only"}
                and source_id not in linked_source_ids
            ):
                errors.append(
                    f"{cell_id}: publishable discovered source is not linked to evidence: "
                    f"{source_id}"
                )

        if cell.get("state") != "no_public_info":
            conservative_scope = _most_conservative(
                backing_scope_statuses, SCOPE_STATUS_BEST_TO_WORST
            )
            if conservative_scope is not None and cell.get("scope_status") != conservative_scope:
                errors.append(
                    f"{cell_id}: cell scope_status {cell.get('scope_status')} overstates backing "
                    f"scope {conservative_scope}"
                )
            conservative_currentness = _most_conservative(
                backing_currentness, CURRENTNESS_BEST_TO_WORST
            )
            if (
                conservative_currentness is not None
                and cell.get("currentness") != conservative_currentness
            ):
                errors.append(
                    f"{cell_id}: cell currentness {cell.get('currentness')} overstates backing "
                    f"currentness {conservative_currentness}"
                )

        if cell.get("state") == "official_verified":
            if not eligible_official_evidence:
                errors.append(f"{cell_id}: official_verified requires eligible official evidence")
            if cell.get("scope_status") != "exact_entity":
                errors.append(f"{cell_id}: official_verified requires exact_entity cell scope")
            for claim_id in cell.get("official_claim_ids", []):
                claim = indexes["official_claims"].get(claim_id, {})
                if claim.get("scope_status") != "exact_entity":
                    errors.append(f"{claim_id}: official_verified requires exact_entity claim scope")
                for source_id in claim.get("source_ids", []):
                    if indexes["sources"].get(source_id, {}).get("scope_status") != "exact_entity":
                        errors.append(f"{source_id}: official_verified requires exact_entity source scope")

        if cell.get("state") == "no_public_info":
            required_routes = category_routes.get(cell.get("category_id"), [])
            receipt_routes = [item.get("route_id") for item in bound_attempts]
            for route_id in required_routes:
                if route_id not in receipt_routes:
                    errors.append(f"{cell_id}: missing required route {route_id}")
            duplicates = sorted(route for route, count in Counter(receipt_routes).items() if count > 1)
            for route_id in duplicates:
                errors.append(f"{cell_id}: duplicate route receipt {route_id}")
            for receipt in bound_attempts:
                if receipt.get("route_id") in required_routes and receipt.get("result") not in ACCEPTABLE_EMPTY_RESULTS:
                    errors.append(f"{receipt.get('attempt_id')}: unacceptable terminal result for no_public_info")
                for source_id in receipt.get("source_ids", []):
                    source = indexes["sources"].get(source_id, {})
                    if source.get("publication_eligibility") in {"eligible", "reference_only"}:
                        errors.append(f"{cell_id}: no_public_info has publishable evidence {source_id}")
            evidence_ledgers = (
                (indexes["official_claims"], "official claim"),
                (indexes["references"], "reference"),
                (indexes["community_reports"], "community report"),
            )
            for records, label in evidence_ledgers:
                for record_id, record in records.items():
                    if (
                        _same_cell(record, cell)
                        and record.get("publication_eligibility") in {"eligible", "reference_only"}
                    ):
                        errors.append(f"{cell_id}: no_public_info has publishable evidence {label} {record_id}")

    ledgers_and_use = (
        ("attempts", "attempt_id", attempt_use, "attempt"),
        ("official_claims", "claim_id", official_use, "official claim"),
        ("references", "reference_id", reference_use, "reference"),
        ("community_reports", "community_report_id", community_use, "community report"),
    )
    for ledger, id_field, use, label in ledgers_and_use:
        for record_id in indexes[ledger]:
            if use[record_id] == 0:
                errors.append(f"orphan {label}: {record_id}")
            elif use[record_id] > 1:
                errors.append(f"{label} referenced by multiple cells: {record_id}")
    for source_id in indexes["sources"]:
        if source_use[source_id] == 0:
            errors.append(f"orphan source: {source_id}")

    for source_id, source in indexes["sources"].items():
        scope = source.get("scope")
        countries = scope.get("countries", []) if isinstance(scope, dict) else []
        if source.get("publication_eligibility") == "eligible" and not countries:
            errors.append(f"{source_id}: eligible source lacks country scope")
        host_tier_error = _source_host_tier_error(source) if prepromotion else None
        if host_tier_error:
            errors.append(f"{source_id}: {host_tier_error}")

    for field in ("capture_locator", "raw_response_sha256"):
        uses = defaultdict(list)
        for receipt in indexes["attempts"].values():
            uses[receipt.get(field)].append(receipt)
        for value, receipts in uses.items():
            route_ids = {receipt.get("route_id") for receipt in receipts}
            route_kinds = {receipt.get("route_kind") for receipt in receipts}
            if value is None or len(receipts) < 2:
                continue
            bindings = [receipt.get("shared_bulk_result_binding") for receipt in receipts]
            binding_keys = {
                json.dumps(binding, sort_keys=True, separators=(",", ":"))
                for binding in bindings
                if isinstance(binding, dict)
            }
            if not (
                all(_valid_shared_bulk_binding(receipt, allowed_shared_sources) for receipt in receipts)
                and len(binding_keys) == len(receipts)
                and len(route_ids) == 1
                and len(route_kinds) == 1
            ):
                if len(route_ids) > 1 or len(route_kinds) > 1:
                    errors.append(
                        f"{field} receipt reuse across distinct routes is not permitted: {value}"
                    )
                else:
                    errors.append(f"{field} receipt reuse across cells is not permitted: {value}")

    capture_hash_uses = defaultdict(list)
    for receipt in indexes["attempts"].values():
        capture_hash = _capture_sha256(receipt.get("capture_locator"))
        if capture_hash is not None:
            capture_hash_uses[capture_hash].append(receipt)
    for capture_hash, receipts in capture_hash_uses.items() if prepromotion else ():
        cells = {receipt.get("cell_id") for receipt in receipts}
        if len(cells) < 2:
            continue
        binding_keys = {
            json.dumps(
                receipt.get("shared_bulk_result_binding"),
                sort_keys=True,
                separators=(",", ":"),
            )
            for receipt in receipts
            if isinstance(receipt.get("shared_bulk_result_binding"), dict)
        }
        if not (
            all(
                _valid_shared_bulk_binding(receipt, allowed_shared_sources)
                for receipt in receipts
            )
            and len(binding_keys) == len(receipts)
        ):
            errors.append(
                f"capture hash reuse across cells is not permitted: {capture_hash}"
            )

    return sorted(errors)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    lint_group = parser.add_mutually_exclusive_group()
    lint_group.add_argument("--prepromotion", action="store_true")
    lint_group.add_argument(
        "--prepromotion-lint-only", action="store_true",
        help="run strict lint without claiming batch or unit promotion completeness",
    )
    context_group = parser.add_mutually_exclusive_group()
    context_group.add_argument(
        "--batch-manifest", type=Path,
        help="JSON manifest containing the exact 25 company_ids in acquisition order",
    )
    context_group.add_argument(
        "--unit-manifest", type=Path,
        help="JSON manifest containing the explicit unit company_ids in acquisition order",
    )
    args = parser.parse_args(argv)
    if args.prepromotion and args.batch_manifest is None and args.unit_manifest is None:
        print(
            "--prepromotion requires --batch-manifest or --unit-manifest",
            file=sys.stderr,
        )
        return 2
    try:
        package = json.loads(args.package.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        print(f"invalid package JSON: {exc}", file=sys.stderr)
        return 2
    validation_context = None
    manifest_path = args.batch_manifest or args.unit_manifest
    if manifest_path is not None:
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            print(f"invalid validation manifest JSON: {exc}", file=sys.stderr)
            return 2
        validation_context = {
            "mode": "batch" if args.batch_manifest else "unit",
            "batch_id": manifest.get("batch_id") if isinstance(manifest, dict) else None,
            "company_ids": manifest.get("company_ids") if isinstance(manifest, dict) else None,
        }
    errors = validate_package(
        package,
        prepromotion=args.prepromotion or args.prepromotion_lint_only,
        validation_context=validation_context,
    )
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    print("benefits-v2 evidence package is valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
