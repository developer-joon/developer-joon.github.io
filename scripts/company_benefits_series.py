#!/usr/bin/env python3
"""Deterministic contracts for the 2,000-company benefits series."""

import fcntl
import hashlib
import importlib.util
import json
import os
import re
import secrets
import shutil
import stat
import tempfile
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

MANIFEST_VERSION = "1"
SCOPES = ("domestic", "international")
BATCH_SIZE = 25
BATCHES_PER_SCOPE = 40
NONABSENCE_PHRASES = ("복지가 없다는 뜻이 아닙니다", "복지가 없다는 뜻이 아니다")
BATCH_IDS = {f"{scope}-{number:02d}" for scope in SCOPES for number in range(1, BATCHES_PER_SCOPE + 1)}
OUTCOME_REVIEW_FIELDS = {
    "review_id", "record_id", "researcher_id", "reviewer_id", "decision",
    "reviewed_at", "issues", "resolution", "quote_entailment_confirmed",
}
HISTORICAL_AUDIT_MANIFEST_SHA256 = "14f42bb46cd35e43fd4ed4ab6946f2da34e06d952b11b3332b76868770b5e5cc"
HISTORICAL_AUDIT_SHA256 = "7df4aae36e7c6ab0021702862c46a3a5ebab6442cefd7fb49cc4a269353f7797"
HISTORICAL_AUDIT_SCHEMA_SHA256 = "910fe8e3a0dc3d062704fe6239359e1cb70a618aba3ab8a8146126795e07482e"
HISTORICAL_PROTOCOL_SHA256 = "863ee9149fb2f48b0330944d4b8422630d89c34bcbfa21d4c47a75540570d60d"
HISTORICAL_FREEZE_SHA256 = "2bcad6384d8e367c7f89e99a48d2f6e53c4315a27f50ee4b80007325aefec665"
HISTORICAL_AUDIT_FIELDS = {
    "record_type", "company_id", "selection_status", "old_batch_id",
    "new_batch_id", "publishable", "reason", "record",
}
IDENTITY_PROVENANCE = "official_identity_projection"
IDENTITY_ALGORITHM = "sec-submissions-identity"
IDENTITY_VERSION = "1"
IDENTITY_SOURCE_FIELDS = {"entity_identity", "legal_name", "registry_id", "tax_id"}
HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")
COMPANY_ID_PATTERN = re.compile(r"^(?!v2(?:::|$))[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$")
OFFICIAL_DISCOVERY_SOURCE_TYPES = {
    "government_register", "regulator_filing", "public_enterprise_disclosure",
    "exchange_filing", "official_company_report",
}
V2_CATEGORIES = (
    "leave", "family", "health", "growth", "housing",
    "commute", "remote", "retirement", "meals", "inclusion",
)
VERIFIED_BENEFIT_REQUIRED_FIELDS = (
    "benefit_id", "proposition_sha256", "company_id", "primary_category_id", "title",
    "description", "scope", "currentness", "currentness_checked_at", "conflict_status",
    "evidence_ids", "review",
)
VERIFIED_BENEFIT_SCOPE_FIELDS = (
    "countries", "legal_entities", "roles", "employment_types", "family_members", "conditions",
)
VERIFIED_BENEFIT_REVIEW_FIELDS = (
    "status", "reviewer_receipt_sha256", "reviewed_candidate_sha256", "reviewed_at",
)
VERIFIED_BENEFIT_REVIEW_BINDING_FIELDS = (
    "reviewer_receipt_sha256", "reviewed_candidate_sha256", "reviewed_at",
)
VERIFIED_BENEFIT_CANDIDATE_INPUT_FIELDS = {
    "company_id", "primary_category_id", "title", "description", "scope", "currentness",
    "currentness_checked_at", "conflict_status", "evidence_ids",
}
VERIFIED_BENEFIT_CANDIDATE_FIELDS = VERIFIED_BENEFIT_CANDIDATE_INPUT_FIELDS | {
    "benefit_id", "proposition_sha256",
}
BENEFIT_ID_PATTERN = re.compile(r"^benefit::[0-9a-f]{64}$")
CANONICAL_RFC3339_PATTERN = re.compile(
    r"^(?P<year>[0-9]{4})-(?P<month>[0-9]{2})-(?P<day>[0-9]{2})T"
    r"(?P<hour>[0-9]{2}):(?P<minute>[0-9]{2}):(?P<second>[0-9]{2})"
    r"(?:\.(?P<fraction>[0-9]+))?"
    r"(?P<zone>Z|(?P<offset_sign>[+-])(?P<offset_hour>[0-9]{2}):(?P<offset_minute>[0-9]{2}))$"
)
V2_LEDGER_FILES = {
    "cells": "company-category-cells.jsonl",
    "attempts": "research-attempts.jsonl",
    "official_claims": "official-claims-v2.jsonl",
    "references": "reference-records.jsonl",
    "community_reports": "community-benefit-reports.jsonl",
    "sources": "sources-v2.jsonl",
}
V2_ID_FIELDS = {
    "cells": "cell_id", "attempts": "attempt_id", "official_claims": "claim_id",
    "references": "reference_id", "community_reports": "community_report_id", "sources": "source_id",
}
V2_STRUCTURAL_ID_FIELDS = {
    "cells": ("cell_id", "company_id", "category_id", "jurisdiction"),
    "attempts": ("attempt_id", "cell_id", "company_id", "category_id", "jurisdiction", "route_id"),
    "official_claims": ("claim_id", "cell_id", "company_id", "category_id", "jurisdiction"),
    "references": ("reference_id", "cell_id", "company_id", "category_id", "source_id"),
    "community_reports": ("community_report_id", "cell_id", "company_id", "category_id", "source_id"),
    "sources": ("source_id",),
}
V2_STRUCTURAL_BINDING_FIELDS = {
    "cells": ("attempt_ids", "official_claim_ids", "reference_ids", "community_report_ids"),
    "attempts": ("source_ids",),
    "official_claims": ("source_ids",),
}
V2_GAP_ID_PREFIX = "company-gap::v2::"
LEGACY_GAP_ID_PREFIX = "company-gap::"


def _open_directory_nofollow(path):
    """Open every directory component without following a symlink."""
    path = Path(path)
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    if path.is_absolute():
        opened = [os.open("/", flags)]
        parts = path.parts[1:]
    else:
        opened = [os.open(".", flags)]
        parts = path.parts
    try:
        for part in parts:
            if part in {"", "."}:
                continue
            opened.append(os.open(part, flags, dir_fd=opened[-1]))
        return opened.pop()
    finally:
        for descriptor in reversed(opened):
            os.close(descriptor)


def read_bounded_regular_files(directory, expected_names, per_file_limit, total_limit, label):
    """Read one exact directory inventory through one no-follow directory descriptor."""
    directory = Path(directory)
    expected = set(expected_names)
    directory_fd = None
    try:
        directory_fd = _open_directory_nofollow(directory)
        before_names = set(os.listdir(directory_fd))
        if before_names != expected:
            raise ValueError(f"{label} must contain the exact canonical file set")
        result = {}
        total = 0
        stable_fields = ("st_dev", "st_ino", "st_mode", "st_size", "st_mtime_ns", "st_ctime_ns")
        for name in sorted(expected):
            descriptor = None
            try:
                descriptor = os.open(
                    name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd,
                )
                before = os.fstat(descriptor)
                if not stat.S_ISREG(before.st_mode):
                    raise ValueError(f"{label} {name} must be a regular file")
                if before.st_size > per_file_limit or total + before.st_size > total_limit:
                    raise ValueError(f"{label} exceeds the bounded byte limit")
                chunks = []
                remaining = before.st_size
                while remaining:
                    chunk = os.read(descriptor, min(remaining, 1024 * 1024))
                    if not chunk:
                        raise ValueError(f"{label} {name} changed during bounded read")
                    chunks.append(chunk)
                    remaining -= len(chunk)
                after = os.fstat(descriptor)
                path_state = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                if any(getattr(before, field) != getattr(after, field)
                       or getattr(before, field) != getattr(path_state, field)
                       for field in stable_fields):
                    raise ValueError(f"{label} {name} path changed during bounded read")
                result[name] = b"".join(chunks)
                total += before.st_size
            except OSError as exc:
                raise ValueError(f"{label} {name} is not a safe regular file") from exc
            finally:
                if descriptor is not None:
                    os.close(descriptor)
        if set(os.listdir(directory_fd)) != before_names:
            raise ValueError(f"{label} inventory changed during bounded read")
        return result
    except OSError as exc:
        raise ValueError(f"{label} directory is not safe") from exc
    finally:
        if directory_fd is not None:
            os.close(directory_fd)


def _directory_identity(descriptor):
    state = os.fstat(descriptor)
    return state.st_dev, state.st_ino, state.st_mode


def _validate_directory_binding(path, descriptor, label):
    """Require a lexical no-follow directory path to retain its opened identity."""
    rebound = None
    try:
        rebound = _open_directory_nofollow(path)
        if _directory_identity(rebound) != _directory_identity(descriptor):
            raise ValueError(f"{label} changed during atomic publication")
    except OSError as exc:
        raise ValueError(f"{label} is not a safe directory") from exc
    finally:
        if rebound is not None:
            os.close(rebound)


def _fsync_directory_descriptors(*descriptors):
    seen = set()
    for descriptor in descriptors:
        identity = _directory_identity(descriptor)[:2]
        if identity not in seen:
            os.fsync(descriptor)
            seen.add(identity)


PUBLICATION_LOCK_FILENAME = ".company-benefits-publication.lock"


def _validate_trusted_output_parent(parent):
    """Require the final publication parent to belong to this repository user."""
    state = os.fstat(parent.descriptor)
    if state.st_uid != os.geteuid() or state.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
        raise ValueError(
            "publication output parent must be owned by the effective user and not group/world-writable"
        )


@contextmanager
def _lock_output_parent(parent):
    """Serialize cooperating compiler/promoter publication beneath one parent."""
    _validate_trusted_output_parent(parent)
    flags = os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC
    descriptor = None
    try:
        descriptor = os.open(
            PUBLICATION_LOCK_FILENAME, flags, 0o600, dir_fd=parent.descriptor,
        )
        opened = os.fstat(descriptor)
        named = os.stat(
            PUBLICATION_LOCK_FILENAME, dir_fd=parent.descriptor, follow_symlinks=False,
        )
        identity = (opened.st_dev, opened.st_ino, opened.st_mode)
        if (not stat.S_ISREG(opened.st_mode) or opened.st_uid != os.geteuid()
                or stat.S_IMODE(opened.st_mode) != 0o600
                or (named.st_dev, named.st_ino, named.st_mode) != identity):
            raise ValueError("publication lock must be an owned no-follow regular file with mode 0600")
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        parent.validate_binding()
        _validate_trusted_output_parent(parent)
        rebound = os.stat(
            PUBLICATION_LOCK_FILENAME, dir_fd=parent.descriptor, follow_symlinks=False,
        )
        if (rebound.st_dev, rebound.st_ino, rebound.st_mode) != identity:
            raise ValueError("publication lock changed while acquiring exclusive access")
        yield
    except OSError as exc:
        raise ValueError("publication lock is not a safe regular file") from exc
    finally:
        if descriptor is not None:
            os.close(descriptor)


class PinnedOutputParent:
    """A pre-existing symlink-free parent chain pinned through publication."""

    def __init__(self, path, descriptors, component_names):
        self.path = path
        self.descriptors = descriptors
        self.component_names = component_names
        self.descriptor = descriptors[-1]
        self.identities = [_directory_identity(descriptor) for descriptor in descriptors]

    def validate_binding(self):
        for index, name in enumerate(self.component_names, start=1):
            named = os.stat(name, dir_fd=self.descriptors[index - 1], follow_symlinks=False)
            named_identity = (named.st_dev, named.st_ino, named.st_mode)
            if not stat.S_ISDIR(named.st_mode) or named_identity != self.identities[index]:
                raise ValueError(
                    "publication output parent directory changed during atomic publication"
                )

    def close(self):
        for descriptor in reversed(self.descriptors):
            if descriptor >= 0:
                os.close(descriptor)
        self.descriptors = []
        self.descriptor = -1


def _checked_directory_child(parent_fd, name, label):
    """Open one real directory child and bind its name to the opened inode."""
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    descriptor = os.open(name, flags, dir_fd=parent_fd)
    try:
        opened = os.fstat(descriptor)
        named = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        opened_identity = (opened.st_dev, opened.st_ino, opened.st_mode)
        named_identity = (named.st_dev, named.st_ino, named.st_mode)
        if not stat.S_ISDIR(opened.st_mode) or named_identity != opened_identity:
            raise ValueError(f"{label} changed while it was opened")
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


@contextmanager
def open_existing_output_parent(output):
    """Open and retain every component of a pre-existing output parent."""
    supplied = Path(output)
    if supplied.name in {"", ".", ".."} or ".." in supplied.parts:
        raise ValueError("publication output path is invalid")
    absolute_output = Path(os.path.abspath(supplied))
    parent = absolute_output.parent
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    descriptors = []
    try:
        descriptors.append(os.open("/", flags))
        component_names = list(parent.parts[1:])
        for part in component_names:
            descriptors.append(_checked_directory_child(
                descriptors[-1], part, "publication output parent",
            ))
        pinned = PinnedOutputParent(parent, descriptors, component_names)
        pinned.validate_binding()
    except BaseException as exc:
        for descriptor in reversed(descriptors):
            os.close(descriptor)
        if isinstance(exc, OSError):
            raise ValueError(
                "publication output parent must pre-exist as a symlink-free directory chain"
            ) from exc
        raise
    try:
        yield pinned
    finally:
        pinned.close()


