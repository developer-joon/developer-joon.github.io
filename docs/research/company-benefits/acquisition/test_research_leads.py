#!/usr/bin/env python3
"""Integrity gates for the local, unapproved acquisition inventory."""
import collections
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest

from normalize_research_leads import LANES

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
SCRATCH = Path(os.environ.get("BENEFIT_ACQUISITION_ROOT", str(Path(os.environ.get('HERMES_HOME', Path.home() / '.hermes')) / 'cache/scratch/mixed-benefit-acquisition')))
REGISTRY = ROOT / "docs/research/company-benefits/source-registry.jsonl"


class ResearchLedgerTest(unittest.TestCase):
    def test_inventory_schema_and_rights(self):
        ledger = (HERE / "research-leads.jsonl").read_bytes()
        records = [json.loads(line) for line in ledger.splitlines()]
        manifest = json.loads((HERE / "research-leads-manifest.json").read_text())
        self.assertEqual(set(manifest["coverage"]), set(LANES))
        self.assertEqual(manifest["raw_rows"], len(records))
        self.assertEqual(manifest["ledger_sha256"], hashlib.sha256(ledger).hexdigest())
        self.assertEqual(dict(sorted(collections.Counter(r["lane"] for r in records).items())), manifest["coverage"])
        registry = [json.loads(line) for line in REGISTRY.read_text().splitlines()]
        seen = set()
        for r in records:
            key = (r["lane"], r["row_number"])
            self.assertNotIn(key, seen)
            seen.add(key)
            self.assertEqual(r["evidence_level"], "research_only")
            self.assertNotIn("verified", r.values())
            self.assertIsInstance(r["company_id"], str)
            self.assertIsInstance(r["batch_id"], str)
            self.assertTrue(r["source_url"].startswith("https://"))
            self.assertTrue(r["statement"])
            self.assertIsInstance(r["blockers"], dict)
            self.assertIn("rights", r["blockers"])
            if r["attributed_quote"] is not None:
                self.assertLessEqual(len(r["attributed_quote"]), 160)
                record = next((x for x in registry if x.get("source_id") == r["rights"]["registry_source_id"]), None)
                self.assertIsNotNone(record)
                assert record is not None
                self.assertEqual(record["url"], r["source_url"])
                self.assertIn(r["attributed_quote"], record["supporting_quote"])
                self.assertEqual(record["decisions"]["quote"], "allowed")
                canonical = json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
                self.assertEqual(hashlib.sha256(canonical).hexdigest(), r["rights"]["registry_record_sha256"])
            else:
                self.assertIsNone(r["quote_attribution"])
        for lane, (_, expected, _) in LANES.items():
            self.assertEqual(manifest["coverage"][lane], expected)
            self.assertEqual({r["row_number"] for r in records if r["lane"] == lane}, set(range(1, expected + 1)))
        self.assertEqual(manifest["provisional_group_keys"], len({(r["company_id"], r["provisional_group"]) for r in records if r["provisional_group"]}))

    def test_rebuild_checks_input_hashes_and_exact_output(self):
        result = subprocess.run([sys.executable, str(HERE / "normalize_research_leads.py"),
                                 "--input-root", str(SCRATCH), "--registry", str(REGISTRY),
                                 "--check"], capture_output=True, text=True, timeout=180)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["raw_rows"], sum(x[1] for x in LANES.values()))

    def test_no_raw_artifacts_or_private_paths(self):
        # Other waves add their own metadata and tests; this ledger owns only its files.
        for name in ("research-leads.jsonl", "research-leads-manifest.json"):
            self.assertTrue((HERE / name).is_file())
        for path in (HERE / "research-leads.jsonl", HERE / "research-leads-manifest.json"):
            text = path.read_text()
            self.assertNotIn("/home/bread/", text)
            self.assertNotIn("file://", text)
            self.assertNotIn("Set-Cookie", text)
            self.assertNotIn("\"raw_capture\"", text)
            self.assertNotIn("\"quote_context\"", text)
        self.assertFalse(any(p.is_symlink() or p.suffix.lower() in {".html", ".pdf", ".png", ".body", ".bin"} for p in HERE.iterdir()))


if __name__ == "__main__":
    unittest.main()
