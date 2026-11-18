#!/usr/bin/env python3
"""Rebuild an audit-only, raw-free lead inventory; never an approval input."""
import argparse
import collections
import hashlib
import json
from pathlib import Path

LANES = {
    "domestic-01-a": ("candidates.jsonl", 19, "domestic-independent-review.json"),
    "domestic-31-b": ("candidates.jsonl", 58, "domestic-independent-review.json"),
    "domestic-01-b": ("candidates.jsonl", 29, "domestic-second-review.json"),
    "domestic-31-c": ("candidates.jsonl", 25, "domestic-second-review.json"),
    "international-01-a": ("candidates.jsonl", 21, "international-independent-review.json"),
    "international-31-b": ("candidates.jsonl", 46, "international-independent-review.json"),
    "international-01-b": ("candidates.jsonl", 43, "international-second-review.json"),
    "domestic-02-a": ("candidates.jsonl", 56, "domestic-02-independent-review.json"),
    "domestic-03-a": ("candidates.jsonl", 43, "domestic-03-independent-review.json"),
    "retention-allowed-cosmo-pilot": ("candidates.jsonl", 25, "cosmo-independent-review.json"),
    "allowed-priority-a": ("hmm.candidates.jsonl", 44, "hmm-independent-review.json"),
    "allowed-priority-b": ("candidates.jsonl", 20, "unisem-independent-review.json"),
}
# Explicit, narrow projection of heterogeneous producer rows; never copy entire records.
PROPOSITION = {"domestic-01-a": "proposition", "domestic-01-b": "statement",
               "domestic-31-b": "statement", "domestic-31-c": "benefit",
               "international-01-a": "proposition", "international-01-b": "proposition",
               "international-31-b": "title", "domestic-02-a": "benefit",
               "domestic-03-a": "proposition", "retention-allowed-cosmo-pilot": "statement",
               "allowed-priority-a": "proposition_ko", "allowed-priority-b": "proposition"}
CATEGORY = {"domestic-01-a": "category_id", "domestic-01-b": "category_id",
            "domestic-31-b": "category_id", "domestic-31-c": "category_id",
            "international-01-a": "category_id", "international-01-b": "primary_category",
            "international-31-b": "primary_category_id", "domestic-02-a": "primary_category",
            "domestic-03-a": "category_id", "retention-allowed-cosmo-pilot": "category_id"}
QUOTE = {"domestic-01-a": "verbatim_quote", "domestic-01-b": "quote",
         "domestic-31-b": "verbatim_quote", "domestic-31-c": "quote",
         "international-01-a": "quote", "international-01-b": "verbatim_quote",
         "international-31-b": "verbatim_quote", "domestic-02-a": "quote",
         "domestic-03-a": "supporting_quote", "allowed-priority-a": "quote",
         "allowed-priority-b": "quote"}
