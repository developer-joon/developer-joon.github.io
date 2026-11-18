#!/usr/bin/env python3
"""External protocol-2 assignment ledger and neutral scratch-input compiler."""

from __future__ import annotations

import argparse
import ctypes
import fcntl
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Mapping, Sequence, cast

try:
    from scripts import company_benefits_series as series
except ImportError:  # direct script execution
    import company_benefits_series as series

CATEGORIES = series.V2_CATEGORIES

STAGES = (
    "canonical_assignment", "acquisition_shard", "identity_audit",
    "neutral_aggregate", "candidate", "review", "promotion",
)
SCRATCH_JSONL = (
    "sources.jsonl", "claims.jsonl", "gaps.jsonl",
    "company-category-cells.jsonl", "research-attempts.jsonl",
    "official-claims-v2.jsonl", "reference-records.jsonl",
    "community-benefit-reports.jsonl", "sources-v2.jsonl",
    "verified-benefit-candidates.jsonl",
)
SCRATCH_FILES = ("draft.json", *SCRATCH_JSONL)
UNRESOLVED = {"research_incomplete", "source_access_failed", "conflicting_evidence", "not_researched"}
DECISIONS = {"evidence_candidate", "no_public_info", *UNRESOLVED}
CELL_STATE_DECISIONS = {
    "official_verified": "evidence_candidate",
    "reference": "evidence_candidate",
    "community_report": "evidence_candidate",
    "no_public_info": "no_public_info",
    "research_incomplete": "research_incomplete",
    "source_access_failed": "source_access_failed",
    "conflicting_evidence": "conflicting_evidence",
    "not_researched": "not_researched",
}
TERMINAL_EMPTY_RESULTS = {"no_result", "ineligible_source"}
MAX_INPUT_BYTES = 16 * 1024 * 1024
MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
# Protocol 2 fixes one 25-company/250-cell batch and at most three canonical
# routes per cell. Each route has exactly one source/attempt/capture chain.
PROTOCOL_2_MAX_ARTIFACTS = 25 * len(CATEGORIES) * 3 * 3
# Retained evidence may be larger than the 128 MiB compiled candidate, but one
# batch must remain practical to inspect. This allows 1 MiB per cell in total.
PROTOCOL_2_MAX_AGGREGATE_ARTIFACT_BYTES = 256 * 1024 * 1024
HASH = re.compile(r"[0-9a-f]{64}")
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")



def canonical_bytes(value: object) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def content_digest(value: Mapping[str, object], field: str) -> str:
    return sha256(canonical_bytes({key: item for key, item in value.items() if key != field}))


def _validate_root(root: Path) -> Path:
    root = Path(root)
    try:
        info = root.lstat()
    except FileNotFoundError as exc:
        raise ValueError("external root must be a pre-existing real directory") from exc
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        raise ValueError("external root must be a pre-existing real directory, not a symlink")
    if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise ValueError("external root must be owned by the effective user and private")
    return root.resolve(strict=True)


def _bounded_regular(path: Path, maximum: int = MAX_INPUT_BYTES) -> bytes:
    path = Path(path)
    try:
        before = path.lstat()
    except OSError as exc:
        raise ValueError(f"input must be a no-follow regular file: {path}") from exc
    if stat.S_ISLNK(before.st_mode) or not stat.S_ISREG(before.st_mode):
        raise ValueError(f"input must be a no-follow regular file: {path}")
    try:
        fd = os.open(path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError as exc:
        raise ValueError(f"input must be a no-follow regular file: {path}") from exc
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise ValueError(f"input must be a regular file: {path}")
        if info.st_size > maximum:
            raise ValueError(f"input is too large: {path}")
        raw = b""
        while len(raw) <= maximum:
            part = os.read(fd, min(1024 * 1024, maximum + 1 - len(raw)))
            if not part:
                break
            raw += part
        if len(raw) > maximum:
            raise ValueError(f"input is too large: {path}")
        return raw
    finally:
        os.close(fd)


def _root_relative_parts(root: Path, path: Path | str) -> tuple[str, ...]:
    """Return a lexical path below root without resolving symlinks."""
    candidate = Path(path)
    if candidate.is_absolute():
        try:
            candidate = candidate.relative_to(root)
        except ValueError as exc:
            raise ValueError("input path must remain below the external root") from exc
    parts = candidate.parts
    if not parts or any(part in {"", ".", ".."} for part in parts):
        raise ValueError("input path must be a clean external-root-relative path")
    return parts


def _bounded_root_regular(
    root: Path, path: Path | str, maximum: int = MAX_INPUT_BYTES,
) -> bytes:
    """Open every path component descriptor-relatively with no symlink following."""
    parts = _root_relative_parts(root, path)
    directory_flags = os.O_RDONLY | os.O_CLOEXEC | os.O_DIRECTORY | os.O_NOFOLLOW
    opened = [os.open(root, directory_flags)]
    try:
        for part in parts[:-1]:
            opened.append(os.open(part, directory_flags, dir_fd=opened[-1]))
        flags = os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK
        fd = os.open(parts[-1], flags, dir_fd=opened[-1])
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode):
                raise ValueError(f"input must be a no-follow regular file: {path}")
            if info.st_size > maximum:
                raise ValueError(f"input is too large: {path}")
            chunks = []
            remaining = maximum + 1
            while remaining:
                chunk = os.read(fd, min(1024 * 1024, remaining))
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            raw = b"".join(chunks)
            if len(raw) > maximum or len(raw) != info.st_size:
                raise ValueError(f"input is too large or changed while reading: {path}")
            return raw
        finally:
            os.close(fd)
    except OSError as exc:
        raise ValueError(f"input must be a descriptor-relative no-follow regular file: {path}") from exc
    finally:
        for descriptor in reversed(opened):
            os.close(descriptor)


