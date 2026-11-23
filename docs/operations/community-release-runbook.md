# Community release runbook

This runbook is the operator boundary for the Free Plan community release. It assumes three isolated environments and no permanent staging environment:

| Boundary | Purpose | Required isolation |
|---|---|---|
| local Docker | Destructive, exhaustive migration, database, browser, and fixture testing | No hosted credentials; disposable local Auth, database, Functions, Storage, and test identities |
| hosted development | Internet-reachable development cloud integration | A dedicated Free project, synthetic data only, its own project ref, separate Google OAuth client, exact redirect allow-list, separate keys, separate Storage objects, and separate administrator test identity |
| production | Real users and data | A second Free project with a distinct project ref, separate Google OAuth client, exact redirect allow-list, separate keys, separate Storage, and separate test identities |

The development and production project refs must be distinct. Never repurpose production as development, never copy production credentials into local or development configuration, and never use production when development is paused.

Google is the only enabled community OAuth provider for this release. Kakao and GitHub are future providers and must remain disabled in local, hosted development, and production Auth configuration. This restriction does not affect the separate GitHub-backed giscus blog comment system.

## Roles and approval boundaries

- **Release operator:** runs non-mutating gates, gathers evidence, and executes an approved procedure.
- **Approver:** supplies a recorded approval reference for each hosted mutation, Pages deployment, and production write canary.
- **Incident lead:** may disable writes and choose forward-fix or clean-target recovery.

`scripts/release-gate.mjs` is a non-deploying gate. It never runs or invokes hosted mutation commands, `supabase db push`, Function deployment, GitHub Pages deployment, backup/restore, or a production canary. Every hosted mutation shown below is manual approval-gated and has a stop point. Read-only success does not grant write approval.

Approved company-benefit corrections follow the separate [offline-review runbook](benefit-correction-offline-review.md): immutable candidate export, independent research, normal v2 validation, artifact generation/verification, and only then a separately approved applied transition bound to the verified manifest version. The exporter never mutates a correction, ledger, or artifact.

## Operator inputs and preflight

Use the repository-pinned Supabase CLI. Values come from the environment; never put a password, access token, privileged key, OAuth secret, or connection string in a CLI literal.

```bash
export REPO_ROOT="$(git rev-parse --show-toplevel)"
: "${DEVELOPMENT_PROJECT_REF:?set the hosted development project ref}"
: "${PRODUCTION_PROJECT_REF:?set the production project ref}"
: "${DEVELOPMENT_SUPABASE_URL:?set the hosted development URL}"
: "${PRODUCTION_SUPABASE_URL:?set the production URL}"
: "${DEVELOPMENT_PUBLISHABLE_KEY:?set the development publishable key}"
: "${PRODUCTION_PUBLISHABLE_KEY:?set the production publishable key}"
[ "$DEVELOPMENT_PROJECT_REF" != "$PRODUCTION_PROJECT_REF" ] || {
  printf '%s\n' 'development and production refs must differ' >&2
  exit 1
}
case "$DEVELOPMENT_SUPABASE_URL" in
  "https://${DEVELOPMENT_PROJECT_REF}.supabase.co") ;;
  *) printf '%s\n' 'development URL/ref mismatch' >&2; exit 1 ;;
esac
case "$PRODUCTION_SUPABASE_URL" in
  "https://${PRODUCTION_PROJECT_REF}.supabase.co") ;;
  *) printf '%s\n' 'production URL/ref mismatch' >&2; exit 1 ;;
esac
./community-app/node_modules/.bin/supabase --version
```

A publishable key is public and is expected in the static browser bundle. Service-role/secret keys, database passwords, Supabase access tokens, OAuth client secrets, and user tokens are privileged and are not public. Secrets enter only through a secret manager, a hidden prompt, or a process environment. They must never appear in CLI literals, shell history, repository files, release evidence, logs, GitHub Actions artifacts, or Pages artifacts.

When database authentication is needed:

