#!/usr/bin/env python3
"""Build a separate, audit-only lead index; this is not an approval or release tool."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import unicodedata
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
BASE = Path("community-app/public/data/company-benefits")
REGISTRY = Path("docs/research/company-benefits/source-registry.jsonl")
OUTPUT = BASE / "research-leads-v1"
FIELDS = {"company_id", "primary_category", "benefit_action", "source_url",
          "source_registry_id", "scope", "currentness", "observed_at",
          "limitations", "status", "source_text_sha256"}
SCOPE_FIELDS = {"legal_entity", "roles", "employment_types", "conditions"}
CONDITION_KEYS = {"occasion", "education_level", "covered_persons", "purpose",
                  "residence", "tenure", "price"}
HEX = re.compile(r"[0-9a-f]{64}\Z")
TIME = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)\Z")
MAX_INPUT = 1_000_000


def require(ok, message):
    if not ok:
        raise ValueError(message)


def fixed_file(root, relative, limit):
    """Read only pinned paths without following any linked component."""
    path = root
    for piece in relative.parts:
        require(piece not in (".", "..", "") and not path.is_symlink(), "linked path")
        path = path / piece
        require(not path.is_symlink(), "linked path")
    info = path.stat()
    require(stat.S_ISREG(info.st_mode) and info.st_size <= limit, "invalid file size/type")
    with path.open("rb") as handle:
        data = handle.read(limit + 1)
    require(len(data) <= limit, "oversized file")
    return data


def parse_json(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "duplicate JSON key")
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique)


def safe_url(value):
    require(isinstance(value, str) and value.startswith("https://") and len(value) <= 2048, "HTTPS URL required")
    authority = value[8:].split("/", 1)[0].split("?", 1)[0].split("#", 1)[0]
    require(authority and not any(c in authority for c in "%@\\[]") and
            not any(ord(c) < 33 or ord(c) > 126 for c in authority), "unsafe authority")
    try:
        url = urlsplit(value)
        port = url.port
    except ValueError as exc:
        raise ValueError("malformed URL") from exc
    require(not any(re.fullmatch(r"(?:api[_-]?key|access[_-]?token|token|secret|password|passwd|session|auth|signature|sig|code)",
                                 unquote(part.split("=", 1)[0]), re.I)
                    for part in url.query.split("&") if "=" in part), "credential query")
    require(url.scheme == "https" and url.hostname and url.username is None and
            url.password is None and port in (None, 443) and not url.fragment and
            re.fullmatch(r"[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+", url.hostname) and
            all(part and not part.startswith("-") and not part.endswith("-") for part in url.hostname.split(".")) and
            not any(ord(c) < 32 or ord(c) == 127 for c in value), "unsafe URL")


def text(value, max_length):
    require(isinstance(value, str) and 0 < len(value.strip()) <= max_length and
            value == value.strip() and not any(ord(c) < 32 or ord(c) == 127 for c in value), "invalid short text")


def bounded_text_field(value, max_length, allow_empty=False):
    if type(value) is list:
        require((allow_empty or len(value) > 0) and len(value) <= 8, "invalid scope list count")
        for item in value:
            text(item, max_length)
    else:
        text(value, max_length)


def canonical(data):
    return (json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def build_artifacts(input_bytes, root=ROOT):
    require(isinstance(input_bytes, bytes) and 0 < len(input_bytes) <= MAX_INPUT, "invalid input size")
    base_bytes = fixed_file(root, BASE / "manifest.json", 2_000_000)
    base = parse_json(base_bytes)
    require(base.get("company_count") == 2000 and len(base.get("listing_chunks", [])) == 40 and
            len(base.get("company_shards", {})) == 2000, "not frozen population")
    data_version = base["data_version"]
    require(re.fullmatch(r"company-benefits-[0-9-]+-v1", data_version), "unexpected base version")
    companies = {}
    for index, chunk in enumerate(base["listing_chunks"], 1):
        expected = f"community/data/company-benefits/{data_version}/listings/companies-{index:02d}.json"
        require(chunk["url"] == expected, "unexpected listing path")
        raw = fixed_file(root, BASE / data_version / "listings" / f"companies-{index:02d}.json", 500_000)
        require(hashlib.sha256(raw).hexdigest() == chunk["sha256"] and len(raw) == chunk["byte_count"], "listing integrity")
        listing = parse_json(raw)["companies"]
        require(len(listing) == chunk["record_count"], "listing count")
        for company in listing:
            cid = company["company_id"]
            require(cid not in companies and cid in base["company_shards"], "listing identity")
            companies[cid] = company["legal_name"]
    require(len(companies) == 2000, "incomplete company listing")
    taxonomy_raw = fixed_file(root, BASE / data_version / "taxonomy.json", 200_000)
    require(hashlib.sha256(taxonomy_raw).hexdigest() == base["taxonomy"]["sha256"], "taxonomy integrity")
    categories = {c["id"] for c in parse_json(taxonomy_raw)["categories"]}
    registry_raw = fixed_file(root, REGISTRY, 5_000_000)
    registry = {}
    for line in registry_raw.splitlines():
        record = parse_json(line)
        rid = record["source_id"]
        require(rid not in registry, "duplicate registry ID")
        registry[rid] = record
    rows = []
    seen = set()
    for line in input_bytes.splitlines():
        require(bool(line) and len(line) <= 4096, "invalid JSONL row")
        row = parse_json(line)
        require(isinstance(row, dict) and set(row) == FIELDS, "unexpected or missing lead field")
        require(row["status"] == "research_only" and type(row["company_id"]) is str and
                row["company_id"] in companies and type(row["primary_category"]) is str and
                row["primary_category"] in categories, "unapproved lead identity/status/category")
        scope = row["scope"]
        require(isinstance(scope, dict) and set(scope) == SCOPE_FIELDS and
                scope["legal_entity"] == companies[row["company_id"]], "legal entity mismatch")
        for key in ("roles", "employment_types"):
            bounded_text_field(scope[key], 160)
        conditions = scope["conditions"]
        if type(conditions) is dict:
            require(len(conditions) <= 8, "too many conditions")
            for key, value in conditions.items():
                require(key in CONDITION_KEYS, "unknown condition key")
                text(value, 160)
        else:
            bounded_text_field(conditions, 160, allow_empty=True)
        for key, cap in (("benefit_action", 300), ("currentness", 80)):
            text(row[key], cap)
        limitations = row["limitations"]
        if type(limitations) is list:
            require(0 < len(limitations) <= 8, "invalid limitations count")
            for item in limitations:
                text(item, 240)
        else:
            text(limitations, 240)
        require(type(row["observed_at"]) is str and TIME.fullmatch(row["observed_at"]), "invalid observation time")
        require(type(row["source_text_sha256"]) is str and HEX.fullmatch(row["source_text_sha256"]), "invalid text digest")
        safe_url(row["source_url"])
        require(type(row["source_registry_id"]) is str and row["source_registry_id"] in registry, "unknown registry ID")
        source = registry[row["source_registry_id"]]
        require(source.get("url") == row["source_url"] and
                source.get("policy_owner_legal_entity") == scope["legal_entity"] and
                scope["legal_entity"] in source.get("applicable_legal_entities", []) and
                source.get("claim_evidence_role", "").startswith("primary_claim") and
                "benefit_claim" in source.get("supported_fields", []) and
                source.get("reuse_decision") == "allowed_with_attribution" and
                source.get("decisions", {}).get("extract") == "allowed" and
                source.get("decisions", {}).get("attribution") == "required", "source lacks claim-specific rights")
        action_key = unicodedata.normalize("NFKC", " ".join(row["benefit_action"].split())).casefold()
        identity = (row["company_id"], action_key)
        require(identity not in seen, "duplicate atomic action")
        seen.add(identity)
        rows.append(row)
        require(len(rows) <= 1000, "too many leads")
    require(bool(rows), "empty leads")
    rows.sort(key=lambda row: (row["company_id"], row["primary_category"], unicodedata.normalize("NFKC", row["benefit_action"])))
    payload = canonical({"artifact_kind": "company_benefits_research_leads", "schema_version": 1,
                         "status": "research_only", "leads": rows})
    manifest = canonical({"artifact_kind": "company_benefits_research_manifest", "schema_version": 1,
                          "status": "research_only", "base_manifest_sha256": hashlib.sha256(base_bytes).hexdigest(),
                          "leads_sha256": hashlib.sha256(payload).hexdigest(),
                          "leads_byte_count": len(payload), "record_count": len(rows),
                          "company_count": len({r["company_id"] for r in rows})})
    return manifest, payload


def write_artifacts(directory, manifest, payload):
    """Stage both files; restore prior bytes if an ordinary replacement fails."""
    names = ("manifest.json", "leads.json")
    temps = [directory / (name + ".tmp") for name in names]
    rollback = directory / "manifest.json.rollback.tmp"
    owned = (*temps, rollback)
    for temp in owned:
        require(not temp.is_symlink(), "linked temporary file")
        if temp.exists():
            require(stat.S_ISREG(temp.stat().st_mode), "invalid temporary file")
            temp.unlink()  # stale generator-owned regular file from an interrupted run
    previous = {}
    for name in names:
        target = directory / name
        require(not target.is_symlink(), "linked output file")
        previous[name] = fixed_file(ROOT, OUTPUT / name, MAX_INPUT + 100_000) if target.exists() else None
    committed = []
    try:
        for temp, content in zip(temps, (manifest, payload)):
            with temp.open("xb") as handle:
                handle.write(content)
        for name, temp in zip(names, temps):
            os.replace(temp, directory / name)
            committed.append(name)
    except Exception:
        for name in reversed(committed):
            old = previous[name]
            target = directory / name
            if old is None:
                target.unlink()
            else:
                with rollback.open("xb") as handle:
                    handle.write(old)
                os.replace(rollback, target)
        raise
    finally:
        for temp in owned:
            if temp.is_file() and not temp.is_symlink():
                temp.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="sanitized public research-only JSONL")
    parser.add_argument("--check", action="store_true", help="compare outputs without writes")
    args = parser.parse_args()
    try:
        path = args.input.absolute()
        require(not any(parent.is_symlink() for parent in (path, *path.parents)) and
                path.is_file() and path.stat().st_size <= MAX_INPUT, "linked or invalid input file")
        with path.open("rb") as handle:
            raw = handle.read(MAX_INPUT + 1)
        manifest, payload = build_artifacts(raw)
        directory = ROOT / OUTPUT
        require(not directory.is_symlink() and not (ROOT / BASE).is_symlink(), "linked output directory")
        if args.check:
            for name, expected in (("manifest.json", manifest), ("leads.json", payload)):
                require((directory / name).exists(), f"stale {name}")
                require(fixed_file(ROOT, OUTPUT / name, MAX_INPUT + 100_000) == expected, f"stale {name}")
        else:
            directory.mkdir(exist_ok=True)
            write_artifacts(directory, manifest, payload)
        return 0
    except (ValueError, OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
        print(f"research artifact rejected: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
