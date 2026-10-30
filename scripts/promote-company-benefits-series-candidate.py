#!/usr/bin/env python3
"""Promote a protocol-4 candidate using repository-external reviews."""

import argparse
import copy
import importlib.util
import json
import os
import re
import shutil
import tempfile
from datetime import datetime
from pathlib import Path

FINAL_FILES = ("sources.jsonl", "claims.jsonl", "reviews.jsonl", "gaps.jsonl", "checks.jsonl")
REVIEW_FILES = {"review-bundle.json", "reviews.jsonl", "checks.jsonl"}
HASH = re.compile(r"^[0-9a-f]{64}$")
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _timestamp(value, label):
    try:
        result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if result.tzinfo is None:
            raise ValueError
        return result
    except ValueError as exc:
        raise ValueError(f"invalid {label} timestamp") from exc


def _external_directory(path):
    path = Path(path)
    try:
        resolved = path.resolve(strict=True)
    except OSError as exc:
        raise ValueError(f"independent review directory is invalid: {exc}") from exc
    lexical = Path(os.path.abspath(path))
    repository = REPOSITORY_ROOT.resolve()
    if path.is_symlink() or lexical.is_relative_to(repository) or resolved.is_relative_to(repository):
        raise ValueError("independent review artifacts must be repository-external and not symlink-aliased")
    return resolved


def _review_urls(kind, target, claim_map, gap_map, source_map):
    record = claim_map[target] if kind == "claim" else gap_map[target]
    source_ids = record.get("source_ids", []) + record.get("searched_source_ids", []) if kind == "claim" else record.get("searched_official_source_ids", [])
    urls = set(record.get("searched_official_urls", [])) if kind == "gap" else set()
    for source_id in source_ids:
        source = source_map.get(source_id)
        if not source or not source.get("url"):
            raise ValueError(f"{target}: unresolved source URL")
        urls.add(source["url"])
    return urls


