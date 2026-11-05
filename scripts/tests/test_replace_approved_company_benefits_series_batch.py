import copy
import hashlib
import importlib.util
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

from scripts.tests.benefits_test_fixture import FrozenFixture
from scripts.tests.benefits_v2_batch_fixture import V2_FILES, no_public_info_records

ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / "scripts" / "replace-approved-company-benefits-series-batch.py"


def load_module():
    spec = importlib.util.spec_from_file_location("series_batch_replacement", MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ApprovedBatchReplacementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.root = base / "research"
        self.package_dir = base / "replacement-package"
        self.package_dir.mkdir()
        self.approval_path = base / "correction-approval.json"
        self.freeze_receipt = base / "freeze-anchor-receipt.json"
        self.fixture = FrozenFixture(self.root)
        self.module.series.materialize_contract(self.root, set(), {}, {})
        batches = self.module.series.read_jsonl(self.root / "series-batches.jsonl")
        self.batch = next(item for item in batches if item["batch_id"] == "domestic-02")
        self.other_batch = next(item for item in batches if item["batch_id"] == "domestic-01")
        self.old_records = no_public_info_records(self.batch, self.fixture.companies)
        self.other_records = no_public_info_records(self.other_batch, self.fixture.companies)
        for ledger, filename in V2_FILES.items():
            field = self.module.series.V2_ID_FIELDS[ledger]
            records = sorted(self.other_records[ledger] + self.old_records[ledger], key=lambda item: item[field])
            self.module.series.write_jsonl(self.root / filename, records)
        self.module.series.materialize_contract(
            self.root,
            {self.other_batch["batch_id"], self.batch["batch_id"]},
            {self.other_batch["batch_id"]: "2026-10-21T00:00:00Z", self.batch["batch_id"]: "2026-10-22T00:00:00Z"},
            {self.other_batch["batch_id"]: ["other-reviewer"], self.batch["batch_id"]: ["old-reviewer"]},
        )
        self.replacement_records = copy.deepcopy(self.old_records)
        attempt = self.replacement_records["attempts"][0]
        attempt["query_or_locator"] += " corrected"
        payload = {key: value for key, value in attempt.items() if key != "receipt_content_sha256"}
        attempt["receipt_content_sha256"] = hashlib.sha256(
            json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        self._write_package()
        self._write_approval()
        self.freeze_receipt.write_bytes(self.module.series.json_bytes({
            "schema_version": "1",
            "protocol_version": self.fixture.protocol["version"],
            "freeze_manifest_sha256": next(iter(self.fixture.approved_freeze_anchors().values())),
            "review_status": "approved",
            "issued_at": "2026-10-21T00:00:00Z",
        }))

    def tearDown(self):
        self.tmp.cleanup()

    def _write_jsonl(self, name, records):
        raw = self.module.series.jsonl_bytes(records)
        (self.package_dir / name).write_bytes(raw)
        return hashlib.sha256(raw).hexdigest()

    def _write_package(self, batch=None, approved_at="2026-10-24T00:00:00Z"):
        batch = batch or self.batch
        gaps = [{
            "audit_id": f"company-gap::v2::{batch['batch_id']}::{company_id}", "company_id": company_id,
            "researcher_id": "replacement-researcher", "disposition": "nonpublishable",
            "reason": "공개 공식 자료에서 확인하지 못했습니다.",
            "searched_official_source_ids": ["replacement-exact-route"], "searched_official_urls": [],
            "nonabsence_wording": "복지가 없다는 뜻이 아닙니다.",
        } for company_id in batch["company_ids"]]
        source = {
            "record_type": "nonpublishable_metadata", "source_id": "replacement-exact-route",
            "title": "Exact entity official discovery route", "owner": "Official registry",
            "source_type": "government_register", "jurisdiction": "KR", "url": "https://official.invalid/entity",
            "checked_at": "2026-10-20T01:00:00Z", "route_quality": "exact_entity",
            "publication_eligible": False, "nonpublication_reason": "Discovery metadata only.",
            "entity_binding_status": "exact_entity", "retention_mode": "metadata_only", "reuse_status": "discovery_only",
            "access_observation": {"status": 200, "final_url": "https://official.invalid/entity", "access_wall": "none"},
        }
        reviews = [{
            "review_id": f"review::{gap['audit_id']}", "record_id": gap["audit_id"],
            "researcher_id": "replacement-researcher", "reviewer_id": "replacement-reviewer",
            "decision": "approved", "reviewed_at": "2026-10-23T00:00:00Z", "issues": [],
            "resolution": "approved nonclaim outcome", "quote_entailment_confirmed": True,
        } for gap in gaps]
        checks = [{
            "source_id": source["source_id"], "url": source["url"], **source["access_observation"],
            "checked_at": "2026-10-23T12:00:00Z",
        }]
        values = {
            "sources.jsonl": [source], "claims.jsonl": [], "reviews.jsonl": reviews,
            "gaps.jsonl": gaps, "checks.jsonl": checks,
            **{filename: self.replacement_records[ledger] for ledger, filename in V2_FILES.items()},
        }
        artifacts = {name: self._write_jsonl(name, records) for name, records in values.items()}
        requests = [{
            "request_id": f"review-request::gap::{gap['audit_id']}", "target_type": "gap",
            "target_id": gap["audit_id"], "researcher_id": gap["researcher_id"],
            "status": "pending_independent_review",
        } for gap in gaps]
        candidate_values = {
            "sources.jsonl": [source], "claims.jsonl": [], "gaps.jsonl": gaps,
            "review-requests.jsonl": requests,
            **{filename: values[filename] for filename in V2_FILES.values()},
        }
        candidate_artifacts = {
            name: hashlib.sha256(self.module.series.jsonl_bytes(records)).hexdigest()
            for name, records in candidate_values.items()
        }
        candidate = {
            "schema_version": "1", "batch_id": batch["batch_id"],
            "company_list_sha256": batch["company_list_sha256"],
            "effective_sequence_sha256": batch["effective_sequence_sha256"],
            "replacement_events_sha256": batch["replacement_events_sha256"],
            "status": "review_pending", "researcher_id": "replacement-researcher",
            "artifacts": candidate_artifacts,
        }
        candidate_raw = self.module.series.json_bytes(candidate)
        review_bundle = {
            "schema_version": "1", "candidate_manifest_sha256": hashlib.sha256(candidate_raw).hexdigest(),
            "candidate_artifacts": candidate_artifacts, "promotion_reviewer_id": "replacement-reviewer",
            "approved_at": approved_at,
            "artifacts": {name: artifacts[name] for name in ("reviews.jsonl", "checks.jsonl")},
        }
        review_raw = self.module.series.json_bytes(review_bundle)
        manifest = {
            "schema_version": "1", "batch_id": batch["batch_id"],
            "company_list_sha256": batch["company_list_sha256"],
            "effective_sequence_sha256": batch["effective_sequence_sha256"],
            "replacement_events_sha256": batch["replacement_events_sha256"],
            "status": "approved", "approved_at": approved_at, "reviewer_id": "replacement-reviewer",
            "artifacts": artifacts,
            "review_audit": {
                "candidate_manifest_sha256": hashlib.sha256(candidate_raw).hexdigest(),
                "candidate_manifest": candidate, "candidate_artifacts": candidate_artifacts,
                "review_bundle_sha256": hashlib.sha256(review_raw).hexdigest(),
                "review_bundle": review_bundle, "review_artifacts": review_bundle["artifacts"],
            },
        }
        (self.package_dir / "batch.json").write_bytes(self.module.series.json_bytes(manifest))
        return manifest

    def _old_hashes(self):
        progress = json.loads((self.root / "series-progress.json").read_text())
        return next(item for item in progress["batches"] if item["batch_id"] == self.batch["batch_id"])["v2_ledger_sha256"]

    def _write_approval(self, **changes):
        value = {
            "schema_version": "1", "action": "replace_approved_company_benefits_series_batch",
            "batch_id": self.batch["batch_id"], "expected_old_v2_ledger_sha256": self._old_hashes(),
            "replacement_batch_manifest_sha256": hashlib.sha256((self.package_dir / "batch.json").read_bytes()).hexdigest(),
            "approved_at": "2026-10-25T00:00:00Z", "approver_id": "correction-approver",
        }
        value.update(changes)
        self.approval_path.write_bytes(self.module.series.json_bytes(value))

    def _tree(self):
        return {path.relative_to(self.root).as_posix(): path.read_bytes()
                for path in self.root.rglob("*") if path.is_file()}

    def _replace(self):
        return self.module.replace_approved_batch(
            self.batch["batch_id"], self.package_dir, self.approval_path, self.root,
            self.freeze_receipt, as_of=date(2026, 10, 29), repository_root=ROOT,
        )

    def test_replaces_only_target_slice_and_keeps_approved_count_and_legacy_bytes(self):
        legacy = {name: (self.root / name).read_bytes() for name in (
            "benefit-claims.jsonl", "reviews.jsonl", "series-prepublication-checks.jsonl",
            "series-research-gaps.jsonl", "source-registry.jsonl", "series-batches.jsonl",
        )}
        other_before = self.module.series.v2_batch_slice(
            self.module.series.read_v2_batch_records(self.root), self.other_batch
        )
        before_progress = json.loads((self.root / "series-progress.json").read_text())
        old_hashes = self._old_hashes()

        result = self._replace()

        after_progress = json.loads((self.root / "series-progress.json").read_text())
        target = next(item for item in after_progress["batches"] if item["batch_id"] == self.batch["batch_id"])
        other_after = self.module.series.v2_batch_slice(
            self.module.series.read_v2_batch_records(self.root), self.other_batch
        )
        self.assertEqual(2, sum(item["status"] == "approved" for item in result["batches"]))
        self.assertEqual(2, sum(item["status"] == "approved" for item in after_progress["batches"]))
        self.assertEqual(other_before, other_after)
        self.assertEqual(
            [item for item in before_progress["batches"] if item["batch_id"] != self.batch["batch_id"]],
            [item for item in after_progress["batches"] if item["batch_id"] != self.batch["batch_id"]],
        )
        self.assertNotEqual(old_hashes, target["v2_ledger_sha256"])
        self.assertEqual(250, target["cell_count"])
        self.assertEqual(legacy, {name: (self.root / name).read_bytes() for name in legacy})
        audit = self.module.series.read_jsonl(self.root / self.module.AUDIT_FILENAME)
        self.assertEqual((1, self.batch["batch_id"], "correction-approver"),
                         (audit[0]["sequence"], audit[0]["batch_id"], audit[0]["correction_approver_id"]))
        body = {key: value for key, value in audit[0].items() if key != "event_sha256"}
        self.assertEqual(
            hashlib.sha256(self.module.series.canonical_json_bytes(body)).hexdigest(),
            audit[0]["event_sha256"],
        )
        self.assertEqual(audit, self.module._validate_audit_chain(self.root / self.module.AUDIT_FILENAME))

    def test_rejects_batch_mismatch_approval_regression_and_stale_hashes_without_writes(self):
        cases = []
        cases.append(("batch mismatch", lambda: self._write_approval(batch_id=self.other_batch["batch_id"])))
        def prepare_regression():
            progress_path = self.root / "series-progress.json"
            progress = json.loads(progress_path.read_text())
            target = next(item for item in progress["batches"] if item["batch_id"] == self.batch["batch_id"])
            target["approved_at"] = "2026-10-26T00:00:00Z"
            progress_path.write_bytes(self.module.series.json_bytes(progress))
            self._write_approval(approved_at="2026-10-27T00:00:00Z")

        cases.append(("approval regression", prepare_regression))
        cases.append(("stale expected old package hashes", lambda: self._write_approval(
            expected_old_v2_ledger_sha256={**self._old_hashes(), V2_FILES["cells"]: "0" * 64}
        )))

        for message, prepare in cases:
            with self.subTest(message=message):
                self._write_package()
                self._write_approval()
                prepare()
                before = self._tree()
                with self.assertRaisesRegex(ValueError, message):
                    self._replace()
                self.assertEqual(before, self._tree())

    def test_replacement_collision_gate_rejects_cross_batch_v2_id(self):
        integrator = self.module._integrator()
        name = V2_FILES["attempts"]
        field = self.module.series.V2_ID_FIELDS["attempts"]
        incoming_path = Path(self.tmp.name) / "incoming-attempts.jsonl"
        existing_path = Path(self.tmp.name) / "existing-attempts.jsonl"
        incoming_path.write_bytes(b'{"attempt_id":"cross-batch-id"}\n')
        existing_path.write_bytes(b'{"attempt_id":"cross-batch-id"}\n')
        incoming = [{field: "cross-batch-id"}]
        existing = [{field: "cross-batch-id"}]

        with self.assertRaisesRegex(ValueError, "cross-batch.*collision"):
            integrator.validate_record_collisions(
                name, incoming_path, existing_path, incoming, existing
            )

    def test_immutable_legacy_projection_overlap_is_validated_separately(self):
        integrator = self.module._integrator()
        legacy_targets = {
            "sources.jsonl": "source-registry.jsonl",
            "claims.jsonl": "benefit-claims.jsonl",
            "reviews.jsonl": "reviews.jsonl",
            "gaps.jsonl": "series-research-gaps.jsonl",
        }
        id_fields = {
            "sources.jsonl": "source_id",
            "claims.jsonl": "claim_id",
            "reviews.jsonl": "review_id",
            "gaps.jsonl": "audit_id",
        }
        package = Path(self.tmp.name) / "legacy-projections"
        research = Path(self.tmp.name) / "legacy-expectations"
        package.mkdir()
        research.mkdir()
        for name, target in legacy_targets.items():
            field = id_fields[name]
            record = ({field: "company-gap::legacy-company", "company_id": "legacy-company", "value": 1}
                      if name == "gaps.jsonl" else {field: f"frozen-{field}", "value": 1})
            raw = self.module.series.jsonl_bytes([record])
            (package / name).write_bytes(raw)
            (research / target).write_bytes(raw)

        self.module._validate_immutable_legacy_projections(
            integrator, package, research
        )

        for name, target in legacy_targets.items():
            with self.subTest(name=name):
                field = id_fields[name]
                original = (research / target).read_bytes()
                record = ({field: "company-gap::legacy-company", "company_id": "legacy-company", "value": 2}
                          if name == "gaps.jsonl" else {field: f"frozen-{field}", "value": 2})
                (research / target).write_bytes(
                    self.module.series.jsonl_bytes([record])
                )
                with self.assertRaisesRegex(ValueError, f"cross-batch {field} collision"):
                    self.module._validate_immutable_legacy_projections(
                        integrator, package, research
                    )
                (research / target).write_bytes(original)

    def test_post_exchange_failure_rolls_back_byte_identically(self):
        before = self._tree()
        real_fsync = self.module._fsync_directory

        def fail_after_exchange(path):
            if Path(path) == self.root.parent and (self.root / self.module.AUDIT_FILENAME).exists():
                raise OSError("injected post-exchange failure")
            return real_fsync(path)

        with mock.patch.object(self.module, "_fsync_directory", side_effect=fail_after_exchange):
            with self.assertRaisesRegex(OSError, "post-exchange failure"):
                self._replace()
        self.assertEqual(before, self._tree())

    def test_rejects_symlinked_package_artifact_without_writes(self):
        outside = Path(self.tmp.name) / "outside-checks.jsonl"
        artifact = self.package_dir / "checks.jsonl"
        outside.write_bytes(artifact.read_bytes())
        artifact.unlink()
        artifact.symlink_to(outside)
        before = self._tree()

        with self.assertRaisesRegex(ValueError, "symlink"):
            self._replace()
        self.assertEqual(before, self._tree())

    def test_rejects_noncanonical_or_wrongly_bound_external_approval_without_writes(self):
        before = self._tree()
        approval = json.loads(self.approval_path.read_text())
        self.approval_path.write_text(json.dumps(approval, indent=2), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "canonical"):
            self._replace()
        self.assertEqual(before, self._tree())

        self._write_approval(replacement_batch_manifest_sha256="0" * 64)
        with self.assertRaisesRegex(ValueError, "manifest hash"):
            self._replace()
        self.assertEqual(before, self._tree())


if __name__ == "__main__":
    unittest.main()
