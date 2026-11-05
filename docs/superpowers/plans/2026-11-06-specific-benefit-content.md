# Specific Benefit Content Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make Benefit Atlas show evidence-backed benefit descriptions, and label category-only official evidence as requiring specific-benefit verification rather than presenting it as an actual benefit.

**Architecture:** Add a derived `specific_benefit_count` to every approved-v2 listing outcome and bind it to publishable reference/community statements in the company detail shard. Keep the full statement, quote, source, and limitations in detail UI; use the derived count only for list/heatmap/fit status. Official claims remain evidence records but contribute zero until their contract contains an explicit benefit description.

**Tech Stack:** Python artifact generator, Node artifact verifier, TypeScript/Zod, React, Vitest, Node test runner, Vite, Docker/Jekyll release verifier.

---

### Task 1: Define the specific-content domain contract

**Objective:** Add a shared, fail-closed definition of which evidence records contain publishable concrete benefit content.

**Files:**
- Modify: `community-app/src/types/benefits.ts`
- Test: `community-app/src/types/benefits.v2.test.ts`

**Steps:**
1. Add failing tests proving eligible reference/community statements count as specific content, official claims count as zero, and ineligible or empty statements cannot count.
2. Run `npm --prefix community-app run test -- --run src/types/benefits.v2.test.ts`; confirm the helper/count field is missing.
3. Add `specific_benefit_count: z.number().int().nonnegative()` to vNext evidenced outcomes only and export a helper that selects publishable reference/community records for one category.
4. Extend `assertCompanyDetailEvidence` so each detail category's selected record count equals the listing outcome count. Official-only and `no_public_info` outcomes must have zero.
5. Run the focused test and `npm --prefix community-app run typecheck`.
6. Commit: `feat: define specific benefit content contract`.

### Task 2: Generate truthful per-cell counts

**Objective:** Derive listing counts from canonical detail evidence without parsing or inventing benefit names.

**Files:**
- Modify: `scripts/generate-company-benefits-artifacts.py`
- Test: `scripts/tests/test_generate_company_benefits_artifacts.py`

**Steps:**
1. Add failing projection tests for a reference statement count, community statement count, official-only zero, and no-public-info zero.
2. Run the exact new pytest cases and confirm generated outcomes lack or misstate the field.
3. In projection generation, compute the count from the records actually emitted into each company detail shard after eligibility filtering.
4. Do not derive content from category names, source titles, or supporting quotes; do not count official claims.
5. Regenerate fixture projection and assert listing/detail parity.
6. Commit: `feat: derive specific benefit counts`.

### Task 3: Enforce listing/detail parity in the release verifier

**Objective:** Ensure a rebound listing cannot claim concrete benefits that its detail shard does not contain.

**Files:**
- Modify: `scripts/verify-benefits-artifacts.mjs`
- Test: `scripts/verify-benefits-artifacts.test.mjs`

**Steps:**
1. Add failing mutations for inflated count, official-only count > 0, removed statement record, and cross-category statement count.
2. Run `node --test scripts/verify-benefits-artifacts.test.mjs`; verify RED for the intended mutations.
3. Reuse the detail evidence inventory and eligibility/source closure checks to derive per-category specific counts and compare them exactly to listing outcomes.
4. Keep current evidence/source/cell/company bindings intact.
5. Run verifier tests and commit: `fix: verify specific benefit inventory`.

### Task 4: Render concrete benefit cards in company detail

**Objective:** Put the actual evidence statement ahead of category labels and raw evidence metadata.

**Files:**
- Modify: `community-app/src/components/benefits/BenefitV2EvidenceGroup.tsx`
- Modify: `community-app/src/pages/BenefitsCompanyPage.tsx`
- Modify: relevant Community CSS file owning `.benefits-evidence`
- Test: `community-app/src/components/benefits/BenefitsV2Rendering.test.tsx`

**Steps:**
1. Add failing accessible UI tests for reference and community statements under `확인된 복지 혜택`.
2. Add a failing test that an official-only category displays `구체 혜택 확인 필요` and is not counted as a confirmed benefit.
3. Run the focused rendering test and confirm RED.
4. Render one card per specific evidence record with category, statement, evidence tier, limitations, supporting quote where available, and safe source link.
5. Render official-only evidence separately as verification context with the explicit missing-content warning.
6. Add restrained responsive styling without changing the shared shell.
7. Run focused tests, typecheck, and lint. Commit: `feat: show evidence-backed benefit details`.

### Task 5: Correct list, heatmap, fit, and comparison semantics

**Objective:** Stop category state from implying a concrete benefit where the derived count is zero.

**Files:**
- Modify: `community-app/src/components/benefits/BenefitsHeatmapTable.tsx`
- Modify: `community-app/src/components/benefits/FitResultList.tsx`
- Modify: `community-app/src/components/benefits/CompanyCompareTray.tsx`
- Modify: `community-app/src/lib/benefitsQueryState.ts` if filtering currently equates evidence with content
- Test: relevant component/query tests under `community-app/src/components/benefits/` and `community-app/src/lib/`

**Steps:**
1. Add failing tests proving count > 0 renders `혜택 내용 확인`, count 0 with evidence renders `구체 혜택 확인 필요`, and no-public-info/pending labels remain distinct.
2. Confirm RED with focused Vitest commands.
3. Add one shared label/helper for specific-content status; do not duplicate state logic in components.
4. In compare detail, show full statement text through disclosure controls rather than truncating it.
5. Ensure fit ranking does not treat category-only official evidence as a concrete benefit match.
6. Run focused tests and commit: `fix: distinguish evidence from benefit content`.

### Task 6: Regenerate and audit the canonical projection

**Objective:** Publish truthful counts across the real 950-company projection.

**Files:**
- Regenerate: `community-app/public/data/company-benefits/manifest.json`
- Regenerate: `community-app/public/data/company-benefits/approved-v2-projection-2026-11-06/**`

**Steps:**
1. Generate into a scratch directory using the reviewed receipts and current tracked base artifact.
2. Run the artifact verifier before replacing tracked files.
3. Programmatically reconcile 950 companies, 9,500 cells, each listing/detail specific count, count-by-tier, and official-only warning count.
4. Replace only the manifest-declared artifact tree, verify zero symlinks and exact inventory, then commit: `feat: publish specific benefit inventory`.

### Task 7: Full review and release verification

**Objective:** Prove the implementation and final static artifact are safe and complete.

**Files:**
- Review cumulative diff from `7edb9c7430e63c975e53d0f661278c4500f1b6bb` to final HEAD.

**Steps:**
1. Run Community full tests, typecheck, lint, and Vite build.
2. Run all Node script tests and Python focused generator tests.
3. Request independent spec review; fix every Critical/Important finding.
4. Request independent quality/security review; fix every Critical/Important finding.
5. Build with `scripts/build-site-docker.sh` to a scratch output and run `scripts/verify-site.mjs` on that exported directory.
6. Verify source/exported manifest hashes match, repository is clean, and no local server or deployment was started.
7. Commit any gate-only fixes.
8. Before GitHub write, recheck actor/repository visibility and remote branch expected head. Push the feature branch once only if the user asks and the preflight policy allows it; do not create a PR, merge, or deploy.
