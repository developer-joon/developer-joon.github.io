#!/usr/bin/env python3
"""Fail-closed checks for the separate official-wave audit projection."""
import copy
import importlib.util
import json
import os
import pathlib
import shutil
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
SOURCE = pathlib.Path(os.environ['OFFICIAL_WAVE_INPUT_ROOT'])
SPEC = importlib.util.spec_from_file_location('official_wave', HERE / 'normalize_official_wave.py')
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class OfficialWaveTest(unittest.TestCase):
    def test_real_source_and_committed_artifacts(self):
        generated = module.build(SOURCE, HERE.parent)
        self.assertEqual(generated['manifest.json']['producer_leads'], 863)
        self.assertEqual(generated['manifest.json']['covered_companies'], 75)
        self.assertEqual(generated['manifest.json']['companies_with_leads'], 59)
        self.assertEqual(generated['manifest.json']['research_incomplete_companies'], 16)
        self.assertEqual(generated['manifest.json']['approved_benefits'], 0)
        module.check_or_write(generated, HERE / 'official-wave', check=True)
        text = (HERE / 'official-wave/leads.jsonl').read_text()
        self.assertNotIn('"quote"', text)
        self.assertNotIn(str(SOURCE), text)
        source_rows = [json.loads(line) for batch in module.BATCHES for line in (SOURCE / batch / 'observations.jsonl').read_text().splitlines()]
        for source, projected in zip(source_rows, map(json.loads, text.splitlines())):
            self.assertNotIn(source['quote'], projected['statement'] + projected['scope_note'])
            self.assertEqual(projected['producer_statement_sha256'], module.sha256(source['statement'].encode()))
        for row in map(json.loads, text.splitlines()):
            self.assertEqual(row['evidence_level'], 'research_only')
            self.assertEqual(row['source_rights_status'], 'unreviewed')
            self.assertEqual(set(row), {'batch_id', 'row_number', 'company_id', 'legal_name', 'category_guess', 'statement', 'producer_statement_sha256', 'source_url', 'scope_note', 'evidence_level', 'source_rights_status'})

    def test_reject_modified_source_even_if_manifest_rehashed(self):
        with tempfile.TemporaryDirectory() as t:
            root = pathlib.Path(t)
            for batch in module.BATCHES:
                shutil.copytree(SOURCE / batch, root / batch)
            path = root / 'domestic-04/observations.jsonl'
            path.write_bytes(path.read_bytes() + b'\n')
            with self.assertRaisesRegex(ValueError, 'pinned input digest'):
                module.build(root, HERE.parent)

    def test_reject_identity_and_coverage_mismatch(self):
        with tempfile.TemporaryDirectory() as t:
            root = pathlib.Path(t)
            for batch in module.BATCHES:
                shutil.copytree(SOURCE / batch, root / batch)
            path = root / 'domestic-05/coverage.jsonl'
            rows = path.read_text().splitlines()
            row = json.loads(rows[0]); row['legal_name'] = 'wrong entity'
            rows[0] = json.dumps(row, ensure_ascii=False)
            path.write_text('\n'.join(rows) + '\n')
            # Pinned digest fails before a manipulated name can enter the projection.
            with self.assertRaisesRegex(ValueError, 'pinned input digest'):
                module.build(root, HERE.parent)
            # Validation must also reject a forged projection with matching fake digests.
            forged = copy.deepcopy(module.PINNED_SHA256)
            forged['domestic-05']['coverage.jsonl'] = module.sha256(path.read_bytes())
            manifest_path = root / 'domestic-05/manifest.json'
            manifest = json.loads(manifest_path.read_text())
            manifest['files']['coverage.jsonl']['sha256'] = forged['domestic-05']['coverage.jsonl']
            manifest_path.write_text(json.dumps(manifest))
            forged['domestic-05']['manifest.json'] = module.sha256(manifest_path.read_bytes())
            with self.assertRaisesRegex(ValueError, 'legal name'):
                module.build(root, HERE.parent, pinned=forged)


if __name__ == '__main__':
    unittest.main()
