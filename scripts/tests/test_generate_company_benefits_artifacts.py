import copy
import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path

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
    raise AssertionError(f"expected {error.__name__}")


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(compact(value).encode()).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(compact(value), encoding="utf-8")


def write_jsonl(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(compact(row) + "\n" for row in rows), encoding="utf-8")


def make_research_fixture(root):
    companies = []
    for index in range(2000):
        domestic = index < 1000
        companies.append({
            "company_id": f"KR-CRN-{index:013d}" if domestic else f"US-CIK{index:010d}",
            "legal_name": f"Verified Employer {index:04d}",
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
        "url": "https://verified.example.gov/benefits",
        "locator": "benefits section",
        "supporting_quote": "Employees receive paid leave.",
        "content_sha256": "a" * 64,
        "publication_date": "2026-01-01",
        "checked_at": "2026-10-30T02:00:00Z",
    }
    claim_review = {
        "review_id": "review-claim-current-1",
        "claim_id": claim["claim_id"],
        "researcher_id": "researcher-a",
        "reviewer_id": "reviewer-b",
        "decision": "approved",
        "reviewed_at": "2026-10-30T01:00:00Z",
        "quote_entailment_confirmed": True,
    }
    gaps = []
    gap_reviews = []
    for company in companies[1:]:
        gap_id = f"company-gap::{company['company_id']}"
        gaps.append({
            "audit_id": gap_id,
            "company_id": company["company_id"],
            "reason_code": "not_researched",
            "nonabsence_wording": "공개 근거가 충분하지 않으며 복지가 없다는 뜻이 아닙니다.",
            "searched_official_source_ids": [],
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
    for index in range(80):
        ids = [company["company_id"] for company in companies[index * 25:(index + 1) * 25]]
        batch_id = ("domestic" if index < 40 else "international") + f"-{index % 40 + 1:02d}"
        batches.append({"batch_id": batch_id, "company_ids": ids})
        progress_entries.append({
            "batch_id": batch_id,
            "status": "approved",
            "claim_count": 1 if index == 0 else 0,
            "no_claim_count": 24 if index == 0 else 25,
            "approved_at": "2026-10-30T03:00:00Z",
            "reviewer_ids": ["reviewer-b"],
        })
    assignment = {
        "claim_id": claim["claim_id"],
        "benefit_type_ids": ["paid-leave"],
        "taxonomy_version": "benefit-taxonomy-v1",
        "claim_content_sha256": digest(claim),
        "researcher_id": "researcher-a",
        "reviewer_id": "taxonomy-reviewer-c",
        "reviewed_at": "2026-10-30T01:30:00Z",
        "decision": "approved",
    }
    write_jsonl(root / "companies.jsonl", companies)
    write_jsonl(root / "benefit-claims.jsonl", [claim])
    write_jsonl(root / "reviews.jsonl", [claim_review, *gap_reviews])
    write_jsonl(root / "series-research-gaps.jsonl", gaps)
    write_jsonl(root / "source-registry.jsonl", [source])
    write_jsonl(root / "series-prepublication-checks.jsonl", [{
        "source_id": "source-1",
        "url": source["url"],
        "status": 200,
        "final_url": source["url"],
        "marker_confirmed": True,
        "content_sha256": source["content_sha256"],
        "checked_at": "2026-10-30T02:00:00Z",
    }])
    write_jsonl(root / "series-batches.jsonl", batches)
    write_json(root / "series-progress.json", {
        "manifest_version": "1",
        "status": "complete",
        "total_companies": 2000,
        "total_batches": 80,
        "batches": progress_entries,
    })
    write_jsonl(root / "benefit-taxonomy-assignments.jsonl", [assignment])
    return {"companies": companies, "claim": claim, "assignment": assignment}


def run_generator(research, output):
    return subprocess.run([
        sys.executable, str(SCRIPT),
        "--research-root", str(research),
        "--output-root", str(output),
        "--taxonomy", str(TAXONOMY),
        "--data-version", "2026-10-30-v2",
        "--generated-at", "2026-10-30T04:00:00Z",
    ], capture_output=True, text=True)


def snapshot(root):
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(root.rglob("*")) if path.is_file()
    }


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
    claims = {fixture["claim"]["claim_id"]: fixture["claim"]}
    taxonomy = json.loads(TAXONOMY.read_text(encoding="utf-8"))
    assert module.validate_assignments([fixture["assignment"]], claims, taxonomy) == {fixture["claim"]["claim_id"]: fixture["assignment"]}
    for field, value in (("decision", "pending"), ("reviewer_id", "researcher-a"), ("claim_content_sha256", "0" * 64)):
        invalid = copy.deepcopy(fixture["assignment"])
        invalid[field] = value
        with raises(ValueError):
            module.validate_assignments([invalid], claims, taxonomy)


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
    assert manifest["fixture"] is False
    assert manifest["company_count"] == 2000
    assert manifest["compare"]["max_companies"] == 4
    assert len(manifest["listing_chunks"]) == 40
    assert len(manifest["company_shards"]) == 2000
    version = first / manifest["data_version"]
    assert all(len(json.loads((version / item["path"]).read_text())["companies"]) == 50 for item in manifest["listing_chunks"])
    for company_id, descriptor in manifest["company_shards"].items():
        payload = json.loads((version / descriptor["path"]).read_text())
        assert payload["company"]["company_id"] == company_id
    first_detail = json.loads((version / manifest["company_shards"][fixture["companies"][0]["company_id"]]["path"]).read_text())
    outcomes = first_detail["company"]["category_outcomes"]
    assert {item["category_id"] for item in outcomes} == {item["id"] for item in json.loads(TAXONOMY.read_text())["categories"]}
    assert any(item["kind"] == "evidenced" for item in outcomes)
    assert all("zero" not in item and "status" not in item for item in outcomes if item["kind"] == "insufficient_evidence")
    assert not [key for raw in snapshot(first).values() if raw.endswith(b"\n") for key in forbidden_keys(json.loads(raw))]


def test_generator_rejects_pending_historical_and_fixture_inputs(tmp_path):
    research = tmp_path / "research"
    fixture = make_research_fixture(research)
    progress = json.loads((research / "series-progress.json").read_text())
    progress["batches"][0]["status"] = "pending"
    write_json(research / "series-progress.json", progress)
    result = run_generator(research, tmp_path / "pending-output")
    assert result.returncode != 0
    assert "approved" in result.stderr.casefold() or "complete" in result.stderr.casefold()

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
    assert "fixture" in result.stderr.casefold()


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
