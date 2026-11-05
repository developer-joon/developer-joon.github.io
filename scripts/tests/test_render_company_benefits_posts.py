import copy
import fcntl
import hashlib
import importlib.util
import json
import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "render-company-benefits-posts.py"
MAP = ROOT / "docs/research/company-benefits/final-series-render-map.json"
TAXONOMY = ROOT / "docs/research/company-benefits/benefit-taxonomy-v1.json"
FIXTURE_MODULE = ROOT / "scripts/tests/test_generate_company_benefits_artifacts.py"


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ProductionPostRendererTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.renderer = load(SCRIPT, "company_benefits_post_renderer")
        cls.fixtures = load(FIXTURE_MODULE, "company_benefits_artifact_test_fixtures")
        cls.real_map = json.loads(MAP.read_text(encoding="utf-8"))
        cls.taxonomy = json.loads(TAXONOMY.read_text(encoding="utf-8"))

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.research = self.base / "research"
        self.output = self.base / "site"
        fixture = self.fixtures.make_research_fixture(self.research)
        population_ids = set(self.real_map["entries"][0]["citation_source_mapping"]["population_source_ids"])
        population_sources = [
            json.loads(line) for line in (ROOT / "docs/research/company-benefits/source-registry.jsonl").read_text().splitlines()
            if json.loads(line).get("source_id") in population_ids
        ]
        with (self.research / "source-registry.jsonl").open("a", encoding="utf-8") as output:
            output.write("".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in population_sources))
        self.companies = fixture["companies"]
        self.render_map = copy.deepcopy(self.real_map)
        batches = [json.loads(line) for line in (self.research / "series-batches.jsonl").read_text().splitlines()]
        by_batch = {row["batch_id"]: row for row in batches}
        for entry in self.render_map["entries"]:
            if entry["artifact_type"] == "installment":
                entry["company_ids"] = by_batch[entry["batch_id"]]["company_ids"]
                entry.pop("company_list_sha256", None)
                entry.pop("effective_sequence_sha256", None)
                entry.pop("replacement_events_sha256", None)
        self.map_path = self.base / "map.json"
        self.map_path.write_text(json.dumps(self.render_map, ensure_ascii=False), encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def render(self):
        generator = load(ROOT / "scripts/generate-company-benefits-artifacts.py", "renderer_publication_gate")
        with (mock.patch.object(generator, "verify_active_ledgers", return_value=None) as verifier,
              mock.patch.object(self.renderer, "load_module", return_value=generator)):
            result = self.renderer.render_series(
                self.research, self.map_path, self.output, TAXONOMY,
                as_of="2026-10-31",
            )
        verifier.assert_called_once()
        return result

    def rendered_posts(self):
        return {
            entry["filename"]: f"new-{number}\n"
            for number, entry in enumerate(self.real_map["entries"])
        }

    def evidence_claim(self, **updates):
        value = {
            "claim_id": "claim-evidence",
            "company_id": self.companies[0]["company_id"],
            "status": "confirmed",
            "source_ids": ["source-1"],
            "source_evidence": [{"source_id": "source-1", "role": "primary_claim_evidence"}],
        }
        value.update(updates)
        return value

    def v2_evidence(self, evidence_class, company_id=None, category_id="leave"):
        company_id = company_id or self.companies[1]["company_id"]
        company = next(row for row in self.companies if row["company_id"] == company_id)
        cell_id = f"cell::{company_id}::{category_id}"
        digest = hashlib.sha256(evidence_class.encode()).hexdigest()
        source_id = f"source::{digest}"
        record_id = (f"official::{digest}" if evidence_class == "official" else
                     f"{evidence_class}::{company_id}::{category_id}::{source_id}")
        cell = {
            "cell_id": cell_id, "company_id": company_id, "category_id": category_id,
            "jurisdiction": company["jurisdiction"], "coverage_policy_id": "fixture-policy",
            "state": {"official": "official_verified", "reference": "reference",
                      "community": "community_report"}[evidence_class],
            "reliability": "high" if evidence_class == "official" else "low",
            "currentness": "current" if evidence_class == "official" else "unknown",
            "scope_status": "exact_entity", "conflict_status": "none",
            "publication_eligibility": "official_claim" if evidence_class == "official" else (
                "reference_only" if evidence_class == "reference" else "community_only"),
            "official_claim_ids": [record_id] if evidence_class == "official" else [],
            "reference_ids": [record_id] if evidence_class == "reference" else [],
            "community_report_ids": [record_id] if evidence_class == "community" else [],
            "attempt_ids": [f"attempt::{company_id}::{category_id}::fixture"],
            "assessed_at": "2026-10-30T02:00:00Z",
        }
        source = {
            "source_id": source_id, "title": f"{evidence_class.title()} benefit source",
            "url": f"https://evidence.example/{evidence_class}",
            "source_tier": {"official": "official_government",
                            "reference": "company_recruiting_major_media",
                            "community": "community_employee_review"}[evidence_class],
            "retrieved_at": "2026-10-30T02:00:00Z", "content_sha256": digest,
            "publication_eligibility": "eligible" if evidence_class != "reference" else "reference_only",
            "reliability": cell["reliability"], "currentness": cell["currentness"],
            "scope_status": "unresolved" if evidence_class == "reference" else "exact_entity",
            "scope": {"countries": [company["jurisdiction"]],
                      "legal_entities": [company["selected_reporting_legal_entity"]],
                      "roles": ["employees"], "employment_types": ["full_time"]},
            "conflict_status": "none",
        }
        if evidence_class == "reference":
            cell["scope_status"] = source["scope_status"]
        record = {
            "cell_id": cell_id, "company_id": company_id, "category_id": category_id,
            "source_tier": source["source_tier"],
            "publication_eligibility": "eligible" if evidence_class != "reference" else "reference_only",
            "reliability": cell["reliability"], "currentness": cell["currentness"],
            "scope_status": "exact_entity", "scope": {"countries": [company["jurisdiction"]],
                "legal_entities": [company["selected_reporting_legal_entity"]], "roles": ["employees"],
                "employment_types": ["full_time"]}, "conflict_status": "none",
        }
        ledger, id_field = {
            "official": ("official_claims", "claim_id"),
            "reference": ("references", "reference_id"),
            "community": ("community_reports", "community_report_id"),
        }[evidence_class]
        record[id_field] = record_id
        if evidence_class == "official":
            record.update(jurisdiction=company["jurisdiction"])
            record["source_ids"] = [source_id]
            record.pop("reliability")
            record.pop("currentness")
        else:
            record["source_id"] = source_id
            category_text = {
                "leave": "유급휴가", "family": "육아휴직", "health": "건강검진",
                "growth": "직무교육", "housing": "기숙사", "commute": "통근버스",
                "remote": "원격근무", "retirement": "퇴직연금", "meals": "사내식당",
                "inclusion": "접근성 편의",
            }[category_id]
            legal_entity = company["selected_reporting_legal_entity"]
            record["statement"] = f"{legal_entity} 직원에게 {category_text} 지원 제도를 운영한다"
        if evidence_class == "community":
            record.update(
                moderation={"status": "approved", "reviewer_id": "moderator::fixture",
                            "reviewed_at": "2026-10-30T02:00:00Z", "decision_sha256": digest},
                frozen_snapshot={"locator": "https://snapshot.example/1", "content_sha256": digest,
                                 "frozen_at": "2026-10-30T02:00:00Z"},
            )
        elif evidence_class == "reference":
            record.pop("scope_status")
            record["supporting_quote"] = record["statement"]
            record["source_locator"] = source["url"]
            record["checked_at"] = source["retrieved_at"]
            record["scope"]["status"] = source["scope_status"]
        indexes = {"attempts": {}, "official_claims": {}, "references": {},
                   "community_reports": {}, "sources": {source_id: source}}
        indexes[ledger][record_id] = record
        return cell, indexes

    def test_official_v2_schema_has_no_publishable_prose_shape(self):
        company_id = self.companies[1]["company_id"]
        cell, indexes = self.v2_evidence("official", company_id)
        self.assertEqual([], self.renderer.curate_installment_entries(
            [{"batch_id": "official", "company_ids": [company_id]}], {}, {}, {},
            {company_id: {"leave": cell}}, indexes, self.taxonomy,
        ))

    def test_current_v2_schema_is_explicitly_fail_closed_for_every_evidence_class(self):
        company_id = self.companies[1]["company_id"]
        for evidence_class in ("official", "reference", "community"):
            with self.subTest(evidence_class=evidence_class):
                cell, indexes = self.v2_evidence(evidence_class, company_id)
                self.assertEqual([], self.renderer.v2_publication_evidence(
                    {"leave": cell}, indexes,
                ))
                self.assertEqual([], self.renderer.publication_evidence(
                    company_id, [], {}, {}, self.taxonomy, {"leave": cell}, indexes,
                ))
        self.assertIn("no independently reviewed publication projection contract",
                      self.renderer.V2_PUBLICATION_BLOCK_REASON)

    def test_v2_publication_prose_is_bounded_plain_text(self):
        probes = (
            ("<script>alert(1)</script><b>bold</b>", ("<script>", "<b>"), "alert"),
            ("# Heading [click](https://evil.example) *emphasis*", ("[click]", "*emphasis*"), "Heading"),
            ("```python boom()``` and `inline`", ("```", "`inline`"), "boom"),
            ("{{ site.secret }} {% include evil.html %}", ("{{", "{%"), "secret"),
        )
        for probe, dangerous, readable in probes:
            with self.subTest(probe=probe):
                text = self.renderer.publication_plain_text(probe)
                self.assertIn(readable, text)
                if probe.startswith("#"):
                    self.assertIn(r"\# Heading", text)
                for construct in dangerous:
                    self.assertNotIn(construct, text)

        long_text = "혜택 " * 2000
        rendered = self.renderer.publication_plain_text(long_text)
        self.assertTrue(rendered.endswith("…"))
        self.assertLessEqual(len(rendered), self.renderer.PUBLICATION_PROSE_MAX_CHARS)
        self.assertEqual(rendered, self.renderer.publication_plain_text(long_text))

    def test_plain_text_bound_applies_after_atomic_expanding_escapes(self):
        for character in ("[", "<", "{", "&", "\\"):
            with self.subTest(character=character):
                rendered = self.renderer.publication_plain_text(character * 1000)
                self.assertLessEqual(len(rendered), self.renderer.PUBLICATION_PROSE_MAX_CHARS)
                self.assertTrue(rendered.endswith("…"))
                self.assertNotRegex(rendered, r"&(?:#\d*)?…$")
                if character == "\\":
                    self.assertEqual(0, len(rendered[:-1]) % 2)

    def test_scope_and_source_url_sanitizers_remain_defense_in_depth(self):
        scope = {
            "countries": ["KR"],
            "legal_entities": ["{{site.secret}}"], "roles": ["<img src=x onerror=alert(1)>"],
            "employment_types": ["[click](javascript:alert(1))"],
        }
        text = self.renderer.scope_text({"application_scope": scope})
        self.assertNotIn("{{site.secret}}", text)
        self.assertNotIn("<img", text)
        self.assertNotIn("[click](javascript:", text)
        self.assertIn("&#123;&#123;site\\.secret&#125;&#125;", text)
        self.assertIn("&lt;img", text)
        self.assertIn(r"\[click\]\(javascript:alert\(1\)\)", text)
        url = "https://example.com/{{site.secret}}/[click](javascript:alert(1))?next=<tag>"
        rendered = self.renderer.publication_source_url({"url": url})
        self.assertIn("%7B%7Bsite.secret%7D%7D", rendered)
        self.assertIn("%5Bclick%5D%28javascript:alert%281%29%29", rendered)

    def test_v2_source_url_with_control_character_is_rejected(self):
        company_id = self.companies[1]["company_id"]
        cell, indexes = self.v2_evidence("reference", company_id)
        source = next(iter(indexes["sources"].values()))
        source["url"] += "\x7f"
        next(iter(indexes["references"].values()))["source_locator"] = source["url"]
        self.assertEqual([], self.renderer.curate_installment_entries(
            [{"batch_id": "v2", "company_ids": [company_id]}], {}, {}, {},
            {company_id: {"leave": cell}}, indexes, self.taxonomy,
        ))

    def test_source_url_rejects_controls_at_every_supported_decode_layer(self):
        suffix = "%0A"
        for layers in range(1, 17):
            with self.subTest(layers=layers):
                with self.assertRaisesRegex(ValueError, "invalid"):
                    self.renderer.publication_source_url({"url": "https://example.test/" + suffix})
            suffix = suffix.replace("%", "%25")

    def test_source_url_rejects_excessive_nesting_malformed_escapes_and_unsafe_authority(self):
        nested = "%25"
        for _ in range(17):
            nested = nested.replace("%", "%25")
        rejected = (
            "https://example.test/" + nested,
            "https://example.test/%80",
            "https://example.test/%ZZ",
            "https://example.test/trailing%",
            "https://example%2Etest/path",
            "https://example%40test/path",
            "https://example%3A443/path",
            "https://%5Bexample.test%5D/path",
            "https://example.test/raw space",
            "https://example.test\\evil/path",
            "https://example.test/\u200bhidden",
            "https://example.test/%E2%80%8Bhidden",
            "https://example.test/\u202eoverride",
            "https://example.test/%E2%80%AEoverride",
            "https://example.test/\u2066isolate",
            "https://example.test/%E2%81%A6isolate",
            "https://example.test/\ufeffbom",
            "https://example.test/%EF%BB%BFbom",
            "https://:/path",
            "https://example.test:bad/path",
            "https://example.test:/path",
            "https://example.test/\x85",
        )
        for url in rejected:
            with self.subTest(url=url):
                with self.assertRaisesRegex(ValueError, "invalid|nesting"):
                    self.renderer.publication_source_url({"url": url})

    def test_v2_source_url_preserves_safe_percent_encoded_targets(self):
        for url in (
                "https://example.test/%ED%95%9C%EA%B8%80",
                "https://example.test/literal%25value",
                "https://example.test/한글"):
            with self.subTest(url=url):
                self.assertEqual(url, self.renderer.publication_source_url({"url": url}))

    def test_v2_semantic_filter_rejects_templates_shells_and_overlong_fields(self):
        company_id = self.companies[1]["company_id"]
        rejected = (
            "회사의 leave 범주 복리후생을 독립적으로 취득한 공개 페이지가 명시한다.",
            "직원 사용 기반 공개 복지 페이지가 회사의 leave 관련 항목을 열거한다.",
            "유급휴가 window clientWidth navigation login copyright menu",
            "# 채용 페이지\n![회사 이미지](https://example.com/logo.png) 유급휴가 제공",
            "유급휴가 " + "가" * self.renderer.PUBLICATION_PROSE_MAX_CHARS,
        )
        for prose in rejected:
            with self.subTest(prose=prose[:40]):
                cell, indexes = self.v2_evidence("reference", company_id)
                record = next(iter(indexes["references"].values()))
                record["statement"] = prose
                record["supporting_quote"] = prose
                self.assertEqual([], self.renderer.curate_installment_entries(
                    [{"batch_id": "v2", "company_ids": [company_id]}], {}, {}, {},
                    {company_id: {"leave": cell}}, indexes, self.taxonomy,
                ))

    def test_v2_fail_closed_policy_does_not_use_a_category_or_record_allowlist(self):
        company_id = self.companies[1]["company_id"]
        accepted = {}
        for category in ("leave", "family", "health", "growth", "housing", "commute",
                         "remote", "retirement", "meals", "inclusion"):
            cell, indexes = self.v2_evidence("reference", company_id, category)
            accepted[category] = bool(self.renderer.publication_evidence(
                company_id, [], {}, {}, self.taxonomy, {category: cell}, indexes,
            ))
        self.assertEqual({category: False for category in accepted}, accepted)
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertNotIn("CATEGORY_PUBLICATION_TERMS", source)
        self.assertNotIn("_entity_benefit_phrase", source)
        self.assertNotIn("V2_RECORD_KEYS", source)

    def test_v2_semantic_filter_requires_bound_entity_and_employee_benefit_action(self):
        company_id = self.companies[1]["company_id"]
        rejected = (
            "다른회사 직원에게 유급휴가를 제공한다",
            "선정 법인은 유급휴가 제품을 고객에게 판매한다",
            "선정 법인 유급휴가 채용 지원자는 지원하세요",
        )
        for prose in rejected:
            with self.subTest(prose=prose):
                cell, indexes = self.v2_evidence("reference", company_id)
                record = next(iter(indexes["references"].values()))
                entity = record["scope"]["legal_entities"][0]
                record["statement"] = prose.replace("선정 법인", entity)
                record["supporting_quote"] = record["statement"]
                self.assertEqual([], self.renderer.publication_evidence(
                    company_id, [], {}, {}, self.taxonomy, {"leave": cell}, indexes,
                ))

    def test_v2_semantic_filter_uses_safe_corporate_alias_boundaries(self):
        company_id = self.companies[1]["company_id"]
        cell, indexes = self.v2_evidence("reference", company_id, "meals")
        record = next(iter(indexes["references"].values()))
        source = next(iter(indexes["sources"].values()))
        record["scope"]["legal_entities"] = ["SM Inc."]
        source["scope"]["legal_entities"] = ["SM Inc."]
        record["statement"] = record["supporting_quote"] = "SMC International 직원에게 식사를 제공한다"
        self.assertEqual([], self.renderer.publication_evidence(
            company_id, [], {}, {}, self.taxonomy, {"meals": cell}, indexes,
        ))

        record["scope"]["legal_entities"] = ["Acme Corporation"]
        source["scope"]["legal_entities"] = ["Acme Corporation"]
        record["statement"] = record["supporting_quote"] = "Acme employees receive meal benefits"
        self.assertFalse(self.renderer.publication_evidence(
            company_id, [], {}, {}, self.taxonomy, {"meals": cell}, indexes,
        ))

    def test_v2_semantic_filter_accepts_exact_short_bound_phrase(self):
        company_id = self.companies[1]["company_id"]
        cell, indexes = self.v2_evidence("community", company_id, "remote")
        record = next(iter(indexes["community_reports"].values()))
        source = next(iter(indexes["sources"].values()))
        record["scope"]["legal_entities"] = ["(주)동방"]
        source["scope"]["legal_entities"] = ["(주)동방"]
        record["statement"] = "(주)동방 직원에게 원격근무를 지원한다"
        self.assertFalse(self.renderer.publication_evidence(
            company_id, [], {}, {}, self.taxonomy, {"remote": cell}, indexes,
        ))

    def test_official_metadata_only_record_is_excluded_without_title_fallback(self):
        company_id = self.companies[1]["company_id"]
        cell, indexes = self.v2_evidence("official", company_id)
        record = indexes["official_claims"][next(iter(indexes["official_claims"]))]
        self.assertNotIn("statement", record)
        self.assertNotIn("supporting_quote", record)
        entries = [{"batch_id": "official-metadata", "company_ids": [company_id]}]
        self.assertEqual([], self.renderer.curate_installment_entries(
            entries, {}, {}, {}, {company_id: {"leave": cell}}, indexes, self.taxonomy,
        ))

    def test_v2_duplicate_ids_wrong_classes_and_malformed_sources_are_rejected(self):
        company_id = self.companies[1]["company_id"]

        def duplicate_record(cell, indexes):
            cell["reference_ids"].append(cell["reference_ids"][0])

        def wrong_record_class(cell, indexes):
            record = indexes["references"].pop(next(iter(indexes["references"])))
            record["reference_id"] = "community::wrong-class"
            cell["reference_ids"] = ["community::wrong-class"]
            indexes["references"]["community::wrong-class"] = record

        def mismatched_source_key(cell, indexes):
            indexes["sources"][next(iter(indexes["sources"]))]["source_id"] = "source::different"

        def missing_title(cell, indexes):
            indexes["sources"][next(iter(indexes["sources"]))].pop("title")

        def malformed_hash(cell, indexes):
            indexes["sources"][next(iter(indexes["sources"]))]["content_sha256"] = "not-a-hash"

        def malformed_retrieval_time(cell, indexes):
            indexes["sources"][next(iter(indexes["sources"]))]["retrieved_at"] = "2026-10-30T02:00:00"

        for mutate in (duplicate_record, wrong_record_class, mismatched_source_key, missing_title,
                       malformed_hash, malformed_retrieval_time):
            with self.subTest(mutate=mutate.__name__):
                cell, indexes = self.v2_evidence("reference", company_id)
                mutate(cell, indexes)
                self.assertEqual([], self.renderer.curate_installment_entries(
                    [{"batch_id": "v2", "company_ids": [company_id]}], {}, {}, {},
                    {company_id: {"leave": cell}}, indexes, self.taxonomy,
                ))

        cell, indexes = self.v2_evidence("official", company_id)
        record = indexes["official_claims"][next(iter(indexes["official_claims"]))]
        record["source_ids"].append(record["source_ids"][0])
        self.assertEqual([], self.renderer.curate_installment_entries(
            [{"batch_id": "v2", "company_ids": [company_id]}], {}, {}, {},
            {company_id: {"leave": cell}}, indexes, self.taxonomy,
        ))

    def test_v2_records_require_canonical_ids_shapes_and_source_binding(self):
        company_id = self.companies[1]["company_id"]

        def noncanonical_id(cell, indexes):
            old = next(iter(indexes["references"]))
            record = indexes["references"].pop(old)
            record["reference_id"] = "reference::abc"
            cell["reference_ids"] = [record["reference_id"]]
            indexes["references"][record["reference_id"]] = record

        mutations = (
            noncanonical_id,
            lambda cell, indexes: next(iter(indexes["references"].values())).update(
                source_locator="https://different.example/"),
            lambda cell, indexes: next(iter(indexes["references"].values())).update(
                checked_at="2026-10-30T03:00:00Z"),
            lambda cell, indexes: next(iter(indexes["references"].values())).update(
                source_tier="other_public_web"),
            lambda cell, indexes: next(iter(indexes["references"].values()))["scope"].update(
                roles=["contractors"]),
            lambda cell, indexes: next(iter(indexes["references"].values())).update(
                currentness="historical"),
            lambda cell, indexes: next(iter(indexes["references"].values())).update(extra=True),
            lambda cell, indexes: cell.update(extra=True),
        )
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                cell, indexes = self.v2_evidence("reference", company_id)
                mutate(cell, indexes)
                self.assertEqual([], self.renderer.curate_installment_entries(
                    [{"batch_id": "v2", "company_ids": [company_id]}], {}, {}, {},
                    {company_id: {"leave": cell}}, indexes, self.taxonomy,
                ))

    def test_v2_community_requires_complete_moderation_and_frozen_snapshot(self):
        company_id = self.companies[1]["company_id"]
        mutations = (
            lambda record: record.update(moderation={"status": "approved"}),
            lambda record: record["moderation"].update(decision_sha256="short"),
            lambda record: record["moderation"].update(reviewed_at="2026-10-30T02:00:00"),
            lambda record: record.update(frozen_snapshot={}),
            lambda record: record["frozen_snapshot"].update(locator="http://snapshot.example/1"),
            lambda record: record["frozen_snapshot"].update(content_sha256="short"),
            lambda record: record["frozen_snapshot"].update(frozen_at="2026-10-30T02:00:00"),
        )
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                cell, indexes = self.v2_evidence("community", company_id)
                record = next(iter(indexes["community_reports"].values()))
                mutate(record)
                self.assertEqual([], self.renderer.curate_installment_entries(
                    [{"batch_id": "v2", "company_ids": [company_id]}], {}, {}, {},
                    {company_id: {"leave": cell}}, indexes, self.taxonomy,
                ))

    def test_all_real_v2_ledgers_are_fail_closed_including_former_survivors_and_wrong_company_transfer(self):
        research = ROOT / "docs/research/company-benefits"
        ledger_specs = {
            "official_claims": ("official-claims-v2.jsonl", "claim_id"),
            "references": ("reference-records.jsonl", "reference_id"),
            "community_reports": ("community-benefit-reports.jsonl", "community_report_id"),
            "sources": ("sources-v2.jsonl", "source_id"),
        }
        indexes = {ledger: {
            row[id_field]: row for row in self.renderer.read_jsonl(research / filename)
        } for ledger, (filename, id_field) in ledger_specs.items()}
        indexes["attempts"] = {}
        cells_by_company = {}
        for cell in self.renderer.read_jsonl(research / "company-category-cells.jsonl"):
            cells_by_company.setdefault(cell["company_id"], {})[cell["category_id"]] = cell
        accepted = [
            item
            for company_id, cells in cells_by_company.items()
            for item in self.renderer.publication_evidence(
                company_id, [], {}, {}, self.taxonomy, cells, indexes)
        ]
        accepted_by_class = {
            evidence_class: {item["record_id"] for item in accepted
                             if item["evidence_class"] == evidence_class}
            for evidence_class in ("official", "reference", "community")
        }
        former_survivors = {
            "reference::KR-CRN-1101110014409::family::source::3b6417cd6d069818d31f273c93cc345747ff99d4604bce62d3d308afd453f4bb",
            "reference::KR-CRN-1101110085450::commute::source::33701f1d2aabd9152ce4b282b9b85e04bf5b587595fd225e9d83c35dd5880070",
            "reference::KR-CRN-1101110221939::health::source::7d10df409e0828155ac0dd2c0298bdd9fa1306b6cd997416410e5590caec406f",
            "reference::KR-CRN-1101111361669::leave::source::ca6cde4350039b12d4f061e3557613a42d7b86a3f3e8904b15c9d3464cc4aa68",
            "reference::KR-CRN-1101112208000::housing::source::0bbc268d68e54e6c3331187e89d57e229593b582a27b7c5b6ffb46a6390cab4d",
            "reference::KR-CRN-1101116420361::remote::source::d9d5196e0bf08a2c23ce3b6f5476864fc75ecf30934f917e456dcb0242f6c098",
            "reference::KR-CRN-1146710001456::health::source::0aea41db5575039a8ce647fa99546c9c3cea2b11ed2c328ae3a1acf23ec48435",
            "reference::KR-CRN-1545110039704::housing::source::fe5d8237555adccd290ad7aa03200c6c117a1c67d16bdacb512409382b1d991a",
            "reference::KR-CRN-1801110186907::housing::source::7f963848dc90a44362e753be313bc8556bd159b077ab0c2875c96cd3f8df4d04",
        }
        renderer_source = SCRIPT.read_text(encoding="utf-8")
        self.assertTrue(all(record_id not in renderer_source for record_id in former_survivors))
        self.assertTrue(former_survivors.issubset(set(indexes["references"])))
        wrong_transfer = next(indexes["references"][record_id] for record_id in former_survivors
                              if "1101111361669::leave" in record_id)
        self.assertIn("osstemvascular.com", wrong_transfer["source_locator"])
        self.assertEqual({"official": set(), "reference": set(), "community": set()},
                         accepted_by_class)

    def test_renderer_does_not_call_private_schema_validator_api(self):
        company_id = self.companies[1]["company_id"]
        cell, indexes = self.v2_evidence("reference", company_id)
        with mock.patch.object(self.renderer, "load_module", side_effect=AssertionError("private API")):
            self.assertFalse(self.renderer.publication_evidence(
                company_id, [], {}, {}, self.taxonomy, {"leave": cell}, indexes,
            ))
        self.assertNotIn("_schema_validators", SCRIPT.read_text(encoding="utf-8"))

    def test_v2_mismatched_malformed_and_noneligible_evidence_is_rejected(self):
        company_id = self.companies[1]["company_id"]
        mutations = (
            lambda cell, indexes: next(iter(indexes["references"].values())).update(company_id="other"),
            lambda cell, indexes: next(iter(indexes["references"].values())).update(source_id=""),
            lambda cell, indexes: next(iter(indexes["references"].values())).update(publication_eligibility="discovery_only"),
            lambda cell, indexes: indexes["sources"][next(iter(indexes["sources"]))].update(
                url="http://evidence.example/reference"),
            lambda cell, indexes: cell.update(state="no_public_info"),
        )
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                cell, indexes = self.v2_evidence("reference", company_id)
                mutate(cell, indexes)
                entries = [{"batch_id": "v2", "company_ids": [company_id]}]
                self.assertEqual([], self.renderer.curate_installment_entries(
                    entries, {}, {}, {}, {company_id: {"leave": cell}}, indexes, self.taxonomy,
                ))

    def test_legacy_unclassified_claim_is_rejected(self):
        claim = self.evidence_claim()
        assignments = {claim["claim_id"]: {"assignment": {
            "state": "unclassified", "benefit_type_ids": []}}}
        self.assertFalse(self.renderer.has_meaningful_benefit_evidence(
            claim["company_id"], [claim], {"source-1": {"url": "https://example.test/reference"}},
            assignments, self.taxonomy,
        ))

    def test_evidence_predicate_retains_bound_concrete_reference(self):
        claim = self.evidence_claim()
        self.assertTrue(self.renderer.has_meaningful_benefit_evidence(
            claim["company_id"], [claim], {"source-1": {"url": "https://example.test/reference"}},
            {claim["claim_id"]: {"assignment": {"state": "assigned", "benefit_type_ids": ["paid-leave"]}}},
        ))

    def test_evidence_predicate_rejects_metadata_http_gap_and_unknown_only_rows(self):
        for status in ("unknown", "name_only", "unresolved", "not_researched"):
            with self.subTest(status=status):
                claim = self.evidence_claim(status=status)
                assignment = {
                    claim["claim_id"]: {
                        "assignment": {"state": "assigned", "benefit_type_ids": ["paid-leave"]}
                    }
                }
                source_map = {"source-1": {"url": "https://example.test/reference"}}
                self.assertFalse(self.renderer.has_meaningful_benefit_evidence(
                    claim["company_id"], [claim], source_map, assignment,
                ))
                entry = {"company_ids": [claim["company_id"]]}
                self.assertEqual([], self.renderer.curate_installment_entries(
                    [entry], {claim["company_id"]: [claim]}, source_map, assignment,
                ))
        metadata = self.evidence_claim(status="confirmed")
        self.assertFalse(self.renderer.has_meaningful_benefit_evidence(
            metadata["company_id"], [metadata],
            {"source-1": {
                "url": "https://example.test/search", "retention_mode": "metadata_only",
                "access_observation": {"status": 403},
            }},
            {metadata["claim_id"]: {
                "assignment": {"state": "assigned", "benefit_type_ids": ["paid-leave"]}
            }},
        ))

    def test_evidence_predicate_retains_historical_and_conflicting_bound_sources(self):
        for status in ("past", "conflict"):
            with self.subTest(status=status):
                claim = self.evidence_claim(status=status, claim_id=f"claim-{status}")
                self.assertTrue(self.renderer.has_meaningful_benefit_evidence(
                    claim["company_id"], [claim],
                    {"source-1": {"url": "https://example.test/evidence"}},
                    {claim["claim_id"]: {"assignment": {"state": "assigned", "benefit_type_ids": ["paid-leave"]}}},
                ))

    def test_curation_omits_empty_batch_and_keeps_only_meaningful_company_in_mixed_batch(self):
        meaningful_id, empty_id = self.companies[0]["company_id"], self.companies[1]["company_id"]
        claim = self.evidence_claim(company_id=meaningful_id)
        entries = [{"batch_id": "mixed", "company_ids": [meaningful_id, empty_id]},
                   {"batch_id": "empty", "company_ids": [empty_id]}]
        curated = self.renderer.curate_installment_entries(
            entries, {meaningful_id: [claim]}, {"source-1": {"url": "https://example.test/evidence"}},
            {claim["claim_id"]: {"assignment": {"state": "assigned", "benefit_type_ids": ["paid-leave"]}}},
        )
        self.assertEqual(["mixed"], [entry["batch_id"] for entry in curated])
        self.assertEqual([meaningful_id], curated[0]["company_ids"])
        self.assertEqual([meaningful_id, empty_id], entries[0]["company_ids"])

    def test_hub_uses_compact_emitted_links_and_actual_scope_counts(self):
        hub = next(row for row in self.render_map["entries"] if row["artifact_type"] == "hub")
        installments = [
            {"scope": "domestic", "title": "국내 기업 복지 공식자료 검증 D1: 25개 보고 법인 기록", "filename": "_posts/d1.md"},
            {"scope": "domestic", "title": "국내 기업 복지 공식자료 검증 D2: 25개 보고 법인 기록", "filename": "_posts/d2.md"},
            {"scope": "international", "title": "해외 기업 복지 공식자료 검증 I1: 미국 SEC 공시 법인 25곳", "filename": "_posts/i1.md"},
        ]
        source_map = {
            source_id: {"url": f"https://example.test/{source_id}"}
            for source_id in hub["citation_source_mapping"]["population_source_ids"]
        }
        text = self.renderer.render_hub(hub, installments, source_map)
        self.assertIn("## 국내 2개 배치", text)
        self.assertIn("## 해외 1개 배치", text)
        self.assertIn("배치 코드를 선택하면 포함된 법인 기록으로 이동합니다.", text)
        self.assertIn("[D1]({% post_url d1 %}) · [D2]({% post_url d2 %})", text)
        self.assertIn("[I1]({% post_url i1 %})", text)
        self.assertNotIn("국내 기업 복지 공식자료 검증 D1", text)
        self.assertNotIn("> 이 디렉터리는", text)
        self.assertNotIn("전체 3개 배치가", text)
        self.assertEqual(3, text.count("{% post_url"))

    def test_publication_removes_only_known_generated_posts_omitted_from_inventory(self):
        rendered = self.rendered_posts()
        omitted = sorted(rendered)[0]
        rendered.pop(omitted)
        stale = self.output / omitted
        unrelated = self.output / "_posts/unrelated.md"
        stale.parent.mkdir(parents=True)
        stale.write_text("old generated filler\n", encoding="utf-8")
        unrelated.write_text("unrelated\n", encoding="utf-8")
        self.renderer.publish_rendered_posts(rendered, self.output)
        self.assertFalse(stale.exists())
        self.assertEqual("unrelated\n", unrelated.read_text(encoding="utf-8"))

    def test_contract_map_has_81_unique_production_paths_and_2000_ids_once(self):
        entries = self.renderer.validate_render_map(self.real_map)
        installments = [row for row in entries if row["artifact_type"] == "installment"]
        self.assertEqual((40, 40, 1), (
            sum(row["scope"] == "domestic" for row in installments),
            sum(row["scope"] == "international" for row in installments),
            sum(row["artifact_type"] == "hub" for row in entries),
        ))
        for field in ("filename", "slug", "title", "banner_seed"):
            self.assertEqual(81, len({row[field] for row in entries}), field)
        ids = [company_id for row in installments for company_id in row["company_ids"]]
        self.assertEqual(2000, len(ids))
        self.assertEqual(2000, len(set(ids)))
        self.assertTrue(all(len(row["company_ids"]) == 25 for row in installments))

    def test_renders_only_evidence_bearing_batches_deterministically_without_mutating_ledgers(self):
        ledger_hashes = {
            path.relative_to(self.research): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in self.research.rglob("*") if path.is_file()
        }
        first = self.render()
        snapshot = {path.relative_to(self.output): path.read_bytes() for path in sorted(self.output.rglob("*.md"))}
        self.assertEqual(2, len(first))
        self.assertEqual(2, len(snapshot))
        second = self.render()
        self.assertEqual(snapshot, {path.relative_to(self.output): path.read_bytes() for path in sorted(self.output.rglob("*.md"))})
        self.assertEqual(first, second)
        self.assertEqual(ledger_hashes, {
            path.relative_to(self.research): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in self.research.rglob("*") if path.is_file()
        })

        all_text = "\n".join(raw.decode() for raw in snapshot.values())
        ids = re.findall(r"법인 ID: `([^`]+)`", all_text)
        self.assertEqual([self.companies[0]["company_id"]], ids)
        self.assertNotIn(self.companies[1]["legal_name"], all_text)
        self.assertNotIn("조사한 공식 경로", all_text)
        self.assertNotIn("HTTP 200", all_text)
        self.assertNotIn("series-historical-audit", all_text)
        self.assertNotRegex(all_text, r"(?:종합|전체) 순위\s*[:：]?\s*\d|\b1위\b")

        emitted = {str(path) for path in snapshot}
        for entry in [row for row in self.render_map["entries"] if row["filename"] in emitted]:
            text = snapshot[Path(entry["filename"])].decode()
            self.assertTrue(text.startswith("---\n"))
            front = text.split("---\n", 2)[1]
            self.assertIn(f"title: '{entry['title']}'", front)
            self.assertIn(f"date: {entry['date']}", front)
            self.assertIn(f"featured_image: '{entry['featured_image']}'", front)
            first_image = re.search(r"!\[[^]]+\]\(([^)]+)\)", text).group(1)
            self.assertEqual(entry["featured_image"], first_image)
            self.assertEqual(f"https://picsum.photos/seed/{entry['banner_seed']}/1600/900", first_image)
            if entry["artifact_type"] == "installment":
                self.assertEqual(1, text.count("법인 ID: `"))
                self.assertIn("복지가 없다는 뜻이 아닙니다", text)
                self.assertIn("순위가 아닙니다", text)

    def test_render_series_consumes_one_publication_gate_snapshot_without_rereading_ledgers(self):
        generator = load(ROOT / "scripts/generate-company-benefits-artifacts.py", "frozen_renderer_gate")
        with mock.patch.object(generator, "verify_active_ledgers", return_value=None):
            frozen = generator.publication_gate(
                self.research, TAXONOMY, "2026-10-31", None, None,
            )
        gate = mock.Mock()

        def return_frozen_then_mutate(*args):
            (self.research / "company-category-cells.jsonl").write_text("changed after gate\n")
            (self.research / "series-batches.jsonl").write_text("changed after gate\n")
            (self.research / "series-prepublication-checks.jsonl").write_text("changed after gate\n")
            return frozen

        gate.publication_gate.side_effect = return_frozen_then_mutate
        with mock.patch.object(self.renderer, "load_module", return_value=gate) as loader:
            emitted = self.renderer.render_series(
                self.research, self.map_path, self.output, TAXONOMY, as_of="2026-10-31",
            )
        loader.assert_called_once()
        gate.publication_gate.assert_called_once_with(
            self.research, TAXONOMY, self.renderer.date(2026, 10, 31), None, None,
        )
        self.assertEqual(2, len(emitted))
        text = "\n".join(path.read_text(encoding="utf-8") for path in self.output.rglob("*.md"))
        self.assertIn(self.companies[0]["legal_name"], text)
        self.assertNotIn(self.companies[1]["legal_name"], text)
        renderer_source = SCRIPT.read_text(encoding="utf-8")
        self.assertNotIn("verify_active_ledgers(", renderer_source)
        self.assertNotIn("validate_complete_inputs(", renderer_source)

    def test_citations_are_contiguous_and_sources_follow_first_seen_order(self):
        self.render()
        for path in self.output.rglob("*.md"):
            text = path.read_text(encoding="utf-8")
            body, ledger = text.split("\n## Sources\n", 1)
            seen = []
            for value in re.findall(r"\[(\d+)\]", body):
                number = int(value)
                if number not in seen:
                    seen.append(number)
            sources = [int(value) for value in re.findall(r"^\[(\d+)\] https://", ledger, re.MULTILINE)]
            self.assertGreater(len(sources), 0, path)
            self.assertEqual(list(range(1, len(seen) + 1)), seen, path)
            self.assertEqual(seen, sources, path)

    def test_filtered_claim_sources_are_dense_first_use_ordered_and_orphan_free(self):
        company = self.companies[0]
        entry = copy.deepcopy(next(
            row for row in self.render_map["entries"] if row["artifact_type"] == "installment"
        ))
        entry["company_ids"] = [company["company_id"]]
        base = {
            "company_id": company["company_id"], "benefit_name": "Bound benefit",
            "detail": "Concrete benefit detail.", "status": "confirmed", "evidence_grade": "A",
            "application_scope": {}, "checked_at": "2026-10-30T02:00:00Z",
        }
        first = {**base, "claim_id": "claim-a", "source_ids": ["source-b", "source-a"],
                 "source_evidence": [{"source_id": "source-b"}, {"source_id": "source-a"}]}
        second = {**base, "claim_id": "claim-b", "source_ids": ["source-a"],
                  "source_evidence": [{"source_id": "source-a"}]}
        unknown = {**base, "claim_id": "claim-gap", "status": "unknown",
                   "source_ids": [], "source_evidence": [], "searched_source_ids": ["source-gap"]}
        sources = {
            key: {"url": f"https://example.test/{key}"}
            for key in ("source-a", "source-b", "source-gap")
        }
        assignments = {
            claim["claim_id"]: {"assignment": {"state": "assigned", "benefit_type_ids": ["paid-leave"]}}
            for claim in (first, second)
        }
        text = self.renderer.render_installment(
            entry, {company["company_id"]: company},
            {company["company_id"]: [first, unknown, second]}, {}, sources, {}, assignments, self.taxonomy,
        )
        body, ledger = text.split("\n## Sources\n", 1)
        self.assertNotIn("source-gap", text)
        self.assertIn("Concrete benefit detail.[1][2]", body)
        self.assertIn("Concrete benefit detail.[2]", body)
        self.assertEqual(
            ["https://example.test/source-b", "https://example.test/source-a"],
            re.findall(r"^\[\d+\] (https://\S+)$", ledger, re.MULTILINE),
        )

    def test_gap_only_companies_do_not_render_company_sections(self):
        gaps_path = self.research / "series-research-gaps.jsonl"
        gaps = [json.loads(line) for line in gaps_path.read_text().splitlines()]
        gaps[0]["reason"] = (
            "Internal approval review expected_marker=secret-marker; response SHA256 "
            + "a" * 64 + "; raw check 2026-10-30T02:00:00Z."
        )
        gaps_path.write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in gaps), encoding="utf-8"
        )
        self.render()
        all_text = "\n".join(path.read_text(encoding="utf-8") for path in self.output.rglob("*.md"))
        self.assertNotIn(self.companies[1]["legal_name"], all_text)
        self.assertNotIn("- 조사한 공식 경로:", all_text)
        self.assertNotIn("- 관찰 상태:", all_text)
        self.assertNotIn("- 조사 결과:", all_text)
        self.assertNotRegex(all_text, r"(?i)\b(?:response|content)[ _-]?sha256\b|\b[a-f0-9]{64}\b")
        self.assertNotRegex(all_text, r"(?i)\b(?:expected_marker|reviewer_id|review_id|approval[_ -]?status)\b")
        self.assertNotRegex(all_text, r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z")

    def test_metadata_and_http_route_do_not_make_company_meaningful(self):
        company_id = self.companies[1]["company_id"]
        gap = next(json.loads(line) for line in (self.research / "series-research-gaps.jsonl").read_text().splitlines()
                   if json.loads(line)["company_id"] == company_id)
        gap["searched_official_source_ids"] = ["official-route-private-id"]
        gap["reason"] = (
            "Internal approval review expected_marker=secret; response SHA256 " + "a" * 64
            + "; checked_at=2026-10-30T02:00:00Z"
        )
        source = {
            "source_id": "official-route-private-id",
            "title": "Official employer search — official-route-private-id",
            "owner": "Official registry",
            "url": "https://verified.example.gov/employer-search",
            "locator": "selected reporting entity search",
            "record_type": "nonpublishable_metadata",
            "source_type": "government_register",
            "route_quality": "exact_entity",
            "entity_binding_status": "exact_entity",
            "publication_eligible": False,
            "retention_mode": "metadata_only",
            "access_observation": {"status": 403, "final_url": "https://verified.example.gov/employer-search", "access_wall": "bot_or_network_block"},
        }
        check = {
            "source_id": source["source_id"], "url": source["url"], "status": 403,
            "final_url": source["url"], "access_wall": "bot_or_network_block",
            "checked_at": "2026-10-30T02:00:00Z",
        }
        entry = {"batch_id": "metadata-only", "company_ids": [company_id]}
        self.assertEqual([], self.renderer.curate_installment_entries(
            [entry], {}, {source["source_id"]: source}, {},
        ))

    def test_replace_failure_restores_exact_prior_bytes_and_cleans_transaction_files(self):
        rendered = self.rendered_posts()
        relatives = sorted(rendered)
        old = {}
        for number in range(5):
            path = self.output / relatives[number]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(f"old-{number}\r\n".encode())
            old[path] = path.read_bytes()
        real_replace = self.renderer.os.replace
        calls = 0

        def fail_replace(source, target):
            nonlocal calls
            calls += 1
            if calls == 4:
                raise OSError("injected replace failure")
            return real_replace(source, target)

        with mock.patch.object(self.renderer.os, "replace", side_effect=fail_replace):
            with self.assertRaisesRegex(OSError, "injected replace failure"):
                self.renderer.publish_rendered_posts(rendered, self.output)
        self.assertEqual(old, {path: path.read_bytes() for path in old})
        self.assertEqual(set(old), set(self.output.rglob("*.md")))
        self.assertFalse(any(self.output.parent.glob(".company-benefits-posts-transaction*")))

    def test_interrupted_publication_is_recovered_before_next_publication(self):
        rendered = self.rendered_posts()
        first_relative = sorted(rendered)[0]
        first = self.output / first_relative
        first.parent.mkdir(parents=True, exist_ok=True)
        first.write_bytes(b"old\r\n")
        real_replace = self.renderer.os.replace
        calls = 0

        def interrupt_replace(source, target):
            nonlocal calls
            calls += 1
            if calls == 3:
                raise KeyboardInterrupt()
            return real_replace(source, target)

        with mock.patch.object(self.renderer.os, "replace", side_effect=interrupt_replace):
            with self.assertRaises(KeyboardInterrupt):
                self.renderer.publish_rendered_posts(rendered, self.output)
        self.assertTrue(any(self.output.parent.glob(".company-benefits-posts-transaction*")))

        self.renderer.recover_publication(self.output)
        self.assertEqual(b"old\r\n", first.read_bytes())
        self.assertEqual([first], list(self.output.rglob("*.md")))
        self.assertFalse(any(self.output.parent.glob(".company-benefits-posts-transaction*")))

        self.renderer.publish_rendered_posts(rendered, self.output)
        self.assertEqual(81, len(list(self.output.rglob("*.md"))))
        self.assertEqual(rendered[first_relative].encode(), first.read_bytes())
        self.assertFalse(any(self.output.parent.glob(".company-benefits-posts-transaction*")))

    def test_recovery_never_deletes_a_concurrently_replaced_target(self):
        rendered = self.rendered_posts()
        real_replace = self.renderer.os.replace
        calls = 0

        def interrupt_replace(source, target):
            nonlocal calls
            calls += 1
            if calls == 4:
                raise KeyboardInterrupt()
            return real_replace(source, target)

        with mock.patch.object(self.renderer.os, "replace", side_effect=interrupt_replace):
            with self.assertRaises(KeyboardInterrupt):
                self.renderer.publish_rendered_posts(rendered, self.output)
        installed = self.output / sorted(rendered)[0]
        installed.write_bytes(b"concurrent-owner\n")
        with self.assertRaisesRegex(RuntimeError, "concurrent"):
            self.renderer.recover_publication(self.output)
        self.assertEqual(b"concurrent-owner\n", installed.read_bytes())

    def test_publication_rejects_paths_outside_generated_inventory(self):
        rendered = self.rendered_posts()
        value = rendered.pop(next(iter(rendered)))
        rendered["_posts/unexpected.md"] = value
        with self.assertRaisesRegex(ValueError, "generated filename subset"):
            self.renderer.publish_rendered_posts(rendered, self.output)
        self.assertFalse(self.output.exists())

    def test_crafted_traversal_journal_cannot_delete_a_sibling(self):
        sibling = self.base / "victim.md"
        sibling.write_bytes(b"owned-by-sibling\n")
        journal = self.output.parent / ".company-benefits-posts-transaction.json"
        item = {
            "relative": "../victim.md", "old_exists": False, "old_sha256": None,
            "new_sha256": self.renderer._sha256(sibling.read_bytes()),
        }
        journal.write_text(json.dumps({
            "schema_version": "company-benefits-publication-v2", "state": "prepared",
            "output_root": os.path.abspath(self.output),
            "transaction": ".company-benefits-posts-transaction-" + "a" * 32,
            "items": [item] * 81,
        }), encoding="utf-8")
        with self.assertRaises(RuntimeError):
            self.renderer.recover_publication(self.output)
        self.assertEqual(b"owned-by-sibling\n", sibling.read_bytes())

    def test_symlinked_output_root_is_rejected_without_touching_destination(self):
        destination = self.base / "destination"
        destination.mkdir()
        self.output.symlink_to(destination, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, "symlink"):
            self.renderer.publish_rendered_posts(self.rendered_posts(), self.output)
        self.assertEqual([], list(destination.rglob("*")))

    def test_symlinked_posts_parent_is_rejected_without_touching_destination(self):
        destination = self.base / "destination"
        destination.mkdir()
        self.output.mkdir()
        (self.output / "_posts").symlink_to(destination, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, "symlink"):
            self.renderer.publish_rendered_posts(self.rendered_posts(), self.output)
        self.assertEqual([], list(destination.rglob("*")))

    def test_journal_hash_tampering_is_rejected_without_mutating_targets(self):
        rendered = self.rendered_posts()
        real_replace = self.renderer.os.replace
        calls = 0

        def interrupt(source, target):
            nonlocal calls
            calls += 1
            if calls == 4:
                raise KeyboardInterrupt()
            return real_replace(source, target)

        with mock.patch.object(self.renderer.os, "replace", side_effect=interrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.renderer.publish_rendered_posts(rendered, self.output)
        journal_path = self.output.parent / ".company-benefits-posts-transaction.json"
        journal = json.loads(journal_path.read_text())
        journal["items"][0]["new_sha256"] = "0" * 64
        journal_path.write_text(json.dumps(journal), encoding="utf-8")
        installed = self.output / sorted(rendered)[0]
        before = installed.read_bytes()
        with self.assertRaisesRegex(RuntimeError, "hash|journal"):
            self.renderer.recover_publication(self.output)
        self.assertEqual(before, installed.read_bytes())

    def test_cross_process_lock_refuses_a_concurrent_publisher(self):
        self.output.parent.mkdir(parents=True, exist_ok=True)
        lock_path = self.output.parent / ".company-benefits-posts.lock"
        descriptor = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(RuntimeError, "publisher.*lock|publication.*lock"):
                self.renderer.publish_rendered_posts(self.rendered_posts(), self.output)
        finally:
            os.close(descriptor)

    def test_crash_before_transaction_directory_creation_is_recoverable(self):
        real_mkdir = self.renderer.os.mkdir

        def interrupt(path, *args, **kwargs):
            if ".company-benefits-posts-transaction-" in os.fspath(path):
                raise KeyboardInterrupt()
            return real_mkdir(path, *args, **kwargs)

        with mock.patch.object(self.renderer.os, "mkdir", side_effect=interrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.renderer.publish_rendered_posts(self.rendered_posts(), self.output)
        self.renderer.recover_publication(self.output)
        self.assertFalse(any(self.output.parent.glob(".company-benefits-posts-transaction*")))

    def test_committed_cleanup_interruption_finishes_forward_not_rollback(self):
        rendered = self.rendered_posts()
        with mock.patch.object(self.renderer, "_remove_tree_durable", side_effect=KeyboardInterrupt()):
            with self.assertRaises(KeyboardInterrupt):
                self.renderer.publish_rendered_posts(rendered, self.output)
        expected = {relative: text.encode() for relative, text in rendered.items()}
        self.renderer.recover_publication(self.output)
        self.assertEqual(expected, {
            str(path.relative_to(self.output)): path.read_bytes()
            for path in self.output.rglob("*.md")
        })
        self.assertFalse(any(self.output.parent.glob(".company-benefits-posts-transaction*")))

    def test_every_atomic_replace_crash_boundary_recovers_exact_old_state(self):
        rendered = self.rendered_posts()
        relatives = sorted(rendered)
        # Preparing journal, prepared journal, 81 targets, committed journal.
        for failure_at in range(1, 85):
            with (self.subTest(failure_at=failure_at),
                  tempfile.TemporaryDirectory(dir=self.base) as directory,
                  mock.patch.object(self.renderer.os, "fsync", return_value=None)):
                output = Path(directory) / "site"
                old = {}
                for relative in (relatives[0], relatives[40], relatives[-1]):
                    target = output / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(("old-" + relative + "\n").encode())
                    old[target] = target.read_bytes()
                real_replace = self.renderer.os.replace
                calls = 0

                def crash(source, target):
                    nonlocal calls
                    calls += 1
                    if calls == failure_at:
                        raise KeyboardInterrupt()
                    return real_replace(source, target)

                with mock.patch.object(self.renderer.os, "replace", side_effect=crash):
                    with self.assertRaises(KeyboardInterrupt):
                        self.renderer.publish_rendered_posts(rendered, output)
                self.renderer.recover_publication(output)
                self.assertEqual(old, {path: path.read_bytes() for path in old})
                self.assertEqual(set(old), set(output.rglob("*.md")))

    def test_strict_journal_contract_rejects_version_state_schema_and_duplicates(self):
        items = [{
            "relative": relative, "old_exists": False, "old_sha256": None,
            "new_sha256": "1" * 64,
        } for relative in sorted(self.renderer.EXPECTED_PUBLICATION_FILENAMES)]
        valid = {
            "schema_version": "company-benefits-publication-v2", "state": "prepared",
            "output_root": os.path.abspath(self.output),
            "transaction": ".company-benefits-posts-transaction-" + "a" * 32,
            "items": items,
        }
        malformed = []
        value = copy.deepcopy(valid); value["schema_version"] = "v1"; malformed.append(value)
        value = copy.deepcopy(valid); value["state"] = "installing"; malformed.append(value)
        value = copy.deepcopy(valid); value["extra"] = True; malformed.append(value)
        value = copy.deepcopy(valid); value["items"][1] = copy.deepcopy(value["items"][0]); malformed.append(value)
        value = copy.deepcopy(valid); value["items"][0]["relative"] = "/absolute.md"; malformed.append(value)
        value = copy.deepcopy(valid); value["items"][0]["new_sha256"] = "2" * 63; malformed.append(value)
        value = copy.deepcopy(valid); value["items"].reverse(); malformed.append(value)
        for journal in malformed:
            with self.subTest(state=journal.get("state")):
                with self.assertRaises(RuntimeError):
                    self.renderer._validate_journal(journal, self.output)

    def test_recovery_refuses_to_remove_an_unowned_transaction_entry(self):
        rendered = self.rendered_posts()
        real_replace = self.renderer.os.replace
        calls = 0

        def interrupt(source, target):
            nonlocal calls
            calls += 1
            if calls == 3:
                raise KeyboardInterrupt()
            return real_replace(source, target)

        with mock.patch.object(self.renderer.os, "replace", side_effect=interrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.renderer.publish_rendered_posts(rendered, self.output)
        journal = json.loads((self.output.parent / ".company-benefits-posts-transaction.json").read_text())
        unowned = self.output.parent / journal["transaction"] / "do-not-delete.txt"
        unowned.write_bytes(b"concurrent-owner\n")
        with self.assertRaisesRegex(RuntimeError, "unexpected"):
            self.renderer.recover_publication(self.output)
        self.assertEqual(b"concurrent-owner\n", unowned.read_bytes())

    def test_gap_without_preserved_official_source_id_route_fails_instead_of_rendering_placeholder(self):
        company_id = self.companies[1]["company_id"]
        gap = next(json.loads(line) for line in (self.research / "series-research-gaps.jsonl").read_text().splitlines()
                   if json.loads(line)["company_id"] == company_id)
        gap["searched_official_source_ids"] = []
        gaps_path = self.research / "series-research-gaps.jsonl"
        gaps = [json.loads(line) for line in gaps_path.read_text().splitlines()]
        gaps = [gap if row["company_id"] == company_id else row for row in gaps]
        self.fixtures.write_jsonl(gaps_path, gaps)
        with self.assertRaisesRegex(ValueError, "official source-ID route|official route"):
            self.render()

    def test_incomplete_series_is_blocked_without_writing_posts(self):
        progress_path = self.research / "series-progress.json"
        progress = json.loads(progress_path.read_text())
        progress["status"] = "in_progress"
        progress["batches"][0]["status"] = "pending"
        progress_path.write_text(json.dumps(progress), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "complete|approved|progress.*schema"):
            self.render()
        self.assertFalse(self.output.exists())

    def test_unknown_claim_does_not_emit_a_filler_installment(self):
        claims_path = self.research / "benefit-claims.jsonl"
        claim = json.loads(claims_path.read_text().strip())
        claim.update(
            status="unknown",
            detail="공식 공개자료에서 확인하지 못했습니다.",
            source_ids=["source-1"],
            source_evidence=[],
            searched_source_ids=["searched-source-1"],
            searched_at="2026-10-30T02:00:00Z",
        )
        self.fixtures.write_jsonl(claims_path, [claim])
        sources_path = self.research / "source-registry.jsonl"
        sources = [json.loads(line) for line in sources_path.read_text().splitlines()]
        searched_source = copy.deepcopy(next(row for row in sources if row["source_id"] == "source-1"))
        searched_source.update(source_id="searched-source-1", url="https://verified.example.gov/benefits-search")
        self.fixtures.write_jsonl(sources_path, [*sources, searched_source])
        checks_path = self.research / "series-prepublication-checks.jsonl"
        checks = [json.loads(line) for line in checks_path.read_text().splitlines()]
        searched_check = copy.deepcopy(next(row for row in checks if row["source_id"] == "source-1"))
        searched_check.update(
            source_id="searched-source-1", url=searched_source["url"], final_url=searched_source["url"],
        )
        self.fixtures.write_jsonl(checks_path, [*checks, searched_check])
        self.fixtures.write_taxonomy_approval(
            self.research,
            {"state": "unclassified", "benefit_type_ids": [],
             "reason_code": "insufficient_claim_specific_evidence"},
        )
        emitted = self.render()
        hub = next(row["filename"] for row in self.render_map["entries"] if row["artifact_type"] == "hub")
        self.assertEqual([hub], emitted)
        self.assertEqual([self.output / hub], list(self.output.rglob("*.md")))

    def test_missing_assignment_source_review_or_check_fails_closed(self):
        cases = (
            "benefit-taxonomy-assignments.jsonl",
            "source-registry.jsonl",
            "reviews.jsonl",
            "series-prepublication-checks.jsonl",
        )
        originals = {name: (self.research / name).read_bytes() for name in cases}
        for name in cases:
            with self.subTest(name=name):
                (self.research / name).write_bytes(b"")
                with self.assertRaises(ValueError):
                    self.render()
                self.assertFalse(self.output.exists())
                (self.research / name).write_bytes(originals[name])

    def test_render_passes_both_external_receipts_to_authoritative_publication_gate(self):
        generator = load(ROOT / "scripts/generate-company-benefits-artifacts.py", "receipt_renderer_gate")
        with mock.patch.object(generator, "verify_active_ledgers", return_value=None):
            frozen = generator.publication_gate(
                self.research, TAXONOMY, "2026-10-31", None, None,
            )
        gate = mock.Mock()
        gate.publication_gate.return_value = frozen
        freeze = self.base / "freeze.json"
        effective = self.base / "effective.json"
        with mock.patch.object(self.renderer, "load_module", return_value=gate):
            self.renderer.render_series(
                self.research, self.map_path, self.output, TAXONOMY, "2026-10-31", freeze, effective,
            )
        gate.publication_gate.assert_called_once_with(
            self.research, TAXONOMY, self.renderer.date(2026, 10, 31), freeze, effective,
        )


if __name__ == "__main__":
    unittest.main()
