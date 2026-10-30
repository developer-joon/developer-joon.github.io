# Company Benefits Community Series Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build and validate an auditable source ledger plus review-ready Community drafts covering 1,000 domestic and 1,000 international large employers without claiming a complete revenue ranking.

**Architecture:** Keep research data, validation code, and publication drafts separate. Store normalized company and benefit evidence as JSONL, validate it with deterministic Python tests, render 25-company Markdown drafts from validated records, and require human approval before any Community write.

**Tech Stack:** Python 3 standard library, JSON Schema-compatible JSON documents, Markdown, existing Community editor, official company/government sources.

---

## Delivery boundaries

- This plan creates local research artifacts and review-ready drafts first.
- It does not add a Community database migration or frontend feature.
- It does not post, push, open a PR, merge, or deploy without a later explicit instruction.
- The 50-company pilot is a quality gate, not a reduction of the 2,000-company target.

### Task 0: Freeze and approve the population protocol

**Objective:** Define the candidate universe and deterministic selection rule before selecting any pilot company.

**Files:**
- Create: `docs/research/company-benefits/population-protocol.json`
- Create: `docs/research/company-benefits/population-protocol.md`
- Create: `docs/research/company-benefits/schema/population-protocol.schema.json`
- Create: `docs/research/company-benefits/population/domestic-eligible.jsonl`
- Create: `docs/research/company-benefits/population/international-eligible.jsonl`
- Create: `docs/research/company-benefits/population/domestic-selected.jsonl`
- Create: `docs/research/company-benefits/population/international-selected.jsonl`
- Create: `docs/research/company-benefits/population/freeze-manifest.json`
- Create: `docs/research/company-benefits/population/domestic-effective-selected.jsonl`
- Create: `docs/research/company-benefits/population/international-effective-selected.jsonl`
- Create: `docs/research/company-benefits/population/effective-selection-events.jsonl`
- Create: `docs/research/company-benefits/population/effective-selection-manifest.json`

**Steps:**

1. Encode the cutoff date, domestic official lists, fixed 18-country international panel, exact official candidate-list endpoints, source precedence, KRW/USD thresholds, financial-sector asset thresholds, 24-month fiscal-year limit, exchange-rate source, and public-sector treatment.
2. Define domestic/international classification by selected reporting legal entity's incorporation and registered head office; do not infer payroll-employer or benefit scope.
3. Separate selected employer, financial consolidation parent, ultimate parent, and benefit-policy owner.
4. Fix canonical SHA-256 serialization: required canonical registry ID; ISO country code; Unicode NFC; whitespace normalization; compact UTF-8 JSON array; missing-value rejection; canonical-byte tie rule; exclusion reasons; and next-hash replacement.
5. Materialize the complete official-list unions, verify each qualifying scale metric, and freeze the eligible domestic and international ledgers.
6. Generate and freeze exactly 1,000 selected records per scope from the canonical hash order; initialize each effective-selected ledger as a byte-identical projection and record both hashes.
7. Record country-level `coverage_gap` values and refuse to imply global representativeness.
8. Obtain explicit approval for the protocol, eligible-ledger, immutable selected-ledger, initial effective-selected, and both manifest hashes before pilot selection; any later rule change creates a new version and full reselection.
9. Commit with `docs(research): freeze company benefits population protocol`.

### Task 1: Define machine-readable research schemas

**Objective:** Make company selection, benefit claims, sources, exclusions, and corrections structurally testable.

**Files:**
- Create: `docs/research/company-benefits/schema/company.schema.json`
- Create: `docs/research/company-benefits/schema/benefit-claim.schema.json`
- Create: `docs/research/company-benefits/schema/source.schema.json`
- Create: `docs/research/company-benefits/schema/correction.schema.json`
- Create: `docs/research/company-benefits/schema/review.schema.json`
- Create: `scripts/verify-company-benefits-ledger.py`
- Create: `scripts/tests/test_verify_company_benefits_ledger.py`

**Steps:**

