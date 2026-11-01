import copy
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.tests.test_company_benefits_v2_contracts import (
    base_attempt,
    base_cell,
    base_community,
    base_reference,
    base_source,
    bind_attempt,
)


ROOT = Path(__file__).resolve().parents[2]
VALIDATOR = ROOT / "scripts" / "validate-benefits-v2-package.py"
POLICY_PATH = ROOT / "docs" / "research" / "company-benefits" / "research-coverage-policies.json"


def load_validator_module():
    spec = importlib.util.spec_from_file_location("benefits_v2_validator", VALIDATOR)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


VALIDATOR_MODULE = load_validator_module()


def official_claim_id(company_id, category_id, source_ids):
    payload = json.dumps(
        {
            "company_id": company_id,
            "category_id": category_id,
            "source_ids": sorted(source_ids),
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"official::{hashlib.sha256(payload).hexdigest()}"


def source(source_id="source::example", tier="other_public_web"):
    record = base_source()
    record["source_id"] = source_id
    record["source_tier"] = tier
    return record


def attempt(route_id, result="no_result", source_ids=None):
    record = base_attempt(result)
    record["route_id"] = route_id
    record["attempt_id"] = f"attempt::KR-CRN-1101112948086::leave::{route_id}"
    kinds = {
        "official-government": "official_government",
        "company-recruiting-media": "company_recruiting_major_media",
        "other-public-web": "other_public_web",
        "community-review": "community_employee_review",
        "user-submission": "user_submission",
    }
    record["route_kind"] = kinds[route_id]
    record["source_ids"] = list(source_ids or [])
    record["raw_response_sha256"] = hashlib.sha256(route_id.encode()).hexdigest()
    record["capture_locator"] = f"https://captures.example/attempt/{route_id}"
    return bind_attempt(record)


def package_for(state="no_public_info"):
    cell = base_cell(state)
    package = {
        "coverage_policy": json.loads(POLICY_PATH.read_text(encoding="utf-8")),
        "cells": [cell],
        "attempts": [],
        "official_claims": [],
        "references": [],
        "community_reports": [],
        "sources": [],
    }
    if state == "no_public_info":
        package["attempts"] = [
            attempt("official-government"),
            attempt("company-recruiting-media"),
            attempt("other-public-web"),
        ]
        cell["attempt_ids"] = [item["attempt_id"] for item in package["attempts"]]
    elif state == "reference":
        ref = base_reference()
        src = source(tier=ref["source_tier"])
        receipt = attempt("company-recruiting-media", "source_found", [src["source_id"]])
        cell["attempt_ids"] = [receipt["attempt_id"]]
        package["attempts"] = [receipt]
        package["references"] = [ref]
        package["sources"] = [src]
    elif state == "community_report":
        report = base_community()
        src = source(report["source_id"], report["source_tier"])
        receipt = attempt("community-review", "source_found", [src["source_id"]])
        cell["attempt_ids"] = [receipt["attempt_id"]]
        package["attempts"] = [receipt]
        package["community_reports"] = [report]
        package["sources"] = [src]
    elif state == "official_verified":
        src = source(tier="official_government")
        receipt = attempt("official-government", "source_found", [src["source_id"]])
        claim = {
            "claim_id": official_claim_id(
                cell["company_id"], cell["category_id"], [src["source_id"]]
            ),
            "cell_id": cell["cell_id"],
            "company_id": cell["company_id"],
            "category_id": cell["category_id"],
            "jurisdiction": cell["jurisdiction"],
            "source_ids": [src["source_id"]],
            "source_tier": "official_government",
            "scope_status": "exact_entity",
            "scope": copy.deepcopy(src["scope"]),
            "conflict_status": "none",
            "publication_eligibility": "eligible",
        }
        cell["attempt_ids"] = [receipt["attempt_id"]]
        package["attempts"] = [receipt]
        package["official_claims"] = [claim]
        package["sources"] = [src]
    return package


def add_shared_bulk_reference_cell(package):
    shared_id = "source::approved-shared-benefits-bulk"
    package["sources"][0]["source_id"] = shared_id
    package["references"][0]["source_id"] = shared_id
    package["references"][0]["reference_id"] = (
        f"reference::KR-CRN-1101112948086::leave::{shared_id}"
    )
    package["cells"][0]["reference_ids"] = [package["references"][0]["reference_id"]]
    first_attempt = package["attempts"][0]
    first_attempt["source_ids"] = [shared_id]
    first_attempt["shared_bulk_result_binding"] = {
        "source_id": shared_id,
        "company_id": first_attempt["company_id"],
        "category_id": "leave",
        "result_locator": "row=company;category=leave",
        "result_sha256": "b" * 64,
    }
    bind_attempt(first_attempt)

    cell = copy.deepcopy(package["cells"][0])
    cell["category_id"] = "health"
    cell["cell_id"] = f"cell::{cell['company_id']}::health"
    receipt = copy.deepcopy(first_attempt)
    receipt["category_id"] = "health"
    receipt["cell_id"] = cell["cell_id"]
    receipt["attempt_id"] = f"attempt::{cell['company_id']}::health::company-recruiting-media"
    receipt["shared_bulk_result_binding"]["category_id"] = "health"
    receipt["shared_bulk_result_binding"]["result_locator"] = "row=company;category=health"
    receipt["shared_bulk_result_binding"]["result_sha256"] = "c" * 64
    bind_attempt(receipt)
    reference = copy.deepcopy(package["references"][0])
    reference["category_id"] = "health"
    reference["cell_id"] = cell["cell_id"]
    reference["reference_id"] = f"reference::{cell['company_id']}::health::{shared_id}"
    cell["attempt_ids"] = [receipt["attempt_id"]]
    cell["reference_ids"] = [reference["reference_id"]]
    package["cells"].append(cell)
    package["attempts"].append(receipt)
    package["references"].append(reference)
    return first_attempt, receipt


class BenefitsV2PackageTests(unittest.TestCase):
    def run_validator(self, package):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "package.json"
            path.write_text(json.dumps(package), encoding="utf-8")
            return subprocess.run(
                [sys.executable, str(VALIDATOR), str(path)],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
            )

    def assert_valid(self, package):
        result = self.run_validator(package)
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)

    def assert_invalid(self, package, fragment):
        result = self.run_validator(package)
        self.assertEqual(1, result.returncode, result.stdout + result.stderr)
        self.assertIn(fragment, result.stdout + result.stderr)

    def test_accepts_cross_ledger_packages_for_every_state(self):
        for state in ("official_verified", "reference", "community_report", "no_public_info"):
            with self.subTest(state=state):
                self.assert_valid(package_for(state))

    def test_no_public_info_requires_every_policy_route_with_acceptable_terminal_result(self):
        missing = package_for()
        missing["attempts"].pop()
        self.assert_invalid(missing, "missing required route")

        failed = package_for()
        failed["attempts"][0]["result"] = "access_failed"
        self.assert_invalid(failed, "unacceptable terminal result")

    def test_no_public_info_rejects_publishable_evidence_even_when_coverage_is_asserted(self):
        package = package_for()
        src = source()
        package["sources"] = [src]
        package["attempts"][2]["result"] = "source_found"
        package["attempts"][2]["source_ids"] = [src["source_id"]]
        self.assert_invalid(package, "publishable evidence")

        package = package_for()
        ref = base_reference()
        src = source(tier=ref["source_tier"])
        package["references"] = [ref]
        package["sources"] = [src]
        self.assert_invalid(package, "publishable evidence")

        downgraded = package_for()
        ref = base_reference()
        ref["scope"]["status"] = "unresolved"
        ref["publication_eligibility"] = "reference_only"
        src = source(tier=ref["source_tier"])
        src["scope_status"] = "unresolved"
        src["publication_eligibility"] = "reference_only"
        downgraded["references"] = [ref]
        downgraded["sources"] = [src]
        self.assert_invalid(downgraded, "publishable evidence")

    def test_package_policy_cannot_omit_a_required_route(self):
        package = package_for()
        package["coverage_policy"]["category_routes"]["leave"].pop()
        self.assert_invalid(package, "canonical coverage policy")

    def test_rejects_noncanonical_cell_and_attempt_identities(self):
        package = package_for()
        package["cells"][0]["cell_id"] = "cell::KR-CRN-1234567890123::health"
        self.assert_invalid(package, "noncanonical cell_id")

        package = package_for()
        package["attempts"][0]["attempt_id"] += "::copied"
        package["cells"][0]["attempt_ids"][0] = package["attempts"][0]["attempt_id"]
        self.assert_invalid(package, "noncanonical attempt_id")

    def test_rejects_missing_duplicate_and_orphan_records(self):
        missing = package_for("reference")
        missing["references"] = []
        self.assert_invalid(missing, "missing reference")

        duplicate = package_for("reference")
        duplicate["references"].append(copy.deepcopy(duplicate["references"][0]))
        self.assert_invalid(duplicate, "duplicate reference_id")

        orphan = package_for("reference")
        extra = copy.deepcopy(orphan["references"][0])
        extra["reference_id"] += "::orphan"
        orphan["references"].append(extra)
        self.assert_invalid(orphan, "orphan reference")

    def test_rejects_substituted_or_copied_attempt_bindings(self):
        substituted = package_for()
        substituted["attempts"][0]["category_id"] = "health"
        self.assert_invalid(substituted, "attempt binding mismatch")

        copied = package_for()
        copied["attempts"][0]["company_id"] = "KR-CRN-9999999999999"
        self.assert_invalid(copied, "attempt binding mismatch")

        wrong_policy = package_for()
        wrong_policy["attempts"][0]["coverage_policy_id"] = "coverage-policy-old"
        self.assert_invalid(wrong_policy, "attempt binding mismatch")

        wrong_kind = package_for()
        wrong_kind["attempts"][0]["route_kind"] = "other_public_web"
        self.assert_invalid(wrong_kind, "route kind mismatch")

        copied_reference = package_for("reference")
        copied_reference["references"][0]["company_id"] = "KR-CRN-9999999999999"
        self.assert_invalid(copied_reference, "reference binding mismatch")

    def test_receipt_content_hash_rejects_tampering(self):
        package = package_for()
        package["attempts"][0]["query_or_locator"] = "tampered query"
        self.assert_invalid(package, "receipt content hash mismatch")

    def test_rejects_copied_capture_or_response_across_cells(self):
        package = package_for("reference")
        first, second = add_shared_bulk_reference_cell(package)
        for key in ("capture_locator", "raw_response_sha256"):
            with self.subTest(key=key):
                copied = copy.deepcopy(package)
                copied["attempts"][1]["capture_locator"] = "https://captures.example/attempt/unique"
                copied["attempts"][1]["raw_response_sha256"] = "d" * 64
                copied["attempts"][1][key] = copied["attempts"][0][key]
                for receipt in copied["attempts"]:
                    receipt.pop("shared_bulk_result_binding")
                    bind_attempt(receipt)
                self.assert_invalid(copied, "receipt reuse across cells")

    def test_no_public_info_rejects_one_capture_copied_across_same_cell_routes(self):
        package = package_for()
        for receipt in package["attempts"][1:]:
            receipt["capture_locator"] = package["attempts"][0]["capture_locator"]
            receipt["raw_response_sha256"] = package["attempts"][0]["raw_response_sha256"]
            bind_attempt(receipt)
        self.assert_invalid(package, "receipt reuse across distinct routes")

    def test_allows_declared_shared_bulk_source_with_per_entity_binding(self):
        package = package_for("reference")
        add_shared_bulk_reference_cell(package)
        self.assert_valid(package)

        copied_binding = copy.deepcopy(package)
        copied_binding["attempts"][1]["shared_bulk_result_binding"] = copy.deepcopy(
            copied_binding["attempts"][0]["shared_bulk_result_binding"]
        )
        bind_attempt(copied_binding["attempts"][1])
        self.assert_invalid(copied_binding, "shared bulk result binding mismatch")

    def test_shared_bulk_binding_cannot_masquerade_as_a_different_route_kind(self):
        package = package_for("reference")
        add_shared_bulk_reference_cell(package)
        package["cells"] = package["cells"][:1]
        package["references"] = package["references"][:1]
        package["attempts"] = package["attempts"][:1]
        copied = copy.deepcopy(package["attempts"][0])
        copied["route_id"] = "official-government"
        copied["route_kind"] = "official_government"
        copied["attempt_id"] = (
            f"attempt::{copied['company_id']}::{copied['category_id']}::official-government"
        )
        bind_attempt(copied)
        package["attempts"].append(copied)
        package["cells"][0]["attempt_ids"].append(copied["attempt_id"])
        self.assert_invalid(package, "receipt reuse across distinct routes")

    def test_rejects_wrong_source_tier_and_unresolved_sources(self):
        wrong = package_for("reference")
        wrong["sources"][0]["source_tier"] = "other_public_web"
        self.assert_invalid(wrong, "source tier mismatch")

        unresolved = package_for("reference")
        unresolved["sources"] = []
        self.assert_invalid(unresolved, "missing source")

    def test_every_evidence_source_must_have_attempt_lineage_for_its_cell(self):
        for state, ledger in (
            ("official_verified", "official_claims"),
            ("reference", "references"),
            ("community_report", "community_reports"),
        ):
            with self.subTest(state=state):
                package = package_for(state)
                package["attempts"][0]["source_ids"] = ["source::unrelated"]
                bind_attempt(package["attempts"][0])
                self.assert_invalid(package, "not discovered by an attempt bound to")

    def test_official_verified_requires_exact_entity_claim_and_source_scope(self):
        for target in ("official_claims", "sources"):
            for scope_status in ("group_only", "unresolved"):
                package = package_for("official_verified")
                package[target][0]["scope_status"] = scope_status
                self.assert_invalid(package, "exact_entity")

    def test_cell_scope_and_currentness_equal_most_conservative_backing_value(self):
        scope = package_for("reference")
        scope["references"][0]["scope"]["status"] = "exact_entity"
        scope["sources"][0]["scope_status"] = "group_only"
        self.assert_invalid(scope, "cell scope_status exact_entity overstates backing scope group_only")

        currentness = package_for("reference")
        currentness["references"][0]["currentness"] = "historical"
        currentness["sources"][0]["currentness"] = "unknown"
        self.assert_invalid(currentness, "cell currentness current overstates backing currentness unknown")

        reconciled = package_for("reference")
        reconciled["references"][0]["scope"]["status"] = "exact_entity"
        reconciled["sources"][0]["scope_status"] = "group_only"
        reconciled["references"][0]["currentness"] = "historical"
        reconciled["sources"][0]["currentness"] = "unknown"
        reconciled["cells"][0]["scope_status"] = "group_only"
        reconciled["cells"][0]["currentness"] = "unknown"
        self.assert_valid(reconciled)

    def test_company_and_jurisdiction_must_match_canonical_ledger(self):
        unknown = package_for("reference")
        unknown["cells"][0]["company_id"] = "KR-CRN-9999999999999"
        self.assert_invalid(unknown, "company is absent from canonical company ledger")

        wrong_country = package_for("reference")
        wrong_country["cells"][0]["jurisdiction"] = "US"
        wrong_country["references"][0]["scope"]["countries"] = ["US"]
        wrong_country["sources"][0]["scope"]["countries"] = ["US"]
        self.assert_invalid(wrong_country, "jurisdiction differs from canonical company ledger")

    def test_exact_entity_official_evidence_must_name_canonical_legal_entity(self):
        for target in ("official_claims", "sources"):
            package = package_for("official_verified")
            package[target][0]["scope"]["legal_entities"] = ["Example Holdings Group"]
            self.assert_invalid(package, "legal entity differs from canonical company ledger")

    def test_rejects_source_less_official_claim(self):
        package = package_for("official_verified")
        package["official_claims"][0]["source_ids"] = []
        self.assert_invalid(package, "official-claim-v2.schema.json")

    def test_rejects_ineligible_official_claim_and_source(self):
        package = package_for("official_verified")
        package["official_claims"][0]["publication_eligibility"] = "ineligible"
        package["sources"][0]["publication_eligibility"] = "ineligible"
        self.assert_invalid(package, "official_verified requires eligible official evidence")

    def test_rejects_forged_reference_identity(self):
        package = package_for("reference")
        forged = "reference::KR-CRN-1101112948086::health::source::example"
        package["references"][0]["reference_id"] = forged
        package["cells"][0]["reference_ids"] = [forged]
        self.assert_invalid(package, "noncanonical reference_id")

    def test_rejects_forged_community_report_identity(self):
        package = package_for("community_report")
        forged = "community::KR-CRN-1101112948086::health::source::community-1"
        package["community_reports"][0]["community_report_id"] = forged
        package["cells"][0]["community_report_ids"] = [forged]
        self.assert_invalid(package, "noncanonical community_report_id")

    def test_rejects_jurisdiction_substitution(self):
        package = package_for("reference")
        package["references"][0]["scope"]["countries"] = ["US"]
        package["sources"][0]["scope"]["countries"] = ["US"]
        self.assert_invalid(package, "does not cover cell jurisdiction KR")

    def test_rejects_scope_substitution_between_evidence_and_source(self):
        package = package_for("reference")
        package["sources"][0]["scope"]["countries"] = ["US"]
        self.assert_invalid(package, "source scope mismatch")

        package = package_for("community_report")
        package["sources"][0]["scope"]["roles"] = ["executives"]
        self.assert_invalid(package, "source scope mismatch")

        package = package_for("official_verified")
        package["official_claims"][0]["scope"]["employment_types"] = ["contractor"]
        self.assert_invalid(package, "source scope mismatch")

    def test_community_report_must_match_cell_and_be_approved_eligible_and_frozen(self):
        mutations = (
            ("company_id", "KR-CRN-9999999999999", "community report binding mismatch"),
            ("category_id", "health", "community report binding mismatch"),
            ("cell_id", "cell::KR-CRN-1234567890123::health", "community report binding mismatch"),
            ("publication_eligibility", "ineligible", "eligible"),
        )
        for field, value, message in mutations:
            package = package_for("community_report")
            package["community_reports"][0][field] = value
            self.assert_invalid(package, message)

        pending = package_for("community_report")
        pending["community_reports"][0]["moderation"] = {"status": "pending"}
        pending["community_reports"][0].pop("frozen_snapshot")
        pending["community_reports"][0]["publication_eligibility"] = "ineligible"
        self.assert_invalid(pending, "approved")

        unfrozen = package_for("community_report")
        unfrozen["community_reports"][0].pop("frozen_snapshot")
        self.assert_invalid(unfrozen, "schema")

    def test_moderated_user_submission_has_a_valid_route_and_unmoderated_cannot_publish(self):
        approved = package_for("community_report")
        report = approved["community_reports"][0]
        report["source_tier"] = "user_submission"
        approved["sources"][0]["source_tier"] = "user_submission"
        approved["attempts"] = [attempt("user-submission", "source_found", [report["source_id"]])]
        approved["cells"][0]["attempt_ids"] = [approved["attempts"][0]["attempt_id"]]
        self.assert_valid(approved)

        pending = copy.deepcopy(approved)
        pending["community_reports"][0]["moderation"] = {"status": "pending"}
        pending["community_reports"][0].pop("frozen_snapshot")
        self.assert_invalid(pending, "community-benefit-report.schema.json")

    def test_reference_and_community_states_require_eligible_underlying_sources(self):
        reference = package_for("reference")
        reference["sources"][0]["publication_eligibility"] = "ineligible"
        self.assert_invalid(reference, "reference state requires eligible reference and source")

        ineligible_reference = package_for("reference")
        ineligible_reference["references"][0]["publication_eligibility"] = "ineligible"
        self.assert_invalid(ineligible_reference, "reference state requires eligible reference and source")

        community = package_for("community_report")
        community["sources"][0]["publication_eligibility"] = "ineligible"
        self.assert_invalid(community, "community_report requires eligible report and source")

    def test_cell_cannot_hide_conflicts_from_backing_evidence_or_sources(self):
        for state, target in (
            ("official_verified", "official_claims"),
            ("official_verified", "sources"),
            ("reference", "references"),
            ("reference", "sources"),
            ("community_report", "community_reports"),
            ("community_report", "sources"),
        ):
            with self.subTest(state=state, target=target):
                package = package_for(state)
                package[target][0]["conflict_status"] = "contradictory"
                self.assert_invalid(package, "cell conflict_status none hides backing conflict")

    def test_every_exact_entity_evidence_and_source_names_canonical_legal_entity(self):
        for state, target in (
            ("reference", "references"),
            ("reference", "sources"),
            ("community_report", "community_reports"),
            ("community_report", "sources"),
        ):
            with self.subTest(state=state, target=target):
                package = package_for(state)
                if state == "community_report":
                    package["community_reports"][0]["scope_status"] = "exact_entity"
                    package["sources"][0]["scope_status"] = "exact_entity"
                    package["cells"][0]["scope_status"] = "exact_entity"
                package[target][0]["scope"]["legal_entities"] = ["Unrelated Holdings Ltd."]
                self.assert_invalid(package, "legal entity differs from canonical company ledger")

    def test_group_evidence_remains_conservatively_labeled(self):
        package = package_for("reference")
        package["references"][0]["scope"]["status"] = "group_only"
        package["sources"][0]["scope_status"] = "group_only"
        package["cells"][0]["scope_status"] = "group_only"
        self.assert_valid(package)

        overstated = copy.deepcopy(package)
        overstated["cells"][0]["scope_status"] = "exact_entity"
        self.assert_invalid(overstated, "overstates backing scope")

    def test_unresolved_reference_is_publishable_with_conservative_cell_scope(self):
        package = package_for("reference")
        package["references"][0]["scope"]["status"] = "unresolved"
        package["sources"][0]["scope_status"] = "unresolved"
        package["cells"][0]["scope_status"] = "unresolved"
        self.assert_valid(package)

    def test_group_only_government_source_can_be_downgraded_to_reference(self):
        package = package_for("reference")
        reference = package["references"][0]
        source_record = package["sources"][0]
        reference["source_tier"] = "official_government"
        reference["scope"]["status"] = "group_only"
        reference["publication_eligibility"] = "reference_only"
        source_record["source_tier"] = "official_government"
        source_record["scope_status"] = "group_only"
        source_record["publication_eligibility"] = "reference_only"
        package["attempts"] = [
            attempt("official-government", "source_found", [source_record["source_id"]])
        ]
        package["cells"][0]["attempt_ids"] = [package["attempts"][0]["attempt_id"]]
        package["cells"][0]["scope_status"] = "group_only"
        self.assert_valid(package)

        exact = copy.deepcopy(package)
        exact["references"][0]["scope"]["status"] = "exact_entity"
        exact["sources"][0]["scope_status"] = "exact_entity"
        exact["cells"][0]["scope_status"] = "exact_entity"
        self.assert_invalid(exact, "reference-record.schema.json")

        not_downgraded = copy.deepcopy(package)
        not_downgraded["references"][0]["publication_eligibility"] = "eligible"
        not_downgraded["sources"][0]["publication_eligibility"] = "eligible"
        self.assert_invalid(not_downgraded, "reference-record.schema.json")

    def test_official_claim_identity_is_canonical_company_category_source_binding(self):
        package = package_for("official_verified")
        self.assert_valid(package)

        forged = "official::KR-CRN-1101112948086::health::source::example"
        package["official_claims"][0]["claim_id"] = forged
        package["cells"][0]["official_claim_ids"] = [forged]
        self.assert_invalid(package, "official-claim-v2.schema.json")

    def test_official_claim_identity_has_no_delimiter_collision(self):
        first = {
            "company_id": "acme",
            "category_id": "leave",
            "source_ids": ["source::a::source::b"],
        }
        second = {
            "company_id": "acme",
            "category_id": "leave",
            "source_ids": ["source::a", "source::b"],
        }
        old_first = "::".join(
            [first["company_id"], first["category_id"], *first["source_ids"]]
        )
        old_second = "::".join(
            [second["company_id"], second["category_id"], *second["source_ids"]]
        )
        self.assertEqual(old_first, old_second)
        self.assertNotEqual(
            VALIDATOR_MODULE._canonical_official_claim_id(first),
            VALIDATOR_MODULE._canonical_official_claim_id(second),
        )

    def test_conflict_status_preserves_maximum_backing_severity_for_all_combinations(self):
        ranks = {"none": 0, "disclosed": 1, "contradictory": 2}
        for state, target in (
            ("official_verified", "official_claims"),
            ("official_verified", "sources"),
            ("reference", "references"),
            ("reference", "sources"),
            ("community_report", "community_reports"),
            ("community_report", "sources"),
        ):
            for backing_status in ranks:
                for cell_status in ranks:
                    with self.subTest(state=state, target=target, backing=backing_status, cell=cell_status):
                        package = package_for(state)
                        package[target][0]["conflict_status"] = backing_status
                        package["cells"][0]["conflict_status"] = cell_status
                        if ranks[cell_status] >= ranks[backing_status]:
                            self.assert_valid(package)
                        else:
                            self.assert_invalid(package, "understates backing conflict")

    def test_publishable_discovered_source_cannot_be_dropped_from_evidence(self):
        package = package_for("reference")
        dropped = source("source::dropped", package["sources"][0]["source_tier"])
        package["sources"].append(dropped)
        package["attempts"][0]["source_ids"].append(dropped["source_id"])
        bind_attempt(package["attempts"][0])
        self.assert_invalid(package, "publishable discovered source is not linked to evidence")

        for eligibility in ("discovery_only", "ineligible"):
            with self.subTest(eligibility=eligibility):
                retained = copy.deepcopy(package)
                retained["sources"][1]["publication_eligibility"] = eligibility
                self.assert_valid(retained)

    def test_cell_publication_eligibility_must_match_state(self):
        expected = {
            "official_verified": "official_claim",
            "reference": "reference_only",
            "community_report": "community_only",
            "no_public_info": "discovery_only",
        }
        for state, eligibility in expected.items():
            with self.subTest(state=state):
                package = package_for(state)
                package["cells"][0]["publication_eligibility"] = eligibility
                self.assert_valid(package)
                package["cells"][0]["publication_eligibility"] = "ineligible"
                self.assert_invalid(package, "company-category-cell.schema.json")

    def test_schema_validation_uses_draft_2020_12_contracts(self):
        package = package_for("reference")
        package["sources"][0]["scope"].pop("roles")
        self.assert_invalid(package, "source-v2.schema.json")

    def test_malformed_cross_ledger_fields_fail_closed_without_traceback(self):
        mutations = (
            ("cells", "attempt_ids", {"not": "an array"}),
            ("cells", "state", ["reference"]),
            ("attempts", "source_ids", 7),
            ("attempts", "route_id", {"bad": "route"}),
            ("official_claims", "source_ids", {"source::example": True}),
            ("official_claims", "scope", "KR"),
            ("references", "source_id", ["source::example"]),
            ("references", "scope", "KR"),
            ("community_reports", "moderation", "approved"),
            ("community_reports", "frozen_snapshot", []),
            ("sources", "scope", "KR"),
            ("sources", "publication_eligibility", {"eligible": True}),
        )
        states = {
            "cells": "reference",
            "attempts": "reference",
            "official_claims": "official_verified",
            "references": "reference",
            "community_reports": "community_report",
            "sources": "reference",
        }
        for ledger, field, value in mutations:
            with self.subTest(ledger=ledger, field=field):
                package = package_for(states[ledger])
                package[ledger][0][field] = value
                result = self.run_validator(package)
                output = result.stdout + result.stderr
                self.assertEqual(1, result.returncode, output)
                self.assertIn("schema", output)
                self.assertNotIn("Traceback", output)

        package = package_for("reference")
        package["references"] = [None, [], "record", 42]
        result = self.run_validator(package)
        self.assertEqual(1, result.returncode, result.stdout + result.stderr)
        self.assertNotIn("Traceback", result.stdout + result.stderr)

    def test_authoritative_json_and_schema_fail_closed_without_traceback(self):
        research_relative = Path("docs/research/company-benefits")
        cases = (
            (research_relative / "companies.jsonl", "{bad json\n", "company ledger"),
            (
                research_relative / "research-coverage-policies.json",
                "[]",
                "coverage policy",
            ),
            (
                research_relative / "schema/source-v2.schema.json",
                "{bad json",
                "source-v2.schema.json",
            ),
        )
        for relative_path, contents, fragment in cases:
            with self.subTest(path=str(relative_path)):
                with tempfile.TemporaryDirectory() as directory:
                    repo = Path(directory)
                    shutil.copytree(
                        ROOT / research_relative,
                        repo / research_relative,
                    )
                    (repo / relative_path).write_text(contents, encoding="utf-8")
                    errors = VALIDATOR_MODULE.validate_package(
                        package_for("reference"), repo_root=repo
                    )
                    rendered = "\n".join(errors)
                    self.assertIn(fragment, rendered)
                    self.assertNotIn("Traceback", rendered)

    def test_authoritative_reader_rejects_symlink_leaf_parent_and_non_regular_file(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory) / "repo"
            repo.mkdir()
            safe = repo / "safe"
            safe.mkdir()
            regular = safe / "record.json"
            regular.write_text("{}", encoding="utf-8")
            self.assertEqual(
                "{}", VALIDATOR_MODULE._read_authoritative_text(repo, regular)
            )

            leaf = safe / "leaf.json"
            leaf.symlink_to(regular)
            parent = repo / "linked-parent"
            parent.symlink_to(safe, target_is_directory=True)
            directory_leaf = safe / "directory.json"
            directory_leaf.mkdir()
            fifo = safe / "fifo.json"
            os.mkfifo(fifo)
            for path in (leaf, parent / "record.json", directory_leaf, fifo):
                with self.subTest(path=str(path)):
                    with self.assertRaises(OSError):
                        VALIDATOR_MODULE._read_authoritative_text(repo, path)

    def test_authoritative_reader_rejects_paths_outside_repo(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            repo = parent / "repo"
            repo.mkdir()
            outside = parent / "outside.json"
            outside.write_text("{}", encoding="utf-8")
            with self.assertRaises(OSError):
                VALIDATOR_MODULE._read_authoritative_text(repo, outside)
            traversed = repo / "safe" / ".." / ".." / "outside.json"
            with self.assertRaises(OSError):
                VALIDATOR_MODULE._read_authoritative_text(repo, traversed)

    def test_malformed_authoritative_schema_encoding_and_policy_shape_fail_closed(self):
        research_relative = Path("docs/research/company-benefits")
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            shutil.copytree(ROOT / research_relative, repo / research_relative)

            schema = repo / research_relative / "schema/source-v2.schema.json"
            schema.write_text('{"type":"bogus"}', encoding="utf-8")
            errors = VALIDATOR_MODULE.validate_package(
                package_for("reference"), repo_root=repo
            )
            self.assertTrue(any("authoritative schema" in error for error in errors))

        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            shutil.copytree(ROOT / research_relative, repo / research_relative)
            companies = repo / research_relative / "companies.jsonl"
            companies.write_bytes(b"\xff")
            errors = VALIDATOR_MODULE.validate_package(
                package_for("reference"), repo_root=repo
            )
            self.assertTrue(any("company ledger cannot be read" in error for error in errors))

        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            shutil.copytree(ROOT / research_relative, repo / research_relative)
            policy_path = repo / research_relative / "research-coverage-policies.json"
            policy = json.loads(policy_path.read_text(encoding="utf-8"))
            policy["category_routes"]["leave"] = 7
            policy_path.write_text(json.dumps(policy), encoding="utf-8")
            package = package_for("no_public_info")
            package["coverage_policy"] = policy
            errors = VALIDATOR_MODULE.validate_package(package, repo_root=repo)
            self.assertTrue(
                any("invalid category routes" in error for error in errors), errors
            )

    def test_scope_array_order_is_semantic_but_different_members_are_rejected(self):
        reordered = package_for("reference")
        for record in (reordered["references"][0], reordered["sources"][0]):
            record["scope"]["roles"] = ["engineers", "all_employees"]
        reordered["sources"][0]["scope"]["roles"].reverse()
        self.assert_valid(reordered)

        different = copy.deepcopy(reordered)
        different["sources"][0]["scope"]["roles"] = ["sales", "all_employees"]
        self.assert_invalid(different, "source scope mismatch")

    def test_diagnostics_are_stable_across_record_order_and_hash_seed(self):
        package = package_for("reference")
        for source_id in ("source::z-dropped", "source::a-dropped"):
            dropped = source(source_id, package["sources"][0]["source_tier"])
            package["sources"].append(dropped)
            package["attempts"][0]["source_ids"].append(source_id)
        bind_attempt(package["attempts"][0])
        outputs = []
        for seed, reverse in (("1", False), ("777", True)):
            candidate = copy.deepcopy(package)
            if reverse:
                candidate["sources"].reverse()
                candidate["attempts"][0]["source_ids"].reverse()
                bind_attempt(candidate["attempts"][0])
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "package.json"
                path.write_text(json.dumps(candidate), encoding="utf-8")
                environment = os.environ.copy()
                environment["PYTHONHASHSEED"] = seed
                result = subprocess.run(
                    [sys.executable, str(VALIDATOR), str(path)],
                    cwd=ROOT,
                    env=environment,
                    text=True,
                    capture_output=True,
                    check=False,
                )
                self.assertEqual(1, result.returncode, result.stdout + result.stderr)
                outputs.append(result.stderr)
        self.assertEqual(outputs[0], outputs[1])

    def test_equal_severity_conflict_diagnostic_has_stable_evidence_tiebreak(self):
        package = package_for("official_verified")
        second = copy.deepcopy(package["sources"][0])
        second["source_id"] = "source::second"
        package["sources"].append(second)
        package["attempts"][0]["source_ids"] = ["source::example", "source::second"]
        bind_attempt(package["attempts"][0])
        package["official_claims"][0]["source_ids"] = [
            "source::example",
            "source::second",
        ]
        claim_id = official_claim_id(
            package["cells"][0]["company_id"],
            package["cells"][0]["category_id"],
            package["official_claims"][0]["source_ids"],
        )
        package["official_claims"][0]["claim_id"] = claim_id
        package["cells"][0]["official_claim_ids"] = [claim_id]
        for record in package["sources"]:
            record["conflict_status"] = "disclosed"
        first = VALIDATOR_MODULE.validate_package(package)
        package["official_claims"][0]["source_ids"].reverse()
        second_result = VALIDATOR_MODULE.validate_package(package)
        self.assertEqual(first, second_result)
        self.assertTrue(any("source::example" in error for error in first), first)


if __name__ == "__main__":
    unittest.main()