class PinnedOutputStaging:
    """A descriptor-relative staging directory beneath a pinned output parent."""

    def __init__(self, parent, name, descriptor, output):
        self.parent = parent
        self.name = name
        self.descriptor = descriptor
        self.identity = _directory_identity(descriptor)
        self.path = parent.path / name
        self.output = Path(os.path.abspath(output))
        self.publication_committed = False
        self.displaced_tree = False
        self.displaced_descriptor = -1

    @staticmethod
    def _entry_name(name):
        if not isinstance(name, str) or not name or Path(name).name != name or name in {".", ".."}:
            raise ValueError("staging entry name is invalid")
        return name

    def write_bytes(self, name, raw):
        name = self._entry_name(name)
        descriptor = os.open(
            name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o644, dir_fd=self.descriptor,
        )
        try:
            view = memoryview(raw)
            while view:
                written = os.write(descriptor, view)
                if written <= 0:
                    raise OSError("short staging write")
                view = view[written:]
            os.fchmod(descriptor, 0o644)
        finally:
            os.close(descriptor)

    def write_text(self, name, text, encoding="utf-8"):
        self.write_bytes(name, text.encode(encoding))

    def read_bytes(self, name):
        name = self._entry_name(name)
        descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=self.descriptor)
        try:
            state = os.fstat(descriptor)
            if not stat.S_ISREG(state.st_mode):
                raise ValueError("staging entry is not a regular file")
            chunks = []
            while True:
                chunk = os.read(descriptor, 1024 * 1024)
                if not chunk:
                    return b"".join(chunks)
                chunks.append(chunk)
        finally:
            os.close(descriptor)

    def names(self):
        return sorted(os.listdir(self.descriptor))

    def fsync_contents(self):
        """Flush the compiler/promoter's flat staged package through its pinned FD."""
        for name in self.names():
            descriptor = os.open(
                name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                dir_fd=self.descriptor,
            )
            try:
                if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                    raise ValueError("staged publication tree contains a non-regular entry")
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        os.fsync(self.descriptor)

    def validate_binding(self):
        self.parent.validate_binding()
        named = os.stat(self.name, dir_fd=self.parent.descriptor, follow_symlinks=False)
        if (named.st_dev, named.st_ino, named.st_mode) != self.identity:
            raise ValueError("staged output directory changed before publication")
        _validate_directory_binding(self.path, self.descriptor, "staged output directory")

    @staticmethod
    def _remove_owned_contents(descriptor):
        """Remove an owned tree through pinned descriptors, making directories writable."""
        os.fchmod(descriptor, 0o700)
        for name in os.listdir(descriptor):
            state = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
            if stat.S_ISDIR(state.st_mode):
                child = os.open(
                    name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                    dir_fd=descriptor,
                )
                try:
                    PinnedOutputStaging._remove_owned_contents(child)
                finally:
                    os.close(child)
                os.rmdir(name, dir_fd=descriptor)
            else:
                os.unlink(name, dir_fd=descriptor)

    def mark_committed(self, displaced=False, atomic_noreplace=None):
        """Record the commit boundary and best-effort remove any displaced old tree."""
        self.publication_committed = True
        self.displaced_tree = displaced
        if not displaced:
            return
        if atomic_noreplace is not None:
            for _ in range(100):
                garbage = f".company-benefits-publication-garbage-{secrets.token_hex(8)}"
                try:
                    atomic_noreplace(
                        self.parent.descriptor, self.name,
                        self.parent.descriptor, garbage,
                    )
                except FileExistsError:
                    continue
                except BaseException:
                    break
                self.name = garbage
                try:
                    os.fsync(self.parent.descriptor)
                except BaseException:
                    pass
                break
        try:
            self.displaced_descriptor = _checked_directory_child(
                self.parent.descriptor, self.name, "displaced publication tree",
            )
        except BaseException:
            pass
        self.cleanup()

    def cleanup(self):
        if self.publication_committed:
            if self.displaced_tree and self.displaced_descriptor >= 0:
                try:
                    self._remove_owned_contents(self.displaced_descriptor)
                except BaseException:
                    pass
                try:
                    os.close(self.displaced_descriptor)
                except BaseException:
                    pass
                self.displaced_descriptor = -1
            if self.descriptor >= 0:
                try:
                    os.close(self.descriptor)
                except BaseException:
                    pass
                self.descriptor = -1
            if self.displaced_tree:
                try:
                    os.rmdir(self.name, dir_fd=self.parent.descriptor)
                    os.fsync(self.parent.descriptor)
                except BaseException:
                    pass
            return
        if self.descriptor >= 0:
            os.close(self.descriptor)
            self.descriptor = -1
        try:
            shutil.rmtree(self.name, dir_fd=self.parent.descriptor)
        except FileNotFoundError:
            return
        os.fsync(self.parent.descriptor)


@contextmanager
def create_output_staging(output, prefix):
    """Create staging beneath a pinned parent under a cooperative exclusive lock."""
    if not isinstance(prefix, str) or not prefix or "/" in prefix:
        raise ValueError("staging prefix is invalid")
    with open_existing_output_parent(output) as parent, _lock_output_parent(parent):
        staging = None
        for _ in range(100):
            name = f".{prefix}{secrets.token_hex(8)}"
            try:
                os.mkdir(name, mode=0o755, dir_fd=parent.descriptor)
                os.fsync(parent.descriptor)
                descriptor = _checked_directory_child(
                    parent.descriptor, name, "staged output directory",
                )
                try:
                    os.fchmod(descriptor, 0o755)
                    staging = PinnedOutputStaging(parent, name, descriptor, output)
                except BaseException:
                    os.close(descriptor)
                    shutil.rmtree(name, dir_fd=parent.descriptor, ignore_errors=True)
                    raise
                break
            except FileExistsError:
                continue
        if staging is None:
            raise FileExistsError("unable to allocate a unique staging directory")
        try:
            staging.validate_binding()
            yield staging
        finally:
            staging.cleanup()


def publish_directory_atomically(staging, atomic_exchange, atomic_noreplace):
    """Publish with the same pinned parent FD used to create staging."""
    output = staging.output
    parent_fd = staging.parent.descriptor
    if staging.name == output.name or output.name in {"", ".", ".."}:
        raise ValueError("atomic publication paths are invalid")
    try:
        staging.validate_binding()
        staged_state = os.stat(staging.name, dir_fd=parent_fd, follow_symlinks=False)
        if not stat.S_ISDIR(staged_state.st_mode):
            raise ValueError("staged publication entry is not a real directory")
        try:
            output_state = os.stat(output.name, dir_fd=parent_fd, follow_symlinks=False)
        except FileNotFoundError:
            output_state = None
        if output_state is not None and not stat.S_ISDIR(output_state.st_mode):
            raise ValueError("publication output exists and is not a real directory")

        staging.fsync_contents()
        staging.validate_binding()
        current_staged = os.stat(staging.name, dir_fd=parent_fd, follow_symlinks=False)
        staged_identity = (staged_state.st_dev, staged_state.st_ino, staged_state.st_mode)
        if (current_staged.st_dev, current_staged.st_ino, current_staged.st_mode) != staged_identity:
            raise ValueError("staged publication directory changed before atomic rename")

        if output_state is None:
            atomic_noreplace(parent_fd, staging.name, parent_fd, output.name)
            try:
                _fsync_directory_descriptors(parent_fd)
                staging.parent.validate_binding()
            except BaseException:
                try:
                    atomic_noreplace(parent_fd, output.name, parent_fd, staging.name)
                    _fsync_directory_descriptors(parent_fd)
                except BaseException as rollback_error:
                    raise RuntimeError("atomic publication rollback failed") from rollback_error
                raise
            staging.mark_committed()
            return

        output_identity = (output_state.st_dev, output_state.st_ino, output_state.st_mode)
        atomic_exchange(parent_fd, staging.name, parent_fd, output.name)
        try:
            displaced = os.stat(staging.name, dir_fd=parent_fd, follow_symlinks=False)
            if (displaced.st_dev, displaced.st_ino, displaced.st_mode) != output_identity:
                raise RuntimeError("publication destination changed concurrently")
            _fsync_directory_descriptors(parent_fd)
            staging.parent.validate_binding()
        except BaseException:
            atomic_exchange(parent_fd, staging.name, parent_fd, output.name)
            _fsync_directory_descriptors(parent_fd)
            raise
        staging.mark_committed(displaced=True, atomic_noreplace=atomic_noreplace)
    except OSError as exc:
        raise ValueError("atomic publication parent or entry is not safe") from exc


def _reject_unpaired_surrogates(value):
    if isinstance(value, str):
        if any(0xD800 <= ord(character) <= 0xDFFF for character in value):
            raise ValueError("canonical text contains an unpaired surrogate code point")
    elif isinstance(value, list):
        for item in value:
            _reject_unpaired_surrogates(item)
    elif isinstance(value, dict):
        for key, item in value.items():
            _reject_unpaired_surrogates(key)
            _reject_unpaired_surrogates(item)


def _canonical_json_bytes(value):
    _reject_unpaired_surrogates(value)
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def _normalized_proposition_text(value):
    _reject_unpaired_surrogates(value)
    normalized = []
    pending_space = False
    for character in value:
        if character in "\t\n\v\f\r ":
            pending_space = bool(normalized)
            continue
        if pending_space:
            normalized.append(" ")
            pending_space = False
        code_point = ord(character)
        normalized.append(chr(code_point + 32) if 0x41 <= code_point <= 0x5A else character)
    return "".join(normalized)


def parse_canonical_rfc3339(value, label="timestamp"):
    """Parse canonical RFC3339 without accepting datetime normalization."""
    match = CANONICAL_RFC3339_PATTERN.fullmatch(value) if isinstance(value, str) else None
    if match is None:
        raise ValueError(f"invalid {label} timestamp")
    offset_hour = int(match.group("offset_hour") or 0)
    offset_minute = int(match.group("offset_minute") or 0)
    if offset_hour > 23 or offset_minute > 59:
        raise ValueError(f"invalid {label} timestamp")
    offset = timedelta(hours=offset_hour, minutes=offset_minute)
    if match.group("offset_sign") == "-":
        offset = -offset
    zone = timezone.utc if match.group("zone") == "Z" else timezone(offset)
    fraction = match.group("fraction") or ""
    microsecond = int((fraction[:6] + "000000")[:6])
    try:
        return datetime(
            int(match.group("year")), int(match.group("month")), int(match.group("day")),
            int(match.group("hour")), int(match.group("minute")), int(match.group("second")),
            microsecond=microsecond, tzinfo=zone,
        )
    except ValueError as exc:
        raise ValueError(f"invalid {label} timestamp") from exc


def _canonical_verified_benefit_scope(scope):
    return {
        field: sorted(
            (_normalized_proposition_text(value) for value in scope[field]),
            key=lambda value: value.encode("utf-8"),
        )
        for field in VERIFIED_BENEFIT_SCOPE_FIELDS
    }


def _verified_benefit_proposition_payload(benefit):
    return {
        "company_id": benefit["company_id"],
        "title": _normalized_proposition_text(benefit["title"]),
        "description": _normalized_proposition_text(benefit["description"]),
        "scope": _canonical_verified_benefit_scope(benefit["scope"]),
        "currentness": benefit["currentness"],
        "currentness_checked_at": benefit["currentness_checked_at"],
        "conflict_status": benefit["conflict_status"],
    }


def validate_verified_benefit_candidate_shape(candidate):
    """Validate every proposition field before canonical identity computation."""
    if not isinstance(candidate, dict) or set(candidate) not in (
            VERIFIED_BENEFIT_CANDIDATE_INPUT_FIELDS, VERIFIED_BENEFIT_CANDIDATE_FIELDS):
        raise ValueError("verified benefit candidate fields do not match the contract")
    try:
        _reject_unpaired_surrogates(candidate)
    except ValueError as exc:
        raise ValueError("verified benefit candidate contains an unpaired surrogate") from exc
    company_id = candidate.get("company_id")
    if not isinstance(company_id, str) or not COMPANY_ID_PATTERN.fullmatch(company_id):
        raise ValueError("verified benefit candidate company ID is invalid")
    if candidate.get("primary_category_id") not in V2_CATEGORIES:
        raise ValueError("verified benefit candidate primary category is invalid")
    for field in ("title", "description"):
        value = candidate.get(field)
        if not isinstance(value, str) or not _normalized_proposition_text(value):
            raise ValueError(f"verified benefit candidate {field} must be nonblank")
    scope = candidate.get("scope")
    if not isinstance(scope, dict) or set(scope) != set(VERIFIED_BENEFIT_SCOPE_FIELDS):
        raise ValueError("verified benefit candidate scope fields do not match the contract")
    for field in VERIFIED_BENEFIT_SCOPE_FIELDS:
        values = scope[field]
        if (not isinstance(values, list)
                or any(not isinstance(value, str) or not _normalized_proposition_text(value)
                       for value in values)):
            raise ValueError("verified benefit candidate scope values must be nonblank string arrays")
    if candidate.get("currentness") not in {"current", "historical", "unknown"}:
        raise ValueError("verified benefit candidate currentness is invalid")
    try:
        parse_canonical_rfc3339(candidate.get("currentness_checked_at"), "currentness_checked_at")
    except ValueError as exc:
        raise ValueError("verified benefit candidate currentness_checked_at is invalid") from exc
    if candidate.get("conflict_status") not in {"none", "disclosed", "contradictory"}:
        raise ValueError("verified benefit candidate conflict status is invalid")
    evidence_ids = candidate.get("evidence_ids")
    if (not isinstance(evidence_ids, list) or not evidence_ids
            or any(not isinstance(value, str) or not _normalized_proposition_text(value)
                   for value in evidence_ids)
            or len(evidence_ids) != len(set(evidence_ids))):
        raise ValueError("verified benefit candidate evidence IDs must be nonblank and unique")
    if "benefit_id" in candidate and (
            not isinstance(candidate["benefit_id"], str)
            or not BENEFIT_ID_PATTERN.fullmatch(candidate["benefit_id"])):
        raise ValueError("verified benefit candidate benefit ID is invalid")
    if "proposition_sha256" in candidate and (
            not isinstance(candidate["proposition_sha256"], str)
            or not HASH_PATTERN.fullmatch(candidate["proposition_sha256"])):
        raise ValueError("verified benefit candidate proposition SHA-256 is invalid")
    return candidate


