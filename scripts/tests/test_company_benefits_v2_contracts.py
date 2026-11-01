import copy
import hashlib
import importlib.util
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
    "official-claim-v2.schema.json",
    "reference-record.schema.json",
    "community-benefit-report.schema.json",
    "source-v2.schema.json",
    "series-progress.schema.json",
)
CATEGORIES = {
    "leave", "family", "health", "growth", "housing",
    "commute", "remote", "retirement", "meals", "inclusion",
}
HASH = "a" * 64


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


def bind_attempt(record):
    payload = {key: value for key, value in record.items() if key != "receipt_content_sha256"}
    record["receipt_content_sha256"] = hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return record


def base_cell(state="reference"):
    publication_by_state = {
        "official_verified": "official_claim",
        "reference": "reference_only",
        "community_report": "community_only",
        "no_public_info": "discovery_only",
    }
    record = {
        "cell_id": "cell::KR-CRN-1101112948086::leave",
        "company_id": "KR-CRN-1101112948086",
        "category_id": "leave",
        "jurisdiction": "KR",
        "state": state,
        "coverage_policy_id": "coverage-policy-v2",
        "attempt_ids": ["attempt::KR-CRN-1101112948086::leave::official-government"],
        "official_claim_ids": [],
        "reference_ids": ["reference::KR-CRN-1101112948086::leave::source::example"],
        "community_report_ids": [],
        "reliability": "medium",
        "currentness": "current",
        "scope_status": "exact_entity",
        "conflict_status": "none",
        "publication_eligibility": publication_by_state[state],
        "assessed_at": "2026-11-01T01:02:03Z",
    }
    if state == "official_verified":
        record["official_claim_ids"] = [
            official_claim_id(
                "KR-CRN-1101112948086", "leave", ["source::example"]
            )
        ]
        record["reference_ids"] = []
        record["reliability"] = "high"
    elif state == "community_report":
        record["reference_ids"] = []
        record["community_report_ids"] = ["community::KR-CRN-1101112948086::leave::source::community-1"]
        record["reliability"] = "low"
        record["currentness"] = "unknown"
        record["scope_status"] = "unresolved"
    elif state == "no_public_info":
        record["reference_ids"] = []
        record["reliability"] = "none"
        record["currentness"] = "unknown"
        record["scope_status"] = "unresolved"
        record["coverage_complete"] = True
    return record


def base_attempt(result="source_found"):
    return bind_attempt({
        "attempt_id": "attempt::KR-CRN-1101112948086::leave::official-government",
        "cell_id": "cell::KR-CRN-1101112948086::leave",
        "company_id": "KR-CRN-1101112948086",
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
    })


def base_reference():
    return {
        "reference_id": "reference::KR-CRN-1101112948086::leave::source::example",
        "cell_id": "cell::KR-CRN-1101112948086::leave",
        "company_id": "KR-CRN-1101112948086",
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
            "legal_entities": ["(주)인텔리안테크놀로지스"],
            "roles": ["all_employees"],
            "employment_types": ["full_time"],
        },
        "conflict_status": "none",
        "publication_eligibility": "eligible",
        "checked_at": "2026-11-01T01:02:03Z",
    }


