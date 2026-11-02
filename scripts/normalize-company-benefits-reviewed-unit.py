#!/usr/bin/env python3
"""Normalize reviewed benefits-v2 ledgers into a deterministic closed package."""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import json
import os
import shutil
import stat
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / "docs" / "research" / "company-benefits"
LEDGER_FILES = {
    "cells": "company-category-cells.jsonl",
    "attempts": "research-attempts.jsonl",
    "official_claims": "official-claims-v2.jsonl",
    "references": "reference-records.jsonl",
    "community_reports": "community-benefit-reports.jsonl",
    "sources": "sources-v2.jsonl",
}
SCHEMA_FILES = {
    "cells": "company-category-cell.schema.json",
    "attempts": "research-attempt.schema.json",
    "official_claims": "official-claim-v2.schema.json",
    "references": "reference-record.schema.json",
    "community_reports": "community-benefit-report.schema.json",
    "sources": "source-v2.schema.json",
}
ID_FIELDS = {
    "cells": "cell_id",
    "attempts": "attempt_id",
    "official_claims": "claim_id",
    "references": "reference_id",
    "community_reports": "community_report_id",
    "sources": "source_id",
}
PACKAGE_FIELDS = {"coverage_policy", *LEDGER_FILES}
REQUIRED_EMPTY_ROUTES = (
    "official-government",
    "company-recruiting-media",
    "other-public-web",
)


class NormalizationError(RuntimeError):
    """An input cannot be normalized without inventing evidence."""


def canonical_bytes(value: Any, newline: bool = False) -> bytes:
    data = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return data + (b"\n" if newline else b"")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def receipt_content_sha256(receipt: dict[str, Any]) -> str:
    payload = {
        key: value for key, value in receipt.items() if key != "receipt_content_sha256"
    }
    return sha256_bytes(canonical_bytes(payload))


def _schema_fields(ledger: str) -> set[str]:
    schema = json.loads((RESEARCH / "schema" / SCHEMA_FILES[ledger]).read_text(encoding="utf-8"))
    return set(schema["properties"])


def _strip_record(ledger: str, record: dict[str, Any]) -> dict[str, Any]:
    allowed = _schema_fields(ledger)
    return {key: value for key, value in record.items() if key in allowed}


def _source_ids_for_cell(package: dict[str, Any], cell: dict[str, Any]) -> set[str]:
    official = {item["claim_id"]: item for item in package["official_claims"]}
    references = {item["reference_id"]: item for item in package["references"]}
    community = {
        item["community_report_id"]: item for item in package["community_reports"]
    }
    result: set[str] = set()
    for record_id in cell.get("official_claim_ids", []):
        result.update(official.get(record_id, {}).get("source_ids", []))
    for record_id in cell.get("reference_ids", []):
        source_id = references.get(record_id, {}).get("source_id")
        if source_id:
            result.add(source_id)
    for record_id in cell.get("community_report_ids", []):
        source_id = community.get(record_id, {}).get("source_id")
        if source_id:
            result.add(source_id)
    return result


