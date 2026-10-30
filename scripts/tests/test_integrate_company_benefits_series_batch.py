import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from scripts.tests.benefits_test_fixture import FrozenFixture

ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / "scripts" / "integrate-company-benefits-series-batch.py"


def load_module():
    spec = importlib.util.spec_from_file_location("series_integration", MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SeriesIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "research"
        self.input = Path(self.tmp.name) / "input"
        self.input.mkdir()
        self.fixture = FrozenFixture(self.root)
        batches = self.module.series.read_jsonl(self.root / "series-batches.jsonl")
        self.batch = next(item for item in batches if item["batch_id"] == "domestic-02")

    def tearDown(self):
        self.tmp.cleanup()

    def write_jsonl(self, name, records):
        payload = self.module.series.jsonl_bytes(records)
        (self.input / name).write_bytes(payload)
        return hashlib.sha256(payload).hexdigest()

    def package(self, claims=None, sources=None, reviews=None, gaps=None, checks=None, status="approved"):
        values = {"sources.jsonl": sources or [], "claims.jsonl": claims or [], "reviews.jsonl": reviews or [],
                  "gaps.jsonl": gaps or [], "checks.jsonl": checks or []}
        artifacts = {name: self.write_jsonl(name, records) for name, records in values.items()}
        manifest = {"schema_version": "1", "batch_id": self.batch["batch_id"],
                    "company_list_sha256": self.batch["company_list_sha256"], "status": status,
                    "effective_sequence_sha256": self.batch["effective_sequence_sha256"],
                    "replacement_events_sha256": self.batch["replacement_events_sha256"],
                    "approved_at": "2026-10-21T00:00:00Z", "reviewer_id": "batch-reviewer",
                    "artifacts": artifacts}
        (self.input / "batch.json").write_text(json.dumps(manifest), encoding="utf-8")

    def outcome_reviews(self, gaps):
        return [{"review_id": f"review::{gap['audit_id']}", "record_id": gap["audit_id"],
                 "researcher_id": "gap-researcher", "reviewer_id": "gap-reviewer", "decision": "approved",
                 "reviewed_at": "2026-10-21T00:00:00Z", "issues": [], "resolution": "approved nonclaim outcome",
                 "quote_entailment_confirmed": True} for gap in gaps]

    def test_rejects_unapproved_package(self):
        self.package(status="review_pending")
        with self.assertRaisesRegex(ValueError, "approved"):
            self.module.load_package(self.input, self.root)

    def test_rejects_stale_effective_sequence_or_replacement_event_binding(self):
        self.package()
        manifest = json.loads((self.input / "batch.json").read_text())
        manifest["effective_sequence_sha256"] = "0" * 64
        (self.input / "batch.json").write_text(json.dumps(manifest), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "effective sequence|replacement"):
            self.module.load_package(self.input, self.root)

    def test_rejects_wrong_batch_entities_and_partial_coverage(self):
        claim = dict(self.fixture.claims[0], claim_id="wrong-batch-claim")
        review = dict(self.fixture.reviews[0], review_id="wrong-review", claim_id="wrong-batch-claim")
        self.package(claims=[claim], reviews=[review])
        with self.assertRaisesRegex(ValueError, "outside batch"):
            self.module.load_package(self.input, self.root)

        gaps = [{"audit_id": f"company-gap::{company_id}", "company_id": company_id,
                 "disposition": "nonpublishable", "reason": "공개 공식 자료에서 게시 가능한 근거를 확인하지 못했습니다.",
                 "searched_official_source_ids": [], "searched_official_urls": [],
                 "nonabsence_wording": "복지가 없다는 뜻이 아닙니다."}
                for company_id in self.batch["company_ids"][:-1]]
        self.package(gaps=gaps)
        with self.assertRaisesRegex(ValueError, "all 25"):
            self.module.load_package(self.input, self.root)

    def test_rejects_cross_batch_id_collision_and_evidence_files(self):
        claim = dict(self.fixture.claims[0])
        claim["company_id"] = self.batch["company_ids"][0]
        review = dict(self.fixture.reviews[0])
        self.package(claims=[claim], reviews=[review])
        with self.assertRaisesRegex(ValueError, "collision"):
            self.module.load_package(self.input, self.root)
        (self.input / "evidence.pdf").write_bytes(b"not allowed")
        with self.assertRaisesRegex(ValueError, "unexpected|evidence"):
            self.module.load_package(self.input, self.root)

    def test_valid_gap_only_package_is_deterministic(self):
        gaps = [{"audit_id": f"company-gap::{company_id}", "company_id": company_id,
                 "disposition": "nonpublishable", "reason": "공개 공식 자료에서 게시 가능한 근거를 확인하지 못했습니다.",
                 "searched_official_source_ids": [], "searched_official_urls": [],
                 "nonabsence_wording": "복지가 없다는 뜻이 아닙니다."}
                for company_id in self.batch["company_ids"]]
        self.package(gaps=gaps, reviews=self.outcome_reviews(gaps))
        first = self.module.load_package(self.input, self.root)
        second = self.module.load_package(self.input, self.root)
        self.assertEqual(first, second)

    def test_zero_claim_25_gap_reviews_are_exact_and_orphans_fail(self):
        gaps = [{"audit_id": f"company-gap::{company_id}", "company_id": company_id,
                 "disposition": "nonpublishable", "reason": "공개 공식 자료에서 확인하지 못했습니다.",
                 "searched_official_source_ids": [], "searched_official_urls": [],
                 "nonabsence_wording": "복지가 없다는 뜻이 아닙니다."}
                for company_id in self.batch["company_ids"]]
        reviews = self.outcome_reviews(gaps)
        self.package(gaps=gaps, reviews=reviews)
        _, _, records = self.module.load_package(self.input, self.root)
        self.assertEqual((0, 25, 25), (len(records["claims.jsonl"]), len(records["gaps.jsonl"]), len(records["reviews.jsonl"])))
        reviews[-1]["record_id"] = "company-gap::orphan"
        self.package(gaps=gaps, reviews=reviews)
        with self.assertRaisesRegex(ValueError, "orphan|exactly once|coverage"):
            self.module.load_package(self.input, self.root)

    def test_shared_url_check_upsert_accepts_only_newer_compatible_check(self):
        existing = [{"url": "https://dol.gov/shared", "status": 200, "final_url": "https://dol.gov/shared",
                     "marker": "Form 5500", "marker_confirmed": True, "content_sha256": "a" * 64,
                     "checked_at": "2026-10-20T05:00:00Z"}]
        newer = [dict(existing[0], checked_at="2026-10-22T05:00:00Z")]
        merged = self.module.merge_checks(existing, newer, {"https://dol.gov/shared": "2026-10-22T04:00:00Z"})
        self.assertEqual("2026-10-22T05:00:00Z", merged[0]["checked_at"])
        for mutation, message, reviewed_at in (
            ({"checked_at": "2026-10-20T05:00:00Z"}, "newer", "2026-10-19T04:00:00Z"),
            ({"checked_at": "2026-10-22T05:00:00Z", "content_sha256": "b" * 64}, "hash", "2026-10-22T04:00:00Z"),
            ({"checked_at": "2026-10-22T05:00:00Z", "marker": "different"}, "marker", "2026-10-22T04:00:00Z"),
            ({"checked_at": "2026-10-22T03:00:00Z"}, "review", "2026-10-22T04:00:00Z"),
        ):
            with self.subTest(mutation=mutation):
                with self.assertRaisesRegex(ValueError, message):
                    self.module.merge_checks(existing, [dict(existing[0], **mutation)],
                                             {"https://dol.gov/shared": reviewed_at})

    def test_accepts_metadata_only_gap_source_and_rejects_body_leakage(self):
        source = {
            "record_type": "nonpublishable_metadata", "source_id": "kr-dart-generic-search",
            "title": "DART generic reflected search route", "owner": "금융감독원 전자공시시스템",
            "source_type": "regulator_filing", "jurisdiction": "KR", "url": "https://dart.fss.or.kr/dsab002/main.do",
            "checked_at": "2026-10-20T01:00:00Z", "route_quality": "reflected_query",
            "publication_eligible": False, "nonpublication_reason": "The generic route did not establish an exact-entity benefit document.",
            "entity_binding_status": "unresolved", "retention_mode": "metadata_only", "reuse_status": "discovery_only",
            "access_observation": {"status": 200, "final_url": "https://dart.fss.or.kr/dsab002/main.do", "access_wall": "none"},
        }
        gaps = [{"audit_id": f"company-gap::{company_id}", "company_id": company_id,
                 "disposition": "nonpublishable", "reason": "공개 공식 자료에서 확인하지 못했습니다.",
                 "searched_official_source_ids": [source["source_id"]], "searched_official_urls": [],
                 "nonabsence_wording": "복지가 없다는 뜻이 아닙니다."}
                for company_id in self.batch["company_ids"]]
        checks = [{"url": source["url"], **source["access_observation"],
                   "checked_at": "2026-10-22T05:00:00Z"}]
        self.package(sources=[source], gaps=gaps, reviews=self.outcome_reviews(gaps), checks=checks)
        self.module.load_package(self.input, self.root)
        source["body"] = "retained body is prohibited"
        self.package(sources=[source], gaps=gaps, reviews=self.outcome_reviews(gaps), checks=checks)
        with self.assertRaisesRegex(ValueError, "schema|metadata|additional"):
            self.module.load_package(self.input, self.root)

    def test_check_coverage_unions_93_claims_and_14_gap_urls_and_rejects_extra(self):
        sources = {f"source-{index}": {"url": f"https://claims.example/{index}"} for index in range(13)}
        claims = [{"source_ids": [f"source-{index % 13}"], "searched_source_ids": []} for index in range(93)]
        gaps = [{"searched_official_source_ids": [],
                 "searched_official_urls": [f"https://gaps.example/{index}"]} for index in range(14)]
        expected = self.module.expected_check_urls(claims, gaps, sources)
        self.assertEqual(27, len(expected))
        checks = [{"url": url, "status": 200, "final_url": url, "marker": "official",
                   "marker_confirmed": True, "content_sha256": "a" * 64,
                   "checked_at": "2026-10-22T05:00:00Z"} for url in sorted(expected)]
        self.assertEqual(27, len(self.module.merge_checks([], checks, {}, expected)))
        checks.append(dict(checks[0], url="https://unrelated.example/extra"))
        with self.assertRaisesRegex(ValueError, "source bindings"):
            self.module.merge_checks([], checks, {}, expected)


if __name__ == "__main__":
    unittest.main()
