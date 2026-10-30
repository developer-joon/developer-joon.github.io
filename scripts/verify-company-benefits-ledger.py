#!/usr/bin/env python3
"""Fail-closed validation for company-benefits research ledgers."""

import argparse
import importlib.util
import calendar
import hashlib
import json
import os
import re
import stat
import sys
import unicodedata
from datetime import date, datetime, time, timezone
from pathlib import Path
from urllib.parse import urlparse

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
PANEL = ["US", "CA", "MX", "BR", "AR", "GB", "FR", "DE", "IT", "TR", "RU", "AU", "CN", "IN", "ID", "JP", "SA", "ZA"]
CLAIM_STATUSES = {"confirmed", "limited", "past", "name_only", "unknown", "conflict"}
EVIDENCED_STATUSES = {"confirmed", "limited", "past", "name_only", "conflict"}
SOURCE_DECISIONS = ("extract", "quote", "retention", "snapshot", "attribution")
PROHIBITED_POPULATION_FILES = {
    "domestic-eligible.jsonl", "international-eligible.jsonl",
    "domestic-selected.jsonl", "international-selected.jsonl",
    "domestic-initial-effective-selected.jsonl", "international-initial-effective-selected.jsonl",
    "domestic-effective-selected.jsonl", "international-effective-selected.jsonl",
    "effective-selection-events.jsonl", "freeze-manifest.json", "effective-selection-manifest.json",
}
RANKING_PATTERNS = (
    re.compile(r"세계\s*매출\s*순위"), re.compile(r"매출\s*(?:상위|순위)\s*\d"),
    re.compile(r"(?:global|world|revenue)\s+(?:revenue\s+)?rank(?:ing)?", re.I),
)
EXPECTED_THRESHOLDS = {
    "domestic_non_financial": ("revenue", 100_000_000_000, "KRW"),
    "international_non_financial": ("revenue", 1_000_000_000, "USD"),
    "domestic_financial": ("total_assets", 10_000_000_000_000, "KRW"),
    "international_financial": ("total_assets", 10_000_000_000, "USD"),
}
PINNED_PROTOCOL_FIELDS = (
    "cutoff_at", "scopes", "registered_sources", "classification", "thresholds",
    "currency_conversion", "source_precedence", "canonical_selection", "immutable_model",
)
EXCLUSION_REASONS = {"entity_ineligible", "duplicate_entity", "evidence_invalidated", "scope_correction"}
OFFICIAL_SOURCE_TYPES = {"government_register", "regulator_filing", "public_enterprise_disclosure", "exchange_filing", "official_company_report"}
PINNED_CONTRACT_SHA256 = "8a9174d66adf5f2fae6d0e6d8144ea873d4d068f918d712573dcb0ed2b861059"
PINNED_CONTRACT_VERSION = "3.1.1"
MAX_EVIDENCE_BYTES = 10 * 1024 * 1024
HASH_SCHEMA = {"type": "string", "pattern": "^[0-9a-f]{64}$"}
EVENT_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["event_id", "protocol_version", "scope", "exclusion_reason", "exclusion_details", "excluded_company_id", "excluded_selection_hash", "excluded_hash_position", "replacement_company_id", "replacement_selection_hash", "previous_effective_sha256", "next_effective_sha256", "occurred_at", "approved_by"],
    "properties": {
        "event_id": {"type": "string", "minLength": 1}, "protocol_version": {"type": "string", "minLength": 1},
        "scope": {"enum": ["domestic", "international"]}, "exclusion_reason": {"enum": sorted(EXCLUSION_REASONS)},
        "exclusion_details": {"type": "string", "minLength": 20}, "excluded_company_id": {"type": "string", "minLength": 1},
        "excluded_selection_hash": HASH_SCHEMA, "excluded_hash_position": {"type": "integer", "minimum": 0},
        "replacement_company_id": {"type": "string", "minLength": 1}, "replacement_selection_hash": HASH_SCHEMA,
        "previous_effective_sha256": HASH_SCHEMA, "next_effective_sha256": HASH_SCHEMA,
        "occurred_at": {"type": "string", "format": "date-time"}, "approved_by": {"type": "string", "minLength": 1},
    },
}
MANIFEST_SCHEMA = {
    "type": "object", "required": ["status", "approved_by", "approved_at", "artifacts"],
    "properties": {
        "status": {"const": "approved"}, "approved_by": {"type": "string", "minLength": 1},
        "approved_at": {"type": "string", "format": "date-time"}, "freeze_manifest_sha256": HASH_SCHEMA,
        "artifacts": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["path", "sha256", "count"], "properties": {"path": {"type": "string", "minLength": 1}, "sha256": HASH_SCHEMA, "count": {"type": "integer", "minimum": 0}}}},
    },
}


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def jsonl_bytes(values):
    return b"".join(json_bytes(value) + b"\n" for value in values)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path, errors):
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"{path}: invalid JSON: {exc}")
        return None
    return value


def read_jsonl(path, errors, required_file=False):
    if not path.is_file():
        if required_file:
            errors.append(f"missing required ledger: {path}")
        return []
    records = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            errors.append(f"{path}:{line_number}: invalid JSON: {exc}")
            continue
        if not isinstance(value, dict):
            errors.append(f"{path}:{line_number}: record must be an object")
            continue
        records.append(value)
    return records


def find_file(root, name):
    direct = root / name
    if direct.exists():
        return direct
    matches = sorted(root.rglob(name))
    return matches[0] if matches else direct


def required(record, fields, kind, record_id, errors, allow_null=()):
    for field in fields:
        if field not in record or (field not in allow_null and record[field] in (None, "")):
            errors.append(f"{record_id}: missing {kind + ' ' if kind else ''}{field}")


def parse_day(value, field, record_id, errors):
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        errors.append(f"{record_id}: invalid {field}")
        return None


def parse_timestamp(value, field, record_id, errors):
    if not isinstance(value, str):
        errors.append(f"{record_id}: invalid {field} timestamp")
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("timezone required")
        return parsed.astimezone(timezone.utc)
    except ValueError:
        errors.append(f"{record_id}: invalid {field} timestamp")
        return None


def as_of_end(as_of):
    return datetime.combine(as_of, time.max, timezone.utc)


def day_start(value):
    return datetime.combine(value, time.min, timezone.utc) if value else None


def _schema_type_matches(value, expected):
    checks = {
        "object": lambda v: isinstance(v, dict), "array": lambda v: isinstance(v, list),
        "string": lambda v: isinstance(v, str), "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
        "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
        "boolean": lambda v: isinstance(v, bool), "null": lambda v: v is None,
    }
    return expected in checks and checks[expected](value)


def validate_structure(value, schema, label, errors, root_schema=None):
    """Validate every JSON Schema keyword used by the checked-in schemas."""
    root_schema = root_schema or schema
    if "$ref" in schema:
        ref = schema["$ref"]
        if not ref.startswith("#/"):
            errors.append(f"{label}: unsupported schema reference {ref}")
            return
        target = root_schema
        for part in ref[2:].split("/"):
            target = target[part.replace("~1", "/").replace("~0", "~")]
        validate_structure(value, target, label, errors, root_schema)
        return
    expected = schema.get("type")
    if expected is not None:
        types = expected if isinstance(expected, list) else [expected]
        if not any(_schema_type_matches(value, item) for item in types):
            errors.append(f"{label}: schema type must be {'/'.join(types)}")
            return
    if "enum" in schema and value not in schema["enum"]: errors.append(f"{label}: schema enum violation")
    if "const" in schema and value != schema["const"]: errors.append(f"{label}: schema const violation")
    if isinstance(value, str):
        if len(value) < schema.get("minLength", 0): errors.append(f"{label}: schema string is too short")
        if "pattern" in schema and not re.search(schema["pattern"], value): errors.append(f"{label}: schema pattern violation")
        fmt = schema.get("format")
        if fmt == "date":
            try: date.fromisoformat(value)
            except ValueError: errors.append(f"{label}: schema invalid date")
        elif fmt == "date-time": parse_timestamp(value, "schema date-time", label, errors)
        elif fmt == "uri":
            parsed = urlparse(value)
            if not parsed.scheme or not parsed.netloc: errors.append(f"{label}: schema invalid URI")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]: errors.append(f"{label}: schema minimum violation")
        if "maximum" in schema and value > schema["maximum"]: errors.append(f"{label}: schema maximum violation")
        if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]: errors.append(f"{label}: schema exclusiveMinimum violation")
    if isinstance(value, list):
        if len(value) < schema.get("minItems", 0): errors.append(f"{label}: schema minItems violation")
        if "maxItems" in schema and len(value) > schema["maxItems"]: errors.append(f"{label}: schema maxItems violation")
        if schema.get("uniqueItems") and len({json.dumps(item, sort_keys=True) for item in value}) != len(value): errors.append(f"{label}: schema uniqueItems violation")
        for index, item in enumerate(value): validate_structure(item, schema.get("items", {}), f"{label}[{index}]", errors, root_schema)
    if isinstance(value, dict):
        for field in schema.get("required", []):
            if field not in value: errors.append(f"{label}: schema missing required {field}")
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            for field in value.keys() - properties.keys(): errors.append(f"{label}: schema additional property {field}")
        for field, item in value.items():
            if field in properties: validate_structure(item, properties[field], f"{label}.{field}", errors, root_schema)
    if "oneOf" in schema:
        matches = 0
        for choice in schema["oneOf"]:
            trial = []
            validate_structure(value, choice, label, trial, root_schema)
            matches += int(not trial)
        if matches != 1: errors.append(f"{label}: schema oneOf violation")
    for condition in schema.get("allOf", []):
        predicate_errors = []
        validate_structure(value, condition.get("if", {}), label, predicate_errors, root_schema)
        branch = condition.get("then") if not predicate_errors else condition.get("else")
        if branch: validate_structure(value, branch, label, errors, root_schema)


def load_schema(name):
    path = Path(__file__).resolve().parents[1] / "docs" / "research" / "company-benefits" / "schema" / name
    return json.loads(path.read_text(encoding="utf-8"))


