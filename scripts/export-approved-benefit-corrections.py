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
CANDIDATE_FIELDS = {
    "correction_request_id",
    "company_id",
    "category_id",
    "current_text",
    "proposed_text",
    "scope_text",
    "evidence_url",
    "observed_data_version",
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
PUBLICATION_LOCK_NAME = ".approved-benefit-correction-export.lock"
PUBLICATION_KEY_NAME = ".approved-benefit-correction-export.key"
PREPARE_MARKER_NAME = ".approved-benefit-correction-export.setup"
ARTIFACT_SUFFIX = ".tar"
ARTIFACT_MEMBER_NAMES = ("manifest.json", "candidates.jsonl")
PUBLICATION_KEY_BYTES = 32
MAX_ARTIFACT_BYTES = MAX_SNAPSHOT_BYTES + MAX_MANIFEST_BYTES + 4096
AT_EMPTY_PATH = 0x1000

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


def _require_public_https_url(
    value, resolver, resolver_timeout_seconds, resolution_cache, resolve_dns=True,
):
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
    if not resolve_dns:
        return value
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


def _validate_candidate(
    candidate, resolver=None,
    resolver_timeout_seconds=DEFAULT_DNS_TIMEOUT_SECONDS,
    resolution_cache=None,
):
    """Validate the public/offline candidate schema at creation and review."""
    if not isinstance(candidate, dict):
        raise ValueError("candidate must be an object")
    unknown = set(candidate) - CANDIDATE_FIELDS
    missing = CANDIDATE_FIELDS - set(candidate)
    if unknown:
        raise ValueError(f"candidate has unexpected fields: {sorted(unknown)}")
    if missing:
        raise ValueError(f"candidate is missing fields: {sorted(missing)}")
    if resolution_cache is None:
        resolution_cache = {}
    request_id = _require_uuid(candidate["correction_request_id"])
    company_id = _require_text(candidate["company_id"], "company_id", 64)
    if not COMPANY_RE.fullmatch(company_id):
        raise ValueError("invalid company_id")
    category_id = _require_text(candidate["category_id"], "category_id", 20)
    if category_id not in CATEGORIES:
        raise ValueError("invalid category_id")
    return {
        "correction_request_id": request_id,
        "company_id": company_id,
        "category_id": category_id,
        "current_text": _require_text(candidate["current_text"], "current_text", 5000),
        "proposed_text": _require_text(candidate["proposed_text"], "proposed_text", 5000),
        "scope_text": _require_text(candidate["scope_text"], "scope_text", 2000),
        "evidence_url": _require_public_https_url(
            candidate["evidence_url"], resolver, resolver_timeout_seconds,
            resolution_cache, resolve_dns=resolver is not None,
        ),
        "observed_data_version": _require_data_version(candidate["observed_data_version"]),
    }


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
    candidate = _validate_candidate({
        "correction_request_id": row["id"],
        "company_id": row["company_id"],
        "category_id": row["category_id"],
        "current_text": row["current_text"],
        "proposed_text": row["proposed_text"],
        "scope_text": row["scope_text"],
        "evidence_url": row["source_url"],
        "observed_data_version": row["observed_data_version"],
    }, resolver, resolver_timeout_seconds, resolution_cache)
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
        "container_format": "deterministic-ustar",
        "schema_version": 1,
        "snapshot_sha256": candidate_sha256,
        "snapshot_version": snapshot_version,
    }
    return {"candidates.jsonl": rows, "manifest.json": _canonical_json_bytes(manifest)}


def _same_inode(left, right):
    return (left.st_dev, left.st_ino, stat.S_IFMT(left.st_mode)) == (
        right.st_dev, right.st_ino, stat.S_IFMT(right.st_mode)
    )


def _write_all(descriptor, raw):
    view = memoryview(raw)
    while view:
        written = os.write(descriptor, view)
        if written <= 0:
            raise OSError(errno.EIO, "snapshot artifact write failed")
        view = view[written:]


def _tar_octal(value, width):
    encoded = f"{value:0{width - 1}o}".encode("ascii")
    if len(encoded) >= width:
        raise ValueError("snapshot artifact tar field overflow")
    return encoded + b"\0"