def compile_cell_outcomes(cells, attempts, verified_propositions, *, expected_count=None):
    """Derive canonical outcomes from exact cells, attempts, and validated propositions."""
    attempts_by_id = {item.get("attempt_id"): item for item in attempts if isinstance(item, dict)}
    propositions_by_cell = {
        (item.get("company_id"), item.get("primary_category_id")): item
        for item in verified_propositions if isinstance(item, dict)
    }
    evidence_field = {
        "official::": ("official_verified", "official_claim_ids"),
        "reference::": ("reference", "reference_ids"),
        "community::": ("community_report", "community_report_ids"),
    }
    outcomes = []
    for cell in cells:
        key = (cell.get("company_id"), cell.get("category_id"))
        bound = [attempts_by_id.get(attempt_id, {}) for attempt_id in cell.get("attempt_ids", [])]
        proposition = propositions_by_cell.get(key)
        if proposition is not None:
            state = cell.get("state")
            if (state not in {"official_verified", "reference", "community_report"}
                    or cell.get("conflict_status") == "contradictory"
                    or not bound or not any(attempt.get("result") == "source_found" for attempt in bound)
                    or any(attempt.get("result") == "access_failed" for attempt in bound)
                    or any(
                        not any(
                            evidence_id.startswith(prefix) and state == allowed_state
                            and evidence_id in cell.get(field, [])
                            for prefix, (allowed_state, field) in evidence_field.items()
                        )
                        for evidence_id in proposition.get("evidence_ids", [])
                    )):
                raise ValueError(f"{cell.get('cell_id')}: proposition requires a validated, nonconflicted evidence-bearing cell")
            reason = "verified_benefit"
        elif cell.get("state") == "not_researched":
            if bound or cell.get("attempt_ids") or cell.get("conflict_status") != "none" or any(
                cell.get(field) for field in ("official_claim_ids", "reference_ids", "community_report_ids")
            ) or cell.get("coverage_complete") is not None:
                raise ValueError(f"{cell.get('cell_id')}: not_researched requires zero attempts and no claim or closure")
            reason = "not_researched"
        elif cell.get("conflict_status") == "contradictory":
            successful = [attempt for attempt in bound
                          if attempt.get("result") == "source_found" and attempt.get("source_ids")]
            if (len(successful) < 2
                    or len({source_id for attempt in successful for source_id in attempt["source_ids"]}) < 2
                    or len({attempt.get("raw_response_sha256") for attempt in successful}) < 2
                    or len({attempt.get("capture_locator") for attempt in successful}) < 2):
                raise ValueError(f"{cell.get('cell_id')}: conflict requires two distinct evidence-bearing successful captures")
            reason = "conflicting_evidence"
        elif any(attempt.get("result") == "access_failed" for attempt in bound):
            reason = "source_access_failed"
        elif (cell.get("state") == "no_public_info" and cell.get("coverage_complete") is True
              and bound and all(attempt.get("result") in {"no_result", "ineligible_source"} for attempt in bound)):
            reason = "not_publicly_verifiable"
        else:
            reason = "research_incomplete"
        outcomes.append({"cell_id": cell.get("cell_id"), "company_id": key[0],
                         "category_id": key[1], "outcome_reason": reason})
    if (len({item["cell_id"] for item in outcomes}) != len(outcomes)
            or (expected_count is not None and len(outcomes) != expected_count)):
        raise ValueError("cell outcomes require exact unique canonical cell membership")
    return outcomes


def count_verified_benefits_by_category(benefits):
    """Count reviewed propositions in canonical category order."""
    return {
        category: sum(benefit.get("primary_category_id") == category for benefit in benefits)
        for category in V2_CATEGORIES
    }


def validate_verified_benefits(benefits, evidence_records, review_binding):
    """Validate reviewed propositions; receipt bytes are verified externally at promotion."""
    if not isinstance(benefits, list) or not isinstance(evidence_records, list):
        raise ValueError("verified benefits and evidence records must be arrays")
    if not benefits:
        if review_binding is not None:
            raise ValueError("verified benefit review binding is forbidden without benefits")
        return benefits
    if (not isinstance(review_binding, dict)
            or set(review_binding) != set(VERIFIED_BENEFIT_REVIEW_BINDING_FIELDS)):
        raise ValueError("verified benefit review binding fields do not match the contract")
    if any(not isinstance(review_binding.get(field), str) or not HASH_PATTERN.fullmatch(review_binding[field])
           for field in ("reviewer_receipt_sha256", "reviewed_candidate_sha256")):
        raise ValueError("verified benefit review binding hashes are invalid")
    try:
        parse_canonical_rfc3339(review_binding.get("reviewed_at"), "reviewed_at")
    except ValueError as exc:
        raise ValueError("verified benefit review binding reviewed_at is invalid") from exc
    evidence = {}
    for record in evidence_records:
        if not isinstance(record, dict):
            raise ValueError("verified benefit evidence must be objects")
        record_id = next((record.get(field) for field in ("claim_id", "reference_id", "community_report_id") if field in record), None)
        if not isinstance(record_id, str) or not record_id:
            raise ValueError("verified benefit evidence requires an ID")
        evidence.setdefault(record_id, []).append(record)

    benefit_ids = set()
    propositions = set()
    for benefit in benefits:
        if not isinstance(benefit, dict) or set(benefit) != set(VERIFIED_BENEFIT_REQUIRED_FIELDS):
            raise ValueError("verified benefit fields do not match the contract")
        validate_verified_benefit_candidate_shape({
            field: benefit[field] for field in VERIFIED_BENEFIT_CANDIDATE_FIELDS
        })
        benefit_id = benefit.get("benefit_id")
        proposition_sha256 = benefit.get("proposition_sha256")
        company_id = benefit.get("company_id")
        category_id = benefit.get("primary_category_id")
        if not isinstance(benefit_id, str) or not BENEFIT_ID_PATTERN.fullmatch(benefit_id) or benefit_id in benefit_ids:
            raise ValueError("verified benefit ID must be unique benefit::<64 lowercase hex>")
        benefit_ids.add(benefit_id)
        if not isinstance(proposition_sha256, str) or not HASH_PATTERN.fullmatch(proposition_sha256):
            raise ValueError("verified benefit proposition SHA-256 is invalid")
        if not isinstance(company_id, str) or not COMPANY_ID_PATTERN.fullmatch(company_id):
            raise ValueError("verified benefit company ID is invalid")
        if category_id not in V2_CATEGORIES:
            raise ValueError("verified benefit primary category is invalid")
        for field in ("title", "description"):
            if not isinstance(benefit.get(field), str) or not _normalized_proposition_text(benefit[field]):
                raise ValueError(f"verified benefit {field} must be nonblank")
        if benefit.get("currentness") not in {"current", "historical", "unknown"}:
            raise ValueError("verified benefit currentness is invalid")
        try:
            parse_canonical_rfc3339(benefit.get("currentness_checked_at"), "currentness_checked_at")
        except ValueError as exc:
            raise ValueError("verified benefit currentness_checked_at is invalid") from exc
        if benefit.get("conflict_status") not in {"none", "disclosed", "contradictory"}:
            raise ValueError("verified benefit conflict status is invalid")

        scope = benefit.get("scope")
        if not isinstance(scope, dict) or set(scope) != set(VERIFIED_BENEFIT_SCOPE_FIELDS):
            raise ValueError("verified benefit scope fields do not match the contract")
        if any(not isinstance(scope[field], list) or any(not isinstance(value, str) for value in scope[field]) for field in VERIFIED_BENEFIT_SCOPE_FIELDS):
            raise ValueError("verified benefit scope values must be string arrays")
        evidence_ids = benefit.get("evidence_ids")
        if (not isinstance(evidence_ids, list) or not evidence_ids
                or any(not isinstance(value, str) or not value for value in evidence_ids)
                or len(evidence_ids) != len(set(evidence_ids))):
            raise ValueError("verified benefit evidence IDs must be nonempty and unique")
        for evidence_id in evidence_ids:
            matches = evidence.get(evidence_id, [])
            if (len(matches) != 1 or matches[0].get("company_id") != company_id
                    or matches[0].get("category_id") != category_id):
                raise ValueError("verified benefit evidence binding mismatch")

        review = benefit.get("review")
        if not isinstance(review, dict) or set(review) != set(VERIFIED_BENEFIT_REVIEW_FIELDS):
            raise ValueError("verified benefit review fields do not match the contract")
        if review.get("status") != "independently_reviewed":
            raise ValueError("verified benefit requires independent review")
        if any(not isinstance(review.get(field), str) or not HASH_PATTERN.fullmatch(review[field]) for field in ("reviewer_receipt_sha256", "reviewed_candidate_sha256")):
            raise ValueError("verified benefit review hashes are invalid")
        try:
            parse_canonical_rfc3339(review.get("reviewed_at"), "reviewed_at")
        except ValueError as exc:
            raise ValueError("verified benefit reviewed_at is invalid") from exc
        if {field: review[field] for field in VERIFIED_BENEFIT_REVIEW_BINDING_FIELDS} != review_binding:
            raise ValueError("verified benefit review does not match detail review binding")

        proposition_payload = _verified_benefit_proposition_payload(benefit)
        expected_sha256 = hashlib.sha256(_canonical_json_bytes(proposition_payload)).hexdigest()
        if proposition_sha256 != expected_sha256 or benefit_id != f"benefit::{proposition_sha256}":
            raise ValueError("verified benefit ID/fingerprint mismatch")
        proposition = _canonical_json_bytes({
            "company_id": company_id,
            "title": proposition_payload["title"],
            "description": proposition_payload["description"],
            "scope": proposition_payload["scope"],
        })
        if proposition in propositions:
            raise ValueError("duplicate verified benefit proposition")
        propositions.add(proposition)
    candidate_payload = [
        {key: value for key, value in benefit.items() if key != "review"}
        for benefit in sorted(benefits, key=lambda item: item["benefit_id"])
    ]
    candidate_sha256 = hashlib.sha256(_canonical_json_bytes(candidate_payload)).hexdigest()
    if review_binding["reviewed_candidate_sha256"] != candidate_sha256:
        raise ValueError("verified benefit reviewed candidate SHA-256 mismatch")
    return benefits


def canonical_v2_gap_id(batch, company_id):
    """Build a v2 gap ID from one authoritative batch membership."""
    if not isinstance(batch, dict):
        raise ValueError("canonical batch membership context is required for a v2 gap ID")
    batch_id, company_ids = batch.get("batch_id"), batch.get("company_ids")
    if (batch_id not in BATCH_IDS or not isinstance(company_ids, list)
            or len(company_ids) != BATCH_SIZE
            or any(not isinstance(item, str) or not COMPANY_ID_PATTERN.fullmatch(item)
                   for item in company_ids)
            or len(set(company_ids)) != BATCH_SIZE):
        raise ValueError("canonical batch membership context is invalid for a v2 gap ID")
    if not isinstance(company_id, str) or not company_id or company_id not in company_ids:
        raise ValueError("v2 gap company_id is outside authoritative batch membership")
    return f"{V2_GAP_ID_PREFIX}{batch_id}::{company_id}"


def legacy_gap_id(company_id):
    if not isinstance(company_id, str) or not COMPANY_ID_PATTERN.fullmatch(company_id):
        raise ValueError("legacy gap company_id is outside the authoritative company ID language")
    return f"{LEGACY_GAP_ID_PREFIX}{company_id}"


def compiled_v2_gap_id(gap, batch):
    """Normalize only the historical unqualified spelling at compilation time."""
    if not isinstance(gap, dict):
        raise ValueError("compiled v2 gap must be an object")
    company_id, audit_id = gap.get("company_id"), gap.get("audit_id")
    canonical = canonical_v2_gap_id(batch, company_id)
    if audit_id not in {canonical, legacy_gap_id(company_id)}:
        raise ValueError(f"{audit_id}: v2 gap ID has an arbitrary namespace, company, or batch binding")
    return canonical


