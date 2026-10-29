import hashlib
import json
from pathlib import Path

PANEL = ["US", "CA", "MX", "BR", "AR", "GB", "FR", "DE", "IT", "TR", "RU", "AU", "CN", "IN", "ID", "JP", "SA", "ZA"]


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def jsonl_bytes(values):
    return b"".join(json_bytes(value) + b"\n" for value in values)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def selection_hash(seed, company):
    return sha(json_bytes([seed, company["jurisdiction"], company["registry_id"], company["legal_name"]]))


def audited_source(source_id, supported_fields, source_type="regulator_filing"):
    return {
        "source_id": source_id,
        "title": f"Official {source_id}",
        "owner": "Official regulator",
        "source_type": source_type,
        "jurisdiction": "INT",
        "url": f"https://example.gov/{source_id}",
        "locator": "section 1",
        "supporting_quote": "Official evidence",
        "content_sha256": "a" * 64,
        "access_model": "public_keyless",
        "authentication": {"api_key": False, "login": False, "fee": False},
        "terms_url": "https://example.gov/terms",
        "reuse_decision": "allowed_with_attribution",
        "decisions": {"extract": "allowed", "quote": "allowed", "retention": "metadata_only", "snapshot": "prohibited", "attribution": "required"},
        "supported_fields": supported_fields,
        "evidence_eligibility": "A",
        "checked_at": "2026-10-20T00:00:00Z",
        "http_verification": {"status": 200, "redirect_chain": [], "content_type": "text/html", "final_url": f"https://example.gov/{source_id}", "final_owner_domain": "example.gov", "access_wall": "none", "expected_marker": "Official"},
        "current_blocker": None,
    }