def _json_under_root(root: Path, path: Path | str, maximum: int = MAX_INPUT_BYTES) -> dict[str, object]:
    try:
        value = json.loads(_bounded_root_regular(root, path, maximum))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid JSON input: {path}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"JSON input must be an object: {path}")
    return value


def _json(path: Path, maximum: int = MAX_INPUT_BYTES) -> dict[str, object]:
    try:
        value = json.loads(_bounded_regular(path, maximum))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid JSON input: {path}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"JSON input must be an object: {path}")
    return value


def _jsonl(path: Path) -> list[dict[str, object]]:
    raw = _bounded_regular(path)
    rows = []
    try:
        for line in raw.splitlines():
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError("row is not an object")
            rows.append(value)
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise ValueError(f"invalid JSONL input: {path}") from exc
    return rows


def _timestamp(value: object, label: str = "timestamp"):
    """Parse time with the production canonical RFC3339 contract."""
    return series.parse_canonical_rfc3339(value, label)


def _identifier(value: object, label: str) -> str:
    if not isinstance(value, str) or IDENTIFIER.fullmatch(value) is None:
        raise ValueError(f"{label} is invalid")
    return value


def _string_identifiers(value: object, label: str) -> list[str]:
    if (not isinstance(value, list)
            or any(not isinstance(item, str) or not item for item in value)):
        raise ValueError(f"{label} must be a list of nonempty strings")
    return cast(list[str], value)


def _atomic_create(path: Path, raw: bytes, mode: int = 0o600) -> None:
    path = Path(path)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC | os.O_NOFOLLOW
    try:
        fd = os.open(path, flags, mode)
    except FileExistsError:
        raise
    try:
        view = memoryview(raw)
        while view:
            written = os.write(fd, view)
            view = view[written:]
        os.fsync(fd)
    finally:
        os.close(fd)


def _rename_directory_noreplace(source: Path, target: Path) -> None:
    """Publish a completed directory without a check/rename overwrite race."""
    libc = ctypes.CDLL(None, use_errno=True)
    renameat2 = getattr(libc, "renameat2", None)
    if renameat2 is None:
        raise RuntimeError("atomic no-overwrite publication requires Linux renameat2")
    renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    renameat2.restype = ctypes.c_int
    at_fdcwd = -100
    if renameat2(at_fdcwd, os.fsencode(source), at_fdcwd, os.fsencode(target), 1) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), target)


def _assignment_path(root: Path, assignment_id: str) -> Path:
    return root / f"{assignment_id}.assignment.json"


def _validate_assignment(assignment: Mapping[str, object]) -> None:
    claimed = assignment.get("assignment_sha256")
    if not isinstance(claimed, str) or claimed != content_digest(assignment, "assignment_sha256"):
        raise ValueError("assignment manifest digest mismatch")
    if assignment.get("assignment_version") != 1:
        raise ValueError("assignment version is invalid")
    _identifier(assignment.get("assignment_id"), "assignment_id")
    _identifier(assignment.get("batch_id"), "batch_id")
    _timestamp(assignment.get("created_at"))
    for field in ("company_list_sha256", "effective_sequence_sha256",
                  "replacement_events_sha256", "canonical_batch_sha256"):
        value = assignment.get(field)
        if not isinstance(value, str) or HASH.fullmatch(value) is None:
            raise ValueError(f"assignment {field} is invalid")
    companies = _string_identifiers(assignment.get("company_ids"), "assignment company IDs")
    cells = assignment.get("cell_ids")
    lanes = assignment.get("lanes")
    if len(companies) != 25:
        raise ValueError("assignment company IDs must be exactly 25 nonempty strings")
    if len(set(companies)) != 25:
        raise ValueError("assignment requires exactly 25 unique companies")
    authorities = assignment.get("authorities")
    if not isinstance(authorities, list) or len(authorities) != 25:
        raise ValueError("assignment requires exactly 25 canonical authorities")
    authority_ids = []
    for authority in authorities:
        if not isinstance(authority, dict) or set(authority) != {
            "company_id", "legal_name", "jurisdiction", "registry_id",
        }:
            raise ValueError("assignment authority shape is invalid")
        if any(not isinstance(authority[field], str) or not authority[field]
               for field in authority):
            raise ValueError("assignment authority is incomplete")
        if re.fullmatch(r"[A-Z]{2}", authority["jurisdiction"]) is None:
            raise ValueError("assignment authority jurisdiction is invalid")
        authority_ids.append(authority["company_id"])
    if authority_ids != companies:
        raise ValueError("assignment authorities do not match canonical company order")
    expected = [f"cell::{company_id}::{category}" for company_id in companies for category in CATEGORIES]
    if cells != expected:
        raise ValueError("assignment requires the exact canonical 250 cell IDs")
    if not isinstance(lanes, list) or len(lanes) != 6:
        raise ValueError("assignment requires exactly six lanes")
    flattened = []
    for index, lane in enumerate(lanes, 1):
        if not isinstance(lane, dict) or lane.get("lane_id") != f"acquisition-{index:02d}":
            raise ValueError("assignment lane identity is invalid")
        lane_cells = lane.get("cell_ids")
        if not isinstance(lane_cells, list):
            raise ValueError("assignment lane cells are invalid")
        flattened.extend(lane_cells)
    if flattened != expected or len(set(flattened)) != 250:
        raise ValueError("assignment lanes must be an exact disjoint union")
    supersedes = assignment.get("supersedes_assignment_sha256")
    if supersedes is not None and (
        not isinstance(supersedes, str) or HASH.fullmatch(supersedes) is None
    ):
        raise ValueError("assignment supersession digest is invalid")


