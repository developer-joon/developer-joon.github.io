#!/usr/bin/env python3
"""Export approved benefit corrections as immutable offline-review candidates.

This tool never changes correction rows, evidence ledgers, or public artifacts.  Its
production transport uses a read-only psql transaction; JSON input exists for
credential-free tests and operator rehearsals.
"""

import argparse
import ctypes
import errno
import fcntl
import hashlib
import hmac
import ipaddress
import io
import json
import multiprocessing
import os
import platform
import re
import secrets
import selectors
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
import unicodedata
import uuid
from pathlib import Path
from urllib.parse import urlsplit


DB_FIELDS = {
    "id",
    "company_id",
    "category_id",
    "current_text",
    "proposed_text",
    "scope_text",
    "source_url",
    "observed_data_version",
    "status",
}
STATUSES = {"submitted", "reviewing", "approved", "rejected", "applied"}
CATEGORIES = {
    "leave", "family", "health", "growth", "housing",
    "commute", "remote", "retirement", "meals", "inclusion",
}
COMPANY_RE = re.compile(r"^(?:KR-CRN-[0-9]{13}|US-CIK[0-9]{10})$")
DATA_VERSION_RE = re.compile(r"^company-benefits-[0-9]{4}-[0-9]{2}-[0-9]{2}-v[1-9][0-9]*$")
SNAPSHOT_VERSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
HASH_RE = re.compile(r"^[0-9a-f]{64}$")
MAX_CANDIDATES = 10_000
# The complete canonical candidates.jsonl is capped at 64 MiB.  Validation is
# incremental, so neither the psql transport nor the accepted candidate set can
# grow toward the multi-gigabyte theoretical row-count maximum.
MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024
# JSON may escape each accepted Unicode code point as two UTF-16 ``\u`` pairs.
# This cap is derived from every projected text limit plus fixed JSON overhead.
MAX_DB_ROW_BYTES = (5000 + 5000 + 2000 + 2048 + 100 + 64 + 36 + 20 + 16) * 12 + 1024
MAX_PSQL_STDERR_BYTES = 64 * 1024
MAX_MANIFEST_BYTES = 10 * 1024 * 1024
MAX_DNS_ANSWERS = 64
DEFAULT_DNS_TIMEOUT_SECONDS = 2.0
DEFAULT_PSQL_TIMEOUT_SECONDS = 30.0
DEFAULT_PROCESS_KILL_GRACE_SECONDS = 0.5
TOMBSTONE_MARKER_NAME = ".approved-benefit-correction-export-tombstone.json"
TOMBSTONE_DOMAIN = "developer-joon.github.io/approved-benefit-correction-export/rollback-tombstone"
TOMBSTONE_HMAC_DOMAIN = b"developer-joon.github.io/approved-benefit-correction-export/tombstone-hmac-v1"
TOMBSTONE_VERSION = 2
TOMBSTONE_CONTROL_DIRECTORY_NAME = ".approved-benefit-correction-export-control"
TOMBSTONE_KEY_NAME = "tombstone-authentication.key"
TOMBSTONE_KEY_BYTES = 32

# The projection deliberately omits submitter/reviewer identity, audit events,
# provider metadata, tokens, email, and the moderator's internal response.
APPROVED_QUERY = rf"""
begin isolation level repeatable read read only;
select jsonb_build_object(
  'id',r.id,
  'company_id',r.company_id,
  'category_id',r.category_id,
  'current_text',r.current_text,
  'proposed_text',r.proposed_text,
  'scope_text',r.scope_text,
  'source_url',r.source_url,
  'observed_data_version',r.observed_data_version,
  'status',r.status
)::text
from (
  select id,company_id,category_id,current_text,proposed_text,scope_text,
         source_url,observed_data_version,status
  from public.benefit_correction_requests r
  where r.status='approved'
  order by id
  limit {MAX_CANDIDATES + 1}
) r
order by r.id;
commit;
"""


def _require_text(value, field, maximum):
    if not isinstance(value, str) or not value or value != value.strip(" ") or len(value) > maximum:
        raise ValueError(f"invalid {field}")
    if "\x00" in value or any(0xD800 <= ord(character) <= 0xDFFF for character in value):
        raise ValueError(f"invalid {field}")
    return value


def _require_uuid(value):
    if not isinstance(value, str):
        raise ValueError("invalid id")
    try:
        parsed = uuid.UUID(value)
    except (ValueError, AttributeError) as exc:
        raise ValueError("invalid id") from exc
    if str(parsed) != value.lower():
        raise ValueError("invalid id")
    return value.lower()


def _require_data_version(value, field="observed_data_version"):
    value = _require_text(value, field, 100)
    if not DATA_VERSION_RE.fullmatch(value):
        raise ValueError(f"invalid {field}")
    try:
        # Parsing without importing date keeps the accepted format aligned with
        # the DB helper while rejecting impossible month/day combinations.
        from datetime import date
        date.fromisoformat(value[17:27])
    except ValueError as exc:
        raise ValueError(f"invalid {field}") from exc
    return value


def _system_resolver(hostname):
    """Return every A/AAAA address from the operating system resolver."""
    answers = socket.getaddrinfo(
        hostname, 443, family=socket.AF_UNSPEC, type=socket.SOCK_STREAM,
        proto=socket.IPPROTO_TCP,
    )
    return [answer[4][0] for answer in answers]


def _resolver_worker(connection, resolver, hostname):
    """Resolve in a disposable process so a stuck libc/NSS call is killable."""
    try:
        raw_answers = resolver(hostname)
        if isinstance(raw_answers, (str, bytes)):
            raise ValueError("malformed resolver answer")
        answers = []
        for index, answer in enumerate(raw_answers):
            if index >= MAX_DNS_ANSWERS:
                raise ValueError("too many resolver answers")
            answers.append(answer)
        connection.send((answers, False))
    except BaseException:  # Child diagnostics must not expose resolver internals.
        try:
            connection.send((None, True))
        except (BrokenPipeError, EOFError, OSError):
            pass
    finally:
        connection.close()


def _stop_process(process, grace_seconds=DEFAULT_PROCESS_KILL_GRACE_SECONDS):
    """Terminate, escalate to kill, and always reap a worker process."""
    if not process.is_alive():
        process.join()
        return
    process.terminate()
    process.join(grace_seconds)
    if process.is_alive():
        process.kill()
        process.join()


def _bounded_resolve(hostname, resolver, timeout_seconds):
    if not isinstance(timeout_seconds, (int, float)) or isinstance(timeout_seconds, bool) or timeout_seconds <= 0:
        raise ValueError("invalid public evidence URL")
    # Linux is the publication platform. Fork preserves injected resolver
    # callables (including closures) while still making every worker killable.
    context = multiprocessing.get_context("fork")
    parent_connection, child_connection = context.Pipe(duplex=False)
    process = context.Process(
        target=_resolver_worker,
        args=(child_connection, resolver, hostname),
        name="benefit-url-resolver",
    )
    process.start()
    child_connection.close()
    try:
        if not parent_connection.poll(timeout_seconds):
            raise ValueError("invalid public evidence URL")
        answers, failed = parent_connection.recv()
    except (EOFError, OSError) as exc:
        raise ValueError("invalid public evidence URL") from exc
    finally:
        parent_connection.close()
        _stop_process(process)
    if failed or not answers:
        raise ValueError("invalid public evidence URL")
    return answers


