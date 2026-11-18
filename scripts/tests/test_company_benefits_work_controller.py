import copy
import hashlib
import importlib.util
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.tests.benefits_v2_batch_fixture import no_public_info_records

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "company_benefits_work_controller.py"


def load_module():
    spec = importlib.util.spec_from_file_location("company_benefits_work_controller", MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {MODULE_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def canonical_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


class WorkControllerTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        os.chmod(self.root, 0o700)
        research = ROOT / "docs" / "research" / "company-benefits"
        batches = [json.loads(line) for line in (research / "series-batches.jsonl").read_text().splitlines()]
        companies = [json.loads(line) for line in (research / "companies.jsonl").read_text().splitlines()]
        self.batch = batches[0]
        selected = {item["company_id"]: item for item in companies if item["company_id"] in self.batch["company_ids"]}
        self.companies = [selected[company_id] for company_id in self.batch["company_ids"]]
        self.batches_path = self.root / "series-batches.jsonl"
        self.companies_path = self.root / "companies.jsonl"
        self.batches_path.write_text(json.dumps(self.batch, ensure_ascii=False) + "\n")
        self.companies_path.write_text("".join(json.dumps(item, ensure_ascii=False) + "\n" for item in self.companies))
        self.assignment = self.module.create_assignment(
            self.root, self.batches_path, self.companies_path, self.batch["batch_id"],
            "assignment-001", "2026-11-15T00:00:00Z",
        )
        self.reject_index = 0

    def tearDown(self):
        self.temp.cleanup()

    def identity_receipt(self, assignment=None):
        assignment = assignment or self.assignment
        rows = []
        by_id = {item["company_id"]: item for item in self.companies}
        for company_id in assignment["company_ids"]:
            company = by_id[company_id]
            rows.append({
                "company_id": company_id,
                "legal_name": company["legal_name"],
                "jurisdiction": company["jurisdiction"],
                "registry_id": company["registry_id"],
                "status": "matched",
            })
        value = {
            "receipt_type": "identity_audit",
            "assignment_sha256": assignment["assignment_sha256"],
            "companies": rows,
            "auditor_id": "identity-auditor",
            "audited_at": "2026-11-15T01:00:00Z",
        }
        value["receipt_sha256"] = digest(value)
        path = self.root / "identity.json"
        path.write_bytes(canonical_bytes(value) + b"\n")
        return path

    def test_untouched_disposition_has_no_chain_and_no_terminal_claim(self):
        shards = self.production_shards()
        shard = shards[0]
        receipt = json.loads(shard.read_text())
        row = receipt["dispositions"][0]
        removed = set(row["artifact_ids"])
        receipt["artifacts"] = [item for item in receipt["artifacts"] if item["artifact_id"] not in removed]
        row["artifact_ids"] = []
        row["scratch"]["research-attempts.jsonl"] = []
        row["scratch"]["company-category-cells.jsonl"][0].update(
            state="not_researched", attempt_ids=[], conflict_status="none")
        row["scratch"]["company-category-cells.jsonl"][0].pop("coverage_complete")
        row["review"].update(decision="not_researched", terminal=False)
        row["closure"] = {"sources": False, "attempts": False, "captures": False}
        receipt["receipt_sha256"] = digest({k: v for k, v in receipt.items() if k != "receipt_sha256"})
        shard.write_bytes(canonical_bytes(receipt) + b"\n")
        self.assertEqual(1, sum(row["review"]["decision"] == "not_researched"
                                for path in shards for row in json.loads(path.read_text())["dispositions"]))
        result = self.module.compile_neutral_aggregate(
            self.root, self.assignment, self.identity_receipt(), shards, self.root / "untouched-aggregate")
        self.assertEqual(1, result["unresolved_count"])
        self.assertEqual("blocked_unresolved", result["adjudication_status"])
        rows = [json.loads(line) for line in (self.root / "untouched-aggregate" / "company-category-cells.jsonl").read_text().splitlines()]
        self.assertEqual(250, len(rows))
        self.assertEqual([], rows[0]["attempt_ids"])

    def production_shards(self):
        """Build a nonempty 25/250 fixture using the production v2 contracts."""
        records = no_public_info_records(self.batch, self.companies)
        attempts_by_cell = {}
        for attempt in records["attempts"]:
            attempts_by_cell.setdefault(attempt["cell_id"], []).append(attempt)
        cells_by_id = {cell["cell_id"]: cell for cell in records["cells"]}
        route_source = {
            "record_type": "nonpublishable_metadata",
            "source_id": "kr-dart-exact-entity-route",
            "title": "DART exact entity discovery route",
            "owner": "금융감독원 전자공시시스템",
            "source_type": "regulator_filing",
            "jurisdiction": "KR",
            "url": "https://dart.fss.or.kr/dsab002/main.do",
            "checked_at": "2026-11-15T01:00:00Z",
            "route_quality": "exact_entity",
            "publication_eligible": False,
            "nonpublication_reason": "The exact-entity official route is retained only as nonclaim discovery metadata.",
            "entity_binding_status": "exact_entity",
            "retention_mode": "metadata_only",
            "reuse_status": "discovery_only",
            "access_observation": {
                "status": 200,
                "final_url": "https://dart.fss.or.kr/dsab002/main.do",
                "access_wall": "none",
            },
        }
        gaps = [{
            "audit_id": f"company-gap::v2::{self.batch['batch_id']}::{company_id}",
            "company_id": company_id,
            "disposition": "nonpublishable",
            "reason": "공개 공식 자료에서 게시 가능한 근거를 확인하지 못했습니다.",
            "searched_official_source_ids": [route_source["source_id"]],
            "searched_official_urls": [],
            "nonabsence_wording": "복지가 없다는 뜻이 아닙니다.",
            "researcher_id": "neutral-aggregate",
        } for company_id in self.assignment["company_ids"]]
        paths = []
        first_disposition = True
        for lane in self.assignment["lanes"]:
            artifacts = []
            dispositions = []
            for cell_id in lane["cell_ids"]:
                _, company_id, category_id = cell_id.split("::", 2)
                authority = next(row for row in self.assignment["authorities"]
                                 if row["company_id"] == company_id)
                artifact_ids = []
                for attempt in attempts_by_cell[cell_id]:
                    capture_payload = (
                        f"terminal capture {cell_id} {attempt['route_id']} no_result\n"
                    ).encode()
                    attempt["raw_response_sha256"] = hashlib.sha256(capture_payload).hexdigest()
                    attempt["receipt_content_sha256"] = digest({
                        key: value for key, value in attempt.items()
                        if key != "receipt_content_sha256"
                    })
                    previous = None
                    for kind in ("source", "attempt", "capture"):
                        artifact_id = f"artifact::{company_id}::{category_id}::{attempt['route_id']}::{kind}"
                        relative = Path("artifacts") / company_id / category_id / attempt["route_id"] / f"{kind}.json"
                        path = self.root / relative
                        path.parent.mkdir(parents=True, exist_ok=True)
                        if kind == "capture":
                            payload = capture_payload
                        elif kind == "attempt":
                            payload = canonical_bytes(attempt) + b"\n"
                        else:
                            payload = canonical_bytes({
                                "artifact_id": artifact_id,
                                "cell_id": cell_id,
                                "attempt_id": attempt["attempt_id"],
                                "route_id": attempt["route_id"],
                                "kind": kind,
                            }) + b"\n"
                        path.write_bytes(payload)
                        item = {
                            "artifact_id": artifact_id,
                            "kind": kind,
                            "cell_id": cell_id,
                            "attempt_id": attempt["attempt_id"],
                            "route_id": attempt["route_id"],
                            "path": relative.as_posix(),
                            "sha256": hashlib.sha256(payload).hexdigest(),
                            "size": len(payload),
                            "result": attempt["result"],
                        }
                        if kind == "attempt":
                            item["source_artifact_id"] = previous
                        elif kind == "capture":
                            item["attempt_artifact_id"] = previous
                        artifacts.append(item)
                        artifact_ids.append(artifact_id)
                        previous = artifact_id
                scratch = {
                    "company-category-cells.jsonl": [copy.deepcopy(cells_by_id[cell_id])],
                    "research-attempts.jsonl": copy.deepcopy(attempts_by_cell[cell_id]),
                }
                if first_disposition:
                    scratch.update({
                        "sources.jsonl": [route_source],
                        "gaps.jsonl": gaps,
                        "verified-benefit-candidates.jsonl": [],
                    })
                    first_disposition = False
                dispositions.append({
                    "cell_id": cell_id,
                    "company_id": company_id,
                    "category_id": category_id,
                    "jurisdiction": authority["jurisdiction"],
                    "review": {
                        "decision": "no_public_info",
                        "terminal": True,
                        "reviewer_id": "independent-reviewer",
                        "reviewed_at": "2026-11-15T02:00:00Z",
                    },
                    "closure": {"sources": True, "attempts": True, "captures": True},
                    "artifact_ids": artifact_ids,
                    "scratch": scratch,
                })
            shard = {
                "receipt_type": "acquisition_shard",
                "lane_id": lane["lane_id"],
                "assignment_sha256": self.assignment["assignment_sha256"],
                "cell_ids": lane["cell_ids"],
                "artifacts": artifacts,
                "dispositions": dispositions,
                "producer_id": "acquisition-producer",
                "completed_at": "2026-11-15T02:30:00Z",
            }
            shard["receipt_sha256"] = digest(shard)
            path = self.root / f"production-{lane['lane_id']}.json"
            path.write_bytes(canonical_bytes(shard) + b"\n")
            paths.append(path)
        return paths

    def rewrite_shard(self, path, mutate):
        value = json.loads(path.read_text())
        mutate(value)
        value["receipt_sha256"] = digest({
            key: item for key, item in value.items() if key != "receipt_sha256"
        })
        path.write_bytes(canonical_bytes(value) + b"\n")

    def assert_production_rejected(self, mutate, message):
        self.reject_index += 1
        identity, shards = self.identity_receipt(), self.production_shards()
        self.rewrite_shard(shards[0], mutate)
        with self.assertRaisesRegex(ValueError, message):
            self.module.compile_neutral_aggregate(
                self.root, self.assignment, identity, shards,
                self.root / f"rejected-{self.reject_index:02d}",
            )

    def test_valid_assignment_is_exact_25_by_10_with_six_disjoint_lanes(self):
        assignment = self.assignment
        self.assertEqual(25, len(assignment["company_ids"]))
        self.assertEqual(250, len(assignment["cell_ids"]))
        self.assertEqual(6, len(assignment["lanes"]))
        flattened = [cell for lane in assignment["lanes"] for cell in lane["cell_ids"]]
        self.assertEqual(assignment["cell_ids"], flattened)
        self.assertEqual(250, len(set(flattened)))
        self.assertEqual(assignment["assignment_sha256"], digest({k: v for k, v in assignment.items() if k != "assignment_sha256"}))

    def test_aggregate_writes_exact_deterministic_current_scratch_inventory(self):
        identity = self.identity_receipt()
        shards = self.production_shards()
        first = self.root / "scratch-a"
        second = self.root / "scratch-b"
        result_a = self.module.compile_neutral_aggregate(self.root, self.assignment, identity, shards, first)
        result_b = self.module.compile_neutral_aggregate(self.root, self.assignment, identity, list(reversed(shards)), second)
        expected = {"draft.json", "sources.jsonl", "claims.jsonl", "gaps.jsonl",
                    "company-category-cells.jsonl", "research-attempts.jsonl",
                    "official-claims-v2.jsonl", "reference-records.jsonl",
                    "community-benefit-reports.jsonl", "sources-v2.jsonl",
                    "verified-benefit-candidates.jsonl"}
        self.assertEqual(expected, {item.name for item in first.iterdir()})
        self.assertEqual(result_a["inventory_sha256"], result_b["inventory_sha256"])
        self.assertEqual({p.name: p.read_bytes() for p in first.iterdir()},
                         {p.name: p.read_bytes() for p in second.iterdir()})
        self.assertEqual(250, len((first / "company-category-cells.jsonl").read_bytes().splitlines()))

    def test_duplicate_or_omitted_shard_is_rejected(self):
        identity, shards = self.identity_receipt(), self.production_shards()
        with self.assertRaisesRegex(ValueError, "duplicate|union"):
            self.module.compile_neutral_aggregate(self.root, self.assignment, identity,
                                                  shards[:-1] + [shards[0]], self.root / "bad-dup")
        with self.assertRaisesRegex(ValueError, "union|missing"):
            self.module.compile_neutral_aggregate(self.root, self.assignment, identity,
                                                  shards[:-1], self.root / "bad-missing")

    def test_wrong_manifest_digest_identity_and_artifact_hash_are_rejected(self):
        identity, shards = self.identity_receipt(), self.production_shards()
        cases = []
        wrong_assignment = copy.deepcopy(self.assignment)
        wrong_assignment["assignment_sha256"] = "0" * 64
        cases.append((wrong_assignment, identity, shards, "digest"))
        identity_value = json.loads(identity.read_text())
        identity_value["companies"][0]["jurisdiction"] = "US"
        identity_value["receipt_sha256"] = digest({k: v for k, v in identity_value.items() if k != "receipt_sha256"})
        wrong_identity = self.root / "wrong-identity.json"
        wrong_identity.write_bytes(canonical_bytes(identity_value) + b"\n")
        cases.append((self.assignment, wrong_identity, shards, "identity|jurisdiction"))
        shard_value = json.loads(shards[0].read_text())
        shard_value["artifacts"][0]["sha256"] = "f" * 64
        shard_value["receipt_sha256"] = digest({k: v for k, v in shard_value.items() if k != "receipt_sha256"})
        wrong_shard = self.root / "wrong-shard.json"
        wrong_shard.write_bytes(canonical_bytes(shard_value) + b"\n")
        cases.append((self.assignment, identity, [wrong_shard, *shards[1:]], "artifact.*hash"))
        for index, (assignment, audit, shard_set, message) in enumerate(cases):
            with self.subTest(index=index), self.assertRaisesRegex(ValueError, message):
                self.module.compile_neutral_aggregate(self.root, assignment, audit, shard_set,
                                                      self.root / f"bad-{index}")

    def test_access_failure_or_missing_review_cannot_become_absence(self):
        identity, shards = self.identity_receipt(), self.production_shards()
        value = json.loads(shards[0].read_text())
        value["artifacts"][0]["result"] = "access_failure"
        value["receipt_sha256"] = digest({k: v for k, v in value.items() if k != "receipt_sha256"})
        shards[0].write_bytes(canonical_bytes(value) + b"\n")
        with self.assertRaisesRegex(ValueError, "result|no_public_info"):
            self.module.compile_neutral_aggregate(self.root, self.assignment, identity, shards,
                                                  self.root / "bad-access")
        shards = self.production_shards()
        value = json.loads(shards[0].read_text())
        del value["dispositions"][0]["review"]
        value["receipt_sha256"] = digest({k: v for k, v in value.items() if k != "receipt_sha256"})
        shards[0].write_bytes(canonical_bytes(value) + b"\n")
        with self.assertRaisesRegex(ValueError, "reviewed disposition"):
            self.module.compile_neutral_aggregate(self.root, self.assignment, identity, shards,
                                                  self.root / "bad-review")

    def test_unresolved_never_reports_approval(self):
        shards = self.production_shards()
        for path in shards:
            def make_unresolved(shard):
                for disposition in shard["dispositions"]:
                    disposition["review"].update(
                        decision="research_incomplete", terminal=False)
                    disposition["scratch"]["company-category-cells.jsonl"][0][
                        "state"
                    ] = "research_incomplete"
                    disposition["scratch"]["company-category-cells.jsonl"][0].pop(
                        "coverage_complete", None)
            self.rewrite_shard(path, make_unresolved)
        result = self.module.compile_neutral_aggregate(
            self.root, self.assignment, self.identity_receipt(),
            shards, self.root / "unresolved")
        self.assertEqual("blocked_unresolved", result["adjudication_status"])
        self.assertEqual(250, result["unresolved_count"])
        self.assertNotIn("approved", canonical_bytes(result).decode())

    def test_unresolved_cell_invariants_are_preflighted_without_candidate_output(self):
        identity, shards = self.identity_receipt(), self.production_shards()
        original = json.loads(shards[0].read_text())
        cases = {
            "official_claim_ids": ["official::stale"],
            "reference_ids": ["reference::stale"],
            "community_report_ids": ["community::stale"],
            "coverage_complete": True,
            "coverage_complete_false": False,
            "reliability": "high",
            "currentness": "current",
            "scope_status": "exact_entity",
            "publication_eligibility": "official_claim",
        }
        for state in ("not_researched", "research_incomplete", "source_access_failed", "conflicting_evidence"):
            wrong_conflict = "none" if state == "conflicting_evidence" else "contradictory"
            for field, stale in (*cases.items(), ("conflict_status", wrong_conflict)):
                with self.subTest(state=state, field=field):
                    shard = copy.deepcopy(original)
                    disposition = shard["dispositions"][0]
                    cell = disposition["scratch"]["company-category-cells.jsonl"][0]
                    disposition["review"].update(decision=state, terminal=False)
                    cell.update(state=state, conflict_status=(
                        "contradictory" if state == "conflicting_evidence" else "none"))
                    cell.pop("coverage_complete")
                    if state == "not_researched":
                        removed = set(disposition["artifact_ids"])
                        shard["artifacts"] = [item for item in shard["artifacts"]
                                              if item["artifact_id"] not in removed]
                        disposition["artifact_ids"] = []
                        disposition["scratch"]["research-attempts.jsonl"] = []
                        disposition["closure"] = dict.fromkeys(
                            ("sources", "attempts", "captures"), False)
                        cell["attempt_ids"] = []
                    cell["coverage_complete" if field == "coverage_complete_false" else field] = stale
                    shard["receipt_sha256"] = digest({
                        key: value for key, value in shard.items() if key != "receipt_sha256"
                    })
                    shards[0].write_bytes(canonical_bytes(shard) + b"\n")
                    output = self.root / f"rejected-{state}-{field}"
                    with self.assertRaisesRegex(ValueError, "coverage_complete" if field == "coverage_complete_false" else field):
                        self.module.compile_neutral_aggregate(
                            self.root, self.assignment, identity, shards, output)
                    self.assertFalse(output.exists())
                    self.assertFalse(list(self.root.glob(".neutral-aggregate-*")))

    def test_restart_supersession_and_receipt_replay(self):
        replay = self.module.create_assignment(
            self.root, self.batches_path, self.companies_path, self.batch["batch_id"],
            "assignment-001", "2026-11-15T00:00:00Z")
        self.assertEqual(self.assignment, replay)
        successor = self.module.create_assignment(
            self.root, self.batches_path, self.companies_path, self.batch["batch_id"],
            "assignment-002", "2026-11-15T03:00:00Z",
            supersedes=self.assignment["assignment_sha256"])
        self.assertEqual(self.assignment["assignment_sha256"], successor["supersedes_assignment_sha256"])
        receipt = self.module.append_stage_receipt(
            self.root, "receipt-1", "canonical_assignment", successor["assignment_sha256"],
            "2026-11-15T03:01:00Z", {"assignment_id": successor["assignment_id"]})
        self.assertEqual(receipt, self.module.append_stage_receipt(
            self.root, "receipt-1", "canonical_assignment", successor["assignment_sha256"],
            "2026-11-15T03:01:00Z", {"assignment_id": successor["assignment_id"]}))
        lines = (self.root / "work-ledger.jsonl").read_bytes().splitlines()
        self.assertEqual(1, len(lines))

    def test_symlink_fifo_and_oversize_inputs_fail_closed(self):
        identity, shards = self.identity_receipt(), self.production_shards()
        link = self.root / "identity-link.json"
        link.symlink_to(identity.name)
        with self.assertRaisesRegex(ValueError, "regular|symlink"):
            self.module.compile_neutral_aggregate(self.root, self.assignment, link, shards,
                                                  self.root / "bad-link")
        fifo = self.root / "identity.fifo"
        os.mkfifo(fifo)
        with self.assertRaisesRegex(ValueError, "regular"):
            self.module.compile_neutral_aggregate(self.root, self.assignment, fifo, shards,
                                                  self.root / "bad-fifo")
        huge = self.root / "huge.json"
        huge.write_bytes(b" " * (self.module.MAX_INPUT_BYTES + 1))
        with self.assertRaisesRegex(ValueError, "too large"):
            self.module.compile_neutral_aggregate(self.root, self.assignment, huge, shards,
                                                  self.root / "bad-huge")

    def test_root_must_be_private_real_preexisting_directory(self):
        public = self.root / "public"
        public.mkdir(mode=0o777)
        os.chmod(public, 0o777)
        with self.assertRaisesRegex(ValueError, "private"):
            self.module.create_assignment(public, self.batches_path, self.companies_path,
                                          self.batch["batch_id"], "bad", "2026-11-15T00:00:00Z")
        linked = self.root / "linked"
        linked.symlink_to(public, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "symlink|real"):
            self.module.create_assignment(linked, self.batches_path, self.companies_path,
                                          self.batch["batch_id"], "bad", "2026-11-15T00:00:00Z")

    def test_aggregate_rejects_object_attempt_id_before_artifact_io(self):
        identity, shards = self.identity_receipt(), self.production_shards()
        self.rewrite_shard(
            shards[0],
            lambda shard: shard["dispositions"][0]["scratch"][
                "research-attempts.jsonl"
            ][0].update(attempt_id={"not": "a string"}),
        )

        with mock.patch.object(
            self.module, "_artifact", side_effect=AssertionError("artifact I/O occurred")
        ):
            with self.assertRaisesRegex(ValueError, "attempt.*identity|string|malformed"):
                self.module.compile_neutral_aggregate(
                    self.root, self.assignment, identity, shards,
                    self.root / "malformed-attempt-id",
                )

    def test_aggregate_rejects_non_object_cell_row_before_artifact_io(self):
        identity, shards = self.identity_receipt(), self.production_shards()
        self.rewrite_shard(
            shards[0],
            lambda shard: shard["dispositions"][0]["scratch"][
                "company-category-cells.jsonl"
            ].__setitem__(0, ["not", "an", "object"]),
        )

        with mock.patch.object(
            self.module, "_artifact", side_effect=AssertionError("artifact I/O occurred")
        ):
            with self.assertRaisesRegex(ValueError, "cell.*object|scratch.*row"):
                self.module.compile_neutral_aggregate(
                    self.root, self.assignment, identity, shards,
                    self.root / "malformed-cell-row",
                )

    def test_mutation_matrix_a_absence_requires_independent_terminal_chains(self):
        def artifact_result(value):
            def mutate(shard):
                artifact = shard["artifacts"][0]
                if value is None:
                    artifact.pop("result", None)
                else:
                    artifact["result"] = value
            return mutate

        for result in ("success", None, "route_exhaustion", "access_failed", "transport_failure"):
            with self.subTest(result=result):
                self.assert_production_rejected(artifact_result(result), "result|no_public_info")

        self.assert_production_rejected(
            lambda shard: shard["dispositions"][0]["review"].update(
                reviewer_id=shard["producer_id"]),
            "independent",
        )
        self.assert_production_rejected(
            lambda shard: shard["dispositions"][0]["review"].update(terminal=False),
            "terminal",
        )
        self.assert_production_rejected(
            lambda shard: shard["artifacts"][1].pop("source_artifact_id"),
            "chain|binding",
        )
        self.assert_production_rejected(
            lambda shard: shard["dispositions"][0]["closure"].update(captures=False),
            "closure",
        )

    def test_mixed_unresolved_preflight_uses_authoritative_candidate_validation(self):
        shards = self.production_shards()
        def mark_unresolved(shard):
            disposition = shard["dispositions"][0]
            disposition["review"].update(decision="research_incomplete", terminal=False)
            cell = disposition["scratch"]["company-category-cells.jsonl"][0]
            cell["state"] = "research_incomplete"
            cell.pop("coverage_complete")
        self.rewrite_shard(shards[0], mark_unresolved)
        candidate = self.root / "mixed-candidate-output"
        result = self.module.compile_neutral_aggregate(
            self.root, self.assignment, self.identity_receipt(), shards,
            self.root / "mixed-production-scratch", candidate_output=candidate,
            research_root=ROOT / "docs" / "research" / "company-benefits",
        )
        self.assertEqual(250, result["cell_count"])
        self.assertEqual(1, result["unresolved_count"])
        self.assertEqual("pending_independent_review", result["adjudication_status"])
        self.assertEqual(250, len((candidate / "company-category-outcomes.jsonl").read_bytes().splitlines()))

    def test_mutation_matrix_b_authoritative_nonempty_25_250_preflight(self):
        candidate = self.root / "candidate-output"
        result = self.module.compile_neutral_aggregate(
            self.root, self.assignment, self.identity_receipt(), self.production_shards(),
            self.root / "production-scratch", candidate_output=candidate,
            research_root=ROOT / "docs" / "research" / "company-benefits",
        )
        self.assertEqual(250, result["cell_count"])
        self.assertEqual(0, result["unresolved_count"])
        self.assertEqual("pending_independent_review", result["adjudication_status"])
        manifest = json.loads((candidate / "candidate.json").read_text())
        self.assertEqual("2", manifest["schema_version"])
        self.assertTrue((candidate / "research-attempts.jsonl").stat().st_size)
        self.assertEqual(250, len((candidate / "company-category-cells.jsonl").read_bytes().splitlines()))

    def test_mutation_matrix_c_disposition_authority_is_exact(self):
        cases = (
            ("company", lambda row: row.update(company_id=self.assignment["company_ids"][1])),
            ("category", lambda row: row.update(category_id="health")),
            ("jurisdiction", lambda row: row.update(jurisdiction="US")),
        )
        for label, change in cases:
            with self.subTest(field=label):
                self.assert_production_rejected(
                    lambda shard, change=change: change(shard["dispositions"][0]),
                    "authority|binding|disposition",
                )

    def test_mutation_matrix_d_artifact_bindings_are_distinct_and_cell_local(self):
        def relabel_one_file(shard):
            original, relabeled = shard["artifacts"][:2]
            for field in ("path", "sha256", "size"):
                relabeled[field] = original[field]

        self.assert_production_rejected(relabel_one_file, "distinct|reused|unique")

        def cross_cell_reuse(shard):
            shard["dispositions"][1]["artifact_ids"] = list(
                shard["dispositions"][0]["artifact_ids"])

        self.assert_production_rejected(cross_cell_reuse, "cell-local|binding|reused")

    def test_mutation_matrix_e_descriptor_relative_reads_fail_closed(self):
        outside = self.root.parent / "outside-artifact.json"
        outside.write_bytes(b"outside\n")
        linked = self.root / "linked-artifacts"
        linked.symlink_to(outside.parent, target_is_directory=True)
        identity, shards = self.identity_receipt(), self.production_shards()

        def intermediate_escape(shard):
            artifact = shard["artifacts"][0]
            artifact.update(path=f"{linked.name}/{outside.name}",
                            sha256=hashlib.sha256(outside.read_bytes()).hexdigest(),
                            size=outside.stat().st_size)

        self.rewrite_shard(shards[0], intermediate_escape)
        with self.assertRaisesRegex(ValueError, "no-follow|symlink|regular"):
            self.module.compile_neutral_aggregate(
                self.root, self.assignment, identity, shards, self.root / "bad-intermediate")

        for kind in ("fifo", "oversize"):
            with self.subTest(kind=kind):
                identity, shards = self.identity_receipt(), self.production_shards()
                hostile = self.root / f"hostile-{kind}"
                if kind == "fifo":
                    os.mkfifo(hostile)
                    size, checksum = 0, hashlib.sha256(b"").hexdigest()
                else:
                    with hostile.open("wb") as stream:
                        stream.truncate(self.module.MAX_ARTIFACT_BYTES + 1)
                    size, checksum = hostile.stat().st_size, "0" * 64

                def bind_hostile(shard, hostile=hostile, size=size, checksum=checksum):
                    shard["artifacts"][0].update(path=hostile.name, size=size, sha256=checksum)

                self.rewrite_shard(shards[0], bind_hostile)
                with self.assertRaisesRegex(ValueError, "regular|too large"):
                    self.module.compile_neutral_aggregate(
                        self.root, self.assignment, identity, shards,
                        self.root / f"bad-{kind}")

    def test_mutation_matrix_f_supersession_revalidates_predecessor(self):
        predecessor_path = self.root / "assignment-001.assignment.json"
        original = json.loads(predecessor_path.read_text())
        claimed = original["assignment_sha256"]

        tampered = copy.deepcopy(original)
        tampered["authorities"][0]["jurisdiction"] = ""
        predecessor_path.write_bytes(canonical_bytes(tampered) + b"\n")
        with self.assertRaisesRegex(ValueError, "predecessor|assignment|digest"):
            self.module.create_assignment(
                self.root, self.batches_path, self.companies_path, self.batch["batch_id"],
                "successor-tampered", "2026-11-15T03:00:00Z", supersedes=claimed)

        malformed = copy.deepcopy(original)
        malformed["lanes"][0]["cell_ids"] = malformed["lanes"][0]["cell_ids"][:-1]
        malformed["assignment_sha256"] = digest({
            key: value for key, value in malformed.items() if key != "assignment_sha256"
        })
        predecessor_path.write_bytes(canonical_bytes(malformed) + b"\n")
        with self.assertRaisesRegex(ValueError, "predecessor|assignment|lane|union"):
            self.module.create_assignment(
                self.root, self.batches_path, self.companies_path, self.batch["batch_id"],
                "successor-malformed", "2026-11-15T03:00:00Z",
                supersedes=malformed["assignment_sha256"])

    def test_mutation_matrix_g_supersession_rebinds_predecessor_to_canonical_ledgers(self):
        predecessor_path = self.root / "assignment-001.assignment.json"
        original = json.loads(predecessor_path.read_text())
        mutations = (
            ("legal-name", lambda value: value["authorities"][0].update(
                legal_name="Forged Legal Name Co., Ltd.")),
            ("company-list-hash", lambda value: value.update(company_list_sha256="0" * 64)),
            ("effective-sequence-hash", lambda value: value.update(effective_sequence_sha256="1" * 64)),
            ("replacement-events-hash", lambda value: value.update(replacement_events_sha256="2" * 64)),
            ("canonical-batch-hash", lambda value: value.update(canonical_batch_sha256="3" * 64)),
        )
        for index, (label, mutate) in enumerate(mutations):
            with self.subTest(mutation=label):
                forged = copy.deepcopy(original)
                mutate(forged)
                forged["assignment_sha256"] = digest({
                    key: value for key, value in forged.items() if key != "assignment_sha256"
                })
                predecessor_path.write_bytes(canonical_bytes(forged) + b"\n")
                with self.assertRaisesRegex(ValueError, "predecessor|canonical|authorit|ledger"):
                    self.module.create_assignment(
                        self.root, self.batches_path, self.companies_path,
                        self.batch["batch_id"], f"successor-forged-{index}",
                        "2026-11-15T03:00:00Z", supersedes=forged["assignment_sha256"],
                    )

    def test_mutation_matrix_h_assignment_load_is_descriptor_relative(self):
        outside = self.root.parent / f"{self.root.name}-assignment-outside"
        outside.mkdir()
        self.addCleanup(shutil.rmtree, outside, True)
        escaped = outside / "escaped.assignment.json"
        escaped.write_bytes(canonical_bytes(self.assignment) + b"\n")
        assignment_link = self.root / "assignment-link"
        assignment_link.symlink_to(outside, target_is_directory=True)
        identity, shards = self.identity_receipt(), self.production_shards()
        arguments = [
            "compile-scratch", "--external-root", str(self.root),
            "--assignment", str(self.root / "assignment-link" / "escaped.assignment.json"),
            "--identity-audit", str(identity), "--output-dir", str(self.root / "escaped-output"),
        ]
        for shard in shards:
            arguments.extend(("--shard", str(shard)))

        with self.assertRaisesRegex(ValueError, "descriptor-relative|no-follow|symlink|regular"):
            self.module.main(arguments)

    def test_mutation_matrix_i_review_decision_matches_production_cell_state(self):
        self.assert_production_rejected(
            lambda shard: shard["dispositions"][0]["review"].update(
                decision="evidence_candidate"),
            "decision|state",
        )

        def evidence_state_with_absence_decision(shard):
            shard["dispositions"][0]["scratch"]["company-category-cells.jsonl"][0][
                "state"
            ] = "official_verified"

        self.assert_production_rejected(
            evidence_state_with_absence_decision,
            "decision|state",
        )

    def test_mutation_matrix_j_review_strictly_follows_bound_attempts(self):
        for reviewed_at in (
            "2026-11-01T01:01:00Z",
            "2026-11-01T10:01:00+09:00",
            "2026-11-01T01:00:59.999999Z",
        ):
            with self.subTest(reviewed_at=reviewed_at):
                self.assert_production_rejected(
                    lambda shard, reviewed_at=reviewed_at: shard["dispositions"][0][
                        "review"
                    ].update(reviewed_at=reviewed_at),
                    "review|strictly after|completion|timestamp",
                )

    def test_mutation_matrix_k_artifact_io_is_preflighted_and_cumulatively_bounded(self):
        identity, shards = self.identity_receipt(), self.production_shards()
        values = [json.loads(path.read_text()) for path in shards]
        declared_total = sum(
            artifact["size"] for shard in values for artifact in shard["artifacts"]
        )

        over_cardinality = copy.deepcopy(values[0]["artifacts"][0])
        over_cardinality.update(
            artifact_id=f"{over_cardinality['artifact_id']}::extra",
            path=f"{over_cardinality['path']}.extra",
            sha256="0" * 64,
        )
        values[0]["artifacts"].append(over_cardinality)
        values[0]["receipt_sha256"] = digest({
            key: value for key, value in values[0].items() if key != "receipt_sha256"
        })
        shards[0].write_bytes(canonical_bytes(values[0]) + b"\n")
        with mock.patch.object(
            self.module, "_artifact", side_effect=AssertionError("artifact I/O occurred")
        ):
            with self.assertRaisesRegex(ValueError, "cardinality|chain|inventory"):
                self.module.compile_neutral_aggregate(
                    self.root, self.assignment, identity, shards,
                    self.root / "over-cardinality",
                )

        identity, shards = self.identity_receipt(), self.production_shards()
        with mock.patch.object(
            self.module, "PROTOCOL_2_MAX_AGGREGATE_ARTIFACT_BYTES", declared_total - 1,
        ), mock.patch.object(
            self.module, "_artifact", side_effect=AssertionError("artifact I/O occurred")
        ):
            with self.assertRaisesRegex(ValueError, "aggregate|declared|budget|byte"):
                self.module.compile_neutral_aggregate(
                    self.root, self.assignment, identity, shards,
                    self.root / "over-declared-budget",
                )

        identity, shards = self.identity_receipt(), self.production_shards()
        first_shard = json.loads(shards[0].read_text())
        first_artifact = first_shard["artifacts"][0]
        artifact_path = self.root / first_artifact["path"]
        artifact_path.write_bytes(artifact_path.read_bytes() + b"x")
        original_bounded_read = self.module._bounded_root_regular
        artifact_limits = []

        def observe_bound(root, path, maximum=self.module.MAX_INPUT_BYTES):
            if Path(path).as_posix() == first_artifact["path"]:
                artifact_limits.append(maximum)
            return original_bounded_read(root, path, maximum)

        with mock.patch.object(self.module, "_bounded_root_regular", side_effect=observe_bound):
            with self.assertRaisesRegex(ValueError, "large|changed|hash|size"):
                self.module.compile_neutral_aggregate(
                    self.root, self.assignment, identity, shards,
                    self.root / "actual-over-declared",
                )
        self.assertEqual([first_artifact["size"]], artifact_limits)

    def test_mutation_matrix_l_malformed_company_ids_raise_value_error(self):
        malformed = copy.deepcopy(self.assignment)
        malformed["company_ids"][0] = {"not": "a string"}
        malformed["assignment_sha256"] = digest({
            key: value for key, value in malformed.items() if key != "assignment_sha256"
        })
        with self.assertRaisesRegex(ValueError, "company|companies|string|invalid"):
            self.module._validate_assignment(malformed)

        ingress_cases = (
            ("batch-company-id", "batch", {"not": "a string"}),
            ("ledger-company-id", "ledger", ["not", "a", "string"]),
        )
        for index, (label, source, malformed_id) in enumerate(ingress_cases, 1):
            with self.subTest(source=label):
                batch = copy.deepcopy(self.batch)
                companies = copy.deepcopy(self.companies)
                if source == "batch":
                    batch["company_ids"][0] = malformed_id
                else:
                    companies[0]["company_id"] = malformed_id
                self.batches_path.write_text(json.dumps(batch, ensure_ascii=False) + "\n")
                self.companies_path.write_text("".join(
                    json.dumps(item, ensure_ascii=False) + "\n" for item in companies
                ))
                with self.assertRaisesRegex(ValueError, "company|companies|string|invalid"):
                    self.module.create_assignment(
                        self.root, self.batches_path, self.companies_path,
                        self.batch["batch_id"], f"malformed-ingress-{index}",
                        "2026-11-15T04:00:00Z",
                    )


if __name__ == "__main__":
    unittest.main()
