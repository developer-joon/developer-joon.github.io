#!/usr/bin/env python3
"""Deterministically materialize the frozen company-benefits population."""

import argparse
import importlib.util
import csv
import hashlib
import json
import unicodedata
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

_spec = importlib.util.spec_from_file_location('sec_workforce_audit', Path(__file__).with_name('sec-workforce-audit.py'))
AUDIT = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(AUDIT)

SEED = "company-benefits-population-v3"
PROTOCOL_VERSION = "4.0.0"
WORKFORCE_MINIMUM = 100
KR_LEDGER_SHA256 = "32bd7d45b9b93c28a2f633c57ed320e6ed35caaac69e0253f2f7a56e9bf2a9d7"
KR_FINANCIAL_DERIVED_SHA256 = "27f07ca7bdac0f796388f0c231ffe976d08a87b2059d4cb3155d79b94aeac883"
KR_BS_SHA256 = "618caedb3c11aaed17c0b8b6dcb205dcfaa7702f51f773af5bc95a12b7fb70cb"
KR_PL_SHA256 = "488ee1044835454a29f4c19b86b8fbb8dfaf7b184181a438f478714cb69ebfcf"
KR_REGISTRY_SHA256 = "901d66f4026ab881f0f9720f6a80bcefe47572eb06ef3e3344fda220b7555bf3"
KR_EMPLOYEE_SHA256 = "30f1c1be01b6358f3dc51781479d887eeac1136adce4b679ecb7433600655adf"
SEC_LEDGER_SHA256 = "05078c97c115a493b88e8a472456b5eff2f9e7e58ee89a48e245be13d5de5762"
APPROVER = "user-authorized implementation scope; technical review pending"
APPROVED_AT = "2026-10-30T14:09:05Z"
PANEL = ["US", "CA", "MX", "BR", "AR", "GB", "FR", "DE", "IT", "TR", "RU", "AU", "CN", "IN", "ID", "JP", "SA", "ZA"]
CESSATION_EVENTS = {
    "KR-CRN-1101110604200": [{
        "event_type": "dissolved", "effective_date": "2026-10-01",
        "source_id": "kr-dart-corporation-registry",
        "url": "https://dart.fss.or.kr/dsae001/downloadExcel.do",
        "locator": "corporation_registration_number=1101110604200;status=dissolved;effective_date=2026-10-01",
        "content_sha256": KR_REGISTRY_SHA256,
    }],
}
CESSATION_TYPES = {"closed", "dissolved", "liquidation_complete", "merged_out"}


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def jsonl_bytes(values):
    return b"".join(json_bytes(value) + b"\n" for value in values)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def verify_source_digest(path, expected):
    actual = sha256(Path(path).read_bytes())
    if actual != expected:
        raise ValueError(f"source digest mismatch for {path}: expected {expected}, got {actual}")


def normalized(value, collapse=False):
    value = unicodedata.normalize("NFC", str(value)).strip()
    return " ".join(value.split()) if collapse else value


def add_selection(record):
    canonical = [SEED, record["jurisdiction"], record["registry_id"], normalized(record["legal_name"], True)]
    record["legal_name"] = canonical[3]
    record["selected_reporting_legal_entity"] = canonical[3]
    record["benefit_policy_owner"] = {"status": "unknown", "reason": "Population evidence does not establish the benefit policy owner or payroll employer."}
    record["selection_hash"] = sha256(json_bytes(canonical))
    record["_canonical"] = json_bytes(canonical)
    return record


def finish(records):
    records.sort(key=lambda item: (item["selection_hash"], item["_canonical"]))
    for record in records:
        record.pop("_canonical")
    return records


def eligibility_decision(record, status_events, cutoff="2026-10-29"):
    """Apply protocol 4 workforce and cessation rules; delisting alone is not cessation."""
    ceased = next((event for event in status_events
                   if event.get("event_type") in CESSATION_TYPES and event.get("effective_date", "9999-99-99") <= cutoff), None)
    if ceased:
        return False, "entity_ceased_before_cutoff"
    count = record.get("employer_evidence", {}).get("employee_count")
    if not isinstance(count, int):
        return False, "workforce_missing_or_ambiguous"
    if count < WORKFORCE_MINIMUM:
        return False, "workforce_below_minimum"
    return True, None


