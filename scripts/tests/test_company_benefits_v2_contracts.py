import copy
import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker


ROOT = Path(__file__).resolve().parents[2]
RESEARCH = ROOT / "docs" / "research" / "company-benefits"
SCHEMA = RESEARCH / "schema"
CONTRACT_FILES = (
    "company-category-cell.schema.json",
    "research-attempt.schema.json",
    "reference-record.schema.json",
    "community-benefit-report.schema.json",
    "source-v2.schema.json",
)
CATEGORIES = {
    "leave", "family", "health", "growth", "housing",
    "commute", "remote", "retirement", "meals", "inclusion",
}
HASH = "a" * 64


def base_cell(state="reference"):
    record = {
        "cell_id": "cell::KR-CRN-1234567890123::leave",
        "company_id": "KR-CRN-1234567890123",
        "category_id": "leave",
        "jurisdiction": "KR",
        "state": state,
        "coverage_policy_id": "coverage-policy-v2",
        "attempt_ids": ["attempt::KR-CRN-1234567890123::leave::official-government"],
        "official_claim_ids": [],
        "reference_ids": ["reference::KR-CRN-1234567890123::leave::1"],
        "community_report_ids": [],
        "reliability": "medium",
        "currentness": "current",
        "scope_status": "exact_entity",
        "conflict_status": "none",
        "publication_eligibility": "eligible",
        "assessed_at": "2026-11-01T01:02:03Z",
    }
    if state == "official_verified":
        record["official_claim_ids"] = ["claim-1"]
        record["reference_ids"] = []
        record["reliability"] = "high"
    elif state == "community_report":
        record["reference_ids"] = []
        record["community_report_ids"] = ["community::KR-CRN-1234567890123::leave::1"]
        record["reliability"] = "low"
    elif state == "no_public_info":
        record["reference_ids"] = []
        record["reliability"] = "none"
        record["currentness"] = "unknown"
        record["scope_status"] = "unresolved"
        record["publication_eligibility"] = "eligible"
        record["coverage_complete"] = True
    return record


def base_attempt(result="source_found"):
    return {
        "attempt_id": "attempt::KR-CRN-1234567890123::leave::official-government",
        "cell_id": "cell::KR-CRN-1234567890123::leave",
        "company_id": "KR-CRN-1234567890123",
        "category_id": "leave",
        "jurisdiction": "KR",
        "coverage_policy_id": "coverage-policy-v2",
        "route_id": "official-government",
        "route_kind": "official_government",
        "query_or_locator": "site:go.kr example leave benefit",
        "started_at": "2026-11-01T01:00:00Z",
        "completed_at": "2026-11-01T01:01:00Z",
        "result": result,
        "source_ids": ["source::example"] if result == "source_found" else [],
        "raw_response_sha256": HASH,
        "capture_locator": "https://captures.example/attempt/1",
        "collector_version": "benefits-collector/2.0.0",
    }


def base_reference():
    return {
        "reference_id": "reference::KR-CRN-1234567890123::leave::1",
        "cell_id": "cell::KR-CRN-1234567890123::leave",
        "company_id": "KR-CRN-1234567890123",
        "category_id": "leave",
        "source_id": "source::example",
        "source_tier": "company_recruiting_major_media",
        "statement": "The recruiting page describes paid leave.",
        "supporting_quote": "Paid leave is available to eligible employees.",
        "source_locator": "https://careers.example/benefits#leave",
        "reliability": "medium",
        "currentness": "current",
        "scope": {
            "status": "exact_entity",
            "countries": ["KR"],
            "legal_entities": ["Example Korea Ltd."],
            "roles": ["all_employees"],
            "employment_types": ["full_time"],
        },
        "conflict_status": "none",
        "publication_eligibility": "eligible",
        "checked_at": "2026-11-01T01:02:03Z",
    }


def base_community():
    return {
        "community_report_id": "community::KR-CRN-1234567890123::leave::1",
        "cell_id": "cell::KR-CRN-1234567890123::leave",
        "company_id": "KR-CRN-1234567890123",
        "category_id": "leave",
        "source_id": "source::community-1",
        "source_tier": "community_employee_review",
        "statement": "An employee review reports paid leave.",
        "reliability": "low",
        "currentness": "unknown",
        "scope_status": "unresolved",
        "scope": {
            "countries": ["KR"],
            "legal_entities": ["Example Korea Ltd."],
            "roles": ["all_employees"],
            "employment_types": ["full_time"],
        },
        "conflict_status": "none",
        "moderation": {
            "status": "approved",
            "reviewer_id": "moderator::1",
            "reviewed_at": "2026-11-01T01:02:03Z",
            "decision_sha256": HASH,
        },
        "frozen_snapshot": {
            "locator": "https://snapshots.example/community/1",
            "content_sha256": HASH,
            "frozen_at": "2026-11-01T01:01:03Z",
        },
        "publication_eligibility": "eligible",
    }


