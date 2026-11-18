import importlib.util
import gc
import hashlib
import json
import resource
import subprocess
import tempfile
import time
import unittest
import sys
import shutil
import weakref
from datetime import date
from pathlib import Path
from unittest import mock

from scripts.tests.test_verify_benefit_release_checkpoint import promoted_current_package

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
                "company-category-cells.jsonl": [{"cell_id": f"cell-{index:02d}"}],
                "research-attempts.jsonl": [{"attempt_id": f"attempt-{index:02d}"}],
                "official-claims-v2.jsonl": [{"claim_id": f"official-{index:02d}"}],
                "reference-records.jsonl": [{"reference_id": f"reference-{index:02d}"}],
                "community-benefit-reports.jsonl": [{"community_report_id": f"community-{index:02d}"}],
                "sources-v2.jsonl": [{"source_id": f"source-v2-{index:02d}"}],
                "verified-benefits.jsonl": [{"benefit_id": f"benefit-{index:02d}"}],
                "company-category-outcomes.jsonl": [{"cell_id": f"outcome-{index:02d}"}],
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
            (package / "series-batch-approval.jsonl").write_text(
                json.dumps({"package_sha256": f"{index + 1:064x}",
                            "reviewer_receipt_sha256": f"{index + 101:064x}"}) + "\n",
                encoding="utf-8",
            )
            (package / "SHA256SUMS").write_text("fixture checksums\n", encoding="utf-8")
            self.paths.append(package)
        self.manifest = self.base / "packages.json"
        self.write_manifest(self.paths)
        self.receipt = self.base / "external-receipt.json"

    def test_integrator_disables_repository_bytecode_writes(self):
        self.assertTrue(sys.dont_write_bytecode)

    def test_package_inventory_is_the_production_protocol_2_inventory(self):
        batch_integrator = self.module._batch_integrator()
        self.assertEqual(set(batch_integrator.CURRENT_ALLOWED_FILES), set(self.module.PACKAGE_MEMBERS))
        self.assertEqual(16, len(self.module.PACKAGE_MEMBERS))

    def test_snapshot_uses_current_bounded_inventory_and_rejects_missing_or_extra_members(self):
        current = self.base / "current-package"
        promoted_current_package(current, "domestic-01")
        snapshot = self.base / "snapshot"
        self.module.snapshot_package(current, snapshot)
        self.assertEqual(
            {path.name: path.read_bytes() for path in current.iterdir()},
            {path.name: path.read_bytes() for path in snapshot.iterdir()},
        )
        for mutation in ("missing", "extra"):
            hostile = self.base / f"hostile-{mutation}"
            shutil.copytree(current, hostile)
            if mutation == "missing":
                (hostile / "SHA256SUMS").unlink()
            else:
                (hostile / "extra.json").write_text("{}", encoding="utf-8")
            with self.subTest(mutation=mutation), self.assertRaisesRegex(ValueError, "exact canonical file set"):
                self.module.snapshot_package(hostile, self.base / f"snapshot-{mutation}")

    def test_real_protocol_2_loader_recomputes_exact_25_by_10_outcomes(self):
        current = self.base / "current-loader-package"
        promoted_current_package(current, "domestic-22")
        pending = self.base / "pending-research"
        canonical = ROOT / "docs" / "research" / "company-benefits"
        shutil.copytree(canonical, pending)
        batch_integrator = self.module._batch_integrator()
        for relative in batch_integrator.LEDGER_TARGETS:
            target = pending / relative
            if target.suffix == ".jsonl":
                target.write_bytes(b"")
        batch_integrator.series.materialize_contract(pending, set(), {}, {})

        _, batch, records = self.module.load_batch_package(current, pending)
        self.assertEqual(25, len(batch["company_ids"]))
        self.assertEqual(250, len(records["company-category-cells.jsonl"]))
        self.assertEqual(250, len(records["company-category-outcomes.jsonl"]))

        checksums_path = current / "SHA256SUMS"
        checksums = checksums_path.read_bytes()
        lines = checksums.decode("utf-8").splitlines()
        for mutation, mutated in (
            ("missing", "\n".join(lines[:-1]) + "\n"),
            ("extra", checksums.decode("utf-8") + f"{'0' * 64}  extra.json\n"),
        ):
            with self.subTest(checksum_member=mutation):
                checksums_path.write_text(mutated, encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "SHA256SUMS.*complete package inventory"):
                    self.module.load_batch_package(current, pending)
                checksums_path.write_bytes(checksums)

        outcomes_path = current / "company-category-outcomes.jsonl"
        outcomes = batch_integrator.series.read_jsonl(outcomes_path)
        outcomes[0]["outcome"] = "verified_benefit"
        outcomes_path.write_bytes(batch_integrator.series.jsonl_bytes(outcomes))
        self._rebind_current_package(current, batch_integrator)
        with self.assertRaisesRegex(ValueError, "outcome|derived"):
            self.module.load_batch_package(current, pending)

    def test_real_multi_package_spools_write_each_final_ledger_once(self):
        pending = self.base / "multi-package-research"
        canonical = ROOT / "docs" / "research" / "company-benefits"
        shutil.copytree(canonical, pending)
        batch_integrator = self.module._batch_integrator()
        for relative in batch_integrator.LEDGER_TARGETS:
            target = pending / relative
            if target.suffix == ".jsonl":
                target.write_bytes(b"")
        batch_integrator.series.materialize_contract(pending, set(), {}, {})

        packages = []
        for batch_id in ("domestic-22", "domestic-23"):
            package = self.base / f"production-{batch_id}"
            promoted_current_package(
                package, batch_id, reviewer_id=f"multi-reviewer-{batch_id}",
            )
            packages.append(package)

        spool_root = self.base / "ledger-spools"
        loaded = []
        expected_identities = {name: set() for name in self.module.MERGED_LEDGER_FIELDS}
        original_write = batch_integrator.series.write_jsonl
        original_read = batch_integrator.series.read_jsonl
        final_writes = []
        accumulated_rows_read = []
        merge_complete = []
        materializations = []

        def counted_write(path, values):
            path = Path(path)
            if path.parent == pending and path.name in self.module.MERGED_LEDGER_FIELDS:
                final_writes.append(path.name)
            return original_write(path, values)

        def counted_read(path):
            rows = original_read(path)
            path = Path(path)
            if (not merge_complete and path.parent == pending
                    and path.name in self.module.MERGED_LEDGER_FIELDS):
                accumulated_rows_read.extend(rows)
            return rows

        original_materialize = batch_integrator.series.materialize_contract
        def counted_materialize(*args, **kwargs):
            materializations.append(True)
            return original_materialize(*args, **kwargs)

        with mock.patch.object(batch_integrator, "load_package", wraps=batch_integrator.load_package) as loader, \
             mock.patch.object(batch_integrator.series, "write_jsonl", side_effect=counted_write), \
             mock.patch.object(batch_integrator.series, "read_jsonl", side_effect=counted_read), \
             mock.patch.object(batch_integrator.series, "materialize_contract", side_effect=counted_materialize), \
             mock.patch.object(self.module, "_write_merged_ledger", wraps=self.module._write_merged_ledger) as merged_writes:
            for position, package in enumerate(packages, 1):
                manifest, batch, records = batch_integrator.load_package(package, pending)
                for package_name, (target, field) in self.module.MERGED_PACKAGE_LEDGER_FIELDS.items():
                    expected_identities[target].update(item[field] for item in records[package_name])
                self.module.spool_loaded_package(spool_root, position, manifest, records)
                loaded.append(self.module.ApprovedPackage(package, manifest, batch))
            self.module.merge_spooled_ledgers(pending, spool_root)
            merge_complete.append(True)
            approval_times = {item.batch["batch_id"]: item.manifest["approved_at"] for item in loaded}
            reviewers = {item.batch["batch_id"]: [item.manifest["reviewer_id"]] for item in loaded}
            batch_integrator.series.materialize_contract(
                pending, set(approval_times), approval_times, reviewers, status="in_progress",
            )

        self.assertEqual(2, loader.call_count)
        self.assertEqual(1, len(materializations))
        self.assertEqual([], final_writes)
        self.assertEqual([], accumulated_rows_read)
        self.assertEqual(len(self.module.MERGED_LEDGER_FIELDS), merged_writes.call_count)
        self.assertEqual(
            set(self.module.MERGED_LEDGER_FIELDS),
            {Path(call.args[0]).name for call in merged_writes.call_args_list},
        )
        self.assertEqual(500, len(batch_integrator.series.read_jsonl(
            pending / "company-category-cells.jsonl"
        )))
        self.assertEqual(500, len(batch_integrator.series.read_jsonl(
            pending / "company-category-outcomes.jsonl"
        )))
        company_position = {
            company_id: position
            for position, company_id in enumerate(
                company_id
                for batch in batch_integrator.series.read_jsonl(pending / "series-batches.jsonl")
                for company_id in batch["company_ids"]
            )
        }
        category_position = {
            category: position for position, category in enumerate(batch_integrator.series.V2_CATEGORIES)
        }
        for filename, field in self.module.MERGED_LEDGER_FIELDS.items():
            rows = batch_integrator.series.read_jsonl(pending / filename)
            if filename in self.module.CANONICAL_CELL_ORDER_LEDGERS:
                def canonical_key(item):
                    key = (company_position[item["company_id"]], category_position[item["category_id"]])
                    return (*key, item["route_id"]) if filename == "research-attempts.jsonl" else key
                self.assertEqual(rows, sorted(rows, key=canonical_key))
            else:
                self.assertEqual(rows, sorted(rows, key=lambda item: item[field]))
            self.assertEqual(expected_identities[filename], {item[field] for item in rows})

    def test_eighty_package_merge_is_descriptor_bounded_and_closes_descriptors(self):
        staged = self.base / "descriptor-bounded-research"
        staged.mkdir()
        spool_root = self.base / "descriptor-bounded-spools"
        expected = {name: set() for name in self.module.MERGED_LEDGER_FIELDS}
        for position, package in enumerate(self.paths, 1):
            manifest, _, records = self.loader(package, staged)
            manifest["schema_version"] = "2"
            batch_id = manifest["batch_id"]
            records["company-category-cells.jsonl"] = [
                {"cell_id": f"cell-{batch_id}-{cell:03d}"} for cell in range(250)
            ]
            records["company-category-outcomes.jsonl"] = [
                {"cell_id": f"outcome-{batch_id}-{cell:03d}"} for cell in range(250)
            ]
            records["series-batch-approval.jsonl"][0]["batch_id"] = batch_id
            self.module.spool_loaded_package(spool_root, position, manifest, records)
            for package_name, (target, field) in self.module.MERGED_PACKAGE_LEDGER_FIELDS.items():
                expected[target].update(item[field] for item in records[package_name])
        for target, field in self.module.MERGED_LEDGER_FIELDS.items():
            existing = {field: f"000-existing-{target}"}
            (staged / target).write_bytes(self.module.series.jsonl_bytes([existing]))
            expected[target].add(existing[field])

        before_descriptors = len(list(Path("/proc/self/fd").iterdir()))
        old_soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
        constrained_soft = min(64, hard)
        self.assertGreaterEqual(constrained_soft, 32)
        active_inputs = 0
        max_active_inputs = 0
        original_iter = self.module._iter_sorted_jsonl
        budget = self.module._budget_existing_spools(spool_root)

        def tracked_iter(*args, **kwargs):
            nonlocal active_inputs, max_active_inputs
            active_inputs += 1
            max_active_inputs = max(max_active_inputs, active_inputs)
            try:
                yield from original_iter(*args, **kwargs)
            finally:
                active_inputs -= 1

        try:
            resource.setrlimit(resource.RLIMIT_NOFILE, (constrained_soft, hard))
            with mock.patch.object(self.module, "_iter_sorted_jsonl", side_effect=tracked_iter):
                self.module.merge_spooled_ledgers(staged, spool_root, budget)
        finally:
            resource.setrlimit(resource.RLIMIT_NOFILE, (old_soft, hard))
        after_descriptors = len(list(Path("/proc/self/fd").iterdir()))

        self.assertEqual(before_descriptors, after_descriptors)
        self.assertEqual(self.module.MERGE_FAN_IN, max_active_inputs)
        self.assertEqual(0, budget.live_bytes)
        self.assertLessEqual(budget.peak_bytes, self.module.MAX_LEDGER_SPOOL_BYTES)
        for target, field in self.module.MERGED_LEDGER_FIELDS.items():
            rows = self.module.series.read_jsonl(staged / target)
            self.assertEqual(len(expected[target]), len(rows))
            self.assertEqual(rows, sorted(rows, key=lambda item: item[field]))
            self.assertEqual(expected[target], {item[field] for item in rows})
        self.assertLessEqual(self.module.MERGE_FAN_IN, 16)
        self.assertEqual([], list(spool_root.glob("**/.merge-runs")))

    def test_intermediate_merge_spool_is_byte_bounded_and_cleaned_on_failure(self):
        runs = self.base / "bounded-run-inputs"
        runs.mkdir()
        paths = []
        for index in range(17):
            path = runs / f"{index:02d}.jsonl"
            path.write_bytes(self.module.series.jsonl_bytes([{"id": f"id-{index:02d}"}]))
            paths.append(path)
        merge_root = self.base / "bounded-merge-work"
        target = self.base / "bounded-output.jsonl"
        budget = self.module.LedgerSpoolBudget(1)
        before_descriptors = len(list(Path("/proc/self/fd").iterdir()))

        with self.assertRaisesRegex(ValueError, "spool.*byte ceiling"):
            self.module._write_merged_ledger(
                target, paths, "id", merge_root=merge_root, spool_budget=budget,
            )

        self.assertFalse(merge_root.exists())
        self.assertEqual(0, budget.live_bytes)
        self.assertEqual(before_descriptors, len(list(Path("/proc/self/fd").iterdir())))

    def _rebind_current_package(self, package, batch_integrator):
        manifest_path = package / "batch.json"
        manifest = json.loads(manifest_path.read_bytes())
        outcome_hash = self.module.sha256((package / "company-category-outcomes.jsonl").read_bytes())
        audit = manifest["review_audit"]
        audit["candidate_artifacts"]["company-category-outcomes.jsonl"] = outcome_hash
        audit["candidate_manifest"]["artifacts"]["company-category-outcomes.jsonl"] = outcome_hash
        candidate_raw = batch_integrator.series.json_bytes(audit["candidate_manifest"])
        audit["candidate_manifest_sha256"] = self.module.sha256(candidate_raw)
        audit["review_bundle"]["candidate_manifest_sha256"] = audit["candidate_manifest_sha256"]
        audit["review_bundle"]["candidate_artifacts"] = audit["candidate_artifacts"]
        audit["review_bundle_sha256"] = self.module.sha256(
            batch_integrator.series.json_bytes(audit["review_bundle"])
        )
        manifest["artifacts"]["company-category-outcomes.jsonl"] = outcome_hash
        manifest_path.write_bytes(batch_integrator.series.json_bytes(manifest))
        approval = batch_integrator.canonical_approval_row(
            manifest["batch_id"], manifest_path.read_bytes(),
            audit["reviewed_candidate_sha256"], audit["reviewer_receipt_sha256"],
        )
        (package / "series-batch-approval.jsonl").write_bytes(
            batch_integrator.series.jsonl_bytes([approval])
        )
        inventory = sorted(path.name for path in package.iterdir() if path.name != "SHA256SUMS")
        (package / "SHA256SUMS").write_text("".join(
            f"{self.module.sha256((package / name).read_bytes())}  {name}\n" for name in inventory
        ), encoding="utf-8")

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
        records["series-batch-approval.jsonl"] = [
            json.loads(line) for line in (Path(package) / "series-batch-approval.jsonl").read_text().splitlines()
        ]
        return manifest, batch, records

    def applied_fixture(self, package, staged=None):
        manifest, batch, _ = self.loader(package, staged)
        compact_manifest = {
            key: manifest.get(key)
            for key in ("schema_version", "batch_id", "status", "approved_at", "reviewer_id")
        }
        compact_batch = {
            key: batch.get(key) for key in ("batch_id", "scope", "batch_number")
        }
        return self.module.ApprovedPackage(package, compact_manifest, compact_batch)

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

    def test_prevalidation_rejects_verified_benefit_and_outcome_id_collisions(self):
        for filename, field in (("verified-benefits.jsonl", "benefit_id"),
                                ("company-category-outcomes.jsonl", "cell_id")):
            with self.subTest(filename=filename):
                target = self.paths[1] / filename
                original = target.read_bytes()
                target.write_bytes((self.paths[0] / filename).read_bytes())
                with self.assertRaisesRegex(ValueError, "global.*collision"):
                    self.module.prevalidate_manifest(self.manifest, self.root, self.canonical, self.loader)
                target.write_bytes(original)

    def test_prevalidation_rejects_package_and_receipt_replay_across_selection_and_canonical_ledger(self):
        first = json.loads((self.paths[0] / "series-batch-approval.jsonl").read_text())
        second_path = self.paths[1] / "series-batch-approval.jsonl"
        original_second = second_path.read_bytes()
        for field in ("package_sha256", "reviewer_receipt_sha256"):
            with self.subTest(scope="selection", field=field):
                second = json.loads(original_second)
                second[field] = first[field]
                second_path.write_text(json.dumps(second) + "\n", encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "package/receipt identity.*replayed"):
                    self.module.prevalidate_manifest(self.manifest, self.root, self.canonical, self.loader)
                second_path.write_bytes(original_second)
            with self.subTest(scope="canonical", field=field):
                (self.root / "series-batch-approvals.jsonl").write_text(
                    json.dumps({field: first[field]}) + "\n", encoding="utf-8"
                )
                with self.assertRaisesRegex(ValueError, "package/receipt identity.*replayed"):
                    self.module.prevalidate_manifest(self.manifest, self.root, self.canonical, self.loader)
                (self.root / "series-batch-approvals.jsonl").unlink()

    def test_prevalidation_releases_each_packages_parsed_ledgers_and_bounds_compact_state(self):
        retained = []

        class TrackableRecords(dict):
            pass

        def tracking_loader(package, research_root):
            manifest, batch, records = self.loader(package, research_root)
            tracked = TrackableRecords(records)
            retained.append(weakref.ref(tracked))
            return manifest, batch, tracked

        loaded = self.module.prevalidate_manifest(
            self.manifest, self.root, self.canonical, tracking_loader,
        )
        gc.collect()
        self.assertEqual(80, len(loaded.packages))
        self.assertTrue(all(reference() is None for reference in retained))
        self.assertTrue(all(not hasattr(package, "records") for package in loaded.packages))

        with mock.patch.object(self.module, "MAX_COMPACT_STATE_BYTES", 1024):
            with self.assertRaisesRegex(ValueError, "compact.*ceiling"):
                self.module.prevalidate_manifest(
                    self.manifest, self.root, self.canonical, self.loader,
                )

    def test_shared_publisher_lock_excludes_batch_and_whole_series_processes(self):
        ready = self.base / "lock-ready"
        release = self.base / "lock-release"
        code = f"""
import importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location('batch_lock_holder', {str(ROOT / 'scripts' / 'integrate-company-benefits-series-batch.py')!r})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with module.acquire_publisher_lock(Path({str(self.root)!r})):
    Path({str(ready)!r}).write_text('ready')
    while not Path({str(release)!r}).exists():
        import time
        time.sleep(0.01)
"""
        process = subprocess.Popen([sys.executable, "-c", code], cwd=ROOT)
        try:
            deadline = time.monotonic() + 10
            while not ready.exists() and process.poll() is None and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(ready.exists(), f"lock holder exited with {process.poll()}")
            with self.assertRaisesRegex(ValueError, "publisher.*in progress"):
                self.module.integrate_series(
                    self.manifest, self.root, self.receipt, self.base / "freeze.json",
                )
            with self.assertRaisesRegex(ValueError, "publisher.*in progress"):
                self.module._batch_integrator().integrate_batch(
                    self.base / "not-a-package", self.root, self.base / "freeze.json",
                )
        finally:
            release.write_text("release")
            process.wait(timeout=10)

    def test_stale_active_tree_is_rejected_immediately_before_exchange(self):
        def finalize(staged, packages, **kwargs):
            (staged / "marker.txt").write_text("complete", encoding="utf-8")
            drafts = staged / "drafts"
            drafts.mkdir()
            for batch in self.canonical:
                (drafts / f"{batch['batch_id']}.md").write_text(batch["batch_id"])
            (drafts / "hub.md").write_text("complete")
            return {"status": "complete", "batches": [
                {"status": "approved", "claim_count": 0, "no_claim_count": 25, "cell_count": 250}
                for _ in packages
            ]}

        def mutate_active_tree(*args, **kwargs):
            (self.root / "marker.txt").write_text("concurrent-publisher", encoding="utf-8")
            return []

        with mock.patch.object(self.module, "canonical_batches", return_value=self.canonical), \
             mock.patch.object(self.module, "load_batch_package", side_effect=self.loader), \
             mock.patch.object(self.module, "finalize_series", side_effect=finalize), \
             mock.patch.object(self.module, "materialize_complete_series"), \
             mock.patch.object(self.module, "verify_staged", side_effect=mutate_active_tree):
            with self.assertRaisesRegex(RuntimeError, "active research tree changed"):
                self.module.integrate_series(
                    self.manifest, self.root, self.receipt, self.base / "freeze.json",
                )
        self.assertEqual("concurrent-publisher", (self.root / "marker.txt").read_text())
        self.assertFalse(self.receipt.exists())

    def test_symlink_package_is_rejected_and_receipt_must_be_external(self):
        alias = self.base / "alias"
        alias.symlink_to(self.paths[0], target_is_directory=True)
        self.write_manifest([alias] + self.paths[1:])
        with self.assertRaisesRegex(ValueError, "symlink|not safe"):
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
        canonical = ROOT / "docs" / "research" / "company-benefits"
        for failure_at in (40, 80):
            with self.subTest(failure_at=failure_at):
                shutil.rmtree(self.root)
                shutil.copytree(canonical, self.root)
                batch_integrator = self.module._batch_integrator()
                for relative in batch_integrator.LEDGER_TARGETS:
                    target = self.root / relative
                    if target.suffix == ".jsonl":
                        target.write_bytes(b"")
                batch_integrator.series.materialize_contract(self.root, set(), {}, {})
                before = self.module.tree_manifest(self.root)
                calls = []
                def fail_late(path, staged):
                    calls.append(path)
                    if len(calls) == failure_at:
                        raise ValueError(f"package {failure_at} failed")
                    return self.loader(path, staged)
                with mock.patch.object(self.module, "canonical_batches", return_value=self.canonical), \
                     mock.patch.object(self.module, "load_batch_package", side_effect=fail_late):
                    with self.assertRaisesRegex(ValueError, f"package {failure_at} failed"):
                        self.module.integrate_series(self.manifest, self.root, self.receipt, self.base / "freeze.json")
                self.assertEqual(failure_at, len(calls))
                self.assertEqual(before, self.module.tree_manifest(self.root))
                self.assertFalse((self.root / "late-merge-proof.jsonl").exists())
                self.assertFalse(self.receipt.exists())

    def test_integration_consumes_validated_package_snapshots_not_mutable_originals(self):
        consumed = []

        def load_snapshot(path, staged):
            consumed.append(Path(path))
            self.assertNotIn(Path(path), self.paths)
            self.assertTrue((Path(path) / "batch.json").is_file())
            return self.loader(path, staged)

        def finalize(staged, packages, **kwargs):
            return {"status": "complete", "batches": [
                {"status": "approved", "claim_count": 0, "no_claim_count": 25, "cell_count": 250} for _ in packages
            ]}

        with mock.patch.object(self.module, "canonical_batches", return_value=self.canonical), \
             mock.patch.object(self.module, "load_batch_package", side_effect=load_snapshot), \
             mock.patch.object(self.module, "finalize_series", side_effect=finalize), \
             mock.patch.object(self.module, "materialize_complete_series"), \
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
                {"status": "approved", "claim_count": 0, "no_claim_count": 25, "cell_count": 250} for _ in packages
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
             mock.patch.object(self.module, "finalize_series", side_effect=finalize), \
             mock.patch.object(self.module, "materialize_complete_series"), \
             mock.patch.object(self.module, "verify_staged", return_value=[]), \
             mock.patch.object(self.module, "_fsync_tree", side_effect=sync_tree), \
             mock.patch.object(self.module, "_write_receipt_exclusive", side_effect=write_receipt), \
             mock.patch.object(self.module, "_atomic_exchange", side_effect=exchange):
            with self.assertRaisesRegex(OSError, "promotion failed"):
                self.module.integrate_series(self.manifest, self.root, self.receipt, self.base / "freeze.json")
        self.assertEqual(["sync-tree", "receipt", "exchange"], events)
        self.assertFalse(self.receipt.exists())

    def test_finalize_transitions_complete_before_rendering_all_batches_and_rebuilds_hub(self):
        staged = self.base / "staged"
        staged.mkdir()
        (staged / "drafts").mkdir()
        (staged / "drafts" / "stale.md").write_text("stale")
        packages = []
        for path, batch in zip(self.paths, self.canonical):
            manifest = json.loads((path / "batch.json").read_text())
            packages.append(self.module.ApprovedPackage(path, manifest, batch))
        statuses = []

        def materialize(root, approved, approvals, reviewers, status):
            statuses.append(status)
            progress = {"status": status, "batches": []}
            (Path(root) / "series-progress.json").write_text(json.dumps(progress))
            return self.canonical, progress

        class Renderer:
            @staticmethod
            def _render_verified_batch(root, output, scope, number, **kwargs):
                progress = json.loads((Path(root) / "series-progress.json").read_text())
                assert progress["status"] == "complete"
                (Path(output) / f"{scope}-{number:02d}.md").write_text("batch")

            @staticmethod
            def render_hub(root, output):
                (Path(output) / "hub.md").write_text("hub")

        with mock.patch.object(self.module.series, "materialize_contract", side_effect=materialize), \
             mock.patch.object(self.module, "_load_script", return_value=Renderer):
            self.module.series.materialize_contract(staged, set(), {}, {}, status="complete")
            progress = self.module.finalize_series(staged, packages, freeze_anchor_receipt=self.base / "freeze.json")
        self.assertEqual(["complete"], statuses)
        self.assertEqual("complete", progress["status"])
        self.assertEqual(81, len(list((staged / "drafts").iterdir())))
        self.assertFalse((staged / "drafts" / "stale.md").exists())

    def test_real_eighty_package_activation_materializes_before_render_and_verifies_once(self):
        canonical = ROOT / "docs" / "research" / "company-benefits"
        research = self.base / "real-eighty-research"
        shutil.copytree(canonical, research)
        batch_integrator = self.module._batch_integrator()
        for relative in batch_integrator.LEDGER_TARGETS:
            target = research / relative
            if target.suffix == ".jsonl":
                target.write_bytes(b"")
        batch_integrator.series.materialize_contract(research, set(), {}, {})

        packages = self.base / "real-eighty-packages"
        packages.mkdir()
        package_paths = []
        for batch in batch_integrator.series.read_jsonl(research / "series-batches.jsonl"):
            package = packages / batch["batch_id"]
            promoted_current_package(
                package, batch["batch_id"],
                reviewer_id=f"whole-series-reviewer::{batch['batch_id']}",
            )
            package_paths.append(package)
        manifest = self.base / "real-eighty-manifest.json"
        manifest.write_text(json.dumps({
            "schema_version": "1", "packages": [str(path) for path in package_paths],
        }), encoding="utf-8")
        freeze_receipt = self.base / "real-eighty-freeze-receipt.json"
        protocol = json.loads((research / "population-protocol.json").read_bytes())
        freeze_receipt.write_bytes(batch_integrator.series.json_bytes({
            "schema_version": "1", "protocol_version": protocol["version"],
            "freeze_manifest_sha256": hashlib.sha256(
                (research / "population" / "freeze-manifest.json").read_bytes()
            ).hexdigest(),
            "review_status": "approved", "issued_at": "2026-10-30T00:00:00Z",
        }))
        receipt = self.base / "real-eighty-integration-receipt.json"

        materializations = []
        render_progress = []
        verifications = []
        original_materialize = self.module.series.materialize_contract
        original_load_script = self.module._load_script

        def counted_materialize(*args, **kwargs):
            materializations.append(kwargs.get("status", args[4] if len(args) > 4 else "in_progress"))
            return original_materialize(*args, **kwargs)

        def instrumented_load_script(path, name):
            loaded = original_load_script(path, name)
            if Path(path).name == "render-company-benefits-drafts.py":
                class Renderer:
                    @staticmethod
                    def _render_verified_batch(root, output, scope, number, **kwargs):
                        assert verifications == [True], "render preceded authoritative workspace verification"
                        progress = json.loads((Path(root) / "series-progress.json").read_bytes())
                        batch_id = f"{scope}-{number:02d}"
                        entry = next(item for item in progress["batches"] if item["batch_id"] == batch_id)
                        render_progress.append((progress["status"], entry["status"]))
                        return loaded._render_verified_batch(root, output, scope, number, **kwargs)

                    render_hub = staticmethod(loaded.render_hub)
                return Renderer
            if Path(path).name == "verify-company-benefits-ledger.py":
                original_verify = loaded.verify_workspace

                def verify_once(*args, **kwargs):
                    verifications.append(True)
                    return original_verify(*args, **kwargs)

                loaded.verify_workspace = verify_once
            return loaded

        old_soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
        constrained_soft = min(64, hard)
        try:
            resource.setrlimit(resource.RLIMIT_NOFILE, (constrained_soft, hard))
            with mock.patch.object(self.module.series, "materialize_contract", side_effect=counted_materialize), \
                 mock.patch.object(self.module, "_load_script", side_effect=instrumented_load_script):
                result = self.module.integrate_series(
                    manifest, research, receipt, freeze_receipt,
                    as_of=date(2026, 11, 7), dry_run=True,
                )
        finally:
            resource.setrlimit(resource.RLIMIT_NOFILE, (old_soft, hard))

        self.assertEqual(["complete"], materializations)
        self.assertEqual(80, len(render_progress))
        self.assertEqual({("complete", "approved")}, set(render_progress))
        self.assertEqual([True], verifications)
        self.assertEqual(2000, result["accounted_companies"])
        self.assertEqual(20000, result["explicit_cells"])
        self.assertEqual("validated_dry_run", json.loads(receipt.read_bytes())["status"])
        self.assertEqual("in_progress", json.loads((research / "series-progress.json").read_bytes())["status"])

    def test_success_completes_staged_series_verifies_then_swaps_once_and_refuses_duplicate(self):
        events = []

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
                                     "claim_count": 0, "no_claim_count": 25, "cell_count": 250} for item in self.canonical]}
            (staged / "series-progress.json").write_text(json.dumps(progress))
            return progress

        def verify(staged, **kwargs):
            self.assertEqual("original", (staged / "marker.txt").read_text())
            events.append(("verify", "pre-render"))
            return []

        with mock.patch.object(self.module, "canonical_batches", return_value=self.canonical), \
             mock.patch.object(self.module, "load_batch_package", side_effect=self.loader), \
             mock.patch.object(self.module, "finalize_series", side_effect=finalize), \
             mock.patch.object(self.module, "materialize_complete_series"), \
             mock.patch.object(self.module, "verify_staged", side_effect=verify), \
             mock.patch.object(self.module.shutil, "copytree", wraps=self.module.shutil.copytree) as copy_tree:
            result = self.module.integrate_series(self.manifest, self.root, self.receipt, self.base / "freeze.json")
            self.assertEqual("complete", (self.root / "marker.txt").read_text())
            self.assertEqual(80, result["approved_batches"])
            self.assertEqual("finalize", events[-1][0])
            self.assertEqual(1, copy_tree.call_count)
            self.assertEqual(1, sum(event[0] == "finalize" for event in events))
            self.assertEqual(1, sum(event[0] == "verify" for event in events))
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
                        "batches": [{"status": "approved", "claim_count": 0, "no_claim_count": 25, "cell_count": 250} for _ in packages]}
            (staged / "series-progress.json").write_text(json.dumps(progress))
            return progress

        with mock.patch.object(self.module, "canonical_batches", return_value=self.canonical), \
             mock.patch.object(self.module, "load_batch_package", side_effect=self.loader), \
             mock.patch.object(self.module, "finalize_series", side_effect=finalize), \
             mock.patch.object(self.module, "materialize_complete_series"), \
             mock.patch.object(self.module, "verify_staged", side_effect=lambda *a, **k: verified.append(True) or []):
            self.module.integrate_series(self.manifest, self.root, self.receipt, self.base / "freeze.json", dry_run=True)
        self.assertTrue(verified)
        self.assertEqual(before, self.module.tree_manifest(self.root))
        receipt = json.loads(self.receipt.read_text())
        self.assertEqual("validated_dry_run", receipt["status"])
        self.assertEqual("complete", receipt["staged_status"])


if __name__ == "__main__":
    unittest.main()
