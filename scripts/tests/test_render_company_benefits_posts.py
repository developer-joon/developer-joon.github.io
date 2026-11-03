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
        with mock.patch.object(self.renderer, "verify_active_ledgers", return_value=None) as verifier:
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
        cell_id = f"cell::{company_id}::{category_id}"
        source_id = f"source::{evidence_class}"
        record_id = f"{evidence_class}::record"
        cell = {
            "cell_id": cell_id, "company_id": company_id, "category_id": category_id,
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
            "attempt_ids": [],
        }
        source = {
            "source_id": source_id, "title": f"{evidence_class.title()} benefit source",
            "url": f"https://evidence.example/{evidence_class}",
            "publication_eligibility": "eligible" if evidence_class != "reference" else "reference_only",
            "reliability": cell["reliability"], "currentness": cell["currentness"],
            "scope_status": "exact_entity", "conflict_status": "none",
        }
        record = {
            "cell_id": cell_id, "company_id": company_id, "category_id": category_id,
            "statement": f"{evidence_class.title()} leave statement",
            "supporting_quote": f"{evidence_class.title()} leave quote",
            "publication_eligibility": "eligible" if evidence_class != "reference" else "reference_only",
            "reliability": cell["reliability"], "currentness": cell["currentness"],
            "scope_status": "exact_entity", "scope": {"countries": ["KR"],
                "legal_entities": [self.companies[1]["legal_name"]], "roles": ["employees"],
                "employment_types": ["full_time"]}, "conflict_status": "none",
        }
        ledger, id_field = {
            "official": ("official_claims", "claim_id"),
            "reference": ("references", "reference_id"),
            "community": ("community_reports", "community_report_id"),
        }[evidence_class]
        record[id_field] = record_id
        if evidence_class == "official":
            record["source_ids"] = [source_id]
        else:
            record["source_id"] = source_id
        if evidence_class == "community":
            record.update(moderation={"status": "approved"}, frozen_snapshot={"locator": "https://snapshot.example/1"})
        indexes = {"attempts": {}, "official_claims": {}, "references": {},
                   "community_reports": {}, "sources": {source_id: source}}
        indexes[ledger][record_id] = record
        return cell, indexes

    def render_v2_installment(self, evidence_class):
        company = self.companies[1]
        cell, indexes = self.v2_evidence(evidence_class, company["company_id"])
        entry = copy.deepcopy(next(row for row in self.render_map["entries"]
                                   if row["artifact_type"] == "installment"))
        entry["company_ids"] = [company["company_id"]]
        curated = self.renderer.curate_installment_entries(
            [entry], {}, {}, {}, {company["company_id"]: {"leave": cell}}, indexes, self.taxonomy,
        )
        self.assertEqual([company["company_id"]], curated[0]["company_ids"])
        text = self.renderer.render_installment(
            curated[0], {company["company_id"]: company}, {}, {}, {}, {}, {}, self.taxonomy,
            {company["company_id"]: {"leave": cell}}, indexes,
        )
        return company, text

    def test_v2_only_official_company_is_retained_and_rendered(self):
        company, text = self.render_v2_installment("official")
        self.assertIn(company["legal_name"], text)
        self.assertIn("Official leave statement", text)
        self.assertIn("Official leave quote", text)
        self.assertIn("휴가·근무시간", text)
        self.assertIn("공식", text)
        self.assertIn("https://evidence.example/official", text)

    def test_v2_only_reference_company_is_retained_and_rendered(self):
        company, text = self.render_v2_installment("reference")
        self.assertIn(company["legal_name"], text)
        self.assertIn("Reference leave statement", text)
        self.assertIn("Reference leave quote", text)
        self.assertIn("참고", text)
        self.assertIn("https://evidence.example/reference", text)

    def test_v2_only_community_company_is_retained_and_rendered(self):
        company, text = self.render_v2_installment("community")
        self.assertIn(company["legal_name"], text)
        self.assertIn("Community leave statement", text)
        self.assertIn("Community leave quote", text)
        self.assertIn("커뮤니티", text)
        self.assertIn("https://evidence.example/community", text)

    def test_v2_mismatched_malformed_and_noneligible_evidence_is_rejected(self):
        company_id = self.companies[1]["company_id"]
        mutations = (
            lambda cell, indexes: indexes["references"]["reference::record"].update(company_id="other"),
            lambda cell, indexes: indexes["references"]["reference::record"].update(source_id=""),
            lambda cell, indexes: indexes["references"]["reference::record"].update(publication_eligibility="discovery_only"),
            lambda cell, indexes: indexes["sources"]["source::reference"].update(url="http://evidence.example/reference"),
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

    def test_hub_uses_only_emitted_links_and_actual_scope_and_total_counts(self):
        hub = next(row for row in self.render_map["entries"] if row["artifact_type"] == "hub")
        installments = [
            {"scope": "domestic", "title": "D1", "filename": "_posts/d1.md"},
            {"scope": "domestic", "title": "D2", "filename": "_posts/d2.md"},
            {"scope": "international", "title": "I1", "filename": "_posts/i1.md"},
        ]
        source_map = {
            source_id: {"url": f"https://example.test/{source_id}"}
            for source_id in hub["citation_source_mapping"]["population_source_ids"]
        }
        text = self.renderer.render_hub(hub, installments, source_map)
        self.assertIn("전체 3개 배치", text)
        self.assertIn("## 국내 2개 배치", text)
        self.assertIn("## 해외 1개 배치", text)
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

    def test_render_series_consumes_validated_v2_cells_and_indexes(self):
        original_validate = self.renderer.validate_complete_inputs
        company = self.companies[1]
        cell, indexes = self.v2_evidence("reference", company["company_id"])

        def validated_with_v2(*args):
            values = list(original_validate(*args))
            values[8] = copy.deepcopy(values[8])
            values[8][company["company_id"]]["leave"] = cell
            for ledger, records in indexes.items():
                values[11][ledger].update(records)
            return tuple(values)

        with mock.patch.object(self.renderer, "validate_complete_inputs", side_effect=validated_with_v2):
            emitted = self.render()
        self.assertEqual(2, len(emitted))
        text = "\n".join(path.read_text(encoding="utf-8") for path in self.output.rglob("*.md"))
        self.assertIn(company["legal_name"], text)
        self.assertIn("Reference leave statement", text)
        self.assertIn("https://evidence.example/reference", text)

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
        with self.assertRaisesRegex(ValueError, "complete|approved"):
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

    def test_preflight_passes_both_external_receipts_to_authoritative_verifier(self):
        verifier = mock.Mock()
        verifier.verify_workspace.return_value = []
        freeze = self.base / "freeze.json"
        effective = self.base / "effective.json"
        with mock.patch.object(self.renderer, "load_module", return_value=verifier):
            self.renderer.verify_active_ledgers(self.research, "2026-10-31", freeze, effective)
        verifier.verify_workspace.assert_called_once_with(
            self.research, as_of="2026-10-31",
            freeze_anchor_receipt=freeze, effective_selection_receipt=effective,
        )


if __name__ == "__main__":
    unittest.main()
