# Community release operations and gate design

Date: 2026-09-29; revised 2026-10-03
Status: revised written specification awaiting final user review
Scope: Task 15 — local, development-cloud, and production release operations with fail-closed gates

## Context

The repository builds one GitHub Pages artifact from Jekyll, the Vite community application, and public Supabase snapshots. Database migrations, frontend checks, artifact verification, and reproducibility checks exist, but operators currently have to compose them manually. There is no repository-owned backup/restore/rollback runbook and no single command that proves a release candidate is ready.

There is no permanent staging environment. Development uses three distinct boundaries: a local Supabase CLI/Docker stack, one hosted Free Plan development project, and one hosted Free Plan production project. The hosted development project is an integration target for OAuth, CORS, Edge Functions, and internet-reachable behavior; it never contains production data and is not a deployment promotion source.

Supabase currently permits two active Free Plan projects. Local CLI/Docker instances do not consume that hosted-project quota. Free projects may be paused for low activity, so a paused development project is an explicit recoverable preflight failure and never causes a fallback to production.

Task 15 adds the release boundary and documentation. It does not deploy Pages, mutate either hosted Supabase project, change OAuth, or execute a production backup, restore, or canary write. Those remain explicit operator actions in Task 16.

## Goals

1. Provide one local entry point that fails on any missing or failed release check.
2. Always clean project-owned local services and temporary artifacts.
3. Document a practical production backup, restore, and rollback procedure.
4. Keep production credentials and backup data outside the repository and logs.
5. Make E2E mandatory rather than silently omitting it before Task 16 exists.
6. Preserve the existing single Pages artifact and single deployment contract.
7. Keep local, development-cloud, and production credentials and evidence structurally separate.
8. Make every production mutation—including canary verification—a separate explicit approval boundary.

## Non-goals

- Deploying to GitHub Pages.
- Applying migrations or deploying Functions to a hosted Supabase project.
- Creating, downloading, or restoring a real production backup.
- Configuring GitHub OAuth or hosted Supabase settings.
- Implementing browser E2E; Task 16 supplies it.
- Building a general CI orchestration framework.

## Chosen approach

Use a Node.js release-gate orchestrator plus repository-owned validation tests and one operations runbook.

A Node orchestrator is preferred over a large shell script because it can execute fixed command arrays without shell interpolation, preserve the first failing exit status, run cleanup in `finally`, and expose a testable plan/runner boundary. It reuses existing project commands rather than duplicating their logic.

Rejected alternatives:

- GitHub Actions-only gate: centralizes execution but weakens local parity and creates an unnecessary remote execution boundary.
- Makefile task graph: provides reusable targets but introduces a second build abstraction that this repository does not otherwise use.

## Components

### `scripts/release-gate.mjs`

One non-deploying CLI with `--mode local|development|production-readiness`; `local` is the default.

The command constructs an ordered immutable plan and runs each step serially:

1. Preflight:
   - supported mode;
   - clean Git working tree;
   - exact Node and required executable availability;
   - no forbidden privileged Supabase credential variables;
   - mode-specific project URL, evidence, and opt-in inputs;
   - no repository-local plaintext backup or evidence output.
2. Start local Supabase.
3. Reset from zero and run upgrade-path tests.
4. Run the complete pgTAP suite and DB lint.
5. Run all Node script tests.
6. Build/export two fresh Docker artifacts.
7. Verify both exported artifacts on the host.
8. Compare byte manifests for exact reproducibility.
9. Run the mode-specific verification command.
10. Write a non-secret JSON summary to an operator-selected path outside the repository.

The gate never pushes, creates a PR, deploys Pages, runs `supabase db push`, deploys an Edge Function, or writes to a hosted database. Hosted migration, Function deployment, Pages deployment, and production canary commands belong to the operator runbook and are not hidden inside the verification gate.

### Mode contract

- `local`
  - fixture-backed snapshot generation;
  - local browser E2E command;
  - no hosted credentials or network target required.
- `development`
  - targets the dedicated hosted development Supabase project only;
  - requires an HTTPS project URL, explicit `ALLOW_DEVELOPMENT_CLOUD_READS=1`, and a project-reference fingerprint that differs from production evidence;
  - performs read-only health and configuration probes in Task 15;
  - delegates authenticated integration writes and browser behavior to Task 16;
  - reports a paused or unreachable Free Plan project as a recoverable hard failure with resume guidance;
  - never falls back to the production URL or credentials.
- `production-readiness`
  - is offline/read-only readiness validation and still does not deploy or mutate production;
  - requires current local E2E evidence, current development-cloud integration evidence, current backup evidence, and an explicit operator opt-in;
  - requires development and production project-reference fingerprints to differ;
  - validates evidence structure, revision binding, timestamps, and file location without reading secrets;
  - excludes production write canaries, which require a separate named command and approval in Task 16.

