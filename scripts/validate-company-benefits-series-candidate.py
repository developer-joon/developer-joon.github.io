#!/usr/bin/env python3
"""Validate the sole protocol-4 review-pending series candidate layout."""

import argparse
import copy
import hashlib
import importlib.util
import json
import re
import stat
import sys
from pathlib import Path
from urllib.parse import unquote

CANDIDATE_FILES = ("sources.jsonl", "claims.jsonl", "gaps.jsonl", "review-requests.jsonl")
V2_FILES = (
    "company-category-cells.jsonl", "research-attempts.jsonl", "official-claims-v2.jsonl",
    "reference-records.jsonl", "community-benefit-reports.jsonl", "sources-v2.jsonl",
)
ALL_ARTIFACT_FILES = (*CANDIDATE_FILES, *V2_FILES)
ALLOWED_FILES = {"candidate.json", *ALL_ARTIFACT_FILES}
HASH = re.compile(r"^[0-9a-f]{64}$")
REQUEST_FIELDS = {"request_id", "target_type", "target_id", "researcher_id", "status"}
GAP_FIELDS = {"audit_id", "company_id", "disposition", "reason", "searched_official_source_ids",
              "searched_official_urls", "nonabsence_wording", "researcher_id"}
LOCAL_ABSOLUTE_PATH = re.compile(r"^(?:\\|[A-Za-z]:[\\/]|file://)", re.IGNORECASE)
FILESYSTEM_ROOTS = {
    "bin", "boot", "dev", "etc", "home", "lib", "lib64", "media", "mnt", "opt",
    "private", "proc", "root", "run", "sbin", "srv", "sys", "tmp", "users", "usr", "var",
}


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


def _unsafe_root_relative_path(value):
    if not value.startswith("/"):
        return False
    if any(ord(char) < 32 or 127 <= ord(char) <= 159 for char in value):
        return True
    decoded = re.split(r"[\s)\]]", value, maxsplit=1)[0]
    while True:
        try:
            expanded = unquote(decoded, errors="strict")
        except UnicodeDecodeError:
            return True
        if expanded == decoded:
            break
        decoded = expanded
    if decoded.startswith("//") or "\\" in decoded or ":" in decoded:
        return True
    if any(ord(char) < 32 or 127 <= ord(char) <= 159 for char in decoded):
        return True
    segments = decoded.split("/")[1:]
    if ".." in segments:
        return True
    normalized = [segment for segment in segments if segment not in ("", ".")]
    return not normalized or normalized[0].casefold() in FILESYSTEM_ROOTS


