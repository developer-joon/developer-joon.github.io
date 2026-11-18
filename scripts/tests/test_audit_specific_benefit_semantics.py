import json
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
AUDITOR = ROOT / "scripts" / "audit-specific-benefit-semantics.py"
RECORD_KEY_LIMIT = 100


def _reference(record_id, category_id, statement, source_locator, scope_status: str | None = "exact_entity"):
    record = {
        "reference_id": record_id,
        "cell_id": f"cell::company-a::{category_id}",
        "company_id": "company-a",
        "category_id": category_id,
        "source_id": f"source::{record_id}",
        "source_tier": "company_recruiting_major_media",
        "statement": statement,
        "supporting_quote": statement,
        "source_locator": source_locator,
        "reliability": "medium",
        "currentness": "current",
        "scope": {
            "countries": ["KR"],
            "legal_entities": ["Example Company"],
            "roles": ["employees"],
            "employment_types": ["full_time"],
        },
        "conflict_status": "none",
        "publication_eligibility": "eligible",
        "checked_at": "2026-11-06T00:00:00Z",
    }
    if scope_status is not None:
        record["scope"]["status"] = scope_status
    return record


def _community(record_id, category_id, statement, locator, scope_status="exact_entity"):
    record = {
        "community_report_id": record_id,
        "cell_id": f"cell::company-a::{category_id}",
        "company_id": "company-a",
        "category_id": category_id,
        "source_id": f"source::{record_id}",
        "source_tier": "community_employee_review",
        "statement": statement,
        "reliability": "low",
        "currentness": "current",
        "scope": {
            "countries": ["KR"],
            "legal_entities": ["Example Company"],
            "roles": ["employees"],
            "employment_types": ["full_time"],
        },
        "conflict_status": "none",
        "moderation": {
            "status": "approved",
            "reviewer_id": "moderator::fixture",
            "reviewed_at": "2026-11-06T00:00:00Z",
            "decision_sha256": "a" * 64,
        },
        "frozen_snapshot": {
            "locator": locator,
            "content_sha256": "b" * 64,
            "frozen_at": "2026-11-06T00:00:00Z",
        },
        "publication_eligibility": "eligible",
    }
    if scope_status is not None:
        record["scope_status"] = scope_status
    return record


def _write_projection(tmp_path):
    projection = tmp_path / "projection"
    companies = projection / "companies"
    companies.mkdir(parents=True)

    page_dump = "\n\n".join(f"Page section {index}: navigation and content" for index in range(24))
    company_a = {
        "company": {"company_id": "company-a", "legal_name": "Example Company"},
        "verified_benefits": [
            {"benefit_id": "benefit-a"},
            {"benefit_id": "benefit-b", "eligible_for_promotion": True},
        ],
        "references": [
            _reference(
                "reference::clean-exact",
                "health",
                "Example Company pays employee health premiums.",
                "https://example.test/clean-exact",
                "exact_entity",
            ),
            _reference(
                "reference::clean-bounded",
                "commute",
                "Employees assigned to the Seoul office receive a transit pass.",
                "https://example.test/clean-bounded",
                "bounded_entity",
            ),
            _reference(
                "reference::group-only",
                "family",
                "Employees receive a family care stipend.",
                "https://example.test/group",
                "group_only",
            ),
            _reference(
                "reference::unresolved",
                "remote",
                "Employees may use home-office equipment.",
                "https://example.test/unresolved",
                "unresolved",
            ),
            _reference(
                "reference::missing-scope-status",
                "growth",
                "Employees receive an annual training budget.",
                "https://example.test/missing",
                None,
            ),
            _reference(
                "reference::unknown-scope-status",
                "housing",
                "Employees assigned abroad receive housing support.",
                "https://example.test/unknown",
                "unknown",
            ),
            _reference(
                "reference::page-dump",
                "leave",
                page_dump,
                "https://example.test/dump",
            ),
            _reference(
                "reference::meta-public",
                "family",
                "Public source reports Other Company and family terms.",
                "https://example.test/meta-public",
            ),
            _reference(
                "reference::meta-fetched",
                "growth",
                "Fetched public page contains Example Company and growth terms.",
                "https://example.test/meta-fetched",
            ),
            _reference(
                "reference::duplicate-a",
                "meals",
                "Employees receive a daily meal allowance.",
                "https://example.test/duplicate-a",
            ),
            _reference(
                "reference::duplicate-b",
                "meals",
                "  Employees receive a daily meal allowance.  ",
                "https://example.test/duplicate-b",
                "bounded_entity",
            ),
            _reference(
                "reference::replay-a",
                "retirement",
                "Employees receive a monthly savings contribution.",
                "https://example.test/replay-a",
            ),
            _reference(
                "reference::replay-b",
                "inclusion",
                " employees receive a monthly savings contribution. ",
                "https://example.test/replay-b",
            ),
        ],
        "community_reports": [
            _community(
                "community::shared-a",
                "leave",
                "Employees report five additional personal days.",
                "https://captures.example.test/shared",
                "exact_entity",
            ),
            _community(
                "community::shared-b",
                "health",
                "Employees report an annual dental allowance.",
                "https://captures.example.test/shared",
                "bounded_entity",
            ),
            _community(
                "community::group-only",
                "remote",
                "Employees report a remote-work equipment budget.",
                "https://captures.example.test/group",
                "group_only",
            ),
            _community(
                "community::unresolved",
                "inclusion",
                "Employees report accessibility equipment support.",
                "https://captures.example.test/unresolved",
                "unresolved",
            ),
        ],
    }
    company_b = {
        "company": {"company_id": "company-b", "legal_name": "Other Company"},
        "references": [],
        "community_reports": [],
    }

    # Reverse lexical creation order to prove traversal does not depend on creation order.
    (companies / "z-company-b.json").write_text(json.dumps(company_b), encoding="utf-8")
    (companies / "a-company-a.json").write_text(json.dumps(company_a), encoding="utf-8")
    return projection


