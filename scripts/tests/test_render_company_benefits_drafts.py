import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

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
        self.protocol = {"protocol_id": "test-v1", "status": "approved", "approval": {"approved_by": "owner", "approved_at": "2026-10-01T00:00:00Z"}}
        (self.root / "population-protocol.json").write_text(json.dumps(self.protocol), encoding="utf-8")
        self.companies = []
        self.claims = []
        self.sources = []
        for i in range(25):
            cid = f"domestic-{i + 1:03d}"
            sid = f"source-{i + 1:03d}"
            self.companies.append({"company_id": cid, "scope": "domestic", "legal_name": f"회사 {i + 1}", "selection_hash": f"{i + 1:064x}"})
            self.claims.append({"claim_id": f"claim-{i + 1:03d}", "company_id": cid, "benefit_name": "휴가", "detail": "공식 자료에서 확인됨", "status": "confirmed", "source_ids": [sid]})
            self.sources.append({"source_id": sid, "title": f"공식 자료 {i + 1}", "url": f"https://example.gov/{i + 1}"})
        self.write_jsonl("companies.jsonl", self.companies)
        self.write_jsonl("benefit-claims.jsonl", self.claims)
        self.write_jsonl("sources.jsonl", self.sources)

    def tearDown(self):
        self.tmp.cleanup()

    def write_jsonl(self, name, values):
        (self.root / name).write_text("".join(json.dumps(v, ensure_ascii=False) + "\n" for v in values), encoding="utf-8")

    def render(self):
        return self.renderer.render_batch(self.root, self.out, "domestic", 1)

    def test_renders_stable_batch_id_and_exactly_25_companies(self):
        path = self.render()
        text = path.read_text(encoding="utf-8")
        self.assertIn("batch_id: domestic-01", text)
        self.assertEqual(25, text.count("## 회사 "))

    def test_render_is_byte_for_byte_deterministic(self):
        first = self.render().read_bytes()
        second = self.render().read_bytes()
        self.assertEqual(first, second)

    def test_refuses_incomplete_batch(self):
        self.write_jsonl("companies.jsonl", self.companies[:-1])
        with self.assertRaisesRegex(ValueError, "exactly 25"):
            self.render()

    def test_refuses_blocked_protocol(self):
        self.protocol["status"] = "blocked"
        self.protocol["approval"] = None
        (self.root / "population-protocol.json").write_text(json.dumps(self.protocol), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "approved protocol"):
            self.render()

    def test_refuses_mixed_scope(self):
        companies = list(self.companies)
        companies[-1] = dict(companies[-1], scope="international")
        self.write_jsonl("companies.jsonl", companies)
        with self.assertRaisesRegex(ValueError, "scope"):
            self.render()

    def test_refuses_missing_claim_or_source(self):
        self.write_jsonl("benefit-claims.jsonl", self.claims[:-1])
        with self.assertRaisesRegex(ValueError, "claim"):
            self.render()
        self.write_jsonl("benefit-claims.jsonl", self.claims)
        self.write_jsonl("sources.jsonl", self.sources[:-1])
        with self.assertRaisesRegex(ValueError, "source"):
            self.render()

    def test_contains_required_nonranking_unknown_and_comment_warnings(self):
        text = self.render().read_text(encoding="utf-8")
        self.assertIn("작성 순서는 순위가 아닙니다", text)
        self.assertIn("확인 불가는 복지가 없다는 뜻이 아닙니다", text)
        self.assertIn("사내 비공개·기밀 자료나 개인정보를 댓글로 올리지 마세요", text)
        self.assertIn("정정", text)
        self.assertNotIn("매출 순위", text)


if __name__ == "__main__":
    unittest.main()
