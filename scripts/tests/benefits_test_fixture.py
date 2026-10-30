import copy
import hashlib
import json
from pathlib import Path

from scripts import company_benefits_series

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
RESEARCH_ROOT = REPOSITORY_ROOT / "docs" / "research" / "company-benefits"
PANEL = ["US", "CA", "MX", "BR", "AR", "GB", "FR", "DE", "IT", "TR", "RU", "AU", "CN", "IN", "ID", "JP", "SA", "ZA"]


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def jsonl_bytes(values):
    return b"".join(json_bytes(value) + b"\n" for value in values)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def selection_hash(seed, company):
    return sha(json_bytes([seed, company["jurisdiction"], company["registry_id"], company["legal_name"]]))


def audited_source(source_id, supported_fields, url=None, source_type="regulator_filing", jurisdiction="INT"):
    url = url or f"https://example.gov/{source_id}"
    return {
        "source_id": source_id,
        "title": f"Official {source_id}",
        "owner": "Official authority",
        "source_type": source_type,
        "jurisdiction": jurisdiction,
        "url": url,
        "locator": "section 1",
        "supporting_quote": "Official evidence",
        "content_sha256": "a" * 64,
        "hash_provenance": "observed_response",
        "retrieved_at": "2026-10-20T00:00:00Z",
        "access_model": "public_keyless",
        "authentication": {"api_key": False, "login": False, "fee": False},
        "terms_url": "https://example.gov/terms",
        "reuse_decision": "allowed_with_attribution",
        "decisions": {"extract": "allowed", "quote": "allowed", "retention": "metadata_only", "snapshot": "prohibited", "attribution": "required"},
        "supported_fields": supported_fields,
        "evidence_eligibility": "A",
        "checked_at": "2026-10-20T01:00:00Z",
        "http_verification": {"status": 200, "redirect_chain": [], "content_type": "text/html", "final_url": url, "final_owner_domain": url.split("/")[2], "access_wall": "none", "expected_marker": "Official"},
        "current_blocker": None,
    }


