import hashlib
import importlib.util
import json
import stat
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "normalize-company-benefits-reviewed-unit.py"
spec = importlib.util.spec_from_file_location("benefits_normalizer", SCRIPT)
assert spec is not None and spec.loader is not None
normalizer = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = normalizer
spec.loader.exec_module(normalizer)


def digest(payload):
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def attempt(company, category, route, sources=()):
    item = {
        "attempt_id": f"attempt::{company}::{category}::{route}",
        "cell_id": f"cell::{company}::{category}",
        "company_id": company,
        "category_id": category,
        "jurisdiction": "KR",
        "coverage_policy_id": "coverage-policy-v2",
        "route_id": route,
        "route_kind": {
            "official-government": "official_government",
            "company-recruiting-media": "company_recruiting_major_media",
            "other-public-web": "other_public_web",
        }[route],
        "query_or_locator": f"search-query::{company}::{category}::{route}",
        "started_at": "2026-11-01T00:00:00Z",
        "completed_at": "2026-11-01T00:00:00Z",
        "result": "source_found" if sources else "no_result",
        "source_ids": list(sources),
        "raw_response_sha256": "0" * 64,
        "capture_locator": "relative/capture.json",
        "collector_version": "test/1",
        "receipt_content_sha256": "bad",
    }
    return item


def cell(company, category, attempts, state="no_public_info", source_id=None):
    return {
        "cell_id": f"cell::{company}::{category}",
        "company_id": company,
        "category_id": category,
        "jurisdiction": "KR",
        "state": state,
        "coverage_policy_id": "coverage-policy-v2",
        "attempt_ids": [item["attempt_id"] for item in attempts],
        "official_claim_ids": [],
        "reference_ids": [] if source_id is None else [f"reference::{company}::{category}::{source_id}"],
        "community_report_ids": [],
        "reliability": "none" if state == "no_public_info" else "medium",
        "currentness": "unknown" if state == "no_public_info" else "current",
        "scope_status": "unresolved" if state == "no_public_info" else "exact_entity",
        "conflict_status": "none",
        "publication_eligibility": "discovery_only" if state == "no_public_info" else "reference_only",
        "assessed_at": "2026-11-01T00:00:00Z",
    }


class NormalizePayloadTests(unittest.TestCase):
    def test_repairs_hash_locator_order_and_strips_unknown_fields(self):
        companies = ["company-b", "company-a"]
        routes = ["official-government", "company-recruiting-media", "other-public-web"]
        attempts = [attempt(c, cat, route) for c in reversed(companies) for cat in ["family", "leave"] for route in reversed(routes)]
        cells = [cell(c, cat, [a for a in attempts if a["company_id"] == c and a["category_id"] == cat]) for c in reversed(companies) for cat in ["family", "leave"]]
        package = {"coverage_policy": {}, "cells": cells, "attempts": attempts, "official_claims": [], "references": [], "community_reports": [], "sources": [], "wrapper": True}
        package["attempts"][0]["wrapper"] = True

        result = normalizer.normalize_payload(package, companies, ["leave", "family"], routes)

        self.assertEqual([(c["company_id"], c["category_id"]) for c in result["cells"]], [("company-b", "leave"), ("company-b", "family"), ("company-a", "leave"), ("company-a", "family")])
        self.assertNotIn("wrapper", result)
        for item in result["attempts"]:
            self.assertNotIn("wrapper", item)
            self.assertEqual(item["capture_locator"], f"https://captures.invalid/sha256/{item['raw_response_sha256']}")
            self.assertEqual(item["receipt_content_sha256"], normalizer.receipt_content_sha256(item))
        self.assertTrue(all(c["coverage_complete"] for c in result["cells"]))

    def test_fails_when_cell_references_missing_attempt(self):
        item = attempt("company-a", "leave", "official-government")
        record = cell("company-a", "leave", [item])
        package = {"coverage_policy": {}, "cells": [record], "attempts": [], "official_claims": [], "references": [], "community_reports": [], "sources": []}
        with self.assertRaisesRegex(normalizer.NormalizationError, "missing attempt"):
            normalizer.normalize_payload(package, ["company-a"], ["leave"], ["official-government"])

    def test_fails_when_evidence_source_was_not_discovered_for_same_cell(self):
        source_id = "source::" + "1" * 64
        attempts = [attempt("company-a", "leave", route) for route in ["official-government", "company-recruiting-media", "other-public-web"]]
        package = {
            "coverage_policy": {}, "cells": [cell("company-a", "leave", attempts, "reference", source_id)], "attempts": attempts,
            "official_claims": [], "community_reports": [],
            "references": [{"reference_id": f"reference::company-a::leave::{source_id}", "cell_id": "cell::company-a::leave", "company_id": "company-a", "category_id": "leave", "source_id": source_id}],
            "sources": [{"source_id": source_id, "url": "https://example.invalid/evidence"}],
        }
        with self.assertRaisesRegex(normalizer.NormalizationError, "not discovered by a cell-local attempt"):
            normalizer.normalize_payload(package, ["company-a"], ["leave"], ["official-government", "company-recruiting-media", "other-public-web"])

    def test_no_public_info_requires_all_routes_before_setting_coverage_complete(self):
        attempts = [attempt("company-a", "leave", "official-government")]
        package = {"coverage_policy": {}, "cells": [cell("company-a", "leave", attempts)], "attempts": attempts, "official_claims": [], "references": [], "community_reports": [], "sources": []}
        with self.assertRaisesRegex(normalizer.NormalizationError, "exact required routes"):
            normalizer.normalize_payload(package, ["company-a"], ["leave"], ["official-government", "company-recruiting-media", "other-public-web"])


