import gzip
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

from scripts import company_benefits_collectors as collectors


ROOT = Path(__file__).resolve().parents[2]
SCHEMA = ROOT / "docs" / "research" / "company-benefits" / "schema"


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
            self.assertEqual([], package["cells"])
            self.assertEqual([], package["official_claims"])
            self.assertEqual([], package["references"])
            self.assertEqual([], package["community_reports"])
            self.assertEqual("no_result", package["attempts"][0]["result"])
            self.assertNotIn("no_public_info", json.dumps(package))

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


if __name__ == "__main__":
    unittest.main()