def _ascii_hostname(hostname):
    if any(
        character in "\u3002\uff0e\uff61" or unicodedata.category(character).startswith("C")
        for character in hostname
    ):
        raise ValueError("invalid public evidence URL")
    try:
        ascii_host = hostname.encode("idna").decode("ascii").lower()
    except (UnicodeError, AttributeError) as exc:
        raise ValueError("invalid public evidence URL") from exc
    if len(ascii_host) > 253 or ascii_host.endswith("."):
        raise ValueError("invalid public evidence URL")
    labels = ascii_host.split(".")
    if len(labels) < 2 or any(not label or len(label) > 63 for label in labels):
        raise ValueError("invalid public evidence URL")
    label_pattern = re.compile(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?")
    if any(not label_pattern.fullmatch(label) for label in labels):
        raise ValueError("invalid public evidence URL")
    for label in labels:
        if label.startswith("xn--"):
            try:
                if label.encode("ascii").decode("idna").encode("idna").decode("ascii").lower() != label:
                    raise ValueError("invalid public evidence URL")
            except UnicodeError as exc:
                raise ValueError("invalid public evidence URL") from exc
    return ascii_host


def _require_public_https_url(value, resolver, resolver_timeout_seconds, resolution_cache):
    value = _require_text(value, "source_url", 2048)
    if any(character.isspace() or ord(character) < 32 for character in value):
        raise ValueError("invalid public evidence URL")
    try:
        parsed = urlsplit(value)
        port = parsed.port
        username = parsed.username
        password = parsed.password
    except ValueError as exc:
        raise ValueError("invalid public evidence URL") from exc
    if parsed.scheme != "https" or not parsed.netloc or username is not None or password is not None:
        raise ValueError("invalid public evidence URL")
    authority = parsed.netloc
    if "@" in authority or "[" in authority or "]" in authority:
        raise ValueError("invalid public evidence URL")
    if port is not None and not 1 <= port <= 65535:
        raise ValueError("invalid public evidence URL")
    host = parsed.hostname or ""
    ascii_host = _ascii_hostname(host)
    if re.fullmatch(r"[0-9.]+", ascii_host):
        raise ValueError("invalid public evidence URL")
    numeric_labels = re.compile(r"(?:[0-9]+|0x[0-9a-f]+)")
    if all(numeric_labels.fullmatch(label) for label in ascii_host.split(".")):
        raise ValueError("invalid public evidence URL")
    if (
        ascii_host == "localhost"
        or ascii_host.endswith((".localhost", ".local", ".internal", ".test", ".invalid"))
    ):
        raise ValueError("invalid public evidence URL")
    answers = resolution_cache.get(ascii_host)
    if answers is None:
        answers = _bounded_resolve(ascii_host, resolver, resolver_timeout_seconds)
    for answer in answers:
        if not isinstance(answer, str):
            raise ValueError("invalid public evidence URL")
        try:
            address = ipaddress.ip_address(answer)
        except ValueError as exc:
            raise ValueError("invalid public evidence URL") from exc
        mapped = getattr(address, "ipv4_mapped", None)
        prohibited = (
            not address.is_global or address.is_private or address.is_loopback
            or address.is_link_local or address.is_reserved or address.is_multicast
            or address.is_unspecified
        )
        mapped_prohibited = mapped is not None and (
            not mapped.is_global or mapped.is_private or mapped.is_loopback
            or mapped.is_link_local or mapped.is_reserved or mapped.is_multicast
            or mapped.is_unspecified
        )
        if prohibited or mapped_prohibited:
            raise ValueError("invalid public evidence URL")
    resolution_cache[ascii_host] = tuple(answers)
    return value


def _validate_row(row, index, resolver, resolver_timeout_seconds, resolution_cache):
    if not isinstance(row, dict):
        raise ValueError(f"database row {index} must be an object")
    unknown = set(row) - DB_FIELDS
    missing = DB_FIELDS - set(row)
    if unknown:
        raise ValueError(f"database row {index} has unexpected fields: {sorted(unknown)}")
    if missing:
        raise ValueError(f"database row {index} is missing fields: {sorted(missing)}")
    status = row["status"]
    if not isinstance(status, str) or status not in STATUSES:
        raise ValueError(f"database row {index} has invalid status")
    request_id = _require_uuid(row["id"])
    company_id = _require_text(row["company_id"], "company_id", 64)
    if not COMPANY_RE.fullmatch(company_id):
        raise ValueError("invalid company_id")
    category_id = _require_text(row["category_id"], "category_id", 20)
    if category_id not in CATEGORIES:
        raise ValueError("invalid category_id")
    candidate = {
        "correction_request_id": request_id,
        "company_id": company_id,
        "category_id": category_id,
        "current_text": _require_text(row["current_text"], "current_text", 5000),
        "proposed_text": _require_text(row["proposed_text"], "proposed_text", 5000),
        "scope_text": _require_text(row["scope_text"], "scope_text", 2000),
        "evidence_url": _require_public_https_url(
            row["source_url"], resolver, resolver_timeout_seconds, resolution_cache
        ),
        "observed_data_version": _require_data_version(row["observed_data_version"]),
    }
    return status, candidate


def _canonical_json_bytes(value):
    encoded = json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    # Keep canonical JSON safe even if an operator accidentally embeds it in an
    # HTML/script context; JSON parsers restore the original untrusted text.
    encoded = encoded.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    return (encoded + "\n").encode("utf-8")


class _SnapshotFile:
    """A repeatably readable, bounded canonical JSONL file."""

    def __init__(self, spool):
        self.spool = spool
        self.byte_count = spool.byte_count
        self.sha256 = spool.sha256

    def chunks(self, chunk_size=1024 * 1024):
        yield from self.spool.iter_chunks(chunk_size)


class _SnapshotSpool:
    """Disk-backed canonical candidates plus bounded duplicate metadata."""

    def __init__(self, file_object, records, byte_count, digest):
        self._file = file_object
        self._records = records
        self.byte_count = byte_count
        self.sha256 = digest
        self._ordered_ids = tuple(
            key for key in sorted(records) if records[key][0] == "approved"
        )

    def __len__(self):
        return len(self._ordered_ids)

    def __iter__(self):
        descriptor = self._file.fileno()
        for request_id in self._ordered_ids:
            _status, _fingerprint, offset, length = self._records[request_id]
            raw = os.pread(descriptor, length, offset)
            if len(raw) != length:
                raise OSError(errno.EIO, "snapshot spool truncated")
            yield json.loads(raw)

    def __getitem__(self, index):
        if isinstance(index, slice):
            return list(self)[index]
        request_id = self._ordered_ids[index]
        _status, _fingerprint, offset, length = self._records[request_id]
        raw = os.pread(self._file.fileno(), length, offset)
        if len(raw) != length:
            raise OSError(errno.EIO, "snapshot spool truncated")
        return json.loads(raw)

    def iter_chunks(self, chunk_size=1024 * 1024):
        offset = 0
        descriptor = self._file.fileno()
        while offset < self.byte_count:
            raw = os.pread(descriptor, min(chunk_size, self.byte_count - offset), offset)
            if not raw:
                raise OSError(errno.EIO, "snapshot spool truncated")
            offset += len(raw)
            yield raw

    def read_bytes(self):
        return b"".join(self.iter_chunks())

    def close(self):
        if self._file is not None:
            self._file.close()
            self._file = None

    def __del__(self):
        self.close()


class _SnapshotAccumulator:
    """Validate rows into a disk spool while retaining only fixed-size metadata."""

    def __init__(self, resolver, resolver_timeout_seconds):
        self.resolver = resolver or _system_resolver
        self.resolver_timeout_seconds = resolver_timeout_seconds
        self.resolution_cache = {}
        self.records = {}
        self.canonical_bytes = 0
        self.row_count = 0
        self._unordered = tempfile.TemporaryFile(mode="w+b")

    def close(self):
        if self._unordered is not None:
            self._unordered.close()
            self._unordered = None

    def add(self, row):
        if self.row_count >= MAX_CANDIDATES:
            raise ValueError("database response exceeds candidate limit")
        index = self.row_count
        self.row_count += 1
        status, candidate = _validate_row(
            row, index, self.resolver, self.resolver_timeout_seconds,
            self.resolution_cache,
        )
        request_id = candidate["correction_request_id"]
        prior = self.records.get(request_id)
        fingerprint = hashlib.sha256(
            _canonical_json_bytes((status, candidate))
        ).digest()
        if prior is not None:
            if prior[1] != fingerprint:
                raise ValueError(f"conflicting duplicate correction request: {request_id}")
            return
        if status == "approved":
            candidate_raw = _canonical_json_bytes(candidate)
            candidate_bytes = len(candidate_raw)
            if self.canonical_bytes + candidate_bytes > MAX_SNAPSHOT_BYTES:
                raise ValueError("database response exceeds snapshot byte limit")
            offset = self._unordered.tell()
            self._unordered.write(candidate_raw)
            self.canonical_bytes += candidate_bytes
            self.records[request_id] = (status, fingerprint, offset, candidate_bytes)
        else:
            # Non-approved rows are fixture-only (the SQL filters them). Keep a
            # fixed-size digest for duplicate-conflict detection, not their text.
            self.records[request_id] = (status, fingerprint, None, None)

    def finish(self):
        ordered = tempfile.TemporaryFile(mode="w+b")
        digest = hashlib.sha256()
        byte_count = 0
        try:
            self._unordered.flush()
            for request_id in sorted(self.records):
                status, fingerprint, offset, length = self.records[request_id]
                if status != "approved":
                    continue
                raw = os.pread(self._unordered.fileno(), length, offset)
                if len(raw) != length:
                    raise OSError(errno.EIO, "snapshot spool truncated")
                final_offset = byte_count
                ordered.write(raw)
                digest.update(raw)
                byte_count += length
                self.records[request_id] = (
                    status, fingerprint, final_offset, length
                )
            ordered.flush()
            result = _SnapshotSpool(
                ordered, self.records, byte_count, digest.hexdigest()
            )
            ordered = None
            return result
        finally:
            self.close()
            if ordered is not None:
                ordered.close()


def build_snapshot(rows, resolver=None, resolver_timeout_seconds=DEFAULT_DNS_TIMEOUT_SECONDS):
    """Validate an exact DB projection under row and canonical-byte limits."""
    if not isinstance(rows, list):
        raise ValueError("database response must be an array")
    accumulator = _SnapshotAccumulator(resolver, resolver_timeout_seconds)
    try:
        for row in rows:
            accumulator.add(row)
        return accumulator.finish()
    finally:
        accumulator.close()


def canonical_jsonl(candidates):
    if isinstance(candidates, _SnapshotSpool):
        return candidates.read_bytes()
    output = io.BytesIO()
    total = 0
    for candidate in candidates:
        raw = _canonical_json_bytes(candidate)
        total += len(raw)
        if total > MAX_SNAPSHOT_BYTES:
            raise ValueError("snapshot exceeds snapshot byte limit")
        output.write(raw)
    return output.getvalue()


def snapshot_sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def _expected_files(snapshot_version, candidates):
    if isinstance(candidates, _SnapshotSpool):
        rows = _SnapshotFile(candidates)
        candidate_count = len(candidates)
        candidate_sha256 = candidates.sha256
    else:
        rows = canonical_jsonl(candidates)
        candidate_count = len(candidates)
        candidate_sha256 = snapshot_sha256(rows)
    manifest = {
        "artifact_kind": "approved_benefit_correction_offline_review_snapshot",
        "candidate_count": candidate_count,
        "candidates_file": "candidates.jsonl",
        "schema_version": 1,
        "snapshot_sha256": candidate_sha256,
        "snapshot_version": snapshot_version,
    }
    return {"candidates.jsonl": rows, "manifest.json": _canonical_json_bytes(manifest)}


def _same_inode(left, right):
    return (left.st_dev, left.st_ino, stat.S_IFMT(left.st_mode)) == (
        right.st_dev, right.st_ino, stat.S_IFMT(right.st_mode)
    )


def _read_regular_file_at(directory_fd, name):
    descriptor = os.open(
        name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=directory_fd,
    )
    try:
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode):
            raise OSError(errno.EINVAL, "snapshot member is not a regular file")
        chunks = []
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
        current = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        if not stat.S_ISREG(current.st_mode) or not _same_inode(opened, current):
            raise OSError(errno.ESTALE, "snapshot member changed during validation")
        return b"".join(chunks), opened
    finally:
        os.close(descriptor)


