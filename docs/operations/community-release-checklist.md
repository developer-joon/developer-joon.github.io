# Community release checklist

Complete every checkbox in order. Each evidence record is external to the repository, revision-bound, UTC-dated, private where needed, and free of credentials or user content. A failed or unverified item is no-go.

## 0. Isolation and approval preflight

- [ ] Record release revision, operator, approver, UTC start, and external evidence paths.
- [ ] Confirm local Docker, hosted development, and production are the only boundaries; there is no staging project.
- [ ] Confirm development and production project refs are nonempty and distinct.
- [ ] Confirm separate Google OAuth clients, exact redirect allow-lists, keys, private Storage, and test identities.
- [ ] Confirm Google is the only enabled community OAuth provider; Kakao and GitHub are future providers and remain disabled. The separate giscus GitHub integration is unchanged.
- [ ] Confirm only publishable keys are public. Privileged keys/password/OAuth secrets are absent from CLI literals, repository, evidence, logs, Actions artifacts, and Pages.
- [ ] Check current Free Plan active-project, database, Storage, egress, Functions, `pg_cron`, and `pg_net` quotas. Do not auto-enable paid overage.
- [ ] If hosted development is paused, use Dashboard **Resume project** and repeat health checks. No artificial keepalive and never fall back to production.

## 1. local exhaustive + Task 16 E2E

- [ ] Clean working tree and supported Node, Docker, pinned Supabase CLI, Ruby/Jekyll toolchain.
- [ ] Local reset/upgrade tests, pgTAP, DB lint, frontend checks, all Node script tests.
- [ ] Two fresh Docker site artifacts verify and reproduce byte-for-byte.
- [ ] Task 16 E2E passes against local Docker; no intentional sentinel remains.
- [ ] Local stack and temporary artifacts are cleaned; local evidence is current and revision-bound.

## 2. development cloud integration+cleanup

- [ ] Read-only development gate passes against the dedicated hosted development ref.
- [ ] Obtain development-only mutation approval; inspect migration dry run.
- [ ] Apply reviewed development migration and deploy the explicit Function set to `--project-ref "$DEVELOPMENT_PROJECT_REF"`.
- [ ] Verify the separate development Google OAuth client returns through `https://${DEVELOPMENT_PROJECT_REF}.supabase.co/auth/v1/callback`, then to `http://localhost:5173/community/auth/callback/`; confirm Kakao/GitHub remain disabled.
- [ ] Run Task 16 development cloud integration for Auth, migration, Functions, OAuth, and private Storage.
- [ ] Record every synthetic row/Auth user/object as operator-recorded fixture IDs.
- [ ] Cleanup uses exact IDs only; repeat reads/listing and record zero-residue read-back.

## 3. production backup/capability evidence

- [ ] Verify current Free Plan capabilities: managed daily backups are not available; PITR, project clone, and managed restore-to-new-project are unavailable Free recovery assumptions.
- [ ] Confirm no temporary paid upgrade or paid-overage fallback is proposed.
- [ ] Create the pre-production migration encrypted logical database backup outside the repository.
- [ ] Capture encrypted private Storage inventory and object bytes separately; database backups do not include Storage object bytes.
- [ ] Set directory/file modes to 700/600, validate SHA-256 checksums, remove plaintext, transfer encrypted artifacts off-site.
- [ ] Record RPO 24 hours, target RTO 4 hours, latest quarterly restore drill, DB major, migration revision, project-ref hash, and checksums.
- [ ] Confirm recovery capacity: if a clean target is needed, pause development first; never repurpose production as development.

## 4. additive backend deployment

- [ ] Obtain production backend approval distinct from Pages and canary approvals.
- [ ] Confirm every migration is additive; no destructive down migration exists.
- [ ] Inspect `db push --dry-run` against the explicit production ref.
- [ ] Apply the approved migration and deploy the exact reviewed Functions with explicit `--project-ref "$PRODUCTION_PROJECT_REF"`.
- [ ] On failure, write-disable and forward-fix; do not destructively reverse an applied migration.

## 5. production read-only probes

- [ ] Run only bounded GET/HEAD health, configuration, public read, RLS-denial, and Function read probes with the production publishable key.
- [ ] Store statuses/durations only; no URLs, bodies, keys, tokens, or user content.
- [ ] Confirm the read-only production probe is strictly separate from the approved write canary; probe success never authorizes a write.

## 6. Pages deployment

- [ ] Obtain Pages approval for the exact source revision and verified artifact.
- [ ] Deploy once through `.github/workflows/jekyll.yml`; do not upload or patch an artifact manually.
- [ ] Verify workflow SHA, canonical routes, six community shells, assets, snapshots/sitemap, privacy page, and the production application callback `https://www.breadlab.ai/community/auth/callback/`.

## 7. separately approved bounded write canary