class ClosureTests(unittest.TestCase):
    def test_search_acquisition_capture_is_preferred_over_same_attempt_direct_capture(self):
        search_capture = Path("search-capture.json")
        direct_capture = Path("direct-capture.json")
        search = normalizer.AcquisitionReceipt(
            Path("search-receipt.json"),
            {
                "artifact_type": "company-benefits-search-tool-acquisition",
                "capture_sha256": "1" * 64,
            },
            "3" * 64,
        )
        index = normalizer.AcquisitionIndex(
            files_by_sha256={
                "1" * 64: search_capture,
                "2" * 64: direct_capture,
            },
            json_by_attempt={"attempt::shared": [direct_capture, search_capture]},
        )

        self.assertEqual(
            search_capture,
            normalizer._preferred_acquisition_capture(index, search),
        )

    def test_direct_v2_acquisition_closes_cell_local_direct_source_attempt(self):
        locator = "https://www.teamblind.com/kr/company/example/review/XZ7yK9vq6"
        receipt = {
            "artifact_type": "company-benefits-direct-page-acquisition",
            "format_version": 2,
            "acquisition_status": "complete",
            "cell_id": "cell::KR-CRN-1101112948086::remote",
            "company_id": "KR-CRN-1101112948086",
            "category_id": "remote",
            "route_id": "community-review",
            "locator": locator,
            "capture_sha256": "1" * 64,
            "raw_tool_response_sha256": "2" * 64,
            "result": {"kind": "direct_source", "review_status": "unreviewed_lead", "url": locator},
        }
        direct_attempt = attempt(
            "KR-CRN-1101112948086", "remote", "other-public-web",
            ["source::" + "c" * 64],
        )
        direct_attempt.update({
            "attempt_id": "attempt::KR-CRN-1101112948086::remote::community-review",
            "route_id": "community-review",
            "route_kind": "community_employee_review",
            "query_or_locator": locator,
        })
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / "direct.json"
            path.write_text(json.dumps(receipt), encoding="utf-8")
            index = normalizer.index_acquisition_roots([root])
            matched = normalizer._receipt_for_attempt(index, direct_attempt, {locator})
        self.assertIsNotNone(matched)
        self.assertEqual(path, matched.path)

    def test_direct_acquisition_capture_is_preferred_over_legacy_attempt_capture(self):
        direct = normalizer.AcquisitionReceipt(
            Path("direct-receipt.json"),
            {"artifact_type": "company-benefits-direct-page-acquisition", "capture_sha256": "1" * 64},
            "2" * 64,
        )
        index = normalizer.AcquisitionIndex(files_by_sha256={"1" * 64: Path("direct-capture.json")})
        self.assertEqual(
            Path("direct-capture.json"),
            normalizer._preferred_acquisition_capture(index, direct),
        )

    def test_external_closure_rejects_acquisition_capture_hash_mismatch(self):
        root, closure = self._closure_fixture()
        self.addCleanup(root.cleanup)
        acquisition_path = Path(root.name) / closure["attempts"][0]["acquisition_receipt"]["path"]
        acquisition = json.loads(acquisition_path.read_text(encoding="utf-8"))
        acquisition["capture_sha256"] = "f" * 64
        acquisition_path.write_text(json.dumps(acquisition), encoding="utf-8")
        closure["attempts"][0]["acquisition_receipt"]["sha256"] = hashlib.sha256(
            acquisition_path.read_bytes()
        ).hexdigest()

        with self.assertRaisesRegex(normalizer.NormalizationError, "acquisition capture hash mismatch"):
            normalizer.verify_external_closure(Path(root.name), closure)

    def test_external_closure_rejects_capture_raw_hash_mismatch(self):
        root, closure = self._closure_fixture()
        self.addCleanup(root.cleanup)
        capture_path = Path(root.name) / closure["attempts"][0]["capture"]["path"]
        capture = json.loads(capture_path.read_text(encoding="utf-8"))
        capture["raw_tool_response_sha256"] = "f" * 64
        capture_path.write_text(json.dumps(capture), encoding="utf-8")
        closure["attempts"][0]["capture"]["sha256"] = hashlib.sha256(
            capture_path.read_bytes()
        ).hexdigest()
        acquisition_path = Path(root.name) / closure["attempts"][0]["acquisition_receipt"]["path"]
        acquisition = json.loads(acquisition_path.read_text(encoding="utf-8"))
        acquisition["capture_sha256"] = closure["attempts"][0]["capture"]["sha256"]
        acquisition_path.write_text(json.dumps(acquisition), encoding="utf-8")
        closure["attempts"][0]["acquisition_receipt"]["sha256"] = hashlib.sha256(
            acquisition_path.read_bytes()
        ).hexdigest()

        with self.assertRaisesRegex(normalizer.NormalizationError, "capture raw hash mismatch"):
            normalizer.verify_external_closure(Path(root.name), closure)

    def test_external_closure_rejects_search_query_semantics_mismatch(self):
        root, closure = self._closure_fixture()
        self.addCleanup(root.cleanup)
        capture_path = Path(root.name) / closure["attempts"][0]["capture"]["path"]
        capture = json.loads(capture_path.read_text(encoding="utf-8"))
        capture["executed_query"] = "different query"
        capture_path.write_text(json.dumps(capture), encoding="utf-8")
        closure["attempts"][0]["capture"]["sha256"] = hashlib.sha256(
            capture_path.read_bytes()
        ).hexdigest()
        acquisition_path = Path(root.name) / closure["attempts"][0]["acquisition_receipt"]["path"]
        acquisition = json.loads(acquisition_path.read_text(encoding="utf-8"))
        acquisition["capture_sha256"] = closure["attempts"][0]["capture"]["sha256"]
        acquisition_path.write_text(json.dumps(acquisition), encoding="utf-8")
        closure["attempts"][0]["acquisition_receipt"]["sha256"] = hashlib.sha256(
            acquisition_path.read_bytes()
        ).hexdigest()

        with self.assertRaisesRegex(normalizer.NormalizationError, "query semantics mismatch"):
            normalizer.verify_external_closure(Path(root.name), closure)

    def _closure_fixture(self):
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        paths = {
            "receipt": root / "artifacts/attempt-receipts/attempt.json",
            "acquisition": root / "artifacts/acquisition-receipts/acquisition.json",
            "capture": root / "artifacts/captures/capture.json",
            "raw": root / "artifacts/raw/raw.bin",
        }
        for path in paths.values():
            path.parent.mkdir(parents=True, exist_ok=True)
        raw = b"raw search response"
        raw_hash = hashlib.sha256(raw).hexdigest()
        paths["raw"].write_bytes(raw)
        receipt = {
            "attempt_id": "attempt::company::leave::other-public-web",
            "cell_id": "cell::company::leave",
            "company_id": "company",
            "category_id": "leave",
            "route_id": "other-public-web",
            "query_or_locator": "company leave benefits",
            "raw_response_sha256": raw_hash,
        }
        capture = {
            "attempt_id": receipt["attempt_id"],
            "cell_id": receipt["cell_id"],
            "route_id": receipt["route_id"],
            "executed_query": receipt["query_or_locator"],
            "raw_tool_response_sha256": raw_hash,
        }
        paths["receipt"].write_text(json.dumps(receipt), encoding="utf-8")
        paths["capture"].write_text(json.dumps(capture), encoding="utf-8")
        capture_hash = hashlib.sha256(paths["capture"].read_bytes()).hexdigest()
        acquisition = {
            "artifact_type": "company-benefits-search-tool-acquisition",
            "format_version": 2,
            "query_id": "search-query::company::leave::other-public-web",
            "capture_sha256": capture_hash,
            "raw_tool_response_sha256": raw_hash,
        }
        paths["acquisition"].write_text(json.dumps(acquisition), encoding="utf-8")
        closure = {
            "attempts": [{
                "attempt_id": receipt["attempt_id"],
                "receipt": {
                    "path": paths["receipt"].relative_to(root).as_posix(),
                    "sha256": hashlib.sha256(paths["receipt"].read_bytes()).hexdigest(),
                },
                "acquisition_receipt": {
                    "path": paths["acquisition"].relative_to(root).as_posix(),
                    "sha256": hashlib.sha256(paths["acquisition"].read_bytes()).hexdigest(),
                    "artifact_type": acquisition["artifact_type"],
                    "query_id": acquisition["query_id"],
                    "locator": None,
                },
                "capture": {
                    "path": paths["capture"].relative_to(root).as_posix(),
                    "sha256": capture_hash,
                },
                "raw": {
                    "path": paths["raw"].relative_to(root).as_posix(),
                    "sha256": raw_hash,
                },
            }]
        }
        return temporary, closure

    def test_acquisition_index_rejects_declared_wrapper_hash_and_uses_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            receipt = {"artifact_type": "company-benefits-search-tool-acquisition", "format_version": 2, "artifact_content_sha256": "f" * 64, "query_id": "search-query::c::leave::official-government", "capture_sha256": "1" * 64, "raw_tool_response_sha256": "2" * 64}
            path = root / "receipt.json"
            path.write_text(json.dumps(receipt), encoding="utf-8")
            index = normalizer.index_acquisition_roots([root])
            self.assertEqual(index.receipts[0].file_sha256, hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertNotEqual(index.receipts[0].file_sha256, receipt["artifact_content_sha256"])

    def test_extracts_exact_canonical_embedded_payload(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            embedded = {"attempt_id": "attempt::c::leave::official-government", "result": "no_result"}
            wrapper = {"bound_raw_response": embedded}
            (root / "wrapper.json").write_text(json.dumps(wrapper), encoding="utf-8")
            index = normalizer.index_acquisition_roots([root])
            expected = normalizer.canonical_bytes(embedded)
            actual = normalizer.extract_content(index, hashlib.sha256(expected).hexdigest())
            self.assertEqual(actual, expected)

    def test_verification_rejects_stale_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            payload = root / "payload.json"
            payload.write_text("{}\n", encoding="utf-8")
            manifest = {"files": [{"path": "payload.json", "sha256": "0" * 64, "size": 3}]}
            with self.assertRaisesRegex(normalizer.NormalizationError, "manifest hash mismatch"):
                normalizer.verify_closure_manifest(root, manifest)

    def test_external_closure_is_copied_inside_output_with_private_modes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "external.bin"
            source.write_bytes(b"immutable")
            output = root / "package"
            copied = normalizer.copy_immutable(source, output, "artifacts/raw")
            self.assertTrue(copied.relative_path.startswith("artifacts/raw/"))
            self.assertEqual((output / copied.relative_path).read_bytes(), b"immutable")
            self.assertEqual(stat.S_IMODE((output / copied.relative_path).stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o700)

    def test_descriptor_safe_manifest_paths_reject_traversal(self):
        with self.assertRaisesRegex(normalizer.NormalizationError, "unsafe manifest path"):
            normalizer.safe_relative_path("../external")


if __name__ == "__main__":
    unittest.main()
