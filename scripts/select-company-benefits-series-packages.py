#!/usr/bin/env python3
"""Select and fully verify all 80 retained protocol-2 approved packages."""

import argparse
import ctypes
import hashlib
import importlib.util
import json
import os
import secrets
import stat
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import company_benefits_series as series

PACKAGE_MEMBERS = {
    "batch.json", "sources.jsonl", "claims.jsonl", "reviews.jsonl", "gaps.jsonl",
    "checks.jsonl", "company-category-cells.jsonl", "research-attempts.jsonl",
    "official-claims-v2.jsonl", "reference-records.jsonl",
    "community-benefit-reports.jsonl", "sources-v2.jsonl", "verified-benefits.jsonl",
    "company-category-outcomes.jsonl", "series-batch-approval.jsonl", "SHA256SUMS",
}
RECORD_ID_FIELDS = {
    "sources.jsonl": "source_id",
    "claims.jsonl": "claim_id",
    "reviews.jsonl": "review_id",
    "gaps.jsonl": "audit_id",
    "checks.jsonl": "source_id",
    "company-category-cells.jsonl": "cell_id",
    "research-attempts.jsonl": "attempt_id",
    "official-claims-v2.jsonl": "claim_id",
    "reference-records.jsonl": "reference_id",
    "community-benefit-reports.jsonl": "community_report_id",
    "sources-v2.jsonl": "source_id",
    "verified-benefits.jsonl": "benefit_id",
    "company-category-outcomes.jsonl": "cell_id",
}
EVIDENCE_IDENTITIES = {
    "official-claims-v2.jsonl": "claim_id",
    "reference-records.jsonl": "reference_id",
    "community-benefit-reports.jsonl": "community_report_id",
}
MAX_CANONICAL_FILE_BYTES = 2 * 1024 * 1024
MAX_DISCOVERY_DIRECTORIES = 10000
MAX_DISCOVERY_ENTRIES = 100000
MAX_PACKAGE_FILE_BYTES = 64 * 1024 * 1024
MAX_PACKAGE_BYTES = 256 * 1024 * 1024
MAX_SERIES_PACKAGE_BYTES = 80 * MAX_PACKAGE_BYTES
_PRODUCTION_INTEGRATOR = None


class SelectionResult:
    def __init__(self, manifest, inventory, totals, report):
        self.manifest = manifest
        self.inventory = inventory
        self.totals = totals
        self.report = report


def _sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def _canonical_json(value):
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False,
    ).encode("utf-8")


def _parse_jsonl(raw, label):
    try:
        lines = raw.decode("utf-8").splitlines()
    except UnicodeDecodeError as exc:
        raise ValueError(f"{label} is not UTF-8") from exc
    records = []
    for number, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{label}:{number}: invalid JSON") from exc
        if not isinstance(item, dict):
            raise ValueError(f"{label}:{number}: record must be an object")
        records.append(item)
    return records


def _safe_root(path, label, private=False):
    path = Path(path)
    lexical = Path(os.path.abspath(path))
    try:
        state = os.lstat(path)
        resolved = path.resolve(strict=True)
    except OSError as exc:
        raise ValueError(f"{label} must be a pre-existing real directory") from exc
    if not stat.S_ISDIR(state.st_mode) or lexical != resolved:
        raise ValueError(f"{label} symlink aliases are prohibited")
    if private and (state.st_uid != os.geteuid() or stat.S_IMODE(state.st_mode) & 0o077):
        raise ValueError(f"{label} must be owner-private")
    return resolved


