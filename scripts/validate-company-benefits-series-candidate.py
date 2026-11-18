#!/usr/bin/env python3
"""Validate the protocol-2 review-pending series candidate layout."""

import argparse
import copy
import hashlib
import importlib.util
import json
import os
import re
import stat
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
from review_metadata_validation import (
    access_observation_tuple_error,
    validate_credential_free_https,
    validate_review_metadata_observation,
)

CANDIDATE_FILES = ("sources.jsonl", "claims.jsonl", "gaps.jsonl", "review-requests.jsonl")
V2_FILES = (
    "company-category-cells.jsonl", "research-attempts.jsonl", "official-claims-v2.jsonl",
    "reference-records.jsonl", "community-benefit-reports.jsonl", "sources-v2.jsonl",
)
ALL_ARTIFACT_FILES = (*CANDIDATE_FILES, *V2_FILES)
CURRENT_FILES = ("verified-benefit-candidates.jsonl", "company-category-outcomes.jsonl")
CURRENT_ARTIFACT_FILES = (*ALL_ARTIFACT_FILES, *CURRENT_FILES)
ALLOWED_FILES = {"candidate.json", *ALL_ARTIFACT_FILES}
CURRENT_ALLOWED_FILES = {"candidate.json", *CURRENT_ARTIFACT_FILES}
HASH = re.compile(r"^[0-9a-f]{64}$")
REQUEST_FIELDS = {"request_id", "target_type", "target_id", "researcher_id", "status"}
LOCAL_ABSOLUTE_PATH = re.compile(r"^(?:\\|[A-Za-z]:[\\/]|file://)", re.IGNORECASE)
FILESYSTEM_ROOTS = {
    "applications", "bin", "boot", "dev", "etc", "home", "lib", "lib64", "media", "mnt", "opt",
    "private", "proc", "root", "run", "sbin", "srv", "sys", "system", "tmp", "users", "usr", "var",
    "volumes",
}
MAX_PERCENT_DECODE_PASSES = 5
MAX_CANDIDATE_FILE_BYTES = 64 * 1024 * 1024
# One protocol-2 candidate has 13 files; cap their retained ingress well below
# the independent 13 * per-file limit while leaving ample room for 250 cells.
MAX_CANDIDATE_TOTAL_BYTES = 128 * 1024 * 1024


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


def read_jsonl_bytes(raw, label):
    values = []
    try:
        lines = raw.decode("utf-8").splitlines()
    except UnicodeDecodeError as exc:
        raise ValueError(f"{label}: invalid UTF-8") from exc
    for number, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{label}:{number}: invalid JSON") from exc
        if not isinstance(value, dict):
            raise ValueError(f"{label}:{number}: record must be an object")
        values.append(value)
    return values


def _read_candidate_regular(candidate_dir, name, limit=None, total_budget=None):
    limit = MAX_CANDIDATE_FILE_BYTES if limit is None else limit
    directory_fd = os.open(candidate_dir, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    descriptor = None
    try:
        descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                             dir_fd=directory_fd)
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_size > limit:
            raise ValueError(f"{name}: candidate artifact must be a bounded regular file")
        if total_budget is not None and total_budget[0] + before.st_size > MAX_CANDIDATE_TOTAL_BYTES:
            raise ValueError("candidate package exceeds aggregate bounded byte limit")
        raw = b""
        while len(raw) < before.st_size:
            chunk = os.read(descriptor, min(before.st_size - len(raw), 1024 * 1024))
            if not chunk:
                raise ValueError(f"{name}: candidate artifact changed during read")
            raw += chunk
        after = os.fstat(descriptor)
        path_state = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        stable = ("st_dev", "st_ino", "st_mode", "st_size", "st_mtime_ns", "st_ctime_ns")
        if any(getattr(before, field) != getattr(after, field)
               or getattr(before, field) != getattr(path_state, field) for field in stable):
            raise ValueError(f"{name}: candidate artifact changed during read")
        if total_budget is not None:
            total_budget[0] += len(raw)
        return raw
    except OSError as exc:
        raise ValueError(f"{name}: candidate artifact is not a safe regular file") from exc
    finally:
        if descriptor is not None:
            os.close(descriptor)
        os.close(directory_fd)