def base_community():
    return {
        "community_report_id": "community::KR-CRN-1101112948086::leave::source::community-1",
        "cell_id": "cell::KR-CRN-1101112948086::leave",
        "company_id": "KR-CRN-1101112948086",
        "category_id": "leave",
        "source_id": "source::community-1",
        "source_tier": "community_employee_review",
        "statement": "An employee review reports paid leave.",
        "reliability": "low",
        "currentness": "unknown",
        "scope_status": "unresolved",
        "scope": {
            "countries": ["KR"],
            "legal_entities": ["(주)인텔리안테크놀로지스"],
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
            "legal_entities": ["(주)인텔리안테크놀로지스"],
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
        spec = importlib.util.spec_from_file_location(
            "company_benefits_series_progress_contract",
            ROOT / "scripts" / "company_benefits_series.py",
        )
        if spec is None or spec.loader is None:
            raise RuntimeError("cannot load company benefits series contract")
        cls.series = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.series)

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

    def progress_entry(self, batch_id, status="pending"):
        entry = {
            "batch_id": batch_id,
            "scope": "domestic" if batch_id.startswith("domestic") else "international",
            "batch_number": int(batch_id[-2:]),
            "status": status,
            "company_list_sha256": HASH,
            "claim_count": 0,
            "no_claim_count": 0,
        }
        if status == "approved":
            entry.update(approved_at="2026-11-01T00:00:00Z", reviewer_ids=["reviewer-1"])
        return entry

    def progress(self, version=None):
        entries = [
            self.progress_entry(f"{scope}-{number:02d}")
            for scope in ("domestic", "international") for number in range(1, 41)
        ]
        result = {
            "manifest_version": "1",
            "status": "in_progress",
            "company_list_sha256": HASH,
            "total_companies": 2000,
            "total_batches": 80,
            "batches": entries,
        }
        if version is not None:
            result["progress_version"] = version
        return result

    def test_progress_schema_retains_wholly_legacy_approved_ledger_as_explicit_v1(self):
        progress = self.progress("1")
        progress["batches"][0] = self.progress_entry("domestic-01", "approved")
        self.assert_valid("series-progress.schema.json", progress)

    def test_progress_schema_rejects_mixed_legacy_and_v2_approved_entries(self):
        progress = self.progress()
        progress["total_cells"] = 20000
        progress["batches"][0] = self.progress_entry("domestic-01", "approved")
        progress["batches"][1] = self.progress_entry("domestic-02", "approved")
        progress["batches"][1].update(
            cell_count=250,
            cell_set_sha256=HASH,
            v2_ledger_sha256={name: HASH for name in (
                "company-category-cells.jsonl", "research-attempts.jsonl",
                "official-claims-v2.jsonl", "reference-records.jsonl",
                "community-benefit-reports.jsonl", "sources-v2.jsonl",
            )},
        )
        self.assert_invalid("series-progress.schema.json", progress)

    def test_progress_schema_enforces_v2_approved_and_pending_shapes(self):
        progress = self.progress("2")
        progress["total_cells"] = 20000
        for entry in progress["batches"]:
            entry["cell_count"] = 0
        approved = self.progress_entry("domestic-01", "approved")
        approved.update(
            cell_count=250,
            cell_set_sha256=HASH,
            v2_ledger_sha256={name: HASH for name in (
                "company-category-cells.jsonl", "research-attempts.jsonl",
                "official-claims-v2.jsonl", "reference-records.jsonl",
                "community-benefit-reports.jsonl", "sources-v2.jsonl",
            )},
        )
        progress["batches"][0] = approved
        self.assert_valid("series-progress.schema.json", progress)
        for mutation in ("approved_count", "approved_hashes", "pending_count", "pending_hash", "incomplete_completion"):
            invalid = copy.deepcopy(progress)
            if mutation == "approved_count":
                invalid["batches"][0]["cell_count"] = 0
            elif mutation == "approved_hashes":
                invalid["batches"][0].pop("v2_ledger_sha256")
            elif mutation == "pending_count":
                invalid["batches"][1]["cell_count"] = 250
            elif mutation == "pending_hash":
                invalid["batches"][1]["cell_set_sha256"] = HASH
            else:
                invalid["status"] = "complete"
            with self.subTest(mutation=mutation):
                self.assert_invalid("series-progress.schema.json", invalid)

    def test_progress_schema_and_runtime_parser_have_identical_version_decisions(self):
        legacy = self.progress()
        explicit_legacy = self.progress("1")
        v2_pending = self.progress("2")
        v2_pending["total_cells"] = 20000
        for entry in v2_pending["batches"]:
            entry["cell_count"] = 0
        v2_approved = copy.deepcopy(v2_pending)
        v2_approved["batches"][0] = self.progress_entry("domestic-01", "approved")
        v2_approved["batches"][0].update(
            cell_count=250,
            cell_set_sha256=HASH,
            v2_ledger_sha256={name: HASH for name in (
                "company-category-cells.jsonl", "research-attempts.jsonl",
                "official-claims-v2.jsonl", "reference-records.jsonl",
                "community-benefit-reports.jsonl", "sources-v2.jsonl",
            )},
        )

        cases = {
            "valid markerless legacy": (legacy, True),
            "valid explicit legacy": (explicit_legacy, True),
            "valid v2 pending": (v2_pending, True),
            "valid v2 approved": (v2_approved, True),
            "markerless total_cells": (dict(legacy, total_cells=20000), False),
            "markerless hashes": (copy.deepcopy(legacy), False),
            "mixed legacy and v2": (copy.deepcopy(v2_approved), False),
            "wrong version": (dict(legacy, progress_version="3"), False),
            "extra top field": (dict(legacy, unexpected=True), False),
            "extra entry field": (copy.deepcopy(legacy), False),
            "legacy completion": (dict(legacy, status="complete"), True),
        }
        cases["markerless hashes"][0]["batches"][0].update(
            cell_count=250,
            cell_set_sha256=HASH,
            v2_ledger_sha256={name: HASH for name in (
                "company-category-cells.jsonl", "research-attempts.jsonl",
                "official-claims-v2.jsonl", "reference-records.jsonl",
                "community-benefit-reports.jsonl", "sources-v2.jsonl",
            )},
        )
        cases["mixed legacy and v2"][0]["batches"][1].pop("cell_count")
        cases["extra entry field"][0]["batches"][0]["unexpected"] = True

        validator = Draft202012Validator(
            self.schemas["series-progress.schema.json"], format_checker=FormatChecker()
        )
        for label, (progress, expected) in cases.items():
            with self.subTest(label=label):
                schema_accepts = not list(validator.iter_errors(progress))
                try:
                    self.series.progress_contract_version(progress)
                    runtime_accepts = True
                except ValueError:
                    runtime_accepts = False
                self.assertEqual(expected, schema_accepts, "schema decision")
                self.assertEqual(schema_accepts, runtime_accepts, "schema/runtime mismatch")

    def test_all_cell_states_are_representable(self):
        for state in ("official_verified", "reference", "community_report", "no_public_info"):
            with self.subTest(state=state):
                self.assert_valid("company-category-cell.schema.json", base_cell(state))

    def test_cell_publication_eligibility_is_state_specific_and_never_generic(self):
        expected = {
            "official_verified": "official_claim",
            "reference": "reference_only",
            "community_report": "community_only",
            "no_public_info": "discovery_only",
        }
        possible = {*expected.values(), "ineligible"}
        for state, eligibility in expected.items():
            with self.subTest(state=state):
                valid = base_cell(state)
                valid["publication_eligibility"] = eligibility
                self.assert_valid("company-category-cell.schema.json", valid)
                for invalid in possible - {eligibility}:
                    forged = base_cell(state)
                    forged["publication_eligibility"] = invalid
                    self.assert_invalid("company-category-cell.schema.json", forged)

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

    def test_official_verified_cell_retains_lower_tier_evidence_ids(self):
        record = base_cell("official_verified")
        record["reference_ids"] = ["reference::retained"]
        record["community_report_ids"] = ["community::retained"]
        self.assert_valid("company-category-cell.schema.json", record)

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
            ("receipt_content_sha256", "ABC"),
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
        for tier in ("community_employee_review", "user_submission"):
            record = base_reference()
            record["source_tier"] = tier
            self.assert_invalid("reference-record.schema.json", record)
        record = base_reference()
        record["official_claim_id"] = "claim-1"
        self.assert_invalid("reference-record.schema.json", record)

    def test_reference_rejects_malformed_values_and_accepts_conservative_publication_scope(self):
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
        for scope_status in ("bounded_entity", "group_only", "unresolved"):
            with self.subTest(scope_status=scope_status):
                conservative = base_reference()
                conservative["scope"]["status"] = scope_status
                self.assert_valid("reference-record.schema.json", conservative)

    def test_government_reference_requires_explicit_downgrade_and_non_exact_scope(self):
        record = base_reference()
        record["source_tier"] = "official_government"
        record["scope"]["status"] = "group_only"
        record["publication_eligibility"] = "reference_only"
        self.assert_valid("reference-record.schema.json", record)

        exact = copy.deepcopy(record)
        exact["scope"]["status"] = "exact_entity"
        self.assert_invalid("reference-record.schema.json", exact)

        not_downgraded = copy.deepcopy(record)
        not_downgraded["publication_eligibility"] = "eligible"
        self.assert_invalid("reference-record.schema.json", not_downgraded)

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
        self.assertEqual(
            {"route_kind": "user_submission", "required": False},
            policy["routes"]["user-submission"],
        )
        self.assertNotIn(
            "user-submission",
            {route for routes in policy["category_routes"].values() for route in routes},
        )
        self.assertEqual(
            ["exact_entity", "bounded_entity", "group_only", "unresolved"],
            policy["cell_evidence_aggregation"]["scope_status_best_to_worst"],
        )
        self.assertEqual(
            ["current", "historical", "unknown"],
            policy["cell_evidence_aggregation"]["currentness_best_to_worst"],
        )
        for category, routes in policy["category_routes"].items():
            with self.subTest(category=category):
                self.assertGreaterEqual(len(routes), 3)
                self.assertEqual(len(routes), len(set(routes)))
                self.assertTrue(all(route in policy["routes"] for route in routes))


if __name__ == "__main__":
    unittest.main()
