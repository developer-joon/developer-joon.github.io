#!/usr/bin/env python3
"""Render the complete, approved company-benefits series into Jekyll posts."""

import argparse
import importlib.util
import json
import os
import re
import shutil
import sys
import tempfile
from datetime import date
from pathlib import Path

EXPECTED_SCOPES = ("domestic", "international")
STATUS_LABELS = {
    "confirmed": "확인됨",
    "limited": "범위 제한 확인",
    "past": "과거 확인",
    "name_only": "명칭만 확인",
    "conflict": "상충",
}


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ValueError(f"cannot load required module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_json(path):
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain an object")
    return value


def read_jsonl(path):
    path = Path(path)
    if not path.is_file():
        raise ValueError(f"missing required ledger: {path.name}")
    values = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        value = json.loads(line)
        if not isinstance(value, dict):
            raise ValueError(f"{path.name}:{number}: row must be an object")
        values.append(value)
    return values


def unique_map(rows, field, label):
    result = {}
    for row in rows:
        key = row.get(field)
        if not isinstance(key, str) or not key or key in result:
            raise ValueError(f"{label} requires unique nonempty {field}")
        result[key] = row
    return result


def validate_render_map(render_map):
    if render_map.get("schema_version") != "final-series-render-map-v1":
        raise ValueError("unsupported final series render map")
    counts = render_map.get("counts")
    if counts != {"total": 81, "hub": 1, "domestic": 40, "international": 40, "companies": 2000}:
        raise ValueError("render map count contract mismatch")
    entries = render_map.get("entries")
    if not isinstance(entries, list) or len(entries) != 81:
        raise ValueError("render map requires exactly 81 entries")
    hubs = [entry for entry in entries if entry.get("artifact_type") == "hub"]
    installments = [entry for entry in entries if entry.get("artifact_type") == "installment"]
    if len(hubs) != 1 or len(installments) != 80:
        raise ValueError("render map requires one hub and 80 installments")
    expected_batches = {f"{scope}-{number:02d}" for scope in EXPECTED_SCOPES for number in range(1, 41)}
    if {entry.get("batch_id") for entry in installments} != expected_batches:
        raise ValueError("render map batch identity mismatch")
    for field in ("filename", "slug", "title", "banner_seed"):
        values = [entry.get(field) for entry in entries]
        if any(not isinstance(value, str) or not value for value in values) or len(values) != len(set(values)):
            raise ValueError(f"render map requires 81 unique nonempty {field} values")
    all_ids = []
    for entry in installments:
        ids = entry.get("company_ids")
        if not isinstance(ids, list) or len(ids) != 25 or len(set(ids)) != 25:
            raise ValueError(f"{entry.get('batch_id')}: installment requires 25 unique company IDs")
        all_ids.extend(ids)
    if len(all_ids) != 2000 or len(set(all_ids)) != 2000:
        raise ValueError("render map must partition exactly 2,000 company IDs once")
    for entry in entries:
        filename = Path(entry["filename"])
        expected_image = f"https://picsum.photos/seed/{entry['banner_seed']}/1600/900"
        if (filename.is_absolute() or ".." in filename.parts or filename.parent != Path("_posts")
                or filename.suffix != ".md" or entry.get("featured_image") != expected_image
                or entry.get("banner_seed") != entry.get("slug")):
            raise ValueError(f"{entry.get('artifact_id')}: unsafe path or banner contract mismatch")
    return entries


def verify_active_ledgers(research_root, as_of, freeze_anchor_receipt=None, effective_selection_receipt=None):
    verifier = load_module(Path(__file__).with_name("verify-company-benefits-ledger.py"), "benefits_post_verifier")
    errors = verifier.verify_workspace(
        Path(research_root), as_of=as_of,
        freeze_anchor_receipt=freeze_anchor_receipt,
        effective_selection_receipt=effective_selection_receipt,
    )
    if errors:
        raise ValueError("active ledger verification failed:\n" + "\n".join(errors))


def validate_complete_inputs(research_root, taxonomy):
    generator = load_module(Path(__file__).with_name("generate-company-benefits-artifacts.py"), "benefits_post_inputs")
    generator.taxonomy_contract(taxonomy)
    return generator.validate_inputs(Path(research_root), taxonomy)


def yaml_quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def front_matter(entry):
    categories = json.dumps(entry["categories"], ensure_ascii=False)
    tags = json.dumps(entry["tags"], ensure_ascii=False)
    return (
        "---\n"
        f"title: {yaml_quote(entry['title'])}\n"
        f"date: {entry['date']}\n"
        f"categories: {categories}\n"
        f"description: {yaml_quote(entry['description'])}\n"
        f"featured_image: {yaml_quote(entry['featured_image'])}\n"
        f"tags: {tags}\n"
        "---\n\n"
    )


def format_scale(company):
    metric = company.get("scale_metric") or {}
    value = metric.get("value")
    currency = metric.get("currency", "")
    fiscal = metric.get("fiscal_year_end", "공개 자료에 명시되지 않음")
    scope = metric.get("financial_scope", "공개 자료에 명시되지 않음")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        value = f"{value:,}"
    else:
        value = "공개 자료에 명시되지 않음"
    return f"{metric.get('type', '규모 지표')} {value} {currency}".strip(), fiscal, scope


def scope_text(claim):
    scope = claim.get("application_scope") or {}
    def joined(field):
        values = scope.get(field) or []
        return ", ".join(str(value) for value in values) or "출처에 명시되지 않음"
    return (
        f"국가 {joined('countries')}; 법인 {joined('legal_entities')}; "
        f"직군 {joined('roles')}; 고용형태 {joined('employment_types')}; "
        f"근속 조건 {scope.get('tenure_condition') or '출처에 명시되지 않음'}"
    )


def render_sources(source_ids, source_map):
    return "".join(f"[{number}] {source_map[source_id]['url']}\n" for number, source_id in enumerate(source_ids, 1))


def render_installment(entry, company_map, claims_by_company, gaps_by_company, source_map, assignments, taxonomy):
    type_map = {item["id"]: item for item in taxonomy["benefit_types"]}
    cited = []

    def citations(source_ids):
        numbers = []
        for source_id in sorted(set(source_ids)):
            source = source_map.get(source_id)
            if source is None or not str(source.get("url", "")).startswith("https://"):
                raise ValueError(f"{source_id}: claim source is missing or not publication eligible")
            if source_id not in cited:
                cited.append(source_id)
            numbers.append(cited.index(source_id) + 1)
        return "".join(f"[{number}]" for number in numbers)

    parts = [front_matter(entry)]
    parts.append(f"![{entry['body_image_alt']}]({entry['featured_image']})\n\n")
    parts.append(entry["intro_text"] + "\n\n")
    parts.append("> 이 글의 회사 순서는 순위가 아닙니다. 공개 근거 공백은 복지가 없다는 뜻이 아닙니다.\n\n")
    parts.append("## 25개 보고 법인\n\n")
    for company_id in entry["company_ids"]:
        company = company_map[company_id]
        scale, fiscal, financial_scope = format_scale(company)
        parts.append(f"### {company['legal_name']}\n\n")
        parts.append(f"- 법인 ID: `{company_id}`\n")
        parts.append(f"- 선정 단위: {company.get('selected_reporting_legal_entity', company['legal_name'])}\n")
        parts.append(f"- 관할·범위: {company.get('jurisdiction', '미상')} / {company.get('scope', entry['scope'])}\n")
        parts.append(f"- 규모 근거: {scale}; 회계연도 말 {fiscal}; 재무 범위 {financial_scope}\n")
        claims = sorted(claims_by_company.get(company_id, []), key=lambda item: item["claim_id"])
        gap_values = gaps_by_company.get(company_id, [])
        if not claims:
            if len(gap_values) != 1:
                raise ValueError(f"{company_id}: missing exact approved gap")
            gap = gap_values[0]
            parts.append(f"- 근거 상태: {gap.get('reason', '공개 공식자료에서 게시 가능한 복지 근거를 확인하지 못했습니다.')} ")
            parts.append(gap["nonabsence_wording"] + "\n\n")
            continue
        for claim in claims:
            if claim.get("status") == "unknown":
                marker = citations(claim.get("searched_source_ids", []))
                parts.append(
                    "- 근거 상태: 공식 공개 경로를 조사했지만 게시 가능한 복지 근거를 확인하지 못했습니다. "
                    f"복지가 없다는 뜻이 아닙니다.{marker}\n"
                )
                parts.append(f"  - 조사 결과: {claim.get('detail', '공개자료에서 확인하지 못했습니다.')}\n")
                parts.append(f"  - 조사 시점: {claim.get('searched_at', claim.get('checked_at', '미상'))}\n")
                continue
            assignment = assignments.get(claim["claim_id"])
            if assignment is None:
                raise ValueError(f"{claim['claim_id']}: missing approved taxonomy assignment")
            labels = [type_map[type_id]["label_ko"] for type_id in assignment["benefit_type_ids"]]
            source_ids = [item["source_id"] for item in claim.get("source_evidence", [])]
            if set(source_ids) != set(claim.get("source_ids", [])):
                raise ValueError(f"{claim['claim_id']}: source evidence coverage mismatch")
            marker = citations(source_ids)
            status = STATUS_LABELS.get(claim.get("status"), claim.get("status", "범위 제한 확인"))
            parts.append(f"- **{claim['benefit_name']}** ({', '.join(labels)}) — {status}: {claim['detail']}{marker}\n")
            parts.append(f"  - 적용 범위: {scope_text(claim)}\n")
            parts.append(f"  - 근거 등급·확인일: {claim.get('evidence_grade', '미상')} / {claim.get('prepublication_checked_at', claim.get('checked_at', '미상'))}\n")
            if claim.get("current_validity") == "historical" or claim.get("status") == "past":
                parts.append("  - 한계: 과거의 명시된 계획·기간에 대한 근거이며 현재 제공이나 개인 자격을 뜻하지 않습니다.\n")
        parts.append("\n")
    parts.append("## 해석 범위\n\n")
    parts.append(entry["summary_text"] + "\n\n")
    parts.append("보고 법인의 규모 근거는 급여 고용주나 복지 적용 법인을 자동으로 확정하지 않습니다. 출처에 명시된 국가·법인·직군·고용형태와 시점 밖으로 확대하지 않습니다.\n\n")
    parts.append("## Sources\n\n")
    parts.append(render_sources(cited, source_map))
    return "".join(parts)


def render_hub(entry, installment_entries, source_map):
    parts = [front_matter(entry)]
    parts.append(f"![{entry['body_image_alt']}]({entry['featured_image']})\n\n")
    parts.append(entry["intro_text"] + "\n\n")
    parts.append("> 이 디렉터리는 기업의 종합 순위나 우열표가 아닙니다. 근거를 확인하지 못했다는 기록은 복지 부재 판정이 아닙니다.\n\n")
    parts.append("## 국내 40개 배치\n\n")
    for item in [row for row in installment_entries if row["scope"] == "domestic"]:
        parts.append(f"- [{item['title']}]({{% post_url {Path(item['filename']).stem} %}})\n")
    parts.append("\n## 해외 40개 배치\n\n")
    for item in [row for row in installment_entries if row["scope"] == "international"]:
        parts.append(f"- [{item['title']}]({{% post_url {Path(item['filename']).stem} %}})\n")
    parts.append("\n## 읽는 법과 한계\n\n")
    parts.append(entry["summary_text"] + "\n\n")
    parts.append("해외 범위는 미국 설립·미국 주사업장 근거를 갖춘 SEC 10-K 공시 법인 코호트이고, 국내 범위는 선정된 대한민국 보고 법인입니다. 서로 다른 회계연도와 지표를 하나의 순위로 합치지 않습니다. 과거 계획 근거는 현재 제공이나 개인 자격으로 확대하지 않습니다.\n\n")
    parts.append("## Sources\n\n")
    return "".join(parts)


def render_series(research_root, render_map_path, output_root, taxonomy_path, as_of=None,
                  freeze_anchor_receipt=None, effective_selection_receipt=None):
    research_root, output_root = Path(research_root), Path(output_root)
    render_map = read_json(render_map_path)
    entries = validate_render_map(render_map)
    progress = read_json(research_root / "series-progress.json")
    progress_entries = progress.get("batches")
    if (progress.get("status") != "complete" or progress.get("total_batches") != 80
            or progress.get("total_companies") != 2000 or not isinstance(progress_entries, list)
            or len(progress_entries) != 80 or any(item.get("status") != "approved" for item in progress_entries)):
        raise ValueError("production posts require a complete series with all 80 batches approved")
    as_of_date = date.fromisoformat(as_of) if isinstance(as_of, str) else (as_of or date.today())
    verify_active_ledgers(research_root, as_of_date, freeze_anchor_receipt, effective_selection_receipt)
    taxonomy = read_json(taxonomy_path)
    companies, company_map, claims_by_company, gaps_by_company, source_map, assignments = validate_complete_inputs(research_root, taxonomy)
    if len(companies) != 2000:
        raise ValueError("validated active company ledger must contain exactly 2,000 rows")
    batch_map = unique_map(read_jsonl(research_root / "series-batches.jsonl"), "batch_id", "series batches")
    installments = [entry for entry in entries if entry["artifact_type"] == "installment"]
    for entry in installments:
        batch = batch_map.get(entry["batch_id"])
        if batch is None or batch.get("company_ids") != entry["company_ids"]:
            raise ValueError(f"{entry['batch_id']}: render map differs from active canonical batch")
    rendered = {}
    for entry in installments:
        rendered[entry["filename"]] = render_installment(
            entry, company_map, claims_by_company, gaps_by_company, source_map, assignments, taxonomy
        )
    hub = next(entry for entry in entries if entry["artifact_type"] == "hub")
    rendered[hub["filename"]] = render_hub(hub, installments, source_map)
    if len(rendered) != 81:
        raise ValueError("renderer did not produce exactly 81 unique posts")
    existing = [output_root / relative for relative in rendered if (output_root / relative).exists()]
    if existing:
        raise ValueError("refusing to overwrite existing production post: " + ", ".join(str(path) for path in existing))
    output_root.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".company-benefits-posts-", dir=output_root.parent))
    try:
        for relative, text in rendered.items():
            target = staging / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text, encoding="utf-8", newline="\n")
        for relative in sorted(rendered):
            source = staging / relative
            target = output_root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(source, target)
    except Exception:
        for relative in rendered:
            target = output_root / relative
            if target.exists():
                target.unlink()
        raise
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return sorted(rendered)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--research-root", required=True, type=Path)
    parser.add_argument("--render-map", required=True, type=Path)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--taxonomy", required=True, type=Path)
    parser.add_argument("--as-of", type=date.fromisoformat)
    parser.add_argument("--freeze-anchor-receipt", type=Path, default=os.environ.get("COMPANY_BENEFITS_FREEZE_ANCHOR_RECEIPT"))
    parser.add_argument("--effective-selection-receipt", type=Path, default=os.environ.get("COMPANY_BENEFITS_EFFECTIVE_SELECTION_RECEIPT"))
    args = parser.parse_args(argv)
    try:
        paths = render_series(
            args.research_root, args.render_map, args.output_root, args.taxonomy,
            as_of=args.as_of, freeze_anchor_receipt=args.freeze_anchor_receipt,
            effective_selection_receipt=args.effective_selection_receipt,
        )
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        print(f"production post rendering failed: {exc}", file=sys.stderr)
        return 1
    print(f"Rendered {len(paths)} deterministic Jekyll posts.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
