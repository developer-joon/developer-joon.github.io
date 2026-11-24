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
- [ ] Chromium preflight resolves an executable (explicit `BENEFITS_CHROMIUM` if set, otherwise a supported local candidate); browser acceptance is not skipped.
- [ ] `TMPDIR` is private scratch; evidence has a run UUID and the mode-0700 per-run build/manifest directory is isolated from concurrent runs.
- [ ] Local reset/upgrade tests, pgTAP, DB lint, frontend checks, all Node script tests.
- [ ] Two fresh Docker site artifacts verify and reproduce byte-for-byte.
- [ ] Task 16 E2E passes against local Docker; no intentional sentinel remains.
- [ ] Local stack and only this run's temporary directory are cleaned; local evidence is current, run-identified, and revision-bound.
- [ ] Run the pinned Deno check/test/fmt commands for `verify-benefit-company` with injected mock transport only; confirm no local or hosted NTS request occurred.
- [ ] Confirm the NTS matrix covers pre-body origin/method/content-type/Bearer/UUID/declared-length rejection; Auth before any body pull; fake bearer plus never-closing sensitive body returning quick `401` with zero pulls; a valid current-Google session plus never-closing body bounded and cancelled at the same pre-Auth deadline; streaming byte/cancel bounds; strict current-Google timestamp evidence; exact revision matrix (pending reserve = 1; terminal reserve/finalize/failure = 2); reserve-before-NTS; terminal replay; both official endpoint decoders (`01` active, `02` suspended, `03` closed); the 8-second monotonic budget with a 6-second external cutoff and 2-second persistence margin; reserve/finalize/failure network, abort, deadline, truncated/oversized/wrong-content-type/malformed/invalid-success uncertainty and same-key retry convergence; reserve ambiguity with no invented request ID; known-ID finalize/failure ambiguity; exact bounded recognized PostgREST rejection mapping; immutable per-operation AbortSignals; fixed fetch-based Auth/reserve contracts; bounded JSON for every runtime RPC; `no-store`/`nosniff` response headers; UTF-8-byte HMAC limits; finalize/failure privacy; and reader/timer/late-promise cleanup.
- [ ] Run `node scripts/verify-benefit-claims-release.mjs`; require migrations through `202611230011`, claim/company pgTAP+dblink coverage, strict anonymous v2 decoder mutations (extra private keys and 201 claims), authenticated route inputs, and the narrow sensitive-value scanner.
- [ ] Require positive final count evidence for title upgrade, base seed importer, OpenDART importer integration, and canonical pgTAP. Missing/zero/duplicate/truncated/post-summary count output is **NO-GO**.
- [ ] Verify assembled authenticated shells for submit/my-submissions/company-request/claim/claim-reaction and all benefit admin queues; verify canonical `/benefits/` eager roles remain exactly `benefits-main`, `benefits`, `react`, and `jsx-runtime`, with no auth/mutation/admin eager dependency.
- [ ] Record readiness separately: claims/manual review local readiness; NTS mock-only local readiness; NTS hosted canary **NOT RUN** unless separately authorized; OpenDART production bundle **BLOCKED** until official source and reuse-rights authority exist.
- [ ] Do not run the composite local gate in a no-browser scope: its graph contains Chromium/local HTTP acceptance and the intentional Task 16 sentinel. Run only authorized constituents and record composite **NOT RUN / NO-GO**.

## 2. development cloud integration+cleanup

- [ ] Read-only development gate passes against the dedicated hosted development ref.
- [ ] Obtain development-only mutation approval; inspect migration dry run.
- [ ] Apply reviewed development migration and deploy the explicit Function set to `--project-ref "$DEVELOPMENT_PROJECT_REF"`.
- [ ] Separately approve and configure only the exact NTS Function names: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NTS_SERVICE_KEY`, `BUSINESS_NUMBER_HMAC_SECRET`, and `BENEFIT_COMPANY_ALLOWED_ORIGINS`; record no values.
- [ ] Confirm `verify-benefit-company` alone has its reviewed `verify_jwt = false` setting and, under one deadline created before network/body reads, performs a signal-aware fixed `/auth/v1/user` GET before body consumption, unique current-`google` identity timestamp correlation (rejecting linked-but-current-non-Google, missing, and ambiguous evidence), then a signal-aware bearer-bound fixed reserve RPC; record the GoTrue per-session-provider proof limitation and do not weaken any other Function setting.
- [ ] Do not run a real development NTS call unless a distinct authorized-canary approval, legitimate consented business case, real operator-controlled Google identity, and quota/terms review are recorded. Never fabricate identity or business fields.
- [ ] Verify the separate development Google OAuth client returns through `https://${DEVELOPMENT_PROJECT_REF}.supabase.co/auth/v1/callback`, then to `http://localhost:5173/community/auth/callback/`; confirm Kakao/GitHub remain disabled.
- [ ] Run Task 16 development cloud integration for Auth, migration, Functions, OAuth, and private Storage.
- [ ] Record every synthetic row/Auth user/object as operator-recorded fixture IDs.
- [ ] Cleanup uses exact IDs only; repeat reads/listing and record zero-residue read-back.

