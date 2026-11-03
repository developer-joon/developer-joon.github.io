#!/usr/bin/env python3
"""Render the complete, approved company-benefits series into Jekyll posts."""

import argparse
import copy
import fcntl
import hashlib
import html
import importlib.util
import json
import os
import re
import stat
import sys
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

EXPECTED_SCOPES = ("domestic", "international")
STATUS_LABELS = {
    "confirmed": "확인됨",
    "limited": "범위 제한 확인",
    "past": "과거 확인",
    "name_only": "명칭만 확인",
    "conflict": "상충",
}
PUBLIC_GAP_MESSAGES = {
    "access_limited": "공식 경로의 접근이 제한되어 게시 가능한 복지 근거를 확인하지 못했습니다.",
    "entity_or_scope_unproven": "공식 경로를 확인했지만 선정 법인과 복지 적용 범위를 함께 입증하는 게시 가능한 근거를 확인하지 못했습니다.",
    "publication_requirements_unmet": "공식 경로를 확인했지만 현재 적용 범위와 게시 가능 요건을 충족하는 근거를 확인하지 못했습니다.",
    "not_verified": "공식 공개 경로에서 게시 가능한 복지 근거를 확인하지 못했습니다.",
}
EXPECTED_PUBLICATION_FILENAMES = frozenset(
    [f"_posts/2026-10-31-company-benefits-domestic-d{number:02d}.md" for number in range(1, 41)]
    + [f"_posts/2026-10-31-company-benefits-international-i{number:02d}.md" for number in range(1, 41)]
    + ["_posts/2026-10-31-company-benefits-verified-directory-hub.md"]
)
# Publication prose is capped after escaping so emitted Markdown is bounded.
PUBLICATION_PROSE_MAX_CHARS = 500
V2_SOURCE_TIERS = {
    "official_government", "company_recruiting_major_media", "other_public_web",
    "community_employee_review", "user_submission",
}
# Reviewed literal variants complement the Korean taxonomy labels. They are a
# publication filter only: no claim text is generated or split from these terms.
CATEGORY_PUBLICATION_TERMS = {
    "leave": ("유급휴가", "리프레시 휴가", "경조휴가", "연차", "휴가", "paid leave", "leave"),
    "family": ("육아휴직", "출산휴가", "보육", "어린이집", "자녀", "가족 행사", "parental leave"),
    "health": ("건강검진", "건강보험", "의료", "치과", "시력", "심리상담", "웰니스", "보험", "health insurance"),
    "growth": ("직무교육", "학비", "등록금", "자격", "어학", "자기계발", "경력개발", "도서구입", "tuition"),
    "housing": ("주택", "주거", "기숙사", "사택", "우리사주", "주식매입", "재무복지", "법률지원", "housing"),
    "commute": ("통근버스", "통근", "교통", "차량", "주차", "유류비", "셔틀", "commute"),
    "remote": ("유연근무", "시차", "원격근무", "재택근무", "재택 근무", "탄력 근무", "remote work"),
    "retirement": ("퇴직연금", "퇴직저축", "퇴직금", "퇴직", "장기근속", "401(k)", "retirement"),
    "meals": ("식사", "사내식당", "구내식당", "구내 식당", "복지포인트", "동호회", "휴양", "편의시설", "선물", "meal"),
    "inclusion": ("접근성", "합리적 편의", "포용", "다양성", "장애 지원", "돌봄", "ERG", "accessibility"),
}
PAGE_SHELL_PATTERN = re.compile(
    r"(?i)(?:\bwindow\b|clientWidth|heightVH|\bdocument\.|javascript:|"
    r"\bnavigation\b|\bcopyright\b|\blogin\b|\bsign[ -]?in\b|\bmenu\b|로그인|메뉴|저작권|"
    r"<\s*(?:html|head|body|script|style|aside|nav|header|footer|img|svg)\b|"
    r"!\[[^\]]*\]\(|https?://|(?:^|\n)\s*#{1,6}\s|\|\s*---)"
)
TEMPLATE_PROSE_PATTERNS = (
    re.compile(r"(?:범주|관련)\s*복리후생.*공개\s*페이지가\s*(?:명시|열거)"),
    re.compile(r"공개\s*복지\s*페이지가.*관련\s*항목을\s*열거"),
    re.compile(r"관련\s*항목을\s*열거한다"),
)
EMPLOYEE_TERMS = ("직원", "임직원", "구성원", "사원", "근로자", "employee", "employees", "staff", "workforce")
BENEFIT_ACTION_TERMS = (
    "지원", "제공", "운영", "지급", "부여", "이용", "가입", "시행", "사용", "보장",
    "benefit", "benefits", "allowance", "provide", "provides", "provided", "receive",
    "receives", "offer", "offers", "operate", "paid", "coverage",
)
CORPORATE_FORM_PATTERN = re.compile(
    r"(?i)(?:주식회사|유한회사|합자회사|합명회사|유한책임회사|\(\s*주\s*\)|㈜|"
    r"\b(?:incorporated|inc|corporation|corp|limited|ltd|company|co|llc)\b\.?)"
)
GENERIC_ENTITY_ALIASES = {"company", "corporation", "inc", "corp", "ltd", "co", "회사", "기업"}

V2_RECORD_KEYS = {
    "official": {"claim_id", "cell_id", "company_id", "category_id", "jurisdiction", "source_ids",
                 "source_tier", "scope_status", "scope", "conflict_status", "publication_eligibility"},
    "reference": {"reference_id", "cell_id", "company_id", "category_id", "source_id", "source_tier",
                  "statement", "supporting_quote", "source_locator", "reliability", "currentness", "scope",
                  "conflict_status", "publication_eligibility", "checked_at"},
    "community": {"community_report_id", "cell_id", "company_id", "category_id", "source_id", "source_tier",
                  "statement", "reliability", "currentness", "scope_status", "scope", "conflict_status",
                  "moderation", "frozen_snapshot", "publication_eligibility"},
}
V2_CELL_KEYS = {"cell_id", "company_id", "category_id", "jurisdiction", "state", "coverage_policy_id",
                "attempt_ids", "official_claim_ids", "reference_ids", "community_report_ids", "reliability",
                "currentness", "scope_status", "conflict_status", "publication_eligibility", "assessed_at"}
