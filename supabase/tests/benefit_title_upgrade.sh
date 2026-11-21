#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cli="$repo_root/community-app/node_modules/.bin/supabase"
db_container="supabase_db_developer-joon-community-design"
fixture_root="$repo_root/supabase/fixtures/benefit-title-upgrade"
writer_app="benefit-title-legacy-writer"
migration_app="benefit-title-migration-003"
writer_pid=""
migration_pid=""
writer_fd=""
writer_fifo=""
writer_log=""
migration_log=""

psql_query() {
  docker exec "$db_container" psql -X -Aqt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "$1"
}

wait_for_sql() {
  local expected="$1" query="$2" description="$3"
  local attempt actual
  for attempt in {1..100}; do
    actual="$(psql_query "$query")"
    if [[ "$actual" == "$expected" ]]; then return 0; fi
    sleep 0.1
  done
  printf 'timed out waiting for %s (last value: %s)\n' "$description" "$actual" >&2
  return 1
}

wait_for_process() {
  local pid="$1" description="$2"
  if ! timeout 15s tail --pid="$pid" -f /dev/null; then
    printf 'timed out waiting for %s\n' "$description" >&2
    return 1
  fi
  wait "$pid"
}

cleanup() {
  original_status=$?
  trap - EXIT
  set +e
  if [[ -n "$writer_fd" ]]; then
    printf '\\q\n' >&"$writer_fd"
    eval "exec ${writer_fd}>&-"
  fi
  [[ -z "$writer_pid" ]] || kill "$writer_pid" 2>/dev/null
  [[ -z "$migration_pid" ]] || kill "$migration_pid" 2>/dev/null
  [[ -z "$writer_pid" ]] || wait "$writer_pid" 2>/dev/null
  [[ -z "$migration_pid" ]] || wait "$migration_pid" 2>/dev/null
  rm -f "$writer_fifo" "$writer_log" "$migration_log"
  "$cli" db reset --local --no-seed >/dev/null
  cleanup_status=$?
  if (( original_status != 0 )); then exit "$original_status"; fi
  exit "$cleanup_status"
}
trap cleanup EXIT

"$cli" db reset --local --version 202611210002 --no-seed
docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < "$fixture_root/seed.sql"
"$cli" migration up --local
docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < "$fixture_root/assertions.sql"

"$cli" db reset --local --version 202611210002 --no-seed
docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < "$fixture_root/seed.sql"

writer_fifo="$(mktemp)"
rm -f "$writer_fifo"
writer_log="$(mktemp)"
migration_log="$(mktemp)"
mkfifo "$writer_fifo"
exec {writer_fd}<>"$writer_fifo"
docker exec -i -e "PGAPPNAME=$writer_app" "$db_container" \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres <"$writer_fifo" >"$writer_log" 2>&1 &
writer_pid=$!
cat >&"$writer_fd" <<'SQL'
begin;
insert into public.benefit_publications(
  publication_id,company_id,category_id,title,description,eligibility_text,condition_text,
  trust_tier,status,dedupe_key,revision,supersedes_publication_id,source_url,source_type,
  observed_at,verified_at,provenance,reviewer_id,created_at,updated_at
) values (
  'e7000000-0000-4000-8000-000000000030','KR-BIZ-9970000001','remote','Concurrent legacy writer',
  'Committed while migration 003 waits','All employees',null,
  'community_reviewed','active','legacy-concurrent-lineage',1,null,
  'https://example.com/concurrent-legacy-writer','user_submission',
  '2026-11-03 00:00:00+00','2026-11-04 00:00:00+00',
  '{"submission_id":"e7100000-0000-4000-8000-000000000030"}'::jsonb,
  'e7200000-0000-4000-8000-000000000001',
  '2026-11-03 00:00:00+00','2026-11-04 00:00:00+00'
);
SQL
wait_for_sql 'idle in transaction' \
  "select state from pg_catalog.pg_stat_activity where application_name='$writer_app'" \
  'legacy writer transaction'