## 2A. Dynamic benefits directory evidence and approvals

### Local, no hosted credentials

- [ ] Start/reset local Supabase; run `db:test:benefit-title-upgrade`, `db:test:benefit-seed-importer`, `db:test`, and `db:lint` with no hosted target or credential present.
- [ ] Run `node scripts/generate-benefit-directory-seed.mjs --check`, then the independent `node scripts/verify-benefit-directory-seed.mjs`; require `40,053` actual rows and the frozen byte/ID/source digests.
- [ ] Run the OpenDART generator `--check` and independent verifier only with the reviewed official source and authority descriptor. The tracked production bundle is currently absent; synthetic fixtures never satisfy this item.
- [ ] Run `db:test:opendart-benefit-importer`; require its synthetic integration fixture to identify itself as non-production and emit final `Tests=1` only after cleanup-safe completion.
- [ ] Set loopback-only `DATABASE_URL` and trusted absolute `PSQL_BIN`; run `apply-benefit-directory-seed.mjs --dry-run`; stop and prove rollback left prior rows/publications unchanged.
- [ ] Run the normal local import separately; read back exact company count `40,053`, identity split `1,000 / 35,910 / 3,143`, and the receipt/bundle/ordered-ID/source digests. Replay is idempotent and unrelated companies/publications are unchanged.
- [ ] Run frontend check/build and the assembled-site A/B verification, browser acceptance, and reproducibility. Exact RPC keys and strict decoder rejection of `source_url`, `verified_at`, `reviewer_id`, or any other private provenance are mandatory.

### Hosted development/production, manual only

- [ ] For each target, confirm exact reviewed revision, clean tree, target-specific external backup/evidence, and three distinct approvals: migration, seed import, Pages.
- [ ] With the explicit target ref, inspect migration `db push --dry-run`; **STOP**. Migration apply requires its own approval and does not authorize seed import.
- [ ] Immediately before import, re-run the independent bundle verifier. Supply target `DATABASE_URL` only through the approved secret environment and use trusted absolute `PSQL_BIN`; never log or pass secrets as CLI literals.
- [ ] Immediately before the target seed `--dry-run`, establish the target binding by running `node scripts/assert-benefit-seed-target.mjs` with the exact lowercase 20-character `TARGET_PROJECT_REF`; require a clean exact `REVIEWED_HEAD`, target-specific evidence reference, and seed-import approval. Any absent, malformed, ambiguous, conflicting, or mismatched target binding is **NO-GO**.
- [ ] Run target seed `--dry-run`; **STOP** and inspect the sanitized rollback result. Record a distinct post-dry-run confirmation (`TARGET_SEED_APPLY_CONFIRMATION`); the earlier seed-import approval alone does not authorize normal import.
- [ ] Immediately before normal import, repeat the clean exact-HEAD/evidence/approval checks and target binding validator. A target mismatch is **NO-GO**.
- [ ] After normal import, record only exact aggregate counts and receipt digest; inspect private receipt details only through the approved DB session. Confirm idempotence and no deletion of unrelated companies/publications.
- [ ] Run bounded read-only public-RPC smoke using the publishable key: one known canonical company search/detail, `혜택 있음`, zero-evidence semantics (`공개 복지 정보 미확인`, not `복지 없음`), exact public keys, no private field names/values. Do not log key, URL query, or body.
- [ ] Require backend migration/import, receipt read-back, and public smoke before Pages. After the single approved workflow deploy, verify `/benefits`, one company deep link, and legacy query/hash redirect.
- [ ] **NO-GO:** any digest/count/revision mismatch, dirty tree, missing or reused approval, private projection leak, failed/ambiguous smoke, unrelated-row change, or dry-run/import residue.
- [ ] Recovery retains additive schema/seed and evidence: stop cutover or revert only the frontend route/link shell, disable writes if needed, preserve receipts/backups, forward-fix DB/read model, and rerun gate/smoke. Never use a destructive down/delete.
- [ ] Confirm automatic `scripts/release-gate.mjs` contains no hosted migration/import/push/deploy/canary/write; production-readiness is offline evidence aggregation only.

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
- [ ] Treat migration apply, NTS secret configuration, and `verify-benefit-company` deployment as separately approved mutations; deployment does not authorize an NTS call.
- [ ] Verify the exact HTTPS origin allow-list has no wildcard, empty member, credential, path/query/fragment, or HTTP origin; POST without `Origin` remains denied.
- [ ] Confirm safe logs contain only opaque Edge request ID, result/status class, and timing bucket—no token, body, raw business/representative/date value, NTS URL/key/detail, Supabase ref, SQL, or RPC error.
- [ ] Confirm the kill switch disables both `company_add_write_enabled` and `nts_verification_enabled`; recovery is forward-fix plus mock-only validation and fresh approvals, never manual finalize.
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
