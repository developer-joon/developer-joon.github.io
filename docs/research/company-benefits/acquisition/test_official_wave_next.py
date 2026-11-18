#!/usr/bin/env python3
"""Verify the disjoint second-wave inventory against restricted producer inputs."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
SOURCE = Path(os.environ.get('OFFICIAL_WAVE_NEXT_INPUT_ROOT', str(Path(os.environ.get('HERMES_HOME', Path.home() / '.hermes')) / 'data/benefit-batch-wave')))
SPEC = importlib.util.spec_from_file_location('official_wave_next', HERE / 'normalize_official_wave_next.py')
assert SPEC is not None and SPEC.loader is not None
wave = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(wave)


class OfficialWaveNextTest(unittest.TestCase):
    def test_exact_inventory_and_rights(self):
        generated = wave.build(SOURCE, HERE.parent)
        manifest = generated['manifest.json']
        self.assertEqual((manifest['covered_companies'], manifest['producer_leads'], manifest['companies_with_leads'], manifest['research_incomplete_companies'], manifest['approved_benefits']), (75, 274, 37, 38, 0))
        wave.check_or_write(generated, HERE / 'official-wave-next', check=True)
        leads, coverage = generated['leads.jsonl'], generated['coverage.jsonl']
        self.assertEqual(len({r['company_id'] for r in coverage}), 75)
        self.assertEqual([len([r for r in leads if r['batch_id'] == b]) for b in wave.BATCHES], [132, 110, 32])
        self.assertEqual([sum(bool(r['producer_lead_count']) for r in coverage if r['batch_id'] == b) for b in wave.BATCHES], [12, 10, 15])
        self.assertEqual([sum(not r['producer_lead_count'] for r in coverage if r['batch_id'] == b) for b in wave.BATCHES], [13, 15, 10])
        for batch in wave.BATCHES:
            originals = wave.rows((SOURCE / batch / 'observations.jsonl').read_bytes())
            for original, projected in zip(originals, (r for r in leads if r['batch_id'] == batch)):
                self.assertEqual(projected['producer_statement_sha256'], wave.digest(original['statement'].encode()))
                self.assertEqual(projected['producer_scope_note_sha256'], wave.digest(original['eligibility_note'].encode()))
                self.assertEqual(projected['private_origin'], {'batch_id': batch, 'file': 'observations.jsonl', 'row_number': projected['row_number']})
                self.assertNotIn('statement', projected)
                self.assertNotIn('quote', projected)
                self.assertNotIn('scope_note', projected)
                if batch == 'international-04':
                    self.assertEqual(projected['entity_binding'], original['entity_binding'])
                else:
                    self.assertNotIn('entity_binding', projected)
                self.assertEqual(projected['source_rights_status'], 'unreviewed')
        self.assertEqual(sum(r['entity_binding']['legal_entity_binding'] == 'proven' for r in leads if r['batch_id'] == 'international-04'), 3)
        text = ''.join((HERE / 'official-wave-next' / n).read_text() for n in ('leads.jsonl', 'coverage.jsonl', 'manifest.json'))
        self.assertNotIn(str(SOURCE), text)
        self.assertNotIn('"quote"', text)
        self.assertNotIn('"statement"', text)
        self.assertNotIn('"raw_body"', text)

    def test_pinned_input_rejects_rehash(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for batch in wave.BATCHES:
                shutil.copytree(SOURCE / batch, root / batch)
            path = root / 'international-04/observations.jsonl'
            path.write_bytes(path.read_bytes() + b'\n')
            with self.assertRaisesRegex(ValueError, 'pinned input digest mismatch'):
                wave.build(root, HERE.parent)

    def test_forged_digest_still_rejects_identity_and_outcome(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for batch in wave.BATCHES:
                shutil.copytree(SOURCE / batch, root / batch)
            path = root / 'domestic-08/coverage.jsonl'
            lines = path.read_text().splitlines()
            row = json.loads(lines[0]); row['legal_name'] = 'wrong employer'
            lines[0] = json.dumps(row, ensure_ascii=False)
            path.write_text('\n'.join(lines) + '\n')
            manifest_path = root / 'domestic-08/manifest.json'
            manifest = json.loads(manifest_path.read_text())
            manifest['files']['coverage.jsonl']['sha256'] = wave.digest(path.read_bytes())
            manifest_path.write_text(json.dumps(manifest))
            forged = copy.deepcopy(wave.PINNED)
            forged['domestic-08']['coverage.jsonl'] = wave.digest(path.read_bytes())
            forged['domestic-08']['manifest.json'] = wave.digest(manifest_path.read_bytes())
            with self.assertRaisesRegex(ValueError, 'coverage legal name mismatch'):
                wave.build(root, HERE.parent, pinned=forged)

    def test_url_credentials_rejected(self):
        for url in ('https://name:secret@example.org/', 'https://example.org/?token=secret', 'https://%65xample.org/', 'http://example.org/'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                wave.safe_url(url)


if __name__ == '__main__':
    unittest.main()
