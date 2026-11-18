#!/usr/bin/env python3
"""Pinned fifth acquisition batch, fourth separate audit projection."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
SOURCE = Path(os.environ.get('OFFICIAL_WAVE_FOURTH_INPUT_ROOT', str(Path.home() / '.hermes/profiles/conan/data/benefit-batch-wave')))
SPEC = importlib.util.spec_from_file_location('official_wave_fourth', HERE / 'normalize_official_wave_fourth.py')
wave = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(wave)


class FourthWaveTest(unittest.TestCase):
    def test_exact_pinned_projection(self):
        generated = wave.build(SOURCE, HERE.parent)
        wave.check_or_write(generated, HERE / 'official-wave-fourth', check=True)
        manifest = generated['manifest.json']
        leads, coverage = generated['leads.jsonl'], generated['coverage.jsonl']
        self.assertEqual((len(leads), len(coverage), len({r['company_id'] for r in coverage})), (620, 125, 125))
        self.assertEqual((manifest['producer_leads'], manifest['companies_with_leads'], manifest['research_incomplete_companies'], manifest['approved_benefits']), (620, 67, 58, 0))
        self.assertEqual([sum(x['batch_id'] == b for x in leads) for b in wave.BATCHES], [87, 92, 188, 111, 142])
        self.assertEqual(sum(x['entity_binding'] == 'unproven' for x in leads), 142)
        self.assertTrue(all(x['claim_eligible'] is False and x['source_rights_status'] == 'unreviewed' for x in leads))
        for batch in wave.BATCHES:
            originals = wave.rows((SOURCE / batch / 'observations.jsonl').read_bytes())
            projected = [r for r in leads if r['batch_id'] == batch]
            for original, row in zip(originals, projected):
                self.assertEqual(row['producer_statement_sha256'], wave.digest(original['statement'].encode()))
                self.assertEqual(row['producer_scope_note_sha256'], wave.digest(original['eligibility_note'].encode()))
                self.assertEqual(row['private_origin'], {'batch_id': batch, 'file': 'observations.jsonl', 'row_number': row['row_number']})
                self.assertEqual(row['source_url'], original['source_url'] if original['source_url'].startswith('https:') else None)
                if original['source_url'].startswith('http:'):
                    self.assertEqual(row['source_url_sha256'], wave.digest(original['source_url'].encode()))
        for row in coverage:
            self.assertEqual(row['producer_lead_count'], sum(x['company_id'] == row['company_id'] for x in leads))
            self.assertEqual(row['outcome'], 'research_leads_pending_review' if row['producer_lead_count'] else 'research_incomplete')
        text = ''.join((HERE / 'official-wave-fourth' / name).read_text() for name in ('leads.jsonl', 'coverage.jsonl', 'manifest.json', 'README.md'))
        self.assertNotIn('http:' + '//', text)
        self.assertNotIn(str(SOURCE), text)
        for key in ('"quote"', '"statement"', '"raw_body"', '"eligibility_note"'):
            self.assertNotIn(key, text)
        self.assertTrue(all(not x['source_url'] or x['source_url'].startswith('https:') for x in leads))
        self.assertTrue(all(u.startswith('https:') for x in coverage for u in x['destination_urls']))

    def test_pinned_bytes_reject_mutation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            shutil.copytree(SOURCE / 'domestic-12', root / 'domestic-12')
            path = root / 'domestic-12/observations.jsonl'
            path.write_bytes(path.read_bytes() + b'\n')
            with self.assertRaisesRegex(ValueError, 'pinned input digest mismatch'):
                wave.build(root, HERE.parent)

    def test_rehashed_legal_name_and_count_still_fail(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for batch in wave.BATCHES:
                shutil.copytree(SOURCE / batch, root / batch)
            path = root / 'domestic-15/coverage.jsonl'
            lines = path.read_text().splitlines()
            row = json.loads(lines[0]); row['legal_name'] = 'wrong employer'
            lines[0] = json.dumps(row, ensure_ascii=False)
            path.write_text('\n'.join(lines) + '\n')
            manifest_path = root / 'domestic-15/manifest.json'
            manifest = json.loads(manifest_path.read_text())
            manifest['files']['coverage.jsonl'] = wave.digest(path.read_bytes())
            manifest_path.write_text(json.dumps(manifest))
            forged = copy.deepcopy(wave.PINNED)
            forged['domestic-15']['coverage.jsonl'] = wave.digest(path.read_bytes())
            forged['domestic-15']['manifest.json'] = wave.digest(manifest_path.read_bytes())
            with self.assertRaisesRegex(ValueError, 'coverage legal name mismatch'):
                wave.build(root, HERE.parent, pinned=forged)
            row['legal_name'] = wave.rows((SOURCE / 'domestic-15/coverage.jsonl').read_bytes())[0]['legal_name']
            row['observation_count'] = 9
            lines[0] = json.dumps(row, ensure_ascii=False)
            path.write_text('\n'.join(lines) + '\n')
            manifest['files']['coverage.jsonl'] = wave.digest(path.read_bytes())
            manifest_path.write_text(json.dumps(manifest))
            forged['domestic-15']['coverage.jsonl'] = wave.digest(path.read_bytes())
            forged['domestic-15']['manifest.json'] = wave.digest(manifest_path.read_bytes())
            with self.assertRaisesRegex(ValueError, 'coverage row count mismatch'):
                wave.build(root, HERE.parent, pinned=forged)

    def test_unsafe_url_rejected(self):
        for url in ('https://user:pass@example.org/', 'https://%65xample.org/', 'https://example.org/?token=abc', 'https://example.org:0/', 'ftp://example.org/'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                wave.safe_url(url)


if __name__ == '__main__':
    unittest.main()