def base_source():
    return {
        "source_id": "source::example",
        "source_tier": "other_public_web",
        "title": "Example benefits page",
        "url": "https://example.com/benefits",
        "retrieved_at": "2026-11-01T01:02:03Z",
        "content_sha256": HASH,
        "reliability": "medium",
        "currentness": "current",
        "scope_status": "exact_entity",
        "scope": {
            "countries": ["KR"],
            "legal_entities": ["Example Korea Ltd."],
            "roles": ["all_employees"],
            "employment_types": ["full_time"],
        },
        "conflict_status": "none",
        "publication_eligibility": "eligible",
    }


class V2ContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schemas = {}
        for name in CONTRACT_FILES:
            path = SCHEMA / name
            if path.exists():
                schema = json.loads(path.read_text(encoding="utf-8"))
                Draft202012Validator.check_schema(schema)
                cls.schemas[name] = schema

    def validate(self, name, instance):
        if name not in self.schemas:
            self.skipTest(f"missing contract: {name}")
        errors = list(Draft202012Validator(
            self.schemas[name], format_checker=FormatChecker()
        ).iter_errors(instance))
        return errors

    def assert_valid(self, name, instance):
        errors = self.validate(name, instance)
        self.assertEqual([], errors, "\n".join(error.message for error in errors))

    def assert_invalid(self, name, instance):
        self.assertTrue(self.validate(name, instance), f"unexpectedly valid: {instance}")

    def test_contract_files_exist(self):
        missing = [name for name in CONTRACT_FILES if not (SCHEMA / name).is_file()]
        if not (RESEARCH / "research-coverage-policies.json").is_file():
            missing.append("research-coverage-policies.json")
        self.assertEqual([], missing)

    def test_all_cell_states_are_representable(self):
        for state in ("official_verified", "reference", "community_report", "no_public_info"):
            with self.subTest(state=state):
                self.assert_valid("company-category-cell.schema.json", base_cell(state))

    def test_cell_rejects_unknown_fields_and_enums(self):
        unknown = base_cell()
        unknown["score"] = 99
        self.assert_invalid("company-category-cell.schema.json", unknown)
        bad_enum = base_cell()
        bad_enum["state"] = "not_researched"
        self.assert_invalid("company-category-cell.schema.json", bad_enum)

    def test_cell_enforces_cross_state_evidence(self):
        cases = []
        official = base_cell("official_verified")
        official["official_claim_ids"] = []
        cases.append(official)
        reference = base_cell("reference")
        reference["official_claim_ids"] = ["claim-1"]
        cases.append(reference)
        community = base_cell("community_report")
        community["reference_ids"] = ["reference::forbidden"]
        cases.append(community)
        no_info = base_cell("no_public_info")
        no_info["community_report_ids"] = ["community::forbidden"]
        cases.append(no_info)
        for record in cases:
            self.assert_invalid("company-category-cell.schema.json", record)

    def test_official_verified_cell_requires_exact_entity_scope(self):
        for scope_status in ("group_only", "unresolved"):
            record = base_cell("official_verified")
            record["scope_status"] = scope_status
            self.assert_invalid("company-category-cell.schema.json", record)

    def test_no_public_info_requires_policy_attempt_and_complete_bindings(self):
        for field in ("coverage_policy_id", "attempt_ids", "coverage_complete"):
            record = base_cell("no_public_info")
            record.pop(field)
            self.assert_invalid("company-category-cell.schema.json", record)
        empty = base_cell("no_public_info")
        empty["attempt_ids"] = []
        self.assert_invalid("company-category-cell.schema.json", empty)
        false_claim = base_cell("no_public_info")
        false_claim["coverage_complete"] = False
        self.assert_invalid("company-category-cell.schema.json", false_claim)

    def test_attempt_accepts_category_bound_receipt(self):
        self.assert_valid("research-attempt.schema.json", base_attempt())

    def test_attempt_rejects_malformed_ids_hash_timestamp_url_and_unknown_field(self):
        mutations = (
            ("attempt_id", "attempt 1"),
            ("category_id", "vacation"),
            ("raw_response_sha256", "ABC"),
            ("completed_at", "yesterday"),
            ("capture_locator", "not a url"),
            ("capture_locator", "https://"),
        )
        for field, value in mutations:
            record = base_attempt()
            record[field] = value
            self.assert_invalid("research-attempt.schema.json", record)
        record = base_attempt()
        record["unexpected"] = True
        self.assert_invalid("research-attempt.schema.json", record)

    def test_attempt_result_controls_source_bindings(self):
        found = base_attempt()
        found["source_ids"] = []
        self.assert_invalid("research-attempt.schema.json", found)
        empty = base_attempt("no_result")
        self.assert_valid("research-attempt.schema.json", empty)
        empty["source_ids"] = ["source::invented"]
        self.assert_invalid("research-attempt.schema.json", empty)

    def test_reference_is_strict_and_keeps_official_claims_separate(self):
        self.assert_valid("reference-record.schema.json", base_reference())
        for tier in ("official_government", "community_employee_review", "user_submission"):
            record = base_reference()
            record["source_tier"] = tier
            self.assert_invalid("reference-record.schema.json", record)
        record = base_reference()
        record["official_claim_id"] = "claim-1"
        self.assert_invalid("reference-record.schema.json", record)

    def test_reference_rejects_malformed_values_and_ineligible_publication(self):
        for field, value in (
            ("reference_id", "bad id"),
            ("source_locator", "http://insecure.example"),
            ("source_locator", "https://"),
            ("checked_at", "2026-99-99"),
            ("reliability", "certain"),
        ):
            record = base_reference()
            record[field] = value
            self.assert_invalid("reference-record.schema.json", record)
        unresolved = base_reference()
        unresolved["scope"]["status"] = "unresolved"
        self.assert_invalid("reference-record.schema.json", unresolved)

    def test_community_publication_requires_approval_and_frozen_snapshot(self):
        self.assert_valid("community-benefit-report.schema.json", base_community())
        pending = base_community()
        pending["moderation"] = {"status": "pending"}
        self.assert_invalid("community-benefit-report.schema.json", pending)
        missing_snapshot = base_community()
        missing_snapshot.pop("frozen_snapshot")
        self.assert_invalid("community-benefit-report.schema.json", missing_snapshot)

    def test_nonpublished_community_report_may_await_moderation(self):
        pending = base_community()
        pending["moderation"] = {"status": "pending"}
        pending.pop("frozen_snapshot")
        pending["publication_eligibility"] = "ineligible"
        self.assert_valid("community-benefit-report.schema.json", pending)

    def test_community_rejects_bad_tier_hash_url_and_unknown_field(self):
        for path, value in (
            (("source_tier",), "other_public_web"),
            (("moderation", "decision_sha256"), "bad"),
            (("frozen_snapshot", "locator"), "file:///private/snapshot"),
            (("frozen_snapshot", "locator"), "https://"),
            (("frozen_snapshot", "content_sha256"), "F" * 64),
        ):
            record = base_community()
            target = record
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = value
            self.assert_invalid("community-benefit-report.schema.json", record)
        record = base_community()
        record["moderation"]["note"] = "unknown"
        self.assert_invalid("community-benefit-report.schema.json", record)

    def test_community_requires_strict_scope_dimensions(self):
        for field in ("countries", "legal_entities", "roles", "employment_types"):
            record = base_community()
            record["scope"].pop(field)
            self.assert_invalid("community-benefit-report.schema.json", record)
        record = base_community()
        record["scope"]["countries"] = ["Korea"]
        self.assert_invalid("community-benefit-report.schema.json", record)

    def test_source_v2_represents_every_tier_and_quality_dimension(self):
        tiers = (
            "official_government", "company_recruiting_major_media", "other_public_web",
            "community_employee_review", "user_submission",
        )
        for tier in tiers:
            record = base_source()
            record["source_tier"] = tier
            self.assert_valid("source-v2.schema.json", record)

    def test_source_v2_rejects_unknowns_and_malformed_values(self):
        for field, value in (
            ("source_tier", "social_media"),
            ("url", "http://example.com"),
            ("url", "https://"),
            ("content_sha256", "0x123"),
            ("retrieved_at", "2026-11-01"),
            ("conflict_status", "ignored"),
        ):
            record = base_source()
            record[field] = value
            self.assert_invalid("source-v2.schema.json", record)
        record = base_source()
        record["extra"] = "forbidden"
        self.assert_invalid("source-v2.schema.json", record)

    def test_source_v2_requires_strict_scope_dimensions(self):
        for field in ("countries", "legal_entities", "roles", "employment_types"):
            record = base_source()
            record["scope"].pop(field)
            self.assert_invalid("source-v2.schema.json", record)
        record = base_source()
        record["scope"]["employment_types"] = []
        self.assert_invalid("source-v2.schema.json", record)

    def test_coverage_policy_is_category_specific_and_fail_closed(self):
        path = RESEARCH / "research-coverage-policies.json"
        if not path.is_file():
            self.skipTest("missing coverage policy")
        policy = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual("coverage-policy-v2", policy["policy_id"])
        self.assertEqual(CATEGORIES, set(policy["category_routes"]))
        self.assertFalse(policy["allow_generator_synthesized_receipts"])
        self.assertEqual("all_required_routes_have_valid_receipts", policy["completion_rule"])
        for category, routes in policy["category_routes"].items():
            with self.subTest(category=category):
                self.assertGreaterEqual(len(routes), 3)
                self.assertEqual(len(routes), len(set(routes)))
                self.assertTrue(all(route in policy["routes"] for route in routes))


if __name__ == "__main__":
    unittest.main()
