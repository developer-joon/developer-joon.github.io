import copy
import fcntl
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
            self.assertGreater(len(sources), 0, path)
            self.assertEqual(list(range(1, len(seen) + 1)), seen, path)
            self.assertEqual(seen, sources, path)

    def test_every_gap_renders_company_bound_route_status_and_precise_nonabsence_result(self):
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
        sections = re.findall(r"### ([^\n]+)\n\n(.*?)(?=\n### |\n## 해석 범위)", all_text, re.DOTALL)
        gap_sections = [body for _, body in sections if "- 조사 결과:" in body]
        self.assertEqual(1999, len(gap_sections))
        for body in gap_sections:
            self.assertIn("- 조사한 공식 경로:", body)
            self.assertIn("- 관찰 상태:", body)
            self.assertIn("- 조사 결과:", body)
            self.assertIn("복지가 없다는 뜻이 아닙니다", body)
            self.assertNotRegex(body, r"(?:source-|gap-route|discovery-|identity)[A-Za-z0-9:_-]*")
            self.assertNotIn("content_sha256", body)
            self.assertNotIn("supporting_quote", body)
        self.assertNotRegex(all_text, r"(?i)\b(?:response|content)[ _-]?sha256\b|\b[a-f0-9]{64}\b")
        self.assertNotRegex(all_text, r"(?i)\b(?:expected_marker|reviewer_id|review_id|approval[_ -]?status)\b")
        self.assertNotRegex(all_text, r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z")

    def test_gap_route_details_are_resolved_only_from_bound_source_and_check(self):
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
        text = self.renderer.render_installment(
            {**next(row for row in self.render_map["entries"] if row.get("artifact_type") == "installment"),
             "company_ids": [company_id]},
            {company_id: self.companies[1]}, {}, {company_id: [gap]},
            {source["source_id"]: source}, {source["source_id"]: check}, {}, self.taxonomy,
        )
        self.assertIn("Official registry", text)
        self.assertIn(source["url"], text)
        self.assertIn("HTTP 403", text)
        self.assertIn("2026-10-30 02:00:00 UTC", text)
        self.assertNotIn("bot_or_network_block", text)
        self.assertNotIn(check["checked_at"], text)
        self.assertNotIn(source["locator"], text)
        self.assertNotIn(source["source_id"], text)
        self.assertNotIn("expected_marker", text)
        self.assertNotIn("SHA256", text)
        self.assertNotIn("a" * 64, text)

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

    def test_publication_requires_the_exact_contract_filename_set(self):
        rendered = self.rendered_posts()
        value = rendered.pop(next(iter(rendered)))
        rendered["_posts/unexpected.md"] = value
        with self.assertRaisesRegex(ValueError, "exact.*filename|filename.*contract"):
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
        value = copy.deepcopy(valid); value["items"][0]["new_sha256"] = None; malformed.append(value)
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
        with self.assertRaisesRegex(ValueError, "official source-ID route|official route"):
            self.renderer.render_installment(
                {**next(row for row in self.render_map["entries"] if row.get("artifact_type") == "installment"),
                 "company_ids": [company_id]},
                {company_id: self.companies[1]}, {}, {company_id: [gap]}, {}, {}, {}, self.taxonomy,
            )

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