def older_than_months(value, as_of, months):
    year = as_of.year - (months // 12)
    month = as_of.month - (months % 12)
    if month < 1:
        year -= 1
        month += 12
    day = min(as_of.day, calendar.monthrange(year, month)[1])
    boundary = date(year, month, day)
    return value < boundary


def canonical_values(protocol, company):
    def norm(value, collapse=False):
        value = unicodedata.normalize("NFC", value).strip()
        return re.sub(r"\s+", " ", value) if collapse else value
    seed = protocol.get("canonical_selection", {}).get("seed")
    fields = (seed, company.get("jurisdiction"), company.get("registry_id"), company.get("legal_name"))
    if not all(isinstance(value, str) and value.strip() for value in fields):
        return None
    return [norm(fields[0]), norm(fields[1]), norm(fields[2]), norm(fields[3], True)]


def canonical_hash(protocol, company):
    values = canonical_values(protocol, company)
    return sha256(json_bytes(values)) if values else None


def canonical_key(protocol, company):
    values = canonical_values(protocol, company)
    return (canonical_hash(protocol, company) or "", json_bytes(values) if values else b"")


def pinned_protocol_contract():
    path = Path(__file__).with_name("company-benefits-protocol-contract.json")
    raw = path.read_bytes()
    if sha256(raw) != PINNED_CONTRACT_SHA256:
        raise ValueError("pinned protocol contract violates repository integrity pin")
    contract = json.loads(raw)
    if set(contract) != set(PINNED_PROTOCOL_FIELDS):
        raise ValueError("pinned protocol contract fields are incomplete")
    return contract


def validate_protocol(protocol, source_map, errors):
    contract = pinned_protocol_contract()
    validate_structure(protocol, load_schema("population-protocol.schema.json"), "protocol", errors)
    if protocol.get("version") != PINNED_CONTRACT_VERSION:
        errors.append("protocol version violates independent pinned contract version")
    for field, expected in contract.items():
        if protocol.get(field) != expected:
            errors.append(f"protocol {field} violates pinned protocol contract")
    schema_path = Path(__file__).resolve().parents[1] / "docs" / "research" / "company-benefits" / "schema" / "population-protocol.schema.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    if schema.get("x-pinned-protocol-contract-sha256") != sha256(json_bytes(contract)):
        errors.append("population protocol schema is not aligned with pinned protocol contract")
    scopes = protocol.get("scopes", {})
    domestic = scopes.get("domestic", {})
    international = scopes.get("international", {})
    if domestic.get("jurisdictions") != ["KR"] or domestic.get("target_count") != 1000:
        errors.append("protocol domestic scope must fix the KR union and target_count 1000")
    domestic_ids = domestic.get("candidate_source_ids")
    if not isinstance(domestic_ids, list) or not domestic_ids:
        errors.append("protocol domestic candidate-source union must be non-empty")
    if international.get("country_panel") != PANEL:
        errors.append("protocol international scope must use the fixed 18-country panel")
    if international.get("excluded_jurisdiction") != "KR" or international.get("target_count") != 1000:
        errors.append("protocol international scope must exclude KR and target exactly 1000")
    by_country = international.get("candidate_source_ids_by_jurisdiction")
    if not isinstance(by_country, dict) or set(by_country) != set(PANEL) or any(not isinstance(by_country.get(country), list) or not by_country[country] for country in PANEL):
        errors.append("protocol must register exact international candidate-source IDs by jurisdiction")

    thresholds = protocol.get("thresholds", {})
    for name, (metric, minimum, currency) in EXPECTED_THRESHOLDS.items():
        value = thresholds.get(name, {})
        if (value.get("metric"), value.get("minimum"), value.get("currency")) != (metric, minimum, currency):
            errors.append(f"protocol threshold {name} must be {metric} {minimum} {currency}")
    if thresholds.get("maximum_fiscal_age_months") != 24:
        errors.append("protocol threshold freshness must be exactly 24 months")

    registered = protocol.get("registered_sources")
    expected_jurisdictions = {"KR", *PANEL}
    if not isinstance(registered, dict) or set(registered) != expected_jurisdictions:
        errors.append("protocol registered_sources must cover exact domestic union and fixed panel")
        return
    expected_ids = {"KR": domestic_ids or []}
    if isinstance(by_country, dict):
        expected_ids.update({country: by_country.get(country, []) for country in PANEL})
    for jurisdiction, ids in expected_ids.items():
        entries = registered.get(jurisdiction, [])
        actual_ids = [entry.get("source_id") for entry in entries if isinstance(entry, dict)]
        if actual_ids != ids:
            errors.append(f"protocol registered source IDs mismatch for {jurisdiction}")
        for entry in entries:
            source = source_map.get(entry.get("source_id")) if isinstance(entry, dict) else None
            if source is None or entry.get("endpoint") != source.get("url"):
                errors.append(f"protocol registered source endpoint mismatch for {jurisdiction}")


def source_is_eligible(source, field, grade_required=False):
    if not isinstance(source, dict) or field not in source.get("supported_fields", []):
        return False
    if grade_required and source.get("evidence_eligibility") not in {"A", "B"}:
        return False
    if grade_required and source.get("source_type") not in OFFICIAL_SOURCE_TYPES:
        return False
    if source.get("access_model") not in {"public_keyless", "public_api_key"}:
        return False
    authentication = source.get("authentication", {})
    expected_auth = {"api_key": source.get("access_model") == "public_api_key", "login": False, "fee": False}
    if authentication != expected_auth:
        return False
    if source.get("reuse_decision") not in {"allowed", "allowed_with_attribution"}:
        return False
    if source.get("current_blocker") not in (None, ""):
        return False
    decisions = source.get("decisions", {})
    if decisions.get("extract") != "allowed" or decisions.get("quote") != "allowed":
        return False
    if decisions.get("retention") not in {"allowed", "metadata_only"}:
        return False
    if decisions.get("attribution") not in {"allowed", "required"}:
        return False
    if decisions.get("snapshot") not in {"allowed", "prohibited"}:
        return False
    http = source.get("http_verification", {})
    return http.get("status") == 200 and http.get("access_wall") in {"none", "api_key"}


def validate_sources(sources, errors, as_of=None, evidence_root=None):
    result = {}
    schema = load_schema("source.schema.json")
    fields = ("source_id", "title", "owner", "source_type", "jurisdiction", "url", "locator", "supporting_quote", "content_sha256", "hash_provenance", "retrieved_at", "access_model", "authentication", "terms_url", "reuse_decision", "decisions", "supported_fields", "evidence_eligibility", "checked_at", "http_verification")
    for index, source in enumerate(sources, 1):
        source_id = source.get("source_id") or f"source[{index}]"
        validate_structure(source, schema, source_id, errors)
        required(source, fields, "source", source_id, errors)
        if "current_blocker" not in source:
            errors.append(f"{source_id}: missing source current_blocker")
        if source_id in result:
            errors.append(f"duplicate source_id: {source_id}")
        result[source_id] = source
        source_type = source.get("source_type")
        grade = source.get("evidence_eligibility")
        if str(source.get("owner", "")).strip().casefold() in {"", "anonymous", "unknown", "n/a"}:
            errors.append(f"{source_id}: source owner must be nonanonymous")
        if grade in {"A", "B"} and source_type not in OFFICIAL_SOURCE_TYPES:
            errors.append(f"{source_id}: evidence grade requires an official source_type")
        for field in ("url", "terms_url"):
            if urlparse(str(source.get(field, ""))).scheme != "https":
                errors.append(f"{source_id}: {field} must use HTTPS")
        checked = parse_timestamp(source.get("checked_at"), "source checked_at", source_id, errors)
        retrieved = parse_timestamp(source.get("retrieved_at"), "retrieved_at", source_id, errors)
        published = parse_day(source.get("publication_date"), "source publication_date", source_id, errors)
        if as_of and checked and checked > as_of_end(as_of): errors.append(f"{source_id}: source checked_at is in the future")
        if as_of and retrieved and retrieved > as_of_end(as_of): errors.append(f"{source_id}: source retrieved_at is in the future")
        if checked and retrieved and retrieved > checked: errors.append(f"{source_id}: retrieved_at must not follow checked_at")
        if published and retrieved and day_start(published) > retrieved: errors.append(f"{source_id}: publication_date must not follow retrieved_at")
        if not re.fullmatch(r"[0-9a-f]{64}", str(source.get("content_sha256", ""))):
            errors.append(f"{source_id}: invalid source content_sha256")
        provenance = source.get("hash_provenance")
        if provenance == "retained_file":
            if source.get("decisions", {}).get("retention") != "allowed" or source.get("decisions", {}).get("snapshot") != "allowed":
                errors.append(f"{source_id}: retained evidence requires allowed retention and snapshot decisions")
            relative = source.get("evidence_path")
            try:
                if evidence_root is None or not isinstance(relative, str): raise ValueError
                root = Path(evidence_root).resolve(strict=True)
                candidate = root / relative
                metadata = candidate.lstat()
                resolved = candidate.resolve(strict=True)
                if root not in resolved.parents or stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode) or metadata.st_size > MAX_EVIDENCE_BYTES: raise ValueError
                if sha256(resolved.read_bytes()) != source.get("content_sha256"): raise ValueError
            except (OSError, ValueError):
                errors.append(f"{source_id}: retained evidence is outside the approved root, unsafe, oversized, missing, or hash-mismatched")
        elif provenance == "artifact_manifest":
            official_ids = source.get("official_artifact_ids")
            derived_ids = source.get("derived_artifact_ids")
            if source.get("artifact_manifest_path") != "population/source-artifacts.jsonl" or not isinstance(official_ids, list) or not official_ids or not isinstance(derived_ids, list) or not derived_ids or set(official_ids) & set(derived_ids):
                errors.append(f"{source_id}: artifact manifest must distinguish official acquisition artifacts from derived artifacts")
        elif provenance != "observed_response":
            errors.append(f"{source_id}: invalid hash_provenance")
        decisions = source.get("decisions", {})
        for decision in SOURCE_DECISIONS:
            if decision not in decisions:
                errors.append(f"{source_id}: missing source decision {decision}")
        auth = source.get("authentication", {})
        for field in ("api_key", "login", "fee"):
            if field not in auth:
                errors.append(f"{source_id}: missing authentication decision {field}")
        http = source.get("http_verification", {})
        for field in ("status", "redirect_chain", "content_type", "final_url", "final_owner_domain", "access_wall", "expected_marker"):
            if field not in http:
                errors.append(f"{source_id}: missing http_verification {field}")
        if urlparse(str(http.get("final_url", ""))).scheme != "https": errors.append(f"{source_id}: final URL must use HTTPS")
    return result


