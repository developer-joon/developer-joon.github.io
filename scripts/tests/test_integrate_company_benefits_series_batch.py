import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

from scripts.tests.benefits_test_fixture import FrozenFixture
from scripts.tests.benefits_v2_batch_fixture import V2_FILES, no_public_info_records

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
        self.module.series.materialize_contract(self.root, set(), {}, {})
        batches = self.module.series.read_jsonl(self.root / "series-batches.jsonl")
        self.batch = next(item for item in batches if item["batch_id"] == "domestic-02")
        self.v2_records = no_public_info_records(self.batch, self.fixture.companies)

    def tearDown(self):
        self.tmp.cleanup()

    def write_jsonl(self, name, records):
        payload = self.module.series.jsonl_bytes(records)
        (self.input / name).write_bytes(payload)
        return hashlib.sha256(payload).hexdigest()

    def package(self, claims=None, sources=None, reviews=None, gaps=None, checks=None, status="approved",
                include_review_audit=True):
        normalized_gaps = [dict(gap, researcher_id=gap.get("researcher_id", "gap-researcher"))
                           for gap in (gaps or [])]
        values = {"sources.jsonl": sources or [], "claims.jsonl": claims or [], "reviews.jsonl": reviews or [],
                  "gaps.jsonl": normalized_gaps, "checks.jsonl": checks or []}
        values.update({filename: self.v2_records[ledger] for ledger, filename in V2_FILES.items()})
        artifacts = {name: self.write_jsonl(name, records) for name, records in values.items()}
        manifest = {"schema_version": "1", "batch_id": self.batch["batch_id"],
                    "company_list_sha256": self.batch["company_list_sha256"], "status": status,
                    "effective_sequence_sha256": self.batch["effective_sequence_sha256"],
                    "replacement_events_sha256": self.batch["replacement_events_sha256"],
                    "approved_at": "2026-10-23T00:00:00Z", "reviewer_id": "batch-reviewer",
                    "artifacts": artifacts}
        if include_review_audit:
            candidate_claims = [{key: value for key, value in claim.items() if key != "prepublication_checked_at"}
                                for claim in values["claims.jsonl"]]
            claims_by_company = {}
            for claim in candidate_claims:
                claims_by_company.setdefault(claim.get("company_id"), []).append(claim)
            gaps_by_company = {}
            for gap in normalized_gaps:
                gaps_by_company.setdefault(gap.get("company_id"), []).append(gap)
            requests = []
            for company_id in self.batch["company_ids"]:
                for claim in claims_by_company.get(company_id, []):
                    target = claim.get("claim_id")
                    requests.append({"request_id": f"review-request::claim::{target}", "target_type": "claim",
                                     "target_id": target, "researcher_id": claim.get("researcher_id", "gap-researcher"),
                                     "status": "pending_independent_review"})
                for gap in gaps_by_company.get(company_id, []):
                    target = gap.get("audit_id")
                    requests.append({"request_id": f"review-request::gap::{target}", "target_type": "gap",
                                     "target_id": target, "researcher_id": gap["researcher_id"],
                                     "status": "pending_independent_review"})
            candidate_values = {"sources.jsonl": values["sources.jsonl"], "claims.jsonl": candidate_claims,
                                "gaps.jsonl": normalized_gaps, "review-requests.jsonl": requests,
                                **{filename: values[filename] for filename in V2_FILES.values()}}
            candidate_artifacts = {name: hashlib.sha256(self.module.series.jsonl_bytes(records)).hexdigest()
                                   for name, records in candidate_values.items()}
            candidate_manifest = {
                "schema_version": "1", "batch_id": self.batch["batch_id"],
                "company_list_sha256": self.batch["company_list_sha256"],
                "effective_sequence_sha256": self.batch["effective_sequence_sha256"],
                "replacement_events_sha256": self.batch["replacement_events_sha256"],
                "status": "review_pending", "researcher_id": "gap-researcher", "artifacts": candidate_artifacts,
            }
            candidate_raw = self.module.series.json_bytes(candidate_manifest)
            review_bundle = {
                "schema_version": "1", "candidate_manifest_sha256": hashlib.sha256(candidate_raw).hexdigest(),
                "candidate_artifacts": candidate_artifacts, "promotion_reviewer_id": "batch-reviewer",
                "approved_at": manifest["approved_at"],
                "artifacts": {name: artifacts[name] for name in ("reviews.jsonl", "checks.jsonl")},
            }
            review_raw = self.module.series.json_bytes(review_bundle)
            manifest["review_audit"] = {
                "candidate_manifest_sha256": hashlib.sha256(candidate_raw).hexdigest(),
                "candidate_manifest": candidate_manifest, "candidate_artifacts": candidate_artifacts,
                "review_bundle_sha256": hashlib.sha256(review_raw).hexdigest(),
                "review_bundle": review_bundle, "review_artifacts": review_bundle["artifacts"],
            }
        (self.input / "batch.json").write_bytes(self.module.series.json_bytes(manifest))

    def outcome_reviews(self, gaps):
        return [{"review_id": f"review::{gap['audit_id']}", "record_id": gap["audit_id"],
                 "researcher_id": "gap-researcher", "reviewer_id": "gap-reviewer", "decision": "approved",
                 "reviewed_at": "2026-10-21T00:00:00Z", "issues": [], "resolution": "approved nonclaim outcome",
                 "quote_entailment_confirmed": True} for gap in gaps]

    def bind_exact_gap_route(self, gaps):
        source = {
            "record_type": "nonpublishable_metadata", "source_id": "exact-entity-gap-route",
            "title": "Exact entity official discovery route", "owner": "Official registry",
            "source_type": "government_register", "jurisdiction": "KR", "url": "https://official.invalid/entity",
            "checked_at": "2026-10-20T01:00:00Z", "route_quality": "exact_entity",
            "publication_eligible": False, "nonpublication_reason": "Exact-entity route is retained only as nonclaim metadata.",
            "entity_binding_status": "exact_entity", "retention_mode": "metadata_only", "reuse_status": "discovery_only",
            "access_observation": {"status": 200, "final_url": "https://official.invalid/entity", "access_wall": "none"},
        }
        for gap in gaps:
            gap["searched_official_source_ids"] = [source["source_id"]]
        check = {"source_id": source["source_id"], "url": source["url"], **source["access_observation"],
                 "checked_at": "2026-10-22T05:00:00Z"}
        return [source], [check]

    def test_rejects_unapproved_package(self):
        self.package(status="review_pending")
        with self.assertRaisesRegex(ValueError, "approved"):
            self.module.load_package(self.input, self.root)

    def test_batch_cli_fails_closed_on_unhashable_v2_binding_without_writes(self):
        self.v2_records["cells"][0]["attempt_ids"] = [{"unhashable": True}]
        self.package()
        before = {path.relative_to(self.root): path.read_bytes()
                  for path in self.root.rglob("*") if path.is_file()}
        result = subprocess.run(
            [sys.executable, str(MODULE), str(self.input), "--research-root", str(self.root),
             "--freeze-anchor-receipt", str(Path(self.tmp.name) / "unused-receipt.json")],
            cwd=ROOT, text=True, capture_output=True, check=False,
        )
        output = result.stdout + result.stderr
        after = {path.relative_to(self.root): path.read_bytes()
                 for path in self.root.rglob("*") if path.is_file()}
        self.assertEqual(1, result.returncode, output)
        self.assertIn("invalid v2 record structure", output)
        self.assertNotIn("Traceback", output)
        self.assertEqual("", result.stdout)
        self.assertEqual(before, after)

    def test_rejects_v2_package_without_review_audit(self):
        self.package(include_review_audit=False)
        with self.assertRaisesRegex(ValueError, "review_audit|candidate|promotion"):
            self.module.load_package(self.input, self.root)

    def test_rejects_already_approved_legacy_entry_even_without_cell_count(self):
        progress_path = self.root / "series-progress.json"
        progress = json.loads(progress_path.read_text())
        current = next(item for item in progress["batches"] if item["batch_id"] == self.batch["batch_id"])
        current.update(status="approved", approved_at="2026-10-20T00:00:00Z", reviewer_ids=["legacy-reviewer"])
        current.pop("cell_count", None)
        progress_path.write_text(json.dumps(progress), encoding="utf-8")
        self.package()
        with self.assertRaisesRegex(ValueError, "pending|v2 transition"):
            self.module.load_package(self.input, self.root)

    def test_rejects_v2_transition_when_another_approved_batch_is_legacy(self):
        progress_path = self.root / "series-progress.json"
        progress = json.loads(progress_path.read_text())
        legacy = next(item for item in progress["batches"] if item["batch_id"] == "domestic-01")
        legacy.update(status="approved", approved_at="2026-10-20T00:00:00Z", reviewer_ids=["legacy-reviewer"])
        progress_path.write_text(json.dumps(progress), encoding="utf-8")
        self.package()

        with self.assertRaisesRegex(ValueError, "legacy|v2 transition"):
            self.module.load_package(self.input, self.root)

    def test_rejects_prior_approved_v2_tampering_before_hash_regeneration(self):
        first = next(item for item in self.module.series.read_jsonl(self.root / "series-batches.jsonl")
                     if item["batch_id"] == "domestic-01")
        existing = no_public_info_records(first, self.fixture.companies)
        for ledger, filename in V2_FILES.items():
            self.module.series.write_jsonl(self.root / filename, existing[ledger])
        self.module.series.materialize_contract(
            self.root, {"domestic-01"}, "2026-10-21T00:00:00Z", "legacy-reviewer"
        )
        attempts_path = self.root / V2_FILES["attempts"]
        attempts = self.module.series.read_jsonl(attempts_path)
        attempts[0]["query_or_locator"] += " tampered"
        payload = {key: value for key, value in attempts[0].items() if key != "receipt_content_sha256"}
        attempts[0]["receipt_content_sha256"] = hashlib.sha256(
            json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
        self.module.series.write_jsonl(attempts_path, attempts)
        self.package()
        with self.assertRaisesRegex(ValueError, "persisted v2 ledger hash mismatch"):
            self.module.load_package(self.input, self.root)

    def test_rejects_forged_review_audit_not_bound_to_exact_candidate_payload(self):
        gaps = [{"audit_id": f"company-gap::{company_id}", "company_id": company_id,
                 "disposition": "nonpublishable", "reason": "공개 공식 자료에서 확인하지 못했습니다.",
                 "searched_official_source_ids": [], "searched_official_urls": [],
                 "nonabsence_wording": "복지가 없다는 뜻이 아닙니다."}
                for company_id in self.batch["company_ids"]]
        sources, checks = self.bind_exact_gap_route(gaps)
        self.package(sources=sources, gaps=gaps, reviews=self.outcome_reviews(gaps), checks=checks)
        manifest = json.loads((self.input / "batch.json").read_bytes())
        audit = manifest["review_audit"]
        audit["candidate_artifacts"]["company-category-cells.jsonl"] = "0" * 64
        audit["candidate_manifest"]["artifacts"] = audit["candidate_artifacts"]
        candidate_raw = self.module.series.json_bytes(audit["candidate_manifest"])
        audit["candidate_manifest_sha256"] = hashlib.sha256(candidate_raw).hexdigest()
        audit["review_bundle"]["candidate_manifest_sha256"] = audit["candidate_manifest_sha256"]
        audit["review_bundle"]["candidate_artifacts"] = audit["candidate_artifacts"]
        review_raw = self.module.series.json_bytes(audit["review_bundle"])
        audit["review_bundle_sha256"] = hashlib.sha256(review_raw).hexdigest()
        (self.input / "batch.json").write_bytes(self.module.series.json_bytes(manifest))
        with self.assertRaisesRegex(ValueError, "artifact hash|candidate|binding"):
            self.module.load_package(self.input, self.root)

    def test_rejects_legacy_shaped_unbound_review_audit(self):
        gaps = [{"audit_id": f"company-gap::{company_id}", "company_id": company_id,
                 "disposition": "nonpublishable", "reason": "공개 공식 자료에서 확인하지 못했습니다.",
                 "searched_official_source_ids": [], "searched_official_urls": [],
                 "nonabsence_wording": "복지가 없다는 뜻이 아닙니다."}
                for company_id in self.batch["company_ids"]]
        sources, checks = self.bind_exact_gap_route(gaps)
        self.package(sources=sources, gaps=gaps, reviews=self.outcome_reviews(gaps), checks=checks)
        manifest = json.loads((self.input / "batch.json").read_bytes())
        candidate_artifacts = dict(manifest["review_audit"]["candidate_artifacts"])
        candidate_artifacts["company-category-cells.jsonl"] = "0" * 64
        manifest["review_audit"] = {
            "candidate_manifest_sha256": "0" * 64,
            "candidate_artifacts": candidate_artifacts,
            "review_artifacts": {name: manifest["artifacts"][name]
                                 for name in ("reviews.jsonl", "checks.jsonl")},
        }
        (self.input / "batch.json").write_bytes(self.module.series.json_bytes(manifest))
        with self.assertRaisesRegex(ValueError, "review_audit|candidate|binding"):
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
        with self.assertRaisesRegex(ValueError, "outside (canonical )?batch"):
            self.module.load_package(self.input, self.root)

        gaps = [{"audit_id": f"company-gap::{company_id}", "company_id": company_id,
                 "disposition": "nonpublishable", "reason": "공개 공식 자료에서 게시 가능한 근거를 확인하지 못했습니다.",
                 "searched_official_source_ids": [], "searched_official_urls": [],
                 "nonabsence_wording": "복지가 없다는 뜻이 아닙니다."}
                for company_id in self.batch["company_ids"][:-1]]
        sources, checks = self.bind_exact_gap_route(gaps)
        self.package(sources=sources, gaps=gaps, reviews=self.outcome_reviews(gaps), checks=checks)
        with self.assertRaisesRegex(ValueError, "all 25"):
            self.module.load_package(self.input, self.root)

    def test_rejects_cross_batch_id_collision_and_evidence_files(self):
        gaps = [{"audit_id": f"company-gap::{company_id}", "company_id": company_id,
                 "disposition": "nonpublishable", "reason": "공개 공식 자료에서 확인하지 못했습니다.",
                 "searched_official_source_ids": [], "searched_official_urls": [],
                 "nonabsence_wording": "복지가 없다는 뜻이 아닙니다."}
                for company_id in self.batch["company_ids"]]
        sources, checks = self.bind_exact_gap_route(gaps)
        self.package(sources=sources, gaps=gaps, reviews=self.outcome_reviews(gaps), checks=checks)
        existing_attempts = self.module.series.read_jsonl(self.root / V2_FILES["attempts"])
        existing_attempts.append(self.v2_records["attempts"][0])
        self.module.series.write_jsonl(self.root / V2_FILES["attempts"], existing_attempts)
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
        sources, checks = self.bind_exact_gap_route(gaps)
        self.package(sources=sources, gaps=gaps, reviews=self.outcome_reviews(gaps), checks=checks)
        first = self.module.load_package(self.input, self.root)
        second = self.module.load_package(self.input, self.root)
        self.assertEqual(first, second)

    def test_real_v2_integration_preserves_legacy_audit_ledgers_byte_for_byte(self):
        gaps = [{"audit_id": f"company-gap::{company_id}", "company_id": company_id,
                 "disposition": "nonpublishable", "reason": "공개 공식 자료에서 게시 가능한 근거를 확인하지 못했습니다.",
                 "searched_official_source_ids": [], "searched_official_urls": [],
                 "nonabsence_wording": "복지가 없다는 뜻이 아닙니다."}
                for company_id in self.batch["company_ids"]]
        sources, checks = self.bind_exact_gap_route(gaps)
        self.package(sources=sources, gaps=gaps, reviews=self.outcome_reviews(gaps), checks=checks)
        legacy_paths = (
            "benefit-claims.jsonl", "reviews.jsonl", "series-prepublication-checks.jsonl",
            "series-research-gaps.jsonl", "source-registry.jsonl",
        )
        before = {name: hashlib.sha256((self.root / name).read_bytes()).hexdigest() for name in legacy_paths}
        freeze_receipt = Path(self.tmp.name) / "freeze-anchor-receipt.json"
        freeze_receipt.write_bytes(self.module.series.json_bytes({
            "schema_version": "1", "protocol_version": self.fixture.protocol["version"],
            "freeze_manifest_sha256": next(iter(self.fixture.approved_freeze_anchors().values())),
            "review_status": "approved", "issued_at": "2026-10-21T00:00:00Z",
        }))

        progress = self.module.integrate_batch(
            self.input, self.root, freeze_receipt, as_of=date(2026, 10, 29)
        )

        after = {name: hashlib.sha256((self.root / name).read_bytes()).hexdigest() for name in legacy_paths}
        self.assertEqual(before, after)
        approved_entry = next(item for item in progress["batches"] if item["status"] == "approved")
        self.assertEqual((0, 250, 250), (
            approved_entry["claim_count"], approved_entry["no_claim_count"], approved_entry["cell_count"]
        ))
        self.assertEqual(1, sum(item["status"] == "approved" for item in progress["batches"]))
        self.assertEqual(79, sum(item["status"] == "pending" for item in progress["batches"]))
        for ledger, filename in V2_FILES.items():
            id_field = self.module.series.V2_ID_FIELDS[ledger]
            self.assertEqual(
                sorted(self.v2_records[ledger], key=lambda item: item[id_field]),
                self.module.series.read_jsonl(self.root / filename),
            )

    def test_zero_claim_25_gap_reviews_are_exact_and_orphans_fail(self):
        gaps = [{"audit_id": f"company-gap::{company_id}", "company_id": company_id,
                 "disposition": "nonpublishable", "reason": "공개 공식 자료에서 확인하지 못했습니다.",
                 "searched_official_source_ids": [], "searched_official_urls": [],
                 "nonabsence_wording": "복지가 없다는 뜻이 아닙니다."}
                for company_id in self.batch["company_ids"]]
        reviews = self.outcome_reviews(gaps)
        sources, checks = self.bind_exact_gap_route(gaps)
        self.package(sources=sources, gaps=gaps, reviews=reviews, checks=checks)
        _, _, records = self.module.load_package(self.input, self.root)
        self.assertEqual((0, 25, 25), (len(records["claims.jsonl"]), len(records["gaps.jsonl"]), len(records["reviews.jsonl"])))
        reviews[-1]["record_id"] = "company-gap::orphan"
        self.package(sources=sources, gaps=gaps, reviews=reviews, checks=checks)
        with self.assertRaisesRegex(ValueError, "orphan|exactly once|coverage"):
            self.module.load_package(self.input, self.root)

    def test_claim_review_map_ignores_gap_outcome_reviews(self):
        claim_review = {"review_id": "review::claim", "claim_id": "claim::one"}
        gap_review = {"review_id": "review::gap", "record_id": "company-gap::one"}
        self.assertEqual({"claim::one": claim_review}, self.module.claim_review_map([gap_review, claim_review]))

    def test_shared_url_check_upsert_accepts_only_newer_compatible_check(self):
        existing = [{"source_id": "dol-plan-a", "url": "https://dol.gov/shared", "status": 200,
                     "final_url": "https://dol.gov/shared",
                     "marker": "Form 5500", "marker_confirmed": True, "content_sha256": "a" * 64,
                     "checked_at": "2026-10-20T05:00:00Z"}]
        newer = [dict(existing[0], checked_at="2026-10-22T05:00:00Z")]
        merged = self.module.merge_checks(existing, newer, {"dol-plan-a": "2026-10-22T04:00:00Z"})
        self.assertEqual("2026-10-22T05:00:00Z", merged[0]["checked_at"])
        for mutation, message, reviewed_at in (
            ({"checked_at": "2026-10-20T05:00:00Z"}, "newer", "2026-10-19T04:00:00Z"),
            ({"checked_at": "2026-10-22T05:00:00Z", "content_sha256": "b" * 64}, "tuple", "2026-10-22T04:00:00Z"),
            ({"checked_at": "2026-10-22T05:00:00Z", "marker": "different"}, "tuple", "2026-10-22T04:00:00Z"),
            ({"checked_at": "2026-10-22T03:00:00Z"}, "review", "2026-10-22T04:00:00Z"),
        ):
            with self.subTest(mutation=mutation):
                with self.assertRaisesRegex(ValueError, message):
                    self.module.merge_checks(existing, [dict(existing[0], **mutation)],
                                             {"dol-plan-a": reviewed_at})

    def test_accepts_metadata_only_gap_source_and_rejects_body_leakage(self):
        source = {
            "record_type": "nonpublishable_metadata", "source_id": "kr-dart-exact-entity-search",
            "title": "DART exact entity search route", "owner": "금융감독원 전자공시시스템",
            "source_type": "regulator_filing", "jurisdiction": "KR", "url": "https://dart.fss.or.kr/dsab002/main.do",
            "checked_at": "2026-10-20T01:00:00Z", "route_quality": "exact_entity",
            "publication_eligible": False, "nonpublication_reason": "The exact-entity route is retained only as nonclaim discovery metadata.",
            "entity_binding_status": "exact_entity", "retention_mode": "metadata_only", "reuse_status": "discovery_only",
            "access_observation": {"status": 200, "final_url": "https://dart.fss.or.kr/dsab002/main.do", "access_wall": "none"},
        }
        gaps = [{"audit_id": f"company-gap::{company_id}", "company_id": company_id,
                 "disposition": "nonpublishable", "reason": "공개 공식 자료에서 확인하지 못했습니다.",
                 "searched_official_source_ids": [source["source_id"]], "searched_official_urls": [],
                 "nonabsence_wording": "복지가 없다는 뜻이 아닙니다."}
                for company_id in self.batch["company_ids"]]
        checks = [{"source_id": source["source_id"], "url": source["url"], **source["access_observation"],
                   "checked_at": "2026-10-22T05:00:00Z"}]
        self.package(sources=[source], gaps=gaps, reviews=self.outcome_reviews(gaps), checks=checks)
        self.module.load_package(self.input, self.root)
        source["body"] = "retained body is prohibited"
        self.package(sources=[source], gaps=gaps, reviews=self.outcome_reviews(gaps), checks=checks)
        with self.assertRaisesRegex(ValueError, "schema|metadata|additional"):
            self.module.load_package(self.input, self.root)

    def test_check_coverage_unions_claim_and_gap_source_ids_and_rejects_raw_urls(self):
        sources: dict[str, dict[str, object]] = {
            f"source-{index}": {"url": f"https://official.example/{index}"} for index in range(27)
        }
        for index in range(13, 27):
            source_id = f"source-{index}"
            sources[source_id] = {
                **sources[source_id], "record_type": "nonpublishable_metadata",
                "source_type": "government_register", "route_quality": "exact_entity",
                "entity_binding_status": "exact_entity", "publication_eligible": False,
                "retention_mode": "metadata_only",
            }
        claims = [{"source_ids": [f"source-{index % 13}"], "searched_source_ids": []} for index in range(93)]
        gaps = [{"audit_id": f"company-gap::test-{index}", "disposition": "nonpublishable",
                 "nonabsence_wording": "복지가 없다는 뜻이 아닙니다.",
                 "searched_official_source_ids": [f"source-{13 + index}"], "searched_official_urls": []}
                for index in range(14)]
        expected = self.module.expected_check_source_ids(claims, gaps, sources)
        self.assertEqual(27, len(expected))
        checks = [{"source_id": source_id, "url": sources[source_id]["url"], "status": 200,
                   "final_url": sources[source_id]["url"], "marker": "official",
                   "marker_confirmed": True, "content_sha256": "a" * 64,
                   "checked_at": "2026-10-22T05:00:00Z"} for source_id in sorted(expected)]
        self.assertEqual(27, len(self.module.merge_checks([], checks, {}, expected)))
        checks.append(dict(checks[0], source_id="unrelated"))
        with self.assertRaisesRegex(ValueError, "source bindings"):
            self.module.merge_checks([], checks, {}, expected)
        gaps[0]["searched_official_urls"] = ["https://official.example/raw"]
        with self.assertRaisesRegex(ValueError, "migrated|source_id"):
            self.module.expected_check_source_ids(claims, gaps, sources)

    def transaction_fixture(self):
        index = getattr(self, "transaction_index", 0)
        self.transaction_index = index + 1
        root = Path(self.tmp.name) / f"transaction-root-{index}"
        staged = Path(self.tmp.name) / f"transaction-staged-{index}"
        (root / "drafts").mkdir(parents=True)
        (staged / "drafts").mkdir(parents=True)
        targets = list(self.module.LEDGER_TARGETS) + ["drafts/domestic-02.md"]
        before = {}
        replacements = []
        for index, relative in enumerate(targets):
            target = root / relative
            source = staged / relative
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_bytes(f"new-{index}\x00".encode())
            if index != len(targets) - 1:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(f"old-{index}\xff".encode())
                before[relative] = target.read_bytes()
            else:
                before[relative] = None
            replacements.append((source, relative))
        return root, replacements, before

    def assert_transaction_state(self, root, before):
        for relative, expected in before.items():
            target = root / relative
            if expected is None:
                self.assertFalse(target.exists(), relative)
            else:
                self.assertEqual(expected, target.read_bytes(), relative)
        self.assertFalse((root / self.module.TRANSACTION_DIRNAME).exists())
        self.assertFalse((root / self.module.COMMITTED_TRANSACTION_DIRNAME).exists())
        self.assertEqual([], list(root.rglob("*.company-benefits-batch-tmp")))

    def test_successful_transaction_promotes_all_outputs_and_removes_journal(self):
        root, replacements, _ = self.transaction_fixture()
        expected = {relative: source.read_bytes() for source, relative in replacements}
        self.module.commit_staged_outputs(root, replacements)
        for relative, raw in expected.items():
            self.assertEqual(raw, (root / relative).read_bytes())
        self.assertFalse((root / self.module.TRANSACTION_DIRNAME).exists())

    def test_failure_at_every_target_replace_rolls_back_all_prior_bytes_and_absence(self):
        for failure_at in range(len(self.module.LEDGER_TARGETS) + 1):
            with self.subTest(failure_at=failure_at):
                root, replacements, before = self.transaction_fixture()
                target_paths = {root / relative for _, relative in replacements}
                position = 0
                real_replace = os.replace

                def fail_at_position(source, destination):
                    nonlocal position
                    if Path(destination) in target_paths:
                        if position == failure_at:
                            position += 1
                            raise OSError(f"injected replace failure {failure_at}")
                        position += 1
                    return real_replace(source, destination)

                with mock.patch.object(self.module.os, "replace", side_effect=fail_at_position):
                    with self.assertRaisesRegex(OSError, "injected replace failure"):
                        self.module.commit_staged_outputs(root, replacements)
                self.assert_transaction_state(root, before)

    def test_failure_at_every_transaction_write_position_cleans_owned_state(self):
        write_count = 1 + (len(self.module.LEDGER_TARGETS) + 1) + len(self.module.LEDGER_TARGETS) + 1
        for failure_at in range(write_count):
            with self.subTest(failure_at=failure_at):
                root, replacements, before = self.transaction_fixture()
                position = 0
                real_write = self.module._write_file_durable

                def fail_after_write(path, raw, exclusive=False):
                    nonlocal position
                    real_write(path, raw, exclusive)
                    current = position
                    position += 1
                    if current == failure_at:
                        raise OSError(f"injected write interruption {failure_at}")

                with mock.patch.object(self.module, "_write_file_durable", side_effect=fail_after_write):
                    with self.assertRaisesRegex(OSError, "injected write interruption"):
                        self.module.commit_staged_outputs(root, replacements)
                self.assert_transaction_state(root, before)

    def test_ready_journal_replace_interruption_cleans_owned_state(self):
        root, replacements, before = self.transaction_fixture()
        real_replace = os.replace

        def interrupt_journal_replace(source, destination):
            if Path(destination).name == "journal.json":
                raise OSError("injected journal replace interruption")
            return real_replace(source, destination)

        with mock.patch.object(self.module.os, "replace", side_effect=interrupt_journal_replace):
            with self.assertRaisesRegex(OSError, "journal replace interruption"):
                self.module.commit_staged_outputs(root, replacements)
        self.assert_transaction_state(root, before)

    def test_commit_marker_replace_interruption_rolls_back_all_outputs(self):
        root, replacements, before = self.transaction_fixture()
        real_replace = os.replace

        def interrupt_commit_marker(source, destination):
            if Path(source) == root / self.module.TRANSACTION_DIRNAME:
                raise OSError("injected commit marker replace interruption")
            return real_replace(source, destination)

        with mock.patch.object(self.module.os, "replace", side_effect=interrupt_commit_marker):
            with self.assertRaisesRegex(OSError, "commit marker replace interruption"):
                self.module.commit_staged_outputs(root, replacements)
        self.assert_transaction_state(root, before)

    def test_recovery_cleans_committed_marker_without_rolling_back_promoted_outputs(self):
        root, replacements, _ = self.transaction_fixture()
        expected = {relative: source.read_bytes() for source, relative in replacements}
        real_cleanup = self.module._cleanup_committed_transaction

        def interrupt_cleanup(research_root):
            if (Path(research_root) / self.module.COMMITTED_TRANSACTION_DIRNAME).exists():
                raise KeyboardInterrupt("simulated post-commit interruption")
            return real_cleanup(research_root)

        with mock.patch.object(self.module, "_cleanup_committed_transaction", side_effect=interrupt_cleanup):
            with self.assertRaisesRegex(KeyboardInterrupt, "post-commit interruption"):
                self.module.commit_staged_outputs(root, replacements)
        self.assertTrue((root / self.module.COMMITTED_TRANSACTION_DIRNAME).is_dir())
        self.module.recover_transaction(root)
        for relative, raw in expected.items():
            self.assertEqual(raw, (root / relative).read_bytes())
        self.assertFalse((root / self.module.COMMITTED_TRANSACTION_DIRNAME).exists())

    def test_next_transaction_recovers_an_interrupted_journal_before_proceeding(self):
        root, replacements, before = self.transaction_fixture()
        target_paths = {root / relative for _, relative in replacements}
        real_replace = os.replace
        promoted = 0

        def interrupt_after_first(source, destination):
            nonlocal promoted
            if Path(destination) in target_paths:
                promoted += 1
                if promoted == 2:
                    raise KeyboardInterrupt("simulated process interruption")
            return real_replace(source, destination)

        with mock.patch.object(self.module.os, "replace", side_effect=interrupt_after_first), \
             mock.patch.object(self.module, "rollback_transaction", side_effect=KeyboardInterrupt("rollback interrupted")):
            with self.assertRaisesRegex(KeyboardInterrupt, "rollback interrupted"):
                self.module.commit_staged_outputs(root, replacements)
        self.assertTrue((root / self.module.TRANSACTION_DIRNAME / "journal.json").is_file())
        self.assertNotEqual(before[next(iter(before))], (root / next(iter(before))).read_bytes())

        self.module.recover_transaction(root)
        self.assert_transaction_state(root, before)

    def test_recovery_refuses_to_overwrite_concurrent_target_bytes(self):
        root, replacements, _ = self.transaction_fixture()
        target_paths = {root / relative for _, relative in replacements}
        real_replace = os.replace
        promoted = 0

        def interrupt_after_first(source, destination):
            nonlocal promoted
            if Path(destination) in target_paths:
                promoted += 1
                if promoted == 2:
                    raise OSError("stop after first promotion")
            return real_replace(source, destination)

        with mock.patch.object(self.module.os, "replace", side_effect=interrupt_after_first), \
             mock.patch.object(self.module, "rollback_transaction", side_effect=OSError("rollback unavailable")):
            with self.assertRaisesRegex(OSError, "rollback unavailable"):
                self.module.commit_staged_outputs(root, replacements)
        first_target = root / replacements[0][1]
        first_target.write_bytes(b"concurrent-owner-bytes")
        with self.assertRaisesRegex(RuntimeError, "concurrent|unexpected"):
            self.module.recover_transaction(root)
        self.assertEqual(b"concurrent-owner-bytes", first_target.read_bytes())
        self.assertTrue((root / self.module.TRANSACTION_DIRNAME).exists())


if __name__ == "__main__":
    unittest.main()