class FrozenFixture:
    def __init__(self, root):
        self.root = Path(root)
        self.population = self.root / "population"
        self.population.mkdir(parents=True, exist_ok=True)
        self.seed = "fixture-seed"
        self.sources = [
            audited_source("scale-source", ["revenue", "total_assets", "legal_entity", "fiscal_year_end"]),
            audited_source("benefit-source", ["benefit_claim"]),
        ]
        registered_sources = {
            "KR": [{"source_id": "scale-source", "endpoint": "https://example.gov/scale-source"}],
            **{country: [{"source_id": "scale-source", "endpoint": "https://example.gov/scale-source"}] for country in PANEL},
        }
        self.protocol = {
            "protocol_id": "fixture-v1", "version": "1.0.0", "status": "approved",
            "approval": {"approved_by": "owner", "approved_at": "2026-10-21T00:00:00Z"},
            "cutoff_at": "2026-10-29T00:00:00Z", "purpose": "fixture", "non_ranking_statement": "not a ranking",
            "scopes": {
                "domestic": {"jurisdictions": ["KR"], "target_count": 1000, "candidate_source_ids": ["scale-source"]},
                "international": {"excluded_jurisdiction": "KR", "target_count": 1000, "country_panel": PANEL, "candidate_source_ids_by_jurisdiction": {country: ["scale-source"] for country in PANEL}},
            },
            "registered_sources": registered_sources,
            "classification": {"selection_unit": "selected_employer_legal_entity", "domestic_rule": "incorporated and registered in KR", "international_rule": "incorporated and registered outside KR", "separate_roles": ["selected_employer_legal_entity", "financial_consolidation_parent", "ultimate_parent", "benefit_policy_owner"], "related_entity_rule": "separate scale and benefit evidence required"},
            "thresholds": {
                "domestic_non_financial": {"metric": "revenue", "minimum": 100000000000, "currency": "KRW"},
                "international_non_financial": {"metric": "revenue", "minimum": 1000000000, "currency": "USD"},
                "domestic_financial": {"metric": "total_assets", "minimum": 10000000000000, "currency": "KRW"},
                "international_financial": {"metric": "total_assets", "minimum": 10000000000, "currency": "USD"},
                "maximum_fiscal_age_months": 24,
            },
            "currency_conversion": {"source_id": "scale-source", "source_owner": "Official regulator", "indicator": "FX", "url": "https://example.gov/scale-source", "rule": "preserve original and prove conversion"},
            "source_precedence": ["regulator_filing", "government_register", "official_company_report"],
            "canonical_selection": {"seed": self.seed, "order": "selection_hash_ascending", "replacement_rule": "next_unused_eligible"},
            "immutable_model": {
                "eligible_ledgers": ["population/domestic-eligible.jsonl", "population/international-eligible.jsonl"],
                "selected_ledgers": ["population/domestic-selected.jsonl", "population/international-selected.jsonl"],
                "initial_effective_ledgers": ["population/domestic-initial-effective-selected.jsonl", "population/international-initial-effective-selected.jsonl"],
                "effective_ledgers": ["population/domestic-effective-selected.jsonl", "population/international-effective-selected.jsonl"],
                "event_ledger": "population/effective-selection-events.jsonl", "freeze_manifest": "population/freeze-manifest.json", "effective_manifest": "population/effective-selection-manifest.json",
            },
            "coverage_gap": {"KR": "none", **{country: "none" for country in PANEL}}, "blockers": [],
            "forbidden_while_blocked": ["population/domestic-eligible.jsonl", "population/international-eligible.jsonl", "population/domestic-selected.jsonl", "population/international-selected.jsonl", "population/domestic-initial-effective-selected.jsonl", "population/international-initial-effective-selected.jsonl", "population/domestic-effective-selected.jsonl", "population/international-effective-selected.jsonl", "population/effective-selection-events.jsonl", "population/freeze-manifest.json", "population/effective-selection-manifest.json"],
        }
        self.eligible = {"domestic": self._companies("domestic", 1001), "international": self._companies("international", 1001)}
        self.selected = {scope: records[:1000] for scope, records in self.eligible.items()}
        self.events = []
        self.current = {scope: list(records) for scope, records in self.selected.items()}
        self.companies = self.current["domestic"] + self.current["international"]
        self.claims = [self._claim(company) for company in self.current["domestic"][:25]]
        self.reviews = [{"review_id": f"review-{i:04d}", "claim_id": claim["claim_id"], "researcher_id": "alice", "reviewer_id": "bob", "decision": "approved", "reviewed_at": "2026-10-21T00:00:00Z", "issues": [], "resolution": "accepted"} for i, claim in enumerate(self.claims)]
        self.write_all()

    def _companies(self, scope, count):
        records = []
        for index in range(count):
            jurisdiction = "KR" if scope == "domestic" else PANEL[index % len(PANEL)]
            company = {
                "company_id": f"{scope}-{index:04d}", "jurisdiction": jurisdiction, "incorporation_country": jurisdiction,
                "scope": scope, "registry_id": f"{scope[:1]}-{index:06d}", "legal_name": f"{scope.title()} Employer {index:04d}",
                "selected_employer_legal_entity": f"{scope.title()} Employer {index:04d}", "registered_head_office_country": jurisdiction,
                "financial_consolidation_parent": None, "ultimate_parent": None, "benefit_policy_owner": f"{scope.title()} Employer {index:04d}",
                "related_company_exception": None, "entity_status": "active", "sector": "non_financial",
                "scale_metric": {"type": "revenue", "value": 200000000000 if scope == "domestic" else 2000000000, "currency": "KRW" if scope == "domestic" else "USD", "original_value": 200000000000 if scope == "domestic" else 2000000000, "original_currency": "KRW" if scope == "domestic" else "USD", "conversion": None, "fiscal_year_end": "2025-12-31", "financial_scope": "standalone", "source_ids": ["scale-source"]},
            }
            company["selection_hash"] = selection_hash(self.seed, company)
            records.append(company)
        return sorted(records, key=lambda item: (item["selection_hash"], json_bytes([self.seed, item["jurisdiction"], item["registry_id"], item["legal_name"]])))

    def _claim(self, company):
        return {"claim_id": "claim-" + company["company_id"], "company_id": company["company_id"], "benefit_name": "Leave", "detail": "Paid leave is offered.", "status": "confirmed", "evidence_grade": "A", "source_ids": ["benefit-source"], "application_scope": {"countries": ["KR"], "legal_entities": [company["legal_name"]], "roles": ["all"], "employment_types": ["full_time"], "tenure_condition": "none"}, "publication_date": "2026-01-01", "checked_at": "2026-10-20", "prepublication_checked_at": "2026-10-20", "source_locator": "benefits", "supporting_quote": "Paid leave is offered.", "content_sha256": "b" * 64}

    def write_json(self, relative, value):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(json_bytes(value))

    def write_jsonl(self, relative, values):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(jsonl_bytes(values))

    def refresh_manifests(self):
        effective_entries = []
        for relative in ["population/domestic-initial-effective-selected.jsonl", "population/international-initial-effective-selected.jsonl", "population/domestic-effective-selected.jsonl", "population/international-effective-selected.jsonl", "population/effective-selection-events.jsonl"]:
            data = (self.root / relative).read_bytes()
            effective_entries.append({"path": relative, "sha256": sha(data), "count": len(data.splitlines())})
        effective = {"status": "approved", "approved_by": "owner", "approved_at": "2026-10-21T00:00:00Z", "artifacts": effective_entries}
        self.write_json("population/effective-selection-manifest.json", effective)
        freeze_entries = []
        for relative in ["population-protocol.json", "population/domestic-eligible.jsonl", "population/international-eligible.jsonl", "population/domestic-selected.jsonl", "population/international-selected.jsonl", "population/domestic-initial-effective-selected.jsonl", "population/international-initial-effective-selected.jsonl", "population/domestic-effective-selected.jsonl", "population/international-effective-selected.jsonl", "population/effective-selection-events.jsonl", "population/effective-selection-manifest.json"]:
            data = (self.root / relative).read_bytes()
            count = 1 if relative.endswith(".json") else len(data.splitlines())
            freeze_entries.append({"path": relative, "sha256": sha(data), "count": count})
        self.write_json("population/freeze-manifest.json", {"status": "approved", "approved_by": "owner", "approved_at": "2026-10-21T00:00:00Z", "artifacts": freeze_entries})

    def write_all(self):
        self.write_json("population-protocol.json", self.protocol)
        self.write_jsonl("source-registry.jsonl", self.sources)
        for scope in ("domestic", "international"):
            self.write_jsonl(f"population/{scope}-eligible.jsonl", self.eligible[scope])
            self.write_jsonl(f"population/{scope}-selected.jsonl", self.selected[scope])
            self.write_jsonl(f"population/{scope}-initial-effective-selected.jsonl", self.selected[scope])
            self.write_jsonl(f"population/{scope}-effective-selected.jsonl", self.current[scope])
        self.write_jsonl("population/effective-selection-events.jsonl", self.events)
        self.write_jsonl("companies.jsonl", self.companies)
        self.write_jsonl("benefit-claims.jsonl", self.claims)
        self.write_jsonl("reviews.jsonl", self.reviews)
        self.write_jsonl("corrections.jsonl", [])
        self.refresh_manifests()