V2_SOURCE_KEYS = {"source_id", "source_tier", "title", "url", "retrieved_at", "content_sha256", "reliability",
                  "currentness", "scope_status", "scope", "conflict_status", "publication_eligibility"}


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ValueError(f"cannot load required module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


COMPANY_BENEFITS_SERIES = load_module(
    Path(__file__).with_name("company_benefits_series.py"), "company_benefits_post_contract"
)


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


def validate_complete_inputs(research_root, taxonomy, taxonomy_sha256):
    generator = load_module(Path(__file__).with_name("generate-company-benefits-artifacts.py"), "benefits_post_inputs")
    generator.taxonomy_contract(taxonomy)
    return generator.validate_inputs(Path(research_root), taxonomy, taxonomy_sha256)


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
        return ", ".join(publication_plain_text(str(value)) for value in values) or "출처에 명시되지 않음"
    return (
        f"국가 {joined('countries')}; 법인 {joined('legal_entities')}; "
        f"직군 {joined('roles')}; 고용형태 {joined('employment_types')}; "
        f"근속 조건 {publication_plain_text(str(scope.get('tenure_condition') or '출처에 명시되지 않음'))}"
    )


def render_sources(source_ids, source_map):
    return "".join(
        f"[{number}] {publication_source_url(source_map[source_id])}\n"
        for number, source_id in enumerate(source_ids, 1)
    )


def public_check_time(value):
    """Render an exact instant without exposing a raw ledger timestamp."""
    if not isinstance(value, str) or not value:
        return "미기록"
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("invalid official-route check time") from exc
    if parsed.tzinfo is None:
        raise ValueError("official-route check time requires a timezone")
    return parsed.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def public_gap_message(gap, checks):
    """Map reviewed internal gap detail to a bounded public taxonomy."""
    if any(check.get("status") is None or check.get("status") >= 400
           or check.get("access_wall") not in (None, "", "none") for check in checks):
        return PUBLIC_GAP_MESSAGES["access_limited"]
    reason = str(gap.get("reason", "")).casefold()
    if any(term in reason for term in (
            "entity", "법인", "sponsor", "ein", "cik", "affiliate", "subsidiary", "정확", "결속")):
        return PUBLIC_GAP_MESSAGES["entity_or_scope_unproven"]
    if any(term in reason for term in (
            "current", "현행", "permission", "publish", "게시", "applicability", "적용", "scope", "범위")):
        return PUBLIC_GAP_MESSAGES["publication_requirements_unmet"]
    return PUBLIC_GAP_MESSAGES["not_verified"]


def _credential_free_https(source):
    parsed = urlparse(str(source.get("url", ""))) if isinstance(source, dict) else None
    return bool(parsed and parsed.scheme == "https" and parsed.netloc
                and parsed.username is None and parsed.password is None)


def _timezone_aware_timestamp(value):
    if not isinstance(value, str) or not re.fullmatch(
            r"20[0-9]{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T"
            r"(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]+)?"
            r"(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])", value):
        return False
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).tzinfo is not None
    except ValueError:
        return False


def publication_plain_text(value):
    """Render ledger prose as inert Jekyll Markdown within the final bound."""
    collapsed = " ".join(value.split())
    tokens = []
    for character in collapsed:
        if character in "{}":
            token = f"&#{ord(character)};"
        elif ord(character) < 32 or 127 <= ord(character) <= 159:
            token = f"&#{ord(character)};"
        elif character in "&<>":
            token = html.escape(character, quote=False)
        elif character in "\\`*_[]()#+-.!|":
            token = "\\" + character
        else:
            token = character
        tokens.append(token)
    if sum(map(len, tokens)) <= PUBLICATION_PROSE_MAX_CHARS:
        return "".join(tokens)
    emitted = []
    length = 0
    for token in tokens:
        if length + len(token) > PUBLICATION_PROSE_MAX_CHARS - 1:
            break
        emitted.append(token)
        length += len(token)
    return "".join(emitted) + "…"


def publication_source_url(source):
    """Return a deterministic inert URL without changing valid target semantics."""
    url = source.get("url") if isinstance(source, dict) else None
    if not isinstance(url, str):
        raise ValueError("publication source URL is invalid")
    decoded = url
    for _ in range(4):
        if any(ord(char) < 32 or 127 <= ord(char) <= 159 for char in decoded):
            raise ValueError("publication source URL is invalid")
        next_decoded = unquote(decoded)
        if next_decoded == decoded:
            break
        decoded = next_decoded
    if not _credential_free_https(source):
        raise ValueError("publication source URL is invalid")
    return quote(url, safe=":/?#@!$&+,;=%")


def _valid_scope_shape(scope, reference=False):
    keys = {"countries", "legal_entities", "roles", "employment_types"}
    if reference:
        keys.add("status")
    if not isinstance(scope, dict) or set(scope) != keys:
        return False
    for field in ("countries", "legal_entities", "roles", "employment_types"):
        values = scope.get(field)
        if (not isinstance(values, list) or not values or len(values) != len(set(values))
                or any(not isinstance(value, str) or not value for value in values)):
            return False
    return all(re.fullmatch(r"[A-Z]{2}", country) for country in scope["countries"])


def _valid_v2_cell_shape(cell):
    if not isinstance(cell, dict) or set(cell) != V2_CELL_KEYS:
        return False
    if not _timezone_aware_timestamp(cell.get("assessed_at")):
        return False
    for field in ("attempt_ids", "official_claim_ids", "reference_ids", "community_report_ids"):
        values = cell.get(field)
        if not isinstance(values, list) or len(values) != len(set(values)):
            return False
    return True


def _valid_v2_record_shape(evidence_class, record):
    if not isinstance(record, dict) or set(record) != V2_RECORD_KEYS[evidence_class]:
        return False
    scope = record.get("scope")
    if not _valid_scope_shape(scope, reference=evidence_class == "reference"):
        return False
    if evidence_class == "official":
        return isinstance(record.get("source_ids"), list) and bool(record["source_ids"])
    statement = record.get("statement")
    if not isinstance(statement, str) or not 1 <= len(statement) <= 2000:
        return False
    if evidence_class == "reference":
        quote_text = record.get("supporting_quote")
        return (isinstance(quote_text, str) and 1 <= len(quote_text) <= 2000
                and _timezone_aware_timestamp(record.get("checked_at")))
    return True