1. Write failing tests for required identifiers, legal-entity classification, scale metric type/value/currency/band, evidence grades, conditional source requirements by status, freshness dates, source locators/hashes, access and licensing decisions, application scope, duplicate IDs, parent/subsidiary rules, reviewer separation, canonical selection hashes, and frozen-protocol hashes.
2. Run `python -m unittest scripts.tests.test_verify_company_benefits_ledger -v`; expect failures because the verifier is absent.
3. Implement schemas and the minimal standard-library verifier.
4. Run the focused unit test; expect all tests to pass.
5. Run `git diff --check`.
6. Commit with `test(research): define company benefits ledger contracts`.

### Task 2: Create candidate-source registry and methodology

**Objective:** Record which official sources may establish company size, identity, ownership, headquarters, and benefit evidence.

**Files:**
- Create: `docs/research/company-benefits/source-registry.jsonl`
- Create: `docs/research/company-benefits/methodology.md`
- Modify: `scripts/tests/test_verify_company_benefits_ledger.py`

**Steps:**

1. Add failing fixtures for missing source owner, source type, jurisdiction, access date, terms URL, extraction/quotation/retention/snapshot/attribution decisions, source locator, supporting quote, content hash, and supported fields.
2. Add domestic sources: Open DART, Fair Trade Commission business groups, ALIO, Cleaneye, and official corporate reports.
3. Add international sources only from the protocol's fixed country panel: government/regulator lists, official filings, public-enterprise disclosures, and publicly accessible official corporate reports.
4. Mark commercial/editorial lists and search results as discovery-only and ineligible to prove identity, scale, selection, or benefit claims.
5. Reject a source from evidence use when required extraction, quotation, retention, or attribution terms are unknown or incompatible.
6. Verify URLs with a recorded HTTP status, redirect chain, content type, final owner/domain, access-wall state, and expected document marker. An archive passes only when archiving and evidence use are lawful and the original owner/title are recorded.
7. Commit with `docs(research): add company benefits source registry`.

### Task 3: Build deterministic batch and draft renderer

**Objective:** Generate stable 25-company draft files from validated ledger entries without treating processing order as a ranking.

**Files:**
- Create: `scripts/render-company-benefits-drafts.py`
- Create: `scripts/tests/test_render_company_benefits_drafts.py`
- Create: `docs/research/company-benefits/templates/hub.md`
- Create: `docs/research/company-benefits/templates/batch.md`

**Steps:**

1. Write failing tests for stable `batch_id`, exactly 25 companies per complete batch, domestic/international separation, required disclaimers, sources, correction policy, and `확인 불가` wording.
2. Implement the minimal renderer.
3. Generate drafts twice and assert byte-for-byte equality.
4. Verify that no text calls `selection_order` a revenue rank.
5. Commit with `feat(research): add deterministic benefits draft renderer`.

### Task 4: Research the 50-company pilot candidate set

**Objective:** Select 25 domestic and 25 international companies with independently verifiable scale and identity evidence.

**Files:**
- Create: `docs/research/company-benefits/pilot/companies.jsonl`
- Create: `docs/research/company-benefits/pilot/selection-log.jsonl`
- Create: `docs/research/company-benefits/pilot/exclusions.jsonl`
- Read: `docs/research/company-benefits/population/domestic-selected.jsonl`
- Read: `docs/research/company-benefits/population/international-selected.jsonl`
- Read: `docs/research/company-benefits/population/domestic-eligible.jsonl`
- Read: `docs/research/company-benefits/population/international-eligible.jsonl`
- Read: `docs/research/company-benefits/population/freeze-manifest.json`
- Modify: `docs/research/company-benefits/population/domestic-effective-selected.jsonl`
- Modify: `docs/research/company-benefits/population/international-effective-selected.jsonl`
- Modify: `docs/research/company-benefits/population/effective-selection-events.jsonl`
- Modify: `docs/research/company-benefits/population/effective-selection-manifest.json`

**Steps:**

