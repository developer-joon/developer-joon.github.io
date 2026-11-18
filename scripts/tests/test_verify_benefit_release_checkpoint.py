import hashlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

MODULE_PATH = Path(__file__).parents[1] / "verify-benefit-release-checkpoint.py"
ROOT = MODULE_PATH.parents[1]
RESEARCH = ROOT / "docs" / "research" / "company-benefits"
SPEC = importlib.util.spec_from_file_location("verify_benefit_release_checkpoint", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("unable to load checkpoint verifier")
VERIFIER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFIER)


def compact_bytes(value, *, newline=False):
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return raw + (b"\n" if newline else b"")


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def jsonl_bytes(records):
    return b"".join(compact_bytes(record, newline=True) for record in records)


ARTIFACT_NAMES = (
    "sources.jsonl", "claims.jsonl", "reviews.jsonl", "gaps.jsonl", "checks.jsonl",
    "company-category-cells.jsonl", "research-attempts.jsonl", "official-claims-v2.jsonl",
    "reference-records.jsonl", "community-benefit-reports.jsonl", "sources-v2.jsonl",
)
CANDIDATE_ARTIFACT_NAMES = tuple(
    name for name in ARTIFACT_NAMES if name not in {"reviews.jsonl", "checks.jsonl"}
) + ("review-requests.jsonl",)


def production_package_manifest(batch, index):
    artifact_hashes = {name: f"{index * 100 + offset + 1:064x}" for offset, name in enumerate(ARTIFACT_NAMES)}
    candidate_artifact_hashes = {
        name: artifact_hashes.get(name, f"{index * 100 + 19:064x}")
        for name in CANDIDATE_ARTIFACT_NAMES
    }
    return {
        "schema_version": "1",
        "batch_id": batch["batch_id"],
        "company_list_sha256": batch["company_list_sha256"],
        "effective_sequence_sha256": batch["effective_sequence_sha256"],
        "replacement_events_sha256": batch["replacement_events_sha256"],
        "status": "approved",
        "approved_at": "2026-11-06T00:00:00Z",
        "reviewer_id": f"fixture-reviewer-{index + 1}",
        "artifacts": artifact_hashes,
        "review_audit": {
            "candidate_manifest_sha256": f"{index * 100 + 20:064x}",
            "candidate_manifest": {},
            "candidate_artifacts": candidate_artifact_hashes,
            "review_bundle_sha256": f"{index * 100 + 21:064x}",
            "review_bundle": {},
            "review_artifacts": {
                name: artifact_hashes[name] for name in ("reviews.jsonl", "checks.jsonl")
            },
        },
    }


def canonical_fixture(root, batch_count=4):
    root = Path(root)
    canonical_root = root / "canonical"
    package_root = root / "reviewed-packages"
    population = canonical_root / "population"
    population.mkdir(parents=True)
    package_root.mkdir()
    events_raw = b'{"event":"fixture"}\n'
    (population / "effective-selection-events.jsonl").write_bytes(events_raw)

    batches = []
    companies = []
    sequences = {"domestic": [], "international": []}
    scope_numbers = {"domestic": 0, "international": 0}
    for batch_index in range(batch_count):
        jurisdiction = "KR" if batch_index % 2 == 0 else "US"
        scope = "domestic" if jurisdiction == "KR" else "international"
        scope_numbers[scope] += 1
        batch_number = scope_numbers[scope]
        company_ids = [f"{jurisdiction}-company-{batch_index:02d}-{index:02d}" for index in range(25)]
        sequences[scope].extend({"company_id": company_id} for company_id in company_ids)
        batches.append({
            "manifest_version": "1",
            "batch_id": f"{scope}-{batch_number:02d}",
            "scope": scope,
            "batch_number": batch_number,
            "company_list_sha256": sha256(json.dumps(company_ids, ensure_ascii=False, separators=(",", ":")).encode("utf-8")),
            "effective_sequence_sha256": "",
            "replacement_events_sha256": sha256(events_raw),
            "company_ids": company_ids,
        })
        companies.extend({"company_id": company_id, "jurisdiction": jurisdiction} for company_id in company_ids)

    for scope, records in sequences.items():
        raw = b"".join(compact_bytes(record, newline=True) for record in records)
        (population / f"{scope}-effective-selected.jsonl").write_bytes(raw)
        digest = sha256(raw)
        for batch in batches:
            if batch["scope"] == scope:
                batch["effective_sequence_sha256"] = digest

    approvals = []
    for index, batch in enumerate(batches):
        reviewed_candidate_sha256 = f"{index + 201:064x}"
        reviewer_receipt_sha256 = f"{index + 301:064x}"
        package_dir = package_root / batch["batch_id"]
        package_dir.mkdir()
        package_manifest = production_package_manifest(batch, index)
        package_raw = compact_bytes(package_manifest, newline=True)
        (package_dir / "batch.json").write_bytes(package_raw)
        approvals.append({
            "approval_version": "1",
            "batch_id": batch["batch_id"],
            "status": "approved",
            "package_sha256": sha256(package_raw),
            "reviewed_candidate_sha256": reviewed_candidate_sha256,
            "reviewer_receipt_sha256": reviewer_receipt_sha256,
        })

    return batches, approvals, companies, canonical_root, package_root


