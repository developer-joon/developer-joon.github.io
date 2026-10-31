import copy
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
RESEARCH = ROOT / "docs" / "research" / "company-benefits"
SCRIPT = ROOT / "scripts" / "generate-pending-benefit-taxonomy-assignments.py"
VALIDATOR = ROOT / "scripts" / "validate-benefit-taxonomy-assignments.py"
REQUESTED_AT = "2026-10-30T01:45:00Z"
PRODUCTION_REQUESTED_AT = "2026-10-31T22:12:00+09:00"


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def write_jsonl(path, rows):
    path.write_text("".join(compact(row) + "\n" for row in rows), encoding="utf-8", newline="\n")


def make_fixture(root):
    root.mkdir(parents=True, exist_ok=True)
    taxonomy = {
        "artifact_kind": "benefit_taxonomy",
        "taxonomy_version": "benefit-taxonomy-test-v1",
        "categories": [{"id": "commute"}],
        "benefit_types": [{"id": "transport-allowance", "category_id": "commute"}],
        "dol_form_5500_mappings": [],
    }
    (root / "benefit-taxonomy-v1.json").write_text(compact(taxonomy), encoding="utf-8")
    claims = [
        {
            "claim_id": "claim-classified", "source_ids": ["source-a"],
            "searched_source_ids": ["source-search"],
            "source_evidence": [{"role": "primary_claim_evidence", "proposition": "LPG연료비 지원"}],
            "researched_at": "2026-10-30T00:00:00Z",
        },
        {
            "claim_id": "claim-unclassified", "source_ids": ["source-b"],
            "source_evidence": [{"role": "primary_claim_evidence", "proposition": "성과급 제도"}],
            "researched_at": "2026-10-30T00:00:00Z",
        },
    ]
    sources = [{"source_id": "source-a"}, {"source_id": "source-search"}, {"source_id": "source-b"}]
    reviews = [
        {"review_id": f"review-{claim['claim_id']}", "claim_id": claim["claim_id"],
         "researcher_id": "claim-researcher", "reviewer_id": "factual-reviewer",
         "decision": "approved", "reviewed_at": "2026-10-30T01:00:00Z"}
        for claim in claims
    ]
    checks = [
        {"source_id": "source-a", "checked_at": "2026-10-30T01:30:00Z"},
        {"source_id": "source-search", "checked_at": "2026-10-30T01:31:00Z"},
        {"source_id": "source-b", "checked_at": "2026-10-30T01:32:00Z"},
    ]
    write_jsonl(root / "benefit-claims.jsonl", claims)
    write_jsonl(root / "source-registry.jsonl", sources)
    write_jsonl(root / "reviews.jsonl", reviews)
    write_jsonl(root / "series-prepublication-checks.jsonl", checks)
    return taxonomy


def approved_from_request(request, reviewer="taxonomy-reviewer"):
    reviewed = request["assignment"]
    if reviewed["state"] == "classified":
        outcome = {
            "state": "assigned",
            "category_ids": ["commute"],
            "benefit_type_ids": reviewed["benefit_type_ids"],
        }
    else:
        outcome = {"state": "unclassified", "reason": reviewed["reason_code"]}
    return {
        "request_id": request["request_id"],
        "request_sha256": request["request_sha256"],
        "claim_id": request["claim_id"],
        "assignment": outcome,
        "taxonomy_version": request["taxonomy_version"],
        "taxonomy_sha256": request["taxonomy_sha256"],
        "bindings": copy.deepcopy(request["bindings"]),
        "researcher_id": request["requested_by"],
        "reviewer_id": reviewer,
        "reviewed_at": "2026-10-30T02:00:00Z",
        "decision": "approved",
    }


