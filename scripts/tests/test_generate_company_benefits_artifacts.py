import copy
import hashlib
import importlib.util
import inspect
import io
import json
import shutil
import tempfile
import time
import unittest
from contextlib import contextmanager, nullcontext, redirect_stderr, redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from scripts import company_benefits_series as series
from scripts.tests.benefits_v2_batch_fixture import no_public_info_records

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts" / "generate-company-benefits-artifacts.py"
TAXONOMY = REPO / "docs" / "research" / "company-benefits" / "benefit-taxonomy-v1.json"
ASSIGNMENT_VALIDATOR = REPO / "scripts" / "validate-benefit-taxonomy-assignments.py"


@contextmanager
def raises(error):
    try:
        yield
    except error:
        return
    expected = ", ".join(item.__name__ for item in error) if isinstance(error, tuple) else error.__name__
    raise AssertionError(f"expected {expected}")


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(compact(value).encode()).hexdigest()


def file_digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(compact(value), encoding="utf-8")


def write_jsonl(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(compact(row) + "\n" for row in rows), encoding="utf-8")


def write_taxonomy_approval(root, decision=None):
    """Write one current-contract request and its independent approval."""
    claim = json.loads((root / "benefit-claims.jsonl").read_text(encoding="utf-8").splitlines()[0])
    sources = {
        row["source_id"]: row
        for row in map(json.loads, (root / "source-registry.jsonl").read_text(encoding="utf-8").splitlines())
    }
    reviews = {
        row["claim_id"]: row
        for row in map(json.loads, (root / "reviews.jsonl").read_text(encoding="utf-8").splitlines())
        if "claim_id" in row
    }
    checks = {
        row["source_id"]: row
        for row in map(json.loads, (root / "series-prepublication-checks.jsonl").read_text(encoding="utf-8").splitlines())
    }
    source_ids = claim["source_ids"] + claim.get("searched_source_ids", [])
    taxonomy_sha256 = file_digest(TAXONOMY)
    requested_decision = decision or {"state": "classified", "benefit_type_ids": ["paid-leave"]}
    bindings = {
        "record_byte_contract": "exact_utf8_jsonl_record_excluding_lf_terminator",
        "claim_record_sha256": digest(claim),
        "source_records": [
            {"source_id": source_id, "record_sha256": digest(sources[source_id])}
            for source_id in source_ids
        ],
        "factual_review_record": {
            "review_id": reviews[claim["claim_id"]]["review_id"],
            "record_sha256": digest(reviews[claim["claim_id"]]),
        },
        "prepublication_check_records": [
            {"source_id": source_id, "record_sha256": digest(checks[source_id])}
            for source_id in source_ids
        ],
    }
    request = {
        "request_id": f"benefit-taxonomy-assignment::{claim['claim_id']}",
        "claim_id": claim["claim_id"],
        "taxonomy_version": "benefit-taxonomy-v1",
        "taxonomy_sha256": taxonomy_sha256,
        "assignment": requested_decision,
        "bindings": bindings,
        "requested_by": "deterministic-benefit-taxonomy-generator-v1",
        "requested_at": "2026-10-30T02:15:00Z",
        "review_status": "review_pending",
    }
    request["request_sha256"] = digest(request)
    if requested_decision["state"] == "classified":
        outcome = {
            "state": "assigned",
            "category_ids": ["leave"],
            "benefit_type_ids": requested_decision["benefit_type_ids"],
        }
    else:
        outcome = {"state": "unclassified", "reason": requested_decision["reason_code"]}
    approval = {
        "request_id": request["request_id"],
        "request_sha256": request["request_sha256"],
        "claim_id": claim["claim_id"],
        "assignment": outcome,
        "taxonomy_version": request["taxonomy_version"],
        "taxonomy_sha256": taxonomy_sha256,
        "bindings": copy.deepcopy(bindings),
        "researcher_id": request["requested_by"],
        "reviewer_id": "taxonomy-reviewer-c",
        "reviewed_at": "2026-10-30T02:30:00Z",
        "decision": "approved",
    }
    write_jsonl(root / "benefit-taxonomy-assignment-requests.jsonl", [request])
    write_jsonl(root / "benefit-taxonomy-assignments.jsonl", [approval])
    return request, approval


def assignment_validation_args(module, root, taxonomy):
    return (
        [json.loads(line) for line in (root / "benefit-taxonomy-assignment-requests.jsonl").read_text().splitlines()],
        module.read_jsonl_records(root / "benefit-claims.jsonl"),
        module.read_jsonl_records(root / "source-registry.jsonl"),
        module.read_jsonl_records(root / "reviews.jsonl"),
        module.read_jsonl_records(root / "series-prepublication-checks.jsonl"),
        taxonomy,
        file_digest(TAXONOMY),
    )