def _run(projection, cwd):
    return subprocess.run(
        [sys.executable, str(AUDITOR), str(projection)],
        cwd=cwd,
        check=False,
        capture_output=True,
        text=True,
    )


def _write_single_shard(tmp_path, payload):
    companies = tmp_path / "projection" / "companies"
    companies.mkdir(parents=True)
    (companies / "company-a.json").write_text(json.dumps(payload), encoding="utf-8")
    return companies.parent


def _assert_cli_error(result, expected_error, tmp_path):
    assert result.returncode != 0
    assert result.stdout == ""
    assert result.stderr.strip() == f"error: {expected_error}"
    assert str(tmp_path) not in result.stderr


@pytest.mark.parametrize(
    ("payload", "expected_error"),
    [
        pytest.param({}, "company-a.json: missing required field 'company'", id="empty-shard"),
        pytest.param(
            {"company": {"legal_name": "Example Company"}, "references": [], "community_reports": []},
            "company-a.json: missing required field 'company.company_id'",
            id="missing-company-id",
        ),
        pytest.param(
            {"company": {"company_id": "company-a"}, "references": [], "community_reports": []},
            "company-a.json: missing required field 'company.legal_name'",
            id="missing-legal-name",
        ),
        pytest.param(
            {"company": {"company_id": "company-a", "legal_name": "Example Company"}, "community_reports": []},
            "company-a.json: missing required field 'references'",
            id="missing-references",
        ),
        pytest.param(
            {"company": {"company_id": "company-a", "legal_name": "Example Company"}, "references": []},
            "company-a.json: missing required field 'community_reports'",
            id="missing-community-reports",
        ),
        pytest.param(
            {"company": {"company_id": "  ", "legal_name": "Example Company"}, "references": [], "community_reports": []},
            "company-a.json: field 'company.company_id' must be a nonblank string",
            id="blank-company-id",
        ),
        pytest.param(
            {"company": {"company_id": 7, "legal_name": "Example Company"}, "references": [], "community_reports": []},
            "company-a.json: field 'company.company_id' must be a nonblank string",
            id="non-string-company-id",
        ),
        pytest.param(
            {"company": {"company_id": "company-a", "legal_name": "\t"}, "references": [], "community_reports": []},
            "company-a.json: field 'company.legal_name' must be a nonblank string",
            id="blank-legal-name",
        ),
        pytest.param(
            {"company": {"company_id": "company-a", "legal_name": ["Example Company"]}, "references": [], "community_reports": []},
            "company-a.json: field 'company.legal_name' must be a nonblank string",
            id="non-string-legal-name",
        ),
    ],
)
def test_cli_rejects_shards_without_required_production_shape_without_report(
    tmp_path, payload, expected_error
):
    projection = _write_single_shard(tmp_path, payload)

    result = _run(projection, ROOT)

    _assert_cli_error(result, expected_error, tmp_path)


def test_cli_rejects_nonexistent_input_path_without_report(tmp_path):
    result = _run(tmp_path / "missing-projection", ROOT)

    _assert_cli_error(result, "input path does not exist", tmp_path)


