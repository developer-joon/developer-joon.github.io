#!/usr/bin/env python3
"""Atomically replace one already-approved benefits-series batch."""

import argparse
import ctypes
import fcntl
import hashlib
import importlib.util
import json
import os
import re
import shutil
import sys
import tempfile
from datetime import date, datetime
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import company_benefits_series as series

AUDIT_FILENAME = "series-approved-batch-replacements.jsonl"
APPROVAL_FIELDS = {
    "schema_version", "action", "batch_id", "expected_old_v2_ledger_sha256",
    "replacement_batch_manifest_sha256", "approved_at", "approver_id",
}
AUDIT_FIELDS = {
    "schema_version", "sequence", "batch_id", "old_approved_at", "old_reviewer_ids",
    "new_approved_at", "new_reviewer_id", "correction_approved_at", "correction_approver_id",
    "old_v2_ledger_sha256", "new_v2_ledger_sha256", "replacement_batch_manifest_sha256",
    "candidate_manifest_sha256", "review_bundle_sha256", "correction_approval_sha256",
    "previous_event_sha256", "event_sha256",
}
HASH = re.compile(r"^[0-9a-f]{64}$")
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]


def sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def _load_script(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _integrator():
    return _load_script(Path(__file__).with_name("integrate-company-benefits-series-batch.py"),
                        "approved_batch_replacement_integrator")


def _parse_timestamp(value, label):
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError
        return parsed
    except ValueError as exc:
        raise ValueError(f"invalid {label} timestamp") from exc


def _external_file(path, repository_root, research_root):
    path = Path(path)
    lexical = Path(os.path.abspath(path))
    if path.is_symlink() or not path.is_file():
        raise ValueError("external correction approval must be a regular file without symlinks")
    resolved = path.resolve(strict=True)
    repository = Path(repository_root).resolve(strict=True)
    research = Path(research_root).resolve(strict=True)
    if lexical != resolved or resolved.is_relative_to(repository) or resolved.is_relative_to(research):
        raise ValueError("correction approval must be repository-external and not symlink-aliased")
    return resolved


def load_correction_approval(path, batch_id, package_dir, research_root,
                             repository_root=REPOSITORY_ROOT):
    """Load a canonical external authorization bound to the old and new package hashes."""
    approval_path = _external_file(path, repository_root, research_root)
    raw = approval_path.read_bytes()
    try:
        approval = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("invalid external correction approval") from exc
    if (not isinstance(approval, dict) or set(approval) != APPROVAL_FIELDS
            or approval.get("schema_version") != "1"
            or approval.get("action") != "replace_approved_company_benefits_series_batch"):
        raise ValueError("external correction approval schema mismatch")
    if raw != series.json_bytes(approval):
        raise ValueError("external correction approval must use canonical JSON bytes")
    if approval.get("batch_id") != batch_id:
        raise ValueError("batch mismatch between requested ID and external correction approval")
    approver = approval.get("approver_id")
    if not isinstance(approver, str) or not approver.strip():
        raise ValueError("external correction approval requires an approver identity")
    _parse_timestamp(approval.get("approved_at"), "correction approved_at")
    package_manifest = Path(package_dir) / "batch.json"
    if (not package_manifest.is_file() or package_manifest.is_symlink()
            or approval.get("replacement_batch_manifest_sha256") != sha256(package_manifest.read_bytes())):
        raise ValueError("replacement package manifest hash does not match external correction approval")
    hashes = approval.get("expected_old_v2_ledger_sha256")
    if (not isinstance(hashes, dict) or set(hashes) != set(series.V2_LEDGER_FILES.values())
            or any(not HASH.fullmatch(str(value)) for value in hashes.values())):
        raise ValueError("external correction approval requires all six expected old package hashes")
    return approval, raw


def _validate_audit_chain(path):
    rows = series.read_jsonl(path)
    previous = None
    for position, row in enumerate(rows, 1):
        if (not isinstance(row, dict) or set(row) != AUDIT_FIELDS or row.get("schema_version") != "1"
                or row.get("sequence") != position or row.get("previous_event_sha256") != previous):
            raise ValueError("approved-batch replacement audit chain is malformed")
        event_hash = row.get("event_sha256")
        if not HASH.fullmatch(str(event_hash)):
            raise ValueError("approved-batch replacement audit chain has an invalid event hash")
        body = {key: value for key, value in row.items() if key != "event_sha256"}
        if sha256(series.canonical_json_bytes(body)) != event_hash:
            raise ValueError("approved-batch replacement audit chain hash mismatch")
        previous = event_hash
    return rows


def _append_audit_event(staged, batch_id, old_entry, manifest, approval, approval_raw, new_entry):
    path = Path(staged) / AUDIT_FILENAME
    rows = _validate_audit_chain(path)
    audit = manifest["review_audit"]
    body = {
        "schema_version": "1",
        "sequence": len(rows) + 1,
        "batch_id": batch_id,
        "old_approved_at": old_entry["approved_at"],
        "old_reviewer_ids": old_entry["reviewer_ids"],
        "new_approved_at": manifest["approved_at"],
        "new_reviewer_id": manifest["reviewer_id"],
        "correction_approved_at": approval["approved_at"],
        "correction_approver_id": approval["approver_id"],
        "old_v2_ledger_sha256": old_entry["v2_ledger_sha256"],
        "new_v2_ledger_sha256": new_entry["v2_ledger_sha256"],
        "replacement_batch_manifest_sha256": sha256((Path(staged).parent / "replacement-batch.json").read_bytes()),
        "candidate_manifest_sha256": audit["candidate_manifest_sha256"],
        "review_bundle_sha256": audit["review_bundle_sha256"],
        "correction_approval_sha256": sha256(approval_raw),
        "previous_event_sha256": rows[-1]["event_sha256"] if rows else None,
    }
    if body["replacement_batch_manifest_sha256"] != approval["replacement_batch_manifest_sha256"]:
        raise ValueError("replacement audit binding mismatch")
    event = {**body, "event_sha256": sha256(series.canonical_json_bytes(body))}
    series.write_jsonl(path, [*rows, event])
    _validate_audit_chain(path)


def _tree_bytes(root):
    root = Path(root)
    result = {}
    for path in sorted(root.rglob("*"), key=lambda item: item.relative_to(root).as_posix()):
        if path.is_symlink():
            raise ValueError(f"research tree symlinks are prohibited: {path}")
        if path.is_file():
            result[path.relative_to(root).as_posix()] = path.read_bytes()
    return result


def _fsync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _fsync_tree(root):
    directories = [Path(root)]
    for path in Path(root).rglob("*"):
        if path.is_symlink():
            raise ValueError(f"staged research tree symlinks are prohibited: {path}")
        if path.is_dir():
            directories.append(path)
        elif path.is_file():
            descriptor = os.open(path, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
    for directory in sorted(directories, key=lambda item: len(item.parts), reverse=True):
        _fsync_directory(directory)


def _atomic_exchange(left, right):
    libc = ctypes.CDLL(None, use_errno=True)
    renameat2 = getattr(libc, "renameat2", None)
    if renameat2 is None:
        raise RuntimeError("atomic replacement requires Linux renameat2")
    renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    renameat2.restype = ctypes.c_int
    if renameat2(-100, os.fsencode(left), -100, os.fsencode(right), 2) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), f"{left} <-> {right}")