def normalize_payload(
    package: dict[str, Any],
    company_order: list[str],
    category_order: list[str],
    route_order: list[str],
) -> dict[str, Any]:
    """Return schema-only, canonical records without changing evidence decisions."""
    missing_ledgers = sorted(PACKAGE_FIELDS - set(package))
    if missing_ledgers:
        raise NormalizationError(f"missing package fields: {', '.join(missing_ledgers)}")
    result: dict[str, Any] = {"coverage_policy": package["coverage_policy"]}
    for ledger in LEDGER_FILES:
        records = package.get(ledger)
        if not isinstance(records, list) or any(not isinstance(item, dict) for item in records):
            raise NormalizationError(f"{ledger} must be a list of objects")
        result[ledger] = [_strip_record(ledger, item) for item in records]

    company_rank = {company_id: rank for rank, company_id in enumerate(company_order)}
    category_rank = {category: rank for rank, category in enumerate(category_order)}
    route_rank = {route: rank for rank, route in enumerate(route_order)}
    unknown_companies = sorted(
        {item.get("company_id") for item in result["cells"]} - set(company_rank)
    )
    if unknown_companies:
        raise NormalizationError(f"unit split contains unknown companies: {unknown_companies}")

    def cell_key(item: dict[str, Any]) -> tuple[int, int, str]:
        return (
            company_rank.get(item.get("company_id"), len(company_rank)),
            category_rank.get(item.get("category_id"), len(category_rank)),
            str(item.get("cell_id", "")),
        )

    result["cells"].sort(key=cell_key)
    result["attempts"].sort(
        key=lambda item: (
            *cell_key(item),
            route_rank.get(item.get("route_id"), len(route_rank)),
            str(item.get("attempt_id", "")),
        )
    )
    for ledger in ("official_claims", "references", "community_reports"):
        id_field = ID_FIELDS[ledger]
        result[ledger].sort(key=lambda item: (*cell_key(item), str(item.get(id_field, ""))))
    result["sources"].sort(key=lambda item: str(item.get("source_id", "")))

    attempt_index = {item.get("attempt_id"): item for item in result["attempts"]}
    if len(attempt_index) != len(result["attempts"]):
        raise NormalizationError("duplicate attempt_id")
    for attempt_record in result["attempts"]:
        raw_hash = attempt_record.get("raw_response_sha256")
        if not isinstance(raw_hash, str) or len(raw_hash) != 64:
            raise NormalizationError(
                f"{attempt_record.get('attempt_id')}: invalid raw_response_sha256"
            )
        attempt_record["capture_locator"] = f"https://captures.invalid/sha256/{raw_hash}"
        attempt_record["receipt_content_sha256"] = receipt_content_sha256(attempt_record)

    for cell_record in result["cells"]:
        cell_id = cell_record.get("cell_id")
        bound: list[dict[str, Any]] = []
        for attempt_id in cell_record.get("attempt_ids", []):
            receipt = attempt_index.get(attempt_id)
            if receipt is None:
                raise NormalizationError(f"{cell_id}: missing attempt {attempt_id}")
            if receipt.get("cell_id") != cell_id:
                raise NormalizationError(f"{cell_id}: cross-cell attempt {attempt_id}")
            bound.append(receipt)
        discovered = {
            source_id for receipt in bound for source_id in receipt.get("source_ids", [])
        }
        for source_id in sorted(_source_ids_for_cell(result, cell_record)):
            if source_id not in discovered:
                raise NormalizationError(
                    f"{cell_id}: source {source_id} not discovered by a cell-local attempt"
                )
        if cell_record.get("state") == "no_public_info":
            routes = [item.get("route_id") for item in bound]
            if sorted(routes) != sorted(REQUIRED_EMPTY_ROUTES):
                raise NormalizationError(
                    f"{cell_id}: no_public_info requires exact required routes"
                )
            if cell_record.get("coverage_complete") is False:
                raise NormalizationError(
                    f"{cell_id}: explicit coverage_complete=false cannot be changed"
                )
            cell_record["coverage_complete"] = True
    return result


@dataclass(frozen=True)
class AcquisitionReceipt:
    path: Path
    payload: dict[str, Any]
    file_sha256: str


@dataclass
class AcquisitionIndex:
    receipts: list[AcquisitionReceipt] = field(default_factory=list)
    files_by_sha256: dict[str, Path] = field(default_factory=dict)
    json_by_attempt: dict[str, list[Path]] = field(default_factory=dict)
    json_payloads: dict[Path, Any] = field(default_factory=dict)


def index_acquisition_roots(roots: Iterable[Path]) -> AcquisitionIndex:
    index = AcquisitionIndex()
    seen: set[Path] = set()
    for root_value in roots:
        root = Path(root_value).resolve()
        if not root.is_dir():
            raise NormalizationError(f"acquisition root is not a directory: {root}")
        for path in sorted(root.rglob("*")):
            if not path.is_file() or path.is_symlink():
                continue
            resolved = path.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            digest = sha256_file(path)
            index.files_by_sha256.setdefault(digest, path)
            if path.suffix.lower() not in {".json", ".jsonl"}:
                continue
            try:
                text = path.read_text(encoding="utf-8")
                if path.suffix.lower() == ".jsonl":
                    payload = [json.loads(line) for line in text.splitlines() if line.strip()]
                else:
                    payload = json.loads(text)
            except (OSError, UnicodeError, json.JSONDecodeError):
                continue
            index.json_payloads[path] = payload
            payload_items = payload if isinstance(payload, list) else [payload]
            for item_payload in payload_items:
                if not isinstance(item_payload, dict):
                    continue
                attempt_id = item_payload.get("attempt_id")
                if isinstance(attempt_id, str):
                    index.json_by_attempt.setdefault(attempt_id, []).append(path)
                if (
                    item_payload.get("artifact_type")
                    == "company-benefits-search-tool-acquisition"
                    and item_payload.get("format_version") == 2
                ):
                    index.receipts.append(AcquisitionReceipt(path, item_payload, digest))
    index.receipts.sort(key=lambda item: (str(item.payload.get("query_id", "")), str(item.path)))
    return index