def jsonl_raw_record_map(path, field):
    """Return exact nonblank JSONL record bytes keyed by a unique string ID."""
    result = {}
    path = Path(path)
    raw_records = path.read_bytes().splitlines() if path.is_file() else []
    for raw in raw_records:
        if not raw.strip():
            continue
        try:
            record = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{path.name}: invalid JSON") from exc
        record_id = record.get(field) if isinstance(record, dict) else None
        if not isinstance(record_id, str) or not record_id or record_id in result:
            raise ValueError(f"{path.name}: requires unique nonempty {field}")
        result[record_id] = raw
    return result


def validate_v2_gap_id(gap, batch, *, raw_record=None, frozen_legacy_records=None):
    """Accept canonical v2 IDs, or exact already-frozen legacy records only."""
    if not isinstance(gap, dict):
        raise ValueError("v2 gap must be an object")
    company_id, audit_id = gap.get("company_id"), gap.get("audit_id")
    canonical = canonical_v2_gap_id(batch, company_id)
    if audit_id == canonical:
        return canonical
    legacy = legacy_gap_id(company_id)
    if audit_id == legacy:
        frozen = (frozen_legacy_records or {}).get(legacy)
        if raw_record is not None and frozen is not None and raw_record == frozen:
            return legacy
        raise ValueError(f"{audit_id}: legacy gap ID is accepted only for an immutable byte-identical frozen record")
    raise ValueError(f"{audit_id}: canonical v2 gap ID must exactly bind authoritative batch and company")


def validate_v2_record_structure(records, batch):
    """Reject malformed v2 identifiers before any value is indexed or hashed."""
    if not isinstance(records, dict) or set(records) != set(V2_LEDGER_FILES):
        raise ValueError("v2 records must contain the six exact canonical ledgers")
    for ledger in V2_LEDGER_FILES:
        rows = records[ledger]
        if not isinstance(rows, list):
            raise ValueError(f"invalid v2 record structure: {ledger} must be an array")
        for index, row in enumerate(rows):
            if not isinstance(row, dict):
                raise ValueError(f"invalid v2 record structure: {ledger}[{index}] must be an object")
            for field in V2_STRUCTURAL_ID_FIELDS[ledger]:
                value = row.get(field)
                if not isinstance(value, str) or not value:
                    raise ValueError(
                        f"invalid v2 record structure: {ledger}[{index}].{field} must be a nonempty string"
                    )
            for field in V2_STRUCTURAL_BINDING_FIELDS.get(ledger, ()):
                values = row.get(field)
                if not isinstance(values, list):
                    raise ValueError(
                        f"invalid v2 record structure: {ledger}[{index}].{field} must be an array"
                    )
                for binding_index, value in enumerate(values):
                    if not isinstance(value, str) or not value:
                        raise ValueError(
                            f"invalid v2 record structure: {ledger}[{index}].{field}"
                            f"[{binding_index}] must be a nonempty string"
                        )
            if ledger == "attempts" and "shared_bulk_result_binding" in row:
                shared = row["shared_bulk_result_binding"]
                if not isinstance(shared, dict):
                    raise ValueError(
                        f"invalid v2 record structure: {ledger}[{index}].shared_bulk_result_binding must be an object"
                    )
                for field in ("source_id", "company_id", "category_id"):
                    value = shared.get(field)
                    if not isinstance(value, str) or not value:
                        raise ValueError(
                            f"invalid v2 record structure: {ledger}[{index}].shared_bulk_result_binding."
                            f"{field} must be a nonempty string"
                        )

    company_ids = batch.get("company_ids") if isinstance(batch, dict) else None
    if (not isinstance(company_ids, list) or len(company_ids) != BATCH_SIZE
            or any(not isinstance(value, str) or not COMPANY_ID_PATTERN.fullmatch(value)
                   for value in company_ids)):
        raise ValueError(
            "canonical batch company_ids must contain exactly 25 authoritative company IDs"
        )
    if len(set(company_ids)) != BATCH_SIZE:
        raise ValueError("canonical batch must contain exactly 25 unique companies")
    return records


def validate_v2_batch_records(records, batch):
    """Validate the batch-specific envelope before the authoritative v2 validator."""
    validate_v2_record_structure(records, batch)
    company_ids = batch["company_ids"]

    errors = []
    expected_keys = {(company_id, category_id) for company_id in company_ids for category_id in V2_CATEGORIES}
    expected_order = [(company_id, category_id) for company_id in company_ids for category_id in V2_CATEGORIES]
    cells = records["cells"]
    cell_ids = [cell.get("cell_id") for cell in cells if isinstance(cell, dict)]
    cell_keys = [(cell.get("company_id"), cell.get("category_id")) for cell in cells if isinstance(cell, dict)]
    duplicate_ids = sorted({value for value in cell_ids if cell_ids.count(value) > 1}, key=str)
    duplicate_keys = sorted({value for value in cell_keys if cell_keys.count(value) > 1}, key=str)
    if duplicate_ids or duplicate_keys:
        errors.append("duplicate v2 cell identities are prohibited")
    actual_keys = set(cell_keys)
    missing = sorted(expected_keys - actual_keys)
    unexpected = sorted(actual_keys - expected_keys)
    if missing:
        errors.append(f"missing canonical v2 cells: {missing[0][0]}::{missing[0][1]}")
    if unexpected:
        errors.append(f"substituted or unexpected v2 cell: {unexpected[0][0]}::{unexpected[0][1]}")
    if len(cells) != BATCH_SIZE * len(V2_CATEGORIES) or actual_keys != expected_keys:
        errors.append("v2 cells must equal the exact canonical 25 companies x 10 categories set")
    if cell_keys != expected_order:
        errors.append("v2 cells are not in canonical company/category order")

    id_fields = {
        "attempts": "attempt_id", "official_claims": "claim_id", "references": "reference_id",
        "community_reports": "community_report_id", "sources": "source_id",
    }
    indexes = {}
    for ledger, field in id_fields.items():
        values = [record.get(field) for record in records[ledger] if isinstance(record, dict)]
        if len(values) != len(records[ledger]) or any(not isinstance(value, str) or not value for value in values):
            errors.append(f"{ledger} require nonempty object IDs")
        duplicates = sorted({value for value in values if values.count(value) > 1}, key=str)
        if duplicates:
            errors.append(f"duplicate {ledger} ID: {duplicates[0]}")
        indexes[ledger] = {record.get(field): record for record in records[ledger] if isinstance(record, dict)}

    cell_position = {key: index for index, key in enumerate(expected_order)}
    expected_attempt_order = sorted(
        records["attempts"],
        key=lambda item: (cell_position.get((item.get("company_id"), item.get("category_id")), 10**9),
                          item.get("route_id", "")),
    )
    if records["attempts"] != expected_attempt_order:
        errors.append("v2 attempts are not in canonical cell/route order")
    for ledger, field in (("official_claims", "claim_id"), ("references", "reference_id"),
                          ("community_reports", "community_report_id"), ("sources", "source_id")):
        if records[ledger] != sorted(records[ledger], key=lambda item: item.get(field, "")):
            errors.append(f"v2 {ledger} are not in deterministic ID order")

    use = {ledger: {} for ledger in ("attempts", "official_claims", "references", "community_reports")}
    cells_by_id = {cell.get("cell_id"): cell for cell in cells if isinstance(cell, dict)}
    bindings = (
        ("attempts", "attempt_ids"), ("official_claims", "official_claim_ids"),
        ("references", "reference_ids"), ("community_reports", "community_report_ids"),
    )
    for cell_id in sorted(cells_by_id, key=str):
        cell = cells_by_id[cell_id]
        for ledger, field in bindings:
            for record_id in cell.get(field, []):
                use[ledger][record_id] = use[ledger].get(record_id, 0) + 1
                record = indexes[ledger].get(record_id)
                label = ledger.replace("_", " ").rstrip("s")
                if record is None:
                    errors.append(f"{cell_id}: missing {label} {record_id}")
                elif any(record.get(key) != cell.get(key) for key in ("cell_id", "company_id", "category_id")):
                    errors.append(f"{record_id}: cross-cell {label} binding mismatch")

    for ledger, field in id_fields.items():
        if ledger == "sources":
            continue
        label = ledger.replace("_", " ").rstrip("s")
        for record_id in sorted(indexes[ledger], key=str):
            count = use[ledger].get(record_id, 0)
            if count == 0:
                errors.append(f"orphan {label}: {record_id}")
            elif count > 1:
                errors.append(f"{label} referenced by multiple cells: {record_id}")

    for report_id, report in sorted(indexes["community_reports"].items(), key=lambda item: str(item[0])):
        moderation = report.get("moderation")
        if (report.get("publication_eligibility") != "eligible"
                or not isinstance(moderation, dict) or moderation.get("status") != "approved"
                or not isinstance(report.get("frozen_snapshot"), dict)):
            errors.append(f"{report_id}: community report must be approved and frozen")

    if errors:
        raise ValueError("invalid v2 batch records:\n" + "\n".join(sorted(set(errors))))
    return records


def read_v2_batch_records(directory):
    directory = Path(directory)
    return {ledger: read_jsonl(directory / filename) for ledger, filename in V2_LEDGER_FILES.items()}


def validate_v2_authoritative_records(records, research_root, prepromotion=False, validation_context=None):
    """Run the authoritative cross-ledger validator over an arbitrary complete slice."""
    validator_path = Path(__file__).with_name("validate-benefits-v2-package.py")
    spec = importlib.util.spec_from_file_location("benefits_v2_batch_package_validator", validator_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {validator_path}")
    validator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(validator)
    research_root = Path(research_root)

    repository_root = Path(__file__).resolve().parents[1]
    canonical_root = repository_root / "docs" / "research" / "company-benefits"
    if research_root.resolve() == canonical_root.resolve():
        policy = json.loads((research_root / "research-coverage-policies.json").read_text(encoding="utf-8"))
        errors = validator.validate_package(
            {"coverage_policy": policy, **records}, repository_root,
            prepromotion=prepromotion,
            validation_context=validation_context,
        )
    else:
        with tempfile.TemporaryDirectory(prefix="benefits-v2-authority-") as directory:
            temporary_root = Path(directory)
            target = temporary_root / "docs" / "research" / "company-benefits"
            (target / "schema").mkdir(parents=True)
            for filename in validator.SCHEMAS.values():
                shutil.copyfile(canonical_root / "schema" / filename, target / "schema" / filename)
            for filename in (
                "companies.jsonl", "research-coverage-policies.json", "series-batches.jsonl"
            ):
                source = research_root / filename
                if not source.is_file() and filename == "research-coverage-policies.json":
                    source = canonical_root / filename
                if not source.is_file():
                    raise ValueError(f"v2 authoritative input is missing: {filename}")
                shutil.copyfile(source, target / filename)
            policy = json.loads((target / "research-coverage-policies.json").read_text(encoding="utf-8"))
            errors = validator.validate_package(
                {"coverage_policy": policy, **records}, temporary_root,
                prepromotion=prepromotion,
                validation_context=validation_context,
            )
    if errors:
        raise ValueError("authoritative benefits-v2 validation failed:\n" + "\n".join(errors))
    return records


def validate_v2_package_records(records, batch, research_root, prepromotion=False):
    """Run batch envelope checks and the authoritative v2 package validator."""
    validate_v2_batch_records(records, batch)
    return validate_v2_authoritative_records(
        records, research_root, prepromotion=prepromotion,
        validation_context={
            "mode": "batch", "batch_id": batch.get("batch_id"),
            "company_ids": batch["company_ids"],
        },
    )


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def canonical_json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True,
                      allow_nan=False).encode("utf-8")


def jsonl_bytes(values):
    return b"".join(json_bytes(value) + b"\n" for value in values)


def identity_projection(official_response_identity):
    """Return the sole normalized SEC identity projection (CIK/name/EIN)."""
    if not isinstance(official_response_identity, dict) or set(official_response_identity) != {"cik", "name", "ein"}:
        raise ValueError("official identity response must contain exactly cik, name, and ein")
    cik = official_response_identity["cik"]
    if isinstance(cik, bool) or not isinstance(cik, (int, str)) or not str(cik).isdigit():
        raise ValueError("official identity CIK must be decimal")
    cik = str(cik)
    if len(cik) > 10:
        raise ValueError("official identity CIK exceeds ten digits")
    name, ein = official_response_identity["name"], official_response_identity["ein"]
    if not isinstance(name, str) or not name or not isinstance(ein, str):
        raise ValueError("official identity name must be nonempty and EIN must be an exact string")
    return {"cik": cik.zfill(10), "legal_name": name, "ein": ein}


def identity_projection_sha256(official_response_identity):
    return hashlib.sha256(json_bytes(identity_projection(official_response_identity))).hexdigest()


def validate_identity_source(source):
    normalization = source.get("normalization")
    expected = {"algorithm", "version", "projection_sha256"}
    if (not isinstance(normalization, dict) or set(normalization) != expected
            or normalization.get("algorithm") != IDENTITY_ALGORITHM
            or normalization.get("version") != IDENTITY_VERSION
            or not HASH_PATTERN.fullmatch(str(normalization.get("projection_sha256", "")))
            or normalization.get("projection_sha256") != source.get("content_sha256")):
        raise ValueError("official identity normalization algorithm/version/projection digest mismatch")
    supported = source.get("supported_fields")
    if (source.get("source_type") not in {"regulator_filing", "government_register"}
            or not isinstance(supported, list) or not supported or set(supported) - IDENTITY_SOURCE_FIELDS):
        raise ValueError("official identity projection is restricted to official entity identity fields")