def validate_source_use(source_map, source_ids, field, record_id, errors, grade_required=False):
    eligible = []
    for source_id in source_ids:
        source = source_map.get(source_id)
        if source is None:
            errors.append(f"{record_id}: unknown source {source_id}")
            continue
        if field not in source.get("supported_fields", []):
            errors.append(f"{record_id}: source {source_id} does not support {field}")
        if source.get("reuse_decision") not in {"allowed", "allowed_with_attribution"}:
            errors.append(f"{record_id}: source {source_id} reuse is unknown or prohibited")
        access_model = source.get("access_model")
        expected_auth = {"api_key": access_model == "public_api_key", "login": False, "fee": False}
        if access_model not in {"public_keyless", "public_api_key"} or source.get("authentication") != expected_auth:
            errors.append(f"{record_id}: source {source_id} access/authentication decision is ineligible")
        if source.get("decisions", {}).get("retention") not in {"allowed", "metadata_only"}:
            errors.append(f"{record_id}: source {source_id} retention is unknown or prohibited")
        if source.get("decisions", {}).get("snapshot") not in {"allowed", "prohibited"}:
            errors.append(f"{record_id}: source {source_id} snapshot decision is unresolved")
        if source.get("current_blocker") not in (None, ""):
            errors.append(f"{record_id}: source {source_id} has a current blocker")
        http = source.get("http_verification", {})
        if http.get("status") != 200:
            errors.append(f"{record_id}: source {source_id} HTTP status is not 200")
        if http.get("access_wall") not in {"none", "api_key"}:
            errors.append(f"{record_id}: source {source_id} has a prohibited access wall")
        if source_is_eligible(source, field, grade_required):
            eligible.append(source_id)
    return eligible


def source_applies_to_company(source, company, record_id, errors, claim_status):
    if not isinstance(source, dict) or not isinstance(company, dict):
        return False
    jurisdiction = company.get("jurisdiction")
    selected_entity = company.get("selected_reporting_legal_entity")
    applicable = source.get("applicable_legal_entities", [])
    source_jurisdiction = source.get("jurisdiction")
    reporting_group_limited = claim_status == "limited" and "application_scope_as_expressly_quoted" in source.get("supported_fields", [])
    if reporting_group_limited:
        mapping = source.get("multi_jurisdiction_applicability")
        aligned = bool(applicable) and source_jurisdiction in {jurisdiction, "INT"} and isinstance(mapping, dict) and mapping.get(jurisdiction) == applicable
        if not aligned:
            errors.append(f"{record_id}: limited reporting-group source lacks explicit jurisdiction and legal-entity binding")
        return aligned
    aligned = source_jurisdiction == jurisdiction
    if source_jurisdiction == "INT":
        mapping = source.get("multi_jurisdiction_applicability")
        aligned = isinstance(mapping, dict) and "*" not in mapping and set(mapping).issubset({"KR", *PANEL}) and mapping.get(jurisdiction) == applicable
        if not aligned:
            errors.append(f"{record_id}: source {source.get('source_id')} lacks strict explicit multi-jurisdiction applicability")
    elif not aligned:
        errors.append(f"{record_id}: source {source.get('source_id')} jurisdiction does not match company jurisdiction")
    if selected_entity not in applicable:
        errors.append(f"{record_id}: source {source.get('source_id')} applicability does not include selected reporting legal entity")
        aligned = False
    if claim_status != "unknown":
        recorded_owner = company.get("benefit_policy_owner")
        source_owner = source.get("policy_owner_legal_entity")
        if isinstance(recorded_owner, str):
            owner_aligned = source_owner == recorded_owner
        else:
            owner_aligned = (
                isinstance(recorded_owner, dict)
                and recorded_owner.get("status") == "unknown"
                and isinstance(source_owner, str)
                and bool(source_owner.strip())
                and (source_owner == selected_entity or source_owner in applicable)
            )
        if not owner_aligned:
            if isinstance(recorded_owner, str):
                errors.append(f"{record_id}: source {source.get('source_id')} does not match recorded benefit policy owner")
            else:
                errors.append(f"{record_id}: source {source.get('source_id')} does not establish an applicable benefit policy owner")
            aligned = False
    return aligned