def partition_eligibility(records):
    eligible, exclusions = [], []
    for record in records:
        events = CESSATION_EVENTS.get(record["company_id"], [])
        included, reason = eligibility_decision(record, events)
        if included:
            record["entity_status"] = "active_at_cutoff"
            record["active_at_cutoff"] = {
                "status": "no_official_cessation_evidence",
                "cutoff_at": "2026-10-29T23:59:59+09:00",
                "evidence_source_ids": ["kr-dart-corporation-registry"] if record["scope"] == "domestic" else ["us-sec-quarterly-financials"],
            }
            eligible.append(record)
            continue
        event = next((item for item in events if item.get("event_type") in CESSATION_TYPES), None)
        evidence = event or {
            "source_id": record.get("employer_evidence", {}).get("source_id"),
            "url": record.get("employer_evidence", {}).get("url"),
            "locator": record.get("employer_evidence", {}).get("locator"),
            "content_sha256": record.get("employer_evidence", {}).get("content_sha256"),
            "evidence_date": record.get("employer_evidence", {}).get("fiscal_period_end"),
            "employee_count": record.get("employer_evidence", {}).get("employee_count"),
        }
        exclusions.append({"company_id": record["company_id"], "scope": record["scope"],
                           "legal_name": record["legal_name"], "reason_code": reason, "evidence": evidence})
    eligible.sort(key=lambda item: item["selection_hash"])
    return eligible, sorted(exclusions, key=lambda item: (item["scope"], item["company_id"]))


def load_domestic(path, retrieved_at=APPROVED_AT):
    with Path(path).open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    records = []
    for row in rows:
        financial = row["is_financial_sector"].casefold() == "true"
        metric = "total_assets" if financial else "revenue"
        value = int(row["assets_krw"] if financial else row["revenue_krw"])
        basis = row["assets_basis"] if financial else row["revenue_basis"]
        legal_name = normalized(row["legal_name"], True)
        registry_id = row["entity_id"]
        period = "2024-12-31"
        employee_period = row["employee_evidence_dates"]
        company = {
            "company_id": registry_id, "jurisdiction": "KR", "incorporation_country": "KR", "scope": "domestic",
            "registry_id": registry_id, "legal_name": legal_name, "selected_reporting_legal_entity": legal_name,
            "registered_head_office_country": "KR", "financial_consolidation_parent": {"status":"unknown","reason":"Not established by population evidence."}, "ultimate_parent": {"status":"unknown","reason":"Not established by population evidence."},
            "related_company_exception": None, "entity_status": "unassessed", "employment_evidence_scope": "filing_entity_total",
            "employment_boundary_note": "Official reporting-entity workforce evidence supports population eligibility; it is not guaranteed payroll headcount and does not establish the payroll employer or benefit scope.",
            "sector": "financial" if financial else "non_financial", "scale_source_precedence_rank": 1, "source_availability": [],
            "scale_metric": {"type": metric, "value": value, "currency": "KRW", "original_value": value,
                             "original_currency": "KRW", "conversion": None, "fiscal_year_end": period,
                             "financial_scope": "consolidated" if basis == "consolidated" else "standalone",
                             "source_ids": ["kr-opendart-financial-bulk"]},
            "scale_evidence": {"source_id": "kr-opendart-financial-bulk", "url": row["financial_source_url"],
                               "locator": f"fiscal_year=2024;stock_code={row['stock_code']};filing_name={normalized(row['filing_name'], True)};metric={metric};basis={basis}",
                               "content_sha256": KR_BS_SHA256 if metric == "total_assets" else KR_PL_SHA256, "hash_provenance": "retained_source_artifact",
                               "retrieved_at": retrieved_at, "filing_date": period, "registry_id": registry_id,
                               "legal_name": legal_name, "fiscal_period_end": period, "metric": metric, "value": value, "currency": "KRW"},
            "employer_evidence": {"source_id": "kr-opendart-employee-bulk", "url": row["employee_source_url"],
                                  "locator": f"selectYear=2024;reportCode=11011;stock_code={row['stock_code']};filing_name={normalized(row['filing_name'], True)}",
                                  "content_sha256": KR_EMPLOYEE_SHA256, "hash_provenance": "retained_source_artifact",
                                  "retrieved_at": retrieved_at, "filing_date": employee_period, "registry_id": registry_id,
                                  "legal_name": legal_name, "fiscal_period_end": employee_period,
                                  "employee_count": int(row["employee_max_reported_row_total"]),
                                  "quote": f"positive_employee_rows={row['positive_employee_rows']}; employee_max_reported_row_total={row['employee_max_reported_row_total']}"},
        }
        records.append(add_selection(company))
    return finish(records)