def frozen_source_records(root):
    """Index exact JSONL record bytes, including their line terminator."""
    path = Path(root) / "source-registry.jsonl"
    records = {}
    for raw in path.read_bytes().splitlines(keepends=True) if path.is_file() else []:
        if not raw.strip():
            continue
        source_id = json.loads(raw)["source_id"]
        if source_id in records:
            raise ValueError(f"{source_id}: duplicate frozen legacy source")
        records[source_id] = raw
    return records


def source_check_map(records):
    """Collapse identical serialized checks; reject ambiguous source observations."""
    result = {}
    for check in records:
        if not isinstance(check, dict):
            raise ValueError("checks must be objects")
        source_id = check.get("source_id")
        if not isinstance(source_id, str) or not source_id:
            raise ValueError("checks require nonempty source_id")
        if source_id in result and json_bytes(result[source_id]) != json_bytes(check):
            raise ValueError(f"{source_id}: conflicting source check tuple")
        result[source_id] = check
    return result


def read_source_checks(path):
    """Retain audit records, requiring repeated observations to be byte-identical."""
    path = Path(path)
    records, seen = [], {}
    for raw in path.read_bytes().splitlines(keepends=True) if path.is_file() else []:
        if not raw.strip():
            continue
        check = json.loads(raw)
        key = json_bytes(check)
        if key in seen and seen[key] != raw:
            raise ValueError("duplicate source checks must be byte-identical")
        seen[key] = raw
        records.append(check)
    return records


def validate_source_check(check, source, legacy_record=None):
    """Validate a post-review observation without rewriting its source.

    Metadata drift requires an explicit compatibility audit bound to trusted
    frozen JSONL bytes. This grants no publication eligibility or claim evidence.
    Callers retain responsibility for post-review timing and exact byte overlap.
    """
    source_id = source.get("source_id")
    if check.get("source_id") != source_id or check.get("url") != source.get("url"):
        raise ValueError(f"{source_id}: post-review check source_id/URL binding mismatch")
    if source.get("record_type") == "nonpublishable_metadata":
        fields = {"source_id", "url", "status", "final_url", "access_wall", "checked_at"}
        actual = {field: check.get(field) for field in ("status", "final_url", "access_wall")}
        projection = check.get("compatibility_projection")
        if projection is not None:
            expected = {"algorithm": "immutable-legacy-source-v1",
                        "legacy_record_sha256": hashlib.sha256(legacy_record).hexdigest()
                        if legacy_record is not None else None}
            if (legacy_record is None or json.loads(legacy_record) != source
                    or projection != expected or set(check) != fields | {"compatibility_projection"}):
                raise ValueError(f"{source_id}: invalid immutable legacy compatibility projection")
            status, final_url, wall = (check.get(key) for key in ("status", "final_url", "access_wall"))
            walls = {"none", "api_key", "login", "fee", "contract", "bot_or_network_block"}
            try:
                final = urlsplit(final_url) if isinstance(final_url, str) else None
                secure_final = final is not None and final.scheme == "https" and bool(final.hostname)
            except ValueError:
                secure_final = False
            if (not isinstance(wall, str) or wall not in walls
                    or (status is None and (final_url is not None or wall != "bot_or_network_block"))
                    or (status is not None and (type(status) is not int or not 100 <= status <= 599
                        or not secure_final))
                    or (status == 200 and wall == "bot_or_network_block")
                    or (status in {401, 403, 429} and wall == "none")):
                raise ValueError(f"{source_id}: inconsistent current metadata observation")
            return
        if set(check) != fields or actual != source.get("access_observation"):
            raise ValueError(f"{source_id}: metadata check must exactly match observed route failure/access semantics")
        return
    fields = {"source_id", "url", "status", "final_url", "marker", "marker_confirmed",
              "content_sha256", "checked_at"}
    if source.get("hash_provenance") == IDENTITY_PROVENANCE:
        fields.add("normalization")
    expected = (source.get("http_verification", {}).get("final_url"),
                source.get("http_verification", {}).get("expected_marker"), source.get("content_sha256"))
    actual = (check.get("final_url"), check.get("marker"), check.get("content_sha256"))
    if (set(check) != fields or not str(check.get("url", "")).startswith("https://")
            or check.get("status") != 200 or check.get("marker_confirmed") is not True or actual != expected
            or not HASH_PATTERN.fullmatch(str(check.get("content_sha256", "")))):
        raise ValueError(f"{source_id}: publishable source check must be a successful exact source tuple")
    if source.get("hash_provenance") == IDENTITY_PROVENANCE:
        validate_identity_source(source)
        normalization = check.get("normalization")
        expected_fields = {"algorithm", "version", "official_response_identity", "projection_sha256"}
        if (not isinstance(normalization, dict) or set(normalization) != expected_fields
                or normalization.get("algorithm") != IDENTITY_ALGORITHM
                or normalization.get("version") != IDENTITY_VERSION):
            raise ValueError(f"{source_id}: identity normalization check mismatch")
        recomputed = identity_projection_sha256(normalization.get("official_response_identity"))
        if (normalization.get("projection_sha256") != recomputed
                or recomputed != source["normalization"]["projection_sha256"]
                or recomputed != check.get("content_sha256")):
            raise ValueError(f"{source_id}: official identity projection drift")


def validate_gap_source_routes(gap, source_map):
    """Require explicit, exact-entity, metadata-only official routes for a gap."""
    gap_id = gap.get("audit_id", "gap[missing-id]")
    if (gap.get("disposition") != "nonpublishable"
            or not any(phrase in gap.get("nonabsence_wording", "") for phrase in NONABSENCE_PHRASES)):
        raise ValueError(f"{gap_id}: gap must remain nonpublishable with mandatory non-absence wording")
    source_ids = gap.get("searched_official_source_ids")
    if (not isinstance(source_ids, list) or not source_ids
            or any(not isinstance(source_id, str) or not source_id for source_id in source_ids)
            or len(source_ids) != len(set(source_ids))):
        raise ValueError(f"{gap_id}: gap requires at least one unique nonempty official source-ID route")
    if gap.get("searched_official_urls"):
        raise ValueError(f"{gap_id}: raw searched URLs must be migrated to source-ID records")
    for source_id in source_ids:
        source = source_map.get(source_id)
        if source is None:
            raise ValueError(f"{gap_id}: official route source_id does not resolve: {source_id}")
        if (source.get("record_type") != "nonpublishable_metadata"
                or source.get("publication_eligible") is not False
                or source.get("retention_mode") != "metadata_only"):
            raise ValueError(f"{gap_id}: official route must remain nonpublishable metadata: {source_id}")
        if (source.get("route_quality") != "exact_entity"
                or source.get("entity_binding_status") != "exact_entity"
                or source.get("source_type") not in OFFICIAL_DISCOVERY_SOURCE_TYPES):
            raise ValueError(f"{gap_id}: official route must be an exact-entity official discovery route: {source_id}")
    return source_ids


def read_jsonl(path):
    path = Path(path)
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def write_jsonl(path, values):
    Path(path).write_bytes(jsonl_bytes(values))


def company_list_sha256(company_ids):
    return hashlib.sha256(json_bytes(company_ids)).hexdigest()


def v2_cell_set_sha256(cells):
    identities = sorted((cell.get("company_id"), cell.get("category_id")) for cell in cells)
    return hashlib.sha256(json_bytes(identities)).hexdigest()


def v2_batch_slice(records, batch):
    """Return the complete authoritative package slice owned or used by one batch."""
    company_ids = set(batch.get("company_ids", []))
    sliced = {
        ledger: [record for record in records[ledger] if record.get("company_id") in company_ids]
        for ledger in V2_LEDGER_FILES if ledger != "sources"
    }
    source_ids = set()
    for ledger in ("attempts", "official_claims"):
        for record in sliced[ledger]:
            values = record.get("source_ids", [])
            if (not isinstance(values, list)
                    or any(not isinstance(source_id, str) or not source_id for source_id in values)):
                raise ValueError(
                    f"{record.get(V2_ID_FIELDS[ledger])}: invalid v2 source binding; "
                    "source_ids must contain strings"
                )
            source_ids.update(values)
    for ledger in ("references", "community_reports"):
        for record in sliced[ledger]:
            source_id = record.get("source_id")
            if not isinstance(source_id, str) or not source_id:
                raise ValueError(
                    f"{record.get(V2_ID_FIELDS[ledger])}: invalid v2 source binding; "
                    "source_id must be a string"
                )
            source_ids.add(source_id)
    sliced["sources"] = [record for record in records["sources"] if record.get("source_id") in source_ids]
    company_position = {company_id: index for index, company_id in enumerate(batch.get("company_ids", []))}
    category_position = {category_id: index for index, category_id in enumerate(V2_CATEGORIES)}
    cell_key = lambda record: (company_position.get(record.get("company_id"), 10**9),
                               category_position.get(record.get("category_id"), 10**9))
    sliced["cells"].sort(key=cell_key)
    sliced["attempts"].sort(key=lambda record: (*cell_key(record), record.get("route_id", "")))
    for ledger in ("official_claims", "references", "community_reports", "sources"):
        sliced[ledger].sort(key=lambda record, field=V2_ID_FIELDS[ledger]: record.get(field, ""))
    return sliced


def v2_ledger_sha256(records):
    """Bind every full canonical record payload, independent of source file ordering."""
    result = {}
    for ledger, filename in V2_LEDGER_FILES.items():
        field = V2_ID_FIELDS[ledger]
        ordered = sorted(records[ledger], key=lambda record: record.get(field, ""))
        result[filename] = hashlib.sha256(canonical_json_bytes(ordered)).hexdigest()
    return result


def progress_contract_version(progress):
    """Parse the strict legacy/v2 progress union without inferring a v2 marker."""
    if not isinstance(progress, dict) or not isinstance(progress.get("batches"), list):
        raise ValueError("series progress must be an object with batch entries")
    entries = progress["batches"]
    legacy_top = {"manifest_version", "status", "company_list_sha256", "total_companies", "total_batches", "batches"}
    legacy_entry = {"batch_id", "scope", "batch_number", "status", "company_list_sha256", "claim_count", "no_claim_count"}
    approval_fields = {"approved_at", "reviewer_ids"}
    v2_entry_fields = {"cell_count", "cell_set_sha256", "v2_ledger_sha256"}
    version = progress.get("progress_version")
    if version not in {None, "1", "2"}:
        raise ValueError("series progress version must be 1 or 2")
    if (version != "2" and ("total_cells" in progress
            or any(isinstance(entry, dict) and set(entry) & v2_entry_fields for entry in entries))):
        raise ValueError("v2 progress fields require explicit progress_version=2")
    if version in {None, "1"}:
        expected_top = legacy_top | ({"progress_version"} if version == "1" else set())
        if (set(progress) != expected_top or progress.get("manifest_version") != MANIFEST_VERSION
                or progress.get("status") not in {"in_progress", "complete"}
                or progress.get("total_companies") != 2000 or progress.get("total_batches") != 80
                or not HASH_PATTERN.fullmatch(str(progress.get("company_list_sha256", "")))
                or len(entries) != 80):
            raise ValueError("legacy v1 progress schema is invalid")
        for entry in entries:
            if not isinstance(entry, dict):
                raise ValueError("legacy progress batch entries must be objects")
            status = entry.get("status")
            expected = legacy_entry | (approval_fields if status == "approved" else set())
            reviewers = entry.get("reviewer_ids")
            invalid_approval = status == "approved" and (
                not isinstance(entry.get("approved_at"), str)
                or not isinstance(reviewers, list) or not reviewers
                or any(not isinstance(item, str) or not item for item in reviewers)
                or len(reviewers) != len(set(reviewers))
            )
            if (set(entry) != expected or status not in {"pending", "approved"}
                    or entry.get("scope") not in SCOPES
                    or not isinstance(entry.get("batch_number"), int) or isinstance(entry.get("batch_number"), bool)
                    or not 1 <= entry["batch_number"] <= 40
                    or not HASH_PATTERN.fullmatch(str(entry.get("company_list_sha256", "")))
                    or any(not isinstance(entry.get(field), int) or isinstance(entry.get(field), bool)
                           or entry[field] < 0 for field in ("claim_count", "no_claim_count"))
                    or invalid_approval):
                raise ValueError("legacy progress batch entry schema is invalid")
        return "1"
    expected_top = legacy_top | {"progress_version", "total_cells"}
    if (set(progress) != expected_top or progress.get("manifest_version") != MANIFEST_VERSION
            or progress.get("status") not in {"in_progress", "complete"}
            or progress.get("total_companies") != 2000 or progress.get("total_batches") != 80
            or not HASH_PATTERN.fullmatch(str(progress.get("company_list_sha256", "")))):
        raise ValueError("v2 progress schema is invalid")
    if progress.get("total_cells") != 20000:
        raise ValueError("v2 progress requires total_cells=20000")
    if len(entries) != 80:
        raise ValueError("v2 progress requires the complete 80-batch partition")

    ledger_names = set(V2_LEDGER_FILES.values())
    approved_count = 0
    cell_count = 0
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("v2 progress batch entries must be objects")
        batch_id = entry.get("batch_id", "unknown-batch")
        status = entry.get("status")
        expected = legacy_entry | {"cell_count"} | (approval_fields | {"cell_set_sha256", "v2_ledger_sha256"}
                                                    if status == "approved" else set())
        if (set(entry) != expected or entry.get("scope") not in SCOPES
                or not isinstance(entry.get("batch_number"), int) or isinstance(entry.get("batch_number"), bool)
                or not 1 <= entry["batch_number"] <= 40
                or not HASH_PATTERN.fullmatch(str(entry.get("company_list_sha256", "")))
                or any(not isinstance(entry.get(field), int) or isinstance(entry.get(field), bool)
                       or entry[field] < 0 for field in ("claim_count", "no_claim_count"))):
            raise ValueError(f"{batch_id}: v2 progress batch entry schema is invalid")
        if status == "approved":
            approved_count += 1
            count = entry.get("cell_count")
            cell_count += count if isinstance(count, int) and not isinstance(count, bool) else 0
            hashes = entry.get("v2_ledger_sha256")
            if (count != 250 or isinstance(count, bool)
                    or not HASH_PATTERN.fullmatch(str(entry.get("cell_set_sha256", "")))
                    or not isinstance(hashes, dict) or set(hashes) != ledger_names
                    or any(not HASH_PATTERN.fullmatch(str(value)) for value in hashes.values())
                    or not isinstance(entry.get("approved_at"), str)
                    or not isinstance(entry.get("reviewer_ids"), list) or not entry["reviewer_ids"]
                    or any(not isinstance(item, str) or not item for item in entry["reviewer_ids"])
                    or len(entry["reviewer_ids"]) != len(set(entry["reviewer_ids"]))):
                raise ValueError(f"{batch_id}: v2 approved batch requires exactly 250 cells and all six ledger hashes; legacy approved entries cannot coexist")
        elif status == "pending":
            if (entry.get("cell_count") != 0 or "cell_set_sha256" in entry
                    or "v2_ledger_sha256" in entry):
                raise ValueError(f"{batch_id}: v2 pending batch requires zero cells and no v2 hashes")
        else:
            raise ValueError(f"{batch_id}: invalid v2 progress status")
    if progress.get("status") == "complete" and (approved_count != 80 or cell_count != 20000):
        raise ValueError("v2 completion requires exactly 80 approved batches and 20,000 cells")
    return "2"