def validate_company(protocol, company, source_map, as_of, errors):
    company_id = company.get("company_id") or "company[missing-id]"
    validate_structure(company, load_schema("company.schema.json"), company_id, errors)
    required(company, ("company_id", "jurisdiction", "incorporation_country", "scope", "registry_id", "legal_name", "selected_reporting_legal_entity", "registered_head_office_country", "financial_consolidation_parent", "ultimate_parent", "benefit_policy_owner", "related_company_exception", "entity_status", "sector", "employment_evidence_scope", "employment_boundary_note", "scale_metric", "scale_evidence", "employer_evidence", "scale_source_precedence_rank", "source_availability", "selection_hash"), "", company_id, errors, allow_null=("related_company_exception",))
    scope = company.get("scope")
    jurisdiction = company.get("jurisdiction")
    incorporation = company.get("incorporation_country")
    office = company.get("registered_head_office_country")
    if scope == "domestic" and (jurisdiction != "KR" or incorporation != "KR" or office != "KR"):
        errors.append(f"{company_id}: domestic legal entity requires KR incorporation and registered head office")
    if scope == "international" and (jurisdiction not in PANEL or incorporation != jurisdiction or office != jurisdiction):
        errors.append(f"{company_id}: international incorporation, head office, and fixed panel jurisdiction must match")
    if scope == "international" and (jurisdiction != "US" or incorporation != "US" or office != "US"):
        errors.append(f"{company_id}: international cohort requires strict US incorporation and principal business address")
    if scope == "international" and company.get("legal_name") in {"NCL CORP LTD.", "TRINSEO PLC", "MOBILEYE GLOBAL INC."}:
        errors.append(f"{company_id}: known foreign or ambiguous entity is excluded from strict-US cohort")
    if scope not in {"domestic", "international"}:
        errors.append(f"{company_id}: invalid scope")
    if company.get("entity_status") != "active":
        errors.append(f"{company_id}: invalid entity status")
    if company.get("selected_reporting_legal_entity") != company.get("legal_name"):
        errors.append(f"{company_id}: selected reporting entity must be the legal entity")
    for parent_field in ("financial_consolidation_parent", "ultimate_parent"):
        parent = company.get(parent_field)
        known = isinstance(parent, str) and bool(parent.strip())
        unknown = isinstance(parent, dict) and parent.get("status") == "unknown" and bool(parent.get("reason"))
        if not (known or unknown):
            errors.append(f"{company_id}: {parent_field} requires a known entity or structured unknown reason")
    if company.get("employment_evidence_scope") not in {"filing_entity_total", "filing_entity_total_or_stated_workforce"}:
        errors.append(f"{company_id}: invalid employment evidence scope")
    if "benefit scope" not in str(company.get("employment_boundary_note", "")):
        errors.append(f"{company_id}: employment boundary note must disclaim benefit scope")
    if canonical_hash(protocol, company) != company.get("selection_hash"):
        errors.append(f"{company_id}: selection_hash mismatch")

    sector = company.get("sector")
    threshold_name = f"{scope}_{sector}" if scope in {"domestic", "international"} and sector in {"financial", "non_financial"} else None
    expected = EXPECTED_THRESHOLDS.get(threshold_name)
    metric = company.get("scale_metric", {})
    required(metric, ("type", "value", "currency", "original_value", "original_currency", "conversion", "fiscal_year_end", "financial_scope", "source_ids"), "scale metric", company_id, errors, allow_null=("conversion",))
    if expected:
        expected_type, minimum, currency = expected
        if metric.get("type") != expected_type:
            errors.append(f"{company_id}: invalid scale metric type")
        if metric.get("currency") != currency:
            errors.append(f"{company_id}: normalized threshold currency must be {currency}")
        try:
            if float(metric.get("value", 0)) < minimum:
                errors.append(f"{company_id}: scale metric is below threshold")
        except (TypeError, ValueError):
            errors.append(f"{company_id}: invalid scale metric value")
        if metric.get("original_currency") != currency:
            conversion = metric.get("conversion")
            needed = ("rate", "source_id", "year", "converted_value")
            if not isinstance(conversion, dict) or any(conversion.get(field) in (None, "") for field in needed):
                errors.append(f"{company_id}: non-threshold original currency requires FX conversion proof")
            elif conversion.get("source_id") != protocol.get("currency_conversion", {}).get("source_id"):
                errors.append(f"{company_id}: FX conversion source does not match protocol")
            if isinstance(conversion, dict):
                fiscal_year = str(metric.get("fiscal_year_end", ""))[:4]
                if str(conversion.get("year")) != fiscal_year:
                    errors.append(f"{company_id}: FX conversion year must match fiscal year")
                try:
                    converted = float(conversion.get("converted_value"))
                    calculated = float(metric.get("original_value")) / float(conversion.get("rate"))
                    normalized = float(metric.get("value"))
                    tolerance = max(1e-6, abs(normalized) * 1e-9)
                    if abs(converted - calculated) > tolerance or abs(converted - normalized) > tolerance:
                        errors.append(f"{company_id}: FX converted value does not match original value and rate")
                except (TypeError, ValueError, ZeroDivisionError):
                    errors.append(f"{company_id}: invalid FX conversion values")
                validate_source_use(source_map, [conversion.get("source_id")], "local_currency_per_USD", company_id, errors)
    fiscal = parse_day(metric.get("fiscal_year_end"), "fiscal_year_end", company_id, errors)
    if fiscal and fiscal > as_of:
        errors.append(f"{company_id}: scale metric has a future fiscal year-end")
    elif fiscal and older_than_months(fiscal, as_of, 24):
        errors.append(f"{company_id}: scale metric fiscal age exceeds 24 months")
    source_ids = metric.get("source_ids", []) if isinstance(metric.get("source_ids"), list) else []
    validate_source_use(source_map, source_ids, metric.get("type", "scale field"), company_id, errors)
    evidence_specs = (
        ("scale", company.get("scale_evidence"), metric.get("type"), True),
        ("employer", company.get("employer_evidence"), "employee_evidence", False),
    )
    for label, evidence, supported_field, is_scale in evidence_specs:
        if not isinstance(evidence, dict):
            errors.append(f"{company_id}: missing {label}_evidence")
            continue
        source_id = evidence.get("source_id")
        source = source_map.get(source_id)
        validate_source_use(source_map, [source_id], supported_field, company_id, errors)
        if is_scale and source_id not in source_ids:
            errors.append(f"{company_id}: scale evidence source_id is not in scale_metric source_ids")
        if evidence.get("registry_id") != company.get("registry_id"):
            errors.append(f"{company_id}: {label} evidence registry_id does not match selected entity")
        if evidence.get("legal_name") != company.get("legal_name"):
            errors.append(f"{company_id}: {label} evidence legal_name does not match selected entity")
        if is_scale and evidence.get("fiscal_period_end") != metric.get("fiscal_year_end"):
            errors.append(f"{company_id}: {label} evidence fiscal period does not match scale period")
        if not re.fullmatch(r"[0-9a-f]{64}", str(evidence.get("content_sha256", ""))):
            errors.append(f"{company_id}: {label} evidence content hash is invalid")
        elif evidence.get("hash_provenance") == "observed_response" and isinstance(source, dict) and evidence.get("content_sha256") != source.get("content_sha256"):
            errors.append(f"{company_id}: {label} evidence content hash does not match observed source")
        parsed = urlparse(str(evidence.get("url", "")))
        source_host = urlparse(str(source.get("url", ""))).hostname if isinstance(source, dict) else None
        if parsed.scheme != "https" or not parsed.hostname or not source_host or not (parsed.hostname == source_host or parsed.hostname.endswith("." + source_host) or source_host.endswith("." + parsed.hostname)):
            errors.append(f"{company_id}: {label} evidence URL does not match official source")
        retrieved = parse_timestamp(evidence.get("retrieved_at"), f"{label} evidence retrieved_at", company_id, errors)
        filing = parse_day(evidence.get("filing_date"), f"{label} evidence filing_date", company_id, errors)
        accepted = parse_timestamp(evidence.get("accepted_at"), f"{label} evidence accepted_at", company_id, errors) if scope == "international" else None
        cutoff = parse_timestamp(protocol.get("cutoff_at"), "cutoff_at", "protocol", errors)
        if scope == "international" and accepted is None:
            errors.append(f"{company_id}: international {label} evidence requires SEC acceptance time")
        if accepted and cutoff and accepted > cutoff:
            errors.append(f"{company_id}: {label} evidence SEC acceptance follows population cutoff")
        if retrieved and retrieved > as_of_end(as_of):
            errors.append(f"{company_id}: {label} evidence retrieved_at is in the future")
        if filing and filing > as_of:
            errors.append(f"{company_id}: {label} evidence filing_date is in the future")
        if is_scale:
            for field, expected_value in (("metric", metric.get("type")), ("value", metric.get("value")), ("currency", metric.get("currency"))):
                if evidence.get(field) != expected_value:
                    errors.append(f"{company_id}: scale evidence {field} does not match scale metric")
        elif not isinstance(evidence.get("employee_count"), int) or evidence.get("employee_count") < 1:
            errors.append(f"{company_id}: employer evidence must show a positive employee count")
    if scope == "international":
        accessions = {company.get("scale_evidence", {}).get("accession"), company.get("employer_evidence", {}).get("accession")}
        for field, label, official_field in (("incorporation_evidence", "incorporation", "countryinc/stprinc"), ("head_office_evidence", "head office", "countryba/stprba")):
            evidence = company.get(field)
            if not isinstance(evidence, dict):
                errors.append(f"{company_id}: missing {field}")
                continue
            required(evidence, ("source_id", "url", "locator", "content_sha256", "retrieved_at", "filing_date", "accepted_at", "accession", "registry_id", "legal_name", "quote", "official_field", "normalized_official_code", "normalized_official_value"), f"{label} evidence", company_id, errors)
            if evidence.get("normalized_official_code") != "US": errors.append(f"{company_id}: {label} evidence normalized official code must be US")
            if evidence.get("official_field") != official_field: errors.append(f"{company_id}: {label} evidence must use SEC {official_field}, not filing venue")
            if evidence.get("registry_id") != company.get("registry_id") or evidence.get("legal_name") != company.get("legal_name"): errors.append(f"{company_id}: {label} evidence identity mismatch")
            if evidence.get("accession") not in accessions or len(accessions) != 1: errors.append(f"{company_id}: {label} evidence accession must bind scale and employee evidence")
            if not re.fullmatch(r"[0-9a-f]{64}", str(evidence.get("content_sha256", ""))): errors.append(f"{company_id}: {label} evidence content hash is invalid")
            source = source_map.get(evidence.get("source_id"), {})
            if evidence.get("content_sha256") != company.get("scale_evidence", {}).get("content_sha256"): errors.append(f"{company_id}: {label} evidence content hash does not match SEC SUB archive")
            if evidence.get("url") != company.get("scale_evidence", {}).get("url") or source.get("source_id") != "us-sec-quarterly-financials": errors.append(f"{company_id}: {label} evidence source is not the bound SEC quarterly archive")
    registered = protocol.get("registered_sources", {}).get(jurisdiction, [])
    pinned_ids = {entry.get("source_id") for entry in registered if isinstance(entry, dict)}
    for source_id in source_ids:
        source = source_map.get(source_id, {})
        if source_id not in pinned_ids or source.get("jurisdiction") != jurisdiction:
            errors.append(f"{company_id}: source {source_id} is not a pinned scale source for jurisdiction {jurisdiction}")
    precedence = protocol.get("source_precedence", [])
    ranks = []
    for source_id in source_ids:
        source = source_map.get(source_id, {})
        if source.get("source_type") not in precedence:
            errors.append(f"{company_id}: scale source violates source precedence")
        else:
            ranks.append(precedence.index(source.get("source_type")) + 1)
    declared_rank = company.get("scale_source_precedence_rank")
    if not ranks or declared_rank != min(ranks):
        errors.append(f"{company_id}: scale_source_precedence_rank does not match selected source type")
    if isinstance(declared_rank, int) and declared_rank > 1:
        availability = company.get("source_availability")
        by_rank = {item.get("precedence_rank"): item for item in availability if isinstance(item, dict)} if isinstance(availability, list) else {}
        if set(by_rank) != set(range(1, declared_rank)):
            errors.append(f"{company_id}: lower-priority scale source requires higher-precedence source availability proof")
        for rank in range(1, declared_rank):
            item = by_rank.get(rank, {})
            checked = set(item.get("checked_source_ids", [])) if isinstance(item.get("checked_source_ids"), list) else set()
            expected_checked = {
                source_id for source_id in pinned_ids
                if source_map.get(source_id, {}).get("source_type") in precedence
                and precedence.index(source_map[source_id]["source_type"]) + 1 == rank
            }
            if item.get("status") != "unavailable" or len(" ".join(str(item.get("reason", "")).split())) < 10 or not expected_checked or checked != expected_checked:
                errors.append(f"{company_id}: higher-precedence proof must name every pinned source for the same jurisdiction and rank")
            if any(source_is_eligible(source_map.get(source_id), metric.get("type", "scale field")) for source_id in checked):
                errors.append(f"{company_id}: higher-precedence source availability references an eligible source")
    owner = company.get("benefit_policy_owner")
    if isinstance(owner, str) and owner != company.get("selected_reporting_legal_entity"):
        contract = company.get("related_company_exception")
        required_contract = ("separate_scale_source_ids", "entity_specific_benefit_source_ids", "no_inheritance")
        if not isinstance(contract, dict) or any(field not in contract for field in required_contract) or contract.get("no_inheritance") is not True:
            errors.append(f"{company_id}: missing related-company exception contract")
        elif not validate_source_use(source_map, contract.get("separate_scale_source_ids", []), metric.get("type", "scale field"), company_id, errors):
            errors.append(f"{company_id}: related-company scale source is not eligible for the metric")
        elif not set(contract.get("separate_scale_source_ids", [])).issubset(set(source_ids)):
            errors.append(f"{company_id}: related-company separate scale sources must be present in actual scale source_ids")


def validate_ledger_records(protocol, records, label, source_map, as_of, errors, exact_count=None, enforce_order=True):
    if exact_count is not None and len(records) != exact_count:
        errors.append(f"{label} must contain exactly {exact_count} records")
    ids = []
    registry = []
    for company in records:
        validate_company(protocol, company, source_map, as_of, errors)
        ids.append(company.get("company_id"))
        registry.append((company.get("jurisdiction"), company.get("registry_id")))
    if len(ids) != len(set(ids)):
        errors.append(f"{label}: duplicate company_id")
    if len(registry) != len(set(registry)):
        errors.append(f"{label}: duplicate jurisdiction/registry_id")
    if enforce_order and records != sorted(records, key=lambda company: canonical_key(protocol, company)):
        errors.append(f"{label}: records are not in canonical order")


def validate_manifest(path, required_paths, root, errors, label, as_of, not_before=None):
    if not path.is_file():
        errors.append(f"missing required {label} manifest: {path}")
        return None
    manifest = read_json(path, errors)
    if not isinstance(manifest, dict):
        return None
    validate_structure(manifest, MANIFEST_SCHEMA, str(path), errors)
    allowed = {"status", "approved_by", "approved_at", "artifacts"} | ({"freeze_manifest_sha256"} if label == "effective" else set())
    for field in set(manifest) - allowed: errors.append(f"{path}: schema additional property {field}")
    if manifest.get("status") != "approved" or not manifest.get("approved_by") or not manifest.get("approved_at"):
        errors.append(f"{path}: {label} manifest is not explicitly approved")
    approved_at = parse_timestamp(manifest.get("approved_at"), "approved_at", str(path), errors)
    if approved_at and approved_at > as_of_end(as_of): errors.append(f"{path}: manifest approved_at is in the future")
    if approved_at and not_before and approved_at < not_before: errors.append(f"{path}: manifest approval predates relevant freeze or event")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, list):
        errors.append(f"{path}: manifest artifacts must be a list")
        return manifest
    entries = {item.get("path"): item for item in artifacts if isinstance(item, dict)}
    if set(entries) != set(required_paths):
        errors.append(f"{path}: manifest artifact set mismatch")
    for relative in required_paths:
        entry = entries.get(relative, {})
        if set(entry) != {"path", "sha256", "count"}: errors.append(f"{path}: manifest artifact schema mismatch for {relative}")
        artifact = root / relative
        if not artifact.is_file():
            errors.append(f"{path}: missing frozen artifact {relative}")
            continue
        data = artifact.read_bytes()
        if entry.get("sha256") != sha256(data):
            errors.append(f"{path}: frozen artifact hash mismatch for {relative}")
        actual_count = 1 if relative.endswith(".json") else len(data.splitlines())
        if entry.get("count") != actual_count:
            errors.append(f"{path}: frozen artifact count mismatch for {relative}")
    return manifest


