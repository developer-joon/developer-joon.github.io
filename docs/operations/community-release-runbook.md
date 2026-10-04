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
for function_name in validate-upload cleanup-attachments public-attachment; do
  ./community-app/node_modules/.bin/supabase --workdir "$REPO_ROOT" \
    functions deploy "$function_name" --project-ref "$DEVELOPMENT_PROJECT_REF"
done
```

Task 16 records every created post, comment, attachment, Storage object path, and Auth test user as **operator-recorded fixture IDs** in private external evidence. Cleanup selects and deletes only those exact IDs; prefix-only or age-only deletion is forbidden. It then repeats the same authenticated reads and Storage listing and records a **zero-residue read-back**. A cleanup failure blocks production.

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
for function_name in validate-upload cleanup-attachments public-attachment; do
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