- [ ] Obtain a fresh production canary approval and use only the dedicated production test identity.
- [ ] Pause `.github/workflows/community-snapshots.yml` during canary and verify disabled state.
- [ ] Generate one canary run UUID; derive the deterministic prefix from that UUID as `release-canary-${CANARY_RUN_ID}`.
- [ ] Record exact canary fixture IDs returned for every post, comment, attachment, Auth identity, and private Storage object.
- [ ] Exercise only the minimum create/read/update/delete and attachment flow; do not inspect or mutate real-user records.

Use the same fail-closed command contract as the runbook. Approval, target ref, run ID/prefix, evidence path, dedicated test identity, and hard write limits are environment-only; the command accepts no secret or target values as arguments. The implementation must return the exact post, comment, reaction, report, and object IDs used for cleanup and evidence.

```bash
set -euo pipefail
: "${PRODUCTION_CANARY_APPROVAL:?record the explicit production canary approval token}"
: "${GITHUB_REPOSITORY:?set owner/repository}"
: "${PRODUCTION_PROJECT_REF:?set production project ref}"
: "${PRODUCTION_CANARY_TEST_IDENTITY_ID:?set the dedicated test identity ID}"
: "${PRODUCTION_CANARY_EVIDENCE_PATH:?set an absolute evidence path outside the repository}"
case "$PRODUCTION_CANARY_EVIDENCE_PATH" in /*) ;; *) exit 1 ;; esac
case "$PRODUCTION_CANARY_EVIDENCE_PATH" in "$REPO_ROOT/"*) exit 1 ;; esac
CANARY_RUN_ID="$(node --input-type=module -e 'import { randomUUID } from "node:crypto"; console.log(randomUUID())')"
CANARY_PREFIX="release-canary-${CANARY_RUN_ID}"
export PRODUCTION_CANARY_APPROVAL GITHUB_REPOSITORY PRODUCTION_PROJECT_REF
export PRODUCTION_CANARY_TEST_IDENTITY_ID PRODUCTION_CANARY_EVIDENCE_PATH
export CANARY_RUN_ID CANARY_PREFIX
export CANARY_MAX_POSTS=1
export CANARY_MAX_COMMENTS=1
export CANARY_MAX_REACTIONS=1
export CANARY_MAX_REPORTS=1
export CANARY_MAX_OBJECTS=1

gh workflow disable community-snapshots.yml --repo "$GITHUB_REPOSITORY"
gh workflow view community-snapshots.yml --repo "$GITHUB_REPOSITORY"
node scripts/community-production-canary.mjs \
  --cleanup-exact-ids \
  --assert-zero-residue
test -s "$PRODUCTION_CANARY_EVIDENCE_PATH"
gh workflow enable community-snapshots.yml --repo "$GITHUB_REPOSITORY"
gh workflow view community-snapshots.yml --repo "$GITHUB_REPOSITORY"
```

`scripts/community-production-canary.mjs` is currently absent and not implemented; it is a Task 16 prerequisite. Any absent implementation or intentional sentinel blocks release. Do not run an ad-hoc substitute. The command must exit nonzero on a hard-limit violation, incomplete exact-ID cleanup, any zero-residue read-back residue, or evidence failure. Do not re-enable `.github/workflows/community-snapshots.yml` until cleanup and zero-residue read-back have succeeded.

## 8. exact cleanup/read-back

- [ ] Delete only by exact canary fixture IDs; never broad prefix/time-window deletion.
- [ ] Read back each exact ID and object path and assert absent.
- [ ] Record zero-residue read-back without response bodies or object content.
- [ ] If any residue remains, disable writes, preserve evidence, and start rollback/forward-fix.

## 9. snapshots re-enable/observe

- [ ] Restore `.github/workflows/community-snapshots.yml` after cleanup and verify enabled state.
- [ ] Observe one successful scheduled/manual snapshot result with no canary content.
- [ ] Confirm low-frequency attachment cleanup uses `pg_cron`/`pg_net` only after current Free Plan quota review; no keepalive behavior.
- [ ] Close approval references and record release end time.

## Go/no-go declaration

- [ ] **GO** only when sections 0–9 are complete and evidence matches the deployed revision.
- [ ] **NO-GO** on stale/missing evidence, paused/unreachable development, backup/checksum mismatch, cleanup residue, schedule restore failure, or any unapproved mutation.

## Official references

- Supabase local development: https://supabase.com/docs/guides/local-development/cli/getting-started
- Supabase backups: https://supabase.com/docs/guides/platform/backups
- Supabase CLI backup/restore: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- Supabase Storage downloads: https://supabase.com/docs/guides/storage/management/download-objects
- Supabase scheduled Functions: https://supabase.com/docs/guides/functions/schedule-functions
- Google OAuth 2.0 web server applications: https://developers.google.com/identity/protocols/oauth2/web-server
- GitHub Pages workflows: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