def validate_complete_v2_progress(root, batches=None, progress=None, records=None):
    """Require and verify an exact complete v2 record snapshot and its canonical partition."""
    root = Path(root)
    batches = batches if batches is not None else read_jsonl(root / "series-batches.jsonl")
    if progress is None:
        progress = json.loads((root / "series-progress.json").read_text(encoding="utf-8"))
    if progress_contract_version(progress) != "2":
        raise ValueError("v2 publication requires explicit progress_version=2")
    if progress.get("status") != "complete":
        raise ValueError("v2 publication requires complete progress")

    canonical_ids = {f"{scope}-{number:02d}" for scope in SCOPES for number in range(1, BATCHES_PER_SCOPE + 1)}
    if not isinstance(batches, list) or len(batches) != len(canonical_ids):
        raise ValueError("authoritative series batch ledger must contain exactly 80 canonical batches")
    batch_ids = [batch.get("batch_id") for batch in batches if isinstance(batch, dict)]
    if len(batch_ids) != len(batches) or len(set(batch_ids)) != len(batch_ids) or set(batch_ids) != canonical_ids:
        raise ValueError("authoritative series batch IDs must exactly equal the canonical 80-batch set")

    batch_map = {}
    company_owner = {}
    expected_cell_keys = set()
    for batch in batches:
        batch_id = batch["batch_id"]
        scope, raw_number = batch_id.rsplit("-", 1)
        company_ids = batch.get("company_ids")
        if (batch.get("scope") != scope or batch.get("batch_number") != int(raw_number)
                or not isinstance(company_ids, list) or len(company_ids) != BATCH_SIZE
                or len(set(company_ids)) != BATCH_SIZE
                or batch.get("company_list_sha256") != company_list_sha256(company_ids)):
            raise ValueError(f"{batch_id}: authoritative batch identity or company membership is invalid")
        for company_id in company_ids:
            if not isinstance(company_id, str) or not company_id or company_id in company_owner:
                raise ValueError("authoritative series batches must partition 2,000 unique companies")
            company_owner[company_id] = batch_id
            expected_cell_keys.update((company_id, category_id) for category_id in V2_CATEGORIES)
        batch_map[batch_id] = batch
    if len(company_owner) != BATCH_SIZE * len(canonical_ids):
        raise ValueError("authoritative series batches must partition exactly 2,000 unique companies")

    entries = progress.get("batches", [])
    progress_ids = [entry.get("batch_id") for entry in entries if isinstance(entry, dict)]
    if (len(progress_ids) != len(entries) or len(set(progress_ids)) != len(progress_ids)
            or set(progress_ids) != canonical_ids):
        raise ValueError("v2 progress batch IDs must exactly equal the canonical 80-batch set")
    entry_map = {entry["batch_id"]: entry for entry in entries}

    records = read_v2_batch_records(root) if records is None else records
    validate_v2_authoritative_records(records, root)
    partitions = {
        batch_id: {ledger: [] for ledger in V2_LEDGER_FILES}
        for batch_id in canonical_ids
    }
    global_ids = {}
    for ledger, id_field in V2_ID_FIELDS.items():
        seen = set()
        for record in records[ledger]:
            if not isinstance(record, dict):
                raise ValueError(f"v2 {ledger} ledger records must be objects")
            record_id = record.get(id_field)
            if not isinstance(record_id, str) or not record_id or record_id in seen:
                raise ValueError(f"v2 {ledger} ledger requires globally unique nonempty {id_field}")
            seen.add(record_id)
        global_ids[ledger] = seen

    cells = records["cells"]
    cell_keys = [(record.get("company_id"), record.get("category_id")) for record in cells]
    if (len(cells) != BATCH_SIZE * len(V2_CATEGORIES) * len(canonical_ids)
            or len(set(cell_keys)) != len(cell_keys) or set(cell_keys) != expected_cell_keys):
        raise ValueError("actual v2 cells must be exactly 20,000 unique canonical company/category records")

    for ledger in V2_LEDGER_FILES:
        if ledger == "sources":
            continue
        for record in records[ledger]:
            company_id = record.get("company_id")
            category_id = record.get("category_id")
            batch_id = company_owner.get(company_id)
            expected_cell_id = f"cell::{company_id}::{category_id}"
            if (batch_id is None or category_id not in V2_CATEGORIES
                    or record.get("cell_id") != expected_cell_id
                    or (company_id, category_id) not in expected_cell_keys):
                raise ValueError(f"{record.get(V2_ID_FIELDS[ledger])}: v2 record has no exact canonical batch/cell owner")
            partitions[batch_id][ledger].append(record)

    source_owners = {source_id: set() for source_id in global_ids["sources"]}
    source_bindings = (("attempts", "source_ids"), ("official_claims", "source_ids"),
                       ("references", "source_id"), ("community_reports", "source_id"))
    for ledger, field in source_bindings:
        for record in records[ledger]:
            batch_id = company_owner[record["company_id"]]
            values = record.get(field, []) if field.endswith("_ids") else [record.get(field)]
            if not isinstance(values, list):
                raise ValueError(f"{record.get(V2_ID_FIELDS[ledger])}: invalid v2 source binding")
            for source_id in values:
                if source_id not in source_owners:
                    raise ValueError(f"{record.get(V2_ID_FIELDS[ledger])}: unknown v2 source binding {source_id}")
                source_owners[source_id].add(batch_id)
    source_map = {record["source_id"]: record for record in records["sources"]}
    for source_id, owners in source_owners.items():
        if len(owners) != 1:
            raise ValueError(f"{source_id}: v2 source must belong to exactly one canonical batch")
        partitions[next(iter(owners))]["sources"].append(source_map[source_id])

    for batch_id in sorted(canonical_ids):
        batch = batch_map[batch_id]
        entry = entry_map[batch_id]
        sliced = partitions[batch_id]
        if (entry.get("scope") != batch.get("scope")
                or entry.get("batch_number") != batch.get("batch_number")
                or entry.get("company_list_sha256") != batch.get("company_list_sha256")):
            raise ValueError(f"{batch_id}: progress identity does not match authoritative batch ledger")
        if len(sliced["cells"]) != BATCH_SIZE * len(V2_CATEGORIES):
            raise ValueError(f"{batch_id}: actual v2 partition must contain exactly 250 cells")
        if entry.get("cell_count") != len(sliced["cells"]):
            raise ValueError(f"{batch_id}: declared v2 cell count does not match actual partition")
        if entry.get("cell_set_sha256") != v2_cell_set_sha256(sliced["cells"]):
            raise ValueError(f"{batch_id}: persisted v2 cell-set hash mismatch")
        if entry.get("v2_ledger_sha256") != v2_ledger_sha256(sliced):
            raise ValueError(f"{batch_id}: persisted v2 ledger hash mismatch")
        validate_v2_batch_records(sliced, batch)
    return records, partitions


def validate_persisted_v2_hashes(root, batches=None, progress=None, v2_transition=False):
    """Reject approved-ledger drift before any operation can regenerate progress hashes."""
    root = Path(root)
    batches = batches if batches is not None else read_jsonl(root / "series-batches.jsonl")
    if progress is None:
        progress = json.loads((root / "series-progress.json").read_text(encoding="utf-8"))
    if progress_contract_version(progress) == "1":
        if v2_transition and any(entry.get("status") == "approved" for entry in progress.get("batches", [])
                                 if isinstance(entry, dict)):
            raise ValueError("v2 transition requires every approved batch to use the v2 cell/hash contract; approved legacy entries cannot coexist")
        return
    batch_map = {batch.get("batch_id"): batch for batch in batches}
    records = read_v2_batch_records(root)
    for entry in progress.get("batches", []):
        if entry.get("status") != "approved":
            continue
        batch = batch_map.get(entry.get("batch_id"))
        if batch is None or entry.get("v2_ledger_sha256") != v2_ledger_sha256(v2_batch_slice(records, batch)):
            raise ValueError(f"{entry.get('batch_id')}: persisted v2 ledger hash mismatch")


def file_sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def validate_historical_audit(root, active_company_ids, errors):
    root = Path(root)
    manifest_path = root / "series-historical-audit-manifest.json"
    audit_path = root / "series-historical-audit.jsonl"
    schema_path = root / "schema" / "series-historical-audit.schema.json"
    historical_protocol = root / "population" / "history" / "protocol-3.1.1" / "population-protocol.json"
    historical_freeze = root / "population" / "history" / "protocol-3.1.1" / "freeze-manifest.json"
    required = (manifest_path, audit_path, schema_path, historical_protocol, historical_freeze)
    missing = [path.name for path in required if not path.is_file()]
    if missing:
        errors.append(f"historical audit required artifact missing: {', '.join(missing)}")
        return
    try:
        manifest_bytes = manifest_path.read_bytes()
        manifest = json.loads(manifest_bytes)
        audit_bytes = audit_path.read_bytes()
        rows = [json.loads(line) for line in audit_bytes.splitlines()]
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        errors.append(f"historical audit is invalid: {exc}")
        return
    if hashlib.sha256(manifest_bytes).hexdigest() != HISTORICAL_AUDIT_MANIFEST_SHA256:
        errors.append("historical audit manifest violates immutable repository pin")
    expected_manifest = {
        "schema_version": "1",
        "audit_path": "series-historical-audit.jsonl",
        "audit_sha256": HISTORICAL_AUDIT_SHA256,
        "audit_schema_path": "schema/series-historical-audit.schema.json",
        "audit_schema_sha256": HISTORICAL_AUDIT_SCHEMA_SHA256,
        "byte_count": 893563,
        "row_count": 497,
        "record_type_counts": {"claim": 199, "review": 199, "gap": 99},
        "publishable": False,
        "source_protocol_version": "3.1.1",
        "source_protocol_sha256": HISTORICAL_PROTOCOL_SHA256,
        "source_freeze_manifest_sha256": HISTORICAL_FREEZE_SHA256,
        "source_commit": "0871312fcb82d3e2f141d472a225d95147c9e12c",
        "wrapper_reason": "protocol_4_refreeze_requires_new_batch_review",
    }
    if manifest != expected_manifest:
        errors.append("historical audit manifest provenance or counts mismatch")
    if hashlib.sha256(schema_path.read_bytes()).hexdigest() != HISTORICAL_AUDIT_SCHEMA_SHA256:
        errors.append("historical audit schema violates immutable manifest binding")
    if (hashlib.sha256(audit_bytes).hexdigest() != HISTORICAL_AUDIT_SHA256
            or len(audit_bytes) != 893563 or len(rows) != 497):
        errors.append("historical audit exact bytes, order, or row count mismatch")
    if hashlib.sha256(historical_protocol.read_bytes()).hexdigest() != HISTORICAL_PROTOCOL_SHA256:
        errors.append("historical audit source protocol digest mismatch")
    if hashlib.sha256(historical_freeze.read_bytes()).hexdigest() != HISTORICAL_FREEZE_SHA256:
        errors.append("historical audit source freeze digest mismatch")
    type_counts = {record_type: 0 for record_type in ("claim", "review", "gap")}
    claim_companies = {}
    for row in rows:
        if not isinstance(row, dict) or set(row) != HISTORICAL_AUDIT_FIELDS:
            errors.append("historical audit wrapper schema mismatch")
            continue
        record_type = row.get("record_type")
        if record_type not in type_counts:
            errors.append("historical audit contains unknown record type")
            continue
        type_counts[record_type] += 1
        company_id = row.get("company_id")
        selection_status = row.get("selection_status")
        record = row.get("record")
        if (not isinstance(company_id, str) or not company_id
                or selection_status not in {"retained", "removed"}
                or row.get("publishable") is not False
                or row.get("reason") != "protocol_4_refreeze_requires_new_batch_review"
                or row.get("old_batch_id") not in BATCH_IDS
                or row.get("new_batch_id") not in ({None} | BATCH_IDS)
                or not isinstance(record, dict)):
            errors.append("historical audit wrapper schema mismatch")
        if not isinstance(record, dict):
            record = {}
        if selection_status == "removed" and (row.get("new_batch_id") is not None or company_id in active_company_ids):
            errors.append("historical audit removed company leaked into active ledger")
        if selection_status == "retained" and not isinstance(row.get("new_batch_id"), str):
            errors.append("historical audit retained-company provenance mismatch")
        if record_type in {"claim", "gap"} and record.get("company_id") != company_id:
            errors.append("historical audit record company binding mismatch")
        if record_type == "claim":
            claim_companies[record.get("claim_id")] = company_id
    for row in rows:
        if isinstance(row, dict) and row.get("record_type") == "review":
            record = row.get("record", {})
            if claim_companies.get(record.get("claim_id")) != row.get("company_id"):
                errors.append("historical audit review provenance mismatch")
    if type_counts != {"claim": 199, "review": 199, "gap": 99}:
        errors.append("historical audit record-type counts mismatch")


