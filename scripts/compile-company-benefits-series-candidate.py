#!/usr/bin/env python3
"""Deterministically compile scratch research into the candidate contract."""

import argparse
import importlib.util
import json
import shutil
import tempfile
from pathlib import Path

SCRATCH_FILES = {"draft.json", "sources.jsonl", "claims.jsonl", "gaps.jsonl"}


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
    if {path.name for path in scratch_dir.iterdir()} != SCRATCH_FILES or any(not path.is_file() for path in scratch_dir.iterdir()):
        raise ValueError("scratch compiler input must contain exactly draft.json, sources.jsonl, claims.jsonl, and gaps.jsonl")
    draft = json.loads((scratch_dir / "draft.json").read_text(encoding="utf-8"))
    fields = {"schema_version", "batch_id", "company_list_sha256", "effective_sequence_sha256",
              "replacement_events_sha256", "researcher_id"}
    if set(draft) != fields or draft.get("schema_version") != "1":
        raise ValueError("scratch draft manifest schema mismatch")
    batch = validator._canonical_batch(research_root, draft.get("batch_id"))
    position = {company_id: index for index, company_id in enumerate(batch["company_ids"])}
    sources = sorted(validator.read_jsonl(scratch_dir / "sources.jsonl"), key=lambda item: item.get("source_id", ""))
    claims = sorted(validator.read_jsonl(scratch_dir / "claims.jsonl"),
                    key=lambda item: (position.get(item.get("company_id"), 10**9), item.get("claim_id", "")))
    gaps = sorted(validator.read_jsonl(scratch_dir / "gaps.jsonl"),
                  key=lambda item: position.get(item.get("company_id"), 10**9))
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
               "review-requests.jsonl": requests}
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="candidate-compile-", dir=output_dir.parent) as temporary:
        staged = Path(temporary) / "candidate"
        staged.mkdir()
        artifacts = {}
        for name in validator.CANDIDATE_FILES:
            raw = validator._load_verifier().company_benefits_series.jsonl_bytes(records[name])
            (staged / name).write_bytes(raw)
            artifacts[name] = validator.sha256(raw)
        manifest = {**draft, "status": "review_pending", "artifacts": artifacts}
        (staged / "candidate.json").write_bytes(validator._load_verifier().company_benefits_series.json_bytes(manifest))
        validator.validate_candidate(staged, research_root)
        if output_dir.exists():
            shutil.rmtree(output_dir)
        shutil.copytree(staged, output_dir)
    return output_dir


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("scratch_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--research-root", type=Path, default=Path("docs/research/company-benefits"))
    args = parser.parse_args(argv)
    compile_candidate(args.scratch_dir, args.output_dir, args.research_root)
    print(f"compiled candidate at {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