def _tar_header(name, size):
    raw_name = name.encode("ascii")
    if name not in ARTIFACT_MEMBER_NAMES or len(raw_name) > 100:
        raise ValueError("invalid snapshot artifact member")
    header = bytearray(512)
    header[:len(raw_name)] = raw_name
    header[100:108] = _tar_octal(0o600, 8)
    header[108:116] = _tar_octal(0, 8)
    header[116:124] = _tar_octal(0, 8)
    header[124:136] = _tar_octal(size, 12)
    header[136:148] = _tar_octal(0, 12)
    header[148:156] = b"        "
    header[156:157] = b"0"
    header[257:263] = b"ustar\0"
    header[263:265] = b"00"
    checksum = sum(header)
    header[148:156] = f"{checksum:06o}\0 ".encode("ascii")
    return bytes(header)


def _write_tar_member(descriptor, name, expected):
    size = expected.byte_count if isinstance(expected, _SnapshotFile) else len(expected)
    _write_all(descriptor, _tar_header(name, size))
    _write_expected_file(descriptor, expected)
    padding = (-size) % 512
    if padding:
        _write_all(descriptor, b"\0" * padding)


def _stream_fd_digest(descriptor):
    digest = hashlib.sha256()
    offset = 0
    size = os.fstat(descriptor).st_size
    while offset < size:
        chunk = os.pread(descriptor, min(1024 * 1024, size - offset), offset)
        if not chunk:
            raise OSError(errno.EIO, "snapshot artifact truncated")
        digest.update(chunk)
        offset += len(chunk)
    return digest.hexdigest()


def _parse_tar_number(field):
    if not field or field[-1:] not in (b"\0", b" "):
        raise ValueError("invalid snapshot artifact tar number")
    digits = field.rstrip(b"\0 ")
    if not digits or any(character not in b"01234567" for character in digits):
        raise ValueError("invalid snapshot artifact tar number")
    return int(digits, 8)


def _validate_candidate_member(descriptor, offset, size):
    """Incrementally validate canonical ordered JSONL within one bounded member."""
    digest = hashlib.sha256()
    count = 0
    previous_id = None
    pending = bytearray()
    remaining = size
    member_offset = offset
    try:
        while remaining:
            chunk = os.pread(descriptor, min(1024 * 1024, remaining), member_offset)
            if not chunk:
                raise OSError(errno.EIO, "snapshot candidates truncated")
            digest.update(chunk)
            pending.extend(chunk)
            member_offset += len(chunk)
            remaining -= len(chunk)
            while True:
                newline = pending.find(b"\n")
                if newline < 0:
                    if len(pending) > MAX_DB_ROW_BYTES:
                        raise ValueError("snapshot candidate row exceeds byte limit")
                    break
                line = bytes(pending[:newline + 1])
                del pending[:newline + 1]
                if len(line) > MAX_DB_ROW_BYTES:
                    raise ValueError("snapshot candidate row exceeds byte limit")
                candidate = json.loads(line)
                candidate = _validate_candidate(candidate)
                if _canonical_json_bytes(candidate) != line:
                    raise ValueError("snapshot candidate row is not canonical JSON")
                request_id = candidate["correction_request_id"]
                if previous_id is not None and request_id <= previous_id:
                    raise ValueError("snapshot candidate IDs are not strictly increasing")
                previous_id = request_id
                count += 1
                if count > MAX_CANDIDATES:
                    raise ValueError("snapshot candidate count exceeds limit")
        if pending:
            raise ValueError("snapshot candidates are not JSONL")
    except (UnicodeError, json.JSONDecodeError, TypeError, ValueError) as exc:
        raise OSError(errno.EINVAL, "invalid snapshot candidate row") from exc
    return count, digest.hexdigest()


