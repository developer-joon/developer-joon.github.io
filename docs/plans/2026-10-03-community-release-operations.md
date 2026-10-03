# Community Release Operations Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a fail-closed, non-deploying release gate and operator runbooks for local Docker, a hosted development Supabase project, and a separate production Supabase project.

**Architecture:** A dependency-injected Node.js orchestrator builds immutable command plans for `local`, `development`, and `production-readiness` modes. The ordinary gate may run local commands and explicit read-only hosted probes, but it cannot deploy or mutate either hosted project; hosted writes, Pages deployment, backup, and production canary procedures remain documented approval-gated operator actions. JSON evidence is written atomically outside the repository and contains no credentials or user content.

**Tech Stack:** Node.js 24 built-ins, `node:test`, Supabase CLI 2.118, Docker, Bash only for existing fixed build commands, Jekyll 4.4.1, React/Vite checks.

**Authoritative design:** `docs/superpowers/specs/2026-09-29-community-release-operations-design.md`

---

### Task 1: Release-gate plan, mode, and environment preflight

**Objective:** Define a pure, testable release plan that rejects unsafe modes, credentials, repository-local evidence, and development/production project aliasing before any command runs.

**Files:**
- Create: `scripts/release-gate.mjs`
- Create: `scripts/release-gate.test.mjs`

**Step 1: Write failing tests**

Use `node:test` with temporary directories and injected dependencies. Cover:

- default `local` mode and exact ordered local step names;
- only `local`, `development`, and `production-readiness` are accepted;
- unsupported Node major/minor is rejected;
- `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SERVICE_KEY`, `SUPABASE_DB_PASSWORD`, and secret-key patterns are rejected;
- evidence output must resolve outside the repository and must not be a symlink;
- development requires HTTPS `DEVELOPMENT_SUPABASE_URL` and `ALLOW_DEVELOPMENT_CLOUD_READS=1`;
- production hostname/project fingerprint is rejected in development mode;
- production readiness requires distinct development/production fingerprints and explicit `ALLOW_PRODUCTION_READINESS=1`;
- no generated plan contains `supabase db push`, `supabase functions deploy`, `git push`, `gh workflow run`, or a write-capable HTTP method.

Define the wished-for API:

```js
export function parseReleaseOptions(argv, env, context) {}
export function buildReleasePlan(options) {}
export function projectFingerprint(url) {}
export async function runReleaseGate(options, dependencies) {}
```

**Step 2: Verify RED**

Run:

```bash
node --test scripts/release-gate.test.mjs
```

Expected: FAIL because `scripts/release-gate.mjs` or its exports do not exist.

**Step 3: Implement minimal pure preflight and plan builder**

Requirements:

- no shell interpolation; every step is `{ name, command, args, environment }` with fixed arrays;
- exact Node version requirement derives from `community-app/package.json` engines;
- project fingerprint is a non-secret SHA-256 digest of the canonical Supabase project ref, never the full URL;
- URL parser accepts `https://<ref>.supabase.co` only for hosted projects;
- local mode rejects hosted credential variables rather than ignoring them;
- all returned plans are frozen recursively;
- exported functions do not read global process state unless called by the CLI adapter.

**Step 4: Verify GREEN**

Run:

```bash
node --test scripts/release-gate.test.mjs
```

Expected: all Task 1 tests pass.

**Step 5: Commit**

```bash
git add scripts/release-gate.mjs scripts/release-gate.test.mjs
git commit -m "build: add community release gate preflight"
```

---

### Task 2: Serial execution, cleanup, sentinels, and atomic evidence

**Objective:** Execute the immutable plan fail-fast, always clean project-owned resources, and publish non-secret evidence only after required checks finish.

**Files:**
- Modify: `scripts/release-gate.mjs`
- Modify: `scripts/release-gate.test.mjs`
- Create: `scripts/community-e2e-sentinel.mjs`
- Create: `scripts/development-integration-sentinel.mjs`

**Step 1: Write failing tests**

Cover:

- steps execute serially in exact order;
- first command failure prevents later checks;
- cleanup runs after success, command failure, sentinel failure, and signal-abort simulation;
- cleanup failure changes an otherwise successful exit to failure without hiding the original failure;
- local Supabase stop targets only this repository project;
- local mode reaches and fails at `community-e2e-sentinel.mjs`;
- development mode performs only explicit GET/HEAD or anon RPC probes, then reaches and fails at `development-integration-sentinel.mjs`;
- HTTP 5xx/timeout and known paused-project responses fail with resume guidance and no fallback URL;
- evidence schema exact-keys validation;
- evidence includes revision, mode, UTC timestamps, step status/duration, artifact manifest references, and non-secret project fingerprint;
- evidence excludes environment dumps, command stdout/stderr, URLs, request/response bodies, JWTs, keys, Markdown, and user data;
- evidence is written to a temporary sibling then atomically renamed;
- failure evidence cannot be mistaken for a successful release proof.

