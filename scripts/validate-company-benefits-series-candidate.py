#!/usr/bin/env python3
"""Validate the sole protocol-4 review-pending series candidate layout."""

import argparse
import hashlib
import importlib.util
import json
import re
from pathlib import Path

CANDIDATE_FILES = ("sources.jsonl", "claims.jsonl", "gaps.jsonl", "review-requests.jsonl")
ALLOWED_FILES = {"candidate.json", *CANDIDATE_FILES}
HASH = re.compile(r"^[0-9a-f]{64}$")
REQUEST_FIELDS = {"request_id", "target_type", "target_id", "researcher_id", "status"}
GAP_FIELDS = {"audit_id", "company_id", "disposition", "reason", "searched_official_source_ids",
              "searched_official_urls", "nonabsence_wording", "researcher_id"}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def _load_verifier():
    path = Path(__file__).with_name("verify-company-benefits-ledger.py")
    spec = importlib.util.spec_from_file_location("company_benefits_candidate_verifier", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_jsonl(path):
    values = []
    for number, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{Path(path).name}:{number}: invalid JSON") from exc
        if not isinstance(value, dict):
            raise ValueError(f"{Path(path).name}:{number}: record must be an object")
        values.append(value)
    return values


def _unique(records, field, label):
    values = [record.get(field) for record in records]
    if any(not isinstance(value, str) or not value for value in values) or len(values) != len(set(values)):
        raise ValueError(f"{label} requires unique nonempty {field}; duplicate IDs are prohibited")


def _canonical_batch(root, batch_id):
    batches = read_jsonl(Path(root) / "series-batches.jsonl")
    matches = [item for item in batches if item.get("batch_id") == batch_id]
    if len(matches) != 1:
        raise ValueError("candidate batch_id must resolve exactly once in canonical series-batches.jsonl")
    return matches[0]


def _validate_sources(records, verifier):
    _unique(records, "source_id", "sources")
    metadata_schema = verifier.load_schema("nonpublishable-source.schema.json")
    publishable_schema = verifier.load_schema("source.schema.json")
    metadata_ids = set()
    errors = []
    prohibited = {"supporting_quote", "content_sha256", "hash_provenance", "expected_marker",
                  "applicable_legal_entities", "policy_owner_legal_entity", "body", "content", "raw_response",
                  "locator", "http_verification", "evidence_path", "evidence_file"}
    for source in records:
        source_id = source.get("source_id", "source[missing-id]")
        if source.get("record_type") == "nonpublishable_metadata":
            metadata_ids.add(source_id)
            leaked = sorted(set(source) & prohibited)
            if leaked:
                errors.append(f"{source_id}: metadata source contains prohibited retained/asserted fields: {', '.join(leaked)}")
            verifier.validate_structure(source, metadata_schema, source_id, errors)
            if source.get("publication_eligible") is not False or source.get("retention_mode") != "metadata_only":
                errors.append(f"{source_id}: metadata source must be nonpublishable metadata_only")
        else:
            verifier.validate_structure(source, publishable_schema, source_id, errors)
    if errors:
        raise ValueError("source schema validation failed:\n" + "\n".join(errors))
    return metadata_ids


def validate_candidate(candidate_dir, research_root):
    candidate_dir, research_root = Path(candidate_dir), Path(research_root)
    if not candidate_dir.is_dir():
        raise ValueError("candidate package directory is missing")
    actual = {path.name for path in candidate_dir.iterdir()}
    if actual != ALLOWED_FILES or any(not path.is_file() for path in candidate_dir.iterdir()):
        raise ValueError("candidate package must contain exactly candidate.json and four canonical JSONL files")
    try:
        manifest = json.loads((candidate_dir / "candidate.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("invalid candidate manifest") from exc
    fields = {"schema_version", "batch_id", "company_list_sha256", "effective_sequence_sha256",
              "replacement_events_sha256", "status", "researcher_id", "artifacts"}
    if set(manifest) != fields or manifest.get("schema_version") != "1" or manifest.get("status") != "review_pending":
        raise ValueError("candidate manifest schema mismatch; status must be review_pending")
    if not isinstance(manifest.get("researcher_id"), str) or not manifest["researcher_id"].strip():
        raise ValueError("candidate researcher_id is required")
    batch = _canonical_batch(research_root, manifest.get("batch_id"))
    for field in ("company_list_sha256", "effective_sequence_sha256", "replacement_events_sha256"):
        if not HASH.fullmatch(str(manifest.get(field, ""))) or manifest.get(field) != batch.get(field):
            raise ValueError(f"candidate strict batch hash mismatch: {field}")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, dict) or set(artifacts) != set(CANDIDATE_FILES):
        raise ValueError("candidate manifest must hash the four exact artifacts")
    records = {}
    for name in CANDIDATE_FILES:
        raw = (candidate_dir / name).read_bytes()
        if artifacts.get(name) != sha256(raw):
            raise ValueError(f"candidate artifact hash mismatch: {name}")
        records[name] = read_jsonl(candidate_dir / name)

    verifier = _load_verifier()
    metadata_ids = _validate_sources(records["sources.jsonl"], verifier)
    sources = {item["source_id"]: item for item in records["sources.jsonl"]}
    claims, gaps, requests = records["claims.jsonl"], records["gaps.jsonl"], records["review-requests.jsonl"]
    _unique(claims, "claim_id", "claims")
    _unique(gaps, "audit_id", "gaps")
    _unique(requests, "request_id", "review requests")
    company_ids = batch.get("company_ids", [])
    if len(company_ids) != 25 or len(set(company_ids)) != 25:
        raise ValueError("canonical batch must contain exactly 25 ordered company IDs")
    position = {company_id: index for index, company_id in enumerate(company_ids)}
    if claims != sorted(claims, key=lambda item: (position.get(item.get("company_id"), 10**9), item.get("claim_id", ""))):
        raise ValueError("claims are not in canonical order")
    if gaps != sorted(gaps, key=lambda item: position.get(item.get("company_id"), 10**9)):
        raise ValueError("gaps are not in canonical order")

    claim_by_company = {}
    claim_errors = []
    claim_schema = verifier.load_schema("benefit-claim.schema.json")
    for claim in claims:
        company_id, claim_id = claim.get("company_id"), claim.get("claim_id")
        if company_id not in position:
            raise ValueError(f"{claim_id}: claim company is outside canonical batch")
        if not isinstance(claim_id, str) or not claim_id.startswith(company_id + "-"):
            raise ValueError(f"{claim_id}: noncanonical claim ID")
        verifier.validate_structure(claim, claim_schema, claim_id, claim_errors)
        for source_id in claim.get("source_ids", []) + claim.get("searched_source_ids", []):
            if source_id not in sources:
                raise ValueError(f"{claim_id}: claim source does not resolve in candidate package")
            if source_id in metadata_ids:
                raise ValueError(f"{claim_id}: nonpublishable metadata cannot be a claim source")
        claim_by_company.setdefault(company_id, []).append(claim)
    if claim_errors:
        raise ValueError("claim schema validation failed:\n" + "\n".join(claim_errors))

    gap_by_company = {}
    for gap in gaps:
        company_id = gap.get("company_id")
        if set(gap) != GAP_FIELDS:
            raise ValueError(f"{gap.get('audit_id')}: gap schema mismatch")
        if company_id not in position or gap.get("audit_id") != f"company-gap::{company_id}":
            raise ValueError(f"{gap.get('audit_id')}: canonical gap ID must exactly bind company_id")
        wording = gap.get("nonabsence_wording", "")
        if gap.get("disposition") != "nonpublishable" or not any(
                phrase in wording for phrase in ("복지가 없다는 뜻이 아닙니다", "복지가 없다는 뜻이 아니다")):
            raise ValueError(f"{gap.get('audit_id')}: gap must be nonpublishable with non-absence wording")
        if gap.get("researcher_id") != manifest["researcher_id"]:
            raise ValueError(f"{gap.get('audit_id')}: gap researcher does not bind candidate researcher")
        for source_id in gap.get("searched_official_source_ids", []):
            if source_id not in sources:
                raise ValueError(f"{gap.get('audit_id')}: gap source does not resolve")
        if any(not isinstance(url, str) or not url.startswith("https://") for url in gap.get("searched_official_urls", [])):
            raise ValueError(f"{gap.get('audit_id')}: gap URL must use HTTPS")
        gap_by_company.setdefault(company_id, []).append(gap)

    targets = []
    for company_id in company_ids:
        company_claims, company_gaps = claim_by_company.get(company_id, []), gap_by_company.get(company_id, [])
        if bool(company_claims) == bool(company_gaps) or len(company_gaps) > 1:
            raise ValueError("candidate must account for all 25 companies by claims or exactly one gap")
        targets.extend(("claim", claim["claim_id"], claim.get("researcher_id", manifest["researcher_id"])) for claim in company_claims)
        targets.extend(("gap", gap["audit_id"], gap["researcher_id"]) for gap in company_gaps)
    expected_requests = [{"request_id": f"review-request::{kind}::{target}", "target_type": kind,
                          "target_id": target, "researcher_id": researcher, "status": "pending_independent_review"}
                         for kind, target, researcher in targets]
    if requests != expected_requests or any(set(request) != REQUEST_FIELDS for request in requests):
        raise ValueError("review requests require exact one pending target per outcome in canonical order; duplicate or orphan targets are prohibited")
    return {"manifest": manifest, "batch": batch, "records": records, "targets": targets,
            "manifest_sha256": sha256((candidate_dir / "candidate.json").read_bytes())}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidate_dir", type=Path)
    parser.add_argument("--research-root", type=Path, default=Path("docs/research/company-benefits"))
    args = parser.parse_args(argv)
    package = validate_candidate(args.candidate_dir, args.research_root)
    print(f"valid review-pending candidate {package['manifest']['batch_id']}: {len(package['targets'])} outcomes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
