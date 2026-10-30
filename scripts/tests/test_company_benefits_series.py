import copy
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


if __name__ == "__main__":
    unittest.main()
