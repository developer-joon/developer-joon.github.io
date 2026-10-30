import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
def module():
    spec = importlib.util.spec_from_file_location('sec_audit', ROOT / 'scripts/sec-workforce-audit.py')
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj

class WorkforceAuditTests(unittest.TestCase):
    def test_quote_dates(self):
        audit = module()
        for quote, expected in [('As of January 3, 2026, we employed 100 people.', '2026-01-03'), ('At December 31, 2025 we had 50 employees.', '2025-12-31'), ('We currently employ 10 people.', None)]:
            self.assertEqual(expected, audit.quote_date(quote))
        with self.assertRaises(ValueError):
            audit.quote_date('As of January 3, 2026 and December 31, 2025 we employed 100 people.')

    def test_count_date_is_bounded_to_carpenter_workforce_clause(self):
        import csv
        import json
        audit = module()
        source_rows = list(csv.DictReader((audit.EXTERNAL/'corrected_strict_us_employee_eligible_ledger.csv').read_text().splitlines()))
        carpenter = next(row for row in source_rows if row['legal_name'] == 'CARPENTER TECHNOLOGY CORP')
        self.assertEqual('2026-06-30', audit.count_quote_date(carpenter['employee_evidence_quote'], carpenter['employee_count']))
        self.assertEqual('2025-12-31', audit.count_quote_date('Globally, at Dec. 31, 2025, we had approximately 48,100 full-time employees.', 48100))
        reviews = [json.loads(line) for line in (ROOT/'docs/research/company-benefits/population/independent-sec-workforce-reviews.jsonl').read_text().splitlines()]
        review = next(row for row in reviews if row['accession'] == carpenter['accession'])
        self.assertEqual('2026-06-30', review['evidence_date'])
        self.assertEqual('explicit_quote_date', review['date_basis'])

    def test_independent_review_semantics_fail_closed(self):
        import csv
        import json
        import tempfile
        audit = module()
        review_rows = [json.loads(line) for line in (ROOT/'docs/research/company-benefits/population/independent-sec-workforce-reviews.jsonl').read_text().splitlines()]
        source_rows = {row['accession']: row for row in csv.DictReader((audit.EXTERNAL/'corrected_strict_us_employee_eligible_ledger.csv').read_text().splitlines())}

        adversarial_values = [
            ('reviewed_at', 'not-a-timestamp'),
            ('reviewed_at', '2999-01-01T00:00:00Z'),
            ('reviewer_id', ''),
            ('rationale', ''),
            ('rationale', 'Reviewed and approved based on the evidence.'),
            ('date_basis', ''),
            ('date_basis', 'filing_date'),
            ('evidence_date', '1999-01-01'),
            ('filing_sha256', '0' * 64),
            ('CIK', '0000000000'),
            ('entity_entailment_confirmed', False),
            ('positive_count_confirmed', False),
            ('rejection_reason', 'approved rows cannot carry a rejection reason'),
        ]
        approved_index = next(i for i, row in enumerate(review_rows) if row['decision'] == 'approved')
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'reviews.jsonl'
            for field, value in adversarial_values:
                with self.subTest(field=field, value=value):
                    bad = [dict(row) for row in review_rows]
                    bad[approved_index][field] = value
                    path.write_text(''.join(json.dumps(row)+'\n' for row in bad))
                    with self.assertRaises(ValueError):
                        review_map = audit.reviews(path)
                        audit.workforce_date(source_rows[bad[approved_index]['accession']], review_map)

    def test_undated_review_requires_null_date_and_undated_basis(self):
        import csv
        import json
        import tempfile
        audit = module()
        review_rows = [json.loads(line) for line in (ROOT/'docs/research/company-benefits/population/independent-sec-workforce-reviews.jsonl').read_text().splitlines()]
        source_rows = {row['accession']: row for row in csv.DictReader((audit.EXTERNAL/'corrected_strict_us_employee_eligible_ledger.csv').read_text().splitlines())}
        index = next(i for i, row in enumerate(review_rows) if audit.count_quote_date(row['exact quote'], source_rows[row['accession']]['employee_count']) is None)
        self.assertIsNone(review_rows[index]['evidence_date'])
        self.assertEqual('undated_current', review_rows[index]['date_basis'])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'reviews.jsonl'
            for evidence_date, date_basis in [('undated_current', 'undated_current'), ('2026-01-01', 'undated_current'), (None, 'explicit_quote_date')]:
                with self.subTest(evidence_date=evidence_date, date_basis=date_basis):
                    bad = [dict(row) for row in review_rows]
                    bad[index]['evidence_date'] = evidence_date
                    bad[index]['date_basis'] = date_basis
                    path.write_text(''.join(json.dumps(row)+'\n' for row in bad))
                    with self.assertRaises(ValueError):
                        review_map = audit.reviews(path)
                        audit.workforce_date(source_rows[bad[index]['accession']], review_map)

    def test_compact_audit_and_population(self):
        audit = module()
        root = ROOT / 'docs/research/company-benefits'
        audit.validate(root)
        import json
        rows = [json.loads(x) for x in (root/'population/international-eligible.jsonl').read_text().splitlines()]
        self.assertEqual(1060, len(rows))
        rejected_reviews = [
            json.loads(x) for x in (root/'population/independent-sec-workforce-reviews.jsonl').read_text().splitlines()
            if json.loads(x)['decision'] == 'rejected'
        ]
        rejected_names = {item['company legal name'] for item in rejected_reviews}
        for ledger in ('international-eligible.jsonl', 'international-selected.jsonl', 'international-effective-selected.jsonl'):
            ledger_rows = [json.loads(x) for x in (root/'population'/ledger).read_text().splitlines()]
            self.assertTrue(audit.REJECTED.isdisjoint(r['employer_evidence']['accession'] for r in ledger_rows), ledger)
            self.assertTrue(rejected_names.isdisjoint(r['legal_name'] for r in ledger_rows), ledger)

    def test_named_dates_and_tampering(self):
        import json
        import shutil
        import tempfile
        audit = module()
        source = ROOT/'docs/research/company-benefits'
        expected = {'BERKLEY W R CORP':'2026-01-15', 'EVEREST REINSURANCE HOLDINGS INC':'2026-02-01', "DILLARD'S, INC.":'2025-12-20', 'SLEEP NUMBER CORP':'2026-01-03'}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)/'research'
            shutil.copytree(source, root)
            path = root/'population/international-eligible.jsonl'
            original = path.read_text()
            rows = [json.loads(x) for x in original.splitlines()]
            for name, value in expected.items():
                record = next(x for x in rows if x['legal_name']==name)
                self.assertEqual(value, record['employer_evidence']['evidence_date'])
                record['employer_evidence']['evidence_date'] = record['scale_metric']['fiscal_year_end']
                path.write_text(''.join(json.dumps(x)+'\n' for x in rows))
                with self.assertRaisesRegex(ValueError, 'date mismatch'):
                    audit.validate(root)
                record['employer_evidence']['evidence_date'] = value
            path.write_text(original)
            compact = root/'population/independent-sec-workforce-reviews.jsonl'
            compact.write_text(compact.read_text().replace('independent-sec-workforce-review', 'pretend-reviewer', 1))
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                audit.validate(root)

    def test_review_identity_and_hashes_fail_closed(self):
        import json
        import tempfile
        audit = module()
        rows = [json.loads(x) for x in (ROOT/'docs/research/company-benefits/population/independent-sec-workforce-reviews.jsonl').read_text().splitlines()]
        self.assertEqual(163, sum(x['decision']=='approved' for x in rows))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'reviews.jsonl'
            for field, value in [('reviewer_id','other'), ('quote_sha256','0'*64), ('accession',rows[1]['accession'])]:
                bad = [dict(x) for x in rows]; bad[0][field]=value
                path.write_text(''.join(json.dumps(x)+'\n' for x in bad))
                with self.assertRaises(ValueError): audit.reviews(path)

    def test_manifest_pins_counts_and_exclusions_tampering(self):
        import json
        import shutil
        import tempfile
        audit = module()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)/'research'
            shutil.copytree(ROOT/'docs/research/company-benefits', root)
            path = root/'population/acquisition-audit-manifest.json'
            original = json.loads(path.read_text())
            for key in ['counts', 'external_pins']:
                bad = json.loads(json.dumps(original))
                if key=='counts': bad[key]['excluded']=670
                else: bad[key][0]['sha256']='0'*64
                path.write_text(json.dumps(bad))
                with self.assertRaises(ValueError): audit.validate(root)
            path.write_text(json.dumps(original))
            path = root/'population/international-eligible.jsonl'
            rows = [json.loads(x) for x in path.read_text().splitlines()]
            rows[0]['employer_evidence']['accession'] = sorted(audit.REJECTED)[0]
            path.write_text(''.join(json.dumps(x)+'\n' for x in rows))
            with self.assertRaisesRegex(ValueError,'excluded'): audit.validate(root)

    def test_new_receipt_and_old_identities(self):
        import json
        import tempfile
        spec = importlib.util.spec_from_file_location('verifier', ROOT/'scripts/verify-company-benefits-ledger.py')
        verifier = importlib.util.module_from_spec(spec); spec.loader.exec_module(verifier)
        protocol = {'version':'4.0.0'}
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'receipt.json'
            receipt={'schema_version':'1','protocol_version':'4.0.0','freeze_manifest_sha256':'a'*64,'review_status':'review_pending','issued_at':'2026-10-30T00:00:00Z'}
            path.write_text(json.dumps(receipt)); errors=[]
            self.assertEqual({},verifier.external_freeze_anchor(path,protocol,errors))
            self.assertIn('not approved', ' '.join(errors))
            receipt.update(review_status='approved',protocol_version='3.1.1');path.write_text(json.dumps(receipt));errors=[]
            verifier.external_freeze_anchor(path,protocol,errors)
            self.assertIn('protocol identity mismatch',' '.join(errors))

    def test_deterministic_materialization_twice(self):
        import hashlib
        import tempfile
        spec=importlib.util.spec_from_file_location('materializer',ROOT/'scripts/materialize-company-benefits-population.py')
        m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
        audit=module()
        cache=Path('/home/bread/.hermes/profiles/conan/cache/scratch')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            (root/'population-protocol.json').write_bytes((ROOT/'docs/research/company-benefits/population-protocol.json').read_bytes())
            args=(cache/'korea-no-key-acquisition/korean_fully_qualifying_entities.csv',audit.EXTERNAL/'corrected_strict_us_employee_eligible_ledger.csv',root,cache/'international-open-acquisition/threshold_latest/acquisition_manifest.json',cache/'international-open-acquisition/threshold_latest/filing_evidence_manifest.csv')
            m.materialize(*args)
            first={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
            m.materialize(*args)
            self.assertEqual(first,{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()})
            audit.validate(root)
            self.assertEqual(b'',(root/'benefit-claims.jsonl').read_bytes())

    def test_renderer_refuses_pending_refrozen_batch(self):
        import tempfile
        from datetime import date
        from unittest import mock
        spec=importlib.util.spec_from_file_location('renderer',ROOT/'scripts/render-company-benefits-drafts.py')
        renderer=importlib.util.module_from_spec(spec);spec.loader.exec_module(renderer)
        verifier=renderer.load_verifier()
        real_verify=verifier.verify_workspace
        root=ROOT/'docs/research/company-benefits'
        anchor=verifier.sha256((root/'population/freeze-manifest.json').read_bytes())
        verifier.verify_workspace=lambda *args, **kwargs: real_verify(*args, **kwargs, approved_freeze_anchors={'4.0.0':anchor})
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(renderer,'load_verifier',return_value=verifier):
            with self.assertRaisesRegex(ValueError, 'pending'):
                renderer.render_batch(root,Path(tmp),'international',1,as_of=date(2026,10,30))

    def test_audit_manifest_records_exact_count_and_role_for_every_artifact(self):
        import json
        manifest = json.loads((ROOT/'docs/research/company-benefits/population/acquisition-audit-manifest.json').read_text())
        entries = manifest['external_pins'] + manifest['committed_copies']
        self.assertTrue(entries)
        for entry in entries:
            self.assertIsInstance(entry['count'], int, entry)
            self.assertGreater(entry['count'], 0, entry)
            self.assertIn(entry['role'], {'external_audit_artifact', 'repo_compact_copy'}, entry)
        self.assertEqual({'repo_compact_copy'}, {item['role'] for item in manifest['committed_copies']})
        self.assertEqual({'external_audit_artifact'}, {item['role'] for item in manifest['external_pins']})

    def test_company_schema_requires_workforce_date_and_basis(self):
        import json
        schema = json.loads((ROOT/'docs/research/company-benefits/schema/company.schema.json').read_text())
        employer_requirements = [
            item['then']['properties']['employer_evidence']['required']
            for item in schema['allOf']
            if 'employer_evidence' in item.get('then', {}).get('properties', {})
        ]
        self.assertTrue(employer_requirements)
        self.assertIn('evidence_date', employer_requirements[0])
        self.assertIn('date_basis', employer_requirements[0])