def _validate_snapshot_artifact_fd(descriptor, expected_version=None, expected_digest=None):
    """Validate every byte of the exact deterministic two-member tar."""
    metadata = os.fstat(descriptor)
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > MAX_ARTIFACT_BYTES:
        raise OSError(errno.EINVAL, "invalid snapshot artifact file")
    if expected_digest is not None and not hmac.compare_digest(
        _stream_fd_digest(descriptor), expected_digest
    ):
        raise OSError(errno.EEXIST, "existing snapshot artifact differs")

    offset = 0
    manifest_raw = None
    candidate_digest = None
    candidate_count = None
    for expected_name in ARTIFACT_MEMBER_NAMES:
        header = os.pread(descriptor, 512, offset)
        if len(header) != 512 or header == b"\0" * 512:
            raise OSError(errno.EINVAL, "invalid snapshot artifact inventory")
        try:
            size = _parse_tar_number(header[124:136])
        except ValueError as exc:
            raise OSError(errno.EINVAL, "invalid snapshot artifact header") from exc
        maximum = MAX_MANIFEST_BYTES if expected_name == "manifest.json" else MAX_SNAPSHOT_BYTES
        if size > maximum or header != _tar_header(expected_name, size):
            raise OSError(errno.EINVAL, "noncanonical snapshot artifact header")
        offset += 512
        if offset + size > metadata.st_size:
            raise OSError(errno.EINVAL, "truncated snapshot artifact member")
        if expected_name == "manifest.json":
            manifest_raw = os.pread(descriptor, size, offset)
            if len(manifest_raw) != size:
                raise OSError(errno.EIO, "snapshot manifest truncated")
        else:
            candidate_count, candidate_digest = _validate_candidate_member(
                descriptor, offset, size
            )
        offset += size
        padding = (-size) % 512
        if padding and os.pread(descriptor, padding, offset) != b"\0" * padding:
            raise OSError(errno.EINVAL, "noncanonical snapshot artifact padding")
        offset += padding

    if os.pread(descriptor, 1024, offset) != b"\0" * 1024 or offset + 1024 != metadata.st_size:
        raise OSError(errno.EINVAL, "invalid snapshot artifact trailer or inventory")
    try:
        manifest = json.loads(manifest_raw)
    except (UnicodeError, json.JSONDecodeError, TypeError) as exc:
        raise OSError(errno.EINVAL, "invalid snapshot artifact manifest") from exc
    expected_keys = {
        "artifact_kind", "candidate_count", "candidates_file", "container_format",
        "schema_version", "snapshot_sha256", "snapshot_version",
    }
    manifest_sha256 = manifest.get("snapshot_sha256") if isinstance(manifest, dict) else None
    manifest_version = manifest.get("snapshot_version") if isinstance(manifest, dict) else None
    hash_matches = (
        isinstance(manifest_sha256, str)
        and isinstance(candidate_digest, str)
        and HASH_RE.fullmatch(manifest_sha256) is not None
        and hmac.compare_digest(manifest_sha256, candidate_digest)
    )
    version_valid = (
        isinstance(manifest_version, str)
        and SNAPSHOT_VERSION_RE.fullmatch(manifest_version) is not None
    )
    if (
        not isinstance(manifest, dict)
        or set(manifest) != expected_keys
        or _canonical_json_bytes(manifest) != manifest_raw
        or manifest.get("artifact_kind") != "approved_benefit_correction_offline_review_snapshot"
        or manifest.get("container_format") != "deterministic-ustar"
        or manifest.get("candidates_file") != "candidates.jsonl"
        or type(manifest.get("schema_version")) is not int
        or manifest.get("schema_version") != 1
        or type(manifest.get("candidate_count")) is not int
        or manifest.get("candidate_count") != candidate_count
        or not hash_matches
        or not version_valid
        or (expected_version is not None and manifest_version != expected_version)
    ):
        raise OSError(errno.EINVAL, "snapshot artifact manifest mismatch")
    return manifest


def _fsync_directory_fd(descriptor):
    os.fsync(descriptor)


def _write_expected_file(descriptor, expected):
    chunks = expected.chunks() if isinstance(expected, _SnapshotFile) else (expected,)
    for chunk in chunks:
        view = memoryview(chunk)
        while view:
            written = os.write(descriptor, view)
            view = view[written:]


