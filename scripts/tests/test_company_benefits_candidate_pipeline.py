import copy
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

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
            "audit_id": f"company-gap::{company_id}", "company_id": company_id, "disposition": "nonpublishable",
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
        with self.assertRaisesRegex(ValueError, "canonical gap"):
            self.validator.validate_candidate(self.candidate, self.root)
        self.gaps[0]["audit_id"] = f"company-gap::{self.company_ids[0]}"
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

    def test_source_id_check_coverage_rejects_missing_duplicate_orphan_and_cross_source_tuple(self):
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
            (valid + [copy.deepcopy(valid[-1])], "duplicate|cover"),
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

    def test_metadata_gap_accepts_exact_network_failure_without_final_url(self):
        self.sources[0]["access_observation"] = {"status": None, "final_url": None,
                                                 "access_wall": "bot_or_network_block"}
        self.write_candidate()
        check = {"source_id": self.sources[0]["source_id"], "url": self.sources[0]["url"],
                 **self.sources[0]["access_observation"], "checked_at": "2026-10-30T03:00:00Z"}
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
        write_records(scratch, self.v2_records, jsonl_bytes)
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
