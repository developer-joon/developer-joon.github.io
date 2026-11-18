# Three-country employer research pilot implementation plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task, with a neutral scope/count check before integration. Research inputs are never approvals.

**Goal:** Measure whether KR, US and JP can each supply 100 distinct, officially identified *discovery* candidates with separately evidenced current operation and employee status; never fabricate the 100-row quota or expand the frozen 2,000 series.

**Architecture:** Keep official-source download metadata and candidate/worker observations in restricted private custody. Add one versioned audit-only pilot contract with exact set-difference, immutable assignment, source-status and rights guards. Only bounded quote-free approved fields may enter the tracked repository. The 30,000 target remains an unverified long-term ceiling until the pilot reports eligible yield.

**Tech Stack:** Python standard library (`csv`, `zipfile`, `hashlib`, `unittest`) for contract and DART/NTA parsing; read-only SEC official JSON/filing lookups; existing Jekyll repo docs (excluded from site build).

---

### Task 1: Pin the baseline and source boundaries

**Objective:** Prove no research-pilot change mutates old population, batches or two prior expansion identity versions.

**Files:** Create `docs/research/company-benefits/acquisition/three_country_pilot/README.md`, `source-inventory.v1.json` with official URLs, observation dates, bytes/SHA when actually acquired, custody and rights status. Test `test_pilot_contract.py` against frozen-file digests.

**Steps:** Write a failing test for old-ledger SHA and source inventory scope → execute `python3 -m unittest discover -s docs/research/company-benefits/acquisition/three_country_pilot -q` (RED) → implement only the source-inventory schema and pinned baseline → rerun (GREEN) → local commit. No production download may be counted merely because a URL exists.

### Task 2: Validate a restricted official-source parser fixture per country

**Objective:** Establish executable CSV/XLSX/JSON parsing and rights metadata without declaring registry rows employers.

**Files:** Create `official_sources.py` and `test_official_sources.py` in `docs/research/company-benefits/acquisition/three_country_pilot/`. Restricted input artifacts under `${HERMES_HOME}/data/benefit-batch-wave/three-country-pilot/`; never commit raw XLSX/ZIP/JSON responses.

**Steps:** Fail tests for malformed/empty IDs, duplicates, invalid Unicode/ZIP entries, stale/closed NTA records, and DART corp-code-versus-CRN confusion → implement bounded readers for the *actual* source column layouts → test fixture parser first, then observe one real official file/sample and pin bytes/SHA → local commit. If an official file is blocked, preserve blocker and do not synthesize a substitute.

### Task 3: Freeze exact disjoint 100-ID discovery assignments when feasible

**Objective:** Select the actual available official identity IDs (up to 100/country), excluding all prior canonical/expansion identities.

**Files:** Create `assignment.py`, a **private** exact-ID `assignments.v1.json` under the restricted input root, a tracked aggregate-only `assignment-summary.v1.json` with counts/hashes and rights status, and `test_assignment.py` in the pilot directory. Do not commit DART-derived names or IDs while bulk republication rights remain unresolved; other private unfiltered candidates stay under the restricted input root.

**Steps:** RED tests reject repeated IDs, normalized name collisions, incorrect country/namespace, more than 100 IDs/country, unpinned provenance, invalid source date, and unverified selection claim → compile deterministic ordered assignment from official inputs (never pad to 100) → independent neutral program verifies exact union, count and SHA → local commit. For US, 100 SEC discovery IDs may be a baseline, but at least one non-SEC official identity route must be exercised before claiming a path to 10,000.

### Task 4: Measure activity and employee evidence separately

**Objective:** Classify each assigned legal entity as `employment_verified`, `identity_only`, `blocked` or `excluded` with exact source and year, not false absence.

**Files:** Create `employment.py`, `test_employment.py`, restricted evidence receipts and a quote-free pilot summary; no benefit publication files.

**Steps:** RED tests reject group/consolidated headcount attributed to a subsidiary, missing dated operation evidence, rights unknown shown as publishable, search snippets as worker evidence and auto-conversion of `identity_only` to `no_public_info` → gather bounded official employer filings or registries → validate exact ID membership and source origin → run tests and independent sample of positive claims → local commit. The assigned count and verified count are separate numbers; zero is an honest result.

### Task 5: Decide whether to widen each country's acquisition lane

**Objective:** Report actual 100-ID-pilot yields and feasibility of eventual 10,000 per country, not an ETA invented from registry-row counts.

**Files:** Create `pilot-report.md` in the pilot directory with acquired/eligible/blocked/excluded counts, per-source rights and currentness notes, and independent reviewer objections.

**Steps:** Recompute category totals from exact ID set and source digests in code, not producer summaries. Run both acquisition suites (root and pilot separately), verify no private paths/quotes/HTTP locators in tracked docs, and compare frozen baseline SHA. If the US non-SEC employment bridge or reuse rights fail, record a stop gate and recommend a revised achievable scope before the next wave. Keep one final branch push only after the user's full requested deliverable is complete; never PR/merge/deploy here.