def create_assignment(
    external_root: Path, series_batches: Path, companies_path: Path,
    batch_id: str, assignment_id: str, created_at: str, *, supersedes: str | None = None,
) -> dict[str, object]:
    root = _validate_root(external_root)
    assignment_id = _identifier(assignment_id, "assignment_id")
    _timestamp(created_at)
    batches = [item for item in _jsonl(series_batches) if item.get("batch_id") == batch_id]
    if len(batches) != 1:
        raise ValueError("batch_id must resolve exactly once in canonical series-batches")
    batch = batches[0]
    company_ids = _string_identifiers(batch.get("company_ids"), "canonical batch company IDs")
    if len(company_ids) != 25 or len(set(company_ids)) != 25:
        raise ValueError("canonical batch must contain exactly 25 unique companies")
    companies = _jsonl(companies_path)
    ledger_ids = _string_identifiers(
        [item.get("company_id") for item in companies], "canonical company ledger IDs",
    )
    by_id = dict(zip(ledger_ids, companies))
    if len(by_id) != len(companies) or any(company_id not in by_id for company_id in company_ids):
        raise ValueError("canonical company identities are missing or duplicated")
    authorities = []
    for company_id in company_ids:
        company = by_id[company_id]
        fields = {name: company.get(name) for name in ("company_id", "legal_name", "jurisdiction", "registry_id")}
        if any(not isinstance(value, str) or not value for value in fields.values()):
            raise ValueError("canonical legal identity or jurisdiction is incomplete")
        authorities.append(fields)
    canonical_bindings = {
        "batch_id": batch_id,
        "company_list_sha256": batch.get("company_list_sha256"),
        "effective_sequence_sha256": batch.get("effective_sequence_sha256"),
        "replacement_events_sha256": batch.get("replacement_events_sha256"),
        "canonical_batch_sha256": sha256(canonical_bytes(batch)),
        "company_ids": company_ids,
        "authorities": authorities,
    }
    if supersedes is not None:
        if HASH.fullmatch(supersedes) is None:
            raise ValueError("supersession digest is malformed")
        predecessors = []
        with os.scandir(root) as entries:
            for entry in entries:
                if not entry.name.endswith(".assignment.json"):
                    continue
                try:
                    prior = _json_under_root(root, entry.name)
                    _validate_assignment(prior)
                except ValueError as exc:
                    raise ValueError(f"predecessor assignment is invalid: {entry.name}") from exc
                if prior.get("assignment_sha256") == supersedes:
                    predecessors.append(prior)
        if len(predecessors) != 1 or predecessors[0].get("batch_id") != batch_id:
            raise ValueError("superseded assignment must resolve once for the same batch")
        if any(predecessors[0].get(field) != value
               for field, value in canonical_bindings.items()):
            raise ValueError(
                "predecessor assignment authorities or canonical ledger hashes mismatch"
            )
    cells = [f"cell::{company_id}::{category}" for company_id in company_ids for category in CATEGORIES]
    sizes = (42, 42, 42, 42, 41, 41)
    lanes = []
    offset = 0
    for index, size in enumerate(sizes, 1):
        lanes.append({"lane_id": f"acquisition-{index:02d}", "cell_ids": cells[offset:offset + size]})
        offset += size
    assignment: dict[str, object] = {
        "assignment_version": 1, "assignment_id": assignment_id, "batch_id": batch_id,
        "created_at": created_at, **canonical_bindings,
        "cell_ids": cells,
        "lanes": lanes,
    }
    if supersedes is not None:
        assignment["supersedes_assignment_sha256"] = supersedes
    assignment["assignment_sha256"] = content_digest(assignment, "assignment_sha256")
    _validate_assignment(assignment)
    raw = canonical_bytes(assignment) + b"\n"
    path = _assignment_path(root, assignment_id)
    try:
        _atomic_create(path, raw)
    except FileExistsError:
        if _bounded_regular(path) != raw:
            raise ValueError("assignment ID already exists with different immutable bytes")
    return assignment


