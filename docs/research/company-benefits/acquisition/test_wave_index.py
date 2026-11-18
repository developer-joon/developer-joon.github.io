import copy
import hashlib
import importlib.util
import json
import os
import pathlib
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('wave_index', HERE / 'wave_index.py')
index = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(index)
CANON = HERE.parent
PRIVATE = pathlib.Path(os.environ.get('HERMES_HOME', pathlib.Path.home() / '.hermes')) / 'data/benefit-batch-wave'


class WaveIndexTest(unittest.TestCase):
    def test_pinned_waves_reproduce_population_and_binding(self):
        pins = json.loads((HERE / 'research-wave-inputs.json').read_text())
        result = index.build(PRIVATE, CANON, pins)
        self.assertEqual(len(result['coverage']), 25 * len(pins['batches']))
        self.assertEqual(len(result['leads']), sum(x['raw_research_rows'] for x in result['header']['batches']))
        initial = {x['batch_id'] for x in pins['batches'][:5]}
        self.assertEqual(sum(r['batch_id'] in initial for r in result['leads']), 460)
        us = [r for r in result['leads'] if r['batch_id'] == 'international-06']
        self.assertEqual(sum(r['entity_binding'] == 'proven' and not r['historical'] for r in us), 6)
        self.assertEqual(sum(r['entity_binding'] == 'unproven' for r in us), 5)
        self.assertEqual(sum(r['historical'] for r in us), 1)
        self.assertTrue(all(r['claim_eligible'] is False and r['source_rights_status'] == 'unreviewed' for r in result['leads']))
        self.assertFalse(any(k in json.dumps(result) for k in ('"quote"', '"statement"', str(PRIVATE))))

    def test_adapter_old_and_new_declarations(self):
        for batch in ('domestic-06', 'domestic-14', 'international-04', 'domestic-24', 'international-06'):
            with self.subTest(batch=batch):
                pins = {'schema_version': 1, 'batches': [index.pin_batch(PRIVATE, batch)]}
                result = index.build(PRIVATE, CANON, pins)
                self.assertEqual(len(result['coverage']), 25)

    def test_historical_entity_binding_is_not_current_proof(self):
        pins = {'schema_version': 1, 'batches': [index.pin_batch(PRIVATE, 'international-07')]}
        result = index.build(PRIVATE, CANON, pins)
        us = result['leads']
        self.assertEqual(len(us), 9)
        self.assertEqual(sum(r['entity_binding'] == 'proven' and not r['historical'] for r in us), 6)
        self.assertEqual(sum(r['entity_binding'] == 'unproven' for r in us), 2)
        historical = [r for r in us if r['historical']]
        self.assertEqual(len(historical), 1)
        self.assertIsNone(historical[0]['entity_binding'])
        self.assertFalse(historical[0]['claim_eligible'])

    def test_merged_shards_remain_unapproved_with_missing_quotes_and_history(self):
        pins = {'schema_version': 1, 'batches': [index.pin_batch(PRIVATE, 'international-08')]}
        result = index.build(PRIVATE, CANON, pins)
        self.assertEqual(len(result['coverage']), 25)
        self.assertEqual(len(result['leads']), 158)
        self.assertEqual(sum(r['historical'] for r in result['leads']), 10)
        self.assertEqual(sum(r.get('quote_sha256') is None for r in result['leads']), 96)
        self.assertTrue(all(r['entity_binding'] == 'unproven' and not r['claim_eligible']
                            for r in result['leads']))

    def test_unreported_company_counts_are_derived_and_marked(self):
        pins = {'schema_version': 1, 'batches': [index.pin_batch(PRIVATE, 'international-10')]}
        result = index.build(PRIVATE, CANON, pins)
        self.assertEqual(len(result['leads']), 19)
        self.assertEqual(len(result['coverage']), 25)
        self.assertTrue(all(x['count_source'] == 'derived_from_observations'
                            for x in result['coverage']))
        self.assertEqual(sum(x['raw_research_rows'] for x in result['coverage']), 19)

    def test_plural_observations_count_is_reconciled(self):
        pins = {'schema_version': 1, 'batches': [index.pin_batch(PRIVATE, 'domestic-01')]}
        result = index.build(PRIVATE, CANON, pins)
        self.assertEqual(len(result['leads']), 133)
        self.assertEqual(sum(x['raw_research_rows'] for x in result['coverage']), 133)
        self.assertFalse(any('count_source' in x for x in result['coverage']))

    def test_mismatch_is_rejected_before_any_write(self):
        with tempfile.TemporaryDirectory() as root:
            root = pathlib.Path(root)
            pins = {'schema_version': 1, 'batches': [index.pin_batch(PRIVATE, 'domestic-24')]}
            pins['batches'][0]['files']['observations.jsonl'] = '0' * 64
            with self.assertRaises(ValueError):
                index.add_wave(root / 'pins.json', root / 'wave-index.jsonl', pins, PRIVATE, CANON, 'domestic-25')
            self.assertFalse((root / 'pins.json').exists())
            self.assertFalse((root / 'wave-index.jsonl').exists())

    def test_url_redaction_and_rejection(self):
        self.assertEqual(index.project_url('http://example.org/benefit')[0], None)
        self.assertEqual(index.project_url('https://example.org/benefit')[0], 'https://example.org/benefit')
        for bad in ('https://user@example.org/', 'https://exa%6dple.org/', 'https://example.org/?token=abc', 'https://example.org:0/'):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                index.project_url(bad)

    def test_rehashed_coverage_count_mutation_fails(self):
        with tempfile.TemporaryDirectory() as root:
            root = pathlib.Path(root)
            batch = 'domestic-24'
            (root / batch).mkdir()
            for name in index.FILES:
                (root / batch / name).write_bytes((PRIVATE / batch / name).read_bytes())
            path = root / batch / 'coverage.jsonl'
            covered = path.read_text().splitlines()
            first = json.loads(covered[0])
            first['count'] += 1
            covered[0] = json.dumps(first, ensure_ascii=False)
            path.write_text('\n'.join(covered) + '\n')
            manifest_path = root / batch / 'manifest.json'
            manifest = json.loads(manifest_path.read_text())
            manifest['files']['coverage.jsonl']['sha256'] = index.digest(path.read_bytes())
            manifest_path.write_text(json.dumps(manifest))
            pins = {'schema_version': 1, 'batches': [index.pin_batch(root, batch)]}
            with self.assertRaisesRegex(ValueError, 'coverage row count'):
                index.build(root, CANON, pins)

    def test_add_wave_refuses_drift_and_duplicate_without_write(self):
        pins = {'schema_version': 1, 'batches': [index.pin_batch(PRIVATE, 'domestic-24')]}
        with tempfile.TemporaryDirectory() as root:
            root = pathlib.Path(root)
            pins_path, output = root / 'pins.json', root / 'wave-index.jsonl'
            pins_path.write_text(json.dumps(pins))
            output.write_text('drift\n')
            before = (pins_path.read_bytes(), output.read_bytes())
            with self.assertRaises(ValueError):
                index.add_wave(pins_path, output, pins, PRIVATE, CANON, 'domestic-25')
            self.assertEqual((pins_path.read_bytes(), output.read_bytes()), before)
            with self.assertRaises(ValueError):
                index.add_wave(pins_path, output, pins, PRIVATE, CANON, 'domestic-24')

    def test_check_detects_drift(self):
        pins = json.loads((HERE / 'research-wave-inputs.json').read_text())
        with tempfile.TemporaryDirectory() as root:
            path = pathlib.Path(root) / 'wave-index.jsonl'
            index.write_index(path, index.build(PRIVATE, CANON, pins))
            index.check_index(path, index.build(PRIVATE, CANON, pins))
            path.write_text(path.read_text() + '{}\n')
            with self.assertRaises(ValueError):
                index.check_index(path, index.build(PRIVATE, CANON, pins))


if __name__ == '__main__':
    unittest.main()