```bash
read -rsp 'Production database password: ' SUPABASE_DB_PASSWORD
printf '\n'
export SUPABASE_DB_PASSWORD
```

Unset secrets as soon as the approved operation finishes: `unset SUPABASE_DB_PASSWORD SUPABASE_ACCESS_TOKEN`.

## Free project pause and quota preflight

Before hosted development checks, make a bounded read-only health request. A timeout, DNS failure, 5xx, or a platform paused-project response is a hard stop.

```bash
curl --fail --silent --show-error --max-time 15 \
  --request GET \
  --header "apikey: $DEVELOPMENT_PUBLISHABLE_KEY" \
  --output /dev/null \
  "$DEVELOPMENT_SUPABASE_URL/rest/v1/"
```

If this is a paused project, open its Supabase Dashboard entry, choose **Resume project**, wait for healthy status, and rerun the preflight. The gate never falls back to production. Do not generate artificial keepalive traffic; this is an explicit **no artificial keepalive** rule, and ordinary development use or an operator resume is the only response.

Before enabling schedules, inspect the current Free Plan quotas and current organization usage in the Dashboard. Do not bake today’s numeric quotas into automation. Attachment cleanup may use hosted `pg_cron` plus `pg_net` at a low-frequency schedule, initially once daily, only after quota and Function behavior are verified. Quota exhaustion fails closed. Never automatically enable paid overage, upgrade a plan, or increase schedule frequency to keep a project active.

## Required promotion sequence

Use [the tested checklist](community-release-checklist.md). The immutable order is:

1. local exhaustive gate and Task 16 local E2E;
2. development migration, Functions, OAuth, Storage integration, exact fixture cleanup, and zero-residue read-back;
3. production logical backup, private Storage inventory/object backup, and capability evidence;
4. approved additive backend deployment;
5. production read-only probes;
6. Pages deployment through `.github/workflows/jekyll.yml`;
7. separately approved bounded write canary;
8. cleanup by exact IDs and zero-residue read-back;
9. re-enable scheduled snapshots and observe.

Any missing, stale, or revision-mismatched evidence is no-go.

## Local and development proof

Run local exhaustive proof from a clean revision. Task 16 must replace both intentional sentinels before a release can be green.

The gate resolves Chromium during preflight, before either site build. An explicit
`BENEFITS_CHROMIUM` path takes priority and must be an executable regular file;
otherwise the gate searches the documented `chromium`, `chromium-browser`,
`google-chrome`, and `google-chrome-stable` candidates on `PATH` plus their usual
system locations. No browser means a failed preflight, never a skipped acceptance
test. Set `TMPDIR` to the operator's private scratch filesystem when needed. Each
invocation creates its own mode-0700 run directory there, records a run UUID in
evidence, derives both builds and reproducibility manifests from that directory,
and removes only that invocation's directory during cleanup.

```bash
node scripts/release-gate.mjs --mode local \
  --evidence "${LOCAL_EVIDENCE_PATH:?set an absolute path outside the repository}"
```

After local E2E is green, run hosted development read-only gate evidence, then perform the separately approved Task 16 authenticated integration procedure. Development integration must exercise reviewed migrations, all deployed Functions, Google OAuth through the development Supabase `/auth/v1/callback`, and private Storage with synthetic fixtures only. Confirm Supabase returns to `http://localhost:5173/community/auth/callback/` and that Kakao/GitHub remain disabled.

**Development mutation stop point:** do not continue without `DEVELOPMENT_MUTATION_APPROVAL` and a reviewed revision.

```bash
: "${DEVELOPMENT_MUTATION_APPROVAL:?record development mutation approval}"
read -rsp 'Development database password: ' SUPABASE_DB_PASSWORD
printf '\n'
export SUPABASE_DB_PASSWORD
./community-app/node_modules/.bin/supabase --workdir "$REPO_ROOT" \
  db push --project-ref "$DEVELOPMENT_PROJECT_REF" --dry-run
printf '%s\n' 'STOP: compare the dry run with the reviewed additive migrations'
```