def append_stage_receipt(
    external_root: Path, receipt_id: str, stage: str, subject_sha256: str,
    recorded_at: str, details: Mapping[str, object],
) -> dict[str, object]:
    root = _validate_root(external_root)
    receipt_id = _identifier(receipt_id, "receipt_id")
    if stage not in STAGES:
        raise ValueError("unknown work-ledger stage")
    if HASH.fullmatch(subject_sha256) is None:
        raise ValueError("subject digest is malformed")
    _timestamp(recorded_at)
    if not isinstance(details, Mapping):
        raise ValueError("receipt details must be an object")
    path = root / "work-ledger.jsonl"
    flags = os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_CLOEXEC | os.O_NOFOLLOW
    fd = os.open(path, flags, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise ValueError("work ledger must be a regular file")
        os.lseek(fd, 0, os.SEEK_SET)
        raw = b""
        while True:
            part = os.read(fd, 1024 * 1024)
            if not part:
                break
            raw += part
            if len(raw) > MAX_INPUT_BYTES:
                raise ValueError("work ledger is too large")
        rows = []
        for line in raw.splitlines():
            row = json.loads(line)
            expected_prev = rows[-1]["receipt_sha256"] if rows else None
            if row.get("previous_receipt_sha256") != expected_prev:
                raise ValueError("work ledger hash chain is broken")
            if row.get("receipt_sha256") != content_digest(row, "receipt_sha256"):
                raise ValueError("work ledger receipt digest mismatch")
            rows.append(row)
        matches = [row for row in rows if row.get("receipt_id") == receipt_id]
        if matches:
            existing = matches[0]
            replay_fields = {
                "ledger_version": 1, "receipt_id": receipt_id, "stage": stage,
                "subject_sha256": subject_sha256, "recorded_at": recorded_at,
                "details": dict(details),
            }
            if len(matches) == 1 and all(existing.get(key) == value for key, value in replay_fields.items()):
                return existing
            raise ValueError("receipt ID replay conflicts with immutable ledger")
        base: dict[str, object] = {
            "ledger_version": 1, "receipt_id": receipt_id, "stage": stage,
            "subject_sha256": subject_sha256, "recorded_at": recorded_at,
            "details": dict(details),
            "previous_receipt_sha256": rows[-1]["receipt_sha256"] if rows else None,
        }
        base["receipt_sha256"] = content_digest(base, "receipt_sha256")
        os.write(fd, canonical_bytes(base) + b"\n")
        os.fsync(fd)
        return base
    finally:
        os.close(fd)


def _verify_identity(assignment: Mapping[str, object], path: Path, root: Path | None = None) -> dict[str, object]:
    receipt = _json_under_root(root, path) if root is not None else _json(path)
    if receipt.get("receipt_sha256") != content_digest(receipt, "receipt_sha256"):
        raise ValueError("identity audit receipt digest mismatch")
    if receipt.get("receipt_type") != "identity_audit" or receipt.get("assignment_sha256") != assignment["assignment_sha256"]:
        raise ValueError("identity audit assignment digest mismatch")
    expected = assignment.get("authorities")
    actual = receipt.get("companies")
    if not isinstance(actual, list) or len(actual) != 25:
        raise ValueError("identity audit must cover exactly 25 companies")
    normalized = [{key: row.get(key) for key in ("company_id", "legal_name", "jurisdiction", "registry_id")} for row in actual if isinstance(row, dict)]
    if normalized != expected or any(row.get("status") != "matched" for row in actual if isinstance(row, dict)):
        raise ValueError("legal identity or jurisdiction audit mismatch")
    _identifier(receipt.get("auditor_id"), "auditor_id")
    _timestamp(receipt.get("audited_at"))
    return receipt


def _validate_artifact_metadata(metadata: Mapping[str, object]) -> None:
    relative = metadata.get("path")
    if not isinstance(relative, str) or not relative:
        raise ValueError("artifact path must be root-relative")
    if metadata.get("kind") not in {"source", "attempt", "capture"}:
        raise ValueError("acquisition artifact kind is invalid")
    for field in ("artifact_id", "cell_id", "attempt_id", "route_id", "result"):
        if not isinstance(metadata.get(field), str) or not metadata[field]:
            raise ValueError(f"acquisition artifact {field} is missing")
    size = metadata.get("size")
    if (not isinstance(size, int) or isinstance(size, bool)
            or size < 0 or size > MAX_ARTIFACT_BYTES):
        raise ValueError("acquisition artifact declared size is invalid or too large")
    checksum = metadata.get("sha256")
    if not isinstance(checksum, str) or HASH.fullmatch(checksum) is None:
        raise ValueError("acquisition artifact digest is invalid")


def _artifact(root: Path, metadata: Mapping[str, object], remaining_budget: int) -> bytes:
    _validate_artifact_metadata(metadata)
    size = cast(int, metadata["size"])
    if size > remaining_budget:
        raise ValueError("acquisition artifacts exceed aggregate byte budget")
    raw = _bounded_root_regular(root, cast(str, metadata["path"]), size)
    if size != len(raw) or metadata.get("sha256") != sha256(raw):
        raise ValueError("acquisition artifact hash or size mismatch")
    return raw


def _artifact_chains(
    cell_id: str, artifact_ids: Sequence[str], artifacts: Mapping[str, Mapping[str, object]],
    attempts: Sequence[Mapping[str, object]], decision: str,
) -> None:
    """Validate exact cell-local source -> attempt -> capture chains."""
    selected = [artifacts[item] for item in artifact_ids]
    if any(item.get("cell_id") != cell_id for item in selected):
        raise ValueError("disposition artifact binding must be cell-local")
    attempts_by_id = {item.get("attempt_id"): item for item in attempts}
    if len(attempts_by_id) != len(attempts) or None in attempts_by_id:
        raise ValueError("disposition attempt binding is incomplete")
    selected_by_attempt: dict[str, list[Mapping[str, object]]] = {}
    for item in selected:
        selected_by_attempt.setdefault(item["attempt_id"], []).append(item)
    if set(selected_by_attempt) != set(attempts_by_id):
        raise ValueError("artifact chains must cover every disposition attempt exactly")
    for attempt_id, chain_items in selected_by_attempt.items():
        attempt = attempts_by_id[attempt_id]
        if attempt.get("cell_id") != cell_id:
            raise ValueError("attempt binding must be cell-local")
        by_kind = {item["kind"]: item for item in chain_items}
        if len(chain_items) != 3 or set(by_kind) != {"source", "attempt", "capture"}:
            raise ValueError("each attempt requires one source/attempt/capture chain")
        source_item, attempt_item, capture_item = (
            by_kind["source"], by_kind["attempt"], by_kind["capture"],
        )
        if attempt_item.get("source_artifact_id") != source_item["artifact_id"]:
            raise ValueError("source-to-attempt chain binding mismatch")
        if capture_item.get("attempt_artifact_id") != attempt_item["artifact_id"]:
            raise ValueError("attempt-to-capture chain binding mismatch")
        expected_attempt_raw = canonical_bytes(attempt) + b"\n"
        if (attempt_item.get("sha256") != sha256(expected_attempt_raw)
                or attempt_item.get("size") != len(expected_attempt_raw)):
            raise ValueError("attempt artifact does not contain the bound attempt receipt")
        if capture_item.get("sha256") != attempt.get("raw_response_sha256"):
            raise ValueError("capture artifact does not bind the attempt response hash")
        route_id = attempt.get("route_id")
        result = attempt.get("result")
        if any(item.get("route_id") != route_id or item.get("result") != result
               for item in chain_items):
            raise ValueError("artifact chain route or terminal result binding mismatch")
        if decision == "no_public_info" and result not in TERMINAL_EMPTY_RESULTS:
            raise ValueError("no_public_info requires an acceptable terminal result")


def _jsonl_bytes(rows: Sequence[Mapping[str, object]]) -> bytes:
    return b"".join(canonical_bytes(row) + b"\n" for row in rows)


def _preflight_unresolved_cell(cell: Mapping[str, object], state: str) -> None:
    """Reject publishable or absence-only fields in unresolved scratch cells."""
    for field in ("official_claim_ids", "reference_ids", "community_report_ids"):
        if cell.get(field) != []:
            raise ValueError(f"unresolved cell {field} must be empty")
    if "coverage_complete" in cell:
        raise ValueError("unresolved cell coverage_complete is forbidden")
    expected = {
        "reliability": "none", "currentness": "unknown",
        "scope_status": "unresolved", "publication_eligibility": "discovery_only",
    }
    if state == "not_researched":
        expected["conflict_status"] = "none"
    elif state == "conflicting_evidence":
        expected["conflict_status"] = "contradictory"
    for field, value in expected.items():
        if cell.get(field) != value:
            raise ValueError(f"unresolved cell {field} must be {value}")
    if state in {"research_incomplete", "source_access_failed"} and cell.get(
        "conflict_status"
    ) not in {"none", "disclosed"}:
        raise ValueError("unresolved cell conflict_status must be none or disclosed")


def _preflight_artifacts(
    assignment: Mapping[str, object], shards: Sequence[Mapping[str, object]],
    lanes: Mapping[str, Mapping[str, object]],
) -> int:
    """Validate the complete declared artifact graph before artifact I/O."""
    seen_lanes: set[str] = set()
    seen_cells: set[str] = set()
    seen_artifact_ids: set[str] = set()
    seen_artifact_paths: set[str] = set()
    seen_artifact_contents: set[tuple[str, int]] = set()
    declared_bytes = 0
    artifact_count = 0
    for shard in shards:
        if shard.get("receipt_sha256") != content_digest(shard, "receipt_sha256"):
            raise ValueError("acquisition shard receipt digest mismatch")
        if (shard.get("receipt_type") != "acquisition_shard"
                or shard.get("assignment_sha256") != assignment["assignment_sha256"]):
            raise ValueError("acquisition shard assignment digest mismatch")
        lane_id = shard.get("lane_id")
        if not isinstance(lane_id, str) or lane_id not in lanes or lane_id in seen_lanes:
            raise ValueError("duplicate or unknown acquisition lane")
        seen_lanes.add(lane_id)
        lane_cells = lanes[lane_id].get("cell_ids")
        if not isinstance(lane_cells, list):
            raise ValueError("assignment lane cells are invalid")
        if shard.get("cell_ids") != lane_cells:
            raise ValueError("shard cell union does not match assigned lane")
        artifacts_value = shard.get("artifacts")
        if not isinstance(artifacts_value, list):
            raise ValueError("shard artifact inventory is invalid")
        artifacts: dict[str, Mapping[str, object]] = {}
        for item in artifacts_value:
            if not isinstance(item, dict):
                raise ValueError("shard artifact inventory has malformed entries")
            _validate_artifact_metadata(item)
            artifact_id = cast(str, item["artifact_id"])
            relative = cast(str, item["path"])
            content_identity = (cast(str, item["sha256"]), cast(int, item["size"]))
            if (artifact_id in artifacts or artifact_id in seen_artifact_ids
                    or relative in seen_artifact_paths
                    or content_identity in seen_artifact_contents):
                raise ValueError("acquisition artifacts must be globally distinct and unreused")
            artifacts[artifact_id] = item
            seen_artifact_ids.add(artifact_id)
            seen_artifact_paths.add(relative)
            seen_artifact_contents.add(content_identity)
            artifact_count += 1
            declared_bytes += cast(int, item["size"])
        if artifact_count > PROTOCOL_2_MAX_ARTIFACTS:
            raise ValueError("protocol-2 artifact inventory exceeds maximum cardinality")
        if declared_bytes > PROTOCOL_2_MAX_AGGREGATE_ARTIFACT_BYTES:
            raise ValueError("acquisition artifacts exceed aggregate declared byte budget")
        rows = shard.get("dispositions")
        if not isinstance(rows, list) or len(rows) != len(lane_cells):
            raise ValueError("shard disposition union is incomplete")
        bound_artifact_ids: set[str] = set()
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError("reviewed disposition must be an object")
            cell_id = row.get("cell_id")
            if (not isinstance(cell_id, str) or cell_id not in lane_cells
                    or cell_id in seen_cells):
                raise ValueError("duplicate or unexpected reviewed cell disposition")
            seen_cells.add(cell_id)
            artifact_ids = row.get("artifact_ids")
            supplied = row.get("scratch")
            cell_rows = supplied.get("company-category-cells.jsonl") if isinstance(supplied, dict) else None
            if (not isinstance(cell_rows, list) or len(cell_rows) != 1
                    or not isinstance(cell_rows[0], dict)):
                raise ValueError("scratch cell row must be an object")
            attempts = supplied.get("research-attempts.jsonl") if isinstance(supplied, dict) else None
            if (not isinstance(attempts, list) or any(
                not isinstance(attempt, dict) for attempt in attempts
            ) or (not attempts and cell_rows[0].get("state") != "not_researched")):
                raise ValueError("each researched disposition must supply its actual attempts")
            if any(not isinstance(attempt.get("attempt_id"), str) for attempt in attempts):
                raise ValueError("attempt identity is malformed")
            if (not isinstance(artifact_ids, list)
                    or (not attempts and artifact_ids != [])
                    or (attempts and cell_rows[0].get("state") == "not_researched")
                    or any(not isinstance(item, str) for item in artifact_ids)
                    or len(artifact_ids) != 3 * len(attempts)
                    or len(set(artifact_ids)) != len(artifact_ids)
                    or any(item not in artifacts for item in artifact_ids)):
                raise ValueError("disposition artifact chain cardinality is not exact")
            typed_artifact_ids = cast(list[str], artifact_ids)
            typed_attempts = cast(list[Mapping[str, object]], attempts)
            if bound_artifact_ids.intersection(typed_artifact_ids):
                raise ValueError("acquisition artifact is reused across cell dispositions")
            review = row.get("review")
            decision_value = review.get("decision") if isinstance(review, dict) else None
            decision = decision_value if isinstance(decision_value, str) else ""
            _artifact_chains(cell_id, typed_artifact_ids, artifacts, typed_attempts, decision)
            bound_artifact_ids.update(typed_artifact_ids)
        if bound_artifact_ids != set(artifacts):
            raise ValueError("shard artifact inventory contains unbound artifacts")
    expected_cells = assignment.get("cell_ids")
    if not isinstance(expected_cells, list) or any(
        not isinstance(cell_id, str) for cell_id in expected_cells
    ):
        raise ValueError("assignment cell IDs are invalid")
    if seen_lanes != set(lanes) or seen_cells != set(expected_cells):
        raise ValueError("shard union has duplicates or omissions")
    return declared_bytes


def compile_neutral_aggregate(
    external_root: Path, assignment: Mapping[str, object], identity_audit: Path,
    shard_paths: Sequence[Path], output_dir: Path, *, candidate_output: Path | None = None,
    research_root: Path | None = None,
) -> dict[str, object]:
    root = _validate_root(external_root)
    _validate_assignment(assignment)
    _verify_identity(assignment, identity_audit, root)
    if len(shard_paths) != 6:
        raise ValueError("shard union must contain exactly six lanes")
    lanes = {lane["lane_id"]: lane for lane in assignment["lanes"]}
    authorities = {row["company_id"]: row for row in assignment["authorities"]}
    shards = [_json_under_root(root, shard_path) for shard_path in shard_paths]
    declared_artifact_bytes = _preflight_artifacts(assignment, shards, lanes)
    policy = _json(
        Path(__file__).resolve().parents[1] / "docs" / "research" / "company-benefits"
        / "research-coverage-policies.json"
    )
    policy_routes = policy.get("category_routes")
    policy_id = policy.get("policy_id")
    if not isinstance(policy_routes, dict) or not isinstance(policy_id, str):
        raise ValueError("canonical coverage policy category routes are invalid")
    seen_lanes: set[str] = set()
    seen_artifact_ids: set[str] = set()
    seen_artifact_paths: set[str] = set()
    seen_artifact_contents: set[tuple[str, int]] = set()
    dispositions: dict[str, Mapping[str, object]] = {}
    scratch: dict[str, list[Mapping[str, object]]] = {name: [] for name in SCRATCH_JSONL}
    unresolved = []
    artifact_bytes_read = 0
    for shard in shards:
        if shard.get("receipt_sha256") != content_digest(shard, "receipt_sha256"):
            raise ValueError("acquisition shard receipt digest mismatch")
        if shard.get("receipt_type") != "acquisition_shard" or shard.get("assignment_sha256") != assignment["assignment_sha256"]:
            raise ValueError("acquisition shard assignment digest mismatch")
        producer_id = _identifier(shard.get("producer_id"), "producer_id")
        _timestamp(shard.get("completed_at"))
        lane_id = shard.get("lane_id")
        if not isinstance(lane_id, str) or lane_id not in lanes or lane_id in seen_lanes:
            raise ValueError("duplicate or unknown acquisition lane")
        seen_lanes.add(lane_id)
        if shard.get("cell_ids") != lanes[lane_id]["cell_ids"]:
            raise ValueError("shard cell union does not match assigned lane")
        artifacts_value = shard.get("artifacts")
        if not isinstance(artifacts_value, list):
            raise ValueError("shard artifact inventory is invalid")
        artifacts = {}
        for item in artifacts_value:
            if not isinstance(item, dict) or not isinstance(item.get("artifact_id"), str) or item["artifact_id"] in artifacts:
                raise ValueError("shard artifact inventory has duplicate or malformed IDs")
            raw = _artifact(
                root, item,
                min(declared_artifact_bytes, PROTOCOL_2_MAX_AGGREGATE_ARTIFACT_BYTES)
                - artifact_bytes_read,
            )
            artifact_bytes_read += len(raw)
            artifact_id = item["artifact_id"]
            relative = item["path"]
            content_identity = (item["sha256"], item["size"])
            if (artifact_id in seen_artifact_ids or relative in seen_artifact_paths
                    or content_identity in seen_artifact_contents):
                raise ValueError("acquisition artifacts must be globally distinct and unreused")
            seen_artifact_ids.add(artifact_id)
            seen_artifact_paths.add(relative)
            seen_artifact_contents.add(content_identity)
            artifacts[artifact_id] = item
        rows = shard.get("dispositions")
        if not isinstance(rows, list) or len(rows) != len(lanes[lane_id]["cell_ids"]):
            raise ValueError("shard disposition union is incomplete")
        bound_artifact_ids: set[str] = set()
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError("reviewed disposition must be an object")
            cell_id = row.get("cell_id")
            if (not isinstance(cell_id, str) or cell_id not in lanes[lane_id]["cell_ids"]
                    or cell_id in dispositions):
                raise ValueError("duplicate or unexpected reviewed cell disposition")
            _, expected_company, expected_category = cell_id.split("::", 2)
            authority = authorities[expected_company]
            if (row.get("company_id"), row.get("category_id"), row.get("jurisdiction")) != (
                expected_company, expected_category, authority["jurisdiction"],
            ):
                raise ValueError("reviewed disposition authority binding mismatch")
            review = row.get("review")
            if not isinstance(review, dict):
                raise ValueError("explicit reviewed disposition is required")
            decision = review.get("decision")
            if decision not in DECISIONS or not isinstance(review.get("terminal"), bool):
                raise ValueError("reviewed disposition decision or terminality is invalid")
            expected_terminal = decision not in UNRESOLVED
            if review["terminal"] != expected_terminal:
                raise ValueError("reviewed disposition terminality conflicts with decision")
            reviewer_id = _identifier(review.get("reviewer_id"), "reviewer_id")
            if reviewer_id == producer_id:
                raise ValueError("reviewed disposition must be independently reviewed")
            reviewed_at = _timestamp(review.get("reviewed_at"), "reviewed_at")
            closure = row.get("closure")
            expected_closure = {key: decision != "not_researched" for key in ("sources", "attempts", "captures")}
            if closure != expected_closure:
                raise ValueError("source/attempt/capture closure must reflect actual research")
            artifact_ids = row.get("artifact_ids")
            if (not isinstance(artifact_ids, list) or (not artifact_ids and decision != "not_researched")
                    or len(set(artifact_ids)) != len(artifact_ids)
                    or any(item not in artifacts for item in artifact_ids)):
                raise ValueError("disposition artifact binding is incomplete")
            if bound_artifact_ids.intersection(artifact_ids):
                raise ValueError("acquisition artifact is reused across cell dispositions")
            bound_artifact_ids.update(artifact_ids)
            supplied = row.get("scratch")
            if not isinstance(supplied, dict) or set(supplied) - set(SCRATCH_JSONL):
                raise ValueError("disposition scratch payload is invalid")
            cell_rows = supplied.get("company-category-cells.jsonl")
            if not isinstance(cell_rows, list) or len(cell_rows) != 1:
                raise ValueError("each disposition must supply its exact explicit cell")
            cell_row = cell_rows[0]
            if (cell_row.get("cell_id"), cell_row.get("company_id"),
                    cell_row.get("category_id"), cell_row.get("jurisdiction")) != (
                cell_id, expected_company, expected_category, authority["jurisdiction"],
            ):
                raise ValueError("scratch cell authority binding mismatch")
            if cell_row.get("coverage_policy_id") != policy_id:
                raise ValueError("scratch cell coverage policy binding mismatch")
            if CELL_STATE_DECISIONS.get(cell_row.get("state")) != decision:
                raise ValueError("review decision does not match production cell state")
            if decision in UNRESOLVED:
                _preflight_unresolved_cell(cell_row, decision)
            attempts = supplied.get("research-attempts.jsonl")
            if (not isinstance(attempts, list) or any(
                not isinstance(attempt, dict) for attempt in attempts
            ) or (not attempts and decision != "not_researched")
                    or (attempts and decision == "not_researched")):
                raise ValueError("each researched disposition must supply its actual attempts")
            completed_at = []
            for attempt in attempts:
                if (not isinstance(attempt.get("attempt_id"), str)
                        or not isinstance(attempt.get("route_id"), str)):
                    raise ValueError("attempt identity is malformed")
                if (attempt.get("cell_id"), attempt.get("company_id"),
                        attempt.get("category_id"), attempt.get("jurisdiction"),
                        attempt.get("coverage_policy_id")) != (
                    cell_id, expected_company, expected_category,
                    authority["jurisdiction"], policy_id,
                ):
                    raise ValueError("attempt authority or coverage binding mismatch")
                completed_at.append(_timestamp(
                    attempt.get("completed_at"), "attempt completed_at",
                ))
            if any(reviewed_at <= completed for completed in completed_at):
                raise ValueError(
                    "reviewed_at must be strictly after every bound attempt completion"
                )
            attempt_ids = [attempt.get("attempt_id") for attempt in attempts]
            cell_attempt_ids = cell_row.get("attempt_ids")
            if (not isinstance(cell_attempt_ids, list)
                    or len(set(attempt_ids)) != len(attempt_ids)
                    or set(cell_attempt_ids) != set(attempt_ids)):
                raise ValueError("scratch cell attempt binding mismatch")
            if decision == "source_access_failed" and not any(
                attempt.get("result") == "access_failed" for attempt in attempts
            ):
                raise ValueError("source_access_failed requires an actual failed request")
            if decision == "conflicting_evidence":
                successful = [attempt for attempt in attempts if attempt.get("result") == "source_found"
                              and attempt.get("source_ids")]
                if (len(successful) < 2
                        or len({source_id for attempt in successful for source_id in attempt["source_ids"]}) < 2
                        or len({attempt.get("raw_response_sha256") for attempt in successful}) < 2):
                    raise ValueError("conflicting_evidence requires distinct successful evidence captures")
            if decision == "no_public_info":
                required_routes = policy_routes.get(expected_category)
                actual_routes = [attempt.get("route_id") for attempt in attempts]
                if (not isinstance(required_routes, list)
                        or len(set(actual_routes)) != len(actual_routes)
                        or set(actual_routes) != set(required_routes)):
                    raise ValueError("no_public_info requires every canonical route")
            _artifact_chains(cell_id, artifact_ids, artifacts, attempts, decision)
            if decision in UNRESOLVED:
                unresolved.append(cell_id)
            for name, records in supplied.items():
                if not isinstance(records, list) or any(not isinstance(record, dict) for record in records):
                    raise ValueError("scratch ledger rows must be objects")
                scratch[name].extend(records)
            dispositions[cell_id] = row
        if bound_artifact_ids != set(artifacts):
            raise ValueError("shard artifact inventory contains unbound artifacts")
    if artifact_bytes_read != declared_artifact_bytes:
        raise ValueError("acquisition artifact bytes do not match the declared aggregate")
    if seen_lanes != set(lanes) or set(dispositions) != set(assignment["cell_ids"]):
        raise ValueError("shard union has duplicates, omissions, or unstable ordering")
    expected_keys = [(cell_id.split("::", 2)[1], cell_id.split("::", 2)[2]) for cell_id in assignment["cell_ids"]]
    cell_position = {cell_id: index for index, cell_id in enumerate(assignment["cell_ids"])}
    scratch["company-category-cells.jsonl"].sort(
        key=lambda item: cell_position.get(item.get("cell_id"), 10**9)
    )
    actual_cells = scratch["company-category-cells.jsonl"]
    actual_keys = [(item.get("company_id"), item.get("category_id")) for item in actual_cells]
    if len(actual_cells) != 250 or actual_keys != expected_keys or len({item.get("cell_id") for item in actual_cells}) != 250:
        raise ValueError("aggregate cells are not the exact canonical 250-cell union")
    output = Path(output_dir)
    if output.parent.resolve(strict=True) != root or output.exists():
        raise ValueError("scratch output must be a new direct child of the external root")
    draft = {
        "schema_version": "1", "batch_id": assignment["batch_id"],
        "company_list_sha256": assignment["company_list_sha256"],
        "effective_sequence_sha256": assignment["effective_sequence_sha256"],
        "replacement_events_sha256": assignment["replacement_events_sha256"],
        "researcher_id": "neutral-aggregate",
    }
    raws = {"draft.json": canonical_bytes(draft) + b"\n"}
    for name in SCRATCH_JSONL:
        rows = scratch[name]
        if name != "company-category-cells.jsonl":
            rows = sorted(rows, key=canonical_bytes)
        raws[name] = _jsonl_bytes(rows)
    staging = Path(tempfile.mkdtemp(prefix=".neutral-aggregate-", dir=root))
    os.chmod(staging, 0o700)
    try:
        for name in SCRATCH_FILES:
            _atomic_create(staging / name, raws[name], 0o600)
        _rename_directory_noreplace(staging, output)
    except BaseException:
        for child in staging.glob("*"):
            child.unlink()
        if staging.exists():
            staging.rmdir()
        raise
    inventory = sha256(canonical_bytes({name: sha256(raw) for name, raw in sorted(raws.items())}))
    result: dict[str, object] = {
        "aggregate_version": 1, "assignment_sha256": assignment["assignment_sha256"],
        "inventory_sha256": inventory, "cell_count": 250,
        "unresolved_count": len(unresolved),
        "adjudication_status": "blocked_unresolved" if unresolved else "pending_independent_review",
    }
    if candidate_output is not None:
        if research_root is None:
            raise ValueError("candidate preflight requires research_root")
        compiler = Path(__file__).with_name("compile-company-benefits-series-candidate.py")
        subprocess.run(
            [sys.executable, str(compiler), str(output), str(candidate_output),
             "--research-root", str(research_root)], check=True,
        )
        # Compilation includes authoritative candidate validation. Only this
        # successful preflight makes the mixed inventory review-pending.
        result["adjudication_status"] = "pending_independent_review"
    return result


def _load_assignment(root: Path, path: Path) -> dict[str, object]:
    value = _json_under_root(_validate_root(root), path)
    _validate_assignment(value)
    return value


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    create = subparsers.add_parser("create-assignment", help="freeze one canonical 25/250 assignment")
    create.add_argument("--external-root", required=True, type=Path)
    create.add_argument("--series-batches", required=True, type=Path)
    create.add_argument("--companies", required=True, type=Path)
    create.add_argument("--batch-id", required=True)
    create.add_argument("--assignment-id", required=True)
    create.add_argument("--created-at", required=True)
    create.add_argument("--supersedes")
    receipt = subparsers.add_parser("append-receipt", help="append a hash-chained stage receipt")
    receipt.add_argument("--external-root", required=True, type=Path)
    receipt.add_argument("--receipt-id", required=True)
    receipt.add_argument("--stage", required=True, choices=STAGES)
    receipt.add_argument("--subject-sha256", required=True)
    receipt.add_argument("--recorded-at", required=True)
    receipt.add_argument("--details-json", default="{}")
    aggregate = subparsers.add_parser("compile-scratch", help="neutral exact-union scratch compilation")
    aggregate.add_argument("--external-root", required=True, type=Path)
    aggregate.add_argument("--assignment", required=True, type=Path)
    aggregate.add_argument("--identity-audit", required=True, type=Path)
    aggregate.add_argument("--shard", required=True, action="append", type=Path)
    aggregate.add_argument("--output-dir", required=True, type=Path)
    aggregate.add_argument("--candidate-output", type=Path)
    aggregate.add_argument("--research-root", type=Path)
    args = parser.parse_args(argv)
    if args.command == "create-assignment":
        value = create_assignment(args.external_root, args.series_batches, args.companies,
                                  args.batch_id, args.assignment_id, args.created_at,
                                  supersedes=args.supersedes)
    elif args.command == "append-receipt":
        try:
            details = json.loads(args.details_json)
        except json.JSONDecodeError as exc:
            parser.error(f"--details-json is invalid: {exc}")
        value = append_stage_receipt(args.external_root, args.receipt_id, args.stage,
                                     args.subject_sha256, args.recorded_at, details)
    else:
        value = compile_neutral_aggregate(
            args.external_root, _load_assignment(args.external_root, args.assignment),
            args.identity_audit,
            args.shard, args.output_dir, candidate_output=args.candidate_output,
            research_root=args.research_root,
        )
    print(canonical_bytes(value).decode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
