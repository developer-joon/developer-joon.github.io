# Benefit Atlas UI and Post Cleanup Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Rebrand the company-benefits product as Benefit Atlas, add a native full-width banner and clearer authenticated correction flow, and remove blog sections/posts that contain no meaningful benefit evidence.

**Architecture:** Keep the existing React/Jekyll shell and Supabase correction workflow. Introduce one presentational Benefit Atlas hero plus a safe local SVG asset, then add deterministic curation to the existing Python post renderer so blog output is derived from evidence-bearing entries while research ledgers remain untouched.

**Tech Stack:** React 19, TypeScript, CSS, Vitest/Testing Library, Jekyll data/posts, Python stdlib renderer/tests, existing site/release verifiers.

---

### Task 1: Establish isolated baseline

**Objective:** Confirm the isolated branch starts clean and identify the exact focused test commands.

**Files:**
- Read: `community-app/package.json`
- Read: `scripts/tests/test_render_company_benefits_posts.py`

**Step 1:** Install frontend dependencies with `npm ci` in `community-app` if `node_modules` is absent.

**Step 2:** Run `npm test -- --run src/App.benefits.test.tsx src/components/AppHeader.test.tsx src/styles/siteIntegration.test.ts`.

**Step 3:** Run `python -m unittest scripts.tests.test_render_company_benefits_posts`.

**Step 4:** Record any pre-existing failure before modifying production files.

### Task 2: Rebrand the global menu and explorer shell

**Objective:** Replace every user-facing menu/page brand label with `Benefit Atlas` while preserving route and active-state behavior.

**Files:**
- Modify: `_data/settings.yml`
- Modify: `community-app/src/components/AppHeader.tsx`
- Modify: `community-app/src/components/benefits/BenefitsExplorerShell.tsx`
- Test: `community-app/src/components/AppHeader.test.tsx`
- Test: `community-app/src/App.benefits.test.tsx`
- Test: `community-app/src/styles/siteIntegration.test.ts`

**Step 1: Write failing tests**

Update assertions to require `Benefit Atlas`, reject `기업 복지 탐색기`, and preserve `aria-current="page"` on all `/community/benefits/*` routes.

**Step 2: Verify RED**

Run:
```bash
npm test -- --run src/App.benefits.test.tsx src/components/AppHeader.test.tsx src/styles/siteIntegration.test.ts
```
Expected: FAIL because production labels are still Korean.

**Step 3: Implement minimal change**

Change only the menu/header/H1 labels. Keep internal Korean tabs unchanged.

**Step 4: Verify GREEN**

Run the same command; expected PASS.

**Step 5: Commit**

```bash
git add _data/settings.yml community-app/src/components/AppHeader.tsx community-app/src/components/benefits/BenefitsExplorerShell.tsx community-app/src/App.benefits.test.tsx community-app/src/components/AppHeader.test.tsx community-app/src/styles/siteIntegration.test.ts
git commit -m "feat: rebrand benefits explorer as Benefit Atlas"
```

### Task 3: Add the Benefit Atlas full-width banner

**Objective:** Add a responsive, accessible, site-native hero without changing header geometry.

**Files:**
- Create: `images/community/benefit-atlas.svg`
- Modify: `community-app/src/components/benefits/BenefitsExplorerShell.tsx`
- Modify: `community-app/src/styles/benefits.css`
- Test: `community-app/src/App.benefits.test.tsx`
- Test: `community-app/src/styles/siteIntegration.test.ts`

**Step 1: Write failing tests**

Require:
- one `h1` named `Benefit Atlas` inside `.benefit-atlas-hero`;
- local `/images/community/benefit-atlas.svg` usage;
- no script, event handler, `foreignObject`, text, entity, or external reference in the SVG;
- manifest version facts inside the hero when available;
- wrapper and mobile CSS contracts, including `word-break: keep-all` and no horizontal overflow.

**Step 2: Verify RED**

Run the focused tests; expected FAIL because the hero and asset do not exist.

**Step 3: Implement minimal hero**

Move heading/version markup into a full-bleed section outside the constrained workspace content. Use an inner wrapper matching site breakpoints. Add a decorative local SVG with no embedded text or external resources.

**Step 4: Verify GREEN**

Run focused tests and `npm run typecheck`; expected PASS.

**Step 5: Commit**

```bash
git add images/community/benefit-atlas.svg community-app/src/components/benefits/BenefitsExplorerShell.tsx community-app/src/styles/benefits.css community-app/src/App.benefits.test.tsx community-app/src/styles/siteIntegration.test.ts
git commit -m "feat: add Benefit Atlas evidence banner"
```

### Task 4: Clarify the internal correction workflow

**Objective:** Make the existing Google/Supabase correction form obvious and explicitly separate review approval from publication.

**Files:**
- Modify: `community-app/src/pages/BenefitCorrectionPage.tsx`
- Modify: `community-app/src/pages/BenefitsMethodologyPage.tsx`
- Modify: `community-app/src/pages/BenefitsCompanyPage.tsx`
- Modify: `community-app/src/styles/benefits.css`
- Test: `community-app/src/pages/BenefitsCorrectionRequests.test.tsx`
- Test: `community-app/src/App.benefits.test.tsx`
- Test: `community-app/src/styles/siteIntegration.test.ts`