**Step 2: Verify RED**

Run:

```bash
node --test scripts/release-gate.test.mjs
```

Expected: new execution/evidence tests fail for missing behavior.

**Step 3: Implement minimal runner**

Use `spawn`/`spawnSync` without `shell: true`, injected clock/fetch/runner/filesystem for tests, and `try/finally` cleanup. Preserve bounded diagnostic tails in process memory for terminal display only; never persist them in evidence. Make sentinels print an actionable Task 16 message and exit non-zero.

The local ordered plan must reuse existing commands rather than duplicate logic:

1. repository and executable preflight;
2. `npm --prefix community-app run db:start`;
3. `npm --prefix community-app run db:reset`;
4. storage, public-listing, snapshot, and public-attachment upgrade/integration scripts;
5. `npm --prefix community-app run db:test`;
6. `npm --prefix community-app run db:lint`;
7. Node script tests excluding recursive release-gate self-invocation;
8. two fresh Docker site exports;
9. host verification of both artifacts;
10. reproducibility comparison;
11. local E2E sentinel;
12. cleanup.

Development mode runs the local proof first, then explicit read-only hosted health/configuration probes, then the development integration sentinel. Production readiness validates evidence only and performs no network or write operation.

**Step 4: Verify GREEN**

Run:

```bash
node --test scripts/release-gate.test.mjs
node scripts/release-gate.mjs --mode local --evidence /tmp/breadlab-community-release-local.json
```

Expected: unit tests pass; real local gate runs earlier checks and exits non-zero specifically at the intentional local E2E sentinel, followed by successful cleanup. Do not claim the complete gate is green in Task 15.

**Step 5: Commit**

```bash
git add scripts/release-gate.mjs scripts/release-gate.test.mjs scripts/community-e2e-sentinel.mjs scripts/development-integration-sentinel.mjs
git commit -m "build: enforce fail-closed community release evidence"
```

---

### Task 3: Operator runbooks and release checklist

**Objective:** Document executable, approval-bounded procedures for two hosted Free Plan projects, backup/restore, deployment, rollback, and production canary cleanup.

**Files:**
- Create: `docs/operations/community-release-runbook.md`
- Create: `docs/operations/community-backup-restore.md`
- Create: `docs/operations/community-rollback.md`
- Create: `docs/operations/community-release-checklist.md`
- Create: `scripts/community-operations-docs.test.mjs`
- Modify: `docs/operations/community-oauth-setup.md`
- Modify: `README.md`

**Step 1: Write failing documentation-contract tests**

Tests must assert the runbooks contain:

- local Docker, hosted development, and production separation;
- distinct project references, OAuth apps, redirect allow-lists, keys, Storage, and test identities;
- Free Plan pause detection/resume with no production fallback and no artificial keepalive;
- Free Plan only: managed daily backup, PITR, and managed restore-to-new-project must not be required or offered as fallbacks;
- encrypted logical DB backup and private Storage inventory before production migration;
- Free Plan recovery capacity explicitly pauses development before creating or activating a clean recovery target;
- scheduled cleanup uses low-frequency `pg_cron`/`pg_net`, verifies current Free Plan quotas, and never enables paid overage automatically;
- no secrets in CLI literals, repository files, evidence, or Pages artifacts;
- additive migration and forward-fix policy;
- development fixture cleanup with exact IDs and zero-residue read-back;
- production read-only probe separated from explicit write canary approval;
- snapshot schedule control during canary;
- exact canary fixture IDs and cleanup/read-back;
- Pages source-driven rollback and backend write-disable order;
- RPO 24h, target RTO 4h, quarterly restore drill;
- authoritative Supabase and GitHub links;
- no unresolved markers or example secret values.

Also test that `scripts/verify-site.mjs` rejects these operational sources if they enter `_site`.

**Step 2: Verify RED**

Run:

```bash
node --test scripts/community-operations-docs.test.mjs
```

Expected: FAIL because the required documents do not exist.

**Step 3: Write runbooks**

Commands must represent operator-supplied values only through documented environment-variable input, for example:

```bash
read -rsp 'Production database password: ' SUPABASE_DB_PASSWORD
export SUPABASE_DB_PASSWORD
```

Never include real refs, keys, tokens, passwords, or connection strings. Hosted mutation commands must be shown as manual approval-gated procedures and must not be invoked by `release-gate.mjs`.

Document this promotion order:

1. local exhaustive gate and Task 16 local E2E;
2. hosted development migration/Functions/OAuth/integration and cleanup;
3. production backup and capability evidence;
4. production additive backend deployment;
5. production read-only probes;
6. Pages deployment;
7. separately approved bounded canary;
8. exact cleanup/read-back;
9. enable scheduled snapshots and observe.

**Step 4: Verify GREEN**

Run:

```bash
node --test scripts/community-operations-docs.test.mjs
node scripts/verify-site.mjs _site
```

