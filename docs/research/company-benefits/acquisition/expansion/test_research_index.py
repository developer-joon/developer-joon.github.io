"""Fail-closed, audit-only expansion research index regressions."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('expansion_research_index', HERE / 'research_index.py')
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)
ROOT = Path(os.environ.get('EXPANSION_RESEARCH_INPUT_ROOT', str(Path(os.environ.get('HERMES_HOME', Path.home() / '.hermes')) / 'data/benefit-batch-wave/expansion-research')))


class ResearchIndexTest(unittest.TestCase):
    def setUp(self):
        self.pins = json.loads((module.ARCHIVE / 'research-inputs.v1.json').read_text())

    def build(self, root=ROOT, pins=None):
        return module.build(root, self.pins if pins is None else pins)

    def link_other_shards(self, root, changed):
        for pin in self.pins['shards']:
            if pin['shard'] != changed:
                (root / pin['shard']).symlink_to(ROOT / pin['shard'], target_is_directory=True)

    def test_exact_population_and_quote_free_output(self):
        data = self.build()
        rows = [json.loads(s) for s in data.splitlines()]
        self.assertEqual((len(rows), sum(r['raw_research_rows'] for r in rows)), (71, 691))
        self.assertEqual([r['company_id'] for r in rows], sorted(r['company_id'] for r in rows))
        self.assertEqual(sum(r['private_http_source_count'] for r in rows), 18)
        self.assertEqual(len({r['company_id'] for r in rows}), 71)
        self.assertTrue(all(r['status'] == 'research_only' and r['approved_benefits'] == 0 for r in rows))
        self.assertFalse(any(b'http://' in data or (str(Path.home()).encode() + b'/') in data for _ in [0]))
        self.assertEqual(module.check(module.ARCHIVE / 'research-index.v1.jsonl', ROOT, self.pins), (71, 691))
        private = (ROOT / 'kr-0' / 'observations.jsonl').read_text()
        self.assertNotIn(json.loads(private.splitlines()[0])['quote'], data.decode())
        self.assertNotIn(json.loads(private.splitlines()[0])['statement'], data.decode())

    def mutation(self, shard, filename, change, refresh_producer=False, reject=True):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.link_other_shards(root, shard)
            dest = root / shard
            dest.mkdir()
            for name in ('manifest.json', 'coverage.jsonl', 'observations.jsonl'):
                (dest / name).write_bytes((ROOT / shard / name).read_bytes())
            path = dest / filename
            change(path)
            pins = copy.deepcopy(self.pins)
            pin = next(p for p in pins['shards'] if p['shard'] == shard)
            if refresh_producer:
                manifest = json.loads((dest / 'manifest.json').read_text())
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                if isinstance(manifest.get('files', {}).get(filename), dict):
                    manifest['files'][filename]['sha256'] = digest
                else:
                    for key in ('files_sha256', 'outputs_sha256'):
                        if filename in manifest.get(key, {}):
                            manifest[key][filename] = digest
                (dest / 'manifest.json').write_text(json.dumps(manifest))
                pin['files']['manifest.json'] = hashlib.sha256((dest / 'manifest.json').read_bytes()).hexdigest()
            pin['files'][filename] = hashlib.sha256(path.read_bytes()).hexdigest()
            if reject:
                with self.assertRaises(ValueError):
                    self.build(root, pins)
            else:
                return self.build(root, pins)

    def test_tamper_rejected_against_pin(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.link_other_shards(root, 'us-0')
            dest = root / 'us-0'
            dest.mkdir()
            for name in ('manifest.json', 'coverage.jsonl', 'observations.jsonl'):
                (dest / name).write_bytes((ROOT / 'us-0' / name).read_bytes())
            with (dest / 'observations.jsonl').open('ab') as out:
                out.write(b'\n')
            with self.assertRaisesRegex(ValueError, 'pin'):
                self.build(root)

    def test_duplicate_company_id_even_with_rehashed_producer(self):
        def change(path):
            lines = path.read_text().splitlines()
            row = json.loads(lines[1]); row['company_id'] = json.loads(lines[0])['company_id']
            lines[1] = json.dumps(row)
            path.write_text('\n'.join(lines) + '\n')
        self.mutation('us-0', 'coverage.jsonl', change, True)

    def test_missing_observation_even_with_rehashed_producer(self):
        def change(path):
            path.write_text('\n'.join(path.read_text().splitlines()[1:]) + '\n')
        self.mutation('us-0', 'observations.jsonl', change, True)

    def test_quote_and_private_path_never_projected(self):
        def change(path):
            lines = path.read_text().splitlines()
            row = json.loads(lines[0]); row['quote'] = 'SECRET QUOTE'; row['statement'] = '/home/bread/private/text'
            lines[0] = json.dumps(row); path.write_text('\n'.join(lines) + '\n')
        data = self.mutation('us-0', 'observations.jsonl', change, True, False)
        self.assertNotIn(b'SECRET QUOTE', data)
        self.assertNotIn(b'/home/bread/private/text', data)
        self.assertNotIn(b'quote', data)
        self.assertNotIn(b'statement', data)

    def test_http_only_url_is_digest_not_locator(self):
        rows = [json.loads(s) for s in self.build().splitlines()]
        http = [r for r in rows if r['private_http_source_count']]
        self.assertTrue(http)
        self.assertTrue(all(r['private_http_source_sha256'] and not r['source_urls'] for r in http))

    def test_credential_url_rejected_with_updated_hashes(self):
        def change(path):
            lines = path.read_text().splitlines()
            row = json.loads(lines[0]); row['source_url'] = 'https://user:password@example.org/benefits'
            lines[0] = json.dumps(row); path.write_text('\n'.join(lines) + '\n')
        self.mutation('us-0', 'observations.jsonl', change, True)

    def test_manifest_input_pin_and_order_fail_closed(self):
        pins = copy.deepcopy(self.pins)
        pins['shards'][0]['company_ids'].reverse()
        with self.assertRaises(ValueError):
            self.build(pins=pins)
        pins = copy.deepcopy(self.pins)
        pins['shards'][0]['files']['manifest.json'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'pin'):
            self.build(pins=pins)

    def test_index_tamper_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'index.jsonl'
            output.write_bytes(self.build() + b'\n')
            with self.assertRaisesRegex(ValueError, 'drift'):
                module.check(output, ROOT, self.pins)


if __name__ == '__main__':
    unittest.main()
