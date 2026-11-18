# Benefit Atlas Verified Batch Release Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Fail closed on the invalid specific-benefit projection, introduce independently reviewed atomic benefit propositions, and release the first 25-KR/25-US gold set before continuing in verified 100-company checkpoints.

**Architecture:** Preserve raw evidence and active-v1 bytes, but decouple user-visible benefits into a new verified-proposition inventory. Research remains canonical 25-company/250-cell packages; publication checkpoints combine reviewed packages, with an initial 50-company gold set and later 100-company branches. Python generation, Node verification, TypeScript/Zod, React, and release checks independently derive proposition counts.

**Tech Stack:** Python 3, JSONL immutable packages, Node.js 24, TypeScript/Zod, React/Vitest, Node test runner, Vite, Docker/Jekyll artifact verification.

---

### Task 1: Record the approved design and establish the correction baseline

**Objective:** Freeze the approved batch-release contract and prove the merged projection defect from the current `origin/master`.

**Files:**
- Create: `docs/superpowers/specs/2026-11-06-benefit-atlas-verified-batch-release-design.md`
- Create: `docs/superpowers/plans/2026-11-06-benefit-atlas-verified-batch-release.md`
- Create: `scripts/audit-specific-benefit-semantics.py`
- Test: `scripts/tests/test_audit_specific_benefit_semantics.py`

**Steps:**
1. Add a failing audit test with page-dump, producer-meta, cross-category replay, duplicate proposition, and unrelated-company fixtures.
2. Run the focused pytest and confirm failure because the audit command does not exist.
3. Implement a deterministic read-only auditor that reports evidence records separately from eligible propositions and emits JSON.
4. Run it against the tracked projection and preserve the exact defect summary in a scratch receipt, not a generated production ledger.
5. Run the focused test and commit the design, plan, and audit tool.

### Task 2: Define the verified proposition schema

**Objective:** Make an independently reviewed proposition the only object that can increment a specific-benefit count.

**Files:**
- Modify: `community-app/src/types/benefits.ts`
- Modify: `community-app/src/types/benefits.v2.test.ts`
- Modify: `scripts/company-benefits-protocol-contract.json`
- Modify: `scripts/company_benefits_series.py`
- Test: `scripts/tests/test_company_benefits_v2_contracts.py`

**Steps:**
1. Add failing TypeScript and Python tests for `verified_benefits`, exact primary category, one-or-more evidence IDs, independent review receipt binding, and proposition identity.
2. Add failing tests that reject raw statement eligibility, cross-category replay, duplicate logical propositions, reviewer/candidate hash mismatch, and evidence from another company.
3. Run focused tests and verify RED for missing proposition contracts.
4. Implement the minimal disjoint contract version; reject mixed old/new specific-content formats.
5. Export shared helpers that derive counts only from independently reviewed propositions.
6. Run focused tests, typecheck, and commit.

### Task 3: Make the client fail closed on legacy specific content

**Objective:** Stop rendering or counting existing reference/community statements as verified benefits.

**Files:**
- Modify: `community-app/src/types/benefits.ts`
- Modify: `community-app/src/components/benefits/BenefitV2EvidenceGroup.tsx`
- Modify: `community-app/src/components/benefits/BenefitsHeatmapTable.tsx`
- Modify: `community-app/src/components/benefits/FitResultList.tsx`
- Modify: `community-app/src/components/benefits/CompanyCompareTray.tsx`
- Test: `community-app/src/types/benefits.v2.test.ts`
- Test: `community-app/src/components/benefits/BenefitsV2Rendering.test.tsx`

**Steps:**
1. Add failing tests proving a legacy nonblank statement yields zero benefits and renders `구체 혜택 재검증 중`.
2. Add failing tests distinguishing `research_incomplete`, `source_access_failed`, `conflicting_evidence`, and `not_publicly_verifiable`.
3. Run focused Vitest tests and verify RED.
4. Replace `specificBenefitRecords` with proposition-based selection; render raw evidence only in a clearly labeled evidence context section.
5. Ensure fit and comparison do not rank evidence-only cells as benefit matches.
6. Run focused tests, typecheck, lint, and commit.

### Task 4: Generate a zero-inflation emergency correction artifact

**Objective:** Regenerate the 950-company projection so unreviewed legacy evidence contributes zero verified benefits without deleting audit evidence.

**Files:**
- Modify: `scripts/generate-company-benefits-artifacts.py`
- Modify: `scripts/tests/test_generate_company_benefits_artifacts.py`
- Regenerate: `community-app/public/data/company-benefits/manifest.json`
- Regenerate: `community-app/public/data/company-benefits/approved-v2-projection-2026-11-06/**`