1. Verify both immutable `*-selected.jsonl` files against `freeze-manifest.json`, verify both `*-effective-selected.jsonl` files against `effective-selection-manifest.json`, then consume exactly the first 25 effective records per scope; never filter the eligible ledger or add companies during pilot research.
2. Normalize selected employer legal entity, registered head office, financial consolidation parent, ultimate parent, benefit-policy owner, source year, financial scope, original scale metric, currency, and official size-source URL.
3. Enforce the legal-entity and related-company rules; parent and subsidiary may coexist only with separate qualifying size and entity-specific benefit evidence.
4. If one of those 25 records is invalid, halt the pilot, append an exclusion/replacement event containing the previous effective hash, select the next unused hash from the corresponding frozen eligible ledger, regenerate that scope's effective-selected projection, and approve the new manifest hash before continuing; never mutate the original selected ledger or substitute a company ad hoc.
5. Run the ledger verifier and independently review all exclusions and replacements.
6. Commit with `data(research): add company benefits pilot companies`.

### Task 5: Research pilot benefit evidence

**Objective:** Record claim-level official evidence and application scope for all 50 pilot companies.

**Files:**
- Create: `docs/research/company-benefits/pilot/benefit-claims.jsonl`
- Create: `docs/research/company-benefits/pilot/sources.jsonl`
- Create: `docs/research/company-benefits/pilot/research-log.md`

**Steps:**

1. Search lawfully public official benefit, careers, annual, ESG, collective agreement, and government disclosure sources for each company; never retain leaked, authenticated-only, or privately supplied documents.
2. Store one normalized claim per evidenced benefit. Require at least one A/B source for confirmed, limited, past, or name-only status and at least two conflicting A/B sources for conflict status.
3. Record country, selected reporting legal entity, separately evidenced payroll employer and policy owner when known, role, employment type, tenure condition, source title/owner, page or section locator, supporting quote, publication date, access timestamp, content hash, terms decision, and validity status.
4. When no official evidence is found, store a non-claim `확인 불가` research-result record with searched official source IDs and scope; do not require an A/B claim source and never infer absence.
5. Apply the 24-month dated-source rule, 30-day undated-page check, and 14-day pre-publication recheck.
6. Have a reviewer other than the original researcher record reviewed claim IDs, entailment decision, stale-document finding, overgeneralization, conflict, resolution, and approval state.
7. Run the verifier and commit with `data(research): add pilot benefit evidence`.

### Task 6: Generate and review the hub plus two pilot drafts

**Objective:** Produce review-ready Markdown without writing to the live Community.

**Files:**
- Create: `docs/research/company-benefits/drafts/hub.md`
- Create: `docs/research/company-benefits/drafts/domestic-01.md`
- Create: `docs/research/company-benefits/drafts/international-01.md`
- Create: `docs/research/company-benefits/pilot/review-report.md`

**Steps:**

1. Render drafts from the validated pilot ledger.
2. Verify 25 distinct companies in each batch.
3. Check every factual statement against its attached source.
4. Check Korean copy for false ranking implications and unsupported generalization.
5. Record counts for each evidence grade and status, unresolved conflicts, and average research effort.
6. Commit with `docs(community): add company benefits pilot drafts`.

### Task 7: Evaluate pilot operations without changing selection

**Objective:** Use pilot evidence to estimate effort and improve the evidence workflow without tuning the approved population to observed results.

**Files:**
- Create: `docs/research/company-benefits/calibration.md`
- Modify: `docs/research/company-benefits/methodology.md`
- Modify: `scripts/tests/test_verify_company_benefits_ledger.py`

**Steps:**

1. Measure source coverage and `확인 불가` rate by scope and source type.
2. Measure research time, review effort, stale-source rate, licensing rejection rate, and unresolved conflicts.
3. Keep thresholds, country panel, source precedence, financial/public-sector rules, seed, and replacements unchanged.
4. Add regression fixtures for workflow defects discovered by the pilot.
5. If population rules must change, stop, create a new protocol version, re-freeze the full candidate ledger, obtain approval, and rerun the pilot selection.
6. Require explicit user review before collecting the remaining 1,950 companies.
7. Commit with `docs(research): calibrate company benefits selection`.