class ContractFixture:
    """Complete synthetic fixture for the pinned protocol contract."""

    def __init__(self, root):
        self.root = Path(root)
        self.population = self.root / "population"
        self.population.mkdir(parents=True, exist_ok=True)
        self.protocol = json.loads((RESEARCH_ROOT / "population-protocol.json").read_text(encoding="utf-8"))
        self.protocol.update({
            "protocol_id": "company-benefits-population-synthetic-test",
            "version": "3.1.1",
            "status": "approved",
            "approval": {"approved_by": "owner", "approved_at": "2026-10-21T00:00:00Z"},
        })
        self.seed = self.protocol["canonical_selection"]["seed"]
        self.sources = []
        source_jurisdiction = {}
        for jurisdiction, entries in self.protocol["registered_sources"].items():
            for entry in entries:
                source_jurisdiction[entry["source_id"]] = jurisdiction
                self.sources.append(audited_source(
                    entry["source_id"],
                    ["revenue", "total_assets", "legal_entity", "fiscal_year_end", "employee_evidence"],
                    url=entry["endpoint"],
                    jurisdiction=jurisdiction,
                ))
        fx = self.protocol["currency_conversion"]
        self.sources.append(audited_source(fx["source_id"], ["local_currency_per_USD"], url=fx["url"]))

        self.source_for_jurisdiction = {
            jurisdiction: entries[0]["source_id"]
            for jurisdiction, entries in self.protocol["registered_sources"].items()
        }
        self.eligible = {"domestic": self._companies("domestic", 1001), "international": self._companies("international", 1001)}
        self.selected = {scope: records[:1000] for scope, records in self.eligible.items()}
        self.events = []
        self.current = {scope: list(records) for scope, records in self.selected.items()}
        self.companies = self.current["domestic"] + self.current["international"]
        for company in self.current["domestic"][:25]:
            source = audited_source(
                "benefit-source-" + company["company_id"], ["benefit_claim"],
                source_type="official_company_report", jurisdiction=company["jurisdiction"],
            )
            source.update(
                locator="benefits", supporting_quote="Paid leave is offered.", publication_date="2026-01-01",
                claim_evidence_role="primary_claim_evidence", claim_evidence_proposition="Paid leave is offered.",
                applicable_legal_entities=[company["selected_reporting_legal_entity"]],
                policy_owner_legal_entity=company["benefit_policy_owner"],
            )
            self.sources.append(source)
        # Claims cover only the first render batch; the fixture does not imply complete benefit coverage.
        self.claims = [self._claim(company) for company in self.current["domestic"][:25]]
        self.reviews = [{"review_id": f"review-{i:04d}", "claim_id": claim["claim_id"], "researcher_id": "alice", "reviewer_id": "bob", "decision": "approved", "reviewed_at": "2026-10-20T03:00:00Z", "issues": [], "resolution": "accepted", "quote_entailment_confirmed": True, "source_entailment_reviews": [{"source_id": item["source_id"], "reviewed_role": item["role"], "reviewed_proposition": item["proposition"], "source_locator": item["source_locator"], "reviewed_quote": item["supporting_quote"], "content_sha256": item["content_sha256"], "entailment_confirmed": True, "reviewer_id": "bob"} for item in claim["source_evidence"]]} for i, claim in enumerate(self.claims)]
        self.write_all()

    def _companies(self, scope, count):
        records = []
        for index in range(count):
            jurisdiction = "KR" if scope == "domestic" else "US"
            legal_name = f"{scope.title()} Employer {index:04d}"
            source_id = self.source_for_jurisdiction[jurisdiction]
            company = {
                "company_id": f"{scope}-{index:04d}", "jurisdiction": jurisdiction, "incorporation_country": jurisdiction,
                "scope": scope, "registry_id": f"{scope[:1]}-{index:06d}", "legal_name": legal_name,
                "selected_reporting_legal_entity": legal_name, "registered_head_office_country": jurisdiction,
                "financial_consolidation_parent": {"status":"unknown","reason":"Not established by test population evidence."}, "ultimate_parent": {"status":"unknown","reason":"Not established by test population evidence."}, "benefit_policy_owner": legal_name,
                "related_company_exception": None, "entity_status": "active", "sector": "non_financial",
                "employment_evidence_scope": "filing_entity_total", "employment_boundary_note": "Test evidence does not establish payroll employer or benefit scope.",
                "scale_source_precedence_rank": 1,
                "source_availability": [],
                "scale_metric": {"type": "revenue", "value": 200000000000 if scope == "domestic" else 2000000000, "currency": "KRW" if scope == "domestic" else "USD", "original_value": 200000000000 if scope == "domestic" else 2000000000, "original_currency": "KRW" if scope == "domestic" else "USD", "conversion": None, "fiscal_year_end": "2025-12-31", "financial_scope": "standalone", "source_ids": [source_id]},
                "scale_evidence": {"source_id": source_id, "url": self.protocol["registered_sources"][jurisdiction][0]["endpoint"], "locator": f"row:{index};metric=revenue", "content_sha256": "a" * 64, "hash_provenance": "observed_response", "retrieved_at": "2026-10-20T00:00:00Z", "filing_date": "2026-01-15", "accepted_at": "2026-01-15T12:00:00-05:00" if scope == "international" else None, "registry_id": f"{scope[:1]}-{index:06d}", "legal_name": legal_name, "fiscal_period_end": "2025-12-31", "metric": "revenue", "value": 200000000000 if scope == "domestic" else 2000000000, "currency": "KRW" if scope == "domestic" else "USD"},
                "employer_evidence": {"source_id": source_id, "url": self.protocol["registered_sources"][jurisdiction][0]["endpoint"], "locator": f"row:{index};field=employees", "content_sha256": "a" * 64, "hash_provenance": "observed_response", "retrieved_at": "2026-10-20T00:00:00Z", "filing_date": "2026-01-15", "accepted_at": "2026-01-15T12:00:00-05:00" if scope == "international" else None, "registry_id": f"{scope[:1]}-{index:06d}", "legal_name": legal_name, "fiscal_period_end": "2025-12-31", "employee_count": 10, "quote": "The registrant employed 10 people."},
            }
            if scope == "international":
                common = {"source_id": source_id, "url": self.protocol["registered_sources"][jurisdiction][0]["endpoint"], "locator": f"sub.txt:row={index}", "content_sha256": "a" * 64, "hash_provenance": "observed_response", "retrieved_at": "2026-10-20T00:00:00Z", "filing_date": "2026-01-15", "accepted_at": "2026-01-15T12:00:00-05:00", "accession": f"test-{index}", "registry_id": f"{scope[:1]}-{index:06d}", "legal_name": legal_name, "quote": "countryinc=US | stprinc=DE | countryba=US | stprba=NY"}
                company["scale_evidence"]["accession"] = f"test-{index}"
                company["employer_evidence"].update(accession=f"test-{index}", fiscal_period_end=None, evidence_date=None, date_basis="undated_current")
                company["incorporation_evidence"] = {**common, "official_field": "countryinc/stprinc", "normalized_official_code": "US", "normalized_official_value": "DE"}
                company["head_office_evidence"] = {**common, "official_field": "countryba/stprba", "normalized_official_code": "US", "normalized_official_value": "NY"}
            company["selection_hash"] = selection_hash(self.seed, company)
            records.append(company)
        return sorted(records, key=lambda item: (item["selection_hash"], json_bytes([self.seed, item["jurisdiction"], item["registry_id"], item["legal_name"]])))

    def _claim(self, company):
        source_id = "benefit-source-" + company["company_id"]
        return {"claim_id": "claim-" + company["company_id"], "company_id": company["company_id"], "benefit_name": "Leave", "detail": "Paid leave is offered.", "status": "confirmed", "current_validity": "current", "evidence_grade": "A", "source_ids": [source_id], "source_evidence": [{"source_id": source_id, "role": "primary_claim_evidence", "proposition": "Paid leave is offered.", "source_locator": "benefits", "supporting_quote": "Paid leave is offered.", "content_sha256": "a" * 64}], "application_scope": {"countries": [company["jurisdiction"]], "legal_entities": [company["legal_name"]], "roles": ["all"], "employment_types": ["full_time"], "tenure_condition": "none"}, "publication_date": "2026-01-01", "checked_at": "2026-10-20", "researched_at": "2026-10-20T02:00:00Z", "prepublication_checked_at": "2026-10-20T04:00:00Z", "source_locator": "benefits", "supporting_quote": "Paid leave is offered.", "content_sha256": "a" * 64}

    @property
    def benefit_source(self):
        return next(source for source in self.sources if source["source_id"] == self.claims[0]["source_ids"][0])

    def approved_freeze_anchors(self):
        return {self.protocol["version"]: sha((self.population / "freeze-manifest.json").read_bytes())}

    def approved_effective_anchors(self):
        if not self.events:
            return {}
        scope = self.events[-1]["scope"]
        return {self.protocol["version"]: {
            "effective_manifest_sha256": sha((self.population / "effective-selection-manifest.json").read_bytes()),
            "domestic_effective_sequence_sha256": sha((self.population / "domestic-effective-selected.jsonl").read_bytes()),
            "international_effective_sequence_sha256": sha((self.population / "international-effective-selected.jsonl").read_bytes()),
            "replacement_events_sha256": sha((self.population / "effective-selection-events.jsonl").read_bytes()),
            "candidate_effective_sha256": sha((self.population / f"{scope}-effective-selected.jsonl").read_bytes()),
        }}

    def replacement_event(self, scope="domestic", excluded_index=-1):
        old = self.current[scope]
        excluded = old[excluded_index]
        replacement = next(record for record in self.eligible[scope] if record["company_id"] not in {item["company_id"] for item in old})
        new = list(old)
        new[excluded_index] = replacement
        event = {
            "event_id": "event-1", "protocol_version": self.protocol["version"], "scope": scope,
            "exclusion_reason": "entity_ineligible", "exclusion_details": "Official registry shows the entity no longer qualifies.",
            "excluded_company_id": excluded["company_id"], "excluded_selection_hash": excluded["selection_hash"],
            "excluded_hash_position": old.index(excluded), "replacement_company_id": replacement["company_id"],
            "replacement_selection_hash": replacement["selection_hash"],
            "previous_effective_sha256": sha(jsonl_bytes(old)), "next_effective_sha256": sha(jsonl_bytes(new)),
            "occurred_at": "2026-10-22T00:00:00Z", "approved_by": "owner",
        }
        return event, new

    def write_json(self, relative, value):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(json_bytes(value))

    def write_jsonl(self, relative, values):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(jsonl_bytes(values))

    def refresh_manifests(self):
        freeze_paths = ["population-protocol.json", "population/domestic-eligible.jsonl", "population/international-eligible.jsonl", "population/domestic-selected.jsonl", "population/international-selected.jsonl", "population/international-coverage-gaps.json", "population/source-artifact-bindings.jsonl", "population/source-artifacts.jsonl"]
        for name in ('independent-sec-workforce-reviews.jsonl', 'acquisition-audit-manifest.json'):
            source = RESEARCH_ROOT / 'population' / name
            (self.population / name).write_bytes(source.read_bytes())
            freeze_paths.append('population/' + name)
        freeze_entries = []
        for relative in freeze_paths:
            data = (self.root / relative).read_bytes()
            freeze_entries.append({"path": relative, "sha256": sha(data), "count": 1 if relative.endswith(".json") else len(data.splitlines())})
        self.write_json("population/freeze-manifest.json", {"status": "approved", "approved_by": "owner", "approved_at": "2026-10-21T00:00:00Z", "artifacts": freeze_entries})
        freeze_hash = sha((self.root / "population/freeze-manifest.json").read_bytes())
        effective_paths = ["population/domestic-effective-selected.jsonl", "population/international-effective-selected.jsonl", "population/effective-selection-events.jsonl"]
        effective_entries = []
        for relative in effective_paths:
            data = (self.root / relative).read_bytes()
            effective_entries.append({"path": relative, "sha256": sha(data), "count": len(data.splitlines())})
        effective = {"status": "approved", "approved_by": "owner", "approved_at": "2026-10-23T00:00:00Z", "freeze_manifest_sha256": freeze_hash, "artifacts": effective_entries}
        self.write_json("population/effective-selection-manifest.json", effective)

    def write_all(self):
        self.write_json("population-protocol.json", self.protocol)
        self.write_jsonl("source-registry.jsonl", self.sources)
        for scope in ("domestic", "international"):
            self.write_jsonl(f"population/{scope}-eligible.jsonl", self.eligible[scope])
            self.write_jsonl(f"population/{scope}-selected.jsonl", self.selected[scope])
            self.write_jsonl(f"population/{scope}-initial-effective-selected.jsonl", self.selected[scope])
            self.write_jsonl(f"population/{scope}-effective-selected.jsonl", self.current[scope])
        self.write_jsonl("population/effective-selection-events.jsonl", self.events)
        artifacts = [{"artifact_id":"derived-test-ledger","kind":"derived","locator":"synthetic fixture","sha256":"d"*64}]
        for source in self.sources:
            if "revenue" in source.get("supported_fields", []) or "total_assets" in source.get("supported_fields", []) or "employee_evidence" in source.get("supported_fields", []):
                artifacts.append({"artifact_id":"official-"+source["source_id"],"kind":"official_acquisition","url":source["url"],"sha256":source["content_sha256"]})
        self.write_jsonl("population/source-artifacts.jsonl", sorted({item["artifact_id"]:item for item in artifacts}.values(), key=lambda item:item["artifact_id"]))
        bindings = []
        for company in self.eligible["domestic"] + self.eligible["international"]:
            kinds = ("scale", "employer") if company["scope"] == "domestic" else ("scale", "employer", "incorporation", "head_office")
            for kind in kinds:
                evidence = company.get(f"{kind}_evidence", {})
                bindings.append({"company_id": company["company_id"], "kind": kind, "source_id": evidence.get("source_id"), "url": evidence.get("url"), "locator": evidence.get("locator"), "content_sha256": evidence.get("content_sha256"), "registry_id": evidence.get("registry_id"), "legal_name": evidence.get("legal_name"), "fiscal_period_end": evidence.get("fiscal_period_end"), "official_artifact_id":"official-"+str(evidence.get("source_id")), "identity_artifact_id":"official-"+str(evidence.get("source_id")), "derived_artifact_id":"derived-test-ledger"})
        self.write_jsonl("population/source-artifact-bindings.jsonl", sorted(bindings, key=lambda item: (item["company_id"], item["kind"])))
        self.write_json("population/international-coverage-gaps.json", {"panel": PANEL, "selected_population": {"jurisdiction": "US", "count": 1000, "source": "strict US-incorporated and US principal-business-address SEC 10-K filers"}, "representativeness": "Protocol-bounded test population; not globally representative, not all SEC filers, and not a source rank.", "coverage_gaps": [{"jurisdiction": country, "status": "not_materialized", "selected_count": 0} for country in PANEL if country != "US"]})
        self.write_jsonl("companies.jsonl", self.companies)
        self.write_jsonl("benefit-claims.jsonl", self.claims)
        self.write_jsonl("reviews.jsonl", self.reviews)
        self.write_jsonl("corrections.jsonl", [])
        self.refresh_manifests()
        try:
            company_benefits_series.materialize_contract(
                self.root, {"domestic-01"}, "2026-10-21T00:00:00Z", "bob"
            )
        except ValueError:
            # Mutation tests intentionally write invalid population sizes; the verifier must report them.
            pass


# Backwards-compatible test helper name while callers migrate.
FrozenFixture = ContractFixture