def _unique(records, field, label):
    values = [record.get(field) for record in records]
    if any(not isinstance(value, str) or not value for value in values) or len(values) != len(set(values)):
        raise ValueError(f"{label} requires unique nonempty {field}; duplicate IDs are prohibited")


def _decode_percent_bounded(value):
    decoded = value
    for _ in range(MAX_PERCENT_DECODE_PASSES):
        try:
            expanded = unquote(decoded, errors="strict")
        except UnicodeDecodeError:
            return None
        if expanded == decoded:
            return decoded
        decoded = expanded
    try:
        return decoded if unquote(decoded, errors="strict") == decoded else None
    except UnicodeDecodeError:
        return None


def _unsafe_url_component(value):
    for candidate in re.split(r"[&;=]", value):
        if not candidate:
            continue
        if LOCAL_ABSOLUTE_PATH.match(candidate) or candidate.startswith("//") or "\\" in candidate:
            return True
        segments = [segment for segment in re.split(r"[\\/]", candidate) if segment]
        if (candidate.startswith("/") and not segments) or ".." in segments:
            return True
        if segments and segments[0].casefold() in FILESYSTEM_ROOTS:
            return True
    return False


def _unsafe_root_relative_path(value):
    stripped = value.lstrip()
    token = re.split(r"[\s)\]]", stripped, maxsplit=1)[0]
    decoded = _decode_percent_bounded(token)
    if decoded is None:
        return True
    if LOCAL_ABSOLUTE_PATH.match(decoded):
        return True
    if not decoded.startswith("/"):
        return False
    if any(ord(char) < 32 or 127 <= ord(char) <= 159 for char in decoded):
        return True
    try:
        parsed = urlsplit(decoded)
    except ValueError:
        return True
    if parsed.scheme or parsed.netloc or "\\" in parsed.path or ":" in parsed.path:
        return True
    segments = parsed.path.split("/")[1:]
    if ".." in segments or _unsafe_url_component(parsed.query) or _unsafe_url_component(parsed.fragment):
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
        if source.get("record_type") == "nonpublishable_metadata":
            metadata_ids.add(source_id)
            leaked = sorted(set(source) & prohibited)
            if leaked:
                errors.append(f"{source_id}: metadata source contains prohibited retained/asserted fields: {', '.join(leaked)}")
            verifier.validate_structure(source, metadata_schema, source_id, errors)
            observation = source.get("access_observation", {})
            try:
                validate_review_metadata_observation(
                    source.get("url"), observation, label=f"{source_id}: candidate source",
                )
            except ValueError as exc:
                errors.append(str(exc))
            if source.get("publication_eligible") is not False or source.get("retention_mode") != "metadata_only":
                errors.append(f"{source_id}: metadata source must be nonpublishable metadata_only")
        else:
            try:
                validate_credential_free_https(
                    source.get("url"), f"{source_id}: candidate source URL",
                )
                validate_credential_free_https(
                    source.get("http_verification", {}).get("final_url"),
                    f"{source_id}: candidate source final URL",
                )
            except ValueError as exc:
                errors.append(str(exc))
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


PROPOSITION_CANDIDATE_INPUT_FIELDS = _load_verifier().company_benefits_series.VERIFIED_BENEFIT_CANDIDATE_INPUT_FIELDS
PROPOSITION_CANDIDATE_FIELDS = _load_verifier().company_benefits_series.VERIFIED_BENEFIT_CANDIDATE_FIELDS
OUTCOME_REASONS = {
    "verified_benefit", "not_publicly_verifiable", "research_incomplete",
    "source_access_failed", "conflicting_evidence", "not_researched",
}


