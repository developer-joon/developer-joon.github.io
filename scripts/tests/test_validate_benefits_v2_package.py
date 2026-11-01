import copy
import hashlib
import json
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
            "claim_id": "official::KR-CRN-1101112948086::leave::source::example",
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
        self.assert_invalid(pending, "community report must be approved")

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

    def test_official_claim_identity_is_canonical_company_category_source_binding(self):
        package = package_for("official_verified")
        self.assert_valid(package)

        forged = "official::KR-CRN-1101112948086::health::source::example"
        package["official_claims"][0]["claim_id"] = forged
        package["cells"][0]["official_claim_ids"] = [forged]
        self.assert_invalid(package, "noncanonical claim_id")

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
                self.assert_invalid(package, "publication eligibility")

    def test_schema_validation_uses_draft_2020_12_contracts(self):
        package = package_for("reference")
        package["sources"][0]["scope"].pop("roles")
        self.assert_invalid(package, "source-v2.schema.json")

    def test_malformed_cross_ledger_fields_fail_closed_without_traceback(self):
        package = package_for("community_report")
        package["community_reports"][0]["moderation"] = "approved"
        package["sources"][0]["scope"] = "KR"
        result = self.run_validator(package)
        self.assertEqual(1, result.returncode, result.stdout + result.stderr)
        self.assertIn("schema", result.stdout + result.stderr)
        self.assertNotIn("Traceback", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