def _same_v2_scope(record_scope, source_scope):
    fields = ("countries", "legal_entities", "roles", "employment_types")
    return all(
        isinstance(record_scope, dict) and isinstance(source_scope, dict)
        and isinstance(record_scope.get(field), list) and isinstance(source_scope.get(field), list)
        and sorted(record_scope[field]) == sorted(source_scope[field])
        for field in fields
    )


def _category_terms(category_id, taxonomy):
    terms = set(CATEGORY_PUBLICATION_TERMS.get(category_id, ()))
    for item in (taxonomy or {}).get("benefit_types", []):
        if item.get("category_id") == category_id and isinstance(item.get("label_ko"), str):
            terms.add(item["label_ko"])
    return tuple(sorted(terms, key=lambda value: (-len(value), value)))


def _entity_name_patterns(legal_entity):
    if not isinstance(legal_entity, str) or not legal_entity.strip():
        return ()
    exact = " ".join(legal_entity.split())
    alias = " ".join(CORPORATE_FORM_PATTERN.sub(" ", exact).split()).strip(" ,.-")
    names = [exact]
    if (alias.casefold() not in GENERIC_ENTITY_ALIASES and len(re.sub(r"[^0-9A-Za-z가-힣]", "", alias)) >= 3
            and alias.casefold() != exact.casefold()):
        names.append(alias)
    patterns = []
    for name in names:
        escaped = re.escape(name).replace(r"\ ", r"\s+")
        if re.search(r"[가-힣]", name):
            patterns.append(re.compile(
                r"(?<![0-9A-Za-z가-힣])" + escaped
                + r"(?=$|[\s,.;:!?)]|은|는|이|가|의|에서|에게|에는|을|를|과|와|도)", re.IGNORECASE))
        else:
            patterns.append(re.compile(
                r"(?<![0-9A-Za-z])" + escaped + r"(?![0-9A-Za-z])", re.IGNORECASE))
    return tuple(patterns)


def _all_term_positions(value, terms):
    positions = []
    for term in terms:
        start = value.find(term.casefold())
        while start >= 0:
            positions.append(start)
            start = value.find(term.casefold(), start + 1)
    return positions


def _entity_benefit_phrase(value, legal_entities, category_id, taxonomy):
    folded = value.casefold()
    entity_positions = [match.start() for entity in legal_entities
                        for pattern in _entity_name_patterns(entity)
                        for match in pattern.finditer(value)]
    employee_positions = _all_term_positions(folded, EMPLOYEE_TERMS)
    action_positions = _all_term_positions(folded, BENEFIT_ACTION_TERMS)
    category_positions = _all_term_positions(folded, _category_terms(category_id, taxonomy))
    return any(
        max(entity, employee, action, category) - min(entity, employee, action, category) <= 160
        for entity in entity_positions
        for employee in employee_positions
        for action in action_positions
        for category in category_positions
    )


def _eligible_publication_prose(value, category_id, taxonomy, legal_entities):
    if (not isinstance(value, str) or not value.strip()
            or len(value) > PUBLICATION_PROSE_MAX_CHARS
            or any(ord(char) < 32 and char not in "\t\n\r" for char in value)
            or any(pattern.search(value) for pattern in TEMPLATE_PROSE_PATTERNS)
            or PAGE_SHELL_PATTERN.search(value)
            or not isinstance(legal_entities, list) or not legal_entities):
        return False
    return _entity_benefit_phrase(value, legal_entities, category_id, taxonomy)


def _canonical_v2_source(source_id, source):
    if (not isinstance(source, dict) or set(source) != V2_SOURCE_KEYS
            or source.get("source_id") != source_id
            or not re.fullmatch(r"source::[A-Za-z0-9][A-Za-z0-9._:-]{2,220}", source_id)
            or source.get("source_tier") not in V2_SOURCE_TIERS
            or not isinstance(source.get("title"), str) or not source["title"]
            or len(source["title"]) > 500 or not _credential_free_https(source)
            or not _timezone_aware_timestamp(source.get("retrieved_at"))
            or not isinstance(source.get("content_sha256"), str)
            or not re.fullmatch(r"[0-9a-f]{64}", source["content_sha256"])
            or source.get("reliability") not in {"high", "medium", "low", "unrated"}
            or source.get("currentness") not in {"current", "historical", "unknown"}
            or source.get("scope_status") not in {"exact_entity", "bounded_entity", "group_only", "unresolved"}
            or source.get("conflict_status") not in {"none", "disclosed", "contradictory"}
            or source.get("publication_eligibility") not in {
                "eligible", "reference_only", "discovery_only", "ineligible"}):
        return False
    scope = source.get("scope")
    if not isinstance(scope, dict):
        return False
    for field in ("countries", "legal_entities", "roles", "employment_types"):
        values = scope.get(field)
        if (not isinstance(values, list) or not values or len(values) != len(set(values))
                or any(not isinstance(value, str) or not value for value in values)):
            return False
    if not all(re.fullmatch(r"[A-Z]{2}", country) for country in scope["countries"]):
        return False
    try:
        publication_source_url(source)
    except ValueError:
        return False
    return True


def _valid_community_review(record):
    moderation = record.get("moderation")
    snapshot = record.get("frozen_snapshot")
    return bool(
        isinstance(moderation, dict)
        and set(moderation) == {"status", "reviewer_id", "reviewed_at", "decision_sha256"}
        and moderation.get("status") == "approved"
        and isinstance(moderation.get("reviewer_id"), str)
        and re.fullmatch(r"moderator::[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", moderation["reviewer_id"])
        and _timezone_aware_timestamp(moderation.get("reviewed_at"))
        and isinstance(moderation.get("decision_sha256"), str)
        and re.fullmatch(r"[0-9a-f]{64}", moderation["decision_sha256"])
        and isinstance(snapshot, dict)
        and set(snapshot) == {"locator", "content_sha256", "frozen_at"}
        and _credential_free_https({"url": snapshot.get("locator")})
        and isinstance(snapshot.get("content_sha256"), str)
        and re.fullmatch(r"[0-9a-f]{64}", snapshot["content_sha256"])
        and _timezone_aware_timestamp(snapshot.get("frozen_at"))
    )


