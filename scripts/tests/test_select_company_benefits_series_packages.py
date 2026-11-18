import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "select-company-benefits-series-packages.py"
RESEARCH = ROOT / "docs" / "research" / "company-benefits"


def load_module():
    spec = importlib.util.spec_from_file_location("package_selector", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def compact(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def promote_fixture_package(arguments):
    destination, batch_id, reviewer_id = arguments
    from scripts.tests.test_verify_benefit_release_checkpoint import promoted_current_package
    promoted_current_package(destination, batch_id, reviewer_id=reviewer_id)
    return batch_id


class RetainedPackageSelectorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=ROOT.parent)
        self.base = Path(self.tmp.name)
        self.canonical = self.base / "canonical"
        self.retained = self.base / "retained"
        self.output_parent = self.base / "output"
        for path in (self.canonical, self.retained, self.output_parent):
            path.mkdir(mode=0o700)
        self.batches = []
        self.approvals = []
        self.packages = []
        self.records = {}
        for index in range(80):
            scope = "domestic" if index < 40 else "international"
            number = index + 1 if index < 40 else index - 39
            batch_id = f"{scope}-{number:02d}"
            company_ids = [f"company-{index:02d}-{n:02d}" for n in range(25)]
            batch = {"batch_id": batch_id, "company_ids": company_ids}
            self.batches.append(batch)
            package = self.retained / f"opaque-{79-index:02d}"
            package.mkdir()
            manifest = {"schema_version": "2", "batch_id": batch_id, "status": "approved"}
            (package / "batch.json").write_bytes(compact(manifest))
            for name in self.module.PACKAGE_MEMBERS - {"batch.json"}:
                (package / name).write_bytes(b"")
            package_raw = (package / "batch.json").read_bytes()
            approval = {
                "approval_version": "1", "batch_id": batch_id, "status": "approved",
                "package_sha256": hashlib.sha256(package_raw).hexdigest(),
                "reviewed_candidate_sha256": f"{index + 1000:064x}",
                "reviewer_receipt_sha256": f"{index + 2000:064x}",
            }
            self.approvals.append(approval)
            self.packages.append(package)
            cells = []
            outcomes = []
            for company_number, company_id in enumerate(company_ids):
                for category_number in range(10):
                    cell_id = f"cell::{batch_id}::{company_number:02d}::{category_number:02d}"
                    cells.append({"cell_id": cell_id, "company_id": company_id})
                    outcomes.append({"cell_id": cell_id, "outcome": "no_public_info"})
            self.records[package] = {
                name: [] for name in self.module.RECORD_ID_FIELDS
            }
            self.records[package]["company-category-cells.jsonl"] = cells
            self.records[package]["company-category-outcomes.jsonl"] = outcomes
            self.records[package]["research-attempts.jsonl"] = [
                {"attempt_id": f"attempt::{batch_id}::{n:03d}"} for n in range(3)
            ]
            self.records[package]["verified-benefits.jsonl"] = [
                {"benefit_id": f"benefit::{batch_id}"}
            ]
            self.records[package]["official-claims-v2.jsonl"] = [
                {"claim_id": f"evidence::{batch_id}::official"}
            ]
            self.records[package]["reference-records.jsonl"] = [
                {"reference_id": f"evidence::{batch_id}::reference"}
            ]
            self.records[package]["community-benefit-reports.jsonl"] = [
                {"community_report_id": f"evidence::{batch_id}::community"}
            ]
            self.records[package]["sources.jsonl"] = [{"source_id": f"source::{batch_id}"}]
            self.records[package]["claims.jsonl"] = [{"claim_id": f"claim::{batch_id}"}]
            self.records[package]["reviews.jsonl"] = [{"review_id": f"review::{batch_id}"}]
            self.records[package]["gaps.jsonl"] = [{"audit_id": f"gap::{batch_id}"}]
            self.records[package]["checks.jsonl"] = [{"source_id": f"check::{batch_id}"}]
            self.records[package]["sources-v2.jsonl"] = [{"source_id": f"source-v2::{batch_id}"}]
        self.write_canonical()
        self.calls = []

    def tearDown(self):
        self.tmp.cleanup()

    def write_canonical(self):
        (self.canonical / "series-batches.jsonl").write_bytes(
            b"".join(compact(item) + b"\n" for item in self.batches)
        )
        (self.canonical / "series-batch-approvals.jsonl").write_bytes(
            b"".join(compact(item) + b"\n" for item in self.approvals)
        )

    def loader(self, package, research_root, retained_approval=None):
        package = Path(package)
        self.calls.append((package, retained_approval))
        manifest = json.loads((package / "batch.json").read_bytes())
        batch = next(item for item in self.batches if item["batch_id"] == manifest["batch_id"])
        return manifest, batch, self.records[package]

    def select(self):
        return self.module.verify_and_select([self.retained], self.canonical, loader=self.loader)

    def test_exact_80_are_ordered_by_canonical_ledger_and_every_package_is_loaded(self):
        result = self.select()
        self.assertEqual([item["batch_id"] for item in self.batches], [item["batch_id"] for item in result.inventory])
        self.assertEqual(self.packages, [Path(path) for path in result.manifest["packages"]])
        self.assertEqual(80, len(self.calls))
        self.assertTrue(all(call[1] == approval for call, approval in zip(self.calls, self.approvals)))
        self.assertEqual({"batches": 80, "companies": 2000, "cells": 20000}, result.totals)

    def test_explicit_root_order_cannot_change_canonical_package_order(self):
        second_root = self.base / "retained-second"
        second_root.mkdir(mode=0o700)
        for index in range(0, 80, 2):
            old = self.packages[index]
            new = second_root / old.name
            old.rename(new)
            self.records[new] = self.records.pop(old)
            self.packages[index] = new
        result = self.module.verify_and_select(
            [second_root, self.retained], self.canonical, loader=self.loader,
        )
        self.assertEqual(self.packages, [Path(path) for path in result.manifest["packages"]])

    def test_79_and_81_canonical_batches_fail(self):
        original_batches = list(self.batches)
        original_approvals = list(self.approvals)
        for count in (79, 81):
            with self.subTest(count=count):
                self.batches = list(original_batches)
                self.approvals = list(original_approvals)
                if count == 79:
                    self.batches = self.batches[:79]
                    self.approvals = self.approvals[:79]
                else:
                    self.batches.append({"batch_id": "international-41", "company_ids": [f"extra-{n}" for n in range(25)]})
                    self.approvals.append(dict(self.approvals[-1], batch_id="international-41", package_sha256="f" * 64,
                                               reviewer_receipt_sha256="e" * 64))
                self.write_canonical()
                with self.assertRaisesRegex(ValueError, "exactly 80"):
                    self.select()
        self.batches = original_batches
        self.approvals = original_approvals
        self.write_canonical()

    def test_ambiguity_and_stale_candidate_or_review_fail_closed(self):
        duplicate = self.retained / "another-copy"
        duplicate.mkdir()
        for source in self.packages[0].iterdir():
            (duplicate / source.name).write_bytes(source.read_bytes())
        with self.assertRaisesRegex(ValueError, "ambiguous"):
            self.select()
        for marker in ("candidate.json", "review-bundle.json"):
            for path in duplicate.iterdir():
                path.unlink()
            duplicate.rmdir()
            stale = self.retained / marker
            stale.write_text("{}")
            with self.assertRaisesRegex(ValueError, "stale candidate/review"):
                self.select()
            stale.unlink()
            duplicate.mkdir()
            for source in self.packages[0].iterdir():
                (duplicate / source.name).write_bytes(source.read_bytes())

    def test_79_or_81_retained_packages_fail(self):
        removed = self.packages[-1]
        shutil.rmtree(removed)
        with self.assertRaisesRegex(ValueError, "missing"):
            self.select()
        removed.mkdir()
        (removed / "batch.json").write_bytes(compact({
            "schema_version": "2", "batch_id": self.batches[-1]["batch_id"], "status": "approved",
        }))
        for name in self.module.PACKAGE_MEMBERS - {"batch.json"}:
            (removed / name).write_bytes(b"")
        extra = self.retained / "eighty-first"
        shutil.copytree(self.packages[0], extra)
        with self.assertRaisesRegex(ValueError, "ambiguous"):
            self.select()

    def test_symlink_special_file_and_missing_or_extra_member_fail(self):
        cases = []
        alias = self.retained / "alias"
        alias.symlink_to(self.packages[0], target_is_directory=True)
        cases.append((alias, "symlink"))
        for path, message in cases:
            with self.subTest(message=message):
                with self.assertRaisesRegex(ValueError, message):
                    self.select()
                path.unlink()
        member = self.packages[0] / "checks.jsonl"
        member.unlink()
        with self.assertRaisesRegex(ValueError, "exactly 16|member"):
            self.select()
        member.write_bytes(b"")
        extra = self.packages[0] / "extra.txt"
        extra.write_bytes(b"")
        with self.assertRaisesRegex(ValueError, "exactly 16|member"):
            self.select()
        extra.unlink()
        member.unlink()
        os.link(self.packages[1] / "checks.jsonl", member)
        with self.assertRaisesRegex(ValueError, "duplicate package member inode"):
            self.select()
        member.unlink()
        os.mkfifo(member)
        with self.assertRaisesRegex(ValueError, "regular"):
            self.select()

    def test_duplicate_package_receipt_proposition_outcome_and_global_ids_fail(self):
        cases = [
            (lambda: self.approvals[1].update(package_sha256=self.approvals[0]["package_sha256"]), "package identity"),
            (lambda: self.approvals[1].update(reviewer_receipt_sha256=self.approvals[0]["reviewer_receipt_sha256"]), "receipt identity"),
            (lambda: self.records[self.packages[1]]["verified-benefits.jsonl"].__setitem__(0, {"benefit_id": "benefit::domestic-01"}), "benefit_id"),
            (lambda: self.records[self.packages[1]]["company-category-outcomes.jsonl"].__setitem__(0, dict(self.records[self.packages[0]]["company-category-outcomes.jsonl"][0])), "cell_id"),
            (lambda: self.records[self.packages[1]]["claims.jsonl"].__setitem__(0, {"claim_id": "claim::domestic-01"}), "claim_id"),
            (lambda: self.records[self.packages[1]]["reference-records.jsonl"].__setitem__(0, {"reference_id": "evidence::domestic-01::official"}), "evidence identity"),
        ]
        for mutate, message in cases:
            with self.subTest(message=message):
                mutate()
                self.write_canonical()
                with self.assertRaisesRegex(ValueError, message):
                    self.select()
                self.tearDown()
                self.setUp()

    def test_publish_is_atomic_stable_and_output_unchanged_on_failure(self):
        result = self.select()
        repeated = self.select()
        self.assertEqual(result.report, repeated.report)
        destination = self.output_parent / "preflight"
        self.module.publish_selection(result, destination)
        manifest_raw = (destination / "package-paths.json").read_bytes()
        report_raw = (destination / "preflight-report.json").read_bytes()
        self.assertEqual(result.manifest, json.loads(manifest_raw))
        report = json.loads(report_raw)
        self.assertEqual(result.totals, report["totals"])
        self.assertEqual(hashlib.sha256(manifest_raw).hexdigest(), report["package_paths_sha256"])
        before = {path.name: path.read_bytes() for path in destination.iterdir()}
        with self.assertRaisesRegex(ValueError, "already exists"):
            self.module.publish_selection(result, destination)
        self.assertEqual(before, {path.name: path.read_bytes() for path in destination.iterdir()})
        self.records[self.packages[1]]["claims.jsonl"][0] = {"claim_id": "claim::domestic-01"}
        with self.assertRaises(ValueError):
            failed = self.select()
            self.module.publish_selection(failed, destination)
        self.assertEqual(before, {path.name: path.read_bytes() for path in destination.iterdir()})

    def test_post_rename_parent_fsync_failure_removes_output_and_allows_retry(self):
        result = self.select()
        destination = self.output_parent / "preflight"
        real_fsync_directory_fd = self.module._fsync_directory_fd
        directory_fsync_calls = 0

        def fail_post_rename_parent(descriptor):
            nonlocal directory_fsync_calls
            directory_fsync_calls += 1
            if directory_fsync_calls == 2:
                raise OSError("simulated post-rename parent fsync failure")
            return real_fsync_directory_fd(descriptor)

        with mock.patch.object(
            self.module, "_fsync_directory_fd", side_effect=fail_post_rename_parent,
        ):
            with self.assertRaisesRegex(OSError, "post-rename parent fsync failure"):
                self.module.publish_selection(result, destination)

        self.assertFalse(destination.exists())
        self.module.publish_selection(result, destination)
        self.assertEqual(result.manifest, json.loads(
            (destination / "package-paths.json").read_bytes(),
        ))

    def test_failed_rollback_is_finished_as_committed_success(self):
        result = self.select()
        destination = self.output_parent / "preflight"
        real_fsync_directory_fd = self.module._fsync_directory_fd
        real_rename_noreplace = self.module._rename_noreplace
        directory_fsync_calls = 0
        rename_calls = 0

        def fail_first_parent_fsync(descriptor):
            nonlocal directory_fsync_calls
            directory_fsync_calls += 1
            if directory_fsync_calls == 2:
                raise OSError("uncertain initial parent fsync")
            return real_fsync_directory_fd(descriptor)

        def block_rollback(*args, **kwargs):
            nonlocal rename_calls
            rename_calls += 1
            if rename_calls == 2:
                raise OSError("rollback unavailable")
            return real_rename_noreplace(*args, **kwargs)

        with mock.patch.object(
            self.module, "_fsync_directory_fd", side_effect=fail_first_parent_fsync,
        ), mock.patch.object(
            self.module, "_rename_noreplace", side_effect=block_rollback,
        ):
            self.assertIsNone(self.module.publish_selection(result, destination))

        self.assertTrue(destination.is_dir())
        self.assertEqual(result.manifest, json.loads(
            (destination / "package-paths.json").read_bytes(),
        ))
        self.assertEqual(3, directory_fsync_calls)

    def test_post_commit_staging_close_failure_returns_success_with_output(self):
        result = self.select()
        destination = self.output_parent / "preflight"
        real_make_owned_staging = self.module._make_owned_staging
        real_close = os.close
        staging_descriptor = None

        def capture_staging_descriptor(*args, **kwargs):
            nonlocal staging_descriptor
            name, staging_descriptor = real_make_owned_staging(*args, **kwargs)
            return name, staging_descriptor

        def close_then_report_error(descriptor):
            real_close(descriptor)
            if descriptor == staging_descriptor:
                raise OSError("simulated committed staging close failure")

        with mock.patch.object(
            self.module, "_make_owned_staging", side_effect=capture_staging_descriptor,
        ), mock.patch.object(
            self.module.os, "close", side_effect=close_then_report_error,
        ):
            self.assertIsNone(self.module.publish_selection(result, destination))

        self.assertTrue(destination.is_dir())
        self.assertEqual(result.manifest, json.loads(
            (destination / "package-paths.json").read_bytes(),
        ))

    def test_staging_close_failure_does_not_mask_primary_pre_commit_error(self):
        result = self.select()
        destination = self.output_parent / "preflight"
        real_make_owned_staging = self.module._make_owned_staging
        real_close = os.close
        primary = OSError("simulated pre-commit staging fsync failure")
        staging_descriptor = None

        def capture_staging_descriptor(*args, **kwargs):
            nonlocal staging_descriptor
            name, staging_descriptor = real_make_owned_staging(*args, **kwargs)
            return name, staging_descriptor

        def fail_staging_fsync(descriptor):
            if descriptor == staging_descriptor:
                raise primary
            return os.fsync(descriptor)

        def close_then_report_error(descriptor):
            real_close(descriptor)
            if descriptor == staging_descriptor:
                raise OSError("simulated staging close failure during cleanup")

        with mock.patch.object(
            self.module, "_make_owned_staging", side_effect=capture_staging_descriptor,
        ), mock.patch.object(
            self.module, "_fsync_directory_fd", side_effect=fail_staging_fsync,
        ), mock.patch.object(
            self.module.os, "close", side_effect=close_then_report_error,
        ):
            with self.assertRaises(OSError) as raised:
                self.module.publish_selection(result, destination)

        self.assertIs(primary, raised.exception)
        self.assertFalse(destination.exists())
        notes = "\n".join(getattr(primary, "__notes__", []))
        self.assertIn("staging descriptor cleanup failed", notes)

    def test_rollback_and_cleanup_errors_preserve_original_failure_without_output(self):
        result = self.select()
        destination = self.output_parent / "preflight"
        real_fsync_directory_fd = self.module._fsync_directory_fd
        real_rename_noreplace = self.module._rename_noreplace
        primary = OSError("original post-rename parent fsync failure")
        directory_fsync_calls = 0
        rename_calls = 0

        def fail_first_parent_fsync(descriptor):
            nonlocal directory_fsync_calls
            directory_fsync_calls += 1
            if directory_fsync_calls == 2:
                raise primary
            return real_fsync_directory_fd(descriptor)

        def rollback_then_report_error(*args, **kwargs):
            nonlocal rename_calls
            rename_calls += 1
            result_value = real_rename_noreplace(*args, **kwargs)
            if rename_calls == 2:
                raise OSError("rollback syscall reported an error after moving the name")
            return result_value

        with mock.patch.object(
            self.module, "_fsync_directory_fd", side_effect=fail_first_parent_fsync,
        ), mock.patch.object(
            self.module, "_rename_noreplace", side_effect=rollback_then_report_error,
        ), mock.patch.object(
            self.module, "_cleanup_owned_staging", side_effect=OSError("cleanup unavailable"),
        ):
            with self.assertRaises(OSError) as raised:
                self.module.publish_selection(result, destination)

        self.assertIs(primary, raised.exception)
        self.assertFalse(destination.exists())
        notes = "\n".join(getattr(primary, "__notes__", []))
        self.assertIn("rollback reported an error after taking effect", notes)
        self.assertIn("owned staging cleanup failed", notes)
        self.module.publish_selection(result, destination)
        self.assertTrue(destination.is_dir())

    def test_cli_help_documents_explicit_roots_and_safe_output(self):
        completed = subprocess.run(
            [sys.executable, str(MODULE_PATH), "--help"], capture_output=True, text=True, check=False,
        )
        self.assertEqual(0, completed.returncode, completed.stderr)
        self.assertIn("retained_roots", completed.stdout)
        self.assertIn("--research-root", completed.stdout)
        self.assertIn("--output", completed.stdout)

    @unittest.skipUnless(
        os.environ.get("RUN_FULL_RETAINED_PACKAGE_SELECTOR_TEST") == "1",
        "set RUN_FULL_RETAINED_PACKAGE_SELECTOR_TEST=1 for the real 80-package production-loader gate",
    )
    def test_exact_80_current_packages_pass_the_real_production_loader(self):
        real_root = self.base / "real-canonical"
        real_retained = self.base / "real-retained"
        real_root.mkdir(mode=0o700)
        real_retained.mkdir(mode=0o700)
        batches = [json.loads(line) for line in (RESEARCH / "series-batches.jsonl").read_text().splitlines()]
        jobs = [
            (real_retained / batch["batch_id"], batch["batch_id"], f"selector-reviewer-{index:02d}")
            for index, batch in enumerate(batches)
        ]
        with ProcessPoolExecutor(max_workers=min(8, os.cpu_count() or 1)) as executor:
            promoted = list(executor.map(promote_fixture_package, jobs))
        self.assertEqual([batch["batch_id"] for batch in batches], promoted)

        shutil.copytree(RESEARCH / "population", real_root / "population")
        shutil.copy2(RESEARCH / "companies.jsonl", real_root / "companies.jsonl")
        shutil.copy2(RESEARCH / "series-batches.jsonl", real_root / "series-batches.jsonl")
        targets = {
            "sources.jsonl": "source-registry.jsonl", "claims.jsonl": "benefit-claims.jsonl",
            "reviews.jsonl": "reviews.jsonl", "gaps.jsonl": "series-research-gaps.jsonl",
            "checks.jsonl": "series-prepublication-checks.jsonl",
            "company-category-cells.jsonl": "company-category-cells.jsonl",
            "research-attempts.jsonl": "research-attempts.jsonl",
            "official-claims-v2.jsonl": "official-claims-v2.jsonl",
            "reference-records.jsonl": "reference-records.jsonl",
            "community-benefit-reports.jsonl": "community-benefit-reports.jsonl",
            "sources-v2.jsonl": "sources-v2.jsonl",
            "verified-benefits.jsonl": "verified-benefits.jsonl",
            "company-category-outcomes.jsonl": "company-category-outcomes.jsonl",
        }
        for source_name, target_name in targets.items():
            (real_root / target_name).write_bytes(b"".join(
                (real_retained / batch["batch_id"] / source_name).read_bytes() for batch in batches
            ))
        approvals = [
            self.module.series.read_jsonl(real_retained / batch["batch_id"] / "series-batch-approval.jsonl")[0]
            for batch in batches
        ]
        self.module.series.write_jsonl(real_root / "series-batch-approvals.jsonl", approvals)
        approved_at = {}
        reviewers = {}
        for batch in batches:
            manifest = json.loads((real_retained / batch["batch_id"] / "batch.json").read_bytes())
            approved_at[batch["batch_id"]] = manifest["approved_at"]
            reviewers[batch["batch_id"]] = [manifest["reviewer_id"]]
        self.module.series.materialize_contract(real_root, set(approved_at), approved_at, reviewers)

        before = {
            path.relative_to(real_root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in real_root.rglob("*") if path.is_file()
        }
        result = self.module.verify_and_select([real_retained], real_root)
        after = {
            path.relative_to(real_root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in real_root.rglob("*") if path.is_file()
        }
        self.assertEqual(before, after)
        self.assertEqual(80, len(result.manifest["packages"]))
        self.assertEqual({"batches": 80, "companies": 2000, "cells": 20000}, result.totals)


if __name__ == "__main__":
    unittest.main()
