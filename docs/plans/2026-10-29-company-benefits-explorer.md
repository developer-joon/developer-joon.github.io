# Company Benefits Explorer Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Ship a fixture-backed, production-quality vertical slice of the three approved public benefits explorer screens and company detail inside the existing static Community React application.

**Architecture:** Add static multi-page entries under `/community/benefits/`, a strict read-only artifact client, URL-owned shared explorer state, and lazy React pages. Use clearly labelled fixture artifacts until approved research data exists; do not add Supabase tables or RPCs.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Vitest, Testing Library, Zod 4, existing Community CSS/token system.

---

## Task 1: Add static entries and route resolution

**Files:**
- Create: `community-app/benefits/index.html`
- Create: `community-app/benefits/rankings/index.html`
- Create: `community-app/benefits/fit/index.html`
- Create: `community-app/benefits/company/index.html`
- Modify: `community-app/vite.config.ts`
- Modify: `community-app/src/App.tsx`
- Modify: `community-app/src/App.test.tsx`

**TDD:** Add failing route tests for all four paths and lazy fallbacks; verify failure; implement entries and routes; verify focused tests pass.

## Task 2: Define fixture artifacts and strict artifact client

**Files:**
- Create: `community-app/public/data/company-benefits/fixture-v1/manifest.json`
- Create: `community-app/public/data/company-benefits/fixture-v1/company-index.json`
- Create: `community-app/public/data/company-benefits/fixture-v1/rankings.json`
- Create: `community-app/public/data/company-benefits/fixture-v1/details/companies.json`
- Create: `community-app/src/types/benefits.ts`
- Create: `community-app/src/data/benefitsArtifactClient.ts`
- Create: `community-app/src/data/benefitsArtifactClient.test.ts`

**TDD:** First test strict schemas, exact counts, enums, unsafe URLs, version mismatches, malformed scores and unknown records; then implement the minimal client. Fixture company names must be fictional and every page must expose `예시 데이터`.

## Task 3: Implement normalized shared URL state and scoring helpers

**Files:**
- Create: `community-app/src/lib/benefitsQueryState.ts`
- Create: `community-app/src/lib/benefitsQueryState.test.ts`
- Create: `community-app/src/lib/benefitsScoring.ts`
- Create: `community-app/src/lib/benefitsScoring.test.ts`

**TDD:** Cover query truncation, enums, max four comparison IDs, page bounds, tab round trips, custom weight bounds, ranking component sum verification, unknown-as-unscored, fit-data-insufficient behavior, and deterministic ties.

## Task 4: Build the shared explorer shell and heatmap

**Files:**
- Create: `community-app/src/pages/BenefitsExplorerPage.tsx`
- Create: `community-app/src/pages/BenefitsExplorerPage.test.tsx`
- Create: `community-app/src/components/benefits/BenefitsExplorerShell.tsx`
- Create: `community-app/src/components/benefits/BenefitsFilterPanel.tsx`
- Create: `community-app/src/components/benefits/BenefitsHeatmapTable.tsx`
- Create: `community-app/src/components/benefits/CompanyCompareTray.tsx`
- Create: `community-app/src/styles/benefits.css`
- Modify: `community-app/src/main.tsx`

**TDD:** Cover fixture badge, three tabs, status text plus non-color labels, scope/search/status/category filters, 50-row pagination contract, comparison max, URL preservation, loading/fail-closed/empty states, table semantics and keyboard links.

## Task 5: Build category rankings and fit screens

**Files:**
- Create: `community-app/src/pages/BenefitsRankingsPage.tsx`
- Create: `community-app/src/pages/BenefitsRankingsPage.test.tsx`
- Create: `community-app/src/pages/BenefitsFitPage.tsx`
- Create: `community-app/src/pages/BenefitsFitPage.test.tsx`
- Create: `community-app/src/components/benefits/CategoryRankingList.tsx`
- Create: `community-app/src/components/benefits/FitPresetPicker.tsx`
- Create: `community-app/src/components/benefits/FitResultList.tsx`

**TDD:** Require a category before ranking, show four score components, separate insufficient-evidence companies, call fit output `조건 일치 기업`, preserve query state across tabs, and never score unknown categories as zero.

## Task 6: Build company evidence detail

**Files:**
- Create: `community-app/src/pages/BenefitsCompanyPage.tsx`
- Create: `community-app/src/pages/BenefitsCompanyPage.test.tsx`
- Create: `community-app/src/components/benefits/CompanyEvidenceHeader.tsx`
- Create: `community-app/src/components/benefits/BenefitClaimGroup.tsx`
- Create: `community-app/src/components/benefits/OfficialSourceList.tsx`

**TDD:** Cover missing/unknown ID, fictional fixture disclosure, legal entity and applicability fields, claim status, source title/date/grade, HTTPS external link safety, unknown-not-absence wording, and return links preserving filters.

## Task 7: Integrate build and release verification

**Files:**
- Modify: `scripts/community-snapshots.mjs`
- Modify: `scripts/community-snapshots.test.mjs`
- Modify: `scripts/verify-site.mjs`
- Modify: `scripts/verify-site.test.mjs`
- Modify: `scripts/fixtures/community-snapshots.json`

**TDD:** Add failing artifact tests for four HTML entries, fixture JSON payloads, titles/canonicals/assets, then update generators/verifiers. Verify existing Community and Jekyll routes remain unchanged.

## Task 8: Responsive and accessibility acceptance

**Verification:**
- `npm run check` in `community-app`
- `npm run build` in `community-app`
- relevant Node script tests
- `./scripts/build-site-docker.sh`
- artifact verifier
- desktop/tablet/mobile browser checks only after user requested result UI
- no server left running
- `git diff --check`

**Acceptance:** Three tabs and company detail work from direct static URLs; fixture status is unmistakable; no composite best-company claim; unknown is not negative; static artifacts are strict and version-consistent; current Community regression suite passes.