def test_cli_rejects_empty_directory_without_report(tmp_path):
    projection = tmp_path / "projection"
    projection.mkdir()

    result = _run(projection, ROOT)

    _assert_cli_error(result, "input directory contains no .json shards", tmp_path)


def test_cli_rejects_input_file_without_report(tmp_path):
    input_file = tmp_path / "projection.json"
    input_file.write_text("{}", encoding="utf-8")

    result = _run(input_file, ROOT)

    _assert_cli_error(result, "input path must be a directory", tmp_path)


def test_cli_rejects_non_object_shard_without_report(tmp_path):
    projection = _write_single_shard(tmp_path, [])

    result = _run(projection, ROOT)

    _assert_cli_error(result, "company-a.json: top-level payload must be an object", tmp_path)


def test_cli_rejects_invalid_json_shard_without_report(tmp_path):
    companies = tmp_path / "projection" / "companies"
    companies.mkdir(parents=True)
    (companies / "company-a.json").write_text("{", encoding="utf-8")

    result = _run(companies.parent, ROOT)

    _assert_cli_error(result, "company-a.json: invalid JSON", tmp_path)


def test_cli_rejects_non_object_company_without_report(tmp_path):
    projection = _write_single_shard(tmp_path, {"company": []})

    result = _run(projection, ROOT)

    _assert_cli_error(result, "company-a.json: field 'company' must be an object", tmp_path)


def test_cli_rejects_non_list_references_without_report(tmp_path):
    projection = _write_single_shard(
        tmp_path,
        {
            "company": {"company_id": "company-a", "legal_name": "Example Company"},
            "references": {},
            "community_reports": [],
        },
    )

    result = _run(projection, ROOT)

    _assert_cli_error(result, "company-a.json: field 'references' must be an array", tmp_path)


def test_cli_rejects_non_object_reference_record_without_report(tmp_path):
    projection = _write_single_shard(
        tmp_path,
        {
            "company": {"company_id": "company-a", "legal_name": "Example Company"},
            "references": ["not-an-object"],
            "community_reports": [],
        },
    )

    result = _run(projection, ROOT)

    _assert_cli_error(result, "company-a.json: field 'references[0]' must be an object", tmp_path)


def test_cli_rejects_non_list_community_reports_without_report(tmp_path):
    projection = _write_single_shard(
        tmp_path,
        {
            "company": {"company_id": "company-a", "legal_name": "Example Company"},
            "references": [],
            "community_reports": {},
        },
    )

    result = _run(projection, ROOT)

    _assert_cli_error(result, "company-a.json: field 'community_reports' must be an array", tmp_path)


def test_cli_rejects_non_object_community_report_without_report(tmp_path):
    projection = _write_single_shard(
        tmp_path,
        {
            "company": {"company_id": "company-a", "legal_name": "Example Company"},
            "references": [],
            "community_reports": [1],
        },
    )

    result = _run(projection, ROOT)

    _assert_cli_error(result, "company-a.json: field 'community_reports[0]' must be an object", tmp_path)


def test_cli_rejects_non_list_verified_benefits_without_report(tmp_path):
    projection = _write_single_shard(
        tmp_path,
        {
            "company": {"company_id": "company-a", "legal_name": "Example Company"},
            "references": [],
            "community_reports": [],
            "verified_benefits": {},
        },
    )

    result = _run(projection, ROOT)

    _assert_cli_error(result, "company-a.json: field 'verified_benefits' must be an array", tmp_path)


def test_cli_rejects_non_object_verified_benefit_without_report(tmp_path):
    projection = _write_single_shard(
        tmp_path,
        {
            "company": {"company_id": "company-a", "legal_name": "Example Company"},
            "references": [],
            "community_reports": [],
            "verified_benefits": [None],
        },
    )

    result = _run(projection, ROOT)

    _assert_cli_error(result, "company-a.json: field 'verified_benefits[0]' must be an object", tmp_path)