**Step 1: Write failing tests**

Require:
- CTA label `정보 수정 요청` links only to `/community/benefits/correction/`;
- no GitHub issue URL/copy/template reference in assembled source;
- login gate explains Google login and same-site return;
- form warns against personal/private/authenticated/paid material;
- form states approval does not immediately change public data;
- submitted view links to `내 수정 요청`.

**Step 2: Verify RED**

Run:
```bash
npm test -- --run src/pages/BenefitsCorrectionRequests.test.tsx src/App.benefits.test.tsx src/styles/siteIntegration.test.ts
```
Expected: FAIL on the new copy/CTA contract.

**Step 3: Implement minimal copy/layout change**

Reuse existing auth, draft storage, repository, RPC and routes. Do not add a second mutation path or new authentication logic.

**Step 4: Verify GREEN**

Run focused tests, typecheck, and lint; expected PASS.

**Step 5: Commit**

```bash
git add community-app/src/pages/BenefitCorrectionPage.tsx community-app/src/pages/BenefitsMethodologyPage.tsx community-app/src/pages/BenefitsCompanyPage.tsx community-app/src/styles/benefits.css community-app/src/pages/BenefitsCorrectionRequests.test.tsx community-app/src/App.benefits.test.tsx community-app/src/styles/siteIntegration.test.ts
git commit -m "feat: clarify Benefit Atlas correction workflow"
```

### Task 5: Define evidence-bearing blog curation

**Objective:** Make the renderer distinguish meaningful benefit entries from metadata/gap-only sections.

**Files:**
- Modify: `scripts/render-company-benefits-posts.py`
- Modify: `scripts/tests/test_render_company_benefits_posts.py`

**Step 1: Write failing unit tests**

Add fixtures proving:
- a company with a concrete benefit claim/reference is retained;
- metadata plus HTTP/gap boilerplate only is removed;
- conflict/historical evidence with a bound source is retained;
- an empty batch post is omitted;
- footnote numbering is dense and orphan-free after curation;
- the hub links only to emitted posts and reports actual domestic/international counts;
- research ledger inputs are read-only and unchanged.

**Step 2: Verify RED**

Run:
```bash
python -m unittest scripts.tests.test_render_company_benefits_posts
```
Expected: FAIL because the renderer always emits 81 fixed posts and gap-only sections.

**Step 3: Implement curation**

Introduce small pure helpers such as `is_meaningful_company_entry`, `curate_batch_entries`, and `render_curated_hub`. Base inclusion on evidence records already present in renderer inputs; do not infer benefits from URL/status metadata. Return no post for an empty curated batch.

**Step 4: Verify GREEN**

Run the same unit suite; expected PASS.

**Step 5: Commit**

```bash
git add scripts/render-company-benefits-posts.py scripts/tests/test_render_company_benefits_posts.py
git commit -m "feat: curate evidence-bearing benefit posts"
```

### Task 6: Regenerate and inspect published benefit posts

**Objective:** Apply deterministic curation to the 81 generated files and remove empty posts/links.

**Files:**
- Modify/Delete: `_posts/2026-10-31-company-benefits-*.md`
- Modify: `_posts/2026-10-31-company-benefits-verified-directory-hub.md`
- Modify if needed: generated-post manifest/checksum fixtures owned by the renderer

**Step 1:** Run the renderer in its documented publication mode against the isolated repository.

**Step 2:** Run a programmatic audit that asserts:
- every emitted batch post has at least one concrete benefit entry;
- forbidden repeated gap-only prose is absent;
- every hub link target exists;
- no deleted post is referenced;
- footnotes are dense and every definition is referenced;
- no non-benefits post was touched.

**Step 3:** Review deletion count and retained post count from a machine-generated report, not manually.

**Step 4:** Run `git diff --check` and the renderer unit suite.

**Step 5: Commit**

```bash
git add -A _posts scripts
git commit -m "content: remove empty company benefit posts"
```

### Task 7: Full verification and independent review

**Objective:** Prove the UI/content change is complete without starting a local server.

**Files:**
- Read/verify all changed files
- Create: `docs/verification/benefit-atlas-ui-post-cleanup.json` if the project verification convention permits tracked evidence; otherwise keep logs outside the repository.

**Step 1:** Run:
```bash
cd community-app
npm run check
npm run build
```

**Step 2:** Run:
```bash
python -m unittest scripts.tests.test_render_company_benefits_posts
node scripts/verify-site.mjs
node scripts/verify-benefits-artifacts.mjs
```

**Step 3:** Verify Jekyll settings and built React assets contain `Benefit Atlas`, internal correction routes, and no obsolete GitHub issue text.

**Step 4:** Verify the original research/canonical ledger hashes and `docs/research/company-benefits/series-progress.json` are unchanged from commit `327520c`.

**Step 5:** Request independent spec-compliance review, then code-quality review. Fix any Critical/Important finding and rerun relevant tests.

**Step 6:** Commit verification-only changes if any. Do not push, open a PR, merge, deploy, or start HTTP/dev/CDP servers.
