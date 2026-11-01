import importlib.util
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / "scripts" / "integrate-company-benefits-pilot.py"


def load_module():
    spec = importlib.util.spec_from_file_location("pilot_integration", MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_jsonl(path, records):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(item) + "\n" for item in records), encoding="utf-8")


def build_pilot_fixture(root, module):
    root = Path(root)
    sources = []
    for index in range(161):
        source_id = f"source-{index:03d}"
        url = f"https://example.gov/benefits/{index:03d}"
        sources.append({
            "source_id": source_id,
            "title": f"Official benefit source {index}",
            "owner": "Fixture Authority",
            "source_type": "official_company_report",
            "jurisdiction": "KR",
            "url": url,
            "locator": "benefits section",
            "supporting_quote": "Employees receive an official benefit.",
            "content_sha256": f"{index:064x}",
            "hash_provenance": "fixture_input",
            "retrieved_at": "2026-10-20T02:00:00Z",
            "access_model": "public_keyless",
            "authentication": {"api_key": False, "login": False, "fee": False},
            "terms_url": "https://example.gov/terms",
            "reuse_decision": "allowed_with_attribution",
            "decisions": {"extract": "allowed", "quote": "allowed", "retention": "metadata_only"},
            "supported_fields": ["benefit_claim"],
            "evidence_eligibility": "A",
            "checked_at": "2026-10-20T01:00:00Z",
            "http_verification": {
                "status": 200, "redirect_chain": [], "content_type": "text/html",
                "final_url": url, "final_owner_domain": "example.gov",
                "access_wall": "none", "expected_marker": "official benefit",
            },
            "current_blocker": None,
        })
    claims = []
    reviews = []
    for index in range(199):
        source = sources[index % len(sources)]
        claim_id = f"claim-{index:03d}"
        claims.append({
            "claim_id": claim_id,
            "company_id": f"company-{index % 48:02d}",
            "benefit_name": "Fixture benefit",
            "detail": "Employees receive an official benefit.",
            "status": "confirmed",
            "current_validity": "current",
            "evidence_grade": "A",
            "source_ids": [source["source_id"]],
            "source_locator": source["locator"],
            "supporting_quote": source["supporting_quote"],
            "content_sha256": source["content_sha256"],
            "publication_date": "2026-01-01",
            "checked_at": "2026-10-20",
            "researched_at": "2026-10-20T02:00:00Z",
        })
        reviews.append({
            "review_id": f"review-{index:03d}",
            "claim_id": claim_id,
            "researcher_id": "fixture-researcher",
            "reviewer_id": "fixture-reviewer",
            "decision": "approved",
            "reviewed_at": "2026-10-20T03:00:00Z",
            "issues": [],
            "resolution": "approved",
            "quote_entailment_confirmed": True,
        })

    for _, relative, review_relative in module.BATCHES:
        write_jsonl(root / relative / "claims.jsonl", claims if relative == "domestic-1/revised" else [])
        write_jsonl(root / relative / "sources.jsonl", sources if relative == "domestic-1/revised" else [])
        if review_relative:
            write_jsonl(root / review_relative, reviews if relative == "domestic-1/revised" else [])
    gaps = [{
        "company_id": f"gap-company-{index:02d}",
        "original_claim_ids": [f"omitted-claim-{index:02d}"],
        "reason": "The original claim is not publishable.",
        "live_check": {"requested_url": f"https://example.gov/gaps/{index:02d}"},
    } for index in range(99)]
    gap_path = root / "gap-records" / "nonpublishable-gaps.json"
    gap_path.write_text(json.dumps(gaps), encoding="utf-8")


class PilotIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.module = load_module()
        self.source = Path(self.tmp.name) / "results"
        build_pilot_fixture(self.source, self.module)

    def tearDown(self):
        self.tmp.cleanup()

    def test_legacy_package_remains_deterministic_but_is_not_ingested(self):
        module = self.module
        research = ROOT / "docs" / "research" / "company-benefits"
        active_claims_before = (research / "benefit-claims.jsonl").read_bytes()
        claims, sources, reviews, gaps = module.aggregate(self.source)
        self.assertEqual((199, 161, 199, 99), (len(claims), len(sources), len(reviews), len(gaps)))
        self.assertEqual(48, len({item["company_id"] for item in claims}))
        self.assertTrue(all(item["decision"] == "approved" for item in reviews))
        self.assertTrue(all("evidence_path" not in item and "evidence_file" not in item for item in sources))
        self.assertTrue(all(item["hash_provenance"] == "observed_response" for item in sources))
        first_bytes = [module.json.dumps(part, ensure_ascii=False, separators=(",", ":"), sort_keys=True) for part in (claims, sources, reviews, gaps)]
        second_claims, second_sources, second_reviews, second_gaps = module.aggregate(self.source)
        second_bytes = [module.json.dumps(part, ensure_ascii=False, separators=(",", ":"), sort_keys=True) for part in (second_claims, second_sources, second_reviews, second_gaps)]
        self.assertEqual(first_bytes, second_bytes)
        self.assertEqual(active_claims_before, (research / "benefit-claims.jsonl").read_bytes())

    def test_rechecks_must_be_one_per_url_and_after_review(self):
        module = self.module
        claims, sources, reviews, _ = module.aggregate(self.source)
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
