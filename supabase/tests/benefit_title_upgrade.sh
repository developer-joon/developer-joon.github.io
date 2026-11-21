#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cli="$repo_root/community-app/node_modules/.bin/supabase"
db_container="supabase_db_developer-joon-community-design"
fixture_root="$repo_root/supabase/fixtures/benefit-title-upgrade"

psql_query() {
  docker exec "$db_container" psql -X -Aqt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "$1"
}

cleanup() {
  original_status=$?
  trap - EXIT
  set +e
  rm -f "${migration_log:-}"
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
  < "$fixture_root/invalid_seed.sql"
original_title="$(psql_query "select encode(convert_to(title,'UTF8'),'hex') from public.benefit_publications where publication_id='e7000000-0000-4000-8000-000000000020'")"
original_constraint="$(psql_query "select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.benefit_publications'::regclass and conname='benefit_publications_title_check'")"

migration_log="$(mktemp)"
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
