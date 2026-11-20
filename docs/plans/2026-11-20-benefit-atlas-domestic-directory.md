# Domestic Company Directory Implementation Plan

> **For Hermes:** Use subagent-driven-development for independent implementation work; spec review then code review. Keep source raw files outside the repository and do not run a local HTTP/dev/CDP server.

**Goal:** Search a materially larger, honest Korean company directory alongside the existing benefit atlas, categorize only companies with legal-size evidence, and show concrete benefit actions before links.

**Architecture:** Export a separate hash-pinned `domestic-directory-v1` static sibling from a permissively licensed dated recruitment dataset and a private, exact-ID DART alias-exclusion bridge. The original 2,000-company manifest and existing 128 research-only actions stay unchanged. A new lazy route loads bounded directory shards, handles deterministic name/size filters, and links known base CRNs to existing benefit detail; other business identities remain `공개 복지 정보 미확인`. No internet services at browser runtime except same-origin static artifacts.

**Tech Stack:** Python 3 stdlib (`csv`, `zipfile`, `ElementTree`, `json`, `hashlib`, `unittest`), Node built-in test runner, TypeScript/React/Zod/Vitest, Jekyll/Docker static build.

**Specification:** `docs/superpowers/specs/2026-11-20-benefit-atlas-domestic-directory-design.md`. Sources private under `${HERMES_HOME}/data/benefit-domestic-acquisition/` (the active conan profile, never public or logged in generated files). Pinned SHA-256 checks in the spec must be enforced before transforming source bytes. Preserve earlier user constraints: one final push of the expanded work branch only, no PR/merge/deploy, and no local web server.

---

### Task 1: Pure acquisition parser and atomic generator

**Files:** Create `scripts/generate-domestic-company-directory.py`, `scripts/test_domestic_company_directory.py`.

1. Write failing tests for 10-digit business identifiers, exact 13-digit DART CRN joins, duplicate postings, latest-day contradictory names, inconsistent latest-day region/employee counts, missing posting dates, HTML/control chars, base-CRN aliases, and a source hash mismatch. Each fixture is tiny and synthetic; no real business numbers or names in fixtures.
2. Run `python3 -m unittest scripts/test_domestic_company_directory.py -q` and confirm a meaningful failure.
3. Implement streaming private XLSX row extraction with `zipfile.ZipFile` + `xml.etree.ElementTree.iterparse` (do not load 170MB XML into memory). Parse `G` as exact CRN and `H` as exact BID, not ticker/DART corp_code. Reject ambiguous BID-to-CRN joins. Parse CP949 CSV `기업명,사업자번호,지역구분,종업원수,공고명,고용형태,공고등록일`; do not export the latter two prose fields. For each BID choose the greatest valid observation date; if different names occur on that same day, quarantine the BID. Do not call the observation a currently active company.
4. Export stable `KR-BIZ-<10 digits>` for non-base BID identities. If an unambiguous exact BID→CRN join finds an existing base KR-CRN identity, export a base enrichment record under that CRN instead; no second company. For multiple dates of one BID, preserve latest-day date; for conflicting region/staff values on that day, omit that optional field.
5. Write manifest and bounded shards by staging files in a temp directory; validate all before atomic destination replacement. Preserve a prior complete output on normal replacement failure. A `--check` run compares all expected bytes, not just counts. Record all source/manifest SHA-256, count and exclusion rules without host-private paths.
6. Run the focused unittest and verify it passes. Commit only scripts/tests; never add either source file.

### Task 2: Run the real official files and audit denominators

**Files:** Create `community-app/public/data/company-benefits/domestic-directory-v1/{manifest.json,shards/*.json}`, update `docs/research/company-benefits/acquisition/README.md`.

1. Run the generator with explicitly pinned restricted inputs and the unchanged base manifest/listing, then `--check`. Expected public output: all accepted **unique identities**, not 84,860 job rows; latest-day conflicts and aliases reduce the number. Calculate the final number from generated shards, do not hardcode `36,093` or any other guess.
2. Programmatically compare the published new `KR-BIZ` IDs against exact old base aliases and validate that every duplicated source BID has one final record. Audit old observations separately from fresh ones; show posting dates and source edition.
3. Scan public JSON for raw job titles, addresses, phones, host paths, credential patterns and original full CSV/XLSX; abort if found. Ensure source files are absent from `git status` and staged set. Commit only cleaned manifest/shards and docs.

### Task 2a: Dated official size-evidence overlay (separate from directory generator)

**Files:** Create `scripts/generate-domestic-size-evidence.py`, focused tests, and `community-app/public/data/company-benefits/domestic-directory-v1/size-evidence.json` or a separate versioned sibling; update the directory manifest/consumer only after its schema is frozen.