def number(value):
    parsed = float(value)
    return int(parsed) if parsed.is_integer() else parsed


def sec_accepted_at(value):
    parsed = datetime.strptime(value, "%Y-%m-%d %H:%M:%S.%f").replace(tzinfo=ZoneInfo("America/New_York"))
    return parsed.isoformat()


def load_international(path, retrieved_at=APPROVED_AT, review_map=None):
    review_map = review_map or {}
    with Path(path).open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    records = []
    for row in rows:
        if row["accession"] in AUDIT.REJECTED:
            continue
        evidence_date, date_basis = AUDIT.workforce_date(row, review_map)
        if row.get("jurisdiction") != "US" or row.get("incorporation_country") != "US" or row.get("business_address_country") != "US":
            raise ValueError(f"strict-US jurisdiction evidence mismatch for {row.get('legal_name')}")
        if row.get("jurisdiction_method") != "exact_SEC_SUB_countryinc_US_and_countryba_US":
            raise ValueError(f"strict-US jurisdiction method mismatch for {row.get('legal_name')}")
        financial = row["financial_class"].casefold() == "true"
        metric = "total_assets" if financial else "revenue"
        value = number(row["assets_usd"] if financial else row["revenue_usd"])
        legal_name = normalized(row["legal_name"], True)
        registry_id = row["legal_id"]
        period = row["fiscal_period_end"]
        jurisdiction = row["jurisdiction"]
        accepted_at = sec_accepted_at(row["accepted"])
        accession = row["accession"]
        jurisdiction_common = {"source_id": "us-sec-quarterly-financials", "url": row["jurisdiction_dataset_url"],
                               "locator": row["jurisdiction_evidence_locator"], "content_sha256": row["jurisdiction_dataset_sha256"],
                               "hash_provenance": "retained_source_artifact", "retrieved_at": retrieved_at,
                               "filing_date": row["filed"], "accepted_at": accepted_at, "accession": accession,
                               "registry_id": registry_id, "legal_name": legal_name, "quote": row["jurisdiction_evidence_quote"]}
        company = {
            "company_id": f"{jurisdiction}-{registry_id}", "jurisdiction": jurisdiction, "incorporation_country": jurisdiction, "scope": "international",
            "registry_id": registry_id, "legal_name": legal_name, "selected_reporting_legal_entity": legal_name,
            "registered_head_office_country": jurisdiction, "financial_consolidation_parent": {"status":"unknown","reason":"Not established by population evidence."}, "ultimate_parent": {"status":"unknown","reason":"Not established by population evidence."},
            "related_company_exception": None, "entity_status": "unassessed", "employment_evidence_scope": "filing_entity_total_or_stated_workforce" if row["employee_scope"] == "reporting_legal_entity_or_consolidated_group_total" else row["employee_scope"],
            "employment_boundary_note": "Official SEC reporting-entity or stated consolidated workforce evidence is not guaranteed payroll headcount and does not establish the payroll employer or benefit scope.",
            "sector": "financial" if financial else "non_financial", "scale_source_precedence_rank": 1, "source_availability": [],
            "scale_metric": {"type": metric, "value": value, "currency": "USD", "original_value": value,
                             "original_currency": "USD", "conversion": None, "fiscal_year_end": period,
                             "financial_scope": "consolidated", "source_ids": ["us-sec-quarterly-financials"]},
            "scale_evidence": {"source_id": "us-sec-quarterly-financials", "url": row["financial_dataset_url"],
                               "locator": row["financial_fact_locator"], "content_sha256": row["financial_dataset_sha256"],
                               "hash_provenance": "retained_source_artifact", "retrieved_at": retrieved_at,
                               "filing_date": row["filed"], "accepted_at": accepted_at, "accession": accession, "registry_id": registry_id, "legal_name": legal_name,
                               "fiscal_period_end": period, "metric": metric, "value": value, "currency": "USD"},
            "employer_evidence": {"source_id": "us-sec-filing-employee", "url": row["employee_filing_url"],
                                  "locator": row["employee_evidence_locator"], "content_sha256": row["employee_filing_sha256"],
                                  "hash_provenance": "retained_source_artifact", "retrieved_at": retrieved_at,
                                  "filing_date": row["filed"], "accepted_at": accepted_at, "accession": accession, "registry_id": registry_id, "legal_name": legal_name,
                                  "fiscal_period_end": evidence_date, "evidence_date": evidence_date, "date_basis": date_basis, "employee_count": int(row["employee_count"]),
                                  "quote": row["employee_evidence_quote"]},
            "incorporation_evidence": {**jurisdiction_common, "official_field": "countryinc/stprinc", "normalized_official_code": row["incorporation_country"], "normalized_official_value": row["incorporation_state_province"] or "<blank>"},
            "head_office_evidence": {**jurisdiction_common, "official_field": "countryba/stprba", "normalized_official_code": row["business_address_country"], "normalized_official_value": row["business_address_state_province"]},
        }
        records.append(add_selection(company))
    return finish(records)


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def manifest_entry(root, relative):
    data = (root / relative).read_bytes()
    return {"path": relative, "sha256": sha256(data), "count": 1 if relative.endswith(".json") else len(data.splitlines())}