def _valid_v2_record_binding(evidence_class, record_id, record, cell, source):
    if not _valid_v2_cell_shape(cell) or not _valid_v2_record_shape(evidence_class, record):
        return False
    if evidence_class == "official":
        return (
            record_id == record.get("claim_id")
            and record.get("source_tier") == "official_government"
            and record.get("scope_status") == source.get("scope_status") == cell.get("scope_status")
            and record.get("conflict_status") == source.get("conflict_status")
            and record.get("publication_eligibility") == source.get("publication_eligibility") == "eligible"
            and _same_v2_scope(record.get("scope"), source.get("scope"))
        )
    source_id = record.get("source_id")
    canonical_id = f"{evidence_class}::{record.get('company_id')}::{record.get('category_id')}::{source_id}"
    if record_id != canonical_id:
        return False
    record_scope_status = (
        record.get("scope", {}).get("status") if evidence_class == "reference"
        else record.get("scope_status")
    )
    if (record.get("source_tier") != source.get("source_tier")
            or record.get("reliability") != source.get("reliability")
            or record.get("currentness") != source.get("currentness")
            or record.get("conflict_status") != source.get("conflict_status")
            or record.get("publication_eligibility") != source.get("publication_eligibility")
            or record_scope_status != source.get("scope_status")
            or record_scope_status != cell.get("scope_status")
            or not _same_v2_scope(record.get("scope"), source.get("scope"))):
        return False
    if evidence_class == "reference":
        return (record.get("source_locator") == source.get("url")
                and record.get("checked_at") == source.get("retrieved_at"))
    return _valid_community_review(record)


def publication_evidence(company_id, claims, source_map, assignments, taxonomy,
                         cells=None, v2_indexes=None):
    """Normalize validated legacy and v2 records into publication evidence."""
    type_ids = {item["id"] for item in (taxonomy or {}).get("benefit_types", [])}
    category_map = {item["id"]: item["label_ko"] for item in (taxonomy or {}).get("categories", [])}
    evidence = []
    for claim in claims:
        if (claim.get("company_id") != company_id
                or claim.get("status") not in {"confirmed", "limited", "past", "conflict"}):
            continue
        assignment = assignments.get(claim.get("claim_id"), {}).get("assignment", {})
        assigned_ids = assignment.get("benefit_type_ids")
        if (assignment.get("state") != "assigned" or not isinstance(assigned_ids, list)
                or not assigned_ids or (type_ids and any(item not in type_ids for item in assigned_ids))):
            continue
        source_ids = claim.get("source_ids")
        source_evidence = claim.get("source_evidence")
        if (not isinstance(source_ids, list) or not source_ids
                or not isinstance(source_evidence, list) or not source_evidence):
            continue
        evidence_ids = [item.get("source_id") for item in source_evidence if isinstance(item, dict)]
        if set(evidence_ids) != set(source_ids) or any(not source_id for source_id in evidence_ids):
            continue
        bound = True
        for source_id in source_ids:
            source = source_map.get(source_id)
            if (not _credential_free_https(source)
                    or source.get("publication_eligible") is False
                    or source.get("retention_mode") == "metadata_only"):
                bound = False
                break
        if bound:
            evidence.append({"evidence_class": "legacy", "record_id": claim["claim_id"],
                             "source_ids": source_ids, "raw": claim, "type_ids": assigned_ids})

    indexes = v2_indexes or {}
    sources = indexes.get("sources", {})
    ledger_contracts = (
        ("official", "official_claims", "official_claim_ids", "claim_id", {"eligible"},
         r"official::[a-f0-9]{64}"),
        ("reference", "references", "reference_ids", "reference_id", {"eligible", "reference_only"},
         r"reference::[A-Za-z0-9][A-Za-z0-9._:-]{2,220}"),
        ("community", "community_reports", "community_report_ids", "community_report_id", {"eligible"},
         r"community::[A-Za-z0-9][A-Za-z0-9._:-]{2,220}"),
    )
    valid_cell_publication = {
        "official_verified": "official_claim", "reference": "reference_only",
        "community_report": "community_only",
    }
    record_counts = {}
    for cell in (cells or {}).values():
        if not isinstance(cell, dict):
            continue
        for field in ("official_claim_ids", "reference_ids", "community_report_ids"):
            for record_id in cell.get(field, []) if isinstance(cell.get(field), list) else []:
                record_counts[record_id] = record_counts.get(record_id, 0) + 1
    seen_records = set()
    for category_id, cell in (cells or {}).items():
        if (not isinstance(cell, dict) or category_id not in category_map
                or cell.get("company_id") != company_id or cell.get("category_id") != category_id
                or cell.get("state") not in valid_cell_publication
                or cell.get("publication_eligibility") != valid_cell_publication[cell["state"]]):
            continue
        cell_id = cell.get("cell_id")
        if cell_id != f"cell::{company_id}::{category_id}":
            continue
        for evidence_class, ledger, cell_field, id_field, eligible_values, id_pattern in ledger_contracts:
            record_ids = cell.get(cell_field)
            if (not isinstance(record_ids, list) or len(record_ids) != len(set(record_ids))
                    or any(record_counts.get(record_id) != 1 for record_id in record_ids)):
                continue
            for record_id in record_ids:
                if (not isinstance(record_id, str) or not re.fullmatch(id_pattern, record_id)
                        or record_id in seen_records):
                    continue
                record = indexes.get(ledger, {}).get(record_id)
                if (not isinstance(record, dict) or record.get(id_field) != record_id
                        or any(record.get(field) != cell.get(field)
                               for field in ("cell_id", "company_id", "category_id"))
                        or record.get("publication_eligibility") not in eligible_values):
                    continue
                if evidence_class == "official":
                    source_ids = record.get("source_ids")
                else:
                    source_id = record.get("source_id")
                    source_ids = [source_id] if isinstance(source_id, str) and source_id else []
                if not isinstance(source_ids, list) or not source_ids or any(
                        not isinstance(source_id, str) or not source_id for source_id in source_ids):
                    continue
                if len(source_ids) != len(set(source_ids)):
                    continue
                bound_sources = [sources.get(source_id) for source_id in source_ids]
                if any(not _canonical_v2_source(source_id, source)
                       or source.get("publication_eligibility") not in eligible_values
                       for source_id, source in zip(source_ids, bound_sources)):
                    continue
                if not _valid_v2_record_binding(
                        evidence_class, record_id, record, cell, bound_sources[0]):
                    continue
                statement = record.get("statement")
                quote = record.get("supporting_quote")
                if evidence_class == "community":
                    quote = statement
                prose = (statement, quote)
                legal_entities = record.get("scope", {}).get("legal_entities")
                if any(not _eligible_publication_prose(
                        value, category_id, taxonomy, legal_entities) for value in prose):
                    continue
                evidence.append({
                    "evidence_class": evidence_class, "record_id": record_id,
                    "source_ids": source_ids, "statement": publication_plain_text(statement),
                    "supporting_quote": publication_plain_text(quote), "category_label": category_map[category_id],
                    "scope": record.get("scope") or cell.get("scope") or {},
                    "scope_status": record.get("scope_status", cell.get("scope_status", "unknown")),
                    "reliability": record.get("reliability", cell.get("reliability", "unknown")),
                    "currentness": record.get("currentness", cell.get("currentness", "unknown")),
                    "conflict_status": record.get("conflict_status", cell.get("conflict_status", "none")),
                })
                seen_records.add(record_id)
    return evidence


