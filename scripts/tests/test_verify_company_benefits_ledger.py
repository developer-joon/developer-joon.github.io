import copy
import hashlib
import importlib.util
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "verify-company-benefits-ledger.py"


def load_module():
    spec = importlib.util.spec_from_file_location("benefits_verifier", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def digest(values):
    raw = json.dumps(values, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()
    return hashlib.sha256(raw).hexdigest()


class VerifierTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.verifier = load_module()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "population").mkdir()
        self.protocol = {
            "protocol_id": "cbp-v1",
            "version": "1.0.0",
            "status": "approved",
            "approval": {"approved_by": "owner", "approved_at": "2026-10-01T00:00:00Z"},
            "canonical_selection": {"seed": "seed-v1"},
        }
        self.write_json("population-protocol.json", self.protocol)
        self.source = {
            "source_id": "src-a",
            "owner": "Regulator",
            "source_type": "regulator_filing",
            "jurisdiction": "US",
            "url": "https://example.gov/a",
            "access_model": "public_keyless",
            "authentication": {"api_key": False, "login": False, "fee": False},
            "terms_url": "https://example.gov/terms",
            "reuse_decision": "allowed_with_attribution",
            "decisions": {"extract": "allowed", "quote": "allowed", "retention": "metadata_only", "snapshot": "prohibited", "attribution": "required"},
            "supported_fields": ["benefit_claim"],
            "evidence_eligibility": "A",
            "checked_at": "2026-10-01T00:00:00Z",
            "http_verification": {"status": 200, "redirect_chain": [], "content_type": "text/html", "final_url": "https://example.gov/a", "final_owner_domain": "example.gov", "access_wall": "none", "expected_marker": "Regulator"},
            "current_blocker": None,
        }
        self.write_jsonl("source-registry.jsonl", [self.source])
        self.company = {
            "company_id": "co-1",
            "jurisdiction": "US",
            "scope": "international",
            "registry_id": "0001",
            "legal_name": "Example Corp",
            "selected_employer_legal_entity": "Example Corp",
            "registered_head_office_country": "US",
            "financial_consolidation_parent": None,
            "ultimate_parent": None,
            "benefit_policy_owner": "Example Corp",
            "entity_status": "active",
            "sector": "non_financial",
            "scale_metric": {"type": "revenue", "value": 2000000000, "currency": "USD", "band": "USD_1B_PLUS", "fiscal_year_end": "2025-12-31", "financial_scope": "consolidated", "source_ids": ["src-a"]},
            "selection_hash": digest(["seed-v1", "US", "0001", "Example Corp"]),
        }
        self.claim = {
            "claim_id": "claim-1",
            "company_id": "co-1",
            "benefit_name": "Leave",
            "detail": "Paid leave is offered.",
            "status": "confirmed",
            "evidence_grade": "A",
            "source_ids": ["src-a"],
            "application_scope": {"countries": ["US"], "legal_entities": ["Example Corp"], "roles": ["all"], "employment_types": ["full_time"], "tenure_condition": "none stated"},
            "publication_date": "2026-01-01",
            "checked_at": "2026-10-01",
            "prepublication_checked_at": "2026-10-20",
            "source_locator": "Benefits section",
            "supporting_quote": "Paid leave is offered.",
            "content_sha256": "a" * 64,
        }
        self.review = {"review_id": "review-1", "claim_id": "claim-1", "researcher_id": "alice", "reviewer_id": "bob", "decision": "approved", "reviewed_at": "2026-10-21T00:00:00Z", "issues": [], "resolution": "accepted"}
        self.write_jsonl("companies.jsonl", [self.company])
        self.write_jsonl("benefit-claims.jsonl", [self.claim])
        self.write_jsonl("reviews.jsonl", [self.review])
        self.write_jsonl("corrections.jsonl", [])

    def tearDown(self):
        self.tmp.cleanup()

    def write_json(self, name, value):
        (self.root / name).write_text(json.dumps(value), encoding="utf-8")

    def write_jsonl(self, name, values):
        text = "".join(json.dumps(v, ensure_ascii=False) + "\n" for v in values)
        (self.root / name).write_text(text, encoding="utf-8")

    def errors(self):
        return self.verifier.verify_workspace(self.root, as_of=date(2026, 10, 29))

    def assert_error(self, needle):
        errors = self.errors()
        self.assertTrue(any(needle in error for error in errors), errors)

    def test_valid_approved_fixture_passes(self):
        self.assertEqual([], self.errors())

    def test_blocked_or_unapproved_protocol_fails_closed(self):
        self.protocol["status"] = "blocked"
        self.protocol["approval"] = None
        self.write_json("population-protocol.json", self.protocol)
        self.assert_error("protocol status is blocked")

    def test_blocked_protocol_rejects_population_artifacts(self):
        self.protocol["status"] = "blocked"
        self.protocol["approval"] = None
        self.write_json("population-protocol.json", self.protocol)
        (self.root / "population" / "freeze-manifest.json").write_text("{}", encoding="utf-8")
        self.assert_error("prohibited population artifact")

    def test_missing_and_duplicate_ids_fail(self):
        bad = copy.deepcopy(self.company)
        bad["company_id"] = "co-1"
        self.write_jsonl("companies.jsonl", [self.company, bad])
        self.assert_error("duplicate company_id")
        bad.pop("registry_id")
        self.write_jsonl("companies.jsonl", [bad])
        self.assert_error("missing registry_id")

    def test_invalid_legal_scope_and_status_fail(self):
        bad = copy.deepcopy(self.company)
        bad["registered_head_office_country"] = "KR"
        self.write_jsonl("companies.jsonl", [bad])
        self.assert_error("international scope")
        claim = copy.deepcopy(self.claim)
        claim["status"] = "yes"
        self.write_jsonl("benefit-claims.jsonl", [claim])
        self.assert_error("invalid status")

    def test_invalid_evidence_grade_fails(self):
        claim = copy.deepcopy(self.claim)
        claim["evidence_grade"] = "C"
        self.write_jsonl("benefit-claims.jsonl", [claim])
        self.assert_error("invalid evidence grade")

    def test_confirmed_claim_requires_eligible_a_or_b_source(self):
        claim = copy.deepcopy(self.claim)
        claim["source_ids"] = []
        self.write_jsonl("benefit-claims.jsonl", [claim])
        self.assert_error("requires at least one eligible A/B source")

    def test_conflict_requires_two_eligible_sources(self):
        claim = copy.deepcopy(self.claim)
        claim["status"] = "conflict"
        self.write_jsonl("benefit-claims.jsonl", [claim])
        self.assert_error("requires at least two eligible A/B sources")

    def test_freshness_and_applicability_gaps_fail(self):
        claim = copy.deepcopy(self.claim)
        claim["publication_date"] = "2023-01-01"
        claim["application_scope"]["legal_entities"] = []
        self.write_jsonl("benefit-claims.jsonl", [claim])
        errors = self.errors()
        self.assertTrue(any("older than 24 months" in e for e in errors), errors)
        self.assertTrue(any("application_scope.legal_entities" in e for e in errors), errors)

    def test_source_access_and_licensing_decision_gaps_fail(self):
        source = copy.deepcopy(self.source)
        source["decisions"].pop("quote")
        self.write_jsonl("source-registry.jsonl", [source])
        self.assert_error("missing source decision quote")

    def test_review_self_approval_fails(self):
        review = copy.deepcopy(self.review)
        review["reviewer_id"] = review["researcher_id"]
        self.write_jsonl("reviews.jsonl", [review])
        self.assert_error("self-approval")

    def test_invalid_canonical_selection_hash_fails(self):
        company = copy.deepcopy(self.company)
        company["selection_hash"] = "0" * 64
        self.write_jsonl("companies.jsonl", [company])
        self.assert_error("selection_hash mismatch")

    def test_invalid_frozen_protocol_hash_fails(self):
        (self.root / "population" / "freeze-manifest.json").write_text(
            json.dumps({"protocol_sha256": "0" * 64}), encoding="utf-8"
        )
        self.assert_error("protocol_sha256 mismatch")

    def test_ranking_language_fails(self):
        (self.root / "draft.md").write_text("세계 매출 순위 1위 기업입니다.\n", encoding="utf-8")
        self.assert_error("prohibited ranking language")

    def test_unknown_is_non_claim_and_does_not_mean_absence(self):
        claim = copy.deepcopy(self.claim)
        claim.update({"status": "unknown", "evidence_grade": "none", "source_ids": [], "searched_source_ids": ["src-a"], "detail": "공식 공개자료에서 확인 불가; 제도가 없다는 뜻이 아니다."})
        self.write_jsonl("benefit-claims.jsonl", [claim])
        self.assertEqual([], self.errors())

    def test_source_registry_requires_full_audit_fields(self):
        source = copy.deepcopy(self.source)
        source.pop("owner")
        source["http_verification"].pop("expected_marker")
        self.write_jsonl("source-registry.jsonl", [source])
        errors = self.errors()
        self.assertTrue(any("missing source owner" in e for e in errors), errors)
        self.assertTrue(any("expected_marker" in e for e in errors), errors)

    def test_repository_registry_covers_domestic_and_fixed_panel(self):
        research = ROOT / "docs" / "research" / "company-benefits"
        records = [json.loads(line) for line in (research / "source-registry.jsonl").read_text(encoding="utf-8").splitlines() if line]
        required = {"KR", "US", "CA", "MX", "BR", "AR", "GB", "FR", "DE", "IT", "TR", "RU", "AU", "CN", "IN", "ID", "JP", "SA", "ZA"}
        self.assertTrue(required <= {record["jurisdiction"] for record in records})
        self.assertEqual(len(records), len({record["source_id"] for record in records}))
        audit_errors = []
        self.verifier.validate_sources(records, audit_errors)
        self.assertEqual([], audit_errors)

    def test_repository_protocol_is_blocked_without_population_artifacts(self):
        research = ROOT / "docs" / "research" / "company-benefits"
        protocol = json.loads((research / "population-protocol.json").read_text(encoding="utf-8"))
        self.assertEqual("blocked", protocol["status"])
        self.assertIsNone(protocol["approval"])
        for relative in protocol["forbidden_while_blocked"]:
            self.assertFalse((research / relative).exists(), relative)


if __name__ == "__main__":
    unittest.main()
