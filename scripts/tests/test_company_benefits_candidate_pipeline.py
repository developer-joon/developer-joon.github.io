import copy
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

from scripts.tests.benefits_test_fixture import audited_source
from scripts.tests.benefits_v2_batch_fixture import no_public_info_records, write_records

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
        research = ROOT / "docs" / "research" / "company-benefits"
        batches = [json.loads(line) for line in (research / "series-batches.jsonl").read_text().splitlines()]
        self.batch = next(item for item in batches if item["batch_id"] == "domestic-02")
        self.company_ids = self.batch["company_ids"]
        companies = [json.loads(line) for line in (research / "companies.jsonl").read_text().splitlines()]
        selected = [company for company in companies if company["company_id"] in set(self.company_ids)]
        (self.root / "companies.jsonl").write_bytes(jsonl_bytes(selected))
        self.v2_records = no_public_info_records(self.batch, selected)
        (self.root / "series-batches.jsonl").write_bytes(jsonl_bytes([self.batch]))
        for name in ("source-registry.jsonl", "benefit-claims.jsonl", "reviews.jsonl",
                     "series-research-gaps.jsonl", "series-prepublication-checks.jsonl"):
            (self.root / name).write_bytes(b"")
        progress = {
            "manifest_version": "1", "progress_version": "1", "status": "in_progress",
            "company_list_sha256": self.verifier.company_benefits_series.company_list_sha256([
                company_id for batch in batches for company_id in batch["company_ids"]
            ]),
            "total_companies": 2000, "total_batches": 80,
            "batches": [{
                "batch_id": batch["batch_id"], "scope": batch["scope"],
                "batch_number": batch["batch_number"], "status": "pending",
                "company_list_sha256": batch["company_list_sha256"],
                "claim_count": 0, "no_claim_count": 0,
            } for batch in batches],
        }
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
            "record_type": "nonpublishable_metadata", "source_id": "kr-dart-exact-entity-route",
            "title": "DART exact entity discovery route", "owner": "금융감독원 전자공시시스템",
            "source_type": "regulator_filing", "jurisdiction": "KR", "url": "https://dart.fss.or.kr/dsab002/main.do",
            "checked_at": "2026-10-30T01:00:00Z", "route_quality": "exact_entity",
            "publication_eligible": False, "nonpublication_reason": "The exact-entity official route is retained only as nonclaim discovery metadata.",
            "entity_binding_status": "exact_entity", "retention_mode": "metadata_only", "reuse_status": "discovery_only",
            "access_observation": {"status": 200, "final_url": "https://dart.fss.or.kr/dsab002/main.do", "access_wall": "none"},
        }

    def gap(self, company_id):
        return {
            "audit_id": f"company-gap::v2::{self.batch['batch_id']}::{company_id}",
            "company_id": company_id, "disposition": "nonpublishable",
            "reason": "공개 공식 자료에서 게시 가능한 근거를 확인하지 못했습니다.",
            "searched_official_source_ids": ["kr-dart-exact-entity-route"], "searched_official_urls": [],
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
        artifacts.update(write_records(self.candidate, self.v2_records, jsonl_bytes))
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
        if checks is None:
            checks = [self.review_check(source) for source in self.sources]
        elif checks:
            checked_ids = {check.get("source_id") for check in checks}
            checks = [*checks, *(self.review_check(source) for source in self.sources
                                 if source.get("record_type") == "nonpublishable_metadata"
                                 and source["source_id"] not in checked_ids)]
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

    def make_current_candidate(self, propositions=None):
        propositions = propositions or []
        outcomes = self.validator.compile_cell_outcomes(
            self.v2_records["cells"], self.v2_records["attempts"], propositions
        )
        for name, values in (("verified-benefit-candidates.jsonl", propositions),
                             ("company-category-outcomes.jsonl", outcomes)):
            raw = jsonl_bytes(values)
            (self.candidate / name).write_bytes(raw)
        manifest = json.loads((self.candidate / "candidate.json").read_bytes())
        manifest["schema_version"] = "2"
        for name in ("verified-benefit-candidates.jsonl", "company-category-outcomes.jsonl"):
            manifest["artifacts"][name] = digest((self.candidate / name).read_bytes())
        (self.candidate / "candidate.json").write_bytes(json_bytes(manifest))

    def write_current_review_bundle(self):
        self.write_review_bundle()
        candidate_payload = [json.loads(line) for line in
                             (self.candidate / "verified-benefit-candidates.jsonl").read_text().splitlines()]
        candidate_raw = self.validator._load_verifier().company_benefits_series.canonical_json_bytes(
            candidate_payload
        )
        candidate_sha = digest(candidate_raw)
        (self.review / "reviewed-candidate.json").write_bytes(candidate_raw)
        receipt = {"schema_version": "1", "status": "approved", "reviewer_id": "reviewer-b",
                   "reviewed_candidate_sha256": candidate_sha, "reviewed_at": "2026-10-30T02:00:00Z"}
        receipt_raw = json_bytes(receipt)
        (self.review / "reviewer-receipt.json").write_bytes(receipt_raw)
        bundle = json.loads((self.review / "review-bundle.json").read_bytes())
        bundle.update(schema_version="2", reviewed_candidate_path="reviewed-candidate.json",
                      reviewed_candidate_sha256=candidate_sha,
                      reviewer_receipt_path="reviewer-receipt.json",
                      reviewer_receipt_sha256=digest(receipt_raw))
        (self.review / "review-bundle.json").write_bytes(json_bytes(bundle))

    def use_current_verified_benefit(self):
        company_id = self.company_ids[0]
        companies = [json.loads(line) for line in
                     (ROOT / "docs/research/company-benefits/companies.jsonl").read_text().splitlines()]
        company = next(item for item in companies if item["company_id"] == company_id)
        cell = self.v2_records["cells"][0]
        source_id = "source::verified-benefit"
        source = {
            "source_id": source_id, "source_tier": "official_government",
            "title": "Official paid leave policy", "url": "https://www.dol.gov/verified-benefit",
            "retrieved_at": "2026-10-30T01:00:00Z", "content_sha256": "a" * 64,
            "reliability": "high", "currentness": "current", "scope_status": "exact_entity",
            "scope": {"countries": ["KR"], "legal_entities": [company["selected_reporting_legal_entity"]],
                      "roles": ["all_employees"], "employment_types": ["full_time"]},
            "conflict_status": "none", "publication_eligibility": "eligible",
        }
        claim_payload = {"company_id": company_id, "category_id": cell["category_id"],
                         "source_ids": [source_id]}
        claim_id = "official::" + digest(json.dumps(
            claim_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode())
        claim = {
            "claim_id": claim_id, "cell_id": cell["cell_id"], "company_id": company_id,
            "category_id": cell["category_id"], "jurisdiction": cell["jurisdiction"],
            "source_ids": [source_id], "source_tier": "official_government",
            "scope_status": "exact_entity", "scope": copy.deepcopy(source["scope"]),
            "conflict_status": "none", "publication_eligibility": "eligible",
        }
        official_attempt = next(item for item in self.v2_records["attempts"]
                                if item["attempt_id"] in cell["attempt_ids"]
                                and item["route_kind"] == "official_government")
        official_attempt.update(result="source_found", source_ids=[source_id])
        payload = {key: value for key, value in official_attempt.items() if key != "receipt_content_sha256"}
        official_attempt["receipt_content_sha256"] = digest(json.dumps(
            payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode())
        cell.pop("coverage_complete", None)
        cell.update(state="official_verified", official_claim_ids=[claim_id], reliability="high",
                    currentness="current", scope_status="exact_entity",
                    publication_eligibility="official_claim")
        self.v2_records["official_claims"] = [claim]
        self.v2_records["sources"] = [source]
        candidate = {
            "company_id": company_id, "primary_category_id": cell["category_id"],
            "title": "Paid leave", "description": "Employees receive paid leave.",
            "scope": {**copy.deepcopy(source["scope"]), "family_members": [], "conditions": []},
            "currentness": "current", "currentness_checked_at": "2026-10-30T01:00:00Z",
            "conflict_status": "none", "evidence_ids": [claim_id],
        }
        canonical = self.validator.validate_proposition_candidates([candidate], [claim], self.batch)
        self.write_candidate()
        self.make_current_candidate(canonical)

    def rebind_current_package(self):
        manifest_path = self.output / "batch.json"
        manifest = json.loads(manifest_path.read_bytes())
        for name in manifest["artifacts"]:
            manifest["artifacts"][name] = digest((self.output / name).read_bytes())
        manifest_path.write_bytes(json_bytes(manifest))
        integrator = self.promoter._load(
            ROOT / "scripts" / "integrate-company-benefits-series-batch.py", "chronology_mutation_integrator"
        )
        audit = manifest["review_audit"]
        approval = integrator.canonical_approval_row(
            manifest["batch_id"], manifest_path.read_bytes(), audit["reviewed_candidate_sha256"],
            audit["reviewer_receipt_sha256"],
        )
        (self.output / "series-batch-approval.jsonl").write_bytes(jsonl_bytes([approval]))
        inventory = sorted(path.name for path in self.output.iterdir() if path.name != "SHA256SUMS")
        (self.output / "SHA256SUMS").write_text("".join(
            f"{digest((self.output / name).read_bytes())}  {name}\n" for name in inventory
        ))
        return integrator

    def rebind_mutated_current_review(self):
        manifest_path = self.output / "batch.json"
        manifest = json.loads(manifest_path.read_bytes())
        audit = manifest["review_audit"]
        review_raw = (self.output / "reviews.jsonl").read_bytes()
        review_hash = digest(review_raw)
        manifest["artifacts"]["reviews.jsonl"] = review_hash
        audit["review_artifacts"]["reviews.jsonl"] = review_hash
        audit["review_bundle"]["artifacts"]["reviews.jsonl"] = review_hash
        audit["review_bundle_sha256"] = digest(json_bytes(audit["review_bundle"]))
        manifest_path.write_bytes(json_bytes(manifest))
        return self.rebind_current_package()

    def make_scratch(self, name="scratch"):
        scratch = Path(self.tmp.name) / name
        scratch.mkdir()
        draft = {key: self.batch[key] for key in (
            "batch_id", "company_list_sha256", "effective_sequence_sha256", "replacement_events_sha256"
        )}
        draft.update(schema_version="1", researcher_id="researcher-a")
        (scratch / "draft.json").write_bytes(json_bytes(draft))
        (scratch / "sources.jsonl").write_bytes(jsonl_bytes(self.sources))
        (scratch / "claims.jsonl").write_bytes(jsonl_bytes(self.claims))
        (scratch / "gaps.jsonl").write_bytes(jsonl_bytes(self.gaps))
        write_records(scratch, self.v2_records, jsonl_bytes)
        return scratch

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
        route = next(source for source in self.sources if source.get("record_type") == "nonpublishable_metadata")
        self.sources = [source, route]
        self.claims = [claim]
        self.gaps = self.gaps[1:]
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

    def normalized_identity_source(self):
        source = audited_source("sec-submissions-example", ["entity_identity"],
                                url="https://data.sec.gov/submissions/CIK0000123456.json",
                                source_type="regulator_filing", jurisdiction="US")
        source.update(locator="top-level cik/name/ein", supporting_quote="Example Corp / 12-3456789")
        identity = {"cik": "0000123456", "legal_name": "EXAMPLE CORP", "ein": "12-3456789"}
        projection = digest(json_bytes(identity))
        source.update(content_sha256=projection, hash_provenance="official_identity_projection",
                      normalization={"algorithm": "sec-submissions-identity", "version": "1",
                                     "projection_sha256": projection})
        return source, identity

    def source_check(self, source, **updates):
        value = {"source_id": source["source_id"], "url": source["url"], "status": 200,
                 "final_url": source["http_verification"]["final_url"],
                 "marker": source["http_verification"]["expected_marker"], "marker_confirmed": True,
                 "content_sha256": source["content_sha256"], "checked_at": "2026-10-30T03:00:00Z"}
        value.update(updates)
        return value

    def review_check(self, source):
        if source.get("record_type") == "nonpublishable_metadata":
            return {"source_id": source["source_id"], "url": source["url"],
                    **source["access_observation"], "checked_at": "2026-10-30T03:00:00Z"}
        return self.source_check(source)

    def test_accepts_exact_entity_route_only_as_nonpublishable_metadata(self):
        package = self.validator.validate_candidate(self.candidate, self.root)
        self.assertEqual("nonpublishable_metadata", package["records"]["sources.jsonl"][0]["record_type"])

    def test_candidate_review_metadata_urls_are_credential_free_https(self):
        source = self.sources[0]
        original_url = source["url"]
        original_observation = copy.deepcopy(source["access_observation"])
        invalid = (
            ("url", "http://example.invalid/source"),
            ("url", "https://reviewer:secret@example.invalid/source"),
            ("url", "https://***@example.invalid/source"),
            ("url", "https://@example.invalid/source"),
            ("url", "https://reviewer%3Asecret%40example.invalid/source"),
            ("url", "https://reviewer%3asecret%40example.invalid/source"),
            ("url", "https://%40example.invalid/source"),
            ("url", "https://%65xample.invalid/source"),
            ("url", "https://example.invalid%2eattacker/source"),
            ("url", "https://example.invalid%2Eattacker/source"),
            ("url", "https://example.invalid /source"),
            ("url", "https://example.invalid\n/source"),
            ("url", "https://example.invalid\t/source"),
            ("url", "https:///source"),
            ("url", "https://[example.invalid/source"),
            ("url", "https://example.invalid:not-a-port/source"),
            ("final_url", "http://example.invalid/final"),
            ("final_url", "https://reviewer:secret@example.invalid/final"),
            ("final_url", "https://***@example.invalid/final"),
            ("final_url", "https://@example.invalid/final"),
            ("final_url", "https://reviewer%3Asecret%40example.invalid/final"),
            ("final_url", "https://%65xample.invalid/final"),
            ("final_url", "https://example.invalid%2eattacker/final"),
            ("final_url", "https://example.invalid%2Eattacker/final"),
        )
        for field, value in invalid:
            with self.subTest(field=field, value=value):
                source["url"] = original_url
                source["access_observation"] = copy.deepcopy(original_observation)
                if field == "url":
                    source["url"] = value
                else:
                    source["access_observation"]["final_url"] = value
                self.write_candidate()
                with self.assertRaisesRegex(ValueError, "credential-free HTTPS|Invalid IPv6 URL"):
                    self.validator.validate_candidate(self.candidate, self.root)

        source["url"] = original_url
        source["access_observation"] = {
            "status": None, "final_url": None, "access_wall": "bot_or_network_block",
        }
        self.write_candidate()
        self.validator.validate_candidate(self.candidate, self.root)
        source["access_observation"] = copy.deepcopy(original_observation)
        self.write_candidate()
        self.validator.validate_candidate(self.candidate, self.root)
        source["url"] = "https://example.invalid/path%40reviewer?next=user%3Asecret%40example.invalid"
        source["access_observation"]["final_url"] = source["url"]
        self.write_candidate()
        self.validator.validate_candidate(self.candidate, self.root)

    def test_atomic_proposition_candidate_binds_two_evidence_records_without_self_approval(self):
        company_id = self.company_ids[0]
        evidence = [
            {"claim_id": "official::one", "company_id": company_id, "category_id": "meals"},
            {"reference_id": "reference::two", "company_id": company_id, "category_id": "meals"},
        ]
        candidate = {
            "company_id": company_id, "primary_category_id": "meals",
            "title": "Meal allowance", "description": "Employees receive a daily meal allowance.",
            "scope": {"countries": ["KR"], "legal_entities": ["Example Employer"],
                      "roles": [], "employment_types": ["full_time"], "family_members": [],
                      "conditions": []},
            "currentness": "current", "currentness_checked_at": "2026-11-01T01:02:03Z",
            "conflict_status": "none", "evidence_ids": ["official::one", "reference::two"],
        }
        canonical = self.validator.validate_proposition_candidates([candidate], evidence, self.batch)
        self.assertEqual(1, len(canonical))
        self.assertRegex(canonical[0]["proposition_sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual("benefit::" + canonical[0]["proposition_sha256"], canonical[0]["benefit_id"])
        self.assertNotIn("review", canonical[0])

    def test_candidate_rejects_malformed_proposition_before_identity_hashing(self):
        company_id = self.company_ids[0]
        evidence = [{"claim_id": "official::one", "company_id": company_id, "category_id": "meals"}]
        malformed = {
            "company_id": company_id, "primary_category_id": "meals", "title": " \t\r\n",
            "description": "Employees receive a meal allowance.",
            "scope": {"countries": "KR", "legal_entities": ["Example Employer"],
                      "roles": ["employees"], "employment_types": [42], "family_members": [],
                      "conditions": ["  "]},
            "currentness": "fresh", "currentness_checked_at": "2026-11-01 01:02:03",
            "conflict_status": "maybe", "evidence_ids": ["official::one"],
        }

        with mock.patch.object(self.validator, "sha256", side_effect=AssertionError("identity hashing reached")) as identity_hash:
            with self.assertRaisesRegex(ValueError, "candidate.*(title|scope|currentness|conflict|shape|surrogate)"):
                self.validator.validate_proposition_candidates([malformed], evidence, self.batch)
        identity_hash.assert_not_called()

    def test_candidate_rejects_rfc3339_hour_24(self):
        company_id = self.company_ids[0]
        evidence = [{"claim_id": "official::one", "company_id": company_id, "category_id": "meals"}]
        candidate = {
            "company_id": company_id, "primary_category_id": "meals",
            "title": "Meal allowance", "description": "Employees receive a daily meal allowance.",
            "scope": {"countries": ["KR"], "legal_entities": ["Example Employer"],
                      "roles": [], "employment_types": ["full_time"], "family_members": [],
                      "conditions": []},
            "currentness": "current", "currentness_checked_at": "2026-10-29T24:00:00Z",
            "conflict_status": "none", "evidence_ids": ["official::one"],
        }

        with self.assertRaisesRegex(ValueError, "currentness_checked_at"):
            self.validator.validate_proposition_candidates([candidate], evidence, self.batch)

    def test_cell_outcomes_preserve_truthful_unresolved_reasons(self):
        cells = copy.deepcopy(self.v2_records["cells"])
        attempts = copy.deepcopy(self.v2_records["attempts"])
        first_attempt_ids = set(cells[0]["attempt_ids"])
        for attempt in attempts:
            if attempt["attempt_id"] in first_attempt_ids:
                attempt["result"] = "access_failed"
                payload = {key: value for key, value in attempt.items() if key != "receipt_content_sha256"}
                attempt["receipt_content_sha256"] = digest(json.dumps(
                    payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
                ).encode())
        cells[1]["conflict_status"] = "contradictory"
        with self.assertRaisesRegex(ValueError, "conflict requires two distinct"):
            self.validator.compile_cell_outcomes(cells, attempts, [])
        cells[1]["conflict_status"] = "none"
        outcomes = self.validator.compile_cell_outcomes(cells, attempts, [])
        self.assertEqual("source_access_failed", outcomes[0]["outcome_reason"])
        self.assertEqual("not_publicly_verifiable", outcomes[1]["outcome_reason"])
        self.assertEqual("not_publicly_verifiable", outcomes[2]["outcome_reason"])
        self.assertNotIn("benefit", outcomes[0])

    def mixed_scratch(self, name="mixed-scratch"):
        """Structural ingress fixture only; receipts are not retained evidence."""
        self.use_current_verified_benefit()
        scratch = self.make_scratch(name)
        (scratch / "verified-benefit-candidates.jsonl").write_bytes(
            (self.candidate / "verified-benefit-candidates.jsonl").read_bytes())
        cells = self.v2_records["cells"]
        attempts_by_id = {row["attempt_id"]: row for row in self.v2_records["attempts"]}
        selected = []
        for cell in cells:
            if cell is not cells[0]:
                cell.update(state="research_incomplete", conflict_status="none",
                            publication_eligibility="discovery_only")
                cell.pop("coverage_complete", None)
                cell["attempt_ids"] = cell["attempt_ids"][:1]
            selected.extend(attempts_by_id[attempt_id] for attempt_id in cell["attempt_ids"])
        write_records(scratch, {**self.v2_records, "attempts": selected}, jsonl_bytes)
        return scratch

    def test_mixed_batch_compiles_one_positive_with_unresolved_cells(self):
        scratch = self.mixed_scratch()
        output = self.root.parent / "mixed-candidate"
        self.compiler.compile_candidate(scratch, output, self.root)
        validated = self.validator.validate_candidate(output, self.root)
        outcomes = validated["cell_outcomes"]
        self.assertEqual(250, len(outcomes))
        self.assertEqual("verified_benefit", outcomes[0]["outcome_reason"])
        self.assertEqual(249, sum(item["outcome_reason"] == "research_incomplete" for item in outcomes))
        self.assertEqual(1, len(validated["proposition_candidates"]))

    def test_not_researched_has_no_attempts_and_no_benefit_or_absence(self):
        scratch = self.mixed_scratch("untouched")
        cells_path = scratch / "company-category-cells.jsonl"
        attempts_path = scratch / "research-attempts.jsonl"
        cells = [json.loads(line) for line in cells_path.read_text().splitlines()]
        attempts = [json.loads(line) for line in attempts_path.read_text().splitlines()]
        untouched = cells[1]
        attempts = [row for row in attempts if row["attempt_id"] not in untouched["attempt_ids"]]
        untouched.update(state="not_researched", attempt_ids=[])
        cells_path.write_bytes(jsonl_bytes(cells))
        attempts_path.write_bytes(jsonl_bytes(attempts))
        output = self.root.parent / "untouched-candidate"
        self.compiler.compile_candidate(scratch, output, self.root)
        validated = self.validator.validate_candidate(output, self.root)
        self.assertEqual("not_researched", validated["cell_outcomes"][1]["outcome_reason"])
        for state, coverage in (("official_verified", None), ("no_public_info", True)):
            with self.subTest(state=state):
                changed = copy.deepcopy(cells)
                changed[1]["state"] = state
                if coverage is not None:
                    changed[1]["coverage_complete"] = coverage
                cells_path.write_bytes(jsonl_bytes(changed))
                with self.assertRaises(ValueError):
                    self.compiler.compile_candidate(scratch, self.root.parent / f"untouched-{state}", self.root)

    def test_mixed_batch_rejects_invented_terminal_absence_and_missing_attempt(self):
        for mutation in ("absence", "attempt"):
            with self.subTest(mutation=mutation):
                scratch = self.mixed_scratch(f"mixed-{mutation}")
                cells_path = scratch / "company-category-cells.jsonl"
                cells = [json.loads(line) for line in cells_path.read_text().splitlines()]
                if mutation == "absence":
                    cells[1].update(state="no_public_info", coverage_complete=True)
                else:
                    cells[1]["attempt_ids"] = []
                cells_path.write_bytes(jsonl_bytes(cells))
                with self.assertRaises(ValueError):
                    self.compiler.compile_candidate(scratch, self.root.parent / f"reject-{mutation}", self.root)

    def test_mixed_unresolved_states_require_matching_attempt_evidence(self):
        cases = (
            ("source_access_failed", "access_failed", "none", True),
            ("source_access_failed", "no_result", "none", False),
            ("conflicting_evidence", "no_result", "contradictory", False),
            ("conflicting_evidence", "no_result", "none", False),
        )
        for index, (state, result, conflict, accepted) in enumerate(cases):
            with self.subTest(state=state, result=result, conflict=conflict):
                scratch = self.mixed_scratch(f"mixed-state-{index}")
                cells_path = scratch / "company-category-cells.jsonl"
                attempts_path = scratch / "research-attempts.jsonl"
                cells = [json.loads(line) for line in cells_path.read_text().splitlines()]
                attempts = [json.loads(line) for line in attempts_path.read_text().splitlines()]
                cell = cells[1]
                cell.update(state=state, conflict_status=conflict)
                attempt = next(row for row in attempts if row["attempt_id"] == cell["attempt_ids"][0])
                attempt["result"] = result
                attempt["receipt_content_sha256"] = digest(json.dumps(
                    {key: value for key, value in attempt.items() if key != "receipt_content_sha256"},
                    ensure_ascii=False, sort_keys=True, separators=(",", ":")
                ).encode())
                cells_path.write_bytes(jsonl_bytes(cells))
                attempts_path.write_bytes(jsonl_bytes(attempts))
                output = self.root.parent / f"mixed-state-candidate-{index}"
                if accepted:
                    self.compiler.compile_candidate(scratch, output, self.root)
                    outcomes = self.validator.validate_candidate(output, self.root)["cell_outcomes"]
                    self.assertEqual(state, outcomes[1]["outcome_reason"])
                else:
                    with self.assertRaises(ValueError):
                        self.compiler.compile_candidate(scratch, output, self.root)

    def test_conflict_requires_distinct_successful_sources_and_capture_receipts(self):
        scratch = self.mixed_scratch("actual-conflict-structure")
        cells = [json.loads(line) for line in (scratch / "company-category-cells.jsonl").read_text().splitlines()]
        attempts = [json.loads(line) for line in (scratch / "research-attempts.jsonl").read_text().splitlines()]
        sources = [json.loads(line) for line in (scratch / "sources-v2.jsonl").read_text().splitlines()]
        cell = cells[1]
        cell.update(state="conflicting_evidence", conflict_status="contradictory")
        second = next(row for row in self.v2_records["attempts"] if row["cell_id"] == cell["cell_id"]
                      and row["attempt_id"] not in cell["attempt_ids"])
        cell["attempt_ids"].append(second["attempt_id"])
        attempts.append(copy.deepcopy(second))
        selected = [row for row in attempts if row["attempt_id"] in cell["attempt_ids"]]
        for index, attempt in enumerate(selected):
            source = copy.deepcopy(sources[0])
            source.update(source_id=f"source::conflict-{index}", source_tier=attempt["route_kind"],
                          url=f"https://example.org/conflict/{index}", conflict_status="contradictory",
                          publication_eligibility="discovery_only", content_sha256=digest(f"source-{index}".encode()))
            sources.append(source)
            attempt.update(result="source_found", source_ids=[source["source_id"]],
                           raw_response_sha256=digest(f"capture-{index}".encode()),
                           capture_locator=f"https://captures.invalid/conflict/{index}")
            attempt["receipt_content_sha256"] = digest(json.dumps(
                {key: value for key, value in attempt.items() if key != "receipt_content_sha256"},
                ensure_ascii=False, sort_keys=True, separators=(",", ":")
            ).encode())
        write_records(scratch, {**self.v2_records, "cells": cells, "attempts": attempts, "sources": sources}, jsonl_bytes)
        self.compiler.compile_candidate(scratch, self.root.parent / "conflict-structure", self.root)
        for mutation in ("same_capture", "same_source", "no_success"):
            with self.subTest(mutation=mutation):
                changed = copy.deepcopy(attempts)
                affected = [row for row in changed if row["attempt_id"] in cell["attempt_ids"]]
                if mutation == "same_capture":
                    affected[1]["raw_response_sha256"] = affected[0]["raw_response_sha256"]
                elif mutation == "same_source":
                    affected[1]["source_ids"] = affected[0]["source_ids"]
                else:
                    affected[1].update(result="no_result", source_ids=[])
                for attempt in affected:
                    attempt["receipt_content_sha256"] = digest(json.dumps(
                        {key: value for key, value in attempt.items() if key != "receipt_content_sha256"},
                        ensure_ascii=False, sort_keys=True, separators=(",", ":")
                    ).encode())
                write_records(scratch, {**self.v2_records, "cells": cells, "attempts": changed, "sources": sources}, jsonl_bytes)
                with self.assertRaises(ValueError):
                    self.compiler.compile_candidate(scratch, self.root.parent / f"conflict-{mutation}", self.root)

    def test_mixed_batch_rejects_positive_on_unsupported_cell(self):
        scratch = self.mixed_scratch()
        cells_path = scratch / "company-category-cells.jsonl"
        cells = [json.loads(line) for line in cells_path.read_text().splitlines()]
        cells[0].update(state="conflicting_evidence", conflict_status="contradictory",
                        official_claim_ids=[], publication_eligibility="discovery_only")
        cells_path.write_bytes(jsonl_bytes(cells))
        proposition = [json.loads(line) for line in
                       (scratch / "verified-benefit-candidates.jsonl").read_text().splitlines()]
        attempts = [json.loads(line) for line in
                    (scratch / "research-attempts.jsonl").read_text().splitlines()]
        with self.assertRaisesRegex(ValueError, "proposition requires.*evidence-bearing cell"):
            self.validator.compile_cell_outcomes(cells, attempts, proposition)
        with self.assertRaises(ValueError):
            self.compiler.compile_candidate(scratch, self.root.parent / "reject-positive", self.root)

    def test_external_review_recomputes_actual_candidate_and_receipt_bytes(self):
        candidate_payload = [{"benefit_id": "benefit::" + "a" * 64}]
        candidate_raw = json.dumps(
            candidate_payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode()
        (self.review / "reviewed-candidate.json").write_bytes(candidate_raw)
        receipt = {
            "schema_version": "1", "status": "approved", "reviewer_id": "reviewer-b",
            "reviewed_candidate_sha256": digest(candidate_raw),
            "reviewed_at": "2026-11-01T02:00:00Z",
        }
        receipt_raw = json_bytes(receipt)
        (self.review / "reviewer-receipt.json").write_bytes(receipt_raw)
        binding = self.promoter.verify_external_review_bytes(
            self.review, "reviewed-candidate.json", digest(candidate_raw),
            "reviewer-receipt.json", digest(receipt_raw), "researcher-a",
        )
        self.assertEqual(digest(receipt_raw), binding["reviewer_receipt_sha256"])
        (self.review / "reviewed-candidate.json").write_bytes(candidate_raw + b"\n")
        with self.assertRaisesRegex(ValueError, "candidate.*bytes|SHA|hash"):
            self.promoter.verify_external_review_bytes(
                self.review, "reviewed-candidate.json", digest(candidate_raw),
                "reviewer-receipt.json", digest(receipt_raw), "researcher-a",
            )

        canonical_empty = b"[]"
        claimed_empty_sha = digest(canonical_empty)
        empty_receipt = dict(receipt, reviewed_candidate_sha256=claimed_empty_sha)
        empty_receipt_raw = json_bytes(empty_receipt)
        (self.review / "reviewer-receipt.json").write_bytes(empty_receipt_raw)
        (self.review / "reviewed-candidate.json").write_bytes(b"[ ]")
        with self.assertRaisesRegex(ValueError, "candidate.*bytes|SHA|hash"):
            self.promoter.verify_external_review_bytes(
                self.review, "reviewed-candidate.json", claimed_empty_sha,
                "reviewer-receipt.json", digest(empty_receipt_raw), "researcher-a",
            )

    def test_current_promotion_emits_complete_checksums_and_canonical_approval_row(self):
        self.make_current_candidate()
        self.write_current_review_bundle()
        manifest = self.promoter.promote(self.candidate, self.review, self.output, self.root)
        expected_extra = {"verified-benefits.jsonl", "company-category-outcomes.jsonl",
                          "series-batch-approval.jsonl", "SHA256SUMS"}
        self.assertTrue(expected_extra <= {path.name for path in self.output.iterdir()})
        listed = {}
        for line in (self.output / "SHA256SUMS").read_text().splitlines():
            checksum, name = line.split("  ", 1)
            listed[name] = checksum
        inventory = {path.name for path in self.output.iterdir() if path.name != "SHA256SUMS"}
        self.assertEqual(inventory, set(listed))
        self.assertEqual({name: digest((self.output / name).read_bytes()) for name in inventory}, listed)
        approval = json.loads((self.output / "series-batch-approval.jsonl").read_text())
        self.assertEqual(digest((self.output / "batch.json").read_bytes()), approval["package_sha256"])
        self.assertEqual(manifest["review_audit"]["reviewed_candidate_sha256"],
                         approval["reviewed_candidate_sha256"])

    def test_real_promoter_rejects_approved_null_network_failure_tuple(self):
        """The real protocol-2 promoter must enforce approval-aware metadata checks."""
        self.sources[0]["access_observation"] = {
            "status": None, "final_url": None,
            "access_wall": "bot_or_network_block",
        }
        self.write_candidate()
        self.make_current_candidate()
        self.write_current_review_bundle()

        with self.assertRaisesRegex(ValueError, "approved.*final URL|final URL.*approved"):
            self.promoter.promote(self.candidate, self.review, self.output, self.root)

        self.assertFalse(self.output.exists())

    def test_current_promotion_rejects_receipt_review_after_approval_without_writes(self):
        self.make_current_candidate()
        self.write_current_review_bundle()
        receipt_path = self.review / "reviewer-receipt.json"
        receipt = json.loads(receipt_path.read_bytes())
        receipt["reviewed_at"] = "2026-10-30T05:00:00Z"
        receipt_raw = json_bytes(receipt)
        receipt_path.write_bytes(receipt_raw)
        bundle_path = self.review / "review-bundle.json"
        bundle = json.loads(bundle_path.read_bytes())
        bundle["reviewer_receipt_sha256"] = digest(receipt_raw)
        bundle_path.write_bytes(json_bytes(bundle))

        with self.assertRaisesRegex(ValueError, "receipt.*review.*precede|review.*approval"):
            self.promoter.promote(self.candidate, self.review, self.output, self.root)
        self.assertFalse(self.output.exists())

    def test_current_promotion_rejects_rfc3339_hour_24_in_receipt_and_bundle(self):
        self.make_current_candidate()
        for target in ("receipt", "bundle"):
            with self.subTest(target=target):
                self.write_current_review_bundle()
                bundle_path = self.review / "review-bundle.json"
                bundle = json.loads(bundle_path.read_bytes())
                if target == "receipt":
                    receipt_path = self.review / "reviewer-receipt.json"
                    receipt = json.loads(receipt_path.read_bytes())
                    receipt["reviewed_at"] = "2026-10-29T24:00:00Z"
                    receipt_raw = json_bytes(receipt)
                    receipt_path.write_bytes(receipt_raw)
                    bundle["reviewer_receipt_sha256"] = digest(receipt_raw)
                else:
                    bundle["approved_at"] = "2026-10-29T24:00:00Z"
                bundle_path.write_bytes(json_bytes(bundle))

                with self.assertRaisesRegex(ValueError, "timestamp"):
                    self.promoter.promote(self.candidate, self.review, self.output, self.root)
                self.assertFalse(self.output.exists())

    def test_integration_recomputes_outcomes_from_cells_and_verified_propositions(self):
        self.make_current_candidate()
        self.write_current_review_bundle()
        self.promoter.promote(self.candidate, self.review, self.output, self.root)

        outcomes_path = self.output / "company-category-outcomes.jsonl"
        outcomes = [json.loads(line) for line in outcomes_path.read_text().splitlines()]
        outcomes[0]["outcome_reason"] = "verified_benefit"
        outcomes_path.write_bytes(jsonl_bytes(outcomes))
        manifest_path = self.output / "batch.json"
        manifest = json.loads(manifest_path.read_bytes())
        audit = manifest["review_audit"]
        outcome_hash = digest(outcomes_path.read_bytes())
        audit["candidate_artifacts"]["company-category-outcomes.jsonl"] = outcome_hash
        audit["candidate_manifest"]["artifacts"] = audit["candidate_artifacts"]
        candidate_manifest_raw = json_bytes(audit["candidate_manifest"])
        audit["candidate_manifest_sha256"] = digest(candidate_manifest_raw)
        audit["review_bundle"]["candidate_manifest_sha256"] = audit["candidate_manifest_sha256"]
        audit["review_bundle"]["candidate_artifacts"] = audit["candidate_artifacts"]
        audit["review_bundle_sha256"] = digest(json_bytes(audit["review_bundle"]))
        manifest["artifacts"]["company-category-outcomes.jsonl"] = outcome_hash
        manifest_path.write_bytes(json_bytes(manifest))
        integrator = self.promoter._load(
            ROOT / "scripts" / "integrate-company-benefits-series-batch.py", "outcome_mutation_integrator"
        )
        approval = integrator.canonical_approval_row(
            manifest["batch_id"], manifest_path.read_bytes(), audit["reviewed_candidate_sha256"],
            audit["reviewer_receipt_sha256"],
        )
        (self.output / "series-batch-approval.jsonl").write_bytes(jsonl_bytes([approval]))
        inventory = sorted(path.name for path in self.output.iterdir() if path.name != "SHA256SUMS")
        (self.output / "SHA256SUMS").write_text("".join(
            f"{digest((self.output / name).read_bytes())}  {name}\n" for name in inventory
        ))
        before = {path.relative_to(self.root): path.read_bytes() for path in self.root.rglob("*") if path.is_file()}

        with self.assertRaisesRegex(ValueError, "cell outcomes|outcome.*match|verified.*proposition"):
            integrator.load_package(self.output, self.root)
        after = {path.relative_to(self.root): path.read_bytes() for path in self.root.rglob("*") if path.is_file()}
        self.assertEqual(before, after)

    def test_integration_rejects_verified_benefit_review_after_package_approval_without_writes(self):
        self.use_current_verified_benefit()
        self.write_current_review_bundle()
        self.promoter.promote(self.candidate, self.review, self.output, self.root)
        benefits_path = self.output / "verified-benefits.jsonl"
        benefits = [json.loads(line) for line in benefits_path.read_text().splitlines()]
        benefits[0]["review"]["reviewed_at"] = "2026-10-30T05:00:00Z"
        benefits_path.write_bytes(jsonl_bytes(benefits))
        integrator = self.rebind_current_package()
        before = {path.relative_to(self.root): path.read_bytes() for path in self.root.rglob("*") if path.is_file()}
        merged_current = {
            name: [json.loads(line) for line in (self.output / name).read_text().splitlines()]
            for name in (
                "company-category-cells.jsonl", "research-attempts.jsonl", "official-claims-v2.jsonl",
                "reference-records.jsonl", "community-benefit-reports.jsonl", "verified-benefits.jsonl",
                "company-category-outcomes.jsonl",
            )
        }

        with self.assertRaisesRegex(ValueError, "verified benefit review.*precede.*package approval"):
            integrator.validate_current_outcomes(
                merged_current,
                approved_at_by_company={company_id: "2026-10-30T04:00:00Z" for company_id in self.company_ids},
            )
        with self.assertRaisesRegex(ValueError, "verified benefit review.*precede.*package approval"):
            integrator.load_package(self.output, self.root)
        with self.assertRaisesRegex(ValueError, "verified benefit review.*precede.*package approval"):
            integrator.integrate_batch(self.output, self.root, Path(self.tmp.name) / "unused-receipt.json")

        after = {path.relative_to(self.root): path.read_bytes() for path in self.root.rglob("*") if path.is_file()}
        self.assertEqual(before, after)

    def test_integration_binds_verified_benefit_review_to_retained_receipt_bytes(self):
        self.use_current_verified_benefit()
        self.write_current_review_bundle()
        self.promoter.promote(self.candidate, self.review, self.output, self.root)
        benefits_path = self.output / "verified-benefits.jsonl"
        original = [json.loads(line) for line in benefits_path.read_text().splitlines()]
        before = {path.relative_to(self.root): path.read_bytes()
                  for path in self.root.rglob("*") if path.is_file()}
        mutations = (
            ("reviewer_receipt_sha256", "f" * 64),
            ("reviewed_candidate_sha256", "e" * 64),
            ("reviewed_at", "2026-10-30T02:30:00Z"),
        )
        for field, value in mutations:
            with self.subTest(field=field):
                benefits = copy.deepcopy(original)
                benefits[0]["review"][field] = value
                benefits_path.write_bytes(jsonl_bytes(benefits))
                integrator = self.rebind_current_package()
                with self.assertRaisesRegex(ValueError, "review.*binding|receipt|candidate"):
                    integrator.load_package(self.output, self.root)
                self.assertEqual(before, {path.relative_to(self.root): path.read_bytes()
                                          for path in self.root.rglob("*") if path.is_file()})
        benefits_path.write_bytes(jsonl_bytes(original))
        integrator = self.rebind_current_package()
        integrator.load_package(self.output, self.root)

    def test_refreshed_package_hashes_cannot_authorize_mutated_proposition(self):
        self.use_current_verified_benefit()
        self.write_current_review_bundle()
        self.promoter.promote(self.candidate, self.review, self.output, self.root)
        path = self.output / "verified-benefits.jsonl"
        benefit = json.loads(path.read_text().splitlines()[0])
        benefit["title"] = "UNREVIEWED_TITLE"
        contract = self.verifier.company_benefits_series
        proposition = contract._verified_benefit_proposition_payload(benefit)
        new_hash = digest(contract._canonical_json_bytes(proposition))
        benefit["benefit_id"] = f"benefit::{new_hash}"
        benefit["proposition_sha256"] = new_hash
        path.write_bytes(jsonl_bytes([benefit]))
        integrator = self.rebind_current_package()
        with self.assertRaisesRegex(ValueError, "candidate|review|benefit"):
            integrator.load_package(self.output, self.root)

    def test_reviewed_package_renders_proposition_once_after_authoritative_validation(self):
        self.use_current_verified_benefit()
        self.write_current_review_bundle()
        self.promoter.promote(self.candidate, self.review, self.output, self.root)
        integrator = self.promoter._load(
            ROOT / "scripts" / "integrate-company-benefits-series-batch.py", "reviewed_render_integrator"
        )
        research = Path(self.tmp.name) / "full-research"
        shutil.copytree(ROOT / "docs" / "research" / "company-benefits", research)
        for relative in integrator.LEDGER_TARGETS:
            target = research / relative
            if target.suffix == ".jsonl":
                target.write_bytes(b"")
        integrator.series.materialize_contract(research, set(), {}, {})
        protocol = json.loads((research / "population-protocol.json").read_bytes())
        freeze = Path(self.tmp.name) / "freeze-receipt.json"
        freeze.write_bytes(json_bytes({
            "schema_version": "1", "protocol_version": protocol["version"],
            "freeze_manifest_sha256": digest((research / "population" / "freeze-manifest.json").read_bytes()),
            "review_status": "approved", "issued_at": "2026-10-30T00:00:00Z",
        }))
        rendered = []
        original_loader = integrator._load_script

        def tracked_loader(path, name):
            module = original_loader(path, name)
            if Path(path).name == "render-company-benefits-drafts.py":
                original_render = module._render_verified_batch

                def render(*args, **kwargs):
                    rendered.append(True)
                    return original_render(*args, **kwargs)

                module._render_verified_batch = render
            return module

        with mock.patch.object(integrator, "_load_script", side_effect=tracked_loader):
            integrator.integrate_batch(self.output, research, freeze, as_of=date(2026, 11, 7))
        self.assertEqual([True], rendered)
        benefit = json.loads((self.output / "verified-benefits.jsonl").read_text().splitlines()[0])
        draft = (research / "drafts" / "domestic-02.md").read_text()
        self.assertEqual(1, draft.count(f"**{benefit['title']}**"))

    def test_integration_rejects_rfc3339_hour_24_package_approval(self):
        self.make_current_candidate()
        self.write_current_review_bundle()
        self.promoter.promote(self.candidate, self.review, self.output, self.root)
        manifest_path = self.output / "batch.json"
        manifest = json.loads(manifest_path.read_bytes())
        manifest["approved_at"] = "2026-10-29T24:00:00Z"
        manifest["review_audit"]["review_bundle"]["approved_at"] = manifest["approved_at"]
        manifest["review_audit"]["review_bundle_sha256"] = digest(
            json_bytes(manifest["review_audit"]["review_bundle"])
        )
        manifest_path.write_bytes(json_bytes(manifest))
        integrator = self.rebind_current_package()

        with self.assertRaisesRegex(ValueError, "approved_at timestamp"):
            integrator.load_package(self.output, self.root)

    def test_current_integration_revalidates_complete_independent_review_contract(self):
        self.make_current_candidate()
        self.write_current_review_bundle()
        self.promoter.promote(self.candidate, self.review, self.output, self.root)
        reviews_path = self.output / "reviews.jsonl"
        original = [json.loads(line) for line in reviews_path.read_text().splitlines()]
        for field, value in (("quote_entailment_confirmed", False), ("reviewer_id", "reviewer-c")):
            with self.subTest(field=field):
                reviews = copy.deepcopy(original)
                reviews[0][field] = value
                reviews_path.write_bytes(jsonl_bytes(reviews))
                integrator = self.rebind_mutated_current_review()
                with self.assertRaisesRegex(ValueError, "review|entailment|reviewer|identity"):
                    integrator.load_package(self.output, self.root)
                reviews_path.write_bytes(jsonl_bytes(original))
                self.rebind_mutated_current_review()

    def test_compiler_rejects_symlink_fifo_and_oversized_ingress(self):
        for kind in ("symlink", "fifo", "oversized"):
            with self.subTest(kind=kind):
                scratch = self.make_scratch(f"scratch-{kind}")
                target = scratch / "claims.jsonl"
                if kind == "symlink":
                    outside = Path(self.tmp.name) / "outside-claims.jsonl"
                    outside.write_bytes(target.read_bytes())
                    target.unlink()
                    target.symlink_to(outside)
                elif kind == "fifo":
                    target.unlink()
                    os.mkfifo(target)
                else:
                    target.write_bytes(b" " * 1025)
                limit = mock.patch.object(self.compiler, "MAX_COMPILER_FILE_BYTES", 1024) if kind == "oversized" else mock.patch.object(
                    self.compiler, "MAX_COMPILER_FILE_BYTES", 64 * 1024 * 1024
                )
                with limit, self.assertRaisesRegex(ValueError, "regular|bounded|safe|input|limit"):
                    self.compiler.compile_candidate(scratch, Path(self.tmp.name) / f"compiled-{kind}", self.root)

    def test_compiler_rejects_path_replacement_during_descriptor_read(self):
        scratch = self.make_scratch("scratch-replacement")
        target = scratch / "gaps.jsonl"
        target_inode = target.stat().st_ino
        original_read = self.compiler.series.os.read
        replaced = False

        def replace_during_read(descriptor, count):
            nonlocal replaced
            chunk = original_read(descriptor, count)
            if not replaced and os.fstat(descriptor).st_ino == target_inode:
                replacement = scratch / ".replacement-claims.jsonl"
                replacement.write_bytes(target.read_bytes())
                os.replace(replacement, target)
                replaced = True
            return chunk

        with mock.patch.object(self.compiler.series.os, "read", side_effect=replace_during_read):
            with self.assertRaisesRegex(ValueError, "changed during bounded read|path changed"):
                self.compiler.compile_candidate(
                    scratch, Path(self.tmp.name) / "compiled-replacement", self.root,
                )
        self.assertTrue(replaced)

    def test_integration_rejects_symlink_fifo_oversize_and_path_replacement(self):
        self.make_current_candidate()
        self.write_current_review_bundle()
        integrator = self.promoter._load(
            ROOT / "scripts" / "integrate-company-benefits-series-batch.py", "bounded_package_integrator"
        )
        for kind in ("symlink", "fifo", "oversized", "replacement"):
            with self.subTest(kind=kind):
                self.promoter.promote(self.candidate, self.review, self.output, self.root)
                target = self.output / "reviews.jsonl"
                patcher = mock.patch.object(integrator, "MAX_PACKAGE_FILE_BYTES", 1024)
                if kind == "symlink":
                    outside = Path(self.tmp.name) / "outside-reviews.jsonl"
                    outside.write_bytes(target.read_bytes())
                    target.unlink()
                    target.symlink_to(outside)
                elif kind == "fifo":
                    target.unlink()
                    os.mkfifo(target)
                elif kind == "oversized":
                    target.write_bytes(b" " * 1025)
                else:
                    patcher = mock.patch.object(integrator, "MAX_PACKAGE_FILE_BYTES", 64 * 1024 * 1024)
                if kind != "replacement":
                    with patcher, self.assertRaisesRegex(ValueError, "regular|bounded|safe|limit"):
                        integrator.load_package(self.output, self.root)
                    continue
                original_read = integrator.series.os.read
                replaced = False
                target_inode = target.stat().st_ino

                def replace_during_read(descriptor, count):
                    nonlocal replaced
                    chunk = original_read(descriptor, count)
                    if not replaced and os.fstat(descriptor).st_ino == target_inode:
                        replacement = self.output / ".replacement-reviews.jsonl"
                        replacement.write_bytes(target.read_bytes())
                        os.replace(replacement, target)
                        replaced = True
                    return chunk

                with patcher, mock.patch.object(integrator.series.os, "read", side_effect=replace_during_read):
                    with self.assertRaisesRegex(ValueError, "changed during bounded read|path changed"):
                        integrator.load_package(self.output, self.root)
                self.assertTrue(replaced)

    def test_candidate_rejects_aggregate_bytes_below_individual_file_caps(self):
        self.make_current_candidate()
        total = sum(path.stat().st_size for path in self.candidate.iterdir())
        self.assertTrue(all(
            path.stat().st_size <= self.validator.MAX_CANDIDATE_FILE_BYTES
            for path in self.candidate.iterdir()
        ))
        with mock.patch.object(self.validator, "MAX_CANDIDATE_TOTAL_BYTES", total - 1):
            with self.assertRaisesRegex(ValueError, "aggregate|total|bounded byte limit"):
                self.validator.validate_candidate(self.candidate, self.root)

    def test_review_rejects_aggregate_bytes_below_individual_file_caps(self):
        self.make_current_candidate()
        self.write_current_review_bundle()
        package = self.validator.validate_candidate(self.candidate, self.root)
        total = sum(path.stat().st_size for path in self.review.iterdir())
        self.assertTrue(all(
            path.stat().st_size <= self.promoter.MAX_REVIEW_ARTIFACT_BYTES
            for path in self.review.iterdir()
        ))
        with mock.patch.object(self.promoter, "MAX_REVIEW_TOTAL_BYTES", total - 1):
            with self.assertRaisesRegex(ValueError, "aggregate|total|bounded byte limit"):
                self.promoter.validate_external_review(package, self.review, self.validator)

    def test_compiler_publish_failure_preserves_existing_candidate_bytes(self):
        scratch = self.make_scratch("scratch-atomic")
        output = Path(self.tmp.name) / "compiled-atomic"
        self.compiler.compile_candidate(scratch, output, self.root)
        before = {path.name: path.read_bytes() for path in output.iterdir()}
        with mock.patch.object(self.compiler, "_atomic_exchange", side_effect=RuntimeError("injected exchange failure")):
            with self.assertRaisesRegex(RuntimeError, "injected exchange failure"):
                self.compiler.compile_candidate(scratch, output, self.root)
        self.assertEqual(before, {path.name: path.read_bytes() for path in output.iterdir()})

    def test_compiler_post_rename_fsync_failure_rolls_back_absent_and_existing_outputs(self):
        scratch = self.make_scratch("scratch-fsync-rollback")
        output = Path(self.tmp.name) / "compiled-fsync-rollback"
        with mock.patch.object(self.compiler.series, "_fsync_directory_descriptors",
                               side_effect=[OSError("injected fsync failure"), None]):
            with self.assertRaisesRegex(ValueError, "atomic publication"):
                self.compiler.compile_candidate(scratch, output, self.root)
        self.assertFalse(output.exists())

        self.compiler.compile_candidate(scratch, output, self.root)
        before = {path.name: path.read_bytes() for path in output.iterdir()}
        with mock.patch.object(self.compiler.series, "_fsync_directory_descriptors",
                               side_effect=[OSError("injected fsync failure"), None]):
            with self.assertRaisesRegex(ValueError, "atomic publication"):
                self.compiler.compile_candidate(scratch, output, self.root)
        self.assertEqual(before, {path.name: path.read_bytes() for path in output.iterdir()})

    def test_promoter_publish_failure_preserves_existing_package_bytes(self):
        self.make_current_candidate()
        self.write_current_review_bundle()
        self.promoter.promote(self.candidate, self.review, self.output, self.root)
        before = {path.name: path.read_bytes() for path in self.output.iterdir()}
        with mock.patch.object(self.promoter, "_atomic_exchange", side_effect=RuntimeError("injected exchange failure")):
            with self.assertRaisesRegex(RuntimeError, "injected exchange failure"):
                self.promoter.promote(self.candidate, self.review, self.output, self.root)
        self.assertEqual(before, {path.name: path.read_bytes() for path in self.output.iterdir()})

    def test_post_commit_cleanup_of_nonwritable_displaced_tree_never_fails_publication(self):
        self.make_current_candidate()
        self.write_current_review_bundle()
        self.promoter.promote(self.candidate, self.review, self.output, self.root)
        nested = self.output / "old-nested" / "locked"
        nested.mkdir(parents=True)
        (nested / "old.txt").write_text("old")
        os.chmod(nested, 0o500)

        try:
            manifest = self.promoter.promote(self.candidate, self.review, self.output, self.root)
        finally:
            os.chmod(nested, 0o700) if nested.exists() else None

        self.assertEqual("approved", manifest["status"])
        self.assertTrue((self.output / "batch.json").is_file())
        self.assertFalse((self.output / "old-nested").exists())
        self.assertEqual([], list(self.output.parent.glob(".company-benefits-publication-garbage-*")))

    def test_displaced_tree_garbage_name_collision_never_replaces_preexisting_directory(self):
        self.make_current_candidate()
        self.write_current_review_bundle()
        self.promoter.promote(self.candidate, self.review, self.output, self.root)
        collision = self.output.parent / ".company-benefits-publication-garbage-collision"
        collision.mkdir()
        collision_identity = collision.stat().st_ino

        with mock.patch.object(
            self.promoter.series.secrets, "token_hex",
            side_effect=["staging", "collision", "fresh"],
        ):
            self.promoter.promote(self.candidate, self.review, self.output, self.root)

        self.assertTrue(collision.is_dir())
        self.assertEqual(collision_identity, collision.stat().st_ino)
        self.assertEqual([], list(self.output.parent.glob(".company-benefits-publication-garbage-fresh")))

    def test_cooperating_publishers_serialize_staging_and_publication_across_processes(self):
        parent = Path(self.tmp.name) / "cooperative-publication"
        parent.mkdir()
        output = parent / "published"
        first_ready = parent / "first-ready"
        first_release = parent / "first-release"
        second_ready = parent / "second-ready"
        worker = r'''
import importlib.util
import sys
import time
from pathlib import Path

root, output, ready, release, owner = map(Path, sys.argv[1:])
series_path = root / "scripts" / "company_benefits_series.py"
compiler_path = root / "scripts" / "compile-company-benefits-series-candidate.py"
spec = importlib.util.spec_from_file_location("cooperative_series", series_path)
series = importlib.util.module_from_spec(spec)
spec.loader.exec_module(series)
spec = importlib.util.spec_from_file_location("cooperative_compiler", compiler_path)
compiler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compiler)
with series.create_output_staging(output, "cooperative-test-") as staging:
    staging.write_text("owner.txt", owner.name)
    series.publish_directory_atomically(staging, compiler._atomic_exchange, compiler._atomic_noreplace)
    ready.write_text("ready")
    while not release.exists():
        time.sleep(0.02)
'''
        first = subprocess.Popen(
            [sys.executable, "-c", worker, str(ROOT), str(output), str(first_ready),
             str(first_release), "first"], cwd=ROOT, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        second_release = parent / "second-release"
        second_release.write_text("release")
        second = None
        try:
            deadline = time.monotonic() + 5
            while not first_ready.exists() and time.monotonic() < deadline:
                time.sleep(0.02)
            if not first_ready.exists():
                self.fail(f"first publisher did not become ready: {first.communicate(timeout=1)}")
            self.assertEqual("first", (output / "owner.txt").read_text())

            second = subprocess.Popen(
                [sys.executable, "-c", worker, str(ROOT), str(output), str(second_ready),
                 str(second_release), "second"], cwd=ROOT, text=True,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            )
            time.sleep(0.3)
            self.assertIsNone(second.poll(), second.communicate(timeout=1) if second.poll() is not None else "")
            self.assertFalse(second_ready.exists())
            self.assertEqual("first", (output / "owner.txt").read_text())
            self.assertEqual(0, len(list(parent.glob(".cooperative-test-*"))))

            first_release.write_text("release")
            self.assertEqual(("", ""), first.communicate(timeout=5))
            self.assertEqual(0, first.returncode)
            self.assertEqual(("", ""), second.communicate(timeout=5))
            self.assertEqual(0, second.returncode)
            self.assertTrue(second_ready.exists())
            self.assertEqual("second", (output / "owner.txt").read_text())
        finally:
            first.kill() if first.poll() is None else None
            if second is not None and second.poll() is None:
                second.kill()

    def test_publication_parent_must_be_owned_and_not_group_or_world_writable(self):
        parent = Path(self.tmp.name) / "untrusted-publication-parent"
        parent.mkdir(mode=0o777)
        os.chmod(parent, 0o777)
        with self.assertRaisesRegex(ValueError, "owned|writable|trusted"):
            with self.compiler.series.create_output_staging(parent / "candidate", "trust-test-"):
                self.fail("untrusted final output parent was accepted")

    def test_protocol_2_contract_and_integration_help_name_current_files(self):
        contract = (ROOT / "docs" / "research" / "company-benefits" /
                    "series-input-contract.md").read_text(encoding="utf-8")
        def documented_files(after):
            block = contract.split(after, 1)[1].split("```text", 1)[1].split("```", 1)[0]
            return set(re.findall(r"(?:├──|└──) ([A-Za-z0-9.-]+)", block))

        self.assertEqual(
            {"candidate.json", *self.validator.CURRENT_ARTIFACT_FILES},
            documented_files("## Authoritative protocol-2 candidate layout"),
        )
        self.assertEqual(
            self.promoter.CURRENT_REVIEW_FILES,
            documented_files("Independent review artifacts must be outside the repository"),
        )
        integrator = self.promoter._load(
            ROOT / "scripts" / "integrate-company-benefits-series-batch.py",
            "documented_current_package_integrator",
        )
        self.assertEqual(
            integrator.CURRENT_ALLOWED_FILES,
            documented_files("## Approved integration package layout"),
        )
        help_result = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "integrate-company-benefits-series-batch.py"), "--help"],
            cwd=ROOT, capture_output=True, text=True, check=False,
        )
        self.assertEqual(0, help_result.returncode, help_result.stderr)
        self.assertNotIn("eleven JSONL artifacts", help_result.stdout)
        self.assertIn("protocol-2 approved package", help_result.stdout)

        promoter_help = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "promote-company-benefits-series-candidate.py"), "--help"],
            cwd=ROOT, capture_output=True, text=True, check=False,
        )
        self.assertEqual(0, promoter_help.returncode, promoter_help.stderr)
        self.assertNotIn("protocol-4", promoter_help.stdout)
        self.assertIn("protocol-2 candidate", promoter_help.stdout)

        validator_help = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "validate-company-benefits-series-candidate.py"), "--help"],
            cwd=ROOT, capture_output=True, text=True, check=False,
        )
        self.assertEqual(0, validator_help.returncode, validator_help.stderr)
        self.assertNotIn("protocol-4", validator_help.stdout)
        self.assertIn("protocol-2", validator_help.stdout)
        self.assertIn("legacy compile and promotion compatibility", contract)
        self.assertNotIn("Schema-version-1 compatibility remains read-only input support", contract)

    def test_compiler_rejects_missing_output_parent_beneath_symlink_without_external_writes(self):
        scratch = self.make_scratch("scratch-missing-parent-symlink")
        external = Path(self.tmp.name) / "compiler-external"
        external.mkdir()
        alias = Path(self.tmp.name) / "compiler-alias"
        alias.symlink_to(external, target_is_directory=True)
        output = alias / "external_parent_created" / "compiled"

        with self.assertRaisesRegex((ValueError, OSError), "safe|symlink|directory"):
            self.compiler.compile_candidate(scratch, output, self.root)
        self.assertFalse((external / "external_parent_created").exists())
        self.assertEqual([], list(external.iterdir()))

    def test_promoter_rejects_missing_output_parent_beneath_symlink_without_external_writes(self):
        self.make_current_candidate()
        self.write_current_review_bundle()
        external = Path(self.tmp.name) / "promoter-external"
        external.mkdir()
        alias = Path(self.tmp.name) / "promoter-alias"
        alias.symlink_to(external, target_is_directory=True)
        output = alias / "external_parent_created" / "approved"

        with self.assertRaisesRegex((ValueError, OSError), "safe|symlink|directory"):
            self.promoter.promote(self.candidate, self.review, output, self.root)
        self.assertFalse((external / "external_parent_created").exists())
        self.assertEqual([], list(external.iterdir()))

    def test_compiler_and_promoter_reject_missing_output_parents_without_writes(self):
        scratch = self.make_scratch("scratch-missing-parent")
        compiled_parent = Path(self.tmp.name) / "compiler-missing" / "nested"
        compiled = compiled_parent / "compiled"
        with self.assertRaisesRegex(ValueError, "parent must pre-exist"):
            self.compiler.compile_candidate(scratch, compiled, self.root)
        self.assertFalse((Path(self.tmp.name) / "compiler-missing").exists())

        self.make_current_candidate()
        self.write_current_review_bundle()
        approved_parent = Path(self.tmp.name) / "promoter-missing" / "nested"
        approved = approved_parent / "approved"
        with self.assertRaisesRegex(ValueError, "parent must pre-exist"):
            self.promoter.promote(self.candidate, self.review, approved, self.root)
        self.assertFalse((Path(self.tmp.name) / "promoter-missing").exists())

    def test_output_parent_component_replacement_creates_nothing_in_moved_or_alias_target(self):
        scratch = self.make_scratch("scratch-parent-component-race")
        parent = Path(self.tmp.name) / "race-parent"
        parent.mkdir()
        moved = Path(self.tmp.name) / "race-parent-moved"
        alias_target = Path(self.tmp.name) / "race-alias-target"
        alias_target.mkdir()
        output = parent / "missing" / "compiled"
        checked_child = self.compiler.series._checked_directory_child
        replaced = False

        def replace_component(parent_fd, name, label):
            nonlocal replaced
            descriptor = checked_child(parent_fd, name, label)
            if name == parent.name and not replaced:
                parent.rename(moved)
                parent.symlink_to(alias_target, target_is_directory=True)
                replaced = True
            return descriptor

        with mock.patch.object(self.compiler.series, "_checked_directory_child",
                               side_effect=replace_component):
            with self.assertRaisesRegex(ValueError, "parent must pre-exist|changed"):
                self.compiler.compile_candidate(scratch, output, self.root)
        self.assertTrue(replaced)
        self.assertEqual([], list(moved.iterdir()))
        self.assertEqual([], list(alias_target.iterdir()))

    def test_promoter_parent_component_replacement_creates_nothing_in_moved_or_alias_target(self):
        self.make_current_candidate()
        self.write_current_review_bundle()
        parent = Path(self.tmp.name) / "promotion-race-parent"
        parent.mkdir()
        moved = Path(self.tmp.name) / "promotion-race-parent-moved"
        alias_target = Path(self.tmp.name) / "promotion-race-alias-target"
        alias_target.mkdir()
        output = parent / "missing" / "approved"
        checked_child = self.promoter.series._checked_directory_child
        replaced = False

        def replace_component(parent_fd, name, label):
            nonlocal replaced
            descriptor = checked_child(parent_fd, name, label)
            if name == parent.name and not replaced:
                parent.rename(moved)
                parent.symlink_to(alias_target, target_is_directory=True)
                replaced = True
            return descriptor

        with mock.patch.object(self.promoter.series, "_checked_directory_child",
                               side_effect=replace_component):
            with self.assertRaisesRegex(ValueError, "parent must pre-exist|changed"):
                self.promoter.promote(self.candidate, self.review, output, self.root)
        self.assertTrue(replaced)
        self.assertEqual([], list(moved.iterdir()))
        self.assertEqual([], list(alias_target.iterdir()))

    def test_output_parent_creation_rejects_parent_traversal(self):
        escaped = Path(self.tmp.name) / "escaped-output-parent"
        traversal = Path(self.tmp.name) / "safe-parent" / ".." / escaped.name / "compiled"
        with self.assertRaisesRegex(ValueError, "invalid"):
            with self.compiler.series.open_existing_output_parent(traversal):
                self.fail("unsafe traversal output parent was accepted")
        self.assertFalse(escaped.exists())

    def test_compiler_rejects_symlinked_output_parent_before_publication(self):
        scratch = self.make_scratch("scratch-unsafe-parent")
        parent = Path(self.tmp.name) / "compiler-parent"
        parent.mkdir()
        replacement = Path(self.tmp.name) / "compiler-parent-replaced"
        output = parent / "compiled"
        publish = self.compiler.series.publish_directory_atomically

        def replace_parent_then_publish(*args):
            parent.rename(replacement)
            parent.symlink_to(replacement, target_is_directory=True)
            return publish(*args)

        with mock.patch.object(self.compiler.series, "publish_directory_atomically",
                               side_effect=replace_parent_then_publish):
            with self.assertRaisesRegex((ValueError, OSError), "safe|symlink|directory"):
                self.compiler.compile_candidate(scratch, output, self.root)
        self.assertFalse(output.exists())
        self.assertFalse((replacement / output.name).exists())

    def test_promoter_rejects_symlinked_output_parent_before_publication(self):
        self.make_current_candidate()
        self.write_current_review_bundle()
        parent = Path(self.tmp.name) / "promoter-parent"
        parent.mkdir()
        replacement = Path(self.tmp.name) / "promoter-parent-replaced"
        output = parent / "approved"
        publish = self.promoter.series.publish_directory_atomically

        def replace_parent_then_publish(*args):
            parent.rename(replacement)
            parent.symlink_to(replacement, target_is_directory=True)
            return publish(*args)

        with mock.patch.object(self.promoter.series, "publish_directory_atomically",
                               side_effect=replace_parent_then_publish):
            with self.assertRaisesRegex((ValueError, OSError), "safe|symlink|directory"):
                self.promoter.promote(self.candidate, self.review, output, self.root)
        self.assertFalse(output.exists())
        self.assertFalse((replacement / output.name).exists())

    def test_candidate_cli_fails_closed_on_unhashable_v2_binding_without_writes(self):
        self.v2_records["cells"][0]["attempt_ids"] = [["unhashable"]]
        self.write_candidate()
        before = {path.relative_to(self.candidate): path.read_bytes()
                  for path in self.candidate.iterdir() if path.is_file()}
        result = subprocess.run(
            [sys.executable, str(VALIDATOR), str(self.candidate), "--research-root", str(self.root)],
            cwd=ROOT, text=True, capture_output=True, check=False,
        )
        output = result.stdout + result.stderr
        after = {path.relative_to(self.candidate): path.read_bytes()
                 for path in self.candidate.iterdir() if path.is_file()}
        self.assertEqual(1, result.returncode, output)
        self.assertIn("invalid v2 record structure", output)
        self.assertNotIn("Traceback", output)
        self.assertEqual("", result.stdout)
        self.assertEqual(before, after)

    def test_every_gap_requires_a_nonempty_official_source_id_route(self):
        self.gaps[0]["searched_official_source_ids"] = []
        self.write_candidate()
        with self.assertRaisesRegex(ValueError, "nonempty|source-ID|official route"):
            self.validator.validate_candidate(self.candidate, self.root)

    def test_gap_rejects_url_only_route(self):
        self.gaps[0]["searched_official_source_ids"] = []
        self.gaps[0]["searched_official_urls"] = [self.sources[0]["url"]]
        self.write_candidate()
        with self.assertRaisesRegex(ValueError, "source-ID|source_id|raw searched URLs"):
            self.validator.validate_candidate(self.candidate, self.root)

    def test_gap_rejects_orphan_source_id(self):
        self.gaps[0]["searched_official_source_ids"] = ["orphan-official-route"]
        self.write_candidate()
        with self.assertRaisesRegex(ValueError, "does not resolve|orphan"):
            self.validator.validate_candidate(self.candidate, self.root)

    def test_gap_rejects_generic_or_nonmetadata_route(self):
        for field, value in (("route_quality", "generic"), ("entity_binding_status", "generic_route"),
                             ("record_type", None)):
            with self.subTest(field=field):
                original = self.sources[0].get(field)
                if value is None:
                    self.sources[0].pop(field)
                else:
                    self.sources[0][field] = value
                self.write_candidate()
                with self.assertRaisesRegex(ValueError, "exact-entity|metadata|official route|schema"):
                    self.validator.validate_candidate(self.candidate, self.root)
                self.sources[0][field] = original

    def test_gap_route_requires_post_review_source_id_check(self):
        self.write_review_bundle(checks=[])
        with self.assertRaisesRegex(ValueError, "post-review checks|missing|cover"):
            self.promoter.promote(self.candidate, self.review, self.output, self.root)

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
        with self.assertRaisesRegex(ValueError, "canonical.*gap"):
            self.validator.validate_candidate(self.candidate, self.root)
        self.gaps[0]["audit_id"] = self.gap(self.company_ids[0])["audit_id"]
        self.write_candidate()
        manifest = json.loads((self.candidate / "candidate.json").read_bytes())
        manifest["artifacts"]["gaps.jsonl"] = "0" * 64
        (self.candidate / "candidate.json").write_bytes(json_bytes(manifest))
        with self.assertRaisesRegex(ValueError, "artifact hash"):
            self.validator.validate_candidate(self.candidate, self.root)

    def test_candidate_rejects_noncanonical_file_and_directory_modes(self):
        os.chmod(self.candidate / "claims.jsonl", 0o755)
        with self.assertRaisesRegex(ValueError, "mode|permissions"):
            self.validator.validate_candidate(self.candidate, self.root)
        os.chmod(self.candidate / "claims.jsonl", 0o644)
        os.chmod(self.candidate, 0o775)
        with self.assertRaisesRegex(ValueError, "mode|permissions"):
            self.validator.validate_candidate(self.candidate, self.root)

    def test_candidate_rejects_symlinked_artifact_even_with_matching_mode_and_bytes(self):
        artifact = self.candidate / "claims.jsonl"
        outside = Path(self.tmp.name) / "outside-claims.jsonl"
        outside.write_bytes(artifact.read_bytes())
        artifact.unlink()
        artifact.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, "symlink|regular file"):
            self.validator.validate_candidate(self.candidate, self.root)

    def test_candidate_rejects_symlinked_parent_directory(self):
        alias = Path(self.tmp.name) / "candidate-parent-alias"
        alias.symlink_to(self.candidate.parent, target_is_directory=True)
        aliased_candidate = alias / self.candidate.name
        with self.assertRaisesRegex(ValueError, "symlink"):
            self.validator.validate_candidate(aliased_candidate, self.root)

    def test_candidate_allows_root_relative_web_asset_paths(self):
        for path in (
            "/btn_programInfo01.png",
            "/images/foo.svg",
            "/images/icons/v1.2/foo.svg",
            "/btn_programInfo01.png)](/health/contents.do) [more](https://example.com)",
        ):
            with self.subTest(path=path):
                self.validator._reject_local_absolute_paths(path)

    def test_candidate_rejects_root_relative_filesystem_and_traversal_bypasses(self):
        for path in (
            "/bin",
            "/sbin",
            "/dev",
            "/proc",
            "/sys",
            "/run",
            "/srv",
            "/mnt",
            "/media",
            "/boot",
            "/lib",
            "/lib64",
            "/bin/sh",
            "/dev/null",
            "/proc/self/environ",
            "/sys/kernel",
            "/run/secrets/x",
            "//server/share/x",
            "/images/../../etc/passwd",
            "/images/%2e%2e/etc/passwd",
            "%2fetc/passwd",
            "%252fetc/passwd",
            "%25252fetc/passwd",
            "/%65tc/passwd",
            "/%2fserver/share",
            "/images/logo.svg?next=/etc/passwd",
            "/images/logo.svg?next=%252fetc/passwd",
            "/images/logo.svg#../../etc/passwd",
            "/Applications/private.app",
            "/System/Library/private",
            "/Volumes/private/capture",
            r"/images\private.png",
            "/images:private.png",
            "/images/\x00private.png",
        ):
            with self.subTest(path=path), self.assertRaisesRegex(
                ValueError, "local absolute path"
            ):
                self.validator._reject_local_absolute_paths(path)

    def test_candidate_fails_closed_when_percent_decoding_exceeds_bound(self):
        path = "/etc/passwd"
        for _ in range(self.validator.MAX_PERCENT_DECODE_PASSES + 1):
            path = path.replace("%", "%25").replace("/", "%2f")
        with self.assertRaisesRegex(ValueError, "local absolute path"):
            self.validator._reject_local_absolute_paths(path)

    def test_candidate_allows_benign_root_relative_query_and_fragment(self):
        for path in (
            "/images/logo.svg?v=1.2",
            "/images/logo.svg#brand-mark",
        ):
            with self.subTest(path=path):
                self.validator._reject_local_absolute_paths(path)

    def test_candidate_rejects_local_absolute_paths_in_package_fields(self):
        for path in (
            "/",
            "/home/bread",
            "/etc/passwd",
            "/tmp/private/capture.html",
            "/var/tmp/capture.html",
            "/usr/local/bin/tool",
            "/opt/tool/capture.html",
            "/root/private/capture.html",
            "/Users/researcher/private/capture.html",
            "/private/capture.html",
            r"\private\capture.html",
            r"\\server\share\capture.html",
            r"C:\\Users\\researcher\\capture.html",
            "file:///",
            "file:///home/researcher/capture.html",
            "FILE:///home/researcher/capture.html",
        ):
            with self.subTest(path=path), self.assertRaisesRegex(
                ValueError, "local absolute path"
            ):
                self.validator._reject_local_absolute_paths(path)

        _, claim = self.use_factual_claim()
        claim["source_locator"] = "/home/researcher/private/capture.html"
        claim["source_evidence"][0]["source_locator"] = claim["source_locator"]
        self.write_candidate()
        with self.assertRaisesRegex(ValueError, "local absolute path"):
            self.validator.validate_candidate(self.candidate, self.root)

    def test_claim_source_ids_must_equal_source_evidence_closure(self):
        _, claim = self.use_factual_claim()
        claim["source_evidence"][0]["source_id"] = "different-source"
        self.write_candidate()
        with self.assertRaisesRegex(ValueError, "source_ids.*source_evidence|source closure"):
            self.validator.validate_candidate(self.candidate, self.root)

    def test_candidate_hashes_every_v2_ledger(self):
        for filename in (
            "company-category-cells.jsonl", "research-attempts.jsonl", "official-claims-v2.jsonl",
            "reference-records.jsonl", "community-benefit-reports.jsonl", "sources-v2.jsonl",
        ):
            with self.subTest(filename=filename):
                original = (self.candidate / filename).read_bytes()
                (self.candidate / filename).write_bytes(original + b"\n")
                with self.assertRaisesRegex(ValueError, f"artifact hash mismatch: {filename}"):
                    self.validator.validate_candidate(self.candidate, self.root)
                (self.candidate / filename).write_bytes(original)

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
        with self.assertRaisesRegex(ValueError, "publishable|claim source|schema|source closure"):
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
        checks = [{"source_id": source["source_id"], "url": source["url"], "status": 200,
                   "final_url": source["url"],
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
        check = {"source_id": source["source_id"], "url": source["url"], "status": 200,
                 "final_url": source["url"],
                 "marker": source["http_verification"]["expected_marker"], "marker_confirmed": True,
                 "content_sha256": source["content_sha256"], "checked_at": "2026-10-30T03:00:00Z"}
        self.write_review_bundle(reviews=reviews, checks=[check])
        self.promoter.promote(self.candidate, self.review, self.output, self.root)
        promoted_claim = json.loads((self.output / "claims.jsonl").read_text())
        self.assertNotIn("prepublication_checked_at", promoted_claim)

    def test_publishable_check_must_match_exact_https_source_hash_marker_and_final_url(self):
        source, claim = self.use_factual_claim()
        valid = {"source_id": source["source_id"], "url": source["url"], "status": 200,
                 "final_url": source["url"],
                 "marker": source["http_verification"]["expected_marker"], "marker_confirmed": True,
                 "content_sha256": source["content_sha256"], "checked_at": "2026-10-30T03:00:00Z"}
        for field, value in (("status", 403), ("final_url", "https://other.example/"),
                             ("marker", "wrong"), ("content_sha256", "f" * 64)):
            with self.subTest(field=field):
                self.write_review_bundle(reviews=self.factual_reviews(claim), checks=[dict(valid, **{field: value})])
                with self.assertRaisesRegex(ValueError, "publishable|exact|check"):
                    self.promoter.promote(self.candidate, self.review, self.output, self.root)

    def test_same_url_supports_distinct_source_id_marker_locator_and_hash_checks(self):
        first, claim = self.use_factual_claim(url="https://www.dol.gov/shared/archive.zip")
        second = copy.deepcopy(first)
        second.update(source_id="official-benefit-policy-part-b", locator="form-5500:plan-b",
                      supporting_quote="Dental support is offered.", content_sha256="b" * 64)
        second["http_verification"] = dict(first["http_verification"], expected_marker="Plan B")
        self.sources.append(second)
        claim["source_ids"].append(second["source_id"])
        claim["source_evidence"].append({"source_id": second["source_id"], "role": "primary_claim_evidence",
                                         "proposition": claim["detail"], "source_locator": second["locator"],
                                         "supporting_quote": second["supporting_quote"],
                                         "content_sha256": second["content_sha256"]})
        self.write_candidate()
        checks = [self.source_check(first), self.source_check(second)]
        self.write_review_bundle(reviews=self.factual_reviews(claim), checks=checks)
        self.promoter.promote(self.candidate, self.review, self.output, self.root)
        promoted = [json.loads(line) for line in (self.output / "checks.jsonl").read_text().splitlines()]
        self.assertEqual([first["source_id"], second["source_id"], "kr-dart-exact-entity-route"],
                         [item["source_id"] for item in promoted])

    def test_source_id_check_coverage_rejects_missing_competing_orphan_and_cross_source_tuple(self):
        first, claim = self.use_factual_claim(url="https://www.dol.gov/shared/archive.zip")
        second = copy.deepcopy(first)
        second.update(source_id="official-benefit-policy-part-b", locator="form-5500:plan-b",
                      content_sha256="b" * 64)
        second["http_verification"] = dict(first["http_verification"], expected_marker="Plan B")
        self.sources.append(second)
        claim["source_ids"].append(second["source_id"])
        claim["source_evidence"].append(dict(claim["source_evidence"][0], source_id=second["source_id"],
                                             source_locator=second["locator"], content_sha256=second["content_sha256"]))
        self.write_candidate()
        valid = [self.source_check(first), self.source_check(second)]
        cases = [
            (valid[:-1], "missing|cover"),
            (valid + [dict(valid[-1], checked_at="2026-10-30T03:30:00Z")], "conflicting|tuple"),
            (valid + [dict(valid[-1], source_id="orphan")], "orphan|cover"),
            ([valid[0], dict(valid[1], marker=first["http_verification"]["expected_marker"])], "source|tuple|marker"),
        ]
        for checks, message in cases:
            with self.subTest(message=message):
                self.write_review_bundle(reviews=self.factual_reviews(claim), checks=checks)
                with self.assertRaisesRegex(ValueError, message):
                    self.promoter.promote(self.candidate, self.review, self.output, self.root)

    def test_official_identity_projection_is_stable_but_rejects_identity_drift(self):
        source, identity = self.normalized_identity_source()
        _, claim = self.use_factual_claim()
        claim.update(status="unknown", evidence_grade="none", source_ids=[], searched_source_ids=[source["source_id"]],
                     searched_at="2026-10-30T01:00:00Z", search_scope="benefit_nonclaim")
        for field in ("source_evidence", "source_locator", "supporting_quote", "content_sha256"):
            claim.pop(field)
        self.sources = [source, self.metadata_source()]
        self.write_candidate()
        self.validator.validate_candidate(self.candidate, self.root)
        reviews = [{"review_id": f"review::{claim['claim_id']}", "claim_id": claim["claim_id"],
                    "researcher_id": "researcher-a", "reviewer_id": "reviewer-b", "decision": "approved",
                    "reviewed_at": "2026-10-30T02:00:00Z", "issues": [], "resolution": "approved unknown",
                    "quote_entailment_confirmed": True},
                   *self.factual_reviews({**claim, "source_evidence": []})[1:]]
        check = self.source_check(source, normalization={"algorithm": "sec-submissions-identity", "version": "1",
                                                         "official_response_identity": {"cik": 123456,
                                                                                        "name": identity["legal_name"],
                                                                                        "ein": identity["ein"]},
                                                         "projection_sha256": source["content_sha256"]})
        self.write_review_bundle(reviews=reviews, checks=[check])
        self.promoter.promote(self.candidate, self.review, self.output, self.root)
        for field, value in (("name", "EXAMPLE CORP RENAMED"), ("ein", "00-0000000"), ("cik", 654321)):
            with self.subTest(field=field):
                mutated = copy.deepcopy(check)
                mutated["normalization"]["official_response_identity"][field] = value
                self.write_review_bundle(reviews=reviews, checks=[mutated])
                with self.assertRaisesRegex(ValueError, "identity|projection|normalization"):
                    self.promoter.promote(self.candidate, self.review, self.output, self.root)

    def test_normalized_identity_provenance_cannot_support_benefit_claim_prose(self):
        source, _ = self.normalized_identity_source()
        _, claim = self.use_factual_claim()
        self.sources = [source, self.metadata_source()]
        claim["source_ids"] = [source["source_id"]]
        claim["source_evidence"][0].update(source_id=source["source_id"], content_sha256=source["content_sha256"])
        self.write_candidate()
        with self.assertRaisesRegex(ValueError, "identity|benefit|claim"):
            self.validator.validate_candidate(self.candidate, self.root)

    def frozen_current_check(self):
        self.sources[0]["access_observation"] = {"status": 403, "final_url": self.sources[0]["url"],
                                                 "access_wall": "bot_or_network_block"}
        raw = jsonl_bytes(self.sources)
        (self.root / "source-registry.jsonl").write_bytes(raw)
        self.write_candidate()
        return {"source_id": self.sources[0]["source_id"], "url": self.sources[0]["url"],
                "status": 200, "final_url": self.sources[0]["url"], "access_wall": "none",
                "checked_at": "2026-10-30T03:00:00Z",
                "compatibility_projection": {"algorithm": "immutable-legacy-source-v1",
                                             "legacy_record_sha256": digest(raw)}}

    def test_frozen_bot_block_accepts_fresh_check_with_explicit_audit(self):
        check = self.frozen_current_check()
        frozen = (self.root / "source-registry.jsonl").read_bytes()
        self.write_review_bundle(checks=[check])
        self.promoter.promote(self.candidate, self.review, self.output, self.root)
        self.assertEqual(frozen, (self.output / "sources.jsonl").read_bytes())
        self.assertEqual(frozen, (self.root / "source-registry.jsonl").read_bytes())

    def test_existing_historical_check_accepts_projected_refresh_and_later_change(self):
        check = self.frozen_current_check()
        historical = {key: value for key, value in check.items() if key != "compatibility_projection"}
        historical.update(self.sources[0]["access_observation"], checked_at="2026-10-29T03:00:00Z")
        ledger = self.root / "series-prepublication-checks.jsonl"
        frozen = (self.root / "source-registry.jsonl").read_bytes()
        for previous, current in ((historical, check), (check, dict(check, status=403,
                access_wall="bot_or_network_block", checked_at="2026-10-30T03:30:00Z"))):
            with self.subTest(previous=previous):
                ledger.write_bytes(jsonl_bytes([previous]))
                self.write_review_bundle(checks=[current])
                output = self.output if previous == historical else self.output.with_name("approved-later")
                self.promoter.promote(self.candidate, self.review, output, self.root)
                self.assertEqual(frozen, (output / "sources.jsonl").read_bytes())
                self.assertEqual(frozen, (self.root / "source-registry.jsonl").read_bytes())

    def test_effective_checks_are_bound_unambiguous_and_order_independent(self):
        current = self.frozen_current_check()
        historical = {key: value for key, value in current.items() if key != "compatibility_projection"}
        historical.update(self.sources[0]["access_observation"], checked_at="2026-10-29T03:00:00Z")
        integrator = load(ROOT / "scripts/integrate-company-benefits-series-batch.py", "selection_integrator")
        source_id = current["source_id"]
        bindings = dict(source_map={source_id: self.sources[0]},
                        legacy_sources={source_id: (self.root / "source-registry.jsonl").read_bytes()})
        later = dict(current, checked_at="2026-10-30T03:30:00Z")
        for existing in ([historical, current], [current, historical], [current, copy.deepcopy(current)]):
            self.assertEqual([later], integrator.merge_checks(existing, [later, copy.deepcopy(later)],
                             {source_id: "2026-10-30T02:00:00Z"}, **bindings))
        competing = dict(current, status=403, access_wall="bot_or_network_block")
        for existing, incoming in (([historical], [current, competing]),
                                   ([current, competing], [later]),
                                   ([historical, current, dict(historical, checked_at="2026-10-28T03:00:00Z")], [later]),
                                   ([dict(historical, checked_at=later["checked_at"]), current], [later]),
                                   ([current], [dict(historical, checked_at=later["checked_at"])])):
            with self.assertRaises(ValueError):
                integrator.merge_checks(existing, incoming, {source_id: "2026-10-30T02:00:00Z"}, **bindings)
        with self.assertRaisesRegex(ValueError, "unbound"):
            integrator.merge_checks([historical], [current], {source_id: "2026-10-30T02:00:00Z"})
        # A projection cannot bring another workflow's check fields into this ledger.
        with self.assertRaises(ValueError):
            integrator.merge_checks([], [dict(current, workflow="unrelated")],
                                    {source_id: "2026-10-30T02:00:00Z"}, **bindings)
        other_id = "other-source-same-url"
        substituted = dict(current, source_id=other_id)
        other_source = dict(self.sources[0], source_id=other_id)
        with self.assertRaises(ValueError):
            integrator.merge_checks([], [substituted], {other_id: "2026-10-30T02:00:00Z"},
                source_map={other_id: other_source}, legacy_sources={other_id: bindings["legacy_sources"][source_id]})
        unrelated = dict(historical, source_id=other_id)
        result = integrator.merge_checks([unrelated, historical], [current],
                         {source_id: "2026-10-30T02:00:00Z"}, **bindings)
        self.assertEqual({source_id, other_id}, {item["source_id"] for item in result})

    def test_duplicate_projected_artifact_is_identical_or_rejected(self):
        check = self.frozen_current_check()
        self.write_review_bundle(checks=[check, copy.deepcopy(check)])
        self.promoter.promote(self.candidate, self.review, self.output, self.root)
        ledger = self.root / "series-prepublication-checks.jsonl"
        ledger.write_bytes(jsonl_bytes([check]) + json.dumps(check).encode() + b"\n")
        integrator = load(ROOT / "scripts/integrate-company-benefits-series-batch.py", "duplicate_integrator")
        with self.assertRaisesRegex(ValueError, "byte-identical"):
            integrator.load_package(self.output, self.root)

    def test_historical_success_can_be_followed_by_projected_failure(self):
        check = self.frozen_current_check()
        self.sources[0]["access_observation"] = {"status": 200, "final_url": check["url"], "access_wall": "none"}
        frozen = jsonl_bytes(self.sources)
        (self.root / "source-registry.jsonl").write_bytes(frozen)
        self.write_candidate()
        historical = {key: value for key, value in check.items() if key != "compatibility_projection"}
        historical["checked_at"] = "2026-10-29T03:00:00Z"
        (self.root / "series-prepublication-checks.jsonl").write_bytes(jsonl_bytes([historical]))
        check.update(status=403, access_wall="bot_or_network_block")
        check["compatibility_projection"]["legacy_record_sha256"] = digest(frozen)
        self.write_review_bundle(checks=[check])
        self.promoter.promote(self.candidate, self.review, self.output, self.root)
        self.assertEqual(frozen, (self.output / "sources.jsonl").read_bytes())

    def test_frozen_check_rejects_absent_or_forged_projection(self):
        for mode in ("absent", "forged", "unanchored"):
            check = self.frozen_current_check()
            if mode == "absent":
                del check["compatibility_projection"]
            elif mode == "forged":
                check["compatibility_projection"]["legacy_record_sha256"] = "0" * 64
            else:
                (self.root / "source-registry.jsonl").write_bytes(b"")
            self.write_review_bundle(checks=[check])
            with self.assertRaises(ValueError):
                self.promoter.promote(self.candidate, self.review, self.output, self.root)

    def test_frozen_source_rejects_nonvolatile_and_byte_changes(self):
        self.frozen_current_check()
        self.sources[0]["owner"] = "Changed owner"
        self.write_candidate()
        with self.assertRaisesRegex(ValueError, "legacy|frozen"):
            self.validator.validate_candidate(self.candidate, self.root)
        self.frozen_current_check()
        path = self.root / "source-registry.jsonl"
        path.write_text(json.dumps(self.sources[0]) + "\n")
        with self.assertRaisesRegex(ValueError, "legacy|frozen"):
            self.validator.validate_candidate(self.candidate, self.root)

    def test_compiler_preserves_frozen_source_and_rejects_mutation(self):
        self.frozen_current_check()
        self.test_scratch_compiler_is_separate_and_deterministic()
        frozen = (self.root / "source-registry.jsonl").read_bytes()
        compiled = Path(self.tmp.name) / "compiled"
        self.assertEqual(frozen, (compiled / "sources.jsonl").read_bytes())
        scratch = Path(self.tmp.name) / "scratch"
        mutated = dict(self.sources[0], owner="Changed owner")
        (scratch / "sources.jsonl").write_bytes(jsonl_bytes([mutated]))
        with self.assertRaisesRegex(ValueError, "legacy|frozen"):
            self.compiler.compile_candidate(scratch, compiled, self.root)
        self.assertEqual(frozen, (compiled / "sources.jsonl").read_bytes())

    def test_frozen_current_check_rejects_inconsistent_metadata(self):
        for updates in ({"access_wall": "bot_or_network_block"}, {"status": None},
                        {"final_url": "http://insecure.example"}, {"status": True}, {"status": 999},
                        {"access_wall": []}, {"final_url": "https://"}):
            check = self.frozen_current_check()
            check.update(updates)
            self.write_review_bundle(checks=[check])
            with self.assertRaises(ValueError):
                self.promoter.promote(self.candidate, self.review, self.output, self.root)

    def test_metadata_gap_accepts_exact_failed_observation_but_not_mutation(self):
        self.sources[0]["access_observation"] = {"status": 403, "final_url": self.sources[0]["url"],
                                                 "access_wall": "bot_or_network_block"}
        self.write_candidate()
        check = {"source_id": self.sources[0]["source_id"], "url": self.sources[0]["url"],
                 **self.sources[0]["access_observation"], "checked_at": "2026-10-30T03:00:00Z"}
        self.write_review_bundle(checks=[check])
        self.promoter.promote(self.candidate, self.review, self.output, self.root)
        self.assertNotIn("content_sha256", json.loads((self.output / "checks.jsonl").read_text()))
        self.write_review_bundle(checks=[dict(check, status=404)])
        with self.assertRaisesRegex(ValueError, "metadata|observation|exact"):
            self.promoter.promote(self.candidate, self.review, self.output, self.root)

    def test_metadata_gap_approval_rejects_exact_network_failure_without_final_url(self):
        self.sources[0]["access_observation"] = {"status": None, "final_url": None,
                                                 "access_wall": "bot_or_network_block"}
        self.write_candidate()
        check = {"source_id": self.sources[0]["source_id"], "url": self.sources[0]["url"],
                 **self.sources[0]["access_observation"], "checked_at": "2026-10-30T03:00:00Z"}
        self.write_review_bundle(checks=[check])
        with self.assertRaisesRegex(ValueError, "approved.*final URL|final URL.*approved"):
            self.promoter.promote(self.candidate, self.review, self.output, self.root)
        self.assertFalse(self.output.exists())

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
        write_records(scratch, self.v2_records, jsonl_bytes)
        self.compiler.compile_candidate(scratch, compiled, self.root)
        first = {path.name: path.read_bytes() for path in compiled.iterdir()}
        self.compiler.compile_candidate(scratch, compiled, self.root)
        self.assertEqual(first, {path.name: path.read_bytes() for path in compiled.iterdir()})
        self.validator.validate_candidate(compiled, self.root)

    def test_compiler_migrates_legacy_gap_ids_to_batch_qualified_ids(self):
        scratch = Path(self.tmp.name) / "scratch-gap-id-migration"
        compiled = Path(self.tmp.name) / "compiled-gap-id-migration"
        scratch.mkdir()
        draft = {key: self.batch[key] for key in (
            "batch_id", "company_list_sha256", "effective_sequence_sha256", "replacement_events_sha256"
        )}
        draft.update(schema_version="1", researcher_id="researcher-a")
        (scratch / "draft.json").write_bytes(json_bytes(draft))
        (scratch / "sources.jsonl").write_bytes(jsonl_bytes(self.sources))
        (scratch / "claims.jsonl").write_bytes(jsonl_bytes(self.claims))
        legacy = [dict(gap, audit_id=f"company-gap::{gap['company_id']}") for gap in self.gaps]
        (scratch / "gaps.jsonl").write_bytes(jsonl_bytes(legacy))
        write_records(scratch, self.v2_records, jsonl_bytes)

        self.compiler.compile_candidate(scratch, compiled, self.root)

        gaps = self.validator.read_jsonl(compiled / "gaps.jsonl")
        self.assertEqual(
            [f"company-gap::v2::{self.batch['batch_id']}::{company_id}" for company_id in self.company_ids],
            [gap["audit_id"] for gap in gaps],
        )
        requests = self.validator.read_jsonl(compiled / "review-requests.jsonl")
        self.assertEqual([gap["audit_id"] for gap in gaps], [request["target_id"] for request in requests])

    def test_candidate_rejects_wrong_batch_arbitrary_and_unfrozen_legacy_gap_ids(self):
        original = self.gaps[0]["audit_id"]
        for audit_id in (
            f"company-gap::v2::domestic-35::{self.company_ids[0]}",
            f"other-gap::v2::{self.batch['batch_id']}::{self.company_ids[0]}",
            f"company-gap::{self.company_ids[0]}",
        ):
            with self.subTest(audit_id=audit_id):
                self.gaps[0]["audit_id"] = audit_id
                self.requests[0] = self.request(audit_id, "gap")
                self.write_candidate()
                with self.assertRaisesRegex(ValueError, "gap ID|canonical|legacy|batch"):
                    self.validator.validate_candidate(self.candidate, self.root)
        self.gaps[0]["audit_id"] = original
        self.requests[0] = self.request(original, "gap")
        self.write_candidate()

    def test_promoter_rejects_mixed_gap_id_review_binding(self):
        reviews = [{"review_id": f"review::{gap['audit_id']}", "record_id": gap["audit_id"],
                    "researcher_id": "researcher-a", "reviewer_id": "reviewer-b", "decision": "approved",
                    "reviewed_at": "2026-10-30T02:00:00Z", "issues": [], "resolution": "approved",
                    "quote_entailment_confirmed": True} for gap in self.gaps]
        reviews[0]["record_id"] = f"company-gap::{self.company_ids[0]}"
        self.write_review_bundle(reviews=reviews)
        with self.assertRaisesRegex(ValueError, "orphan|coverage|binding"):
            self.promoter.promote(self.candidate, self.review, self.output, self.root)

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
        stale = [{"source_id": self.sources[0]["source_id"], "url": self.sources[0]["url"],
                  **self.sources[0]["access_observation"],
                  "checked_at": "2026-10-30T01:30:00Z"}]
        self.write_review_bundle(checks=stale)
        with self.assertRaisesRegex(ValueError, "post-review|follow"):
            self.promoter.promote(self.candidate, self.review, self.output, self.root)

    def test_promotion_emits_exact_existing_six_file_package_deterministically(self):
        self.write_review_bundle()
        self.promoter.promote(self.candidate, self.review, self.output, self.root)
        expected = {"batch.json", "sources.jsonl", "claims.jsonl", "reviews.jsonl", "gaps.jsonl", "checks.jsonl",
                    "company-category-cells.jsonl", "research-attempts.jsonl", "official-claims-v2.jsonl",
                    "reference-records.jsonl", "community-benefit-reports.jsonl", "sources-v2.jsonl"}
        self.assertEqual(expected, {p.name for p in self.output.iterdir()})
        first = {p.name: p.read_bytes() for p in self.output.iterdir()}
        self.promoter.promote(self.candidate, self.review, self.output, self.root)
        self.assertEqual(first, {p.name: p.read_bytes() for p in self.output.iterdir()})
        manifest = json.loads((self.output / "batch.json").read_bytes())
        self.assertEqual("approved", manifest["status"])
        self.assertEqual({name for name in expected if name != "batch.json"}, set(manifest["artifacts"]))


if __name__ == "__main__":
    unittest.main()
