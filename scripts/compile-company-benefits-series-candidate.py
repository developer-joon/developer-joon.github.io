#!/usr/bin/env python3
"""Deterministically compile scratch research into the candidate contract."""

import argparse
import ctypes
import importlib.util
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import company_benefits_series as series

V2_FILES = {
    "company-category-cells.jsonl", "research-attempts.jsonl", "official-claims-v2.jsonl",
    "reference-records.jsonl", "community-benefit-reports.jsonl", "sources-v2.jsonl",
}
SCRATCH_FILES = {"draft.json", "sources.jsonl", "claims.jsonl", "gaps.jsonl", *V2_FILES}
CURRENT_SCRATCH_FILES = {*SCRATCH_FILES, "verified-benefit-candidates.jsonl"}
MAX_COMPILER_FILE_BYTES = 64 * 1024 * 1024
MAX_COMPILER_PACKAGE_BYTES = 256 * 1024 * 1024


def _renameat2(left_fd, left_name, right_fd, right_name, flags, message):
    libc = ctypes.CDLL(None, use_errno=True)
    renameat2 = getattr(libc, "renameat2", None)
    if renameat2 is None:
        raise RuntimeError(message)
    renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    renameat2.restype = ctypes.c_int
    if renameat2(left_fd, os.fsencode(left_name), right_fd, os.fsencode(right_name), flags) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), f"{left_name} <-> {right_name}")


def _atomic_exchange(left_fd, left_name, right_fd, right_name):
    _renameat2(left_fd, left_name, right_fd, right_name, 2,
               "atomic compiler replacement requires Linux renameat2")


def _atomic_noreplace(left_fd, left_name, right_fd, right_name):
    _renameat2(left_fd, left_name, right_fd, right_name, 1,
               "atomic compiler publication requires Linux renameat2")