After a second explicit operator confirmation, remove `--dry-run`, then deploy each reviewed Function with an explicit ref:

```bash
: "${DEVELOPMENT_MUTATION_APPROVAL:?approval is required}"
./community-app/node_modules/.bin/supabase --workdir "$REPO_ROOT" \
  db push --project-ref "$DEVELOPMENT_PROJECT_REF"
for function_name in validate-upload cleanup-attachments public-attachment verify-benefit-company; do
  ./community-app/node_modules/.bin/supabase --workdir "$REPO_ROOT" \
    functions deploy "$function_name" --project-ref "$DEVELOPMENT_PROJECT_REF"
done
```

Task 16 records every created post, comment, attachment, Storage object path, and Auth test user as **operator-recorded fixture IDs** in private external evidence. Cleanup selects and deletes only those exact IDs; prefix-only or age-only deletion is forbidden. It then repeats the same authenticated reads and Storage listing and records a **zero-residue read-back**. A cleanup failure blocks production.

## Dynamic benefits directory

The repository bytes are the release authority for this read model: the pinned `domestic-search-index-v1` source deterministically generates `supabase/fixtures/benefit-directory`. The tracked manifest is descriptive, not authority. The public contract is the exact-key PostgreSQL RPC projection and the frontend's strict anonymous decoder. Source URL, observation/review dates, reviewer identity, and other provenance stay private; official and community-reviewed labels must remain distinct. Any private field such as `source_url`, `verified_at`, or `reviewer_id` in an anonymous response is a release stop.

### Local proof (no hosted credentials)

Use only the loopback database and a trusted absolute `psql` executable. Do not set a hosted ref, hosted URL, publishable key, access token, or hosted `DATABASE_URL` in this shell.

```bash
npm --prefix community-app run db:start
npm --prefix community-app run db:reset
npm --prefix community-app run db:test:benefit-title-upgrade
npm --prefix community-app run db:test:benefit-seed-importer
npm --prefix community-app run db:test
npm --prefix community-app run db:lint
node scripts/generate-benefit-directory-seed.mjs --check
node scripts/verify-benefit-directory-seed.mjs

export DATABASE_URL="${LOCAL_DATABASE_URL:?set the loopback-only local database URL}"
export PSQL_BIN='/trusted/absolute/path/to/psql'
node scripts/apply-benefit-directory-seed.mjs --dry-run
printf '%s\n' 'STOP: dry-run must roll back; inspect the unchanged pre-import counts'
node scripts/apply-benefit-directory-seed.mjs
npm --prefix community-app run check
npm --prefix community-app run build
```

