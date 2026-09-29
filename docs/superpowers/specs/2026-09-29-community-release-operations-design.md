# Community release operations and gate design

Date: 2026-09-29
Status: proposed written specification; conceptual design approved
Scope: Task 15 — operational backup, restore, rollback, and one fail-closed release gate

## Context

The repository builds one GitHub Pages artifact from Jekyll, the Vite community application, and public Supabase snapshots. Database migrations, frontend checks, artifact verification, and reproducibility checks exist, but operators currently have to compose them manually. There is no repository-owned backup/restore/rollback runbook and no single command that proves a release candidate is ready.

Task 15 adds that operational boundary. It does not deploy Pages, mutate a hosted Supabase project, change OAuth, or execute a production backup or restore.

## Goals

1. Provide one local entry point that fails on any missing or failed release check.
2. Always clean project-owned local services and temporary artifacts.
3. Document a practical production backup, restore, and rollback procedure.
4. Keep production credentials and backup data outside the repository and logs.
5. Make E2E mandatory rather than silently omitting it before Task 16 exists.
6. Preserve the existing single Pages artifact and single deployment contract.

## Non-goals

- Deploying to GitHub Pages.
- Applying migrations to a hosted Supabase project.
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

One non-deploying CLI with `--mode local|staging|production`; `local` is the default.

The command constructs an ordered immutable plan and runs each step serially:

1. Preflight:
   - supported mode;
   - clean Git working tree;
   - exact Node and required executable availability;
   - no forbidden privileged Supabase credential variables;
   - mode-specific URL and approval inputs;
   - no repository-local plaintext backup or evidence output.
2. Start local Supabase.
3. Reset from zero and run upgrade-path tests.
4. Run the complete pgTAP suite and DB lint.
5. Run all Node script tests.
6. Build/export two fresh Docker artifacts.
7. Verify both exported artifacts on the host.
8. Compare byte manifests for exact reproducibility.
9. Run the mode-specific E2E command.
10. Write a non-secret JSON summary to an operator-selected path outside the repository.

The gate never pushes, creates a PR, deploys Pages, runs `supabase db push`, or writes to a hosted database.

### Mode contract

- `local`
  - fixture-backed snapshot generation;
  - local browser E2E command;
  - no hosted credentials or network target required.
- `staging`
  - requires an HTTPS staging URL and explicit `ALLOW_STAGING_E2E=1`;
  - rejects the production hostname;
  - delegates browser behavior to Task 16's staging E2E command.
- `production`
  - is readiness-only and still does not deploy;
  - requires a verified staging E2E evidence file, current backup evidence, and explicit approval input;
  - validates evidence structure, revision binding, timestamps, and file location without reading secrets.

Task 15 intentionally installs a failing E2E sentinel. The gate must stop at that step until Task 16 replaces it with real browser tests. This is preferable to a false-green release gate.

### `scripts/release-gate.test.mjs`

Behavioral tests use an injected runner, temporary directories, and synthetic non-secret evidence. They verify:

- exact step order;
- first failure stops later release checks;
- cleanup runs after success, ordinary failure, and E2E failure;
- cleanup failure makes an otherwise successful run fail;
- missing E2E is a hard failure;
- staging requires explicit opt-in and rejects `breadlab.ai`;
- production requires revision-bound, current backup and staging evidence;
- service-role and secret-key environment variables are rejected before commands run;
- summary output contains no environment values or command output;
- artifact paths are outside the repository and removed after completion.

### `docs/operations/community-release-runbook.md`

The runbook contains:

- roles and approval boundaries;
- release sequence and go/no-go checklist;
- backup policy and evidence format;
- restore drill procedure;
- database forward-fix and restore-to-new-project procedure;
- Storage object recovery procedure;
- GitHub Pages rollback procedure;
- OAuth/configuration recovery checklist;
- incident communication and verification record template.

The `docs/` tree is excluded from Jekyll output, and the artifact verifier rejects leaked operational source documents.

## Backup policy

Baseline: Supabase managed database backup plus an independently encrypted logical backup.

- Managed backup/PITR availability must be verified for the actual plan before production approval. Lack of managed backup is a release blocker unless the operator explicitly adopts the documented logical-only exception.
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

## Restore and rollback strategy

### Database

Migrations remain forward-only. A failed production migration is not handled by editing or deleting an already-applied migration.

Preferred order:

1. stop writes or place the community in maintenance/read-only mode;
2. capture incident time and current revision;
3. prefer a forward-fix when data integrity is intact;
4. when restoration is required, restore into a new Supabase project;
5. restore roles/schema/data and migration history according to the official Supabase process;
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
- named step status and duration;
- artifact manifest checksum and file count;
- DB test counts;
- backup evidence timestamp/checksum references for production readiness;
- E2E evidence timestamp/revision reference.

It must not contain environment dumps, URLs with credentials, HTTP bodies, JWTs, connection strings, user data, or backup contents.

## Failure handling

- Every step is a hard failure.
- The first operational failure is preserved as the primary error.
- Cleanup always attempts to stop the project-owned Supabase stack and delete temporary artifact/evidence staging directories.
- Cleanup failures are reported and fail an otherwise successful gate.
- Signal handling uses the same cleanup path.
- Existing unrelated containers are never removed.
- A partially written summary is staged then atomically renamed; no success summary is emitted before every required step passes.

## Security boundaries

- Publishable credentials may be used only by the existing public snapshot path.
- Service-role, database password, access token, and secret-key variables are forbidden in ordinary local/staging artifact steps.
- Backup commands are manual operator procedures and receive secrets through an approved secret manager, never command-line literals committed to history.
- Staging write tests require explicit approval and are out of scope until Task 16.
- Production deployment and hosted database writes remain separate explicit approval points.

## Verification and acceptance

Task 15 is complete when:

- release-gate unit tests pass;
- env/preflight tests include fail-closed credential and URL cases;
- the real gate reaches and fails at the intentionally missing E2E step after earlier local checks pass, proving E2E cannot be skipped;
- documentation checks reject unresolved markers and secret-like values;
- frontend, DB, Jekyll, snapshot, verifier, and reproducibility commands remain green independently;
- an independent operations/security review reports no Critical or Important findings;
- the Task 15 commit is locally integrated only after review.

Task 16 replaces the E2E sentinel, runs local/staging browser verification within the approved boundary, and is the first point where the complete release gate may become green.

## Authoritative references

- Supabase Database Backups: https://supabase.com/docs/guides/platform/backups
- Supabase CLI Backup and Restore: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- Supabase Restore to a New Project: https://supabase.com/docs/guides/platform/clone-project
- GitHub Actions deployments: https://docs.github.com/actions/deployment/about-deployments/deploying-with-github-actions