def safe_relative_path(value: str) -> str:
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise NormalizationError(f"unsafe manifest path: {value}")
    return str(path)


@dataclass(frozen=True)
class CopiedArtifact:
    relative_path: str
    sha256: str
    size: int


def _private_parent(path: Path, stop: Path) -> None:
    stop.mkdir(parents=True, exist_ok=True, mode=0o700)
    stop.chmod(0o700)
    relative = path.relative_to(stop)
    current = stop
    for part in relative.parts:
        current = current / part
        if current.exists() and (current.is_symlink() or not current.is_dir()):
            raise NormalizationError(f"unsafe output directory: {current}")
        current.mkdir(exist_ok=True, mode=0o700)
        current.chmod(0o700)


def copy_immutable(source: Path, output: Path, relative_directory: str) -> CopiedArtifact:
    source = Path(source)
    if not source.is_file() or source.is_symlink():
        raise NormalizationError(f"immutable artifact is not a regular file: {source}")
    data = source.read_bytes()
    digest = sha256_bytes(data)
    relative = safe_relative_path(f"{relative_directory}/{digest}{source.suffix.lower()}")
    destination = output / relative
    _private_parent(destination.parent, output)
    if destination.exists() and destination.read_bytes() != data:
        raise NormalizationError(f"content-address collision: {relative}")
    destination.write_bytes(data)
    destination.chmod(0o600)
    return CopiedArtifact(relative, digest, len(data))


def _write_private(path: Path, data: bytes) -> CopiedArtifact:
    _private_parent(path.parent, path.parents[len(path.parts) - len(path.parts)]) if False else None
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    path.chmod(0o600)
    return CopiedArtifact(path.name, sha256_bytes(data), len(data))


def _all_values(value: Any) -> Iterable[Any]:
    yield value
    if isinstance(value, dict):
        for item in value.values():
            yield from _all_values(item)
    elif isinstance(value, list):
        for item in value:
            yield from _all_values(item)


def extract_content(index: AcquisitionIndex, expected_hash: str) -> bytes | None:
    exact = index.files_by_sha256.get(expected_hash)
    if exact is not None:
        return exact.read_bytes()
    for payload in index.json_payloads.values():
        for value in _all_values(payload):
            candidates: list[bytes] = []
            if isinstance(value, (dict, list)):
                candidates.append(canonical_bytes(value))
                candidates.append(canonical_bytes(value, newline=True))
            elif isinstance(value, str):
                candidates.append(value.encode("utf-8"))
                try:
                    candidates.append(base64.b64decode(value, validate=True))
                except (ValueError, binascii.Error):
                    pass
            for data in candidates:
                if sha256_bytes(data) == expected_hash:
                    return data
    return None


def _extract_raw(index: AcquisitionIndex, expected_hash: str, attempt_id: str) -> bytes | None:
    exact = index.files_by_sha256.get(expected_hash)
    if exact is not None:
        return exact.read_bytes()
    candidate_paths = index.json_by_attempt.get(attempt_id, [])
    candidate_index = AcquisitionIndex(
        files_by_sha256=index.files_by_sha256,
        json_payloads={path: index.json_payloads[path] for path in candidate_paths},
    )
    return extract_content(candidate_index, expected_hash) or extract_content(index, expected_hash)


def _receipt_for_attempt(index: AcquisitionIndex, attempt: dict[str, Any]) -> AcquisitionReceipt | None:
    company = attempt["company_id"]
    category = attempt["category_id"]
    route = attempt["route_id"]
    locator = attempt.get("query_or_locator")
    exact = f"search-query::{company}::{category}::{route}"
    broad = f"search-query::{company}::broad::{route}"
    candidates = []
    for item in index.receipts:
        query_id = item.payload.get("query_id")
        if query_id == locator:
            return item
        if query_id == exact:
            candidates.insert(0, item)
        elif query_id == broad:
            candidates.append(item)
    return candidates[0] if candidates else None