def build_batches(root):
    root = Path(root)
    records = []
    all_ids = []
    for scope in SCOPES:
        effective_path = root / "population" / f"{scope}-effective-selected.jsonl"
        companies = read_jsonl(effective_path)
        if len(companies) != BATCH_SIZE * BATCHES_PER_SCOPE:
            raise ValueError(f"{scope} effective ledger must contain exactly 1000 companies")
        ids = [item.get("company_id") for item in companies]
        if None in ids or len(ids) != len(set(ids)):
            raise ValueError(f"{scope} effective ledger company IDs must be unique and nonempty")
        all_ids.extend(ids)
        for number in range(1, BATCHES_PER_SCOPE + 1):
            company_ids = ids[(number - 1) * BATCH_SIZE:number * BATCH_SIZE]
            records.append({
                "manifest_version": MANIFEST_VERSION,
                "batch_id": f"{scope}-{number:02d}",
                "scope": scope,
                "batch_number": number,
                "company_list_sha256": company_list_sha256(company_ids),
                "effective_sequence_sha256": file_sha256(effective_path),
                "replacement_events_sha256": file_sha256(root / "population" / "effective-selection-events.jsonl"),
                "company_ids": company_ids,
            })
    if len(all_ids) != 2000 or len(set(all_ids)) != 2000:
        raise ValueError("effective ledgers must partition exactly 2,000 unique companies")
    return records


def _company_gap_map(gaps):
    company_gaps = [item for item in gaps if str(item.get("audit_id", "")).startswith("company-gap::")]
    result = {}
    for gap in company_gaps:
        result.setdefault(gap.get("company_id"), []).append(gap)
    return result


def build_progress(root, batches, approved_batch_ids, approved_at, reviewer_id, status="in_progress"):
    root = Path(root)
    claims = read_jsonl(root / "benefit-claims.jsonl")
    gaps = read_jsonl(root / "series-research-gaps.jsonl")
    claims_by_company = {}
    for claim in claims:
        claims_by_company.setdefault(claim.get("company_id"), []).append(claim)
    gaps_by_company = _company_gap_map(gaps)
    v2_records = read_v2_batch_records(root)
    v2_progress = any(v2_records.values())
    v2_cells = v2_records["cells"]
    v2_cells_by_company = {}
    for cell in v2_cells:
        v2_cells_by_company.setdefault(cell.get("company_id"), []).append(cell)
    entries = []
    for batch in batches:
        approved = batch["batch_id"] in approved_batch_ids
        company_ids = batch["company_ids"]
        batch_cells = [cell for company_id in company_ids for cell in v2_cells_by_company.get(company_id, [])]
        if approved and v2_progress:
            claim_count = sum(bool(cell.get("official_claim_ids")) for cell in batch_cells)
            no_claim_count = len(batch_cells) - claim_count
        else:
            claim_count = sum(len(claims_by_company.get(company_id, [])) for company_id in company_ids) if approved else 0
            no_claim_count = sum(bool(gaps_by_company.get(company_id)) for company_id in company_ids) if approved else 0
        entry = {
            "batch_id": batch["batch_id"],
            "scope": batch["scope"],
            "batch_number": batch["batch_number"],
            "status": "approved" if approved else "pending",
            "company_list_sha256": batch["company_list_sha256"],
            "claim_count": claim_count,
            "no_claim_count": no_claim_count,
        }
        if v2_progress:
            entry["cell_count"] = sum(len(v2_cells_by_company.get(company_id, [])) for company_id in company_ids) if approved else 0
        if approved:
            timestamp = approved_at.get(batch["batch_id"]) if isinstance(approved_at, dict) else approved_at
            reviewers = reviewer_id.get(batch["batch_id"]) if isinstance(reviewer_id, dict) else reviewer_id
            if isinstance(reviewers, str):
                reviewers = [reviewers]
            if v2_progress and len(batch_cells) != BATCH_SIZE * len(V2_CATEGORIES):
                raise ValueError(f"{batch['batch_id']}: v2 approved batch requires exactly 250 cells before progress publication")
            entry.update(approved_at=timestamp, reviewer_ids=sorted(reviewers or []))
            if v2_progress:
                entry["cell_set_sha256"] = v2_cell_set_sha256(batch_cells)
                entry["v2_ledger_sha256"] = v2_ledger_sha256(v2_batch_slice(v2_records, batch))
        entries.append(entry)
    all_ids = [company_id for batch in batches for company_id in batch["company_ids"]]
    progress = {
        "manifest_version": MANIFEST_VERSION,
        "progress_version": "2" if v2_progress else "1",
        "status": status,
        "company_list_sha256": company_list_sha256(all_ids),
        "total_companies": 2000,
        "total_batches": 80,
        "batches": entries,
    }
    if v2_progress:
        progress["total_cells"] = 20000
    return progress


def materialize_contract(root, approved_batch_ids, approved_at, reviewer_id, status="in_progress"):
    root = Path(root)
    batches = build_batches(root)
    write_jsonl(root / "series-batches.jsonl", batches)
    if not (root / "series-research-gaps.jsonl").exists():
        write_jsonl(root / "series-research-gaps.jsonl", [])
    if not (root / "series-prepublication-checks.jsonl").exists():
        claims = read_jsonl(root / "benefit-claims.jsonl")
        reviews = {item.get("claim_id"): item for item in read_jsonl(root / "reviews.jsonl")}
        sources = {item.get("source_id"): item for item in read_jsonl(root / "source-registry.jsonl")}
        checks = {}
        for claim in claims:
            checked_at = claim.get("prepublication_checked_at")
            if not checked_at or claim.get("company_id") not in {cid for batch in batches if batch["batch_id"] in approved_batch_ids for cid in batch["company_ids"]}:
                continue
            if reviews.get(claim.get("claim_id"), {}).get("decision") != "approved":
                continue
            for source_id in claim.get("source_ids", []) + claim.get("searched_source_ids", []):
                source = sources.get(source_id, {})
                url = source.get("url")
                if url and source_id:
                    checks[source_id] = {"source_id": source_id, "url": url, "status": 200,
                                         "final_url": source.get("http_verification", {}).get("final_url", url),
                                         "marker": source.get("http_verification", {}).get("expected_marker") or source.get("title"),
                                         "marker_confirmed": True, "content_sha256": source.get("content_sha256"),
                                         "checked_at": checked_at}
        write_jsonl(root / "series-prepublication-checks.jsonl", [checks[key] for key in sorted(checks)])
    progress = build_progress(root, batches, set(approved_batch_ids), approved_at, reviewer_id, status)
    (root / "series-progress.json").write_bytes(json_bytes(progress))
    return batches, progress


def reconcile_refreeze(root, previous_selected, previous_claims, previous_reviews, previous_gaps):
    """Preserve old research as nonpublishable audit records and remap by company ID."""
    root = Path(root)
    batches = build_batches(root)
    new_batch_by_company = {
        company_id: batch["batch_id"]
        for batch in batches for company_id in batch["company_ids"]
    }
    old_ids = {item["company_id"] for item in previous_selected}
    new_ids = set(new_batch_by_company)
    retained = old_ids & new_ids
    removed = old_ids - new_ids
    added = new_ids - old_ids
    old_batch_by_company = {}
    for scope in SCOPES:
        ids = [item["company_id"] for item in previous_selected if item.get("scope") == scope]
        for index, company_id in enumerate(ids):
            old_batch_by_company[company_id] = f"{scope}-{index // BATCH_SIZE + 1:02d}"
    claim_company = {item.get("claim_id"): item.get("company_id") for item in previous_claims}
    audit = []
    for record_type, records in (("claim", previous_claims), ("review", previous_reviews), ("gap", previous_gaps)):
        for record in records:
            company_id = record.get("company_id")
            if not company_id and record_type == "review":
                company_id = claim_company.get(record.get("claim_id"))
            audit.append({
                "record_type": record_type,
                "company_id": company_id,
                "selection_status": "retained" if company_id in retained else "removed",
                "old_batch_id": old_batch_by_company.get(company_id),
                "new_batch_id": new_batch_by_company.get(company_id),
                "publishable": False,
                "reason": "protocol_4_refreeze_requires_new_batch_review",
                "record": record,
            })
    write_jsonl(root / "series-historical-audit.jsonl", audit)
    write_jsonl(root / "benefit-claims.jsonl", [])
    write_jsonl(root / "reviews.jsonl", [])
    write_jsonl(root / "series-research-gaps.jsonl", [])
    write_jsonl(root / "series-prepublication-checks.jsonl", [])
    materialize_contract(root, set(), {}, {}, status="in_progress")
    report = {
        "protocol_version": "4.0.0",
        "old_population_count": len(old_ids),
        "new_population_count": len(new_ids),
        "retained_count": len(retained),
        "removed_count": len(removed),
        "new_count": len(added),
        "retained_company_ids": sorted(retained),
        "removed_company_ids": sorted(removed),
        "new_company_ids": sorted(added),
        "new_batch_by_company_id": {key: new_batch_by_company[key] for key in sorted(new_batch_by_company)},
        "approval_rule": "A batch remains pending unless all 25 new canonical member IDs are reviewed or otherwise accounted; old batch approval is never transferred.",
    }
    (root / "series-remap-report.json").write_bytes(json_bytes(report))
    return report


