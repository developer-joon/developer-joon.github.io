import copy
import gzip
import hashlib
import importlib.util
import json
import os
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from jsonschema import Draft202012Validator, FormatChecker

from scripts import company_benefits_collectors as collectors


ROOT = Path(__file__).resolve().parents[2]
SCHEMA = ROOT / "docs" / "research" / "company-benefits" / "schema"


def load_cli():
    path = ROOT / "scripts" / "collect-company-benefits-v2.py"
    spec = importlib.util.spec_from_file_location("collect_company_benefits_v2", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(path.parent))
    try:
        spec.loader.exec_module(module)
    finally:
        sys.path.pop(0)
    return module


class FakeTransport:
    def __init__(self, responses):
        self.responses = {key: list(value) for key, value in responses.items()}
        self.calls = []

    def request(self, url, *, connect_timeout, read_timeout, max_wire_bytes):
        self.calls.append((url, connect_timeout, read_timeout, max_wire_bytes))
        result = self.responses[url].pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def response(status=200, body=b"benefits", headers=None, peer_ip="93.184.216.34"):
    return collectors.TransportResponse(
        status=status,
        headers=headers or {"content-type": "text/html; charset=utf-8"},
        body=body,
        peer_ip=peer_ip,
    )


class CollectorTests(unittest.TestCase):
    def setUp(self):
        self.company = collectors.CompanyAuthority(
            company_id="KR-CRN-1101112948086",
            jurisdiction="KR",
            legal_name="(주)인텔리안테크놀로지스",
            canonical_legal_entity="(주)인텔리안테크놀로지스",
            official_domain="intelliantech.com",
        )

    def test_canonical_queries_and_ids_are_deterministic_and_scope_bound(self):
        query = collectors.canonical_query(self.company, "leave", "official-company")
        self.assertEqual(
            '"(주)인텔리안테크놀로지스" "KR-CRN-1101112948086" "leave" site:intelliantech.com',
            query,
        )
        first = collectors.attempt_id(self.company.company_id, "leave", "official-company")
        second = collectors.attempt_id(self.company.company_id, "leave", "official-company")
        self.assertEqual(first, second)
        self.assertEqual(
            first,
            collectors.attempt_id(self.company.company_id, "leave", "company-recruiting-media"),
        )
        self.assertNotEqual(first, collectors.attempt_id(self.company.company_id, "health", "official-company"))
        self.assertNotEqual(first, collectors.attempt_id("KR-CRN-other", "leave", "official-company"))
        self.assertEqual(
            {
                "official-company",
                "official-government",
                "company-recruiting-media",
                "other-public-web",
                "community-review",
            },
            set(collectors.ROUTES),
        )

    def test_url_policy_rejects_unsafe_urls_and_every_unsafe_dns_answer(self):
        public = lambda host, port: ["93.184.216.34"]
        for url in (
            "http://example.com/",
            "ftp://example.com/",
            "https://user:pass@example.com/",
            "https://localhost/",
            "https://127.0.0.1/",
            "https://[::1]/",
            "https://169.254.169.254/latest/meta-data/",
        ):
            with self.subTest(url=url), self.assertRaises(collectors.SecurityError):
                collectors.validate_public_https_url(url, resolver=public)
        for answers in (["10.0.0.1"], ["93.184.216.34", "192.168.1.2"], ["224.0.0.1"], ["192.0.2.1"]):
            with self.subTest(answers=answers), self.assertRaises(collectors.SecurityError):
                collectors.validate_public_https_url("https://example.com/", resolver=lambda h, p, a=answers: a)
        self.assertEqual("https://example.com/", collectors.validate_public_https_url("https://EXAMPLE.com", resolver=public))

    def test_url_policy_rejects_signed_and_credential_query_or_fragment_variants(self):
        public = lambda host, port: ["93.184.216.34"]
        urls = (
            "https://example.com/?X-Amz-Signature=secret",
            "https://example.com/?x-amz-credential=value",
            "https://example.com/?ACCESS_TOKEN=secret",
            "https://example.com/?oauth_token=secret",
            "https://example.com/?Signature=secret",
            "https://example.com/#access_token=secret",
            "https://example.com/#X-Amz-Security-Token=secret",
            "https://example.com/api/sk-abcdefghijklmnopqrstuvwx/data",
            "https://example.com/api/%73%6b-abcdefghijklmnopqrstuvwx/data",
        )
        for url in urls:
            with self.subTest(url=url), self.assertRaises(collectors.SecurityError):
                collectors.validate_public_https_url(url, resolver=public)

    def test_official_query_uses_canonical_entity_and_strict_optional_authority(self):
        without_domain = collectors.CompanyAuthority(
            company_id=self.company.company_id,
            jurisdiction="KR",
            legal_name="Trading Name",
            canonical_legal_entity="Canonical Legal Entity Ltd",
        )
        query = collectors.canonical_query(without_domain, "leave", "official-company")
        self.assertIn('"Canonical Legal Entity Ltd"', query)
        self.assertIn('"official company"', query)
        self.assertNotIn("site:", query)
        for bad in ("example.com evil", 'example.com"', "example.com?x=1", "example.com/#x", "-bad.com", "bad-.com", "localhost"):
            company = collectors.CompanyAuthority(**{**without_domain.__dict__, "official_domain": bad})
            with self.subTest(domain=bad), self.assertRaises(collectors.CollectorError):
                collectors.canonical_query(company, "leave", "official-company")

    def test_cli_rejects_batch_official_domain_override_and_uses_canonical_authority(self):
        cli = load_cli()
        companies = {
            self.company.company_id: {
                "company_id": self.company.company_id,
                "jurisdiction": "KR",
                "legal_name": "Canonical Co",
                "selected_reporting_legal_entity": "Canonical Co Ltd",
                "official_domain": "canonical.example",
            }
        }
        with self.assertRaises(cli.CollectorError):
            cli._expand_requests([{
                "company_id": self.company.company_id,
                "category_id": "leave",
                "route_ids": ["official-company"],
                "official_domain": "attacker.example",
            }], companies, 10)
        items = cli._expand_requests([{
            "company_id": self.company.company_id,
            "category_id": "leave",
            "route_ids": ["official-company"],
        }], companies, 10)
        self.assertEqual("canonical.example", items[0]["company"].official_domain)

    def test_redirects_are_bounded_and_revalidated(self):
        start = "https://example.com/start"
        next_url = "https://example.org/final"
        transport = FakeTransport({
            start: [response(302, b"", {"location": next_url, "content-type": "text/html"})],
            next_url: [response(200, b"ok")],
        })
        policy = collectors.FetchPolicy(max_redirects=1, retries=0)
        result = collectors.fetch_bounded(start, transport=transport, policy=policy, resolver=lambda h, p: ["93.184.216.34"])
        self.assertEqual(next_url, result.final_url)
        self.assertEqual([start, next_url], result.url_chain)

        evil = FakeTransport({start: [response(302, b"", {"location": "https://127.0.0.1/admin"})]})
        with self.assertRaises(collectors.SecurityError):
            collectors.fetch_bounded(start, transport=evil, policy=policy, resolver=lambda h, p: ["93.184.216.34"])

        loop = FakeTransport({start: [response(302, b"", {"location": start}), response(302, b"", {"location": start})]})
        with self.assertRaises(collectors.FetchError):
            collectors.fetch_bounded(start, transport=loop, policy=policy, resolver=lambda h, p: ["93.184.216.34"])

    def test_peer_ip_content_type_response_and_decompression_are_bounded(self):
        url = "https://example.com/"
        resolve = lambda h, p: ["93.184.216.34"]
        cases = (
            response(body=b"x" * 11),
            response(body=b"{}", headers={"content-type": "application/octet-stream"}),
            response(body=gzip.compress(b"x" * 100), headers={"content-type": "text/html", "content-encoding": "gzip"}),
            response(body=b"ok", peer_ip="127.0.0.1"),
            response(body=b"ok", peer_ip="93.184.216.35"),
        )
        for item in cases:
            with self.subTest(item=item), self.assertRaises((collectors.FetchError, collectors.SecurityError)):
                collectors.fetch_bounded(
                    url,
                    transport=FakeTransport({url: [item]}),
                    policy=collectors.FetchPolicy(max_wire_bytes=10, max_decoded_bytes=10, retries=0),
                    resolver=resolve,
                )

    def test_retries_are_finite_and_only_retry_transient_failures(self):
        url = "https://example.com/"
        policy = collectors.FetchPolicy(retries=2, retry_backoff_seconds=0)
        transport = FakeTransport({url: [collectors.TransientFetchError("timeout"), response(503), response(200)]})
        result = collectors.fetch_bounded(url, transport=transport, policy=policy, resolver=lambda h, p: ["93.184.216.34"])
        self.assertEqual(200, result.status)
        self.assertEqual(3, len(transport.calls))

        permanent = FakeTransport({url: [response(404)]})
        result = collectors.fetch_bounded(url, transport=permanent, policy=policy, resolver=lambda h, p: ["93.184.216.34"])
        self.assertEqual(404, result.status)
        self.assertEqual(1, len(permanent.calls))

    def test_capture_and_receipt_hashes_are_immutable_and_schema_valid(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = collectors.CaptureStore(Path(tmp), "https://captures.invalid/sha256/")
            result = collectors.FetchResult(
                requested_url="https://example.com/benefits",
                final_url="https://example.com/benefits",
                url_chain=["https://example.com/benefits"],
                status=200,
                headers={"content-type": "text/html"},
                body=b"<title>Benefits</title>",
            )
            receipt, source = collectors.build_records(
                self.company,
                "leave",
                "official-company",
                '"company" leave',
                result,
                store,
                started_at="2026-11-01T01:00:00Z",
                completed_at="2026-11-01T01:00:01Z",
            )
            capture_path = Path(tmp) / receipt["raw_response_sha256"][:2] / (receipt["raw_response_sha256"] + ".json")
            self.assertTrue(capture_path.is_file())
            self.assertEqual(receipt["raw_response_sha256"], hashlib.sha256(capture_path.read_bytes()).hexdigest())
            payload = {key: value for key, value in receipt.items() if key != "receipt_content_sha256"}
            expected = hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            self.assertEqual(expected, receipt["receipt_content_sha256"])
            self.assertEqual("company-recruiting-media", receipt["route_id"])
            attempt_schema = json.loads((SCHEMA / "research-attempt.schema.json").read_text())
            source_schema = json.loads((SCHEMA / "source-v2.schema.json").read_text())
            self.assertEqual([], list(Draft202012Validator(attempt_schema, format_checker=FormatChecker()).iter_errors(receipt)))
            self.assertEqual([], list(Draft202012Validator(source_schema, format_checker=FormatChecker()).iter_errors(source)))
            self.assertEqual([self.company.canonical_legal_entity], source["scope"]["legal_entities"])
            self.assertEqual("unresolved", source["scope_status"])

    def test_capture_store_rejects_repo_paths_symlinks_and_special_files(self):
        with tempfile.TemporaryDirectory(dir=ROOT.parent) as tmp:
            external = Path(tmp)
            with self.assertRaises(collectors.SecurityError):
                collectors.CaptureStore(ROOT / "captures", "https://captures.invalid/sha256/", repository_root=ROOT)
            alias = external / "repo-alias"
            alias.symlink_to(ROOT, target_is_directory=True)
            with self.assertRaises(collectors.SecurityError):
                collectors.CaptureStore(alias / "captures", "https://captures.invalid/sha256/", repository_root=ROOT)

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "captures"
            store = collectors.CaptureStore(root, "https://captures.invalid/sha256/", repository_root=ROOT)
            raw = collectors._canonical_json({"safe": True})
            digest = hashlib.sha256(raw).hexdigest()
            directory = root / digest[:2]
            directory.mkdir()
            target = directory / f"{digest}.json"
            target.symlink_to(Path(tmp) / "outside")
            with self.assertRaises(collectors.CollectorError):
                store.put({"safe": True})
            target.unlink()
            os.mkfifo(target)
            with self.assertRaises(collectors.CollectorError):
                store.put({"safe": True})

    def test_capture_publication_is_no_replace_and_verifies_race_winner(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = collectors.CaptureStore(Path(tmp) / "captures", "https://captures.invalid/sha256/", repository_root=ROOT)
            value = {"safe": True}
            raw = collectors._canonical_json(value)
            digest = hashlib.sha256(raw).hexdigest()
            real_link = os.link

            def corrupt_winner(src, dst, **kwargs):
                directory_fd = kwargs["dst_dir_fd"]
                fd = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=directory_fd)
                os.write(fd, b"attacker")
                os.close(fd)
                raise FileExistsError(dst)

            with mock.patch.object(os, "link", side_effect=corrupt_winner):
                with self.assertRaises(collectors.CollectorError):
                    store.put(value)
            self.assertTrue(callable(real_link))

    def test_capture_store_rejects_secret_material_in_any_persisted_string(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = collectors.CaptureStore(Path(tmp) / "captures", "https://captures.invalid/sha256/", repository_root=ROOT)
            for value in (
                {"note": "Authorization: Bearer abc.def.ghi"},
                {"note": "api_key=super-secret-value"},
                {"nested": ["X-Amz-Signature=abcdef"]},
                {"x-amz-credential": "credential-value"},
            ):
                with self.subTest(value=value), self.assertRaises(collectors.SecurityError):
                    store.put(value)

    def test_capture_rejects_structured_and_signed_secrets_in_response_body(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = collectors.CaptureStore(Path(tmp) / "captures", "https://captures.invalid/sha256/", repository_root=ROOT)
            for body in (
                b'{"api_key":"super-secret-value"}',
                b'https://example.com/?sig=secret',
                b'https://example.com/?X-Goog-Signature=secret',
                b'<script>window.config = {"api_key":"super-secret-value"};</script>',
                b'<a href="https://example.com/?%73ig=abc123">link</a>',
            ):
                result = collectors.FetchResult(
                    requested_url="https://example.com/", final_url="https://example.com/",
                    url_chain=["https://example.com/"], status=200,
                    headers={"content-type": "application/json"}, body=body,
                )
                with self.subTest(body=body), self.assertRaises(collectors.SecurityError):
                    collectors.build_records(
                        self.company, "leave", "official-company", "query", result, store,
                        started_at="2026-11-01T01:00:00Z", completed_at="2026-11-01T01:00:01Z",
                    )

    def test_secure_directory_open_is_descriptor_relative_during_ancestor_swap(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            ancestor = base / "ancestor"
            target = ancestor / "target"
            outside = base / "outside"
            target.mkdir(parents=True)
            (outside / "target").mkdir(parents=True)
            real_open = os.open
            swapped = False

            def racing_open(path, flags, mode=0o777, *, dir_fd=None):
                nonlocal swapped
                descriptor = real_open(path, flags, mode, dir_fd=dir_fd)
                if path == "ancestor" and not swapped:
                    swapped = True
                    ancestor.rename(base / "ancestor-original")
                    ancestor.symlink_to(outside, target_is_directory=True)
                return descriptor

            with mock.patch.object(os, "open", racing_open):
                _, descriptor = collectors._prepare_secure_directory(target, collectors.SecurityError)
            try:
                self.assertEqual(
                    (base / "ancestor-original" / "target").resolve(),
                    Path(f"/proc/self/fd/{descriptor}").resolve(),
                )
            finally:
                os.close(descriptor)

    def test_secure_transport_total_timeout_bounds_header_trickle(self):
        class SlowConnection:
            sock = mock.Mock()
            sock.getpeername.return_value = ("93.184.216.34", 443)
            def __init__(self, *args, **kwargs): pass
            def connect(self): pass
            def request(self, *args, **kwargs): pass
            def getresponse(self):
                time.sleep(0.2)
                raise AssertionError("deadline worker should have been terminated")
            def close(self): pass

        started = time.monotonic()
        with mock.patch.object(collectors, "_PinnedHTTPSConnection", SlowConnection):
            with self.assertRaises(collectors.TransientFetchError):
                collectors.SecureHTTPTransport().request(
                    "https://example.com/", connect_timeout=1, read_timeout=1,
                    max_wire_bytes=100, total_timeout=0.02, resolved_ip="93.184.216.34",
                )
        self.assertLess(time.monotonic() - started, 0.15)

    def test_checkpoint_is_atomic_resumable_detects_corruption_and_never_persists_secrets(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "checkpoint.json"
            checkpoint = collectors.BatchCheckpoint(path, "a" * 64)
            checkpoint.record("attempt::one", {"result": "no_result", "authorization": "Bearer secret"})
            raw = path.read_text()
            self.assertNotIn("secret", raw)
            loaded = collectors.BatchCheckpoint(path, "a" * 64)
            self.assertIn("attempt::one", loaded.completed)
            parsed = json.loads(raw)
            parsed["completed"]["attempt::one"]["result"] = "source_found"
            path.write_text(json.dumps(parsed))
            with self.assertRaises(collectors.CheckpointError):
                collectors.BatchCheckpoint(path, "a" * 64)
            with self.assertRaises(collectors.CheckpointError):
                collectors.BatchCheckpoint(path, "b" * 64)

    def test_checkpoint_rejects_embedded_secrets_symlinks_special_files_and_traversal(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            checkpoint = collectors.BatchCheckpoint(base / "checkpoint.json", "a" * 64)
            for value in (
                {"note": "Bearer abc.def.ghi"},
                {"note": "x-api-key: secret-value"},
                {"url": "https://example.com/#access_token=secret"},
            ):
                with self.subTest(value=value), self.assertRaises(collectors.SecurityError):
                    checkpoint.record("attempt::secret", value)
            link = base / "link.json"
            link.symlink_to(base / "checkpoint.json")
            with self.assertRaises(collectors.CheckpointError):
                collectors.BatchCheckpoint(link, "a" * 64)
            fifo = base / "fifo.json"
            os.mkfifo(fifo)
            with self.assertRaises(collectors.CheckpointError):
                collectors.BatchCheckpoint(fifo, "a" * 64)
            with self.assertRaises(collectors.CheckpointError):
                collectors.BatchCheckpoint(base / "nested" / ".." / "escape.json", "a" * 64)

    def test_resume_rejects_rehashed_substituted_receipt_source_and_capture(self):
        with tempfile.TemporaryDirectory() as tmp:
            url = "https://example.com/benefits"
            items = [{"company": self.company, "category_id": "leave", "route_id": "official-company", "locator": url}]
            store = collectors.CaptureStore(Path(tmp) / "captures", "https://captures.invalid/sha256/", repository_root=ROOT)
            path = Path(tmp) / "checkpoint.json"
            checkpoint = collectors.BatchCheckpoint(path, collectors.batch_input_sha256(items))
            collectors.collect_batch(
                items, transport=FakeTransport({url: [response(200, b"benefits")]}), capture_store=store,
                checkpoint=checkpoint, resolver=lambda h, p: ["93.184.216.34"], now=lambda: "2026-11-01T01:00:00Z",
            )
            document = json.loads(path.read_text())
            entry = document["completed"][collectors.attempt_id(self.company.company_id, "leave", "official-company")]
            entry["receipt"]["company_id"] = "KR-CRN-attacker"
            entry["receipt"]["receipt_content_sha256"] = hashlib.sha256(collectors._canonical_json({
                key: value for key, value in entry["receipt"].items() if key != "receipt_content_sha256"
            })).hexdigest()
            unsigned = {key: value for key, value in document.items() if key != "checkpoint_sha256"}
            document["checkpoint_sha256"] = hashlib.sha256(collectors._canonical_json(unsigned)).hexdigest()
            path.write_text(json.dumps(document))
            resumed = collectors.BatchCheckpoint(path, collectors.batch_input_sha256(items))
            with self.assertRaises(collectors.CheckpointError):
                collectors.collect_batch(
                    items, transport=FakeTransport({}), capture_store=store, checkpoint=resumed,
                    resolver=lambda h, p: ["93.184.216.34"], now=lambda: "2026-11-01T01:00:00Z",
                )

    def test_resume_validates_schema_hash_source_and_canonical_capture_bindings(self):
        with tempfile.TemporaryDirectory() as tmp:
            url = "https://example.com/benefits"
            items = [{"company": self.company, "category_id": "leave", "route_id": "official-company", "locator": url}]
            store = collectors.CaptureStore(Path(tmp) / "captures", "https://captures.invalid/sha256/", repository_root=ROOT)
            checkpoint = collectors.BatchCheckpoint(Path(tmp) / "checkpoint.json", collectors.batch_input_sha256(items))
            collectors.collect_batch(
                items, transport=FakeTransport({url: [response(200, b"benefits")]}), capture_store=store,
                checkpoint=checkpoint, resolver=lambda h, p: ["93.184.216.34"], now=lambda: "2026-11-01T01:00:00Z",
            )
            key = collectors.attempt_id(self.company.company_id, "leave", "official-company")
            original = checkpoint.completed[key]
            query = collectors.canonical_query(self.company, "leave", "official-company")

            def validate(prior):
                return collectors._validate_resumed_entry(
                    prior, company=self.company, category_id="leave", route_id="official-company",
                    locator=url, query=query, capture_store=store,
                    resolver=lambda h, p: ["93.184.216.34"], policy=collectors.FetchPolicy(),
                )

            cases = []
            substituted_id = copy.deepcopy(original)
            substituted_id["receipt"]["attempt_id"] += "::other"
            cases.append(("attempt", substituted_id))
            bad_schema = copy.deepcopy(original)
            bad_schema["receipt"]["unexpected"] = True
            cases.append(("schema", bad_schema))
            bad_source = copy.deepcopy(original)
            bad_source["source"]["source_id"] = "source::substituted"
            cases.append(("source", bad_source))
            promoted_source = copy.deepcopy(original)
            promoted_source["source"].update({
                "publication_eligibility": "eligible", "reliability": "high",
                "currentness": "current", "scope_status": "exact_entity",
            })
            cases.append(("source review metadata", promoted_source))
            bad_query = copy.deepcopy(original)
            bad_query["receipt"]["query_or_locator"] = '"other company"'
            receipt = bad_query["receipt"]
            receipt["receipt_content_sha256"] = hashlib.sha256(collectors._canonical_json({
                key: value for key, value in receipt.items() if key != "receipt_content_sha256"
            })).hexdigest()
            cases.append(("canonical request", bad_query))
            bad_capture = copy.deepcopy(original)
            capture = store.read(bad_capture["receipt"]["raw_response_sha256"])
            capture["query_or_locator"] = '"other company"'
            digest, locator = store.put(capture)
            bad_capture["receipt"]["raw_response_sha256"] = digest
            bad_capture["receipt"]["capture_locator"] = locator
            receipt = bad_capture["receipt"]
            receipt["receipt_content_sha256"] = hashlib.sha256(collectors._canonical_json({
                key: value for key, value in receipt.items() if key != "receipt_content_sha256"
            })).hexdigest()
            cases.append(("capture", bad_capture))
            for label, prior in cases:
                with self.subTest(binding=label), self.assertRaises(collectors.CheckpointError):
                    validate(prior)

    def test_batch_emits_only_actual_attempts_and_never_synthesizes_no_public_info(self):
        with tempfile.TemporaryDirectory() as tmp:
            url = "https://example.com/benefits"
            package = collectors.collect_batch(
                [{
                    "company": self.company,
                    "category_id": "leave",
                    "route_id": "official-company",
                    "locator": url,
                }],
                transport=FakeTransport({url: [response(404, b"missing")]}),
                capture_store=collectors.CaptureStore(Path(tmp) / "captures", "https://captures.invalid/sha256/"),
                checkpoint=collectors.BatchCheckpoint(Path(tmp) / "checkpoint.json", collectors.batch_input_sha256([{
                    "company": self.company,
                    "category_id": "leave",
                    "route_id": "official-company",
                    "locator": url,
                }])),
                resolver=lambda h, p: ["93.184.216.34"],
                now=lambda: "2026-11-01T01:00:00Z",
            )
            self.assertEqual("company-benefits-collector-discovery", package["artifact_type"])
            self.assertEqual("no_result", package["attempts"][0]["result"])
            self.assertNotIn("no_public_info", json.dumps(package))

    def test_discovery_artifact_has_schema_and_requires_cell_decisions_before_package_conversion(self):
        with tempfile.TemporaryDirectory() as tmp:
            url = "https://example.com/benefits"
            items = [{"company": self.company, "category_id": "leave", "route_id": "official-company", "locator": url}]
            artifact = collectors.collect_batch(
                items, transport=FakeTransport({url: [response(404)]}),
                capture_store=collectors.CaptureStore(Path(tmp) / "captures", "https://captures.invalid/sha256/", repository_root=ROOT),
                checkpoint=collectors.BatchCheckpoint(Path(tmp) / "checkpoint.json", collectors.batch_input_sha256(items)),
                resolver=lambda h, p: ["93.184.216.34"], now=lambda: "2026-11-01T01:00:00Z",
            )
            schema = json.loads((SCHEMA / "collector-discovery-artifact.schema.json").read_text())
            self.assertEqual([], list(Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(artifact)))
            with self.assertRaises(collectors.CollectorError):
                collectors.discovery_to_review_package(artifact, [])
            attempt = artifact["attempts"][0]
            cell = {
                "cell_id": attempt["cell_id"], "company_id": attempt["company_id"],
                "category_id": attempt["category_id"], "attempt_ids": [attempt["attempt_id"]],
            }
            package = collectors.discovery_to_review_package(artifact, [cell])
            self.assertEqual([cell], package["cells"])
            self.assertNotIn("artifact_type", package)
            wrong_scope = {**cell, "company_id": "KR-CRN-attacker"}
            with self.assertRaises(collectors.CollectorError):
                collectors.discovery_to_review_package(artifact, [wrong_scope])

    def test_dns_and_total_deadlines_fail_closed_deterministically(self):
        url = "https://example.com/"
        started = time.monotonic()
        with self.assertRaises(collectors.TransientFetchError):
            collectors.validate_public_https_url(
                url, resolver=lambda h, p: (time.sleep(0.2), ["93.184.216.34"])[1], dns_timeout=0.02,
            )
        self.assertLess(time.monotonic() - started, 0.15)

        class Clock:
            value = 0.0
            def __call__(self):
                return self.value

        clock = Clock()

        class TrickleTransport:
            def request(self, requested_url, **kwargs):
                clock.value += 2.0
                return response(200)

        with self.assertRaises(collectors.FetchError):
            collectors.fetch_bounded(
                url, transport=TrickleTransport(),
                policy=collectors.FetchPolicy(retries=0, total_timeout=1.0, dns_timeout=0.1),
                resolver=lambda h, p: ["93.184.216.34"], monotonic=clock,
            )

    def test_batch_rejects_adapters_that_alias_the_same_policy_route(self):
        with tempfile.TemporaryDirectory() as tmp:
            items = [
                {
                    "company": self.company,
                    "category_id": "leave",
                    "route_id": route,
                    "locator": "https://example.com/benefits",
                }
                for route in ("official-company", "company-recruiting-media")
            ]
            with self.assertRaises(collectors.CollectorError):
                collectors.collect_batch(
                    items,
                    transport=FakeTransport({"https://example.com/benefits": [response(404)]}),
                    capture_store=collectors.CaptureStore(Path(tmp) / "captures", "https://captures.invalid/sha256/"),
                    checkpoint=collectors.BatchCheckpoint(Path(tmp) / "checkpoint.json", collectors.batch_input_sha256(items)),
                    resolver=lambda h, p: ["93.184.216.34"],
                    now=lambda: "2026-11-01T01:00:00Z",
                )

    def test_cli_exposes_bounded_collection_inputs(self):
        completed = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "collect-company-benefits-v2.py"), "--help"],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(0, completed.returncode, completed.stderr)
        self.assertIn("--capture-root", completed.stdout)
        self.assertIn("--checkpoint", completed.stdout)
        self.assertIn("--max-response-bytes", completed.stdout)
        self.assertIn("--dns-timeout", completed.stdout)
        self.assertIn("--total-timeout", completed.stdout)
        self.assertIn("discovery artifact", completed.stdout.lower())


if __name__ == "__main__":
    unittest.main()