def _reject_local_absolute_paths(value, location="package"):
    if isinstance(value, str) and (
        LOCAL_ABSOLUTE_PATH.match(value) or _unsafe_root_relative_path(value)
    ):
        raise ValueError(f"{location}: local absolute path is prohibited")
    if isinstance(value, dict):
        for key, child in value.items():
            _reject_local_absolute_paths(child, f"{location}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _reject_local_absolute_paths(child, f"{location}[{index}]")


def _validate_package_modes(candidate_dir):
    if stat.S_IMODE(candidate_dir.stat().st_mode) != 0o755:
        raise ValueError("candidate directory permissions must use canonical mode 0755")
    for path in candidate_dir.iterdir():
        if stat.S_IMODE(path.stat().st_mode) != 0o644:
            raise ValueError(
                f"candidate file permissions must use canonical mode 0644: {path.name}"
            )


def _has_symlink_component(path):
    absolute = path.absolute()
    return any(component.is_symlink() for component in (absolute, *absolute.parents))


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
        if not isinstance(source.get("url"), str) or not source["url"].startswith("https://"):
            errors.append(f"{source_id}: candidate source URL must use HTTPS")
        if source.get("record_type") == "nonpublishable_metadata":
            metadata_ids.add(source_id)
            leaked = sorted(set(source) & prohibited)
            if leaked:
                errors.append(f"{source_id}: metadata source contains prohibited retained/asserted fields: {', '.join(leaked)}")
            verifier.validate_structure(source, metadata_schema, source_id, errors)
            observation = source.get("access_observation", {})
            if observation.get("status") is None and observation.get("final_url") is not None:
                errors.append(f"{source_id}: network failure final URL must be null")
            if source.get("publication_eligible") is not False or source.get("retention_mode") != "metadata_only":
                errors.append(f"{source_id}: metadata source must be nonpublishable metadata_only")
        else:
            if source.get("hash_provenance") == "retained_file":
                errors.append(f"{source_id}: retained_file provenance cannot be integrated and is prohibited in candidates")
            verifier.validate_structure(source, publishable_schema, source_id, errors)
    if errors:
        raise ValueError("source schema validation failed:\n" + "\n".join(errors))
    return metadata_ids


def _candidate_claim_schema(verifier):
    """Derive the immutable review input schema from the final claim schema."""
    schema = copy.deepcopy(verifier.load_schema("benefit-claim.schema.json"))
    schema["properties"].pop("prepublication_checked_at", None)
    for condition in schema.get("allOf", []):
        required = condition.get("then", {}).get("required", [])
        condition.get("then", {})["required"] = [field for field in required if field != "prepublication_checked_at"]
    return schema


def validate_candidate(candidate_dir, research_root):
    candidate_dir, research_root = Path(candidate_dir), Path(research_root)
    if _has_symlink_component(candidate_dir) or not candidate_dir.is_dir():
        raise ValueError("candidate package directory is missing or symlink-aliased")
    actual = {path.name for path in candidate_dir.iterdir()}
    if actual != ALLOWED_FILES or any(
        path.is_symlink() or not path.is_file() for path in candidate_dir.iterdir()
    ):
        raise ValueError(
            "candidate package must contain exactly candidate.json and ten canonical regular files; symlinks are prohibited"
        )
    _validate_package_modes(candidate_dir)
    try:
        manifest_raw = (candidate_dir / "candidate.json").read_bytes()
        manifest = json.loads(manifest_raw)
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("invalid candidate manifest") from exc
    fields = {"schema_version", "batch_id", "company_list_sha256", "effective_sequence_sha256",
              "replacement_events_sha256", "status", "researcher_id", "artifacts"}
    if set(manifest) != fields or manifest.get("schema_version") != "1" or manifest.get("status") != "review_pending":
        raise ValueError("candidate manifest schema mismatch; status must be review_pending")
    canonical_manifest = json.dumps(manifest, ensure_ascii=False, separators=(",", ":"),
                                    allow_nan=False).encode("utf-8")
    if manifest_raw != canonical_manifest:
        raise ValueError("candidate manifest must use canonical JSON bytes")
    if not isinstance(manifest.get("researcher_id"), str) or not manifest["researcher_id"].strip():
        raise ValueError("candidate researcher_id is required")
    _reject_local_absolute_paths(manifest, "candidate.json")
    batch = _canonical_batch(research_root, manifest.get("batch_id"))
    for field in ("company_list_sha256", "effective_sequence_sha256", "replacement_events_sha256"):
        if not HASH.fullmatch(str(manifest.get(field, ""))) or manifest.get(field) != batch.get(field):
            raise ValueError(f"candidate strict batch hash mismatch: {field}")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, dict) or set(artifacts) != set(ALL_ARTIFACT_FILES):
        raise ValueError("candidate manifest must hash the ten exact v1/v2 artifacts")
    records = {}
    for name in ALL_ARTIFACT_FILES:
        raw = (candidate_dir / name).read_bytes()
        if artifacts.get(name) != sha256(raw):
            raise ValueError(f"candidate artifact hash mismatch: {name}")
        records[name] = read_jsonl(candidate_dir / name)
        _reject_local_absolute_paths(records[name], name)

    verifier = _load_verifier()
    v2_records = {
        ledger: records[filename]
        for ledger, filename in verifier.company_benefits_series.V2_LEDGER_FILES.items()
    }
    verifier.company_benefits_series.validate_v2_package_records(
        v2_records, batch, research_root, prepromotion=True
    )
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
    claim_schema = _candidate_claim_schema(verifier)
    for claim in claims:
        company_id, claim_id = claim.get("company_id"), claim.get("claim_id")
        if company_id not in position:
            raise ValueError(f"{claim_id}: claim company is outside canonical batch")
        if not isinstance(claim_id, str) or not claim_id.startswith(company_id + "-"):
            raise ValueError(f"{claim_id}: noncanonical claim ID")
        if "prepublication_checked_at" in claim:
            raise ValueError(f"{claim_id}: candidate cannot assert post-review prepublication gate state")
        verifier.validate_structure(claim, claim_schema, claim_id, claim_errors)
        evidence_source_ids = {
            evidence.get("source_id")
            for field in ("source_evidence", "conflict_evidence")
            for evidence in claim.get(field, [])
            if isinstance(evidence, dict) and isinstance(evidence.get("source_id"), str)
        }
        claim_source_ids = claim.get("source_ids", [])
        if claim.get("status") != "unknown" and (
            set(claim_source_ids) != evidence_source_ids
            or len(claim_source_ids) != len(set(claim_source_ids))
        ):
            raise ValueError(
                f"{claim_id}: source_ids must exactly match source_evidence source closure"
            )
        for source_id in claim.get("source_ids", []) + claim.get("searched_source_ids", []):
            if source_id not in sources:
                raise ValueError(f"{claim_id}: claim source does not resolve in candidate package")
            if source_id in metadata_ids:
                raise ValueError(f"{claim_id}: nonpublishable metadata cannot be a claim source")
        normalized_claim_sources = [source_id for source_id in claim.get("source_ids", [])
                                    if sources[source_id].get("hash_provenance") == verifier.company_benefits_series.IDENTITY_PROVENANCE]
        if normalized_claim_sources:
            raise ValueError(f"{claim_id}: official identity projections cannot support benefit claim prose")
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
        verifier.company_benefits_series.validate_gap_source_routes(gap, sources)
        gap_by_company.setdefault(company_id, []).append(gap)

    referenced_source_ids = {source_id for claim in claims
                             for source_id in claim.get("source_ids", []) + claim.get("searched_source_ids", [])}
    referenced_source_ids.update(source_id for gap in gaps for source_id in gap.get("searched_official_source_ids", []))
    if referenced_source_ids != set(sources):
        raise ValueError("candidate sources must be referenced exactly by claim/gap source_id bindings; orphan sources are prohibited")

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
    try:
        package = validate_candidate(args.candidate_dir, args.research_root)
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"candidate validation failed: {exc}", file=sys.stderr)
        return 1
    print(f"valid review-pending candidate {package['manifest']['batch_id']}: {len(package['targets'])} outcomes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
