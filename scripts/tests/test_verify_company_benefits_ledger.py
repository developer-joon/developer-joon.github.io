import copy
import importlib.util
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from scripts.tests.benefits_test_fixture import FrozenFixture, PANEL, sha

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
        self.approved_freeze_anchors = self.fixture.approved_freeze_anchors()

    def tearDown(self):
        self.tmp.cleanup()

    def errors(self, anchors=None):
        anchors = self.approved_freeze_anchors if anchors is None else anchors
        return self.verifier.verify_workspace(self.root, as_of=date(2026, 10, 29), approved_freeze_anchors=anchors)

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

    def test_complete_synthetic_contract_fixture_passes(self):
        self.assertEqual([], self.errors())

    def test_approved_protocol_requires_immutable_literal_freeze_anchor(self):
        errors = self.verifier.verify_workspace(self.root, as_of=date(2026, 10, 29))
        self.assertTrue(any("immutable freeze approval anchor" in error for error in errors), errors[:20])
        self.assertEqual([], self.errors())

    def test_self_consistent_frozen_scale_drift_fails_against_old_anchor(self):
        old_anchor = self.fixture.approved_freeze_anchors()
        company_id = self.fixture.selected["domestic"][0]["company_id"]
        for collection in (self.fixture.eligible["domestic"], self.fixture.selected["domestic"], self.fixture.current["domestic"], self.fixture.companies):
            target = next(item for item in collection if item["company_id"] == company_id)
            target["scale_metric"]["value"] += 1
            target["scale_metric"]["original_value"] += 1
        self.fixture.write_all()
        errors = self.errors(anchors=old_anchor)
        self.assertTrue(any("immutable freeze approval anchor" in error for error in errors), errors[:30])

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
            company["scale_metric"]["source_ids"] = [self.fixture.benefit_source["source_id"]]
        self.rewrite_company_everywhere("international", 0, mutate)
        errors = self.errors()
        for needle in ("incorporation", "below threshold", "fiscal age", "does not support revenue"):
            self.assertTrue(any(needle in error for error in errors), (needle, errors[:30]))

    def test_company_requires_row_bound_scale_and_employer_evidence(self):
        def mutate(company):
            company.pop("employer_evidence", None)
            company["scale_evidence"]["registry_id"] = "wrong-registry"
            company["scale_evidence"]["value"] = company["scale_metric"]["value"] + 1
        self.rewrite_company_everywhere("domestic", 0, mutate)
        errors = self.errors()
        for needle in ("employer_evidence", "scale evidence registry_id", "scale evidence value"):
            self.assertTrue(any(needle in error for error in errors), (needle, errors[:40]))

    def test_evidence_source_url_hash_period_and_legal_entity_must_match(self):
        def mutate(company):
            company["employer_evidence"].update(
                url="https://evil.example/evidence",
                content_sha256="b" * 64,
                legal_name="Different Legal Entity",
                fiscal_period_end="2024-12-31",
            )
        self.rewrite_company_everywhere("international", 0, mutate)
        errors = self.errors()
        for needle in ("employer evidence URL", "employer evidence content hash", "employer evidence legal_name", "employer evidence fiscal period"):
            self.assertTrue(any(needle in error for error in errors), (needle, errors[:40]))

    def test_non_threshold_currency_requires_original_value_and_fx_proof(self):
        def mutate(company):
            metric = company["scale_metric"]
            metric.update({"currency": "USD", "value": 2000000000, "original_currency": "EUR", "original_value": 1800000000, "conversion": None})
        self.rewrite_company_everywhere("international", 0, mutate)
        self.assert_error("requires FX conversion proof")

    def test_fx_conversion_value_year_and_supported_proof_are_enforced(self):
        def mutate(company):
            metric = company["scale_metric"]
            metric.update({"original_currency": "EUR", "original_value": 1800000000, "conversion": {"rate": 2, "source_id": self.fixture.benefit_source["source_id"], "year": 2024, "converted_value": 123}})
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

    def test_related_entity_exception_resolves_eligible_entity_specific_sources(self):
        company_id = self.fixture.selected["domestic"][0]["company_id"]
        for collection in (self.fixture.eligible["domestic"], self.fixture.selected["domestic"], self.fixture.current["domestic"], self.fixture.companies):
            target = next(item for item in collection if item["company_id"] == company_id)
            target["benefit_policy_owner"] = "Parent Corp"
            target["related_company_exception"] = {
                "separate_scale_source_ids": ["nonexistent-scale"],
                "entity_specific_benefit_source_ids": ["nonexistent-benefit"],
                "no_inheritance": True,
            }
        self.fixture.write_all()
        errors = self.errors()
        self.assertTrue(any("related-company scale source" in error for error in errors), errors[:30])
        self.assertTrue(any("approved entity claim" in error for error in errors), errors[:30])

    def test_source_required_audit_fields_and_claim_specific_eligibility_fail(self):
        source = self.fixture.benefit_source
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

    def test_schema_invalid_self_asserted_social_source_cannot_prove_historical_claim(self):
        source = self.fixture.benefit_source
        source.update({"source_type": "social_media", "owner": "", "url": "http://social.example/post", "evidence_eligibility": "A", "checked_at": "2026-12-01T00:00:00Z"})
        source["http_verification"]["final_url"] = source["url"]
        self.fixture.claims[0].update(status="past", current_validity="historical", publication_date="2020-01-01")
        self.fixture.write_jsonl("source-registry.jsonl", self.fixture.sources)
        self.fixture.write_jsonl("benefit-claims.jsonl", self.fixture.claims)
        errors = self.errors()
        for needle in ("source_type", "owner", "HTTPS", "future", "official"):
            self.assertTrue(any(needle in error for error in errors), (needle, errors[:40]))

    def test_evidence_hash_provenance_is_verified_or_independently_reviewed(self):
        source = self.fixture.benefit_source
        source["hash_provenance"] = "retained_file"
        source["evidence_path"] = "outside.bin"
        source["content_sha256"] = "0" * 64
        self.fixture.write_jsonl("source-registry.jsonl", self.fixture.sources)
        self.assert_error("retained evidence")

        self.fixture = FrozenFixture(self.root)
        evidence_root = self.root / "lawful-evidence"
        evidence_root.mkdir()
        payload = b"lawfully retained official evidence"
        (evidence_root / "benefit.bin").write_bytes(payload)
        for source in self.fixture.sources:
            if "benefit_claim" not in source["supported_fields"]:
                continue
            source.update(hash_provenance="retained_file", evidence_path="benefit.bin", content_sha256=sha(payload))
            source["decisions"].update(retention="allowed", snapshot="allowed")
        for claim in self.fixture.claims:
            claim["content_sha256"] = sha(payload)
        self.fixture.write_all()
        self.assertEqual([], self.verifier.verify_workspace(self.root, as_of=date(2026, 10, 29), evidence_root=evidence_root, approved_freeze_anchors=self.approved_freeze_anchors))

        self.fixture = FrozenFixture(self.root)
        self.fixture.reviews[0]["quote_entailment_confirmed"] = False
        self.fixture.write_jsonl("reviews.jsonl", self.fixture.reviews)
        self.assert_error("quote entailment")

    def test_schema_additional_properties_are_rejected(self):
        self.fixture.benefit_source["self_asserted_grade"] = "A"
        self.fixture.write_jsonl("source-registry.jsonl", self.fixture.sources)
        self.assert_error("schema additional property self_asserted_grade")

    def test_scale_source_must_be_pinned_for_company_jurisdiction_and_actually_used(self):
        us_source = self.fixture.source_for_jurisdiction["US"]
        self.rewrite_company_everywhere("domestic", 0, lambda company: company["scale_metric"].update(source_ids=[us_source]))
        self.assert_error("pinned scale source for jurisdiction KR")

        self.fixture = FrozenFixture(self.root)
        company_id = self.fixture.selected["domestic"][0]["company_id"]
        for collection in (self.fixture.eligible["domestic"], self.fixture.selected["domestic"], self.fixture.current["domestic"], self.fixture.companies):
            target = next(item for item in collection if item["company_id"] == company_id)
            target["benefit_policy_owner"] = "Parent Corp"
            target["related_company_exception"] = {"separate_scale_source_ids": [self.fixture.source_for_jurisdiction["US"]], "entity_specific_benefit_source_ids": [self.fixture.benefit_source["source_id"]], "no_inheritance": True}
        self.fixture.benefit_source["applicable_legal_entities"] = [self.fixture.selected["domestic"][0]["legal_name"]]
        self.fixture.write_all()
        self.assert_error("actual scale source_ids")

    def test_related_parent_only_claim_does_not_apply_to_selected_employer(self):
        company = self.fixture.selected["domestic"][0]
        company_id = company["company_id"]
        for collection in (self.fixture.eligible["domestic"], self.fixture.selected["domestic"], self.fixture.current["domestic"], self.fixture.companies):
            target = next(item for item in collection if item["company_id"] == company_id)
            target["benefit_policy_owner"] = "Parent Corp"
            target["related_company_exception"] = {"separate_scale_source_ids": list(target["scale_metric"]["source_ids"]), "entity_specific_benefit_source_ids": [self.fixture.benefit_source["source_id"]], "no_inheritance": True}
        claim = next(item for item in self.fixture.claims if item["company_id"] == company_id)
        claim["application_scope"]["legal_entities"] = ["Parent Corp"]
        self.fixture.benefit_source["applicable_legal_entities"] = ["Parent Corp"]
        self.fixture.write_all()
        self.assert_error("selected employer legal entity")

    def test_all_audit_timestamps_are_bounded_and_ordered(self):
        self.fixture.benefit_source["checked_at"] = "2026-11-01T00:00:00Z"
        self.fixture.benefit_source["retrieved_at"] = "2026-11-01T00:00:00Z"
        self.fixture.reviews[0]["reviewed_at"] = "2026-10-19T00:00:00Z"
        self.fixture.write_all()
        errors = self.errors()
        self.assertTrue(any("source checked_at is in the future" in error for error in errors), errors[:40])
        self.assertTrue(any("review must follow" in error for error in errors), errors[:40])

        self.fixture = FrozenFixture(self.root)
        event, new = self.fixture.replacement_event()
        event["occurred_at"] = "2026-11-01T00:00:00Z"
        event["exclusion_details"] = "x"
        self.fixture.current["domestic"] = new
        self.fixture.companies = new + self.fixture.current["international"]
        self.fixture.events = [event]
        self.fixture.write_all()
        errors = self.errors()
        self.assertTrue(any("event occurred_at is in the future" in error for error in errors), errors[:40])
        self.assertTrue(any("meaningful exclusion_details" in error for error in errors), errors[:40])

    def test_unknown_search_ids_must_be_resolved_official_accessible_and_scoped(self):
        claim = self.fixture.claims[0]
        claim.update({"status": "unknown", "evidence_grade": "none", "source_ids": [], "current_validity": "undated_current", "publication_date": None, "detail": "조사에서 확인되지 않았으며, 혜택이 없다는 뜻이 아니다.", "searched_source_ids": ["missing-source"], "searched_at": "2026-10-20T00:00:00Z", "search_scope": "benefit_nonclaim"})
        for field in ("prepublication_checked_at", "source_locator", "supporting_quote", "content_sha256"):
            claim.pop(field, None)
        self.fixture.write_jsonl("benefit-claims.jsonl", self.fixture.claims)
        self.assert_error("unknown searched source missing-source")

        claim["searched_source_ids"] = [self.fixture.source_for_jurisdiction["US"]]
        self.fixture.write_jsonl("benefit-claims.jsonl", self.fixture.claims)
        self.assert_error("does not support benefit_claim")

    def test_unknown_search_rejects_same_jurisdiction_scale_only_source(self):
        claim = self.fixture.claims[0]
        claim.update({"status": "unknown", "evidence_grade": "none", "source_ids": [], "current_validity": "undated_current", "publication_date": None, "detail": "조사에서 확인되지 않았으며, 혜택이 없다는 뜻이 아니다.", "searched_source_ids": [self.fixture.source_for_jurisdiction["KR"]], "searched_at": "2026-10-20T02:00:00Z", "search_scope": "benefit_nonclaim"})
        for field in ("prepublication_checked_at", "source_locator", "supporting_quote", "content_sha256"):
            claim.pop(field, None)
        self.fixture.write_jsonl("benefit-claims.jsonl", self.fixture.claims)
        self.assert_error("does not support benefit_claim")

    def test_benefit_source_must_match_jurisdiction_employer_and_policy_owner(self):
        source = self.fixture.benefit_source
        source["jurisdiction"] = "US"
        source["applicable_legal_entities"] = ["Unrelated US Corp"]
        source["policy_owner_legal_entity"] = "Unrelated US Corp"
        self.fixture.write_jsonl("source-registry.jsonl", self.fixture.sources)
        errors = self.errors()
        for needle in ("jurisdiction", "selected employer", "benefit policy owner"):
            self.assertTrue(any(needle in error for error in errors), (needle, errors[:40]))

    def test_explicit_global_policy_mapping_has_no_wildcards(self):
        company = self.fixture.selected["domestic"][0]
        source = self.fixture.benefit_source
        source["jurisdiction"] = "INT"
        source["multi_jurisdiction_applicability"] = {"*": [company["legal_name"]]}
        self.fixture.write_jsonl("source-registry.jsonl", self.fixture.sources)
        self.assert_error("explicit multi-jurisdiction applicability")
        source["multi_jurisdiction_applicability"] = {"KR": [company["legal_name"]]}
        self.fixture.write_jsonl("source-registry.jsonl", self.fixture.sources)
        self.assertEqual([], self.errors())

    def test_contract_file_digest_is_an_independent_literal_anchor(self):
        contract_path = ROOT / "scripts" / "company-benefits-protocol-contract.json"
        original = contract_path.read_bytes()
        try:
            contract = json.loads(original)
            contract["thresholds"]["domestic_non_financial"]["minimum"] = 1
            contract_path.write_text(json.dumps(contract), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "independent pin anchor"):
                self.verifier.pinned_protocol_contract()
        finally:
            contract_path.write_bytes(original)

    def test_nonempty_current_blocker_makes_source_ineligible(self):
        self.fixture.benefit_source["current_blocker"] = "terms unresolved; do not use"
        self.fixture.write_jsonl("source-registry.jsonl", self.fixture.sources)
        self.assert_error("current blocker")

    def test_exact_field_legal_decisions_are_all_required(self):
        self.fixture.benefit_source["decisions"]["snapshot"] = "unknown"
        self.fixture.write_jsonl("source-registry.jsonl", self.fixture.sources)
        self.assert_error("snapshot")

    def test_undated_current_requires_explicit_validity_and_recent_check(self):
        claim = self.fixture.claims[0]
        claim["publication_date"] = None
        claim["current_validity"] = "undated_current"
        self.fixture.write_jsonl("benefit-claims.jsonl", self.fixture.claims)
        self.assertEqual([], self.errors())
        claim["current_validity"] = "current"
        self.fixture.write_jsonl("benefit-claims.jsonl", self.fixture.claims)
        self.assert_error("undated_current")
        claim["current_validity"] = "undated_current"
        claim.pop("publication_date")
        self.fixture.write_jsonl("benefit-claims.jsonl", self.fixture.claims)
        self.assert_error("explicit null")
        claim["publication_date"] = None
        claim["checked_at"] = "2026-08-01"
        self.fixture.write_jsonl("benefit-claims.jsonl", self.fixture.claims)
        self.assert_error("undated source was not checked within 30 days")

    def test_future_fiscal_and_current_evidence_dates_fail(self):
        self.rewrite_company_everywhere("domestic", 0, lambda company: company["scale_metric"].update(fiscal_year_end="2026-11-01"))
        self.assert_error("future fiscal")
        self.fixture = FrozenFixture(self.root)
        self.fixture.claims[0]["publication_date"] = "2026-11-01"
        self.fixture.write_jsonl("benefit-claims.jsonl", self.fixture.claims)
        self.assert_error("future publication")

    def test_historical_claim_accepts_old_official_evidence_but_current_does_not(self):
        claim = self.fixture.claims[0]
        claim.update(status="past", current_validity="historical", publication_date="2020-01-01")
        self.fixture.write_jsonl("benefit-claims.jsonl", self.fixture.claims)
        self.assertEqual([], self.errors())
        claim["current_validity"] = "current"
        self.fixture.write_jsonl("benefit-claims.jsonl", self.fixture.claims)
        self.assert_error("current source is older than 24 months")

    def test_only_approved_independent_reviews_unlock_claims(self):
        self.fixture.reviews[0]["decision"] = "changes_required"
        self.fixture.write_jsonl("reviews.jsonl", self.fixture.reviews)
        self.assert_error("missing approved independent review")

    def test_causal_evidence_review_and_prepublication_order_is_enforced(self):
        self.fixture.claims[0]["researched_at"] = "2026-10-19T00:00:00Z"
        self.fixture.claims[0]["prepublication_checked_at"] = "2026-10-20T02:30:00Z"
        self.fixture.write_jsonl("benefit-claims.jsonl", self.fixture.claims)
        errors = self.errors()
        self.assertTrue(any("research must follow source checked_at" in error for error in errors), errors[:40])
        self.assertTrue(any("prepublication check must follow independent review" in error for error in errors), errors[:40])

    def test_source_publication_must_precede_retrieval(self):
        self.fixture.benefit_source["publication_date"] = "2026-10-21"
        self.fixture.write_jsonl("source-registry.jsonl", self.fixture.sources)
        self.assert_error("publication_date must not follow retrieved_at")

    def configure_conflict(self, contradicting_quote="Paid leave is not offered.", include_side_review=True):
        claim = self.fixture.claims[0]
        duplicate = copy.deepcopy(self.fixture.benefit_source)
        duplicate["source_id"] = "benefit-source-alias"
        duplicate["content_sha256"] = "b" * 64
        duplicate["supporting_quote"] = contradicting_quote
        self.fixture.sources.append(duplicate)
        claim.update(status="conflict", source_ids=[claim["source_ids"][0], duplicate["source_id"]], conflict_evidence=[
            {"source_id": claim["source_ids"][0], "position": "supports", "proposition": "Paid leave is offered.", "source_locator": "benefits", "supporting_quote": "Paid leave is offered.", "content_sha256": "a" * 64},
            {"source_id": duplicate["source_id"], "position": "contradicts", "proposition": "Paid leave is not offered.", "source_locator": "benefits", "supporting_quote": contradicting_quote, "content_sha256": "b" * 64},
        ])
        review = self.fixture.reviews[0]
        review.update(
            conflict_determination="unresolved",
            conflict_opposition_confirmed=True,
            unresolved_conflict_wording_approved=True,
        )
        if include_side_review:
            review["conflict_side_entailments"] = [
                {"source_id": item["source_id"], "position": item["position"], "reviewed_proposition": item["proposition"], "source_locator": item["source_locator"], "reviewed_quote": item["supporting_quote"], "content_sha256": item["content_sha256"], "entailment_confirmed": True, "reviewer_id": review["reviewer_id"]}
                for item in claim["conflict_evidence"]
            ]
        self.fixture.write_all()
        return claim, duplicate, review

    def test_conflict_rejects_fabricated_contradiction_without_truthful_side_review(self):
        self.configure_conflict(contradicting_quote="Paid leave remains offered.", include_side_review=False)
        self.assert_error("complete one-to-one conflict-side entailment coverage")

    def test_complete_synthetic_conflict_contract_with_independent_side_attestations_passes(self):
        self.configure_conflict()
        self.assertEqual([], self.errors())

    def test_conflict_requires_opposing_distinct_evidence_and_reviewer_determination(self):
        claim, duplicate, review = self.configure_conflict()
        duplicate["content_sha256"] = "a" * 64
        duplicate["supporting_quote"] = "Paid leave is offered."
        claim["conflict_evidence"][1].update(content_sha256="a" * 64, supporting_quote="Paid leave is offered.")
        review["conflict_side_entailments"][1].update(content_sha256="a" * 64, reviewed_quote="Paid leave is offered.")
        self.fixture.write_all()
        self.assert_error("duplicate conflict evidence")

        self.fixture = FrozenFixture(self.root)
        claim, duplicate, review = self.configure_conflict()
        review.pop("conflict_determination")
        review.pop("unresolved_conflict_wording_approved")
        self.fixture.write_all()
        self.assert_error("conflict determination")

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
        event, _ = self.fixture.replacement_event()
        event["next_effective_sha256"] = "0" * 64
        self.fixture.current["domestic"] = new
        self.fixture.companies = new + self.fixture.current["international"]
        self.fixture.events = [event]
        self.fixture.write_all()
        self.assert_error("next_effective_sha256 mismatch")

    def test_replacement_must_use_next_unused_canonical_candidate(self):
        event, new = self.fixture.replacement_event()
        self.fixture.current["domestic"] = new
        self.fixture.companies = new + self.fixture.current["international"]
        self.fixture.events = [event]
        self.fixture.write_all()
        self.assertEqual([], self.errors())

        freeze_path = self.root / "population" / "freeze-manifest.json"
        frozen_bytes = freeze_path.read_bytes()
        frozen_hash = sha(frozen_bytes)
        self.fixture.refresh_manifests()
        self.assertEqual(frozen_bytes, freeze_path.read_bytes())
        effective = json.loads((self.root / "population" / "effective-selection-manifest.json").read_text())
        self.assertEqual(frozen_hash, effective["freeze_manifest_sha256"])

        self.fixture = FrozenFixture(self.root)
        wrong = self.fixture.eligible["domestic"][999]
        event["replacement_company_id"] = wrong["company_id"]
        self.fixture.events = [event]
        self.fixture.write_all()
        self.assert_error("next unused canonical candidate")

    def test_replacement_event_requires_full_audit_context(self):
        event, new = self.fixture.replacement_event()
        event.pop("exclusion_reason")
        event.pop("excluded_hash_position")
        self.fixture.current["domestic"] = new
        self.fixture.companies = new + self.fixture.current["international"]
        self.fixture.events = [event]
        self.fixture.write_all()
        errors = self.errors()
        self.assertTrue(any("exclusion_reason" in error for error in errors), errors[:30])
        self.assertTrue(any("excluded_hash_position" in error for error in errors), errors[:30])

    def test_lower_precedence_source_requires_structured_unavailability_proof(self):
        source_id = self.fixture.source_for_jurisdiction["KR"]
        source = next(item for item in self.fixture.sources if item["source_id"] == source_id)
        source["source_type"] = "official_company_report"
        company_id = self.fixture.selected["domestic"][0]["company_id"]
        for collection in (self.fixture.eligible["domestic"], self.fixture.selected["domestic"], self.fixture.current["domestic"], self.fixture.companies):
            target = next(item for item in collection if item["company_id"] == company_id)
            target["scale_source_precedence_rank"] = 5
            target["source_availability"] = []
        self.fixture.write_all()
        self.assert_error("higher-precedence source availability")

        arbitrary = self.fixture.source_for_jurisdiction["US"]
        for collection in (self.fixture.eligible["domestic"], self.fixture.selected["domestic"], self.fixture.current["domestic"], self.fixture.companies):
            target = next(item for item in collection if item["company_id"] == company_id)
            target["source_availability"] = [
                {"precedence_rank": rank, "status": "unavailable", "reason": "Official endpoint unavailable during audit", "checked_source_ids": [arbitrary]}
                for rank in range(1, 5)
            ]
        self.fixture.write_all()
        self.assert_error("every pinned source for the same jurisdiction")

    def test_protocol_requires_exact_panel_domestic_union_thresholds_and_registered_endpoints(self):
        self.fixture.protocol["scopes"]["international"]["country_panel"] = PANEL[:-1]
        self.fixture.protocol["scopes"]["domestic"]["candidate_source_ids"] = []
        self.fixture.protocol["thresholds"]["domestic_non_financial"]["currency"] = "USD"
        self.fixture.protocol["registered_sources"]["US"][0]["endpoint"] = "https://evil.example/source"
        self.fixture.write_all()
        errors = self.errors()
        for needle in ("fixed 18-country panel", "domestic candidate-source union", "threshold", "registered source endpoint"):
            self.assertTrue(any(needle in error for error in errors), (needle, errors[:30]))

    def test_every_pinned_protocol_section_rejects_mutation(self):
        mutations = [
            lambda p: p["scopes"]["international"]["country_panel"].pop(),
            lambda p: p["scopes"]["domestic"]["candidate_source_ids"].append("fabricated"),
            lambda p: p["scopes"]["international"]["candidate_source_ids_by_jurisdiction"]["US"].append("fabricated"),
            lambda p: p["registered_sources"]["US"][0].update(endpoint="https://evil.example"),
            lambda p: p["classification"].update(selection_unit="brand"),
            lambda p: p["currency_conversion"].update(source_owner="Other authority"),
            lambda p: p["thresholds"]["international_financial"].update(minimum=1),
            lambda p: p["thresholds"].update(public_sector_rule="Public entities auto-qualify"),
            lambda p: p["source_precedence"].reverse(),
            lambda p: p["canonical_selection"].update(serialization="implementation-defined"),
            lambda p: p["canonical_selection"].update(replacement_rule="pick any replacement"),
            lambda p: p["immutable_model"]["freeze_manifest_artifacts"].append("population/effective-selection-events.jsonl"),
            lambda p: p.update(cutoff_at="2026-10-30T23:59:59+09:00"),
        ]
        for number, mutate in enumerate(mutations):
            with self.subTest(number=number):
                fixture = FrozenFixture(self.root)
                mutate(fixture.protocol)
                fixture.write_all()
                self.assertTrue(any("pinned protocol contract" in error for error in self.errors()))

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
        contract = json.loads((ROOT / "scripts" / "company-benefits-protocol-contract.json").read_text())
        self.assertEqual(contract, {field: protocol[field] for field in self.verifier.PINNED_PROTOCOL_FIELDS})
        self.assertEqual(self.verifier.sha256(self.verifier.json_bytes(contract)), schema["x-pinned-protocol-contract-sha256"])

    def test_repository_real_population_is_approved_and_verifies(self):
        research = ROOT / "docs" / "research" / "company-benefits"
        errors = self.verifier.verify_workspace(research, as_of=date(2026, 10, 29))
        self.assertEqual([], errors)
        self.assertEqual("approved", json.loads((research / "population-protocol.json").read_text())["status"])
        expected = {"domestic-eligible.jsonl": 1350, "international-eligible.jsonl": 1071,
                    "domestic-selected.jsonl": 1000, "international-selected.jsonl": 1000,
                    "domestic-effective-selected.jsonl": 1000, "international-effective-selected.jsonl": 1000}
        for name, count in expected.items():
            self.assertEqual(count, len((research / "population" / name).read_bytes().splitlines()), name)
        self.assertEqual(2000, len((research / "companies.jsonl").read_bytes().splitlines()))
        self.assertEqual(0, len((research / "benefit-claims.jsonl").read_bytes().splitlines()))
        self.assertEqual(0, len((research / "reviews.jsonl").read_bytes().splitlines()))


if __name__ == "__main__":
    unittest.main()
