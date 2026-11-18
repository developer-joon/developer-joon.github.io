"""Fail-closed, research-only three-country source inventory contract.

Run `python3 -m unittest discover -s docs/research/company-benefits/acquisition/three_country_pilot -p 'test_*.py'`.
Run `python3 docs/research/company-benefits/acquisition/three_country_pilot/test_pilot_contract.py check`.
"""
import copy
import hashlib
import json
import os
import pathlib
import shutil
import sys
import tempfile
import unittest
from urllib.parse import urlsplit

HERE = pathlib.Path(__file__).resolve().parent
BENEFITS = HERE.parents[1]
INVENTORY = HERE / 'source-inventory.v1.json'
ARCHIVE = pathlib.Path(os.environ.get('EXPANSION_ARCHIVE_ROOT', pathlib.Path(os.environ.get('HERMES_HOME', pathlib.Path.home() / '.hermes')) / 'data/benefit-batch-wave/expansion-private-prepush'))

# The independently fixed v1 baseline; changing the JSON alone cannot repin it.
BASELINE = (
    ('companies.jsonl', 'e5888e3081d8ead3cc67c18d8e8e8007066c1c0de1c68103c59e390be77894ed', 2000, 'public'),
    ('series-batches.jsonl', '51e1ae04cc02584199de65be73e0723b808216ccc93ecea5dfdb0f3a85f95423', 80, 'public'),
    ('acquisition/expansion/candidates.v1.jsonl', '38ff846d0603b7b2d0ac07fb4ba0aa047a0e82eb139d8c88c2ee0a6607dea48e', 36, 'private'),
    ('acquisition/expansion/candidates.v2.jsonl', '34ab09582e86575954d59346ca16d1b95fb6f68287a3326be57dcae16dc98f16', 35, 'private'),
)
LOCATORS = (
    ('KR', 'DART', 'https://dart.fss.or.kr/'),
    ('US', 'SEC', 'https://www.sec.gov/edgar/search/'),
    ('JP', 'NTA', 'https://www.houjin-bangou.nta.go.jp/'),
)


def load_inventory_text(text):
    # Reject duplicate keys before dict conversion can hide an unsafe earlier value.
    def unique_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f'duplicate JSON key: {key}')
            result[key] = value
        return result
    return json.loads(text, object_pairs_hook=unique_pairs)


def validate_contract(inventory, root, archive=ARCHIVE):
    if not isinstance(inventory, dict) or set(inventory) != {'schema_version', 'purpose', 'pinned_inputs', 'sources'}:
        raise ValueError('inventory shape')
    if inventory['schema_version'] != 'three-country-pilot-sources-v1' or inventory['purpose'] != 'research_only':
        raise ValueError('inventory version/purpose')
    pins = inventory['pinned_inputs']
    if not isinstance(pins, list) or pins != [dict(path=p, sha256=h, count=n, custody=c) for p, h, n, c in BASELINE]:
        raise ValueError('pinned input count or hash mismatch')
    if not archive.is_dir() or archive.is_symlink():
        raise ValueError('private expansion archive missing or linked')
    for path, digest, count, custody in BASELINE:
        target = (root / path) if custody == 'public' else (archive / pathlib.Path(path).name)
        if not target.is_file() or target.is_symlink():
            raise ValueError(f'pinned input missing or linked: {path}')
        data = target.read_bytes()
        if hashlib.sha256(data).hexdigest() != digest or len(data.splitlines()) != count:
            raise ValueError(f'input hash/count drift: {path}')
    sources = inventory['sources']
    if not isinstance(sources, list) or len(sources) != len(LOCATORS):
        raise ValueError('source count mismatch')
    for source, (jurisdiction, authority, url) in zip(sources, LOCATORS):
        if not isinstance(source, dict) or set(source) != {'jurisdiction', 'authority', 'url', 'status'}:
            raise ValueError('source shape')
        candidate = source['url']
        if not isinstance(candidate, str):
            raise ValueError('source URL')
        parsed = urlsplit(candidate)
        if (source['jurisdiction'], source['authority'], candidate, source['status']) != (jurisdiction, authority, url, 'not_acquired') or parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port or parsed.fragment or parsed.query:
            raise ValueError('source status/URL/authority mismatch')


class PilotContractTest(unittest.TestCase):
    def setUp(self):
        self.inventory = load_inventory_text(INVENTORY.read_text(encoding='utf-8'))

    def test_real_inventory_is_research_only_and_pinned(self):
        validate_contract(self.inventory, BENEFITS)

    def test_invalid_source_status_fails(self):
        inventory = copy.deepcopy(self.inventory)
        inventory['sources'][0]['status'] = 'acquired'
        with self.assertRaises(ValueError):
            validate_contract(inventory, BENEFITS)

    def test_invalid_source_count_fails(self):
        inventory = copy.deepcopy(self.inventory)
        inventory['sources'].pop()
        with self.assertRaises(ValueError):
            validate_contract(inventory, BENEFITS)

    def test_unsafe_url_fails(self):
        for url in ('http://www.sec.gov/edgar/search/',
                    'https://www.sec.gov.evil.example/edgar/search/',
                    'https://www.sec.gov@evil.example/edgar/search/',
                    'https://www.sec.gov/edgar/search/#fragment'):
            with self.subTest(url=url):
                inventory = copy.deepcopy(self.inventory)
                inventory['sources'][1]['url'] = url
                with self.assertRaises(ValueError):
                    validate_contract(inventory, BENEFITS)

    def test_duplicate_json_key_cannot_hide_acquired_source(self):
        text = INVENTORY.read_text(encoding='utf-8').replace(
            '"status": "not_acquired"', '"status": "acquired", "status": "not_acquired"', 1)
        with self.assertRaisesRegex(ValueError, 'duplicate JSON key'):
            validate_contract(load_inventory_text(text), BENEFITS)

    def test_original_hash_drift_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            for entry in self.inventory['pinned_inputs']:
                if entry['custody'] != 'public':
                    continue
                source = BENEFITS / entry['path']
                target = root / entry['path']
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
            target = root / self.inventory['pinned_inputs'][0]['path']
            target.write_bytes(target.read_bytes() + b'\n')
            with self.assertRaises(ValueError):
                validate_contract(self.inventory, root)

    def test_private_expansion_archive_is_required_and_hash_bound(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            with self.assertRaisesRegex(ValueError, 'private expansion archive'):
                validate_contract(self.inventory, BENEFITS, root / 'missing')
            for entry in self.inventory['pinned_inputs']:
                if entry['custody'] == 'private':
                    shutil.copyfile(ARCHIVE / pathlib.Path(entry['path']).name, root / pathlib.Path(entry['path']).name)
            target = root / 'candidates.v1.jsonl'
            target.write_bytes(target.read_bytes() + b'\n')
            with self.assertRaisesRegex(ValueError, 'hash/count drift'):
                validate_contract(self.inventory, BENEFITS, root)


if __name__ == '__main__':
    if sys.argv[1:] == ['check']:
        try:
            validate_contract(load_inventory_text(INVENTORY.read_text(encoding='utf-8')), BENEFITS)
        except (ValueError, OSError) as exc:
            print(f'pilot contract rejected: {exc}', file=sys.stderr)
            sys.exit(1)
        print('pilot contract valid (research only; no source acquired)')
    else:
        unittest.main()
