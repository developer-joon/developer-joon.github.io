import copy
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

from scripts.tests.benefits_test_fixture import audited_source

ROOT = Path(__file__).resolve().parents[2]
VALIDATOR = ROOT / "scripts" / "validate-company-benefits-series-candidate.py"
PROMOTER = ROOT / "scripts" / "promote-company-benefits-series-candidate.py"
COMPILER = ROOT / "scripts" / "compile-company-benefits-series-candidate.py"
VERIFIER = ROOT / "scripts" / "verify-company-benefits-ledger.py"
FILES = ("sources.jsonl", "claims.jsonl", "gaps.jsonl", "review-requests.jsonl")


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()


def jsonl_bytes(values):
    return b"".join(json_bytes(value) + b"\n" for value in values)


def digest(data):
    return hashlib.sha256(data).hexdigest()


class CandidatePipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.validator = load(VALIDATOR, "candidate_validator")
        cls.promoter = load(PROMOTER, "candidate_promoter")
        cls.compiler = load(COMPILER, "candidate_compiler")
        cls.verifier = load(VERIFIER, "candidate_pipeline_verifier")

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.root = base / "research"
        self.candidate = base / "candidate"
        self.review = base / "external-review"
        self.output = base / "approved"
        self.root.mkdir()
        self.candidate.mkdir()
        self.review.mkdir()
        self.company_ids = [f"KR-CRN-{index:013d}" for index in range(25)]
        self.batch = {
            "manifest_version": "1", "batch_id": "domestic-02", "scope": "domestic", "batch_number": 2,
            "company_list_sha256": digest(json_bytes(self.company_ids)), "effective_sequence_sha256": "a" * 64,
            "replacement_events_sha256": "b" * 64, "company_ids": self.company_ids,
        }
        (self.root / "series-batches.jsonl").write_bytes(jsonl_bytes([self.batch]))
        for name in ("source-registry.jsonl", "benefit-claims.jsonl", "reviews.jsonl",
                     "series-research-gaps.jsonl", "series-prepublication-checks.jsonl"):
            (self.root / name).write_bytes(b"")
        progress = {"batches": [{"batch_id": self.batch["batch_id"], "status": "pending"}]}
        (self.root / "series-progress.json").write_bytes(json_bytes(progress))
        self.sources = [self.metadata_source()]
        self.claims = []
        self.gaps = [self.gap(company_id) for company_id in self.company_ids]
        self.requests = [self.request(gap["audit_id"], "gap") for gap in self.gaps]
        self.write_candidate()

    def tearDown(self):
        self.tmp.cleanup()

    def metadata_source(self):
        return {
            "record_type": "nonpublishable_metadata", "source_id": "kr-dart-generic-search",
            "title": "DART generic reflected search route", "owner": "금융감독원 전자공시시스템",
            "source_type": "regulator_filing", "jurisdiction": "KR", "url": "https://dart.fss.or.kr/dsab002/main.do",
            "checked_at": "2026-10-30T01:00:00Z", "route_quality": "reflected_query",
            "publication_eligible": False, "nonpublication_reason": "The generic route did not establish an exact-entity benefit document.",
            "entity_binding_status": "unresolved", "retention_mode": "metadata_only", "reuse_status": "discovery_only",
            "access_observation": {"status": 200, "final_url": "https://dart.fss.or.kr/dsab002/main.do", "access_wall": "none"},
        }

    def gap(self, company_id):
        return {
            "audit_id": f"company-gap::{company_id}", "company_id": company_id, "disposition": "nonpublishable",
            "reason": "공개 공식 자료에서 게시 가능한 근거를 확인하지 못했습니다.",
            "searched_official_source_ids": ["kr-dart-generic-search"], "searched_official_urls": [],
            "nonabsence_wording": "복지가 없다는 뜻이 아닙니다.", "researcher_id": "researcher-a",
        }

    def request(self, target_id, target_type):
        return {
            "request_id": f"review-request::{target_type}::{target_id}", "target_type": target_type,
            "target_id": target_id, "researcher_id": "researcher-a", "status": "pending_independent_review",
        }

    def write_candidate(self):
        records = {"sources.jsonl": self.sources, "claims.jsonl": self.claims, "gaps.jsonl": self.gaps,
                   "review-requests.jsonl": self.requests}
        artifacts = {}
        for name in FILES:
            raw = jsonl_bytes(records[name])
            (self.candidate / name).write_bytes(raw)
            artifacts[name] = digest(raw)
        manifest = {
            "schema_version": "1", "batch_id": self.batch["batch_id"],
            "company_list_sha256": self.batch["company_list_sha256"],
            "effective_sequence_sha256": self.batch["effective_sequence_sha256"],
            "replacement_events_sha256": self.batch["replacement_events_sha256"],
            "status": "review_pending", "researcher_id": "researcher-a", "artifacts": artifacts,
        }
        (self.candidate / "candidate.json").write_bytes(json_bytes(manifest))

    def write_review_bundle(self, reviews=None, checks=None, candidate_manifest_sha256=None):
        reviews = reviews if reviews is not None else [
            {"review_id": f"review::{gap['audit_id']}", "record_id": gap["audit_id"],
             "researcher_id": "researcher-a", "reviewer_id": "reviewer-b", "decision": "approved",
             "reviewed_at": "2026-10-30T02:00:00Z", "issues": [], "resolution": "Approved bounded nonclaim outcome.",
             "quote_entailment_confirmed": True}
            for gap in self.gaps
        ]
        checks = checks if checks is not None else [{
            "url": self.sources[0]["url"], **self.sources[0]["access_observation"],
            "checked_at": "2026-10-30T03:00:00Z",
        }]
        review_raw, check_raw = jsonl_bytes(reviews), jsonl_bytes(checks)
        (self.review / "reviews.jsonl").write_bytes(review_raw)
        (self.review / "checks.jsonl").write_bytes(check_raw)
        candidate_manifest = (self.candidate / "candidate.json").read_bytes()
        candidate = json.loads(candidate_manifest)
        bundle = {
            "schema_version": "1", "candidate_manifest_sha256": candidate_manifest_sha256 or digest(candidate_manifest),
            "candidate_artifacts": candidate["artifacts"], "promotion_reviewer_id": "reviewer-b",
            "approved_at": "2026-10-30T04:00:00Z",
            "artifacts": {"reviews.jsonl": digest(review_raw), "checks.jsonl": digest(check_raw)},
        }
        (self.review / "review-bundle.json").write_bytes(json_bytes(bundle))

    def use_factual_claim(self, *, provenance="observed_response", url="https://benefits.example/policy"):
        company_id = self.company_ids[0]
        source = audited_source("official-benefit-policy", ["benefit_claim"], url=url,
                                source_type="official_company_report", jurisdiction="KR")
        source.update(locator="benefits", supporting_quote="Meal support is offered.",
                      claim_evidence_role="primary_claim_evidence",
                      claim_evidence_proposition="Meal support is offered.",
                      applicable_legal_entities=["Example Employer"], policy_owner_legal_entity="Example Employer")
        source["hash_provenance"] = provenance
        if provenance == "retained_file":
            source["decisions"].update(retention="allowed", snapshot="allowed")
            source["evidence_path"] = "evidence/policy.html"
        claim = {
            "claim_id": f"{company_id}-meal", "company_id": company_id, "benefit_name": "Meal support",
            "detail": "Meal support is offered.", "status": "confirmed", "current_validity": "current",
            "evidence_grade": "A", "source_ids": [source["source_id"]],
            "source_evidence": [{"source_id": source["source_id"], "role": "primary_claim_evidence",
                                 "proposition": "Meal support is offered.", "source_locator": "benefits",
                                 "supporting_quote": "Meal support is offered.", "content_sha256": "a" * 64}],
            "application_scope": {"countries": ["KR"], "legal_entities": ["Example Employer"],
                                  "roles": ["all"], "employment_types": ["full_time"],
                                  "tenure_condition": "none"},
            "publication_date": "2026-01-01", "checked_at": "2026-10-30",
            "researched_at": "2026-10-30T01:00:00Z", "source_locator": "benefits",
            "supporting_quote": "Meal support is offered.", "content_sha256": "a" * 64,
        }
        self.sources = [source]
        self.claims = [claim]
        self.gaps = self.gaps[1:]
        for gap in self.gaps:
            gap["searched_official_source_ids"] = []
        self.requests = [self.request(claim["claim_id"], "claim")] + [self.request(g["audit_id"], "gap") for g in self.gaps]
        self.write_candidate()
        return source, claim

    def factual_reviews(self, claim):
        claim_review = {
            "review_id": f"review::{claim['claim_id']}", "claim_id": claim["claim_id"],
            "researcher_id": "researcher-a", "reviewer_id": "reviewer-b", "decision": "approved",
            "reviewed_at": "2026-10-30T02:00:00Z", "issues": [], "resolution": "approved",
            "quote_entailment_confirmed": True,
            "source_entailment_reviews": [{"source_id": evidence["source_id"], "reviewed_role": evidence["role"],
                                            "reviewed_proposition": evidence["proposition"],
                                            "source_locator": evidence["source_locator"],
                                            "reviewed_quote": evidence["supporting_quote"],
                                            "content_sha256": evidence["content_sha256"],
                                            "entailment_confirmed": True, "reviewer_id": "reviewer-b"}
                                           for evidence in claim["source_evidence"]],
        }
        gap_reviews = [{"review_id": f"review::{gap['audit_id']}", "record_id": gap["audit_id"],
                        "researcher_id": "researcher-a", "reviewer_id": "reviewer-b", "decision": "approved",
                        "reviewed_at": "2026-10-30T02:00:00Z", "issues": [], "resolution": "approved",
                        "quote_entailment_confirmed": True} for gap in self.gaps]
        return [claim_review, *gap_reviews]

    def test_accepts_generic_reflected_dart_only_as_nonpublishable_metadata(self):
        package = self.validator.validate_candidate(self.candidate, self.root)
        self.assertEqual("nonpublishable_metadata", package["records"]["sources.jsonl"][0]["record_type"])

    def test_metadata_source_rejects_quote_hash_marker_entity_and_body_assertions(self):
        for field, value in (
            ("supporting_quote", "not retainable"), ("content_sha256", "d" * 64),
            ("expected_marker", "company"), ("applicable_legal_entities", ["Some Company"]),
            ("body", "leaked response body"),
        ):
            with self.subTest(field=field):
                self.sources[0][field] = value
                self.write_candidate()
                with self.assertRaisesRegex(ValueError, "metadata|additional|prohibited"):
                    self.validator.validate_candidate(self.candidate, self.root)
                del self.sources[0][field]

    def test_rejects_wrong_layout_hash_order_and_noncanonical_ids(self):
        (self.candidate / "notes.txt").write_text("no")
        with self.assertRaisesRegex(ValueError, "exactly"):
            self.validator.validate_candidate(self.candidate, self.root)
        (self.candidate / "notes.txt").unlink()
        self.gaps.reverse()
        self.write_candidate()
        with self.assertRaisesRegex(ValueError, "canonical order"):
            self.validator.validate_candidate(self.candidate, self.root)
        self.gaps.reverse()
        self.gaps[0]["audit_id"] = "gap-0"
        self.write_candidate()
        with self.assertRaisesRegex(ValueError, "canonical gap"):
            self.validator.validate_candidate(self.candidate, self.root)
        self.gaps[0]["audit_id"] = f"company-gap::{self.company_ids[0]}"
        self.write_candidate()
        manifest = json.loads((self.candidate / "candidate.json").read_bytes())
        manifest["artifacts"]["gaps.jsonl"] = "0" * 64
        (self.candidate / "candidate.json").write_bytes(json_bytes(manifest))
        with self.assertRaisesRegex(ValueError, "artifact hash"):
            self.validator.validate_candidate(self.candidate, self.root)

    def test_requires_claim_gap_exclusivity_and_exact_one_pending_target(self):
        self.gaps.pop()
        self.requests.pop()
        self.write_candidate()
        with self.assertRaisesRegex(ValueError, "all 25"):
            self.validator.validate_candidate(self.candidate, self.root)
        self.gaps.append(self.gap(self.company_ids[-1]))
        self.requests = [self.request(gap["audit_id"], "gap") for gap in self.gaps]
        self.requests.append(copy.deepcopy(self.requests[-1]))
        self.write_candidate()
        with self.assertRaisesRegex(ValueError, "exact one|duplicate"):
            self.validator.validate_candidate(self.candidate, self.root)

    def test_claim_sources_keep_strict_publishable_contract(self):
        claim = {"claim_id": f"{self.company_ids[0]}-meal", "company_id": self.company_ids[0],
                 "status": "confirmed", "source_ids": [self.sources[0]["source_id"]]}
        self.claims = [claim]
        self.gaps = self.gaps[1:]
        self.requests = [self.request(claim["claim_id"], "claim")] + [self.request(g["audit_id"], "gap") for g in self.gaps]
        self.write_candidate()
        with self.assertRaisesRegex(ValueError, "publishable|claim source|schema"):
            self.validator.validate_candidate(self.candidate, self.root)

    def test_candidate_claim_omits_gate_state_and_promotion_injects_exact_check_time_with_audit(self):
        source, claim = self.use_factual_claim()
        self.validator.validate_candidate(self.candidate, self.root)
        claim["prepublication_checked_at"] = "2026-10-30T01:30:00Z"
        self.write_candidate()
        with self.assertRaisesRegex(ValueError, "prepublication|gate"):
            self.validator.validate_candidate(self.candidate, self.root)
        del claim["prepublication_checked_at"]
        self.write_candidate()
        checks = [{"url": source["url"], "status": 200, "final_url": source["url"],
                   "marker": source["http_verification"]["expected_marker"], "marker_confirmed": True,
                   "content_sha256": source["content_sha256"], "checked_at": "2026-10-30T03:00:00Z"}]
        self.write_review_bundle(reviews=self.factual_reviews(claim), checks=checks)
        candidate_hash = digest((self.candidate / "candidate.json").read_bytes())
        self.promoter.promote(self.candidate, self.review, self.output, self.root)
        promoted_claim = json.loads((self.output / "claims.jsonl").read_text())
        manifest = json.loads((self.output / "batch.json").read_text())
        self.assertEqual("2026-10-30T03:00:00Z", promoted_claim["prepublication_checked_at"])
        self.assertEqual(candidate_hash, manifest["review_audit"]["candidate_manifest_sha256"])
        self.assertEqual(json.loads((self.review / "review-bundle.json").read_text())["artifacts"],
                         manifest["review_audit"]["review_artifacts"])

    def test_unknown_candidate_remains_without_factual_prepublication_gate_state(self):
        source, claim = self.use_factual_claim()
        claim.update(status="unknown", evidence_grade="none", source_ids=[],
                     searched_source_ids=[source["source_id"]], searched_at="2026-10-30T01:00:00Z",
                     search_scope="benefit_nonclaim")
        for field in ("source_evidence", "source_locator", "supporting_quote", "content_sha256"):
            claim.pop(field)
        self.write_candidate()
        review = {"review_id": f"review::{claim['claim_id']}", "claim_id": claim["claim_id"],
                  "researcher_id": "researcher-a", "reviewer_id": "reviewer-b", "decision": "approved",
                  "reviewed_at": "2026-10-30T02:00:00Z", "issues": [], "resolution": "approved unknown",
                  "quote_entailment_confirmed": True}
        reviews = [review, *self.factual_reviews({**claim, "source_evidence": []})[1:]]
        check = {"url": source["url"], "status": 200, "final_url": source["url"],
                 "marker": source["http_verification"]["expected_marker"], "marker_confirmed": True,
                 "content_sha256": source["content_sha256"], "checked_at": "2026-10-30T03:00:00Z"}
        self.write_review_bundle(reviews=reviews, checks=[check])
        self.promoter.promote(self.candidate, self.review, self.output, self.root)
        promoted_claim = json.loads((self.output / "claims.jsonl").read_text())
        self.assertNotIn("prepublication_checked_at", promoted_claim)

    def test_publishable_check_must_match_exact_https_source_hash_marker_and_final_url(self):
        source, claim = self.use_factual_claim()
        valid = {"url": source["url"], "status": 200, "final_url": source["url"],
                 "marker": source["http_verification"]["expected_marker"], "marker_confirmed": True,
                 "content_sha256": source["content_sha256"], "checked_at": "2026-10-30T03:00:00Z"}
        for field, value in (("status", 403), ("final_url", "https://other.example/"),
                             ("marker", "wrong"), ("content_sha256", "f" * 64)):
            with self.subTest(field=field):
                self.write_review_bundle(reviews=self.factual_reviews(claim), checks=[dict(valid, **{field: value})])
                with self.assertRaisesRegex(ValueError, "publishable|exact|check"):
                    self.promoter.promote(self.candidate, self.review, self.output, self.root)

    def test_metadata_gap_accepts_exact_failed_observation_but_not_mutation(self):
        self.sources[0]["access_observation"] = {"status": 403, "final_url": self.sources[0]["url"],
                                                 "access_wall": "bot_or_network_block"}
        self.write_candidate()
        check = {"url": self.sources[0]["url"], **self.sources[0]["access_observation"],
                 "checked_at": "2026-10-30T03:00:00Z"}
        self.write_review_bundle(checks=[check])
        self.promoter.promote(self.candidate, self.review, self.output, self.root)
        self.assertNotIn("content_sha256", json.loads((self.output / "checks.jsonl").read_text()))
        self.write_review_bundle(checks=[dict(check, status=404)])
        with self.assertRaisesRegex(ValueError, "metadata|observation|exact"):
            self.promoter.promote(self.candidate, self.review, self.output, self.root)

    def test_metadata_gap_accepts_exact_network_failure_without_final_url(self):
        self.sources[0]["access_observation"] = {"status": None, "final_url": None,
                                                 "access_wall": "bot_or_network_block"}
        self.write_candidate()
        check = {"url": self.sources[0]["url"], **self.sources[0]["access_observation"],
                 "checked_at": "2026-10-30T03:00:00Z"}
        self.write_review_bundle(checks=[check])
        self.promoter.promote(self.candidate, self.review, self.output, self.root)
        self.assertIsNone(json.loads((self.output / "checks.jsonl").read_text())["final_url"])

    def test_candidate_rejects_non_https_and_retained_file_provenance_before_review(self):
        for provenance, url, message in (("observed_response", "http://benefits.example/policy", "HTTPS"),
                                         ("retained_file", "https://benefits.example/policy", "retained")):
            with self.subTest(provenance=provenance, url=url):
                self.use_factual_claim(provenance=provenance, url=url)
                with self.assertRaisesRegex(ValueError, message):
                    self.validator.validate_candidate(self.candidate, self.root)

    def test_verifier_accepts_metadata_source_without_weakening_publishable_source_schema(self):
        errors = []
        sources = self.verifier.validate_sources([self.sources[0]], errors)
        self.assertEqual([], errors)
        self.assertIn(self.sources[0]["source_id"], sources)
        publishable = copy.deepcopy(self.sources[0])
        del publishable["record_type"]
        errors = []
        self.verifier.validate_sources([publishable], errors)
        self.assertTrue(any("schema" in error or "missing source" in error for error in errors))

    def test_scratch_compiler_is_separate_and_deterministic(self):
        scratch = Path(self.tmp.name) / "scratch"
        compiled = Path(self.tmp.name) / "compiled"
        scratch.mkdir()
        draft = {key: self.batch[key] for key in ("batch_id", "company_list_sha256", "effective_sequence_sha256", "replacement_events_sha256")}
        draft.update(schema_version="1", researcher_id="researcher-a")
        (scratch / "draft.json").write_bytes(json_bytes(draft))
        (scratch / "sources.jsonl").write_bytes(jsonl_bytes(list(reversed(self.sources))))
        (scratch / "claims.jsonl").write_bytes(jsonl_bytes(self.claims))
        (scratch / "gaps.jsonl").write_bytes(jsonl_bytes(list(reversed(self.gaps))))
        self.compiler.compile_candidate(scratch, compiled, self.root)
        first = {path.name: path.read_bytes() for path in compiled.iterdir()}
        self.compiler.compile_candidate(scratch, compiled, self.root)
        self.assertEqual(first, {path.name: path.read_bytes() for path in compiled.iterdir()})
        self.validator.validate_candidate(compiled, self.root)

    def test_promotion_rejects_missing_duplicate_orphan_and_cross_target_reviews(self):
        cases = []
        valid = [{"review_id": f"review::{g['audit_id']}", "record_id": g["audit_id"], "researcher_id": "researcher-a",
                  "reviewer_id": "reviewer-b", "decision": "approved", "reviewed_at": "2026-10-30T02:00:00Z",
                  "issues": [], "resolution": "approved", "quote_entailment_confirmed": True} for g in self.gaps]
        cases.append((valid[:-1], "missing|coverage"))
        cases.append((valid + [copy.deepcopy(valid[-1])], "duplicate|coverage"))
        orphan = copy.deepcopy(valid); orphan[-1]["record_id"] = "company-gap::orphan"; cases.append((orphan, "orphan|coverage"))
        cross = copy.deepcopy(valid); cross[-1]["claim_id"] = cross[-1]["record_id"]; cases.append((cross, "exactly one|cross"))
        for reviews, message in cases:
            with self.subTest(message=message):
                self.write_review_bundle(reviews=reviews)
                with self.assertRaisesRegex(ValueError, message):
                    self.promoter.promote(self.candidate, self.review, self.output, self.root)

    def test_promotion_rejects_old_approval_transfer_and_stale_checks(self):
        self.write_review_bundle(candidate_manifest_sha256="0" * 64)
        with self.assertRaisesRegex(ValueError, "candidate.*hash|binding"):
            self.promoter.promote(self.candidate, self.review, self.output, self.root)
        stale = [{"url": self.sources[0]["url"], **self.sources[0]["access_observation"],
                  "checked_at": "2026-10-30T01:30:00Z"}]
        self.write_review_bundle(checks=stale)
        with self.assertRaisesRegex(ValueError, "post-review|follow"):
            self.promoter.promote(self.candidate, self.review, self.output, self.root)

    def test_promotion_emits_exact_existing_six_file_package_deterministically(self):
        self.write_review_bundle()
        self.promoter.promote(self.candidate, self.review, self.output, self.root)
        expected = {"batch.json", "sources.jsonl", "claims.jsonl", "reviews.jsonl", "gaps.jsonl", "checks.jsonl"}
        self.assertEqual(expected, {p.name for p in self.output.iterdir()})
        first = {p.name: p.read_bytes() for p in self.output.iterdir()}
        self.promoter.promote(self.candidate, self.review, self.output, self.root)
        self.assertEqual(first, {p.name: p.read_bytes() for p in self.output.iterdir()})
        manifest = json.loads((self.output / "batch.json").read_bytes())
        self.assertEqual("approved", manifest["status"])
        self.assertEqual({name for name in expected if name != "batch.json"}, set(manifest["artifacts"]))


if __name__ == "__main__":
    unittest.main()