def test_cli_emits_production_accurate_deterministic_read_only_signals(tmp_path):
    projection = _write_projection(tmp_path)
    before = {path.relative_to(projection): path.read_bytes() for path in projection.rglob("*") if path.is_file()}

    first = _run(projection, ROOT)
    second = _run(projection, tmp_path)

    assert first.returncode == 0, first.stderr
    assert second.returncode == 0, second.stderr
    assert first.stdout == second.stdout
    assert first.stderr == ""
    assert {path.relative_to(projection): path.read_bytes() for path in projection.rglob("*") if path.is_file()} == before

    report = json.loads(first.stdout)
    assert report["audit_kind"] == "specific_benefit_semantic_audit"
    assert report["projection_directory"] == "projection"
    assert report["raw_evidence_record_count"] == 17
    assert report["raw_verified_benefit_count"] == 2
    assert report["verified_benefit_inventory"] == "present"
    assert report["eligible_verified_proposition_count"] == 0

    signals = report["audit_signals"]
    expected_counts = {
        "page_or_body_dump": 1,
        "producer_meta_statement": 2,
        "same_company_category_duplicate_statement": 2,
        "same_company_cross_category_statement_replay": 2,
        "source_url_reused_across_categories": 2,
        "unrelated_company_text": 1,
        "unresolved_or_missing_scope": 6,
        "conservative_invalid_or_unscoped_union": 15,
    }
    assert set(signals) == set(expected_counts)
    for signal_name, expected_count in expected_counts.items():
        signal = signals[signal_name]
        assert signal["count"] == expected_count
        assert signal["total_count"] == expected_count
        assert signal["truncated"] is False
        assert signal["record_keys"] == sorted(signal["record_keys"])

    expected_union_keys = sorted(
        {
            "a-company-a.json:references:reference::group-only",
            "a-company-a.json:references:reference::unresolved",
            "a-company-a.json:references:reference::missing-scope-status",
            "a-company-a.json:references:reference::unknown-scope-status",
            "a-company-a.json:references:reference::page-dump",
            "a-company-a.json:references:reference::meta-public",
            "a-company-a.json:references:reference::meta-fetched",
            "a-company-a.json:references:reference::duplicate-a",
            "a-company-a.json:references:reference::duplicate-b",
            "a-company-a.json:references:reference::replay-a",
            "a-company-a.json:references:reference::replay-b",
            "a-company-a.json:community_reports:community::shared-a",
            "a-company-a.json:community_reports:community::shared-b",
            "a-company-a.json:community_reports:community::group-only",
            "a-company-a.json:community_reports:community::unresolved",
        }
    )
    union = signals["conservative_invalid_or_unscoped_union"]
    assert union["record_keys"] == expected_union_keys
    assert all(not key.startswith("/") and str(tmp_path) not in key for key in union["record_keys"])
    assert "a-company-a.json:references:reference::clean-exact" not in union["record_keys"]
    assert "a-company-a.json:references:reference::clean-bounded" not in union["record_keys"]


def test_cli_keeps_present_verified_benefits_uncounted_at_task_1(tmp_path):
    projection = _write_projection(tmp_path)

    result = _run(projection, ROOT)

    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["verified_benefit_inventory"] == "present"
    assert report["raw_verified_benefit_count"] == 2
    assert report["eligible_verified_proposition_count"] == 0
    assert "Task 1" in report["audit_policy"]["eligible_proposition_rule"]
    assert "exact approved-contract validator" in report["audit_policy"]["eligible_proposition_rule"]
    assert report["audit_policy"]["automatic_promotion"] == "blocked_by_any_signal"
    assert "do not certify unflagged text" in report["audit_policy"]["limitations"]


def test_cli_caps_record_keys_without_reducing_total_counts(tmp_path):
    projection = tmp_path / "projection"
    companies = projection / "companies"
    companies.mkdir(parents=True)
    records = [
        _reference(
            f"reference::unscoped-{index:03d}",
            "leave",
            f"Employees receive leave option {index}.",
            f"https://example.test/unscoped/{index}",
            "unresolved",
        )
        for index in range(RECORD_KEY_LIMIT + 5)
    ]
    payload = {
        "company": {"company_id": "company-a", "legal_name": "Example Company"},
        "references": records,
        "community_reports": [],
    }
    (companies / "company-a.json").write_text(json.dumps(payload), encoding="utf-8")

    result = _run(projection, ROOT)

    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["audit_policy"]["record_key_limit_per_signal"] == RECORD_KEY_LIMIT
    for signal_name in ("unresolved_or_missing_scope", "conservative_invalid_or_unscoped_union"):
        signal = report["audit_signals"][signal_name]
        assert signal["count"] == RECORD_KEY_LIMIT + 5
        assert signal["total_count"] == RECORD_KEY_LIMIT + 5
        assert signal["truncated"] is True
        assert len(signal["record_keys"]) == RECORD_KEY_LIMIT
        assert signal["record_keys"] == sorted(signal["record_keys"])
        assert signal["record_keys"][-1].endswith("reference::unscoped-099")