def validate_population(root, protocol, source_map, as_of, errors, approved_freeze_anchors):
    model = protocol.get("immutable_model", {})
    required_model = ("eligible_ledgers", "selected_ledgers", "initial_effective_ledgers", "effective_ledgers", "event_ledger", "freeze_manifest", "effective_manifest")
    if any(not model.get(field) for field in required_model):
        errors.append("protocol immutable model is incomplete")
        return {}
    expected_paths = {
        "eligible_ledgers": ["population/domestic-eligible.jsonl", "population/international-eligible.jsonl"],
        "selected_ledgers": ["population/domestic-selected.jsonl", "population/international-selected.jsonl"],
        "initial_effective_ledgers": ["population/domestic-initial-effective-selected.jsonl", "population/international-initial-effective-selected.jsonl"],
        "effective_ledgers": ["population/domestic-effective-selected.jsonl", "population/international-effective-selected.jsonl"],
    }
    for field, expected in expected_paths.items():
        if model.get(field) != expected:
            errors.append(f"protocol immutable model {field} mismatch")
    if model.get("event_ledger") != "population/effective-selection-events.jsonl":
        errors.append("protocol immutable model event ledger mismatch")
    if model.get("freeze_manifest") != "population/freeze-manifest.json" or model.get("effective_manifest") != "population/effective-selection-manifest.json":
        errors.append("protocol immutable manifest paths mismatch")

    ledgers = {}
    for scope, index in (("domestic", 0), ("international", 1)):
        for kind, field in (("eligible", "eligible_ledgers"), ("selected", "selected_ledgers"), ("initial", "initial_effective_ledgers"), ("current", "effective_ledgers")):
            relative = expected_paths[field][index]
            ledgers[(scope, kind)] = read_jsonl(root / relative, errors, required_file=True)
        validate_ledger_records(protocol, ledgers[(scope, "eligible")], f"{scope} eligible", source_map, as_of, errors)
        if protocol.get("protocol_id") in {"company-benefits-population-v2", "company-benefits-population-v3"}:
            expected_eligible = 1350 if scope == "domestic" else (1066 if protocol.get("version") == "3.1.1" else 1070)
            if len(ledgers[(scope, "eligible")]) != expected_eligible:
                errors.append(f"{scope} eligible must contain exactly {expected_eligible} verified records")
        for kind in ("selected", "initial", "current"):
            validate_ledger_records(protocol, ledgers[(scope, kind)], f"{scope} {kind}", source_map, as_of, errors, exact_count=1000)
        if ledgers[(scope, "selected")] != ledgers[(scope, "eligible")][:1000]:
            errors.append(f"{scope} selected must be the first 1000 eligible records")
        selected_path = root / expected_paths["selected_ledgers"][index]
        initial_path = root / expected_paths["initial_effective_ledgers"][index]
        if selected_path.is_file() and initial_path.is_file() and selected_path.read_bytes() != initial_path.read_bytes():
            errors.append(f"{scope} initial effective ledger must be byte-identical to selected")

    artifacts = read_jsonl(root / "population/source-artifacts.jsonl", errors, required_file=True)
    artifact_map = {item.get("artifact_id"): item for item in artifacts}
    if len(artifact_map) != len(artifacts):
        errors.append("source-artifact manifest contains duplicate artifact IDs")
    for artifact_id, artifact in artifact_map.items():
        if set(artifact) not in ({"artifact_id", "kind", "url", "sha256"}, {"artifact_id", "kind", "url", "acquisition_url", "sha256"}, {"artifact_id", "kind", "locator", "sha256"}):
            errors.append(f"{artifact_id}: source-artifact manifest schema mismatch")
        if artifact.get("kind") not in {"official_acquisition", "derived"} or not re.fullmatch(r"[0-9a-f]{64}", str(artifact.get("sha256", ""))):
            errors.append(f"{artifact_id}: invalid source-artifact identity")
    manifest_digest = sha256((root / "population/source-artifacts.jsonl").read_bytes()) if (root / "population/source-artifacts.jsonl").is_file() else None
    for source in source_map.values():
        if source.get("hash_provenance") != "artifact_manifest":
            continue
        if source.get("content_sha256") != manifest_digest:
            errors.append(f"{source.get('source_id')}: source registry artifact-manifest hash mismatch")
        for artifact_id in source.get("official_artifact_ids", []):
            if artifact_map.get(artifact_id, {}).get("kind") != "official_acquisition":
                errors.append(f"{source.get('source_id')}: fabricated official artifact identity {artifact_id}")
        for artifact_id in source.get("derived_artifact_ids", []):
            if artifact_map.get(artifact_id, {}).get("kind") != "derived":
                errors.append(f"{source.get('source_id')}: fabricated derived artifact identity {artifact_id}")
    bindings = read_jsonl(root / "population/source-artifact-bindings.jsonl", errors, required_file=True)
    binding_map = {(item.get("company_id"), item.get("kind")): item for item in bindings}
    expected_binding_keys = set()
    for scope in ("domestic", "international"):
        for company in ledgers[(scope, "eligible")]:
            kinds = ("scale", "employer") if scope == "domestic" else ("scale", "employer", "incorporation", "head_office")
            for kind in kinds:
                key = (company.get("company_id"), kind)
                expected_binding_keys.add(key)
                evidence = company.get(f"{kind}_evidence", {})
                expected = {"company_id": company.get("company_id"), "kind": kind, "source_id": evidence.get("source_id"),
                            "url": evidence.get("url"), "locator": evidence.get("locator"),
                            "content_sha256": evidence.get("content_sha256"), "registry_id": evidence.get("registry_id"),
                            "legal_name": evidence.get("legal_name"), "fiscal_period_end": evidence.get("fiscal_period_end")}
                binding = binding_map.get(key, {})
                if any(binding.get(field) != value for field, value in expected.items()):
                    errors.append(f"{company.get('company_id')}: {kind} evidence does not match frozen source-artifact binding")
                official = artifact_map.get(binding.get("official_artifact_id"), {})
                identity = artifact_map.get(binding.get("identity_artifact_id"), {})
                derived = artifact_map.get(binding.get("derived_artifact_id"), {})
                if official.get("kind") != "official_acquisition" or official.get("sha256") != evidence.get("content_sha256") or official.get("url") != evidence.get("url"):
                    errors.append(f"{company.get('company_id')}: {kind} official artifact hash or locator mismatch")
                if identity.get("kind") != "official_acquisition" or derived.get("kind") != "derived":
                    errors.append(f"{company.get('company_id')}: {kind} artifact provenance chain is incomplete")
    if set(binding_map) != expected_binding_keys or len(bindings) != len(binding_map):
        errors.append("source-artifact bindings must cover every eligible company and evidence kind exactly once")

    event_path = root / "population/effective-selection-events.jsonl"
    events = read_jsonl(event_path, errors, required_file=True)
    projected = {scope: list(ledgers[(scope, "selected")]) for scope in ("domestic", "international")}
    ever_used = {scope: {item.get("company_id") for item in projected[scope]} for scope in projected}
    event_ids = set()
    previous_occurred_at = None
    for event in events:
        event_id = event.get("event_id") or "event[missing-id]"
        validate_structure(event, EVENT_SCHEMA, event_id, errors)
        required(event, ("event_id", "protocol_version", "scope", "exclusion_reason", "exclusion_details", "excluded_company_id", "excluded_selection_hash", "excluded_hash_position", "replacement_company_id", "replacement_selection_hash", "previous_effective_sha256", "next_effective_sha256", "occurred_at", "approved_by"), "event", event_id, errors)
        event_fields = {"event_id", "protocol_version", "scope", "exclusion_reason", "exclusion_details", "excluded_company_id", "excluded_selection_hash", "excluded_hash_position", "replacement_company_id", "replacement_selection_hash", "previous_effective_sha256", "next_effective_sha256", "occurred_at", "approved_by"}
        for field in set(event) - event_fields: errors.append(f"{event_id}: schema additional property {field}")
        if event_id in event_ids:
            errors.append(f"duplicate event_id: {event_id}")
        event_ids.add(event_id)
        scope = event.get("scope")
        if scope not in projected:
            errors.append(f"{event_id}: invalid event scope")
            continue
        before = projected[scope]
        occurred_at = parse_timestamp(event.get("occurred_at"), "occurred_at", event_id, errors)
        if occurred_at and occurred_at > as_of_end(as_of): errors.append(f"{event_id}: event occurred_at is in the future")
        if occurred_at and previous_occurred_at and occurred_at <= previous_occurred_at: errors.append(f"{event_id}: events are not strictly ordered")
        if occurred_at: previous_occurred_at = occurred_at
        if len(" ".join(str(event.get("exclusion_details", "")).split())) < 20:
            errors.append(f"{event_id}: meaningful exclusion_details must contain at least 20 normalized characters")
        for hash_field in ("excluded_selection_hash", "replacement_selection_hash", "previous_effective_sha256", "next_effective_sha256"):
            if not re.fullmatch(r"[0-9a-f]{64}", str(event.get(hash_field, ""))):
                errors.append(f"{event_id}: invalid {hash_field}")
        if not isinstance(event.get("excluded_hash_position"), int) or event.get("excluded_hash_position") < 0:
            errors.append(f"{event_id}: invalid excluded_hash_position")
        if event.get("protocol_version") != protocol.get("version"):
            errors.append(f"{event_id}: protocol_version mismatch")
        pinned_reasons = set(protocol.get("canonical_selection", {}).get("exclusion_reason_enum", []))
        if event.get("exclusion_reason") not in pinned_reasons or pinned_reasons != EXCLUSION_REASONS:
            errors.append(f"{event_id}: invalid exclusion_reason")
        if event.get("previous_effective_sha256") != sha256(jsonl_bytes(before)):
            errors.append(f"{event_id}: previous_effective_sha256 mismatch")
        excluded = event.get("excluded_company_id")
        if excluded not in {item.get("company_id") for item in before}:
            errors.append(f"{event_id}: excluded company is not currently effective")
            continue
        excluded_record = next(item for item in before if item.get("company_id") == excluded)
        if event.get("excluded_selection_hash") != excluded_record.get("selection_hash"):
            errors.append(f"{event_id}: excluded_selection_hash mismatch")
        if event.get("excluded_hash_position") != before.index(excluded_record):
            errors.append(f"{event_id}: excluded_hash_position mismatch")
        replacement = next((item for item in ledgers[(scope, "eligible")] if item.get("company_id") not in ever_used[scope]), None)
        if replacement is None or event.get("replacement_company_id") != replacement.get("company_id"):
            errors.append(f"{event_id}: replacement is not the next unused canonical candidate")
            continue
        if event.get("replacement_selection_hash") != replacement.get("selection_hash"):
            errors.append(f"{event_id}: replacement_selection_hash mismatch")
        after = [item for item in before if item.get("company_id") != excluded] + [replacement]
        after.sort(key=lambda company: canonical_key(protocol, company))
        if event.get("next_effective_sha256") != sha256(jsonl_bytes(after)):
            errors.append(f"{event_id}: next_effective_sha256 mismatch")
        projected[scope] = after
        ever_used[scope].add(replacement.get("company_id"))
    for scope in projected:
        current_path = root / f"population/{scope}-effective-selected.jsonl"
        if current_path.is_file() and current_path.read_bytes() != jsonl_bytes(projected[scope]):
            errors.append(f"{scope} current effective ledger does not match event projection")

    effective_required = ["population/domestic-effective-selected.jsonl", "population/international-effective-selected.jsonl", "population/effective-selection-events.jsonl"]
    freeze_required = [
        "population-protocol.json", "population/domestic-eligible.jsonl", "population/international-eligible.jsonl",
        "population/domestic-selected.jsonl", "population/international-selected.jsonl", "population/international-coverage-gaps.json",
        "population/source-artifact-bindings.jsonl", "population/source-artifacts.jsonl",
        "population/independent-sec-workforce-reviews.jsonl", "population/acquisition-audit-manifest.json",
    ]
    protocol_approval = parse_timestamp(protocol.get("approval", {}).get("approved_at"), "approved_at", "protocol", errors)
    freeze_manifest = validate_manifest(root / "population/freeze-manifest.json", freeze_required, root, errors, "freeze", as_of, protocol_approval)
    freeze_path = root / "population/freeze-manifest.json"
    expected_anchor = approved_freeze_anchors.get(protocol.get("version"))
    actual_anchor = sha256(freeze_path.read_bytes()) if freeze_path.is_file() else None
    if approved_freeze_anchors and (not expected_anchor or actual_anchor != expected_anchor):
        errors.append("external freeze-anchor receipt digest mismatch")
    freeze_approval = parse_timestamp(freeze_manifest.get("approved_at"), "approved_at", "freeze manifest", errors) if isinstance(freeze_manifest, dict) else None
    event_boundary = max([value for value in (freeze_approval, previous_occurred_at) if value], default=None)
    effective_manifest = validate_manifest(root / "population/effective-selection-manifest.json", effective_required, root, errors, "effective", as_of, event_boundary)
    if isinstance(effective_manifest, dict) and freeze_path.is_file() and effective_manifest.get("freeze_manifest_sha256") != sha256(freeze_path.read_bytes()):
        errors.append("effective manifest freeze_manifest_sha256 mismatch")
    return projected