def validate_proposition_candidates(candidates, evidence_records, batch):
    """Canonicalize unapproved atomic propositions using the Task 5 hash contract."""
    if not isinstance(candidates, list):
        raise ValueError("verified benefit candidates must be an array")
    contract = _load_verifier().company_benefits_series
    company_ids = batch.get("company_ids", [])
    evidence = {}
    for record in evidence_records:
        if not isinstance(record, dict):
            raise ValueError("proposition evidence records must be objects")
        record_id = next((record.get(field) for field in (
            "claim_id", "reference_id", "community_report_id"
        ) if field in record), None)
        if not isinstance(record_id, str) or not record_id or record_id in evidence:
            raise ValueError("proposition evidence IDs must be unique and nonempty")
        evidence[record_id] = record
    result = []
    logical = set()
    identifiers = set()
    for supplied in candidates:
        contract.validate_verified_benefit_candidate_shape(supplied)
        if "review" in supplied:
            raise ValueError("candidate compiler cannot self-approve a verified benefit")
        benefit = dict(supplied)
        company_id, category_id = benefit.get("company_id"), benefit.get("primary_category_id")
        if company_id not in company_ids or category_id not in contract.V2_CATEGORIES:
            raise ValueError("verified benefit candidate company/category binding mismatch")
        evidence_ids = benefit.get("evidence_ids")
        if (not isinstance(evidence_ids, list) or not evidence_ids
                or len(evidence_ids) != len(set(evidence_ids))):
            raise ValueError("verified benefit candidate requires unique evidence IDs")
        for evidence_id in evidence_ids:
            record = evidence.get(evidence_id)
            if (record is None or record.get("company_id") != company_id
                    or record.get("category_id") != category_id):
                raise ValueError("verified benefit candidate evidence binding mismatch")
        payload = contract._verified_benefit_proposition_payload(benefit)
        proposition_sha256 = sha256(contract._canonical_json_bytes(payload))
        expected_id = f"benefit::{proposition_sha256}"
        if ("proposition_sha256" in benefit and benefit["proposition_sha256"] != proposition_sha256) or (
                "benefit_id" in benefit and benefit["benefit_id"] != expected_id):
            raise ValueError("verified benefit candidate ID/fingerprint mismatch")
        benefit["proposition_sha256"] = proposition_sha256
        benefit["benefit_id"] = expected_id
        key = contract._canonical_json_bytes({
            "company_id": company_id, "title": payload["title"],
            "description": payload["description"], "scope": payload["scope"],
        })
        if expected_id in identifiers or key in logical:
            raise ValueError("duplicate verified benefit candidate proposition")
        identifiers.add(expected_id)
        logical.add(key)
        result.append(benefit)
    return sorted(result, key=lambda item: item["benefit_id"])


def compile_cell_outcomes(cells, attempts, proposition_candidates):
    """Materialize one truthful outcome reason for every canonical research cell."""
    return _load_verifier().company_benefits_series.compile_cell_outcomes(
        cells, attempts, proposition_candidates, expected_count=250
    )


