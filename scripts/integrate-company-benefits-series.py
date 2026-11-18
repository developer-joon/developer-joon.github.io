#!/usr/bin/env python3
"""Atomically integrate an explicit manifest of all 80 approved series packages."""

import argparse
import ctypes
import hashlib
import heapq
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

COLLISION_FIELDS = {
    "sources.jsonl": "source_id",
    "claims.jsonl": "claim_id",
    "reviews.jsonl": "review_id",
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
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
MAX_COMPACT_STATE_BYTES = 64 * 1024 * 1024
COMPACT_ID_OVERHEAD_BYTES = 96
MERGE_FAN_IN = 16


class ApprovedPackage:
    def __init__(self, path, manifest, batch):
        self.path = Path(path)
        self.manifest = manifest
        self.batch = batch


class ValidatedRun:
    def __init__(self, packages, inventory, run_digest, spool_root=None, spool_budget=None):
        self.packages = packages
        self.inventory = inventory
        self.run_digest = run_digest
        self.spool_root = Path(spool_root) if spool_root is not None else None
        self.spool_budget = spool_budget


class LedgerSpoolBudget:
    """Account live ledger-spool bytes against one explicit ceiling."""

    def __init__(self, byte_limit):
        self.byte_limit = byte_limit
        self.live_bytes = 0
        self.peak_bytes = 0

    def reserve(self, byte_count):
        if byte_count < 0 or self.live_bytes + byte_count > self.byte_limit:
            raise ValueError("ledger spool exceeds bounded byte ceiling")
        self.live_bytes += byte_count
        self.peak_bytes = max(self.peak_bytes, self.live_bytes)

    def release(self, byte_count):
        if byte_count < 0 or byte_count > self.live_bytes:
            raise RuntimeError("ledger spool byte accounting underflow")
        self.live_bytes -= byte_count


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
    global _BATCH_INTEGRATOR
    if _BATCH_INTEGRATOR is None:
        _BATCH_INTEGRATOR = _load_script(
            Path(__file__).with_name("integrate-company-benefits-series-batch.py"),
            "series_batch_integrator",
        )
    return _BATCH_INTEGRATOR


_BATCH_INTEGRATOR = None
_PRODUCTION_BATCH_INTEGRATOR = _batch_integrator()
PACKAGE_FILES = tuple(_PRODUCTION_BATCH_INTEGRATOR.CURRENT_FILES)
PACKAGE_MEMBERS = tuple(sorted(_PRODUCTION_BATCH_INTEGRATOR.CURRENT_ALLOWED_FILES))
# Package filename -> (final ledger filename, stable identity field).
MERGED_PACKAGE_LEDGER_FIELDS = {
    **{
        filename: (filename, _PRODUCTION_BATCH_INTEGRATOR.ID_FIELDS[filename])
        for filename in _PRODUCTION_BATCH_INTEGRATOR.V2_TARGETS
    },
    "verified-benefits.jsonl": ("verified-benefits.jsonl", "benefit_id"),
    "company-category-outcomes.jsonl": ("company-category-outcomes.jsonl", "cell_id"),
    "series-batch-approval.jsonl": ("series-batch-approvals.jsonl", "batch_id"),
}
MERGED_LEDGER_FIELDS = {
    target: field for target, field in MERGED_PACKAGE_LEDGER_FIELDS.values()
}
CANONICAL_CELL_ORDER_LEDGERS = {
    "company-category-cells.jsonl", "research-attempts.jsonl",
    "company-category-outcomes.jsonl",
}
# At most 80 new package inventories plus one existing 80-package series are
# live while a merge pass writes an equally sized set of intermediate runs.
MAX_LEDGER_SPOOL_BYTES = 4 * 80 * _PRODUCTION_BATCH_INTEGRATOR.MAX_PACKAGE_BYTES


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


def _read_current_package_bytes(path):
    """Use the production protocol inventory and bounded no-follow reader."""
    integrator = _batch_integrator()
    return integrator.series.read_bounded_regular_files(
        Path(os.path.abspath(path)), integrator.CURRENT_ALLOWED_FILES,
        integrator.MAX_PACKAGE_FILE_BYTES, integrator.MAX_PACKAGE_BYTES,
        "integration package",
    )


def snapshot_package(source, target):
    """Snapshot one complete package from a single bounded byte read."""
    raw = _read_current_package_bytes(source)
    target = Path(target)
    target.mkdir(mode=0o700)
    try:
        for name, value in raw.items():
            (target / name).write_bytes(value)
    except BaseException:
        shutil.rmtree(target, ignore_errors=True)
        raise
    return target


def spool_loaded_package(spool_root, position, manifest, records, spool_budget=None):
    """Write one production-loaded package as bounded, sorted ledger runs."""
    spool_root = Path(spool_root)
    current = manifest.get("schema_version") == "2"
    for package_name, (target, field) in MERGED_PACKAGE_LEDGER_FIELDS.items():
        if package_name in _PRODUCTION_BATCH_INTEGRATOR.CURRENT_EXTRA_FILES + ("series-batch-approval.jsonl",) and not current:
            continue
        values = records[package_name]
        run = spool_root / target / f"{position:02d}.jsonl"
        run.parent.mkdir(parents=True, exist_ok=True)
        ordered = values if target in CANONICAL_CELL_ORDER_LEDGERS else sorted(values, key=lambda item: item[field])
        raw = series.jsonl_bytes(ordered)
        if spool_budget is not None:
            spool_budget.reserve(len(raw))
        try:
            run.write_bytes(raw)
        except BaseException:
            if spool_budget is not None:
                spool_budget.release(len(raw))
            run.unlink(missing_ok=True)
            raise


def _iter_sorted_jsonl(path, field, sort_key=None):
    """Stream a sorted JSONL run and reject ordering/schema drift."""
    previous = None
    with Path(path).open("r", encoding="utf-8") as source:
        for line_number, line in enumerate(source, 1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"invalid spooled JSONL at {path}:{line_number}") from exc
            identity = record.get(field) if isinstance(record, dict) else None
            if not isinstance(identity, str) or not identity:
                raise ValueError(f"invalid {field} in spooled ledger {path}:{line_number}")
            order = sort_key(record) if sort_key is not None else identity
            if previous is not None and order < previous:
                raise ValueError(f"spooled ledger is not sorted by {field}: {path}")
            previous = order
            yield record


def _merge_run_group(target, runs, field, spool_budget=None, sort_key=None):
    """Merge one descriptor-bounded run group, closing every input eagerly."""
    streams = [_iter_sorted_jsonl(run, field, sort_key) for run in runs]
    written = 0
    previous = None
    seen = set() if sort_key is not None else None
    try:
        with Path(target).open("wb") as output:
            for record in heapq.merge(*streams, key=sort_key or (lambda item: item[field])):
                identity = record[field]
                if identity == previous or (seen is not None and identity in seen):
                    raise ValueError(f"duplicate {field} while finalizing {Path(target).name}: {identity}")
                previous = identity
                if seen is not None:
                    seen.add(identity)
                raw = series.json_bytes(record) + b"\n"
                if spool_budget is not None:
                    spool_budget.reserve(len(raw))
                try:
                    output.write(raw)
                except BaseException:
                    if spool_budget is not None:
                        spool_budget.release(len(raw))
                    raise
                written += len(raw)
    except BaseException:
        if spool_budget is not None and written:
            spool_budget.release(written)
        Path(target).unlink(missing_ok=True)
        raise
    finally:
        for stream in streams:
            stream.close()
    return written


def _write_merged_ledger(target, runs, field, merge_root=None, spool_budget=None, sort_key=None):
    """Deterministically multi-pass merge runs and write the final ledger once."""
    runs = [Path(run) for run in runs]
    if len(runs) <= MERGE_FAN_IN:
        _merge_run_group(target, runs, field, sort_key=sort_key)
        return

    merge_root = Path(merge_root) if merge_root is not None else Path(target).parent / ".merge-runs"
    merge_root.mkdir(parents=True, exist_ok=False)
    owned_sizes = {}
    current = runs
    pass_number = 0
    try:
        while len(current) > MERGE_FAN_IN:
            next_runs = []
            for group_number, start in enumerate(range(0, len(current), MERGE_FAN_IN)):
                group = current[start:start + MERGE_FAN_IN]
                if len(group) == 1:
                    next_runs.append(group[0])
                    continue
                intermediate = merge_root / f"pass-{pass_number:02d}-{group_number:02d}.jsonl"
                owned_sizes[intermediate] = _merge_run_group(
                    intermediate, group, field, spool_budget=spool_budget,
                    sort_key=sort_key,
                )
                next_runs.append(intermediate)
            retained = set(next_runs)
            for run in current:
                if run in owned_sizes and run not in retained:
                    run.unlink()
                    size = owned_sizes.pop(run)
                    if spool_budget is not None:
                        spool_budget.release(size)
            current = next_runs
            pass_number += 1
        _merge_run_group(target, current, field, sort_key=sort_key)
    finally:
        for run, size in list(owned_sizes.items()):
            run.unlink(missing_ok=True)
            if spool_budget is not None:
                spool_budget.release(size)
        shutil.rmtree(merge_root, ignore_errors=True)


def _budget_existing_spools(spool_root):
    budget = LedgerSpoolBudget(MAX_LEDGER_SPOOL_BYTES)
    for path in Path(spool_root).glob("*/*.jsonl"):
        budget.reserve(path.stat().st_size)
    return budget


def merge_spooled_ledgers(staged, spool_root, spool_budget=None):
    """Descriptor-bounded merge of each ledger with one final write per ledger."""
    staged, spool_root = Path(staged), Path(spool_root)
    spool_budget = spool_budget or _budget_existing_spools(spool_root)
    batches_path = staged / "series-batches.jsonl"
    company_position = ({
        company_id: position
        for position, company_id in enumerate(
            company_id
            for batch in series.read_jsonl(batches_path)
            for company_id in batch["company_ids"]
        )
    } if batches_path.is_file() else {})
    category_position = {category: position for position, category in enumerate(series.V2_CATEGORIES)}

    def canonical_cell_key(record):
        return (company_position[record["company_id"]], category_position[record["category_id"]])

    def canonical_attempt_key(record):
        return (*canonical_cell_key(record), record["route_id"])

    for target, field in MERGED_LEDGER_FIELDS.items():
        ledger_spool = spool_root / target
        ledger_spool.mkdir(parents=True, exist_ok=True)
        existing = staged / target
        existing_run = ledger_spool / "00-existing.jsonl"
        existing_size = existing.stat().st_size if existing.is_file() else 0
        spool_budget.reserve(existing_size)
        if existing.is_file():
            os.replace(existing, existing_run)
        else:
            existing_run.write_bytes(b"")
        runs = [existing_run, *sorted(ledger_spool.glob("[0-9][0-9].jsonl"))]
        _write_merged_ledger(
            existing, runs, field,
            merge_root=ledger_spool / ".merge-runs",
            spool_budget=spool_budget,
            sort_key=(canonical_attempt_key if company_position and target == "research-attempts.jsonl"
                      else canonical_cell_key if company_position and target in CANONICAL_CELL_ORDER_LEDGERS
                      else None),
        )
        released = sum(path.stat().st_size for path in runs)
        shutil.rmtree(ledger_spool)
        spool_budget.release(released)
    spool_root.rmdir()


def prevalidate_manifest(manifest_path, research_root, batches=None, loader=None, spool_root=None):
    """Validate all package identities and global identifiers without mutating the workspace."""
    batches = list(batches if batches is not None else canonical_batches(research_root))
    if len(batches) != 80:
        raise ValueError("canonical series must contain exactly 80 batches")
    loader = loader or load_batch_package
    paths = _read_manifest(manifest_path)
    resolved_paths = [Path(os.path.abspath(path)) for path in paths]
    if len(set(resolved_paths)) != len(resolved_paths):
        raise ValueError("duplicate package path in explicit manifest")

    research_root = Path(research_root)
    packages = []
    seen = {name: set() for name in COLLISION_FIELDS}
    compact_state_bytes = 0
    spool_budget = LedgerSpoolBudget(MAX_LEDGER_SPOOL_BYTES) if spool_root is not None else None

    def retain_compact(value, overhead=0):
        nonlocal compact_state_bytes
        compact_state_bytes += len(canonical_json(value)) + overhead
        if compact_state_bytes > MAX_COMPACT_STATE_BYTES:
            raise ValueError("aggregate compact prevalidation state exceeds practical ceiling")

    for name, field in (("verified-benefits.jsonl", "benefit_id"),
                        ("company-category-outcomes.jsonl", "cell_id")):
        target = research_root / name
        if target.is_file():
            seen[name].update(item.get(field) for item in series.read_jsonl(target))
    approval_path = research_root / "series-batch-approvals.jsonl"
    canonical_approvals = series.read_jsonl(approval_path) if approval_path.is_file() else []
    replay_identities = {
        field: {item.get(field) for item in canonical_approvals}
        for field in ("package_sha256", "reviewer_receipt_sha256")
    }
    for values in (*seen.values(), *replay_identities.values()):
        for value in values:
            retain_compact(value, COMPACT_ID_OVERHEAD_BYTES)
    inventory = []
    for position, (path, expected) in enumerate(zip(resolved_paths, batches), 1):
        package_raw = _read_current_package_bytes(path)
        manifest, batch, records = loader(path, research_root)
        expected_id = expected.get("batch_id")
        actual_id = manifest.get("batch_id")
        if actual_id != expected_id or batch.get("batch_id") != expected_id:
            raise ValueError(f"package manifest is not in canonical order at position {position}: expected {expected_id}, got {actual_id}")
        if manifest.get("status") != "approved":
            raise ValueError(f"{actual_id}: package is not approved")
        approvals = records.get("series-batch-approval.jsonl")
        if not isinstance(approvals, list) or len(approvals) != 1 or not isinstance(approvals[0], dict):
            raise ValueError(f"{actual_id}: package requires exactly one canonical approval row")
        approval = approvals[0]
        for field, values in replay_identities.items():
            value = approval.get(field)
            if value in values:
                raise ValueError("approved package/receipt identity is copied or replayed")
            values.add(value)
            retain_compact(value, COMPACT_ID_OVERHEAD_BYTES)
        for filename, field in COLLISION_FIELDS.items():
            values = [item.get(field) for item in records[filename]]
            collisions = seen[filename].intersection(values)
            if collisions:
                raise ValueError(f"global {field} collision across packages: {sorted(collisions)[0]}")
            seen[filename].update(values)
            for value in values:
                retain_compact(value, COMPACT_ID_OVERHEAD_BYTES)
        file_hashes = {name: sha256(package_raw[name]) for name in PACKAGE_MEMBERS}
        inventory_entry = {"batch_id": actual_id, "files": file_hashes}
        compact_manifest = {
            key: manifest.get(key)
            for key in ("schema_version", "batch_id", "status", "approved_at", "reviewer_id")
        }
        compact_batch = {
            key: batch.get(key) for key in ("batch_id", "scope", "batch_number")
        }
        retain_compact(inventory_entry)
        retain_compact(compact_manifest)
        retain_compact(compact_batch)
        if spool_root is not None:
            spool_loaded_package(spool_root, position, manifest, records, spool_budget)
        inventory.append(inventory_entry)
        packages.append(ApprovedPackage(path, compact_manifest, compact_batch))
        del package_raw, records
    run_digest = sha256(canonical_json({"schema_version": "1", "packages": inventory}))
    return ValidatedRun(packages, inventory, run_digest, spool_root, spool_budget)


def snapshot_package_manifest(manifest_path, workspace):
    """Copy explicit package inputs once, then validate and integrate only those bytes."""
    snapshots = Path(workspace) / "packages"
    snapshots.mkdir()
    copied = []
    for position, source in enumerate(_read_manifest(manifest_path), 1):
        target = snapshots / f"{position:02d}"
        snapshot_package(source, target)
        copied.append(str(target))
    snapshot_manifest = Path(workspace) / "package-paths.json"
    snapshot_manifest.write_bytes(canonical_json({"schema_version": "1", "packages": copied}))
    return snapshot_manifest


def tree_manifest(root):
    return _batch_integrator().research_tree_manifest(root)


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


def materialize_complete_series(staged, packages):
    approval_times = {item.batch["batch_id"]: item.manifest["approved_at"] for item in packages}
    reviewers = {item.batch["batch_id"]: [item.manifest["reviewer_id"]] for item in packages}
    return series.materialize_contract(staged, set(approval_times), approval_times, reviewers, status="complete")


def finalize_series(staged, packages, **kwargs):
    """Render only after package loading and final staged verification."""
    drafts = Path(staged) / "drafts"
    if drafts.exists():
        shutil.rmtree(drafts)
    drafts.mkdir()
    renderer = _load_script(Path(__file__).with_name("render-company-benefits-drafts.py"), "series_transaction_renderer")
    progress = json.loads((Path(staged) / "series-progress.json").read_bytes())
    for item in packages:
        renderer._render_verified_batch(
            staged, drafts, item.batch["scope"], item.batch["batch_number"],
            as_of=kwargs.get("as_of"),
        )
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
    if progress.get("progress_version") == "2":
        # V2 claim/no-claim counters are cell outcomes (250 per batch), not
        # company outcomes. Canonical approved batches account for 25 companies.
        accounted = approved * series.BATCH_SIZE
    else:
        accounted = sum(item.get("claim_count", 0) + item.get("no_claim_count", 0) for item in entries)
    cells = sum(item.get("cell_count", 0) for item in entries)
    if progress.get("status") != "complete" or approved != 80 or accounted != 2000 or cells != 20000:
        raise ValueError(f"completion gate failed: {approved}/80 approved, {accounted}/2000 accounted, and {cells}/20000 cells")
    return approved, accounted, cells


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
    active_cells = sum(item.get("cell_count", 0) for item in active_progress.get("batches", []))
    if active_progress.get("status") == "complete" and active_cells == 20000:
        raise ValueError("series is already complete; duplicate ingestion is prohibited")
    active_root = _batch_integrator().capture_active_root(research_root)
    before_digest = active_root[2]
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
        spool_root = temporary / "ledger-spools"
        validated = prevalidate_manifest(
            snapshot_manifest, staged, batches, load_batch_package, spool_root=spool_root,
        )
        arguments = {
            "freeze_anchor_receipt": freeze_anchor_receipt,
            "effective_selection_receipt": effective_selection_receipt,
            "as_of": as_of,
        }
        merge_spooled_ledgers(staged, validated.spool_root, validated.spool_budget)
        merged_packages = validated.packages
        approval_times = {
            item.batch["batch_id"]: item.manifest["approved_at"]
            for item in merged_packages
        }
        if any(item.manifest.get("schema_version") == "2" for item in merged_packages):
            _batch_integrator().validate_merged_current_outcomes(staged, approval_times)
        materialize_complete_series(staged, merged_packages)
        errors = verify_staged(staged, **arguments)
        if errors:
            raise ValueError("final authoritative staged verification failed:\n" + "\n".join(errors))
        progress = finalize_series(staged, merged_packages, **arguments)
        approved, accounted, cells = _completion_counts(progress)
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
            "explicit_cells": cells,
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
            _batch_integrator().assert_active_root_unchanged(research_root, active_root)
            _write_receipt_exclusive(receipt, result)
            return result
        _fsync_tree(staged)
        _write_receipt_exclusive(receipt, result)
        exchanged = False
        try:
            _batch_integrator().assert_active_root_unchanged(research_root, active_root)
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
    """Serialize snapshot through cleanup on the shared publisher lock."""
    research_root = Path(research_root)
    if research_root.is_symlink():
        raise ValueError("research root symlinks are prohibited")
    research_root = research_root.resolve(strict=True)
    with _batch_integrator().acquire_publisher_lock(research_root):
        return _integrate_series_locked(manifest_path, research_root, receipt_path, freeze_anchor_receipt,
                                        effective_selection_receipt, as_of, dry_run)


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