def _read_root_file(root, name, label):
    root_fd = file_fd = None
    try:
        root_fd = series._open_directory_nofollow(root)
        file_fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=root_fd)
        before = os.fstat(file_fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_CANONICAL_FILE_BYTES:
            raise ValueError(f"{label} must be a bounded regular file")
        chunks = []
        remaining = before.st_size
        while remaining:
            chunk = os.read(file_fd, min(remaining, 1024 * 1024))
            if not chunk:
                raise ValueError(f"{label} changed during bounded read")
            chunks.append(chunk)
            remaining -= len(chunk)
        after = os.fstat(file_fd)
        current = os.stat(name, dir_fd=root_fd, follow_symlinks=False)
        fields = ("st_dev", "st_ino", "st_mode", "st_size", "st_mtime_ns", "st_ctime_ns")
        if any(getattr(before, field) != getattr(after, field)
               or getattr(before, field) != getattr(current, field) for field in fields):
            raise ValueError(f"{label} changed during bounded read")
        return b"".join(chunks)
    except OSError as exc:
        raise ValueError(f"{label} is not a safe regular file") from exc
    finally:
        if file_fd is not None:
            os.close(file_fd)
        if root_fd is not None:
            os.close(root_fd)


def _canonical_state(research_root):
    batches_raw = _read_root_file(research_root, "series-batches.jsonl", "canonical batch ledger")
    approvals_raw = _read_root_file(
        research_root, "series-batch-approvals.jsonl", "canonical approval ledger",
    )
    batches = _parse_jsonl(batches_raw, "series-batches.jsonl")
    approvals = _parse_jsonl(approvals_raw, "series-batch-approvals.jsonl")
    batch_ids = [item.get("batch_id") for item in batches]
    if len(batches) != 80 or len(set(batch_ids)) != 80 or any(not isinstance(item, str) or not item for item in batch_ids):
        raise ValueError("canonical series must contain exactly 80 unique batches")
    company_ids = [company_id for batch in batches for company_id in batch.get("company_ids", [])]
    if (any(not isinstance(batch.get("company_ids"), list) or len(batch["company_ids"]) != 25 for batch in batches)
            or len(company_ids) != 2000 or len(set(company_ids)) != 2000):
        raise ValueError("canonical series must contain exactly 2,000 unique companies")
    approval_by_batch = {}
    package_ids = set()
    receipt_ids = set()
    for approval in approvals:
        batch_id = approval.get("batch_id")
        if batch_id in approval_by_batch:
            raise ValueError(f"duplicate canonical approval for {batch_id}")
        if batch_id not in set(batch_ids) or approval.get("status") != "approved":
            raise ValueError("canonical approval ledger contains an invalid or stale approval")
        for field, seen, label in (
            ("package_sha256", package_ids, "package identity"),
            ("reviewer_receipt_sha256", receipt_ids, "receipt identity"),
        ):
            value = approval.get(field)
            if not isinstance(value, str) or not series.HASH_PATTERN.fullmatch(value):
                raise ValueError(f"canonical approval {label} is invalid")
            if value in seen:
                raise ValueError(f"duplicate canonical {label}")
            seen.add(value)
        approval_by_batch[batch_id] = approval
    if set(approval_by_batch) != set(batch_ids):
        raise ValueError("canonical approval ledger must approve every one of the 80 batches exactly once")
    return batches, approval_by_batch, batches_raw, approvals_raw


def _discover_packages(retained_roots):
    packages = []
    package_inodes = set()
    member_inodes = set()
    roots = [_safe_root(root, "retained package root", private=True) for root in retained_roots]
    if not roots:
        raise ValueError("at least one explicit retained package root is required")
    seen_roots = set()
    directory_count = 0
    entry_count = 0
    for root in roots:
        root_identity = (root.stat().st_dev, root.stat().st_ino)
        if root_identity in seen_roots:
            raise ValueError("duplicate retained package root path/inode")
        seen_roots.add(root_identity)
        for current, directory_names, file_names, directory_fd in os.fwalk(root, topdown=True, follow_symlinks=False):
            directory_count += 1
            if directory_count > MAX_DISCOVERY_DIRECTORIES:
                raise ValueError("retained package discovery exceeds the directory ceiling")
            current_path = Path(current)
            entry_count += len(directory_names) + len(file_names)
            if entry_count > MAX_DISCOVERY_ENTRIES:
                raise ValueError("retained package discovery exceeds the entry ceiling")
            for name in list(directory_names):
                state = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                if stat.S_ISLNK(state.st_mode):
                    raise ValueError(f"retained package discovery rejects symlink alias: {current_path / name}")
                if not stat.S_ISDIR(state.st_mode):
                    raise ValueError(f"retained package discovery requires regular directories: {current_path / name}")
            names = set(file_names) | set(directory_names)
            if names & {"candidate.json", "review-bundle.json", "reviewer-receipt.json"}:
                raise ValueError(f"stale candidate/review material in retained root: {current_path}")
            if "batch.json" not in names:
                for name in file_names:
                    state = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                    if not stat.S_ISREG(state.st_mode):
                        raise ValueError(f"retained roots may contain only regular files: {current_path / name}")
                continue
            if names != PACKAGE_MEMBERS:
                raise ValueError(f"approved package must contain exactly 16 canonical members: {current_path}")
            resolved = current_path.resolve(strict=True)
            if Path(os.path.abspath(current_path)) != resolved:
                raise ValueError(f"approved package symlink aliases are prohibited: {current_path}")
            identity = os.fstat(directory_fd)
            inode = (identity.st_dev, identity.st_ino)
            if inode in package_inodes:
                raise ValueError("duplicate package path/inode")
            package_inodes.add(inode)
            for name in file_names:
                state = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                if not stat.S_ISREG(state.st_mode):
                    raise ValueError(f"package members must be regular files: {current_path / name}")
                member_inode = (state.st_dev, state.st_ino)
                if member_inode in member_inodes:
                    raise ValueError(f"duplicate package member inode: {current_path / name}")
                member_inodes.add(member_inode)
            packages.append(resolved)
            directory_names[:] = []
    return packages


def _load_production_integrator():
    global _PRODUCTION_INTEGRATOR
    if _PRODUCTION_INTEGRATOR is not None:
        return _PRODUCTION_INTEGRATOR
    path = Path(__file__).with_name("integrate-company-benefits-series-batch.py")
    spec = importlib.util.spec_from_file_location("retained_series_package_integrator", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load production package verifier: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _PRODUCTION_INTEGRATOR = module
    return _PRODUCTION_INTEGRATOR


def load_package(path, research_root, retained_approval=None):
    """Delegate retained-package verification to the production loader."""
    return _load_production_integrator().load_package(
        path, research_root, retained_approval=retained_approval,
    )


def _record_values(records, filename, field):
    values = []
    for record in records.get(filename, []):
        value = record.get(field) if isinstance(record, dict) else None
        if not isinstance(value, str) or not value:
            raise ValueError(f"{filename} contains an invalid {field}")
        values.append(value)
    if len(values) != len(set(values)):
        raise ValueError(f"duplicate {field} inside {filename}")
    return values


def verify_and_select(retained_roots, research_root, loader=None):
    """Discover one immutable approved package per canonical batch and verify the full union."""
    research_root = _safe_root(research_root, "canonical research root")
    batches, approvals, batches_raw, approvals_raw = _canonical_state(research_root)
    discovered = _discover_packages(retained_roots)
    by_batch = {}
    for path in discovered:
        raw = series.read_bounded_regular_files(
            path, PACKAGE_MEMBERS, MAX_PACKAGE_FILE_BYTES, MAX_PACKAGE_BYTES, "retained package",
        )["batch.json"]
        try:
            manifest = json.loads(raw)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"invalid retained package batch.json: {path}") from exc
        batch_id = manifest.get("batch_id") if isinstance(manifest, dict) else None
        if batch_id not in approvals or manifest.get("schema_version") != "2" or manifest.get("status") != "approved":
            raise ValueError(f"stale or noncanonical retained package: {path}")
        by_batch.setdefault(batch_id, []).append(path)
    for batch in batches:
        matches = by_batch.get(batch["batch_id"], [])
        if len(matches) != 1:
            reason = "missing" if not matches else "ambiguous"
            raise ValueError(f"{batch['batch_id']}: {reason} approved retained package")
    if set(by_batch) != {item["batch_id"] for item in batches}:
        raise ValueError("retained roots contain a package outside the canonical batch ledger")

    loader = loader or load_package
    seen = {filename: set() for filename in RECORD_ID_FIELDS}
    evidence_seen = set()
    inventory = []
    selected_paths = []
    aggregate_bytes = 0
    outcome_count = 0
    for position, batch in enumerate(batches, 1):
        batch_id = batch["batch_id"]
        path = by_batch[batch_id][0]
        before = series.read_bounded_regular_files(
            path, PACKAGE_MEMBERS, MAX_PACKAGE_FILE_BYTES, MAX_PACKAGE_BYTES, "retained package",
        )
        aggregate_bytes += sum(len(raw) for raw in before.values())
        if aggregate_bytes > MAX_SERIES_PACKAGE_BYTES:
            raise ValueError("retained package union exceeds the aggregate byte ceiling")
        manifest, loaded_batch, records = loader(
            path, research_root, retained_approval=approvals[batch_id],
        )
        after = series.read_bounded_regular_files(
            path, PACKAGE_MEMBERS, MAX_PACKAGE_FILE_BYTES, MAX_PACKAGE_BYTES, "retained package",
        )
        if before != after:
            raise ValueError(f"{batch_id}: retained package changed during full verification")
        if manifest.get("batch_id") != batch_id or loaded_batch.get("batch_id") != batch_id:
            raise ValueError(
                f"package order mismatch at position {position}: expected {batch_id}",
            )
        if not isinstance(records, dict) or not set(RECORD_ID_FIELDS).issubset(records):
            raise ValueError(f"{batch_id}: production loader omitted required package records")
        for filename, field in RECORD_ID_FIELDS.items():
            values = _record_values(records, filename, field)
            collisions = seen[filename].intersection(values)
            if collisions:
                raise ValueError(f"global {field} collision in {filename}: {sorted(collisions)[0]}")
            seen[filename].update(values)
        for filename, field in EVIDENCE_IDENTITIES.items():
            values = set(_record_values(records, filename, field))
            collisions = evidence_seen.intersection(values)
            if collisions:
                raise ValueError(f"global evidence identity collision: {sorted(collisions)[0]}")
            evidence_seen.update(values)
        outcome_count += len(records.get("company-category-outcomes.jsonl", []))
        file_inventory = {
            name: {"bytes": len(raw), "sha256": _sha256(raw)}
            for name, raw in sorted(before.items())
        }
        inventory.append({
            "batch_id": batch_id,
            "package_path": str(path),
            "package_sha256": _sha256(before["batch.json"]),
            "files": file_inventory,
        })
        selected_paths.append(str(path))
    cell_count = len(seen["company-category-cells.jsonl"])
    outcome_cells = len(seen["company-category-outcomes.jsonl"])
    if cell_count != 20000 or outcome_count != 20000 or outcome_cells != 20000:
        raise ValueError(
            f"full-series cell gate failed: {cell_count} cells and {outcome_count} outcomes",
        )
    totals = {"batches": 80, "companies": 2000, "cells": 20000}
    manifest = {"schema_version": "1", "packages": selected_paths}
    manifest_raw = _canonical_json(manifest)
    report = {
        "schema_version": "1",
        "status": "verified",
        "totals": totals,
        "package_paths_sha256": _sha256(manifest_raw),
        "series_batches_sha256": _sha256(batches_raw),
        "series_batch_approvals_sha256": _sha256(approvals_raw),
        "aggregate_package_bytes": aggregate_bytes,
        "inventory": inventory,
    }
    report["inventory_sha256"] = _sha256(_canonical_json(inventory))
    return SelectionResult(manifest, inventory, totals, report)


def _fsync_directory_fd(descriptor):
    os.fsync(descriptor)


def _rename_noreplace(source, destination, source_dir_fd=-100, destination_dir_fd=-100):
    """Atomically publish a directory without replacing any existing path."""
    libc = ctypes.CDLL(None, use_errno=True)
    renameat2 = getattr(libc, "renameat2", None)
    if renameat2 is None:
        raise RuntimeError("atomic no-replace publication requires Linux renameat2")
    renameat2.argtypes = [
        ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint,
    ]
    renameat2.restype = ctypes.c_int
    if renameat2(
        source_dir_fd, os.fsencode(source), destination_dir_fd, os.fsencode(destination), 1,
    ) != 0:
        error = ctypes.get_errno()
        if error == 17:
            raise ValueError("output directory already exists; refusing to overwrite")
        raise OSError(error, os.strerror(error), f"{source} -> {destination}")


def _binding_matches(parent_fd, name, descriptor):
    try:
        named = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    except FileNotFoundError:
        return False
    opened = os.fstat(descriptor)
    return (named.st_dev, named.st_ino, named.st_mode) == (
        opened.st_dev, opened.st_ino, opened.st_mode,
    )


def _name_exists(parent_fd, name):
    try:
        os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        return True
    except FileNotFoundError:
        return False


def _cleanup_owned_staging(parent_fd, name, descriptor):
    """Remove only the flat staging tree still bound to its held descriptor."""
    if not _name_exists(parent_fd, name):
        return
    if not _binding_matches(parent_fd, name, descriptor):
        raise OSError("refusing to clean a staging name no longer bound to the owned directory")
    for member in os.listdir(descriptor):
        state = os.stat(member, dir_fd=descriptor, follow_symlinks=False)
        if not stat.S_ISREG(state.st_mode):
            raise OSError("owned selector staging contains a non-regular entry")
        os.unlink(member, dir_fd=descriptor)
    os.rmdir(name, dir_fd=parent_fd)


def _note_secondary(primary, label, secondary):
    primary.add_note(f"{label}: {type(secondary).__name__}: {secondary}")


def _make_owned_staging(parent_fd, prefix):
    for _ in range(100):
        name = f".{prefix}.{secrets.token_hex(8)}"
        try:
            os.mkdir(name, 0o700, dir_fd=parent_fd)
        except FileExistsError:
            continue
        try:
            descriptor = os.open(
                name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent_fd,
            )
        except BaseException:
            os.rmdir(name, dir_fd=parent_fd)
            raise
        if not _binding_matches(parent_fd, name, descriptor):
            os.close(descriptor)
            raise OSError("selector staging changed while it was opened")
        return name, descriptor
    raise FileExistsError("could not allocate a unique selector staging directory")


def publish_selection(result, output_directory):
    """Atomically publish the integrator manifest and stable preflight report."""
    output_directory = Path(output_directory)
    parent = _safe_root(output_directory.parent, "output parent", private=True)
    if output_directory.exists() or output_directory.is_symlink():
        raise ValueError("output directory already exists; refusing to overwrite")
    parent_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    temporary_name = None
    staging_fd = None
    published = False
    committed = False
    try:
        temporary_name, staging_fd = _make_owned_staging(parent_fd, output_directory.name)
        os.fchmod(staging_fd, 0o700)
        for name, value in (
            ("package-paths.json", result.manifest),
            ("preflight-report.json", result.report),
        ):
            descriptor = os.open(
                name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                0o600, dir_fd=staging_fd,
            )
            try:
                raw = _canonical_json(value)
                written = 0
                while written < len(raw):
                    count = os.write(descriptor, raw[written:])
                    if count <= 0:
                        raise OSError("short output write")
                    written += count
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        _fsync_directory_fd(staging_fd)
        _rename_noreplace(
            temporary_name, output_directory.name,
            source_dir_fd=parent_fd, destination_dir_fd=parent_fd,
        )
        published = True
        _fsync_directory_fd(parent_fd)
        committed = True
    except BaseException as primary:
        if published:
            rollback_error = None
            try:
                if not _binding_matches(parent_fd, output_directory.name, staging_fd):
                    raise OSError("published selector output no longer has its owned identity")
                _rename_noreplace(
                    output_directory.name, temporary_name,
                    source_dir_fd=parent_fd, destination_dir_fd=parent_fd,
                )
            except BaseException as exc:
                rollback_error = exc

            rolled_back = (
                _binding_matches(parent_fd, temporary_name, staging_fd)
                and not _name_exists(parent_fd, output_directory.name)
            )
            still_published = (
                _binding_matches(parent_fd, output_directory.name, staging_fd)
                and not _name_exists(parent_fd, temporary_name)
            )
            if still_published:
                # Rollback did not take effect. Crossing the parent-fsync boundary
                # is now the only truthful outcome: report committed success rather
                # than an error while leaving a newly published destination visible.
                try:
                    _fsync_directory_fd(parent_fd)
                except BaseException as commit_error:
                    if rollback_error is not None:
                        _note_secondary(primary, "publication rollback failed", rollback_error)
                    _note_secondary(primary, "publication commit retry failed", commit_error)
                    raise
                committed = True
                return
            if not rolled_back:
                if rollback_error is not None:
                    _note_secondary(primary, "publication rollback failed", rollback_error)
                raise OSError("selector publication rollback left an ambiguous binding") from primary
            published = False
            if rollback_error is not None:
                _note_secondary(primary, "publication rollback reported an error after taking effect", rollback_error)
            try:
                _fsync_directory_fd(parent_fd)
            except BaseException as exc:
                _note_secondary(primary, "publication rollback fsync failed", exc)
        if staging_fd is not None:
            try:
                _cleanup_owned_staging(parent_fd, temporary_name, staging_fd)
                _fsync_directory_fd(parent_fd)
            except BaseException as exc:
                _note_secondary(primary, "owned staging cleanup failed", exc)
        raise
    finally:
        primary = sys.exception()
        cleanup_errors = []
        if staging_fd is not None:
            try:
                os.close(staging_fd)
            except BaseException as exc:
                cleanup_errors.append(("staging descriptor cleanup failed", exc))
        try:
            os.close(parent_fd)
        except BaseException as exc:
            cleanup_errors.append(("parent descriptor cleanup failed", exc))
        if primary is not None:
            for label, exc in cleanup_errors:
                _note_secondary(primary, label, exc)
        elif cleanup_errors and not committed:
            label, cleanup_error = cleanup_errors[0]
            for secondary_label, exc in cleanup_errors[1:]:
                _note_secondary(cleanup_error, secondary_label, exc)
            raise cleanup_error


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "retained_roots", nargs="+", type=Path,
        help="explicit pre-existing owner-private roots containing immutable approved packages",
    )
    parser.add_argument(
        "--research-root", type=Path, default=Path("docs/research/company-benefits"),
        help="canonical research root containing series-batches and approval ledgers",
    )
    parser.add_argument(
        "--output", type=Path, required=True,
        help="new output directory beneath a pre-existing owner-private parent",
    )
    args = parser.parse_args(argv)
    result = verify_and_select(args.retained_roots, args.research_root)
    publish_selection(result, args.output)
    print("verified 80 packages, 2,000 companies, and 20,000 cells")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
