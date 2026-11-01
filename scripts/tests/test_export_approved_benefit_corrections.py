import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
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

    def test_exports_only_approved_rows_with_a_strict_candidate_allowlist(self):
        snapshot = self.exporter.build_snapshot([
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
        self.assertEqual(1, len(self.exporter.build_snapshot([original, dict(original)])))
        conflicting = row(proposed_text="Different")
        with self.assertRaisesRegex(ValueError, "conflicting duplicate"):
            self.exporter.build_snapshot([original, conflicting])
        with self.assertRaisesRegex(ValueError, "conflicting duplicate"):
            self.exporter.build_snapshot([original, row(status="submitted")])

    def test_jsonl_escapes_malicious_text_and_round_trips_exactly(self):
        malicious = '</script>\n{"forged":true}\t\\"\u2028'
        candidates = self.exporter.build_snapshot([row(proposed_text=malicious)])
        raw = self.exporter.canonical_jsonl(candidates)
        self.assertNotIn(b"</script>", raw)
        self.assertEqual(malicious, json.loads(raw.decode("utf-8"))["proposed_text"])
        self.assertEqual(1, len(raw.splitlines()))

    def test_rejects_unknown_fields_and_pii_in_database_responses(self):
        for field in ("unexpected", "email", "submitter_id", "reviewer_id", "provider_metadata"):
            with self.subTest(field=field):
                with self.assertRaisesRegex(ValueError, "unexpected fields"):
                    self.exporter.build_snapshot([row(**{field: "secret"})])

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
                    self.exporter.build_snapshot([invalid])

    def test_canonical_order_and_hash_are_deterministic(self):
        second = row("10000000-0000-4000-8000-000000000002", company_id="US-CIK0000320193")
        first = row()
        left = self.exporter.canonical_jsonl(self.exporter.build_snapshot([second, first]))
        right = self.exporter.canonical_jsonl(self.exporter.build_snapshot([first, second]))
        self.assertEqual(left, right)
        self.assertEqual(hashlib.sha256(left).hexdigest(), self.exporter.snapshot_sha256(left))
        self.assertEqual(first["id"], json.loads(left.splitlines()[0])["correction_request_id"])

    def test_publish_is_atomic_idempotent_and_refuses_existing_mismatch(self):
        candidates = self.exporter.build_snapshot([row()])
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

    def test_psql_transport_is_injectable_read_only_and_has_no_sensitive_projection(self):
        calls = []

        class Result:
            returncode = 0
            stdout = "[]\n"

        def runner(command, **kwargs):
            calls.append((command, kwargs))
            return Result()

        self.assertEqual([], self.exporter.fetch_rows_with_psql(runner))
        command, kwargs = calls[0]
        self.assertEqual("psql", command[0])
        self.assertNotIn("--dbname", command)
        query = kwargs["input"]
        self.assertIn("repeatable read read only", query)
        self.assertIn("where r.status='approved'", query)
        for sensitive in (
            "submitter_id", "reviewer_id", "admin_response", "client_key",
            "payload_fingerprint", "benefit_correction_events",
        ):
            self.assertNotIn(sensitive, query)

    def test_fixture_backed_cli_exports_without_credentials_or_network(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = root / "rows.json"
            fixture.write_text(json.dumps([row()]), encoding="utf-8")
            result = subprocess.run(
                [
                    sys.executable, str(EXPORTER), "export", "--input-json", str(fixture),
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
