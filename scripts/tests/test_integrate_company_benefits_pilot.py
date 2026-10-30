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
    def test_approved_inputs_materialize_deterministically_with_exact_totals(self):
        module = load_module()
        claims, sources, reviews, gaps = module.aggregate(SOURCE)
        self.assertEqual((199, 161, 199, 99), (len(claims), len(sources), len(reviews), len(gaps)))
        research = ROOT / "docs" / "research" / "company-benefits"
        companies = {item["company_id"]: item for item in module.read_jsonl(research / "companies.jsonl")}
        bound_sources = module.bind_claim_sources(claims, sources, companies)
        module.bind_source_entailment_reviews(claims, reviews)
        bindings = [item for claim in claims for item in claim.get("source_evidence", [])]
        referenced = {source_id for claim in claims for source_id in claim.get("source_ids", []) + claim.get("searched_source_ids", [])}
        self.assertEqual((215, 196, 215), (len(bound_sources), len(bindings), len(referenced)))
        self.assertTrue(all(len(review.get("source_entailment_reviews", [])) == len(claim.get("source_evidence", [])) for claim, review in zip(claims, reviews)))
        dol = next(item for item in claims if item["claim_id"] == "US-CIK0000827187-2024-health")
        self.assertEqual(["primary_plan_row", "secondary_code_definition"], [item["role"] for item in dol["source_evidence"]])
        self.assertEqual("4A Health (other than vision or dental).", dol["source_evidence"][1]["supporting_quote"])
        self.assertEqual(48, len({item["company_id"] for item in claims}))
        self.assertTrue(all(item["decision"] == "approved" for item in reviews))
        self.assertTrue(all("evidence_path" not in item and "evidence_file" not in item for item in sources))
        self.assertTrue(all(item["hash_provenance"] == "observed_response" for item in sources))
        first_bytes = [module.json.dumps(part, ensure_ascii=False, separators=(",", ":"), sort_keys=True) for part in (claims, bound_sources, reviews, gaps)]
        second_claims, second_sources, second_reviews, second_gaps = module.aggregate(SOURCE)
        second_sources = module.bind_claim_sources(second_claims, second_sources, companies)
        module.bind_source_entailment_reviews(second_claims, second_reviews)
        second_bytes = [module.json.dumps(part, ensure_ascii=False, separators=(",", ":"), sort_keys=True) for part in (second_claims, second_sources, second_reviews, second_gaps)]
        self.assertEqual(first_bytes, second_bytes)

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