docker exec -i -e "PGAPPNAME=$migration_app" "$db_container" \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < "$repo_root/supabase/migrations/202611210003_canonical_benefit_publication_titles.sql" \
  >"$migration_log" 2>&1 &
migration_pid=$!
wait_for_sql 't' \
  "select exists(select 1 from pg_catalog.pg_stat_activity activity join pg_catalog.pg_locks lock on lock.pid=activity.pid where activity.application_name='$migration_app' and lock.relation='public.benefit_publications'::regclass and lock.mode='AccessExclusiveLock' and not lock.granted)" \
  'migration 003 access-exclusive lock to block on the legacy writer'
if ! kill -0 "$migration_pid" 2>/dev/null; then
  printf 'migration 003 exited instead of blocking on the legacy writer\n' >&2
  cat "$migration_log" >&2
  exit 1
fi

printf 'commit;\n\\q\n' >&"$writer_fd"
eval "exec ${writer_fd}>&-"
writer_fd=""
wait_for_process "$writer_pid" 'legacy writer commit'
writer_pid=""
wait_for_process "$migration_pid" 'migration 003 completion'
migration_pid=""
rm -f "$writer_fifo" "$writer_log"
writer_fifo=""
writer_log=""

if [[ "$(psql_query "select title||'|'||dedupe_key from public.benefit_publications where publication_id='e7000000-0000-4000-8000-000000000030'")" != \
  "$(psql_query "select 'Concurrent legacy writer|user-'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to('KR-BIZ-9970000001'||E'\\n'||'remote'||E'\\n'||'concurrent legacy writer','UTF8'),'sha256'),'hex')")" ]]; then
  printf 'concurrent legacy writer escaped migration 003 canonical lineage rewrite\n' >&2
  psql_query "select title,dedupe_key from public.benefit_publications where publication_id='e7000000-0000-4000-8000-000000000030'" >&2
  exit 1
fi
if [[ "$(psql_query "select exists(select 1 from public.benefit_publications where dedupe_key='legacy-concurrent-lineage')")" != "f" ]]; then
  printf 'migration 003 left the concurrent legacy dedupe key behind\n' >&2
  exit 1
fi
docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < "$fixture_root/assertions.sql"

"$cli" db reset --local --version 202611210002 --no-seed
docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < "$fixture_root/invalid_seed.sql"
original_title="$(psql_query "select encode(convert_to(title,'UTF8'),'hex') from public.benefit_publications where publication_id='e7000000-0000-4000-8000-000000000020'")"
original_constraint="$(psql_query "select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.benefit_publications'::regclass and conname='benefit_publications_title_check'")"

set +e
"$cli" migration up --local >"$migration_log" 2>&1
invalid_status=$?
set -e
if (( invalid_status == 0 )); then
  printf 'migration unexpectedly accepted whitespace-only legacy title\n' >&2
  cat "$migration_log" >&2
  exit 1
fi
if ! grep -Fq 'benefit title canonicalization preflight failed: invalid title' "$migration_log"; then
  printf 'migration failure did not include the fail-closed title preflight error\n' >&2
  cat "$migration_log" >&2
  exit 1
fi
if [[ "$(psql_query "select exists(select 1 from supabase_migrations.schema_migrations where version='202611210003')")" != "f" ]]; then
  printf 'failed migration was recorded in the migration ledger\n' >&2
  exit 1
fi
if [[ "$(psql_query "select encode(convert_to(title,'UTF8'),'hex') from public.benefit_publications where publication_id='e7000000-0000-4000-8000-000000000020'")" != "$original_title" ]]; then
  printf 'failed migration changed the invalid legacy title\n' >&2
  exit 1
fi
if [[ "$(psql_query "select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.benefit_publications'::regclass and conname='benefit_publications_title_check'")" != "$original_constraint" ]]; then
  printf 'failed migration changed the legacy title constraint\n' >&2
  exit 1
fi
if [[ "$(psql_query "select to_regprocedure('private.canonical_benefit_publication_title(text)') is null")" != "t" ]]; then
  printf 'failed migration left the canonical title helper installed\n' >&2
  exit 1
fi

printf 'benefit title upgrade and rollback fixtures passed\n'