**Steps:**
1. Add failing generator tests for empty verified inventory, all-zero specific counts, raw-evidence preservation, and conservative `research_incomplete` downgrade.
2. Run focused pytest cases and verify RED.
3. Generate proposition inventory and counts independently of raw evidence record counts.
4. Regenerate into scratch, verify exact inventory, then replace only manifest-declared projection files.
5. Programmatically assert 950 projected companies, 9,500 cells, zero unreviewed proposition counts, raw evidence preservation, and byte-identical active-v1 files.
6. Commit the emergency artifact correction.

### Task 5: Independently verify proposition and release-checkpoint semantics

**Objective:** Prevent any producer or client mutation from inflating benefit counts or composing invalid checkpoints.

**Files:**
- Modify: `scripts/verify-benefits-artifacts.mjs`
- Modify: `scripts/verify-benefits-artifacts.test.mjs`
- Create: `scripts/verify-benefit-release-checkpoint.py`
- Create: `scripts/tests/test_verify_benefit_release_checkpoint.py`

**Steps:**
1. Add failing mutations for page-dump promotion, meta-statement promotion, duplicate-source inflation, proposition replay, cross-category reuse, company mismatch, review hash mismatch, mixed contract versions, and copied 25-company batches.
2. Add failing checkpoint tests for any union other than exact 2-batch gold set or exact 4-batch/100-company normal release.
3. Run Node and pytest tests and verify RED.
4. Implement independent proposition derivation and exact batch-union checks before any artifact write.
5. Run real-tree verification against the corrected projection and commit.

### Task 6: Compile immutable 25-company reviewed packages

**Objective:** Extend the existing candidate pipeline so each 25-company batch can carry reviewed atomic propositions and truthful unresolved states.

**Files:**
- Modify: `scripts/compile-company-benefits-series-candidate.py`
- Modify: `scripts/validate-company-benefits-series-candidate.py`
- Modify: `scripts/promote-company-benefits-series-candidate.py`
- Modify: `scripts/integrate-company-benefits-series-batch.py`
- Test: `scripts/tests/test_company_benefits_candidate_pipeline.py`
- Test: `scripts/tests/test_integrate_company_benefits_series_batch.py`

**Steps:**
1. Add failing end-to-end fixtures for one verified proposition with two sources, evidence-only context, unresolved access failure, and bounded nonverification.
2. Verify RED at compiler/validator/promotion boundaries.
3. Implement canonical proposition IDs, package-relative source closure, independent review receipt binding, and post-merge collision checks.
4. Require exact 25 companies and 250 canonical cells per research package.
5. Verify package-only reproducibility and complete `SHA256SUMS` equality.
6. Run focused suites and commit.

### Task 7: Build and review the 50-company gold set

**Objective:** Reacquire and independently review `domestic-01` and `international-01` under the new proposition contract.

**Files:**
- External immutable acquisition packages for `domestic-01` and `international-01`
- Repository promoted ledgers only after external review approval
- Generated gold-set projection files under a new immutable data version

**Steps:**
1. Pin the exact clean canonical SHA and exact 25-company membership for each batch.
2. Run official-first acquisition for all 500 cells, retaining exact source bodies and terminal route receipts.
3. Extract atomic proposition candidates without self-approval.
4. Dispatch independent reviewers over disjoint company IDs; reconcile exact 500-cell union, quote verbatimness, legal entity, category, scope, currentness, and duplicates.
5. Compile, validate, and promote only exact approved bytes; keep failures as explicit unresolved states.
6. Generate the 50-company gold-set checkpoint and verify exact 25 KR + 25 US membership.
7. Commit gold-set ledgers and artifacts.

### Task 8: Run the full release gate and push the branch once

**Objective:** Deliver a verified branch without PR, merge, or deployment.

**Files:**
- Review all changes from `origin/master` to final HEAD.

**Steps:**
1. Run all focused Python, Node, and Community tests.
2. Run Community full test, typecheck, lint, and production build.
3. Run artifact verifier, checkpoint verifier, deterministic regeneration, and active-v1 byte-preservation checks.
4. Obtain independent spec compliance review, then independent quality/security review; fix every Critical/Important finding and re-review.
5. Build the static site through the repository Docker release path and verify the exported artifact.
6. Confirm no persistent local HTTP/dev/CDP server remains.
7. Verify GitHub actor, anonymous repository visibility, expected remote base, and branch absence/expected old SHA.
8. Push `fix/benefit-atlas-verified-batch-release` once; read back the exact remote SHA through git and authenticated/anonymous GitHub endpoints.
9. Report push, PR, merge, and deployment states separately.

### Task 9: Start the first normal 100-company checkpoint

**Objective:** Continue collection after the gold set without reusing the merged branch.

**Files:**
- New branch from the gold-set merge commit
- Four immutable 25-company packages selected from the canonical residual backlog

**Steps:**
1. After the user merges the gold-set branch, fetch and verify the merge on `origin/master`.
2. Create a new range-named branch from that exact SHA.
3. Select four disjoint canonical 25-company batches with an exact 100-company union.
4. Repeat acquisition, independent review, promotion, artifact generation, and release verification.
5. Push the new branch once and stop before PR/merge/deployment.
