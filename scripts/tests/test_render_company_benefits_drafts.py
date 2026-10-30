import importlib.util
import tempfile
import unittest
from unittest import mock
from datetime import date
from pathlib import Path

from scripts.tests.benefits_test_fixture import FrozenFixture

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "render-company-benefits-drafts.py"


def load_module():
    spec = importlib.util.spec_from_file_location("benefits_renderer", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class RendererTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.renderer = load_module()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.out = self.root / "out"
        self.fixture = FrozenFixture(self.root)
        self.approved_freeze_anchors = self.fixture.approved_freeze_anchors()

    def tearDown(self):
        self.tmp.cleanup()

    def render(self):
        verifier = self.renderer.load_verifier()
        verify_workspace = verifier.verify_workspace
        anchors = self.approved_freeze_anchors
        verifier.verify_workspace = lambda *args, **kwargs: verify_workspace(*args, **kwargs, approved_freeze_anchors=anchors)
        with mock.patch.object(self.renderer, "load_verifier", return_value=verifier):
            return self.renderer.render_batch(self.root, self.out, "domestic", 1, as_of=date(2026, 10, 29))

    def test_renders_validated_effective_batch_deterministically(self):
        first = self.render().read_bytes()
        second = self.render().read_bytes()
        self.assertEqual(first, second)
        text = first.decode()
        self.assertIn("batch_id: domestic-01", text)
        self.assertEqual(25, text.count("## Domestic Employer"))
        expected_first = self.fixture.current["domestic"][0]["legal_name"]
        self.assertLess(text.index(expected_first), text.index(self.fixture.current["domestic"][1]["legal_name"]))

    def test_renderer_calls_same_fail_closed_workspace_verifier(self):
        (self.root / "population" / "freeze-manifest.json").unlink()
        with self.assertRaisesRegex(ValueError, "freeze manifest"):
            self.render()

    def test_renderer_cannot_bypass_production_freeze_anchor(self):
        with self.assertRaisesRegex(ValueError, "external freeze-anchor receipt"):
            self.renderer.render_batch(self.root, self.out, "domestic", 1, as_of=date(2026, 10, 29))

    def test_renderer_validates_freshness_at_render_date_not_protocol_cutoff(self):
        self.fixture.claims[0]["publication_date"] = "2026-01-01"
        self.fixture.write_jsonl("benefit-claims.jsonl", self.fixture.claims)
        with self.assertRaisesRegex(ValueError, "older than 24 months"):
            self.renderer.render_batch(self.root, self.out, "domestic", 1, as_of=date(2029, 1, 2))

    def test_minimal_fake_approved_fixture_cannot_render(self):
        for path in self.root.rglob("*"):
            if path.is_file():
                path.unlink()
        (self.root / "population-protocol.json").write_text('{"status":"approved","approval":{}}', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "verification failed"):
            self.render()

    def test_renderer_rejects_arbitrary_company_not_in_effective_selection(self):
        outsider = dict(self.fixture.companies[0], company_id="outsider")
        self.fixture.companies[0] = outsider
        self.fixture.write_jsonl("companies.jsonl", self.fixture.companies)
        with self.assertRaisesRegex(ValueError, "effective selection"):
            self.render()

    def test_renderer_requires_claim_sources_and_approved_independent_reviews(self):
        self.fixture.benefit_source["supported_fields"] = ["revenue"]
        self.fixture.write_jsonl("source-registry.jsonl", self.fixture.sources)
        with self.assertRaisesRegex(ValueError, "benefit_claim"):
            self.render()

        self.fixture = FrozenFixture(self.root)
        self.fixture.reviews[0]["decision"] = "rejected"
        self.fixture.write_jsonl("reviews.jsonl", self.fixture.reviews)
        with self.assertRaisesRegex(ValueError, "approved independent review"):
            self.render()

    def test_renderer_refuses_tampered_effective_projection(self):
        path = self.root / "population" / "domestic-effective-selected.jsonl"
        path.write_bytes(path.read_bytes().replace(b"Domestic Employer", b"Tampered Employer", 1))
        self.fixture.refresh_manifests()
        with self.assertRaisesRegex(ValueError, "projection|selection_hash"):
            self.render()

    def test_company_without_claim_renders_nonabsence_gap_without_claim_or_score(self):
        company_id = self.fixture.current["domestic"][0]["company_id"]
        removed_ids = {item["claim_id"] for item in self.fixture.claims if item["company_id"] == company_id}
        self.fixture.claims = [item for item in self.fixture.claims if item["claim_id"] not in removed_ids]
        self.fixture.reviews = [item for item in self.fixture.reviews if item["claim_id"] not in removed_ids]
        self.fixture.write_jsonl("benefit-claims.jsonl", self.fixture.claims)
        self.fixture.write_jsonl("reviews.jsonl", self.fixture.reviews)

        text = self.render().read_text(encoding="utf-8")

        section = text.split(f"## {self.fixture.current['domestic'][0]['legal_name']}", 1)[1].split("\n## ", 1)[0]
        self.assertIn("이번 조사에서 게시 가능한 공식 복지 근거를 확보하지 못했습니다. 복지가 없다는 뜻이 아닙니다.", section)
        self.assertNotIn("점수", section)
        self.assertNotIn("**", section)

    def test_contains_required_nonranking_scope_scale_checked_at_and_comment_warnings(self):
        text = self.render().read_text(encoding="utf-8")
        self.assertIn("작성 순서는 순위가 아닙니다", text)
        self.assertIn("확인 불가는 복지가 없다는 뜻이 아닙니다", text)
        self.assertIn("규모 기준", text)
        self.assertIn("회계연도 말", text)
        self.assertIn("법인·정책 경계", text)
        self.assertIn("최종 확인", text)
        self.assertIn("사내 비공개·기밀 자료나 개인정보를 댓글로 올리지 마세요", text)
        self.assertNotIn("매출 순위", text)


if __name__ == "__main__":
    unittest.main()
