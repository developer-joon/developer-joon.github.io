import csv
import importlib.util
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