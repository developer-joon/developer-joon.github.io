#!/usr/bin/env python3
"""Bounded, SSRF-resistant collectors for company-benefits v2 research."""

from __future__ import annotations

import base64
import dataclasses
import hashlib
import http.client
import ipaddress
import json
import os
import re
import socket
import ssl
import time
import urllib.parse
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Mapping, Protocol, Sequence


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
    "key", "password", "secret", "signature", "token",
}
SENSITIVE_RECORD_KEYS = SENSITIVE_QUERY_KEYS | {
    "cookie", "set-cookie", "proxy-authorization", "www-authenticate",
}


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
    official_domain: str | None = None


@dataclass(frozen=True)
class Route:
    route_kind: str
    terms: tuple[str, ...]
    official_domain_only: bool = False
    policy_route_id: str | None = None


ROUTES: Mapping[str, Route] = {
    "official-company": Route(
        "company_recruiting_major_media",
        ("benefits",),
        True,
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
    retries: int = 2
    retry_backoff_seconds: float = 0.25

    def __post_init__(self) -> None:
        numeric = (
            self.max_redirects, self.max_wire_bytes, self.max_decoded_bytes,
            self.connect_timeout, self.read_timeout, self.retries,
            self.retry_backoff_seconds,
        )
        if any(value < 0 for value in numeric):
            raise ValueError("fetch policy bounds must be non-negative")
        if self.max_wire_bytes == 0 or self.max_decoded_bytes == 0:
            raise ValueError("response byte bounds must be positive")


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


def validate_public_https_url(
    url: str,
    *,
    resolver: Callable[[str, int], Sequence[str]] = _default_resolver,
) -> str:
    """Canonicalize a URL and reject credentials, secrets, or non-public targets."""
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
    for key, _ in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True):
        if key.lower() in SENSITIVE_QUERY_KEYS:
            raise SecurityError(f"credential-like query parameter is prohibited: {key}")
    try:
        literal = ipaddress.ip_address(ascii_host)
    except ValueError:
        answers = list(resolver(ascii_host, port))
        if not answers:
            raise TransientFetchError(f"DNS returned no addresses for {ascii_host}")
        for answer in answers:
            _public_ip(answer)
        netloc_host = ascii_host
    else:
        _public_ip(str(literal))
        answers = [str(literal)]
        netloc_host = f"[{literal}]" if literal.version == 6 else str(literal)
    netloc = netloc_host if port == 443 else f"{netloc_host}:{port}"
    path = parsed.path or "/"
    return urllib.parse.urlunsplit(("https", netloc, path, parsed.query, parsed.fragment))


class SecureHTTPTransport:
    """One-hop HTTPS transport; redirect policy is enforced by fetch_bounded."""

    def request(
        self,
        url: str,
        *,
        connect_timeout: float,
        read_timeout: float,
        max_wire_bytes: int,
    ) -> TransportResponse:
        parsed = urllib.parse.urlsplit(url)
        host = parsed.hostname
        if host is None:
            raise SecurityError("URL has no host")
        port = parsed.port or 443
        target = urllib.parse.urlunsplit(("", "", parsed.path or "/", parsed.query, ""))
        connection = http.client.HTTPSConnection(
            host,
            port,
            timeout=connect_timeout,
            context=ssl.create_default_context(),
        )
        try:
            connection.connect()
            if connection.sock is None:
                raise TransientFetchError("TLS connection has no peer socket")
            connection.sock.settimeout(read_timeout)
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
            length = response.getheader("Content-Length")
            if length is not None:
                try:
                    if int(length) > max_wire_bytes:
                        raise FetchError("response Content-Length exceeds wire byte limit")
                except ValueError as exc:
                    raise FetchError("invalid response Content-Length") from exc
            body = response.read(max_wire_bytes + 1)
            if len(body) > max_wire_bytes:
                raise FetchError("response exceeds wire byte limit")
            headers = {key.lower(): value for key, value in response.getheaders()}
            return TransportResponse(response.status, headers, body, peer_ip)
        except (TimeoutError, socket.timeout, ssl.SSLError, OSError, http.client.HTTPException) as exc:
            if isinstance(exc, FetchError):
                raise
            raise TransientFetchError(f"HTTPS request failed: {exc}") from exc
        finally:
            connection.close()


def _safe_headers(headers: Mapping[str, str]) -> dict[str, str]:
    return {
        str(key).lower(): str(value)
        for key, value in sorted(headers.items(), key=lambda item: str(item[0]).lower())
        if str(key).lower() not in SENSITIVE_RECORD_KEYS
    }


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
    return decoded


def _request_with_retries(
    url: str,
    transport: Transport,
    policy: FetchPolicy,
    expected_ips: set[str],
) -> TransportResponse:
    for attempt in range(policy.retries + 1):
        try:
            response = transport.request(
                url,
                connect_timeout=policy.connect_timeout,
                read_timeout=policy.read_timeout,
                max_wire_bytes=policy.max_wire_bytes,
            )
            peer = str(_public_ip(response.peer_ip))
            if peer not in expected_ips:
                raise SecurityError("connected peer differs from validated DNS answers")
            if response.status in TRANSIENT_STATUSES and attempt < policy.retries:
                if policy.retry_backoff_seconds:
                    time.sleep(policy.retry_backoff_seconds * (2 ** attempt))
                continue
            return response
        except TransientFetchError:
            if attempt >= policy.retries:
                raise
            if policy.retry_backoff_seconds:
                time.sleep(policy.retry_backoff_seconds * (2 ** attempt))
    raise AssertionError("finite retry loop exhausted unexpectedly")


def fetch_bounded(
    url: str,
    *,
    transport: Transport,
    policy: FetchPolicy = FetchPolicy(),
    resolver: Callable[[str, int], Sequence[str]] = _default_resolver,
) -> FetchResult:
    requested = url
    chain: list[str] = []
    current = url
    for redirect_count in range(policy.max_redirects + 1):
        current = validate_public_https_url(current, resolver=resolver)
        parsed = urllib.parse.urlsplit(current)
        answers = {str(_public_ip(value)) for value in resolver(parsed.hostname or "", parsed.port or 443)}
        response = _request_with_retries(current, transport, policy, answers)
        chain.append(current)
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
        content_type = next(
            (str(value).split(";", 1)[0].strip().lower() for key, value in response.headers.items()
             if str(key).lower() == "content-type"),
            "",
        )
        if content_type not in ALLOWED_CONTENT_TYPES:
            raise FetchError(f"content type is not allowed: {content_type or 'missing'}")
        return FetchResult(
            requested_url=validate_public_https_url(requested, resolver=resolver),
            final_url=current,
            url_chain=chain,
            status=response.status,
            headers=_safe_headers(response.headers),
            body=body,
        )
    raise FetchError("redirect limit exceeded")


def canonical_query(company: CompanyAuthority, category_id: str, route_id: str) -> str:
    if route_id not in ROUTES:
        raise CollectorError(f"unknown route: {route_id}")
    route = ROUTES[route_id]
    parts = [f'"{company.legal_name}"', f'"{company.company_id}"', f'"{category_id}"']
    if route.official_domain_only:
        if not company.official_domain:
            raise CollectorError("official-company route requires a canonical official domain")
        domain = company.official_domain.strip().rstrip(".").lower().encode("idna").decode("ascii")
        if any(character in domain for character in "/:@"):
            raise CollectorError("invalid official domain")
        parts.append(f"site:{domain}")
    else:
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


class CaptureStore:
    """Content-addressed, repository-external raw response capture store."""

    def __init__(self, root: Path, base_url: str):
        self.root = Path(root).expanduser().resolve()
        self.base_url = base_url.rstrip("/") + "/"
        validate_public_https_url(self.base_url, resolver=lambda host, port: ["93.184.216.34"])
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)

    def put(self, value: Mapping[str, object]) -> tuple[str, str]:
        raw = _canonical_json(value)
        digest = hashlib.sha256(raw).hexdigest()
        directory = self.root / digest[:2]
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        path = directory / f"{digest}.json"
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                raise CollectorError(f"existing capture is corrupt: {path}")
        else:
            with os.fdopen(descriptor, "wb") as output:
                output.write(raw)
                output.flush()
                os.fsync(output.fileno())
            _fsync_directory(directory)
        return digest, self.base_url + digest


