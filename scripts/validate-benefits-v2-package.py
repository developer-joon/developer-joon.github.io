#!/usr/bin/env python3
"""Validate a benefits-v2 evidence package across all of its ledgers."""

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker


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


def _schema_validators():
    validators = {}
    for ledger, filename in SCHEMAS.items():
        schema = json.loads((SCHEMA_ROOT / filename).read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(schema)
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
        and all(left.get(field) == right.get(field) for field in dimensions)
    )


def _canonical_evidence_id(prefix, record):
    return f"{prefix}::{record.get('company_id')}::{record.get('category_id')}::{record.get('source_id')}"


def _covers_jurisdiction(record, jurisdiction):
    scope = record.get("scope") if isinstance(record, dict) else None
    countries = scope.get("countries") if isinstance(scope, dict) else None
    return isinstance(countries, list) and jurisdiction in countries


def validate_package(package):
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

    validators = _schema_validators()
    for ledger, (filename, validator) in validators.items():
        for index, record in enumerate(package[ledger]):
            for error in sorted(validator.iter_errors(record), key=lambda item: list(item.path)):
                location = ".".join(str(part) for part in error.path)
                suffix = f".{location}" if location else ""
                errors.append(f"{filename}:{ledger}[{index}]{suffix}: schema {error.message}")

    indexes = {
        ledger: _index(package[ledger], id_field, ledger, errors)
        for ledger, id_field in ID_FIELDS.items()
    }
    canonical_policy = json.loads((RESEARCH / "research-coverage-policies.json").read_text(encoding="utf-8"))
    if policy != canonical_policy:
        errors.append("package coverage_policy does not match canonical coverage policy")
    policy = canonical_policy
    policy_id = policy.get("policy_id")
    routes = policy.get("routes") if isinstance(policy.get("routes"), dict) else {}
    category_routes = policy.get("category_routes") if isinstance(policy.get("category_routes"), dict) else {}
    if not isinstance(policy_id, str) or not policy_id:
        errors.append("coverage policy is missing policy_id")

    attempt_use = Counter()
    official_use = Counter()
    reference_use = Counter()
    community_use = Counter()
    source_use = Counter()

    for cell_id, cell in indexes["cells"].items():
        expected_cell_id = f"cell::{cell.get('company_id')}::{cell.get('category_id')}"
        if cell_id != expected_cell_id:
            errors.append(f"{cell_id}: noncanonical cell_id; expected {expected_cell_id}")
        if cell.get("coverage_policy_id") != policy_id:
            errors.append(f"{cell_id}: coverage policy binding mismatch")

        bound_attempts = []
        for attempt_id in cell.get("attempt_ids", []):
            attempt_use[attempt_id] += 1
            receipt = indexes["attempts"].get(attempt_id)
            if receipt is None:
                errors.append(f"{cell_id}: missing attempt {attempt_id}")
                continue
            bound_attempts.append(receipt)
            if not _same_cell(receipt, cell, include_jurisdiction=True) or receipt.get("coverage_policy_id") != policy_id:
                errors.append(f"{attempt_id}: attempt binding mismatch for {cell_id}")
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

        eligible_official_evidence = False
        for claim_id in cell.get("official_claim_ids", []):
            official_use[claim_id] += 1
            claim = indexes["official_claims"].get(claim_id)
            if claim is None:
                errors.append(f"{cell_id}: missing official claim {claim_id}")
                continue
            if not _same_cell(claim, cell, include_jurisdiction=True):
                errors.append(f"{claim_id}: official claim binding mismatch for {cell_id}")
            if claim.get("source_tier") != OFFICIAL_TIER:
                errors.append(f"{claim_id}: official claim source tier mismatch")
            if claim.get("publication_eligibility") != "eligible":
                errors.append(f"{claim_id}: official claim must be publication eligible")
            if not _covers_jurisdiction(claim, cell.get("jurisdiction")):
                errors.append(f"{claim_id}: evidence does not cover cell jurisdiction {cell.get('jurisdiction')}")
            for source_id in claim.get("source_ids", []):
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

        for reference_id in cell.get("reference_ids", []):
            reference_use[reference_id] += 1
            reference = indexes["references"].get(reference_id)
            if reference is None:
                errors.append(f"{cell_id}: missing reference {reference_id}")
                continue
            if not _same_cell(reference, cell):
                errors.append(f"{reference_id}: reference binding mismatch for {cell_id}")
            expected_reference_id = _canonical_evidence_id("reference", reference)
            if reference_id != expected_reference_id:
                errors.append(f"{reference_id}: noncanonical reference_id; expected {expected_reference_id}")
            if not _covers_jurisdiction(reference, cell.get("jurisdiction")):
                errors.append(f"{reference_id}: evidence does not cover cell jurisdiction {cell.get('jurisdiction')}")
            source_id = reference.get("source_id")
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

        for report_id in cell.get("community_report_ids", []):
            community_use[report_id] += 1
            report = indexes["community_reports"].get(report_id)
            if report is None:
                errors.append(f"{cell_id}: missing community report {report_id}")
                continue
            if not _same_cell(report, cell):
                errors.append(f"{report_id}: community report binding mismatch for {cell_id}")
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
                    if source.get("publication_eligibility") == "eligible":
                        errors.append(f"{cell_id}: no_public_info has publishable evidence {source_id}")
            evidence_ledgers = (
                (indexes["official_claims"], "official claim"),
                (indexes["references"], "reference"),
                (indexes["community_reports"], "community report"),
            )
            for records, label in evidence_ledgers:
                for record_id, record in records.items():
                    if _same_cell(record, cell) and record.get("publication_eligibility") == "eligible":
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

    return errors


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    args = parser.parse_args(argv)
    try:
        package = json.loads(args.package.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"invalid package JSON: {exc}", file=sys.stderr)
        return 2
    errors = validate_package(package)
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    print("benefits-v2 evidence package is valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
