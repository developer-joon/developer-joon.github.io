# Community attachment cleanup runbook

## Runtime contract

`cleanup-attachments` is a service-only Supabase Edge Function. It accepts
`POST` only, sends no browser CORS headers, and requires the exact service-role
token in `Authorization: Bearer …`. Never put the service-role key in browser
code, Pages configuration, URLs, command tracing, or logs.

Each invocation claims at most 20 rows and processes at most 5 concurrently.
Each row is atomically prepared as `deleting` only after its current cleanup
eligibility is revalidated, then Storage removal runs, then token-bound
completion marks it deleted. Prepare, Storage removal, completion, and release
each have a 15-second deadline. With four concurrency waves, the conservative
failure path is at most `4 × 4 × 15s = 240s`, below the database's five-minute
lease. Timed-out RPCs receive an abort signal. The Storage client removal itself
is not abortable: after its local timeout it may still finish. A prepared row
therefore remains `deleting` across release/reclaim and its path cannot be
replayed or reattached; a late removal cannot delete a replacement upload.
The successful prepare is the irreversible retention boundary. Product or
moderation restore flows must run before that boundary and must refuse to
restore posts whose attachments are already `deleting` or `deleted`; Task 4
does not expose a post-restore mutation.

Function logs contain only request ID, bounded result name, and duration. Do not
add storage paths, claim tokens, authorization headers, service keys, or raw
provider errors.

## Required configuration

The deployed function and the scheduler require:

- `SUPABASE_URL`: target Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: service-role JWT for the same project.

`validate-upload` also accepts `UPLOAD_ALLOWED_ORIGINS`. If it is absent or
empty, the exact defaults are only `https://breadlab.ai` and
`https://www.breadlab.ai`. A nonempty value **replaces** those defaults; it does
not extend them. Configure each deployment with a comma-separated list of exact
origins (scheme, host, and port), with no wildcard or trailing path. Examples:

- production default: leave it unset, or set
  `https://breadlab.ai,https://www.breadlab.ai` explicitly;
- staging: `https://staging.breadlab.ai`;
- local function development: `http://localhost:5173` (add another exact local
  origin only when that client is actually used).

Do not add localhost to a production deployment. Origin configuration contains
no credentials; service-role and other keys remain secrets.

Create separate GitHub Environments named `staging` and `production`. Define
both secrets independently in each Environment and restrict who can edit the
production secrets. Never reuse a project URL/key pair across environments. The
hourly schedule targets `production`; `workflow_dispatch` defaults to `staging`
and allows an explicit environment choice. Required-reviewer rules pause every
scheduled production run, so do not enable them unless that manual gate is
intentional.

Deploy `cleanup-attachments` to each Supabase project before enabling its
scheduler secrets. This workflow does not build, modify, or deploy GitHub Pages.

## Schedule and overlap behavior

`.github/workflows/community-attachment-cleanup.yml` invokes the deployed
endpoint hourly at minute 17. It has empty repository permissions, a five-minute
job timeout, a 270-second HTTP timeout, and an environment-specific concurrency
group with `cancel-in-progress: false`. A delayed run therefore does not overlap
or cancel an active run for the same environment.

GitHub masks configured secrets, but the workflow also avoids shell tracing and
keeps the response only in a temporary file. It validates the exact JSON shape,
the invariant `claimed = deleted + skipped + failed`, prints only those four
numeric counts, and fails only when `failed` is nonzero (including an HTTP `207`
partial result). Keep credentials in GitHub Environment secrets,
not repository files or workflow arguments.

## Manual smoke test

Use the staging project first. The commands below avoid command-line secret
assignment and shell tracing:

```bash
export SUPABASE_URL="https://STAGING_PROJECT_REF.supabase.co"
read -rsp "Staging service-role key: " SUPABASE_SERVICE_ROLE_KEY && echo
export SUPABASE_SERVICE_ROLE_KEY
curl --silent --show-error \
  --output /tmp/community-cleanup-response.json \
  --write-out 'HTTP %{http_code}\n' \
  --request POST \
  --header "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  --header "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  "${SUPABASE_URL%/}/functions/v1/cleanup-attachments"
unset SUPABASE_SERVICE_ROLE_KEY
```