def _membership_keys(records):
    return {(item.get("company_id"), item.get("category_id")) for item in records["cells"]}


def _stage_replacement(batch_id, package_dir, approval, approval_raw, research_root, staged,
                       freeze_anchor_receipt, effective_selection_receipt, as_of):
    integrator = _integrator()
    progress_path = staged / "series-progress.json"
    progress = json.loads(progress_path.read_text(encoding="utf-8"))
    batches = series.read_jsonl(staged / "series-batches.jsonl")
    batch_map = {item.get("batch_id"): item for item in batches}
    batch = batch_map.get(batch_id)
    if batch is None:
        raise ValueError("batch mismatch: requested old batch ID is not canonical")
    entries = progress.get("batches", [])
    old_entry = next((item for item in entries if item.get("batch_id") == batch_id), None)
    if old_entry is None or old_entry.get("status") != "approved":
        raise ValueError("requested old batch must be currently approved")
    expected_hashes = approval["expected_old_v2_ledger_sha256"]
    if old_entry.get("v2_ledger_sha256") != expected_hashes:
        raise ValueError("stale expected old package hashes")

    records = series.read_v2_batch_records(staged)
    old_slice = series.v2_batch_slice(records, batch)
    series.validate_v2_batch_records(old_slice, batch)
    expected_membership = {(company_id, category_id) for company_id in batch["company_ids"]
                           for category_id in series.V2_CATEGORIES}
    if (len(batch["company_ids"]) != 25 or len(set(batch["company_ids"])) != 25
            or len(old_slice["cells"]) != 250 or _membership_keys(old_slice) != expected_membership):
        raise ValueError("old approved batch does not have exact canonical 25-company/250-cell membership")

    for ledger, filename in series.V2_LEDGER_FILES.items():
        field = series.V2_ID_FIELDS[ledger]
        owned_ids = {item[field] for item in old_slice[ledger]}
        current = records[ledger]
        retained = [item for item in current if item.get(field) not in owned_ids]
        if len(current) - len(retained) != len(owned_ids):
            raise ValueError(f"old approved batch {filename} ownership is ambiguous")
        series.write_jsonl(staged / filename, retained)

    pending_entry = {
        key: value for key, value in old_entry.items()
        if key not in {"approved_at", "reviewer_ids", "cell_set_sha256", "v2_ledger_sha256"}
    }
    pending_entry.update(status="pending", claim_count=0, no_claim_count=0, cell_count=0)
    progress["batches"] = [pending_entry if item.get("batch_id") == batch_id else item for item in entries]
    progress_path.write_bytes(series.json_bytes(progress))

    manifest, package_batch, incoming = integrator.load_package(package_dir, staged)
    if manifest.get("batch_id") != batch_id or package_batch.get("batch_id") != batch_id:
        raise ValueError("batch mismatch between requested old batch and replacement package")
    if _parse_timestamp(manifest.get("approved_at"), "replacement approved_at") <= _parse_timestamp(
            old_entry.get("approved_at"), "old approved_at"):
        raise ValueError("approval regression: replacement approval must be newer than old approval")
    if _parse_timestamp(approval.get("approved_at"), "correction approved_at") <= _parse_timestamp(
            manifest.get("approved_at"), "replacement approved_at"):
        raise ValueError("approval regression: correction approval must follow replacement promotion")
    new_records = {ledger: incoming[filename] for ledger, filename in series.V2_LEDGER_FILES.items()}
    if (len(new_records["cells"]) != 250 or _membership_keys(new_records) != expected_membership
            or {item.get("company_id") for item in new_records["cells"]} != set(batch["company_ids"])):
        raise ValueError("replacement changes canonical 25-company/250-cell membership")

    for ledger, filename in series.V2_LEDGER_FILES.items():
        field = series.V2_ID_FIELDS[ledger]
        current = series.read_jsonl(staged / filename)
        merged = sorted([*current, *incoming[filename]], key=lambda item: item[field])
        series.write_jsonl(staged / filename, merged)

    approved_ids = {item["batch_id"] for item in entries if item.get("status") == "approved"}
    approval_times = {item["batch_id"]: item["approved_at"] for item in entries if item.get("status") == "approved"}
    reviewers = {item["batch_id"]: item["reviewer_ids"] for item in entries if item.get("status") == "approved"}
    approval_times[batch_id] = manifest["approved_at"]
    reviewers[batch_id] = [manifest["reviewer_id"]]
    new_progress = series.build_progress(staged, batches, approved_ids, approval_times, reviewers,
                                         progress.get("status", "in_progress"))
    if sum(item.get("status") == "approved" for item in new_progress["batches"]) != len(approved_ids):
        raise ValueError("approved batch count changed during replacement")
    old_others = {item["batch_id"]: item for item in entries if item["batch_id"] != batch_id}
    new_others = {item["batch_id"]: item for item in new_progress["batches"] if item["batch_id"] != batch_id}
    if old_others != new_others:
        raise ValueError("replacement changed another batch progress record")
    progress_path.write_bytes(series.json_bytes(new_progress))
    new_entry = next(item for item in new_progress["batches"] if item["batch_id"] == batch_id)

    manifest_snapshot = staged.parent / "replacement-batch.json"
    manifest_snapshot.write_bytes((Path(package_dir) / "batch.json").read_bytes())
    _append_audit_event(staged, batch_id, old_entry, manifest, approval, approval_raw, new_entry)
    manifest_snapshot.unlink()

    series.validate_persisted_v2_hashes(staged, batches, new_progress)
    verifier = _load_script(Path(__file__).with_name("verify-company-benefits-ledger.py"),
                            "approved_batch_replacement_verifier")
    errors = verifier.verify_workspace(
        staged, as_of=as_of, freeze_anchor_receipt=freeze_anchor_receipt,
        effective_selection_receipt=effective_selection_receipt,
    )
    if errors:
        raise ValueError("full-series staged validation failed:\n" + "\n".join(errors))
    renderer = _load_script(Path(__file__).with_name("render-company-benefits-drafts.py"),
                            "approved_batch_replacement_renderer")
    renderer.render_batch(
        staged, staged / "drafts", batch["scope"], batch["batch_number"], as_of=as_of,
        freeze_anchor_receipt=freeze_anchor_receipt,
        effective_selection_receipt=effective_selection_receipt,
    )
    errors = verifier.verify_workspace(
        staged, as_of=as_of, freeze_anchor_receipt=freeze_anchor_receipt,
        effective_selection_receipt=effective_selection_receipt,
    )
    if errors:
        raise ValueError("post-render full-series staged validation failed:\n" + "\n".join(errors))
    return new_progress


