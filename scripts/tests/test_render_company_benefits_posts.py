import copy
import importlib.util
import json
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

    def test_renders_81_deterministic_jekyll_posts_with_exact_company_partition(self):
        first = self.render()
        snapshot = {path.relative_to(self.output): path.read_bytes() for path in sorted(self.output.rglob("*.md"))}
        self.assertEqual(81, len(first))
        self.assertEqual(81, len(snapshot))
        for path in list(snapshot):
            (self.output / path).unlink()
        second = self.render()
        self.assertEqual(snapshot, {path.relative_to(self.output): path.read_bytes() for path in sorted(self.output.rglob("*.md"))})
        self.assertEqual(first, second)

        all_text = "\n".join(raw.decode() for raw in snapshot.values())
        ids = re.findall(r"법인 ID: `([^`]+)`", all_text)
        self.assertEqual(2000, len(ids))
        self.assertEqual(2000, len(set(ids)))
        self.assertNotIn("series-historical-audit", all_text)
        self.assertNotRegex(all_text, r"(?:종합|전체) 순위\s*[:：]?\s*\d|\b1위\b")

        for entry in self.render_map["entries"]:
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
                self.assertEqual(25, text.count("법인 ID: `"))
                self.assertIn("복지가 없다는 뜻이 아닙니다", text)
                self.assertIn("순위가 아닙니다", text)

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
            self.assertEqual(list(range(1, len(seen) + 1)), seen, path)
            self.assertEqual(seen, sources, path)

    def test_incomplete_series_is_blocked_without_writing_posts(self):
        progress_path = self.research / "series-progress.json"
        progress = json.loads(progress_path.read_text())
        progress["status"] = "in_progress"
        progress["batches"][0]["status"] = "pending"
        progress_path.write_text(json.dumps(progress), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "complete|approved"):
            self.render()
        self.assertFalse(self.output.exists())

    def test_unknown_claim_renders_as_nonabsence_outcome_without_taxonomy_leak(self):
        claims_path = self.research / "benefit-claims.jsonl"
        claim = json.loads(claims_path.read_text().strip())
        claim.update(
            status="unknown",
            detail="공식 공개자료에서 확인하지 못했습니다.",
            source_ids=[],
            source_evidence=[],
            searched_source_ids=["source-1"],
        )
        claims_path.write_text(json.dumps(claim, ensure_ascii=False) + "\n", encoding="utf-8")
        (self.research / "benefit-taxonomy-assignments.jsonl").write_bytes(b"")
        self.render()
        first = self.output / self.render_map["entries"][1]["filename"]
        text = first.read_text(encoding="utf-8")
        section = text.split("### Verified Employer 0000", 1)[1].split("\n### ", 1)[0]
        self.assertIn("복지가 없다는 뜻이 아닙니다", section)
        self.assertNotIn("유급휴가", section)
        self.assertIn("[1]", section)

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


if __name__ == "__main__":
    unittest.main()