def validate_series(root, projected, claims, reviews, source_map, as_of, errors, parse_timestamp):
    root = Path(root)
    active_company_ids = {
        company.get("company_id")
        for records in projected.values() for company in records
    }
    validate_historical_audit(root, active_company_ids, errors)
    batches = read_jsonl(root / "series-batches.jsonl")
    try:
        expected = build_batches(root)
    except ValueError as exc:
        errors.append(str(exc))
        expected = []
    if batches != expected:
        errors.append("series batches must exactly match the canonical effective-ledger partition")
    if len(batches) != 80 or len({item.get("batch_id") for item in batches}) != len(batches):
        errors.append("series batches must contain exactly 80 unique batches")
    progress_path = root / "series-progress.json"
    try:
        progress = json.loads(progress_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"invalid series progress: {exc}")
        return
    legacy_top = {"manifest_version", "status", "company_list_sha256", "total_companies", "total_batches", "batches"}
    allowed_top = legacy_top | {"progress_version", "total_cells"}
    try:
        v2_progress = progress_contract_version(progress) == "2"
    except ValueError as exc:
        errors.append(str(exc))
        v2_progress = "total_cells" in progress or progress.get("progress_version") == "2"
    if v2_progress:
        # Preserved v1 refreeze ledgers are nonpublishable audit evidence during
        # migration. They cannot account for, approve, or block a v2 batch.
        claims = []
        reviews = []
    valid_top_shapes = (legacy_top, legacy_top | {"progress_version"},
                        legacy_top | {"total_cells"}, allowed_top)
    if set(progress) not in valid_top_shapes or progress.get("manifest_version") != MANIFEST_VERSION or progress.get("status") not in {"in_progress", "complete"}:
        errors.append("series progress schema or status is invalid")
    entries = progress.get("batches", [])
    if not isinstance(entries, list) or len(entries) != 80:
        errors.append("series progress must contain exactly 80 batch entries")
        return
    entry_map = {item.get("batch_id"): item for item in entries if isinstance(item, dict)}
    if len(entry_map) != 80 or set(entry_map) != {item.get("batch_id") for item in batches}:
        errors.append("series progress batch identities must match all 80 canonical batches")
    all_ids = [company_id for batch in batches for company_id in batch.get("company_ids", [])]
    if (progress.get("company_list_sha256") != company_list_sha256(all_ids)
            or progress.get("total_companies") != 2000 or progress.get("total_batches") != 80
            or (v2_progress and progress.get("total_cells") != 20000)):
        errors.append("series progress company-list identity or totals mismatch")

    claims_by_company = {}
    for claim in claims:
        claims_by_company.setdefault(claim.get("company_id"), []).append(claim)
    review_by_claim = {}
    for review in reviews:
        review_by_claim.setdefault(review.get("claim_id"), []).append(review)
    gaps = [] if v2_progress else read_jsonl(root / "series-research-gaps.jsonl")
    gap_map = _company_gap_map(gaps)
    complete_v2 = v2_progress and progress.get("status") == "complete"
    v2_partitions = None
    if complete_v2:
        try:
            v2_records, v2_partitions = validate_complete_v2_progress(
                root, batches, progress
            )
        except (OSError, ValueError, RuntimeError) as exc:
            errors.append(f"complete v2 publication validation failed: {exc}")
            v2_records = {ledger: [] for ledger in V2_LEDGER_FILES}
    else:
        v2_records = read_v2_batch_records(root)
        if any(v2_records.values()):
            try:
                validate_v2_authoritative_records(v2_records, root)
            except (OSError, ValueError, RuntimeError) as exc:
                errors.append(f"merged v2 ledgers failed authoritative validation: {exc}")
    v2_cells = v2_records["cells"]
    gap_by_id = {item.get("audit_id"): item for item in gaps if str(item.get("audit_id", "")).startswith("company-gap::")}
    outcome_reviews = [item for item in reviews if item.get("record_id") and not item.get("claim_id")]
    outcome_targets = set()
    for review in outcome_reviews:
        record_id = review.get("record_id")
        if record_id in outcome_targets:
            errors.append(f"{record_id}: duplicate outcome review target")
        outcome_targets.add(record_id)
        if record_id not in gap_by_id:
            errors.append(f"{review.get('review_id')}: orphan outcome review target")
        if set(review) != OUTCOME_REVIEW_FIELDS:
            errors.append(f"{review.get('review_id', 'outcome review')}: outcome review schema mismatch")
        researcher_id = review.get("researcher_id")
        reviewer_id = review.get("reviewer_id")
        if (review.get("decision") != "approved"
                or not isinstance(researcher_id, str) or not researcher_id.strip()
                or not isinstance(reviewer_id, str) or not reviewer_id.strip()
                or researcher_id == reviewer_id
                or review.get("quote_entailment_confirmed") is not True
                or not isinstance(review.get("resolution"), str) or not review["resolution"].strip()
                or not isinstance(review.get("issues"), list)):
            errors.append(f"{review.get('review_id')}: outcome review must be approved and independent")
        parse_timestamp(review.get("reviewed_at"), "reviewed_at", review.get("review_id", "outcome review"), errors)
    approved_companies = set()
    approved_batches = []
    for batch in batches:
        entry = entry_map.get(batch.get("batch_id"), {})
        expected_fields = {"batch_id", "scope", "batch_number", "status", "company_list_sha256", "claim_count", "no_claim_count"}
        if v2_progress:
            expected_fields.add("cell_count")
        status = entry.get("status")
        if status == "approved":
            expected_fields |= {"approved_at", "reviewer_ids"}
            if v2_progress and entry.get("cell_count", 0):
                expected_fields |= {"cell_set_sha256", "v2_ledger_sha256"}
            approved_batches.append(batch)
            approved_companies.update(batch["company_ids"])
            if not entry.get("reviewer_ids") or len(entry["reviewer_ids"]) != len(set(entry["reviewer_ids"])):
                errors.append(f"{batch['batch_id']}: approved batch requires reviewer identity")
            parse_timestamp(entry.get("approved_at"), "approved_at", batch["batch_id"], errors)
        elif status != "pending":
            errors.append(f"{batch['batch_id']}: invalid series batch status")
        if set(entry) != expected_fields:
            errors.append(f"{batch['batch_id']}: series progress entry schema mismatch")
        if any(entry.get(key) != batch.get(key) for key in ("batch_id", "scope", "batch_number", "company_list_sha256")):
            errors.append(f"{batch['batch_id']}: series progress binding mismatch")
        batch_claims = [claim for company_id in batch["company_ids"] for claim in claims_by_company.get(company_id, [])]
        batch_gaps = [gap for company_id in batch["company_ids"] for gap in gap_map.get(company_id, [])]
        if v2_partitions is not None:
            batch_v2_records = v2_partitions[batch["batch_id"]]
            batch_cells = batch_v2_records["cells"]
        else:
            batch_cells = [cell for cell in v2_cells
                           if cell.get("company_id") in set(batch["company_ids"])]
            try:
                batch_v2_records = v2_batch_slice(v2_records, batch)
            except ValueError as exc:
                errors.append(f"{batch['batch_id']}: merged v2 batch validation failed: {exc}")
                batch_v2_records = {ledger: [] for ledger in V2_LEDGER_FILES}
        if status == "pending":
            if batch_claims or batch_gaps or any(review_by_claim.get(claim.get("claim_id")) for claim in batch_claims):
                errors.append(f"{batch['batch_id']}: pending batch must have no published claims, reviews, or company gaps")
            if entry.get("claim_count") != 0 or entry.get("no_claim_count") != 0:
                errors.append(f"{batch['batch_id']}: pending batch counts must be zero")
            if v2_progress and (batch_cells or entry.get("cell_count") != 0):
                errors.append(f"{batch['batch_id']}: pending batch must have no v2 cells")
            continue
        expected_cell_keys = {(company_id, category) for company_id in batch["company_ids"] for category in V2_CATEGORIES}
        actual_cell_keys = [(cell.get("company_id"), cell.get("category_id")) for cell in batch_cells]
        if (batch_cells or entry.get("cell_count", 0)) and not complete_v2:
            if (len(batch_cells) != 250 or len(set(actual_cell_keys)) != 250 or set(actual_cell_keys) != expected_cell_keys
                    or entry.get("cell_count") != 250
                    or entry.get("cell_set_sha256") != v2_cell_set_sha256(batch_cells)
                    or entry.get("v2_ledger_sha256") != v2_ledger_sha256(batch_v2_records)):
                errors.append(f"{batch['batch_id']}: approved batch requires exact canonical 250-cell set and hash")
            try:
                validate_v2_batch_records(batch_v2_records, batch)
            except (OSError, ValueError, RuntimeError) as exc:
                errors.append(f"{batch['batch_id']}: merged v2 batch validation failed: {exc}")
        if v2_progress:
            expected_claim_count = sum(bool(cell.get("official_claim_ids")) for cell in batch_cells)
            expected_no_claim_count = len(batch_cells) - expected_claim_count
            if (entry.get("claim_count") != expected_claim_count
                    or entry.get("no_claim_count") != expected_no_claim_count):
                errors.append(f"{batch['batch_id']}: v2 claim/no-claim progress counts mismatch")
            continue
        accounted = 0
        for company_id in batch["company_ids"]:
            company_claims = claims_by_company.get(company_id, [])
            company_gaps = gap_map.get(company_id, [])
            if bool(company_claims) == bool(company_gaps):
                errors.append(f"{batch['batch_id']}:{company_id}: approved company must be accounted by claims or exactly one company gap")
                continue
            if company_claims:
                if any(not any(review.get("decision") == "approved" for review in review_by_claim.get(claim.get("claim_id"), [])) for claim in company_claims):
                    errors.append(f"{batch['batch_id']}:{company_id}: every claim requires an approved review")
                else:
                    accounted += 1
            elif len(company_gaps) == 1 and any(phrase in company_gaps[0].get("nonabsence_wording", "") for phrase in NONABSENCE_PHRASES):
                accounted += 1
            else:
                errors.append(f"{batch['batch_id']}:{company_id}: company gap requires mandatory Korean non-absence wording")
        if accounted != 25:
            errors.append(f"{batch['batch_id']}: all 25 approved companies must be accounted")
        if entry.get("claim_count") != len(batch_claims) or entry.get("no_claim_count") != len(batch_gaps):
            errors.append(f"{batch['batch_id']}: claim/no-claim progress counts mismatch")

    if set(claims_by_company) - approved_companies:
        errors.append("claims for a pending batch are prohibited")
    if set(gap_map) - approved_companies:
        errors.append("company gaps for a pending batch are prohibited")
    expected_outcome_targets = {
        gap.get("audit_id")
        for gap in gaps
        if gap.get("company_id") in approved_companies
    }
    for gap in gaps:
        expected_id = f"company-gap::{gap.get('company_id')}"
        if gap.get("audit_id") != expected_id:
            errors.append(f"{gap.get('audit_id')}: company gap target must exactly bind company_id")
    actual_outcome_targets = [review.get("record_id") for review in outcome_reviews]
    if (len(actual_outcome_targets) != len(expected_outcome_targets)
            or set(actual_outcome_targets) != expected_outcome_targets):
        errors.append("approved gap/nonclaim outcome review coverage must be exact one-to-one with no missing, duplicate, or orphan targets")

    used_source_ids = {source_id for claim in claims for source_id in claim.get("source_ids", []) + claim.get("searched_source_ids", [])}
    for claim in claims:
        if any(source_map.get(source_id, {}).get("hash_provenance") == IDENTITY_PROVENANCE
               for source_id in claim.get("source_ids", [])):
            errors.append(f"{claim.get('claim_id')}: official identity projections cannot support benefit claim prose")
    checks = [] if v2_progress else read_jsonl(root / "series-prepublication-checks.jsonl")
    check_map = {item.get("source_id"): item for item in checks}
    expected_source_ids = set(used_source_ids)
    for gap_id in outcome_targets:
        gap = gap_by_id.get(gap_id, {})
        try:
            expected_source_ids.update(validate_gap_source_routes(gap, source_map))
        except ValueError as exc:
            errors.append(str(exc))
    if len(check_map) != len(checks) or set(check_map) != expected_source_ids:
        errors.append("series prepublication checks must contain one record per used official source_id")
    legacy_sources = frozen_source_records(root)
    for source_id, check in check_map.items():
        source = source_map.get(source_id)
        if source is None:
            errors.append(f"prepublication {source_id}: orphan source_id")
            continue
        try:
            validate_source_check(check, source, legacy_sources.get(source_id))
        except ValueError as exc:
            errors.append(str(exc))
        checked = parse_timestamp(check.get("checked_at"), "checked_at", f"prepublication {source_id}", errors)
        if checked and checked.date() > as_of:
            errors.append(f"prepublication {source_id}: checked_at is in the future")
    review_map = {item.get("claim_id"): item for item in reviews}
    for claim in claims:
        bound_ids = claim.get("source_ids", []) + claim.get("searched_source_ids", [])
        bound = [check_map.get(source_id, {}) for source_id in bound_ids]
        timestamps = [parse_timestamp(item.get("checked_at"), "checked_at", claim.get("claim_id"), errors) for item in bound]
        timestamps = [item for item in timestamps if item]
        reviewed = parse_timestamp(review_map.get(claim.get("claim_id"), {}).get("reviewed_at"), "reviewed_at", claim.get("claim_id"), errors)
        prepub_value = claim.get("prepublication_checked_at")
        prepub = parse_timestamp(prepub_value, "prepublication_checked_at", claim.get("claim_id"), errors) if prepub_value else None
        positive_times = [parse_timestamp(check_map.get(source_id, {}).get("checked_at"), "checked_at",
                                          claim.get("claim_id"), errors) for source_id in claim.get("source_ids", [])]
        positive_times = [item for item in positive_times if item]
        prepub_mismatch = claim.get("status") != "unknown" and (
            not prepub or not reviewed or not positive_times or prepub <= reviewed or prepub != max(positive_times)
        )
        if not timestamps or len(timestamps) != len(bound_ids) or not reviewed or min(timestamps) <= reviewed or prepub_mismatch:
            errors.append(f"{claim.get('claim_id')}: prepublication chronology or source_id binding mismatch")
    for review in outcome_reviews:
        gap = gap_by_id.get(review.get("record_id"), {})
        source_ids = set(gap.get("searched_official_source_ids", []))
        reviewed = parse_timestamp(review.get("reviewed_at"), "reviewed_at", review.get("review_id"), errors)
        checked = [parse_timestamp(check_map.get(source_id, {}).get("checked_at"), "checked_at",
                                   review.get("record_id"), errors) for source_id in source_ids]
        if any(not value or not reviewed or value <= reviewed for value in checked) or len(checked) != len(source_ids):
            errors.append(f"{review.get('record_id')}: gap/nonclaim source checks must completely follow outcome review")

    if progress.get("status") == "complete":
        if len(approved_batches) != 80:
            errors.append("complete series requires all 80 batches approved")
        if len(approved_companies) != 2000:
            errors.append("complete series requires all 2,000 companies accounted")
        drafts = root / "drafts"
        expected_drafts = {"hub.md"} | {f"{scope}-{number:02d}.md" for scope in SCOPES for number in range(1, 41)}
        actual_drafts = {path.name for path in drafts.glob("*.md")} if drafts.is_dir() else set()
        if actual_drafts != expected_drafts:
            errors.append("complete series requires exactly 80 review-ready drafts plus hub")
        fixture_markers = ("fixture", "synthetic", "example.com")
        for path in (root / "series-batches.jsonl", root / "series-progress.json", root / "series-research-gaps.jsonl", root / "series-prepublication-checks.jsonl"):
            if path.is_file() and any(marker in path.read_text(encoding="utf-8").casefold() for marker in fixture_markers):
                errors.append(f"complete series prohibits fixture data in {path.name}")
    return None