def validate_claims(claims, company_map, source_map, as_of, errors):
    claim_ids = set()
    schema = load_schema("benefit-claim.schema.json")
    for index, claim in enumerate(claims, 1):
        claim_id = claim.get("claim_id") or f"claim[{index}]"
        validate_structure(claim, schema, claim_id, errors)
        required(claim, ("claim_id", "company_id", "benefit_name", "detail", "status", "current_validity", "evidence_grade", "source_ids", "application_scope", "checked_at"), "", claim_id, errors)
        if claim_id in claim_ids:
            errors.append(f"duplicate claim_id: {claim_id}")
        claim_ids.add(claim_id)
        company = company_map.get(claim.get("company_id"))
        if company is None:
            errors.append(f"{claim_id}: company is outside current effective selection")
        status = claim.get("status")
        if status not in CLAIM_STATUSES:
            errors.append(f"{claim_id}: invalid status")
        grade = claim.get("evidence_grade")
        source_ids = claim.get("source_ids", []) if isinstance(claim.get("source_ids"), list) else []
        eligible = validate_source_use(source_map, source_ids, "benefit_claim", claim_id, errors, grade_required=True)
        for source_id in source_ids:
            if source_id in source_map and company:
                source_applies_to_company(source_map[source_id], company, claim_id, errors, status)
        required_count = 2 if status == "conflict" else (1 if status in EVIDENCED_STATUSES else 0)
        if len(set(eligible)) < required_count:
            errors.append(f"{claim_id}: {status} requires at least {required_count} eligible claim-field source(s)")
        if status == "unknown":
            if grade != "none" or source_ids:
                errors.append(f"{claim_id}: unknown must be a non-claim without evidence")
            searched = claim.get("searched_source_ids")
            if not searched:
                errors.append(f"{claim_id}: unknown requires searched_source_ids")
            if "없다는 뜻이 아니다" not in claim.get("detail", ""):
                errors.append(f"{claim_id}: unknown wording must not imply absence")
            if claim.get("search_scope") != "benefit_nonclaim":
                errors.append(f"{claim_id}: unknown search_scope must be benefit_nonclaim")
            searched_at = parse_timestamp(claim.get("searched_at"), "searched_at", claim_id, errors)
            if searched_at and searched_at > as_of_end(as_of): errors.append(f"{claim_id}: searched_at is in the future")
            for source_id in searched or []:
                source = source_map.get(source_id)
                if source is None:
                    errors.append(f"{claim_id}: unknown searched source {source_id} does not resolve")
                elif "benefit_claim" not in source.get("supported_fields", []):
                    errors.append(f"{claim_id}: unknown searched source {source_id} does not support benefit_claim")
                elif source.get("source_type") not in OFFICIAL_SOURCE_TYPES or source.get("access_model") not in {"public_keyless", "public_api_key"} or source.get("reuse_decision") not in {"allowed", "allowed_with_attribution"} or not source_applies_to_company(source, company, claim_id, errors, status):
                    errors.append(f"{claim_id}: unknown searched source {source_id} is not official, accessible, or jurisdiction-applicable")
                elif searched_at:
                    source_checked = parse_timestamp(source.get("checked_at"), "source checked_at", source_id, errors)
                    if source_checked and searched_at < source_checked:
                        errors.append(f"{claim_id}: unknown search must follow source checked_at")
        elif status in EVIDENCED_STATUSES:
            required(claim, ("prepublication_checked_at", "source_locator", "supporting_quote", "content_sha256"), "claim", claim_id, errors)
            if grade not in {"A", "B"}:
                errors.append(f"{claim_id}: evidenced claim requires evidence grade A or B")
            if not re.fullmatch(r"[0-9a-f]{64}", str(claim.get("content_sha256", ""))):
                errors.append(f"{claim_id}: invalid content_sha256")
            source_hashes = {source_map.get(source_id, {}).get("content_sha256") for source_id in source_ids}
            if claim.get("content_sha256") not in source_hashes:
                errors.append(f"{claim_id}: claim content_sha256 does not match referenced evidence")
            if not any(
                source_map.get(source_id, {}).get("locator") == claim.get("source_locator")
                and source_map.get(source_id, {}).get("supporting_quote") == claim.get("supporting_quote")
                and source_map.get(source_id, {}).get("content_sha256") == claim.get("content_sha256")
                for source_id in source_ids
            ):
                errors.append(f"{claim_id}: claim locator, quote, and hash do not resolve to one referenced source")
            source_evidence = claim.get("source_evidence")
            evidence_entries = [item for item in source_evidence if isinstance(item, dict)] if isinstance(source_evidence, list) else []
            evidence_ids = [item.get("source_id") for item in evidence_entries]
            if len(evidence_entries) != len(source_ids) or len(set(evidence_ids)) != len(evidence_ids) or set(evidence_ids) != set(source_ids):
                errors.append(f"{claim_id}: source evidence requires exact one-to-one source_ids coverage with no duplicates, omissions, or extras")
            for item in evidence_entries:
                source = source_map.get(item.get("source_id"), {})
                if not item.get("role") or not item.get("proposition") or not (
                    item.get("source_locator") == source.get("locator")
                    and item.get("supporting_quote") == source.get("supporting_quote")
                    and item.get("content_sha256") == source.get("content_sha256")
                    and item.get("role") == source.get("claim_evidence_role")
                    and item.get("proposition") == source.get("claim_evidence_proposition")
                ):
                    errors.append(f"{claim_id}: source evidence tuple must exactly match its source registry row and state a role and proposition")
            parse_timestamp(claim.get("researched_at"), "researched_at", claim_id, errors)
            if status == "conflict":
                conflict = claim.get("conflict_evidence")
                if not isinstance(conflict, list) or {item.get("position") for item in conflict if isinstance(item, dict)} != {"supports", "contradicts"}:
                    errors.append(f"{claim_id}: conflict evidence must record supports and contradicts positions")
                else:
                    entries = [item for item in conflict if isinstance(item, dict)]
                    conflict_ids = [item.get("source_id") for item in entries]
                    propositions = [item.get("proposition") for item in entries]
                    if len(conflict) != 2 or len(set(conflict_ids)) != 2 or set(conflict_ids) != set(source_ids) or len(set(propositions)) != 2:
                        errors.append(f"{claim_id}: conflict evidence must use two distinct sources and propositions")
                    for item in entries:
                        source = source_map.get(item.get("source_id"), {})
                        if not (
                            item.get("source_locator") == source.get("locator")
                            and item.get("supporting_quote") == source.get("supporting_quote")
                            and item.get("content_sha256") == source.get("content_sha256")
                        ):
                            errors.append(f"{claim_id}: conflict evidence locator, quote, and hash must exactly match its bound source record")
                    quotes = {item.get("supporting_quote") for item in entries}
                    hashes = {item.get("content_sha256") for item in entries}
                    if len(quotes) != len(conflict_ids) or len(hashes) != len(conflict_ids):
                        errors.append(f"{claim_id}: duplicate conflict evidence aliases are prohibited")
        app = claim.get("application_scope", {})
        for field in ("countries", "legal_entities", "roles", "employment_types", "tenure_condition"):
            if app.get(field) in (None, "", []):
                errors.append(f"{claim_id}: missing application_scope.{field}")
        reporting_group_limited = status == "limited" and any(
            "application_scope_as_expressly_quoted" in source_map.get(source_id, {}).get("supported_fields", [])
            for source_id in source_ids
        )
        if company and company.get("selected_reporting_legal_entity") not in app.get("legal_entities", []) and not reporting_group_limited:
            errors.append(f"{claim_id}: application_scope must include the selected reporting legal entity")
        published = parse_day(claim.get("publication_date"), "publication_date", claim_id, errors)
        checked = parse_day(claim.get("checked_at"), "checked_at", claim_id, errors)
        prepub_timestamp = parse_timestamp(claim.get("prepublication_checked_at"), "prepublication_checked_at", claim_id, errors) if claim.get("prepublication_checked_at") else None
        prepub = prepub_timestamp.date() if prepub_timestamp else None
        validity = claim.get("current_validity")
        if validity not in {"current", "undated_current", "historical"}:
            errors.append(f"{claim_id}: invalid current_validity")
        if status == "past" and validity != "historical":
            errors.append(f"{claim_id}: past status must be labeled historical")
        if status != "past" and validity == "historical":
            errors.append(f"{claim_id}: historical validity requires past status")
        if published and published > as_of:
            errors.append(f"{claim_id}: future publication date is prohibited")
        if validity == "current" and not published:
            errors.append(f"{claim_id}: current validity requires a date; use undated_current")
        if validity == "current" and published and older_than_months(published, as_of, 24):
            errors.append(f"{claim_id}: current source is older than 24 months")
        if validity == "undated_current" and ("publication_date" not in claim or claim.get("publication_date") is not None):
            errors.append(f"{claim_id}: undated_current requires an explicit null publication date")
        if validity == "undated_current" and (not checked or checked > as_of or (as_of - checked).days > 30):
            errors.append(f"{claim_id}: undated source was not checked within 30 days")
        if checked and checked > as_of:
            errors.append(f"{claim_id}: checked_at is in the future")
        if validity == "historical" and not published:
            errors.append(f"{claim_id}: historical validity requires dated official evidence")
        if status in EVIDENCED_STATUSES and prepub and (prepub > as_of or (as_of - prepub).days > 14):
            errors.append(f"{claim_id}: prepublication check is older than 14 days")
    return claim_ids


