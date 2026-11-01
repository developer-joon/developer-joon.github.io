#!/usr/bin/env python3
"""Export approved benefit corrections as immutable offline-review candidates.

This tool never changes correction rows, evidence ledgers, or public artifacts.  Its
production transport uses a read-only psql transaction; JSON input exists for
credential-free tests and operator rehearsals.
"""

import argparse
import ctypes
import errno
import hashlib
import ipaddress
import json
import multiprocessing
import os
import re
import signal
import socket
import stat
import subprocess
import sys
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
MAX_CANDIDATES = 100_000
MAX_MANIFEST_BYTES = 10 * 1024 * 1024
MAX_DNS_ANSWERS = 64
DEFAULT_DNS_TIMEOUT_SECONDS = 2.0
DEFAULT_PSQL_TIMEOUT_SECONDS = 30.0
DEFAULT_PROCESS_KILL_GRACE_SECONDS = 0.5

# The projection deliberately omits submitter/reviewer identity, audit events,
# provider metadata, tokens, email, and the moderator's internal response.
APPROVED_QUERY = r"""
begin isolation level repeatable read read only;
select coalesce(jsonb_agg(jsonb_build_object(
  'id',r.id,
  'company_id',r.company_id,
  'category_id',r.category_id,
  'current_text',r.current_text,
  'proposed_text',r.proposed_text,
  'scope_text',r.scope_text,
  'source_url',r.source_url,
  'observed_data_version',r.observed_data_version,
  'status',r.status
) order by r.id),'[]'::jsonb)::text
from public.benefit_correction_requests r
where r.status='approved';
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


def _require_public_https_url(value, resolver, resolver_timeout_seconds):
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
    return value


def _validate_row(row, index, resolver, resolver_timeout_seconds):
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
            row["source_url"], resolver, resolver_timeout_seconds
        ),
        "observed_data_version": _require_data_version(row["observed_data_version"]),
    }
    return status, candidate


def build_snapshot(rows, resolver=None, resolver_timeout_seconds=DEFAULT_DNS_TIMEOUT_SECONDS):
    """Validate an exact DB projection and return sorted approved candidates."""
    if not isinstance(rows, list):
        raise ValueError("database response must be an array")
    if len(rows) > MAX_CANDIDATES:
        raise ValueError("database response exceeds candidate limit")
    by_id = {}
    seen_rows = {}
    resolver = resolver or _system_resolver
    for index, row in enumerate(rows):
        status, candidate = _validate_row(row, index, resolver, resolver_timeout_seconds)
        request_id = candidate["correction_request_id"]
        validated = (status, candidate)
        prior_row = seen_rows.get(request_id)
        if prior_row is not None and prior_row != validated:
            raise ValueError(f"conflicting duplicate correction request: {request_id}")
        seen_rows[request_id] = validated
        if status != "approved":
            continue
        by_id[request_id] = candidate
    return [by_id[key] for key in sorted(by_id)]


def _canonical_json_bytes(value):
    encoded = json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    # Keep canonical JSON safe even if an operator accidentally embeds it in an
    # HTML/script context; JSON parsers restore the original untrusted text.
    encoded = encoded.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    return (encoded + "\n").encode("utf-8")


def canonical_jsonl(candidates):
    return b"".join(_canonical_json_bytes(candidate) for candidate in candidates)


def snapshot_sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def _expected_files(snapshot_version, candidates):
    rows = canonical_jsonl(candidates)
    manifest = {
        "artifact_kind": "approved_benefit_correction_offline_review_snapshot",
        "candidate_count": len(candidates),
        "candidates_file": "candidates.jsonl",
        "schema_version": 1,
        "snapshot_sha256": snapshot_sha256(rows),
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
                raw, metadata = _read_regular_file_at(target_fd, name)
            except OSError:
                return False
            if raw != expected[name]:
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
    finally:
        os.close(target_fd)


def _fsync_directory_fd(descriptor):
    os.fsync(descriptor)


def _rename_noreplace(source, target, source_dir_fd=-100, target_dir_fd=-100):
    """Atomically publish a directory without replacing any existing target."""
    libc = ctypes.CDLL(None, use_errno=True)
    renameat2 = getattr(libc, "renameat2", None)
    if renameat2 is None:
        raise OSError(errno.ENOTSUP, "atomic no-replace rename is unavailable")
    renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    renameat2.restype = ctypes.c_int
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


def publish_snapshot(output_root, snapshot_version, candidates):
    """Atomically publish or idempotently accept one immutable version directory."""
    if not isinstance(snapshot_version, str) or not SNAPSHOT_VERSION_RE.fullmatch(snapshot_version):
        raise ValueError("invalid snapshot version")
    root = Path(output_root)
    root.mkdir(parents=True, exist_ok=True)
    target = root / snapshot_version
    expected = _expected_files(snapshot_version, candidates)
    root_fd = os.open(
        root,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
    )
    staging_name = f".{snapshot_version}-{uuid.uuid4().hex}"
    staging_metadata = None
    staging_files = {}
    try:
        try:
            os.stat(snapshot_version, dir_fd=root_fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            if _root_path_still_names_fd(root, root_fd) and _directory_matches(
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
                    view = memoryview(raw)
                    while view:
                        written = os.write(file_fd, view)
                        view = view[written:]
                    os.fsync(file_fd)
                    staging_files[name] = os.fstat(file_fd)
                finally:
                    os.close(file_fd)
            _fsync_directory_fd(staging_fd)
            if not _directory_matches(
                root_fd,
                staging_name,
                expected,
                expected_directory=staging_metadata,
                expected_files=staging_files,
            ):
                raise OSError(errno.ESTALE, "snapshot staging validation failed")
            try:
                _rename_noreplace(
                    staging_name,
                    snapshot_version,
                    source_dir_fd=root_fd,
                    target_dir_fd=root_fd,
                )
            except FileExistsError:
                if _root_path_still_names_fd(root, root_fd) and _directory_matches(
                    root_fd, snapshot_version, expected
                ):
                    return target
                raise FileExistsError(f"existing snapshot mismatch: {target}")
        finally:
            os.close(staging_fd)
        _fsync_directory_fd(root_fd)
        if (
            not _root_path_still_names_fd(root, root_fd)
            or not _directory_matches(
                root_fd,
                snapshot_version,
                expected,
                expected_directory=staging_metadata,
                expected_files=staging_files,
            )
        ):
            raise OSError(errno.ESTALE, "published snapshot path changed")
        return target
    finally:
        _remove_staging(
            root_fd,
            staging_name,
            expected,
            expected_directory=staging_metadata,
        )
        os.close(root_fd)


def load_json_rows(path):
    source = Path(path)
    if source.is_symlink() or not source.is_file():
        raise ValueError("input JSON must be a regular file")
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


def fetch_rows_with_psql(
    process_factory=subprocess.Popen,
    timeout_seconds=DEFAULT_PSQL_TIMEOUT_SECONDS,
    kill_grace_seconds=DEFAULT_PROCESS_KILL_GRACE_SECONDS,
):
    """Read the exact approved projection using psql's configured connection."""
    for value in (timeout_seconds, kill_grace_seconds):
        if not isinstance(value, (int, float)) or isinstance(value, bool) or value <= 0:
            raise ValueError("invalid psql timeout")
    try:
        process = process_factory(
            ["psql", "-X", "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--quiet"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
        )
    except OSError as exc:
        raise RuntimeError("approved correction read failed") from exc
    try:
        stdout, _stderr = process.communicate(input=APPROVED_QUERY, timeout=timeout_seconds)
    except subprocess.TimeoutExpired as exc:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.communicate(timeout=kill_grace_seconds)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                process.communicate(timeout=kill_grace_seconds)
            except subprocess.TimeoutExpired:
                # A descendant that escaped the process group may still hold a
                # captured pipe.  Never let that prevent reaping the direct
                # child or turn cleanup into an unbounded wait.
                for stream_name in ("stdin", "stdout", "stderr"):
                    stream = getattr(process, stream_name, None)
                    if stream is not None:
                        try:
                            stream.close()
                        except OSError:
                            pass
                try:
                    process.wait(timeout=kill_grace_seconds)
                except subprocess.TimeoutExpired:
                    process.kill()
                    try:
                        process.wait(timeout=kill_grace_seconds)
                    except subprocess.TimeoutExpired:
                        pass
        raise RuntimeError("approved correction read timed out") from exc
    if process.returncode != 0:
        raise RuntimeError("approved correction read failed")
    lines = [line for line in stdout.splitlines() if line.strip()]
    if len(lines) != 1:
        raise ValueError("malformed psql response")
    try:
        return json.loads(lines[0])
    except json.JSONDecodeError as exc:
        raise ValueError("malformed psql response") from exc


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
    try:
        if args.command == "export":
            if args.resolver_json and not args.input_json:
                raise ValueError("--resolver-json requires --input-json")
            rows = (
                load_json_rows(args.input_json)
                if args.input_json
                else fetch_rows_with_psql(timeout_seconds=args.psql_timeout_seconds)
            )
            resolver = load_resolver_fixture(args.resolver_json) if args.resolver_json else None
            candidates = build_snapshot(
                rows, resolver=resolver, resolver_timeout_seconds=args.dns_timeout_seconds
            )
            target = publish_snapshot(args.output_root, args.snapshot_version, candidates)
            raw = canonical_jsonl(candidates)
            result = {
                "candidate_count": len(candidates),
                "snapshot_path": str(target),
                "snapshot_sha256": snapshot_sha256(raw),
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


if __name__ == "__main__":
    raise SystemExit(main())
