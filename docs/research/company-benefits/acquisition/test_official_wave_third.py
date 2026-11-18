#!/usr/bin/env python3
"""Audit-only third wave and retrospective US legal-employer binding correction."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
SOURCE = Path(os.environ.get('OFFICIAL_WAVE_THIRD_INPUT_ROOT', str(Path.home() / '.hermes/profiles/conan/data/benefit-batch-wave')))
SPEC = importlib.util.spec_from_file_location('official_wave_third', HERE / 'normalize_official_wave_third.py')
wave = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(wave)


class OfficialWaveThirdTest(unittest.TestCase):
    def test_exact_inventory_rights_and_correction(self):
        generated = wave.build(SOURCE, HERE.parent)
        manifest = generated['manifest.json']
        self.assertEqual((manifest['covered_companies'], manifest['producer_leads'], manifest['companies_with_leads'], manifest['research_incomplete_companies'], manifest['approved_benefits']), (75, 295, 28, 47, 0))
        wave.check_or_write(generated, HERE / 'official-wave-third', check=True)
        leads, coverage = generated['leads.jsonl'], generated['coverage.jsonl']
        self.assertEqual(len({r['company_id'] for r in coverage}), 75)
        self.assertEqual([sum(r['batch_id'] == b for r in leads) for b in wave.BATCHES], [134, 111, 50])
        self.assertEqual([sum(bool(r['producer_lead_count']) for r in coverage if r['batch_id'] == b) for b in wave.BATCHES], [10, 11, 7])
        self.assertEqual([sum(not r['producer_lead_count'] for r in coverage if r['batch_id'] == b) for b in wave.BATCHES], [15, 14, 18])
        insecure = {
            '029a581b21e21008829b7100378d77e3a544c24964c83b4422136610aa167f31',
            '9577efca6a6a1f913369a7b57621811e9613a5adac08dac8911ab79b37ca17c9',
            '702d51a00539161858c32b2341824b84bc0d4707713fcd2f61198fcf0bd55829',
        }
        self.assertEqual(set(manifest['unencrypted_http_source_sha256_research_only']), insecure)
        affected = [r for r in leads if r['source_transport'] == 'http_research_only_unpublishable']
        self.assertEqual({r['source_url_sha256'] for r in affected}, insecure - {'702d51a00539161858c32b2341824b84bc0d4707713fcd2f61198fcf0bd55829'})
        self.assertTrue(all(r['source_url'] is None and r['claim_eligible'] is False for r in affected))
        self.assertTrue(all(r['outcome'] == 'research_incomplete' and r['producer_lead_count'] == 0 for r in coverage if r['outcome'] == 'research_incomplete'))
        for batch in wave.BATCHES:
            originals = wave.rows((SOURCE / batch / 'observations.jsonl').read_bytes())
            for original, projected in zip(originals, (r for r in leads if r['batch_id'] == batch)):
                self.assertEqual(projected['producer_statement_sha256'], wave.digest(original['statement'].encode()))
                self.assertEqual(projected['producer_scope_note_sha256'], wave.digest(original['eligibility_note'].encode()))
                self.assertEqual(projected['private_origin'], {'batch_id': batch, 'file': 'observations.jsonl', 'row_number': projected['row_number']})
                if original['source_url'].startswith('http:'):
                    self.assertIsNone(projected['source_url'])
                    self.assertEqual(projected['source_url_sha256'], wave.digest(original['source_url'].encode()))
                else:
                    self.assertEqual(projected['source_url'], original['source_url'])
                self.assertEqual(projected['source_rights_status'], 'unreviewed')
                self.assertFalse({'statement', 'quote', 'scope_note', 'raw_body'} & projected.keys())
        correction = manifest['international_04_identity_correction']
        self.assertEqual((correction['previously_unbound_rows'], correction['newly_bindable_rows'], correction['still_unbound_rows']), (29, 4, 25))
        audit = json.loads((SOURCE / 'international-04-identity-audit.json').read_text())
        expected = {r['company_id']: r for r in audit['records']}
        self.assertEqual(len(correction['records']), 14)
        for record in correction['records']:
            original = expected[record['company_id']]
            self.assertEqual(record['newly_bindable_row_numbers'], original['exact_entity_bindable_rows'])
            self.assertEqual(record['unbound_row_numbers'], original['unbound_rows'])
            self.assertEqual(record['identity_source_urls'], original['source_urls'])
            self.assertEqual(record['classification'], original['classification'])
        text = ''.join(p.read_text() for p in (HERE / 'official-wave-third').iterdir() if p.is_file())
        self.assertNotIn('http:' + '//', text)
        for batch in wave.BATCHES:
            for filename in ('observations.jsonl', 'coverage.jsonl'):
                private = (SOURCE / batch / filename).read_text()
                for url in re.findall(r'http:' + r'//[^"\s]+', private):
                    self.assertNotIn(url, text)
        for original, projected in zip((r for b in wave.BATCHES for r in wave.rows((SOURCE / b / 'coverage.jsonl').read_bytes())), coverage):
            insecure_urls = [u for u in original['destination_urls'] if u.startswith('http:')]
            self.assertEqual(projected['destination_url_sha256_research_only'], [wave.digest(u.encode()) for u in insecure_urls])
            self.assertTrue(all(u.startswith('https:') for u in projected['destination_urls']))
            if insecure_urls:
                self.assertFalse(projected['claim_eligible'])
        self.assertNotIn(str(SOURCE), text)
        for sensitive in ('"quote"', '"statement"', '"raw_body"', '"reason"'):
            self.assertNotIn(sensitive, text)

    def test_pinned_input_and_identity_audit_reject_mutation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for batch in wave.BATCHES:
                shutil.copytree(SOURCE / batch, root / batch)
            shutil.copy(SOURCE / 'international-04-identity-audit.json', root)
            path = root / 'domestic-09/observations.jsonl'
            path.write_bytes(path.read_bytes() + b'\n')
            with self.assertRaisesRegex(ValueError, 'pinned input digest mismatch'):
                wave.build(root, HERE.parent)
            shutil.copy(SOURCE / 'domestic-09/observations.jsonl', path)
            path = root / 'international-04-identity-audit.json'
            path.write_bytes(path.read_bytes() + b'\n')
            with self.assertRaisesRegex(ValueError, 'pinned identity audit digest mismatch'):
                wave.build(root, HERE.parent)

    def test_rehashed_coverage_identity_still_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for batch in wave.BATCHES:
                shutil.copytree(SOURCE / batch, root / batch)
            shutil.copy(SOURCE / 'international-04-identity-audit.json', root)
            path = root / 'domestic-10/coverage.jsonl'
            lines = path.read_text().splitlines()
            row = json.loads(lines[0]); row['legal_name'] = 'wrong employer'
            lines[0] = json.dumps(row, ensure_ascii=False)
            path.write_text('\n'.join(lines) + '\n')
            manifest_path = root / 'domestic-10/manifest.json'
            manifest = json.loads(manifest_path.read_text())
            manifest['files']['coverage.jsonl']['sha256'] = wave.digest(path.read_bytes())
            manifest_path.write_text(json.dumps(manifest))
            forged = copy.deepcopy(wave.PINNED)
            forged['domestic-10']['coverage.jsonl'] = wave.digest(path.read_bytes())
            forged['domestic-10']['manifest.json'] = wave.digest(manifest_path.read_bytes())
            with self.assertRaisesRegex(ValueError, 'coverage legal name mismatch'):
                wave.build(root, HERE.parent, pinned=forged)

    def test_credential_url_rejected(self):
        for url in ('https://name:secret@example.org/', 'https://example.org/?token=secret', 'https://%65xample.org/', 'http:' + '//example.org/'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                wave.safe_url(url)


if __name__ == '__main__':
    unittest.main()
