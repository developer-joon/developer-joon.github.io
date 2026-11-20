"""Small source-shaped fixtures for the independent legal-size overlay."""
import csv
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile

SCRIPT = Path(__file__).with_name('generate-domestic-size-evidence.py')
spec = importlib.util.spec_from_file_location('domestic_size', SCRIPT)
size = importlib.util.module_from_spec(spec)
NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'


def workbook(path, sheet, rows):
    root = ET.Element(f'{{{NS}}}worksheet')
    data = ET.SubElement(root, f'{{{NS}}}sheetData')
    for index, cells in enumerate(rows, 1):
        row = ET.SubElement(data, f'{{{NS}}}row', r=str(index))
        for col, text in cells.items():
            cell = ET.SubElement(row, f'{{{NS}}}c', r=f'{col}{index}', t='inlineStr')
            ET.SubElement(ET.SubElement(cell, f'{{{NS}}}is'), f'{{{NS}}}t').text = str(text)
    with zipfile.ZipFile(path, 'w') as archive:
        archive.writestr(f'xl/worksheets/sheet{sheet}.xml', ET.tostring(root))


class SizeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec.loader.exec_module(size)

    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.ftc = self.root / 'ftc.xlsx'
        self.dart = self.root / 'dart.xlsx'
        self.mid = self.root / 'mid.csv'
        self.sme = self.root / 'sme.csv'
        self.base = self.root / 'base.json'
        self.selected = self.root / 'selected.jsonl'
        self.directory = self.root / 'directory'
        self.directory.mkdir()
        (self.directory / 'shards').mkdir()
        self.output = self.root / 'overlay'
        self.base.write_text(json.dumps({'company_shards': {
            'KR-CRN-0000000000001': {'company_id': 'KR-CRN-0000000000001'}}}) + '\n')
        self.selected.write_text(json.dumps({'registry_id':'KR-CRN-0000000000001'})+'\n')

    def fixture(self, ftc_rows=None, bridges=None, mid_rows=None, sme_rows=None, listing=None):
        ftc_rows = ftc_rows if ftc_rows is not None else [
            ('갑','Base','0000000000001'), ('갑','Affiliate','0000000000002'),
            ('을','Conflicted','0000000000003'), ('병','Conflicted','0000000000003'),
            ('갑','Exact','0000000000004'), ('갑','Mismatch','0000000000005'),
            ('갑','Orphan','0000000000006')]
        headers = [{'A':'source title'}, {'A':'as-of'}, {'A':'연번','B':'기업집단','C':'소속회사명','D':'법인등록번호','E':'금융여부'}]
        headers += [{'A':1,'B':group,'C':name,'D':crn,'E':'비금융'} for group,name,crn in ftc_rows]
        workbook(self.ftc, 4, headers)
        workbook(self.dart, 1, [{'G':crn,'H':bid} for crn,bid in (bridges if bridges is not None else [
            ('0000000000002','0000000002'),('0000000000004','0000000004'),
            ('0000000000005','0000000005')])])
        with self.mid.open('w', encoding='cp949', newline='') as f:
            writer = csv.writer(f); writer.writerow(['순번','사업자번호','업체명','내일채움공제 가입인원'])
            for i,(bid,name) in enumerate(mid_rows or [('0000000007','Mid'),('0000000008','Wrong')],1): writer.writerow([i,bid,name,1])
        with self.sme.open('w', encoding='cp949', newline='') as f:
            writer = csv.writer(f); writer.writerow(['연번','사업자번호','상호','대표자명','주소','주생산품','선정일','유효기간 종료일'])
            for i,(bid,name,expiry) in enumerate(sme_rows or [('0000000009','SME','2027-01-01'),('0000000008','Wrong','2027-01-01'),('0000000010','Old','2025-01-01')],1): writer.writerow([i,bid,name,'private person','private address','private product','2025-01-01',expiry])
        listing = listing if listing is not None else [('KR-CRN-0000000000001','Base'),('KR-BIZ-0000000002','Affiliate'),('KR-BIZ-0000000004','Exact'),('KR-BIZ-0000000005','Different'),('KR-BIZ-0000000007','Mid'),('KR-BIZ-0000000008','Different'),('KR-BIZ-0000000009','SME')]
        (self.directory / 'shards/0000.json').write_text(json.dumps({'records':[{'id':ident,'name':name,'size_class':'unclassified'} for ident,name in listing]}))
        (self.directory / 'manifest.json').write_text(json.dumps({'base_manifest_sha256':hashlib.sha256(self.base.read_bytes()).hexdigest(),'sources':{'recruitment':{'sha256':size.JOB_SHA},'dart_bridge':{'sha256':hashlib.sha256(self.dart.read_bytes()).hexdigest()}},'chunks':[{'path':'shards/0000.json','count':len(listing),'bytes':(self.directory/'shards/0000.json').stat().st_size,'sha256':hashlib.sha256((self.directory/'shards/0000.json').read_bytes()).hexdigest()}],'totals':{'listing_records':len(listing)}}))

    def build(self, check=False, hashes=None):
        paths = (self.ftc,self.dart,self.mid,self.sme)
        return size.build(*paths, self.selected, self.base, self.directory, self.output,
                          hashes=hashes or tuple(hashlib.sha256(p.read_bytes()).hexdigest() for p in paths), check=check)

    def test_exact_identity_conflicts_and_nonoverlap(self):
        self.fixture()
        manifest = self.build()
        records = json.loads((self.output/'records.json').read_text())
        labels = {r['id']:r for r in records['labels']}
        self.assertEqual(set(labels), {'KR-CRN-0000000000001','KR-BIZ-0000000002','KR-BIZ-0000000004','KR-BIZ-0000000007','KR-BIZ-0000000009'})
        self.assertEqual(labels['KR-BIZ-0000000007']['size_class'], 'mid_history')
        self.assertEqual(labels['KR-BIZ-0000000009']['size_class'], 'sme_unspecified')
        self.assertEqual(labels['KR-BIZ-0000000009']['expires_on'], '2027-01-01')
        self.assertEqual([x['id'] for x in records['ftc_only']], ['KR-CRN-0000000000006'])
        self.assertEqual(records['ftc_only'][0]['name'], 'Orphan')
        self.assertEqual(manifest['totals']['ftc_conflicting_crns'], 1)
        self.assertEqual(manifest['totals']['ftc_only'], 1)
        self.assertEqual(manifest['records']['sha256'], hashlib.sha256((self.output/'records.json').read_bytes()).hexdigest())
        self.assertEqual(manifest['base_manifest_sha256'], hashlib.sha256(self.base.read_bytes()).hexdigest())
        self.assertEqual(manifest['directory_manifest_sha256'], hashlib.sha256((self.directory/'manifest.json').read_bytes()).hexdigest())
        self.assertEqual(manifest['sources']['ftc']['as_of'], '2026-11-02')
        self.assertIn('공공누리', manifest['sources']['ftc']['license'])
        self.assertEqual(self.build(check=True), manifest)
        self.assertNotIn('private person', (self.output/'records.json').read_text())

    def test_selected_must_match_base_manifest_before_output_changes(self):
        self.fixture()
        self.build()
        original = {p.name: p.read_bytes() for p in self.output.iterdir()}
        base = {'registry_id': 'KR-CRN-0000000000001'}
        foreign = {'registry_id': 'KR-CRN-0000000000006'}  # FTC-only affiliate
        for rows in ([base, foreign], [foreign], [base, base]):
            with self.subTest(rows=rows):
                self.selected.write_text(''.join(json.dumps(row) + '\n' for row in rows))
                with self.assertRaisesRegex(ValueError, 'selected base membership mismatch') as error:
                    self.build()
                self.assertNotIn('0000000000006', str(error.exception))
                self.assertEqual({p.name: p.read_bytes() for p in self.output.iterdir()}, original)

    def test_simultaneous_classes_quarantined_and_tampering_rejected(self):
        self.fixture(mid_rows=[('0000000009','SME')])
        manifest = self.build()
        self.assertNotIn('KR-BIZ-0000000009', {r['id'] for r in json.loads((self.output/'records.json').read_text())['labels']})
        self.assertEqual(manifest['totals']['conflicting_classes'],1)
        with self.assertRaisesRegex(ValueError, 'digest mismatch'):
            self.build(hashes=('0'*64,)+tuple(hashlib.sha256(p.read_bytes()).hexdigest() for p in (self.dart,self.mid,self.sme)))
        self.assertEqual(self.build(check=True), manifest)
        (self.output/'records.json').write_text('tampered')
        with self.assertRaises(ValueError): self.build(check=True)

    def test_corporate_designator_only_is_equivalent_not_arbitrary_name(self):
        self.fixture(mid_rows=[('0000000007','(주)Mid')],
                     sme_rows=[('0000000009','SME(주)','2027-01-01'),
                               ('0000000008','Wrong(주)','2027-01-01')])
        self.build()
        labels = {r['id']:r for r in json.loads((self.output/'records.json').read_text())['labels']}
        self.assertEqual(labels['KR-BIZ-0000000007']['size_class'], 'mid_history')
        self.assertEqual(labels['KR-BIZ-0000000009']['size_class'], 'sme_unspecified')
        self.assertNotIn('KR-BIZ-0000000008', labels)

    def test_directory_source_binding_rejects_wrong_recruitment_hash(self):
        self.fixture()
        path = self.directory / 'manifest.json'
        manifest = json.loads(path.read_text())
        manifest['sources']['recruitment']['sha256'] = '0'*64
        path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, 'directory source binding mismatch'):
            self.build()
        self.assertFalse(self.output.exists())

    def test_ambiguous_dart_bridge_never_labels_bid_or_exports_affiliate(self):
        self.fixture(bridges=[('0000000000002','0000000002'),('0000000000006','0000000002'),('0000000000004','0000000004'),('0000000000005','0000000005')])
        self.build()
        records = json.loads((self.output/'records.json').read_text())
        self.assertNotIn('KR-BIZ-0000000002', {r['id'] for r in records['labels']})
        self.assertNotIn('KR-CRN-0000000000002', {r['id'] for r in records['ftc_only']})


if __name__ == '__main__': unittest.main()