def _streamed_regular_file_matches_at(directory_fd, name, expected):
    """Hash a large expected member without retaining its bytes in memory."""
    descriptor = os.open(
        name,
        os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=directory_fd,
    )
    try:
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode) or opened.st_size != expected.byte_count:
            return False, opened
        digest = hashlib.sha256()
        remaining = expected.byte_count
        while remaining:
            chunk = os.read(descriptor, min(1024 * 1024, remaining))
            if not chunk:
                return False, opened
            digest.update(chunk)
            remaining -= len(chunk)
        if os.read(descriptor, 1):
            return False, opened
        current = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        return (
            stat.S_ISREG(current.st_mode)
            and _same_inode(opened, current)
            and hmac.compare_digest(digest.hexdigest(), expected.sha256)
        ), opened
    finally:
        os.close(descriptor)


def _directory_binding_matches(root_fd, target_name, target_fd, opened_directory):
    """Prove a root entry still directly names the opened directory."""
    try:
        named_directory = os.stat(
            target_name, dir_fd=root_fd, follow_symlinks=False
        )
        current_directory = os.fstat(target_fd)
    except OSError:
        return False
    return (
        stat.S_ISDIR(named_directory.st_mode)
        and not stat.S_ISLNK(named_directory.st_mode)
        and _same_inode(opened_directory, named_directory)
        and stat.S_ISDIR(current_directory.st_mode)
        and _same_inode(opened_directory, current_directory)
    )


def _directory_matches(
    root_fd,
    target_name,
    expected,
    expected_directory=None,
    expected_files=None,
):
    """Validate an exact inventory without following target/member symlinks."""
    try:
        target_fd = os.open(
            target_name,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=root_fd,
        )
    except OSError:
        return False
    try:
        return _directory_fd_matches(
            root_fd,
            target_name,
            target_fd,
            expected,
            expected_directory=expected_directory,
            expected_files=expected_files,
        )
    finally:
        os.close(target_fd)


def _directory_fd_matches(
    root_fd,
    target_name,
    target_fd,
    expected,
    expected_directory=None,
    expected_files=None,
):
    """Validate an opened directory and its stable binding under root_fd."""
    opened_directory = os.fstat(target_fd)
    if not stat.S_ISDIR(opened_directory.st_mode):
        return False
    if expected_directory is not None and not _same_inode(
        opened_directory, expected_directory
    ):
        return False
    first_inventory = os.listdir(target_fd)
    if len(first_inventory) != len(expected) or set(first_inventory) != set(expected):
        return False
    if not _directory_binding_matches(
        root_fd, target_name, target_fd, opened_directory
    ):
        return False
    opened_files = {}
    for name in first_inventory:
        try:
            expected_value = expected[name]
            if isinstance(expected_value, _SnapshotFile):
                matches, metadata = _streamed_regular_file_matches_at(
                    target_fd, name, expected_value
                )
                if not matches:
                    return False
            else:
                raw, metadata = _read_regular_file_at(target_fd, name)
                if raw != expected_value:
                    return False
        except OSError:
            return False
        if expected_files is not None and not _same_inode(
            metadata, expected_files[name]
        ):
            return False
        opened_files[name] = metadata

    if not _directory_binding_matches(
        root_fd, target_name, target_fd, opened_directory
    ):
        return False

    # Re-list and re-stat each entry to prove the validated inventory still
    # names the same inodes after every byte comparison.
    second_inventory = os.listdir(target_fd)
    if len(second_inventory) != len(first_inventory) or set(second_inventory) != set(first_inventory):
        return False
    for name, opened in opened_files.items():
        try:
            current = os.stat(name, dir_fd=target_fd, follow_symlinks=False)
        except OSError:
            return False
        if not stat.S_ISREG(current.st_mode) or not _same_inode(opened, current):
            return False
    return _directory_binding_matches(
        root_fd, target_name, target_fd, opened_directory
    )


def _fsync_directory_fd(descriptor):
    os.fsync(descriptor)


def _write_expected_file(descriptor, expected):
    chunks = expected.chunks() if isinstance(expected, _SnapshotFile) else (expected,)
    for chunk in chunks:
        view = memoryview(chunk)
        while view:
            written = os.write(descriptor, view)
            view = view[written:]


def _renameat2_function():
    libc = ctypes.CDLL(None, use_errno=True)
    function = getattr(libc, "renameat2", None)
    if function is None:
        raise OSError(errno.ENOTSUP, "Linux renameat2 is unavailable")
    function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    function.restype = ctypes.c_int
    return function


def _preflight_cleanup_hook(_stage, _context):
    """Test hook for deterministic mutation at cleanup trust boundaries."""


def _cleanup_metadata_matches(current, expected):
    """Match every attribute relied on before destructive probe cleanup."""
    return (
        current.st_dev,
        current.st_ino,
        stat.S_IFMT(current.st_mode),
        current.st_nlink,
        current.st_uid,
        stat.S_IMODE(current.st_mode),
    ) == (
        expected.st_dev,
        expected.st_ino,
        stat.S_IFMT(expected.st_mode),
        expected.st_nlink,
        expected.st_uid,
        stat.S_IMODE(expected.st_mode),
    )


def _preflight_cleanup_error(root, probe_name, detail, residue_fd=None):
    residue = root / probe_name if probe_name else root
    if residue_fd is not None:
        try:
            residue = Path(os.readlink(f"/proc/self/fd/{residue_fd}"))
        except OSError:
            pass
    return OSError(
        errno.ESTALE,
        f"capability preflight cleanup uncertain ({detail}); manual cleanup required; "
        f"foreign entries and exporter residue preserved at {residue}",
    )