Task 15 intentionally installs failing sentinels for local browser E2E and development-cloud authenticated integration verification. The applicable gate must stop at either missing step until Task 16 replaces it with real tests. This is preferable to a false-green release gate.

### `scripts/release-gate.test.mjs`

Behavioral tests use an injected runner, temporary directories, and synthetic non-secret evidence. They verify:

- exact step order;
- first failure stops later release checks;
- cleanup runs after success, ordinary failure, and E2E failure;
- cleanup failure makes an otherwise successful run fail;
- missing local E2E or development-cloud integration evidence is a hard failure;
- development mode requires explicit read-only opt-in and rejects the production project fingerprint;
- a paused or unreachable development project fails without attempting production;
- production readiness requires revision-bound, current backup, local E2E, and development-cloud evidence;
- production canary variables cannot make the non-deploying gate perform a write;
- service-role and secret-key environment variables are rejected before commands run;
- summary output contains no environment values or command output;
- temporary artifact paths are outside the repository and removed after completion; the atomically published evidence summary remains at the operator-selected external path.

### `docs/operations/community-release-runbook.md`

The runbook contains:

- roles and approval boundaries;
- release sequence and go/no-go checklist;
- separation of local, development-cloud, and production project configuration;
- hosted development project resume, reset, and fixture-cleanup procedures;
- backup policy and evidence format;
- restore drill procedure;
- database forward-fix and restore-to-new-project procedure;
- Storage object recovery procedure;
- GitHub Pages rollback procedure;
- OAuth/configuration recovery checklist;
- incident communication and verification record template.
- production read-only probe and separately approved write-canary procedures.

The `docs/` tree is excluded from Jekyll output, and the artifact verifier rejects leaked operational source documents.

## Backup policy

Baseline: Free Plan capabilities only, with an independently encrypted logical database backup and a separate private Storage object backup. Paid backup features are not part of the release contract.

- Managed daily backups, PITR, and managed project cloning are unavailable assumptions and must not appear as required or fallback paths.
- Create encrypted logical exports at least daily and immediately before a production migration.
- Store encrypted backups off-site with retention independent of the Supabase project. Deleting a project also removes provider-held backups.
- Record a SHA-256 checksum, source project reference hash, database major version, migration revision, creation time, encryption mechanism identifier, and storage-object inventory checksum. Do not record connection strings, tokens, or raw project credentials.
- Never keep plaintext dumps under the repository, Actions workspace artifact, or Pages artifact.

Supabase database backups do not include the Storage API object bytes. The backup procedure therefore treats these as separate assets:

1. database roles/schema/data and migration history;
2. Auth/Storage schema customizations and provider settings;
3. private Storage objects plus a bounded inventory/checksum manifest;
4. GitHub OAuth settings and redirect allow-list documentation.

Target objectives:

- RPO: no more than 24 hours during normal operation; a fresh pre-migration backup narrows planned-change exposure.
- RTO: four hours to restore into a new project, verify, and prepare cutover for the current expected data volume.
- Restore drill: at least quarterly and before relying on a materially changed backup mechanism.

The Free Plan does not provide the managed daily backups and PITR assumed by paid plans. Supabase recommends regular CLI `db dump` exports for Free Plan projects. The managed "Restore to a New Project" flow is also paid-plan-only. Independent logical DB exports and Storage object inventories are therefore mandatory before production migrations under the Free Plan.

Free Plan recovery uses a manual logical restore. Because both active hosted-project slots are normally occupied, the recovery runbook pauses the development project to free one active slot, then creates or activates a clean recovery project. A paid-plan upgrade is not a fallback. Production is never overwritten merely to make room for a restore rehearsal. The quarterly drill may use the development project only after its synthetic fixtures are exported or declared disposable and its project identity is recorded for reconfiguration.

## Environment isolation

### Local

- Supabase CLI and Docker are the disposable source of exhaustive database and browser testing.
- Reset, destructive fixtures, concurrency probes, and cleanup verification run only here by default.
- Local services use no hosted project credentials.

### Hosted development project

- Uses the first hosted Free Plan project for OAuth, redirect, CORS, Edge Function, Storage, and public-internet integration checks.
- Contains synthetic fixtures only and has a separate GitHub OAuth application, redirect allow-list, keys, Storage objects, and administrator test identity.
- May be reset or cleaned under an explicit development-only operator command.
- May pause after low activity. Release automation reports the condition and stops; it does not send artificial keepalive traffic and never substitutes production.

### Free Plan runtime budget

- Scheduled attachment cleanup uses hosted `pg_cron`/`pg_net` plus the existing Edge Function at a low frequency, initially once per day.
- The runbook verifies current Free Plan quotas before release instead of treating today's numeric limits as permanent constants.
- Quota exhaustion or platform restriction fails closed and raises an operator action; it never enables paid overage or upgrades automatically.
- Development integration fixtures remain bounded and are cleaned by exact identifiers so validation does not consume production capacity.

### Production project

