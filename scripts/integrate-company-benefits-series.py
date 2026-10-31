#!/usr/bin/env python3
"""Atomically integrate an explicit manifest of all 80 approved series packages."""

import argparse
import ctypes
import fcntl
import hashlib
import importlib.util
import json
import os
import shutil
import sys
import tempfile
from datetime import date
from pathlib import Path

# A validation-only run must not create repository-local __pycache__ files.
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import company_benefits_series as series

PACKAGE_FILES = ("sources.jsonl", "claims.jsonl", "reviews.jsonl", "gaps.jsonl", "checks.jsonl")
PACKAGE_MEMBERS = ("batch.json", *PACKAGE_FILES)
COLLISION_FIELDS = {
    "sources.jsonl": "source_id",
    "claims.jsonl": "claim_id",
    "reviews.jsonl": "review_id",
    "checks.jsonl": "source_id",
}
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]


class ApprovedPackage:
    def __init__(self, path, manifest, batch, records):
        self.path = Path(path)
        self.manifest = manifest
        self.batch = batch
        self.records = records


class ValidatedRun:
    def __init__(self, packages, inventory, run_digest):
        self.packages = packages
        self.inventory = inventory
        self.run_digest = run_digest


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True, allow_nan=False).encode("utf-8")


def _load_script(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _batch_integrator():
    return _load_script(Path(__file__).with_name("integrate-company-benefits-series-batch.py"), "series_batch_integrator")


def canonical_batches(research_root):
    batches = series.read_jsonl(Path(research_root) / "series-batches.jsonl")
    if len(batches) != 80 or len({item.get("batch_id") for item in batches}) != 80:
        raise ValueError("canonical series must contain exactly 80 unique batches")
    return batches


def load_batch_package(package, research_root):
    return _batch_integrator().load_package(package, research_root)


def _read_manifest(path):
    try:
        manifest = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid package-path manifest: {exc}") from exc
    if not isinstance(manifest, dict) or set(manifest) != {"schema_version", "packages"} or manifest.get("schema_version") != "1":
        raise ValueError("package-path manifest schema mismatch")
    paths = manifest.get("packages")
    if not isinstance(paths, list) or len(paths) != 80 or any(not isinstance(item, str) or not item for item in paths):
        raise ValueError("package-path manifest must contain exactly 80 explicit paths")
    return [Path(item) for item in paths]


def _validate_package_path(path):
    lexical = Path(os.path.abspath(path))
    if path.is_symlink() or not path.is_dir():
        raise ValueError(f"package path must be a real directory, not a symlink: {path}")
    resolved = path.resolve(strict=True)
    if lexical != resolved:
        raise ValueError(f"package path aliases through a symlink: {path}")
    actual = {item.name for item in resolved.iterdir()}
    if actual != set(PACKAGE_MEMBERS):
        raise ValueError(f"package must contain exactly batch.json and five artifacts: {path}")
    for item in resolved.iterdir():
        if item.is_symlink() or not item.is_file():
            raise ValueError(f"package members must be regular files without symlinks: {item}")
    return resolved


def prevalidate_manifest(manifest_path, research_root, batches=None, loader=None):
    """Validate all package identities and global identifiers without mutating the workspace."""
    batches = list(batches if batches is not None else canonical_batches(research_root))
    if len(batches) != 80:
        raise ValueError("canonical series must contain exactly 80 batches")
    loader = loader or load_batch_package
    paths = _read_manifest(manifest_path)
    resolved_paths = [_validate_package_path(path) for path in paths]
    if len(set(resolved_paths)) != len(resolved_paths):
        raise ValueError("duplicate package path in explicit manifest")

    packages = []
    seen = {name: set() for name in COLLISION_FIELDS}
    inventory = []
    for position, (path, expected) in enumerate(zip(resolved_paths, batches), 1):
        manifest, batch, records = loader(path, research_root)
        expected_id = expected.get("batch_id")
        actual_id = manifest.get("batch_id")
        if actual_id != expected_id or batch.get("batch_id") != expected_id:
            raise ValueError(f"package manifest is not in canonical order at position {position}: expected {expected_id}, got {actual_id}")
        if manifest.get("status") != "approved":
            raise ValueError(f"{actual_id}: package is not approved")
        for filename, field in COLLISION_FIELDS.items():
            values = [item.get(field) for item in records[filename]]
            collisions = seen[filename].intersection(values)
            if collisions:
                raise ValueError(f"global {field} collision across packages: {sorted(collisions)[0]}")
            seen[filename].update(values)
        file_hashes = {name: sha256((path / name).read_bytes()) for name in PACKAGE_MEMBERS}
        inventory.append({"batch_id": actual_id, "files": file_hashes})
        packages.append(ApprovedPackage(path, manifest, batch, records))
    run_digest = sha256(canonical_json({"schema_version": "1", "packages": inventory}))
    return ValidatedRun(packages, inventory, run_digest)


def snapshot_package_manifest(manifest_path, workspace):
    """Copy explicit package inputs once, then validate and integrate only those bytes."""
    snapshots = Path(workspace) / "packages"
    snapshots.mkdir()
    copied = []
    for position, source in enumerate(_read_manifest(manifest_path), 1):
        source = _validate_package_path(source)
        target = snapshots / f"{position:02d}"
        shutil.copytree(source, target)
        copied.append(str(target))
    snapshot_manifest = Path(workspace) / "package-paths.json"
    snapshot_manifest.write_bytes(canonical_json({"schema_version": "1", "packages": copied}))
    return snapshot_manifest


def tree_manifest(root):
    root = Path(root)
    entries = []
    for path in sorted(root.rglob("*"), key=lambda item: item.relative_to(root).as_posix()):
        if path.is_symlink():
            raise ValueError(f"research tree symlinks are prohibited during atomic integration: {path}")
        if path.is_file():
            raw = path.read_bytes()
            entries.append({"path": path.relative_to(root).as_posix(), "sha256": sha256(raw), "bytes": len(raw)})
    return entries


def validate_receipt_path(receipt_path, repository_root=REPOSITORY_ROOT, research_root=None):
    receipt = Path(receipt_path)
    lexical = Path(os.path.abspath(receipt))
    repository = Path(repository_root).resolve()
    try:
        resolved_parent = receipt.parent.resolve(strict=True)
    except OSError as exc:
        raise ValueError("integration receipt parent must be an existing real directory") from exc
    if Path(os.path.abspath(receipt.parent)) != resolved_parent:
        raise ValueError("integration receipt parent symlink aliases are prohibited")
    resolved_candidate = resolved_parent / receipt.name
    if lexical.is_relative_to(repository) or resolved_candidate.is_relative_to(repository):
        raise ValueError("integration receipt must remain outside the repository")
    if research_root is not None and (lexical.is_relative_to(Path(research_root).resolve())
                                      or resolved_candidate.is_relative_to(Path(research_root).resolve())):
        raise ValueError("integration receipt must remain outside the integrated workspace")
    if receipt.is_symlink():
        raise ValueError("integration receipt symlinks are prohibited")
    if not resolved_parent.is_dir():
        raise ValueError("integration receipt parent must be an existing real directory")
    return lexical


def integrate_one(package, staged, **kwargs):
    return _batch_integrator().integrate_batch(package, staged, kwargs["freeze_anchor_receipt"],
                                                kwargs.get("effective_selection_receipt"), kwargs.get("as_of"))


def finalize_series(staged, packages, **kwargs):
    approval_times = {item.batch["batch_id"]: item.manifest["approved_at"] for item in packages}
    reviewers = {item.batch["batch_id"]: [item.manifest["reviewer_id"]] for item in packages}
    approved = set(approval_times)
    # Draft each batch while progress remains in_progress; complete status itself requires all drafts.
    series.materialize_contract(staged, approved, approval_times, reviewers, status="in_progress")
    drafts = Path(staged) / "drafts"
    if drafts.exists():
        shutil.rmtree(drafts)
    drafts.mkdir()
    renderer = _load_script(Path(__file__).with_name("render-company-benefits-drafts.py"), "series_transaction_renderer")
    for item in packages:
        renderer.render_batch(staged, drafts, item.batch["scope"], item.batch["batch_number"],
                              as_of=kwargs.get("as_of"), freeze_anchor_receipt=kwargs["freeze_anchor_receipt"],
                              effective_selection_receipt=kwargs.get("effective_selection_receipt"))
    _, progress = series.materialize_contract(staged, approved, approval_times, reviewers, status="complete")
    renderer.render_hub(staged, drafts)
    expected = {"hub.md"} | {f"{item.batch['batch_id']}.md" for item in packages}
    actual = {path.name for path in drafts.iterdir() if path.is_file()}
    if actual != expected or len(actual) != 81:
        raise ValueError("completion requires exactly 80 canonical drafts plus hub")
    return progress


def verify_staged(staged, **kwargs):
    verifier = _load_script(Path(__file__).with_name("verify-company-benefits-ledger.py"), "series_transaction_verifier")
    return verifier.verify_workspace(staged, as_of=kwargs.get("as_of"),
                                     freeze_anchor_receipt=kwargs["freeze_anchor_receipt"],
                                     effective_selection_receipt=kwargs.get("effective_selection_receipt"))


def _atomic_exchange(left, right):
    """Atomically exchange two same-filesystem directories (Linux renameat2)."""
    libc = ctypes.CDLL(None, use_errno=True)
    renameat2 = getattr(libc, "renameat2", None)
    if renameat2 is None:
        raise RuntimeError("atomic directory exchange requires Linux renameat2")
    renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    renameat2.restype = ctypes.c_int
    result = renameat2(-100, os.fsencode(left), -100, os.fsencode(right), 2)
    if result != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), f"{left} <-> {right}")


