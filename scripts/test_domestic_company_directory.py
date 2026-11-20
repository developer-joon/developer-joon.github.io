"""Synthetic, non-real identity fixtures for the domestic directory builder."""
import csv
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile

SCRIPT = Path(__file__).with_name('generate-domestic-company-directory.py')
spec = importlib.util.spec_from_file_location('domestic_directory', SCRIPT)
module = importlib.util.module_from_spec(spec)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class DirectoryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec.loader.exec_module(module)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.csv_path = self.root / 'jobs.csv'
        self.dart = self.root / 'dart.xlsx'
        self.base = self.root / 'manifest.json'
        self.selected = self.root / 'selected.jsonl'
        self.output = self.root / 'out'
        self.base.write_text('{"company_count":1}\n')
        self.selected.write_text(json.dumps({'registry_id': 'KR-CRN-0000000000001'}) + '\n')

    def fixture(self, rows, bridges=()):
        with self.csv_path.open('w', encoding='cp949', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['기업명','사업자번호','지역구분','종업원수','공고명','고용형태','공고등록일'])
            writer.writerows(rows)
        ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
        sheet = ET.Element(f'{{{ns}}}worksheet')
        data = ET.SubElement(sheet, f'{{{ns}}}sheetData')
        for n, (crn, bid) in enumerate(bridges, 1):
            row = ET.SubElement(data, f'{{{ns}}}row', r=str(n))
            for col, val in [('G', crn), ('H', bid)]:
                cell = ET.SubElement(row, f'{{{ns}}}c', r=f'{col}{n}', t='inlineStr')
                ET.SubElement(ET.SubElement(cell, f'{{{ns}}}is'), f'{{{ns}}}t').text = val
        with zipfile.ZipFile(self.dart, 'w') as z:
            z.writestr('xl/worksheets/sheet1.xml', ET.tostring(sheet))

    def build(self, check=False, hashes=None):
        return module.build(self.csv_path, self.dart, self.selected, self.base, self.output,
                            hashes or (digest(self.csv_path), digest(self.dart)), check=check)

    def test_latest_day_quarantine_optional_conflicts_and_alias(self):
        self.fixture([
            ['가상회사','0000000002','A','4','private title','full','2025-01-01'],
            ['가상회사','0000000002','A','5','private title','full','2026-01-01'],
            ['가상회사','0000000002','B','5','private title','full','2026-01-01'],
            ['다른회사','0000000003','C','1','private title','full','2026-01-01'],
            ['충돌회사','0000000003','C','1','private title','full','2026-01-01'],
            ['별명회사','0000000004','C','1','private title','full','2026-01-01'],
            ['불명회사','0000000005','C','1','private title','full','2026-01-01'],
        ], [('0000000000001','0000000004'), ('0000000000002','0000000005'), ('0000000000003','0000000005')])
        manifest = self.build()
        self.assertEqual(manifest['sources']['dart_bridge']['acquired_on'], '2026-11-20')
        self.assertEqual(manifest['limits']['max_shards'], 400)
        records = [r for c in manifest['chunks'] for r in json.loads((self.output / c['path']).read_text())['records']]
        self.assertEqual([r['id'] for r in records], ['KR-BIZ-0000000002','KR-BIZ-0000000005','KR-CRN-0000000000001'])
        self.assertNotIn('region', records[0]); self.assertEqual(records[0]['employee_count'], 5)
        self.assertEqual(manifest['totals']['excluded_last_day_name_conflict'], 1)
        self.assertEqual(manifest['totals']['base_aliases'], 1)
        self.assertEqual(manifest['totals']['new_records'], 2)
        self.assertEqual(manifest['totals']['job_rows'], 7)
        self.assertNotIn('private title', json.dumps(records))
        self.assertEqual(self.build(check=True), manifest)
        (self.output / manifest['chunks'][0]['path']).write_text('tamper')
        with self.assertRaises(ValueError): self.build(check=True)

    def test_invalid_ids_dates_and_unsafe_text_are_excluded(self):
        self.fixture([
            ['가상회사','123456789','A','1','x','x','2026-01-01'],
            ['가상회사','0000000002','A','1','x','x',''],
            ['<script>','0000000003','A','1','x','x','2026-01-01'],
            ['가상\x01회사','0000000004','A','1','x','x','2026-01-01'],
            ['가상회사','0000000005','A','1','x','x','2026-02-30'],
            ['가상회사','0000000006','A','1','x','x','2026-01-01'],
        ])
        manifest = self.build()
        self.assertEqual(manifest['totals']['new_records'], 1)
        self.assertEqual(manifest['totals']['candidate_unique_bid'], 1)

    def test_json_escapes_safe_punctuation_without_dropping_name(self):
        self.fixture([['가상&회사','0000000002','','','x','x','2026-01-01']])
        manifest = self.build()
        record = json.loads((self.output / manifest['chunks'][0]['path']).read_text())['records'][0]
        self.assertEqual(record['name'], '가상&회사')

    def test_hash_mismatch_fails_without_touching_previous_output(self):
        self.fixture([['가상회사','0000000002','','','x','x','2026-01-01']])
        previous = self.build()
        with self.assertRaises(ValueError): self.build(hashes=('0'*64, digest(self.dart)))
        self.assertEqual(self.build(check=True), previous)

    def test_dart_formatted_business_id_aliases_exact_digits(self):
        self.fixture([['가상회사','0000000002','','','x','x','2026-01-01']],
                     [('0000000000001','000-00-00002')])
        manifest = self.build()
        record = json.loads((self.output / manifest['chunks'][0]['path']).read_text())['records'][0]
        self.assertEqual(record['id'], 'KR-CRN-0000000000001')

    def test_ambiguous_base_bridge_does_not_alias(self):
        self.fixture([['가상회사','0000000002','','','x','x','2026-01-01']],
                     [('0000000000001','0000000002'),('0000000000002','0000000002')])
        manifest = self.build()
        record = json.loads((self.output / manifest['chunks'][0]['path']).read_text())['records'][0]
        self.assertEqual(record['id'], 'KR-BIZ-0000000002')


if __name__ == '__main__': unittest.main()
