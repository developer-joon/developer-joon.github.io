"""Fail-closed ingress regressions; private artifacts are never committed."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
from unittest import mock
import unittest

HERE = Path(__file__).resolve().parent
BASE = HERE.parents[1]
PRIVATE = Path(os.environ.get('HERMES_HOME', Path.home() / '.hermes')) / 'data/benefit-batch-wave/three-country-pilot'
spec = importlib.util.spec_from_file_location('pilot_ingress', HERE / 'pilot_ingress.py')
pilot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)


class PilotIngressTest(unittest.TestCase):
    def test_real_private_sources_and_disjoint_assignment(self):
        summary, rows = pilot.validate(PRIVATE, BASE)
        self.assertEqual(summary['counts'], {'KR': 100, 'JP': 100, 'US': 28})
        self.assertEqual(summary['employment_verified'], 0)
        self.assertEqual(summary['source_snapshot_date'], {'KR': None, 'JP': '2026-10-30', 'US': None})
        self.assertEqual(summary['candidate_generated_at']['KR'], '2026-11-17T10:17:22.237510+00:00')
        self.assertIsNone(summary['candidate_generated_at']['US'])
        self.assertIsNone(summary['identity_observed_at']['KR'])
        self.assertEqual(json.loads((HERE / 'assignment-summary.v1.json').read_text()), summary)
        self.assertEqual(len(rows), 228)
        self.assertEqual(len({r['company_id'] for r in rows}), 228)
        self.assertTrue(all(r['status'] == 'identity_only' for r in rows))
        self.assertTrue(all(r['worker'] in ('KR', 'JP', 'US') for r in rows))

    def mutate(self, relative, change):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for country in ('kr', 'jp', 'us'):
                for src in (PRIVATE / country).rglob('*'):
                    if src.is_file():
                        name = src.relative_to(PRIVATE)
                        dst = root / name
                        dst.parent.mkdir(parents=True, exist_ok=True)
                        os.link(src, dst) if name.suffix in ('.xlsx', '.zip') else shutil.copyfile(src, dst)
            p = root / relative
            value = json.loads(p.read_text())
            change(value)
            p.write_text(json.dumps(value))
            old = pilot.INPUTS[relative]
            pilot.INPUTS[relative] = pilot.digest(p)  # self-consistent rehash must still fail
            inventory_row = next(r for r in pilot.PRIVATE_INVENTORY['authoritative'] if r['path'] == relative)
            inventory_row['sha256'] = pilot.INPUTS[relative]
            try:
                with self.assertRaises(ValueError):
                    pilot.validate(root, BASE)
            finally:
                pilot.INPUTS[relative] = old
                inventory_row['sha256'] = old

    def test_atomic_assignment_replace_failure_preserves_existing_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            destination = root / 'assignment.v1.json'
            destination.write_bytes(b'original assignment')
            with mock.patch.object(pilot, 'validate', return_value=({'safe': True}, [])), \
                    mock.patch.object(pilot, 'check_summary'), \
                    mock.patch.object(pilot.os, 'replace', side_effect=OSError('simulated replace failure')):
                with self.assertRaises(OSError):
                    pilot.write_assignment(root, BASE)
            self.assertEqual(destination.read_bytes(), b'original assignment')
            self.assertEqual([p.name for p in root.iterdir()], ['assignment.v1.json'])

    def test_assignment_hardlink_target_is_not_modified(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / 'protected-target.json'
            target.write_bytes(b'protected content')
            destination = root / 'assignment.v1.json'
            os.link(target, destination)
            with mock.patch.object(pilot, 'validate', return_value=({'safe': True}, [])), \
                    mock.patch.object(pilot, 'check_summary'):
                pilot.write_assignment(root, BASE)
            self.assertEqual(target.read_bytes(), b'protected content')
            self.assertNotEqual(destination.stat().st_ino, target.stat().st_ino)
            self.assertEqual(destination.stat().st_mode & 0o777, 0o600)

    def test_unrestricted_custody_directory_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            root.chmod(0o755)
            with mock.patch.object(pilot, 'validate', return_value=({'safe': True}, [])), \
                    mock.patch.object(pilot, 'check_summary'):
                with self.assertRaisesRegex(ValueError, 'private custody permissions'):
                    pilot.write_assignment(root, BASE)
            self.assertFalse((root / 'assignment.v1.json').exists())

    def test_public_summary_drift_rejected(self):
        summary, _ = pilot.validate(PRIVATE, BASE)
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / 'summary.json'
            output.write_text(json.dumps({**summary, 'employment_verified': 228}))
            with self.assertRaisesRegex(ValueError, 'public summary drift'):
                pilot.check_summary(summary, output)

    def test_duplicate_ids_rejected(self):
        self.mutate('us/candidate-pilot.json', lambda x: x['candidates'].__setitem__(-1, copy.deepcopy(x['candidates'][0])))

    def test_raw_hash_rejected(self):
        self.mutate('kr/pilot-manifest.json', lambda x: x.update(source_sha256='0' * 64))

    def test_worker_claim_rejected(self):
        def alter(x):
            x['candidates'][0]['company_id'] = 'JP-CN-1010001119515'
        self.mutate('us/candidate-pilot.json', alter)

    def test_selection_inflation_rejected(self):
        self.mutate('kr/pilot-manifest.json', lambda x: x.update(selected_count=101))

    def test_raw_response_claim_rejected(self):
        self.mutate('us/candidate-pilot.json', lambda x: x['candidates'][0].update(http_status=200))

    def test_jp_selected_identity_fields_rejected_even_when_rehashed(self):
        for key, value in (('close_date', '2026-01-01'), ('latest', '0'),
                           ('search_exclusion', '1'), ('kind_code', '999')):
            with self.subTest(field=key):
                self.mutate('jp/identity-pilot.json', lambda x: x['selected'][0].update({key: value}))

    def test_us_identity_fields_rejected_even_when_rehashed(self):
        sec = 'https' + '://data.sec.gov/submissions/CIK'
        for key, value in (('entity_type', 'foreign'), ('state_of_incorporation', 'ON'),
                           ('business_address_state_or_country', 'GB'),
                           ('source_url', 'https' + '://evil.example/submissions/CIK0000000000.json'),
                           ('source_url', 'https' + '://user:pass@data.sec.gov/submissions/CIK0000000000.json'),
                           ('source_url', sec + '9999999999.json')):
            with self.subTest(field=key, case=value[:15]):
                self.mutate('us/candidate-pilot.json', lambda x: x['candidates'][0].update({key: value}))

    def test_us_missing_ticker_extraction_digest_rejected_even_when_rehashed(self):
        self.mutate('us/candidate-pilot.json', lambda x: x.update(sec_ticker_extracted_sha256=None))

    def test_missing_or_changed_auxiliary_receipt_rejected(self):
        for name in ('jp/citation-ledger.json', 'us/sec-probes.jsonl', 'us/sec-probes-v2.jsonl'):
            with self.subTest(name=name):
                with tempfile.TemporaryDirectory() as tmp:
                    root = Path(tmp)
                    for country in ('kr', 'jp', 'us'):
                        shutil.copytree(PRIVATE / country, root / country)
                    (root / name).unlink()
                    with self.assertRaises(ValueError):
                        pilot.validate(root, BASE)
                    shutil.copyfile(PRIVATE / name, root / name)
                    (root / name).write_bytes(b'altered receipt')
                    with self.assertRaises(ValueError):
                        pilot.validate(root, BASE)

    def test_unlisted_and_symlink_private_file_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for country in ('kr', 'jp', 'us'):
                shutil.copytree(PRIVATE / country, root / country)
            unexpected = root / 'us' / 'extra.json'
            unexpected.write_text('{}')
            with self.assertRaises(ValueError):
                pilot.validate(root, BASE)
            unexpected.unlink()
            receipt = root / 'jp' / 'citation-ledger.json'
            receipt.unlink()
            receipt.symlink_to(PRIVATE / 'jp/citation-ledger.json')
            with self.assertRaises(ValueError):
                pilot.validate(root, BASE)

    def test_base_population_source_hashes_rejected(self):
        for name in ('companies.jsonl', 'series-batches.jsonl', 'population-protocol.json'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as tmp:
                base = Path(tmp)
                public_pins = [p for p in pilot.BASELINE if not p.startswith('acquisition/expansion/')]
                for pinned in (*public_pins, 'companies.jsonl', 'series-batches.jsonl', 'population-protocol.json'):
                    target = base / pinned
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.symlink_to(BASE / pinned)
                target = base / name
                target.unlink()
                target.write_bytes(b'changed source')
                with self.assertRaises(ValueError):
                    pilot.validate(PRIVATE, base)


if __name__ == '__main__':
    unittest.main()
