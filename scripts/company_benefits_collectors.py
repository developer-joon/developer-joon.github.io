#!/usr/bin/env python3
"""Bounded, SSRF-resistant collectors for company-benefits v2 research."""

from __future__ import annotations

import base64
import dataclasses
import hashlib
import http.client
import ipaddress
import json
import multiprocessing
import os
import re
import socket
import ssl
import stat
import time
import urllib.parse
import uuid
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Mapping, Protocol, Sequence

from jsonschema import Draft202012Validator, FormatChecker


COLLECTOR_VERSION = "benefits-collector/2.0.0"
COVERAGE_POLICY_ID = "coverage-policy-v2"
REDIRECT_STATUSES = {301, 302, 303, 307, 308}
TRANSIENT_STATUSES = {408, 425, 429, 500, 502, 503, 504}
ALLOWED_CONTENT_TYPES = {
    "application/json",
    "application/pdf",
    "application/xhtml+xml",
    "text/html",
    "text/plain",
}
SENSITIVE_QUERY_KEYS = {
    "access_token", "api_key", "apikey", "authorization", "credential",
    "id_token", "key", "oauth_token", "oauth_verifier", "password",
    "refresh_token", "secret", "signature", "sig", "token",
    "awsaccesskeyid", "googleaccessid", "key-pair-id", "client_secret",
}
SENSITIVE_RECORD_KEYS = SENSITIVE_QUERY_KEYS | {
    "cookie", "set-cookie", "proxy-authorization", "www-authenticate",
}
SECRET_TEXT_PATTERNS = (
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+"),
    re.compile(r"(?i)\b(?:token|password|secret|credential)[\"']?\s*[:=]\s*[\"']?[^\s&#;\"']+"),
    re.compile(r"(?i)\b(?:api[_-]?key|x-api-key|access[_-]?token|refresh[_-]?token|id[_-]?token|oauth[_-]?token|client[_-]?secret|authorization)[\"']?\s*[:=]\s*[\"']?[^\s&#;\"']+"),
    re.compile(r"(?i)\b(?:x-amz-[a-z0-9-]+|x-goog-[a-z0-9-]+|signature|sig|awsaccesskeyid|googleaccessid)[\"']?\s*[:=]\s*[\"']?[^\s&#;\"']+"),
    re.compile(r"\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{12,}|sk_(?:live|test)_[A-Za-z0-9]{12,})\b"),
)
REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_ROOT = REPOSITORY_ROOT / "docs" / "research" / "company-benefits" / "schema"
MAX_CAPTURE_ENVELOPE_BYTES = 16 * 1024 * 1024
MAX_CHECKPOINT_BYTES = 16 * 1024 * 1024
MAX_SAFE_RESPONSE_HEADER_BYTES = 256 * 1024
MAX_LEGACY_CAPTURE_HEADER_BYTES = 4 * 1024 * 1024


class CollectorError(ValueError):
    """Base collector failure."""


class SecurityError(CollectorError):
    """The requested network target violates the public-HTTPS policy."""


class FetchError(CollectorError):
    """A bounded fetch could not produce an acceptable response."""


class TransientFetchError(FetchError):
    """A fetch failed in a way that may be retried within the finite budget."""


class CheckpointError(CollectorError):
    """A checkpoint is corrupt or belongs to different input."""


@dataclass(frozen=True)
class CompanyAuthority:
    company_id: str
    jurisdiction: str
    legal_name: str
    canonical_legal_entity: str


@dataclass(frozen=True)
class Route:
    route_kind: str
    terms: tuple[str, ...]
    policy_route_id: str | None = None


ROUTES: Mapping[str, Route] = {
    "official-company": Route(
        "company_recruiting_major_media",
        ("benefits",),
        "company-recruiting-media",
    ),
    "official-government": Route("official_government", ("benefits", "regulator", "government")),
    "company-recruiting-media": Route("company_recruiting_major_media", ("benefits", "careers", "recruiting")),
    "other-public-web": Route("other_public_web", ("benefits",)),
    "community-review": Route("community_employee_review", ("benefits", "employee", "review")),
}


@dataclass(frozen=True)
class FetchPolicy:
    max_redirects: int = 4
    max_wire_bytes: int = 2_000_000
    max_decoded_bytes: int = 4_000_000
    connect_timeout: float = 5.0
    read_timeout: float = 10.0
    dns_timeout: float = 3.0
    total_timeout: float = 30.0
    retries: int = 2
    retry_backoff_seconds: float = 0.25

    def __post_init__(self) -> None:
        numeric = (
            self.max_redirects, self.max_wire_bytes, self.max_decoded_bytes,
            self.connect_timeout, self.read_timeout, self.retries,
            self.retry_backoff_seconds, self.dns_timeout, self.total_timeout,
        )
        if any(value < 0 for value in numeric):
            raise ValueError("fetch policy bounds must be non-negative")
        if self.max_wire_bytes == 0 or self.max_decoded_bytes == 0:
            raise ValueError("response byte bounds must be positive")
        if self.dns_timeout == 0 or self.total_timeout == 0:
            raise ValueError("DNS and total timeouts must be positive")


@dataclass(frozen=True)
class TransportResponse:
    status: int
    headers: Mapping[str, str]
    body: bytes
    peer_ip: str


@dataclass(frozen=True)
class FetchResult:
    requested_url: str
    final_url: str
    url_chain: list[str]
    status: int
    headers: Mapping[str, str]
    body: bytes
    network_bindings: tuple[Mapping[str, object], ...] = dataclasses.field(default_factory=tuple)


@dataclass(frozen=True)
class _ValidatedTarget:
    url: str
    resolved_ips: frozenset[str]


@dataclass(frozen=True)
class _CanonicalTarget:
    url: str
    host: str
    port: int
    literal_ips: frozenset[str]


class Transport(Protocol):
    def request(
        self,
        url: str,
        *,
        connect_timeout: float,
        read_timeout: float,
        max_wire_bytes: int,
    ) -> TransportResponse: ...


def _default_resolver(host: str, port: int) -> list[str]:
    try:
        answers = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise TransientFetchError(f"DNS lookup failed for {host}: {exc}") from exc
    return sorted({str(answer[4][0]).split("%", 1)[0] for answer in answers})


def _resolver_worker(connection, resolver, host: str, port: int) -> None:
    try:
        connection.send((True, list(resolver(host, port))))
    except BaseException as exc:  # child boundary must report and fail closed
        connection.send((False, f"{type(exc).__name__}: {exc}"))
    finally:
        connection.close()


def _stop_and_reap(process) -> None:
    """Bound cleanup without allowing a SIGTERM-ignoring child to survive."""
    try:
        if process.is_alive():
            process.terminate()
            process.join(timeout=0.02)
        if process.is_alive():
            process.kill()
            process.join(timeout=0.05)
        if process.is_alive():
            raise RuntimeError("worker could not be reaped after SIGKILL")
        process.join(timeout=0)
    finally:
        if not process.is_alive():
            process.close()


def _resolve_bounded(
    resolver: Callable[[str, int], Sequence[str]], host: str, port: int, timeout: float
) -> list[str]:
    """Run even stdlib DNS in a killable worker so the timeout is real."""
    if timeout <= 0:
        raise TransientFetchError("DNS deadline exhausted")
    try:
        context = multiprocessing.get_context("fork")
    except ValueError as exc:  # fail closed where a killable resolver is unavailable
        raise TransientFetchError("bounded DNS workers are unavailable") from exc
    parent, child = context.Pipe(duplex=False)
    process = context.Process(target=_resolver_worker, args=(child, resolver, host, port), daemon=True)
    try:
        process.start()
    except BaseException as exc:
        parent.close()
        child.close()
        process.close()
        raise TransientFetchError("DNS worker could not start") from exc
    child.close()
    try:
        if not parent.poll(timeout):
            raise TransientFetchError(f"DNS lookup timed out for {host}")
        ok, payload = parent.recv()
        if not ok:
            raise TransientFetchError(f"DNS lookup failed for {host}: {payload}")
        return [str(value) for value in payload]
    except EOFError as exc:
        raise TransientFetchError(f"DNS worker failed for {host}") from exc
    finally:
        parent.close()
        _stop_and_reap(process)