def _replace_locked(batch_id, package_dir, approval_path, research_root, freeze_anchor_receipt,
                    effective_selection_receipt=None, as_of=None,
                    repository_root=REPOSITORY_ROOT, dry_run=False):
    if not isinstance(batch_id, str) or not re.fullmatch(r"(?:domestic|international)-(?:0[1-9]|[1-3][0-9]|40)", batch_id):
        raise ValueError("exact old batch ID is required")
    package_dir = Path(package_dir)
    if package_dir.is_symlink() or not package_dir.is_dir() or package_dir.resolve(strict=True) != Path(os.path.abspath(package_dir)):
        raise ValueError("replacement package must be a real directory without symlink aliases")
    try:
        package_manifest = json.loads((package_dir / "batch.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("replacement package manifest is invalid") from exc
    if not isinstance(package_manifest, dict) or package_manifest.get("batch_id") != batch_id:
        raise ValueError("batch mismatch between requested old batch and replacement package")
    approval, approval_raw = load_correction_approval(
        approval_path, batch_id, package_dir, research_root, repository_root
    )
    integrator = _integrator()
    integrator.recover_transaction(research_root)
    before = _tree_bytes(research_root)
    progress = json.loads((research_root / "series-progress.json").read_text(encoding="utf-8"))
    batches = series.read_jsonl(research_root / "series-batches.jsonl")
    series.validate_persisted_v2_hashes(research_root, batches, progress)
    baseline_verifier = _load_script(Path(__file__).with_name("verify-company-benefits-ledger.py"),
                                     "approved_batch_replacement_baseline_verifier")
    baseline_errors = baseline_verifier.verify_workspace(
        research_root, as_of=as_of, freeze_anchor_receipt=freeze_anchor_receipt,
        effective_selection_receipt=effective_selection_receipt,
    )
    if baseline_errors:
        raise ValueError("active full-series validation failed before replacement:\n" + "\n".join(baseline_errors))

    temporary = Path(tempfile.mkdtemp(prefix=".approved-batch-replacement-", dir=research_root.parent))
    staged = temporary / "research"
    exchanged = False
    try:
        shutil.copytree(research_root, staged)
        if staged.stat().st_dev != research_root.stat().st_dev:
            raise ValueError("atomic replacement staging must share the research-root filesystem")
        new_progress = _stage_replacement(
            batch_id, package_dir, approval, approval_raw, research_root, staged,
            freeze_anchor_receipt, effective_selection_receipt, as_of,
        )
        if dry_run:
            if _tree_bytes(research_root) != before:
                raise RuntimeError("dry-run replacement changed active research bytes")
            return new_progress
        _fsync_tree(staged)
        _atomic_exchange(research_root, staged)
        exchanged = True
        try:
            _fsync_directory(research_root.parent)
            if _tree_bytes(research_root) == before:
                raise RuntimeError("replacement produced no active byte change")
        except BaseException:
            _atomic_exchange(research_root, staged)
            exchanged = False
            _fsync_directory(research_root.parent)
            if _tree_bytes(research_root) != before:
                raise RuntimeError("replacement rollback was not byte-identical")
            raise
        return new_progress
    except BaseException:
        if exchanged:
            _atomic_exchange(research_root, staged)
            _fsync_directory(research_root.parent)
        if _tree_bytes(research_root) != before:
            raise RuntimeError("failed replacement did not restore byte-identical active state")
        raise
    finally:
        shutil.rmtree(temporary, ignore_errors=True)


def replace_approved_batch(batch_id, package_dir, approval_path, research_root,
                           freeze_anchor_receipt, effective_selection_receipt=None,
                           as_of=None, repository_root=REPOSITORY_ROOT, dry_run=False):
    """Serialize validation, staging, and atomic whole-tree replacement on the stable parent."""
    research_root = Path(research_root)
    if research_root.is_symlink():
        raise ValueError("research root symlinks are prohibited")
    research_root = research_root.resolve(strict=True)
    lock_fd = os.open(research_root.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ValueError("another company-benefits series operation is in progress") from exc
        return _replace_locked(
            batch_id, package_dir, approval_path, research_root, freeze_anchor_receipt,
            effective_selection_receipt, as_of, repository_root, dry_run,
        )
    finally:
        os.close(lock_fd)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("old_batch_id", help="exact currently-approved canonical batch ID")
    parser.add_argument("replacement_package", type=Path, help="newly promoted approved package directory")
    parser.add_argument("external_approval", type=Path, help="repository-external correction approval JSON")
    parser.add_argument("--research-root", type=Path, default=Path("docs/research/company-benefits"))
    parser.add_argument("--freeze-anchor-receipt", type=Path,
                        default=os.environ.get("COMPANY_BENEFITS_FREEZE_ANCHOR_RECEIPT"))
    parser.add_argument("--effective-selection-receipt", type=Path,
                        default=os.environ.get("COMPANY_BENEFITS_EFFECTIVE_SELECTION_RECEIPT"))
    parser.add_argument("--as-of", type=date.fromisoformat)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    if args.freeze_anchor_receipt is None:
        parser.error("--freeze-anchor-receipt or COMPANY_BENEFITS_FREEZE_ANCHOR_RECEIPT is required")
    try:
        progress = replace_approved_batch(
            args.old_batch_id, args.replacement_package, args.external_approval,
            args.research_root, args.freeze_anchor_receipt,
            args.effective_selection_receipt, args.as_of, dry_run=args.dry_run,
        )
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"approved batch replacement failed: {exc}", file=sys.stderr)
        return 1
    approved = sum(item.get("status") == "approved" for item in progress["batches"])
    suffix = " (dry run)" if args.dry_run else ""
    print(f"replaced approved batch {args.old_batch_id}; {approved}/80 approved batches unchanged{suffix}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