def has_meaningful_benefit_evidence(company_id, claims, source_map, assignments, taxonomy=None,
                                    cells=None, v2_indexes=None):
    """Return whether normalized publication evidence exists for a company."""
    return bool(publication_evidence(
        company_id, claims, source_map, assignments, taxonomy or {}, cells, v2_indexes
    ))


def curate_installment_entries(entries, claims_by_company, source_map, assignments,
                               cells_by_company=None, v2_indexes=None, taxonomy=None):
    """Copy installments while dropping evidence-empty companies and batches."""
    curated = []
    for entry in entries:
        company_ids = [
            company_id for company_id in entry["company_ids"]
            if has_meaningful_benefit_evidence(
                company_id, claims_by_company.get(company_id, []), source_map, assignments, taxonomy,
                (cells_by_company or {}).get(company_id, {}), v2_indexes,
            )
        ]
        if company_ids:
            value = copy.deepcopy(entry)
            value["company_ids"] = company_ids
            curated.append(value)
    return curated


def render_installment(entry, company_map, claims_by_company, gaps_by_company, source_map, check_map,
                       assignments, taxonomy, cells_by_company=None, v2_indexes=None):
    type_map = {item["id"]: item for item in taxonomy["benefit_types"]}
    source_map = {**source_map, **(v2_indexes or {}).get("sources", {})}
    cited = []

    def citations(source_ids):
        numbers = []
        for source_id in dict.fromkeys(source_ids):
            source = source_map.get(source_id)
            try:
                publication_source_url(source)
            except ValueError as exc:
                raise ValueError(
                    f"{source_id}: claim source is missing or not publication eligible"
                ) from exc
            if source_id not in cited:
                cited.append(source_id)
            numbers.append(cited.index(source_id) + 1)
        return "".join(f"[{number}]" for number in numbers)

    parts = [front_matter(entry)]
    parts.append(f"![{entry['body_image_alt']}]({entry['featured_image']})\n\n")
    parts.append(entry["intro_text"] + "\n\n")
    parts.append("> 이 글의 회사 순서는 순위가 아닙니다. 공개 근거 공백은 복지가 없다는 뜻이 아닙니다.\n\n")
    parts.append(f"## 근거가 확인된 {len(entry['company_ids'])}개 보고 법인\n\n")
    for company_id in entry["company_ids"]:
        company = company_map[company_id]
        scale, fiscal, financial_scope = format_scale(company)
        parts.append(f"### {company['legal_name']}\n\n")
        parts.append(f"- 법인 ID: `{company_id}`\n")
        parts.append(f"- 선정 단위: {company.get('selected_reporting_legal_entity', company['legal_name'])}\n")
        parts.append(f"- 관할·범위: {company.get('jurisdiction', '미상')} / {company.get('scope', entry['scope'])}\n")
        parts.append(f"- 규모 근거: {scale}; 회계연도 말 {fiscal}; 재무 범위 {financial_scope}\n")
        company_evidence = publication_evidence(
            company_id, claims_by_company.get(company_id, []), source_map, assignments, taxonomy,
            (cells_by_company or {}).get(company_id, {}), v2_indexes,
        )
        if not company_evidence:
            raise ValueError(f"{company_id}: curated company lacks meaningful benefit evidence")
        for item in company_evidence:
            if item["evidence_class"] != "legacy":
                marker = citations(item["source_ids"])
                class_label = {"official": "공식", "reference": "참고", "community": "커뮤니티"}[
                    item["evidence_class"]]
                parts.append(f"- **{item['statement']}** ({item['category_label']}; {class_label}){marker}\n")
                parts.append(f"  - 근거 문구: {item['supporting_quote']}\n")
                parts.append(f"  - 적용 범위: {scope_text({'application_scope': item['scope']})}\n")
                parts.append(f"  - 신뢰도·현재성: {item['reliability']} / {item['currentness']}\n")
                parts.append(f"  - 범위·상충: {item['scope_status']} / {item['conflict_status']}\n")
                continue
            claim = item["raw"]
            assignment = assignments.get(claim["claim_id"])
            if assignment is None:
                raise ValueError(f"{claim['claim_id']}: missing approved taxonomy assignment")
            outcome = assignment["assignment"]
            labels = [type_map[type_id]["label_ko"] for type_id in outcome["benefit_type_ids"]]
            source_ids = [item["source_id"] for item in claim.get("source_evidence", [])]
            if set(source_ids) != set(claim.get("source_ids", [])):
                raise ValueError(f"{claim['claim_id']}: source evidence coverage mismatch")
            marker = citations(source_ids)
            status = STATUS_LABELS.get(claim.get("status"), claim.get("status", "범위 제한 확인"))
            parts.append(f"- **{claim['benefit_name']}** ({', '.join(labels)}) — {status}: {claim['detail']}{marker}\n")
            parts.append(f"  - 적용 범위: {scope_text(claim)}\n")
            checked_at = claim.get("prepublication_checked_at", claim.get("checked_at"))
            checked_text = public_check_time(checked_at) if checked_at else "미상"
            parts.append(f"  - 근거 등급·확인일: {claim.get('evidence_grade', '미상')} / {checked_text}\n")
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
    domestic = [row for row in installment_entries if row["scope"] == "domestic"]
    international = [row for row in installment_entries if row["scope"] == "international"]
    parts = [front_matter(entry)]
    parts.append(f"![{entry['body_image_alt']}]({entry['featured_image']})\n\n")
    intro = entry["intro_text"].replace(
        "국내 40개 배치와 해외 40개 배치",
        f"국내 {len(domestic)}개 배치와 해외 {len(international)}개 배치",
    )
    parts.append(intro + "\n\n")
    parts.append("> 이 디렉터리는 기업의 종합 순위나 우열표가 아닙니다. 근거를 확인하지 못했다는 기록은 복지 부재 판정이 아닙니다.\n\n")
    parts.append(f"전체 {len(installment_entries)}개 배치가 근거를 포함해 발행되었습니다.\n\n")
    parts.append(f"## 국내 {len(domestic)}개 배치\n\n")
    for item in domestic:
        parts.append(f"- [{item['title']}]({{% post_url {Path(item['filename']).stem} %}})\n")
    parts.append(f"\n## 해외 {len(international)}개 배치\n\n")
    for item in international:
        parts.append(f"- [{item['title']}]({{% post_url {Path(item['filename']).stem} %}})\n")
    parts.append("\n## 읽는 법과 한계\n\n")
    parts.append(entry["summary_text"] + "\n\n")
    population_source_ids = entry["citation_source_mapping"]["population_source_ids"]
    citation_marks = "".join(f"[{index}]" for index in range(1, len(population_source_ids) + 1))
    parts.append("해외 범위는 미국 설립·미국 주사업장 근거를 갖춘 SEC 10-K 공시 법인 코호트이고, 국내 범위는 선정된 대한민국 보고 법인입니다. 서로 다른 회계연도와 지표를 하나의 순위로 합치지 않습니다. 과거 계획 근거는 현재 제공이나 개인 자격으로 확대하지 않습니다." + citation_marks + "\n\n")
    parts.append("## Sources\n\n")
    parts.append(render_sources(population_source_ids, source_map))
    return "".join(parts)


