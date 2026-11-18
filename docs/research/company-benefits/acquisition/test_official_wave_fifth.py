#!/usr/bin/env python3
"""Pinned fifth official research wave: raw-free, exact-company audit only."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
SOURCE = Path(os.environ.get('OFFICIAL_WAVE_FIFTH_INPUT_ROOT', str(Path.home() / '.hermes/profiles/conan/data/benefit-batch-wave')))
SPEC = importlib.util.spec_from_file_location('official_wave_fifth', HERE / 'normalize_official_wave_fifth.py')
wave = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(wave)


class FifthWaveTest(unittest.TestCase):
    def test_exact_projection_and_byte_parity(self):
        generated = wave.build(SOURCE, HERE.parent)
        wave.check_or_write(generated, HERE / 'official-wave-fifth', check=True)
        leads, coverage, manifest = (generated[x] for x in ('leads.jsonl', 'coverage.jsonl', 'manifest.json'))
        self.assertEqual((len(leads), len(coverage), len({r['company_id'] for r in coverage})), (526, 100, 100))
        self.assertEqual((manifest['companies_with_leads'], manifest['research_incomplete_companies'], manifest['approved_benefits']), (42, 58, 0))
        self.assertEqual([sum(x['batch_id'] == b for x in leads) for b in wave.BATCHES], [90, 107, 139, 190])
        for batch in wave.BATCHES:
            original = wave.rows((SOURCE / batch / 'observations.jsonl').read_bytes())
            projected = [r for r in leads if r['batch_id'] == batch]
            for number, (source, row) in enumerate(zip(original, projected), 1):
                self.assertEqual(row['private_origin'], {'batch_id': batch, 'file': 'observations.jsonl', 'row_number': number})
                self.assertEqual(row['producer_statement_sha256'], wave.digest(source['statement'].encode()))
                self.assertEqual(row['source_url'], source['source_url'] if source['source_url'].startswith('https:') else None)
                if source['source_url'].startswith('http:'):
                    self.assertEqual(row['source_url_sha256'], wave.digest(source['source_url'].encode()))
        for row in coverage:
            self.assertEqual(row['producer_lead_count'], sum(x['company_id'] == row['company_id'] for x in leads))
        text = ''.join((HERE / 'official-wave-fifth' / name).read_text() for name in ('leads.jsonl', 'coverage.jsonl', 'manifest.json', 'README.md'))
        self.assertNotIn('http:' + '//', text)
        self.assertNotIn(str(SOURCE), text)
        for key in ('"quote"', '"statement"', '"raw_body"', '"eligibility_note"'):
            self.assertNotIn(key, text)
        self.assertTrue(all(r['evidence_level'] == 'research_only' and not r['claim_eligible'] for r in leads))
        self.assertTrue(all(not r['source_url'] or r['source_url'].startswith('https:') for r in leads))
        self.assertTrue(all(u.startswith('https:') for r in coverage for u in r['destination_urls']))

    def test_pinned_input_mutation_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            shutil.copytree(SOURCE / 'domestic-16', root / 'domestic-16')
            path = root / 'domestic-16/observations.jsonl'
            path.write_bytes(path.read_bytes() + b'\n')
            with self.assertRaisesRegex(ValueError, 'pinned input digest mismatch'):
                wave.build(root, HERE.parent)

    def test_rehashed_membership_and_count_mutations_fail(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for batch in wave.BATCHES:
                shutil.copytree(SOURCE / batch, root / batch)
            path = root / 'domestic-17/coverage.jsonl'
            original = path.read_bytes()
            for mutation, expected in (({'legal_name': 'wrong employer'}, 'legal name'), ({'observation_count': 999}, 'coverage row count')):
                lines = original.decode().splitlines()
                row = json.loads(lines[0]); row.update(mutation)
                lines[0] = json.dumps(row, ensure_ascii=False)
                path.write_text('\n'.join(lines) + '\n')
                manifest_path = root / 'domestic-17/manifest.json'
                manifest = json.loads((SOURCE / 'domestic-17/manifest.json').read_text())
                manifest['files']['coverage.jsonl']['sha256'] = wave.digest(path.read_bytes())
                manifest_path.write_text(json.dumps(manifest))
                forged = copy.deepcopy(wave.PINNED)
                forged['domestic-17']['coverage.jsonl'] = wave.digest(path.read_bytes())
                forged['domestic-17']['manifest.json'] = wave.digest(manifest_path.read_bytes())
                with self.assertRaisesRegex(ValueError, expected):
                    wave.build(root, HERE.parent, pinned=forged)

    def test_unsafe_urls_fail(self):
        for url in ('https://user:pass@example.org/', 'https://%65xample.org/', 'https://example.org/?token=abc', 'https://example.org:0/', 'ftp://example.org/'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                wave.safe_url(url)


if __name__ == '__main__':
    unittest.main()
