# Company Benefits v2 Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Complete auditable research for all 20,000 company-category cells and replace public GitHub correction links with a Google-authenticated request/status/admin workflow without weakening official evidence gates.

**Architecture:** Preserve the existing immutable static artifact pipeline and official claim ledger. Add explicit cell, attempt, reference, and moderated-community ledgers; require 80 complete 250-cell packages before generating vNext. Add a dedicated Supabase correction workflow behind constrained RPCs and a separate authenticated Community entry, then export approved requests into the offline research pipeline rather than mutating artifacts from the browser.

**Tech Stack:** Python 3, JSON Schema/JSONL, Node verifier, React 18, TypeScript, Vitest, Supabase Postgres/pgTAP, Jekyll, Docker.

---

### Task 1: Checkpoint approved design and baseline

**Files:**
- Create: `docs/superpowers/specs/2026-11-01-company-benefits-v2-corrections-design.md`

**Steps:**
1. Confirm branch starts at current `origin/master` and the worktree is otherwise clean.
2. Run existing focused pipeline and frontend correction tests to establish baseline.
3. Commit the approved design without production changes.

**Verification:** `git diff --check`; focused tests pass.

### Task 2: Add fail-closed 20,000-cell contracts

**Files:**
- Create: `docs/research/company-benefits/schema/company-category-cell.schema.json`
- Create: `docs/research/company-benefits/schema/research-attempt.schema.json`
- Create: `docs/research/company-benefits/schema/reference-record.schema.json`
- Create: `docs/research/company-benefits/schema/community-benefit-report.schema.json`
- Create: `docs/research/company-benefits/research-coverage-policies.json`
- Modify: `docs/research/company-benefits/schema/source.schema.json`
- Test: `scripts/tests/test_company_benefits_v2_contracts.py`

**TDD steps:**
1. Write failing tests for exact four-state enum, source tiers, currentness/scope/conflict, and required attempt receipts.
2. Verify RED with `python -m unittest scripts.tests.test_company_benefits_v2_contracts -v`.
3. Add the minimal schemas and policy.
4. Verify GREEN and run existing schema tests.
5. Commit.

### Task 3: Enforce 250 explicit cells per batch

**Files:**
- Modify: `docs/research/company-benefits/series-input-contract.md`
- Modify: `docs/research/company-benefits/schema/series-input.schema.json`
- Modify: `docs/research/company-benefits/schema/series-progress.schema.json`
- Modify: `scripts/company_benefits_series.py`
- Modify: `scripts/compile-company-benefits-series-candidate.py`
- Modify: `scripts/validate-company-benefits-series-candidate.py`
- Modify: `scripts/promote-company-benefits-series-candidate.py`
- Modify: `scripts/integrate-company-benefits-series-batch.py`
- Modify: `scripts/integrate-company-benefits-series.py`
- Tests: corresponding `scripts/tests/test_*company_benefits*` files

**TDD steps:**
1. Add RED tests rejecting missing/duplicate/substituted cells, missing attempts, copied unrelated attempts, orphan evidence, and unapproved community reports.
2. Require exact `25 companies × 10 categories` set equality and hash binding for cells/attempts/references/reports.
3. Preserve the old official claim verifier unchanged.
4. Run focused tests and real-tree dry-run verification.
5. Commit.

### Task 4: Build bounded research collectors and receipts

**Files:**
- Create: `scripts/collect-company-benefits-v2.py`
- Create: `scripts/company_benefits_collectors.py`
- Create: `scripts/tests/test_company_benefits_collectors.py`
- Modify: `.gitignore` for raw external captures only if required

**TDD steps:**
1. Add RED tests for canonical query construction, redirects, response bounds, HTTPS/private-network rejection, retry limits, and receipt hashing.
2. Implement adapters for official/company, government/regulator, recruiting/major-media, other-public-web, and community discovery routes.
3. Emit immutable external captures plus per-cell receipts; never synthesize `no_public_info` without complete policy coverage.
4. Add resumable batch checkpoints and deterministic IDs.
5. Run collectors against a small real batch probe and inspect receipts.
6. Commit.

### Task 5: Collect and review all 80 batches

**Files:**
- Create/modify: repository-external capture workspace referenced by receipts
- Create: 80 candidate packages, each containing exactly 250 cells plus bound evidence
- Integrate: `docs/research/company-benefits/company-category-cells.jsonl`
- Integrate: `docs/research/company-benefits/research-attempts.jsonl`
- Integrate: `docs/research/company-benefits/reference-records.jsonl`
- Integrate: `docs/research/company-benefits/community-benefit-reports.jsonl`

**Steps per batch (`domestic-01..40`, `international-01..40`):**
1. Run collectors for all 25 companies and 10 categories.
2. Validate exact 250-cell coverage and receipts.
3. Perform independent cell-state review; official claims retain claim-level review.
4. Promote and atomically integrate the approved package.
5. Append batch result to a machine-readable progress ledger.

**Global verification:** exactly 80 approved batches, 2,000 companies, 20,000 unique cells, no `not_researched`, exact state/source/attempt reconciliation. Do not mark complete from generated defaults.

### Task 6: Generate immutable vNext artifact from explicit cells

**Files:**
- Modify: `scripts/generate-company-benefits-artifacts.py`
- Modify: `scripts/verify-company-benefits-ledger.py`
- Modify: `scripts/verify-benefits-artifacts.mjs`
- Modify: `community-app/src/data/benefitsArtifactClient.ts`
- Modify: `community-app/src/types/benefits.ts`
- Tests: generator, verifier, client and type tests

