"""Versioned second expansion identity inventory, independent of v1."""
import copy
import hashlib
import importlib.util
import json
import os
import pathlib
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SPEC = importlib.util.spec_from_file_location('expansion_identity_v2', HERE / 'identity_ledger_v2.py')
assert SPEC is not None and SPEC.loader is not None
PRIVATE = pathlib.Path(os.environ['EXPANSION_V2_INPUT_ROOT']) if os.getenv('EXPANSION_V2_INPUT_ROOT') else None


@unittest.skipUnless(PRIVATE, 'set EXPANSION_V2_INPUT_ROOT to restricted second-wave inputs')
class IdentityLedgerV2Test(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(cls.module)

    def setUp(self):
        assert PRIVATE is not None
        self.manifest = json.loads((HERE / 'source-manifest.v2.json').read_text())
        self.us = json.loads((PRIVATE / 'expansion-us-second-candidates.json').read_text())
        self.kr = json.loads((PRIVATE / 'expansion-kr-second-candidates.json').read_text())

    def build(self, us=None, kr=None, manifest=None, repin=True):
        with tempfile.TemporaryDirectory() as folder:
            folder = pathlib.Path(folder)
            sources = [('us', us if us is not None else self.us), ('kr', kr if kr is not None else self.kr)]
            m = copy.deepcopy(manifest if manifest is not None else self.manifest)
            for key, value in sources:
                path = folder / f'{key}.json'
                path.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
                if repin:
                    m['sources'][key]['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
            (folder / 'manifest.json').write_text(json.dumps(m))
            return self.module.compile_ledger(folder / 'us.json', folder / 'kr.json',
                                              folder / 'manifest.json', ROOT / 'companies.jsonl',
                                              ROOT / 'series-batches.jsonl', self.module.ARCHIVE / 'candidates.v1.jsonl')

    def test_real_inventory_deterministic_exact_35_and_no_private_content(self):
        expected = (self.module.ARCHIVE / 'candidates.v2.jsonl').read_bytes()
        self.assertEqual(expected, self.module.compile_ledger(
            PRIVATE / 'expansion-us-second-candidates.json',
            PRIVATE / 'expansion-kr-second-candidates.json', HERE / 'source-manifest.v2.json',
            ROOT / 'companies.jsonl', ROOT / 'series-batches.jsonl', self.module.ARCHIVE / 'candidates.v1.jsonl'))
        rows = [json.loads(line) for line in expected.splitlines()]
        self.assertEqual(len(rows), 35)
        self.assertEqual([sum(r['jurisdiction'] == j for r in rows) for j in ('US', 'KR')], [25, 10])
        self.assertEqual(len({r['company_id'] for r in rows}), 35)
        self.assertEqual({r['identity_status'] for r in rows}, {'identity_candidate'})
        self.assertEqual({r['review_status'] for r in rows}, {'research_only'})
        self.assertEqual({r['schema_version'] for r in rows}, {'expansion-identity-v2'})
        self.assertEqual(set(rows[0]), {'schema_version', 'company_id', 'legal_name', 'jurisdiction',
                        'official_identity_url', 'source_date', 'canonical_companies_sha256',
                        'identity_status', 'review_status'})
        self.assertNotIn(str(PRIVATE).encode(), expected)
        self.assertNotIn(b'quote', expected)
        self.assertNotIn(b'careers', expected)

    def test_unpinned_source_rejected(self):
        with self.assertRaisesRegex(ValueError, 'pin'):
            self.build(us={**self.us, 'status': 'changed'}, repin=False)

    def test_original_or_v1_id_collision_rejected(self):
        for company_id in ('US-CIK0001601046', 'US-CIK0001318605'):
            with self.subTest(company_id=company_id):
                us = copy.deepcopy(self.us)
                us['candidates'][0]['company_id'] = company_id
                us['candidates'][0]['cik'] = company_id.removeprefix('US-CIK')
                us['candidates'][0]['sec_submissions_url'] = f'https://data.sec.gov/submissions/CIK{us["candidates"][0]["cik"]}.json'
                with self.assertRaisesRegex(ValueError, 'collision'):
                    self.build(us=us)

    def test_original_or_v1_normalized_name_collision_rejected(self):
        for name in (' keysight technologies, INC. ', 'TESLA INC'):
            with self.subTest(name=name):
                us = copy.deepcopy(self.us)
                us['candidates'][0]['sec_official_name'] = name
                with self.assertRaisesRegex(ValueError, 'collision'):
                    self.build(us=us)

    def test_duplicate_second_candidate_rejected(self):
        us = copy.deepcopy(self.us)
        us['candidates'][1] = copy.deepcopy(us['candidates'][0])
        with self.assertRaisesRegex(ValueError, 'collision'):
            self.build(us=us)

    def test_malformed_crn_rejected(self):
        kr = copy.deepcopy(self.kr)
        kr['verified_new_candidates'][0]['official_crn'] = '110111-0000000'
        with self.assertRaisesRegex(ValueError, 'CRN'):
            self.build(kr=kr)

    def test_wrong_official_url_rejected(self):
        kr = copy.deepcopy(self.kr)
        kr['verified_new_candidates'][0]['official_source_url'] = 'https://englishdart.fss.or.kr@evil.example/dsbc001/selectPopup.ax?selectKey=00907864'
        with self.assertRaisesRegex(ValueError, 'URL'):
            self.build(kr=kr)

    def test_provenance_and_first_pool_pin_rejected(self):
        for key, value in [('schema_version', 'unknown'), ('first_pool_sha256', '0'*64)]:
            with self.subTest(key=key):
                us = copy.deepcopy(self.us)
                us[key] = value
                with self.assertRaisesRegex(ValueError, 'provenance|pin'):
                    self.build(us=us)

    def test_count_mismatch_rejected(self):
        kr = copy.deepcopy(self.kr)
        kr['verified_new_candidates'].pop()
        with self.assertRaisesRegex(ValueError, 'count'):
            self.build(kr=kr)

    def test_first_ledger_and_canonical_pin_rejected(self):
        for section, key in [('prior', 'candidates.v1.jsonl'), ('canonical', 'companies.jsonl')]:
            with self.subTest(section=section):
                m = copy.deepcopy(self.manifest)
                m[section][key] = '0'*64
                with self.assertRaisesRegex(ValueError, 'pin'):
                    self.build(manifest=m)


if __name__ == '__main__':
    unittest.main()
