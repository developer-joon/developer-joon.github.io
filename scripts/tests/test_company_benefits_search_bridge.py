import base64
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator

from scripts import company_benefits_search_bridge as bridge


ROOT = Path(__file__).resolve().parents[2]
SCHEMA = ROOT / "docs" / "research" / "company-benefits" / "schema"
PUBLIC = lambda host, port: ["93.184.216.34"]


class SearchBridgeTests(unittest.TestCase):
    @staticmethod
    def _manifest(max_results=20):
        return bridge.finalize_manifest({
            "artifact_type": "company-benefits-search-query-manifest",
            "format_version": 1,
            "created_at": "2026-11-02T00:00:00Z",
            "source_requests_sha256": "a" * 64,
            "entry_count": 1,
            "entries": [{
                "query_id": "search-query::c-one::leave::other-public-web",
                "company_id": "c-one", "category_id": "leave", "jurisdiction": "KR",
                "route_id": "other-public-web", "route_kind": "other_public_web",
                "query_or_locator": "q", "tool_name": "web_search",
                "max_results": max_results, "authoritative_use_prohibited": True,
            }],
        })

    @staticmethod
    def _complete_receipt(query_id, *, retained=0, dropped=0, reasons=None):
        receipt = {
            "artifact_type": "company-benefits-search-tool-acquisition",
            "format_version": 2,
            "query_manifest_sha256": "a" * 64,
            "query_id": query_id,
            "tool_name": "web_search",
            "recorded_at": "2026-11-02T00:01:00Z",
            "raw_tool_response_sha256": "b" * 64,
            "capture_sha256": "c" * 64,
            "capture_locator": "https://captures.example/sha256/c",
            "validated_result_count": retained,
            "acquisition_status": "complete_with_omissions",
            "total_result_count": retained + dropped,
            "retained_result_count": retained,
            "dropped_result_count": dropped,
            "omission_reason_totals": reasons or {},
            "review_status": "review_pending",
            "authoritative_receipts_created": False,
        }
        receipt["artifact_content_sha256"] = bridge.content_hash_without(
            receipt, "artifact_content_sha256"
        )
        return receipt

    def test_korean_query_plan_uses_safe_aliases_local_terms_and_no_crn(self):
        company = bridge.CompanyAuthority(
            company_id="KR-CRN-1101112948086", jurisdiction="KR",
            legal_name="(주)인텔리안테크놀로지스",
            canonical_legal_entity="(주)인텔리안테크놀로지스",
        )
        companies = {company.company_id: company}

        entries = bridge.plan_company_queries(company, companies)

        broad = [entry for entry in entries if entry["query_stage"] == "broad-discovery"]
        gaps = [entry for entry in entries if entry["query_stage"] == "category-gap"]
        self.assertEqual(3, len(broad))
        self.assertEqual(30, len(gaps))
        self.assertEqual(
            ["(주)인텔리안테크놀로지스", "인텔리안테크놀로지스"],
            broad[0]["search_aliases"],
        )
        self.assertTrue(all(company.company_id not in entry["query_or_locator"] for entry in entries))
        self.assertTrue(all(" OR " not in entry["query_or_locator"] for entry in entries))
        leave = next(
            entry for entry in gaps
            if entry["category_id"] == "leave" and entry["route_id"] == "company-recruiting-media"
        )
        self.assertIn('"인텔리안테크놀로지스"', leave["query_or_locator"])
        self.assertIn("휴가", leave["query_or_locator"])
        self.assertIn("채용", leave["query_or_locator"])
        self.assertIn("복리후생", leave["query_or_locator"])
        self.assertEqual("deferred", leave["execution_status"])
        self.assertEqual(company.company_id, leave["company_id"])

    def test_alias_collisions_are_not_used_as_cross_entity_shortcuts(self):
        first = bridge.CompanyAuthority("c-one", "KR", "(주)한빛", "(주)한빛")
        second = bridge.CompanyAuthority("c-two", "KR", "한빛 주식회사", "한빛 주식회사")
        companies = {first.company_id: first, second.company_id: second}

        self.assertEqual(("(주)한빛",), bridge.safe_search_aliases(first, companies))
        self.assertEqual(("한빛 주식회사",), bridge.safe_search_aliases(second, companies))
        with self.assertRaisesRegex(bridge.CollectorError, "canonical legal name collision"):
            bridge.safe_search_aliases(
                first, {first.company_id: first, "c-three": bridge.CompanyAuthority("c-three", "KR", "(주)한빛", "(주)한빛")}
            )

    def test_split_units_are_disjoint_and_cover_25_companies_and_250_cells(self):
        companies = {
            f"c-{number:02d}": bridge.CompanyAuthority(
                f"c-{number:02d}", "KR", f"(주)회사{number:02d}", f"(주)회사{number:02d}"
            )
            for number in range(25)
        }
        manifests = bridge.build_split_manifests(
            companies, list(companies), batch_id="domestic-01",
            source_requests_sha256="a" * 64, created_at="2026-11-02T00:00:00Z",
        )

        summary = bridge.validate_split_manifests(manifests, list(companies))

        self.assertEqual(5, len(manifests))
        self.assertTrue(all(manifest["company_count"] == 5 for manifest in manifests))
        self.assertTrue(all(manifest["cell_count"] == 50 for manifest in manifests))
        self.assertTrue(all(manifest["broad_query_count"] == 15 for manifest in manifests))
        self.assertTrue(all(manifest["deferred_query_count"] == 150 for manifest in manifests))
        self.assertEqual({"company_count": 25, "cell_count": 250, "unit_count": 5}, summary)
        duplicate = [dict(manifest) for manifest in manifests]
        duplicate[1] = dict(duplicate[1], company_ids=list(duplicate[0]["company_ids"]))
        with self.assertRaisesRegex(bridge.CollectorError, "duplicate company ownership"):
            bridge.validate_split_manifests(duplicate, list(companies))

    def test_no_public_info_coverage_ignores_broad_receipts_and_requires_each_gap_route(self):
        company = bridge.CompanyAuthority("c-one", "KR", "(주)한빛", "(주)한빛")
        entries = bridge.plan_company_queries(company, {company.company_id: company})
        broad_ids = [entry["query_id"] for entry in entries if entry["query_stage"] == "broad-discovery"]
        leave_ids = [
            entry["query_id"] for entry in entries
            if entry["query_stage"] == "category-gap" and entry["category_id"] == "leave"
        ]
        with self.assertRaisesRegex(bridge.CollectorError, "incomplete category-specific route receipts"):
            bridge.validate_no_public_info_coverage(entries, broad_ids + leave_ids[:2], "c-one", "leave")
        bridge.validate_no_public_info_coverage(entries, broad_ids + leave_ids, "c-one", "leave")

    def test_ingest_retains_backend_query_time_and_explicit_result_order_as_unreviewed(self):
        company = bridge.CompanyAuthority("c-one", "KR", "(주)한빛", "(주)한빛")
        entry = bridge.plan_company_queries(company, {company.company_id: company})[0]
        manifest = bridge.finalize_manifest({
            "artifact_type": "company-benefits-search-query-manifest",
            "format_version": 2,
            "created_at": "2026-11-02T00:00:00Z",
            "source_requests_sha256": "a" * 64,
            "entry_count": 1,
            "entries": [entry],
        })
        raw = json.dumps({
            "backend": "test-backend", "served_by": "test-node",
            "data": {"web": [
                {"url": "https://example.com/2", "title": "둘째", "description": "복지"},
                {"url": "https://example.com/1", "title": "첫째", "description": "채용"},
            ]},
        }, ensure_ascii=False).encode()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "captures"
            index = bridge.ingest_tool_response(
                manifest, entry["query_id"], raw, capture_root=root,
                capture_base_url="https://captures.example/sha256/",
                recorded_at="2026-11-02T00:01:00Z", resolver=PUBLIC,
            )
            capture_path = root / index["capture_sha256"][:2] / f'{index["capture_sha256"]}.json'
            capture = json.loads(capture_path.read_text(encoding="utf-8"))
        self.assertEqual("test-backend", capture["response_metadata"]["backend"])
        self.assertEqual("test-node", capture["response_metadata"]["served_by"])
        self.assertEqual(entry["query_or_locator"], capture["executed_query"])
        self.assertEqual("2026-11-02T00:01:00Z", capture["retrieved_at"])
        self.assertEqual([1, 2], [result["result_order"] for result in capture["validated_results"]])
        self.assertTrue(all(result["review_status"] == "unreviewed_lead" for result in capture["validated_results"]))
        self.assertFalse(index["authoritative_receipts_created"])

    def test_ingest_rejects_v2_localized_query_semantic_tampering(self):
        company = bridge.CompanyAuthority("c-one", "KR", "(주)한빛", "(주)한빛")
        entry = dict(bridge.plan_company_queries(company, {company.company_id: company})[0])
        entry["query_or_locator"] = '"한빛" "c-one" benefits'
        manifest = bridge.finalize_manifest({
            "artifact_type": "company-benefits-search-query-manifest",
            "format_version": 2,
            "created_at": "2026-11-02T00:00:00Z",
            "source_requests_sha256": "a" * 64,
            "entry_count": 1,
            "entries": [entry],
        })
        with tempfile.TemporaryDirectory() as tmp, self.assertRaisesRegex(
            bridge.CollectorError, "localized query semantics"
        ):
            bridge.ingest_tool_response(
                manifest, entry["query_id"], b'{"data":{"web":[]}}',
                capture_root=Path(tmp) / "captures",
                capture_base_url="https://captures.example/sha256/",
                recorded_at="2026-11-02T00:01:00Z", resolver=PUBLIC,
            )

    def test_manifest_preserves_canonical_route_ids_and_exact_queries(self):
        queries = {
            route_id: bridge._localized_query("인텔리안테크놀로지스", route_id, "leave")
            for route_id in bridge.SEARCH_ROUTES
        }
        rows = [{
            "company_id": "KR-CRN-1101112948086",
            "category_id": "leave",
            "route_ids": [
                "official-government",
                "company-recruiting-media",
                "other-public-web",
            ],
            "locators": {
                route_id: "https://search.example/?q=" + bridge.urllib.parse.quote_plus(query)
                for route_id, query in queries.items()
            },
        }]
        companies = {
            "KR-CRN-1101112948086": bridge.CompanyAuthority(
                company_id="KR-CRN-1101112948086",
                jurisdiction="KR",
                legal_name="(주)인텔리안테크놀로지스",
                canonical_legal_entity="(주)인텔리안테크놀로지스",
            )
        }

        manifest = bridge.build_query_manifest(
            rows, companies, source_requests_sha256="a" * 64,
            created_at="2026-11-02T00:00:00Z",
        )

        self.assertEqual(3, manifest["entry_count"])
        self.assertEqual(
            ["official-government", "company-recruiting-media", "other-public-web"],
            [entry["route_id"] for entry in manifest["entries"]],
        )
        self.assertTrue(all(entry["query_id"].startswith("search-query::") for entry in manifest["entries"]))
        self.assertEqual(
            '"인텔리안테크놀로지스" 휴가 연차 특별휴가 공식 회사 채용 정부',
            manifest["entries"][0]["query_or_locator"],
        )
        self.assertTrue(all(entry["authoritative_use_prohibited"] for entry in manifest["entries"]))
        self.assertEqual(
            bridge.content_hash_without(manifest, "artifact_content_sha256"),
            manifest["artifact_content_sha256"],
        )

    def test_manifest_rejects_a_locator_whose_query_semantics_drifted(self):
        company = bridge.CompanyAuthority(
            company_id="KR-CRN-1101112948086", jurisdiction="KR",
            legal_name="Example", canonical_legal_entity="Example",
        )
        rows = [{
            "company_id": company.company_id,
            "category_id": "leave",
            "route_ids": ["other-public-web"],
            "locators": {"other-public-web": "https://search.example/?q=changed"},
        }]
        with self.assertRaisesRegex(bridge.CollectorError, "query semantics"):
            bridge.build_query_manifest(
                rows, {company.company_id: company},
                source_requests_sha256="a" * 64,
                created_at="2026-11-02T00:00:00Z",
            )

    def test_ingest_writes_exact_raw_response_to_immutable_capture_without_receipts(self):
        entry = {
            "query_id": "search-query::KR-CRN-1101112948086::leave::other-public-web",
            "company_id": "KR-CRN-1101112948086",
            "category_id": "leave",
            "jurisdiction": "KR",
            "route_id": "other-public-web",
            "route_kind": "other_public_web",
            "query_or_locator": '"Example" "KR-CRN-1101112948086" "leave" "benefits"',
            "tool_name": "web_search",
            "max_results": 5,
            "authoritative_use_prohibited": True,
        }
        manifest = bridge.finalize_manifest({
            "artifact_type": "company-benefits-search-query-manifest",
            "format_version": 1,
            "created_at": "2026-11-02T00:00:00Z",
            "source_requests_sha256": "a" * 64,
            "entry_count": 1,
            "entries": [entry],
        })
        raw = b'{"data":{"web":[{"url":"https://example.com/benefits","title":"Benefits","description":"Paid leave overview"}]}}\n'
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "captures"
            index = bridge.ingest_tool_response(
                manifest, entry["query_id"], raw,
                capture_root=root,
                capture_base_url="https://captures.example/sha256/",
                recorded_at="2026-11-02T00:01:00Z",
                resolver=PUBLIC,
            )
            capture_path = root / index["capture_sha256"][:2] / f'{index["capture_sha256"]}.json'
            capture = json.loads(capture_path.read_text(encoding="utf-8"))

        self.assertEqual("review_pending", index["review_status"])
        self.assertFalse(index["authoritative_receipts_created"])
        self.assertNotIn("result", index)
        self.assertNotIn("source_ids", index)
        self.assertEqual(hashlib.sha256(raw).hexdigest(), index["raw_tool_response_sha256"])
        self.assertEqual(raw, base64.b64decode(capture["raw_tool_response_base64"]))
        self.assertEqual(index["raw_tool_response_sha256"], capture["raw_tool_response_sha256"])
        self.assertEqual("https://example.com/benefits", capture["validated_results"][0]["url"])

    def test_ingest_rejects_response_level_secrets_oversized_and_excess_result_payloads(self):
        manifest = self._manifest(max_results=1)
        cases = [
            b'{"data":{"web":[{"url":"https://example.com","title":"token=secret","description":"x"}]}}',
            json.dumps({"data": {"web": [
                {"url": "https://example.com/a", "title": "a", "description": "a"},
                {"url": "https://example.com/b", "title": "b", "description": "b"},
            ]}}).encode(),
            b"x" * (bridge.MAX_RAW_TOOL_RESPONSE_BYTES + 1),
            b'{"tool_error":"backend unavailable"}',
            b'{"data":{"web":',
        ]
        with tempfile.TemporaryDirectory() as tmp:
            for raw in cases:
                with self.subTest(raw=raw[:80]), self.assertRaises(bridge.CollectorError):
                    bridge.ingest_tool_response(
                        manifest, manifest["entries"][0]["query_id"], raw,
                        capture_root=Path(tmp) / hashlib.sha256(raw).hexdigest(),
                        capture_base_url="https://captures.example/sha256/",
                        recorded_at="2026-11-02T00:01:00Z", resolver=PUBLIC,
                    )

    def test_ingest_retains_safe_leads_and_records_per_result_omissions(self):
        manifest = self._manifest()
        credential = "https://user:do-not-persist@example.com/private"
        raw_value = {"data": {"web": [
            {"position": 1, "url": "https://example.com/safe", "title": "safe", "description": "lead"},
            {"position": 2, "url": "http://example.com/plain", "title": "http", "description": "drop"},
            {"position": 3, "url": credential, "title": "credential", "description": "drop"},
            {"position": 4, "url": "https://127.0.0.1/private", "title": "private", "description": "drop"},
            {"position": 5, "url": "https://[broken", "title": "malformed", "description": "drop"},
            {"position": 6, "url": "https://example.com/long", "title": "x" * 501, "description": "drop"},
        ]}}
        raw = json.dumps(raw_value, separators=(",", ":")).encode()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "captures"
            acquisition = bridge.ingest_tool_response(
                manifest, manifest["entries"][0]["query_id"], raw,
                capture_root=root, capture_base_url="https://captures.example/sha256/",
                recorded_at="2026-11-02T00:01:00Z", resolver=PUBLIC,
            )
            capture_path = root / acquisition["capture_sha256"][:2] / f'{acquisition["capture_sha256"]}.json'
            capture = json.loads(capture_path.read_text(encoding="utf-8"))

        self.assertEqual("complete_with_omissions", acquisition["acquisition_status"])
        self.assertEqual((6, 1, 5), (
            acquisition["total_result_count"], acquisition["retained_result_count"],
            acquisition["dropped_result_count"],
        ))
        self.assertEqual([1], [item["result_order"] for item in capture["validated_results"]])
        self.assertEqual(
            {"credential_like_url": 1, "malformed_url": 1, "non_https_url": 1,
             "private_url": 1, "title_out_of_bounds": 1},
            acquisition["omission_reason_totals"],
        )
        self.assertEqual([2, 3, 4, 5, 6], [item["original_position"] for item in capture["omitted_results"]])
        public_bytes = json.dumps(acquisition, sort_keys=True).encode()
        self.assertNotIn(b"do-not-persist", public_bytes)
        self.assertNotIn(credential.encode(), json.dumps(capture["omitted_results"], sort_keys=True).encode())
        self.assertEqual(raw, base64.b64decode(capture["raw_tool_response_base64"]))

    def test_ingest_drops_duplicate_positions_and_all_dropped_is_still_complete(self):
        manifest = self._manifest()
        raw = json.dumps({"data": {"web": [
            {"position": 1, "url": "http://example.com/one", "title": "one", "description": ""},
            {"position": 1, "url": "https://example.com/two", "title": "two", "description": ""},
        ]}}, separators=(",", ":")).encode()
        with tempfile.TemporaryDirectory() as tmp:
            acquisition = bridge.ingest_tool_response(
                manifest, manifest["entries"][0]["query_id"], raw,
                capture_root=Path(tmp) / "captures",
                capture_base_url="https://captures.example/sha256/",
                recorded_at="2026-11-02T00:01:00Z", resolver=PUBLIC,
            )
        self.assertEqual("complete_with_omissions", acquisition["acquisition_status"])
        self.assertEqual(0, acquisition["retained_result_count"])
        self.assertEqual(2, acquisition["dropped_result_count"])
        self.assertEqual({"duplicate_position": 2}, acquisition["omission_reason_totals"])
        self.assertNotIn("result", acquisition)

    def test_ingest_v2_hashes_are_deterministic(self):
        manifest = self._manifest()
        raw = b'{"data":{"web":[{"position":1,"url":"http://example.com/x","title":"x","description":""}]}}'
        indexes = []
        with tempfile.TemporaryDirectory() as tmp:
            for suffix in ("one", "two"):
                indexes.append(bridge.ingest_tool_response(
                    manifest, manifest["entries"][0]["query_id"], raw,
                    capture_root=Path(tmp) / suffix,
                    capture_base_url="https://captures.example/sha256/",
                    recorded_at="2026-11-02T00:01:00Z", resolver=PUBLIC,
                ))
        self.assertEqual(indexes[0], indexes[1])

    def test_ingest_direct_public_page_binds_locator_cell_route_and_exact_response(self):
        locator = "https://www.teamblind.com/kr/company/example/review/XZ7yK9vq6"
        raw = json.dumps({"results": [{
            "url": locator,
            "title": "유연근무 시행",
            "content": "인텔리안테크놀로지스\n유연근무 시행\nVerified User\n현직원",
            "error": None,
        }]}, ensure_ascii=False, separators=(",", ":")).encode()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "captures"
            receipt = bridge.ingest_direct_page_response(
                locator, raw,
                company_id="KR-CRN-1101112948086", category_id="remote",
                route_id="community-review", tool_name="web_extract",
                backend="hermes-web-extract", recorded_at="2026-11-02T04:00:00Z",
                capture_root=root,
                capture_base_url="https://captures.example/direct/sha256/",
                resolver=PUBLIC,
            )
            capture_sha256 = str(receipt["capture_sha256"])
            capture_path = root / capture_sha256[:2] / f"{capture_sha256}.json"
            capture = json.loads(capture_path.read_text(encoding="utf-8"))
        direct_result = receipt["result"]
        self.assertIsInstance(direct_result, dict)
        assert isinstance(direct_result, dict)

        self.assertEqual("company-benefits-direct-page-acquisition", receipt["artifact_type"])
        self.assertEqual(2, receipt["format_version"])
        self.assertEqual("complete", receipt["acquisition_status"])
        self.assertEqual("cell::KR-CRN-1101112948086::remote", receipt["cell_id"])
        self.assertEqual("community-review", receipt["route_id"])
        self.assertEqual(locator, receipt["locator"])
        self.assertEqual("direct_source", direct_result["kind"])
        self.assertEqual("unreviewed_lead", direct_result["review_status"])
        self.assertEqual("review_pending", receipt["review_status"])
        self.assertFalse(receipt["authoritative_receipts_created"])
        self.assertEqual(hashlib.sha256(raw).hexdigest(), receipt["raw_tool_response_sha256"])
        self.assertEqual(raw, base64.b64decode(capture["raw_tool_response_base64"]))
        self.assertEqual("hermes-web-extract", capture["backend"])

    def test_ingest_direct_public_page_rejects_mismatched_private_secret_and_oversized_content(self):
        locator = "https://example.com/review/one"
        base = {"results": [{"url": locator, "title": "title", "content": "body", "error": None}]}
        cases = [
            {"results": [{**base["results"][0], "url": "https://example.com/review/two"}]},
            {"results": [{**base["results"][0], "url": "https://127.0.0.1/private"}]},
            {"results": [{**base["results"][0], "content": "api_key=do-not-store"}]},
            {"results": [{**base["results"][0], "content": "x" * (bridge.MAX_DIRECT_CONTENT_CHARS + 1)}]},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            for value in cases:
                raw = json.dumps(value, separators=(",", ":")).encode()
                with self.subTest(value=str(value)[:100]), self.assertRaises(bridge.CollectorError):
                    bridge.ingest_direct_page_response(
                        locator, raw, company_id="c", category_id="remote",
                        route_id="community-review", tool_name="web_extract",
                        backend="test", recorded_at="2026-11-02T04:00:00Z",
                        capture_root=Path(tmp) / hashlib.sha256(raw).hexdigest(),
                        capture_base_url="https://captures.example/direct/sha256/",
                        resolver=PUBLIC,
                    )

    def test_reconcile_executed_routes_accepts_complete_zero_lead_receipts_and_lists_failures(self):
        acquisitions = [
            self._complete_receipt("search-query::c::leave::official-government"),
            self._complete_receipt("search-query::c::leave::company-recruiting-media"),
        ]
        summary = bridge.reconcile_executed_routes(
            [item["query_id"] for item in acquisitions] + ["search-query::c::leave::other-public-web"],
            acquisitions,
            {"search-query::c::leave::other-public-web": "tool_error"},
        )
        self.assertEqual(3, summary["executed_route_count"])
        self.assertEqual(2, summary["complete_receipt_count"])
        self.assertEqual(
            [{"query_id": "search-query::c::leave::other-public-web", "reason_code": "tool_error"}],
            summary["true_tool_failures"],
        )
        self.assertEqual("complete_with_tool_failures", summary["status"])

    def test_reconcile_rejects_tampered_receipt_counts(self):
        receipt = self._complete_receipt(
            "search-query::c::leave::official-government",
            retained=1, dropped=1, reasons={"non_https_url": 1},
        )
        receipt["total_result_count"] = 1
        receipt["artifact_content_sha256"] = bridge.content_hash_without(
            receipt, "artifact_content_sha256"
        )
        with self.assertRaisesRegex(bridge.CollectorError, "count mismatch"):
            bridge.reconcile_executed_routes([receipt["query_id"]], [receipt], {})

    def test_bounded_input_reader_rejects_oversize_and_symlink_inputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            oversized = root / "oversized.json"
            oversized.write_bytes(b"x" * 11)
            with self.assertRaisesRegex(bridge.CollectorError, "byte bound"):
                bridge._read_bytes(oversized, 10)
            target = root / "target.json"
            target.write_bytes(b"{}")
            linked = root / "linked.json"
            linked.symlink_to(target)
            with self.assertRaisesRegex(bridge.CollectorError, "regular file"):
                bridge._read_bytes(linked, 10)

    def test_bridge_schemas_exist_and_forbid_authoritative_fields(self):
        names = [
            "search-acquisition-query-manifest.schema.json",
            "search-tool-acquisition.schema.json",
            "direct-page-acquisition.schema.json",
        ]
        for name in names:
            schema = json.loads((SCHEMA / name).read_text(encoding="utf-8"))
            Draft202012Validator.check_schema(schema)
        acquisition = json.loads((SCHEMA / names[1]).read_text(encoding="utf-8"))
        valid = {
            "artifact_type": "company-benefits-search-tool-acquisition",
            "format_version": 1,
            "query_manifest_sha256": "a" * 64,
            "query_id": "search-query::c::leave::other-public-web",
            "tool_name": "web_search",
            "recorded_at": "2026-11-02T00:01:00Z",
            "raw_tool_response_sha256": "b" * 64,
            "capture_sha256": "c" * 64,
            "capture_locator": "https://captures.example/sha256/c",
            "validated_result_count": 1,
            "review_status": "review_pending",
            "authoritative_receipts_created": False,
            "artifact_content_sha256": "d" * 64,
        }
        self.assertFalse(list(Draft202012Validator(acquisition).iter_errors(valid)))
        self.assertTrue(list(Draft202012Validator(acquisition).iter_errors({**valid, "result": "source_found"})))

    def test_ingest_rejects_manifest_count_or_scope_binding_tampering(self):
        base = {
            "artifact_type": "company-benefits-search-query-manifest",
            "format_version": 1,
            "created_at": "2026-11-02T00:00:00Z",
            "source_requests_sha256": "a" * 64,
            "entry_count": 1,
            "entries": [{
                "query_id": "search-query::c::leave::other-public-web",
                "company_id": "c", "category_id": "leave", "jurisdiction": "KR",
                "route_id": "other-public-web", "route_kind": "other_public_web",
                "query_or_locator": "q", "tool_name": "web_search", "max_results": 1,
                "authoritative_use_prohibited": True,
            }],
        }
        raw = b'{"data":{"web":[]}}'
        for mutation in (
            {**base, "entry_count": 2},
            {**base, "entries": [{**base["entries"][0], "query_id": "search-query::other::leave::other-public-web"}]},
        ):
            manifest = bridge.finalize_manifest(mutation)
            with tempfile.TemporaryDirectory() as tmp, self.assertRaises(bridge.CollectorError):
                bridge.ingest_tool_response(
                    manifest, manifest["entries"][0]["query_id"], raw,
                    capture_root=Path(tmp) / "captures",
                    capture_base_url="https://captures.example/sha256/",
                    recorded_at="2026-11-02T00:01:00Z", resolver=PUBLIC,
                )


if __name__ == "__main__":
    unittest.main()