### Task 8: Expand company ledgers to 1,000 per scope

**Objective:** Produce two protocol-bounded, deduplicated, reproducible company samples.

**Files:**
- Create: `docs/research/company-benefits/data/domestic-companies.jsonl`
- Create: `docs/research/company-benefits/data/international-companies.jsonl`
- Create: `docs/research/company-benefits/data/exclusions.jsonl`
- Create: `docs/research/company-benefits/data/replacements.jsonl`

**Steps:**

1. Read only the latest approved effective-selected ledgers and verify their hashes against `effective-selection-manifest.json`; separately verify the immutable originals against the freeze manifest.
2. Replay `effective-selection-events.jsonl` from the original selected ledgers and require byte-identical effective-selected projections before any enrichment.
3. Enrich effective-selected records in 100-company research batches while writing each batch durably before continuing.
4. Validate after every batch and stop on protocol/effective-hash drift, duplicate employer, missing official size evidence, illegal related-company inclusion, stale fiscal year, or scope mismatch.
5. Run an independent reconciliation after 500 and 1,000 companies per scope.
6. Recompute the baseline selection and effective projection, then assert exactly 1,000 unique effective companies in each scope.
7. Commit each completed and reviewed 100-company batch separately.

### Task 9: Research and render the remaining 78 batches

**Objective:** Produce all 80 detailed drafts with official claim-level evidence.

**Files:**
- Create: `docs/research/company-benefits/data/benefit-claims-*.jsonl`
- Create: `docs/research/company-benefits/data/sources-*.jsonl`
- Create: `docs/research/company-benefits/drafts/domestic-02.md` through `domestic-40.md`
- Create: `docs/research/company-benefits/drafts/international-02.md` through `international-40.md`

**Steps for each 25-company batch:**

1. Research official sources and write claim records.
2. Validate schema, evidence grade, status, applicability, and dates.
3. Render one draft.
4. Run independent source-entailment and editorial reviews.
5. Correct all blocking findings and rerun verification.
6. Commit the reviewed batch.

### Task 10: Prepare controlled Community publication

**Objective:** Publish only reviewed drafts with idempotent write tracking and post-write verification.

**Files:**
- Create: `docs/research/company-benefits/publication-manifest.jsonl`
- Create: `docs/research/company-benefits/publication-runbook.md`

**Steps:**

1. Record a unique local draft ID, expected title, scope, batch ID, content hash, and publication status.
2. Obtain explicit approval for the exact hub and batch drafts to publish.
3. Create each Community post once; never retry a write blindly.
4. Read back the exact post ID, title, body hash, author, and public visibility after each write.
5. Update the hub only after every referenced batch post is verified.
6. Record corrections as append-only manifest events.
7. Stop immediately on duplicate detection, failed read-back, authorization mismatch, or unexpected content mutation.
8. Publish the prohibited-information warning, report/removal path, and moderation response. If prompt hide/delete is unavailable, omit the public call for comment tips and pause tip intake.
9. Never copy prohibited comment content into research or correction logs; retain only restricted incident metadata.

### Task 11: Final verification

**Objective:** Prove artifact completeness within the approved protocol, evidence integrity, publication state, and repository cleanliness.

**Steps:**

1. Run all research verifier and renderer tests.
2. Assert exactly 1 hub draft, 40 domestic drafts, and 40 international drafts.
3. Assert exactly 1,000 unique companies in each protocol-bounded scope and 25 per detailed draft; do not claim completeness relative to all large employers.
4. Assert every confirmed claim has lawfully public A/B evidence, required locators/hashes/licensing decisions, and freshness checks, and every unknown uses non-absence language.
5. Compare the publication manifest with live Community read-back data if publication was approved.
6. Run `npm run check` in `community-app` and `git diff --check`.
7. Report local drafts, published posts, unresolved conflicts, and excluded companies separately.