def _load_validator():
    path = Path(__file__).with_name("validate-company-benefits-series-candidate.py")
    spec = importlib.util.spec_from_file_location("candidate_compiler_contract", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def compile_candidate(scratch_dir, output_dir, research_root):
    validator = _load_validator()
    scratch_dir, output_dir = Path(scratch_dir), Path(output_dir)
    actual = set(os.listdir(scratch_dir))
    current_format = actual == CURRENT_SCRATCH_FILES
    if actual not in (SCRATCH_FILES, CURRENT_SCRATCH_FILES):
        raise ValueError("scratch compiler input must contain one exact legacy/current canonical ledger set")
    input_raw = series.read_bounded_regular_files(
        scratch_dir, actual, MAX_COMPILER_FILE_BYTES, MAX_COMPILER_PACKAGE_BYTES,
        "scratch compiler input",
    )
    try:
        draft = json.loads(input_raw["draft.json"])
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("scratch draft manifest is invalid JSON") from exc
    fields = {"schema_version", "batch_id", "company_list_sha256", "effective_sequence_sha256",
              "replacement_events_sha256", "researcher_id"}
    if set(draft) != fields or draft.get("schema_version") != "1":
        raise ValueError("scratch draft manifest schema mismatch")
    batch = validator._canonical_batch(research_root, draft.get("batch_id"))
    contract = validator._load_verifier().company_benefits_series
    position = {company_id: index for index, company_id in enumerate(batch["company_ids"])}
    sources = sorted(validator.read_jsonl_bytes(input_raw["sources.jsonl"], "sources.jsonl"), key=lambda item: item.get("source_id", ""))
    claims = sorted(validator.read_jsonl_bytes(input_raw["claims.jsonl"], "claims.jsonl"),
                    key=lambda item: (position.get(item.get("company_id"), 10**9), item.get("claim_id", "")))
    supplied_gaps = validator.read_jsonl_bytes(input_raw["gaps.jsonl"], "gaps.jsonl")
    gaps = []
    for supplied in supplied_gaps:
        gap = dict(supplied)
        gap["audit_id"] = contract.compiled_v2_gap_id(gap, batch)
        gaps.append(gap)
    gaps.sort(key=lambda item: position.get(item.get("company_id"), 10**9))
    category_position = {category: index for index, category in enumerate(contract.V2_CATEGORIES)}
    cells = sorted(validator.read_jsonl_bytes(input_raw["company-category-cells.jsonl"], "company-category-cells.jsonl"),
                   key=lambda item: (position.get(item.get("company_id"), 10**9),
                                     category_position.get(item.get("category_id"), 10**9)))
    attempts = sorted(validator.read_jsonl_bytes(input_raw["research-attempts.jsonl"], "research-attempts.jsonl"),
                      key=lambda item: (position.get(item.get("company_id"), 10**9),
                                        category_position.get(item.get("category_id"), 10**9),
                                        item.get("route_id", "")))
    claims_by_company = {}
    for claim in claims:
        claims_by_company.setdefault(claim.get("company_id"), []).append(claim)
    gaps_by_company = {gap.get("company_id"): gap for gap in gaps}
    requests = []
    for company_id in batch["company_ids"]:
        for claim in claims_by_company.get(company_id, []):
            researcher = claim.get("researcher_id", draft["researcher_id"])
            requests.append({"request_id": f"review-request::claim::{claim.get('claim_id')}", "target_type": "claim",
                             "target_id": claim.get("claim_id"), "researcher_id": researcher,
                             "status": "pending_independent_review"})
        gap = gaps_by_company.get(company_id)
        if gap:
            requests.append({"request_id": f"review-request::gap::{gap.get('audit_id')}", "target_type": "gap",
                             "target_id": gap.get("audit_id"), "researcher_id": gap.get("researcher_id"),
                             "status": "pending_independent_review"})
    records = {"sources.jsonl": sources, "claims.jsonl": claims, "gaps.jsonl": gaps,
               "review-requests.jsonl": requests,
               "company-category-cells.jsonl": cells, "research-attempts.jsonl": attempts}
    for name, field in (("official-claims-v2.jsonl", "claim_id"), ("reference-records.jsonl", "reference_id"),
                        ("community-benefit-reports.jsonl", "community_report_id"), ("sources-v2.jsonl", "source_id")):
        records[name] = sorted(validator.read_jsonl_bytes(input_raw[name], name), key=lambda item: item.get(field, ""))
    artifact_names = validator.ALL_ARTIFACT_FILES
    if current_format:
        evidence = [*records["official-claims-v2.jsonl"], *records["reference-records.jsonl"],
                    *records["community-benefit-reports.jsonl"]]
        propositions = validator.validate_proposition_candidates(
            validator.read_jsonl_bytes(input_raw["verified-benefit-candidates.jsonl"],
                                       "verified-benefit-candidates.jsonl"), evidence, batch
        )
        records["verified-benefit-candidates.jsonl"] = propositions
        records["company-category-outcomes.jsonl"] = validator.compile_cell_outcomes(
            cells, attempts, propositions
        )
        artifact_names = validator.CURRENT_ARTIFACT_FILES
    with series.create_output_staging(output_dir, "candidate-compile-") as staging:
        staged = staging.path
        artifacts = {}
        for name in artifact_names:
            raw = validator._load_verifier().company_benefits_series.jsonl_bytes(records[name])
            staging.write_bytes(name, raw)
            artifacts[name] = validator.sha256(raw)
        manifest = {**draft, "schema_version": "2" if current_format else "1",
                    "status": "review_pending", "artifacts": artifacts}
        staging.write_bytes(
            "candidate.json",
            validator._load_verifier().company_benefits_series.json_bytes(manifest),
        )
        staging.validate_binding()
        validator.validate_candidate(staged, research_root)
        staging.validate_binding()
        series.publish_directory_atomically(
            staging, _atomic_exchange, _atomic_noreplace,
        )
    return output_dir


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scratch_dir", type=Path)
    parser.add_argument("output_dir", type=Path,
                        help="candidate directory; its full parent chain must pre-exist")
    parser.add_argument("--research-root", type=Path, default=Path("docs/research/company-benefits"))
    args = parser.parse_args(argv)
    compile_candidate(args.scratch_dir, args.output_dir, args.research_root)
    print(f"compiled candidate at {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