def build_source_artifacts(international_csv, acquisition_manifest, filing_manifest):
    artifacts = [
        {"artifact_id":"kr-bs-2024","kind":"official_acquisition","url":"https://opendart.fss.or.kr/disclosureinfo/fnltt/dwld/main.do","acquisition_url":"https://opendart.fss.or.kr/cmm/downloadFnlttZip.do?fl_nm=2024_4Q_BS_20261002032734.zip","sha256":KR_BS_SHA256},
        {"artifact_id":"kr-pl-2024","kind":"official_acquisition","url":"https://opendart.fss.or.kr/disclosureinfo/fnltt/dwld/main.do","acquisition_url":"https://opendart.fss.or.kr/cmm/downloadFnlttZip.do?fl_nm=2024_4Q_PL_20261002033101.zip","sha256":KR_PL_SHA256},
        {"artifact_id":"kr-registry","kind":"official_acquisition","url":"https://dart.fss.or.kr/dsae001/downloadExcel.do","sha256":KR_REGISTRY_SHA256},
        {"artifact_id":"kr-employees-2024","kind":"official_acquisition","url":"https://opendart.fss.or.kr/disclosureinfo/biz/ExcelDownload.do","sha256":KR_EMPLOYEE_SHA256},
        {"artifact_id":"kr-financial-derived","kind":"derived","locator":"opendart_2024_assets_revenue_population.csv","sha256":KR_FINANCIAL_DERIVED_SHA256},
        {"artifact_id":"kr-eligible-derived","kind":"derived","locator":"korean_fully_qualifying_entities.csv","sha256":KR_LEDGER_SHA256},
        {"artifact_id":"sec-qualified-ledger","kind":"derived","locator":"corrected_strict_us_employee_eligible_ledger.csv","sha256":SEC_LEDGER_SHA256},
    ]
    acquisition = json.loads(Path(acquisition_manifest).read_text(encoding="utf-8"))
    for item in acquisition["quarters"]:
        if item.get("available"):
            artifacts.append({"artifact_id":f"sec-quarter-{item['year']}q{item['quarter']}","kind":"official_acquisition","url":item["url"],"sha256":item["sha256"]})
    with Path(filing_manifest).open(encoding="utf-8-sig", newline="") as handle:
        filing_rows = {row["filing_url"]: row for row in csv.DictReader(handle)}
    with Path(international_csv).open(encoding="utf-8-sig", newline="") as handle:
        retained = list(csv.DictReader(handle))
    for row in retained:
        manifest = filing_rows.get(row["employee_filing_url"])
        if not manifest or manifest["raw_html_sha256"] != row["employee_filing_sha256"]:
            raise ValueError(f"filing evidence manifest mismatch for {row['employee_filing_url']}")
        artifacts.append({"artifact_id":f"sec-filing-{row['accession']}","kind":"official_acquisition","url":row["employee_filing_url"],"sha256":row["employee_filing_sha256"]})
    return sorted(artifacts, key=lambda item: item["artifact_id"])