1. RED: conflicting CRN in one official FTC sheet is quarantined; a different business ID or name-only match cannot inherit an affiliate label; exact base CRN and unambiguous private BID→CRN bridge can; zero source evidence remains `unclassified`. Test source dates, hash, count and attribution.
2. Parse private pinned FTC workbook sheet `2-2. 기업집단별 소속회사 현황` SHA-256 `080238dc8e95bc7cff0100534854d317ed6948a25a291688f451fa5be23053fb`, public source [2026-11-18 release](https://www.ftc.go.kr/www/selectBbsNttView.do?bordCd=3&key=12&nttSn=48244) with 공공누리 제1유형 attribution. Use 2026-11-02 reference date, not release date. Quarantine all 16 CRNs with contradictory same-day group/name assignment; do not inflate membership to source row count. Write only exact-ID accepted labels and source/date/attribution, no executive names or copy.
3. Join only known base CRNs and directory records with an unambiguous exact private DART bridge, never on name or group; `대기업` UI label is explicitly `공시대상기업집단 소속(2026-11-02)` evidence, not an independently proven HR/benefit policy. Mid-sized and SME classes remain unclassified until separate valid exact-ID certificates are available; do not infer them from recruitment headcounts.
4. Run focused tests and real pinned source, independently count accepted labels vs base/directory, then update client/verifier to pin the overlay bytes. If scope or rights fail, keep overlay unpublished and display size `미확인`. Commit only public reviewed projections and tests.

### Task 3: Fail-closed site verifier

**Files:** Create `scripts/verify-domestic-directory-artifacts.mjs`, `scripts/verify-domestic-directory-artifacts.test.mjs`; modify `scripts/verify-site.mjs` and site tests.

1. Write failing positive fixture and negative cases: missing manifest/shard, changed byte/hash/count, duplicate IDs (even after recomputed hashes), unsafe paths, false legal size, invalid observation date, oversized text, base aliases counted twice, raw job text in public artifacts.
2. Implement bounded SHA-256 checking and Zod-equivalent strict field validation using existing Node/stdlib only; check base manifest raw-byte binding, per-shard counts and cardinalities, URL path confinement and `size_class=unclassified` until independent evidence is supplied. Reject any scheme/host URL except explicit official HTTPS source metadata.
3. Hook verifier into the existing site build under `community/data/company-benefits/` without rewriting the old verifier. Run `node --test scripts/verify-domestic-directory-artifacts.test.mjs` and `node scripts/verify-site.mjs <assembled-site>` only after build; no server.

### Task 4: Lazy client and dedicated searchable UI

**Files:** Create `community-app/src/data/domesticDirectoryClient.ts`, its `.test.ts`; create `community-app/src/pages/BenefitsDirectoryPage.tsx`, test; modify `community-app/src/benefitsRoutes.ts`, `community-app/src/App.tsx`, `community-app/src/BenefitsApp.tsx`, `community-app/src/components/benefits/BenefitsExplorerShell.tsx`, `community-app/src/styles/benefits.css`; create `community-app/benefits/directory/index.html` from an existing route template.

1. Write failing loader tests for correct actual manifest/shards, tampered hashes, overlarge response, invalid ID, duplicate IDs, stale base manifest binding, abort and retry. Bound shard concurrency and bytes; never fall back to placeholder entries if a shard fails.
2. Add `/community/benefits/directory/` to both app entrypoints and static output. Display a first tab `국내 기업 검색` and an explicit CTA on the existing overview without removing `/community/benefits/` legacy deep links.
3. Write failing React tests for Korean name search, valid size filters, result pagination (<=50 DOM entries), truthful fresh/old observation date, `분류 미확인`, actual benefit-only counts and `공개 복지 정보 미확인`; no blank-reference benefit cards. Make unknown size never appear as SME. Join the 12 existing base research-action summaries by exact `KR-CRN` only.
4. Implement accessible result cards, mobile CSS and base-company detail links. Business-only rows have a dated source-facts panel and no invented benefit-detail link. Do not show raw business ID as evidence of legal corporate identity. Run focused Vitest + `npm run check`.

### Task 5: Benefit-action emphasis and expanded rights review

**Files:** Modify `community-app/src/pages/BenefitsCompanyPage.tsx`, `community-app/src/components/benefits/SourceBackedResearchGroup.tsx`, `community-app/src/styles/benefits.css`; tests under `community-app/src/components/benefits/`.

1. Write failing tests that specific individual action headlines and clear `조사 중—승인된 혜택 아님` labels precede condition/source details, and a company with no action shows `공개 복지 정보 미확인`, never `복지 없음`.
2. Implement compact action-first card UI; source URL, observed time, scope and all limitations remain accessible in expandable details. The verified count remains zero unless a distinct independent approval passes.
3. Review unpublished wave-5 candidates separately for legal owner and reuse rights. Only add eligible exact-claim paraphrases to `source-backed-benefits.jsonl`, regenerate research sibling, and run old verifier if the independent rights review yields concrete approved research-only rows. Do not pad counts from rejected/ambiguous candidates. Re-run focused UI tests.

### Task 6: Revision-bound verification and one remote handoff

**Files:** No source changes except fixes found by tests/review.

1. `python3 scripts/generate-domestic-company-directory.py --check ...` with pinned private inputs; `python3 -m unittest scripts/test_domestic_company_directory.py -q`; `node --test scripts/verify-domestic-directory-artifacts.test.mjs ...`; `cd community-app && npm run check`; `git diff --check`.
2. Run `./scripts/build-site-docker.sh "$out"` to a scratch directory with no local HTTP server, then `node scripts/verify-site.mjs "$out"`. Inspect the *exported* base 2,000, approved zero, new directory computed counts, 128 research-only or rights-reviewed revised count, and UI route. No styled browser screenshot claim without a real browser.
3. Ask independent read-only review of rights, exact legal-ID aliases, absence of false size labels, benefit actions/approval boundary, query UX and exported static artifact. Fix important findings and rerun affected checks.
4. Audit only outgoing Git diff/blobs for secrets, host-private paths, raw CSV/XLSX and false coverage claims. Squash outgoing history if any interim blob contained private host paths. Push **one** new feature branch once; read back the exact remote ref. Do not create PR, merge or deploy. Report observed companies vs benefits, dates, known gaps and source citations honestly.
