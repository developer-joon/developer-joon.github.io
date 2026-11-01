import copy
import importlib.util
import json
import unittest
from pathlib import Path

from scripts.tests.benefits_v2_batch_fixture import no_public_info_records

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
                "jurisdiction": "KR",
                "state": "no_public_info", "attempt_ids": [attempt_id],
                "official_claim_ids": [], "reference_ids": [], "community_report_ids": [],
            })
            attempts.append({
                "attempt_id": attempt_id, "cell_id": cell_id, "company_id": company_id,
                "category_id": category_id, "jurisdiction": "KR", "route_id": "official-government",
                "source_ids": [],
                "capture_locator": f"https://captures.invalid/{company_id}/{category_id}",
                "raw_response_sha256": f"{len(attempts):064x}",
            })
    records = {
        "cells": cells, "attempts": attempts, "official_claims": [],
        "references": [], "community_reports": [], "sources": [],
    }
    return records, batch


def fixture_with_every_ledger():
    records, batch = fixture()
    cell = records["cells"][0]
    cell.update(
        official_claim_ids=["official::claim"],
        reference_ids=["reference::record"],
        community_report_ids=["community::report"],
    )
    binding = {
        "cell_id": cell["cell_id"], "company_id": cell["company_id"],
        "category_id": cell["category_id"],
    }
    records["official_claims"] = [{
        "claim_id": "official::claim", "jurisdiction": "KR",
        "source_ids": ["source::record"], **binding,
    }]
    records["references"] = [{
        "reference_id": "reference::record", "source_id": "source::record", **binding,
    }]
    records["community_reports"] = [{
        "community_report_id": "community::report", "source_id": "source::record",
        "moderation": {"status": "approved"}, "publication_eligibility": "eligible",
        "frozen_snapshot": {}, **binding,
    }]
    records["sources"] = [{"source_id": "source::record"}]
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

    def test_callable_validators_fail_closed_for_every_identifier_field(self):
        scalar_fields = {
            "cells": ("cell_id", "company_id", "category_id", "jurisdiction"),
            "attempts": ("attempt_id", "cell_id", "company_id", "category_id", "jurisdiction", "route_id"),
            "official_claims": ("claim_id", "cell_id", "company_id", "category_id", "jurisdiction"),
            "references": ("reference_id", "cell_id", "company_id", "category_id", "source_id"),
            "community_reports": ("community_report_id", "cell_id", "company_id", "category_id", "source_id"),
            "sources": ("source_id",),
        }
        malformed = ([], {}, None, 7, "")
        validators = (
            ("batch", lambda records, batch: self.module.validate_v2_batch_records(records, batch)),
            ("package", lambda records, batch: self.module.validate_v2_package_records(
                records, batch, ROOT / "docs/research/company-benefits")),
        )
        for validator_name, validator in validators:
            for ledger, fields in scalar_fields.items():
                for field in fields:
                    for value in malformed:
                        with self.subTest(validator=validator_name, ledger=ledger, field=field, value=value):
                            records, batch = fixture_with_every_ledger()
                            records[ledger][0][field] = value
                            with self.assertRaisesRegex(ValueError, "invalid v2 record structure"):
                                validator(records, batch)

    def test_callable_validators_fail_closed_for_every_identifier_binding(self):
        binding_fields = {
            "cells": ("attempt_ids", "official_claim_ids", "reference_ids", "community_report_ids"),
            "attempts": ("source_ids",),
            "official_claims": ("source_ids",),
        }
        malformed_elements = ([], {}, None, 7, "")
        malformed_arrays = ({}, None, 7, "not-an-array")
        validators = (
            ("batch", lambda records, batch: self.module.validate_v2_batch_records(records, batch)),
            ("package", lambda records, batch: self.module.validate_v2_package_records(
                records, batch, ROOT / "docs/research/company-benefits")),
        )
        for validator_name, validator in validators:
            for ledger, fields in binding_fields.items():
                for field in fields:
                    for value in malformed_elements:
                        with self.subTest(validator=validator_name, ledger=ledger, field=field, element=value):
                            records, batch = fixture_with_every_ledger()
                            records[ledger][0][field] = [value]
                            with self.assertRaisesRegex(ValueError, "invalid v2 record structure"):
                                validator(records, batch)
                    for value in malformed_arrays:
                        with self.subTest(validator=validator_name, ledger=ledger, field=field, array=value):
                            records, batch = fixture_with_every_ledger()
                            records[ledger][0][field] = value
                            with self.assertRaisesRegex(ValueError, "invalid v2 record structure"):
                                validator(records, batch)

    def test_callable_validators_fail_closed_for_shared_result_binding_identifiers(self):
        malformed = ([], {}, None, 7, "")
        validators = (
            ("batch", lambda records, batch: self.module.validate_v2_batch_records(records, batch)),
            ("package", lambda records, batch: self.module.validate_v2_package_records(
                records, batch, ROOT / "docs/research/company-benefits")),
        )
        for validator_name, validator in validators:
            for field in ("source_id", "company_id", "category_id"):
                for value in malformed:
                    with self.subTest(validator=validator_name, field=field, value=value):
                        records, batch = fixture_with_every_ledger()
                        attempt = records["attempts"][0]
                        attempt["shared_bulk_result_binding"] = {
                            "source_id": "source::record", "company_id": attempt["company_id"],
                            "category_id": attempt["category_id"],
                        }
                        attempt["shared_bulk_result_binding"][field] = value
                        with self.assertRaisesRegex(ValueError, "invalid v2 record structure"):
                            validator(records, batch)
            for value in ([], None, 7, "not-an-object"):
                with self.subTest(validator=validator_name, binding=value):
                    records, batch = fixture_with_every_ledger()
                    records["attempts"][0]["shared_bulk_result_binding"] = value
                    with self.assertRaisesRegex(ValueError, "invalid v2 record structure"):
                        validator(records, batch)

    def test_callable_validators_reject_malformed_record_and_batch_shapes(self):
        validators = (
            ("batch", lambda records, batch: self.module.validate_v2_batch_records(records, batch)),
            ("package", lambda records, batch: self.module.validate_v2_package_records(
                records, batch, ROOT / "docs/research/company-benefits")),
        )
        for validator_name, validator in validators:
            for ledger in self.module.V2_LEDGER_FILES:
                for value in ([], None, 7, "not-an-object"):
                    with self.subTest(validator=validator_name, ledger=ledger, value=value):
                        records, batch = fixture_with_every_ledger()
                        records[ledger][0] = value
                        with self.assertRaisesRegex(ValueError, "invalid v2 record structure"):
                            validator(records, batch)
            for value in ([[]] * 25, [{}] * 25, [None] * 25, [7] * 25, [""] * 25):
                with self.subTest(validator=validator_name, batch_company_id=value[0]):
                    records, batch = fixture_with_every_ledger()
                    batch["company_ids"] = value
                    with self.assertRaisesRegex(ValueError, "canonical batch company_ids"):
                        validator(records, batch)

    def test_authoritative_schema_errors_still_surface_after_early_validation(self):
        research = ROOT / "docs/research/company-benefits"
        batches = [json.loads(line) for line in (research / "series-batches.jsonl").read_text().splitlines()]
        batch = next(item for item in batches if item["batch_id"] == "domestic-02")
        companies = [json.loads(line) for line in (research / "companies.jsonl").read_text().splitlines()]
        records = no_public_info_records(batch, companies)
        records["attempts"][0]["result"] = "malformed-result"
        with self.assertRaisesRegex(ValueError, "authoritative benefits-v2 validation failed"):
            self.module.validate_v2_package_records(records, batch, research)

    def test_merged_id_order_is_partitioned_back_to_canonical_batch_order(self):
        records, batch = fixture()
        for ledger, field in self.module.V2_ID_FIELDS.items():
            records[ledger] = sorted(records[ledger], key=lambda item: item[field])
        sliced = self.module.v2_batch_slice(records, batch)
        self.module.validate_v2_batch_records(sliced, batch)

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
            "source_id": "source::pending",
            "moderation": {"status": "pending"}, "publication_eligibility": "ineligible",
        })
        self.assert_rejected(records, batch, "approved.*frozen|community report")


if __name__ == "__main__":
    unittest.main()