def _sha256(raw):
    return hashlib.sha256(raw).hexdigest()


def _transaction_paths(output_root):
    parent = Path(output_root).parent
    return parent / ".company-benefits-posts-transaction.json", parent / ".company-benefits-posts.lock"


def _absolute(path):
    """Return a lexical absolute path; resolving would follow an attacker symlink."""
    return Path(os.path.abspath(os.fspath(path)))


def _assert_no_symlink(path):
    """Reject symlinks in every existing component of a publication path."""
    path = _absolute(path)
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(mode):
            raise RuntimeError(f"publication path contains symlink: {current}")
    return path


def _fsync_dir(path):
    descriptor = os.open(_assert_no_symlink(path), os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _mkdir_no_symlinks(path):
    path = _absolute(path)
    current = Path(path.anchor)
    for part in path.parts[1:]:
        parent = current
        current /= part
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            os.mkdir(current, 0o700)
            _fsync_dir(parent)
            mode = current.lstat().st_mode
        if stat.S_ISLNK(mode):
            raise RuntimeError(f"publication path contains symlink: {current}")
        if not stat.S_ISDIR(mode):
            raise RuntimeError(f"publication parent is not a directory: {current}")
    return path


def _read_regular(path):
    path = _assert_no_symlink(path)
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except FileNotFoundError:
        return None
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise RuntimeError(f"publication path is not a regular file: {path}")
        chunks = []
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                return b"".join(chunks)
            chunks.append(chunk)
    finally:
        os.close(descriptor)


def _write_file_durable(path, raw):
    path = _assert_no_symlink(path)
    _mkdir_no_symlinks(path.parent)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        view = memoryview(raw)
        while view:
            written = os.write(descriptor, view)
            view = view[written:]
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    _fsync_dir(path.parent)


@contextmanager
def _publication_lock(output_root):
    output_root = _assert_no_symlink(output_root)
    _mkdir_no_symlinks(output_root.parent)
    _, lock_path = _transaction_paths(output_root)
    _assert_no_symlink(lock_path)
    descriptor = os.open(lock_path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise RuntimeError("publication lock is not a regular file")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise RuntimeError("company-benefits publication publisher lock is held") from exc
        yield output_root
    finally:
        os.close(descriptor)


def _write_journal(path, journal):
    path = _assert_no_symlink(path)
    temporary = Path(str(path) + ".tmp")
    if temporary.exists() or temporary.is_symlink():
        _assert_no_symlink(temporary)
        temporary.unlink()
    raw = json.dumps(journal, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    _write_file_durable(temporary, raw)
    _assert_no_symlink(path.parent)
    os.replace(temporary, path)
    _fsync_dir(path.parent)


def _remove_tree_durable(root):
    root = _assert_no_symlink(root)
    if not root.exists():
        return
    if not root.is_dir():
        raise RuntimeError(f"transaction path is not a directory: {root}")
    for directory, names, files in os.walk(root, topdown=False, followlinks=False):
        directory = _assert_no_symlink(directory)
        for name in files:
            _assert_no_symlink(Path(directory) / name).unlink()
        for name in names:
            _assert_no_symlink(Path(directory) / name).rmdir()
        _fsync_dir(directory)
    root.rmdir()
    _fsync_dir(root.parent)


def _finish_cleanup(journal_path, transaction_root):
    _remove_tree_durable(transaction_root)
    journal_path = _assert_no_symlink(journal_path)
    journal_path.unlink(missing_ok=True)
    temporary = Path(str(journal_path) + ".tmp")
    if temporary.exists():
        _assert_no_symlink(temporary).unlink()
    _fsync_dir(journal_path.parent)


def _validate_journal(raw, output_root):
    required = {"schema_version", "state", "output_root", "transaction", "items"}
    if not isinstance(raw, dict) or set(raw) != required:
        raise RuntimeError("invalid publication journal schema")
    if raw["schema_version"] != "company-benefits-publication-v2":
        raise RuntimeError("unsupported company-benefits publication journal")
    if raw["state"] not in {"preparing", "prepared", "committed"}:
        raise RuntimeError("invalid publication journal state")
    if raw["output_root"] != os.path.abspath(os.fspath(output_root)):
        raise RuntimeError("publication journal belongs to a different output root")
    transaction = raw["transaction"]
    if not isinstance(transaction, str) or not re.fullmatch(r"\.company-benefits-posts-transaction-[0-9a-f]{32}", transaction):
        raise RuntimeError("invalid publication transaction identity")
    items = raw["items"]
    if not isinstance(items, list) or len(items) != 81:
        raise RuntimeError("publication journal requires exactly 81 items")
    relatives = []
    for item in items:
        if not isinstance(item, dict) or set(item) != {"relative", "old_exists", "old_sha256", "new_sha256"}:
            raise RuntimeError("invalid publication journal item schema")
        relative = item["relative"]
        if not isinstance(relative, str):
            raise RuntimeError("invalid publication journal relative path")
        path = Path(relative)
        if path.is_absolute() or ".." in path.parts or path.parent != Path("_posts"):
            raise RuntimeError("unsafe publication journal relative path")
        if not isinstance(item["old_exists"], bool):
            raise RuntimeError("invalid publication journal existence state")
        digest = item["old_sha256"]
        if item["old_exists"] != isinstance(digest, str):
            raise RuntimeError("invalid publication journal old hash state")
        if item["new_sha256"] is not None and not isinstance(item["new_sha256"], str):
            raise RuntimeError("invalid publication journal new hash state")
        for value in (digest, item["new_sha256"]):
            if value is not None and (not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value)):
                raise RuntimeError("invalid publication journal hash")
        relatives.append(relative)
    if relatives != sorted(EXPECTED_PUBLICATION_FILENAMES):
        raise RuntimeError("publication journal filename contract mismatch")
    return raw


def _load_journal(journal_path, output_root):
    raw = _read_regular(journal_path)
    if raw is None:
        temporary = Path(str(journal_path) + ".tmp")
        raw = _read_regular(temporary)
        if raw is None:
            return None
        try:
            value = _validate_journal(json.loads(raw), output_root)
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise RuntimeError("invalid publication journal encoding") from exc
        os.replace(temporary, journal_path)
        _fsync_dir(journal_path.parent)
        return value
    try:
        value = json.loads(raw)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("invalid publication journal encoding") from exc
    return _validate_journal(value, output_root)


def _validate_transaction_tree(transaction_root, items):
    """Refuse to remove anything not proven to belong to this journal."""
    transaction_root = _assert_no_symlink(transaction_root)
    if not transaction_root.exists():
        return
    by_relative = {item["relative"]: item for item in items}
    allowed_directories = {Path("."), Path("staged"), Path("backups"), Path("restore")}
    allowed_directories.update(Path(kind) / "_posts" for kind in ("staged", "backups", "restore"))
    for directory, names, files in os.walk(transaction_root, followlinks=False):
        directory = _assert_no_symlink(directory)
        relative_directory = Path(directory).relative_to(transaction_root)
        if relative_directory not in allowed_directories:
            raise RuntimeError("unexpected publication transaction directory")
        for name in names:
            _assert_no_symlink(Path(directory) / name)
        for name in files:
            path = _assert_no_symlink(Path(directory) / name)
            relative = path.relative_to(transaction_root)
            if len(relative.parts) != 3 or relative.parts[0] not in {"staged", "backups", "restore"}:
                raise RuntimeError("unexpected publication transaction entry")
            publication_relative = str(Path(*relative.parts[1:]))
            item = by_relative.get(publication_relative)
            if item is None:
                raise RuntimeError("unexpected publication transaction filename")
            expected = item["new_sha256"] if relative.parts[0] == "staged" else item["old_sha256"]
            raw = _read_regular(path)
            if expected is None or raw is None or _sha256(raw) != expected:
                raise RuntimeError("publication transaction file hash mismatch")


def _recover_publication_locked(output_root):
    journal_path, _ = _transaction_paths(output_root)
    journal = _load_journal(journal_path, output_root)
    if journal is None:
        return False
    transaction_root = output_root.parent / journal["transaction"]
    _assert_no_symlink(transaction_root)
    items = journal["items"]
    _validate_transaction_tree(transaction_root, items)

    if journal["state"] == "committed":
        for item in items:
            current = _read_regular(output_root / item["relative"])
            current_sha = _sha256(current) if current is not None else None
            if current_sha != item["new_sha256"]:
                raise RuntimeError("committed publication target hash mismatch")
        _finish_cleanup(journal_path, transaction_root)
        return True

    actions = []
    for item in items:
        target = output_root / item["relative"]
        current = _read_regular(target)
        current_sha = _sha256(current) if current is not None else None
        old_sha = item["old_sha256"]
        if current_sha == old_sha and (current is not None) == item["old_exists"]:
            actions.append(("keep", item, target))
            continue
        if journal["state"] == "preparing":
            raise RuntimeError("preparing publication target hash mismatch")
        if current_sha != item["new_sha256"]:
            raise RuntimeError("publication journal or target hash mismatch; concurrent bytes preserved")
        if item["old_exists"]:
            backup = transaction_root / "backups" / item["relative"]
            backup_raw = _read_regular(backup)
            if backup_raw is None or _sha256(backup_raw) != old_sha:
                raise RuntimeError("publication backup hash mismatch")
            actions.append(("restore", item, target))
        else:
            actions.append(("delete", item, target))

    if (journal["state"] == "prepared" and not transaction_root.is_dir()
            and any(action != "keep" for action, _, _ in actions)):
        raise RuntimeError("prepared publication transaction data is missing")
    for action, item, target in reversed(actions):
        if action == "keep":
            continue
        _assert_no_symlink(target.parent)
        if action == "delete":
            target.unlink()
        else:
            backup_raw = _read_regular(transaction_root / "backups" / item["relative"])
            restore = transaction_root / "restore" / item["relative"]
            _mkdir_no_symlinks(restore.parent)
            _write_file_durable(restore, backup_raw)
            _assert_no_symlink(target)
            os.replace(restore, target)
        _fsync_dir(target.parent)
    _finish_cleanup(journal_path, transaction_root)
    return True


def recover_publication(output_root):
    """Recover an interrupted publication while preserving unowned bytes."""
    with _publication_lock(output_root) as output_root:
        return _recover_publication_locked(output_root)


def publish_rendered_posts(rendered, output_root):
    """Publish an emitted subset and remove only omitted known generated paths."""
    if (not isinstance(rendered, dict) or not set(rendered).issubset(EXPECTED_PUBLICATION_FILENAMES)
            or "_posts/2026-10-31-company-benefits-verified-directory-hub.md" not in rendered):
        raise ValueError("publication transaction requires a generated filename subset including the hub")
    encoded = {}
    for relative, text in rendered.items():
        path = Path(relative)
        if (not isinstance(relative, str) or not isinstance(text, str) or path.is_absolute()
                or ".." in path.parts or path.parent != Path("_posts") or path.suffix != ".md"):
            raise ValueError(f"invalid rendered publication item: {relative}")
        encoded[relative] = text.encode("utf-8")

    with _publication_lock(output_root) as output_root:
        journal_path, _ = _transaction_paths(output_root)
        _recover_publication_locked(output_root)
        transaction_name = ".company-benefits-posts-transaction-" + uuid.uuid4().hex
        transaction_root = output_root.parent / transaction_name
        items = []
        for relative in sorted(EXPECTED_PUBLICATION_FILENAMES):
            old = _read_regular(output_root / relative)
            items.append({
                "relative": relative,
                "old_exists": old is not None,
                "old_sha256": _sha256(old) if old is not None else None,
                "new_sha256": _sha256(encoded[relative]) if relative in encoded else None,
            })
        journal = {
            "schema_version": "company-benefits-publication-v2",
            "state": "preparing",
            "output_root": os.path.abspath(os.fspath(output_root)),
            "transaction": transaction_name,
            "items": items,
        }
        _write_journal(journal_path, journal)
        try:
            os.mkdir(transaction_root, 0o700)
            _fsync_dir(transaction_root.parent)
            for directory in (transaction_root / "staged", transaction_root / "backups"):
                os.mkdir(directory, 0o700)
                _fsync_dir(directory.parent)
            for item in items:
                relative = item["relative"]
                if item["new_sha256"] is not None:
                    staged = transaction_root / "staged" / relative
                    _mkdir_no_symlinks(staged.parent)
                    _write_file_durable(staged, encoded[relative])
                if item["old_exists"]:
                    old = _read_regular(output_root / relative)
                    if old is None or _sha256(old) != item["old_sha256"]:
                        raise RuntimeError("concurrent publication target change during preparation")
                    backup = transaction_root / "backups" / relative
                    _mkdir_no_symlinks(backup.parent)
                    _write_file_durable(backup, old)
            journal["state"] = "prepared"
            _write_journal(journal_path, journal)

            for item in items:
                target = output_root / item["relative"]
                _mkdir_no_symlinks(target.parent)
                current = _read_regular(target)
                current_sha = _sha256(current) if current is not None else None
                if current_sha != item["old_sha256"] or (current is not None) != item["old_exists"]:
                    raise RuntimeError(f"concurrent publication target change: {target}")
                _assert_no_symlink(target)
                if item["new_sha256"] is None:
                    if current is not None:
                        target.unlink()
                else:
                    staged = transaction_root / "staged" / item["relative"]
                    staged_raw = _read_regular(staged)
                    if staged_raw is None or _sha256(staged_raw) != item["new_sha256"]:
                        raise RuntimeError("staged publication hash mismatch")
                    os.replace(staged, target)
                _fsync_dir(target.parent)
            journal["state"] = "committed"
            _write_journal(journal_path, journal)
        except Exception:
            _recover_publication_locked(output_root)
            raise
        _validate_transaction_tree(transaction_root, items)
        _finish_cleanup(journal_path, transaction_root)


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
    taxonomy_sha256 = hashlib.sha256(Path(taxonomy_path).read_bytes()).hexdigest()
    validated = validate_complete_inputs(research_root, taxonomy, taxonomy_sha256)
    companies, company_map, claims_by_company, gaps_by_company, source_map, assignments = validated[:6]
    cells_by_company, v2_indexes = validated[8], validated[11]
    check_map = unique_map(read_jsonl(research_root / "series-prepublication-checks.jsonl"), "source_id", "prepublication checks")
    if len(companies) != 2000:
        raise ValueError("validated active company ledger must contain exactly 2,000 rows")
    batch_map = unique_map(read_jsonl(research_root / "series-batches.jsonl"), "batch_id", "series batches")
    installments = [entry for entry in entries if entry["artifact_type"] == "installment"]
    for entry in installments:
        batch = batch_map.get(entry["batch_id"])
        if batch is None or batch.get("company_ids") != entry["company_ids"]:
            raise ValueError(f"{entry['batch_id']}: render map differs from active canonical batch")
    emitted_installments = curate_installment_entries(
        installments, claims_by_company, source_map, assignments,
        cells_by_company, v2_indexes, taxonomy,
    )
    rendered = {}
    for entry in emitted_installments:
        rendered[entry["filename"]] = render_installment(
            entry, company_map, claims_by_company, gaps_by_company, source_map, check_map, assignments,
            taxonomy, cells_by_company, v2_indexes,
        )
    hub = next(entry for entry in entries if entry["artifact_type"] == "hub")
    rendered[hub["filename"]] = render_hub(hub, emitted_installments, source_map)
    publish_rendered_posts(rendered, output_root)
    return sorted(rendered)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--research-root", required=True, type=Path)
    parser.add_argument("--render-map", required=True, type=Path)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--taxonomy", required=True, type=Path)
    parser.add_argument("--as-of", type=date.fromisoformat)
    parser.add_argument("--freeze-anchor-receipt", required=True, type=Path)
    parser.add_argument("--effective-selection-receipt", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        paths = render_series(
            args.research_root, args.render_map, args.output_root, args.taxonomy,
            as_of=args.as_of, freeze_anchor_receipt=args.freeze_anchor_receipt,
            effective_selection_receipt=args.effective_selection_receipt,
        )
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError, RuntimeError) as exc:
        print(f"production post rendering failed: {exc}", file=sys.stderr)
        return 1
    print(f"Rendered {len(paths)} deterministic Jekyll posts.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
