import copy
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / "scripts" / "company_benefits_series.py"
CATEGORIES = (
    "leave", "family", "health", "growth", "housing",
    "commute", "remote", "retirement", "meals", "inclusion",
)


def load_module():
    spec = importlib.util.spec_from_file_location("company_benefits_v2_batch_contract", MODULE)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {MODULE}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fixture():
    company_ids = [f"company-{index:02d}" for index in range(25)]
    batch = {"batch_id": "domestic-01", "company_ids": company_ids}
    cells = []
    attempts = []
    for company_id in company_ids:
        for category_id in CATEGORIES:
            cell_id = f"cell::{company_id}::{category_id}"
            attempt_id = f"attempt::{company_id}::{category_id}::official-government"
            cells.append({
                "cell_id": cell_id, "company_id": company_id, "category_id": category_id,
                "state": "no_public_info", "attempt_ids": [attempt_id],
                "official_claim_ids": [], "reference_ids": [], "community_report_ids": [],
            })
            attempts.append({
                "attempt_id": attempt_id, "cell_id": cell_id, "company_id": company_id,
                "category_id": category_id, "route_id": "official-government",
                "capture_locator": f"https://captures.invalid/{company_id}/{category_id}",
                "raw_response_sha256": f"{len(attempts):064x}",
            })
    records = {
        "cells": cells, "attempts": attempts, "official_claims": [],
        "references": [], "community_reports": [], "sources": [],
    }
    return records, batch


class V2BatchContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()

    def assert_rejected(self, records, batch, pattern):
        with self.assertRaisesRegex(ValueError, pattern):
            self.module.validate_v2_batch_records(records, batch)

    def test_exposes_fail_closed_v2_batch_validator(self):
        self.assertTrue(hasattr(self.module, "validate_v2_batch_records"))

    def test_accepts_exact_250_cell_envelope(self):
        records, batch = fixture()
        self.module.validate_v2_batch_records(records, batch)

    def test_rejects_missing_duplicate_and_substituted_cells_by_set_equality(self):
        for mutation, message in (
            (lambda rows: rows.pop(), "missing.*cell|exact canonical"),
            (lambda rows: rows.__setitem__(-1, copy.deepcopy(rows[0])), "duplicate.*cell"),
            (lambda rows: rows.__setitem__(-1, {**rows[-1], "cell_id": "cell::substitute::inclusion",
                                                "company_id": "substitute"}), "substituted|unexpected.*cell"),
        ):
            with self.subTest(message=message):
                records, batch = fixture()
                mutation(records["cells"])
                self.assert_rejected(records, batch, message)

    def test_rejects_missing_attempt_and_cross_cell_copied_attempt(self):
        records, batch = fixture()
        records["attempts"].pop()
        self.assert_rejected(records, batch, "missing attempt")

        records, batch = fixture()
        records["cells"][1]["attempt_ids"] = list(records["cells"][0]["attempt_ids"])
        self.assert_rejected(records, batch, "multiple cells|cross-cell|binding mismatch")

    def test_rejects_orphan_evidence(self):
        records, batch = fixture()
        records["references"].append({
            "reference_id": "reference::orphan", "cell_id": records["cells"][0]["cell_id"],
            "company_id": records["cells"][0]["company_id"], "category_id": "leave",
            "source_id": "source::orphan",
        })
        self.assert_rejected(records, batch, "orphan reference")

    def test_rejects_unapproved_or_unfrozen_community_report(self):
        records, batch = fixture()
        cell = records["cells"][0]
        cell.update(state="community_report", community_report_ids=["community::pending"])
        records["community_reports"].append({
            "community_report_id": "community::pending", "cell_id": cell["cell_id"],
            "company_id": cell["company_id"], "category_id": cell["category_id"],
            "moderation": {"status": "pending"}, "publication_eligibility": "ineligible",
        })
        self.assert_rejected(records, batch, "approved.*frozen|community report")


if __name__ == "__main__":
    unittest.main()