def make_current_package(batch, approval, package_root):
    package_path = Path(package_root) / batch["batch_id"] / "batch.json"
    manifest = json.loads(package_path.read_bytes())
    reviewed_candidate_sha256 = approval["reviewed_candidate_sha256"]
    receipt = {
        "schema_version": "1",
        "status": "approved",
        "reviewer_id": manifest["reviewer_id"],
        "reviewed_candidate_sha256": reviewed_candidate_sha256,
        "reviewed_at": "2026-11-05T23:59:59Z",
    }
    receipt_raw = json.dumps(
        receipt, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    manifest["schema_version"] = "2"
    manifest["artifacts"].update({
        "verified-benefits.jsonl": "d" * 64,
        "company-category-outcomes.jsonl": "e" * 64,
    })
    manifest["review_audit"]["candidate_artifacts"].update({
        "verified-benefit-candidates.jsonl": "f" * 64,
        "company-category-outcomes.jsonl": "e" * 64,
    })
    manifest["review_audit"].update({
        "reviewed_candidate_sha256": reviewed_candidate_sha256,
        "reviewer_receipt_sha256": sha256(receipt_raw),
        "reviewer_receipt": receipt,
    })
    approval["reviewer_receipt_sha256"] = sha256(receipt_raw)
    raw = compact_bytes(manifest, newline=True)
    package_path.write_bytes(raw)
    approval["package_sha256"] = sha256(raw)
    return manifest, package_path


def checkpoint(kind, batches, approvals):
    approvals_by_id = {approval["batch_id"]: approval for approval in approvals}
    descriptors = []
    for batch in batches:
        approval = approvals_by_id[batch["batch_id"]]
        descriptors.append({
            "approval_version": approval["approval_version"],
            "batch_id": batch["batch_id"],
            "status": "approved",
            "company_ids": list(batch["company_ids"]),
            "package_path": f"{batch['batch_id']}/batch.json",
            "package_sha256": approval["package_sha256"],
            "company_list_sha256": batch["company_list_sha256"],
            "effective_sequence_sha256": batch["effective_sequence_sha256"],
            "replacement_events_sha256": batch["replacement_events_sha256"],
            "reviewed_candidate_sha256": approval["reviewed_candidate_sha256"],
            "reviewer_receipt_sha256": approval["reviewer_receipt_sha256"],
        })
    return {
        "schema_version": 1,
        "artifact_kind": "benefit_release_checkpoint",
        "release_kind": kind,
        "batches": descriptors,
    }


def write_cli_inputs(root, batches, approvals, companies):
    root = Path(root)
    canonical_root = root / "canonical"
    checkpoint_path = root / "checkpoint.json"
    series_path = canonical_root / "series-batches.jsonl"
    approvals_path = canonical_root / "series-batch-approvals.jsonl"
    companies_path = canonical_root / "companies.jsonl"
    checkpoint_path.write_bytes(compact_bytes(checkpoint("gold", batches, approvals), newline=True))
    series_path.write_bytes(b"".join(compact_bytes(batch, newline=True) for batch in batches))
    approvals_path.write_bytes(b"".join(compact_bytes(approval, newline=True) for approval in approvals))
    companies_path.write_bytes(b"".join(compact_bytes(company, newline=True) for company in companies))
    return checkpoint_path, series_path, approvals_path, companies_path


def promoted_current_package(destination, batch_id, reviewer_id=None):
    from scripts.tests.test_company_benefits_candidate_pipeline import CandidatePipelineTests
    from scripts.tests.benefits_v2_batch_fixture import no_public_info_records

    CandidatePipelineTests.setUpClass()
    case = CandidatePipelineTests(methodName="runTest")
    case.setUp()
    try:
        batches = [json.loads(line) for line in (RESEARCH / "series-batches.jsonl").read_text().splitlines()]
        companies = [json.loads(line) for line in (RESEARCH / "companies.jsonl").read_text().splitlines()]
        case.batch = next(item for item in batches if item["batch_id"] == batch_id)
        case.company_ids = case.batch["company_ids"]
        selected = [item for item in companies if item["company_id"] in set(case.company_ids)]
        case.v2_records = no_public_info_records(case.batch, selected)
        (case.root / "companies.jsonl").write_bytes(jsonl_bytes(selected))
        (case.root / "series-batches.jsonl").write_bytes(jsonl_bytes([case.batch]))
        jurisdiction = "KR" if case.batch["scope"] == "domestic" else "US"
        source_id = f"{batch_id}-exact-entity-route"
        source = case.metadata_source()
        source.update(source_id=source_id, jurisdiction=jurisdiction,
                      url=f"https://example.invalid/{batch_id}")
        source["access_observation"]["final_url"] = source["url"]
        case.sources = [source]
        case.claims = []
        case.gaps = [case.gap(company_id) for company_id in case.company_ids]
        for gap in case.gaps:
            gap["searched_official_source_ids"] = [source_id]
        case.requests = [case.request(gap["audit_id"], "gap") for gap in case.gaps]
        case.write_candidate()
        case.make_current_candidate()
        case.write_current_review_bundle()
        if reviewer_id is not None:
            reviews_path = case.review / "reviews.jsonl"
            reviews = [json.loads(line) for line in reviews_path.read_text().splitlines()]
            for review in reviews:
                review["reviewer_id"] = reviewer_id
            reviews_raw = b"".join(compact_bytes(review, newline=True) for review in reviews)
            reviews_path.write_bytes(reviews_raw)
            receipt_path = case.review / "reviewer-receipt.json"
            receipt = json.loads(receipt_path.read_bytes())
            receipt["reviewer_id"] = reviewer_id
            receipt_raw = compact_bytes(receipt)
            receipt_path.write_bytes(receipt_raw)
            bundle_path = case.review / "review-bundle.json"
            bundle = json.loads(bundle_path.read_bytes())
            bundle["promotion_reviewer_id"] = reviewer_id
            bundle["artifacts"]["reviews.jsonl"] = sha256(reviews_raw)
            bundle["reviewer_receipt_sha256"] = sha256(receipt_raw)
            bundle_path.write_bytes(compact_bytes(bundle))
        if batch_id.startswith("international-"):
            receipt_path = case.review / "reviewer-receipt.json"
            receipt = json.loads(receipt_path.read_bytes())
            receipt["reviewed_at"] = "2026-10-30T02:00:01Z"
            receipt_raw = json.dumps(
                receipt, ensure_ascii=False, separators=(",", ":"), allow_nan=False,
            ).encode()
            receipt_path.write_bytes(receipt_raw)
            bundle_path = case.review / "review-bundle.json"
            bundle = json.loads(bundle_path.read_bytes())
            bundle["reviewer_receipt_sha256"] = sha256(receipt_raw)
            bundle_path.write_bytes(json.dumps(
                bundle, ensure_ascii=False, separators=(",", ":"), allow_nan=False,
            ).encode())
        case.promoter.promote(case.candidate, case.review, case.output, case.root)
        shutil.copytree(case.output, destination)
        return case.batch
    finally:
        case.tearDown()


def retained_gold_fixture(root):
    root = Path(root)
    package_root = root / "reviewed-packages"
    canonical_root = root / "canonical"
    package_root.mkdir()
    canonical_root.mkdir()
    batch_ids = ("domestic-02", "international-02")
    batches = [promoted_current_package(package_root / batch_id, batch_id) for batch_id in batch_ids]

    population = canonical_root / "population"
    population.mkdir()
    for name in ("domestic-effective-selected.jsonl", "international-effective-selected.jsonl",
                 "effective-selection-events.jsonl"):
        shutil.copy2(RESEARCH / "population" / name, population / name)
    shutil.copy2(RESEARCH / "companies.jsonl", canonical_root / "companies.jsonl")

    target_names = {
        "sources.jsonl": "source-registry.jsonl", "claims.jsonl": "benefit-claims.jsonl",
        "reviews.jsonl": "reviews.jsonl", "gaps.jsonl": "series-research-gaps.jsonl",
        "checks.jsonl": "series-prepublication-checks.jsonl",
        "company-category-cells.jsonl": "company-category-cells.jsonl",
        "research-attempts.jsonl": "research-attempts.jsonl",
        "official-claims-v2.jsonl": "official-claims-v2.jsonl",
        "reference-records.jsonl": "reference-records.jsonl",
        "community-benefit-reports.jsonl": "community-benefit-reports.jsonl",
        "sources-v2.jsonl": "sources-v2.jsonl",
        "verified-benefits.jsonl": "verified-benefits.jsonl",
        "company-category-outcomes.jsonl": "company-category-outcomes.jsonl",
    }
    for source_name, target_name in target_names.items():
        records = []
        for batch_id in batch_ids:
            records.extend(VERIFIER.series.read_jsonl(package_root / batch_id / source_name))
        VERIFIER.series.write_jsonl(canonical_root / target_name, records)
    approvals = [
        VERIFIER.series.read_jsonl(package_root / batch_id / "series-batch-approval.jsonl")[0]
        for batch_id in batch_ids
    ]
    VERIFIER.series.write_jsonl(canonical_root / "series-batch-approvals.jsonl", approvals)
    approved_at = {}
    reviewer_ids = {}
    for batch_id in batch_ids:
        manifest = json.loads((package_root / batch_id / "batch.json").read_bytes())
        approved_at[batch_id] = manifest["approved_at"]
        reviewer_ids[batch_id] = [manifest["reviewer_id"]]
    VERIFIER.series.materialize_contract(
        canonical_root, set(batch_ids), approved_at, reviewer_ids,
    )
    companies = VERIFIER.series.read_jsonl(canonical_root / "companies.jsonl")
    return batches, approvals, companies, canonical_root, package_root


class ReleaseCheckpointVerifierTests(unittest.TestCase):
    def verify(self, document, batches, approvals, companies, canonical_root, package_root):
        return VERIFIER.verify_checkpoint(
            document, batches, approvals, companies,
            canonical_root=canonical_root,
            package_root=package_root,
        )

    def test_real_canonical_series_ledger_remains_strict_and_identity_free(self):
        schema = json.loads((RESEARCH / "schema" / "series-batch.schema.json").read_text(encoding="utf-8"))
        validator = Draft202012Validator(schema)
        records = [
            json.loads(line)
            for line in (RESEARCH / "series-batches.jsonl").read_text(encoding="utf-8").splitlines()
        ]
        self.assertEqual(80, len(records))
        self.assertEqual(b"", (RESEARCH / "series-batch-approvals.jsonl").read_bytes())
        for record in records:
            self.assertEqual([], list(validator.iter_errors(record)))
            self.assertTrue({"package_sha256", "reviewed_candidate_sha256", "reviewer_receipt_sha256"}.isdisjoint(record))

    def test_approval_schema_is_strict_and_disjoint_from_batch_lineage(self):
        schema = json.loads((RESEARCH / "schema" / "series-batch-approval.schema.json").read_text(encoding="utf-8"))
        validator = Draft202012Validator(schema)
        approval = {
            "approval_version": "1",
            "batch_id": "domestic-01",
            "status": "approved",
            "package_sha256": "a" * 64,
            "reviewed_candidate_sha256": "b" * 64,
            "reviewer_receipt_sha256": "c" * 64,
        }
        self.assertEqual([], list(validator.iter_errors(approval)))
        self.assertTrue(list(validator.iter_errors(dict(approval, company_ids=[]))))

    def test_every_valid_fixture_package_passes_the_production_series_input_schema(self):
        schema = json.loads((RESEARCH / "schema" / "series-input.schema.json").read_text(encoding="utf-8"))
        validator = Draft202012Validator(schema, format_checker=FormatChecker())
        with tempfile.TemporaryDirectory() as directory:
            *_, package_root = canonical_fixture(directory, 4)
            package_paths = sorted(package_root.glob("*/batch.json"))
            self.assertEqual(4, len(package_paths))
            for package_path in package_paths:
                package = json.loads(package_path.read_text(encoding="utf-8"))
                with self.subTest(package=package_path.parent.name):
                    self.assertEqual([], list(validator.iter_errors(package)))
                    self.assertTrue({"reviewed_candidate_sha256", "reviewer_receipt_sha256"}.isdisjoint(package))

    def test_package_manifest_approved_at_matches_production_date_time_format(self):
        manifest = production_package_manifest({
            "batch_id": "domestic-01",
            "company_list_sha256": "a" * 64,
            "effective_sequence_sha256": "b" * 64,
            "replacement_events_sha256": "c" * 64,
        }, 0)
        schema = json.loads((RESEARCH / "schema" / "series-input.schema.json").read_text(encoding="utf-8"))
        # jsonschema's date-time format checker is an optional dependency and
        # may even accept values our stricter production parser rejects.
        schema_validator = Draft202012Validator(schema, format_checker=FormatChecker())

        for approved_at in (
            "2026-11-06T00:00:00Z",
            "2026-11-06T09:30:00+09:30",
            "2026-11-06T09:30:00.123456+09:30",
        ):
            valid = dict(manifest, approved_at=approved_at)
            with self.subTest(approved_at=approved_at):
                self.assertEqual([], list(schema_validator.iter_errors(valid)))
                VERIFIER._verify_production_package_manifest(valid, "domestic-01")

        for approved_at in (
            "20261106T000000+0000",
            "2026-02-30T00:00:00Z",
            "2026-11-06T24:00:00Z",
            "2026-11-06T00:60:00Z",
            "2026-11-06T00:00:60Z",
            "2026-11-06T00:00:00+24:00",
            "2026-11-06T00:00:00+00:60",
        ):
            invalid = dict(manifest, approved_at=approved_at)
            with self.subTest(approved_at=approved_at):
                # Schema format checking is not the authority for production dates.
                with self.assertRaisesRegex(ValueError, "approved_at is not a production date-time"):
                    VERIFIER._verify_production_package_manifest(invalid, "domestic-01")

    def test_rejects_missing_duplicate_malformed_or_mismatched_approval_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            batches, approvals, companies, canonical_root, package_root = canonical_fixture(directory, 2)
            document = checkpoint("gold", batches, approvals)
            mutations = {
                "missing": approvals[:1],
                "duplicate": approvals + [dict(approvals[0])],
                "extra-field": [dict(approvals[0], note="not canonical"), approvals[1]],
                "pending": [dict(approvals[0], status="pending"), approvals[1]],
                "mismatch": [dict(approvals[0], package_sha256="f" * 64), approvals[1]],
                "candidate-mismatch": [dict(approvals[0], reviewed_candidate_sha256="e" * 64), approvals[1]],
                "receipt-mismatch": [dict(approvals[0], reviewer_receipt_sha256="d" * 64), approvals[1]],
            }
            for mutation, approval_rows in mutations.items():
                with self.subTest(mutation=mutation), self.assertRaisesRegex(ValueError, "approval|duplicate|package_sha256"):
                    self.verify(document, batches, approval_rows, companies, canonical_root, package_root)

    def test_accepts_exact_two_by_twenty_five_balanced_gold_union_from_real_package_descriptors(self):
        with tempfile.TemporaryDirectory() as directory:
            batches, approvals, companies, canonical_root, package_root = canonical_fixture(directory, 2)
            result = self.verify(checkpoint("gold", batches, approvals), batches, approvals, companies, canonical_root, package_root)
            self.assertEqual({"batch_count": 2, "company_count": 50, "jurisdictions": {"KR": 25, "US": 25}}, result)

    def test_rejects_package_or_receipt_replay_in_unselected_canonical_approval_rows(self):
        for field, source_index, replay_index in (
            ("package_sha256", 0, 2),
            ("reviewer_receipt_sha256", 1, 3),
        ):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as directory:
                batches, approvals, companies, canonical_root, package_root = canonical_fixture(directory, 4)
                document = checkpoint("gold", batches[:2], approvals[:2])
                approvals[replay_index][field] = approvals[source_index][field]

                with self.assertRaisesRegex(ValueError, f"canonical approval.*replayed.*{field}"):
                    self.verify(
                        document, batches, approvals, companies, canonical_root, package_root,
                    )

    def test_allows_repeated_candidate_digest_in_unselected_canonical_approval_row(self):
        with tempfile.TemporaryDirectory() as directory:
            batches, approvals, companies, canonical_root, package_root = canonical_fixture(directory, 4)
            document = checkpoint("gold", batches[:2], approvals[:2])
            approvals[2]["reviewed_candidate_sha256"] = approvals[0]["reviewed_candidate_sha256"]

            result = self.verify(
                document, batches, approvals, companies, canonical_root, package_root,
            )

            self.assertEqual(
                {"batch_count": 2, "company_count": 50, "jurisdictions": {"KR": 25, "US": 25}},
                result,
            )

    def test_protocol_2_gold_union_rejects_manifest_only_package_directories(self):
        with tempfile.TemporaryDirectory() as directory:
            batches, approvals, companies, canonical_root, package_root = canonical_fixture(directory, 2)
            for batch, approval in zip(batches, approvals):
                make_current_package(batch, approval, package_root)

            with self.assertRaisesRegex(ValueError, "package|file set|artifact|inventory"):
                self.verify(
                    checkpoint("gold", batches, approvals), batches, approvals, companies,
                    canonical_root, package_root,
                )

    def test_protocol_2_gold_union_accepts_complete_retained_promoted_packages(self):
        with tempfile.TemporaryDirectory() as directory:
            batches, approvals, companies, canonical_root, package_root = retained_gold_fixture(directory)
            result = self.verify(
                checkpoint("gold", batches, approvals), batches, approvals, companies,
                canonical_root, package_root,
            )
            self.assertEqual(
                {"batch_count": 2, "company_count": 50, "jurisdictions": {"KR": 25, "US": 25}},
                result,
            )

    def test_protocol_2_rejects_rebound_retained_artifact_when_canonical_approval_is_fixed(self):
        with tempfile.TemporaryDirectory() as directory:
            batches, approvals, companies, canonical_root, package_root = retained_gold_fixture(directory)
            document = checkpoint("gold", batches, approvals)
            package_dir = package_root / batches[0]["batch_id"]
            target = package_dir / "verified-benefits.jsonl"
            target.write_bytes(target.read_bytes() + b"\n")
            manifest_path = package_dir / "batch.json"
            manifest = json.loads(manifest_path.read_bytes())
            manifest["artifacts"][target.name] = sha256(target.read_bytes())
            manifest_path.write_bytes(compact_bytes(manifest))
            rebound = sha256(manifest_path.read_bytes())
            document["batches"][0]["package_sha256"] = rebound
            local_approval_path = package_dir / "series-batch-approval.jsonl"
            local_approval = VERIFIER.series.read_jsonl(local_approval_path)[0]
            local_approval["package_sha256"] = rebound
            local_approval_path.write_bytes(jsonl_bytes([local_approval]))
            inventory = sorted(path.name for path in package_dir.iterdir() if path.name != "SHA256SUMS")
            (package_dir / "SHA256SUMS").write_text("".join(
                f"{sha256((package_dir / name).read_bytes())}  {name}\n" for name in inventory
            ))

            with self.assertRaisesRegex(ValueError, "approval|package SHA"):
                self.verify(
                    document, batches, approvals, companies, canonical_root, package_root,
                )

    def test_accepts_exact_four_by_twenty_five_normal_union(self):
        with tempfile.TemporaryDirectory() as directory:
            batches, approvals, companies, canonical_root, package_root = canonical_fixture(directory, 4)
            result = self.verify(checkpoint("normal", batches, approvals), batches, approvals, companies, canonical_root, package_root)
            self.assertEqual(4, result["batch_count"])
            self.assertEqual(100, result["company_count"])

    def test_rejects_fabricated_lineage_even_with_correct_membership(self):
        with tempfile.TemporaryDirectory() as directory:
            batches, approvals, companies, canonical_root, package_root = canonical_fixture(directory, 2)
            fabricated = checkpoint("gold", batches, approvals)
            fabricated["batches"][0]["effective_sequence_sha256"] = "f" * 64
            package_path = package_root / fabricated["batches"][0]["package_path"]
            package_manifest = json.loads(package_path.read_text(encoding="utf-8"))
            package_manifest["effective_sequence_sha256"] = "f" * 64
            package_raw = compact_bytes(package_manifest, newline=True)
            package_path.write_bytes(package_raw)
            fabricated["batches"][0]["package_sha256"] = sha256(package_raw)
            with self.assertRaisesRegex(ValueError, "lineage|effective sequence|canonical"):
                self.verify(fabricated, batches, approvals, companies, canonical_root, package_root)

    def test_rejects_package_path_escape_symlink_and_nonregular_substitution(self):
        with tempfile.TemporaryDirectory() as directory:
            batches, approvals, companies, canonical_root, package_root = canonical_fixture(directory, 2)
            for mutation in ("escape", "symlink", "directory"):
                invalid = checkpoint("gold", batches, approvals)
                descriptor = invalid["batches"][0]
                if mutation == "escape":
                    descriptor["package_path"] = "../outside.json"
                elif mutation == "symlink":
                    link = package_root / "linked.json"
                    link.symlink_to(package_root / descriptor["package_path"])
                    descriptor["package_path"] = "linked.json"
                else:
                    descriptor["package_path"] = batches[0]["batch_id"]
                with self.subTest(mutation=mutation), self.assertRaisesRegex(ValueError, "path|symlink|regular|package"):
                    self.verify(invalid, batches, approvals, companies, canonical_root, package_root)

    def test_rejects_copied_batch_duplicate_membership_and_wrong_count(self):
        with tempfile.TemporaryDirectory() as directory:
            batches, approvals, companies, canonical_root, package_root = canonical_fixture(directory, 4)
            copied = checkpoint("normal", batches, approvals)
            copied["batches"][1]["package_sha256"] = copied["batches"][0]["package_sha256"]
            with self.assertRaisesRegex(ValueError, "copied|replayed"):
                self.verify(copied, batches, approvals, companies, canonical_root, package_root)

            duplicate = checkpoint("normal", batches, approvals)
            duplicate["batches"][1]["company_ids"][0] = duplicate["batches"][0]["company_ids"][0]
            with self.assertRaisesRegex(ValueError, "membership|duplicate"):
                self.verify(duplicate, batches, approvals, companies, canonical_root, package_root)

            wrong_count = checkpoint("normal", batches[:3], approvals[:3])
            with self.assertRaisesRegex(ValueError, "exactly 4|100"):
                self.verify(wrong_count, batches, approvals, companies, canonical_root, package_root)

    def test_rejects_nonapproved_or_malformed_package_descriptors(self):
        with tempfile.TemporaryDirectory() as directory:
            batches, approvals, companies, canonical_root, package_root = canonical_fixture(directory, 2)
            for status in ("pending", "rejected"):
                invalid = checkpoint("gold", batches, approvals)
                invalid["batches"][0]["status"] = status
                with self.subTest(status=status), self.assertRaisesRegex(ValueError, "approved"):
                    self.verify(invalid, batches, approvals, companies, canonical_root, package_root)

            wrong_version = checkpoint("gold", batches, approvals)
            wrong_version["batches"][0]["approval_version"] = "2"
            with self.assertRaisesRegex(ValueError, "approval version"):
                self.verify(wrong_version, batches, approvals, companies, canonical_root, package_root)

            malformed = checkpoint("gold", batches, approvals)
            del malformed["batches"][0]["reviewer_receipt_sha256"]
            with self.assertRaisesRegex(ValueError, "descriptor"):
                self.verify(malformed, batches, approvals, companies, canonical_root, package_root)

            mixed = checkpoint("gold", batches, approvals)
            mixed["batches"][1]["status"] = "pending"
            with self.assertRaisesRegex(ValueError, "approved"):
                self.verify(mixed, batches, approvals, companies, canonical_root, package_root)

    def test_rejects_descriptor_review_hashes_not_authenticated_by_approval_ledger(self):
        with tempfile.TemporaryDirectory() as directory:
            batches, approvals, companies, canonical_root, package_root = canonical_fixture(directory, 2)
            for field, digest in (
                ("reviewed_candidate_sha256", "a" * 64),
                ("reviewer_receipt_sha256", "b" * 64),
            ):
                substituted = checkpoint("gold", batches, approvals)
                substituted["batches"][0][field] = digest
                with self.subTest(field=field), self.assertRaisesRegex(ValueError, f"approval identity.*{field}"):
                    self.verify(substituted, batches, approvals, companies, canonical_root, package_root)

    def test_current_package_descriptor_binds_both_approval_hashes_to_review_audit(self):
        for field, replacement in (
            ("reviewed_candidate_sha256", "a" * 64),
            ("reviewer_receipt_sha256", "b" * 64),
        ):
            with tempfile.TemporaryDirectory() as directory:
                batches, approvals, _, _, package_root = canonical_fixture(directory, 2)
                make_current_package(batches[0], approvals[0], package_root)
                descriptor = checkpoint("gold", batches, approvals)["batches"][0]
                descriptor[field] = approvals[0][field] = replacement
                with self.subTest(field=field), self.assertRaisesRegex(
                    ValueError, f"canonical approval identity mismatch.*{field}"
                ):
                    VERIFIER._verify_package_descriptor(
                        descriptor, batches[0], approvals[0], package_root,
                    )

    def test_current_package_descriptor_requires_review_before_approval(self):
        with tempfile.TemporaryDirectory() as directory:
            batches, approvals, _, _, package_root = canonical_fixture(directory, 2)
            for reviewed_at in ("2026-11-06T00:00:00Z", "2026-11-06T00:00:01Z"):
                manifest, package_path = make_current_package(batches[0], approvals[0], package_root)
                receipt = manifest["review_audit"]["reviewer_receipt"]
                receipt["reviewed_at"] = reviewed_at
                receipt_raw = json.dumps(
                    receipt, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                    allow_nan=False,
                ).encode("utf-8")
                receipt_sha = sha256(receipt_raw)
                manifest["review_audit"]["reviewer_receipt_sha256"] = receipt_sha
                approvals[0]["reviewer_receipt_sha256"] = receipt_sha
                raw = compact_bytes(manifest, newline=True)
                package_path.write_bytes(raw)
                approvals[0]["package_sha256"] = sha256(raw)
                descriptor = checkpoint("gold", batches, approvals)["batches"][0]
                with self.subTest(reviewed_at=reviewed_at), self.assertRaisesRegex(
                    ValueError, "review.*precede.*approval"
                ):
                    VERIFIER._verify_package_descriptor(
                        descriptor, batches[0], approvals[0], package_root,
                    )

    def test_rejects_descriptor_and_valid_batch_substitution_with_unchanged_approval_ledger(self):
        with tempfile.TemporaryDirectory() as directory:
            batches, approvals, companies, canonical_root, package_root = canonical_fixture(directory, 2)
            substituted = checkpoint("gold", batches, approvals)
            descriptor = substituted["batches"][0]
            package_path = package_root / descriptor["package_path"]
            package_manifest = json.loads(package_path.read_text(encoding="utf-8"))
            package_manifest["approved_at"] = "2026-11-06T00:00:01Z"
            package_raw = compact_bytes(package_manifest, newline=True)
            package_path.write_bytes(package_raw)
            descriptor["package_sha256"] = sha256(package_raw)

            with self.assertRaisesRegex(ValueError, "approval.*package_sha256"):
                self.verify(substituted, batches, approvals, companies, canonical_root, package_root)

    def test_rejects_package_manifest_outside_the_exact_production_shape(self):
        with tempfile.TemporaryDirectory() as directory:
            batches, approvals, companies, canonical_root, package_root = canonical_fixture(directory, 2)
            package_path = package_root / batches[0]["batch_id"] / "batch.json"
            original_manifest = json.loads(package_path.read_text(encoding="utf-8"))
            for mutation in ("missing-approved-at", "unknown-field", "malformed-artifact"):
                document = checkpoint("gold", batches, approvals)
                descriptor = document["batches"][0]
                package_manifest = json.loads(json.dumps(original_manifest))
                if mutation == "missing-approved-at":
                    del package_manifest["approved_at"]
                elif mutation == "unknown-field":
                    package_manifest["reviewed_candidate_sha256"] = "a" * 64
                else:
                    package_manifest["artifacts"]["sources.jsonl"] = "not-a-hash"
                package_raw = compact_bytes(package_manifest, newline=True)
                package_path.write_bytes(package_raw)
                digest = sha256(package_raw)
                descriptor["package_sha256"] = digest
                approvals[0]["package_sha256"] = digest
                with self.subTest(mutation=mutation), self.assertRaisesRegex(ValueError, "package manifest.*(fields|hash|production)"):
                    self.verify(document, batches, approvals, companies, canonical_root, package_root)

    def test_rejects_symlinked_checkpoint_cli_input(self):
        with tempfile.TemporaryDirectory() as directory:
            batches, approvals, companies, canonical_root, package_root = canonical_fixture(directory, 2)
            checkpoint_path, series_path, approvals_path, companies_path = write_cli_inputs(directory, batches, approvals, companies)
            linked_checkpoint = Path(directory) / "linked-checkpoint.json"
            linked_checkpoint.symlink_to(checkpoint_path)
            with self.assertRaisesRegex(ValueError, "checkpoint.*safe regular file|checkpoint.*symlink"):
                with redirect_stdout(io.StringIO()):
                    VERIFIER.main([
                        "--checkpoint", str(linked_checkpoint),
                        "--series-batches", str(series_path),
                        "--series-batch-approvals", str(approvals_path),
                        "--companies", str(companies_path),
                        "--package-root", str(package_root),
                    ])

    def test_cli_reports_unsafe_input_without_a_traceback(self):
        with tempfile.TemporaryDirectory() as directory:
            batches, approvals, companies, canonical_root, package_root = canonical_fixture(directory, 2)
            checkpoint_path, series_path, approvals_path, companies_path = write_cli_inputs(directory, batches, approvals, companies)
            linked_checkpoint = Path(directory) / "linked-checkpoint.json"
            linked_checkpoint.symlink_to(checkpoint_path)
            completed = subprocess.run([
                sys.executable, str(MODULE_PATH),
                "--checkpoint", str(linked_checkpoint),
                "--series-batches", str(series_path),
                "--series-batch-approvals", str(approvals_path),
                "--companies", str(companies_path),
                "--package-root", str(package_root),
            ], capture_output=True, text=True, check=False)
            self.assertNotEqual(0, completed.returncode)
            self.assertIn("error: checkpoint path is not a safe regular file", completed.stderr)
            self.assertNotIn("Traceback", completed.stderr)

    def test_cli_rejects_fifo_checkpoint_promptly_without_traceback(self):
        with tempfile.TemporaryDirectory() as directory:
            batches, approvals, companies, canonical_root, package_root = canonical_fixture(directory, 2)
            _, series_path, approvals_path, companies_path = write_cli_inputs(directory, batches, approvals, companies)
            checkpoint_fifo = Path(directory) / "checkpoint.fifo"
            os.mkfifo(checkpoint_fifo)
            completed = subprocess.run([
                sys.executable, str(MODULE_PATH),
                "--checkpoint", str(checkpoint_fifo),
                "--series-batches", str(series_path),
                "--series-batch-approvals", str(approvals_path),
                "--companies", str(companies_path),
                "--package-root", str(package_root),
            ], capture_output=True, text=True, check=False, timeout=2)
            self.assertNotEqual(0, completed.returncode)
            self.assertRegex(completed.stderr, r"error: checkpoint .*regular file")
            self.assertNotIn("Traceback", completed.stderr)

    def test_cli_rejects_fifo_approval_ledger_promptly_without_traceback(self):
        with tempfile.TemporaryDirectory() as directory:
            batches, approvals, companies, canonical_root, package_root = canonical_fixture(directory, 2)
            checkpoint_path, series_path, approvals_path, companies_path = write_cli_inputs(
                directory, batches, approvals, companies,
            )
            approvals_path.unlink()
            os.mkfifo(approvals_path)
            completed = subprocess.run([
                sys.executable, str(MODULE_PATH),
                "--checkpoint", str(checkpoint_path),
                "--series-batches", str(series_path),
                "--series-batch-approvals", str(approvals_path),
                "--companies", str(companies_path),
                "--package-root", str(package_root),
            ], capture_output=True, text=True, check=False, timeout=2)
            self.assertNotEqual(0, completed.returncode)
            self.assertRegex(completed.stderr, r"error: canonical approval ledger .*regular file")
            self.assertNotIn("Traceback", completed.stderr)

    def test_cli_rejects_intermediate_directory_symlink_for_each_file_input(self):
        with tempfile.TemporaryDirectory() as directory:
            batches, approvals, companies, canonical_root, package_root = canonical_fixture(directory, 2)
            checkpoint_path, series_path, approvals_path, companies_path = write_cli_inputs(directory, batches, approvals, companies)
            inputs = Path(directory) / "inputs"
            inputs.mkdir()
            nested_checkpoint = inputs / checkpoint_path.name
            nested_checkpoint.write_bytes(checkpoint_path.read_bytes())
            alias = Path(directory) / "alias"
            alias.symlink_to(Path(directory), target_is_directory=True)
            paths = {
                "checkpoint": alias / "inputs" / nested_checkpoint.name,
                "series-batches": alias / "canonical" / series_path.name,
                "series-batch-approvals": alias / "canonical" / approvals_path.name,
                "companies": alias / "canonical" / companies_path.name,
            }
            base_arguments = {
                "checkpoint": checkpoint_path,
                "series-batches": series_path,
                "series-batch-approvals": approvals_path,
                "companies": companies_path,
            }
            for option, unsafe_path in paths.items():
                arguments = dict(base_arguments)
                arguments[option] = unsafe_path
                completed = subprocess.run([
                    sys.executable, str(MODULE_PATH),
                    "--checkpoint", str(arguments["checkpoint"]),
                    "--series-batches", str(arguments["series-batches"]),
                    "--series-batch-approvals", str(arguments["series-batch-approvals"]),
                    "--companies", str(arguments["companies"]),
                    "--package-root", str(package_root),
                ], capture_output=True, text=True, check=False, timeout=2)
                with self.subTest(option=option):
                    self.assertNotEqual(0, completed.returncode)
                    self.assertIn("path is not a safe regular file", completed.stderr)
                    self.assertNotIn("Traceback", completed.stderr)

    def test_cli_accepts_regular_file_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            batches, approvals, companies, canonical_root, package_root = canonical_fixture(directory, 2)
            checkpoint_path, series_path, approvals_path, companies_path = write_cli_inputs(directory, batches, approvals, companies)
            completed = subprocess.run([
                sys.executable, str(MODULE_PATH),
                "--checkpoint", str(checkpoint_path),
                "--series-batches", str(series_path),
                "--series-batch-approvals", str(approvals_path),
                "--companies", str(companies_path),
                "--package-root", str(package_root),
            ], capture_output=True, text=True, check=False, timeout=2)
            self.assertEqual(0, completed.returncode, completed.stderr)
            self.assertEqual(50, json.loads(completed.stdout)["company_count"])

    def test_rejects_oversized_top_level_company_ledger(self):
        with tempfile.TemporaryDirectory() as directory:
            batches, approvals, companies, canonical_root, package_root = canonical_fixture(directory, 2)
            checkpoint_path, series_path, approvals_path, companies_path = write_cli_inputs(directory, batches, approvals, companies)
            companies[0]["padding"] = "x" * (16 * 1024 * 1024)
            companies_path.write_bytes(b"".join(compact_bytes(company, newline=True) for company in companies))
            with self.assertRaisesRegex(ValueError, "canonical companies exceeds the bounded byte limit"):
                with redirect_stdout(io.StringIO()):
                    VERIFIER.main([
                        "--checkpoint", str(checkpoint_path),
                        "--series-batches", str(series_path),
                        "--series-batch-approvals", str(approvals_path),
                        "--companies", str(companies_path),
                        "--package-root", str(package_root),
                    ])

    def test_rejects_oversized_canonical_approval_ledger(self):
        with tempfile.TemporaryDirectory() as directory:
            batches, approvals, companies, canonical_root, package_root = canonical_fixture(directory, 2)
            checkpoint_path, series_path, approvals_path, companies_path = write_cli_inputs(
                directory, batches, approvals, companies,
            )
            approvals_path.write_bytes(b"x" * (1024 * 1024 + 1))
            with self.assertRaisesRegex(ValueError, "canonical approval ledger exceeds the bounded byte limit"):
                with redirect_stdout(io.StringIO()):
                    VERIFIER.main([
                        "--checkpoint", str(checkpoint_path),
                        "--series-batches", str(series_path),
                        "--series-batch-approvals", str(approvals_path),
                        "--companies", str(companies_path),
                        "--package-root", str(package_root),
                    ])


if __name__ == "__main__":
    unittest.main()