def _manifest_files(output: Path, exclude: set[str] | None = None) -> list[dict[str, Any]]:
    excluded = exclude or set()
    records = []
    for path in sorted(output.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(output).as_posix()
        if relative in excluded:
            continue
        records.append({"path": relative, "sha256": sha256_file(path), "size": path.stat().st_size})
    return records


def verify_closure_manifest(output: Path, manifest: dict[str, Any]) -> None:
    for record in manifest.get("files", []):
        relative = safe_relative_path(record.get("path", ""))
        path = output / relative
        if not path.is_file() or path.is_symlink():
            raise NormalizationError(f"manifest file missing: {relative}")
        if sha256_file(path) != record.get("sha256"):
            raise NormalizationError(f"manifest hash mismatch: {relative}")
        if path.stat().st_size != record.get("size"):
            raise NormalizationError(f"manifest size mismatch: {relative}")


def _write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    data = b"".join(canonical_bytes(record, newline=True) for record in records)
    path.write_bytes(data)
    path.chmod(0o600)


def materialize_package(
    package: dict[str, Any],
    output: Path,
    batch_id: str,
    unit_id: str,
    acquisition_roots: list[Path],
) -> dict[str, Any]:
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    output.chmod(0o700)
    package_path = output / "validation-package.json"
    package_path.write_bytes(canonical_bytes(package, newline=True))
    package_path.chmod(0o600)
    for ledger, filename in LEDGER_FILES.items():
        _write_jsonl(output / filename, package[ledger])

    index = index_acquisition_roots(acquisition_roots)
    closure_attempts = []
    for attempt_record in package["attempts"]:
        attempt_id = attempt_record["attempt_id"]
        receipt_data = canonical_bytes(attempt_record, newline=True)
        receipt_hash = sha256_bytes(receipt_data)
        receipt_relative = f"artifacts/attempt-receipts/{receipt_hash}.json"
        receipt_path = output / receipt_relative
        receipt_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        receipt_path.parent.chmod(0o700)
        receipt_path.write_bytes(receipt_data)
        receipt_path.chmod(0o600)

        raw_hash = attempt_record["raw_response_sha256"]
        raw = _extract_raw(index, raw_hash, attempt_id)
        if raw is None:
            raise NormalizationError(f"{attempt_id}: immutable raw response bytes not found")
        raw_relative = f"artifacts/raw/{raw_hash}.bin"
        raw_path = output / raw_relative
        raw_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        raw_path.parent.chmod(0o700)
        raw_path.write_bytes(raw)
        raw_path.chmod(0o600)
        if sha256_file(raw_path) != raw_hash:
            raise NormalizationError(f"{attempt_id}: copied raw response hash mismatch")

        acquisition = _receipt_for_attempt(index, attempt_record)
        acquisition_record = None
        if acquisition is not None:
            copied = copy_immutable(acquisition.path, output, "artifacts/acquisition-receipts")
            acquisition_record = {
                "path": copied.relative_path,
                "sha256": copied.sha256,
                "format_version": 2,
                "query_id": acquisition.payload.get("query_id"),
            }
        capture_candidates = index.json_by_attempt.get(attempt_id, [])
        capture_record = None
        if capture_candidates:
            copied = copy_immutable(capture_candidates[0], output, "artifacts/captures")
            capture_record = {"path": copied.relative_path, "sha256": copied.sha256}
        elif acquisition is not None:
            capture_hash = acquisition.payload.get("capture_sha256")
            capture_path = index.files_by_sha256.get(capture_hash)
            if capture_path is not None:
                copied = copy_immutable(capture_path, output, "artifacts/captures")
                capture_record = {"path": copied.relative_path, "sha256": copied.sha256}
        if capture_record is None:
            raise NormalizationError(f"{attempt_id}: immutable capture bytes not found")
        closure_attempts.append(
            {
                "attempt_id": attempt_id,
                "receipt": {"path": receipt_relative, "sha256": receipt_hash},
                "acquisition_receipt": acquisition_record,
                "capture": capture_record,
                "raw": {"path": raw_relative, "sha256": raw_hash},
                "public_capture_locator": attempt_record["capture_locator"],
                "source_ids": attempt_record.get("source_ids", []),
            }
        )

    source_closure = []
    for source in package["sources"]:
        content_hash = source.get("content_sha256")
        source_path = index.files_by_sha256.get(content_hash)
        if source_path is not None:
            copied = copy_immutable(source_path, output, "artifacts/source-bodies")
        else:
            source_bytes = extract_content(index, content_hash)
            if source_bytes is None:
                raise NormalizationError(
                    f"{source.get('source_id')}: immutable source body bytes not found"
                )
            relative = f"artifacts/source-bodies/{content_hash}.bin"
            target = output / relative
            _private_parent(target.parent, output)
            target.write_bytes(source_bytes)
            target.chmod(0o600)
            copied = CopiedArtifact(relative, sha256_file(target), target.stat().st_size)
        source_closure.append(
            {"source_id": source["source_id"], "path": copied.relative_path, "sha256": copied.sha256}
        )

    closure = {
        "batch_id": batch_id,
        "unit_id": unit_id,
        "attempts": closure_attempts,
        "sources": source_closure,
    }
    closure_path = output / "external-closure-manifest.json"
    closure_path.write_bytes(canonical_bytes(closure, newline=True))
    closure_path.chmod(0o600)
    report = {
        "batch_id": batch_id,
        "unit_id": unit_id,
        "cells": len(package["cells"]),
        "attempts": len(package["attempts"]),
        "sources": len(package["sources"]),
        "status": "normalized",
    }
    report_path = output / "normalization-report.json"
    report_path.write_bytes(canonical_bytes(report, newline=True))
    report_path.chmod(0o600)

    manifest = {
        "batch_id": batch_id,
        "unit_id": unit_id,
        "files": _manifest_files(output, {"manifest.json", "SHA256SUMS"}),
    }
    manifest_path = output / "manifest.json"
    manifest_path.write_bytes(canonical_bytes(manifest, newline=True))
    manifest_path.chmod(0o600)
    sums = "".join(f"{item['sha256']}  {item['path']}\n" for item in manifest["files"])
    sums_path = output / "SHA256SUMS"
    sums_path.write_text(sums, encoding="utf-8")
    sums_path.chmod(0o600)
    verify_closure_manifest(output, manifest)
    return manifest


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    records = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        value = json.loads(line)
        if not isinstance(value, dict):
            raise NormalizationError(f"{path}:{line_number}: expected object")
        records.append(value)
    return records


def _company_order(unit_split: str) -> list[str]:
    path = Path(unit_split)
    if path.is_file():
        text = path.read_text(encoding="utf-8")
        if path.suffix == ".jsonl":
            values = [json.loads(line) for line in text.splitlines() if line.strip()]
        else:
            values = json.loads(text)
        if isinstance(values, dict):
            values = values.get("company_ids") or values.get("companies")
        result = [item.get("company_id") if isinstance(item, dict) else item for item in values]
    else:
        result = [item.strip() for item in unit_split.split(",") if item.strip()]
    authoritative = [
        json.loads(line)["company_id"]
        for line in (RESEARCH / "companies.jsonl").read_text(encoding="utf-8").splitlines()
    ]
    requested = set(result)
    if len(requested) != len(result) or not requested:
        raise NormalizationError("unit split must contain unique company IDs")
    ordered = [company_id for company_id in authoritative if company_id in requested]
    if set(ordered) != requested:
        raise NormalizationError("unit split contains company absent from canonical ledger")
    return ordered


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch-id", required=True)
    parser.add_argument("--unit-id", required=True)
    parser.add_argument("--unit-split", required=True)
    for ledger in LEDGER_FILES:
        parser.add_argument(f"--{ledger.replace('_', '-')}", required=True, type=Path)
    parser.add_argument("--acquisition-root", action="append", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        package: dict[str, Any] = {
            "coverage_policy": json.loads(
                (RESEARCH / "research-coverage-policies.json").read_text(encoding="utf-8")
            )
        }
        for ledger in LEDGER_FILES:
            package[ledger] = _read_jsonl(getattr(args, ledger))
        companies = _company_order(args.unit_split)
        category_order = list(package["coverage_policy"]["category_routes"])
        route_order = list(package["coverage_policy"]["routes"])
        normalized = normalize_payload(package, companies, category_order, route_order)
        parent = args.output.resolve().parent
        parent.mkdir(parents=True, exist_ok=True)
        parent.chmod(0o700)
        staging = Path(tempfile.mkdtemp(prefix=f".{args.output.name}-", dir=parent))
        staging.rmdir()
        try:
            materialize_package(
                normalized,
                staging,
                args.batch_id,
                args.unit_id,
                args.acquisition_root,
            )
            if args.output.exists():
                shutil.rmtree(args.output)
            staging.replace(args.output)
        except Exception:
            shutil.rmtree(staging, ignore_errors=True)
            raise
    except (OSError, UnicodeError, json.JSONDecodeError, NormalizationError) as exc:
        print(f"normalization failed: {exc}", file=sys.stderr)
        return 1
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