Expected status is `200` when every claimed row is either deleted or safely
skipped because eligibility changed, or `207` when one or more rows failed and
were released for retry. Confirm that the JSON contains only `claimed`,
`deleted`, `skipped`, and `failed`, and that their counts balance; then delete
the temporary response. A `403`
means the URL/key pair is wrong, and `500 server_misconfigured` means the
deployed function lacks a required runtime variable.

After staging succeeds, manually dispatch the workflow against `staging`,
inspect the Actions status and Supabase function logs, then repeat against
`production` with approval. Do not print either secret while troubleshooting.

## Monitoring and recovery

- Alert on workflow failures, repeated `partial_failure`, or rows reaching
  `cleanup_failed` after five releases.
- Correlate a request with the `x-request-id` response header and the function's
  structured log; do not log attachment paths or tokens.
- `eligibility_changed` is a safe skip: it clears only the exact active lease
  and does not change status, attempts, backoff, or the last failure. The other
  bounded reasons (`prepare_timeout`, `prepare_failed`,
  `storage_remove_timeout`, `storage_remove_failed`, `completion_timeout`, and
  `completion_failed`) are retryable failures and consume an attempt.
- A storage `404` is idempotent success: cleanup still attempts token-bound
  completion.
- On transient failure, leave retry timing to `release_attachment_cleanup`; do
  not manually clear tokens while a lease is active.
- For credential rotation, update the matching Supabase project and GitHub
  Environment together, run the staging smoke test, and revoke the old key.

## Legacy Storage ownership boundary

A local controller probe against the running Supabase service-role Storage REST
API confirmed that a service upload writes both `storage.objects.owner` and
`storage.objects.owner_id` as `NULL`. That is expected trusted-client behavior,
not evidence that the application user owns the object. Do not infer ownership
from a UUID-shaped path or its first component.

New managed uploads remain attributable because `validate-upload` first creates
an attachment intent containing `owner_id`, `client_key`, `payload_sha256`, and
the exact `storage_path`. Once attached, that correlated row is the read
authority; an ownerless Storage row is acceptable only on this managed branch.
Legacy rows lack that identity. Existing legacy objects are automatically read
or cleaned only when at least one Storage owner field is populated and every
populated field agrees with the attachment owner. Existing ownerless, foreign,
or conflicting legacy objects are excluded from cleanup claims and rechecked at
prepare time.

Before any deployed legacy backfill or orphan deletion:

1. Inventory exact `(bucket_id, name)` objects and exact attachment rows in the
   target environment; classify missing, ownerless, singly owned, consistently
   owned, and conflicting ownership separately.
2. Establish an evidence-based object-to-user mapping from authoritative
   application records or retained upload audit data. A path prefix, filename,
   post author alone, or service-role upload event is not ownership evidence.
3. Export the affected rows and record the evidence source, scope, reviewer,
   and rollback procedure. Test the exact mapping in staging first.
4. Backfill only explicitly reviewed exact object mappings. Never run a blanket
   prefix-derived owner update. Re-query for conflicts before enabling reads or
   cleanup.
5. Delete an ownerless orphan manually only after proving it has no attachment
   or other retained reference and recording that evidence. Ambiguous objects
   remain quarantined for manual review; automation must not delete them.

## Local CORS caveat

The local Supabase gateway can answer browser preflight with a wildcard
`Access-Control-Allow-Origin`; that gateway response differs from function
behavior. For the browser upload function, the `POST` origin allow-list check is
the enforcement boundary. Supabase's local Kong gateway can answer `OPTIONS` and
append `Access-Control-Allow-Origin: *` before or after the function response;
do not use that header alone as the security assertion. Probe an authenticated
or gateway-valid `POST`: a disallowed origin must return `403 origin_forbidden`
before authentication, reservation, or body parsing. The cleanup function
remains service-only: it emits no browser CORS headers from application code,
rejects non-`POST` methods that reach it, and requires the service-role token on
`POST`.

