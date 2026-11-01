import errno
import hashlib
import importlib.util
import json
import multiprocessing
import os
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import tracemalloc
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
EXPORTER = ROOT / "scripts" / "export-approved-benefit-corrections.py"


def load_exporter():
    spec = importlib.util.spec_from_file_location("benefit_correction_exporter", EXPORTER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def row(request_id="10000000-0000-4000-8000-000000000001", **overrides):
    value = {
        "id": request_id,
        "company_id": "KR-CRN-1101112948086",
        "category_id": "health",
        "current_text": "Current benefit",
        "proposed_text": "Proposed benefit",
        "scope_text": "Korea permanent employees",
        "source_url": "https://example.com/public-evidence?q=1",
        "observed_data_version": "company-benefits-2026-10-31-v1",
        "status": "approved",
    }
    value.update(overrides)
    return value


class ExportApprovedBenefitCorrectionsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.exporter = load_exporter()

    @staticmethod
    def public_resolver(hostname):
        return ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]

    def build_snapshot(self, rows, **kwargs):
        kwargs.setdefault("resolver", self.public_resolver)
        return self.exporter.build_snapshot(rows, **kwargs)

    @staticmethod
    def snapshot_root(directory):
        root = Path(directory) / "snapshots"
        root.mkdir(mode=0o700)
        return root

    def authenticated_marker(self, root, version, key=None, candidates=None):
        if key is None:
            key = self.exporter._load_tombstone_authentication_key(root)
        if candidates is None:
            candidates = self.build_snapshot([row()])
        identity = self.exporter._tombstone_snapshot_identity(
            self.exporter._expected_files(version, candidates)
        )
        return self.exporter._new_tombstone_marker(key, version, identity)

    def test_exports_only_approved_rows_with_a_strict_candidate_allowlist(self):
        snapshot = self.build_snapshot([
            row(),
            row("10000000-0000-4000-8000-000000000002", status="submitted"),
            row("10000000-0000-4000-8000-000000000003", status="rejected"),
        ])
        self.assertEqual(1, len(snapshot))
        self.assertEqual(
            {
                "correction_request_id", "company_id", "category_id", "current_text",
                "proposed_text", "scope_text", "evidence_url", "observed_data_version",
            },
            set(snapshot[0]),
        )
        self.assertNotIn("status", snapshot[0])

    def test_deduplicates_identical_rows_and_rejects_conflicting_duplicate_ids(self):
        original = row()
        self.assertEqual(1, len(self.build_snapshot([original, dict(original)])))
        conflicting = row(proposed_text="Different")
        with self.assertRaisesRegex(ValueError, "conflicting duplicate"):
            self.build_snapshot([original, conflicting])
        with self.assertRaisesRegex(ValueError, "conflicting duplicate"):
            self.build_snapshot([original, row(status="submitted")])

    def test_jsonl_escapes_malicious_text_and_round_trips_exactly(self):
        malicious = '</script>\n{"forged":true}\t\\"\u2028'
        candidates = self.build_snapshot([row(proposed_text=malicious)])
        raw = self.exporter.canonical_jsonl(candidates)
        self.assertNotIn(b"</script>", raw)
        self.assertEqual(malicious, json.loads(raw.decode("utf-8"))["proposed_text"])
        self.assertEqual(1, len(raw.splitlines()))

    def test_rejects_unknown_fields_and_pii_in_database_responses(self):
        for field in ("unexpected", "email", "submitter_id", "reviewer_id", "provider_metadata"):
            with self.subTest(field=field):
                with self.assertRaisesRegex(ValueError, "unexpected fields"):
                    self.build_snapshot([row(**{field: "secret"})])

    def test_rejects_malformed_rows_unbounded_text_and_non_public_https_urls(self):
        cases = [
            row(status="invented"),
            row(current_text="x" * 5001),
            row(scope_text="x" * 2001),
            row(source_url="http://example.com/evidence"),
            row(source_url="https://user@example.com/evidence"),
            row(source_url="https://localhost/evidence"),
            row(source_url="https://127.0.0.1/evidence"),
        ]
        for invalid in cases:
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    self.build_snapshot([invalid])

    def test_rejects_alternate_numeric_ipv4_and_credential_host_bypasses(self):
        urls = [
            "https://127.1/e", "https://0177.0.0.1/e", "https://0x7f.0.0.1/e",
            "https://0x7f000001/e", "https://2130706433/e",
            "https://user@example.com/e", "https://user:secret@example.com/e",
            "https://user%40example.com@public.example/e",
        ]
        for url in urls:
            with self.subTest(url=url):
                with self.assertRaisesRegex(ValueError, "invalid public evidence URL"):
                    self.build_snapshot([row(source_url=url)])

    def test_validates_idna_and_resolves_the_ascii_hostname(self):
        def resolver(hostname):
            if hostname != "xn--bcher-kva.example":
                raise AssertionError(f"unexpected resolver hostname: {hostname}")
            return ["93.184.216.34"]

        snapshot = self.build_snapshot([row(source_url="https://bücher.example/e")], resolver=resolver)
        self.assertEqual("https://bücher.example/e", snapshot[0]["evidence_url"])

        invalid_urls = [
            "https://-bad.example/e", "https://bad-.example/e", "https://a..example/e",
            "https://\u00ad.example/e", "https://exam\u00adple.com/e",
            "https://www。example.com/e", "https://example。/e", "https://xn--/e",
        ]
        for url in invalid_urls:
            with self.subTest(url=url):
                with self.assertRaisesRegex(ValueError, "invalid public evidence URL"):
                    self.build_snapshot([row(source_url=url)])

    def test_rejects_any_non_global_dns_answer_including_mapped_ipv6(self):
        unsafe_answers = [
            ["127.0.0.1"], ["10.0.0.1"], ["169.254.1.2"], ["192.0.2.1"],
            ["224.0.0.1"], ["::1"], ["fe80::1"], ["::ffff:127.0.0.1"],
            ["93.184.216.34", "10.0.0.1"],
        ]
        for answers in unsafe_answers:
            with self.subTest(answers=answers):
                with self.assertRaisesRegex(ValueError, "invalid public evidence URL"):
                    self.build_snapshot(
                        [row(source_url="https://public-looking.example/e")],
                        resolver=lambda _hostname, answers=answers: answers,
                    )
        with self.assertRaisesRegex(ValueError, "invalid public evidence URL"):
            self.build_snapshot(
                [row(source_url="https://127.0.0.1.nip.io/e")],
                resolver=lambda _hostname: ["127.0.0.1"],
            )

    def test_dns_validation_fails_closed_on_error_timeout_empty_or_malformed_answers(self):
        def raises(_hostname):
            raise socket.gaierror("no answer")

        def blocks(_hostname):
            time.sleep(0.2)
            return ["93.184.216.34"]

        resolvers = [raises, lambda _hostname: [], lambda _hostname: ["not-an-ip"], blocks]
        for resolver in resolvers:
            with self.subTest(resolver=resolver):
                with self.assertRaisesRegex(ValueError, "invalid public evidence URL"):
                    self.build_snapshot(
                        [row()], resolver=resolver, resolver_timeout_seconds=0.01
                    )

    def test_repeated_dns_timeouts_reap_every_worker(self):
        def blocks_well_past_the_deadline(_hostname):
            if threading.current_thread() is threading.main_thread():
                signal.signal(signal.SIGTERM, signal.SIG_IGN)
            time.sleep(5)
            return ["93.184.216.34"]

        child_pids_before = {child.pid for child in multiprocessing.active_children()}
        resolver_threads_before = {
            thread.ident for thread in threading.enumerate()
            if thread.name == "benefit-url-resolver"
        }
        for _ in range(4):
            with self.assertRaisesRegex(ValueError, "invalid public evidence URL"):
                self.build_snapshot(
                    [row()], resolver=blocks_well_past_the_deadline,
                    resolver_timeout_seconds=0.01,
                )
        self.assertEqual(
            child_pids_before,
            {child.pid for child in multiprocessing.active_children()},
        )
        self.assertEqual(
            resolver_threads_before,
            {
                thread.ident for thread in threading.enumerate()
                if thread.name == "benefit-url-resolver"
            },
        )

    def test_dns_answers_are_validation_only_and_do_not_change_snapshot_bytes(self):
        left = self.exporter.canonical_jsonl(self.build_snapshot([row()], resolver=lambda _host: ["8.8.8.8"]))
        right = self.exporter.canonical_jsonl(self.build_snapshot([row()], resolver=lambda _host: ["1.1.1.1"]))
        self.assertEqual(left, right)
        self.assertNotIn(b"8.8.8.8", left)
        self.assertNotIn(b"1.1.1.1", right)

    def test_same_normalized_hostname_is_resolved_once_per_snapshot(self):
        calls = multiprocessing.Value("i", 0)

        def resolver(hostname):
            with calls.get_lock():
                calls.value += 1
            self.assertEqual("example.com", hostname)
            return ["93.184.216.34"]

        self.build_snapshot([
            row(source_url="https://EXAMPLE.com/first"),
            row("10000000-0000-4000-8000-000000000002", source_url="https://example.com/second"),
        ], resolver=resolver)
        self.assertEqual(1, calls.value)

    def test_canonical_order_and_hash_are_deterministic(self):
        second = row("10000000-0000-4000-8000-000000000002", company_id="US-CIK0000320193")
        first = row()
        left = self.exporter.canonical_jsonl(self.build_snapshot([second, first]))
        right = self.exporter.canonical_jsonl(self.build_snapshot([first, second]))
        self.assertEqual(left, right)
        self.assertEqual(hashlib.sha256(left).hexdigest(), self.exporter.snapshot_sha256(left))
        self.assertEqual(first["id"], json.loads(left.splitlines()[0])["correction_request_id"])

    def test_publish_is_atomic_idempotent_and_refuses_existing_mismatch(self):
        candidates = self.build_snapshot([row()])
        with tempfile.TemporaryDirectory() as directory:
            root = self.snapshot_root(directory)
            target = self.exporter.publish_snapshot(root, "approved-2026-11-01-v1", candidates)
            first_manifest = (target / "manifest.json").read_bytes()
            self.assertEqual(target, self.exporter.publish_snapshot(root, "approved-2026-11-01-v1", candidates))
            self.assertEqual(first_manifest, (target / "manifest.json").read_bytes())
            (target / "candidates.jsonl").write_text("tampered\n", encoding="utf-8")
            with self.assertRaisesRegex(FileExistsError, "mismatch"):
                self.exporter.publish_snapshot(root, "approved-2026-11-01-v1", candidates)
            self.assertEqual("tampered\n", (target / "candidates.jsonl").read_text(encoding="utf-8"))
            self.assertFalse(any(path.name.startswith(".approved-2026-11-01-v1-") for path in root.iterdir()))

    def test_publish_rejects_permissive_or_wrong_owner_output_root(self):
        candidates = self.build_snapshot([row()])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"
            root.mkdir(mode=0o777)
            root.chmod(0o777)
            with self.assertRaisesRegex(OSError, "output root"):
                self.exporter.publish_snapshot(root, "approved-2026-11-01-v1", candidates)
            self.assertEqual([], list(root.iterdir()))

        with tempfile.TemporaryDirectory() as directory:
            root = self.snapshot_root(directory)
            original_geteuid = self.exporter.os.geteuid
            self.exporter.os.geteuid = lambda: original_geteuid() + 1
            try:
                with self.assertRaisesRegex(OSError, "output root"):
                    self.exporter.publish_snapshot(root, "approved-2026-11-01-v1", candidates)
            finally:
                self.exporter.os.geteuid = original_geteuid
            self.assertEqual([], list(root.iterdir()))

    def test_output_root_replacement_is_detected_before_publication(self):
        candidates = self.build_snapshot([row()])
        version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = self.snapshot_root(directory)
            original_fsync = self.exporter._fsync_directory_fd
            replaced = False

            def replace_root_after_staging_fsync(descriptor):
                nonlocal replaced
                original_fsync(descriptor)
                try:
                    os.stat("candidates.jsonl", dir_fd=descriptor, follow_symlinks=False)
                except FileNotFoundError:
                    return
                if not replaced:
                    replaced = True
                    root.rename(root.with_name("displaced-root"))
                    root.mkdir(mode=0o700)

            self.exporter._fsync_directory_fd = replace_root_after_staging_fsync
            try:
                with self.assertRaisesRegex(OSError, "output root|staging"):
                    self.exporter.publish_snapshot(root, version, candidates)
            finally:
                self.exporter._fsync_directory_fd = original_fsync
            self.assertTrue(replaced)
            self.assertFalse((root / version).exists())

    def test_atomic_noreplace_rename_refuses_even_an_empty_existing_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.snapshot_root(directory)
            source = root / "source"
            target = root / "target"
            source.mkdir()
            target.mkdir()
            (source / "complete").write_text("snapshot", encoding="utf-8")
            with self.assertRaises(FileExistsError):
                self.exporter._rename_noreplace(source, target)
            self.assertTrue(source.is_dir())
            self.assertEqual([], list(target.iterdir()))

    def test_idempotent_validation_rejects_target_swapped_to_symlink(self):
        candidates = self.build_snapshot([row()])
        version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = self.snapshot_root(directory)
            target = self.exporter.publish_snapshot(root, version, candidates)
            attacker = root / "attacker-copy"
            attacker.mkdir()
            for child in target.iterdir():
                (attacker / child.name).write_bytes(child.read_bytes())

            original_matches = self.exporter._directory_matches
            swapped = False

            def swap_before_inventory(*args, **kwargs):
                nonlocal swapped
                if not swapped:
                    swapped = True
                    renamed = root / "original-snapshot"
                    os.rename(target, renamed)
                    os.symlink(attacker.name, target, target_is_directory=True)
                return original_matches(*args, **kwargs)

            self.exporter._directory_matches = swap_before_inventory
            try:
                with self.assertRaisesRegex(FileExistsError, "mismatch"):
                    self.exporter.publish_snapshot(root, version, candidates)
            finally:
                self.exporter._directory_matches = original_matches
            self.assertTrue(target.is_symlink())

    def test_idempotent_validation_rejects_target_replaced_after_member_reads(self):
        candidates = self.build_snapshot([row()])
        version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = self.snapshot_root(directory)
            target = self.exporter.publish_snapshot(root, version, candidates)
            attacker = root / "attacker-copy"
            attacker.mkdir()
            for child in target.iterdir():
                (attacker / child.name).write_bytes(child.read_bytes())

            original_read = self.exporter._read_regular_file_at
            reads = 0

            def replace_after_last_read(*args, **kwargs):
                nonlocal reads
                result = original_read(*args, **kwargs)
                reads += 1
                if reads == 2:
                    os.rename(target, root / "original-snapshot")
                    os.symlink(attacker.name, target, target_is_directory=True)
                return result

            self.exporter._read_regular_file_at = replace_after_last_read
            try:
                with self.assertRaisesRegex(FileExistsError, "mismatch"):
                    self.exporter.publish_snapshot(root, version, candidates)
            finally:
                self.exporter._read_regular_file_at = original_read
            self.assertTrue(target.is_symlink())

    def test_staging_member_replacement_is_detected_before_publication(self):
        candidates = self.build_snapshot([row()])
        version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = self.snapshot_root(directory)
            original_fsync = self.exporter._fsync_directory_fd
            replaced = False

            def replace_member_after_staging_fsync(descriptor):
                nonlocal replaced
                original_fsync(descriptor)
                if not replaced:
                    try:
                        raw = os.open(
                            "candidates.jsonl", os.O_RDONLY | os.O_NOFOLLOW,
                            dir_fd=descriptor,
                        )
                    except FileNotFoundError:
                        return
                    replaced = True
                    try:
                        contents = b""
                        while True:
                            chunk = os.read(raw, 8192)
                            if not chunk:
                                break
                            contents += chunk
                    finally:
                        os.close(raw)
                    os.unlink("candidates.jsonl", dir_fd=descriptor)
                    replacement = os.open(
                        "candidates.jsonl",
                        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                        0o600,
                        dir_fd=descriptor,
                    )
                    try:
                        os.write(replacement, contents)
                        os.fsync(replacement)
                    finally:
                        os.close(replacement)
                    unexpected = os.open(
                        "unexpected-member",
                        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                        0o600,
                        dir_fd=descriptor,
                    )
                    os.close(unexpected)

            self.exporter._fsync_directory_fd = replace_member_after_staging_fsync
            try:
                with self.assertRaisesRegex(OSError, "staging"):
                    self.exporter.publish_snapshot(root, version, candidates)
            finally:
                self.exporter._fsync_directory_fd = original_fsync

            self.assertFalse((root / version).exists())
            self.assertTrue(any(path.name.startswith(f".{version}-") for path in root.iterdir()))
            target = self.exporter.publish_snapshot(root, version, candidates)
            self.assertTrue((target / "manifest.json").is_file())

    def test_late_staging_member_rolls_back_to_retryable_tombstone(self):
        candidates = self.build_snapshot([row()])
        version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = self.snapshot_root(directory)
            original_rename = self.exporter._rename_noreplace
            mutated = False

            def mutate_at_rename(source, target, source_dir_fd=-100, target_dir_fd=-100):
                nonlocal mutated
                if source.startswith(f".{version}-") and not mutated:
                    mutated = True
                    staging_fd = os.open(
                        source,
                        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                        dir_fd=source_dir_fd,
                    )
                    try:
                        unexpected = os.open(
                            "late-member",
                            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                            0o600,
                            dir_fd=staging_fd,
                        )
                        os.close(unexpected)
                    finally:
                        os.close(staging_fd)
                return original_rename(
                    source,
                    target,
                    source_dir_fd=source_dir_fd,
                    target_dir_fd=target_dir_fd,
                )

            self.exporter._rename_noreplace = mutate_at_rename
            try:
                with self.assertRaisesRegex(OSError, "published snapshot validation failed; rolled back"):
                    self.exporter.publish_snapshot(root, version, candidates)
            finally:
                self.exporter._rename_noreplace = original_rename

            self.assertTrue(mutated)
            self.assertTrue((root / version).is_dir())
            self.assertEqual(
                {self.exporter.TOMBSTONE_MARKER_NAME},
                {path.name for path in (root / version).iterdir()},
            )
            marker = json.loads(
                (root / version / self.exporter.TOMBSTONE_MARKER_NAME).read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(self.exporter.TOMBSTONE_DOMAIN, marker["domain"])
            self.assertEqual(self.exporter.TOMBSTONE_VERSION, marker["version"])
            self.assertRegex(marker["nonce"], r"^[0-9a-f]{64}$")
            self.assertFalse(any("quarantine" in path.name for path in root.iterdir()))
            target = self.exporter.publish_snapshot(root, version, candidates)
            self.assertTrue((target / "manifest.json").is_file())

    def test_rollback_never_rmdirs_canonical_target_or_deletes_foreign_replacement(self):
        candidates = self.build_snapshot([row()])
        version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = self.snapshot_root(directory)
            original_rename = self.exporter._rename_noreplace
            original_rmdir = self.exporter.os.rmdir
            canonical_rmdirs = 0

            def mutate_at_publish(source, destination, source_dir_fd=-100, target_dir_fd=-100):
                if source.startswith(f".{version}-"):
                    staging_fd = os.open(
                        source, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                        dir_fd=source_dir_fd,
                    )
                    try:
                        os.mkdir("late-member", dir_fd=staging_fd)
                    finally:
                        os.close(staging_fd)
                return original_rename(
                    source, destination,
                    source_dir_fd=source_dir_fd, target_dir_fd=target_dir_fd,
                )

            def replace_at_old_rmdir_boundary(path, *args, **kwargs):
                nonlocal canonical_rmdirs
                if path == version:
                    canonical_rmdirs += 1
                    dir_fd = kwargs["dir_fd"]
                    os.rename(path, "captured-tombstone", src_dir_fd=dir_fd, dst_dir_fd=dir_fd)
                    os.mkdir(path, dir_fd=dir_fd)
                return original_rmdir(path, *args, **kwargs)

            self.exporter._rename_noreplace = mutate_at_publish
            self.exporter.os.rmdir = replace_at_old_rmdir_boundary
            try:
                with self.assertRaisesRegex(OSError, "rolled back"):
                    self.exporter.publish_snapshot(root, version, candidates)
            finally:
                self.exporter._rename_noreplace = original_rename
                self.exporter.os.rmdir = original_rmdir

            self.assertEqual(0, canonical_rmdirs)
            self.assertTrue((root / version).is_dir())
            self.assertEqual(
                {self.exporter.TOMBSTONE_MARKER_NAME},
                {path.name for path in (root / version).iterdir()},
            )

    def test_process_restart_recognizes_tombstone_and_retries_atomically(self):
        candidates = self.build_snapshot([row()])
        version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = self.snapshot_root(directory)
            original_rename = self.exporter._rename_noreplace

            def mutate_once(source, destination, source_dir_fd=-100, target_dir_fd=-100):
                if source.startswith(f".{version}-"):
                    staging_fd = os.open(source, os.O_RDONLY | os.O_DIRECTORY, dir_fd=source_dir_fd)
                    try:
                        os.mkdir("late-member", dir_fd=staging_fd)
                    finally:
                        os.close(staging_fd)
                    self.exporter._rename_noreplace = original_rename
                return original_rename(
                    source, destination,
                    source_dir_fd=source_dir_fd, target_dir_fd=target_dir_fd,
                )

            self.exporter._rename_noreplace = mutate_once
            try:
                with self.assertRaisesRegex(OSError, "rolled back"):
                    self.exporter.publish_snapshot(root, version, candidates)
            finally:
                self.exporter._rename_noreplace = original_rename

            restarted = load_exporter()
            target = restarted.publish_snapshot(root, version, candidates)
            self.assertEqual(
                {"candidates.jsonl", "manifest.json"},
                {path.name for path in target.iterdir()},
            )
            self.assertTrue(any(path.name.startswith(f".{version}-") for path in root.iterdir()))

    def test_forged_or_malformed_tombstones_are_mismatches(self):
        candidates = self.build_snapshot([row()])
        version = "approved-2026-11-01-v1"
        forged_markers = [
            b"not-json\n",
            json.dumps({"domain": "foreign", "version": 1, "nonce": "a" * 64}).encode() + b"\n",
            json.dumps({"domain": self.exporter.TOMBSTONE_DOMAIN, "version": 1, "nonce": "short"}).encode() + b"\n",
        ]
        for marker in forged_markers:
            with self.subTest(marker=marker), tempfile.TemporaryDirectory() as directory:
                root = self.snapshot_root(directory)
                target = root / version
                target.mkdir()
                (target / self.exporter.TOMBSTONE_MARKER_NAME).write_bytes(marker)
                with self.assertRaisesRegex(FileExistsError, "mismatch"):
                    self.exporter.publish_snapshot(root, version, candidates)
                self.assertEqual(marker, (target / self.exporter.TOMBSTONE_MARKER_NAME).read_bytes())

    def test_public_marker_fields_cannot_forge_an_authenticated_tombstone(self):
        candidates = self.build_snapshot([row()])
        version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = self.snapshot_root(directory)
            self.exporter._load_tombstone_authentication_key(root)
            target = root / version
            target.mkdir(mode=0o700)
            forged = self.exporter._canonical_json_bytes({
                "domain": self.exporter.TOMBSTONE_DOMAIN,
                "hmac_sha256": "0" * 64,
                "nonce": "a" * 64,
                "snapshot_sha256": "b" * 64,
                "snapshot_version": version,
                "version": self.exporter.TOMBSTONE_VERSION,
            })
            marker_path = target / self.exporter.TOMBSTONE_MARKER_NAME
            marker_path.write_bytes(forged)
            marker_path.chmod(0o600)
            with self.assertRaisesRegex(FileExistsError, "mismatch"):
                self.exporter.publish_snapshot(root, version, candidates)
            self.assertEqual(forged, (target / self.exporter.TOMBSTONE_MARKER_NAME).read_bytes())

    def test_wrong_key_and_tampered_identity_tombstones_remain_untouched(self):
        candidates = self.build_snapshot([row()])
        version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = self.snapshot_root(directory)
            key = self.exporter._load_tombstone_authentication_key(root)
            tampered = json.loads(self.authenticated_marker(root, version, key=key))
            tampered["nonce"] = "f" * 64
            markers = [
                self.authenticated_marker(root, version, key=b"x" * 32),
                self.authenticated_marker(root, "approved-2026-11-01-v2", key=key),
                self.exporter._canonical_json_bytes(tampered),
                self.authenticated_marker(
                    root,
                    version,
                    key=key,
                    candidates=self.build_snapshot([row(proposed_text="different snapshot")]),
                ),
            ]
            for index, marker in enumerate(markers):
                with self.subTest(index=index):
                    target = root / version
                    target.mkdir(mode=0o700)
                    marker_path = target / self.exporter.TOMBSTONE_MARKER_NAME
                    marker_path.write_bytes(marker)
                    marker_path.chmod(0o600)
                    with self.assertRaisesRegex(FileExistsError, "mismatch"):
                        self.exporter.publish_snapshot(root, version, candidates)
                    self.assertEqual(marker, marker_path.read_bytes())
                    marker_path.unlink()
                    target.rmdir()

    def test_tombstone_key_rejects_symlink_permissive_mode_and_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = self.snapshot_root(directory)
            control = base / self.exporter.TOMBSTONE_CONTROL_DIRECTORY_NAME
            control.mkdir(mode=0o755)
            with self.assertRaises(OSError):
                self.exporter._load_tombstone_authentication_key(root)

        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = self.snapshot_root(directory)
            control = base / self.exporter.TOMBSTONE_CONTROL_DIRECTORY_NAME
            control.mkdir(mode=0o700)
            (control / self.exporter.TOMBSTONE_KEY_NAME).mkdir(mode=0o700)
            with self.assertRaises(OSError):
                self.exporter._load_tombstone_authentication_key(root)

        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = self.snapshot_root(directory)
            control = base / self.exporter.TOMBSTONE_CONTROL_DIRECTORY_NAME
            control.mkdir(mode=0o700)
            os.symlink("foreign-key", control / self.exporter.TOMBSTONE_KEY_NAME)
            with self.assertRaises(OSError):
                self.exporter._load_tombstone_authentication_key(root)

        with tempfile.TemporaryDirectory() as directory:
            root = self.snapshot_root(directory)
            self.exporter._load_tombstone_authentication_key(root)
            original_geteuid = self.exporter.os.geteuid
            self.exporter.os.geteuid = lambda: original_geteuid() + 1
            try:
                with self.assertRaises(OSError):
                    self.exporter._load_tombstone_authentication_key(root)
            finally:
                self.exporter.os.geteuid = original_geteuid

        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = self.snapshot_root(directory)
            self.exporter._load_tombstone_authentication_key(root)
            key_path = base / self.exporter.TOMBSTONE_CONTROL_DIRECTORY_NAME / self.exporter.TOMBSTONE_KEY_NAME
            key_path.chmod(0o644)
            with self.assertRaises(OSError):
                self.exporter._load_tombstone_authentication_key(root)

        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = self.snapshot_root(directory)
            self.exporter._load_tombstone_authentication_key(root)
            key_path = base / self.exporter.TOMBSTONE_CONTROL_DIRECTORY_NAME / self.exporter.TOMBSTONE_KEY_NAME
            original_read = self.exporter._read_tombstone_key_bytes

            def replace_after_read(descriptor):
                raw = original_read(descriptor)
                key_path.rename(key_path.with_name("displaced-key"))
                key_path.write_bytes(b"z" * 32)
                key_path.chmod(0o600)
                return raw

            self.exporter._read_tombstone_key_bytes = replace_after_read
            try:
                with self.assertRaises(OSError):
                    self.exporter._load_tombstone_authentication_key(root)
            finally:
                self.exporter._read_tombstone_key_bytes = original_read

    def test_tombstone_key_revalidates_metadata_after_read(self):
        def chmod_key(_base, control, key_path):
            key_path.chmod(0o644)

        def add_hardlink(_base, control, key_path):
            os.link(key_path, control / "extra-key-link")

        def chmod_control(_base, control, _key_path):
            control.chmod(0o755)

        def replace_control(base, control, _key_path):
            control.rename(base / "displaced-control")
            control.mkdir(mode=0o700)

        original_geteuid = self.exporter.os.geteuid

        def change_effective_owner(_base, _control, _key_path):
            self.exporter.os.geteuid = lambda: original_geteuid() + 1

        races = {
            "key mode": chmod_key,
            "key hardlink": add_hardlink,
            "control mode": chmod_control,
            "control replacement": replace_control,
            "effective owner": change_effective_owner,
        }
        for label, mutate in races.items():
            with self.subTest(race=label), tempfile.TemporaryDirectory() as directory:
                base = Path(directory)
                root = self.snapshot_root(directory)
                expected = self.exporter._load_tombstone_authentication_key(root)
                control = base / self.exporter.TOMBSTONE_CONTROL_DIRECTORY_NAME
                key_path = control / self.exporter.TOMBSTONE_KEY_NAME
                original_read = self.exporter._read_tombstone_key_bytes

                def mutate_during_read(descriptor):
                    raw = original_read(descriptor)
                    self.assertEqual(expected, raw)
                    mutate(base, control, key_path)
                    return raw

                self.exporter._read_tombstone_key_bytes = mutate_during_read
                try:
                    with self.assertRaises(OSError):
                        self.exporter._load_tombstone_authentication_key(root)
                finally:
                    self.exporter._read_tombstone_key_bytes = original_read
                    self.exporter.os.geteuid = original_geteuid

    def test_publication_wipes_mutable_authentication_key_on_success_and_failure(self):
        candidates = self.build_snapshot([row()])
        for fail in (False, True):
            with self.subTest(fail=fail), tempfile.TemporaryDirectory() as directory:
                root = self.snapshot_root(directory)
                key = bytearray(b"k" * self.exporter.TOMBSTONE_KEY_BYTES)
                original_load = self.exporter._load_tombstone_authentication_key
                original_noreplace = self.exporter._rename_noreplace
                self.exporter._load_tombstone_authentication_key = lambda _root: key
                if fail:
                    self.exporter._rename_noreplace = lambda *_args, **_kwargs: (_ for _ in ()).throw(
                        OSError(errno.EIO, "forced publication failure")
                    )
                try:
                    if fail:
                        with self.assertRaises(OSError):
                            self.exporter.publish_snapshot(root, "approved-2026-11-01-v1", candidates)
                    else:
                        self.exporter.publish_snapshot(root, "approved-2026-11-01-v1", candidates)
                finally:
                    self.exporter._load_tombstone_authentication_key = original_load
                    self.exporter._rename_noreplace = original_noreplace
                self.assertEqual(bytearray(len(key)), key)

    def test_concurrent_retries_converge_and_preserve_displaced_control_state(self):
        candidates = self.build_snapshot([row()])
        version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = self.snapshot_root(directory)
            marker = self.authenticated_marker(root, version)
            target = root / version
            target.mkdir(mode=0o700)
            marker_path = target / self.exporter.TOMBSTONE_MARKER_NAME
            marker_path.write_bytes(marker)
            marker_path.chmod(0o600)
            barrier = threading.Barrier(3)
            outcomes = []

            def retry():
                barrier.wait()
                try:
                    outcomes.append(self.exporter.publish_snapshot(root, version, candidates))
                except Exception as exc:
                    outcomes.append(exc)

            threads = [threading.Thread(target=retry) for _ in range(2)]
            for thread in threads:
                thread.start()
            barrier.wait()
            for thread in threads:
                thread.join()

            self.assertEqual(2, len(outcomes))
            self.assertTrue(all(outcome == target for outcome in outcomes), outcomes)
            self.assertEqual(
                {"candidates.jsonl", "manifest.json"},
                {path.name for path in target.iterdir()},
            )
            self.assertTrue(any(path.name.startswith(f".{version}-") for path in root.iterdir()))

    def test_tombstone_retry_restores_foreign_target_winning_exchange_race(self):
        candidates = self.build_snapshot([row()])
        version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = self.snapshot_root(directory)
            target = root / version
            target.mkdir(mode=0o700)
            marker_path = target / self.exporter.TOMBSTONE_MARKER_NAME
            marker_path.write_bytes(
                self.authenticated_marker(root, version)
            )
            marker_path.chmod(0o600)
            original_exchange = self.exporter._rename_exchange
            raced = False

            def race_exchange(source, destination, source_dir_fd=-100, target_dir_fd=-100):
                nonlocal raced
                if destination == version and source.startswith(f".{version}-") and not raced:
                    raced = True
                    os.rename(
                        destination, "original-tombstone",
                        src_dir_fd=target_dir_fd, dst_dir_fd=target_dir_fd,
                    )
                    os.mkdir(destination, dir_fd=target_dir_fd)
                    foreign_fd = os.open(
                        destination, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                        dir_fd=target_dir_fd,
                    )
                    try:
                        marker_fd = os.open(
                            "foreign-marker", os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                            0o600, dir_fd=foreign_fd,
                        )
                        try:
                            os.write(marker_fd, b"foreign data")
                        finally:
                            os.close(marker_fd)
                    finally:
                        os.close(foreign_fd)
                return original_exchange(
                    source, destination,
                    source_dir_fd=source_dir_fd, target_dir_fd=target_dir_fd,
                )

            self.exporter._rename_exchange = race_exchange
            try:
                with self.assertRaisesRegex(FileExistsError, "mismatch"):
                    self.exporter.publish_snapshot(root, version, candidates)
            finally:
                self.exporter._rename_exchange = original_exchange

            self.assertTrue(raced)
            self.assertEqual(b"foreign data", (target / "foreign-marker").read_bytes())
            self.assertTrue((root / "original-tombstone").is_dir())
            self.assertTrue(any(path.name.startswith(f".{version}-") for path in root.iterdir()))

    def test_retry_exchange_preserves_displaced_tombstone_after_foreign_replacement(self):
        candidates = self.build_snapshot([row()])
        version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = self.snapshot_root(directory)
            target = root / version
            target.mkdir(mode=0o700)
            marker_path = target / self.exporter.TOMBSTONE_MARKER_NAME
            marker_path.write_bytes(
                self.authenticated_marker(root, version)
            )
            marker_path.chmod(0o600)
            original_exchange = self.exporter._rename_exchange
            replaced = False

            def replace_new_snapshot(source, destination, source_dir_fd=-100, target_dir_fd=-100):
                nonlocal replaced
                original_exchange(
                    source, destination,
                    source_dir_fd=source_dir_fd, target_dir_fd=target_dir_fd,
                )
                if destination == version and source.startswith(f".{version}-") and not replaced:
                    replaced = True
                    os.rename(
                        destination, "displaced-new-snapshot",
                        src_dir_fd=target_dir_fd, dst_dir_fd=target_dir_fd,
                    )
                    os.mkdir(destination, dir_fd=target_dir_fd)
                    foreign_fd = os.open(
                        destination, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                        dir_fd=target_dir_fd,
                    )
                    try:
                        member = os.open(
                            "foreign-marker", os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                            0o600, dir_fd=foreign_fd,
                        )
                        try:
                            os.write(member, b"foreign data")
                        finally:
                            os.close(member)
                    finally:
                        os.close(foreign_fd)

            self.exporter._rename_exchange = replace_new_snapshot
            try:
                with self.assertRaisesRegex(FileExistsError, "mismatch"):
                    self.exporter.publish_snapshot(root, version, candidates)
            finally:
                self.exporter._rename_exchange = original_exchange

            self.assertTrue(replaced)
            self.assertEqual(b"foreign data", (target / "foreign-marker").read_bytes())
            self.assertTrue(any(path.name.startswith(f".{version}-") for path in root.iterdir()))

    def test_rollback_exchange_restores_replacement_arriving_after_validation(self):
        candidates = self.build_snapshot([row()])
        version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = self.snapshot_root(directory)
            target = root / version
            replacement_marker = b"replacement owned by another actor"
            original_rename = self.exporter._rename_noreplace
            original_exchange = self.exporter._rename_exchange
            mutated = False
            replaced = False

            def mutate_at_publish(source, destination, source_dir_fd=-100, target_dir_fd=-100):
                nonlocal mutated
                if source.startswith(f".{version}-") and not mutated:
                    mutated = True
                    staging_fd = os.open(
                        source,
                        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                        dir_fd=source_dir_fd,
                    )
                    try:
                        member_fd = os.open(
                            "late-member",
                            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                            0o600,
                            dir_fd=staging_fd,
                        )
                        os.close(member_fd)
                    finally:
                        os.close(staging_fd)
                return original_rename(
                    source,
                    destination,
                    source_dir_fd=source_dir_fd,
                    target_dir_fd=target_dir_fd,
                )

            def replace_immediately_before_exchange(
                source, destination, source_dir_fd=-100, target_dir_fd=-100
            ):
                nonlocal replaced
                if source == version and not replaced:
                    replaced = True
                    os.rename(
                        source,
                        "attacker-moved-invalid",
                        src_dir_fd=source_dir_fd,
                        dst_dir_fd=source_dir_fd,
                    )
                    os.mkdir(source, dir_fd=source_dir_fd)
                    replacement_directory_fd = os.open(
                        source,
                        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                        dir_fd=source_dir_fd,
                    )
                    try:
                        replacement_fd = os.open(
                            "replacement-marker",
                            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                            0o600,
                            dir_fd=replacement_directory_fd,
                        )
                        try:
                            os.write(replacement_fd, replacement_marker)
                        finally:
                            os.close(replacement_fd)
                    finally:
                        os.close(replacement_directory_fd)
                return original_exchange(
                    source,
                    destination,
                    source_dir_fd=source_dir_fd,
                    target_dir_fd=target_dir_fd,
                )

            self.exporter._rename_noreplace = mutate_at_publish
            self.exporter._rename_exchange = replace_immediately_before_exchange
            try:
                with self.assertRaisesRegex(OSError, "rollback restored replacement target"):
                    self.exporter.publish_snapshot(root, version, candidates)
            finally:
                self.exporter._rename_noreplace = original_rename
                self.exporter._rename_exchange = original_exchange

            self.assertTrue(mutated)
            self.assertTrue(replaced)
            self.assertEqual(replacement_marker, (target / "replacement-marker").read_bytes())
            self.assertFalse(any("quarantine" in path.name for path in root.iterdir()))
            self.assertTrue(any(path.name.startswith(f".{version}-") for path in root.iterdir()))

    def test_rollback_fails_closed_when_atomic_exchange_is_unavailable(self):
        candidates = self.build_snapshot([row()])
        version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = self.snapshot_root(directory)
            target = root / version
            original_rename = self.exporter._rename_noreplace
            original_exchange = self.exporter._rename_exchange
            mutated = False

            def mutate_at_publish(source, destination, source_dir_fd=-100, target_dir_fd=-100):
                nonlocal mutated
                if source.startswith(f".{version}-") and not mutated:
                    mutated = True
                    staging_fd = os.open(
                        source,
                        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                        dir_fd=source_dir_fd,
                    )
                    try:
                        os.mkdir("late-member", dir_fd=staging_fd)
                    finally:
                        os.close(staging_fd)
                return original_rename(
                    source,
                    destination,
                    source_dir_fd=source_dir_fd,
                    target_dir_fd=target_dir_fd,
                )

            def unavailable(*_args, **_kwargs):
                raise OSError(errno.ENOTSUP, "atomic exchange unavailable")

            self.exporter._rename_noreplace = mutate_at_publish
            self.exporter._rename_exchange = unavailable
            try:
                with self.assertRaisesRegex(OSError, "atomic rollback exchange failed"):
                    self.exporter.publish_snapshot(root, version, candidates)
            finally:
                self.exporter._rename_noreplace = original_rename
                self.exporter._rename_exchange = original_exchange

            self.assertTrue(mutated)
            self.assertTrue(target.is_dir())
            self.assertTrue((target / "late-member").is_dir())
            self.assertFalse(any("quarantine" in path.name for path in root.iterdir()))

    def test_cleanup_does_not_delete_a_replaced_staging_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.snapshot_root(directory)
            staging = root / ".snapshot-staging"
            staging.mkdir()
            (staging / "manifest.json").write_text("ours", encoding="utf-8")
            original_metadata = staging.stat()
            os.rename(staging, root / "original-staging")
            staging.mkdir()
            replacement = staging / "manifest.json"
            replacement.write_text("attacker", encoding="utf-8")
            root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
            try:
                self.exporter._remove_staging(
                    root_fd,
                    staging.name,
                    {"manifest.json"},
                    expected_directory=original_metadata,
                )
            finally:
                os.close(root_fd)
            self.assertEqual("attacker", replacement.read_text(encoding="utf-8"))

    def test_publication_cleanup_never_calls_pathname_unlink_or_rmdir(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.snapshot_root(directory)
            staging = root / ".snapshot-staging"
            staging.mkdir(mode=0o700)
            member = staging / "manifest.json"
            member.write_text("ours", encoding="utf-8")
            root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
            staging_fd = os.open(staging, os.O_RDONLY | os.O_DIRECTORY)
            original_unlink = self.exporter.os.unlink
            original_rmdir = self.exporter.os.rmdir
            calls = []
            self.exporter.os.unlink = lambda *args, **kwargs: calls.append(("unlink", args, kwargs))
            self.exporter.os.rmdir = lambda *args, **kwargs: calls.append(("rmdir", args, kwargs))
            try:
                self.exporter._remove_staging(
                    root_fd,
                    staging.name,
                    {member.name},
                    expected_directory=staging.stat(),
                )
                self.exporter._remove_exact_open_directory(
                    root_fd,
                    staging.name,
                    staging_fd,
                    staging.stat(),
                    {member.name: member.read_bytes()},
                    {member.name: member.stat()},
                )
            finally:
                self.exporter.os.unlink = original_unlink
                self.exporter.os.rmdir = original_rmdir
                os.close(staging_fd)
                os.close(root_fd)
            self.assertEqual([], calls)
            self.assertEqual("ours", member.read_text(encoding="utf-8"))

    def test_applied_version_binding_requires_independently_verified_manifest_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            raw = b'{"artifact_kind":"company_benefits_manifest","data_version":"company-benefits-2026-11-01-v2"}\n'
            path.write_bytes(raw)
            digest = hashlib.sha256(raw).hexdigest()
            self.assertEqual(
                "company-benefits-2026-11-01-v2",
                self.exporter.verify_applied_version_binding(
                    path, "company-benefits-2026-11-01-v2", digest
                ),
            )
            with self.assertRaisesRegex(ValueError, "verified manifest SHA-256"):
                self.exporter.verify_applied_version_binding(path, "company-benefits-2026-11-01-v2", "0" * 64)
            with self.assertRaisesRegex(ValueError, "does not match"):
                self.exporter.verify_applied_version_binding(path, "company-benefits-2026-11-02-v1", digest)

    def test_psql_transport_streams_bounded_rows_and_has_no_sensitive_projection(self):
        calls = []

        def process_factory(command, **kwargs):
            calls.append((command, kwargs))
            program = "import sys; query=sys.stdin.buffer.read(); sys.stdout.buffer.write(b'" + json.dumps(row()).replace("'", "\\'") + "\\n')"
            return subprocess.Popen([sys.executable, "-c", program], **kwargs)

        self.assertEqual([row()], self.exporter.fetch_rows_with_psql(
            process_factory=process_factory, timeout_seconds=7.5
        ))
        command, kwargs = calls[0]
        self.assertEqual("psql", command[0])
        self.assertNotIn("--dbname", command)
        self.assertEqual(subprocess.PIPE, kwargs["stdin"])
        self.assertEqual(subprocess.PIPE, kwargs["stdout"])
        self.assertEqual(subprocess.PIPE, kwargs["stderr"])
        self.assertTrue(kwargs["start_new_session"])
        query = self.exporter.APPROVED_QUERY
        self.assertIn("repeatable read read only", query)
        self.assertIn("where r.status='approved'", query)
        self.assertIn(f"limit {self.exporter.MAX_CANDIDATES + 1}", query.lower())
        self.assertNotIn("jsonb_agg", query.lower())
        for sensitive in (
            "submitter_id", "reviewer_id", "admin_response", "client_key",
            "payload_fingerprint", "benefit_correction_events",
        ):
            self.assertNotIn(sensitive, query)

    def test_psql_rejects_max_rows_plus_one_without_validating_all_rows(self):
        original_limit = self.exporter.MAX_CANDIDATES
        self.exporter.MAX_CANDIDATES = 2
        program = "import sys; sys.stdin.buffer.read(); sys.stdout.write(" + repr(
            "\n".join(json.dumps(row(f"10000000-0000-4000-8000-{index:012d}")) for index in range(1, 4)) + "\n"
        ) + ")"
        try:
            with self.assertRaisesRegex(ValueError, "candidate limit"):
                self.exporter.fetch_rows_with_psql(
                    process_factory=lambda _command, **kwargs: subprocess.Popen(
                        [sys.executable, "-c", program], **kwargs
                    )
                )
        finally:
            self.exporter.MAX_CANDIDATES = original_limit

    def test_snapshot_byte_limit_rejects_many_valid_rows_below_row_limit(self):
        sample = self.build_snapshot([row()])
        one_row_bytes = len(self.exporter.canonical_jsonl(sample))
        original_limit = self.exporter.MAX_SNAPSHOT_BYTES
        self.exporter.MAX_SNAPSHOT_BYTES = one_row_bytes * 2
        rows = [
            row(f"10000000-0000-4000-8000-{index:012d}")
            for index in range(1, 4)
        ]
        try:
            with self.assertRaisesRegex(ValueError, "snapshot byte limit"):
                self.build_snapshot(rows)
        finally:
            self.exporter.MAX_SNAPSHOT_BYTES = original_limit

    def test_snapshot_byte_limit_accepts_exact_boundary(self):
        rows = [
            row(f"10000000-0000-4000-8000-{index:012d}")
            for index in range(1, 3)
        ]
        expected = self.build_snapshot(rows)
        exact_size = len(self.exporter.canonical_jsonl(expected))
        original_limit = self.exporter.MAX_SNAPSHOT_BYTES
        self.exporter.MAX_SNAPSHOT_BYTES = exact_size
        try:
            actual = self.build_snapshot(rows)
            self.assertEqual(exact_size, len(self.exporter.canonical_jsonl(actual)))
        finally:
            self.exporter.MAX_SNAPSHOT_BYTES = original_limit

    def test_snapshot_uses_disk_spool_and_bounded_metadata_near_limit(self):
        original_limit = self.exporter.MAX_SNAPSHOT_BYTES
        original_candidates = self.exporter.MAX_CANDIDATES
        self.exporter.MAX_SNAPSHOT_BYTES = 1024 * 1024
        self.exporter.MAX_CANDIDATES = 2_000
        rows = [
            row(
                f"10000000-0000-4000-8000-{index:012d}",
                current_text="c" * 400,
                proposed_text="p" * 400,
            )
            for index in range(800)
        ]
        tracemalloc.start()
        try:
            snapshot = self.build_snapshot(list(reversed(rows)))
            _current, peak = tracemalloc.get_traced_memory()
            self.assertIsInstance(snapshot, self.exporter._SnapshotSpool)
            self.assertGreater(snapshot.byte_count, self.exporter.MAX_SNAPSHOT_BYTES * 0.8)
            self.assertLessEqual(snapshot.byte_count, self.exporter.MAX_SNAPSHOT_BYTES)
            self.assertLess(peak, 12 * 1024 * 1024)
            self.assertEqual(800, len(snapshot))
            self.assertEqual(rows[0]["id"], snapshot[0]["correction_request_id"])
            self.assertFalse(any(isinstance(value[-1], dict) for value in snapshot._records.values()))
        finally:
            tracemalloc.stop()
            self.exporter.MAX_SNAPSHOT_BYTES = original_limit
            self.exporter.MAX_CANDIDATES = original_candidates

    def test_streamed_manifest_is_deterministic_without_materializing_snapshot(self):
        rows = [
            row("10000000-0000-4000-8000-000000000002", proposed_text="second"),
            row("10000000-0000-4000-8000-000000000001", proposed_text="first"),
        ]
        left = self.build_snapshot(rows)
        right = self.build_snapshot(list(reversed(rows)))
        self.assertEqual(left.sha256, right.sha256)
        self.assertEqual(left.byte_count, right.byte_count)
        left_manifest = self.exporter._expected_files("approved-2026-11-01-v1", left)["manifest.json"]
        right_manifest = self.exporter._expected_files("approved-2026-11-01-v1", right)["manifest.json"]
        self.assertEqual(left_manifest, right_manifest)

    def test_psql_snapshot_byte_overflow_terminates_process(self):
        launched = []
        original_limit = self.exporter.MAX_SNAPSHOT_BYTES
        self.exporter.MAX_SNAPSHOT_BYTES = 1024
        program = """
import json
import sys
sys.stdin.buffer.read()
template = %r
for index in range(1000):
    value = dict(template)
    value["id"] = f"10000000-0000-4000-8000-{index:012d}"
    sys.stdout.write(json.dumps(value) + "\\n")
    sys.stdout.flush()
""" % row()

        def process_factory(_command, **kwargs):
            process = subprocess.Popen([sys.executable, "-c", program], **kwargs)
            launched.append(process)
            return process

        try:
            with tempfile.TemporaryDirectory() as directory:
                base = Path(directory)
                output_root = base / "snapshots"
                self.exporter._preflight_publication_platform(output_root)
                with self.assertRaisesRegex((RuntimeError, ValueError), "byte limit"):
                    self.exporter.fetch_snapshot_with_psql(
                        resolver=self.public_resolver,
                        process_factory=process_factory,
                    )
                self.assertTrue(output_root.is_dir())
                self.assert_canonical_capability_control(output_root)
        finally:
            self.exporter.MAX_SNAPSHOT_BYTES = original_limit
        self.assertEqual(1, len(launched))
        self.assertIsNotNone(launched[0].returncode)

    def test_psql_rejects_oversized_stdout_line_and_stderr_flood(self):
        cases = [
            ("import sys; sys.stdin.buffer.read(); sys.stdout.buffer.write(b'x'*200000)", "stdout"),
            ("import sys; sys.stdin.buffer.read(); sys.stderr.buffer.write(b'x'*200000)", "stderr"),
        ]
        for program, diagnostic in cases:
            with self.subTest(stream=diagnostic):
                with self.assertRaisesRegex(RuntimeError, diagnostic):
                    self.exporter.fetch_rows_with_psql(
                        process_factory=lambda _command, program=program, **kwargs: subprocess.Popen(
                            [sys.executable, "-c", program], **kwargs
                        ),
                        timeout_seconds=1,
                    )

    def test_psql_rejects_wrong_keys_before_returning_rows(self):
        invalid = row(unexpected="secret")
        program = "import sys; sys.stdin.buffer.read(); sys.stdout.write(" + repr(json.dumps(invalid) + "\n") + ")"
        with self.assertRaisesRegex(ValueError, "unexpected fields"):
            self.exporter.fetch_rows_with_psql(
                process_factory=lambda _command, **kwargs: subprocess.Popen(
                    [sys.executable, "-c", program], **kwargs
                )
            )

    def test_unsupported_preflight_leaves_no_output_or_control_artifacts(self):
        candidates = self.build_snapshot([row()])
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / "snapshots"
            original = self.exporter._preflight_publication_platform
            self.exporter._preflight_publication_platform = lambda _root: (_ for _ in ()).throw(
                OSError(errno.ENOTSUP, "unsupported publication platform")
            )
            try:
                with self.assertRaisesRegex(OSError, "unsupported"):
                    self.exporter.publish_snapshot(root, "approved-2026-11-01-v1", candidates)
            finally:
                self.exporter._preflight_publication_platform = original
            self.assertFalse(root.exists())
            self.assertFalse((base / self.exporter.TOMBSTONE_CONTROL_DIRECTORY_NAME).exists())

    def capability_control(self, root):
        return root / self.exporter.CAPABILITY_CONTROL_DIRECTORY_NAME

    def assert_canonical_capability_control(self, root):
        control = self.capability_control(root)
        self.assertEqual(
            set(self.exporter.CAPABILITY_PROBE_CONTENTS),
            {entry.name for entry in control.iterdir()},
        )
        for name, expected in self.exporter.CAPABILITY_PROBE_CONTENTS.items():
            entry = control / name
            self.assertEqual(expected, entry.read_bytes())
            metadata = entry.stat()
            self.assertEqual(0o600, metadata.st_mode & 0o777)
            self.assertEqual(1, metadata.st_nlink)

    def test_preflight_rejects_false_enoent_and_preserves_persistent_control(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / "snapshots"
            original = self.exporter._renameat2_function

            def false_enoent(*_args):
                import ctypes
                ctypes.set_errno(errno.ENOENT)
                return -1

            self.exporter._renameat2_function = lambda: false_enoent
            try:
                with self.assertRaisesRegex(OSError, "unsupported"):
                    self.exporter._preflight_publication_platform(root)
            finally:
                self.exporter._renameat2_function = original
            self.assertTrue(root.is_dir())
            self.assertTrue(self.capability_control(root).is_dir())

    def test_preflight_proves_semantics_and_keeps_bounded_canonical_control(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / "snapshots"
            for _ in range(20):
                self.exporter._preflight_publication_platform(root)
                self.assert_canonical_capability_control(root)
            self.assertEqual(
                [self.exporter.CAPABILITY_CONTROL_DIRECTORY_NAME],
                [entry.name for entry in root.iterdir()],
            )

    def test_preflight_fixture_is_inside_exact_private_output_root(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"
            original = self.exporter._renameat2_function
            real_function = original()
            observed = []

            def inspect_fixture(source_fd, source, target_fd, target, flags):
                observed.append(flags)
                self.assertEqual(source_fd, target_fd)
                probe_path = Path(os.readlink(f"/proc/self/fd/{source_fd}"))
                self.assertEqual(root, probe_path.parent)
                self.assertEqual(
                    self.exporter.CAPABILITY_CONTROL_DIRECTORY_NAME, probe_path.name
                )
                self.assertEqual(0o700, os.fstat(source_fd).st_mode & 0o777)
                return real_function(source_fd, source, target_fd, target, flags)

            self.exporter._renameat2_function = lambda: inspect_fixture
            try:
                self.exporter._preflight_publication_platform(root)
            finally:
                self.exporter._renameat2_function = original
            self.assertEqual([1, 2, 2], observed)
            self.assert_canonical_capability_control(root)

    def test_preflight_fails_closed_for_unsupported_filesystem_errors(self):
        for unsupported_errno in (errno.ENOSYS, errno.EOPNOTSUPP, errno.EINVAL):
            with self.subTest(error=unsupported_errno), tempfile.TemporaryDirectory() as directory:
                base = Path(directory)
                root = base / "snapshots"
                original = self.exporter._renameat2_function

                def unsupported(*_args, error_number=unsupported_errno):
                    import ctypes
                    ctypes.set_errno(error_number)
                    return -1

                self.exporter._renameat2_function = lambda: unsupported
                try:
                    with self.assertRaisesRegex(OSError, "unsupported"):
                        self.exporter._preflight_publication_platform(root)
                finally:
                    self.exporter._renameat2_function = original
                self.assertTrue(root.is_dir())
                self.assertTrue(self.capability_control(root).is_dir())

    def test_preflight_never_calls_unlink_or_rmdir_at_destructive_boundaries(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"
            self.exporter._preflight_publication_platform(root)
            original_unlink = self.exporter.os.unlink
            original_rmdir = self.exporter.os.rmdir
            calls = []
            self.exporter.os.unlink = lambda *args, **kwargs: calls.append(("unlink", args, kwargs))
            self.exporter.os.rmdir = lambda *args, **kwargs: calls.append(("rmdir", args, kwargs))
            try:
                for _ in range(5):
                    self.exporter._preflight_publication_platform(root)
            finally:
                self.exporter.os.unlink = original_unlink
                self.exporter.os.rmdir = original_rmdir
            self.assertEqual([], calls)
            self.assert_canonical_capability_control(root)

    def test_preflight_restart_restores_interrupted_exchange(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"
            original = self.exporter._preflight_cleanup_hook

            def interrupt(stage, _context):
                if stage == "after_test_exchange":
                    raise RuntimeError("simulated interruption")

            self.exporter._preflight_cleanup_hook = interrupt
            try:
                with self.assertRaisesRegex(RuntimeError, "simulated interruption"):
                    self.exporter._preflight_publication_platform(root)
            finally:
                self.exporter._preflight_cleanup_hook = original
            control = self.capability_control(root)
            self.assertEqual(
                self.exporter.CAPABILITY_PROBE_CONTENTS["target"],
                (control / "source").read_bytes(),
            )
            self.exporter._preflight_publication_platform(root)
            self.assert_canonical_capability_control(root)

    def test_preflight_foreign_insertion_fails_closed_without_deletion(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"
            self.exporter._preflight_publication_platform(root)
            foreign = self.capability_control(root) / "foreign"
            foreign.write_bytes(b"foreign inode")
            with self.assertRaisesRegex(OSError, "manual recovery.*capability control"):
                self.exporter._preflight_publication_platform(root)
            self.assertEqual(b"foreign inode", foreign.read_bytes())

    def test_preflight_hardlinked_member_fails_closed_and_preserves_both_names(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"
            self.exporter._preflight_publication_platform(root)
            control = self.capability_control(root)
            outside = root / "foreign-hardlink"
            os.link(control / "source", outside, follow_symlinks=False)
            with self.assertRaisesRegex(OSError, "manual recovery.*capability control"):
                self.exporter._preflight_publication_platform(root)
            self.assertTrue((control / "source").is_file())
            self.assertTrue(outside.is_file())
            self.assertEqual(2, outside.stat().st_nlink)

    def test_preflight_replaced_member_at_exchange_boundary_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"
            self.exporter._preflight_publication_platform(root)
            original = self.exporter._preflight_cleanup_hook
            displaced = self.capability_control(root) / "displaced-source"

            def replace(stage, context):
                if stage != "before_test_exchange":
                    return
                control = self.capability_control(root)
                (control / "source").rename(displaced)
                (control / "source").write_bytes(b"foreign replacement")
                (control / "source").chmod(0o600)

            self.exporter._preflight_cleanup_hook = replace
            try:
                with self.assertRaisesRegex(OSError, "manual recovery.*capability control"):
                    self.exporter._preflight_publication_platform(root)
            finally:
                self.exporter._preflight_cleanup_hook = original
            self.assertEqual(b"foreign replacement", (self.capability_control(root) / "target").read_bytes())
            self.assertEqual(
                self.exporter.CAPABILITY_PROBE_CONTENTS["source"], displaced.read_bytes()
            )

    def test_preflight_replaced_control_directory_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"
            self.exporter._preflight_publication_platform(root)
            original = self.exporter._preflight_cleanup_hook
            displaced = root / "displaced-capability-control"

            def replace(stage, _context):
                if stage != "before_test_exchange":
                    return
                self.capability_control(root).rename(displaced)
                replacement = self.capability_control(root)
                replacement.mkdir(mode=0o700)
                (replacement / "foreign-marker").write_bytes(b"foreign directory")

            self.exporter._preflight_cleanup_hook = replace
            try:
                with self.assertRaisesRegex(OSError, "manual recovery.*capability control"):
                    self.exporter._preflight_publication_platform(root)
            finally:
                self.exporter._preflight_cleanup_hook = original
            self.assertEqual(
                b"foreign directory",
                (self.capability_control(root) / "foreign-marker").read_bytes(),
            )
            self.assertTrue(displaced.is_dir())
            self.assertFalse((root / "approved-2026-11-01-v1").exists())

    def test_preflight_replaced_output_root_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / "snapshots"
            self.exporter._preflight_publication_platform(root)
            original = self.exporter._preflight_cleanup_hook
            displaced = base / "displaced-output-root"

            def replace(stage, _context):
                if stage != "before_test_exchange":
                    return
                root.rename(displaced)
                root.mkdir(mode=0o700)
                (root / "foreign-marker").write_bytes(b"foreign root")

            self.exporter._preflight_cleanup_hook = replace
            try:
                with self.assertRaisesRegex(OSError, "manual recovery.*capability control"):
                    self.exporter._preflight_publication_platform(root)
            finally:
                self.exporter._preflight_cleanup_hook = original
            self.assertEqual(b"foreign root", (root / "foreign-marker").read_bytes())
            self.assertTrue((displaced / self.exporter.CAPABILITY_CONTROL_DIRECTORY_NAME).is_dir())
            self.assertFalse((root / "approved-2026-11-01-v1").exists())
            self.assertFalse((root / self.exporter.TOMBSTONE_MARKER_NAME).exists())

    def test_preflight_never_removes_preexisting_output_root(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"
            root.mkdir(mode=0o700)
            before = root.stat()
            self.exporter._preflight_publication_platform(root)
            after = root.stat()
            self.assertEqual((before.st_dev, before.st_ino), (after.st_dev, after.st_ino))
            self.assert_canonical_capability_control(root)

    def test_psql_timeout_kills_pipe_holding_descendants_with_a_bounded_deadline(self):
        launched = []
        program = """
import os
import signal
import time
signal.signal(signal.SIGTERM, signal.SIG_IGN)
if os.fork() == 0:
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
while True:
    time.sleep(1)
"""

        def process_factory(_command, **kwargs):
            process = subprocess.Popen([sys.executable, "-c", program], **kwargs)
            launched.append(process)
            return process

        started = time.monotonic()
        with self.assertRaisesRegex(RuntimeError, "timed out"):
            self.exporter.fetch_rows_with_psql(
                process_factory=process_factory,
                timeout_seconds=0.05,
                kill_grace_seconds=0.05,
            )
        elapsed = time.monotonic() - started
        self.assertLess(elapsed, 0.75)
        self.assertEqual(1, len(launched))
        self.assertIsNotNone(launched[0].returncode)
        deadline = time.monotonic() + 0.5
        while True:
            try:
                os.killpg(launched[0].pid, 0)
            except ProcessLookupError:
                break
            if time.monotonic() >= deadline:
                self.fail("psql process group survived timeout cleanup")
            time.sleep(0.01)

    def test_fixture_backed_cli_exports_without_credentials_or_network(self):
        with tempfile.TemporaryDirectory() as directory:
            root = self.snapshot_root(directory)
            fixture = root / "rows.json"
            resolver_fixture = root / "resolver.json"
            fixture.write_text(json.dumps([row()]), encoding="utf-8")
            resolver_fixture.write_text(json.dumps({"example.com": ["93.184.216.34"]}), encoding="utf-8")
            result = subprocess.run(
                [
                    sys.executable, str(EXPORTER), "export", "--input-json", str(fixture),
                    "--resolver-json", str(resolver_fixture),
                    "--output-root", str(root / "snapshots"), "--snapshot-version", "approved-2026-11-01-v1",
                ],
                cwd=ROOT, text=True, capture_output=True, check=False,
            )
            self.assertEqual(0, result.returncode, result.stdout + result.stderr)
            summary = json.loads(result.stdout)
            self.assertEqual(1, summary["candidate_count"])
            self.assertTrue((root / "snapshots" / "approved-2026-11-01-v1" / "manifest.json").is_file())
            self.assertNotIn("applied", summary)


if __name__ == "__main__":
    unittest.main()
