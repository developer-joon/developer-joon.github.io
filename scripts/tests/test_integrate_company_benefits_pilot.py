import importlib.util
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / "scripts" / "integrate-company-benefits-pilot.py"
SOURCE = Path("/home/bread/.hermes/profiles/conan/cache/scratch/pilot-benefits-research/results")


def load_module():
    spec = importlib.util.spec_from_file_location("pilot_integration", MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PilotIntegrationTests(unittest.TestCase):
    def test_old_external_package_remains_deterministic_but_is_not_ingested(self):
        module = load_module()
        claims, sources, reviews, gaps = module.aggregate(SOURCE)
        self.assertEqual((199, 161, 199, 99), (len(claims), len(sources), len(reviews), len(gaps)))
        self.assertEqual(48, len({item["company_id"] for item in claims}))
        self.assertTrue(all(item["decision"] == "approved" for item in reviews))
        self.assertTrue(all("evidence_path" not in item and "evidence_file" not in item for item in sources))
        self.assertTrue(all(item["hash_provenance"] == "observed_response" for item in sources))
        first_bytes = [module.json.dumps(part, ensure_ascii=False, separators=(",", ":"), sort_keys=True) for part in (claims, sources, reviews, gaps)]
        second_claims, second_sources, second_reviews, second_gaps = module.aggregate(SOURCE)
        second_bytes = [module.json.dumps(part, ensure_ascii=False, separators=(",", ":"), sort_keys=True) for part in (second_claims, second_sources, second_reviews, second_gaps)]
        self.assertEqual(first_bytes, second_bytes)
        research = ROOT / "docs" / "research" / "company-benefits"
        self.assertEqual([], module.read_jsonl(research / "benefit-claims.jsonl"))

    def test_rechecks_must_be_one_per_url_and_after_review(self):
        module = load_module()
        claims, sources, reviews, _ = module.aggregate(SOURCE)
        latest = max(datetime.fromisoformat(item["reviewed_at"].replace("Z", "+00:00")) for item in reviews)
        checked = (latest + timedelta(seconds=1)).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        checks = [{"url": url, "status": 200, "final_url": url, "marker": "fixture", "marker_confirmed": True,
                   "content_sha256": "a" * 64, "checked_at": checked}
                  for url in sorted({item["url"] for item in sources})]
        module.apply_prepublication_checks(claims, sources, reviews, checks)
        self.assertTrue(all(item["prepublication_checked_at"] == checked for item in claims))
        with self.assertRaisesRegex(ValueError, "one check per unique URL"):
            module.apply_prepublication_checks(claims, sources, reviews, checks[:-1])


if __name__ == "__main__":
    unittest.main()
