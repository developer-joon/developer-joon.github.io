import copy
import hashlib
import importlib.util
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from scripts.tests.benefits_test_fixture import FrozenFixture
from scripts.tests.benefits_v2_batch_fixture import V2_FILES, no_public_info_records
from scripts.tests.test_company_benefits_v2_contracts import base_reference

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
        batch = next(item for item in self.series.read_jsonl(self.root / "series-batches.jsonl")
                     if item["batch_id"] == "domestic-01")
        v2_records = no_public_info_records(batch, self.fixture.companies)
        for ledger, filename in V2_FILES.items():
            self.series.write_jsonl(self.root / filename, v2_records[ledger])
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
        routes = [{
            "record_type": "nonpublishable_metadata",
            "source_id": f"gap-route-{index:02d}",
            "title": f"Exact entity official route {index:02d}",
            "owner": company["legal_name"],
            "source_type": "official_company_report",
            "jurisdiction": "KR",
            "url": f"https://official.invalid/entity/{index:02d}",
            "checked_at": "2026-10-20T02:00:00Z",
            "route_quality": "exact_entity",
            "publication_eligible": False,
            "nonpublication_reason": "Exact-entity discovery metadata is not publishable benefit evidence.",
            "entity_binding_status": "exact_entity",
            "retention_mode": "metadata_only",
            "reuse_status": "discovery_only",
            "access_observation": {"status": 200, "final_url": f"https://official.invalid/entity/{index:02d}",
                                   "access_wall": "none"},
        } for index, company in enumerate(companies)]
        gaps = [{
            "audit_id": f"company-gap::{company['company_id']}",
            "company_id": company["company_id"],
            "disposition": "nonpublishable",
            "reason": "공개 공식 자료에서 게시 가능한 근거를 확인하지 못했습니다.",
            "searched_official_source_ids": [routes[index]["source_id"]],
            "searched_official_urls": [],
            "nonabsence_wording": "복지가 없다는 뜻이 아닙니다.",
        } for index, company in enumerate(companies)]
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
        self.fixture.sources.extend(route for route in routes if route["source_id"] not in {
            source["source_id"] for source in self.fixture.sources
        })
        checks = [{"source_id": route["source_id"], "url": route["url"],
                   **route["access_observation"], "checked_at": "2026-10-20T04:00:00Z"} for route in routes]
        self.fixture.write_jsonl("benefit-claims.jsonl", [])
        self.fixture.write_jsonl("reviews.jsonl", reviews)
        self.fixture.write_jsonl("source-registry.jsonl", self.fixture.sources)
        self.fixture.write_jsonl("series-research-gaps.jsonl", gaps)
        self.fixture.write_jsonl("series-prepublication-checks.jsonl", checks)
        self.series.materialize_contract(
            self.root, {"domestic-01"}, "2026-10-21T00:00:00Z", "gap-reviewer"
        )
        return gaps, reviews

    def test_gap_routes_reject_empty_url_only_orphan_generic_and_missing_check(self):
        gaps, _ = self.configure_gap_only_batch()
        self.assertEqual([], self.errors())
        gap_path = self.root / "series-research-gaps.jsonl"
        source_path = self.root / "source-registry.jsonl"
        check_path = self.root / "series-prepublication-checks.jsonl"
        original_gaps = copy.deepcopy(gaps)
        original_sources = self.series.read_jsonl(source_path)
        original_checks = self.series.read_jsonl(check_path)
        cases = []
        empty = copy.deepcopy(original_gaps); empty[0]["searched_official_source_ids"] = []; cases.append(("empty", empty, original_sources, original_checks))
        url_only = copy.deepcopy(empty); url_only[0]["searched_official_urls"] = [original_sources[-25]["url"]]; cases.append(("URL-only", url_only, original_sources, original_checks))
        orphan = copy.deepcopy(original_gaps); orphan[0]["searched_official_source_ids"] = ["orphan-route"]; cases.append(("orphan", orphan, original_sources, original_checks))
        generic_sources = copy.deepcopy(original_sources); generic_sources[-25]["route_quality"] = "generic"; cases.append(("generic", original_gaps, generic_sources, original_checks))
        cases.append(("missing check", original_gaps, original_sources, original_checks[1:]))
        for label, mutated_gaps, mutated_sources, mutated_checks in cases:
            with self.subTest(label=label):
                self.fixture.write_jsonl("series-research-gaps.jsonl", mutated_gaps)
                self.fixture.write_jsonl("source-registry.jsonl", mutated_sources)
                self.fixture.write_jsonl("series-prepublication-checks.jsonl", mutated_checks)
                errors = self.errors()
                self.assertTrue(any(token in error for error in errors for token in
                                    ("official source-ID route", "raw searched URLs", "does not resolve",
                                     "exact-entity", "prepublication checks")), errors[:20])

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

    def test_merged_v2_ledgers_reject_copied_attempt_capture_and_receipt_payload(self):
        attempts_path = self.root / V2_FILES["attempts"]
        attempts = self.series.read_jsonl(attempts_path)
        attempts[1]["capture_locator"] = attempts[0]["capture_locator"]
        attempts[1]["raw_response_sha256"] = attempts[0]["raw_response_sha256"]
        payload = {key: value for key, value in attempts[1].items() if key != "receipt_content_sha256"}
        attempts[1]["receipt_content_sha256"] = hashlib.sha256(
            json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        self.series.write_jsonl(attempts_path, attempts)
        errors = self.errors()
        self.assertTrue(any("receipt reuse" in error for error in errors), errors[:20])

    def test_merged_v2_ledgers_reject_orphan_reference_record(self):
        cells = self.series.read_jsonl(self.root / V2_FILES["cells"])
        orphan = base_reference()
        orphan.update(
            reference_id="reference::orphan",
            cell_id=cells[0]["cell_id"],
            company_id=cells[0]["company_id"],
            category_id=cells[0]["category_id"],
            source_id="source::orphan",
        )
        self.series.write_jsonl(self.root / V2_FILES["references"], [orphan])
        errors = self.errors()
        self.assertTrue(any("orphan reference" in error for error in errors), errors[:20])

    def test_progress_hashes_all_six_full_v2_payloads_and_rejects_tampering(self):
        progress = json.loads((self.root / "series-progress.json").read_text())
        entry = next(item for item in progress["batches"] if item["batch_id"] == "domestic-01")
        self.assertEqual(set(V2_FILES.values()), set(entry["v2_ledger_sha256"]))
        attempts_path = self.root / V2_FILES["attempts"]
        attempts = self.series.read_jsonl(attempts_path)
        attempts[0]["query_or_locator"] += " tampered"
        payload = {key: value for key, value in attempts[0].items() if key != "receipt_content_sha256"}
        attempts[0]["receipt_content_sha256"] = hashlib.sha256(
            json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        self.series.write_jsonl(attempts_path, attempts)
        errors = self.errors()
        self.assertTrue(any("250-cell set and hash" in error for error in errors), errors[:20])

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

    def test_repository_production_series_preserves_refreeze_work_as_nonpublishable_audit(self):
        research = ROOT / "docs" / "research" / "company-benefits"
        report = json.loads((research / "series-remap-report.json").read_text())
        self.assertEqual(2000, report["new_population_count"])
        self.assertEqual(report["removed_count"], len(report["removed_company_ids"]))
        self.assertEqual(report["new_count"], len(report["new_company_ids"]))
        self.assertEqual(150, len(self.series.read_jsonl(research / "benefit-claims.jsonl")))
        self.assertEqual(2000, len(self.series.read_jsonl(research / "reviews.jsonl")))
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
