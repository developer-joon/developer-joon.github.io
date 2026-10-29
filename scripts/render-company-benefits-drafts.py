#!/usr/bin/env python3
"""Render deterministic, review-only company-benefit Markdown drafts."""

import argparse
import importlib.util
import json
from datetime import date
from pathlib import Path

HEADER = """---
batch_id: {batch_id}
scope: {scope}
protocol_id: {protocol_id}
status: draft
---

# 기업 복지 검증 초안 — {batch_id}

> 작성 순서는 순위가 아닙니다. 이 문서는 승인된 모집단에서 정해진 처리 순서로 작성한 검토용 초안입니다.
>
> 확인 불가는 복지가 없다는 뜻이 아닙니다. 공개된 공식 자료에서 확인하지 못했다는 뜻입니다.

"""

FOOTER = """## 정정 및 제보

정정은 공식 공개 출처로 다시 검증한 뒤 반영합니다.
사내 비공개·기밀 자료나 개인정보를 댓글로 올리지 마세요.
급여명세서, 보험·건강정보, 계정정보 및 계약상 비공개 자료도 받지 않습니다.

*이 파일은 검토용 초안이며 게시 승인을 뜻하지 않습니다.*
"""


def read_json(path):
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain an object")
    return value


def read_jsonl(path):
    if not path.exists():
        raise ValueError(f"missing input: {path}")
    records = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if line.strip():
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError(f"{path}:{number} must contain an object")
            records.append(value)
    return records


def load_verifier():
    path = Path(__file__).with_name("verify-company-benefits-ledger.py")
    spec = importlib.util.spec_from_file_location("company_benefits_verifier", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load verifier: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def render_batch(root, output_dir, scope, batch_number):
    root = Path(root)
    output_dir = Path(output_dir)
    if scope not in {"domestic", "international"}:
        raise ValueError("scope must be domestic or international")
    if batch_number < 1:
        raise ValueError("batch number must be positive")

    verifier = load_verifier()
    protocol_path = root / "population-protocol.json"
    protocol = read_json(protocol_path) if protocol_path.is_file() else {}
    cutoff = protocol.get("cutoff_at")
    try:
        as_of = date.fromisoformat(str(cutoff)[:10])
    except ValueError:
        as_of = date.today()
    errors = verifier.verify_workspace(root, as_of=as_of)
    if errors:
        raise ValueError("workspace verification failed:\n" + "\n".join(errors))

    companies = read_jsonl(root / "companies.jsonl")
    claims = read_jsonl(root / "benefit-claims.jsonl")
    sources = read_jsonl(root / "source-registry.jsonl")
    reviews = read_jsonl(root / "reviews.jsonl")
    company_map = {company["company_id"]: company for company in companies}
    effective = read_jsonl(root / "population" / f"{scope}-effective-selected.jsonl")
    scoped = [company_map[record["company_id"]] for record in effective]
    start = (batch_number - 1) * 25
    batch = scoped[start:start + 25]
    if len(batch) != 25:
        raise ValueError("a complete batch requires exactly 25 companies")
    if any(c.get("scope") != scope for c in batch):
        raise ValueError("batch scope mismatch")
    company_ids = [c.get("company_id") for c in batch]
    if None in company_ids or len(set(company_ids)) != 25:
        raise ValueError("batch requires 25 distinct company IDs")

    claims_by_company = {company_id: [] for company_id in company_ids}
    approved_claim_ids = {
        review["claim_id"] for review in reviews
        if review.get("decision") == "approved" and review.get("researcher_id") != review.get("reviewer_id")
    }
    for claim in claims:
        if claim.get("company_id") in claims_by_company and claim.get("claim_id") in approved_claim_ids:
            claims_by_company[claim["company_id"]].append(claim)
    missing_claims = [cid for cid, values in claims_by_company.items() if not values]
    if missing_claims:
        raise ValueError(f"missing claim records for: {', '.join(missing_claims)}")
    source_map = {source.get("source_id"): source for source in sources}
    used_source_ids = {
        source_id
        for values in claims_by_company.values()
        for claim in values
        for source_id in claim.get("source_ids", [])
    }
    missing_sources = sorted(source_id for source_id in used_source_ids if source_id not in source_map)
    if missing_sources:
        raise ValueError(f"missing source records for: {', '.join(missing_sources)}")

    batch_id = f"{scope}-{batch_number:02d}"
    parts = [HEADER.format(batch_id=batch_id, scope=scope, protocol_id=protocol.get("protocol_id", ""))]
    status_labels = {
        "confirmed": "확인됨", "limited": "범위 제한 확인", "past": "과거 확인",
        "name_only": "명칭만 확인", "unknown": "확인 불가", "conflict": "상충",
    }
    for company in batch:
        parts.append(f"## {company['legal_name']}\n\n")
        parts.append(f"- 법인 ID: `{company['company_id']}`\n")
        for claim in sorted(claims_by_company[company["company_id"]], key=lambda c: c.get("claim_id", "")):
            status = status_labels.get(claim.get("status"), claim.get("status", "미정"))
            parts.append(f"- **{claim.get('benefit_name', '복지 항목')}** — {status}: {claim.get('detail', '')}\n")
            for source_id in sorted(claim.get("source_ids", [])):
                source = source_map[source_id]
                parts.append(f"  - 출처: [{source.get('title', source_id)}]({source.get('url', '')})\n")
        parts.append("\n")
    parts.append(FOOTER)
    rendered = "".join(parts)
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / f"{batch_id}.md"
    output.write_text(rendered, encoding="utf-8", newline="\n")
    return output


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root")
    parser.add_argument("output_dir")
    parser.add_argument("scope", choices=("domestic", "international"))
    parser.add_argument("batch_number", type=int)
    args = parser.parse_args(argv)
    output = render_batch(Path(args.root), Path(args.output_dir), args.scope, args.batch_number)
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