def materialize(domestic_csv, international_csv, root, acquisition_manifest, filing_manifest, retrieved_at=APPROVED_AT):
    root = Path(root)
    verify_source_digest(domestic_csv, KR_LEDGER_SHA256)
    verify_source_digest(international_csv, SEC_LEDGER_SHA256)
    domestic_candidates = load_domestic(domestic_csv, retrieved_at)
    review_map = AUDIT.build(root, Path(international_csv).parent)
    international_candidates = load_international(international_csv, retrieved_at, review_map)
    if len(domestic_candidates) != 1350 or len(international_candidates) != 1066:
        raise ValueError(f"verified source count mismatch: domestic={len(domestic_candidates)}, international={len(international_candidates)}")
    domestic, domestic_exclusions = partition_eligibility(domestic_candidates)
    international, international_exclusions = partition_eligibility(international_candidates)
    if len(domestic) != 1037 or len(international) != 1060:
        raise ValueError(f"protocol 4 eligible count mismatch: domestic={len(domestic)}, international={len(international)}")
    selected = {"domestic": domestic[:1000], "international": international[:1000]}
    population = root / "population"
    artifacts = build_source_artifacts(international_csv, acquisition_manifest, filing_manifest)
    with Path(international_csv).open(encoding="utf-8-sig", newline="") as handle:
        international_rows = list(csv.DictReader(handle))
    write(population / "source-artifacts.jsonl", jsonl_bytes(artifacts))
    write(population / "exclusion-ledger.jsonl", jsonl_bytes(domestic_exclusions + international_exclusions))
    candidate_manifest = {
        "protocol_version": PROTOCOL_VERSION,
        "workforce_minimum": WORKFORCE_MINIMUM,
        "candidate_counts": {"domestic": len(domestic_candidates), "international": len(international_candidates)},
        "eligible_counts": {"domestic": len(domestic), "international": len(international)},
        "selected_counts": {"domestic": 1000, "international": 1000},
        "reserve_counts": {"domestic": len(domestic) - 1000, "international": len(international) - 1000},
        "exclusion_reason_codes": ["workforce_below_minimum", "workforce_missing_or_ambiguous", "entity_ceased_before_cutoff"],
    }
    write(population / "candidate-manifest.json", json_bytes(candidate_manifest))
    for scope, records in (("domestic", domestic), ("international", international)):
        write(population / f"{scope}-eligible.jsonl", jsonl_bytes(records))
        write(population / f"{scope}-reserve.jsonl", jsonl_bytes(records[1000:]))
        for suffix in ("selected", "initial-effective-selected", "effective-selected"):
            write(population / f"{scope}-{suffix}.jsonl", jsonl_bytes(selected[scope]))
    write(population / "effective-selection-events.jsonl", b"")
    bindings = []
    for company in domestic + international:
        kinds = ("scale", "employer") if company["scope"] == "domestic" else ("scale", "employer", "incorporation", "head_office")
        for kind in kinds:
            evidence = company[f"{kind}_evidence"]
            if company["scope"] == "domestic":
                official_id = ("kr-bs-2024" if company["scale_metric"]["type"] == "total_assets" else "kr-pl-2024") if kind == "scale" else "kr-employees-2024"
                identity_id = "kr-registry"
                derived_id = "kr-eligible-derived"
            else:
                if kind in {"scale", "incorporation", "head_office"}:
                    official_id = "sec-quarter-" + evidence["url"].rsplit("/", 1)[-1].removesuffix(".zip")
                else:
                    official_id = "sec-filing-" + next(row["accession"] for row in international_rows if row["legal_id"] == company["registry_id"])
                identity_id = official_id
                derived_id = "sec-qualified-ledger"
            bindings.append({"company_id": company["company_id"], "kind": kind, "source_id": evidence["source_id"],
                             "url": evidence["url"], "locator": evidence["locator"],
                             "content_sha256": evidence["content_sha256"], "registry_id": evidence["registry_id"],
                             "legal_name": evidence["legal_name"], "fiscal_period_end": evidence.get("fiscal_period_end"),
                             "official_artifact_id": official_id, "identity_artifact_id": identity_id, "derived_artifact_id": derived_id})
    bindings.sort(key=lambda item: (item["company_id"], item["kind"]))
    write(population / "source-artifact-bindings.jsonl", jsonl_bytes(bindings))
    write(root / "companies.jsonl", jsonl_bytes(selected["domestic"] + selected["international"]))
    for name in ("benefit-claims.jsonl", "reviews.jsonl", "corrections.jsonl"):
        path = root / name
        if not path.exists():
            write(path, b"")

    gaps = {
        "panel": PANEL, "selected_population": {"jurisdiction": "US", "count": 1000, "source": "strict US-incorporated and US principal-business-address SEC 10-K filers"},
        "representativeness": "Protocol-bounded strict-US SEC 10-K population; not globally representative, not all SEC filers, and not a source rank.",
        "coverage_gaps": [{"jurisdiction": country, "status": "not_materialized", "selected_count": 0} for country in PANEL if country != "US"],
    }
    write(population / "international-coverage-gaps.json", json_bytes(gaps))
    freeze_paths = ["population-protocol.json", "population/candidate-manifest.json", "population/exclusion-ledger.jsonl",
                    "population/domestic-eligible.jsonl", "population/international-eligible.jsonl",
                    "population/domestic-selected.jsonl", "population/international-selected.jsonl", "population/international-coverage-gaps.json",
                    "population/domestic-reserve.jsonl", "population/international-reserve.jsonl",
                    "population/source-artifact-bindings.jsonl", "population/source-artifacts.jsonl",
                    "population/independent-sec-workforce-reviews.jsonl", "population/acquisition-audit-manifest.json"]
    freeze = {"status": "approved", "approved_by": APPROVER, "approved_at": APPROVED_AT,
              "artifacts": [manifest_entry(root, path) for path in freeze_paths]}
    write(population / "freeze-manifest.json", json_bytes(freeze))
    effective_paths = ["population/domestic-effective-selected.jsonl", "population/international-effective-selected.jsonl", "population/effective-selection-events.jsonl"]
    effective = {"status": "approved", "approved_by": APPROVER, "approved_at": APPROVED_AT,
                 "freeze_manifest_sha256": sha256((population / "freeze-manifest.json").read_bytes()),
                 "artifacts": [manifest_entry(root, path) for path in effective_paths]}
    write(population / "effective-selection-manifest.json", json_bytes(effective))
    return {"domestic_eligible": len(domestic), "international_eligible": len(international),
            "domestic_selected": 1000, "international_selected": 1000,
            "freeze_manifest_sha256": sha256((population / "freeze-manifest.json").read_bytes()),
            "effective_manifest_sha256": sha256((population / "effective-selection-manifest.json").read_bytes())}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--domestic-csv", type=Path, required=True)
    parser.add_argument("--international-csv", type=Path, required=True)
    parser.add_argument("--root", type=Path, default=Path("docs/research/company-benefits"))
    parser.add_argument("--sec-acquisition-manifest", type=Path, required=True)
    parser.add_argument("--sec-filing-manifest", type=Path, required=True)
    parser.add_argument("--retrieved-at", default=APPROVED_AT)
    args = parser.parse_args(argv)
    print(json.dumps(materialize(args.domestic_csv, args.international_csv, args.root, args.sec_acquisition_manifest, args.sec_filing_manifest, args.retrieved_at), indent=2))


if __name__ == "__main__":
    main()