def _fsync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _fsync_tree(root):
    """Make staged file bytes and directory entries durable before promotion."""
    root = Path(root)
    directories = [root]
    for path in root.rglob("*"):
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


def _write_receipt_exclusive(path, value):
    path = Path(path)
    raw = canonical_json(value)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb") as output:
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
        # link() atomically publishes without overwriting an existing receipt.
        os.link(temporary, path)
        _fsync_directory(path.parent)
        temporary.unlink()
        _fsync_directory(path.parent)
    except BaseException:
        try:
            os.close(descriptor)
        except OSError:
            pass
        temporary.unlink(missing_ok=True)
        raise


def _completion_counts(progress):
    entries = progress.get("batches", [])
    approved = sum(item.get("status") == "approved" for item in entries)
    accounted = sum(item.get("claim_count", 0) + item.get("no_claim_count", 0) for item in entries)
    if progress.get("status") != "complete" or approved != 80 or accounted != 2000:
        raise ValueError(f"completion gate failed: {approved}/80 approved and {accounted}/2000 accounted")
    return approved, accounted


def _integrate_series_locked(manifest_path, research_root, receipt_path, freeze_anchor_receipt,
                             effective_selection_receipt=None, as_of=None, dry_run=False):
    research_root = Path(research_root).resolve(strict=True)
    if research_root.is_symlink():
        raise ValueError("research root symlinks are prohibited")
    receipt = validate_receipt_path(receipt_path, REPOSITORY_ROOT, research_root)
    try:
        active_progress = json.loads((research_root / "series-progress.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        active_progress = {}
    if active_progress.get("status") == "complete":
        raise ValueError("series is already complete; duplicate ingestion is prohibited")
    before = tree_manifest(research_root)
    before_digest = sha256(canonical_json(before))
    if receipt.exists():
        try:
            previous = json.loads(receipt.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError("existing integration receipt is invalid") from exc
        if previous.get("status") == "complete" and previous.get("before_tree_sha256") == before_digest:
            # Recover a crash after durable receipt creation but before atomic promotion.
            receipt.unlink()
        else:
            raise ValueError("integration receipt already exists; duplicate invocation is prohibited")

    temporary = Path(tempfile.mkdtemp(prefix="company-benefits-series-", dir=receipt.parent))
    staged = temporary / "research"
    try:
        if temporary.stat().st_dev != research_root.stat().st_dev:
            raise ValueError("external receipt workspace must share a filesystem with the research root for atomic promotion")
        shutil.copytree(research_root, staged)
        batches = canonical_batches(staged)
        snapshot_manifest = snapshot_package_manifest(manifest_path, temporary)
        validated = prevalidate_manifest(snapshot_manifest, staged, batches, load_batch_package)
        arguments = {
            "freeze_anchor_receipt": freeze_anchor_receipt,
            "effective_selection_receipt": effective_selection_receipt,
            "as_of": as_of,
        }
        for package in validated.packages:
            integrate_one(package.path, staged, **arguments)
        progress = finalize_series(staged, validated.packages, **arguments)
        approved, accounted = _completion_counts(progress)
        errors = verify_staged(staged, **arguments)
        if errors:
            raise ValueError("final authoritative staged verification failed:\n" + "\n".join(errors))
        after = tree_manifest(staged)
        result = {
            "schema_version": "1",
            "status": "validated_dry_run" if dry_run else "complete",
            "staged_status": "complete",
            "run_digest": validated.run_digest,
            "package_inventory": validated.inventory,
            "before_tree_sha256": before_digest,
            "after_tree_sha256": sha256(canonical_json(after)),
            "approved_batches": approved,
            "accounted_companies": accounted,
            "draft_count": 81,
            "inputs": {
                "manifest": str(Path(manifest_path).resolve()),
                "research_root": str(research_root),
                "freeze_anchor_receipt": str(Path(freeze_anchor_receipt).resolve()),
                "effective_selection_receipt": str(Path(effective_selection_receipt).resolve()) if effective_selection_receipt else None,
                "as_of": as_of.isoformat() if hasattr(as_of, "isoformat") else (str(as_of) if as_of else None),
            },
        }
        if dry_run:
            _write_receipt_exclusive(receipt, result)
            return result
        _fsync_tree(staged)
        _write_receipt_exclusive(receipt, result)
        exchanged = False
        try:
            _atomic_exchange(research_root, staged)
            exchanged = True
            _fsync_directory(research_root.parent)
            if staged.parent != research_root.parent:
                _fsync_directory(staged.parent)
        except BaseException:
            if exchanged:
                _atomic_exchange(research_root, staged)
                _fsync_directory(research_root.parent)
                if staged.parent != research_root.parent:
                    _fsync_directory(staged.parent)
            receipt.unlink(missing_ok=True)
            _fsync_directory(receipt.parent)
            raise
        return result
    finally:
        shutil.rmtree(temporary, ignore_errors=True)


def integrate_series(manifest_path, research_root, receipt_path, freeze_anchor_receipt,
                     effective_selection_receipt=None, as_of=None, dry_run=False):
    """Serialize whole-series transactions on the stable parent directory."""
    research_root = Path(research_root)
    if research_root.is_symlink():
        raise ValueError("research root symlinks are prohibited")
    research_root = research_root.resolve(strict=True)
    lock_fd = os.open(research_root.parent, os.O_RDONLY)
    try:
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise ValueError("another company-benefits series integration is in progress") from exc
        return _integrate_series_locked(manifest_path, research_root, receipt_path, freeze_anchor_receipt,
                                        effective_selection_receipt, as_of, dry_run)
    finally:
        os.close(lock_fd)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, help="JSON manifest containing 80 explicit approved-package paths")
    parser.add_argument("--research-root", type=Path, default=Path("docs/research/company-benefits"))
    parser.add_argument("--receipt", type=Path, required=True, help="new exactly-once receipt path outside the repository")
    parser.add_argument("--freeze-anchor-receipt", type=Path,
                        default=os.environ.get("COMPANY_BENEFITS_FREEZE_ANCHOR_RECEIPT"))
    parser.add_argument("--effective-selection-receipt", type=Path,
                        default=os.environ.get("COMPANY_BENEFITS_EFFECTIVE_SELECTION_RECEIPT"))
    parser.add_argument("--as-of", type=date.fromisoformat)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    if args.freeze_anchor_receipt is None:
        parser.error("--freeze-anchor-receipt or COMPANY_BENEFITS_FREEZE_ANCHOR_RECEIPT is required")
    result = integrate_series(args.manifest, args.research_root, args.receipt, args.freeze_anchor_receipt,
                              args.effective_selection_receipt, args.as_of, args.dry_run)
    suffix = " (dry run; external validation receipt written)" if args.dry_run else ""
    print(f"integrated {result['approved_batches']}/80 packages; {result['accounted_companies']}/2000 companies; 81 drafts{suffix}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
