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
            root = Path(directory)
            target = self.exporter.publish_snapshot(root, "approved-2026-11-01-v1", candidates)
            first_manifest = (target / "manifest.json").read_bytes()
            self.assertEqual(target, self.exporter.publish_snapshot(root, "approved-2026-11-01-v1", candidates))
            self.assertEqual(first_manifest, (target / "manifest.json").read_bytes())
            (target / "candidates.jsonl").write_text("tampered\n", encoding="utf-8")
            with self.assertRaisesRegex(FileExistsError, "mismatch"):
                self.exporter.publish_snapshot(root, "approved-2026-11-01-v1", candidates)
            self.assertEqual("tampered\n", (target / "candidates.jsonl").read_text(encoding="utf-8"))
            self.assertFalse(any(path.name.startswith(".approved-2026-11-01-v1-") for path in root.iterdir()))

    def test_atomic_noreplace_rename_refuses_even_an_empty_existing_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
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
            root = Path(directory)
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
            root = Path(directory)
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
            root = Path(directory)
            original_fsync = self.exporter._fsync_directory_fd
            replaced = False

            def replace_member_after_staging_fsync(descriptor):
                nonlocal replaced
                original_fsync(descriptor)
                if not replaced:
                    replaced = True
                    raw = os.open(
                        "candidates.jsonl", os.O_RDONLY | os.O_NOFOLLOW,
                        dir_fd=descriptor,
                    )
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
            self.assertFalse(any(path.name.startswith(f".{version}-") for path in root.iterdir()))
            target = self.exporter.publish_snapshot(root, version, candidates)
            self.assertTrue((target / "manifest.json").is_file())

    def test_late_staging_member_at_rename_rolls_back_and_retry_succeeds(self):
        candidates = self.build_snapshot([row()])
        version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
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
            self.assertFalse((root / version).exists())
            self.assertEqual([], list(root.iterdir()))
            target = self.exporter.publish_snapshot(root, version, candidates)
            self.assertTrue((target / "manifest.json").is_file())

    def test_rollback_never_deletes_a_replacement_target(self):
        candidates = self.build_snapshot([row()])
        version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / version
            replacement_marker = b"replacement owned by another actor"
            original_matches = self.exporter._directory_matches
            replaced = False

            def replace_before_post_publication_validation(root_fd, target_name, expected, **kwargs):
                nonlocal replaced
                if target_name == version and kwargs.get("expected_directory") is not None and not replaced:
                    replaced = True
                    os.rename(target_name, "displaced-corrupt", src_dir_fd=root_fd, dst_dir_fd=root_fd)
                    os.mkdir(target_name, dir_fd=root_fd)
                    replacement_directory_fd = os.open(
                        target_name,
                        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                        dir_fd=root_fd,
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
                return original_matches(root_fd, target_name, expected, **kwargs)

            self.exporter._directory_matches = replace_before_post_publication_validation
            try:
                with self.assertRaisesRegex(OSError, "rollback refused replacement target"):
                    self.exporter.publish_snapshot(root, version, candidates)
            finally:
                self.exporter._directory_matches = original_matches

            self.assertTrue(replaced)
            self.assertEqual(replacement_marker, (target / "replacement-marker").read_bytes())
            self.assertFalse(any("quarantine" in path.name for path in root.iterdir()))
            self.assertFalse(any(path.name.startswith(f".{version}-") for path in root.iterdir()))

    def test_cleanup_does_not_delete_a_replaced_staging_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
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

    def test_psql_transport_is_injectable_read_only_bounded_and_has_no_sensitive_projection(self):
        calls = []

        class Process:
            returncode = 0

            def communicate(self, input, timeout):
                calls.append(("communicate", input, timeout))
                return "[]\n", ""

        def process_factory(command, **kwargs):
            calls.append((command, kwargs))
            return Process()

        self.assertEqual(
            [],
            self.exporter.fetch_rows_with_psql(
                process_factory=process_factory, timeout_seconds=7.5
            ),
        )
        command, kwargs = calls[0]
        self.assertEqual("psql", command[0])
        self.assertNotIn("--dbname", command)
        self.assertEqual(subprocess.PIPE, kwargs["stdin"])
        self.assertEqual(subprocess.PIPE, kwargs["stdout"])
        self.assertEqual(subprocess.PIPE, kwargs["stderr"])
        self.assertTrue(kwargs["start_new_session"])
        _, query, timeout = calls[1]
        self.assertEqual(7.5, timeout)
        self.assertIn("repeatable read read only", query)
        self.assertIn("where r.status='approved'", query)
        for sensitive in (
            "submitter_id", "reviewer_id", "admin_response", "client_key",
            "payload_fingerprint", "benefit_correction_events",
        ):
            self.assertNotIn(sensitive, query)

    def test_psql_timeout_terminates_then_kills_and_reports_no_credentials(self):
        group_signals = []

        class StalledProcess:
            returncode = None
            pid = 424242
            stdin = None
            stdout = None
            stderr = None

            def __init__(self):
                self.calls = []

            def communicate(self, input=None, timeout=None):
                self.calls.append(("communicate", input, timeout))
                if group_signals and group_signals[-1] == signal.SIGKILL:
                    self.returncode = -9
                    return "", "contains password=secret"
                raise subprocess.TimeoutExpired("psql", timeout)

        process = StalledProcess()
        original_killpg = self.exporter.os.killpg
        self.exporter.os.killpg = lambda pid, sent_signal: group_signals.append(sent_signal)
        try:
            with self.assertRaisesRegex(RuntimeError, "timed out") as raised:
                self.exporter.fetch_rows_with_psql(
                    process_factory=lambda *_args, **_kwargs: process,
                    timeout_seconds=0.01,
                    kill_grace_seconds=0.01,
                )
        finally:
            self.exporter.os.killpg = original_killpg
        self.assertEqual("approved correction read timed out", str(raised.exception))
        self.assertEqual([signal.SIGTERM, signal.SIGKILL], group_signals)
        self.assertEqual(-9, process.returncode)

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
            root = Path(directory)
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