def validate_candidate(candidate_dir, research_root):
    candidate_dir, research_root = Path(candidate_dir), Path(research_root)
    if _has_symlink_component(candidate_dir) or not candidate_dir.is_dir():
        raise ValueError("candidate package directory is missing or symlink-aliased")
    actual = {path.name for path in candidate_dir.iterdir()}
    current_format = actual == CURRENT_ALLOWED_FILES
    if actual not in (ALLOWED_FILES, CURRENT_ALLOWED_FILES) or any(
        path.is_symlink() or not path.is_file() for path in candidate_dir.iterdir()
    ):
        raise ValueError(
            "candidate package must contain exactly one legacy/current canonical regular-file set; symlinks are prohibited"
        )
    _validate_package_modes(candidate_dir)
    total_budget = [0]
    try:
        manifest_raw = _read_candidate_regular(
            candidate_dir, "candidate.json", total_budget=total_budget,
        )
        manifest = json.loads(manifest_raw)
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("invalid candidate manifest") from exc
    fields = {"schema_version", "batch_id", "company_list_sha256", "effective_sequence_sha256",
              "replacement_events_sha256", "status", "researcher_id", "artifacts"}
    expected_version = "2" if current_format else "1"
    if set(manifest) != fields or manifest.get("schema_version") != expected_version or manifest.get("status") != "review_pending":
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
    expected_artifacts = CURRENT_ARTIFACT_FILES if current_format else ALL_ARTIFACT_FILES
    if not isinstance(artifacts, dict) or set(artifacts) != set(expected_artifacts):
        raise ValueError("candidate manifest must hash the exact format-specific artifacts")
    records = {}
    artifact_raw = {}
    for name in expected_artifacts:
        raw = _read_candidate_regular(candidate_dir, name, total_budget=total_budget)
        artifact_raw[name] = raw
        if artifacts.get(name) != sha256(raw):
            raise ValueError(f"candidate artifact hash mismatch: {name}")
        records[name] = read_jsonl_bytes(raw, name)
        _reject_local_absolute_paths(records[name], name)

    verifier = _load_verifier()
    contract = verifier.company_benefits_series
    v2_records = {
        ledger: records[filename]
        for ledger, filename in verifier.company_benefits_series.V2_LEDGER_FILES.items()
    }
    verifier.company_benefits_series.validate_v2_package_records(
        v2_records, batch, research_root, prepromotion=True
    )
    proposition_candidates = []
    cell_outcomes = []
    if current_format:
        evidence_records = [
            *records["official-claims-v2.jsonl"], *records["reference-records.jsonl"],
            *records["community-benefit-reports.jsonl"],
        ]
        proposition_candidates = validate_proposition_candidates(
            records["verified-benefit-candidates.jsonl"], evidence_records, batch
        )
        if proposition_candidates != records["verified-benefit-candidates.jsonl"]:
            raise ValueError("verified benefit candidates are not in canonical identity order")
        cell_outcomes = compile_cell_outcomes(
            records["company-category-cells.jsonl"], records["research-attempts.jsonl"],
            proposition_candidates,
        )
        if cell_outcomes != records["company-category-outcomes.jsonl"]:
            raise ValueError("cell outcomes do not exactly match the canonical 250-cell package")
    legacy_sources = verifier.company_benefits_series.frozen_source_records(research_root)
    for raw in artifact_raw["sources.jsonl"].splitlines(keepends=True):
        if raw.strip():
            source_id = json.loads(raw).get("source_id")
            if source_id in legacy_sources and raw != legacy_sources[source_id]:
                raise ValueError(f"{source_id}: frozen legacy source bytes differ")
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
    gap_schema = verifier.load_schema("company-gap.schema.json")
    gap_errors = []
    candidate_gap_raw = contract.jsonl_raw_record_map(candidate_dir / "gaps.jsonl", "audit_id")
    frozen_gap_raw = contract.jsonl_raw_record_map(research_root / "series-research-gaps.jsonl", "audit_id")
    for gap in gaps:
        company_id = gap.get("company_id")
        verifier.validate_structure(gap, gap_schema, gap.get("audit_id", "gap[missing-id]"), gap_errors)
        contract.validate_v2_gap_id(
            gap, batch, raw_record=candidate_gap_raw.get(gap.get("audit_id")),
            frozen_legacy_records=frozen_gap_raw,
        )
        wording = gap.get("nonabsence_wording", "")
        if gap.get("disposition") != "nonpublishable" or not any(
                phrase in wording for phrase in ("복지가 없다는 뜻이 아닙니다", "복지가 없다는 뜻이 아니다")):
            raise ValueError(f"{gap.get('audit_id')}: gap must be nonpublishable with non-absence wording")
        if gap.get("researcher_id") != manifest["researcher_id"]:
            raise ValueError(f"{gap.get('audit_id')}: gap researcher does not bind candidate researcher")
        verifier.company_benefits_series.validate_gap_source_routes(gap, sources)
        gap_by_company.setdefault(company_id, []).append(gap)
    if gap_errors:
        raise ValueError("gap schema validation failed:\n" + "\n".join(gap_errors))

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
            "current_format": current_format, "proposition_candidates": proposition_candidates,
            "cell_outcomes": cell_outcomes,
            "legacy_sources": legacy_sources,
            "manifest_sha256": sha256(manifest_raw)}


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