def make_research_fixture(root, v2=True):
    companies = []
    for index in range(2000):
        domestic = index < 1000
        companies.append({
            "company_id": f"KR-CRN-{index:013d}" if domestic else f"US-CIK{index:010d}",
            "legal_name": f"Verified Employer {index:04d}",
            "selected_reporting_legal_entity": f"Verified Employer {index:04d}",
            "jurisdiction": "KR" if domestic else "US",
            "scope": "domestic" if domestic else "international",
        })
    claim = {
        "claim_id": "claim-current-1",
        "company_id": companies[0]["company_id"],
        "benefit_name": "Paid leave",
        "detail": "Employees receive paid leave.",
        "status": "confirmed",
        "current_validity": "current",
        "evidence_grade": "A",
        "source_ids": ["source-1"],
        "source_evidence": [{
            "source_id": "source-1",
            "role": "primary_claim_evidence",
            "proposition": "Employees receive paid leave.",
            "source_locator": "benefits section",
            "supporting_quote": "Employees receive paid leave.",
            "content_sha256": "a" * 64,
        }],
        "application_scope": {
            "countries": ["KR"],
            "legal_entities": [companies[0]["legal_name"]],
            "roles": ["all employees"],
            "employment_types": ["full_time"],
            "tenure_condition": "none",
        },
        "publication_date": "2026-01-01",
        "checked_at": "2026-10-30",
        "researched_at": "2026-10-29T00:00:00Z",
        "prepublication_checked_at": "2026-10-30T02:00:00Z",
        "source_locator": "benefits section",
        "supporting_quote": "Employees receive paid leave.",
        "content_sha256": "a" * 64,
    }
    source = {
        "source_id": "source-1",
        "title": "Official benefits",
        "owner": companies[0]["legal_name"],
        "source_type": "official_company_report",
        "jurisdiction": "KR",
        "url": "https://verified.example.gov/benefits",
        "locator": "benefits section",
        "supporting_quote": "Employees receive paid leave.",
        "content_sha256": "a" * 64,
        "publication_date": "2026-01-01",
        "checked_at": "2026-10-30T02:00:00Z",
        "evidence_eligibility": "A",
    }
    gap_source = {
        "record_type": "nonpublishable_metadata",
        "source_id": "official-exact-entity-discovery-route",
        "title": "Official exact-entity discovery route",
        "owner": "Official registry",
        "source_type": "government_register",
        "jurisdiction": "KR",
        "url": "https://verified.example.gov/entity-search",
        "checked_at": "2026-10-30T02:00:00Z",
        "route_quality": "exact_entity",
        "publication_eligible": False,
        "nonpublication_reason": "Exact-entity discovery metadata is not publishable benefit evidence.",
        "entity_binding_status": "exact_entity",
        "retention_mode": "metadata_only",
        "reuse_status": "discovery_only",
        "access_observation": {"status": 200, "final_url": "https://verified.example.gov/entity-search",
                               "access_wall": "none"},
    }
    claim_review = {
        "review_id": "review-claim-current-1",
        "claim_id": claim["claim_id"],
        "researcher_id": "researcher-a",
        "reviewer_id": "reviewer-b",
        "decision": "approved",
        "reviewed_at": "2026-10-30T01:00:00Z",
        "quote_entailment_confirmed": True,
        "source_entailment_reviews": [{
            "source_id": "source-1", "reviewed_role": "primary_claim_evidence",
            "reviewed_proposition": claim["detail"], "source_locator": claim["source_locator"],
            "reviewed_quote": claim["supporting_quote"], "content_sha256": claim["content_sha256"],
            "entailment_confirmed": True, "reviewer_id": "reviewer-b",
        }],
    }
    gaps = []
    gap_reviews = []
    for company in companies[1:]:
        gap_id = f"company-gap::{company['company_id']}"
        gaps.append({
            "audit_id": gap_id,
            "company_id": company["company_id"],
            "disposition": "nonpublishable",
            "reason_code": "not_researched",
            "nonabsence_wording": "공개 근거가 충분하지 않으며 복지가 없다는 뜻이 아닙니다.",
            "searched_official_source_ids": [gap_source["source_id"]],
            "searched_official_urls": [],
            "searched_at": None,
        })
        gap_reviews.append({
            "review_id": "review-" + gap_id,
            "record_id": gap_id,
            "researcher_id": "researcher-a",
            "reviewer_id": "reviewer-b",
            "decision": "approved",
            "reviewed_at": "2026-10-30T01:00:00Z",
            "quote_entailment_confirmed": True,
        })
    batches = []
    progress_entries = []
    v2_records = {ledger: [] for ledger in series.V2_LEDGER_FILES}
    for index in range(80):
        ids = [company["company_id"] for company in companies[index * 25:(index + 1) * 25]]
        batch_id = ("domestic" if index < 40 else "international") + f"-{index % 40 + 1:02d}"
        scope = "domestic" if index < 40 else "international"
        batch_hash = hashlib.sha256(compact(ids).encode()).hexdigest()
        batches.append({"batch_id": batch_id, "scope": scope, "batch_number": index % 40 + 1,
                        "company_list_sha256": batch_hash, "company_ids": ids})
        entry = {
            "batch_id": batch_id,
            "scope": scope,
            "batch_number": index % 40 + 1,
            "status": "approved",
            "company_list_sha256": batch_hash,
            "claim_count": 1 if index == 0 else 0,
            "no_claim_count": 24 if index == 0 else 25,
            "approved_at": "2026-10-30T03:00:00Z",
            "reviewer_ids": ["reviewer-b"],
        }
        if v2:
            batch_records = no_public_info_records(batches[-1], companies[index * 25:(index + 1) * 25])
            for ledger in v2_records:
                v2_records[ledger].extend(batch_records[ledger])
            batch_cells = batch_records["cells"]
            identities = sorted((cell["company_id"], cell["category_id"]) for cell in batch_cells)
            entry.update(
                cell_count=250,
                cell_set_sha256=hashlib.sha256(compact(identities).encode()).hexdigest(),
                v2_ledger_sha256=series.v2_ledger_sha256(batch_records),
            )
        progress_entries.append(entry)

    write_jsonl(root / "companies.jsonl", companies)
    write_jsonl(root / "benefit-claims.jsonl", [claim])
    write_jsonl(root / "reviews.jsonl", [claim_review, *gap_reviews])
    write_jsonl(root / "series-research-gaps.jsonl", gaps)
    write_jsonl(root / "source-registry.jsonl", [source, gap_source])
    write_jsonl(root / "series-prepublication-checks.jsonl", [{
        "source_id": "source-1",
        "url": source["url"],
        "status": 200,
        "final_url": source["url"],
        "marker_confirmed": True,
        "content_sha256": source["content_sha256"],
        "checked_at": "2026-10-30T02:00:00Z",
    }, {
        "source_id": gap_source["source_id"], "url": gap_source["url"],
        **gap_source["access_observation"], "checked_at": "2026-10-30T02:00:00Z",
    }])
    write_jsonl(root / "series-batches.jsonl", batches)
    progress = {
        "manifest_version": "1",
        "status": "complete",
        "company_list_sha256": hashlib.sha256(compact([company["company_id"] for company in companies]).encode()).hexdigest(),
        "total_companies": 2000,
        "total_batches": 80,
        "batches": progress_entries,
    }
    if v2:
        progress.update(progress_version="2", total_cells=20000)
        for ledger, filename in series.V2_LEDGER_FILES.items():
            write_jsonl(root / filename, v2_records[ledger])
    write_json(root / "series-progress.json", progress)
    request, assignment = write_taxonomy_approval(root)
    write_json(root / "population-protocol.json", {
        "protocol_id": "company-benefits-population-v4", "version": "4.0.0",
    })
    write_json(root / "population" / "effective-selection-manifest.json", {"status": "approved"})
    return {"companies": companies, "claim": claim, "request": request, "assignment": assignment}


