import importlib.util
import json
import tempfile
import unittest
import sys
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / "scripts" / "integrate-company-benefits-series.py"


def load_module():
    spec = importlib.util.spec_from_file_location("series_transaction", MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TransactionalSeriesIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=ROOT.parent)
        self.base = Path(self.tmp.name)
        self.root = self.base / "research"
        self.root.mkdir()
        (self.root / "marker.txt").write_text("original", encoding="utf-8")
        self.packages = self.base / "approved"
        self.packages.mkdir()
        self.canonical = []
        self.paths = []
        for index in range(80):
            scope = "domestic" if index < 40 else "international"
            number = index + 1 if index < 40 else index - 39
            batch_id = f"{scope}-{number:02d}"
            batch = {"batch_id": batch_id, "scope": scope, "batch_number": number,
                     "company_ids": [f"company-{index:02d}-{n:02d}" for n in range(25)]}
            self.canonical.append(batch)
            # Names are deliberately unrelated to batch identity.
            package = self.packages / f"package-{79-index:02d}"
            package.mkdir()
            records = {
                "sources.jsonl": [{"source_id": f"source-{index:02d}"}],
                "claims.jsonl": [{"claim_id": f"claim-{index:02d}"}],
                "reviews.jsonl": [{"review_id": f"review-{index:02d}"}],
                "gaps.jsonl": [{"audit_id": f"gap-{index:02d}"}],
                "checks.jsonl": [{"source_id": f"check-{index:02d}"}],
            }
            artifacts = {}
            for name, values in records.items():
                raw = b"".join(json.dumps(item, separators=(",", ":")).encode() + b"\n" for item in values)
                (package / name).write_bytes(raw)
                artifacts[name] = self.module.sha256(raw)
            (package / "batch.json").write_text(json.dumps({
                "schema_version": "1", "batch_id": batch_id, "status": "approved",
                "approved_at": "2026-10-30T00:00:00Z", "reviewer_id": f"reviewer-{index:02d}",
                "artifacts": artifacts,
            }), encoding="utf-8")
            self.paths.append(package)
        self.manifest = self.base / "packages.json"
        self.write_manifest(self.paths)
        self.receipt = self.base / "external-receipt.json"

    def test_integrator_disables_repository_bytecode_writes(self):
        self.assertTrue(sys.dont_write_bytecode)

    def tearDown(self):
        self.tmp.cleanup()

    def write_manifest(self, paths):
        self.manifest.write_text(json.dumps({"schema_version": "1", "packages": [str(path) for path in paths]}), encoding="utf-8")

    def loader(self, package, research_root):
        manifest = json.loads((Path(package) / "batch.json").read_text())
        batch = next(item for item in self.canonical if item["batch_id"] == manifest["batch_id"])
        records = {}
        for name in self.module.PACKAGE_FILES:
            records[name] = [json.loads(line) for line in (Path(package) / name).read_text().splitlines()]
        return manifest, batch, records

    def test_manifest_requires_all_canonical_batches_once_in_order_without_using_directory_names(self):
        loaded = self.module.prevalidate_manifest(self.manifest, self.root, self.canonical, self.loader)
        self.assertEqual([item["batch_id"] for item in self.canonical], [item.batch["batch_id"] for item in loaded.packages])
        for paths, message in ((self.paths[:-1], "80"), (self.paths[:1] + self.paths[:1] + self.paths[2:], "duplicate"),
                               (self.paths[1:2] + self.paths[:1] + self.paths[2:], "canonical order")):
            with self.subTest(message=message):
                self.write_manifest(paths)
                with self.assertRaisesRegex(ValueError, message):
                    self.module.prevalidate_manifest(self.manifest, self.root, self.canonical, self.loader)

    def test_prevalidation_rejects_global_source_claim_review_and_check_collisions(self):
        cases = (("sources.jsonl", "source_id"), ("claims.jsonl", "claim_id"),
                 ("reviews.jsonl", "review_id"), ("checks.jsonl", "source_id"))
        for filename, field in cases:
            with self.subTest(filename=filename):
                target = self.paths[1] / filename
                value = json.loads((self.paths[0] / filename).read_text())
                target.write_text(json.dumps(value) + "\n", encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "global.*collision"):
                    self.module.prevalidate_manifest(self.manifest, self.root, self.canonical, self.loader)
                # Restore this package for the next subtest.
                target.write_text(json.dumps({field: ("check-01" if filename == "checks.jsonl" else f"{field.split('_')[0]}-01")}) + "\n", encoding="utf-8")

    def test_symlink_package_is_rejected_and_receipt_must_be_external(self):
        alias = self.base / "alias"
        alias.symlink_to(self.paths[0], target_is_directory=True)
        self.write_manifest([alias] + self.paths[1:])
        with self.assertRaisesRegex(ValueError, "symlink"):
            self.module.prevalidate_manifest(self.manifest, self.root, self.canonical, self.loader)
        with self.assertRaisesRegex(ValueError, "outside the repository"):
            self.module.validate_receipt_path(ROOT / "receipt.json", ROOT, self.root)
        external = self.base / "external"
        external.mkdir()
        linked_parent = self.base / "linked-parent"
        linked_parent.symlink_to(ROOT, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "symlink|outside the repository"):
            self.module.validate_receipt_path(linked_parent / "receipt.json", ROOT, self.root)
        root_alias = self.base / "research-alias"
        root_alias.symlink_to(self.root, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "research root symlink"):
            self.module.integrate_series(self.manifest, root_alias, self.receipt, self.base / "freeze.json")

    def test_failure_at_package_40_or_80_leaves_active_root_and_receipt_untouched(self):
        for failure_at in (40, 80):
            with self.subTest(failure_at=failure_at):
                before = self.module.tree_manifest(self.root)
                calls = []

                def integrate(path, staged, **kwargs):
                    calls.append(path)
                    if len(calls) == failure_at:
                        raise ValueError(f"package {failure_at} failed")

                with mock.patch.object(self.module, "canonical_batches", return_value=self.canonical), \
                     mock.patch.object(self.module, "load_batch_package", side_effect=self.loader), \
                     mock.patch.object(self.module, "integrate_one", side_effect=integrate):
                    with self.assertRaisesRegex(ValueError, f"package {failure_at} failed"):
                        self.module.integrate_series(self.manifest, self.root, self.receipt, self.base / "freeze.json")
                self.assertEqual(before, self.module.tree_manifest(self.root))
                self.assertFalse(self.receipt.exists())

    def test_integration_consumes_validated_package_snapshots_not_mutable_originals(self):
        consumed = []

        def integrate(path, staged, **kwargs):
            consumed.append(Path(path))
            self.assertNotIn(Path(path), self.paths)
            self.assertTrue((Path(path) / "batch.json").is_file())

        def finalize(staged, packages, **kwargs):
            return {"status": "complete", "batches": [
                {"status": "approved", "claim_count": 0, "no_claim_count": 25} for _ in packages
            ]}

        with mock.patch.object(self.module, "canonical_batches", return_value=self.canonical), \
             mock.patch.object(self.module, "load_batch_package", side_effect=self.loader), \
             mock.patch.object(self.module, "integrate_one", side_effect=integrate), \
             mock.patch.object(self.module, "finalize_series", side_effect=finalize), \
             mock.patch.object(self.module, "verify_staged", return_value=[]):
            self.module.integrate_series(self.manifest, self.root, self.receipt, self.base / "freeze.json", dry_run=True)
        self.assertEqual(80, len(consumed))

    def test_receipt_publish_is_atomic_and_leaves_no_temporary_file(self):
        value = {"schema_version": "1", "status": "complete"}
        with mock.patch.object(self.module.os, "link", wraps=self.module.os.link) as link:
            self.module._write_receipt_exclusive(self.receipt, value)
        link.assert_called_once()
        self.assertEqual(value, json.loads(self.receipt.read_text()))
        self.assertEqual([], list(self.base.glob(f".{self.receipt.name}.*")))

    def test_receipt_is_durable_before_promotion_and_removed_if_exchange_fails(self):
        events = []

        def finalize(staged, packages, **kwargs):
            return {"status": "complete", "batches": [
                {"status": "approved", "claim_count": 0, "no_claim_count": 25} for _ in packages
            ]}

        def write_receipt(path, value):
            events.append("receipt")
            Path(path).write_text(json.dumps(value))

        def exchange(left, right):
            events.append("exchange")
            raise OSError("promotion failed")

        def sync_tree(path):
            events.append("sync-tree")

        with mock.patch.object(self.module, "canonical_batches", return_value=self.canonical), \
             mock.patch.object(self.module, "load_batch_package", side_effect=self.loader), \
             mock.patch.object(self.module, "integrate_one"), \
             mock.patch.object(self.module, "finalize_series", side_effect=finalize), \
             mock.patch.object(self.module, "verify_staged", return_value=[]), \
             mock.patch.object(self.module, "_fsync_tree", side_effect=sync_tree), \
             mock.patch.object(self.module, "_write_receipt_exclusive", side_effect=write_receipt), \
             mock.patch.object(self.module, "_atomic_exchange", side_effect=exchange):
            with self.assertRaisesRegex(OSError, "promotion failed"):
                self.module.integrate_series(self.manifest, self.root, self.receipt, self.base / "freeze.json")
        self.assertEqual(["sync-tree", "receipt", "exchange"], events)
        self.assertFalse(self.receipt.exists())

    def test_finalize_renders_all_batches_before_complete_transition_and_rebuilds_hub(self):
        staged = self.base / "staged"
        staged.mkdir()
        (staged / "drafts").mkdir()
        (staged / "drafts" / "stale.md").write_text("stale")
        packages = []
        for path, batch in zip(self.paths, self.canonical):
            manifest = json.loads((path / "batch.json").read_text())
            packages.append(self.module.ApprovedPackage(path, manifest, batch, {}))
        statuses = []

        def materialize(root, approved, approvals, reviewers, status):
            statuses.append(status)
            progress = {"status": status, "batches": []}
            (Path(root) / "series-progress.json").write_text(json.dumps(progress))
            return self.canonical, progress

        class Renderer:
            @staticmethod
            def render_batch(root, output, scope, number, **kwargs):
                (Path(output) / f"{scope}-{number:02d}.md").write_text("batch")

            @staticmethod
            def render_hub(root, output):
                (Path(output) / "hub.md").write_text("hub")

        with mock.patch.object(self.module.series, "materialize_contract", side_effect=materialize), \
             mock.patch.object(self.module, "_load_script", return_value=Renderer):
            progress = self.module.finalize_series(staged, packages, freeze_anchor_receipt=self.base / "freeze.json")
        self.assertEqual(["in_progress", "complete"], statuses)
        self.assertEqual("complete", progress["status"])
        self.assertEqual(81, len(list((staged / "drafts").iterdir())))
        self.assertFalse((staged / "drafts" / "stale.md").exists())

    def test_success_completes_staged_series_verifies_then_swaps_once_and_refuses_duplicate(self):
        events = []

        def integrate(path, staged, **kwargs):
            events.append(("integrate", json.loads((Path(path) / "batch.json").read_text())["batch_id"]))

        def finalize(staged, packages, **kwargs):
            events.append(("finalize", len(packages)))
            (staged / "marker.txt").write_text("complete", encoding="utf-8")
            drafts = staged / "drafts"
            drafts.mkdir()
            for batch in self.canonical:
                (drafts / f"{batch['batch_id']}.md").write_text(batch["batch_id"])
            (drafts / "hub.md").write_text("complete")
            progress = {"status": "complete", "total_batches": 80, "total_companies": 2000,
                        "batches": [{"batch_id": item["batch_id"], "status": "approved",
                                     "claim_count": 0, "no_claim_count": 25} for item in self.canonical]}
            (staged / "series-progress.json").write_text(json.dumps(progress))
            return progress

        def verify(staged, **kwargs):
            events.append(("verify", (staged / "marker.txt").read_text()))
            return []

        with mock.patch.object(self.module, "canonical_batches", return_value=self.canonical), \
             mock.patch.object(self.module, "load_batch_package", side_effect=self.loader), \
             mock.patch.object(self.module, "integrate_one", side_effect=integrate), \
             mock.patch.object(self.module, "finalize_series", side_effect=finalize), \
             mock.patch.object(self.module, "verify_staged", side_effect=verify):
            result = self.module.integrate_series(self.manifest, self.root, self.receipt, self.base / "freeze.json")
            self.assertEqual("complete", (self.root / "marker.txt").read_text())
            self.assertEqual(80, result["approved_batches"])
            self.assertEqual("verify", events[-1][0])
            receipt = json.loads(self.receipt.read_text())
            self.assertEqual("complete", receipt["status"])
            self.assertEqual(80, receipt["approved_batches"])
            with self.assertRaisesRegex(ValueError, "already|receipt"):
                self.module.integrate_series(self.manifest, self.root, self.receipt, self.base / "freeze.json")

    def test_dry_run_executes_final_verifier_without_mutating_root_and_writes_deterministic_external_receipt(self):
        before = self.module.tree_manifest(self.root)
        verified = []

        def finalize(staged, packages, **kwargs):
            progress = {"status": "complete", "total_batches": 80, "total_companies": 2000,
                        "batches": [{"status": "approved", "claim_count": 0, "no_claim_count": 25} for _ in packages]}
            (staged / "series-progress.json").write_text(json.dumps(progress))
            return progress

        with mock.patch.object(self.module, "canonical_batches", return_value=self.canonical), \
             mock.patch.object(self.module, "load_batch_package", side_effect=self.loader), \
             mock.patch.object(self.module, "integrate_one"), \
             mock.patch.object(self.module, "finalize_series", side_effect=finalize), \
             mock.patch.object(self.module, "verify_staged", side_effect=lambda *a, **k: verified.append(True) or []):
            self.module.integrate_series(self.manifest, self.root, self.receipt, self.base / "freeze.json", dry_run=True)
        self.assertTrue(verified)
        self.assertEqual(before, self.module.tree_manifest(self.root))
        receipt = json.loads(self.receipt.read_text())
        self.assertEqual("validated_dry_run", receipt["status"])
        self.assertEqual("complete", receipt["staged_status"])


if __name__ == "__main__":
    unittest.main()