def validate_reviews(reviews, claims, source_map, as_of, errors):
    claim_map = {claim.get("claim_id"): claim for claim in claims}
    claim_ids = set(claim_map)
    approved = set()
    review_ids = set()
    schema = load_schema("review.schema.json")
    for index, review in enumerate(reviews, 1):
        review_id = review.get("review_id") or f"review[{index}]"
        validate_structure(review, schema, review_id, errors)
        required(review, ("review_id", "claim_id", "researcher_id", "reviewer_id", "decision", "reviewed_at", "issues", "resolution", "quote_entailment_confirmed"), "review", review_id, errors)
        if review_id in review_ids:
            errors.append(f"duplicate review_id: {review_id}")
        review_ids.add(review_id)
        claim_id = review.get("claim_id")
        claim = claim_map.get(claim_id)
        if claim is None:
            errors.append(f"{review_id}: unknown claim_id")
        reviewed = parse_timestamp(review.get("reviewed_at"), "reviewed_at", review_id, errors)
        if reviewed and reviewed > as_of_end(as_of): errors.append(f"{review_id}: reviewed_at is in the future")
        boundaries = []
        if claim:
            researched = parse_timestamp(claim.get("researched_at"), "researched_at", claim_id, errors)
            if researched: boundaries.append(researched)
            for source_id in claim.get("source_ids", []):
                source_checked = parse_timestamp(source_map.get(source_id, {}).get("checked_at"), "source checked_at", source_id, errors)
                if source_checked: boundaries.append(source_checked)
            observed = any(source_map.get(source_id, {}).get("hash_provenance") == "observed_response" for source_id in claim.get("source_ids", []))
            if observed and review.get("quote_entailment_confirmed") is not True:
                errors.append(f"{review_id}: independent review must confirm quote entailment for observed-response evidence")
            if claim.get("status") in EVIDENCED_STATUSES:
                expected_entries = [item for item in claim.get("source_evidence", []) if isinstance(item, dict)]
                reviewed_source_entries = [item for item in review.get("source_entailment_reviews", []) if isinstance(item, dict)]
                expected = {
                    (
                        item.get("source_id"), item.get("role"), item.get("proposition"),
                        item.get("source_locator"), item.get("supporting_quote"), item.get("content_sha256"),
                    )
                    for item in expected_entries
                }
                actual = {
                    (
                        item.get("source_id"), item.get("reviewed_role"), item.get("reviewed_proposition"),
                        item.get("source_locator"), item.get("reviewed_quote"), item.get("content_sha256"),
                    )
                    for item in reviewed_source_entries
                    if item.get("entailment_confirmed") is True
                }
                if any(item.get("reviewer_id") != review.get("reviewer_id") for item in reviewed_source_entries):
                    errors.append(f"{review_id}: source entailment reviewer_id must exactly match review reviewer_id")
                if len(reviewed_source_entries) != len(expected_entries) or len(actual) != len(reviewed_source_entries) or actual != expected:
                    errors.append(f"{review_id}: independent review requires exact one-to-one source evidence entailment coverage with no duplicates")
            prepub = parse_timestamp(claim.get("prepublication_checked_at"), "prepublication_checked_at", claim_id, errors) if claim.get("prepublication_checked_at") else None
            if reviewed and prepub and prepub < reviewed:
                errors.append(f"{review_id}: prepublication check must follow independent review")
            if claim.get("status") == "conflict":
                determination = review.get("conflict_determination")
                if determination != "unresolved":
                    errors.append(f"{review_id}: conflict status requires an explicit unresolved conflict determination")
                if review.get("conflict_opposition_confirmed") is not True:
                    errors.append(f"{review_id}: reviewer must explicitly attest that the bound conflict propositions oppose each other")
                side_reviews = review.get("conflict_side_entailments")
                expected = {
                    (
                        item.get("source_id"), item.get("position"), item.get("proposition"),
                        item.get("source_locator"), item.get("supporting_quote"), item.get("content_sha256"),
                    )
                    for item in claim.get("conflict_evidence", []) if isinstance(item, dict)
                }
                reviewed_entries = [item for item in side_reviews if isinstance(item, dict)] if isinstance(side_reviews, list) else []
                actual = {
                    (
                        item.get("source_id"), item.get("position"), item.get("reviewed_proposition"),
                        item.get("source_locator"), item.get("reviewed_quote"), item.get("content_sha256"),
                    )
                    for item in reviewed_entries
                    if item.get("entailment_confirmed") is True and item.get("reviewer_id") == review.get("reviewer_id")
                }
                if len(reviewed_entries) != len(expected) or len(actual) != len(reviewed_entries) or actual != expected:
                    errors.append(f"{review_id}: independent review requires complete one-to-one conflict-side entailment coverage with no duplicates")
                if review.get("unresolved_conflict_wording_approved") is not True:
                    errors.append(f"{review_id}: unresolved conflict wording requires explicit approval")
            elif review.get("conflict_determination") == "unresolved":
                errors.append(f"{review_id}: unresolved conflict determination requires conflict claim status")
        if reviewed and boundaries and reviewed < max(boundaries):
            errors.append(f"{review_id}: review must follow source checked_at and claim research timestamp")
        if review.get("researcher_id") == review.get("reviewer_id"):
            errors.append(f"{review_id}: review self-approval is prohibited")
        elif review.get("decision") == "approved" and claim_id in claim_ids:
            approved.add(claim_id)
    for claim_id in claim_ids - approved:
        errors.append(f"{claim_id}: missing approved independent review")
    return approved


def validate_related_entity_exceptions(companies, claims, approved_claim_ids, source_map, errors):
    claims_by_company = {}
    for claim in claims:
        if claim.get("claim_id") in approved_claim_ids:
            claims_by_company.setdefault(claim.get("company_id"), []).append(claim)
    for company in companies:
        contract = company.get("related_company_exception")
        if not isinstance(contract, dict):
            continue
        company_id = company.get("company_id") or "company[missing-id]"
        declared = set(contract.get("entity_specific_benefit_source_ids", []))
        referenced = {
            source_id
            for claim in claims_by_company.get(company_id, [])
            for source_id in claim.get("source_ids", [])
            if source_is_eligible(source_map.get(source_id), "benefit_claim", grade_required=True)
        }
        if not declared or not declared.issubset(referenced):
            errors.append(f"{company_id}: related-company benefit sources must be eligible and referenced by an approved entity claim")
        selected_entity = company.get("selected_reporting_legal_entity")
        for source_id in declared:
            source = source_map.get(source_id, {})
            applicable = source.get("applicable_legal_entities", [])
            if selected_entity not in applicable or source.get("policy_owner_legal_entity") != company.get("benefit_policy_owner"):
                errors.append(f"{company_id}: related-company source policy owner/applicability does not include selected reporting legal entity")


def validate_pilot_package(root, claims, reviews, source_map, projected, as_of, errors):
    pilot_files = (root / "pilot-prepublication-checks.jsonl", root / "pilot-research-gaps.jsonl")
    present = [path.exists() for path in pilot_files]
    if not claims:
        return
    if len(claims) == 199 and not all(present):
        errors.append("populated pilot package is missing required prepublication or gap audit artifact")
        return
    if not any(present):
        return
    if not all(present):
        errors.append("pilot package artifacts must be present as a complete pair")
        return
    if len(claims) != 199 or len(reviews) != 199 or len({item.get("company_id") for item in claims}) != 48:
        errors.append("pilot package must contain exactly 199 claims, 199 reviews, and 48 claiming companies")
    allowed = {
        item.get("company_id")
        for scope in ("domestic", "international")
        for item in projected.get(scope, [])[:25]
    }
    if {item.get("company_id") for item in claims} - allowed:
        errors.append("pilot claims must belong to the first 25 effective companies in each scope")
    used_sources = {
        source_id
        for claim in claims
        for source_id in claim.get("source_ids", []) + claim.get("searched_source_ids", [])
    }
    for source_id in used_sources:
        source = source_map.get(source_id, {})
        if source.get("hash_provenance") != "observed_response" or "evidence_path" in source or "evidence_file" in source:
            errors.append(f"{source_id}: pilot packaging must retain metadata only with observed_response provenance")
    checks = read_jsonl(root / "pilot-prepublication-checks.jsonl", errors, required_file=True)
    check_map = {item.get("url"): item for item in checks}
    expected_urls = {source_map.get(source_id, {}).get("url") for source_id in used_sources}
    if len(check_map) != len(checks) or set(check_map) != expected_urls:
        errors.append("pilot prepublication checks must contain one record per unique used official URL")
    review_map = {item.get("claim_id"): item for item in reviews}
    for url, check in check_map.items():
        checked = parse_timestamp(check.get("checked_at"), "checked_at", f"prepublication {url}", errors)
        if checked and checked > as_of_end(as_of): errors.append(f"prepublication {url}: checked_at is in the future")
        if check.get("status") != 200 or check.get("marker_confirmed") is not True or not check.get("marker"):
            errors.append(f"prepublication {url}: current official URL or marker check failed")
        if not re.fullmatch(r"[0-9a-f]{64}", str(check.get("content_sha256", ""))):
            errors.append(f"prepublication {url}: invalid content hash")
        final_host = urlparse(str(check.get("final_url", ""))).hostname
        original_host = urlparse(str(url)).hostname
        owner_hosts = {str(source.get("final_owner_domain", "")).casefold().removeprefix("www.") for source in source_map.values() if source.get("url") == url}
        normalized_final = str(final_host or "").casefold().removeprefix("www.")
        if urlparse(str(check.get("final_url", ""))).scheme != "https":
            errors.append(f"prepublication {url}: final URL must use HTTPS")
        if not normalized_final or normalized_final not in ({str(original_host or '').casefold().removeprefix('www.')} | owner_hosts):
            errors.append(f"prepublication {url}: final destination is outside the approved official domain")
    for claim in claims:
        claim_checks = [check_map.get(source_map.get(source_id, {}).get("url"), {}) for source_id in claim.get("source_ids", []) + claim.get("searched_source_ids", [])]
        timestamps = [parse_timestamp(item.get("checked_at"), "checked_at", claim.get("claim_id"), errors) for item in claim_checks]
        timestamps = [item for item in timestamps if item]
        reviewed = parse_timestamp(review_map.get(claim.get("claim_id"), {}).get("reviewed_at"), "reviewed_at", claim.get("claim_id"), errors)
        prepub = parse_timestamp(claim.get("prepublication_checked_at"), "prepublication_checked_at", claim.get("claim_id"), errors)
        if not timestamps or not reviewed or min(timestamps) <= reviewed or not prepub or prepub != max(timestamps):
            errors.append(f"{claim.get('claim_id')}: prepublication chronology or URL binding mismatch")
    gaps = read_jsonl(root / "pilot-research-gaps.jsonl", errors, required_file=True)
    company_gaps = [item for item in gaps if str(item.get("audit_id", "")).startswith("company-gap::")]
    omitted = [item for item in gaps if str(item.get("audit_id", "")).startswith("omitted::")]
    expected_gap_companies = allowed - {item.get("company_id") for item in claims}
    omitted_ids = [item.get("original_claim_id") for item in omitted]
    if (len(gaps) != 99 or len(company_gaps) != 2 or len(omitted) != 97
            or {item.get("company_id") for item in company_gaps} != expected_gap_companies
            or len(set(omitted_ids)) != 97 or set(omitted_ids) & {item.get("claim_id") for item in claims}
            or any("복지가 없다는 뜻이 아닙니다" not in item.get("nonabsence_wording", "") for item in gaps)):
        errors.append("pilot gap audit must preserve 97 unique omitted originals, the exact 2 no-claim companies, and non-absence wording")