def run_generator(research, output):
    spec = importlib.util.spec_from_file_location(f"artifact_cli_{output.name}", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    stdout, stderr = io.StringIO(), io.StringIO()
    argv = [
        "--research-root", str(research),
        "--output-root", str(output),
        "--taxonomy", str(TAXONOMY),
        "--data-version", "2026-10-30-v2",
        "--generated-at", "2026-10-30T04:00:00Z",
        "--as-of", "2026-10-31",
        "--freeze-anchor-receipt", str(research.parent / "freeze.json"),
        "--effective-selection-receipt", str(research.parent / "effective.json"),
    ]
    def verify_v2_gate(*_args, **_kwargs):
        module.load_verifier().company_benefits_series.validate_complete_v2_progress(research)

    with mock.patch.object(module, "verify_active_ledgers", side_effect=verify_v2_gate), \
         redirect_stdout(stdout), redirect_stderr(stderr):
        returncode = module.main(argv)
    return SimpleNamespace(returncode=returncode, stdout=stdout.getvalue(), stderr=stderr.getvalue())


def external_receipts(research, directory):
    protocol = json.loads((research / "population-protocol.json").read_text())
    population = research / "population"
    freeze_hash = file_digest(population / "freeze-manifest.json")
    freeze = directory / "freeze-receipt.json"
    effective = directory / "effective-receipt.json"
    write_json(freeze, {
        "schema_version": "1", "protocol_version": protocol["version"],
        "freeze_manifest_sha256": freeze_hash, "review_status": "approved",
        "issued_at": "2026-10-31T00:00:00Z",
    })
    events = series.read_jsonl(population / "effective-selection-events.jsonl")
    latest_scope = events[-1]["scope"] if events else "domestic"
    write_json(effective, {
        "schema_version": "1", "protocol_version": protocol["version"],
        "freeze_manifest_sha256": freeze_hash,
        "effective_manifest_sha256": file_digest(population / "effective-selection-manifest.json"),
        "domestic_effective_sequence_sha256": file_digest(population / "domestic-effective-selected.jsonl"),
        "international_effective_sequence_sha256": file_digest(population / "international-effective-selected.jsonl"),
        "replacement_events_sha256": file_digest(population / "effective-selection-events.jsonl"),
        "candidate_effective_sha256": file_digest(population / f"{latest_scope}-effective-selected.jsonl"),
        "review_status": "approved", "issued_at": "2026-10-31T00:00:00Z",
    })
    return freeze, effective


def run_real_generator(research, output, receipt_dir, authoritative_calls=None,
                       batch_scans=None, ledger_reads=None):
    spec = importlib.util.spec_from_file_location(f"artifact_real_cli_{output.name}", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    freeze, effective = external_receipts(research, receipt_dir)
    stdout, stderr = io.StringIO(), io.StringIO()
    argv = [
        "--research-root", str(research), "--output-root", str(output),
        "--taxonomy", str(TAXONOMY), "--data-version", "2026-10-31-real-v2",
        "--generated-at", "2026-10-31T04:00:00Z", "--as-of", "2026-10-31",
        "--freeze-anchor-receipt", str(freeze),
        "--effective-selection-receipt", str(effective),
    ]
    runtime_series = module.load_verifier().company_benefits_series
    patcher = (
        mock.patch.object(runtime_series, "validate_v2_authoritative_records",
                          wraps=runtime_series.validate_v2_authoritative_records)
        if authoritative_calls is not None else nullcontext()
    )
    scan_patcher = (
        mock.patch.object(runtime_series, "v2_batch_slice",
                          wraps=runtime_series.v2_batch_slice)
        if batch_scans is not None else nullcontext()
    )
    read_patcher = (
        mock.patch.object(runtime_series, "read_v2_batch_records",
                          wraps=runtime_series.read_v2_batch_records)
        if ledger_reads is not None else nullcontext()
    )
    with patcher as spy, scan_patcher as scan_spy, read_patcher as read_spy, \
            redirect_stdout(stdout), redirect_stderr(stderr):
        started = time.monotonic()
        returncode = module.main(argv)
        elapsed = time.monotonic() - started
    if authoritative_calls is not None:
        authoritative_calls.append(spy.call_count)
    if batch_scans is not None:
        batch_scans.append(getattr(scan_spy, "call_count", 0))
    if ledger_reads is not None:
        ledger_reads.append(getattr(read_spy, "call_count", 0))
    return SimpleNamespace(returncode=returncode, stdout=stdout.getvalue(),
                           stderr=stderr.getvalue(), elapsed=elapsed)


def make_real_v2_research_fixture(destination):
    source = REPO / "docs" / "research" / "company-benefits"
    shutil.copytree(source, destination)
    companies = {row["company_id"]: row for row in series.read_jsonl(destination / "companies.jsonl")}
    batches = series.read_jsonl(destination / "series-batches.jsonl")
    records = {ledger: [] for ledger in series.V2_LEDGER_FILES}
    progress = json.loads((destination / "series-progress.json").read_text())
    entries = {entry["batch_id"]: entry for entry in progress["batches"]}
    for batch in batches:
        batch_records = no_public_info_records(
            batch, [companies[company_id] for company_id in batch["company_ids"]]
        )
        for ledger in records:
            records[ledger].extend(batch_records[ledger])
        entry = entries[batch["batch_id"]]
        entry.update(
            cell_count=250,
            cell_set_sha256=series.v2_cell_set_sha256(batch_records["cells"]),
            v2_ledger_sha256=series.v2_ledger_sha256(batch_records),
        )
    for ledger, filename in series.V2_LEDGER_FILES.items():
        write_jsonl(destination / filename, records[ledger])
    progress.update(progress_version="2", total_cells=20000)
    write_json(destination / "series-progress.json", progress)
    return destination


def snapshot(root):
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(root.rglob("*")) if path.is_file()
    }


def refresh_v2_progress_hashes(root):
    batches = [json.loads(line) for line in (root / "series-batches.jsonl").read_text().splitlines()]
    records = series.read_v2_batch_records(root)
    progress = json.loads((root / "series-progress.json").read_text())
    entries = {entry["batch_id"]: entry for entry in progress["batches"]}
    for batch in batches:
        sliced = series.v2_batch_slice(records, batch)
        entry = entries[batch["batch_id"]]
        entry["cell_set_sha256"] = series.v2_cell_set_sha256(sliced["cells"])
        entry["v2_ledger_sha256"] = series.v2_ledger_sha256(sliced)
    write_json(root / "series-progress.json", progress)


def forbidden_keys(value):
    found = []
    if isinstance(value, dict):
        for key, child in value.items():
            if any(token in key.casefold() for token in ("score", "rank", "percentile", "coverage")):
                found.append(key)
            found.extend(forbidden_keys(child))
    elif isinstance(value, list):
        for child in value:
            found.extend(forbidden_keys(child))
    return found


def internal_review_keys(value):
    prohibited = {
        "review", "review_id", "researcher_id", "reviewer_id", "reviewed_at",
        "requested_at", "review_status", "decision", "quote_entailment_confirmed",
        "source_entailment_reviews", "conflict_determination", "approval",
        "approval_status", "approved", "approved_at", "approved_by",
    }
    found = []
    if isinstance(value, dict):
        for key, child in value.items():
            if key in prohibited:
                found.append(key)
            found.extend(internal_review_keys(child))
    elif isinstance(value, list):
        for child in value:
            found.extend(internal_review_keys(child))
    return found


def test_taxonomy_has_reviewed_shape_and_conservative_dol_mappings():
    taxonomy = json.loads(TAXONOMY.read_text(encoding="utf-8"))
    assert len(taxonomy["categories"]) == 10
    assert len(taxonomy["benefit_types"]) == 45
    assert len({item["id"] for item in taxonomy["categories"]}) == 10
    assert len({item["id"] for item in taxonomy["benefit_types"]}) == 45
    assert {item["category_id"] for item in taxonomy["benefit_types"]} == {item["id"] for item in taxonomy["categories"]}
    assert len({(item["field"], item["code"]) for item in taxonomy["dol_form_5500_mappings"]}) == 9
    assert all(item["forced_status"] == "bounded" for item in taxonomy["dol_form_5500_mappings"])
    assert all(item["evidence_semantics"] == "historical_named_plan_feature_only" for item in taxonomy["dol_form_5500_mappings"])


def test_assignment_validator_requires_hash_bound_independent_approval(tmp_path):
    fixture = make_research_fixture(tmp_path / "research")
    module_spec = importlib.util.spec_from_file_location("taxonomy_assignments", ASSIGNMENT_VALIDATOR)
    assert module_spec is not None and module_spec.loader is not None
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    taxonomy = json.loads(TAXONOMY.read_text(encoding="utf-8"))
    args = assignment_validation_args(module, tmp_path / "research", taxonomy)
    assert module.validate_assignments([fixture["assignment"]], *args) == {fixture["claim"]["claim_id"]: fixture["assignment"]}
    for field, value in (
        ("decision", "pending"),
        ("reviewer_id", fixture["assignment"]["researcher_id"]),
        ("request_sha256", "0" * 64),
    ):
        invalid = copy.deepcopy(fixture["assignment"])
        invalid[field] = value
        with raises(ValueError):
            module.validate_assignments([invalid], *args)


def test_assignment_validator_accepts_reviewed_unclassified_outcome_without_inventing_type(tmp_path):
    fixture = make_research_fixture(tmp_path / "research")
    module_spec = importlib.util.spec_from_file_location("taxonomy_assignments_union", ASSIGNMENT_VALIDATOR)
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    _, assignment = write_taxonomy_approval(
        tmp_path / "research",
        {"state": "unclassified", "benefit_type_ids": [], "reason_code": "no_unambiguous_taxonomy_match"},
    )
    taxonomy = json.loads(TAXONOMY.read_text(encoding="utf-8"))
    args = assignment_validation_args(module, tmp_path / "research", taxonomy)
    assert module.validate_assignments([assignment], *args) == {fixture["claim"]["claim_id"]: assignment}
    invalid = copy.deepcopy(assignment)
    invalid["assignment"]["reason"] = ""
    with raises(ValueError):
        module.validate_assignments([invalid], *args)


def test_source_check_coverage_includes_claim_searched_routes_and_rejects_missing_or_extra(tmp_path):
    research = tmp_path / "research"
    fixture = make_research_fixture(research)
    module_spec = importlib.util.spec_from_file_location("artifact_source_union", SCRIPT)
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    taxonomy = json.loads(TAXONOMY.read_text(encoding="utf-8"))
    registry = [json.loads(line) for line in (research / "source-registry.jsonl").read_text().splitlines()]
    searched_source = copy.deepcopy(registry[0])
    searched_source.update(source_id="searched-route", url="https://verified.example.gov/search")
    claim = fixture["claim"]
    claim["searched_source_ids"] = ["searched-route"]
    write_jsonl(research / "benefit-claims.jsonl", [claim])
    write_jsonl(research / "source-registry.jsonl", [*registry, searched_source])
    with raises(ValueError):
        module.validate_inputs(research, taxonomy, file_digest(TAXONOMY))
    checks = [json.loads(line) for line in (research / "series-prepublication-checks.jsonl").read_text().splitlines()]
    searched_check = copy.deepcopy(checks[0])
    searched_check.update(source_id="searched-route", url=searched_source["url"], final_url=searched_source["url"])
    write_jsonl(research / "series-prepublication-checks.jsonl", [*checks, searched_check])
    write_taxonomy_approval(research)
    module.validate_inputs(research, taxonomy, file_digest(TAXONOMY))
    extra = copy.deepcopy(searched_check)
    extra["source_id"] = "extra-route"
    write_jsonl(research / "series-prepublication-checks.jsonl", [*checks, searched_check, extra])
    with raises(ValueError):
        module.validate_inputs(research, taxonomy, file_digest(TAXONOMY))


def test_artifact_preflight_delegates_to_protocol4_verifier_with_both_external_receipts(tmp_path):
    module_spec = importlib.util.spec_from_file_location("artifact_preflight", SCRIPT)
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    verifier = mock.Mock()
    verifier.verify_workspace.return_value = []
    freeze = tmp_path / "freeze.json"
    effective = tmp_path / "effective.json"
    with mock.patch.object(module, "load_verifier", return_value=verifier):
        assert module.verify_active_ledgers(
            tmp_path / "research", "2026-10-31", freeze, effective
        ) is None
    verifier.verify_workspace.assert_called_once_with(
        tmp_path / "research", as_of="2026-10-31",
        freeze_anchor_receipt=freeze, effective_selection_receipt=effective,
    )


def test_artifact_generation_rejects_gap_without_preserved_official_source_id_route(tmp_path):
    research = tmp_path / "research"
    make_research_fixture(research)
    gaps = [json.loads(line) for line in (research / "series-research-gaps.jsonl").read_text().splitlines()]
    gaps[0]["searched_official_source_ids"] = []
    write_jsonl(research / "series-research-gaps.jsonl", gaps)
    result = run_generator(research, tmp_path / "output")
    assert result.returncode != 0
    assert "official source-id route" in result.stderr.casefold()
    assert not (tmp_path / "output").exists()


def test_artifact_publication_rejects_mixed_legacy_and_v2_approved_progress_before_writes(tmp_path):
    research = tmp_path / "research"
    make_research_fixture(research, v2=False)
    progress = json.loads((research / "series-progress.json").read_text())
    progress["progress_version"] = "2"
    progress["total_cells"] = 20000
    progress["batches"][1].update(
        cell_count=250,
        cell_set_sha256="a" * 64,
        v2_ledger_sha256={name: "b" * 64 for name in (
            "company-category-cells.jsonl", "research-attempts.jsonl",
            "official-claims-v2.jsonl", "reference-records.jsonl",
            "community-benefit-reports.jsonl", "sources-v2.jsonl",
        )},
    )
    write_json(research / "series-progress.json", progress)
    output = tmp_path / "mixed-output"

    result = run_generator(research, output)

    assert result.returncode != 0
    assert any(token in result.stderr.casefold() for token in ("legacy", "250", "v2 progress"))
    assert not output.exists()


def test_artifact_publication_rejects_wholly_legacy_complete_progress_before_writes(tmp_path):
    research = tmp_path / "research"
    make_research_fixture(research, v2=False)
    output = tmp_path / "legacy-output"

    result = run_generator(research, output)

    assert result.returncode != 0
    assert "progress_version" in result.stderr or "v2" in result.stderr.casefold()
    assert not output.exists()


def test_artifact_publication_verifies_all_six_v2_ledger_hashes_before_writes(tmp_path):
    research = tmp_path / "research"
    make_research_fixture(research)
    progress = json.loads((research / "series-progress.json").read_text())
    progress["batches"][0]["v2_ledger_sha256"]["sources-v2.jsonl"] = "0" * 64
    write_json(research / "series-progress.json", progress)
    output = tmp_path / "hash-mismatch-output"

    result = run_generator(research, output)

    assert result.returncode != 0
    assert "hash mismatch" in result.stderr.casefold()
    assert not output.exists()


def test_artifact_publication_rejects_80_replays_of_one_progress_batch_before_writes(tmp_path):
    research = tmp_path / "research"
    make_research_fixture(research)
    progress = json.loads((research / "series-progress.json").read_text())
    progress["batches"] = [copy.deepcopy(progress["batches"][0]) for _ in range(80)]
    write_json(research / "series-progress.json", progress)
    output = tmp_path / "duplicate-progress-output"

    result = run_generator(research, output)

    assert result.returncode != 0
    assert not output.exists()


def test_artifact_publication_rejects_missing_or_substituted_progress_batch_before_writes(tmp_path):
    research = tmp_path / "research"
    make_research_fixture(research)
    progress = json.loads((research / "series-progress.json").read_text())
    progress["batches"][-1]["batch_id"] = "substituted-40"
    write_json(research / "series-progress.json", progress)
    output = tmp_path / "substituted-progress-output"

    result = run_generator(research, output)

    assert result.returncode != 0
    assert not output.exists()


def test_artifact_publication_rejects_declared_inflated_cell_count_before_writes(tmp_path):
    research = tmp_path / "research"
    make_research_fixture(research)
    progress = json.loads((research / "series-progress.json").read_text())
    progress["batches"][0]["cell_count"] = 251
    write_json(research / "series-progress.json", progress)
    output = tmp_path / "inflated-count-output"

    result = run_generator(research, output)

    assert result.returncode != 0
    assert not output.exists()


def test_artifact_publication_rejects_empty_actual_ledgers_with_matching_hashes_before_writes(tmp_path):
    research = tmp_path / "research"
    make_research_fixture(research)
    empty_records = {ledger: [] for ledger in series.V2_LEDGER_FILES}
    empty_hashes = series.v2_ledger_sha256(empty_records)
    empty_cell_set = series.v2_cell_set_sha256([])
    for filename in series.V2_LEDGER_FILES.values():
        write_jsonl(research / filename, [])
    progress = json.loads((research / "series-progress.json").read_text())
    for entry in progress["batches"]:
        entry["cell_set_sha256"] = empty_cell_set
        entry["v2_ledger_sha256"] = empty_hashes
    write_json(research / "series-progress.json", progress)
    output = tmp_path / "empty-v2-ledgers-output"

    result = run_generator(research, output)

    assert result.returncode != 0
    assert not output.exists()


def test_artifact_publication_rejects_cross_batch_record_replay_before_writes(tmp_path):
    research = tmp_path / "research"
    make_research_fixture(research)
    attempts = series.read_jsonl(research / series.V2_LEDGER_FILES["attempts"])
    batches = series.read_jsonl(research / "series-batches.jsonl")
    first = attempts[0]
    replay = next(record for record in attempts if record["company_id"] == batches[1]["company_ids"][0])
    replay.update(cell_id=first["cell_id"], company_id=first["company_id"], category_id=first["category_id"],
                  jurisdiction=first["jurisdiction"])
    write_jsonl(research / series.V2_LEDGER_FILES["attempts"], attempts)
    refresh_v2_progress_hashes(research)
    output = tmp_path / "cross-batch-replay-output"

    result = run_generator(research, output)

    assert result.returncode != 0
    assert not output.exists()


def test_generator_emits_deterministic_immutable_v2_layout(tmp_path):
    fixture = make_research_fixture(tmp_path / "research")
    first = tmp_path / "first"
    second = tmp_path / "second"
    one = run_generator(tmp_path / "research", first)
    two = run_generator(tmp_path / "research", second)
    assert one.returncode == 0, one.stderr
    assert two.returncode == 0, two.stderr
    assert snapshot(first) == snapshot(second)
    manifest = json.loads((first / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["schema_version"] == 2
    assert manifest["artifact_kind"] == "company_benefits_manifest"
    assert manifest["fixture"] is False
    assert manifest["company_count"] == 2000
    assert manifest["taxonomy_version"] == "benefit-taxonomy-v1"
    assert manifest["listing_chunk_size"] == 50
    assert manifest["listing_chunk_count"] == 40
    assert manifest["category_count"] == 10
    assert manifest["protocol"]["protocol_id"] == "company-benefits-population-v4"
    assert set(manifest) == {
        "schema_version", "artifact_kind", "data_version", "fixture", "generated_at", "protocol",
        "taxonomy_version", "company_count", "listing_chunk_size", "listing_chunk_count", "category_count",
        "taxonomy", "sources", "methodology", "listing_chunks", "company_shards",
    }
    assert len(manifest["listing_chunks"]) == 40
    assert len(manifest["company_shards"]) == 2000
    version = first / manifest["data_version"]
    prefix = f"community/data/company-benefits/{manifest['data_version']}/"
    descriptors = [manifest["taxonomy"], manifest["sources"], manifest["methodology"], *manifest["listing_chunks"], *manifest["company_shards"].values()]
    assert all(item["url"].startswith(prefix) and item["byte_count"] > 0 for item in descriptors)
    assert all(len(json.loads((version / item["url"].removeprefix(prefix)).read_text())["companies"]) == 50 for item in manifest["listing_chunks"])
    for company_id, descriptor in manifest["company_shards"].items():
        payload = json.loads((version / descriptor["url"].removeprefix(prefix)).read_text())
        assert payload["artifact_kind"] == "company_detail"
        assert payload["company"]["company_id"] == company_id
    first_descriptor = manifest["company_shards"][fixture["companies"][0]["company_id"]]
    first_detail = json.loads((version / first_descriptor["url"].removeprefix(prefix)).read_text())
    claim = first_detail["claims"][0]
    assert set(claim) == {
        "claim_id", "benefit_type_ids", "category_ids", "benefit_name", "detail",
        "research_status", "current_validity", "evidence_grade", "application_scope",
        "limitation_codes", "publication_date", "checked_at", "source_evidence",
    }
    outcomes = first_detail["category_outcomes"]
    assert {item["category_id"] for item in outcomes} == {item["id"] for item in json.loads(TAXONOMY.read_text())["categories"]}
    assert any(item["kind"] == "evidenced" for item in outcomes)
    assert all("zero" not in item and "status" not in item for item in outcomes if item["kind"] == "insufficient_evidence")
    assert not [key for raw in snapshot(first).values() if raw.endswith(b"\n") for key in forbidden_keys(json.loads(raw))]
    assert not [key for raw in snapshot(first).values() if raw.endswith(b"\n") for key in internal_review_keys(json.loads(raw))]


def test_generator_rejects_pending_historical_and_fixture_inputs(tmp_path):
    research = tmp_path / "research"
    fixture = make_research_fixture(research)
    progress = json.loads((research / "series-progress.json").read_text())
    progress["batches"][0]["status"] = "pending"
    write_json(research / "series-progress.json", progress)
    result = run_generator(research, tmp_path / "pending-output")
    assert result.returncode != 0
    assert any(token in result.stderr.casefold() for token in ("approved", "complete", "v2 progress"))

    make_research_fixture(research)
    historical = {"record_type": "claim", "publishable": False, "record": fixture["claim"]}
    write_jsonl(research / "benefit-claims.jsonl", [historical])
    result = run_generator(research, tmp_path / "historical-output")
    assert result.returncode != 0
    assert "historical" in result.stderr.casefold() or "publishable" in result.stderr.casefold()

    make_research_fixture(research)
    companies = [json.loads(line) for line in (research / "companies.jsonl").read_text().splitlines()]
    companies[0]["company_id"] = "example-001"
    write_jsonl(research / "companies.jsonl", companies)
    result = run_generator(research, tmp_path / "fixture-output")
    assert result.returncode != 0
    assert any(token in result.stderr.casefold() for token in ("fixture", "absent from canonical company ledger"))


def test_validation_apis_expose_no_caller_controlled_authority_bypass(tmp_path):
    research = tmp_path / "research"
    make_research_fixture(research)
    assert not hasattr(series, "ValidatedV2Context")
    assert "create_context" not in inspect.signature(
        series.validate_v2_authoritative_records
    ).parameters
    assert "validated_context" not in inspect.signature(
        series.validate_complete_v2_progress
    ).parameters


def test_forged_validated_context_cannot_publish_schema_invalid_v2_records(tmp_path):
    research = tmp_path / "research"
    make_research_fixture(research)
    attempts = series.read_jsonl(research / series.V2_LEDGER_FILES["attempts"])
    attempts[0]["unsupported_attempt_field"] = "forged-context-bypass"
    write_jsonl(research / series.V2_LEDGER_FILES["attempts"], attempts)
    refresh_v2_progress_hashes(research)
    forged = type("ValidatedV2Context", (), {
        "research_root": research.resolve(),
        "fingerprint": (("forged", "f" * 64),),
        "records_fingerprint": (("attempts", "f" * 64),),
    })()

    with raises((TypeError, ValueError)):
        series.validate_complete_v2_progress(
            research, **{"validated_context": forged}
        )
    with raises(ValueError):
        series.validate_complete_v2_progress(research)

    module_spec = importlib.util.spec_from_file_location("artifact_forged_context", SCRIPT)
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    taxonomy = json.loads(TAXONOMY.read_text(encoding="utf-8"))
    with raises((TypeError, ValueError)):
        module.validate_inputs(research, taxonomy, file_digest(TAXONOMY), **{
            "validated_v2_context": forged,
        })
    with raises(ValueError):
        module.validate_inputs(research, taxonomy, file_digest(TAXONOMY))


def test_fixture_receipt_identities_are_globally_unique_across_all_batches(tmp_path):
    research = tmp_path / "research"
    make_research_fixture(research)
    attempts = series.read_jsonl(research / series.V2_LEDGER_FILES["attempts"])
    batches = series.read_jsonl(research / "series-batches.jsonl")
    owner = {
        company_id: batch["batch_id"]
        for batch in batches for company_id in batch["company_ids"]
    }
    locators = [item["capture_locator"] for item in attempts]
    responses = [item["raw_response_sha256"] for item in attempts]
    assert len(locators) == len(set(locators))
    assert len(responses) == len(set(responses))
    assert all(f"/{owner[item['company_id']]}/" in item["capture_locator"] for item in attempts)
    assert all(item["company_id"] in item["capture_locator"] for item in attempts)
    assert all(item["category_id"] in item["capture_locator"] for item in attempts)
    assert all(item["route_id"] in item["capture_locator"] for item in attempts)


def test_real_publication_preflight_validates_global_v2_package_once_and_emits(tmp_path):
    research = make_real_v2_research_fixture(tmp_path / "research")
    calls, scans, reads = [], [], []
    result = run_real_generator(
        research, tmp_path / "real-output", tmp_path, calls, scans, reads
    )
    assert result.returncode == 0, result.stderr
    assert calls == [1]
    assert scans == [0]
    assert reads == [1]
    assert (tmp_path / "real-output" / "manifest.json").is_file()


def test_real_publication_preflight_rejection_writes_no_output(tmp_path):
    research = make_real_v2_research_fixture(tmp_path / "research")
    freeze, effective = external_receipts(research, tmp_path)
    receipt = json.loads(freeze.read_text())
    receipt["freeze_manifest_sha256"] = "0" * 64
    write_json(freeze, receipt)
    spec = importlib.util.spec_from_file_location("artifact_real_preflight_failure", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    output = tmp_path / "rejected-output"
    stderr = io.StringIO()
    with redirect_stderr(stderr):
        code = module.main([
            "--research-root", str(research), "--output-root", str(output),
            "--taxonomy", str(TAXONOMY), "--data-version", "rejected-v2",
            "--generated-at", "2026-10-31T04:00:00Z", "--as-of", "2026-10-31",
            "--freeze-anchor-receipt", str(freeze),
            "--effective-selection-receipt", str(effective),
        ])
    assert code == 1
    assert "freeze" in stderr.getvalue().casefold()
    assert "traceback" not in stderr.getvalue().casefold()
    assert not output.exists()


def test_generator_rejects_non_string_v2_source_binding_without_traceback_or_output(tmp_path):
    research = tmp_path / "research"
    make_research_fixture(research)
    attempts = series.read_jsonl(research / series.V2_LEDGER_FILES["attempts"])
    attempts[0]["source_ids"] = [{}]
    write_jsonl(research / series.V2_LEDGER_FILES["attempts"], attempts)
    output = tmp_path / "malformed-binding-output"
    result = run_generator(research, output)
    assert result.returncode == 1
    assert "source" in result.stderr.casefold()
    assert "traceback" not in result.stderr.casefold()
    assert not output.exists()


def load_tests(loader, tests, pattern):
    names = [name for name, value in globals().items() if name.startswith("test_") and callable(value)]

    def wrapped(function):
        def run():
            with tempfile.TemporaryDirectory() as directory:
                function(Path(directory)) if "tmp_path" in function.__code__.co_varnames else function()
        return run

    return unittest.TestSuite(unittest.FunctionTestCase(wrapped(globals()[name]), description=name) for name in sorted(names))


if __name__ == "__main__":
    unittest.main()