def _linkat_function():
    libc = ctypes.CDLL(None, use_errno=True)
    function = getattr(libc, "linkat", None)
    if function is None:
        raise OSError(errno.ENOTSUP, "Linux linkat is unavailable")
    function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_int]
    function.restype = ctypes.c_int
    return function


def _link_anonymous_file(descriptor, root_fd, name):
    linkat = _linkat_function()
    ctypes.set_errno(0)
    if linkat(descriptor, b"", root_fd, os.fsencode(name), AT_EMPTY_PATH) == 0:
        return
    error_number = ctypes.get_errno()
    raise OSError(error_number, os.strerror(error_number), name)


def _publication_failure_hook(_stage, _context):
    """Test-only deterministic crash/mutation boundary hook."""


def _prepare_failure_hook(_stage, _context):
    """Test-only deterministic setup race hook."""


def _secure_owned_mode(metadata, file_type, mode):
    return (
        file_type(metadata.st_mode)
        and metadata.st_uid == os.geteuid()
        and stat.S_IMODE(metadata.st_mode) == mode
    )


def _metadata_identity(metadata):
    return (
        metadata.st_dev,
        metadata.st_ino,
        stat.S_IFMT(metadata.st_mode),
        metadata.st_nlink,
        metadata.st_uid,
        stat.S_IMODE(metadata.st_mode),
    )


def _same_control_identity(left, right):
    return _metadata_identity(left) == _metadata_identity(right)


def _open_preprovisioned_file(
    directory_fd, name, flags=os.O_RDWR, size=None, max_size=None
):
    descriptor = os.open(name, flags | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory_fd)
    try:
        opened = os.fstat(descriptor)
        named = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        if (
            not _secure_owned_mode(opened, stat.S_ISREG, 0o600)
            or opened.st_nlink != 1
            or not _same_control_identity(opened, named)
            or (size is not None and opened.st_size != size)
            or (max_size is not None and opened.st_size > max_size)
        ):
            raise OSError(errno.EPERM, f"invalid preprovisioned control file {name}")
        return descriptor, opened
    except Exception:
        os.close(descriptor)
        raise


def _create_preprovisioned_file(directory_fd, name, contents=None):
    if contents is None:
        contents = b""
    descriptor = os.open(
        name,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
        0o600,
        dir_fd=directory_fd,
    )
    try:
        _write_expected_file(descriptor, contents)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _prepared_version_key(snapshot_version):
    material = ("approved-benefit-correction-export\0" + snapshot_version).encode("ascii")
    return hashlib.sha256(material).digest()