**TDD steps:**
1. Add RED tests that missing explicit cells fail instead of falling back to `not_researched`.
2. Load the cell ledger and require exact 20,000-set equality before any output write.
3. Emit four states and reliability/currentness/scope/conflict metadata.
4. Add manifest counts and ledger hashes; create a new immutable data version.
5. Verify shard hashes, inventory, state totals, and refusal to overwrite an existing version.
6. Commit.

### Task 7: Render source tiers in search and comparison

**Files:**
- Modify: `community-app/src/components/benefits/BenefitsHeatmapTable.tsx`
- Modify: `community-app/src/components/benefits/BenefitClaimGroup.tsx`
- Modify: `community-app/src/components/benefits/CompanyCompareTray.tsx`
- Modify: `community-app/src/components/benefits/FitResultList.tsx`
- Modify: `community-app/src/lib/benefitsQueryState.ts`
- Modify: `community-app/src/styles/benefits.css`
- Tests: focused component/query/accessibility tests

**TDD steps:**
1. Add RED tests for all source/state badges, precedence, historical/scope/conflict labels, and community results in search/compare.
2. Implement without creating an aggregate welfare score.
3. Ensure official and community counts are never combined.
4. Verify responsive table/long URL behavior and accessibility.
5. Commit.

### Task 8: Add correction-request database boundary

**Files:**
- Create: `supabase/migrations/<timestamp>_benefit_correction_requests.sql`
- Create: `supabase/tests/database/benefit_corrections.test.sql`
- Modify: database test runner/config only if necessary

**TDD steps:**
1. Write pgTAP RED tests for direct-write denial, authenticated create, bounded fields, HTTPS URL, ownership, idempotency, rate limit, forged admin claim, admin queue, CAS review, immutable payload, and operator-only applied transition.
2. Add dedicated request and append-only audit tables.
3. Add constrained fixed-owner/empty-search-path RPCs.
4. Exclude email/token/provider data from every projection.
5. Run full Supabase migration and database tests.
6. Commit.

### Task 9: Add correction repository, runtime validation, and resilient draft

**Files:**
- Create: `community-app/src/types/benefitCorrections.ts`
- Create: `community-app/src/data/benefitCorrectionRepository.ts`
- Create: `community-app/src/lib/benefitCorrectionDraftStore.ts`
- Tests: colocated repository/draft tests

**TDD steps:**
1. Add RED tests for exact response keys, malformed IDs/status/timestamps, actor mismatch, bounded drafts, storage failure, stable idempotency key, and account switching.
2. Implement strict repository decoding and versioned draft storage.
3. Never persist identity, email, or tokens.
4. Preserve draft through OAuth/retry and clear only after validated success.
5. Commit.

### Task 10: Replace GitHub issue flow with authenticated request and status pages

**Files:**
- Delete: `.github/ISSUE_TEMPLATE/company-benefits-correction.yml`
- Replace: `community-app/src/components/benefits/BenefitsCorrectionLink.tsx`
- Modify: `community-app/src/pages/BenefitsCompanyPage.tsx`
- Modify: `community-app/src/pages/BenefitsMethodologyPage.tsx`
- Replace: `community-app/src/pages/BenefitsCorrectionRequests.test.tsx`
- Create: `community-app/src/pages/BenefitCorrectionPage.tsx`
- Create: `community-app/src/pages/MyBenefitCorrectionsPage.tsx`
- Modify: authenticated Community routing and Vite/Jekyll entry files
- Modify: `community-app/src/styles/benefits.css`

**TDD steps:**
1. Add RED tests for login gate, canonical return path, company/category prefill, OAuth draft preservation, submit lock, malformed success, session expiry, own status, admin response, and applied version.
2. Route protected correction pages through `AuthProvider`; keep public benefits routes auth-free.
3. Remove every GitHub issue URL/copy/template dependency.
4. Run auth/public-boundary/correction tests, typecheck, lint and build.
5. Commit.

### Task 11: Add admin correction queue

**Files:**
- Create: `community-app/src/pages/AdminBenefitCorrectionsPage.tsx`
- Create: `community-app/src/components/BenefitCorrectionQueue.tsx`
- Create: tests for admin page/queue/actions
- Modify: admin navigation/routing as appropriate

**TDD steps:**
1. Add RED tests for login/admin gates, keyset pagination, stale response suppression, CAS actions, bounded admin response, and audit visibility.
2. Implement using DB-backed `isAdmin()`, never JWT metadata.
3. Include submitted source/scope without exposing submitter email/token.
4. Run focused and full frontend tests.
5. Commit.

### Task 12: Export approved corrections into offline review

**Files:**
- Create: `scripts/export-approved-benefit-corrections.py`
- Create: `scripts/tests/test_export_approved_benefit_corrections.py`
- Modify: pipeline documentation/runbook

**TDD steps:**
1. Add RED tests for immutable snapshot export, duplicate handling, unapproved exclusion, text escaping, and artifact-version application binding.
2. Export approved requests as candidates, not direct ledger writes.
3. Require normal independent review and generation before operator-only applied marking.
4. Verify an applied version must equal a verified manifest version.
5. Commit.

### Task 13: Full integration and release gate

**Files:** all changed files; no generated `_site` output committed.

**Steps:**
1. Run all Python pipeline tests and mutation probes.
2. Run Supabase migration/pgTAP tests from a clean database.
3. Run frontend tests, typecheck, lint, and production build.
4. Run pinned Docker Jekyll+React build and static verifier.
5. Verify the generated artifact has exactly 20,000 explicit cells and ledger hashes.
6. Run browser checks only when final UI verification is requested; stop all servers afterward.
7. Dispatch independent spec/security review, then code-quality review; fix every Critical/Important finding.
8. Confirm GitHub active account and anonymous repository visibility, commit, push the feature branch once, and verify local/remote/API SHA equality. Do not create a PR, merge, or deploy.
