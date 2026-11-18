"""Fail-closed checks for the additive, identity-only expansion inventory."""
import hashlib
import importlib.util
import json
import os
import pathlib
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SPEC = importlib.util.spec_from_file_location("expansion_identity", HERE / "identity_ledger.py")
assert SPEC is not None and SPEC.loader is not None
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)
PRIVATE = pathlib.Path(os.environ['EXPANSION_INPUT_ROOT']) if os.getenv('EXPANSION_INPUT_ROOT') else None


@unittest.skipUnless(PRIVATE, 'set EXPANSION_INPUT_ROOT to the restricted candidate input directory')
class IdentityLedgerTest(unittest.TestCase):
    def setUp(self):
        assert PRIVATE is not None
        self.manifest = json.loads((HERE / 'source-manifest.v1.json').read_text())
        self.us = json.loads((PRIVATE / 'expansion-us-candidates.json').read_text())
        self.kr = json.loads((PRIVATE / 'expansion-kr-candidates.json').read_text())
        self.canonical = ROOT / 'companies.jsonl'

    def build(self, us=None, kr=None, manifest=None, canonical=None):
        with tempfile.TemporaryDirectory() as d:
            d = pathlib.Path(d)
            for name, value in [('us.json', us or self.us), ('kr.json', kr or self.kr)]:
                (d / name).write_text(json.dumps(value, ensure_ascii=False))
            m = manifest or self.manifest
            # Mutations need an intentionally matching source pin to test deeper validation.
            m = json.loads(json.dumps(m))
            for name, key in [('us.json', 'us'), ('kr.json', 'kr')]:
                m['sources'][key]['sha256'] = hashlib.sha256((d / name).read_bytes()).hexdigest()
            (d / 'manifest.json').write_text(json.dumps(m))
            return module.compile_ledger(d / 'us.json', d / 'kr.json', d / 'manifest.json', canonical or self.canonical, ROOT / 'series-batches.jsonl')

    def test_real_inventory_has_exact_identity_only_shape_and_deterministic_bytes(self):
        a = self.build()
        self.assertEqual(a, self.build())
        rows = [json.loads(line) for line in a.decode().splitlines()]
        self.assertEqual(len(rows), 36)
        self.assertEqual(len({r['company_id'] for r in rows}), 36)
        self.assertEqual({r['jurisdiction'] for r in rows}, {'KR', 'US'})
        self.assertEqual({r['identity_status'] for r in rows}, {'identity_candidate'})
        self.assertEqual({r['review_status'] for r in rows}, {'research_only'})
        self.assertEqual(set(rows[0]), {'schema_version', 'company_id', 'legal_name', 'jurisdiction', 'official_identity_url', 'source_date', 'canonical_companies_sha256', 'identity_status', 'review_status'})
        self.assertNotIn(str(PRIVATE).encode(), a)

    def test_rejects_unpinned_input(self):
        with tempfile.TemporaryDirectory() as d:
            d = pathlib.Path(d)
            (d/'us.json').write_text(json.dumps(self.us))
            (d/'kr.json').write_text(json.dumps(self.kr))
            with self.assertRaisesRegex(ValueError, 'pin'):
                module.compile_ledger(d/'us.json', d/'kr.json', HERE/'source-manifest.v1.json', self.canonical, ROOT/'series-batches.jsonl')

    def test_existing_id_rejected(self):
        us = json.loads(json.dumps(self.us)); us['candidates'][0]['company_id'] = 'US-CIK0001601046'; us['candidates'][0]['cik'] = '0001601046'
        with self.assertRaisesRegex(ValueError, 'collision'):
            self.build(us=us)

    def test_normalized_legal_name_collision_rejected(self):
        us = json.loads(json.dumps(self.us)); us['candidates'][0]['sec_official_name'] = ' keysight technologies, INC. '
        with self.assertRaisesRegex(ValueError, 'collision'):
            self.build(us=us)

    def test_duplicate_candidate_rejected(self):
        us = json.loads(json.dumps(self.us)); us['candidates'][1] = dict(us['candidates'][0])
        with self.assertRaisesRegex(ValueError, 'duplicate|collision'):
            self.build(us=us)

    def test_malformed_identifier_rejected(self):
        kr = json.loads(json.dumps(self.kr)); kr['verified_new_candidates'][0]['official_crn'] = '110111-5119081'
        with self.assertRaisesRegex(ValueError, 'CRN'):
            self.build(kr=kr)

    def test_unsafe_authority_rejected(self):
        us = json.loads(json.dumps(self.us)); us['candidates'][0]['source_url'] = 'https://data.sec.gov@evil.example/submissions/CIK0001318605.json'
        with self.assertRaisesRegex(ValueError, 'URL'):
            self.build(us=us)

    def test_unsupported_provenance_rejected(self):
        us = json.loads(json.dumps(self.us)); us['candidates'][0]['selection_status'] = 'discovery_only'
        with self.assertRaisesRegex(ValueError, 'provenance'):
            self.build(us=us)

    def test_count_mismatch_rejected(self):
        us = json.loads(json.dumps(self.us)); us['candidates'].pop()
        with self.assertRaisesRegex(ValueError, 'count'):
            self.build(us=us)

    def test_canonical_pin_mismatch_rejected(self):
        m = json.loads(json.dumps(self.manifest)); m['canonical']['companies.jsonl'] = '0'*64
        with self.assertRaisesRegex(ValueError, 'pin'):
            self.build(manifest=m)


if __name__ == '__main__':
    unittest.main()
