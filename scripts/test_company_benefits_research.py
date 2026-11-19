"""Fail-closed tests for the separate, non-publication research artifact."""
import hashlib
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/generate-company-benefits-research.py"
BASE = ROOT / "community-app/public/data/company-benefits/manifest.json"
SOURCE = "cosmo-daily-life-support-official-source::cosmo-daily-life-support"
SECOND = "cosmo-education-housing-official-source::cosmo-education-housing"
URL = "https://www.cosmoamt.com/?page_id=11184"
COMPANY = "KR-CRN-1201110018251"
DIGEST = "a" * 64  # input text digest, not a published source claim


def lead(action="통근버스를 운영한다.", category="commute", registry_id=SOURCE):
    return {
        "company_id": COMPANY,
        "primary_category": category,
        "benefit_action": action,
        "source_url": URL,
        "source_registry_id": registry_id,
        "scope": {"legal_entity": "코스모신소재(주)", "roles": "unspecified",
                  "employment_types": "unspecified", "conditions": "unspecified"},
        "currentness": "source_date_unconfirmed",
        "observed_at": "2026-10-29T23:33:03Z",
        "limitations": "Current eligibility has not been independently reviewed.",
        "status": "research_only",
        "source_text_sha256": DIGEST,
    }


class ResearchArtifactTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("research_generator", SCRIPT)
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def build(self, rows):
        return self.module.build_artifacts(
            b"".join((json.dumps(row, ensure_ascii=False) + "\n").encode() for row in rows), ROOT
        )

    def test_two_atomic_actions_same_company_sorted_and_pinned(self):
        a = lead()
        b = lead("타지역 거주자를 위한 기숙사를 운영한다.", "housing", SECOND)
        base_before = BASE.read_bytes()
        manifest_bytes, payload_bytes = self.build([b, a])
        self.assertEqual((manifest_bytes, payload_bytes), self.build([a, b]))
        self.assertEqual(base_before, BASE.read_bytes())
        self.assertTrue(manifest_bytes.endswith(b"\n"))
        self.assertTrue(payload_bytes.endswith(b"\n"))
        manifest = json.loads(manifest_bytes)
        payload = json.loads(payload_bytes)
        self.assertEqual([a, b], payload["leads"])
        self.assertEqual(manifest["base_manifest_sha256"], hashlib.sha256(base_before).hexdigest())
        self.assertEqual(manifest["leads_sha256"], hashlib.sha256(payload_bytes).hexdigest())
        self.assertEqual(manifest["leads_byte_count"], len(payload_bytes))
        self.assertEqual((manifest["record_count"], manifest["company_count"]), (2, 1))

    def test_production_shaped_limitations_and_conditions_preserved(self):
        structured = lead()
        structured["limitations"] = ["Eligibility requires independent review.",
                                     "Currentness has not been confirmed."]
        structured["scope"]["conditions"] = {"tenure": "At least one year"}
        empty = lead("타지역 거주자를 위한 기숙사를 운영한다.", "housing", SECOND)
        empty["limitations"] = ["Eligibility requires independent review.",
                                "Currentness has not been confirmed."]
        empty["scope"]["conditions"] = {}
        _, payload = self.build([structured, empty])
        self.assertEqual(json.loads(payload)["leads"], [structured, empty])

    def test_list_valued_scope_fields_preserved(self):
        empty = lead()
        empty["scope"].update(roles=["대상 직군 미명시"],
                              employment_types=["고용형태 미명시"], conditions=[])
        stated = lead("타지역 거주자를 위한 기숙사를 운영한다.", "housing", SECOND)
        stated["scope"].update(roles=["생산직"], employment_types=["정규직"],
                               conditions=["타지역 거주자"])
        _, payload = self.build([empty, stated])
        self.assertEqual(json.loads(payload)["leads"], [empty, stated])

    def test_list_valued_scope_rejects_invalid_shapes(self):
        mutations = [
            {"roles": []}, {"employment_types": []},
            {"roles": ["x" * 161]}, {"employment_types": ["x" * 161]},
            {"conditions": ["x" * 161]},
            {"roles": ["valid", 12]}, {"employment_types": [None]},
            {"conditions": [dict(nested="bad")]},
            {"roles": ["valid"] * 9}, {"employment_types": ["valid"] * 9},
            {"conditions": ["valid"] * 9},
            {"conditions": {"unknown_key": "value"}},
        ]
        for scope_change in mutations:
            with self.subTest(scope_change=scope_change), self.assertRaises(ValueError):
                self.build([{**lead(), "scope": {**lead()["scope"], **scope_change}}])

    def test_structured_fields_reject_unsafe_or_oversized_values(self):
        mutations = [
            {"limitations": []},
            {"limitations": ["Valid", {"nested": "not allowed"}]},
            {"limitations": ["x" * 241]},
            {"limitations": ["Valid"] * 9},
            {"scope": {**lead()["scope"], "conditions": {"tenure": {"nested": "bad"}}}},
            {"scope": {**lead()["scope"], "conditions": {"tenure": ["nested"]}}},
            {"scope": {**lead()["scope"], "conditions": {f"key_{n}": "value" for n in range(9)}}},
            {"scope": {**lead()["scope"], "conditions": {"bad key": "value"}}},
            {"scope": {**lead()["scope"], "conditions": {"tenure": "x" * 161}}},
            {"scope": {**lead()["scope"], "conditions": {"k" * 41: "value"}}},
            {"scope": {**lead()["scope"], "conditions": {"tenure": "value"}, "extra": "bad"}},
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                self.build([{**lead(), **mutation}])

    def test_duplicate_normalized_action_rejected(self):
        b = lead("  통근버스를   운영한다.  ", "meals")
        with self.assertRaises(ValueError):
            self.build([lead(), b])

    def test_mutation_matrix_rejected_before_output(self):
        mutations = [
            {"source_url": "http://www.cosmoamt.com/?page_id=11184"},
            {"source_url": "https://www.cosmoamt.com/?api_key=secret"},
            {"source_url": "https://user:pass@www.cosmoamt.com/?page_id=11184"},
            {"source_url": "https://%77ww.cosmoamt.com/?page_id=11184"},
            {"scope": {**lead()["scope"], "legal_entity": "다른회사"}},
            {"source_registry_id": "cosmo-not-a-source"},
            {"primary_category": "fictional"},
            {"status": "verified"},
            {"quote": "unapproved source text"},
            {"body": "full page"},
            {"benefit_action": "x" * 301},
            {"source_text_sha256": "invalid"},
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                self.build([{**lead(), **mutation}])

    def test_route_only_and_unallowed_rights_rejected(self):
        # Real registry IDs: identity-only registry and route-only discovery entries
        registry = [json.loads(line) for line in
                    (ROOT / "docs/research/company-benefits/source-registry.jsonl").read_text().splitlines()]
        route = next(x for x in registry if x.get("reuse_decision") == "allowed_with_attribution"
                     and not x.get("claim_evidence_role") and x.get("url", "").startswith("https://"))
        for source in ("au-asic-companies", route["source_id"]):
            with self.subTest(source=source), self.assertRaises(ValueError):
                self.build([{**lead(), "source_registry_id": source,
                             "source_url": next(x["url"] for x in registry if x["source_id"] == source)}])

    def test_check_does_not_write_missing_artifacts(self):
        output = ROOT / "community-app/public/data/company-benefits/research-leads-v1"
        def snapshot():
            return {p.name: p.read_bytes() for p in output.iterdir()} if output.exists() else None
        before = snapshot()
        with tempfile.TemporaryDirectory() as directory:
            source = pathlib.Path(directory) / "sanitized.jsonl"
            candidates = ([lead()], [lead("타지역 거주자를 위한 기숙사를 운영한다.", "housing", SECOND)])
            rows = next(rows for rows in candidates if before is None or
                        before.get("manifest.json") != self.build(rows)[0])
            source.write_text(json.dumps(rows[0], ensure_ascii=False) + "\n", encoding="utf-8")
            result = subprocess.run(["python3", str(SCRIPT), "--input", str(source), "--check"],
                                    capture_output=True, text=True, check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("stale", result.stderr)
        self.assertEqual(before, snapshot())

    def test_failed_second_replace_rolls_back_and_retries(self):
        for populated in (True, False):
            with self.subTest(populated=populated), tempfile.TemporaryDirectory() as directory:
                root = pathlib.Path(directory)
                output = root / self.module.OUTPUT
                output.mkdir(parents=True)
                old = {"manifest.json": b"old manifest\n", "leads.json": b"old leads\n"} if populated else {}
                for name, data in old.items():
                    (output / name).write_bytes(data)
                source = root / "input.jsonl"
                source.write_bytes(b"valid input")
                generated = (b"new manifest\n", b"new leads\n")
                real_replace = os.replace
                calls = []
                def fail_second(src, dst):
                    calls.append((src, dst))
                    if len(calls) == 1:
                        self.assertTrue(all((output / (name + ".tmp")).is_file()
                                            for name in ("manifest.json", "leads.json")))
                    if len(calls) == 2:
                        raise OSError("injected second replacement failure")
                    return real_replace(src, dst)
                def run(check=False, inject=False):
                    argv = [str(SCRIPT), "--input", str(source)] + (["--check"] if check else [])
                    with mock.patch.object(self.module, "ROOT", root), \
                         mock.patch.object(self.module, "build_artifacts", return_value=generated), \
                         mock.patch.object(sys, "argv", argv):
                        if inject:
                            with mock.patch.object(self.module.os, "replace", side_effect=fail_second):
                                return self.module.main()
                        return self.module.main()
                self.assertEqual(run(inject=True), 1)
                self.assertEqual({p.name: p.read_bytes() for p in output.iterdir()}, old)
                self.assertEqual(run(), 0)
                self.assertEqual({p.name: p.read_bytes() for p in output.iterdir()},
                                 dict(zip(("manifest.json", "leads.json"), generated)))
                self.assertEqual(run(check=True), 0)

    def test_stale_owned_temp_recovered_but_linked_temp_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            output = root / self.module.OUTPUT
            output.mkdir(parents=True)
            source = root / "input.jsonl"
            source.write_bytes(b"valid input")
            argv = [str(SCRIPT), "--input", str(source)]
            temp = output / "leads.json.tmp"
            temp.write_bytes(b"interrupted")
            with mock.patch.object(self.module, "ROOT", root), \
                 mock.patch.object(self.module, "build_artifacts", return_value=(b"manifest", b"leads")), \
                 mock.patch.object(sys, "argv", argv):
                self.assertEqual(self.module.main(), 0)
                self.assertFalse(temp.exists())
                (output / "manifest.json").write_bytes(b"partial")
                with mock.patch.object(sys, "argv", argv + ["--check"]):
                    self.assertEqual(self.module.main(), 1)
                temp.symlink_to(source)
                self.assertEqual(self.module.main(), 1)
                self.assertTrue(temp.is_symlink())
                self.assertEqual(source.read_bytes(), b"valid input")

    def test_encoded_credential_query_keys_rejected(self):
        for key in ("%61pi_key", "api%5fkey", "access%5ftoken"):
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.module.safe_url("https://www.cosmoamt.com/?" + key + "=secret")

    def test_symlink_input_parent_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            actual = root / "actual"
            actual.mkdir()
            (actual / "leads.jsonl").write_text(json.dumps(lead(), ensure_ascii=False) + "\n", encoding="utf-8")
            (root / "linked").symlink_to(actual, target_is_directory=True)
            result = subprocess.run(["python3", str(SCRIPT), "--input", str(root / "linked/leads.jsonl"), "--check"],
                                    capture_output=True, text=True, check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("linked", result.stderr)

    def test_credential_query_rejected_by_url_validator(self):
        with self.assertRaises(ValueError):
            self.module.safe_url("https://www.cosmoamt.com/?api_key=secret")

    def test_strict_shapes_and_jsonl(self):
        for value in (b"{}\n", b"[]\n", b"", b"{\"status\":1}\n", b"{\"x\":1,\"x\":2}\n"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.module.build_artifacts(value, ROOT)


if __name__ == "__main__":
    unittest.main()