def prepare_output_root(output_root, snapshot_version):
    """Offline setup with an exclusive parent marker and binding checks."""
    if not isinstance(snapshot_version, str) or not SNAPSHOT_VERSION_RE.fullmatch(snapshot_version):
        raise ValueError("invalid snapshot version")
    if platform.system() != "Linux" or "fork" not in multiprocessing.get_all_start_methods():
        raise OSError(errno.ENOTSUP, "unsupported publication platform")
    if not hasattr(os, "O_TMPFILE"):
        raise OSError(errno.ENOTSUP, "O_TMPFILE is unavailable")
    _linkat_function()
    root = Path(output_root).absolute()
    parent_fd = os.open(
        root.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    )
    root_fd = None
    marker_fd = None
    try:
        parent_metadata = os.fstat(parent_fd)
        if (
            parent_metadata.st_uid != os.geteuid()
            or stat.S_IMODE(parent_metadata.st_mode) & 0o022
            or not _root_path_still_names_fd(root.parent, parent_fd)
        ):
            raise OSError(errno.EPERM, "output root parent is not private")
        marker_fd = os.open(
            PREPARE_MARKER_NAME,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
            0o600,
            dir_fd=parent_fd,
        )
        os.fsync(marker_fd)
        _prepare_failure_hook("after_setup_lock", {"parent_fd": parent_fd})
        if not _root_path_still_names_fd(root.parent, parent_fd):
            raise OSError(
                errno.ESTALE,
                "output root parent changed or was displaced; inspect the displaced tree",
            )
        try:
            os.stat(root.name, dir_fd=parent_fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise FileExistsError(errno.EEXIST, "output root already exists", str(root))
        os.mkdir(root.name, 0o700, dir_fd=parent_fd)
        root_fd = os.open(
            root.name,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
            dir_fd=parent_fd,
        )
        _create_preprovisioned_file(root_fd, PUBLICATION_LOCK_NAME)
        key = bytearray(_prepared_version_key(snapshot_version))
        try:
            _create_preprovisioned_file(root_fd, PUBLICATION_KEY_NAME, key)
        finally:
            key[:] = b"\x00" * len(key)

        # Prove both filesystem primitives on this exact filesystem during the
        # exclusive offline setup. Runtime has no pathname-staging fallback.
        probe_fd = os.open(
            ".", os.O_RDWR | os.O_TMPFILE | os.O_CLOEXEC, 0o600, dir_fd=root_fd
        )
        try:
            os.fchmod(probe_fd, 0o600)
            _write_all(probe_fd, b"tmpfile-probe")
            os.fsync(probe_fd)
            probe_name = ".approved-benefit-correction-export.tmpfile-probe"
            _link_anonymous_file(probe_fd, root_fd, probe_name)
            os.unlink(probe_name, dir_fd=root_fd)
        except OSError as exc:
            raise OSError(
                errno.ENOTSUP,
                "output filesystem lacks O_TMPFILE + linkat(AT_EMPTY_PATH)",
            ) from exc
        finally:
            os.close(probe_fd)
        _fsync_directory_fd(root_fd)
        _fsync_directory_fd(parent_fd)
        os.close(marker_fd)
        marker_fd = None
        os.unlink(PREPARE_MARKER_NAME, dir_fd=parent_fd)
        _fsync_directory_fd(parent_fd)
        _prepare_failure_hook("before_success", {"parent_fd": parent_fd, "root_fd": root_fd})
        if (
            not _root_path_still_names_fd(root.parent, parent_fd)
            or not _binding_matches(parent_fd, root.name, root_fd, os.fstat(root_fd))
        ):
            raise OSError(
                errno.ESTALE,
                "output root parent changed or was displaced; prepared residue requires inspection",
            )
    finally:
        if root_fd is not None:
            os.close(root_fd)
        if marker_fd is not None:
            os.close(marker_fd)
            try:
                os.unlink(PREPARE_MARKER_NAME, dir_fd=parent_fd)
                _fsync_directory_fd(parent_fd)
            except OSError:
                pass
        os.close(parent_fd)
    return root


def _preflight_publication_platform(output_root):
    """Validate the platform, root, and anonymous-file support before DB I/O."""
    if platform.system() != "Linux" or "fork" not in multiprocessing.get_all_start_methods():
        raise OSError(errno.ENOTSUP, "unsupported publication platform")
    if not hasattr(os, "O_TMPFILE"):
        raise OSError(errno.ENOTSUP, "O_TMPFILE is unavailable")
    _linkat_function()
    root = Path(output_root).absolute()
    try:
        root_fd = os.open(
            root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
        )
    except OSError as exc:
        raise OSError(
            errno.ENOENT,
            "run prepare under exclusive access to provision the output root",
        ) from exc
    try:
        metadata = os.fstat(root_fd)
        if (
            not _secure_owned_mode(metadata, stat.S_ISDIR, 0o700)
            or not _root_path_still_names_fd(root, root_fd)
        ):
            raise OSError(errno.EPERM, "invalid preprovisioned output root")
        probe_fd = None
        try:
            probe_fd = os.open(
                ".", os.O_RDWR | os.O_TMPFILE | os.O_CLOEXEC, 0o600, dir_fd=root_fd
            )
            os.fchmod(probe_fd, 0o600)
        except OSError as exc:
            raise OSError(
                errno.ENOTSUP, "output filesystem lacks anonymous O_TMPFILE support"
            ) from exc
        finally:
            if probe_fd is not None:
                os.close(probe_fd)
    finally:
        os.close(root_fd)


def _open_secure_output_root(output_root):
    """Open the root first, then retain it as the publication trust anchor."""
    root = Path(output_root).absolute()
    try:
        root_fd = os.open(
            root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
        )
    except OSError as exc:
        raise OSError(
            errno.ENOENT,
            "run prepare under exclusive access to provision the output root",
        ) from exc
    try:
        opened = os.fstat(root_fd)
        if (
            not _secure_owned_mode(opened, stat.S_ISDIR, 0o700)
            or not _root_path_still_names_fd(root, root_fd)
        ):
            raise OSError(errno.EPERM, "invalid preprovisioned output root")
        return root, root_fd, opened
    except Exception:
        os.close(root_fd)
        raise


def _secure_output_root_binding(root, root_fd, expected):
    current = os.fstat(root_fd)
    return (
        _secure_owned_mode(current, stat.S_ISDIR, 0o700)
        and _same_inode(expected, current)
        and _root_path_still_names_fd(root, root_fd)
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


def _binding_matches(directory_fd, name, descriptor, expected):
    try:
        current = os.fstat(descriptor)
        named = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
    except OSError:
        return False
    return _same_control_identity(current, expected) and _same_control_identity(named, expected)


def _read_exact_key(descriptor):
    raw = bytearray(os.pread(descriptor, PUBLICATION_KEY_BYTES + 1, 0))
    if len(raw) != PUBLICATION_KEY_BYTES:
        raw[:] = b"\x00" * len(raw)
        raise OSError(errno.EPERM, "invalid preprovisioned publication key")
    return raw


def _key_contents_match(key_fd, expected_key):
    observed = bytearray(os.pread(key_fd, PUBLICATION_KEY_BYTES + 1, 0))
    try:
        return len(observed) == PUBLICATION_KEY_BYTES and hmac.compare_digest(
            observed, expected_key
        )
    finally:
        observed[:] = b"\x00" * len(observed)


def _exact_root_inventory(root_fd, artifact_name=None):
    expected = {PUBLICATION_LOCK_NAME, PUBLICATION_KEY_NAME}
    if artifact_name is not None:
        expected.add(artifact_name)
    observed = os.listdir(root_fd)
    return len(observed) == len(expected) and set(observed) == expected


def _publication_controls_match(
    root, root_fd, root_metadata, lock_fd, lock_metadata,
    key_fd, key_metadata, expected_key, artifact_name=None,
):
    return (
        _secure_output_root_binding(root, root_fd, root_metadata)
        and _exact_root_inventory(root_fd, artifact_name)
        and _binding_matches(root_fd, PUBLICATION_LOCK_NAME, lock_fd, lock_metadata)
        and os.fstat(lock_fd).st_size == 0
        and _binding_matches(root_fd, PUBLICATION_KEY_NAME, key_fd, key_metadata)
        and os.fstat(key_fd).st_size == PUBLICATION_KEY_BYTES
        and _key_contents_match(key_fd, expected_key)
    )


def _open_existing_artifact(root_fd, artifact_name):
    descriptor = os.open(
        artifact_name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=root_fd
    )
    opened = os.fstat(descriptor)
    named = os.stat(artifact_name, dir_fd=root_fd, follow_symlinks=False)
    if (
        not _secure_owned_mode(opened, stat.S_ISREG, 0o600)
        or opened.st_nlink != 1
        or not _same_control_identity(opened, named)
    ):
        os.close(descriptor)
        raise OSError(errno.EPERM, "invalid existing snapshot artifact")
    return descriptor, opened


def _validate_existing_artifact(root_fd, artifact_name, version, digest):
    descriptor, opened = _open_existing_artifact(root_fd, artifact_name)
    try:
        _validate_snapshot_artifact_fd(descriptor, version, digest)
        if not _binding_matches(root_fd, artifact_name, descriptor, opened):
            raise OSError(errno.ESTALE, "snapshot artifact changed during validation")
    finally:
        os.close(descriptor)


def publish_snapshot(output_root, snapshot_version, candidates):
    """Publish one validated anonymous inode with fd-bound no-replace linkat."""
    if not isinstance(snapshot_version, str) or not SNAPSHOT_VERSION_RE.fullmatch(snapshot_version):
        raise ValueError("invalid snapshot version")
    _preflight_publication_platform(output_root)
    root, root_fd, root_metadata = _open_secure_output_root(output_root)
    expected = _expected_files(snapshot_version, candidates)
    artifact_name = snapshot_version + ARTIFACT_SUFFIX
    target = root / artifact_name
    descriptors = []
    key = None
    try:
        # The lock is the only child opened before acquisition. Its pathname
        # binding and the complete root inventory are revalidated under lock.
        lock_fd, lock_metadata = _open_preprovisioned_file(
            root_fd, PUBLICATION_LOCK_NAME, size=0
        )
        descriptors.append(lock_fd)
        fcntl.flock(lock_fd, fcntl.LOCK_EX)
        _publication_failure_hook("after_lock", {"root_fd": root_fd})
        if (
            not _secure_output_root_binding(root, root_fd, root_metadata)
            or not _binding_matches(root_fd, PUBLICATION_LOCK_NAME, lock_fd, lock_metadata)
            or os.fstat(lock_fd).st_size != 0
            or not (
                _exact_root_inventory(root_fd)
                or _exact_root_inventory(root_fd, artifact_name)
            )
        ):
            raise OSError(errno.ESTALE, "preprovisioned publication controls changed")

        key_fd, key_metadata = _open_preprovisioned_file(
            root_fd, PUBLICATION_KEY_NAME, flags=os.O_RDONLY,
            size=PUBLICATION_KEY_BYTES,
        )
        descriptors.append(key_fd)
        key = _read_exact_key(key_fd)
        if not hmac.compare_digest(key, _prepared_version_key(snapshot_version)):
            raise OSError(errno.EPERM, "snapshot version does not match prepared root")
        existing = _exact_root_inventory(root_fd, artifact_name)
        if not _publication_controls_match(
            root, root_fd, root_metadata, lock_fd, lock_metadata,
            key_fd, key_metadata, key, artifact_name if existing else None,
        ):
            raise OSError(errno.ESTALE, "preprovisioned publication controls changed")

        anonymous_fd = os.open(
            ".", os.O_RDWR | os.O_TMPFILE | os.O_CLOEXEC, 0o600, dir_fd=root_fd
        )
        descriptors.append(anonymous_fd)
        os.fchmod(anonymous_fd, 0o600)
        for name in ARTIFACT_MEMBER_NAMES:
            _write_tar_member(anonymous_fd, name, expected[name])
        _write_all(anonymous_fd, b"\0" * 1024)
        os.fsync(anonymous_fd)
        artifact_digest = _stream_fd_digest(anonymous_fd)
        _validate_snapshot_artifact_fd(anonymous_fd, snapshot_version, artifact_digest)
        _publication_failure_hook("after_artifact_fsync", {"root_fd": root_fd, "artifact_fd": anonymous_fd})

        if existing:
            _validate_existing_artifact(root_fd, artifact_name, snapshot_version, artifact_digest)
            return target

        _publication_failure_hook("before_link", {"root_fd": root_fd, "artifact_fd": anonymous_fd})
        if not _publication_controls_match(
            root, root_fd, root_metadata, lock_fd, lock_metadata,
            key_fd, key_metadata, key,
        ):
            # If a same-UID process inserted only the target, validate it below;
            # any other mutation remains a closed failure.
            if not _exact_root_inventory(root_fd, artifact_name):
                raise OSError(errno.ESTALE, "publication controls changed before link")
        try:
            _link_anonymous_file(anonymous_fd, root_fd, artifact_name)
        except FileExistsError:
            _validate_existing_artifact(root_fd, artifact_name, snapshot_version, artifact_digest)
            return target
        _fsync_directory_fd(root_fd)
        _publication_failure_hook("after_link", {"root_fd": root_fd, "artifact_fd": anonymous_fd})
        published = os.fstat(anonymous_fd)
        if (
            not _secure_owned_mode(published, stat.S_ISREG, 0o600)
            or published.st_nlink != 1
            or not _publication_controls_match(
                root, root_fd, root_metadata, lock_fd, lock_metadata,
                key_fd, key_metadata, key, artifact_name,
            )
            or not _binding_matches(root_fd, artifact_name, anonymous_fd, published)
        ):
            raise OSError(errno.ESTALE, "published snapshot artifact validation failed")
        _validate_snapshot_artifact_fd(anonymous_fd, snapshot_version, artifact_digest)
        return target
    finally:
        if key is not None:
            key[:] = b"\x00" * len(key)
        for descriptor in reversed(descriptors):
            os.close(descriptor)
        os.close(root_fd)


def _artifact_candidates_range(descriptor):
    manifest_header = os.pread(descriptor, 512, 0)
    manifest_size = _parse_tar_number(manifest_header[124:136])
    candidate_header_offset = 512 + manifest_size + ((-manifest_size) % 512)
    candidate_header = os.pread(descriptor, 512, candidate_header_offset)
    if len(candidate_header) != 512:
        raise OSError(errno.EINVAL, "invalid snapshot artifact inventory")
    candidate_size = _parse_tar_number(candidate_header[124:136])
    return candidate_header_offset + 512, candidate_size


def stream_review_candidates(artifact_path, snapshot_version, output):
    """Validate one held artifact fd and emit a revalidated anonymous copy."""
    if not isinstance(snapshot_version, str) or not SNAPSHOT_VERSION_RE.fullmatch(snapshot_version):
        raise ValueError("invalid snapshot version")
    path = Path(artifact_path).absolute()
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        opened = os.fstat(descriptor)
        named = path.lstat()
        if not stat.S_ISREG(opened.st_mode) or not _same_inode(opened, named):
            raise OSError(errno.EPERM, "invalid snapshot artifact path")
        manifest = _validate_snapshot_artifact_fd(descriptor, snapshot_version)
        offset, remaining = _artifact_candidates_range(descriptor)
        with tempfile.TemporaryFile(mode="w+b") as review_copy:
            while remaining:
                chunk = os.pread(descriptor, min(1024 * 1024, remaining), offset)
                if not chunk:
                    raise OSError(errno.EIO, "snapshot candidates truncated")
                review_copy.write(chunk)
                offset += len(chunk)
                remaining -= len(chunk)
            # Revalidate after copying. Output begins only after the source fd,
            # its full content, and its pathname binding are proved unchanged.
            _validate_snapshot_artifact_fd(descriptor, snapshot_version)
            if not _same_inode(opened, path.lstat()):
                raise OSError(errno.ESTALE, "snapshot artifact path changed during review")
            review_copy.seek(0)
            while True:
                chunk = review_copy.read(1024 * 1024)
                if not chunk:
                    break
                output.write(chunk)
        return manifest
    finally:
        os.close(descriptor)


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
    prepare = commands.add_parser(
        "prepare",
        help="offline exclusive setup of one preprovisioned publication root",
    )
    prepare.add_argument("--output-root", required=True, type=Path)
    prepare.add_argument("--snapshot-version", required=True)

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

    review = commands.add_parser(
        "review-jsonl", help="validate one snapshot artifact and stream candidates JSONL"
    )
    review.add_argument("--artifact", required=True, type=Path)
    review.add_argument("--snapshot-version", required=True)

    binding = commands.add_parser("verify-apply-binding", help="verify a separate operator apply version")
    binding.add_argument("--manifest", required=True, type=Path)
    binding.add_argument("--applied-version", required=True)
    binding.add_argument("--verified-manifest-sha256", required=True)
    return parser


def main(argv=None):
    args = _parser().parse_args(argv)
    candidates = None
    try:
        if args.command == "prepare":
            root = prepare_output_root(args.output_root, args.snapshot_version)
            result = {
                "output_root": str(root),
                "prepared": True,
                "snapshot_version": args.snapshot_version,
            }
        elif args.command == "export":
            if args.resolver_json and not args.input_json:
                raise ValueError("--resolver-json requires --input-json")
            # Authenticate the fully preprovisioned root before DB/DNS work.
            # Export never creates or promotes trust-anchor state.
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
        elif args.command == "review-jsonl":
            stream_review_candidates(args.artifact, args.snapshot_version, sys.stdout.buffer)
            return 0
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
