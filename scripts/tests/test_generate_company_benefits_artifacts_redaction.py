#!/usr/bin/env python3
import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "generate-company-benefits-artifacts.py"


def load_module():
    spec = importlib.util.spec_from_file_location("benefit_artifact_redaction", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load artifact generator")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BusinessNumberRedactionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()

    def test_redacts_json_like_quoted_keys_and_values(self):
        redact = self.module.redact_business_numbers
        placeholder = self.module.BUSINESS_NUMBER_REDACTION
        first = "".join(("12345", "67890"))
        second = "".join(("09876", "54321"))
        self.assertEqual(redact(f'"business_number": "{first}"'), f'"business_number": "{placeholder}"')
        self.assertEqual(redact(f"'businessNumber' = '{second}'"), f"'businessNumber' = '{placeholder}'")
        self.assertEqual(redact(f'businessNumber {first}'), f'businessNumber {placeholder}')

    def test_redacts_korean_label_and_preserves_punctuation(self):
        redact = self.module.redact_business_numbers
        placeholder = self.module.BUSINESS_NUMBER_REDACTION
        number = "".join(("12345", "67890"))
        self.assertEqual(redact(f'사업자등록번호 : "{number}", 확인'), f'사업자등록번호 : "{placeholder}", 확인')

    def test_is_idempotent(self):
        plain = "".join(("12345", "67890"))
        hyphenated = "-".join(("123", "45", "67890"))
        value = f'"business_number":"{plain}" / {hyphenated}'
        once = self.module.redact_business_numbers(value)
        self.assertEqual(self.module.redact_business_numbers(once), once)

    def test_leaves_ordinary_numbers_unchanged(self):
        value = '직원 1234567890명, 지원금 100000원, 기준일 20260102'
        self.assertEqual(self.module.redact_business_numbers(value), value)


if __name__ == "__main__":
    unittest.main()
