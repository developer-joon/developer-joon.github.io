"""Audit-only revisit ingestion; fixture mutations never print private text."""
import hashlib
import importlib.util
import json
import os
import pathlib
import shutil
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('revisit_index', HERE / 'revisit_index.py')
index = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(index)
PRIVATE = pathlib.Path(os.environ.get('HERMES_HOME', pathlib.Path.home() / '.hermes')) / 'data/benefit-batch-wave'
CANON = HERE.parent


class RevisitIndexTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.private = self.root / 'private'
        self.private.mkdir()
        self.pins_path = self.root / 'pins.json'
        self.output = self.root / 'index.jsonl'

    def copy(self, scope):
        for kind in index.FILES:
            name = f'{scope}-revisit-{kind}'
            shutil.copyfile(PRIVATE / name, self.private / name)
        for row in (json.loads(x) for x in (PRIVATE / f'{scope}-revisit-coverage.jsonl').read_text().splitlines()):
            reference = row.get('prior_coverage_reference', row.get('previous_coverage'))
            relative = reference.get('coverage_file', reference.get('path'))
            target = self.private / relative
            target.parent.mkdir(exist_ok=True)
            shutil.copyfile(PRIVATE / relative, target)

    def mutate(self, scope, kind, change):
        path = self.private / f'{scope}-revisit-{kind}'
        if kind == 'manifest.json':
            data = json.loads(path.read_text())
            change(data)
            path.write_text(json.dumps(data) + '\n')
        else:
            data = [json.loads(x) for x in path.read_text().splitlines()]
            change(data)
            path.write_text(''.join(json.dumps(x, ensure_ascii=False) + '\n' for x in data))

    def pin(self, scope):
        return {'schema_version': 1, 'revisits': [index.pin_revisit(self.private, scope)]}

    def test_both_formats_reconcile_exact_union_and_reproduce_quote_free_output(self):
        for scope in ('domestic', 'international'):
            self.copy(scope)
        pins = {'schema_version': 1, 'revisits': [index.pin_revisit(self.private, s) for s in ('domestic', 'international')]}
        result = index.build(self.private, CANON, pins)
        self.assertEqual(len(result['coverage']), 8)
        self.assertEqual(len(result['leads']), 69)
        self.assertEqual(sum(x['raw_research_rows'] for x in result['coverage']), 69)
        self.assertEqual(sum(x['raw_research_rows'] > 0 for x in result['coverage']), 7)
        self.assertEqual(result['header']['approved_count'], 0)
        self.assertEqual(result['header']['status'], 'research_only')
        serialized = index.output_bytes(result)
        self.assertNotIn(b'"quote":', serialized)
        self.assertNotIn(b'"statement":', serialized)
        self.assertNotIn(str(PRIVATE).encode(), serialized)
        self.assertTrue(all(x['rights_status'] == 'rights_unreviewed' for x in result['leads']))
        self.assertTrue(all(x['claim_eligible'] is False for x in result['leads']))
        index.write_index(self.output, result)
        index.check_index(self.output, index.build(self.private, CANON, pins))

    def test_add_is_append_only_and_check_detects_private_body_tamper(self):
        self.copy('domestic')
        pins = {'schema_version': 1, 'revisits': []}
        first = index.add(self.pins_path, self.output, pins, self.private, CANON, 'domestic')
        self.assertEqual(len(first['leads']), 62)
        self.copy('international')
        pins = json.loads(self.pins_path.read_text())
        second = index.add(self.pins_path, self.output, pins, self.private, CANON, 'international')
        self.assertEqual(len(second['leads']), 69)
        with self.assertRaisesRegex(ValueError, 'already pinned'):
            index.add(self.pins_path, self.output, json.loads(self.pins_path.read_text()), self.private, CANON, 'domestic')
        self.mutate('domestic', 'observations.jsonl', lambda rows: rows[0].__setitem__('statement', 'tampered'))
        with self.assertRaisesRegex(ValueError, 'pinned input mismatch'):
            index.build(self.private, CANON, json.loads(self.pins_path.read_text()))

    def test_swapped_observation_identity_fails_even_with_fresh_pins(self):
        self.copy('domestic')
        coverage = [json.loads(x) for x in (self.private / 'domestic-revisit-coverage.jsonl').read_text().splitlines()]
        self.mutate('domestic', 'observations.jsonl', lambda rows: rows[0].__setitem__('company_id', coverage[0]['company_id']))
        # Manifest must truthfully re-pin the changed producer bytes; identity still fails.
        self.rehash_manifest('domestic', 'observations.jsonl')
        with self.assertRaises(ValueError):
            index.build(self.private, CANON, self.pin('domestic'))

    def rehash_manifest(self, scope, kind):
        raw = (self.private / f'{scope}-revisit-{kind}').read_bytes()
        def change(m):
            name = f'{scope}-revisit-{kind}'
            if 'files' in m:
                m['files'][name]['sha256'] = hashlib.sha256(raw).hexdigest()
                m['files'][name]['bytes'] = len(raw)
            else:
                m['files_sha256'][name] = hashlib.sha256(raw).hexdigest()
        self.mutate(scope, 'manifest.json', change)

    def test_coverage_count_mismatch_rejected_with_rehashed_manifest(self):
        self.copy('international')
        self.mutate('international', 'coverage.jsonl', lambda rows: rows[0].__setitem__('observation_count', 3))
        self.rehash_manifest('international', 'coverage.jsonl')
        with self.assertRaisesRegex(ValueError, 'count mismatch'):
            index.build(self.private, CANON, self.pin('international'))

    def test_missing_coverage_record_rejected_with_rehashed_manifest(self):
        self.copy('domestic')
        self.mutate('domestic', 'coverage.jsonl', lambda rows: rows.pop())
        self.rehash_manifest('domestic', 'coverage.jsonl')
        with self.assertRaises(ValueError):
            index.build(self.private, CANON, self.pin('domestic'))

    def test_http_and_credential_urls_are_never_projected(self):
        self.copy('domestic')
        for url in ('http://example.org/research', 'https://user:secret@example.org/', 'https://exa%6dple.org/'):
            with self.subTest(url=url):
                self.copy('domestic')
                self.mutate('domestic', 'observations.jsonl', lambda rows: rows[0].__setitem__('source_url', url))
                self.rehash_manifest('domestic', 'observations.jsonl')
                with self.assertRaisesRegex(ValueError, 'URL|authority'):
                    index.build(self.private, CANON, self.pin('domestic'))

    def test_missing_quote_needs_explicit_permission_and_is_not_synthesized(self):
        self.copy('domestic')
        self.mutate('domestic', 'observations.jsonl', lambda rows: rows[0].pop('quote'))
        self.rehash_manifest('domestic', 'observations.jsonl')
        with self.assertRaisesRegex(ValueError, 'quote'):
            index.build(self.private, CANON, self.pin('domestic'))
        self.mutate('domestic', 'observations.jsonl', lambda rows: rows[0].__setitem__('quote_absence_permitted', True))
        self.rehash_manifest('domestic', 'observations.jsonl')
        result = index.build(self.private, CANON, self.pin('domestic'))
        self.assertNotIn('quote_sha256', result['leads'][0])

    def test_bad_canonical_identity_or_parent_batch_fails(self):
        self.copy('international')
        for field, value in (('legal_name', 'WRONG'), ('batch_id', 'international-01')):
            with self.subTest(field=field):
                self.copy('international')
                self.mutate('international', 'observations.jsonl', lambda rows: rows[0].__setitem__(field, value))
                self.rehash_manifest('international', 'observations.jsonl')
                with self.assertRaisesRegex(ValueError, 'identity|membership'):
                    index.build(self.private, CANON, self.pin('international'))

    def test_producer_summary_and_zero_status_cannot_override_actual_rows(self):
        self.copy('domestic')
        self.mutate('domestic', 'manifest.json', lambda m: m.__setitem__('unique_company_leads', 4))
        with self.assertRaisesRegex(ValueError, 'summary'):
            index.build(self.private, CANON, self.pin('domestic'))
        self.copy('domestic')
        self.mutate('domestic', 'coverage.jsonl', lambda rows: rows[0].__setitem__('outcome', 'research_only_pending_independent_review'))
        self.rehash_manifest('domestic', 'coverage.jsonl')
        with self.assertRaisesRegex(ValueError, 'status'):
            index.build(self.private, CANON, self.pin('domestic'))

    def test_prior_zero_is_verified_not_just_declared(self):
        self.copy('international')
        self.mutate('international', 'coverage.jsonl', lambda rows: rows[0]['previous_coverage'].__setitem__('previous_observation_count', 1))
        self.rehash_manifest('international', 'coverage.jsonl')
        with self.assertRaisesRegex(ValueError, 'prior'):
            index.build(self.private, CANON, self.pin('international'))


if __name__ == '__main__':
    unittest.main()