class PendingTaxonomyAssignmentTests(unittest.TestCase):
    def fixture_records(self, validator, root):
        return (
            validator.read_jsonl_records(root / "benefit-claims.jsonl"),
            validator.read_jsonl_records(root / "source-registry.jsonl"),
            validator.read_jsonl_records(root / "reviews.jsonl"),
            validator.read_jsonl_records(root / "series-prepublication-checks.jsonl"),
        )

    def test_request_digest_is_canonical_and_tamper_evident(self):
        generator = load(SCRIPT, "pending_taxonomy_generator_digest")
        validator = load(VALIDATOR, "taxonomy_validator_digest")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            taxonomy = make_fixture(root)
            requests, _ = generator.generate(root, REQUESTED_AT)
            classified = next(row for row in requests if row["claim_id"] == "claim-classified")
            self.assertEqual(
                ["source-a", "source-search"],
                [row["source_id"] for row in classified["bindings"]["source_records"]],
            )
            for request in requests:
                payload = {key: value for key, value in request.items() if key != "request_sha256"}
                expected = hashlib.sha256(compact(payload).encode("utf-8")).hexdigest()
                self.assertEqual(expected, request["request_sha256"])
            claims, sources, reviews, checks = self.fixture_records(validator, root)
            tampered = copy.deepcopy(requests)
            tampered[0]["assignment"]["benefit_type_ids"] = []
            with self.assertRaisesRegex(ValueError, "request SHA-256 mismatch"):
                validator.validate_assignment_requests(
                    tampered, claims, sources, reviews, checks, taxonomy,
                    validator.file_sha256(root / "benefit-taxonomy-v1.json"),
                )

    def test_approved_outcomes_bind_exact_validated_requests(self):
        generator = load(SCRIPT, "pending_taxonomy_generator_approval")
        validator = load(VALIDATOR, "taxonomy_validator_approval")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            taxonomy = make_fixture(root)
            requests, _ = generator.generate(root, REQUESTED_AT)
            claims, sources, reviews, checks = self.fixture_records(validator, root)
            assignments = [approved_from_request(request) for request in requests]
            validated = validator.validate_assignments(
                assignments, requests, claims, sources, reviews, checks, taxonomy,
                validator.file_sha256(root / "benefit-taxonomy-v1.json"),
            )
            self.assertEqual({"claim-classified", "claim-unclassified"}, set(validated))

    def test_approved_validator_requires_exact_request_set_and_chronological_review(self):
        generator = load(SCRIPT, "pending_taxonomy_generator_exact_chronology")
        validator = load(VALIDATOR, "taxonomy_validator_exact_chronology")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            taxonomy = make_fixture(root)
            requests, _ = generator.generate(root, REQUESTED_AT)
            claims, sources, reviews, checks = self.fixture_records(validator, root)
            taxonomy_sha256 = validator.file_sha256(root / "benefit-taxonomy-v1.json")
            assignments = [approved_from_request(request) for request in requests]

            with self.assertRaisesRegex(ValueError, "exactly cover pending requests"):
                validator.validate_assignments(
                    assignments[:-1], requests, claims, sources, reviews, checks,
                    taxonomy, taxonomy_sha256,
                )

            stale = copy.deepcopy(assignments)
            stale[0]["reviewed_at"] = "1970-01-01T00:00:00Z"
            with self.assertRaisesRegex(ValueError, "after request creation"):
                validator.validate_assignments(
                    stale, requests, claims, sources, reviews, checks,
                    taxonomy, taxonomy_sha256,
                )

            created_requests = copy.deepcopy(requests)
            created_requests[0]["requested_at"] = "2026-10-30T03:00:00Z"
            created_requests[0]["request_sha256"] = validator.request_sha256(created_requests[0])
            created_assignments = [approved_from_request(request) for request in created_requests]
            with self.assertRaisesRegex(ValueError, "after request creation"):
                validator.validate_assignments(
                    created_assignments, created_requests, claims, sources, reviews, checks,
                    taxonomy, taxonomy_sha256,
                )

            equal_time = copy.deepcopy(assignments)
            equal_time[0]["reviewed_at"] = requests[0]["requested_at"]
            with self.assertRaisesRegex(ValueError, "after request creation"):
                validator.validate_assignments(
                    equal_time, requests, claims, sources, reviews, checks,
                    taxonomy, taxonomy_sha256,
                )

    def test_approved_validator_rejects_missing_stale_duplicate_orphan_self_review_and_drift(self):
        generator = load(SCRIPT, "pending_taxonomy_generator_mutations")
        validator = load(VALIDATOR, "taxonomy_validator_mutations")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            taxonomy = make_fixture(root)
            requests, _ = generator.generate(root, REQUESTED_AT)
            claims, sources, reviews, checks = self.fixture_records(validator, root)
            taxonomy_sha256 = validator.file_sha256(root / "benefit-taxonomy-v1.json")
            valid = [approved_from_request(request) for request in requests]

            mutations = []
            missing = copy.deepcopy(valid); del missing[0]["request_sha256"]
            mutations.append((missing, requests, "schema mismatch"))
            stale = copy.deepcopy(valid); stale[0]["request_sha256"] = "0" * 64
            mutations.append((stale, requests, "request SHA-256 mismatch"))
            for field, message in (
                ("claim_record_sha256", "claim record hash binding mismatch"),
                ("source_records", "source records hash bindings mismatch"),
                ("factual_review_record", "factual review record hash binding mismatch"),
                ("prepublication_check_records", "prepublication check records hash bindings mismatch"),
            ):
                changed = copy.deepcopy(valid)
                if field.endswith("records"):
                    changed[0]["bindings"][field][0]["record_sha256"] = "0" * 64
                elif field == "factual_review_record":
                    changed[0]["bindings"][field]["record_sha256"] = "0" * 64
                else:
                    changed[0]["bindings"][field] = "0" * 64
                mutations.append((changed, requests, message))
            stale_taxonomy = copy.deepcopy(valid); stale_taxonomy[0]["taxonomy_sha256"] = "0" * 64
            mutations.append((stale_taxonomy, requests, "taxonomy binding mismatch"))
            duplicate = copy.deepcopy(valid); duplicate.append(copy.deepcopy(duplicate[0]))
            mutations.append((duplicate, requests, "duplicate approved request"))
            orphan = copy.deepcopy(valid); orphan[0]["request_id"] = "benefit-taxonomy-assignment::orphan"
            mutations.append((orphan, requests, "orphan taxonomy assignment request"))
            self_review = copy.deepcopy(valid); self_review[0]["reviewer_id"] = self_review[0]["researcher_id"]
            mutations.append((self_review, requests, "independent review"))
            drift = copy.deepcopy(valid); drift[0]["assignment"]["benefit_type_ids"] = ["other-type"]
            mutations.append((drift, requests, "reviewed decision") )
            reason_drift = copy.deepcopy(valid); reason_drift[1]["assignment"]["reason"] = "arbitrary text"
            mutations.append((reason_drift, requests, "reviewed reason code"))

            for assignments, bound_requests, message in mutations:
                with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                    validator.validate_assignments(
                        assignments, bound_requests, claims, sources, reviews, checks,
                        taxonomy, taxonomy_sha256,
                    )
    def test_complete_active_ledger_generation_is_deterministic_and_conservative(self):
        generator = load(SCRIPT, "pending_taxonomy_generator")
        validator = load(VALIDATOR, "taxonomy_validator")

        first = generator.generate(RESEARCH, PRODUCTION_REQUESTED_AT)
        second = generator.generate(RESEARCH, PRODUCTION_REQUESTED_AT)
        self.assertEqual(first, second)

        requests, audit = first
        self.assertEqual(150, len(requests))
        self.assertEqual(150, len({row["claim_id"] for row in requests}))
        self.assertTrue(all(row["review_status"] == "review_pending" for row in requests))
        self.assertTrue(all("reviewer_id" not in row and "reviewed_at" not in row for row in requests))
        self.assertEqual(150, audit["total_active_claims"])
        self.assertEqual(149, audit["classified_claims"])
        self.assertEqual(1, audit["unclassified_claims"])
        self.assertEqual(112, audit["counts_by_type"]["retirement-defined-contribution"])
        self.assertEqual(31, audit["counts_by_type"]["medical"])
        self.assertEqual(2, audit["counts_by_type"]["life-insurance"])

        by_id = {row["claim_id"]: row for row in requests}
        self.assertEqual(
            {
                "state": "unclassified",
                "benefit_type_ids": [],
                "reason_code": "no_unambiguous_taxonomy_match",
            },
            by_id["KR-CRN-1101112948086-bonus-plan"]["assignment"],
        )
        self.assertEqual(
            ["dormitory-company-housing"],
            by_id["KR-CRN-1201110097940-d07-169-benefit-v2"]["assignment"]["benefit_type_ids"],
        )

        claims = validator.read_jsonl_records(RESEARCH / "benefit-claims.jsonl")
        sources = validator.read_jsonl_records(RESEARCH / "source-registry.jsonl")
        reviews = validator.read_jsonl_records(RESEARCH / "reviews.jsonl")
        checks = validator.read_jsonl_records(RESEARCH / "series-prepublication-checks.jsonl")
        taxonomy_path = RESEARCH / "benefit-taxonomy-v1.json"
        validated = validator.validate_assignment_requests(
            requests,
            claims,
            sources,
            reviews,
            checks,
            json.loads(taxonomy_path.read_text(encoding="utf-8")),
            validator.file_sha256(taxonomy_path),
        )
        self.assertEqual({record.value["claim_id"] for record in claims}, set(validated))

        assignments = [
            json.loads(line)
            for line in (RESEARCH / "benefit-taxonomy-assignments.jsonl").read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        approved = validator.validate_assignments(
            assignments,
            requests,
            claims,
            sources,
            reviews,
            checks,
            json.loads(taxonomy_path.read_text(encoding="utf-8")),
            validator.file_sha256(taxonomy_path),
        )
        self.assertEqual(150, len(approved))
        self.assertEqual({record.value["claim_id"] for record in claims}, set(approved))

    def test_pending_validator_rejects_bound_record_tampering(self):
        generator = load(SCRIPT, "pending_taxonomy_generator_tamper")
        validator = load(VALIDATOR, "taxonomy_validator_tamper")
        requests, _ = generator.generate(RESEARCH, PRODUCTION_REQUESTED_AT)
        claims = validator.read_jsonl_records(RESEARCH / "benefit-claims.jsonl")
        sources = validator.read_jsonl_records(RESEARCH / "source-registry.jsonl")
        reviews = validator.read_jsonl_records(RESEARCH / "reviews.jsonl")
        checks = validator.read_jsonl_records(RESEARCH / "series-prepublication-checks.jsonl")
        taxonomy_path = RESEARCH / "benefit-taxonomy-v1.json"

        tampered = copy.deepcopy(requests)
        tampered[0]["bindings"]["claim_record_sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "request SHA-256 mismatch"):
            validator.validate_assignment_requests(
                tampered,
                claims,
                sources,
                reviews,
                checks,
                json.loads(taxonomy_path.read_text(encoding="utf-8")),
                validator.file_sha256(taxonomy_path),
            )


    def test_requested_at_is_mandatory_aware_and_after_bound_inputs(self):
        generator = load(SCRIPT, "pending_taxonomy_generator_request_time")
        validator = load(VALIDATOR, "taxonomy_validator_request_time")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            taxonomy = make_fixture(root)

            with self.assertRaisesRegex(TypeError, "requested_at"):
                generator.generate(root)
            with self.assertRaisesRegex(ValueError, "timestamp is invalid"):
                generator.generate(root, "2026-10-30T01:45:00")
            with self.assertRaisesRegex(ValueError, "strictly after every bound factual review/check timestamp"):
                generator.generate(root, "2026-10-30T01:31:00Z")

            requests, _ = generator.generate(root, REQUESTED_AT)
            self.assertTrue(all(row["requested_at"] == REQUESTED_AT for row in requests))
            claims, sources, reviews, checks = self.fixture_records(validator, root)
            missing = copy.deepcopy(requests)
            del missing[0]["requested_at"]
            missing[0]["request_sha256"] = validator.request_sha256(missing[0])
            with self.assertRaisesRegex(ValueError, "request schema mismatch"):
                validator.validate_assignment_requests(
                    missing, claims, sources, reviews, checks, taxonomy,
                    validator.file_sha256(root / "benefit-taxonomy-v1.json"),
                )

    def test_cli_requires_requested_at(self):
        generator = load(SCRIPT, "pending_taxonomy_generator_cli_time")
        with mock.patch("sys.stderr"):
            with self.assertRaises(SystemExit) as raised:
                generator.main(["research", "--output", "out", "--audit-summary", "audit"])
        self.assertEqual(2, raised.exception.code)

    def test_request_schema_requires_requested_at(self):
        schema = json.loads(
            (RESEARCH / "schema" / "benefit-taxonomy-assignment-request.schema.json").read_text(encoding="utf-8")
        )
        self.assertIn("requested_at", schema["required"])


if __name__ == "__main__":
    unittest.main()