def promote(candidate_dir, review_dir, output_dir, research_root):
    validator = _load(Path(__file__).with_name("validate-company-benefits-series-candidate.py"), "candidate_contract")
    package = validator.validate_candidate(candidate_dir, research_root)
    review_dir = _external_directory(review_dir)
    if {path.name for path in review_dir.iterdir()} != REVIEW_FILES or any(not path.is_file() for path in review_dir.iterdir()):
        raise ValueError("external review package must contain exactly review-bundle.json, reviews.jsonl, and checks.jsonl")
    try:
        bundle = json.loads((review_dir / "review-bundle.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("invalid external review bundle") from exc
    bundle_fields = {"schema_version", "candidate_manifest_sha256", "candidate_artifacts",
                     "promotion_reviewer_id", "approved_at", "artifacts"}
    if set(bundle) != bundle_fields or bundle.get("schema_version") != "1":
        raise ValueError("external review bundle schema mismatch")
    if (bundle.get("candidate_manifest_sha256") != package["manifest_sha256"]
            or bundle.get("candidate_artifacts") != package["manifest"]["artifacts"]):
        raise ValueError("external review candidate hash binding mismatch; old approval transfer is prohibited")
    reviewer = bundle.get("promotion_reviewer_id")
    if not isinstance(reviewer, str) or not reviewer.strip() or reviewer == package["manifest"]["researcher_id"]:
        raise ValueError("promotion reviewer must be identified and independent")
    approved_at = _timestamp(bundle.get("approved_at"), "approved_at")
    artifacts = bundle.get("artifacts")
    if not isinstance(artifacts, dict) or set(artifacts) != {"reviews.jsonl", "checks.jsonl"}:
        raise ValueError("external review bundle must hash exact review artifacts")
    for name in artifacts:
        if not HASH.fullmatch(str(artifacts[name])) or artifacts[name] != validator.sha256((review_dir / name).read_bytes()):
            raise ValueError(f"external review artifact hash mismatch: {name}")

    reviews = validator.read_jsonl(review_dir / "reviews.jsonl")
    checks = validator.read_jsonl(review_dir / "checks.jsonl")
    verifier = validator._load_verifier()
    claim_schema = verifier.load_schema("review.schema.json")
    outcome_schema = verifier.load_schema("outcome-review.schema.json")
    targets = [(kind, target) for kind, target, _ in package["targets"]]
    researchers = {(kind, target): researcher for kind, target, researcher in package["targets"]}
    actual_targets = []
    review_times = {}
    review_ids = set()
    errors = []
    for review in reviews:
        review_id = review.get("review_id")
        if not isinstance(review_id, str) or not review_id or review_id in review_ids:
            raise ValueError("duplicate or missing independent review_id")
        review_ids.add(review_id)
        has_claim, has_record = bool(review.get("claim_id")), bool(review.get("record_id"))
        if has_claim == has_record:
            raise ValueError("review must have exactly one claim or gap target; cross-target reviews are prohibited")
        kind, target = ("claim", review.get("claim_id")) if has_claim else ("gap", review.get("record_id"))
        actual_targets.append((kind, target))
        if (kind, target) not in researchers:
            raise ValueError(f"{review_id}: orphan independent review target")
        verifier.validate_structure(review, claim_schema if kind == "claim" else outcome_schema, review_id, errors)
        if (review.get("decision") != "approved" or review.get("researcher_id") != researchers[(kind, target)]
                or review.get("reviewer_id") == review.get("researcher_id")
                or review.get("quote_entailment_confirmed") is not True):
            raise ValueError(f"{review_id}: review must be approved, independently authored, and bind the candidate researcher")
        reviewed = _timestamp(review.get("reviewed_at"), "reviewed_at")
        if reviewed >= approved_at:
            raise ValueError(f"{review_id}: review must precede promotion approval")
        review_times[(kind, target)] = reviewed
    if actual_targets != targets or len(actual_targets) != len(set(actual_targets)):
        raise ValueError("independent review coverage must be exact one-to-one in canonical order with no missing, duplicate, or orphan targets")
    if errors:
        raise ValueError("independent review schema validation failed:\n" + "\n".join(errors))

    records = package["records"]
    source_map = {item["source_id"]: item for item in records["sources.jsonl"]}
    claim_map = {item["claim_id"]: item for item in records["claims.jsonl"]}
    gap_map = {item["audit_id"]: item for item in records["gaps.jsonl"]}
    bound_source_ids = {source_id for claim in claim_map.values()
                        for source_id in claim.get("source_ids", []) + claim.get("searched_source_ids", [])}
    bound_source_ids.update(source_id for gap in gap_map.values()
                            for source_id in gap.get("searched_official_source_ids", []))
    sources_by_url = {}
    for source_id in bound_source_ids:
        source = source_map[source_id]
        sources_by_url.setdefault(source["url"], []).append(source)
    expected_urls = set()
    latest_review = {}
    for kind, target in targets:
        for url in _review_urls(kind, target, claim_map, gap_map, source_map):
            expected_urls.add(url)
            latest_review[url] = max(latest_review.get(url, review_times[(kind, target)]), review_times[(kind, target)])
    check_urls = [check.get("url") for check in checks]
    if len(check_urls) != len(set(check_urls)) or set(check_urls) != expected_urls:
        raise ValueError("post-review checks must exactly cover every candidate source URL once")
    for check in checks:
        url = check.get("url")
        bound_sources = sources_by_url.get(url, [])
        kinds = {source.get("record_type") == "nonpublishable_metadata" for source in bound_sources}
        if len(kinds) > 1:
            raise ValueError(f"{url}: check route ambiguously mixes metadata and publishable sources")
        if True in kinds:
            expected_fields = {"url", "status", "final_url", "access_wall", "checked_at"}
            observations = {json.dumps(source["access_observation"], sort_keys=True) for source in bound_sources}
            actual = {field: check.get(field) for field in ("status", "final_url", "access_wall")}
            if set(check) != expected_fields or len(observations) != 1 or actual != bound_sources[0]["access_observation"]:
                raise ValueError(f"{url}: metadata check must exactly match the observed route failure/access semantics")
        else:
            expected_fields = {"url", "status", "final_url", "marker", "marker_confirmed", "content_sha256", "checked_at"}
            expected = {(source["http_verification"]["final_url"], source["http_verification"]["expected_marker"],
                         source["content_sha256"]) for source in bound_sources}
            if not bound_sources:
                expected = {(url, check.get("marker"), check.get("content_sha256"))}
            actual = (check.get("final_url"), check.get("marker"), check.get("content_sha256"))
            if (set(check) != expected_fields or not str(url).startswith("https://") or len(expected) != 1
                    or check.get("status") != 200 or check.get("marker_confirmed") is not True
                    or actual not in expected or not HASH.fullmatch(str(check.get("content_sha256", "")))):
                raise ValueError(f"{url}: publishable source check must be a successful exact HTTPS URL/hash/marker check")
        checked = _timestamp(check.get("checked_at"), "check checked_at")
        if checked <= latest_review[url]:
            raise ValueError(f"{url}: post-review check must follow every bound independent review")
        if checked >= approved_at:
            raise ValueError(f"{url}: post-review check must precede promotion approval")

    output_dir = Path(output_dir)
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    check_map = {check["url"]: check for check in checks}
    promoted_claims = copy.deepcopy(records["claims.jsonl"])
    for claim in promoted_claims:
        if claim.get("status") == "unknown":
            continue
        bound_checks = [check_map[source_map[source_id]["url"]] for source_id in claim.get("source_ids", [])]
        if not bound_checks:
            raise ValueError(f"{claim.get('claim_id')}: factual claim has no successful post-review source check")
        latest = max(bound_checks, key=lambda check: _timestamp(check["checked_at"], "check checked_at"))
        claim["prepublication_checked_at"] = latest["checked_at"]
    values = {
        "sources.jsonl": records["sources.jsonl"], "claims.jsonl": promoted_claims,
        "reviews.jsonl": reviews, "gaps.jsonl": records["gaps.jsonl"], "checks.jsonl": checks,
    }
    with tempfile.TemporaryDirectory(prefix="benefits-promotion-", dir=output_dir.parent) as temporary:
        staged = Path(temporary) / "package"
        staged.mkdir()
        final_hashes = {}
        for name in FINAL_FILES:
            raw = verifier.company_benefits_series.jsonl_bytes(values[name])
            (staged / name).write_bytes(raw)
            final_hashes[name] = validator.sha256(raw)
        manifest = {
            "schema_version": "1", "batch_id": package["manifest"]["batch_id"],
            "company_list_sha256": package["manifest"]["company_list_sha256"],
            "effective_sequence_sha256": package["manifest"]["effective_sequence_sha256"],
            "replacement_events_sha256": package["manifest"]["replacement_events_sha256"],
            "status": "approved", "approved_at": bundle["approved_at"], "reviewer_id": reviewer,
            "artifacts": final_hashes,
            "review_audit": {"candidate_manifest_sha256": package["manifest_sha256"],
                             "candidate_artifacts": package["manifest"]["artifacts"],
                             "review_artifacts": bundle["artifacts"]},
        }
        (staged / "batch.json").write_bytes(verifier.company_benefits_series.json_bytes(manifest))
        integrator = _load(Path(__file__).with_name("integrate-company-benefits-series-batch.py"), "candidate_promotion_integrator")
        integrator.load_package(staged, research_root)
        if output_dir.exists():
            if not output_dir.is_dir():
                raise ValueError("promotion output exists and is not a directory")
            shutil.rmtree(output_dir)
        shutil.copytree(staged, output_dir)
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("candidate_dir", type=Path)
    parser.add_argument("review_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--research-root", type=Path, default=Path("docs/research/company-benefits"))
    args = parser.parse_args(argv)
    manifest = promote(args.candidate_dir, args.review_dir, args.output_dir, args.research_root)
    print(f"promoted approved package {manifest['batch_id']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
