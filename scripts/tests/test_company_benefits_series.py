import copy
import hashlib
import importlib.util
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from scripts.tests.benefits_test_fixture import FrozenFixture

ROOT = Path(__file__).resolve().parents[2]
SERIES_MODULE = ROOT / "scripts" / "company_benefits_series.py"
VERIFY_MODULE = ROOT / "scripts" / "verify-company-benefits-ledger.py"


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SeriesContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.series = load(SERIES_MODULE, "company_benefits_series")
        cls.verifier = load(VERIFY_MODULE, "company_benefits_verifier_series")

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.fixture = FrozenFixture(self.root)
        self.series.materialize_contract(self.root, approved_batch_ids={"domestic-01"},
                                         approved_at="2026-10-21T00:00:00Z", reviewer_id="bob")

    def tearDown(self):
        self.tmp.cleanup()

    def errors(self):
        return self.verifier.verify_workspace(
            self.root, as_of=date(2026, 10, 29),
            approved_freeze_anchors=self.fixture.approved_freeze_anchors())

    def configure_gap_only_batch(self, include_reviews=True):
        companies = self.fixture.current["domestic"][:25]
        gaps = [{
            "audit_id": f"company-gap::{company['company_id']}",
            "company_id": company["company_id"],
            "disposition": "nonpublishable",
            "reason": "공개 공식 자료에서 게시 가능한 근거를 확인하지 못했습니다.",
            "searched_official_source_ids": [],
            "searched_official_urls": [],
            "nonabsence_wording": "복지가 없다는 뜻이 아닙니다.",
        } for company in companies]
        reviews = [{
            "review_id": f"review::{gap['audit_id']}",
            "record_id": gap["audit_id"],
            "researcher_id": "gap-researcher",
            "reviewer_id": "gap-reviewer",
            "decision": "approved",
            "reviewed_at": "2026-10-20T03:00:00Z",
            "issues": [],
            "resolution": "approved nonclaim outcome",
            "quote_entailment_confirmed": True,
        } for gap in gaps] if include_reviews else []
        self.fixture.claims = []
        self.fixture.reviews = reviews
        self.fixture.write_jsonl("benefit-claims.jsonl", [])
        self.fixture.write_jsonl("reviews.jsonl", reviews)
        self.fixture.write_jsonl("series-research-gaps.jsonl", gaps)
        self.fixture.write_jsonl("series-prepublication-checks.jsonl", [])
        self.series.materialize_contract(
            self.root, {"domestic-01"}, "2026-10-21T00:00:00Z", "gap-reviewer"
        )
        return gaps, reviews

    def install_historical_audit(self):
        research = ROOT / "docs" / "research" / "company-benefits"
        audit = research / "series-historical-audit.jsonl"
        (self.root / audit.name).write_bytes(audit.read_bytes())
        schema = research / "schema" / "series-historical-audit.schema.json"
        (self.root / "schema").mkdir(exist_ok=True)
        (self.root / "schema" / schema.name).write_bytes(schema.read_bytes())
        manifest = {
            "schema_version": "1",
            "audit_path": "series-historical-audit.jsonl",
            "audit_sha256": hashlib.sha256(audit.read_bytes()).hexdigest(),
            "audit_schema_path": "schema/series-historical-audit.schema.json",
            "audit_schema_sha256": "910fe8e3a0dc3d062704fe6239359e1cb70a618aba3ab8a8146126795e07482e",
            "byte_count": len(audit.read_bytes()),
            "row_count": 497,
            "record_type_counts": {"claim": 199, "review": 199, "gap": 99},
            "publishable": False,
            "source_protocol_version": "3.1.1",
            "source_protocol_sha256": "863ee9149fb2f48b0330944d4b8422630d89c34bcbfa21d4c47a75540570d60d",
            "source_freeze_manifest_sha256": "2bcad6384d8e367c7f89e99a48d2f6e53c4315a27f50ee4b80007325aefec665",
            "source_commit": "0871312fcb82d3e2f141d472a225d95147c9e12c",
            "wrapper_reason": "protocol_4_refreeze_requires_new_batch_review",
        }
        (self.root / "series-historical-audit-manifest.json").write_bytes(self.series.json_bytes(manifest))
        return manifest

    def historical_audit_errors(self):
        errors = []
        active_company_ids = {
            company["company_id"]
            for scope in self.fixture.current.values() for company in scope
        }
        self.series.validate_historical_audit(self.root, active_company_ids, errors)
        return errors

    def test_exact_partition_and_deterministic_repeat(self):
        before = (self.root / "series-batches.jsonl").read_bytes()
        batches = self.series.read_jsonl(self.root / "series-batches.jsonl")
        self.assertEqual(80, len(batches))
        self.assertEqual(2000, len({company_id for batch in batches for company_id in batch["company_ids"]}))
        self.assertTrue(all(len(batch["company_ids"]) == 25 for batch in batches))
        self.series.materialize_contract(self.root, approved_batch_ids={"domestic-01"},
                                         approved_at="2026-10-21T00:00:00Z", reviewer_id="bob")
        self.assertEqual(before, (self.root / "series-batches.jsonl").read_bytes())

    def test_pending_batch_data_is_rejected(self):
        claim = copy.deepcopy(self.fixture.claims[0])
        pending_company = self.fixture.current["domestic"][25]
        claim["claim_id"] = "pending-claim"
        claim["company_id"] = pending_company["company_id"]
        self.fixture.claims.append(claim)
        self.fixture.write_jsonl("benefit-claims.jsonl", self.fixture.claims)
        self.assertTrue(any("pending batch" in error for error in self.errors()), self.errors()[:20])

    def test_partial_approved_batch_is_rejected(self):
        self.fixture.claims.pop()
        self.fixture.reviews.pop()
        self.fixture.write_jsonl("benefit-claims.jsonl", self.fixture.claims)
        self.fixture.write_jsonl("reviews.jsonl", self.fixture.reviews)
        self.assertTrue(any("accounted" in error for error in self.errors()), self.errors()[:20])

    def test_approved_gap_outcomes_require_exact_independent_review_coverage(self):
        gaps, reviews = self.configure_gap_only_batch(include_reviews=False)
        self.assertTrue(any("outcome review coverage" in error for error in self.errors()), self.errors()[:20])

        cases = []
        valid_reviews = self.configure_gap_only_batch(include_reviews=True)[1]
        self.assertEqual([], self.errors())
        duplicate = copy.deepcopy(valid_reviews)
        duplicate[-1]["record_id"] = duplicate[0]["record_id"]
        cases.append(("duplicate", duplicate))
        orphan = copy.deepcopy(valid_reviews)
        orphan[-1]["record_id"] = "company-gap::orphan"
        cases.append(("orphan", orphan))
        unapproved = copy.deepcopy(valid_reviews)
        unapproved[0]["decision"] = "changes_required"
        cases.append(("unapproved", unapproved))
        self_approved = copy.deepcopy(valid_reviews)
        self_approved[0]["reviewer_id"] = self_approved[0]["researcher_id"]
        cases.append(("self-approved", self_approved))
        malformed_reviewer = copy.deepcopy(valid_reviews)
        malformed_reviewer[0]["reviewer_id"] = ""
        cases.append(("malformed reviewer", malformed_reviewer))
        malformed_timestamp = copy.deepcopy(valid_reviews)
        malformed_timestamp[0]["reviewed_at"] = "not-a-timestamp"
        cases.append(("malformed timestamp", malformed_timestamp))
        multiple_targets = copy.deepcopy(valid_reviews)
        multiple_targets[0]["claim_id"] = "claim-does-not-belong-here"
        cases.append(("multiple target types", multiple_targets))
        for label, mutated in cases:
            with self.subTest(label=label):
                self.fixture.write_jsonl("reviews.jsonl", mutated)
                self.assertTrue(self.errors(), label)

    def test_complete_before_all_batches_is_rejected(self):
        progress = json.loads((self.root / "series-progress.json").read_text())
        progress["status"] = "complete"
        (self.root / "series-progress.json").write_text(json.dumps(progress), encoding="utf-8")
        self.assertTrue(any("complete" in error and "80" in error for error in self.errors()), self.errors()[:20])

    def test_batch_manifest_preserves_canonical_order_and_hash(self):
        batches = self.series.read_jsonl(self.root / "series-batches.jsonl")
        first = batches[0]
        self.assertEqual("domestic-01", first["batch_id"])
        self.assertEqual([item["company_id"] for item in self.fixture.current["domestic"][:25]], first["company_ids"])
        self.assertEqual(self.series.company_list_sha256(first["company_ids"]), first["company_list_sha256"])
        self.assertEqual(self.series.file_sha256(self.root / "population/domestic-effective-selected.jsonl"),
                         first["effective_sequence_sha256"])
        self.assertEqual(self.series.file_sha256(self.root / "population/effective-selection-events.jsonl"),
                         first["replacement_events_sha256"])

    def test_repository_refreeze_preserves_prior_work_as_nonpublishable_audit(self):
        research = ROOT / "docs" / "research" / "company-benefits"
        report = json.loads((research / "series-remap-report.json").read_text())
        self.assertEqual(2000, report["new_population_count"])
        self.assertEqual(report["removed_count"], len(report["removed_company_ids"]))
        self.assertEqual(report["new_count"], len(report["new_company_ids"]))
        self.assertEqual([], self.series.read_jsonl(research / "benefit-claims.jsonl"))
        self.assertEqual([], self.series.read_jsonl(research / "reviews.jsonl"))
        historical = self.series.read_jsonl(research / "series-historical-audit.jsonl")
        self.assertTrue(historical)
        self.assertTrue(all(row["publishable"] is False for row in historical))
        retained = [row for row in historical if row.get("new_batch_id")]
        self.assertTrue(retained)

    def test_historical_audit_manifest_and_schema_are_committed(self):
        research = ROOT / "docs" / "research" / "company-benefits"
        self.assertTrue((research / "series-historical-audit-manifest.json").is_file())
        self.assertTrue((research / "schema" / "series-historical-audit.schema.json").is_file())

    def test_historical_audit_rejects_absence_extra_reorder_and_mutations(self):
        manifest = self.install_historical_audit()
        self.assertEqual([], self.historical_audit_errors())
        audit_path = self.root / "series-historical-audit.jsonl"
        original = audit_path.read_bytes()
        rows = original.splitlines(keepends=True)
        mutations = {
            "missing audit": None,
            "extra row": original + rows[0],
            "reordered rows": rows[1] + rows[0] + b"".join(rows[2:]),
            "publishable true": original.replace(b'"publishable":false', b'"publishable":true', 1),
            "unknown type": original.replace(b'"record_type":"claim"', b'"record_type":"unknown"', 1),
            "active-ledger leakage": original.replace(
                b'"company_id":"KR-CRN-1101110279433"',
                f'"company_id":"{self.fixture.current["domestic"][0]["company_id"]}"'.encode(), 1),
        }
        for label, mutated in mutations.items():
            with self.subTest(label=label):
                if mutated is None:
                    audit_path.unlink()
                else:
                    audit_path.write_bytes(mutated)
                errors = self.historical_audit_errors()
                self.assertTrue(any("historical audit" in error for error in errors), errors[:20])
                audit_path.write_bytes(original)

        for field, value in (
            ("source_protocol_version", "3.1.0"),
            ("source_protocol_sha256", "0" * 64),
            ("source_freeze_manifest_sha256", "0" * 64),
            ("publishable", True),
        ):
            with self.subTest(manifest_field=field):
                mutated_manifest = copy.deepcopy(manifest)
                mutated_manifest[field] = value
                (self.root / "series-historical-audit-manifest.json").write_bytes(self.series.json_bytes(mutated_manifest))
                errors = self.historical_audit_errors()
                self.assertTrue(any("historical audit" in error for error in errors), errors[:20])


if __name__ == "__main__":
    unittest.main()