def _preflight_publication_platform(output_root):
    """Prove rename semantics with real entries in the exact private output FS."""
    if platform.system() != "Linux" or "fork" not in multiprocessing.get_all_start_methods():
        raise OSError(errno.ENOTSUP, "unsupported publication platform")
    root = Path(output_root).absolute()
    parent_fd = os.open(
        root.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    )
    root_fd = None
    probe_fd = None
    root_created = False
    root_metadata = None
    probe_metadata = None
    file_metadata = []
    exchange_completed = False
    nonce = secrets.token_hex(16)
    probe_name = f".benefit-export-preflight-{nonce}"
    names = ("source", "target")
    contents = (b"preflight-source", b"preflight-target")
    try:
        parent_metadata = os.fstat(parent_fd)
        if (
            parent_metadata.st_uid != os.geteuid()
            or stat.S_IMODE(parent_metadata.st_mode) & 0o022
            or not _root_path_still_names_fd(root.parent, parent_fd)
        ):
            raise OSError(errno.EPERM, "output root parent is not private")
        fcntl.flock(parent_fd, fcntl.LOCK_EX)
        if not _root_path_still_names_fd(root.parent, parent_fd):
            raise OSError(errno.ESTALE, "output root parent changed while locking")
        try:
            os.mkdir(root.name, 0o700, dir_fd=parent_fd)
            root_created = True
            _fsync_directory_fd(parent_fd)
        except FileExistsError:
            pass
        root_fd = os.open(
            root.name,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=parent_fd,
        )
        root_metadata = os.fstat(root_fd)
        named_root = os.stat(root.name, dir_fd=parent_fd, follow_symlinks=False)
        if (
            not _secure_owned_mode(root_metadata, stat.S_ISDIR, 0o700)
            or not _same_inode(root_metadata, named_root)
            or not _root_path_still_names_fd(root, root_fd)
        ):
            raise OSError(errno.EPERM, "invalid output root")

        os.mkdir(probe_name, 0o700, dir_fd=root_fd)
        _fsync_directory_fd(root_fd)
        probe_fd = os.open(
            probe_name,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=root_fd,
        )
        fcntl.flock(probe_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        probe_metadata = os.fstat(probe_fd)
        named_probe = os.stat(probe_name, dir_fd=root_fd, follow_symlinks=False)
        if (
            not _secure_owned_mode(probe_metadata, stat.S_ISDIR, 0o700)
            or not _cleanup_metadata_matches(named_probe, probe_metadata)
        ):
            raise OSError(errno.EPERM, "invalid capability probe directory")

        for name, raw in zip(names, contents):
            descriptor = os.open(
                name,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                0o600,
                dir_fd=probe_fd,
            )
            try:
                _write_expected_file(descriptor, raw)
                os.fsync(descriptor)
                metadata = os.fstat(descriptor)
                if not _secure_owned_mode(metadata, stat.S_ISREG, 0o600) or metadata.st_nlink != 1:
                    raise OSError(errno.EPERM, "invalid capability probe file")
                file_metadata.append(metadata)
            finally:
                os.close(descriptor)
        _fsync_directory_fd(probe_fd)

        function = _renameat2_function()
        ctypes.set_errno(0)
        result = function(probe_fd, names[0].encode(), probe_fd, names[1].encode(), 1)
        error_number = ctypes.get_errno()
        if result == 0 or error_number != errno.EEXIST:
            raise OSError(errno.ENOTSUP, "renameat2 no-replace is unsupported on output filesystem")
        for index, (name, raw) in enumerate(zip(names, contents)):
            current_raw, current = _read_regular_file_at(probe_fd, name)
            if current_raw != raw or not _same_inode(current, file_metadata[index]):
                raise OSError(errno.ENOTSUP, "renameat2 no-replace semantics are incorrect")

        ctypes.set_errno(0)
        result = function(probe_fd, names[0].encode(), probe_fd, names[1].encode(), 2)
        if result != 0:
            raise OSError(errno.ENOTSUP, "renameat2 exchange is unsupported on output filesystem")
        exchange_completed = True
        for index, (name, raw) in enumerate(zip(names, reversed(contents))):
            current_raw, current = _read_regular_file_at(probe_fd, name)
            if current_raw != raw or not _same_inode(current, file_metadata[1 - index]):
                raise OSError(errno.ENOTSUP, "renameat2 exchange semantics are incorrect")
        _fsync_directory_fd(probe_fd)
    finally:
        cleanup_error = None
        context = {
            "root": root,
            "root_fd": root_fd,
            "probe_name": probe_name,
            "probe_fd": probe_fd,
            "names": names,
        }
        if probe_fd is not None:
            try:
                _preflight_cleanup_hook("before_probe_cleanup", context)
                if len(file_metadata) != len(names) or set(os.listdir(probe_fd)) != set(names):
                    raise _preflight_cleanup_error(root, probe_name, "probe inventory changed")
                if probe_metadata is None or not _cleanup_metadata_matches(
                    os.fstat(probe_fd), probe_metadata
                ):
                    raise _preflight_cleanup_error(root, probe_name, "probe descriptor changed")
                named_probe = os.stat(
                    probe_name, dir_fd=root_fd, follow_symlinks=False
                )
                if not _cleanup_metadata_matches(named_probe, probe_metadata):
                    raise _preflight_cleanup_error(root, probe_name, "probe pathname changed")
                expected_metadata = (
                    tuple(reversed(file_metadata))
                    if exchange_completed
                    else tuple(file_metadata)
                )
                for name, expected in zip(names, expected_metadata):
                    current = os.stat(name, dir_fd=probe_fd, follow_symlinks=False)
                    if not _cleanup_metadata_matches(current, expected):
                        raise _preflight_cleanup_error(
                            root, probe_name, f"probe member {name} changed"
                        )
                for name, expected in zip(names, expected_metadata):
                    current = os.stat(name, dir_fd=probe_fd, follow_symlinks=False)
                    if not _cleanup_metadata_matches(current, expected):
                        raise _preflight_cleanup_error(
                            root, probe_name, f"probe member {name} changed before unlink"
                        )
                    os.unlink(name, dir_fd=probe_fd)
                _fsync_directory_fd(probe_fd)
                _preflight_cleanup_hook("before_probe_directory_cleanup", context)
                if os.listdir(probe_fd):
                    raise _preflight_cleanup_error(root, probe_name, "probe directory is not empty")
                if not _cleanup_metadata_matches(os.fstat(probe_fd), probe_metadata):
                    raise _preflight_cleanup_error(root, probe_name, "probe descriptor changed")
                named_probe = os.stat(
                    probe_name, dir_fd=root_fd, follow_symlinks=False
                )
                if not _cleanup_metadata_matches(named_probe, probe_metadata):
                    raise _preflight_cleanup_error(root, probe_name, "probe pathname changed")
                os.rmdir(probe_name, dir_fd=root_fd)
                _fsync_directory_fd(root_fd)
            except OSError as exc:
                cleanup_error = _preflight_cleanup_error(
                    root, probe_name, str(exc), residue_fd=probe_fd
                )
            finally:
                os.close(probe_fd)
                probe_fd = None
        if root_fd is not None:
            try:
                if cleanup_error is None and root_created:
                    _preflight_cleanup_hook("before_root_cleanup", context)
                    if os.listdir(root_fd):
                        raise _preflight_cleanup_error(root, probe_name, "output root is not empty")
                    current_root = os.fstat(root_fd)
                    if (
                        root_metadata is None
                        or not _cleanup_metadata_matches(current_root, root_metadata)
                        or not _root_path_still_names_fd(root, root_fd)
                    ):
                        raise _preflight_cleanup_error(root, probe_name, "output root pathname changed")
                    named_root = os.stat(
                        root.name, dir_fd=parent_fd, follow_symlinks=False
                    )
                    if not _cleanup_metadata_matches(named_root, root_metadata):
                        raise _preflight_cleanup_error(root, probe_name, "output root pathname changed")
                    os.rmdir(root.name, dir_fd=parent_fd)
                    _fsync_directory_fd(parent_fd)
            except OSError as exc:
                cleanup_error = _preflight_cleanup_error(
                    root, probe_name, str(exc), residue_fd=root_fd
                )
            finally:
                os.close(root_fd)
        os.close(parent_fd)
        if cleanup_error is not None:
            raise cleanup_error


def _open_secure_output_root(output_root):
    """Create/open an exact private root and prove its descriptor/name binding."""
    root = Path(output_root).absolute()
    parent = root.parent
    parent_fd = os.open(
        parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    )
    try:
        parent_metadata = os.fstat(parent_fd)
        if (
            not _secure_owned_mode(parent_metadata, stat.S_ISDIR, stat.S_IMODE(parent_metadata.st_mode))
            or stat.S_IMODE(parent_metadata.st_mode) & 0o022
            or not _root_path_still_names_fd(parent, parent_fd)
        ):
            raise OSError(errno.EPERM, "output root parent is not private")
        try:
            os.mkdir(root.name, 0o700, dir_fd=parent_fd)
            _fsync_directory_fd(parent_fd)
        except FileExistsError:
            pass
        root_fd = os.open(
            root.name,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=parent_fd,
        )
        try:
            opened = os.fstat(root_fd)
            named = os.stat(root.name, dir_fd=parent_fd, follow_symlinks=False)
            if (
                not _secure_owned_mode(opened, stat.S_ISDIR, 0o700)
                or not _secure_owned_mode(named, stat.S_ISDIR, 0o700)
                or not _same_inode(opened, named)
                or not _root_path_still_names_fd(root, root_fd)
            ):
                raise OSError(errno.EPERM, "invalid output root")
            return root, root_fd, opened
        except Exception:
            os.close(root_fd)
            raise
    finally:
        os.close(parent_fd)


def _secure_output_root_binding(root, root_fd, expected):
    current = os.fstat(root_fd)
    return (
        _secure_owned_mode(current, stat.S_ISDIR, 0o700)
        and _same_inode(expected, current)
        and _root_path_still_names_fd(root, root_fd)
    )


def _rename_noreplace(source, target, source_dir_fd=-100, target_dir_fd=-100):
    """Atomically publish a directory without replacing any existing target."""
    renameat2 = _renameat2_function()
    result = renameat2(
        source_dir_fd,
        os.fsencode(source),
        target_dir_fd,
        os.fsencode(target),
        1,
    )
    if result == 0:
        return
    error_number = ctypes.get_errno()
    if error_number == errno.EEXIST:
        raise FileExistsError(error_number, os.strerror(error_number), target)
    raise OSError(error_number, os.strerror(error_number), target)


def _rename_exchange(source, target, source_dir_fd=-100, target_dir_fd=-100):
    """Atomically exchange two existing names without an unsafe fallback."""
    renameat2 = _renameat2_function()
    result = renameat2(
        source_dir_fd,
        os.fsencode(source),
        target_dir_fd,
        os.fsencode(target),
        2,
    )
    if result == 0:
        return
    error_number = ctypes.get_errno()
    raise OSError(error_number, os.strerror(error_number), target)


def _publish_staging_noreplace(
    root_fd,
    staging_fd,
    staging_name,
    target_name,
    expected,
    expected_directory,
    expected_files,
):
    """Revalidate the opened staging directory immediately before publication."""
    if not _directory_fd_matches(
        root_fd,
        staging_name,
        staging_fd,
        expected,
        expected_directory=expected_directory,
        expected_files=expected_files,
    ):
        raise OSError(errno.ESTALE, "snapshot staging validation failed")
    _rename_noreplace(
        staging_name,
        target_name,
        source_dir_fd=root_fd,
        target_dir_fd=root_fd,
    )


def _root_path_still_names_fd(root, root_fd):
    try:
        path_metadata = root.lstat()
    except OSError:
        return False
    return (
        stat.S_ISDIR(path_metadata.st_mode)
        and not stat.S_ISLNK(path_metadata.st_mode)
        and _same_inode(path_metadata, os.fstat(root_fd))
    )


def _remove_directory_contents(directory_fd):
    """Remove a directory tree through descriptors without following links."""
    for name in os.listdir(directory_fd):
        try:
            os.unlink(name, dir_fd=directory_fd)
            continue
        except FileNotFoundError:
            continue
        except IsADirectoryError:
            pass
        child_fd = os.open(
            name,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=directory_fd,
        )
        try:
            opened_child = os.fstat(child_fd)
            _remove_directory_contents(child_fd)
            named_child = os.stat(
                name, dir_fd=directory_fd, follow_symlinks=False
            )
            if not stat.S_ISDIR(named_child.st_mode) or not _same_inode(
                opened_child, named_child
            ):
                raise OSError(errno.ESTALE, "staging member changed during cleanup")
        finally:
            os.close(child_fd)
        os.rmdir(name, dir_fd=directory_fd)


def _remove_staging(root_fd, staging_name, _expected_names, expected_directory=None):
    if expected_directory is None:
        return
    try:
        staging_fd = os.open(
            staging_name,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=root_fd,
        )
    except FileNotFoundError:
        return
    try:
        if expected_directory is not None and not _same_inode(
            os.fstat(staging_fd), expected_directory
        ):
            return
        _remove_directory_contents(staging_fd)
    finally:
        os.close(staging_fd)
    try:
        current = os.stat(staging_name, dir_fd=root_fd, follow_symlinks=False)
        if expected_directory is not None and not _same_inode(
            current, expected_directory
        ):
            return
        os.rmdir(staging_name, dir_fd=root_fd)
    except FileNotFoundError:
        pass


def _read_tombstone_key_bytes(descriptor):
    key = bytearray()
    remaining = TOMBSTONE_KEY_BYTES + 1
    while remaining:
        chunk = os.read(descriptor, remaining)
        if not chunk:
            break
        key.extend(chunk)
        remaining -= len(chunk)
    return key


def _secure_owned_mode(metadata, file_type, mode):
    return (
        file_type(metadata.st_mode)
        and metadata.st_uid == os.geteuid()
        and stat.S_IMODE(metadata.st_mode) == mode
    )


def _tombstone_key_metadata_valid(
    parent,
    parent_fd,
    control_fd,
    expected_control,
    key_fd,
    expected_key,
):
    """Revalidate key and control metadata through held descriptors and names."""
    current_control = os.fstat(control_fd)
    named_control = os.stat(
        TOMBSTONE_CONTROL_DIRECTORY_NAME,
        dir_fd=parent_fd,
        follow_symlinks=False,
    )
    current_key = os.fstat(key_fd)
    named_key = os.stat(
        TOMBSTONE_KEY_NAME, dir_fd=control_fd, follow_symlinks=False
    )
    return (
        _secure_owned_mode(current_control, stat.S_ISDIR, 0o700)
        and _secure_owned_mode(named_control, stat.S_ISDIR, 0o700)
        and _same_inode(expected_control, current_control)
        and _same_inode(current_control, named_control)
        and _secure_owned_mode(current_key, stat.S_ISREG, 0o600)
        and _secure_owned_mode(named_key, stat.S_ISREG, 0o600)
        and current_key.st_nlink == 1
        and named_key.st_nlink == 1
        and current_key.st_size == TOMBSTONE_KEY_BYTES
        and named_key.st_size == TOMBSTONE_KEY_BYTES
        and _same_inode(expected_key, current_key)
        and _same_inode(current_key, named_key)
        and _root_path_still_names_fd(parent, parent_fd)
    )


def _load_tombstone_authentication_key(output_root):
    """Create or load the private persistent key outside the snapshot root."""
    root = Path(output_root).absolute()
    parent = root.parent
    parent_fd = os.open(
        parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    )
    try:
        parent_metadata = os.fstat(parent_fd)
        if (
            not stat.S_ISDIR(parent_metadata.st_mode)
            or parent_metadata.st_uid != os.geteuid()
            or stat.S_IMODE(parent_metadata.st_mode) & 0o022
            or not _root_path_still_names_fd(parent, parent_fd)
        ):
            raise OSError(errno.EPERM, "tombstone control parent is not private")
        try:
            os.mkdir(TOMBSTONE_CONTROL_DIRECTORY_NAME, 0o700, dir_fd=parent_fd)
            _fsync_directory_fd(parent_fd)
        except FileExistsError:
            pass
        control_fd = os.open(
            TOMBSTONE_CONTROL_DIRECTORY_NAME,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=parent_fd,
        )
        try:
            control_metadata = os.fstat(control_fd)
            named_control = os.stat(
                TOMBSTONE_CONTROL_DIRECTORY_NAME,
                dir_fd=parent_fd,
                follow_symlinks=False,
            )
            if (
                not _secure_owned_mode(control_metadata, stat.S_ISDIR, 0o700)
                or not _same_inode(control_metadata, named_control)
            ):
                raise OSError(errno.EPERM, "invalid tombstone control directory")
            created = False
            try:
                key_fd = os.open(
                    TOMBSTONE_KEY_NAME,
                    os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                    0o600,
                    dir_fd=control_fd,
                )
                created = True
            except FileExistsError:
                key_fd = os.open(
                    TOMBSTONE_KEY_NAME,
                    os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC,
                    dir_fd=control_fd,
                )
            try:
                if created:
                    # CPython's entropy APIs return an immutable bytes object;
                    # copy immediately into mutable storage and drop that brief
                    # unavoidable immutable value before subsequent key use.
                    generated = secrets.token_bytes(TOMBSTONE_KEY_BYTES)
                    generated_buffer = bytearray(generated)
                    del generated
                    try:
                        view = memoryview(generated_buffer)
                        while view:
                            written = os.write(key_fd, view)
                            view = view[written:]
                        os.fsync(key_fd)
                        _fsync_directory_fd(control_fd)
                        os.lseek(key_fd, 0, os.SEEK_SET)
                    finally:
                        generated_buffer[:] = b"\x00" * len(generated_buffer)
                key_metadata = os.fstat(key_fd)
                if not _tombstone_key_metadata_valid(
                    parent,
                    parent_fd,
                    control_fd,
                    control_metadata,
                    key_fd,
                    key_metadata,
                ):
                    raise OSError(errno.EPERM, "invalid tombstone authentication key")
                key_buffer = _read_tombstone_key_bytes(key_fd)
                try:
                    if (
                        len(key_buffer) != TOMBSTONE_KEY_BYTES
                        or not _tombstone_key_metadata_valid(
                            parent,
                            parent_fd,
                            control_fd,
                            control_metadata,
                            key_fd,
                            key_metadata,
                        )
                    ):
                        raise OSError(
                            errno.ESTALE, "tombstone authentication key changed"
                        )
                    return key_buffer
                except Exception:
                    key_buffer[:] = b"\x00" * len(key_buffer)
                    raise
            finally:
                os.close(key_fd)
        finally:
            os.close(control_fd)
    finally:
        os.close(parent_fd)


def _tombstone_snapshot_identity(expected):
    inventory = {
        name: (
            raw.sha256
            if isinstance(raw, _SnapshotFile)
            else hashlib.sha256(raw).hexdigest()
        )
        for name, raw in expected.items()
    }
    return hashlib.sha256(_canonical_json_bytes(inventory)).hexdigest()


def _tombstone_unsigned_fields(nonce, snapshot_version, snapshot_identity):
    return {
        "domain": TOMBSTONE_DOMAIN,
        "nonce": nonce,
        "snapshot_sha256": snapshot_identity,
        "snapshot_version": snapshot_version,
        "version": TOMBSTONE_VERSION,
    }


def _tombstone_hmac(key, fields):
    payload = TOMBSTONE_HMAC_DOMAIN + b"\x00" + _canonical_json_bytes(fields)
    return hmac.new(key, payload, hashlib.sha256).hexdigest()


def _new_tombstone_marker(key, snapshot_version, snapshot_identity):
    fields = _tombstone_unsigned_fields(
        secrets.token_hex(32), snapshot_version, snapshot_identity
    )
    marker = dict(fields)
    marker["hmac_sha256"] = _tombstone_hmac(key, fields)
    return _canonical_json_bytes(marker)


def _valid_tombstone_marker(raw, key, snapshot_version, snapshot_identity):
    try:
        marker = json.loads(raw.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError):
        return False
    return (
        isinstance(marker, dict)
        and set(marker) == {
            "domain", "hmac_sha256", "nonce", "snapshot_sha256",
            "snapshot_version", "version",
        }
        and marker["domain"] == TOMBSTONE_DOMAIN
        and marker["version"] == TOMBSTONE_VERSION
        and marker["snapshot_version"] == snapshot_version
        and marker["snapshot_sha256"] == snapshot_identity
        and isinstance(marker["nonce"], str)
        and HASH_RE.fullmatch(marker["nonce"]) is not None
        and isinstance(marker["hmac_sha256"], str)
        and HASH_RE.fullmatch(marker["hmac_sha256"]) is not None
        and raw == _canonical_json_bytes(marker)
        and hmac.compare_digest(
            marker["hmac_sha256"],
            _tombstone_hmac(
                key,
                _tombstone_unsigned_fields(
                    marker["nonce"], marker["snapshot_version"], marker["snapshot_sha256"]
                ),
            ),
        )
    )


def _open_verified_tombstone(
    root_fd, name, key, snapshot_version, snapshot_identity
):
    """Open and validate a restart-safe tombstone without following names."""
    try:
        directory_fd = os.open(
            name,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=root_fd,
        )
    except OSError:
        return None
    accepted = False
    try:
        directory = os.fstat(directory_fd)
        if not _secure_owned_mode(directory, stat.S_ISDIR, 0o700):
            return None
        if os.listdir(directory_fd) != [TOMBSTONE_MARKER_NAME]:
            return None
        try:
            raw, marker_file = _read_regular_file_at(
                directory_fd, TOMBSTONE_MARKER_NAME
            )
        except OSError:
            return None
        if (
            not _secure_owned_mode(marker_file, stat.S_ISREG, 0o600)
            or marker_file.st_nlink != 1
        ):
            return None
        if not _valid_tombstone_marker(
            raw, key, snapshot_version, snapshot_identity
        ) or not _directory_fd_matches(
            root_fd,
            name,
            directory_fd,
            {TOMBSTONE_MARKER_NAME: raw},
            expected_directory=directory,
            expected_files={TOMBSTONE_MARKER_NAME: marker_file},
        ):
            return None
        accepted = True
        return directory_fd, directory, raw, marker_file
    finally:
        # Successful callers own the descriptor.
        if not accepted:
            os.close(directory_fd)


def _prepare_tombstone(root_fd, target_name, key, snapshot_identity):
    name = f".{target_name}-tombstone-{secrets.token_hex(16)}"
    marker = _new_tombstone_marker(key, target_name, snapshot_identity)
    directory = None
    os.mkdir(name, mode=0o700, dir_fd=root_fd)
    directory_fd = os.open(
        name,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
        dir_fd=root_fd,
    )
    try:
        directory = os.fstat(directory_fd)
        if not _secure_owned_mode(directory, stat.S_ISDIR, 0o700):
            raise OSError(errno.EPERM, "invalid rollback tombstone directory")
        marker_fd = os.open(
            TOMBSTONE_MARKER_NAME,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
            0o600,
            dir_fd=directory_fd,
        )
        try:
            view = memoryview(marker)
            while view:
                written = os.write(marker_fd, view)
                view = view[written:]
            os.fsync(marker_fd)
            marker_file = os.fstat(marker_fd)
            if (
                not _secure_owned_mode(marker_file, stat.S_ISREG, 0o600)
                or marker_file.st_nlink != 1
            ):
                raise OSError(errno.EPERM, "invalid rollback tombstone marker")
        finally:
            os.close(marker_fd)
        _fsync_directory_fd(directory_fd)
        if not _directory_fd_matches(
            root_fd,
            name,
            directory_fd,
            {TOMBSTONE_MARKER_NAME: marker},
            expected_directory=directory,
            expected_files={TOMBSTONE_MARKER_NAME: marker_file},
        ):
            raise OSError(errno.ESTALE, "rollback tombstone validation failed")
        _fsync_directory_fd(root_fd)
        return name, directory_fd, directory, marker, marker_file
    except Exception:
        os.close(directory_fd)
        _remove_staging(root_fd, name, (), expected_directory=directory)
        raise


def _remove_exact_open_directory(
    root_fd,
    name,
    directory_fd,
    expected_directory,
    expected,
    expected_files,
):
    """Remove only an exact opened sentinel directory at its verified name."""
    if not _directory_fd_matches(
        root_fd,
        name,
        directory_fd,
        expected,
        expected_directory=expected_directory,
        expected_files=expected_files,
    ):
        raise OSError(errno.ESTALE, "sentinel cleanup identity changed")
    for member_name, member_metadata in expected_files.items():
        current = os.stat(
            member_name, dir_fd=directory_fd, follow_symlinks=False
        )
        if not stat.S_ISREG(current.st_mode) or not _same_inode(
            current, member_metadata
        ):
            raise OSError(errno.ESTALE, "sentinel member identity changed")
        os.unlink(member_name, dir_fd=directory_fd)
    if os.listdir(directory_fd) or not _directory_binding_matches(
        root_fd, name, directory_fd, expected_directory
    ):
        raise OSError(errno.ESTALE, "sentinel cleanup binding changed")
    os.rmdir(name, dir_fd=root_fd)


def _rollback_published_directory(
    root_fd, target_name, expected_directory, key, snapshot_identity
):
    """Replace an invalid publication with a durable retry tombstone."""
    try:
        target_fd = os.open(
            target_name,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=root_fd,
        )
    except OSError as exc:
        raise OSError(
            errno.ESTALE,
            "published snapshot validation failed; rollback target unavailable",
        ) from exc
    try:
        opened = os.fstat(target_fd)
        if not _same_inode(opened, expected_directory) or not _directory_binding_matches(
            root_fd, target_name, target_fd, opened
        ):
            raise OSError(
                errno.ESTALE,
                "published snapshot validation failed; rollback refused replacement target",
            )

        (
            quarantine_name,
            tombstone_fd,
            tombstone_directory,
            tombstone_marker,
            tombstone_marker_file,
        ) = _prepare_tombstone(root_fd, target_name, key, snapshot_identity)
        tombstone_location = quarantine_name
        try:
            try:
                _rename_exchange(
                    target_name,
                    quarantine_name,
                    source_dir_fd=root_fd,
                    target_dir_fd=root_fd,
                )
            except OSError as exc:
                raise OSError(
                    exc.errno or errno.ENOTSUP,
                    "published snapshot validation failed; atomic rollback exchange failed",
                ) from exc
            tombstone_location = target_name

            try:
                captured_fd = os.open(
                    quarantine_name,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                    dir_fd=root_fd,
                )
            except OSError as exc:
                raise OSError(
                    errno.ESTALE,
                    "published snapshot validation failed; quarantine identity unavailable",
                ) from exc
            try:
                captured_directory = os.fstat(captured_fd)
                if not _directory_binding_matches(
                    root_fd,
                    quarantine_name,
                    captured_fd,
                    captured_directory,
                ):
                    raise OSError(
                        errno.ESTALE,
                        "published snapshot validation failed; quarantine identity changed",
                    )

                if _same_inode(captured_directory, expected_directory):
                    if not _directory_fd_matches(
                        root_fd,
                        target_name,
                        tombstone_fd,
                        {TOMBSTONE_MARKER_NAME: tombstone_marker},
                        expected_directory=tombstone_directory,
                        expected_files={TOMBSTONE_MARKER_NAME: tombstone_marker_file},
                    ):
                        raise OSError(
                            errno.ESTALE,
                            "published snapshot validation failed; rollback tombstone changed",
                        )
                    _remove_directory_contents(captured_fd)
                    if not _directory_binding_matches(
                        root_fd,
                        quarantine_name,
                        captured_fd,
                        captured_directory,
                    ):
                        raise OSError(
                            errno.ESTALE,
                            "published snapshot validation failed; quarantine identity changed",
                        )
                    os.rmdir(quarantine_name, dir_fd=root_fd)
                    _fsync_directory_fd(root_fd)
                    return

                # A replacement arrived after target validation. Put the exact
                # captured replacement back and remove only our tombstone.
                try:
                    _rename_exchange(
                        target_name,
                        quarantine_name,
                        source_dir_fd=root_fd,
                        target_dir_fd=root_fd,
                    )
                except OSError as exc:
                    raise OSError(
                        exc.errno or errno.ESTALE,
                        "published snapshot validation failed; replacement restoration exchange failed",
                    ) from exc
                tombstone_location = quarantine_name
                if not _directory_binding_matches(
                    root_fd,
                    target_name,
                    captured_fd,
                    captured_directory,
                ) or not _directory_binding_matches(
                    root_fd,
                    quarantine_name,
                    tombstone_fd,
                    tombstone_directory,
                ):
                    raise OSError(
                        errno.ESTALE,
                        "published snapshot validation failed; replacement restoration changed identity",
                    )
            finally:
                os.close(captured_fd)

            _remove_exact_open_directory(
                root_fd,
                quarantine_name,
                tombstone_fd,
                tombstone_directory,
                {TOMBSTONE_MARKER_NAME: tombstone_marker},
                {TOMBSTONE_MARKER_NAME: tombstone_marker_file},
            )
            tombstone_location = None
            _fsync_directory_fd(root_fd)
            raise OSError(
                errno.ESTALE,
                "published snapshot validation failed; rollback restored replacement target",
            )
        finally:
            os.close(tombstone_fd)
            if tombstone_location == quarantine_name:
                verified = _open_verified_tombstone(
                    root_fd, quarantine_name, key, target_name, snapshot_identity
                )
                if verified is not None and _same_inode(
                    verified[1], tombstone_directory
                ):
                    try:
                        _remove_exact_open_directory(
                            root_fd,
                            quarantine_name,
                            verified[0],
                            verified[1],
                            {TOMBSTONE_MARKER_NAME: verified[2]},
                            {TOMBSTONE_MARKER_NAME: verified[3]},
                        )
                    finally:
                        os.close(verified[0])
                _fsync_directory_fd(root_fd)
    finally:
        os.close(target_fd)


def _publish_staging_over_tombstone(
    root_fd,
    staging_fd,
    staging_name,
    target_name,
    expected,
    staging_directory,
    staging_files,
    tombstone,
):
    """Atomically replace a verified tombstone, restoring any raced occupant."""
    tombstone_fd, tombstone_directory, marker, marker_file = tombstone
    tombstone_expected = {TOMBSTONE_MARKER_NAME: marker}
    tombstone_files = {TOMBSTONE_MARKER_NAME: marker_file}
    if not _directory_fd_matches(
        root_fd,
        target_name,
        tombstone_fd,
        tombstone_expected,
        expected_directory=tombstone_directory,
        expected_files=tombstone_files,
    ):
        if _directory_matches(root_fd, target_name, expected):
            return False
        raise FileExistsError(f"existing snapshot mismatch: {target_name}")

    _rename_exchange(
        staging_name,
        target_name,
        source_dir_fd=root_fd,
        target_dir_fd=root_fd,
    )
    published_matches = _directory_fd_matches(
        root_fd,
        target_name,
        staging_fd,
        expected,
        expected_directory=staging_directory,
        expected_files=staging_files,
    )
    displaced_is_tombstone = _directory_fd_matches(
        root_fd,
        staging_name,
        tombstone_fd,
        tombstone_expected,
        expected_directory=tombstone_directory,
        expected_files=tombstone_files,
    )
    if published_matches and displaced_is_tombstone:
        _remove_exact_open_directory(
            root_fd,
            staging_name,
            tombstone_fd,
            tombstone_directory,
            tombstone_expected,
            tombstone_files,
        )
        _fsync_directory_fd(root_fd)
        return True

    # A foreign actor replaced the newly published snapshot after exchange.
    # Preserve its canonical target and remove only the exact displaced,
    # descriptor-verified tombstone now bound at our hidden staging name.
    if not published_matches and displaced_is_tombstone:
        _remove_exact_open_directory(
            root_fd,
            staging_name,
            tombstone_fd,
            tombstone_directory,
            tombstone_expected,
            tombstone_files,
        )
        _fsync_directory_fd(root_fd)
        if _directory_matches(root_fd, target_name, expected):
            return False
        raise FileExistsError(f"existing snapshot mismatch: {target_name}")

    # The canonical name changed after tombstone validation. Exchange back only
    # while both post-exchange names still identify the exact captured inodes.
    try:
        captured_fd = os.open(
            staging_name,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=root_fd,
        )
    except OSError as exc:
        raise OSError(
            errno.ESTALE, "tombstone retry could not capture raced target"
        ) from exc
    try:
        captured_directory = os.fstat(captured_fd)
        if not published_matches or not _directory_binding_matches(
            root_fd,
            staging_name,
            captured_fd,
            captured_directory,
        ):
            raise OSError(
                errno.ESTALE, "tombstone retry refused changed exchange bindings"
            )
        _rename_exchange(
            target_name,
            staging_name,
            source_dir_fd=root_fd,
            target_dir_fd=root_fd,
        )
        if not _directory_binding_matches(
            root_fd, target_name, captured_fd, captured_directory
        ) or not _directory_fd_matches(
            root_fd,
            staging_name,
            staging_fd,
            expected,
            expected_directory=staging_directory,
            expected_files=staging_files,
        ):
            raise OSError(
                errno.ESTALE, "tombstone retry restoration changed identity"
            )
    finally:
        os.close(captured_fd)
    if _directory_matches(root_fd, target_name, expected):
        return False
    raise FileExistsError(f"existing snapshot mismatch: {target_name}")


def publish_snapshot(output_root, snapshot_version, candidates):
    """Transactionally publish or idempotently accept an immutable snapshot."""
    if not isinstance(snapshot_version, str) or not SNAPSHOT_VERSION_RE.fullmatch(snapshot_version):
        raise ValueError("invalid snapshot version")
    _preflight_publication_platform(output_root)
    root, root_fd, root_metadata = _open_secure_output_root(output_root)
    authentication_key = None
    target = root / snapshot_version
    expected = _expected_files(snapshot_version, candidates)
    snapshot_identity = _tombstone_snapshot_identity(expected)
    staging_name = f".{snapshot_version}-{uuid.uuid4().hex}"
    staging_metadata = None
    staging_files = {}
    tombstone = None
    try:
        authentication_key = _load_tombstone_authentication_key(root)
        try:
            os.stat(snapshot_version, dir_fd=root_fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            if _secure_output_root_binding(root, root_fd, root_metadata) and _directory_matches(
                root_fd, snapshot_version, expected
            ):
                return target
            if _secure_output_root_binding(root, root_fd, root_metadata):
                tombstone = _open_verified_tombstone(
                    root_fd,
                    snapshot_version,
                    authentication_key,
                    snapshot_version,
                    snapshot_identity,
                )
            if tombstone is None:
                if _secure_output_root_binding(root, root_fd, root_metadata) and _directory_matches(
                    root_fd, snapshot_version, expected
                ):
                    return target
                raise FileExistsError(f"existing snapshot mismatch: {target}")

        os.mkdir(staging_name, mode=0o700, dir_fd=root_fd)
        staging_fd = os.open(
            staging_name,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=root_fd,
        )
        try:
            staging_metadata = os.fstat(staging_fd)
            for name, raw in expected.items():
                file_fd = os.open(
                    name,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                    0o600,
                    dir_fd=staging_fd,
                )
                try:
                    _write_expected_file(file_fd, raw)
                    os.fsync(file_fd)
                    staging_files[name] = os.fstat(file_fd)
                finally:
                    os.close(file_fd)
            _fsync_directory_fd(staging_fd)
            if not _secure_output_root_binding(root, root_fd, root_metadata):
                raise OSError(errno.ESTALE, "output root changed before publication")
            if tombstone is not None:
                if not _publish_staging_over_tombstone(
                    root_fd,
                    staging_fd,
                    staging_name,
                    snapshot_version,
                    expected,
                    staging_metadata,
                    staging_files,
                    tombstone,
                ):
                    return target
            else:
                try:
                    _publish_staging_noreplace(
                        root_fd,
                        staging_fd,
                        staging_name,
                        snapshot_version,
                        expected,
                        staging_metadata,
                        staging_files,
                    )
                except FileExistsError:
                    if _secure_output_root_binding(root, root_fd, root_metadata) and _directory_matches(
                        root_fd, snapshot_version, expected
                    ):
                        return target
                    raise FileExistsError(f"existing snapshot mismatch: {target}")
        finally:
            os.close(staging_fd)
        _fsync_directory_fd(root_fd)
        if (
            not _secure_output_root_binding(root, root_fd, root_metadata)
            or not _directory_matches(
                root_fd,
                snapshot_version,
                expected,
                expected_directory=staging_metadata,
                expected_files=staging_files,
            )
        ):
            _rollback_published_directory(
                root_fd,
                snapshot_version,
                staging_metadata,
                authentication_key,
                snapshot_identity,
            )
            raise OSError(
                errno.ESTALE,
                "published snapshot validation failed; rolled back",
            )
        return target
    finally:
        try:
            if tombstone is not None:
                os.close(tombstone[0])
            _remove_staging(
                root_fd,
                staging_name,
                expected,
                expected_directory=staging_metadata,
            )
        finally:
            os.close(root_fd)
            if isinstance(authentication_key, bytearray):
                authentication_key[:] = b"\x00" * len(authentication_key)


def load_json_rows(path):
    source = Path(path)
    if source.is_symlink() or not source.is_file():
        raise ValueError("input JSON must be a regular file")
    try:
        source_size = source.stat().st_size
    except OSError as exc:
        raise ValueError(f"invalid input JSON: {exc}") from exc
    if source_size > MAX_SNAPSHOT_BYTES:
        raise ValueError("input JSON exceeds snapshot byte limit")
    try:
        return json.loads(source.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid input JSON: {exc}") from exc


def load_resolver_fixture(path):
    """Load a hostname-to-addresses map for deterministic offline rehearsals."""
    source = Path(path)
    if source.is_symlink() or not source.is_file():
        raise ValueError("resolver JSON must be a regular file")
    try:
        mapping = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid resolver JSON: {exc}") from exc
    if not isinstance(mapping, dict) or not mapping:
        raise ValueError("invalid resolver JSON")
    normalized = {}
    for hostname, addresses in mapping.items():
        if not isinstance(hostname, str) or _ascii_hostname(hostname) != hostname.lower():
            raise ValueError("invalid resolver JSON")
        if not isinstance(addresses, list) or not addresses or len(addresses) > MAX_DNS_ANSWERS:
            raise ValueError("invalid resolver JSON")
        normalized[hostname.lower()] = list(addresses)

    def resolve(hostname):
        try:
            return normalized[hostname]
        except KeyError as exc:
            raise OSError("hostname absent from resolver fixture") from exc

    return resolve


def _terminate_psql_process_group(process, grace_seconds):
    """Boundedly terminate the whole psql session without draining its pipes."""
    for stream_name in ("stdin", "stdout", "stderr"):
        stream = getattr(process, stream_name, None)
        if stream is not None and stream_name == "stdin":
            try:
                stream.close()
            except OSError:
                pass
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=grace_seconds)
    except subprocess.TimeoutExpired:
        pass
    # Escalate the group even when the direct child exited: descendants may
    # still own inherited pipe descriptors or continue producing output.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=grace_seconds)
    except subprocess.TimeoutExpired:
        try:
            process.kill()
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=grace_seconds)
        except subprocess.TimeoutExpired:
            pass
    for stream_name in ("stdout", "stderr"):
        stream = getattr(process, stream_name, None)
        if stream is not None:
            try:
                stream.close()
            except OSError:
                pass


def _parse_psql_row(raw, index):
    if not raw or len(raw) > MAX_DB_ROW_BYTES:
        raise RuntimeError("approved correction stdout line exceeded byte limit")
    try:
        row = json.loads(raw)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("malformed psql response") from exc
    if not isinstance(row, dict):
        raise ValueError(f"database row {index} must be an object")
    unknown = set(row) - DB_FIELDS
    missing = DB_FIELDS - set(row)
    if unknown:
        raise ValueError(f"database row {index} has unexpected fields: {sorted(unknown)}")
    if missing:
        raise ValueError(f"database row {index} is missing fields: {sorted(missing)}")
    return row


def fetch_rows_with_psql(
    process_factory=subprocess.Popen,
    timeout_seconds=DEFAULT_PSQL_TIMEOUT_SECONDS,
    kill_grace_seconds=DEFAULT_PROCESS_KILL_GRACE_SECONDS,
    row_consumer=None,
):
    """Incrementally read bounded JSONL using psql's configured connection."""
    for value in (timeout_seconds, kill_grace_seconds):
        if not isinstance(value, (int, float)) or isinstance(value, bool) or value <= 0:
            raise ValueError("invalid psql timeout")
    try:
        process = process_factory(
            ["psql", "-X", "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--quiet"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
    except OSError as exc:
        raise RuntimeError("approved correction read failed") from exc
    query = APPROVED_QUERY.encode("utf-8")
    deadline = time.monotonic() + timeout_seconds
    # jsonb text includes DB-only names/status and whitespace, so allow bounded
    # transport overhead while deriving the cap from the artifact limit.
    stdout_limit = MAX_SNAPSHOT_BYTES * 2
    rows = []
    row_count = 0
    stdout_buffer = bytearray()
    stdout_bytes = 0
    stderr_bytes = 0
    selector = selectors.DefaultSelector()
    try:
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream is None:
                raise RuntimeError("approved correction read failed")
            os.set_blocking(stream.fileno(), False)
        selector.register(process.stdin, selectors.EVENT_WRITE, "stdin")
        selector.register(process.stdout, selectors.EVENT_READ, "stdout")
        selector.register(process.stderr, selectors.EVENT_READ, "stderr")
        query_offset = 0
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RuntimeError("approved correction read timed out")
            events = selector.select(remaining)
            if not events:
                raise RuntimeError("approved correction read timed out")
            for key, _mask in events:
                stream = key.fileobj
                if key.data == "stdin":
                    try:
                        written = os.write(stream.fileno(), query[query_offset:])
                    except BrokenPipeError:
                        written = 0
                        query_offset = len(query)
                    query_offset += written
                    if query_offset == len(query):
                        selector.unregister(stream)
                        stream.close()
                    continue
                try:
                    chunk = os.read(stream.fileno(), 64 * 1024)
                except BlockingIOError:
                    continue
                if not chunk:
                    selector.unregister(stream)
                    stream.close()
                    continue
                if key.data == "stderr":
                    stderr_bytes += len(chunk)
                    if stderr_bytes > MAX_PSQL_STDERR_BYTES:
                        raise RuntimeError("approved correction stderr exceeded byte limit")
                    continue
                stdout_bytes += len(chunk)
                if stdout_bytes > stdout_limit:
                    raise RuntimeError("approved correction stdout exceeded byte limit")
                stdout_buffer.extend(chunk)
                while True:
                    newline = stdout_buffer.find(b"\n")
                    if newline < 0:
                        if len(stdout_buffer) > MAX_DB_ROW_BYTES:
                            raise RuntimeError("approved correction stdout line exceeded byte limit")
                        break
                    raw = bytes(stdout_buffer[:newline])
                    del stdout_buffer[:newline + 1]
                    if row_count >= MAX_CANDIDATES:
                        raise ValueError("database response exceeds candidate limit")
                    parsed = _parse_psql_row(raw, row_count)
                    row_count += 1
                    if row_consumer is None:
                        rows.append(parsed)
                    else:
                        row_consumer(parsed)
        if stdout_buffer:
            if row_count >= MAX_CANDIDATES:
                raise ValueError("database response exceeds candidate limit")
            parsed = _parse_psql_row(bytes(stdout_buffer), row_count)
            row_count += 1
            if row_consumer is None:
                rows.append(parsed)
            else:
                row_consumer(parsed)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RuntimeError("approved correction read timed out")
        process.wait(timeout=remaining)
    except subprocess.TimeoutExpired as exc:
        _terminate_psql_process_group(process, kill_grace_seconds)
        raise RuntimeError("approved correction read timed out") from exc
    except Exception:
        _terminate_psql_process_group(process, kill_grace_seconds)
        raise
    finally:
        selector.close()
    if process.returncode != 0:
        raise RuntimeError("approved correction read failed")
    return rows


def fetch_snapshot_with_psql(
    resolver=None,
    resolver_timeout_seconds=DEFAULT_DNS_TIMEOUT_SECONDS,
    process_factory=subprocess.Popen,
    timeout_seconds=DEFAULT_PSQL_TIMEOUT_SECONDS,
    kill_grace_seconds=DEFAULT_PROCESS_KILL_GRACE_SECONDS,
):
    """Validate psql JSONL incrementally without retaining decoded DB rows."""
    accumulator = _SnapshotAccumulator(resolver, resolver_timeout_seconds)
    try:
        fetch_rows_with_psql(
            process_factory=process_factory,
            timeout_seconds=timeout_seconds,
            kill_grace_seconds=kill_grace_seconds,
            row_consumer=accumulator.add,
        )
        return accumulator.finish()
    finally:
        accumulator.close()


def verify_applied_version_binding(manifest_path, applied_version, verified_manifest_sha256):
    """Bind a separate apply step to an independently verified public manifest."""
    if not isinstance(verified_manifest_sha256, str) or not HASH_RE.fullmatch(verified_manifest_sha256):
        raise ValueError("invalid verified manifest SHA-256")
    path = Path(manifest_path)
    if path.is_symlink() or not path.is_file():
        raise ValueError("verified manifest must be a regular file")
    raw = path.read_bytes()
    if len(raw) > MAX_MANIFEST_BYTES:
        raise ValueError("verified manifest is too large")
    if hashlib.sha256(raw).hexdigest() != verified_manifest_sha256:
        raise ValueError("verified manifest SHA-256 does not match")
    try:
        manifest = json.loads(raw)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("verified manifest is invalid JSON") from exc
    if not isinstance(manifest, dict) or manifest.get("artifact_kind") != "company_benefits_manifest":
        raise ValueError("verified manifest has the wrong artifact kind")
    manifest_version = _require_data_version(manifest.get("data_version"), "manifest data_version")
    applied_version = _require_data_version(applied_version, "applied version")
    if manifest_version != applied_version:
        raise ValueError("applied version does not match verified manifest version")
    return applied_version


def _parser():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    export = commands.add_parser("export", help="export an immutable candidate snapshot")
    source = export.add_mutually_exclusive_group(required=True)
    source.add_argument("--input-json", type=Path, help="fixture/rehearsal DB response")
    source.add_argument("--psql", action="store_true", help="use psql environment/service configuration")
    export.add_argument(
        "--resolver-json", type=Path,
        help="fixture-only hostname-to-A/AAAA JSON map; disables live DNS for offline rehearsals",
    )
    export.add_argument(
        "--dns-timeout-seconds", type=float, default=DEFAULT_DNS_TIMEOUT_SECONDS,
        help="per-host system DNS deadline (default: 2.0; production fails closed on timeout/error)",
    )
    export.add_argument(
        "--psql-timeout-seconds", type=float, default=DEFAULT_PSQL_TIMEOUT_SECONDS,
        help="psql read deadline (default: 30.0; process is terminated/killed on timeout)",
    )
    export.add_argument("--output-root", required=True, type=Path)
    export.add_argument("--snapshot-version", required=True)

    binding = commands.add_parser("verify-apply-binding", help="verify a separate operator apply version")
    binding.add_argument("--manifest", required=True, type=Path)
    binding.add_argument("--applied-version", required=True)
    binding.add_argument("--verified-manifest-sha256", required=True)
    return parser


def main(argv=None):
    args = _parser().parse_args(argv)
    candidates = None
    try:
        if args.command == "export":
            if args.resolver_json and not args.input_json:
                raise ValueError("--resolver-json requires --input-json")
            # Check platform/filesystem support before DB/DNS work and before
            # creating the output root or persistent control key.
            _preflight_publication_platform(args.output_root)
            resolver = load_resolver_fixture(args.resolver_json) if args.resolver_json else None
            if args.input_json:
                rows = load_json_rows(args.input_json)
                candidates = build_snapshot(
                    rows, resolver=resolver,
                    resolver_timeout_seconds=args.dns_timeout_seconds,
                )
                del rows
            else:
                candidates = fetch_snapshot_with_psql(
                    resolver=resolver,
                    resolver_timeout_seconds=args.dns_timeout_seconds,
                    timeout_seconds=args.psql_timeout_seconds,
                )
            target = publish_snapshot(args.output_root, args.snapshot_version, candidates)
            result = {
                "candidate_count": len(candidates),
                "snapshot_path": str(target),
                "snapshot_sha256": (
                    candidates.sha256
                    if isinstance(candidates, _SnapshotSpool)
                    else snapshot_sha256(canonical_jsonl(candidates))
                ),
                "snapshot_version": args.snapshot_version,
            }
        else:
            version = verify_applied_version_binding(
                args.manifest, args.applied_version, args.verified_manifest_sha256
            )
            result = {"applied_data_version": version, "binding_verified": True}
        sys.stdout.buffer.write(_canonical_json_bytes(result))
        return 0
    except (FileExistsError, OSError, RuntimeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    finally:
        if isinstance(candidates, _SnapshotSpool):
            candidates.close()


if __name__ == "__main__":
    raise SystemExit(main())