## Local storage migration upgrade gate

The migration-003 upgrade fixture intentionally lives in
`supabase/fixtures/storage-upgrade`, outside the recursively discovered
`supabase/tests` database suite. Run the exact focused gate from the app
directory:

```bash
cd community-app
npm run db:test:storage-upgrade
npx --yes supabase@2.118.0 migration list --local
```

The first command must report `Tests=13` with `Result: PASS`. The migration list
checks only the local database and must show local migration `202609260003`
applied. It does not establish remote deployment state. Verify staging and
production migration status in the deployment pipeline or Supabase dashboard
for the linked project before enabling the scheduler; do not report a remote
check based on `--local`. On every successful run, the script resets the local
database to the latest schema with `--no-seed`, so later focused tests do not
inherit the destructive legacy fixture. If migration 003 itself fails, EXIT
cleanup first attempts that same latest reset and then falls back to a clean
migration-002 database; the script still exits with the original migration/test
failure status rather than hiding it. Fix the migration and rerun the gate to
restore and verify the latest state.

## Legacy classification query and alert thresholds

Run this read-only inventory as a role that can read both tables. It classifies
only legacy attachment rows and never infers ownership from a path:

```sql
select classification, count(*) as attachment_count
from (
  select a.id,
    case
      when o.name is null then 'missing'
      when o.owner is null and o.owner_id is null then 'ownerless_blocked'
      when o.owner is not null and o.owner_id is not null
       and o.owner::text <> o.owner_id then 'conflicting_blocked'
      when (o.owner is not null and o.owner <> a.owner_id)
        or (o.owner_id is not null and o.owner_id <> a.owner_id::text)
        then 'foreign_blocked'
      else 'consistent_owned'
    end as classification
  from public.attachments a
  left join storage.objects o
    on o.bucket_id = 'community-images'
   and o.name collate "C" = a.storage_path collate "C"
   and o.archived_at is null
  where a.client_key is null and a.payload_sha256 is null
) inventory
group by classification
order by classification;
```

Run it daily and after every migration/backfill. Page immediately if
`conflicting_blocked` increases, alert within one business day if
`ownerless_blocked + foreign_blocked` increases, and investigate any
`cleanup_failed` row or hourly cleanup run with `failed > 0`. Review stable
blocked counts weekly until they reach zero or have a documented retention
decision.

For an evidence-approved exact mapping, stage rows in a temporary table and use
this transaction skeleton. Replace the example values only with reviewed exact
object names and owner UUIDs. The count guard makes a scope mistake roll back;
leave the final `ROLLBACK` in place for rehearsal, then change only that last
statement to `COMMIT` after staging review.

```sql
begin;
create temporary table approved_legacy_owner_map(
  object_name text primary key,
  owner_id uuid not null,
  evidence_ticket text not null
) on commit drop;
insert into approved_legacy_owner_map values
  ('EXACT/OBJECT/NAME.png','00000000-0000-0000-0000-000000000000','TICKET-000');

do $$
declare expected_count constant integer := 1;
        mapping_count integer;
        updated_count integer;
begin
  select count(*) into mapping_count from approved_legacy_owner_map;
  if mapping_count <> expected_count then
    raise exception 'mapping row-count guard: expected %, got %',
      expected_count, mapping_count;
  end if;
  if exists (
    select 1 from approved_legacy_owner_map m
    where (select count(*) from public.attachments a
           where a.storage_path collate "C"=m.object_name collate "C"
             and a.owner_id=m.owner_id
             and a.client_key is null and a.payload_sha256 is null) <> 1
       or (select count(*) from storage.objects o
           where o.bucket_id='community-images'
             and o.name collate "C"=m.object_name collate "C"
             and o.archived_at is null
             and o.owner is null and o.owner_id is null) <> 1
  ) then
    raise exception 'exact attachment/object evidence guard failed';
  end if;

  update storage.objects o
     set owner = m.owner_id, owner_id = m.owner_id::text
    from approved_legacy_owner_map m
   where o.bucket_id = 'community-images'
     and o.name collate "C" = m.object_name collate "C"
     and o.archived_at is null
     and o.owner is null and o.owner_id is null;
  get diagnostics updated_count = row_count;
  if updated_count <> expected_count then
    raise exception 'backfill row-count guard: expected %, updated %',
      expected_count, updated_count;
  end if;
end $$;

select o.bucket_id,o.name,o.owner,o.owner_id,m.evidence_ticket
from storage.objects o
join approved_legacy_owner_map m
  on o.bucket_id='community-images'
 and o.name collate "C"=m.object_name collate "C"
 and o.archived_at is null
where o.owner=m.owner_id and o.owner_id=m.owner_id::text;
rollback;
```

