import csv
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / "scripts" / "materialize-company-benefits-population.py"


def load_module():
    spec = importlib.util.spec_from_file_location("population_materializer", MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class MaterializerTests(unittest.TestCase):
    def test_repository_preserves_all_eleven_non_december_korean_evidence_dates(self):
        path = ROOT / "docs" / "research" / "company-benefits" / "population" / "domestic-eligible.jsonl"
        records = {item["company_id"]: item for item in (json.loads(line) for line in path.read_text().splitlines())}
        expected = {
            "KR-CRN-1101110035108": "2024-09-30", "KR-CRN-1201110002022": "2024-09-30",
            "KR-CRN-1101112507551": "2024-06-30", "KR-CRN-1701110021816": "2024-03-31",
            "KR-CRN-1741110000098": "2024-06-30", "KR-CRN-1801110054659": "2024-06-30",
            "KR-CRN-1201110046476": "2024-03-31", "KR-CRN-1243110000250": "2024-11-30",
            "KR-CRN-1101110006612": "2024-03-31", "KR-CRN-1701110039207": "2024-06-30",
            "KR-CRN-1101110542484": "2024-03-31",
        }
        self.assertEqual(expected, {company_id: records[company_id]["employer_evidence"]["fiscal_period_end"] for company_id in expected})

    def test_domestic_preserves_non_december_employee_evidence_period(self):
        materializer = load_module()
        row = {"entity_id": "KR-CRN-1101110016249", "legal_registration_number": "1101110016249", "legal_name": "Test", "is_financial_sector": "False", "revenue_krw": "200000000000", "assets_krw": "1", "revenue_basis": "standalone", "assets_basis": "standalone", "employee_max_reported_row_total": "2", "positive_employee_rows": "1", "employee_evidence_dates": "2024-06-30", "filing_name": "Test", "stock_code": "000001", "legal_id_source_url": "https://dart.fss.or.kr/dsae001/downloadExcel.do", "employee_source_url": "https://opendart.fss.or.kr/disclosureinfo/biz/ExcelDownload.do", "financial_source_url": "https://opendart.fss.or.kr/disclosureinfo/fnltt/dwld/main.do"}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "kr.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=row); writer.writeheader(); writer.writerow(row)
            record = materializer.load_domestic(path)[0]
        self.assertEqual("2024-06-30", record["employer_evidence"]["fiscal_period_end"])
        self.assertEqual("2024-06-30", record["employer_evidence"]["filing_date"])

    def test_international_excludes_subsidiary_attribution_and_preserves_scope(self):
        materializer = load_module()
        base = {"jurisdiction":"US","legal_id":"CIK1","legal_name":"Registrant","financial_class":"false","fiscal_period_end":"2025-12-31","filed":"2026-02-01","accepted":"2026-02-01 12:00:00.0","revenue_usd":"2000000000","assets_usd":"1","financial_dataset_url":"https://www.sec.gov/q.zip","financial_dataset_sha256":"a"*64,"financial_fact_locator":"num.txt:x","employee_count":"10","employee_scope":"filing_entity_total","employee_evidence_quote":"Registrant employed 10 people.","employee_evidence_locator":"chars:1-2","employee_filing_url":"https://www.sec.gov/f.htm","employee_filing_sha256":"b"*64,"accession":"1"}
        rows = [base, dict(base, legal_id="CIK2", employee_evidence_quote="Our subsidiary employed 10 people.")]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "us.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=base); writer.writeheader(); writer.writerows(rows)
            records = materializer.load_international(path)
        self.assertEqual(1, len(records))
        self.assertEqual("filing_entity_total", records[0]["employment_evidence_scope"])
        self.assertIn("payroll employer", records[0]["employment_boundary_note"])
        self.assertEqual("Registrant", records[0]["selected_reporting_legal_entity"])
    def test_verified_source_digest_is_fail_closed(self):
        materializer = load_module()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "source.csv"
            path.write_bytes(b"unexpected")
            with self.assertRaisesRegex(ValueError, "source digest mismatch"):
                materializer.verify_source_digest(path, "0" * 64)

    def test_canonical_selection_ignores_source_csv_order(self):
        materializer = load_module()
        rows = [
            {"entity_id": "KR-CRN-2", "legal_registration_number": "2", "legal_name": "Beta", "is_financial_sector": "False", "revenue_krw": "200000000000", "assets_krw": "1", "revenue_basis": "standalone", "assets_basis": "standalone", "employee_max_reported_row_total": "2", "positive_employee_rows": "1", "employee_evidence_dates": "2024-12-31", "filing_name": "Beta", "stock_code": "000002", "legal_id_source_url": "https://dart.fss.or.kr/dsae001/downloadExcel.do", "employee_source_url": "https://opendart.fss.or.kr/disclosureinfo/biz/ExcelDownload.do", "financial_source_url": "https://opendart.fss.or.kr/disclosureinfo/fnltt/dwld/main.do"},
            {"entity_id": "KR-CRN-1", "legal_registration_number": "1", "legal_name": "Alpha", "is_financial_sector": "False", "revenue_krw": "200000000000", "assets_krw": "1", "revenue_basis": "standalone", "assets_basis": "standalone", "employee_max_reported_row_total": "3", "positive_employee_rows": "1", "employee_evidence_dates": "2024-12-31", "filing_name": "Alpha", "stock_code": "000001", "legal_id_source_url": "https://dart.fss.or.kr/dsae001/downloadExcel.do", "employee_source_url": "https://opendart.fss.or.kr/disclosureinfo/biz/ExcelDownload.do", "financial_source_url": "https://opendart.fss.or.kr/disclosureinfo/fnltt/dwld/main.do"},
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "kr.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=rows[0]); writer.writeheader(); writer.writerows(rows)
            forward = materializer.load_domestic(path, "2026-10-29T15:30:00Z")
            writer_rows = list(reversed(rows))
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=rows[0]); writer.writeheader(); writer.writerows(writer_rows)
            reverse = materializer.load_domestic(path, "2026-10-29T15:30:00Z")
            self.assertEqual(forward, reverse)
            self.assertEqual(sorted(item["selection_hash"] for item in forward), [item["selection_hash"] for item in forward])


if __name__ == "__main__":
    unittest.main()