def _public_ip(value: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    try:
        address = ipaddress.ip_address(value.split("%", 1)[0])
    except ValueError as exc:
        raise SecurityError(f"invalid resolved IP address: {value}") from exc
    if (
        not address.is_global
        or address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    ):
        raise SecurityError(f"non-public network target is prohibited: {address}")
    return address


def _decoded_variants(value: str) -> list[str]:
    variants = [value]
    for _ in range(3):
        decoded = urllib.parse.unquote_plus(variants[-1])
        if decoded == variants[-1]:
            break
        variants.append(decoded)
    return variants


def _contains_secret_text(value: str) -> bool:
    return any(
        pattern.search(variant)
        for variant in _decoded_variants(value)
        for pattern in SECRET_TEXT_PATTERNS
    )


def _sensitive_key(value: str) -> bool:
    lowered = value.lower()
    return (
        lowered in SENSITIVE_RECORD_KEYS
        or lowered.startswith("x-amz-")
        or lowered.startswith("x-goog-")
    )


def _canonical_public_https_target(url: str) -> _CanonicalTarget:
    """Canonicalize and validate HTTPS syntax without performing DNS."""
    if not isinstance(url, str) or len(url) > 4000:
        raise SecurityError("URL must be a bounded string")
    try:
        parsed = urllib.parse.urlsplit(url)
        port = parsed.port or 443
    except ValueError as exc:
        raise SecurityError(f"malformed URL: {exc}") from exc
    if parsed.scheme.lower() != "https":
        raise SecurityError("only HTTPS URLs are permitted")
    if parsed.username is not None or parsed.password is not None:
        raise SecurityError("credentials in URLs are prohibited")
    if not parsed.hostname:
        raise SecurityError("URL must contain a hostname")
    host = parsed.hostname.rstrip(".").lower()
    if host == "localhost" or host.endswith(".localhost"):
        raise SecurityError("localhost targets are prohibited")
    try:
        ascii_host = host.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise SecurityError("invalid internationalized hostname") from exc
    for component in (parsed.path, parsed.query, parsed.fragment):
        for key, _ in urllib.parse.parse_qsl(component, keep_blank_values=True):
            if _sensitive_key(key):
                raise SecurityError(f"credential-like URL parameter is prohibited: {key}")
        if _contains_secret_text(component):
            raise SecurityError("credential-like URL material is prohibited")
    try:
        literal = ipaddress.ip_address(ascii_host)
    except ValueError:
        answers: frozenset[str] = frozenset()
        netloc_host = ascii_host
    else:
        address = str(_public_ip(str(literal)))
        answers = frozenset({address})
        netloc_host = f"[{literal}]" if literal.version == 6 else address
    netloc = netloc_host if port == 443 else f"{netloc_host}:{port}"
    path = parsed.path or "/"
    canonical = urllib.parse.urlunsplit(("https", netloc, path, parsed.query, parsed.fragment))
    return _CanonicalTarget(canonical, ascii_host, port, answers)


def _validated_public_https_target(
    url: str,
    *,
    resolver: Callable[[str, int], Sequence[str]] = _default_resolver,
    dns_timeout: float = 3.0,
) -> _ValidatedTarget:
    """Canonicalize a URL and bind it to public DNS answers."""
    canonical = _canonical_public_https_target(url)
    answers = canonical.literal_ips
    if not answers:
        raw_answers = _resolve_bounded(resolver, canonical.host, canonical.port, dns_timeout)
        if not raw_answers:
            raise TransientFetchError(f"DNS returned no addresses for {canonical.host}")
        answers = frozenset(str(_public_ip(answer)) for answer in raw_answers)
    return _ValidatedTarget(canonical.url, answers)


def validate_public_https_url(
    url: str,
    *,
    resolver: Callable[[str, int], Sequence[str]] = _default_resolver,
    dns_timeout: float = 3.0,
) -> str:
    """Canonicalize a URL and reject credentials, secrets, or non-public targets."""
    return _validated_public_https_target(
        url, resolver=resolver, dns_timeout=dns_timeout
    ).url


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """TLS connection whose TCP peer is a prevalidated numeric address."""

    def __init__(self, host: str, port: int, peer_ip: str, **kwargs: object):
        super().__init__(host, port, **kwargs)
        self._peer_ip = peer_ip

    def connect(self) -> None:
        sock = socket.create_connection(
            (self._peer_ip, self.port), self.timeout, self.source_address
        )
        try:
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except OSError:
            pass
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def _https_request_worker(connection, arguments: tuple[object, ...]) -> None:
    try:
        response = SecureHTTPTransport()._request_direct(*arguments)
        connection.send(("ok", response))
    except SecurityError as exc:
        connection.send(("security", str(exc)))
    except FetchError as exc:
        connection.send(("fetch", str(exc)))
    except BaseException as exc:
        connection.send(("transient", f"{type(exc).__name__}: {exc}"))
    finally:
        connection.close()


class SecureHTTPTransport:
    """One-hop HTTPS transport; redirect policy is enforced by fetch_bounded."""

    def request(
        self,
        url: str,
        *,
        connect_timeout: float,
        read_timeout: float,
        max_wire_bytes: int,
        total_timeout: float | None = None,
        resolved_ip: str | None = None,
    ) -> TransportResponse:
        timeout = total_timeout if total_timeout is not None else connect_timeout + read_timeout
        try:
            context = multiprocessing.get_context("fork")
        except ValueError as exc:
            raise TransientFetchError("bounded HTTPS workers are unavailable") from exc
        parent, child = context.Pipe(duplex=False)
        arguments = (
            url, connect_timeout, read_timeout, max_wire_bytes, timeout, resolved_ip,
        )
        process = context.Process(
            target=_https_request_worker, args=(child, arguments), daemon=True
        )
        try:
            process.start()
        except BaseException as exc:
            parent.close()
            child.close()
            process.close()
            raise TransientFetchError("HTTPS worker could not start") from exc
        child.close()
        try:
            if not parent.poll(timeout):
                raise TransientFetchError("total HTTPS request deadline exceeded")
            kind, payload = parent.recv()
            if kind == "ok" and isinstance(payload, TransportResponse):
                return payload
            if kind == "security":
                raise SecurityError(str(payload))
            if kind == "fetch":
                raise FetchError(str(payload))
            raise TransientFetchError(str(payload))
        except EOFError as exc:
            raise TransientFetchError("HTTPS worker failed") from exc
        finally:
            parent.close()
            _stop_and_reap(process)

    def _request_direct(
        self,
        url: str,
        connect_timeout: float,
        read_timeout: float,
        max_wire_bytes: int,
        total_timeout: float,
        resolved_ip: str | None,
    ) -> TransportResponse:
        deadline = time.monotonic() + (
            total_timeout
        )
        parsed = urllib.parse.urlsplit(url)
        host = parsed.hostname
        if host is None:
            raise SecurityError("URL has no host")
        port = parsed.port or 443
        target = urllib.parse.urlunsplit(("", "", parsed.path or "/", parsed.query, ""))
        if resolved_ip is None:
            raise SecurityError("secure transport requires a prevalidated numeric peer")
        connection = _PinnedHTTPSConnection(
            host,
            port,
            resolved_ip,
            timeout=min(connect_timeout, max(0.001, deadline - time.monotonic())),
            context=ssl.create_default_context(),
        )
        try:
            connection.connect()
            if connection.sock is None:
                raise TransientFetchError("TLS connection has no peer socket")
            connection.sock.settimeout(min(read_timeout, max(0.001, deadline - time.monotonic())))
            peer_ip = connection.sock.getpeername()[0]
            connection.request(
                "GET",
                target,
                headers={
                    "Accept": "text/html,application/xhtml+xml,application/json,text/plain,application/pdf;q=0.8",
                    "Accept-Encoding": "gzip, deflate",
                    "User-Agent": "company-benefits-research/2.0 (+public-evidence-collector)",
                    "Connection": "close",
                },
            )
            response = connection.getresponse()
            headers = _safe_header_items(response.getheaders())
            length = response.getheader("Content-Length")
            if length is not None:
                try:
                    if int(length) > max_wire_bytes:
                        raise FetchError("response Content-Length exceeds wire byte limit")
                except ValueError as exc:
                    raise FetchError("invalid response Content-Length") from exc
            chunks: list[bytes] = []
            wire_bytes = 0
            while wire_bytes <= max_wire_bytes:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TransientFetchError("total request deadline exceeded")
                if connection.sock is not None:
                    connection.sock.settimeout(min(read_timeout, max(0.001, remaining)))
                chunk = response.read1(min(64 * 1024, max_wire_bytes + 1 - wire_bytes))
                if not chunk:
                    break
                chunks.append(chunk)
                wire_bytes += len(chunk)
            body = b"".join(chunks)
            if len(body) > max_wire_bytes:
                raise FetchError("response exceeds wire byte limit")
            return TransportResponse(response.status, headers, body, peer_ip)
        except (TimeoutError, socket.timeout, ssl.SSLError, OSError, http.client.HTTPException) as exc:
            if isinstance(exc, FetchError):
                raise
            raise TransientFetchError(f"HTTPS request failed: {exc}") from exc
        finally:
            connection.close()


def _safe_header_items(headers: Iterable[tuple[object, object]]) -> dict[str, str]:
    safe: dict[str, str] = {}
    aggregate_bytes = 0
    for key, value in headers:
        lowered = str(key).lower()
        if lowered in SENSITIVE_RECORD_KEYS:
            raise SecurityError(f"credential response header is prohibited: {lowered}")
        text = str(value)
        _assert_no_secrets(text)
        try:
            aggregate_bytes += len(lowered.encode("utf-8")) + len(text.encode("utf-8"))
        except UnicodeEncodeError as exc:
            raise FetchError("response header is not valid UTF-8 text") from exc
        safe[lowered] = f"{safe[lowered]}, {text}" if lowered in safe else text
    if aggregate_bytes > MAX_SAFE_RESPONSE_HEADER_BYTES:
        raise FetchError("response headers exceed aggregate byte limit")
    return safe


def _safe_headers(headers: Mapping[str, str]) -> dict[str, str]:
    return _safe_header_items(sorted(headers.items(), key=lambda item: str(item[0]).lower()))


def _validate_resumed_headers(headers: object) -> dict[str, str]:
    if not isinstance(headers, dict) or any(
        not isinstance(key, str) or not isinstance(value, str)
        for key, value in headers.items()
    ):
        raise CheckpointError("checkpoint capture headers are malformed")
    try:
        aggregate_bytes = sum(
            len(key.lower().encode("utf-8")) + len(value.encode("utf-8"))
            for key, value in headers.items()
        )
        _assert_no_secrets(headers)
    except UnicodeEncodeError as exc:
        raise CheckpointError("checkpoint capture header is not valid UTF-8 text") from exc
    except SecurityError as exc:
        raise CheckpointError(f"checkpoint capture headers cannot be validated: {exc}") from exc
    if aggregate_bytes > MAX_LEGACY_CAPTURE_HEADER_BYTES:
        raise CheckpointError("checkpoint capture headers exceed legacy byte limit")
    return headers


_CONTENT_TYPE_TOKEN = re.compile(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+")
_SAFE_TEXT_CHARSETS = {
    "utf-8": "utf-8", "utf8": "utf-8",
    "ascii": "ascii", "us-ascii": "ascii",
    "utf-16le": "utf-16le", "utf-16-le": "utf-16le",
    "utf-16be": "utf-16be", "utf-16-be": "utf-16be",
    "utf-16": "utf-16",
}


def _content_type_and_charset(headers: Mapping[str, str]) -> tuple[str, str | None]:
    raw = next(
        (str(value) for key, value in headers.items() if str(key).lower() == "content-type"),
        "",
    )
    if len(raw) > 1024:
        raise FetchError("Content-Type header exceeds byte limit")
    parts = raw.split(";")
    media_type = parts[0].strip().lower()
    charset: str | None = None
    for raw_parameter in parts[1:]:
        parameter = raw_parameter.strip()
        if not parameter or "=" not in parameter:
            raise FetchError("malformed Content-Type parameter")
        name, value = (part.strip() for part in parameter.split("=", 1))
        if _CONTENT_TYPE_TOKEN.fullmatch(name) is None:
            raise FetchError("malformed Content-Type parameter")
        if value.startswith('"'):
            if len(value) < 2 or not value.endswith('"') or '"' in value[1:-1]:
                raise FetchError("malformed Content-Type parameter")
            value = value[1:-1]
        elif _CONTENT_TYPE_TOKEN.fullmatch(value) is None:
            raise FetchError("malformed Content-Type parameter")
        if name.lower() == "charset":
            if charset is not None or not value:
                raise FetchError("malformed Content-Type charset")
            charset = value.lower()
    return media_type, charset


def _decoded_text_for_secret_scan(body: bytes, headers: Mapping[str, str]) -> str | None:
    media_type, charset = _content_type_and_charset(headers)
    if media_type == "application/pdf" or media_type not in ALLOWED_CONTENT_TYPES:
        return None
    if charset is None:
        codec = "utf-16" if body.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8"
    else:
        codec = _SAFE_TEXT_CHARSETS.get(charset)
        if codec is None:
            raise FetchError(f"unsupported textual charset: {charset}")
    try:
        return body.decode(codec, errors="strict")
    except UnicodeError as exc:
        raise FetchError(f"text body is invalid for declared charset: {exc}") from exc


def _assert_body_has_no_secrets(body: bytes, headers: Mapping[str, str]) -> str | None:
    text = _decoded_text_for_secret_scan(body, headers)
    if text is not None:
        _assert_no_secrets(text)
    return text


def _assert_wire_body_has_no_secrets(body: bytes) -> None:
    # Latin-1 is a bounded one-byte projection that preserves every ASCII
    # secret even when unrelated bytes make the wire body invalid UTF-8.
    _assert_no_secrets(body.decode("latin-1", errors="strict"))
    for codec in ("utf-16le", "utf-16be"):
        try:
            text = body.decode(codec, errors="strict")
        except UnicodeError:
            continue
        _assert_no_secrets(text)


def _bounded_decompress(data: bytes, *, wbits: int, limit: int) -> bytes:
    decoder = zlib.decompressobj(wbits)
    decoded = decoder.decompress(data, limit + 1)
    if len(decoded) > limit or decoder.unconsumed_tail:
        raise FetchError("decoded response exceeds byte limit")
    remaining = limit + 1 - len(decoded)
    decoded += decoder.flush(remaining)
    if len(decoded) > limit or not decoder.eof or decoder.unused_data:
        if len(decoded) > limit:
            raise FetchError("decoded response exceeds byte limit")
        raise FetchError("invalid compressed response framing")
    return decoded


def _decode_body(response: TransportResponse, policy: FetchPolicy) -> bytes:
    if len(response.body) > policy.max_wire_bytes:
        raise FetchError("response exceeds wire byte limit")
    _assert_wire_body_has_no_secrets(response.body)
    headers = {str(key).lower(): str(value) for key, value in response.headers.items()}
    encoding = headers.get("content-encoding", "").strip().lower()
    try:
        if not encoding or encoding == "identity":
            decoded = response.body
        elif encoding == "gzip":
            decoded = _bounded_decompress(
                response.body, wbits=zlib.MAX_WBITS | 16, limit=policy.max_decoded_bytes
            )
        elif encoding == "deflate":
            decoded = _bounded_decompress(
                response.body, wbits=zlib.MAX_WBITS, limit=policy.max_decoded_bytes
            )
        else:
            raise FetchError(f"unsupported content encoding: {encoding}")
    except (OSError, EOFError, zlib.error) as exc:
        raise FetchError(f"invalid compressed response: {exc}") from exc
    if len(decoded) > policy.max_decoded_bytes:
        raise FetchError("decoded response exceeds byte limit")
    _assert_body_has_no_secrets(decoded, headers)
    return decoded


def _request_with_retries(
    url: str,
    transport: Transport,
    policy: FetchPolicy,
    expected_ips: set[str],
    deadline: float,
    monotonic: Callable[[], float],
) -> TransportResponse:
    for attempt in range(policy.retries + 1):
        remaining = deadline - monotonic()
        if remaining <= 0:
            raise FetchError("total fetch deadline exceeded")
        try:
            kwargs = {
                "connect_timeout": min(policy.connect_timeout, remaining),
                "read_timeout": min(policy.read_timeout, remaining),
                "max_wire_bytes": policy.max_wire_bytes,
            }
            if isinstance(transport, SecureHTTPTransport):
                response = transport.request(
                    url, **kwargs, total_timeout=remaining,
                    resolved_ip=sorted(expected_ips)[attempt % len(expected_ips)],
                )
            else:
                response = transport.request(url, **kwargs)
            if monotonic() > deadline:
                raise FetchError("total fetch deadline exceeded")
            peer = str(_public_ip(response.peer_ip))
            if peer not in expected_ips:
                raise SecurityError("connected peer differs from validated DNS answers")
            if response.status in TRANSIENT_STATUSES and attempt < policy.retries:
                if policy.retry_backoff_seconds:
                    time.sleep(min(policy.retry_backoff_seconds * (2 ** attempt), max(0, deadline - monotonic())))
                continue
            return response
        except TransientFetchError:
            if attempt >= policy.retries:
                raise
            if policy.retry_backoff_seconds:
                time.sleep(min(policy.retry_backoff_seconds * (2 ** attempt), max(0, deadline - monotonic())))
    raise AssertionError("finite retry loop exhausted unexpectedly")


def fetch_bounded(
    url: str,
    *,
    transport: Transport,
    policy: FetchPolicy = FetchPolicy(),
    resolver: Callable[[str, int], Sequence[str]] = _default_resolver,
    monotonic: Callable[[], float] = time.monotonic,
    _initial_target: _ValidatedTarget | None = None,
    _deadline: float | None = None,
) -> FetchResult:
    deadline = _deadline if _deadline is not None else monotonic() + policy.total_timeout
    chain: list[str] = []
    bindings: list[Mapping[str, object]] = []
    current = url
    for redirect_count in range(policy.max_redirects + 1):
        remaining = deadline - monotonic()
        if remaining <= 0:
            raise FetchError("total fetch deadline exceeded")
        if redirect_count == 0 and _initial_target is not None:
            target = _initial_target
        else:
            target = _validated_public_https_target(
                current, resolver=resolver, dns_timeout=min(policy.dns_timeout, remaining)
            )
        current = target.url
        answers = set(target.resolved_ips)
        response = _request_with_retries(current, transport, policy, answers, deadline, monotonic)
        _safe_headers(response.headers)
        chain.append(current)
        bindings.append({
            "url": current,
            "resolved_ips": sorted(answers),
            "peer_ip": str(_public_ip(response.peer_ip)),
        })
        if response.status in REDIRECT_STATUSES:
            location = next(
                (str(value) for key, value in response.headers.items() if str(key).lower() == "location"),
                None,
            )
            if not location:
                raise FetchError("redirect response lacks Location header")
            if redirect_count >= policy.max_redirects:
                raise FetchError("redirect limit exceeded")
            current = urllib.parse.urljoin(current, location)
            continue
        body = _decode_body(response, policy)
        content_type, _ = _content_type_and_charset(response.headers)
        if content_type not in ALLOWED_CONTENT_TYPES:
            raise FetchError(f"content type is not allowed: {content_type or 'missing'}")
        if monotonic() > deadline:
            raise FetchError("total fetch deadline exceeded")
        return FetchResult(
            requested_url=_initial_target.url if _initial_target is not None else chain[0],
            final_url=current,
            url_chain=chain,
            status=response.status,
            headers=_safe_headers(response.headers),
            body=body,
            network_bindings=tuple(bindings),
        )
    raise FetchError("redirect limit exceeded")


def canonical_query(company: CompanyAuthority, category_id: str, route_id: str) -> str:
    if route_id not in ROUTES:
        raise CollectorError(f"unknown route: {route_id}")
    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{2,220}", company.company_id) is None:
        raise CollectorError("invalid canonical company identity")
    if re.fullmatch(r"[A-Z]{2}", company.jurisdiction) is None:
        raise CollectorError("invalid canonical company jurisdiction")
    for value in (company.legal_name, company.canonical_legal_entity):
        if (
            not isinstance(value, str)
            or value != value.strip()
            or not value
            or len(value) > 500
            or any(character in value for character in ('"', "\\", "\r", "\n", "\x00"))
        ):
            raise CollectorError("invalid canonical legal entity")
    if re.fullmatch(r"[a-z][a-z0-9-]{2,63}", category_id) is None:
        raise CollectorError("invalid category identity")
    route = ROUTES[route_id]
    parts = [
        f'"{company.canonical_legal_entity}"',
        f'"{company.company_id}"',
        f'"{category_id}"',
    ]
    parts.extend(f'"{term}"' for term in route.terms)
    return " ".join(parts)


def search_locator(query: str) -> str:
    return "https://html.duckduckgo.com/html/?" + urllib.parse.urlencode({"q": query})


def canonical_route_id(route_id: str) -> str:
    if route_id not in ROUTES:
        raise CollectorError(f"unknown route: {route_id}")
    return ROUTES[route_id].policy_route_id or route_id


def attempt_id(company_id: str, category_id: str, route_id: str) -> str:
    return f"attempt::{company_id}::{category_id}::{canonical_route_id(route_id)}"


def source_id(company_id: str, category_id: str, route_id: str, url: str, content_hash: str) -> str:
    payload = json.dumps(
        [company_id, category_id, canonical_route_id(route_id), url, content_hash],
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return "source::" + hashlib.sha256(payload).hexdigest()


def _canonical_json(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def _utc_timestamp(value: str) -> str:
    if not re.fullmatch(r"20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z", value):
        raise CollectorError("timestamps must be UTC RFC3339 values")
    return value


def _assert_no_secrets(value: object) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if _sensitive_key(str(key)):
                raise SecurityError(f"credential field is prohibited: {key}")
            _assert_no_secrets(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _assert_no_secrets(item)
    elif isinstance(value, str) and _contains_secret_text(value):
        raise SecurityError("credential-like material cannot be persisted")


def _path_without_traversal(path: Path, error_type: type[CollectorError]) -> Path:
    expanded = Path(path).expanduser()
    if any(part == ".." for part in expanded.parts):
        raise error_type("path traversal is prohibited")
    return expanded.absolute()


def _prepare_secure_directory(path: Path, error_type: type[CollectorError]) -> tuple[Path, int]:
    absolute = _path_without_traversal(path, error_type)
    try:
        descriptor = os.open(absolute.anchor, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError as exc:
        raise error_type(f"cannot open directory anchor: {exc}") from exc
    try:
        for part in absolute.parts[1:]:
            try:
                child = os.open(
                    part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor
                )
            except FileNotFoundError:
                try:
                    os.mkdir(part, mode=0o700, dir_fd=descriptor)
                    os.fsync(descriptor)
                    child = os.open(
                        part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                        dir_fd=descriptor,
                    )
                except OSError as exc:
                    raise error_type(f"cannot create secure directory component {part}: {exc}") from exc
            except OSError as exc:
                raise error_type(f"directory path contains symlink or special file at {part}: {exc}") from exc
            if not stat.S_ISDIR(os.fstat(child).st_mode):
                os.close(child)
                raise error_type(f"directory path component is not a directory: {part}")
            os.close(descriptor)
            descriptor = child
        return absolute, descriptor
    except BaseException:
        os.close(descriptor)
        raise


def _read_regular_at(
    directory_fd: int,
    name: str,
    error_type: type[CollectorError],
    *,
    max_bytes: int,
) -> bytes:
    if max_bytes < 0:
        raise error_type("regular file byte limit must be non-negative")
    try:
        metadata = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
    except OSError as exc:
        raise error_type(f"cannot inspect regular file {name}: {exc}") from exc
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
        raise error_type(f"file is not a private regular file: {name}")
    if metadata.st_size > max_bytes:
        raise error_type(f"regular file exceeds byte limit: {name}")
    try:
        descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd)
    except OSError as exc:
        raise error_type(f"cannot open regular file {name}: {exc}") from exc
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
            raise error_type(f"file is not a private regular file: {name}")
        if metadata.st_size > max_bytes:
            raise error_type(f"regular file exceeds byte limit: {name}")
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = os.read(descriptor, min(64 * 1024, max_bytes - total + 1))
            if not chunk:
                return b"".join(chunks)
            total += len(chunk)
            if total > max_bytes:
                raise error_type(f"regular file exceeds byte limit: {name}")
            chunks.append(chunk)
    finally:
        os.close(descriptor)


class CaptureStore:
    """Descriptor-relative, content-addressed external capture store."""

    def __init__(self, root: Path, base_url: str, *, repository_root: Path = REPOSITORY_ROOT):
        self._root_fd = -1
        requested = _path_without_traversal(root, SecurityError)
        repository = Path(repository_root).expanduser().resolve(strict=True)
        canonical_candidate = requested.resolve(strict=False)
        try:
            inside_repository = os.path.commonpath((str(repository), str(canonical_candidate))) == str(repository)
        except ValueError:
            inside_repository = False
        if inside_repository:
            raise SecurityError("capture root must be outside the repository")
        try:
            self.root, self._root_fd = _prepare_secure_directory(requested, SecurityError)
            descriptor_path = Path(f"/proc/self/fd/{self._root_fd}").resolve(strict=True)
            if descriptor_path != self.root.resolve(strict=True):
                raise SecurityError("capture root descriptor/path mismatch")
            try:
                descriptor_inside = os.path.commonpath((str(repository), str(descriptor_path))) == str(repository)
            except ValueError:
                descriptor_inside = False
            if descriptor_inside:
                raise SecurityError("capture root resolves inside the repository")
            self.base_url = base_url.rstrip("/") + "/"
            validate_public_https_url(
                self.base_url, resolver=lambda host, port: ["93.184.216.34"], dns_timeout=1.0
            )
        except BaseException:
            self.close()
            raise

    def _ensure_open(self) -> int:
        if self._root_fd < 0:
            raise CollectorError("capture store is closed")
        return self._root_fd

    def close(self) -> None:
        if self._root_fd >= 0:
            os.close(self._root_fd)
            self._root_fd = -1

    def __enter__(self) -> "CaptureStore":
        self._ensure_open()
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        self.close()

    def _digest_directory(self, digest: str) -> int:
        root_fd = self._ensure_open()
        name = digest[:2]
        try:
            os.mkdir(name, mode=0o700, dir_fd=root_fd)
            os.fsync(root_fd)
        except FileExistsError:
            pass
        try:
            descriptor = os.open(
                name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root_fd
            )
        except OSError as exc:
            raise CollectorError(f"capture shard is unsafe: {name}: {exc}") from exc
        if not stat.S_ISDIR(os.fstat(descriptor).st_mode):
            os.close(descriptor)
            raise CollectorError(f"capture shard is not a directory: {name}")
        return descriptor

    def _verify_at(
        self, directory_fd: int, name: str, digest: str, *, max_bytes: int = MAX_CAPTURE_ENVELOPE_BYTES
    ) -> bytes:
        max_bytes = min(max_bytes, MAX_CAPTURE_ENVELOPE_BYTES)
        raw = _read_regular_at(directory_fd, name, CollectorError, max_bytes=max_bytes)
        if hashlib.sha256(raw).hexdigest() != digest:
            raise CollectorError(f"existing capture is corrupt: {name}")
        return raw

    def put(self, value: Mapping[str, object]) -> tuple[str, str]:
        self._ensure_open()
        _assert_no_secrets(value)
        raw = _canonical_json(value)
        if len(raw) > MAX_CAPTURE_ENVELOPE_BYTES:
            raise CollectorError("capture envelope exceeds byte limit")
        digest = hashlib.sha256(raw).hexdigest()
        name = f"{digest}.json"
        directory_fd = self._digest_directory(digest)
        temporary = f".{digest}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
        descriptor = -1
        try:
            try:
                self._verify_at(directory_fd, name, digest)
                return digest, self.base_url + digest
            except CollectorError:
                try:
                    os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                except FileNotFoundError:
                    pass
                else:
                    raise
            descriptor = os.open(
                temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                0o600, dir_fd=directory_fd,
            )
            os.write(descriptor, raw)
            os.fsync(descriptor)
            os.close(descriptor)
            descriptor = -1
            try:
                os.link(
                    temporary, name, src_dir_fd=directory_fd, dst_dir_fd=directory_fd,
                    follow_symlinks=False,
                )
            except FileExistsError:
                self._verify_at(directory_fd, name, digest)
            else:
                os.unlink(temporary, dir_fd=directory_fd)
                temporary = ""
                self._verify_at(directory_fd, name, digest)
                os.fsync(directory_fd)
            return digest, self.base_url + digest
        finally:
            if descriptor >= 0:
                os.close(descriptor)
            if temporary:
                try:
                    os.unlink(temporary, dir_fd=directory_fd)
                except FileNotFoundError:
                    pass
            os.close(directory_fd)

    def read(
        self, digest: str, *, max_bytes: int = MAX_CAPTURE_ENVELOPE_BYTES
    ) -> dict[str, object]:
        self._ensure_open()
        max_bytes = min(max_bytes, MAX_CAPTURE_ENVELOPE_BYTES)
        if re.fullmatch(r"[0-9a-f]{64}", digest) is None:
            raise CollectorError("invalid capture digest")
        directory_fd = self._digest_directory(digest)
        try:
            raw = self._verify_at(directory_fd, f"{digest}.json", digest, max_bytes=max_bytes)
        finally:
            os.close(directory_fd)
        try:
            value = json.loads(raw)
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise CollectorError("capture is not valid JSON") from exc
        if not isinstance(value, dict):
            raise CollectorError("capture is not an object")
        _assert_no_secrets(value)
        return value


def _capture_envelope(
    company: CompanyAuthority,
    category_id: str,
    route_id: str,
    query: str,
    result: FetchResult,
) -> dict[str, object]:
    _assert_no_secrets({
        "query_or_locator": query,
        "requested_url": result.requested_url,
        "final_url": result.final_url,
        "url_chain": result.url_chain,
        "headers": dict(result.headers),
    })
    body_text = _assert_body_has_no_secrets(result.body, result.headers)
    if body_text is not None:
        try:
            structured_body = json.loads(body_text)
        except json.JSONDecodeError:
            pass
        else:
            _assert_no_secrets(structured_body)
    return {
        "capture_version": 1,
        "scope": {
            "company_id": company.company_id,
            "category_id": category_id,
            "route_id": canonical_route_id(route_id),
            "adapter_id": route_id,
            "canonical_legal_entity": company.canonical_legal_entity,
        },
        "query_or_locator": query,
        "request": {
            "url": result.requested_url,
            "redirect_chain": result.url_chain,
            "network_bindings": [dict(value) for value in result.network_bindings],
        },
        "response": {
            "status": result.status,
            "final_url": result.final_url,
            "headers": _safe_headers(result.headers),
            "body_base64": base64.b64encode(result.body).decode("ascii"),
            "body_sha256": hashlib.sha256(result.body).hexdigest(),
        },
    }


def _title(body: bytes, fallback: str) -> str:
    text = body[:100_000].decode("utf-8", errors="replace")
    match = re.search(r"<title[^>]*>(.*?)</title>", text, re.IGNORECASE | re.DOTALL)
    if not match:
        return fallback[:500]
    title = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", match.group(1))).strip()
    return (title or fallback)[:500]


def build_records(
    company: CompanyAuthority,
    category_id: str,
    route_id: str,
    query_or_locator: str,
    result: FetchResult,
    capture_store: CaptureStore,
    *,
    started_at: str,
    completed_at: str,
) -> tuple[dict[str, object], dict[str, object] | None]:
    if route_id not in ROUTES:
        raise CollectorError(f"unknown route: {route_id}")
    receipt_route_id = canonical_route_id(route_id)
    capture_hash, capture_locator = capture_store.put(
        _capture_envelope(company, category_id, route_id, query_or_locator, result)
    )
    found = 200 <= result.status < 300 and bool(result.body)
    source = None
    source_ids: list[str] = []
    if found:
        content_hash = hashlib.sha256(result.body).hexdigest()
        sid = source_id(company.company_id, category_id, route_id, result.final_url, content_hash)
        source_ids.append(sid)
        source = {
            "source_id": sid,
            "source_tier": ROUTES[route_id].route_kind,
            "title": _title(result.body, result.final_url),
            "url": result.final_url,
            "retrieved_at": _utc_timestamp(completed_at),
            "content_sha256": content_hash,
            "reliability": "unrated",
            "currentness": "unknown",
            "scope_status": "unresolved",
            "scope": {
                "countries": [company.jurisdiction],
                "legal_entities": [company.canonical_legal_entity],
                "roles": ["unknown"],
                "employment_types": ["unknown"],
            },
            "conflict_status": "none",
            "publication_eligibility": "discovery_only",
        }
    if found:
        attempt_result = "source_found"
    elif result.status in {404, 410}:
        attempt_result = "no_result"
    else:
        attempt_result = "access_failed"
    receipt: dict[str, object] = {
        "attempt_id": attempt_id(company.company_id, category_id, route_id),
        "cell_id": f"cell::{company.company_id}::{category_id}",
        "company_id": company.company_id,
        "category_id": category_id,
        "jurisdiction": company.jurisdiction,
        "coverage_policy_id": COVERAGE_POLICY_ID,
        "route_id": receipt_route_id,
        "route_kind": ROUTES[route_id].route_kind,
        "query_or_locator": query_or_locator,
        "started_at": _utc_timestamp(started_at),
        "completed_at": _utc_timestamp(completed_at),
        "result": attempt_result,
        "source_ids": source_ids,
        "raw_response_sha256": capture_hash,
        "capture_locator": capture_locator,
        "collector_version": COLLECTOR_VERSION,
    }
    receipt["receipt_content_sha256"] = hashlib.sha256(_canonical_json(receipt)).hexdigest()
    return receipt, source


def _atomic_json_at(
    directory_fd: int, name: str, value: object, error_type: type[CollectorError] = CollectorError
) -> None:
    if name in {"", ".", ".."} or "/" in name:
        raise error_type("invalid JSON output filename")
    try:
        metadata = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
    except FileNotFoundError:
        pass
    else:
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
            raise error_type("refusing to replace symlink or special file")
    raw = _canonical_json(value) + b"\n"
    temporary = f".{name}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
    descriptor = -1
    try:
        descriptor = os.open(
            temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600, dir_fd=directory_fd,
        )
        os.write(descriptor, raw)
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = -1
        os.replace(temporary, name, src_dir_fd=directory_fd, dst_dir_fd=directory_fd)
        temporary = ""
        os.fsync(directory_fd)
    except OSError as exc:
        raise error_type(f"atomic JSON write failed: {exc}") from exc
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        if temporary:
            try:
                os.unlink(temporary, dir_fd=directory_fd)
            except FileNotFoundError:
                pass


def _atomic_json(path: Path, value: object) -> None:
    absolute = _path_without_traversal(path, CollectorError)
    parent, directory_fd = _prepare_secure_directory(absolute.parent, CollectorError)
    del parent
    try:
        _atomic_json_at(directory_fd, absolute.name, value)
    finally:
        os.close(directory_fd)


class BatchCheckpoint:
    def __init__(self, path: Path, input_sha256: str):
        self._directory_fd = -1
        self.path = _path_without_traversal(path, CheckpointError)
        _, self._directory_fd = _prepare_secure_directory(self.path.parent, CheckpointError)
        self._name = self.path.name
        self.input_sha256 = input_sha256
        self.completed: dict[str, object] = {}
        try:
            try:
                os.stat(self._name, dir_fd=self._directory_fd, follow_symlinks=False)
            except FileNotFoundError:
                return
            raw = _read_regular_at(
                self._directory_fd, self._name, CheckpointError, max_bytes=MAX_CHECKPOINT_BYTES
            )
            value = json.loads(raw)
        except (UnicodeError, json.JSONDecodeError) as exc:
            self.close()
            raise CheckpointError(f"checkpoint cannot be read: {exc}") from exc
        except BaseException:
            self.close()
            raise
        try:
            stored_hash = value.pop("checkpoint_sha256", None) if isinstance(value, dict) else None
            if not isinstance(value, dict) or stored_hash != hashlib.sha256(_canonical_json(value)).hexdigest():
                raise CheckpointError("checkpoint content hash mismatch")
            if value.get("input_sha256") != input_sha256:
                raise CheckpointError("checkpoint input hash mismatch")
            completed = value.get("completed")
            if value.get("format_version") != 1 or not isinstance(completed, dict):
                raise CheckpointError("unsupported checkpoint structure")
            _assert_no_secrets(completed)
            self.completed = completed
        except BaseException:
            self.close()
            raise

    def _ensure_open(self) -> int:
        if self._directory_fd < 0:
            raise CheckpointError("batch checkpoint is closed")
        return self._directory_fd

    def close(self) -> None:
        if self._directory_fd >= 0:
            os.close(self._directory_fd)
            self._directory_fd = -1

    def __enter__(self) -> "BatchCheckpoint":
        self._ensure_open()
        return self

    def __exit__(self, exc_type: object, exc: object, traceback: object) -> None:
        self.close()

    def record(self, key: str, result: object) -> None:
        directory_fd = self._ensure_open()
        _assert_no_secrets(result)
        self.completed[key] = result
        value: dict[str, object] = {
            "format_version": 1,
            "input_sha256": self.input_sha256,
            "completed": {item: self.completed[item] for item in sorted(self.completed)},
        }
        value["checkpoint_sha256"] = hashlib.sha256(_canonical_json(value)).hexdigest()
        _atomic_json_at(directory_fd, self._name, value, CheckpointError)


def _serialized_item(item: Mapping[str, object]) -> dict[str, object]:
    company = item.get("company")
    if not isinstance(company, CompanyAuthority):
        raise CollectorError("batch item company must be CompanyAuthority")
    return {
        "company": dataclasses.asdict(company),
        "category_id": item.get("category_id"),
        "route_id": item.get("route_id"),
        "locator": item.get("locator"),
    }


def batch_input_sha256(items: Iterable[Mapping[str, object]]) -> str:
    serialized = [_serialized_item(item) for item in items]
    def company_id(value: Mapping[str, object]) -> str:
        company = value.get("company")
        return str(company.get("company_id", "")) if isinstance(company, dict) else ""

    serialized.sort(key=lambda value: (
        company_id(value),
        str(value["category_id"]),
        str(value["route_id"]),
        str(value.get("locator") or ""),
    ))
    return hashlib.sha256(_canonical_json(serialized)).hexdigest()


def _schema_errors(name: str, value: object) -> list[str]:
    try:
        schema = json.loads((SCHEMA_ROOT / name).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise CheckpointError(f"cannot load checkpoint validation schema {name}: {exc}") from exc
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    return [error.message for error in validator.iter_errors(value)]


def _validate_resumed_entry(
    prior: object,
    *,
    company: CompanyAuthority,
    category_id: str,
    route_id: str,
    locator: str,
    query: str,
    capture_store: CaptureStore,
    resolver: Callable[[str, int], Sequence[str]],
    policy: FetchPolicy,
) -> tuple[dict[str, object], dict[str, object] | None]:
    if not isinstance(prior, dict) or set(prior) != {"receipt", "source"}:
        raise CheckpointError("checkpoint entry has unsupported fields")
    _assert_no_secrets(prior)
    receipt = prior.get("receipt")
    source = prior.get("source")
    if not isinstance(receipt, dict):
        raise CheckpointError("checkpoint entry lacks a receipt")
    if _schema_errors("research-attempt.schema.json", receipt):
        raise CheckpointError("checkpoint receipt fails its schema")
    unsigned = {key: value for key, value in receipt.items() if key != "receipt_content_sha256"}
    if receipt.get("receipt_content_sha256") != hashlib.sha256(_canonical_json(unsigned)).hexdigest():
        raise CheckpointError("checkpoint receipt content hash mismatch")
    expected = {
        "attempt_id": attempt_id(company.company_id, category_id, route_id),
        "cell_id": f"cell::{company.company_id}::{category_id}",
        "company_id": company.company_id,
        "category_id": category_id,
        "jurisdiction": company.jurisdiction,
        "coverage_policy_id": COVERAGE_POLICY_ID,
        "route_id": canonical_route_id(route_id),
        "route_kind": ROUTES[route_id].route_kind,
        "query_or_locator": query,
        "collector_version": COLLECTOR_VERSION,
    }
    if any(receipt.get(key) != value for key, value in expected.items()):
        raise CheckpointError("checkpoint receipt is substituted for another scope or request")
    digest = receipt.get("raw_response_sha256")
    if not isinstance(digest, str) or receipt.get("capture_locator") != capture_store.base_url + digest:
        raise CheckpointError("checkpoint receipt capture binding mismatch")
    try:
        capture = capture_store.read(digest, max_bytes=MAX_CAPTURE_ENVELOPE_BYTES)
        validation_deadline = time.monotonic() + policy.total_timeout
        locator_canonical = _canonical_public_https_target(locator)
        canonical_locator = locator_canonical.url
    except CollectorError as exc:
        raise CheckpointError(f"checkpoint capture cannot be validated: {exc}") from exc
    expected_scope = {
        "company_id": company.company_id,
        "category_id": category_id,
        "route_id": canonical_route_id(route_id),
        "adapter_id": route_id,
        "canonical_legal_entity": company.canonical_legal_entity,
    }
    request = capture.get("request")
    response = capture.get("response")
    if (
        capture.get("capture_version") != 1
        or capture.get("scope") != expected_scope
        or capture.get("query_or_locator") != query
        or not isinstance(request, dict)
        or request.get("url") != canonical_locator
        or not isinstance(request.get("redirect_chain"), list)
        or not request["redirect_chain"]
        or request["redirect_chain"][0] != canonical_locator
        or not isinstance(response, dict)
    ):
        raise CheckpointError("checkpoint capture request or scope binding mismatch")
    chain = request["redirect_chain"]
    bindings = request.get("network_bindings")
    final_url = response.get("final_url")
    if (
        len(chain) > policy.max_redirects + 1
        or not isinstance(final_url, str)
        or chain[-1] != final_url
        or not isinstance(bindings, list)
        or len(bindings) != len(chain)
    ):
        raise CheckpointError("checkpoint redirect or final URL binding mismatch")
    try:
        canonical_chain: list[_CanonicalTarget] = []
        for index, value in enumerate(chain):
            if not isinstance(value, str):
                raise SecurityError("redirect URL is malformed")
            canonical = locator_canonical if index == 0 else _canonical_public_https_target(value)
            if canonical.url != value:
                raise SecurityError("redirect URL is not canonical")
            canonical_chain.append(canonical)
            remaining = validation_deadline - time.monotonic()
            if remaining > 0 and not canonical.literal_ips:
                try:
                    _validated_public_https_target(
                        value, resolver=resolver, dns_timeout=min(policy.dns_timeout, remaining)
                    )
                except TransientFetchError:
                    pass
        for canonical, binding in zip(canonical_chain, bindings):
            if not isinstance(binding, dict) or binding.get("url") != canonical.url:
                raise SecurityError("network binding URL mismatch")
            stored_ips = binding.get("resolved_ips")
            if not isinstance(stored_ips, list):
                raise SecurityError("network binding DNS answers are malformed")
            canonical_ips = {str(_public_ip(str(value))) for value in stored_ips}
            if len(canonical_ips) != len(stored_ips):
                raise SecurityError("network binding has duplicate DNS answers")
            peer = binding.get("peer_ip")
            if not canonical_ips and peer is None and response.get("status") == 599:
                continue
            if not canonical_ips:
                raise SecurityError("network binding has no DNS answers")
            if not isinstance(peer, str) or str(_public_ip(peer)) not in canonical_ips:
                raise SecurityError("network peer differs from recorded DNS answers")
    except CollectorError as exc:
        raise CheckpointError(f"checkpoint network binding cannot be validated: {exc}") from exc
    encoded_body = response.get("body_base64")
    max_base64_length = 4 * ((policy.max_decoded_bytes + 2) // 3)
    if not isinstance(encoded_body, str) or len(encoded_body) > max_base64_length:
        raise CheckpointError("checkpoint capture body encoding exceeds byte limit")
    try:
        body = base64.b64decode(encoded_body, validate=True)
    except (ValueError, TypeError) as exc:
        raise CheckpointError("checkpoint capture body encoding is invalid") from exc
    if len(body) > policy.max_decoded_bytes:
        raise CheckpointError("checkpoint capture body exceeds byte limit")
    headers = _validate_resumed_headers(response.get("headers"))
    try:
        _assert_body_has_no_secrets(body, headers)
    except CollectorError as exc:
        raise CheckpointError(f"checkpoint capture body cannot be validated: {exc}") from exc
    if response.get("body_sha256") != hashlib.sha256(body).hexdigest():
        raise CheckpointError("checkpoint capture body hash mismatch")
    status = response.get("status")
    found = isinstance(status, int) and 200 <= status < 300 and bool(body)
    expected_result = "source_found" if found else "no_result" if status in {404, 410} else "access_failed"
    if receipt.get("result") != expected_result:
        raise CheckpointError("checkpoint receipt result does not match capture")
    if found:
        if not isinstance(source, dict) or _schema_errors("source-v2.schema.json", source):
            raise CheckpointError("checkpoint source fails its schema")
        content_hash = hashlib.sha256(body).hexdigest()
        expected_source_id = source_id(company.company_id, category_id, route_id, str(final_url), content_hash)
        expected_source = {
            "source_id": expected_source_id,
            "source_tier": ROUTES[route_id].route_kind,
            "title": _title(body, str(final_url)),
            "url": final_url,
            "retrieved_at": receipt.get("completed_at"),
            "content_sha256": content_hash,
            "reliability": "unrated",
            "currentness": "unknown",
            "scope_status": "unresolved",
            "scope": {
                "countries": [company.jurisdiction],
                "legal_entities": [company.canonical_legal_entity],
                "roles": ["unknown"],
                "employment_types": ["unknown"],
            },
            "conflict_status": "none",
            "publication_eligibility": "discovery_only",
        }
        if receipt.get("source_ids") != [expected_source_id] or source != expected_source:
            raise CheckpointError("checkpoint source binding mismatch")
        return receipt, source
    if source is not None or receipt.get("source_ids") != []:
        raise CheckpointError("checkpoint non-source result has a source binding")
    return receipt, None


def collect_batch(
    items: Iterable[Mapping[str, object]],
    *,
    transport: Transport,
    capture_store: CaptureStore,
    checkpoint: BatchCheckpoint,
    policy: FetchPolicy = FetchPolicy(),
    resolver: Callable[[str, int], Sequence[str]] = _default_resolver,
    now: Callable[[], str],
    coverage_policy: Mapping[str, object] | None = None,
) -> dict[str, object]:
    _assert_no_secrets(coverage_policy or {})
    ordered = sorted(
        list(items),
        key=lambda item: (
            str(getattr(item.get("company"), "company_id", "")),
            str(item.get("category_id", "")),
            str(item.get("route_id", "")),
        ),
    )
    canonical_scopes: set[tuple[str, str, str]] = set()
    for item in ordered:
        company = item.get("company")
        category_id = item.get("category_id")
        route_id = item.get("route_id")
        if not isinstance(company, CompanyAuthority) or not isinstance(category_id, str) or not isinstance(route_id, str):
            raise CollectorError("invalid batch item")
        scope = (company.company_id, category_id, canonical_route_id(route_id))
        if scope in canonical_scopes:
            raise CollectorError(f"duplicate canonical attempt scope: {scope}")
        canonical_scopes.add(scope)
    attempts: list[dict[str, object]] = []
    sources: list[dict[str, object]] = []
    for item in ordered:
        company = item.get("company")
        category_id = item.get("category_id")
        route_id = item.get("route_id")
        if not isinstance(company, CompanyAuthority) or not isinstance(category_id, str) or not isinstance(route_id, str):
            raise CollectorError("invalid batch item")
        key = attempt_id(company.company_id, category_id, route_id)
        query = canonical_query(company, category_id, route_id)
        locator = item.get("locator") or search_locator(query)
        if not isinstance(locator, str):
            raise CollectorError("locator must be a string")
        canonical_locator = _canonical_public_https_target(locator).url
        prior = checkpoint.completed.get(key)
        if prior is not None:
            receipt, source = _validate_resumed_entry(
                prior, company=company, category_id=category_id, route_id=route_id,
                locator=locator, query=query, capture_store=capture_store,
                resolver=resolver, policy=policy,
            )
            attempts.append(receipt)
            if source is not None:
                sources.append(source)
            continue
        attempt_deadline = time.monotonic() + policy.total_timeout
        started = now()
        remaining = attempt_deadline - time.monotonic()
        if remaining <= 0:
            raise FetchError("total collect deadline exceeded")
        initial_target: _ValidatedTarget | None = None
        try:
            initial_target = _validated_public_https_target(
                canonical_locator, resolver=resolver,
                dns_timeout=min(policy.dns_timeout, remaining),
            )
            fetched = fetch_bounded(
                initial_target.url, transport=transport, policy=policy, resolver=resolver,
                _initial_target=initial_target, _deadline=attempt_deadline,
            )
        except (FetchError, SecurityError) as exc:
            completed = now()
            failure_target = initial_target or _ValidatedTarget(canonical_locator, frozenset())
            synthetic = FetchResult(
                requested_url=failure_target.url,
                final_url=failure_target.url,
                url_chain=[failure_target.url],
                status=599,
                headers={"content-type": "text/plain; charset=ascii"},
                body=str(exc).encode("ascii", errors="backslashreplace")[:policy.max_decoded_bytes],
                network_bindings=({
                    "url": failure_target.url,
                    "resolved_ips": sorted(failure_target.resolved_ips),
                    "peer_ip": None,
                },),
            )
            receipt, source = build_records(
                company, category_id, route_id, query, synthetic, capture_store,
                started_at=started, completed_at=completed,
            )
        else:
            completed = now()
            receipt, source = build_records(
                company, category_id, route_id, query, fetched, capture_store,
                started_at=started, completed_at=completed,
            )
        checkpoint.record(key, {"receipt": receipt, "source": source})
        attempts.append(receipt)
        if source is not None:
            sources.append(source)
    attempts.sort(key=lambda value: str(value["attempt_id"]))
    sources.sort(key=lambda value: str(value["source_id"]))
    artifact: dict[str, object] = {
        "artifact_type": "company-benefits-collector-discovery",
        "format_version": 1,
        "input_sha256": checkpoint.input_sha256,
        "coverage_policy_id": COVERAGE_POLICY_ID,
        "coverage_policy": dict(coverage_policy or {}),
        "attempts": attempts,
        "sources": sources,
    }
    _assert_no_secrets(artifact)
    artifact["artifact_content_sha256"] = hashlib.sha256(_canonical_json(artifact)).hexdigest()
    return artifact


def _validate_discovery_bindings(
    attempts: list[object], sources: list[object]
) -> tuple[dict[object, dict[str, object]], dict[object, dict[str, object]]]:
    attempt_by_id: dict[object, dict[str, object]] = {}
    source_by_id: dict[object, dict[str, object]] = {}
    _assert_no_secrets({"attempts": attempts, "sources": sources})
    for attempt in attempts:
        if not isinstance(attempt, dict) or _schema_errors("research-attempt.schema.json", attempt):
            raise CollectorError("discovery artifact has an invalid attempt")
        unsigned_receipt = {
            key: value for key, value in attempt.items() if key != "receipt_content_sha256"
        }
        if attempt.get("receipt_content_sha256") != hashlib.sha256(
            _canonical_json(unsigned_receipt)
        ).hexdigest():
            raise CollectorError("discovery receipt content hash mismatch")
        company_id = attempt.get("company_id")
        category_id = attempt.get("category_id")
        route_id = attempt.get("route_id")
        if not all(isinstance(value, str) for value in (company_id, category_id, route_id)):
            raise CollectorError("discovery receipt scope binding is malformed")
        assert isinstance(company_id, str) and isinstance(category_id, str) and isinstance(route_id, str)
        if route_id not in ROUTES or canonical_route_id(route_id) != route_id:
            raise CollectorError("discovery receipt route binding is invalid")
        if (
            attempt.get("attempt_id") != attempt_id(company_id, category_id, route_id)
            or attempt.get("cell_id") != f"cell::{company_id}::{category_id}"
            or attempt.get("coverage_policy_id") != COVERAGE_POLICY_ID
            or attempt.get("route_kind") != ROUTES[route_id].route_kind
        ):
            raise CollectorError("discovery receipt scope binding mismatch")
        digest = attempt.get("raw_response_sha256")
        locator = attempt.get("capture_locator")
        if not isinstance(digest, str) or not isinstance(locator, str):
            raise CollectorError("discovery capture binding is malformed")
        parsed_locator = urllib.parse.urlsplit(locator)
        if (
            parsed_locator.scheme != "https"
            or parsed_locator.query
            or parsed_locator.fragment
            or parsed_locator.path.rstrip("/").split("/")[-1] != digest
        ):
            raise CollectorError("discovery capture binding mismatch")
        identifier = attempt.get("attempt_id")
        if identifier in attempt_by_id:
            raise CollectorError("discovery artifact has duplicate attempts")
        attempt_by_id[identifier] = attempt
    for source in sources:
        if not isinstance(source, dict) or _schema_errors("source-v2.schema.json", source):
            raise CollectorError("discovery artifact has an invalid source")
        identifier = source.get("source_id")
        if identifier in source_by_id:
            raise CollectorError("discovery artifact has duplicate sources")
        source_by_id[identifier] = source
    source_owners: dict[object, dict[str, object]] = {}
    for attempt in attempt_by_id.values():
        ids = attempt.get("source_ids")
        if not isinstance(ids, list):
            raise CollectorError("discovery receipt source binding is malformed")
        expected_count = 1 if attempt.get("result") == "source_found" else 0
        if len(ids) != expected_count:
            raise CollectorError("discovery receipt source binding mismatch")
        for identifier in ids:
            if identifier not in source_by_id or identifier in source_owners:
                raise CollectorError("discovery artifact has missing, orphan, or multiply-bound sources")
            source_owners[identifier] = attempt
    if set(source_owners) != set(source_by_id):
        raise CollectorError("discovery artifact has missing or orphan sources")
    for identifier, source in source_by_id.items():
        owner = source_owners[identifier]
        expected_identifier = source_id(
            str(owner["company_id"]), str(owner["category_id"]), str(owner["route_id"]),
            str(source.get("url")), str(source.get("content_sha256")),
        )
        if (
            identifier != expected_identifier
            or source.get("source_tier") != owner.get("route_kind")
            or source.get("retrieved_at") != owner.get("completed_at")
        ):
            raise CollectorError("discovery source binding mismatch")
    return attempt_by_id, source_by_id


def discovery_to_review_package(
    artifact: Mapping[str, object],
    cell_decisions: Sequence[Mapping[str, object]],
    *,
    official_claims: Sequence[Mapping[str, object]] = (),
    references: Sequence[Mapping[str, object]] = (),
    community_reports: Sequence[Mapping[str, object]] = (),
) -> dict[str, object]:
    """Cross the review boundary only after every attempt is bound to a decided cell."""
    if artifact.get("artifact_type") != "company-benefits-collector-discovery":
        raise CollectorError("not a collector discovery artifact")
    _assert_no_secrets(artifact)
    if _schema_errors("collector-discovery-artifact.schema.json", artifact):
        raise CollectorError("collector discovery artifact fails its schema")
    unsigned = {key: value for key, value in artifact.items() if key != "artifact_content_sha256"}
    if artifact.get("artifact_content_sha256") != hashlib.sha256(_canonical_json(unsigned)).hexdigest():
        raise CollectorError("discovery artifact content hash mismatch")
    attempts = artifact.get("attempts")
    sources = artifact.get("sources")
    if not isinstance(attempts, list) or not isinstance(sources, list):
        raise CollectorError("discovery artifact records are malformed")
    attempt_by_id, _ = _validate_discovery_bindings(attempts, sources)
    attempt_ids = set(attempt_by_id)
    bound: set[object] = set()
    for cell in cell_decisions:
        ids = cell.get("attempt_ids")
        if not isinstance(ids, list):
            raise CollectorError("cell decision lacks attempt_ids")
        for identifier in ids:
            if identifier not in attempt_ids or identifier in bound:
                raise CollectorError("cell decision has missing, foreign, or duplicate attempt binding")
            attempt = attempt_by_id[identifier]
            if (
                attempt.get("cell_id") != cell.get("cell_id")
                or attempt.get("company_id") != cell.get("company_id")
                or attempt.get("category_id") != cell.get("category_id")
            ):
                raise CollectorError("cell decision scope does not match its attempt")
            bound.add(identifier)
    if bound != attempt_ids:
        raise CollectorError("review decisions must bind every discovery attempt")
    package = {
        "coverage_policy": dict(artifact.get("coverage_policy") or {}),
        "cells": [dict(cell) for cell in cell_decisions],
        "attempts": list(attempts),
        "official_claims": [dict(value) for value in official_claims],
        "references": [dict(value) for value in references],
        "community_reports": [dict(value) for value in community_reports],
        "sources": list(sources),
    }
    _assert_no_secrets(package)
    return package