Expected: documentation tests pass and operational docs are absent from the site artifact.

**Step 5: Commit**

```bash
git add docs/operations README.md scripts/community-operations-docs.test.mjs
git commit -m "docs: add community release operations runbooks"
```

---

### Task 4: Package entry points and CI-safe non-deploying contract

**Objective:** Expose one discoverable release command without granting CI an implicit hosted-write path.

**Files:**
- Modify: `community-app/package.json`
- Modify: `README.md`
- Modify: `scripts/build-definition.test.mjs`
- Modify: `scripts/release-gate.test.mjs`

**Step 1: Write failing tests**

Assert:

- `npm --prefix community-app run release:check -- --mode local --evidence <external-path>` invokes the root release gate;
- package scripts expose no production deploy, hosted DB push, Function deployment, or production canary shortcut;
- `.github/workflows/jekyll.yml` remains the only Pages deployment contract;
- release commands do not accept evidence under the repository;
- ordinary CI/build remains fixture-backed unless the existing explicit live snapshot mode is selected.

**Step 2: Verify RED**

Run:

```bash
node --test scripts/build-definition.test.mjs scripts/release-gate.test.mjs
```

Expected: FAIL because `release:check` is absent.

**Step 3: Add minimal script and documentation**

Add only:

```json
"release:check": "node ../scripts/release-gate.mjs"
```

Do not add production deploy or canary scripts in Task 15.

**Step 4: Verify GREEN**

Run:

```bash
node --test scripts/build-definition.test.mjs scripts/release-gate.test.mjs
npm --prefix community-app run release:check -- --mode production-readiness --evidence /tmp/breadlab-community-readiness.json
```

Expected: tests pass; readiness command fails closed with an actionable missing-evidence message and performs no hosted mutation.

**Step 5: Commit**

```bash
git add community-app/package.json community-app/package-lock.json README.md scripts/build-definition.test.mjs scripts/release-gate.test.mjs
git commit -m "build: expose community release readiness check"
```

---

### Task 5: Independent review and full Task 15 verification

**Objective:** Prove the Task 15 delta matches the approved design, has no privileged execution path, and leaves the repository/local services clean.

**Files:**
- Review all Task 15 files and commits
- Modify only files required to fix Critical or Important findings

**Step 1: Spec compliance review**

Independently compare implementation to:

- `docs/superpowers/specs/2026-09-29-community-release-operations-design.md`
- Tasks 1–4 of this plan

Block on omissions, obsolete environment assumptions, hosted write paths, false-green evidence, or undocumented approval boundaries.

**Step 2: Security/operations quality review**

Check:

- command injection and `shell: true` absence;
- symlink/path traversal around evidence and temporary directories;
- credentials and environment redaction;
- project fingerprint collision/aliasing behavior;
- development pause handling and no production fallback;
- cleanup on failures/signals;
- evidence freshness/revision binding;
- production readiness cannot deploy or mutate;
- runbooks do not overclaim Free Plan backups/PITR.

Fix all Critical/Important findings and rerun focused tests after each fix.

**Step 3: Run fresh full verification**

Run in one exclusive local database session:

```bash
npm --prefix community-app run db:start
npm --prefix community-app run db:reset
npm --prefix community-app run db:test:storage-upgrade
npm --prefix community-app run db:test:public-listing-upgrade
npm --prefix community-app run db:test:community-snapshot-upgrade
npm --prefix community-app run db:test:public-attachment-integration
npm --prefix community-app run db:test
npm --prefix community-app run db:lint
npm --prefix community-app run check
node --test scripts/*.test.mjs
./scripts/build-site-docker.sh /tmp/breadlab-community-site-a
./scripts/build-site-docker.sh /tmp/breadlab-community-site-b
node scripts/verify-site.mjs /tmp/breadlab-community-site-a
node scripts/verify-site.mjs /tmp/breadlab-community-site-b
./scripts/verify-site-reproducibility.sh /tmp/breadlab-community-site-a /tmp/breadlab-community-site-b /tmp/breadlab-community-reproducibility-evidence
```

Then run the real gate and verify intentional failure:

```bash
npm --prefix community-app run release:check -- --mode local --evidence /tmp/breadlab-community-task15.json
```

Expected: all independent commands pass; the real Task 15 gate exits non-zero only at the local E2E sentinel and reports successful cleanup. A full green release claim remains prohibited until Task 16.

**Step 4: Verify cleanup and diff**

```bash
npm --prefix community-app run db:stop
git diff --check
git status --short
```

Verify project-owned Supabase containers and application ports are gone, temporary artifacts are outside the repository, and only intended tracked files remain.

**Step 5: Final Task 15 commit if review fixes exist**

```bash
git add <review-fix-files>
git commit -m "fix: harden community release operations"
```

Do not push, create a PR, mutate hosted Supabase, or deploy Pages without a separate user-approved operation.