## Staging-first release gate

The following commands were checked against installed Supabase CLI `2.118.0`.
Commands marked **REMOTE WRITE** must be run by an operator and were not run
while preparing this change.

```bash
cd /path/to/developer-joon-community-design

# Local Edge gate, locked to deno.lock and the reviewed Deno release.
npx --yes deno@2.9.6 check --lock=deno.lock --frozen-lockfile \
  supabase/functions/validate-upload/index.ts \
  supabase/functions/validate-upload/index.test.ts \
  supabase/functions/cleanup-attachments/index.ts \
  supabase/functions/cleanup-attachments/index.test.ts
npx --yes deno@2.9.6 test --allow-env --allow-read \
  --lock=deno.lock --frozen-lockfile \
  supabase/functions/validate-upload/index.test.ts \
  supabase/functions/cleanup-attachments/index.test.ts
npx --yes deno@2.9.6 fmt --check supabase/functions

# REMOTE WRITE: link staging, then confirm the target before any other write.
npx --yes supabase@2.118.0 link --project-ref "$STAGING_PROJECT_REF"
npx --yes supabase@2.118.0 projects list
npx --yes supabase@2.118.0 migration list --linked

# Read-only migration preview, then REMOTE WRITE apply, then confirmation.
npx --yes supabase@2.118.0 db push --linked --dry-run
npx --yes supabase@2.118.0 db push --linked                 # REMOTE WRITE
npx --yes supabase@2.118.0 migration list --linked

# REMOTE WRITE: exact staging CORS configuration; no wildcard or production URL.
printf 'UPLOAD_ALLOWED_ORIGINS=https://staging.breadlab.ai\n' > /tmp/staging-upload.env
npx --yes supabase@2.118.0 secrets set --env-file /tmp/staging-upload.env  # REMOTE WRITE
rm -f /tmp/staging-upload.env
npx --yes supabase@2.118.0 secrets list

# REMOTE WRITE: deploy each reviewed function explicitly.
npx --yes supabase@2.118.0 functions deploy validate-upload       # REMOTE WRITE
npx --yes supabase@2.118.0 functions deploy cleanup-attachments  # REMOTE WRITE
npx --yes supabase@2.118.0 functions list
```

Do not proceed to production until staging migration status, both function list
entries, CORS `OPTIONS`/authenticated `POST`, and the cleanup smoke test are
confirmed. Repeat the same sequence only after linking and independently
confirming the production project ref.

## Dependency lock and upgrade gate

Root `deno.lock` covers the two Edge sources and two test entrypoints. CI and
deploy preparation must use `--lock=deno.lock --frozen-lockfile`; a lock drift is
a failed build, not an implicit update. Runtime imports remain pinned in source
(including `@supabase/supabase-js@2.117.0`, `@jsquash/jpeg@1.6.0`,
`@jsquash/png@3.1.1`, and `@jsquash/webp@1.5.0`). Dependency upgrades require a
separate reviewed change: update one dependency family, regenerate the lock with
the approved Deno CLI, inspect the lock diff for unexpected packages or scripts,
then rerun locked check/test/fmt, storage pgTAP, migration-upgrade, and the
5,001-row claim EXPLAIN fixture before deployment.
