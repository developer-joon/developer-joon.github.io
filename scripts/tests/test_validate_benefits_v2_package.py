import copy
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
    record["attempt_id"] = f"attempt::KR-CRN-1234567890123::leave::{route_id}"
    kinds = {
        "official-government": "official_government",
        "company-recruiting-media": "company_recruiting_major_media",
        "other-public-web": "other_public_web",
        "community-review": "community_employee_review",
    }
    record["route_kind"] = kinds[route_id]
    record["source_ids"] = list(source_ids or [])
    return record


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
            "claim_id": "claim-1",
            "cell_id": cell["cell_id"],
            "company_id": cell["company_id"],
            "category_id": cell["category_id"],
            "jurisdiction": cell["jurisdiction"],
            "source_ids": [src["source_id"]],
            "source_tier": "official_government",
            "scope_status": "exact_entity",
            "scope": copy.deepcopy(src["scope"]),
            "publication_eligibility": "eligible",
        }
        cell["attempt_ids"] = [receipt["attempt_id"]]
        package["attempts"] = [receipt]
        package["official_claims"] = [claim]
        package["sources"] = [src]
    return package


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

    def test_rejects_wrong_source_tier_and_unresolved_sources(self):
        wrong = package_for("reference")
        wrong["sources"][0]["source_tier"] = "other_public_web"
        self.assert_invalid(wrong, "source tier mismatch")

        unresolved = package_for("reference")
        unresolved["sources"] = []
        self.assert_invalid(unresolved, "missing source")

    def test_official_verified_requires_exact_entity_claim_and_source_scope(self):
        for target in ("official_claims", "sources"):
            for scope_status in ("group_only", "unresolved"):
                package = package_for("official_verified")
                package[target][0]["scope_status"] = scope_status
                self.assert_invalid(package, "exact_entity")

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
