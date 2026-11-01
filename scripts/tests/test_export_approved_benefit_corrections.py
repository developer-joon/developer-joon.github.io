import errno
import fcntl
import hashlib
import importlib.util
import io
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
import tarfile
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


def write_artifact(
    exporter, path, version, candidates_raw, candidate_count=None,
    candidate_sha256=None,
):
    """Write a canonical container around caller-controlled candidate bytes."""
    if candidate_count is None:
        candidate_count = candidates_raw.count(b"\n")
    manifest = exporter._canonical_json_bytes({
        "artifact_kind": "approved_benefit_correction_offline_review_snapshot",
        "candidate_count": candidate_count,
        "candidates_file": "candidates.jsonl",
        "container_format": "deterministic-ustar",
        "schema_version": 1,
        "snapshot_sha256": candidate_sha256 or hashlib.sha256(candidates_raw).hexdigest(),
        "snapshot_version": version,
    })
    with path.open("wb") as artifact:
        for name, raw in (("manifest.json", manifest), ("candidates.jsonl", candidates_raw)):
            artifact.write(exporter._tar_header(name, len(raw)))
            artifact.write(raw)
            artifact.write(b"\0" * ((-len(raw)) % 512))
        artifact.write(b"\0" * 1024)


def rewrite_tar_checksum(header):
    header[148:156] = b"        "
    header[148:156] = f"{sum(header):06o}\0 ".encode("ascii")


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

    def provision(self, root, version="approved-2026-11-01-v1"):
        self.exporter.prepare_output_root(root, version)
        return root

    def test_anonymous_artifact_contract_and_lock_order(self):
        candidates = self.build_snapshot([row()])
        version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"
            self.provision(root, version)
            self.assertEqual(
                {self.exporter.PUBLICATION_LOCK_NAME, self.exporter.PUBLICATION_KEY_NAME},
                {entry.name for entry in root.iterdir()},
            )

            events = []
            original_open = self.exporter._open_preprovisioned_file
            original_flock = self.exporter.fcntl.flock

            def observed_open(directory_fd, name, *args, **kwargs):
                events.append(("open", name))
                return original_open(directory_fd, name, *args, **kwargs)

            def observed_flock(descriptor, operation):
                events.append(("flock", operation))
                return original_flock(descriptor, operation)

            self.exporter._open_preprovisioned_file = observed_open
            self.exporter.fcntl.flock = observed_flock
            try:
                artifact = self.exporter.publish_snapshot(root, version, candidates)
            finally:
                self.exporter._open_preprovisioned_file = original_open
                self.exporter.fcntl.flock = original_flock

            self.assertEqual(root / f"{version}.tar", artifact)
            self.assertLess(
                events.index(("flock", fcntl.LOCK_EX)),
                events.index(("open", self.exporter.PUBLICATION_KEY_NAME)),
            )
            self.assertEqual(
                {self.exporter.PUBLICATION_LOCK_NAME, self.exporter.PUBLICATION_KEY_NAME, f"{version}.tar"},
                {entry.name for entry in root.iterdir()},
            )
            with tarfile.open(artifact, mode="r:") as archive:
                self.assertEqual(["manifest.json", "candidates.jsonl"], archive.getnames())
                self.assertTrue(all(member.isfile() for member in archive.getmembers()))
                manifest = json.load(archive.extractfile("manifest.json"))
                candidate_bytes = archive.extractfile("candidates.jsonl").read()
            self.assertEqual(candidates.sha256, manifest["snapshot_sha256"])
            self.assertEqual(self.exporter.canonical_jsonl(candidates), candidate_bytes)
            before = artifact.read_bytes()
            self.assertEqual(artifact, self.exporter.publish_snapshot(root, version, candidates))
            self.assertEqual(before, artifact.read_bytes())

    def test_late_foreign_target_is_never_replaced(self):
        candidates = self.build_snapshot([row()])
        version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"
            self.provision(root, version)
            target = root / f"{version}.tar"
            original = self.exporter._publication_failure_hook

            def insert(stage, _context):
                if stage == "before_link":
                    target.write_bytes(b"foreign")
                    target.chmod(0o600)

            self.exporter._publication_failure_hook = insert
            try:
                with self.assertRaises(OSError):
                    self.exporter.publish_snapshot(root, version, candidates)
            finally:
                self.exporter._publication_failure_hook = original
            self.assertEqual(b"foreign", target.read_bytes())

    def test_prepare_parent_swap_during_setup_lock_fails_with_residue_diagnostic(self):
        version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            parent = base / "private"
            parent.mkdir(mode=0o700)
            root = parent / "snapshots"
            displaced = base / "displaced-parent"
            original = self.exporter._prepare_failure_hook

            def swap(stage, _context):
                if stage == "after_setup_lock":
                    parent.rename(displaced)
                    parent.mkdir(mode=0o700)

            self.exporter._prepare_failure_hook = swap
            try:
                with self.assertRaisesRegex(OSError, "displaced|changed"):
                    self.exporter.prepare_output_root(root, version)
            finally:
                self.exporter._prepare_failure_hook = original
            self.assertFalse(root.exists())
            self.assertTrue((displaced / "snapshots").is_dir() or not (displaced / "snapshots").exists())

    def assert_prepared_inventory(self, root, version):
        self.assertEqual(
            {self.exporter.PUBLICATION_LOCK_NAME, self.exporter.PUBLICATION_KEY_NAME},
            {entry.name for entry in root.iterdir()},
        )
        self.assertEqual(0o700, root.stat().st_mode & 0o777)
        key = root / self.exporter.PUBLICATION_KEY_NAME
        self.assertEqual(self.exporter.PUBLICATION_KEY_BYTES, key.stat().st_size)
        for path in [root / self.exporter.PUBLICATION_LOCK_NAME, key]:
            self.assertEqual(0o600, path.stat().st_mode & 0o777)
            self.assertEqual(1, path.stat().st_nlink)

    def test_prepare_provisions_exact_inventory_and_refuses_any_existing_path(self):
        version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"
            self.provision(root, version)
            self.assert_prepared_inventory(root, version)
            with self.assertRaises(FileExistsError):
                self.exporter.prepare_output_root(root, version)
            occupied = Path(directory) / "occupied"
            occupied.write_text("foreign", encoding="utf-8")
            with self.assertRaises(FileExistsError):
                self.exporter.prepare_output_root(occupied, version)
            self.assertEqual("foreign", occupied.read_text(encoding="utf-8"))

    def test_runtime_requires_every_anchor_and_never_bootstraps_missing_state(self):
        candidates = self.build_snapshot([row()])
        version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "missing"
            with self.assertRaisesRegex(OSError, "prepare"):
                self.exporter.publish_snapshot(root, version, candidates)
            self.assertFalse(root.exists())
        for missing in (self.exporter.PUBLICATION_LOCK_NAME, self.exporter.PUBLICATION_KEY_NAME):
            with self.subTest(missing=missing), tempfile.TemporaryDirectory() as directory:
                root = Path(directory) / "snapshots"
                self.provision(root, version)
                path = root / missing
                if path.is_dir():
                    for child in path.iterdir():
                        child.unlink()
                    path.rmdir()
                else:
                    path.unlink()
                before = sorted(p.name for p in root.iterdir())
                with self.assertRaises(OSError):
                    self.exporter.publish_snapshot(root, version, candidates)
                self.assertEqual(before, sorted(p.name for p in root.iterdir()))

    def test_publish_is_atomic_idempotent_and_refuses_tampered_snapshot(self):
        candidates = self.build_snapshot([row()])
        version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"
            self.provision(root, version)
            target = self.exporter.publish_snapshot(root, version, candidates)
            self.assertTrue(target.is_file())
            self.assertEqual(target, self.exporter.publish_snapshot(root, version, candidates))
            target.write_text("tampered\n", encoding="utf-8")
            with self.assertRaises(OSError):
                self.exporter.publish_snapshot(root, version, candidates)
            self.assertEqual("tampered\n", target.read_text(encoding="utf-8"))

    def test_runtime_never_mkdirs_creates_unlinks_or_rmdirs_anchor_paths(self):
        candidates = self.build_snapshot([row()])
        version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"
            self.provision(root, version)
            original = (self.exporter.os.open, self.exporter.os.mkdir,
                        self.exporter.os.unlink, self.exporter.os.rmdir)
            calls = []
            def checked_open(path, flags, *args, **kwargs):
                if flags & (os.O_CREAT | os.O_EXCL):
                    calls.append(("open-create", os.fspath(path)))
                return original[0](path, flags, *args, **kwargs)
            self.exporter.os.open = checked_open
            self.exporter.os.mkdir = lambda *a, **k: calls.append(("mkdir", a[0]))
            self.exporter.os.unlink = lambda *a, **k: calls.append(("unlink", a[0]))
            self.exporter.os.rmdir = lambda *a, **k: calls.append(("rmdir", a[0]))
            try:
                self.exporter.publish_snapshot(root, version, candidates)
            finally:
                (self.exporter.os.open, self.exporter.os.mkdir,
                 self.exporter.os.unlink, self.exporter.os.rmdir) = original
            self.assertEqual([], calls)

    def test_root_lock_and_key_swaps_after_lock_fail_before_publication(self):
        candidates = self.build_snapshot([row()])
        version = "approved-2026-11-01-v1"
        for case in ("root", "lock", "key", "key-bytes"):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory:
                base = Path(directory); root = base / "snapshots"; self.provision(root, version)
                original = self.exporter._publication_failure_hook
                def swap(stage, _context):
                    if stage != "after_lock": return
                    self.exporter._publication_failure_hook = original
                    if case == "root":
                        root.rename(base / "displaced-root"); root.mkdir(mode=0o700)
                    elif case == "lock":
                        path = root / self.exporter.PUBLICATION_LOCK_NAME
                        path.rename(root / "displaced-lock"); path.write_bytes(b""); path.chmod(0o600)
                    elif case == "key":
                        path = root / self.exporter.PUBLICATION_KEY_NAME
                        path.rename(root / "displaced-key"); path.write_bytes(b"x" * 32); path.chmod(0o600)
                    else:
                        (root / self.exporter.PUBLICATION_KEY_NAME).write_bytes(b"y" * 32)
                self.exporter._publication_failure_hook = swap
                try:
                    with self.assertRaises(OSError):
                        self.exporter.publish_snapshot(root, version, candidates)
                finally:
                    self.exporter._publication_failure_hook = original
                self.assertFalse((root / f"{version}.tar").exists())

    def test_concurrent_exporters_serialize_on_the_verified_lock(self):
        candidates = self.build_snapshot([row()]); version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"; self.provision(root, version)
            barrier = threading.Barrier(9); guard = threading.Lock(); outcomes = []
            active = 0; maximum = 0; original = self.exporter._publication_failure_hook
            def observe(stage, _context):
                nonlocal active, maximum
                if stage != "after_lock": return
                with guard: active += 1; maximum = max(maximum, active)
                time.sleep(0.01)
                with guard: active -= 1
            def publish():
                barrier.wait()
                try: outcomes.append(self.exporter.publish_snapshot(root, version, candidates))
                except Exception as exc: outcomes.append(exc)
            self.exporter._publication_failure_hook = observe
            try:
                threads = [threading.Thread(target=publish) for _ in range(8)]
                for thread in threads: thread.start()
                barrier.wait()
                for thread in threads: thread.join()
            finally: self.exporter._publication_failure_hook = original
            self.assertEqual(1, maximum); self.assertEqual(8, len(outcomes))
            self.assertTrue(all(value == root / f"{version}.tar" for value in outcomes), outcomes)

    def test_one_hundred_crashes_keep_exact_bounded_inventory_then_recover(self):
        candidates = self.build_snapshot([row()]); version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"; self.provision(root, version)
            original = self.exporter._publication_failure_hook
            def crash(stage, _context):
                if stage == "before_link": raise OSError(errno.EIO, "injected crash")
            self.exporter._publication_failure_hook = crash
            try:
                for _ in range(100):
                    with self.assertRaisesRegex(OSError, "injected crash"):
                        self.exporter.publish_snapshot(root, version, candidates)
            finally: self.exporter._publication_failure_hook = original
            self.assert_prepared_inventory(root, version)
            total = sum(p.stat().st_size for p in root.rglob("*") if p.is_file())
            self.assertEqual(self.exporter.PUBLICATION_KEY_BYTES, total)
            self.assertTrue(self.exporter.publish_snapshot(root, version, candidates).is_file())

    def test_crash_after_link_is_idempotently_recoverable(self):
        candidates = self.build_snapshot([row()]); version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"; self.provision(root, version)
            original = self.exporter._publication_failure_hook
            def crash(stage, _context):
                if stage == "after_link": raise OSError(errno.EIO, "simulated stop")
            self.exporter._publication_failure_hook = crash
            try:
                with self.assertRaisesRegex(OSError, "simulated stop"):
                    self.exporter.publish_snapshot(root, version, candidates)
            finally: self.exporter._publication_failure_hook = original
            self.assertTrue(self.exporter.publish_snapshot(root, version, candidates).is_file())

    def test_invalid_anchor_metadata_links_and_inventory_fail_closed(self):
        candidates = self.build_snapshot([row()]); version = "approved-2026-11-01-v1"
        mutations = {
            "short key": lambda r: (r / self.exporter.PUBLICATION_KEY_NAME).write_bytes(b"short"),
            "permissive root": lambda r: r.chmod(0o755),
            "permissive key": lambda r: (r / self.exporter.PUBLICATION_KEY_NAME).chmod(0o644),
            "extra root": lambda r: (r / "foreign").write_bytes(b"foreign"),
            "linked key": lambda r: os.link(r / self.exporter.PUBLICATION_KEY_NAME, r / "foreign-link"),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label), tempfile.TemporaryDirectory() as directory:
                root = Path(directory) / "snapshots"; self.provision(root, version); mutate(root)
                before = sorted(str(p.relative_to(root)) for p in root.rglob("*"))
                with self.assertRaises(OSError): self.exporter.publish_snapshot(root, version, candidates)
                self.assertEqual(before, sorted(str(p.relative_to(root)) for p in root.rglob("*")))
                self.assertFalse((root / f"{version}.tar").exists())

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
            with tempfile.TemporaryDirectory() as directory:
                version = "approved-2026-11-01-v1"
                root = Path(directory) / "snapshots"
                self.provision(root, version)
                target = self.exporter.publish_snapshot(root, version, snapshot)
                with tarfile.open(target, mode="r:") as archive:
                    self.assertEqual(
                        snapshot.byte_count,
                        archive.getmember("candidates.jsonl").size,
                    )
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
                output_root.mkdir(mode=0o700)
                self.exporter._preflight_publication_platform(output_root)
                with self.assertRaisesRegex((RuntimeError, ValueError), "byte limit"):
                    self.exporter.fetch_snapshot_with_psql(
                        resolver=self.public_resolver,
                        process_factory=process_factory,
                    )
                self.assertTrue(output_root.is_dir())
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

    def test_prepare_rejects_a_permissive_parent(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory) / "shared"
            parent.mkdir(mode=0o777)
            parent.chmod(0o777)
            with self.assertRaisesRegex(OSError, "parent is not private"):
                self.exporter.prepare_output_root(
                    parent / "snapshots", "approved-2026-11-01-v1"
                )

    def test_prepare_refuses_a_preexisting_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            foreign = base / "foreign"
            foreign.mkdir()
            root = base / "snapshots"
            root.symlink_to(foreign, target_is_directory=True)
            with self.assertRaises(FileExistsError):
                self.exporter.prepare_output_root(root, "approved-2026-11-01-v1")
            self.assertTrue(root.is_symlink())

    def test_runtime_rejects_a_nonempty_lock_file(self):
        candidates = self.build_snapshot([row()]); version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"; self.provision(root, version)
            (root / self.exporter.PUBLICATION_LOCK_NAME).write_bytes(b"foreign")
            with self.assertRaises(OSError):
                self.exporter.publish_snapshot(root, version, candidates)

    def test_runtime_rejects_a_version_other_than_the_prepared_version(self):
        candidates = self.build_snapshot([row()])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"
            self.provision(root, "approved-2026-11-01-v1")
            with self.assertRaises(OSError):
                self.exporter.publish_snapshot(root, "approved-2026-11-01-v2", candidates)
            self.assertFalse((root / "approved-2026-11-01-v2.tar").exists())

    def test_runtime_rejects_an_incomplete_key_without_promotion(self):
        candidates = self.build_snapshot([row()]); version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"; self.provision(root, version)
            key = root / self.exporter.PUBLICATION_KEY_NAME
            key.write_bytes(b"")
            with self.assertRaises(OSError):
                self.exporter.publish_snapshot(root, version, candidates)
            self.assertEqual(b"", key.read_bytes())

    def test_runtime_rejects_foreign_regular_symlink_and_directory_targets(self):
        candidates = self.build_snapshot([row()]); version = "approved-2026-11-01-v1"
        for kind in ("regular", "symlink", "directory"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                root = Path(directory) / "snapshots"; self.provision(root, version)
                target = root / f"{version}.tar"
                if kind == "regular":
                    target.write_bytes(b"foreign"); target.chmod(0o600)
                elif kind == "symlink":
                    target.symlink_to(self.exporter.PUBLICATION_KEY_NAME)
                else:
                    target.mkdir(mode=0o700)
                with self.assertRaises(OSError):
                    self.exporter.publish_snapshot(root, version, candidates)
                self.assertTrue(target.exists() or target.is_symlink())

    def test_linkat_failure_leaves_no_named_residue(self):
        candidates = self.build_snapshot([row()]); version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"; self.provision(root, version)
            original = self.exporter._link_anonymous_file
            self.exporter._link_anonymous_file = lambda *_a, **_k: (_ for _ in ()).throw(
                OSError(errno.ENOTSUP, "linkat unavailable")
            )
            try:
                with self.assertRaisesRegex(OSError, "linkat unavailable"):
                    self.exporter.publish_snapshot(root, version, candidates)
            finally:
                self.exporter._link_anonymous_file = original
            self.assert_prepared_inventory(root, version)

    def test_crash_after_anonymous_artifact_fsync_leaves_no_residue(self):
        candidates = self.build_snapshot([row()]); version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"; self.provision(root, version)
            original = self.exporter._publication_failure_hook
            def crash(stage, _context):
                if stage == "after_artifact_fsync":
                    raise OSError(errno.EIO, "anonymous artifact crash")
            self.exporter._publication_failure_hook = crash
            try:
                with self.assertRaisesRegex(OSError, "anonymous artifact crash"):
                    self.exporter.publish_snapshot(root, version, candidates)
            finally:
                self.exporter._publication_failure_hook = original
            self.assert_prepared_inventory(root, version)
            self.assertTrue(self.exporter.publish_snapshot(root, version, candidates).is_file())

    def test_postlink_artifact_mutation_is_reported_not_accepted(self):
        candidates = self.build_snapshot([row()]); version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"; self.provision(root, version)
            original = self.exporter._publication_failure_hook
            def mutate(stage, _context):
                if stage == "after_link":
                    (root / f"{version}.tar").write_bytes(b"tampered")
            self.exporter._publication_failure_hook = mutate
            try:
                with self.assertRaises(OSError):
                    self.exporter.publish_snapshot(root, version, candidates)
            finally:
                self.exporter._publication_failure_hook = original
            self.assertEqual(b"tampered", (root / f"{version}.tar").read_bytes())

    def test_runtime_rejects_wrong_effective_owner_without_mutation(self):
        candidates = self.build_snapshot([row()]); version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"; self.provision(root, version)
            original = self.exporter.os.geteuid
            self.exporter.os.geteuid = lambda: original() + 1
            try:
                with self.assertRaises(OSError):
                    self.exporter.publish_snapshot(root, version, candidates)
            finally:
                self.exporter.os.geteuid = original
            self.assertFalse((root / f"{version}.tar").exists())

    def test_review_tool_streams_valid_jsonl_and_rejects_unsafe_tar_inventory(self):
        candidates = self.build_snapshot([row()]); version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"; self.provision(root, version)
            artifact = self.exporter.publish_snapshot(root, version, candidates)
            output = io.BytesIO()
            manifest = self.exporter.stream_review_candidates(artifact, version, output)
            self.assertEqual(self.exporter.canonical_jsonl(candidates), output.getvalue())
            self.assertEqual(1, manifest["candidate_count"])

            for case in ("unsafe-name", "duplicate", "symlink"):
                malicious = Path(directory) / f"{case}.tar"
                with tarfile.open(malicious, mode="w:") as archive:
                    names = ["manifest.json", "manifest.json"] if case == "duplicate" else ["../manifest.json"]
                    if case == "symlink":
                        member = tarfile.TarInfo("manifest.json")
                        member.type = tarfile.SYMTYPE
                        member.linkname = "/etc/passwd"
                        archive.addfile(member)
                    else:
                        for name in names:
                            raw = b"{}\n"
                            member = tarfile.TarInfo(name)
                            member.size = len(raw)
                            archive.addfile(member, io.BytesIO(raw))
                with self.subTest(case=case), self.assertRaises(OSError):
                    self.exporter.stream_review_candidates(malicious, version, io.BytesIO())

    def test_review_rejects_invalid_candidate_rows_before_emitting_any_bytes(self):
        version = "approved-2026-11-01-v1"
        valid = self.build_snapshot([row()])[0]
        invalid_rows = []
        for field, value in (("email", "private@example.com"), ("status", "submitted"),
                             ("unknown", "value")):
            candidate = dict(valid)
            candidate[field] = value
            invalid_rows.append((field, candidate))
        missing = dict(valid); missing.pop("company_id")
        wrong_type = dict(valid); wrong_type["scope_text"] = 7
        invalid_rows.extend((("missing", missing), ("type", wrong_type)))

        with tempfile.TemporaryDirectory() as directory:
            for label, candidate in invalid_rows:
                with self.subTest(label=label):
                    artifact = Path(directory) / f"{label}.tar"
                    write_artifact(
                        self.exporter, artifact, version,
                        self.exporter._canonical_json_bytes(candidate),
                    )
                    output = io.BytesIO()
                    with self.assertRaises(OSError):
                        self.exporter.stream_review_candidates(artifact, version, output)
                    self.assertEqual(b"", output.getvalue())

    def test_review_rejects_noncanonical_duplicate_and_out_of_order_rows_without_output(self):
        version = "approved-2026-11-01-v1"
        first, second = list(self.build_snapshot([
            row("10000000-0000-4000-8000-000000000001"),
            row("10000000-0000-4000-8000-000000000002"),
        ]))
        cases = {
            "noncanonical": (json.dumps(first) + "\n").encode("utf-8"),
            "duplicate": self.exporter._canonical_json_bytes(first) * 2,
            "out-of-order": (
                self.exporter._canonical_json_bytes(second)
                + self.exporter._canonical_json_bytes(first)
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            for label, raw in cases.items():
                with self.subTest(label=label):
                    artifact = Path(directory) / f"{label}.tar"
                    write_artifact(self.exporter, artifact, version, raw)
                    output = io.BytesIO()
                    with self.assertRaises(OSError):
                        self.exporter.stream_review_candidates(artifact, version, output)
                    self.assertEqual(b"", output.getvalue())

    def test_review_late_row_and_manifest_mismatches_emit_nothing(self):
        version = "approved-2026-11-01-v1"
        first, second = list(self.build_snapshot([
            row("10000000-0000-4000-8000-000000000001"),
            row("10000000-0000-4000-8000-000000000002"),
        ]))
        invalid_last = dict(second); invalid_last["email"] = "private@example.com"
        late_raw = (
            self.exporter._canonical_json_bytes(first)
            + self.exporter._canonical_json_bytes(invalid_last)
        )
        valid_raw = self.exporter._canonical_json_bytes(first)
        cases = {
            "late": (late_raw, None, None),
            "count": (valid_raw, 2, None),
            "hash": (valid_raw, None, "0" * 64),
        }
        with tempfile.TemporaryDirectory() as directory:
            for label, (raw, count, digest) in cases.items():
                with self.subTest(label=label):
                    artifact = Path(directory) / f"{label}.tar"
                    write_artifact(
                        self.exporter, artifact, version, raw,
                        candidate_count=count, candidate_sha256=digest,
                    )
                    output = io.BytesIO()
                    with self.assertRaises(OSError):
                        self.exporter.stream_review_candidates(artifact, version, output)
                    self.assertEqual(b"", output.getvalue())

    def test_review_rejects_every_noncanonical_ustar_header_region(self):
        version = "approved-2026-11-01-v1"
        candidates = self.build_snapshot([row()])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"; self.provision(root, version)
            canonical = self.exporter.publish_snapshot(root, version, candidates).read_bytes()
            regions = {
                "name": 0, "mode": 100, "uid": 108, "gid": 116, "size": 124,
                "mtime": 136, "checksum": 148, "typeflag": 156, "linkname": 157,
                "magic": 257, "version": 263, "uname": 265, "gname": 297,
                "devmajor": 329, "devminor": 337, "prefix": 345, "reserved": 500,
            }
            manifest_size = self.exporter._parse_tar_number(canonical[124:136])
            header_offsets = {
                "manifest": 0,
                "candidates": 512 + manifest_size + ((-manifest_size) % 512),
            }
            for member, header_offset in header_offsets.items():
                for label, index in regions.items():
                    with self.subTest(member=member, region=label):
                        mutated = bytearray(canonical)
                        absolute_index = header_offset + index
                        mutated[absolute_index] = (
                            ord("1") if mutated[absolute_index] != ord("1") else ord("2")
                        )
                        if label != "checksum":
                            header = bytearray(mutated[header_offset:header_offset + 512])
                            rewrite_tar_checksum(header)
                            mutated[header_offset:header_offset + 512] = header
                        artifact = Path(directory) / f"header-{member}-{label}.tar"
                        artifact.write_bytes(mutated)
                        output = io.BytesIO()
                        with self.assertRaises(OSError):
                            self.exporter.stream_review_candidates(artifact, version, output)
                        self.assertEqual(b"", output.getvalue())

    def test_review_rejects_nonzero_padding_terminal_blocks_and_trailing_bytes(self):
        version = "approved-2026-11-01-v1"
        candidates = self.build_snapshot([row()])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "snapshots"; self.provision(root, version)
            canonical = bytearray(self.exporter.publish_snapshot(root, version, candidates).read_bytes())
            manifest_size = self.exporter._parse_tar_number(canonical[124:136])
            padding_index = 512 + manifest_size
            cases = {}
            padded = bytearray(canonical); padded[padding_index] = 1; cases["padding"] = padded
            terminal = bytearray(canonical); terminal[-1] = 1; cases["terminal"] = terminal
            cases["trailing"] = canonical + b"x"
            for label, raw in cases.items():
                with self.subTest(label=label):
                    artifact = Path(directory) / f"{label}.tar"; artifact.write_bytes(raw)
                    output = io.BytesIO()
                    with self.assertRaises(OSError):
                        self.exporter.stream_review_candidates(artifact, version, output)
                    self.assertEqual(b"", output.getvalue())

    def test_eight_concurrent_processes_publish_one_exact_artifact(self):
        version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory); root = base / "snapshots"
            fixture = base / "rows.json"; resolver = base / "resolver.json"
            fixture.write_text(json.dumps([row()]), encoding="utf-8")
            resolver.write_text(json.dumps({"example.com": ["93.184.216.34"]}), encoding="utf-8")
            self.provision(root, version)
            command = [
                sys.executable, str(EXPORTER), "export", "--input-json", str(fixture),
                "--resolver-json", str(resolver), "--output-root", str(root),
                "--snapshot-version", version,
            ]
            processes = [
                subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                for _ in range(8)
            ]
            outcomes = [process.communicate(timeout=30) for process in processes]
            self.assertTrue(
                all(process.returncode == 0 for process in processes),
                [(process.returncode, stderr.decode()) for process, (_stdout, stderr) in zip(processes, outcomes)],
            )
            self.assertEqual(
                {self.exporter.PUBLICATION_LOCK_NAME, self.exporter.PUBLICATION_KEY_NAME, f"{version}.tar"},
                {entry.name for entry in root.iterdir()},
            )

    def test_fixture_backed_cli_requires_prepare_then_exports(self):
        version = "approved-2026-11-01-v1"
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory); root = base / "snapshots"
            fixture = base / "rows.json"; resolver = base / "resolver.json"
            fixture.write_text(json.dumps([row()]), encoding="utf-8")
            resolver.write_text(json.dumps({"example.com": ["93.184.216.34"]}), encoding="utf-8")
            prepare = subprocess.run([sys.executable, str(EXPORTER), "prepare", "--output-root", str(root),
                                      "--snapshot-version", version], cwd=ROOT, text=True, capture_output=True)
            self.assertEqual(0, prepare.returncode, prepare.stdout + prepare.stderr)
            result = subprocess.run([sys.executable, str(EXPORTER), "export", "--input-json", str(fixture),
                                     "--resolver-json", str(resolver), "--output-root", str(root),
                                     "--snapshot-version", version], cwd=ROOT, text=True, capture_output=True)
            self.assertEqual(0, result.returncode, result.stdout + result.stderr)
            self.assertEqual(1, json.loads(result.stdout)["candidate_count"])
            self.assertTrue((root / f"{version}.tar").is_file())


if __name__ == "__main__":
    unittest.main()