HASH = {"domestic-01-a": "raw_body_sha256", "domestic-31-b": "raw_content_sha256",
        "domestic-31-c": "source_body_sha256", "international-01-a": "source_sha256",
        "international-01-b": "source_body_sha256", "international-31-b": "body_sha256",
        "domestic-02-a": "body_sha256", "allowed-priority-a": "capture_sha256",
        "allowed-priority-b": "raw_body_sha256"}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def rows(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def manifest_check(folder, tombstones):
    path = folder / "SHA256SUMS"
    if not path.exists():
        return "absent"
    absent = 0
    for line in path.read_text().splitlines():
        expected, relative = line.split("  ", 1)
        relative = relative.lstrip("*")
        if Path(relative).is_absolute() or ".." in Path(relative).parts:
            raise ValueError(f"unsafe manifest entry: {folder.name}/{relative}")
        target = folder / relative
        if not target.exists():
            if tombstones.get(f"{folder.name}/{relative}") != expected:
                raise ValueError(f"unexplained missing manifest entry: {folder.name}/{relative}")
            absent += 1
            continue
        if not target.is_file() or target.is_symlink() or digest(target.read_bytes()) != expected:
            raise ValueError(f"manifest mismatch: {folder.name}/{relative}")
    return f"verified_present_entries;deleted_tombstoned_entries={absent}"


def review_index(root):
    index = {}
    for name in sorted({v[2] for v in LANES.values()}):
        doc = json.loads((root / name).read_text())
        decisions = doc.get("decisions", doc.get("review", doc.get("rows")))
        if not isinstance(decisions, list):
            raise ValueError(f"review shape: {name}")
        expected = sum(count for _, count, review_name in LANES.values() if review_name == name)
        if len(decisions) != expected:
            raise ValueError(f"review inventory: {name}: {len(decisions)} != {expected}")
        index[name] = decisions
    return index


def decision_for(lane, number, row, reviews):
    name = LANES[lane][2]
    candidates = reviews[name]
    if name in ("domestic-independent-review.json", "domestic-second-review.json"):
        matches = [d for d in candidates if d["bundle"] == lane and d["row_number"] == number]
    elif name == "domestic-02-independent-review.json":
        matches = [d for d in candidates if d["line"] == number]
    elif name == "hmm-independent-review.json":
        matches = [d for d in candidates if d["candidate_id"] == row["candidate_id"]]
    elif name == "unisem-independent-review.json":
        matches = [d for d in candidates if d["proposition_id"] == row["proposition_id"]]
    else:
        matches = [d for d in candidates if d["candidate_id"] == row["candidate_id"]]
    if len(matches) != 1:
        raise ValueError(f"review cardinality: {lane}:{number} ({len(matches)})")
    return matches[0]


def source_fields(lane, row):
    source = row.get("source") or {}
    url = row.get("source_url") or source.get("requested_url") or source.get("url")
    final = row.get("final_url") or row.get("resolved_url") or source.get("final_url")
    hash_value = row.get(HASH.get(lane)) if lane in HASH else None
    hash_value = hash_value or source.get("raw_body_sha256") or source.get("body_sha256")
    return url, final, hash_value


def selected_rights(registry, url, quote, legal_name):
    exact = [r for r in registry if r.get("url") == url]
    claim = [r for r in exact if r.get("record_type") != "nonpublishable_metadata"
             and "benefit_claim" in r.get("supported_fields", [])
             and (not r.get("applicable_legal_entities") or legal_name in r["applicable_legal_entities"]
                  or legal_name == r.get("policy_owner_legal_entity"))]
    # A quote-specific match identifies one claim record; URL-only permission is insufficient.
    matching = [r for r in claim if quote and quote in r.get("supporting_quote", "")]
    allowed = [r for r in matching if r.get("decisions", {}).get("quote") == "allowed"]
    chosen = sorted(allowed, key=lambda r: r["source_id"])[0] if allowed else None
    return ({"registry_source_id": chosen["source_id"] if chosen else None,
             "registry_record_sha256": digest(json.dumps(chosen, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()) if chosen else None,
             "quote_permission": "allowed_with_attribution" if chosen else "unresolved",
             "snapshot_permission": chosen.get("decisions", {}).get("snapshot") if chosen else "unresolved",
             "exact_url_claim_records": len(claim),
             "exact_url_route_only_records": sum(r.get("record_type") == "nonpublishable_metadata" for r in exact)}, chosen)


def normalize(root, registry_path):
    registry = rows(registry_path)
    reviews = review_index(root)
    tombstones = {}
    for name in ("retention-prohibited-capture-removal.json", "cosmo-later-restriction-removal.json"):
        for removed in json.loads((root / name).read_text())["removed"]:
            tombstones[removed["path"]] = removed["sha256"]
    e1 = json.loads((root / "domestic-01-b/e1-retention-tombstone.json").read_text())
    for relative in e1["deleted_capture_paths"]:
        entry = next(line for line in (root / "domestic-01-b/SHA256SUMS").read_text().splitlines() if line.endswith("  " + relative))
        tombstones["domestic-01-b/" + relative] = entry.split("  ", 1)[0]
    output, inventory = [], {}
    canonical = registry_path.parent
    batches = {r["batch_id"]: set(r["company_ids"]) for r in rows(canonical / "series-batches.jsonl")}
    for lane, (filename, expected, review_name) in LANES.items():
        file = root / lane / filename
        original = rows(file)
        if len(original) != expected:
            raise ValueError(f"inventory count: {lane}: {len(original)} != {expected}")
        manifest = manifest_check(root / lane, tombstones)
        inventory[lane] = {"candidate_file": filename, "rows": len(original),
                           "candidate_sha256": digest(file.read_bytes()), "review": review_name,
                           "review_sha256": digest((root / review_name).read_bytes()),
                           "input_manifest": manifest}
        for number, row in enumerate(original, 1):
            review = decision_for(lane, number, row, reviews)
            company = row["company_id"]
            if review.get("company_id", company) != company:
                raise ValueError(f"review identity: {lane}:{number}")
            batch = row.get("batch_id") or ("domestic-31" if lane.startswith("domestic-31") else "international-31" if lane.startswith("international-31") else "international-01" if lane.startswith("international") else "domestic-03" if lane == "domestic-03-a" else "domestic-02" if lane == "domestic-02-a" else "domestic-01")
            if company not in batches[batch]:
                raise ValueError(f"noncanonical batch member: {lane}:{number}:{company}")
            url, final, body_hash = source_fields(lane, row)
            if not isinstance(url, str) or not url.startswith("https://"):
                raise ValueError(f"missing source URL: {lane}:{number}")
            quote = row.get(QUOTE.get(lane)) if lane in QUOTE else (row.get("source") or {}).get("quote")
            rights, specific = selected_rights(registry, url, quote, row.get("legal_name") or row.get("legal_entity") or "")
            category = row.get(CATEGORY.get(lane)) if lane in CATEGORY else review.get("frozen_category_id", review.get("category_hint"))
            if not category and lane == "domestic-01-a":
                category = review.get("reviewed_category")
            decision = review.get("decision", review.get("disposition"))
            group = next((review[k] for k in ("dedupe_group", "proposition_identity", "proposition_group", "provisional_group", "canonical_lead_id", "dedupe_id") if review.get(k)), None)
            blockers = {
                "taxonomy": "unmapped_or_review_required" if not category or row.get("taxonomy_note") else None,
                "identity": "selected_employer_or_policy_owner_unproven" if company.startswith("US-") or lane == "domestic-03-a" else "independent_legal_entity_review_required",
                "currentness": "live_or_historical_policy_continuity_unverified",
                "rights": None if specific else "quote_rights_unresolved_for_specific_claim_record",
                "evidence": "original_bytes_absent_or_deleted" if lane == "domestic-03-a" or (body_hash and not any(p.is_file() and not p.is_symlink() and digest(p.read_bytes()) == body_hash for p in (root / lane).rglob('*') if p.suffix in ('.html', '.body', '.pdf', '.bin'))) else "independent_promotion_receipt_absent",
            }
            output.append({"lane": lane, "row_number": number, "producer_candidate_id": row.get("candidate_id", row.get("proposition_id")),
                           "batch_id": batch,
                           "company_id": company, "source_url": url, "final_url": final,
                           "statement": row[PROPOSITION[lane]], "category_id": category,
                           "source_body_sha256": body_hash, "producer_row_sha256": digest(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()),
                           "triage_decision": decision, "provisional_group": group,
                           "rights": rights,
                           "attributed_quote": quote if specific and isinstance(quote, str) and len(quote) <= 160 else None,
                           "quote_attribution": specific.get("owner") if specific and isinstance(quote, str) and len(quote) <= 160 else None,
                           "blockers": blockers, "evidence_level": "research_only"})
    return output, inventory


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input-root", type=Path, required=True)
    ap.add_argument("--registry", type=Path, required=True)
    ap.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parent)
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    output, inventory = normalize(args.input_root, args.registry)
    ledger = "".join(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n" for r in output)
    coverage = dict(sorted(collections.Counter(r["lane"] for r in output).items()))
    unique = len({(r["company_id"], r["provisional_group"]) for r in output if r["provisional_group"]})
    metadata = {"authority": "audit_only_unapproved_not_a_publication_or_promotion_input", "evidence_level": "research_only",
                "raw_rows": len(output), "provisional_group_keys": unique, "coverage": coverage,
                "inventory": inventory, "source_registry_sha256": digest(args.registry.read_bytes()),
                "ledger_sha256": digest(ledger.encode()),
                "omissions": {"allowed-priority-a/whanin.candidates.jsonl": "one zero-positive route outcome, not a benefit lead"},
                "custody": "Deleted prohibited raw captures and Cosmo pilot body cannot be revalidated; SHA256SUMS entries with absent files are historical assertions only. No raw bytes copied."}
    files = {"research-leads.jsonl": ledger, "research-leads-manifest.json": json.dumps(metadata, ensure_ascii=False, indent=2, sort_keys=True) + "\n"}
    for name, text in files.items():
        dest = args.output_dir / name
        if args.check:
            if not dest.exists() or dest.read_text(encoding="utf-8") != text:
                raise ValueError(f"generated artifact drift: {name}")
        else:
            dest.write_text(text, encoding="utf-8")
    print(json.dumps({"raw_rows": len(output), "provisional_group_keys": unique, "coverage": coverage, "mode": "check" if args.check else "write"}, sort_keys=True))


if __name__ == "__main__":
    main()
