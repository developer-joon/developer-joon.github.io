import copy
import importlib.util
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from scripts.tests.benefits_test_fixture import FrozenFixture, PANEL, jsonl_bytes, sha

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "verify-company-benefits-ledger.py"


def load_module():
    spec = importlib.util.spec_from_file_location("benefits_verifier", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class VerifierTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.verifier = load_module()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.fixture = FrozenFixture(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def errors(self):
        return self.verifier.verify_workspace(self.root, as_of=date(2026, 10, 29))

    def assert_error(self, needle):
        errors = self.errors()
        self.assertTrue(any(needle in error for error in errors), errors[:20])

    def rewrite_company_everywhere(self, scope, index, mutate):
        company_id = self.fixture.selected[scope][index]["company_id"]
        for collection in (self.fixture.eligible[scope], self.fixture.selected[scope], self.fixture.current[scope], self.fixture.companies):
            for record in collection:
                if record["company_id"] == company_id:
                    mutate(record)
        self.fixture.write_all()

    def test_realistic_fully_frozen_approved_fixture_passes(self):
        self.assertEqual([], self.errors())

    def test_approval_without_required_freeze_artifacts_fails(self):
        (self.root / "population" / "freeze-manifest.json").unlink()
        self.assert_error("missing required freeze manifest")
        FrozenFixture(self.root)
        (self.root / "population" / "effective-selection-manifest.json").unlink()
        self.assert_error("missing required effective manifest")

    def test_freeze_manifest_recomputes_hashes_and_counts_from_bytes(self):
        manifest_path = self.root / "population" / "freeze-manifest.json"
        manifest = json.loads(manifest_path.read_text())
        entry = next(item for item in manifest["artifacts"] if item["path"].endswith("domestic-selected.jsonl"))
        entry["sha256"] = "0" * 64
        entry["count"] = 999
        self.fixture.write_json("population/freeze-manifest.json", manifest)
        errors = self.errors()
        self.assertTrue(any("hash mismatch" in error for error in errors), errors[:20])
        self.assertTrue(any("count mismatch" in error for error in errors), errors[:20])

    def test_ledgers_require_exactly_1000_unique_canonical_records(self):
        self.fixture.selected["domestic"] = self.fixture.selected["domestic"][:-1]
        self.fixture.current["domestic"] = list(self.fixture.selected["domestic"])
        self.fixture.companies = self.fixture.current["domestic"] + self.fixture.current["international"]
        self.fixture.write_all()
        self.assert_error("domestic selected must contain exactly 1000")

        self.fixture = FrozenFixture(self.root)
        selected = list(self.fixture.selected["domestic"])
        selected[1] = copy.deepcopy(selected[0])
        self.fixture.selected["domestic"] = selected
        self.fixture.current["domestic"] = list(selected)
        self.fixture.companies = selected + self.fixture.current["international"]
        self.fixture.write_all()
        self.assert_error("duplicate company_id")

    def test_canonical_hash_order_and_first_1000_selection_are_enforced(self):
        records = list(self.fixture.eligible["domestic"])
        records[0], records[1] = records[1], records[0]
        self.fixture.eligible["domestic"] = records
        self.fixture.write_all()
        self.assert_error("canonical order")

        self.fixture = FrozenFixture(self.root)
        self.fixture.selected["domestic"][-1] = self.fixture.eligible["domestic"][1000]
        self.fixture.current["domestic"] = list(self.fixture.selected["domestic"])
        self.fixture.companies = self.fixture.current["domestic"] + self.fixture.current["international"]
        self.fixture.write_all()
        self.assert_error("first 1000 eligible")

    def test_entity_panel_threshold_fiscal_age_and_scale_source_rules_fail(self):
        def mutate(company):
            company["incorporation_country"] = "KR"
            company["scale_metric"]["value"] = 1
            company["scale_metric"]["original_value"] = 1
            company["scale_metric"]["fiscal_year_end"] = "2020-01-01"
            company["scale_metric"]["source_ids"] = ["benefit-source"]
        self.rewrite_company_everywhere("international", 0, mutate)
        errors = self.errors()
        for needle in ("incorporation", "below threshold", "fiscal age", "does not support revenue"):
            self.assertTrue(any(needle in error for error in errors), (needle, errors[:30]))

    def test_non_threshold_currency_requires_original_value_and_fx_proof(self):
        def mutate(company):
            metric = company["scale_metric"]
            metric.update({"currency": "USD", "value": 2000000000, "original_currency": "EUR", "original_value": 1800000000, "conversion": None})
        self.rewrite_company_everywhere("international", 0, mutate)
        self.assert_error("requires FX conversion proof")

    def test_fx_conversion_value_year_and_supported_proof_are_enforced(self):
        def mutate(company):
            metric = company["scale_metric"]
            metric.update({"original_currency": "EUR", "original_value": 1800000000, "conversion": {"rate": 2, "source_id": "benefit-source", "year": 2024, "converted_value": 123}})
        self.rewrite_company_everywhere("international", 0, mutate)
        errors = self.errors()
        for needle in ("FX conversion source", "FX conversion year", "FX converted value", "does not support local_currency_per_USD"):
            self.assertTrue(any(needle in error for error in errors), (needle, errors[:30]))

    def test_parent_or_policy_owner_exception_requires_contract_and_entity_evidence(self):
        def mutate(company):
            company["ultimate_parent"] = "Parent Corp"
            company["benefit_policy_owner"] = "Parent Corp"
            company["related_company_exception"] = None
        self.rewrite_company_everywhere("international", 0, mutate)
        self.assert_error("related-company exception contract")

    def test_source_required_audit_fields_and_claim_specific_eligibility_fail(self):
        source = self.fixture.sources[1]
        source.pop("title")
        source.pop("locator")
        source["http_verification"]["status"] = 403
        source["http_verification"]["access_wall"] = "login"
        source["reuse_decision"] = "unknown"
        source["decisions"]["retention"] = "unknown"
        source["supported_fields"] = ["revenue"]
        self.fixture.write_jsonl("source-registry.jsonl", self.fixture.sources)
        errors = self.errors()
        for needle in ("missing source title", "missing source locator", "HTTP status", "access wall", "reuse", "retention", "does not support benefit_claim"):
            self.assertTrue(any(needle in error for error in errors), (needle, errors[:30]))

    def test_undated_current_accepts_null_or_omitted_date_only_with_recent_check(self):
        claim = self.fixture.claims[0]
        claim["publication_date"] = None
        self.fixture.write_jsonl("benefit-claims.jsonl", self.fixture.claims)
        self.assertEqual([], self.errors())
        claim.pop("publication_date")
        self.fixture.write_jsonl("benefit-claims.jsonl", self.fixture.claims)
        self.assertEqual([], self.errors())
        claim["checked_at"] = "2026-08-01"
        self.fixture.write_jsonl("benefit-claims.jsonl", self.fixture.claims)
        self.assert_error("undated source was not checked within 30 days")

    def test_only_approved_independent_reviews_unlock_claims(self):
        self.fixture.reviews[0]["decision"] = "changes_required"
        self.fixture.write_jsonl("reviews.jsonl", self.fixture.reviews)
        self.assert_error("missing approved independent review")

    def test_initial_projection_is_byte_identical_and_event_chain_is_verified(self):
        initial = self.root / "population" / "domestic-initial-effective-selected.jsonl"
        initial.write_bytes(initial.read_bytes() + b"\n")
        self.fixture.refresh_manifests()
        self.assert_error("initial effective ledger must be byte-identical")

        self.fixture = FrozenFixture(self.root)
        old = self.fixture.current["domestic"]
        replacement = self.fixture.eligible["domestic"][1000]
        new = old[:-1] + [replacement]
        new = sorted(new, key=lambda item: item["selection_hash"])
        previous_bytes = jsonl_bytes(old)
        next_bytes = jsonl_bytes(new)
        self.fixture.current["domestic"] = new
        self.fixture.companies = new + self.fixture.current["international"]
        self.fixture.events = [{"event_id": "event-1", "scope": "domestic", "excluded_company_id": old[-1]["company_id"], "replacement_company_id": replacement["company_id"], "previous_effective_sha256": sha(previous_bytes), "next_effective_sha256": "0" * 64, "approved_by": "owner", "approved_at": "2026-10-22T00:00:00Z"}]
        self.fixture.write_all()
        self.assert_error("next_effective_sha256 mismatch")

    def test_replacement_must_use_next_unused_canonical_candidate(self):
        old = self.fixture.current["domestic"]
        replacement = self.fixture.eligible["domestic"][1000]
        new = sorted(old[:-1] + [replacement], key=lambda item: item["selection_hash"])
        event = {"event_id": "event-1", "scope": "domestic", "excluded_company_id": old[-1]["company_id"], "replacement_company_id": replacement["company_id"], "previous_effective_sha256": sha(jsonl_bytes(old)), "next_effective_sha256": sha(jsonl_bytes(new)), "approved_by": "owner", "approved_at": "2026-10-22T00:00:00Z"}
        self.fixture.current["domestic"] = new
        self.fixture.companies = new + self.fixture.current["international"]
        self.fixture.events = [event]
        self.fixture.write_all()
        self.assertEqual([], self.errors())

        self.fixture = FrozenFixture(self.root)
        wrong = self.fixture.eligible["domestic"][999]
        event["replacement_company_id"] = wrong["company_id"]
        self.fixture.events = [event]
        self.fixture.write_all()
        self.assert_error("next unused canonical candidate")

    def test_protocol_requires_exact_panel_domestic_union_thresholds_and_registered_endpoints(self):
        self.fixture.protocol["scopes"]["international"]["country_panel"] = PANEL[:-1]
        self.fixture.protocol["scopes"]["domestic"]["candidate_source_ids"] = []
        self.fixture.protocol["thresholds"]["domestic_non_financial"]["currency"] = "USD"
        self.fixture.protocol["registered_sources"]["US"][0]["endpoint"] = "https://evil.example/source"
        self.fixture.write_all()
        errors = self.errors()
        for needle in ("fixed 18-country panel", "domestic candidate-source union", "threshold", "registered source endpoint"):
            self.assertTrue(any(needle in error for error in errors), (needle, errors[:30]))

    def test_repository_protocol_and_schema_pin_exact_registered_source_endpoints(self):
        research = ROOT / "docs" / "research" / "company-benefits"
        protocol = json.loads((research / "population-protocol.json").read_text())
        sources = [json.loads(line) for line in (research / "source-registry.jsonl").read_text().splitlines() if line]
        source_map = {source["source_id"]: source for source in sources}
        source_errors = []
        self.verifier.validate_sources(sources, source_errors)
        self.assertEqual([], source_errors)
        self.assertEqual(["KR"], protocol["scopes"]["domestic"]["jurisdictions"])
        self.assertEqual(PANEL, protocol["scopes"]["international"]["country_panel"])
        self.assertEqual({"KR", *PANEL}, set(protocol["registered_sources"]))
        for entries in protocol["registered_sources"].values():
            for entry in entries:
                self.assertEqual(source_map[entry["source_id"]]["url"], entry["endpoint"])
        for source in sources:
            for field in ("title", "locator", "supporting_quote", "content_sha256"):
                self.assertTrue(source.get(field), (source["source_id"], field))
        schema = json.loads((research / "schema" / "population-protocol.schema.json").read_text())
        self.assertEqual(PANEL, schema["$defs"]["country_panel"]["const"])

    def test_repository_protocol_remains_blocked_and_cli_contract_fails(self):
        research = ROOT / "docs" / "research" / "company-benefits"
        errors = self.verifier.verify_workspace(research, as_of=date(2026, 10, 29))
        self.assertTrue(any("protocol status is blocked" in error for error in errors), errors[:20])
        for name in self.verifier.PROHIBITED_POPULATION_FILES:
            self.assertFalse(any(research.rglob(name)), name)


if __name__ == "__main__":
    unittest.main()