def validate_corrections(corrections, claim_ids, as_of, errors):
    seen = set()
    schema = load_schema("correction.schema.json")
    for index, correction in enumerate(corrections, 1):
        correction_id = correction.get("correction_id") or f"correction[{index}]"
        validate_structure(correction, schema, correction_id, errors)
        required(correction, ("correction_id", "claim_id", "status", "received_at", "official_source_ids", "decision", "decided_by", "decided_at"), "correction", correction_id, errors)
        if correction_id in seen:
            errors.append(f"duplicate correction_id: {correction_id}")
        seen.add(correction_id)
        if correction.get("claim_id") not in claim_ids:
            errors.append(f"{correction_id}: unknown claim_id")
        received = parse_timestamp(correction.get("received_at"), "received_at", correction_id, errors)
        decided = parse_timestamp(correction.get("decided_at"), "decided_at", correction_id, errors)
        if received and received > as_of_end(as_of) or decided and decided > as_of_end(as_of): errors.append(f"{correction_id}: correction timestamp is in the future")
        if received and decided and decided < received: errors.append(f"{correction_id}: decided_at precedes received_at")


def validate_ranking_language(root, errors):
    for path in sorted(root.rglob("*.md")):
        if path.name in {"methodology.md", "population-protocol.md"}:
            continue
        text = path.read_text(encoding="utf-8")
        if any(pattern.search(text) for pattern in RANKING_PATTERNS):
            errors.append(f"{path}: prohibited ranking language")


def validate_coverage_gaps(root, errors):
    path = root / "population" / "international-coverage-gaps.json"
    value = read_json(path, errors) if path.is_file() else None
    if not isinstance(value, dict):
        errors.append("missing structured international coverage-gap artifact")
        return
    selected = value.get("selected_population", {})
    if value.get("panel") != PANEL or selected != {"jurisdiction": "US", "count": 1000, "source": "strict US-incorporated and US principal-business-address SEC 10-K filers"}:
        errors.append("international coverage-gap artifact must identify the fixed panel and US-only selected population")
    gaps = value.get("coverage_gaps")
    expected = [country for country in PANEL if country != "US"]
    if not isinstance(gaps, list) or [item.get("jurisdiction") for item in gaps if isinstance(item, dict)] != expected:
        errors.append("international coverage-gap artifact must enumerate all 17 uncovered jurisdictions in panel order")
    elif any(item != {"jurisdiction": country, "status": "not_materialized", "selected_count": 0} for item, country in zip(gaps, expected)):
        errors.append("international coverage-gap artifact contains an invalid gap record")
    statement = str(value.get("representativeness", "")).casefold()
    if "not globally representative" not in statement or "not all sec filers" not in statement or "not a source rank" not in statement:
        errors.append("international coverage-gap artifact must disclaim global representativeness and source rank")


def external_freeze_anchor(path, protocol, errors, workspace_root=None):
    if path is None:
        errors.append("external freeze-anchor receipt is required")
        return {}
    receipt_path = Path(path)
    if workspace_root is not None:
        workspace = Path(workspace_root).resolve()
        repository = REPOSITORY_ROOT.resolve()
        lexical_path = Path(os.path.abspath(receipt_path))
        resolved_path = receipt_path.resolve()
        if lexical_path.is_relative_to(workspace) or resolved_path.is_relative_to(workspace):
            errors.append("external freeze-anchor receipt must be outside the verified workspace")
            return {}
        if lexical_path.is_relative_to(repository) or resolved_path.is_relative_to(repository):
            errors.append("external freeze-anchor receipt must be outside the repository")
            return {}
    receipt = read_json(receipt_path, errors)
    required_fields = {"schema_version", "protocol_version", "freeze_manifest_sha256", "review_status", "issued_at"}
    if not isinstance(receipt, dict) or set(receipt) != required_fields:
        errors.append("external freeze-anchor receipt schema mismatch")
        return {}
    if receipt.get("schema_version") != "1" or receipt.get("protocol_version") != protocol.get("version"):
        errors.append("external freeze-anchor receipt protocol identity mismatch")
    if receipt.get("review_status") != "approved":
        errors.append("external freeze-anchor receipt is not approved")
        return {}
    parse_timestamp(receipt.get("issued_at"), "issued_at", "freeze-anchor receipt", errors)
    digest = receipt.get("freeze_manifest_sha256")
    if not re.fullmatch(r"[0-9a-f]{64}", str(digest)):
        errors.append("external freeze-anchor receipt digest is invalid")
        return {}
    return {protocol.get("version"): digest}


def verify_workspace(root, as_of=None, evidence_root=None, freeze_anchor_receipt=None, approved_freeze_anchors=None):
    root = Path(root)
    as_of = as_of or date.today()
    errors = []
    protocol_path = find_file(root, "population-protocol.json")
    protocol = read_json(protocol_path, errors) if protocol_path.is_file() else None
    if not isinstance(protocol, dict):
        errors.append("missing population protocol")
        return errors
    if approved_freeze_anchors is None:
        approved_freeze_anchors = external_freeze_anchor(freeze_anchor_receipt, protocol, errors, root)
    if protocol.get('protocol_id') == 'company-benefits-population-v3':
        spec = importlib.util.spec_from_file_location('sec_workforce_audit', Path(__file__).with_name('sec-workforce-audit.py'))
        audit = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(audit)
        try:
            audit.validate(root)
        except (ValueError, KeyError, OSError, TypeError) as exc:
            errors.append(f'SEC workforce audit: {exc}')
    status = protocol.get("status")
    if status != "approved":
        errors.append(f"protocol status is {status or 'missing'}; approved protocol required")
        for name in PROHIBITED_POPULATION_FILES:
            for path in root.rglob(name):
                errors.append(f"prohibited population artifact while protocol is blocked: {path}")
        validate_ranking_language(root, errors)
        return errors
    approval = protocol.get("approval")
    if not isinstance(approval, dict) or not approval.get("approved_by") or not approval.get("approved_at"):
        errors.append("approved protocol is missing explicit approval")
    else:
        approved_at = parse_timestamp(approval.get("approved_at"), "approved_at", "protocol", errors)
        if approved_at and approved_at > as_of_end(as_of): errors.append("protocol approved_at is in the future")

    source_path = find_file(root, "source-registry.jsonl")
    sources = read_jsonl(source_path, errors, required_file=True)
    source_map = validate_sources(sources, errors, as_of, evidence_root)
    try:
        validate_protocol(protocol, source_map, errors)
    except ValueError as exc:
        errors.append(str(exc))
        return errors
    projected = validate_population(root, protocol, source_map, as_of, errors, approved_freeze_anchors)
    validate_coverage_gaps(root, errors)

    companies = read_jsonl(find_file(root, "companies.jsonl"), errors, required_file=True)
    effective = projected.get("domestic", []) + projected.get("international", [])
    validate_ledger_records(protocol, companies, "companies", source_map, as_of, errors, exact_count=2000, enforce_order=False)
    effective_map = {company.get("company_id"): company for company in effective}
    company_map = {company.get("company_id"): company for company in companies}
    if set(company_map) != set(effective_map) or any(company_map.get(company_id) != record for company_id, record in effective_map.items()):
        errors.append("companies ledger must exactly match current effective selection")

    claims = read_jsonl(find_file(root, "benefit-claims.jsonl"), errors, required_file=True)
    reviews = read_jsonl(find_file(root, "reviews.jsonl"), errors, required_file=True)
    corrections = read_jsonl(find_file(root, "corrections.jsonl"), errors, required_file=True)
    claim_ids = validate_claims(claims, company_map, source_map, as_of, errors)
    approved_claim_ids = validate_reviews(reviews, claims, source_map, as_of, errors)
    validate_related_entity_exceptions(companies, claims, approved_claim_ids, source_map, errors)
    validate_pilot_package(root, claims, reviews, source_map, projected, as_of, errors)
    validate_corrections(corrections, claim_ids, as_of, errors)
    validate_ranking_language(root, errors)
    return errors


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", default="docs/research/company-benefits")
    parser.add_argument("--as-of", type=date.fromisoformat)
    parser.add_argument("--evidence-root", type=Path)
    parser.add_argument("--freeze-anchor-receipt", type=Path, default=os.environ.get("COMPANY_BENEFITS_FREEZE_ANCHOR_RECEIPT"))
    args = parser.parse_args(argv)
    errors = verify_workspace(Path(args.root), args.as_of, args.evidence_root, args.freeze_anchor_receipt)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print("company-benefits ledger verification passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
