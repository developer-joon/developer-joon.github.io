import copy
import hashlib
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.tests import test_company_benefits_candidate_pipeline as pipeline

ROOT = pipeline.ROOT
json_bytes = pipeline.json_bytes
jsonl_bytes = pipeline.jsonl_bytes
COMPILER = ROOT / "scripts" / "compile-company-benefits-independent-review.py"
EXPECTED = {"review-bundle.json", "reviews.jsonl", "checks.jsonl", "reviewed-candidate.json", "reviewer-receipt.json"}


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


class IndependentReviewCompilerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        pipeline.CandidatePipelineTests.setUpClass()

    def setUp(self):
        self.fixture = pipeline.CandidatePipelineTests(methodName="runTest")
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)
        self.fixture.use_factual_claim()
        self.fixture.use_current_verified_benefit()
        self.input = Path(self.fixture.tmp.name) / "review-input"
        self.input.mkdir()
        self.output_parent = Path(self.fixture.tmp.name) / "private-review-output"
        self.output_parent.mkdir(mode=0o700)
        self.output = self.output_parent / "review"
        self.reviews = self.fixture.factual_reviews(self.fixture.claims[0])
        self.checks = [self.fixture.review_check(source) for source in self.fixture.sources]
        self.decision = {
            "schema_version": "1",
            "candidate_manifest_sha256": digest((self.fixture.candidate / "candidate.json").read_bytes()),
            "reviewer_id": "reviewer-b", "status": "approved",
            "reviewed_at": "2026-10-30T02:00:00Z", "approved_at": "2026-10-30T04:00:00Z",
        }
        self.write_input()
        self.compiler = load(COMPILER, "independent_review_compiler")

    def write_input(self):
        (self.input / "dispositions.jsonl").write_bytes(jsonl_bytes(self.reviews))
        (self.input / "checks.jsonl").write_bytes(jsonl_bytes(self.checks))
        (self.input / "decision.json").write_bytes(json_bytes(self.decision))

    def compile(self, **kwargs):
        return self.compiler.compile_review(
            self.fixture.candidate, self.input, self.output, self.fixture.root, **kwargs
        )

    def snapshot_output(self):
        if not self.output.exists():
            return None
        return {path.name: path.read_bytes() for path in self.output.iterdir()}

    def test_compiles_nonempty_protocol_2_review_and_reuses_promoter_validation(self):
        with mock.patch.object(self.compiler, "validate_with_promoter", wraps=self.compiler.validate_with_promoter) as validate:
            result = self.compile()
        self.assertEqual(EXPECTED, {path.name for path in self.output.iterdir()})
        self.assertEqual("approved", result["status"])
        self.assertTrue(validate.called)
        package = self.fixture.validator.validate_candidate(self.fixture.candidate, self.fixture.root)
        self.fixture.promoter.validate_external_review(package, self.output, self.fixture.validator)
        reviewed = json.loads((self.output / "reviewed-candidate.json").read_bytes())
        self.assertGreater(len(reviewed), 0)

    def test_lint_only_validates_without_writing(self):
        result = self.compile(lint_only=True)
        self.assertEqual("approved", result["status"])
        self.assertFalse(self.output.exists())

    def test_publication_never_overwrites_an_existing_review(self):
        self.compile()
        before = self.snapshot_output()
        with self.assertRaisesRegex(ValueError, "overwrite|already exists"):
            self.compile()
        self.assertEqual(before, self.snapshot_output())

    def test_reject_and_rework_are_represented_but_not_promotable(self):
        for status, decision in (("rejected", "rejected"), ("rework", "changes_required")):
            with self.subTest(status=status):
                self.reviews[0].update(decision=decision, quote_entailment_confirmed=False,
                                       issues=["evidence does not entail the proposition"],
                                       resolution="Return to research.")
                self.decision["status"] = status
                self.write_input()
                output = self.output.with_name(status)
                result = self.compiler.compile_review(
                    self.fixture.candidate, self.input, output, self.fixture.root
                )
                self.assertEqual(status, result["status"])
                receipt = json.loads((output / "reviewer-receipt.json").read_bytes())
                self.assertEqual(status, receipt["status"])
                package = self.fixture.validator.validate_candidate(self.fixture.candidate, self.fixture.root)
                with self.assertRaisesRegex(ValueError, "approved|approval|promot"):
                    self.fixture.promoter.validate_external_review(package, output, self.fixture.validator)
                self.reviews = self.fixture.factual_reviews(self.fixture.claims[0])

    def test_approved_rejects_authoritative_failed_metadata_source_check(self):
        route = next(source for source in self.fixture.sources
                     if source.get("record_type") == "nonpublishable_metadata")
        route["access_observation"] = {
            "status": None, "final_url": None,
            "access_wall": "bot_or_network_block",
        }
        propositions = [json.loads(line) for line in
                        (self.fixture.candidate / "verified-benefit-candidates.jsonl").read_text().splitlines()]
        self.fixture.write_candidate()
        self.fixture.make_current_candidate(propositions)
        self.checks = [self.fixture.review_check(source) for source in self.fixture.sources]
        self.decision["candidate_manifest_sha256"] = digest(
            (self.fixture.candidate / "candidate.json").read_bytes()
        )
        self.write_input()

        with self.assertRaisesRegex(ValueError, "approved.*final URL|final URL.*approved"):
            self.compile()

        self.assertFalse(self.output.exists())

    def test_non_null_source_check_final_url_remains_credential_free_https(self):
        self.checks[0]["final_url"] = "https://reviewer:secret@example.com/source"
        self.write_input()

        with self.assertRaisesRegex(ValueError, "final URL must be credential-free HTTPS"):
            self.compile()

        self.assertFalse(self.output.exists())

    def _assert_real_compiler_and_promoter_reject_percent_encoded_authorities(self):
        self.reviews = self.fixture.factual_reviews(self.fixture.claims[0])
        encoded_authorities = (
            "https://%65xample.invalid/source",
            "https://example.invalid%2eattacker/source",
            "https://example.invalid%2Eattacker/source",
        )
        original_checks = copy.deepcopy(self.checks)
        for boundary in ("url", "final_url"):
            for index, value in enumerate(encoded_authorities):
                with self.subTest(ingress="compiler", boundary=boundary, value=value):
                    self.checks = copy.deepcopy(original_checks)
                    self.checks[0][boundary] = value
                    self.write_input()
                    with self.assertRaisesRegex(ValueError, "credential-free HTTPS"):
                        self.compiler.compile_review(
                            self.fixture.candidate, self.input, self.output,
                            self.fixture.root, lint_only=True,
                        )
                    self.assertFalse(self.output.exists())

                with self.subTest(ingress="promoter", boundary=boundary, value=value):
                    self.checks = copy.deepcopy(original_checks)
                    self.write_input()
                    review_dir = self.output.with_name(f"promoter-{boundary}-{index}")
                    self.compiler.compile_review(
                        self.fixture.candidate, self.input, review_dir,
                        self.fixture.root,
                    )
                    checks = [json.loads(line) for line in
                              (review_dir / "checks.jsonl").read_text().splitlines()]
                    checks[0][boundary] = value
                    checks_raw = jsonl_bytes(checks)
                    (review_dir / "checks.jsonl").write_bytes(checks_raw)
                    bundle_path = review_dir / "review-bundle.json"
                    bundle = json.loads(bundle_path.read_bytes())
                    bundle["artifacts"]["checks.jsonl"] = digest(checks_raw)
                    bundle_path.write_bytes(json_bytes(bundle))
                    promoted = Path(self.fixture.tmp.name) / f"approved-{boundary}-{index}"
                    with self.assertRaisesRegex(ValueError, "credential-free HTTPS"):
                        self.fixture.promoter.promote(
                            self.fixture.candidate, review_dir, promoted,
                            self.fixture.root,
                        )
                    self.assertFalse(promoted.exists())

    def _assert_real_review_pipeline_accepts_percent_encoding_outside_authority(self):
        encoded_url = (
            "https://example.invalid/path%65%2Edata"
            "?next=user%3Asecret%40example.invalid"
        )
        route = next(source for source in self.fixture.sources
                     if source.get("record_type") == "nonpublishable_metadata")
        route["url"] = encoded_url
        route["access_observation"]["final_url"] = encoded_url
        propositions = [json.loads(line) for line in
                        (self.fixture.candidate / "verified-benefit-candidates.jsonl").read_text().splitlines()]
        self.fixture.write_candidate()
        self.fixture.make_current_candidate(propositions)
        self.checks = [self.fixture.review_check(source) for source in self.fixture.sources]
        self.decision["candidate_manifest_sha256"] = digest(
            (self.fixture.candidate / "candidate.json").read_bytes()
        )
        self.write_input()

        self.compile()
        promoted = Path(self.fixture.tmp.name) / "encoded-path-query-approved"
        self.fixture.promoter.promote(
            self.fixture.candidate, self.output, promoted, self.fixture.root,
        )
        self.assertTrue((promoted / "batch.json").is_file())

    def use_metadata_observation(self, observation):
        route = next(source for source in self.fixture.sources
                     if source.get("record_type") == "nonpublishable_metadata")
        route["access_observation"] = observation
        propositions = [json.loads(line) for line in
                        (self.fixture.candidate / "verified-benefit-candidates.jsonl").read_text().splitlines()]
        self.fixture.write_candidate()
        self.fixture.make_current_candidate(propositions)
        self.checks = [self.fixture.review_check(source) for source in self.fixture.sources]
        self.decision["candidate_manifest_sha256"] = digest(
            (self.fixture.candidate / "candidate.json").read_bytes()
        )
        return route

    def set_nonapproval_decision(self, status, disposition):
        self.reviews = self.fixture.factual_reviews(self.fixture.claims[0])
        self.reviews[0].update(
            decision=disposition, quote_entailment_confirmed=False,
            issues=["The retained exact-entity route was inaccessible."],
            resolution="Reject or rework the source acquisition.",
        )
        self.decision["status"] = status
        self.write_input()

    def test_rework_and_rejection_accept_authoritative_failed_metadata_source_check(self):
        route = self.use_metadata_observation({
            "status": None, "final_url": None,
            "access_wall": "bot_or_network_block",
        })
        for status, disposition in (("rework", "changes_required"), ("rejected", "rejected")):
            with self.subTest(status=status):
                self.set_nonapproval_decision(status, disposition)
                output = self.output.with_name(status)

                result = self.compiler.compile_review(
                    self.fixture.candidate, self.input, output, self.fixture.root
                )

                self.assertEqual(status, result["status"])
                compiled_checks = [json.loads(line) for line in
                                   (output / "checks.jsonl").read_text().splitlines()]
                failed = next(check for check in compiled_checks
                              if check["source_id"] == route["source_id"])
                self.assertIsNone(failed["status"])
                self.assertIsNone(failed["final_url"])

    def test_rework_and_rejection_reject_null_final_url_without_network_failure_wall(self):
        self.use_metadata_observation({
            "status": None, "final_url": None, "access_wall": "none",
        })
        for status, disposition in (("rework", "changes_required"), ("rejected", "rejected")):
            with self.subTest(status=status):
                self.set_nonapproval_decision(status, disposition)
                output = self.output.with_name(f"{status}-invalid-wall")

                with self.assertRaisesRegex(ValueError, "final URL|network failure|access wall"):
                    self.compiler.compile_review(
                        self.fixture.candidate, self.input, output, self.fixture.root
                    )

                self.assertFalse(output.exists())

    def test_rework_and_rejection_reject_success_with_null_final_url(self):
        self.use_metadata_observation({
            "status": 200, "final_url": None, "access_wall": "none",
        })
        for status, disposition in (("rework", "changes_required"), ("rejected", "rejected")):
            with self.subTest(status=status):
                self.set_nonapproval_decision(status, disposition)
                output = self.output.with_name(f"{status}-invalid-success")

                with self.assertRaisesRegex(ValueError, "final URL|network failure|status"):
                    self.compiler.compile_review(
                        self.fixture.candidate, self.input, output, self.fixture.root
                    )

                self.assertFalse(output.exists())

    def test_frozen_review_metadata_boundary_matrix(self):
        self.assertIs(
            self.fixture.validator.validate_review_metadata_observation,
            self.compiler.review_metadata.validate_review_metadata_observation,
        )
        self.assertIs(
            self.fixture.validator.validate_review_metadata_observation,
            self.fixture.promoter.review_metadata.validate_review_metadata_observation,
        )
        ordinary = "https://example.invalid/source"
        observations = (
            ("truthful-null-failure", ordinary,
             {"status": None, "final_url": None, "access_wall": "bot_or_network_block"},
             {"approved": False, "rework": True, "rejected": True}),
            ("invalid-null-status", ordinary,
             {"status": 200, "final_url": None, "access_wall": "none"},
             {"approved": False, "rework": False, "rejected": False}),
            ("invalid-null-wall", ordinary,
             {"status": None, "final_url": None, "access_wall": "none"},
             {"approved": False, "rework": False, "rejected": False}),
            ("source-http", "http://example.invalid/source",
             {"status": 200, "final_url": ordinary, "access_wall": "none"},
             {"approved": False, "rework": False, "rejected": False}),
            ("source-credential", "https://reviewer:secret@example.invalid/source",
             {"status": 200, "final_url": ordinary, "access_wall": "none"},
             {"approved": False, "rework": False, "rejected": False}),
            ("source-literal-userinfo", "https://***@example.invalid/source",
             {"status": 200, "final_url": ordinary, "access_wall": "none"},
             {"approved": False, "rework": False, "rejected": False}),
            ("source-empty-userinfo", "https://@example.invalid/source",
             {"status": 200, "final_url": ordinary, "access_wall": "none"},
             {"approved": False, "rework": False, "rejected": False}),
            ("source-percent-encoded-userinfo-upper", "https://reviewer%3Asecret%40example.invalid/source",
             {"status": 200, "final_url": ordinary, "access_wall": "none"},
             {"approved": False, "rework": False, "rejected": False}),
            ("source-percent-encoded-userinfo-lower", "https://reviewer%3asecret%40example.invalid/source",
             {"status": 200, "final_url": ordinary, "access_wall": "none"},
             {"approved": False, "rework": False, "rejected": False}),
            ("source-percent-encoded-at", "https://%40example.invalid/source",
             {"status": 200, "final_url": ordinary, "access_wall": "none"},
             {"approved": False, "rework": False, "rejected": False}),
            ("final-http", ordinary,
             {"status": 200, "final_url": "http://example.invalid/final", "access_wall": "none"},
             {"approved": False, "rework": False, "rejected": False}),
            ("final-credential", ordinary,
             {"status": 200, "final_url": "https://reviewer:secret@example.invalid/final", "access_wall": "none"},
             {"approved": False, "rework": False, "rejected": False}),
            ("final-literal-userinfo", ordinary,
             {"status": 200, "final_url": "https://***@example.invalid/final", "access_wall": "none"},
             {"approved": False, "rework": False, "rejected": False}),
            ("final-empty-userinfo", ordinary,
             {"status": 200, "final_url": "https://@example.invalid/final", "access_wall": "none"},
             {"approved": False, "rework": False, "rejected": False}),
            ("final-percent-encoded-userinfo-upper", ordinary,
             {"status": 200, "final_url": "https://reviewer%3Asecret%40example.invalid/final", "access_wall": "none"},
             {"approved": False, "rework": False, "rejected": False}),
            ("final-percent-encoded-userinfo-lower", ordinary,
             {"status": 200, "final_url": "https://reviewer%3asecret%40example.invalid/final", "access_wall": "none"},
             {"approved": False, "rework": False, "rejected": False}),
            ("source-space", "https://example.invalid /source",
             {"status": 200, "final_url": ordinary, "access_wall": "none"},
             {"approved": False, "rework": False, "rejected": False}),
            ("source-newline", "https://example.invalid\n/source",
             {"status": 200, "final_url": ordinary, "access_wall": "none"},
             {"approved": False, "rework": False, "rejected": False}),
            ("source-control-tab", "https://example.invalid\t/source",
             {"status": 200, "final_url": ordinary, "access_wall": "none"},
             {"approved": False, "rework": False, "rejected": False}),
            ("source-empty-host", "https:///source",
             {"status": 200, "final_url": ordinary, "access_wall": "none"},
             {"approved": False, "rework": False, "rejected": False}),
            ("source-malformed-host", "https://[example.invalid/source",
             {"status": 200, "final_url": ordinary, "access_wall": "none"},
             {"approved": False, "rework": False, "rejected": False}),
            ("source-invalid-port", "https://example.invalid:not-a-port/source",
             {"status": 200, "final_url": ordinary, "access_wall": "none"},
             {"approved": False, "rework": False, "rejected": False}),
            ("encoded-path-and-query-remain-valid",
             "https://example.invalid/path%40reviewer?next=user%3Asecret%40example.invalid",
             {"status": 200, "final_url": ordinary, "access_wall": "none"},
             {"approved": True, "rework": True, "rejected": True}),
            ("ordinary-credential-free-https", ordinary,
             {"status": 200, "final_url": ordinary, "access_wall": "none"},
             {"approved": True, "rework": True, "rejected": True}),
            ("non-object-observation", ordinary, [],
             {"approved": False, "rework": False, "rejected": False}),
        )
        matrix = []
        for name, source_url, observation, expected_by_status in observations:
            for status, expected in expected_by_status.items():
                with self.subTest(boundary=name, status=status):
                    try:
                        self.fixture.validator.validate_review_metadata_observation(
                            source_url, observation, review_status=status,
                        )
                    except ValueError:
                        actual = False
                    else:
                        actual = True
                    matrix.append((name, status, expected, actual))
                    self.assertEqual(expected, actual)

        conflict_sides = [
            {
                "source_id": "conflict-source-supports", "position": "supports",
                "reviewed_proposition": "The policy is available.",
                "source_locator": "policy", "reviewed_quote": "The policy is available.",
                "content_sha256": "b" * 64, "entailment_confirmed": True,
                "reviewer_id": "reviewer-b",
            },
            {
                "source_id": "conflict-source-contradicts", "position": "contradicts",
                "reviewed_proposition": "The policy is unavailable.",
                "source_locator": "restriction", "reviewed_quote": "The policy is unavailable.",
                "content_sha256": "c" * 64, "entailment_confirmed": True,
                "reviewer_id": "reviewer-b",
            },
        ]
        for field in ("source_entailment_reviews", "conflict_side_entailments"):
            with self.subTest(boundary=f"nested-{field}-reviewer-collision"):
                self.reviews = self.fixture.factual_reviews(self.fixture.claims[0])
                if field == "conflict_side_entailments":
                    self.reviews[0][field] = copy.deepcopy(conflict_sides)
                self.reviews[0][field][0]["reviewer_id"] = "researcher-a"
                self.write_input()
                output = self.output.with_name(f"matrix-invalid-{field}")
                with self.assertRaisesRegex(ValueError, "nested|entailment|independent|reviewer"):
                    self.compiler.compile_review(
                        self.fixture.candidate, self.input, output, self.fixture.root
                    )
                self.assertFalse(output.exists())
                matrix.append((f"nested-{field}-reviewer-collision", "all", False, False))

        self.assertEqual(77, len(matrix))
        self._assert_real_compiler_and_promoter_reject_percent_encoded_authorities()
        self._assert_real_review_pipeline_accepts_percent_encoding_outside_authority()

    def test_rejects_candidate_researcher_identity_in_each_nested_entailment(self):
        conflict_sides = [
            {
                "source_id": "conflict-source-supports", "position": "supports",
                "reviewed_proposition": "The policy is available.",
                "source_locator": "policy", "reviewed_quote": "The policy is available.",
                "content_sha256": "b" * 64, "entailment_confirmed": True,
                "reviewer_id": "reviewer-b",
            },
            {
                "source_id": "conflict-source-contradicts", "position": "contradicts",
                "reviewed_proposition": "The policy is unavailable.",
                "source_locator": "restriction", "reviewed_quote": "The policy is unavailable.",
                "content_sha256": "c" * 64, "entailment_confirmed": True,
                "reviewer_id": "reviewer-b",
            },
        ]
        for field in ("source_entailment_reviews", "conflict_side_entailments"):
            with self.subTest(field=field):
                self.reviews = self.fixture.factual_reviews(self.fixture.claims[0])
                if field == "conflict_side_entailments":
                    self.reviews[0][field] = copy.deepcopy(conflict_sides)
                self.reviews[0][field][0]["reviewer_id"] = "researcher-a"
                self.write_input()
                output = self.output.with_name(f"invalid-{field}")

                with self.assertRaisesRegex(ValueError, "nested|entailment|independent|reviewer"):
                    self.compiler.compile_review(
                        self.fixture.candidate, self.input, output, self.fixture.root
                    )

                self.assertFalse(output.exists())

    def test_accepts_independent_identity_in_every_nested_entailment(self):
        self.reviews[0]["conflict_side_entailments"] = [
            {
                "source_id": f"conflict-source-{position}", "position": position,
                "reviewed_proposition": proposition, "source_locator": position,
                "reviewed_quote": proposition, "content_sha256": digest(proposition.encode()),
                "entailment_confirmed": True, "reviewer_id": "reviewer-b",
            }
            for position, proposition in (
                ("supports", "The policy is available."),
                ("contradicts", "The policy is unavailable."),
            )
        ]
        self.write_input()

        result = self.compile()

        self.assertEqual("approved", result["status"])

    def test_rejects_self_missing_duplicate_and_noncanonical_dispositions_without_writes(self):
        cases = []
        self_review = copy.deepcopy(self.reviews)
        self_review[0]["reviewer_id"] = "researcher-a"
        cases.append(self_review)
        cases.append(self.reviews[:-1])
        cases.append([self.reviews[0], *self.reviews])
        cases.append(list(reversed(self.reviews)))
        for index, reviews in enumerate(cases):
            with self.subTest(index=index):
                self.reviews = reviews
                self.write_input()
                output = self.output.with_name(f"invalid-{index}")
                with self.assertRaises(ValueError):
                    self.compiler.compile_review(self.fixture.candidate, self.input, output, self.fixture.root)
                self.assertFalse(output.exists())
        self.reviews = self.fixture.factual_reviews(self.fixture.claims[0])

    def test_rejects_candidate_mutation_and_reordering_after_input_binding(self):
        self.decision["candidate_manifest_sha256"] = digest((self.fixture.candidate / "candidate.json").read_bytes())
        self.write_input()
        original = (self.fixture.candidate / "verified-benefit-candidates.jsonl").read_bytes()
        (self.fixture.candidate / "verified-benefit-candidates.jsonl").write_bytes(original + b"\n")
        with self.assertRaisesRegex(ValueError, "candidate|artifact hash"):
            self.compile()
        self.assertFalse(self.output.exists())

    def test_rejects_chronology_url_source_and_layout_failures_preserving_output(self):
        self.compile()
        before = self.snapshot_output()
        mutations = (
            lambda: self.checks[0].update(checked_at="2026-10-30T01:00:00Z"),
            lambda: self.checks[0].update(url="https://wrong.example/source"),
            lambda: self.checks[0].update(source_id="orphan-source"),
        )
        for mutate in mutations:
            self.checks = [self.fixture.review_check(source) for source in self.fixture.sources]
            mutate()
            self.write_input()
            with self.assertRaises(ValueError):
                self.compile()
            self.assertEqual(before, self.snapshot_output())
        (self.input / "extra.txt").write_text("no")
        with self.assertRaisesRegex(ValueError, "exact"):
            self.compile()
        self.assertEqual(before, self.snapshot_output())
        (self.input / "extra.txt").unlink()
        (self.input / "checks.jsonl").unlink()
        with self.assertRaisesRegex(ValueError, "exact"):
            self.compile()
        self.assertEqual(before, self.snapshot_output())

    def test_rejects_symlink_fifo_and_oversize_inputs_without_writes(self):
        for kind in ("symlink", "fifo", "oversize"):
            with self.subTest(kind=kind):
                with tempfile.TemporaryDirectory(dir=self.fixture.tmp.name) as temp:
                    input_dir = Path(temp)
                    for name in ("decision.json", "dispositions.jsonl", "checks.jsonl"):
                        (input_dir / name).write_bytes((self.input / name).read_bytes())
                    target = input_dir / "checks.jsonl"
                    if kind == "symlink":
                        outside = input_dir.parent / "outside-checks.jsonl"
                        outside.write_bytes(target.read_bytes())
                        target.unlink()
                        target.symlink_to(outside)
                    elif kind == "fifo":
                        target.unlink()
                        os.mkfifo(target)
                    else:
                        target.write_bytes(b" " * 1025)
                    output = self.output.with_name(f"unsafe-{kind}")
                    limit = 1024 if kind == "oversize" else self.compiler.MAX_INPUT_FILE_BYTES
                    with mock.patch.object(self.compiler, "MAX_INPUT_FILE_BYTES", limit), self.assertRaisesRegex(
                        ValueError, "regular|bounded|safe|limit"
                    ):
                        self.compiler.compile_review(
                            self.fixture.candidate, input_dir, output, self.fixture.root
                        )
                    self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