def _capture_envelope(
    company: CompanyAuthority,
    category_id: str,
    route_id: str,
    query: str,
    result: FetchResult,
) -> dict[str, object]:
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
        "request": {"url": result.requested_url, "redirect_chain": result.url_chain},
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


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _atomic_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    raw = _canonical_json(value) + b"\n"
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as output:
            descriptor = -1
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        _fsync_directory(path.parent)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _without_secrets(value: object) -> object:
    if isinstance(value, dict):
        return {
            str(key): _without_secrets(item)
            for key, item in value.items()
            if str(key).lower() not in SENSITIVE_RECORD_KEYS
        }
    if isinstance(value, list):
        return [_without_secrets(item) for item in value]
    return value


class BatchCheckpoint:
    def __init__(self, path: Path, input_sha256: str):
        self.path = Path(path)
        self.input_sha256 = input_sha256
        self.completed: dict[str, object] = {}
        if self.path.exists():
            try:
                value = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError) as exc:
                raise CheckpointError(f"checkpoint cannot be read: {exc}") from exc
            stored_hash = value.pop("checkpoint_sha256", None) if isinstance(value, dict) else None
            if not isinstance(value, dict) or stored_hash != hashlib.sha256(_canonical_json(value)).hexdigest():
                raise CheckpointError("checkpoint content hash mismatch")
            if value.get("input_sha256") != input_sha256:
                raise CheckpointError("checkpoint input hash mismatch")
            completed = value.get("completed")
            if value.get("format_version") != 1 or not isinstance(completed, dict):
                raise CheckpointError("unsupported checkpoint structure")
            self.completed = completed

    def record(self, key: str, result: object) -> None:
        clean = _without_secrets(result)
        self.completed[key] = clean
        value: dict[str, object] = {
            "format_version": 1,
            "input_sha256": self.input_sha256,
            "completed": {item: self.completed[item] for item in sorted(self.completed)},
        }
        value["checkpoint_sha256"] = hashlib.sha256(_canonical_json(value)).hexdigest()
        _atomic_json(self.path, value)


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
        prior = checkpoint.completed.get(key)
        if isinstance(prior, dict) and isinstance(prior.get("receipt"), dict):
            attempts.append(prior["receipt"])
            if isinstance(prior.get("source"), dict):
                sources.append(prior["source"])
            continue
        query = canonical_query(company, category_id, route_id)
        locator = item.get("locator") or search_locator(query)
        if not isinstance(locator, str):
            raise CollectorError("locator must be a string")
        started = now()
        try:
            fetched = fetch_bounded(locator, transport=transport, policy=policy, resolver=resolver)
        except (FetchError, SecurityError) as exc:
            completed = now()
            synthetic = FetchResult(
                requested_url=validate_public_https_url(locator, resolver=resolver),
                final_url=validate_public_https_url(locator, resolver=resolver),
                url_chain=[validate_public_https_url(locator, resolver=resolver)],
                status=599,
                headers={"content-type": "text/plain"},
                body=str(exc).encode("utf-8")[:policy.max_decoded_bytes],
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
    return {
        "coverage_policy": dict(coverage_policy or {}),
        "cells": [],
        "attempts": attempts,
        "official_claims": [],
        "references": [],
        "community_reports": [],
        "sources": sources,
    }