- Uses the second hosted Free Plan project and contains real user data.
- Receives only reviewed additive migrations and versioned Edge Functions after local and development evidence are current.
- Read-only probes are separate from write canaries. Every write canary requires an explicit approval token, dedicated test identity, exact fixture IDs, snapshot scheduling control, and asserted cleanup/read-back.
- Production credentials are never accepted by local or development modes.

## Restore and rollback strategy

### Database

Migrations remain forward-only. A failed production migration is not handled by editing or deleting an already-applied migration.

Preferred order:

1. stop writes or place the community in maintenance/read-only mode;
2. capture incident time and current revision;
3. prefer a forward-fix when data integrity is intact;
4. when restoration is required, pause the development project to secure an active-project slot, then create or activate a clean recovery project;
5. manually restore roles/schema/data and migration history from the encrypted logical backup according to the official Supabase CLI process;
6. restore Storage objects separately;
7. reconfigure Auth, OAuth, API keys, Realtime, extensions, network restrictions, and other settings not guaranteed by the database restore;
8. run schema, RLS, RPC, snapshot, and browser smoke verification;
9. switch endpoints only after explicit approval;
10. retain the old project until verification and rollback windows close.

In-place PITR may require downtime and is used only with an approved incident plan. It is not automated by this repository.

### GitHub Pages

Pages rollback is source-driven:

1. identify the last known-good commit and its verification evidence;
2. revert the bad commit on the deployment branch rather than rewriting history;
3. run the complete release gate against the revert commit;
4. deploy once through the existing `jekyll.yml` workflow;
5. verify canonical routes, snapshot pages, sitemap, assets, and OAuth callback behavior.

Re-running a failed deployment of the same bad revision is not a rollback.

## Evidence format

Evidence is JSON written outside the repository. It contains only:

- schema version;
- Git revision;
- UTC start/end timestamps;
- mode;
- non-secret project-reference fingerprint for hosted evidence;
- named step status and duration;
- artifact manifest checksum and file count;
- DB test counts;
- backup evidence timestamp/checksum references for production readiness;
- local E2E and development-cloud integration evidence timestamp/revision references;
- for production canary evidence only: approval reference, exact synthetic fixture identifiers, and cleanup/read-back status without content bodies.

It must not contain environment dumps, URLs with credentials, HTTP bodies, JWTs, connection strings, user data, or backup contents.

## Failure handling

- Every step is a hard failure.
- The first operational failure is preserved as the primary error.
- Cleanup always attempts to stop the project-owned Supabase stack and delete temporary artifact/evidence work directories.
- Cleanup failures are reported and fail an otherwise successful gate.
- Signal handling uses the same cleanup path.
- Existing unrelated containers are never removed.
- A partially written summary is staged then atomically renamed; no success summary is emitted before every required step passes.

## Security boundaries

- Publishable credentials may be used only by the existing public snapshot path and explicitly read-only hosted probes.
- Service-role, database password, access token, and secret-key variables are forbidden in ordinary local, development, and artifact steps.
- Backup commands are manual operator procedures and receive secrets through an approved secret manager, never command-line literals committed to history.
- Hosted development authenticated writes require explicit development-only opt-in and are out of scope until Task 16.
- Production read-only probes and production write canaries are different commands and different approvals. Read-only success never authorizes a write.
- Production deployment and hosted database writes remain separate explicit approval points.

## Verification and acceptance

Task 15 is complete when:

- release-gate unit tests pass;
- env/preflight tests include fail-closed credential, project-isolation, URL, and paused-development cases;
- the real local gate reaches and fails at the intentionally missing local E2E step after earlier checks pass;
- the development gate reaches and fails at the intentionally missing authenticated integration step without contacting production;
- documentation checks reject unresolved markers and secret-like values;
- frontend, DB, Jekyll, snapshot, verifier, and reproducibility commands remain green independently;
- an independent operations/security review reports no Critical or Important findings;
- the Task 15 commit is locally integrated only after review.

Task 16 replaces both sentinels, runs local browser verification and hosted development integration verification, and produces the evidence required for production readiness. It then follows separate operator-approved steps for production backup, additive backend deployment, read-only probes, Pages deployment, and one bounded write canary with asserted cleanup. No permanent staging environment is introduced.

## Authoritative references

- Supabase Database Backups: https://supabase.com/docs/guides/platform/backups
- Supabase CLI Backup and Restore: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- Supabase Restore to a New Project (paid-plan limitation): https://supabase.com/docs/guides/platform/clone-project
- Supabase Storage object download: https://supabase.com/docs/guides/storage/management/download-objects
- GitHub Actions deployments: https://docs.github.com/actions/deployment/about-deployments/deploying-with-github-actions
- Supabase Billing FAQ (two active Free Plan projects): https://supabase.com/docs/guides/platform/billing-faq
- Supabase Free Project Pausing: https://supabase.com/docs/guides/platform/free-project-pausing