The dry run executes the full import and then rolls back; it is not the normal local import. After the normal import, perform the bounded scalar read-back in [the seed-import runbook](benefit-directory-seed-import.md#read-back-checks): exact company count `40,053`, identity split `1,000 / 35,910 / 3,143`, and one receipt bound to the bundle digest, ordered-ID digest, and pinned source digest. Re-running the import must be idempotent and must not delete or rewrite unrelated companies or publications. The local release gate then runs the frontend strict-decoder tests, frontend build, two assembled-site builds, independent site verification for A and B, browser acceptance, and reproducibility. Do not continue if the RPC key assertions or private-field rejection test fails.

### Hosted development and production (manual only)

For each target, start from the exact reviewed revision and a clean tree. Record a separate target, external backup/evidence reference, and approval for (1) migration, (2) seed import, and (3) Pages. Reverify the bundle with `node scripts/verify-benefit-directory-seed.mjs` immediately before import. Never place a password, connection string, publishable key, or other secret in a CLI argument, document, log, or evidence record; the placeholders below are environment values supplied through the approved secret mechanism.

**Hosted migration stop point:** inspect a dry run against the explicit target ref, then stop. Apply only after the migration approval is recorded.

```bash
: "${TARGET_PROJECT_REF:?set the separately approved target ref}"
: "${TARGET_MIGRATION_APPROVAL:?record migration approval}"
./community-app/node_modules/.bin/supabase --workdir "$REPO_ROOT" \
  db push --project-ref "$TARGET_PROJECT_REF" --dry-run
printf '%s\n' 'STOP: approve the reviewed migration independently of seed import'
```

**Hosted seed-import stop point:** migration success does not authorize import. Obtain a distinct import approval, export the target `DATABASE_URL` through the secret mechanism, set `PSQL_BIN` to a trusted absolute executable, and bind the connection to the exact target before each importer call. `TARGET_PROJECT_REF` is a lowercase 20-character sequence of letters or digits. The validator accepts the canonical direct host `db.<ref>.supabase.co` or canonical pooler username `postgres.<ref>`; if both identifiers are present they must agree. It reads environment values only and never prints or logs `DATABASE_URL`, credentials, or its URL components.

```bash
set -euo pipefail
: "${TARGET_PROJECT_REF:?set the separately approved target ref}"
: "${REVIEWED_HEAD:?set the exact reviewed 40-character lowercase commit}"
: "${TARGET_SEED_IMPORT_APPROVAL:?record seed import approval}"
: "${TARGET_SEED_IMPORT_EVIDENCE_REF:?record target-specific external backup/evidence reference}"
: "${DATABASE_URL:?supplied by the approved secret mechanism}"
: "${PSQL_BIN:?set a trusted absolute psql path}"

assert_seed_import_target() {
  test "$(git rev-parse --show-toplevel)" = "$REPO_ROOT"
  test -z "$(git status --porcelain)"
  test "$(git rev-parse HEAD)" = "$REVIEWED_HEAD"
  test "${#REVIEWED_HEAD}" -eq 40
  : "${TARGET_SEED_IMPORT_APPROVAL:?seed import approval is required}"
  : "${TARGET_SEED_IMPORT_EVIDENCE_REF:?target evidence reference is required}"
  node scripts/assert-benefit-seed-target.mjs
}

node scripts/verify-benefit-directory-seed.mjs
assert_seed_import_target
node scripts/apply-benefit-directory-seed.mjs --dry-run
printf '%s\n' 'STOP: dry-run rolled back; inspect its sanitized result and obtain a distinct apply confirmation'
: "${TARGET_SEED_APPLY_CONFIRMATION:?record the post-dry-run confirmation for normal import}"
assert_seed_import_target
node scripts/apply-benefit-directory-seed.mjs
```

A missing, malformed, ambiguous, conflicting, or mismatched target binding is a hard stop. The normal import's `TARGET_SEED_APPLY_CONFIRMATION` is distinct from the earlier seed-import approval and may be recorded only after the dry-run result is reviewed.

Record only the receipt digest and exact aggregate counts. Read private receipt details only through the approved database session. The import is idempotent and does not delete unrelated companies or publications.

Run a bounded read-only smoke through the public RPC with only that target's publishable key: search one known canonical company, fetch its detail, exercise the `혜택 있음` filter, and verify zero-evidence semantics mean `공개 복지 정보 미확인`, never `복지 없음`. The operator inspects only a sanitized exact-key/count result. Never log the key, URL query, response body, company row, private field name values, or provenance. Require private field names and values to be absent and preserve the public `공식 확인` versus `사용자 제보` labeling.

### Navigation cutover and recovery

Backend migration, separately approved import, receipt read-back, and public smoke all precede Pages. Deploy Pages only once through `.github/workflows/jekyll.yml`. After deployment, verify canonical `/benefits`, one canonical company deep link, and the legacy query/hash redirect.

There is no destructive seed/schema down or bulk delete. A failed dry-run or failed import transaction must leave prior companies, sources, receipts, and publications unchanged. If the public read model is wrong, stop Pages/cutover or revert the frontend link/shell to the prior reviewed revision while disabling writes if needed; preserve receipts, backups, and evidence; forward-fix the database/read model; then rerun the gate and smoke. Backend forward-fix is distinct from frontend route rollback.

`scripts/release-gate.mjs` never applies a hosted migration or seed, runs `db push`, deploys a Function or Pages, executes a canary, or writes to a hosted resource. Production-readiness remains revision-bound offline evidence aggregation.

## NTS full business verification Function

`verify-benefit-company` is a browser POST endpoint. Its gateway setting is
`verify_jwt = false` by design: the handler bounds the bearer value and calls
Supabase Auth `getUser` with `SUPABASE_URL` and `SUPABASE_ANON_KEY`. A current
Google sign-in requires exactly one returned identity whose validated
`last_sign_in_at` instant equals the returned user's `last_sign_in_at`, and that
identity must have provider `google`; missing timestamps, ambiguous matches, and
a newer linked non-Google identity fail closed. `app_metadata.provider` and
caller-decoded JWT claims are not evidence. GoTrue does not expose a separate
cryptographic per-session provider proof through this `getUser` response, so
this strict server-validated timestamp correlation is the strongest available
evidence and retains a dependency on GoTrue's identity timestamp semantics.
The same bearer transport is used for `reserve_benefit_company_nts_request_v1`;
a caller-supplied user ID is never accepted. The service-role client is separate
and is used only for exact finalize/failure RPCs after reservation. One 8-second
monotonic budget is split into phases: authentication, reservation, both NTS
fetch/stream/strict-decode operations, and HMAC must finish before the 6-second
external cutoff. The final 2 seconds are reserved for persistence. Every
transport receives its own AbortSignal; active response readers and timers are
cancelled/cleared when their phase ends. If external verification reaches the
cutoff after reservation, finalize is never invoked: the Function persists the
exact revision-2 `rejected/unavailable` terminal result inside the reserved
margin before returning the normal safe unavailable response. A failure-RPC
transport timeout returns `503 verification_indeterminate`, because aborting
HTTP cannot prove whether the database committed.

Finalize may start only before the external cutoff and uses the reserved
persistence margin. A finalize transport timeout returns bounded
`202 verification_indeterminate` with only the safe code, request ID, and fixed
Korean retry copy; it never claims that a company was or was not created. HTTP
abort is transport cancellation, not transaction rollback. Retry the exact same payload
with the same idempotency key: reserve terminal replay returns revision-2
success without another NTS call if finalize committed, while a still-pending
reservation safely retries verification. Pending reserve responses must be
exactly revision 1; every terminal reserve replay, finalize response, and
failure response must be exactly revision 2. Any impossible state/revision
combination fails closed.

Configure these exact secret names through the target's approved secret manager;
never put their values in this repository, shell history, release evidence, a
browser bundle, or logs:

- `SUPABASE_URL` (the HTTPS project origin, accepted with or without one trailing
  slash; credentials, path, query, and fragment are rejected)
- `SUPABASE_ANON_KEY` (or the target's compatible publishable key value)
- `SUPABASE_SERVICE_ROLE_KEY`
- `NTS_SERVICE_KEY` (the decoded key value; the Function percent-encodes it once
  when constructing each fixed NTS URL)
- `BUSINESS_NUMBER_HMAC_SECRET` (32 to 8,192 UTF-8 bytes, independently generated
  per environment)
- `BENEFIT_COMPANY_ALLOWED_ORIGINS` (one to ten comma-separated, exact HTTPS
  origins; no wildcard, credentials, path, query, fragment, empty member, or
  non-HTTPS development origin)

The endpoint requires an `Origin` header even on POST and accepts only the exact
configured allow-list. It requires `Authorization: Bearer ...`, canonical UUID
`Idempotency-Key`, and `application/json`. Business numbers accept exactly ten
digits or the user form `NNN-NN-NNNNN`; the NTS transport receives digits only.
Opening dates are exact `YYYYMMDD` calendar dates. The NTS outbound verification
requires all four submitted identity values: business number, opening date,
representative name, and business name. Public responses and logs include none
of those four. The reserve/finalize database boundary may persist the proposed
business name as the company field (plus bounded optional region, industry, and
website); that company name is not classified as a sensitive DB field. It must
never persist the raw business number, opening date, or representative name.
The only persistent strong identifier is lower-case
`HMAC-SHA-256(BUSINESS_NUMBER_HMAC_SECRET,
"breadlab:business-number:v1\\0" + ten_digits)`.

Origin, method, content type, bounded Bearer syntax, and canonical idempotency
UUID are rejected before the first request-body pull. The absolute request
deadline starts before body consumption; each body read and every Auth, reserve,
NTS, finalize, and failure transport receives an operation-local AbortSignal.
Auth uses only the fixed `/auth/v1/user` endpoint, and reserve uses only the
fixed PostgREST RPC endpoint; neither relies on an SDK call that drops the
signal. All transport JSON, including finalize/failure responses, is content-
type checked and byte bounded. Every response is `no-store` and `nosniff`, and
CORS is returned only for an allowed origin.

Local validation is mock-only and must use the injected transport in
`index.test.ts`; do not set an NTS key and do not make a real NTS request. Run:

```bash
npx --yes deno@2.9.6 check --lock=deno.lock --frozen-lockfile \
  supabase/functions/verify-benefit-company/index.ts \
  supabase/functions/verify-benefit-company/index.test.ts
npx --yes deno@2.9.6 test --allow-env --allow-read \
  --lock=deno.lock --frozen-lockfile \
  supabase/functions/verify-benefit-company/index.test.ts
npx --yes deno@2.9.6 fmt --check supabase/functions
```

Migration apply, Function secret configuration, and Function deployment are
three separate hosted mutations and require target-specific approvals. A deploy
success does not authorize an NTS request. After deployment, begin with
configuration/read-only checks that do not submit identity data. A real NTS
canary requires a separate recorded approval, a legitimate operator-controlled
Google identity, a legally authorized real business verification case, the
business owner's consent where required, and current NTS terms/quota review.
Never fabricate a person, representative, opening date, Google identity, or
business record for a canary. Record only safe status classes, timing buckets,
and the opaque Edge request ID; never retain request/response bodies, bearer
tokens, URLs containing the NTS service key, raw NTS details, or RPC errors.

Kill switch: set both private feature flags `company_add_write_enabled` and
`nts_verification_enabled` to disabled through a separately approved database
operation; either flag makes reserve/finalize/failure fail closed. Also remove
the Function route or its NTS secret only through an approved incident change.
On NTS errors, malformed responses, timeout, status uncertainty, failure-RPC
failure, or quota exhaustion, leave verification unavailable/rejected and do
not manually finalize. Preserve sanitized evidence, disable the two write flags,
forward-fix, rerun mock-only local tests, redeploy under fresh approval, and use
the same idempotency key only for the exact same safe company payload. Do not
claim JavaScript string zeroization; the handler only drops references and wipes
mutable byte buffers where practical.

Abort is a bounded local observation, not proof that a dispatched remote write
did not commit. In particular, a reserve timeout is returned as reservation
indeterminate; retry only the identical safe payload with the same idempotency
key. Finalize/failure timeout responses likewise describe uncertainty and must
not be reported as “no request” or “no write.”

## Production backend, probes, Pages, and canary

First complete [backup and recovery evidence](community-backup-restore.md). Only additive migrations are allowed. There is no destructive down migration: disable writes and forward-fix instead.

**Production mutation stop point:** require a distinct production backend approval and compare the dry run before applying anything.

```bash
: "${PRODUCTION_BACKEND_APPROVAL:?record production backend approval}"
read -rsp 'Production database password: ' SUPABASE_DB_PASSWORD
printf '\n'
export SUPABASE_DB_PASSWORD
./community-app/node_modules/.bin/supabase --workdir "$REPO_ROOT" \
  db push --project-ref "$PRODUCTION_PROJECT_REF" --dry-run
printf '%s\n' 'STOP: approve the reviewed additive migration set before applying'
```

After approval, apply the same reviewed revision and explicit Function set:

```bash
: "${PRODUCTION_BACKEND_APPROVAL:?approval is required}"
./community-app/node_modules/.bin/supabase --workdir "$REPO_ROOT" \
  db push --project-ref "$PRODUCTION_PROJECT_REF"
for function_name in validate-upload cleanup-attachments public-attachment verify-benefit-company; do
  ./community-app/node_modules/.bin/supabase --workdir "$REPO_ROOT" \
    functions deploy "$function_name" --project-ref "$PRODUCTION_PROJECT_REF"
done
unset SUPABASE_DB_PASSWORD
```

The production read-only probe is strictly separate from the approved write canary. It uses only GET/HEAD and the production publishable key:

```bash
curl --fail --silent --show-error --max-time 15 \
  --request GET \
  --header "apikey: $PRODUCTION_PUBLISHABLE_KEY" \
  --output /dev/null \
  "$PRODUCTION_SUPABASE_URL/rest/v1/"
```

Deploy Pages only from the reviewed source commit through `.github/workflows/jekyll.yml` and verify the workflow’s source revision and artifact evidence. Do not upload a hand-edited artifact.

Before the write canary, obtain a new, separate approval. Disable `.github/workflows/community-snapshots.yml` so a scheduled export cannot publish transient canary content. Do not re-enable it until the canary command has completed exact-ID cleanup and a zero-residue read-back:

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

`scripts/community-production-canary.mjs` is currently absent and not implemented. It is a fail-closed Task 16 prerequisite, not a command that works today, and the production release remains blocked until Task 16 supplies it and local/development evidence validates it. Do not replace the missing command with ad-hoc production `curl`, SQL, Dashboard writes, or an implied manual equivalent.

The required Task 16 implementation accepts the non-secret target, dedicated test-identity ID, UUID/prefix, evidence path, hard limits, and explicit approval token only through the environment shown above; no secrets may appear in arguments or evidence. Authentication material must come from Task 16's reviewed hidden-input/credential mechanism. The implementation must reject any limit other than one and machine-enforce at most one post, one comment, one reaction, one report, and one private Storage object. Every successful write must return and record its post ID, comment ID, reaction ID, report ID, attachment ID if created, and exact object ID/path. The evidence path must resolve outside the repository and contain no bodies, object bytes, credentials, raw URLs, or real-user data.

The command must perform cleanup only by those returned exact IDs, repeat reads/listing for every exact row and object, and exit nonzero if the zero-residue read-back finds any residue or if cleanup/evidence publication fails. The shell's `set -e` therefore prevents snapshot re-enable after any canary failure. Re-enable is allowed only after exact-ID cleanup, zero-residue read-back, successful external evidence publication, and command exit zero. If cleanup or workflow re-enable fails, keep writes disabled, declare the release incomplete, and follow [rollback](community-rollback.md).

## Records and incident communication

Store evidence outside the repository with UTC timestamps, Git revision, non-secret project-ref hash, approval reference, named step statuses, backup/archive hashes, exact synthetic fixture IDs, and cleanup/read-back status. Do not include raw project refs, URLs, credentials, user data, request/response bodies, or object content.

Incident record: detection time, operator/approver, revision, affected boundary, write-disable time, first failing check, selected forward-fix/recovery path, backup evidence reference, known-good Pages commit, verification result, and next update time.

## Official references

- Supabase local CLI: https://supabase.com/docs/guides/local-development/cli/getting-started
- Supabase Auth redirect URLs: https://supabase.com/docs/guides/auth/redirect-urls
- Supabase Google Auth: https://supabase.com/docs/guides/auth/social-login/auth-google
- Supabase Functions deployment: https://supabase.com/docs/guides/functions/deploy
- Scheduled Functions with `pg_cron`/`pg_net`: https://supabase.com/docs/guides/functions/schedule-functions
- Supabase Free project pausing: https://supabase.com/docs/guides/platform/free-project-pausing
- Google OAuth 2.0 web server applications: https://developers.google.com/identity/protocols/oauth2/web-server
- GitHub Pages custom workflows: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
