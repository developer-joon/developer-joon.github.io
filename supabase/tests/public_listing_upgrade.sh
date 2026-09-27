#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cli="$repo_root/community-app/node_modules/.bin/supabase"
db_container="supabase_db_developer-joon-community-design"
seed="$repo_root/supabase/fixtures/public-listing-upgrade/seed.sql"
assertions="$repo_root/supabase/fixtures/public-listing-upgrade/assertions.sql"

psql_query() {
  docker exec "$db_container" psql -X -Aqt -v ON_ERROR_STOP=1 -U postgres -d postgres -c "$1"
}

poll_until() {
  local description=$1 query=$2 deadline=$((SECONDS + 20)) result
  while (( SECONDS < deadline )); do
    result="$(psql_query "$query")"
    if [[ "$result" == "t" ]]; then
      return 0
    fi
    sleep 0.1
  done
  printf 'timed out waiting for %s\n' "$description" >&2
  docker exec "$db_container" psql -X -U postgres -d postgres -c \
    "select pid,application_name,state,wait_event_type,wait_event,query from pg_stat_activity where datname=current_database(); select * from pg_stat_progress_create_index;" >&2
  return 1
}

cleanup() {
  original_status=$?
  trap - EXIT
  set +e
  if [[ -n "${holder_fd:-}" ]]; then
    printf '\\q\n' >&"$holder_fd" 2>/dev/null
  fi
  wait "${holder_pid:-}" 2>/dev/null
  wait "${migration_pid:-}" 2>/dev/null
  rm -f "${migration_log:-}"
  "$cli" db reset --local --no-seed >/dev/null
  cleanup_status=$?
  if (( original_status != 0 )); then exit "$original_status"; fi
  exit "$cleanup_status"
}
trap cleanup EXIT

"$cli" db reset --local --version 202609270004 --no-seed
docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < "$seed"

original_function_hash="$(psql_query "select md5(pg_get_functiondef('public.list_public_posts(text,integer,text,uuid,boolean,timestamp with time zone,bigint,uuid,real)'::regprocedure))")"
original_page_keys_oid="$(psql_query "select to_regprocedure('private.public_post_page_keys(text,integer,tsquery,uuid,boolean,timestamp with time zone,bigint,uuid,real)')::oid")"
docker exec "$db_container" psql -X -Aqt -v ON_ERROR_STOP=1 -U supabase_admin -d postgres -c \
  "create index post_reaction_daily_recent_idx on private.post_reaction_daily_counts (reaction_date,post_id) include (reaction_count) where reaction_count > 0; update pg_catalog.pg_index set indisvalid=false,indisready=false where indexrelid='private.post_reaction_daily_recent_idx'::regclass;" >/dev/null

migration_log="$(mktemp)"
set +e
"$cli" migration up --local >"$migration_log" 2>&1
invalid_status=$?
set -e
if (( invalid_status == 0 )); then
  printf 'migration unexpectedly accepted invalid/not-ready listing index\n' >&2
  cat "$migration_log" >&2
  exit 1
fi
if ! grep -Fq 'SQLSTATE 55000' "$migration_log" ||
   ! grep -Fq 'DROP INDEX CONCURRENTLY IF EXISTS private.post_reaction_daily_recent_idx; then retry migration' "$migration_log"; then
  printf 'migration failure did not include SQLSTATE 55000 and actionable invalid-index recovery\n' >&2
  cat "$migration_log" >&2
  exit 1
fi
if [[ "$(psql_query "select exists(select 1 from supabase_migrations.schema_migrations where version='202609270005')")" != "f" ]]; then
  printf 'failed migration was recorded in the migration ledger\n' >&2
  exit 1
fi
if [[ "$(psql_query "select md5(pg_get_functiondef('public.list_public_posts(text,integer,text,uuid,boolean,timestamp with time zone,bigint,uuid,real)'::regprocedure))")" != "$original_function_hash" ]]; then
  printf 'failed migration replaced list_public_posts\n' >&2
  exit 1
fi
if [[ "$(psql_query "select to_regprocedure('private.public_post_page_keys(text,integer,tsquery,uuid,boolean,timestamp with time zone,bigint,uuid,real)')::oid")" != "$original_page_keys_oid" ]]; then
  printf 'failed migration installed public_post_page_keys\n' >&2
  exit 1
fi

psql_query "drop index concurrently if exists private.post_reaction_daily_recent_idx;" >/dev/null

coproc LISTING_HOLDER {
  docker exec -e PGAPPNAME=public-listing-upgrade-holder -i "$db_container" \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres >/dev/null
}
holder_pid=$LISTING_HOLDER_PID
holder_fd=${LISTING_HOLDER[1]}
printf '%s\n' \
  "begin;" \
  "update public.posts set updated_at=updated_at where id=md5('listing-upgrade-1')::uuid;" \
  "update private.post_reaction_daily_counts set reaction_count=reaction_count where post_id=md5('listing-upgrade-1')::uuid;" >&"$holder_fd"
poll_until 'holder transaction' \
  "select exists(select 1 from pg_stat_activity where application_name='public-listing-upgrade-holder' and xact_start is not null and state='idle in transaction')"

PGAPPNAME=public-listing-upgrade-migration "$cli" migration up --local >/dev/null &
migration_pid=$!
poll_until 'concurrent recent-reaction index build' \
  "select exists(select 1 from pg_stat_progress_create_index where relid='private.post_reaction_daily_counts'::regclass and index_relid=to_regclass('private.post_reaction_daily_recent_idx'))"

# A queued blocking index rebuild would make both writes time out behind it.
docker exec "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
  "set lock_timeout='1s'; update public.posts set updated_at=clock_timestamp() where id=md5('listing-upgrade-2')::uuid; insert into private.post_reaction_daily_counts values(md5('listing-upgrade-2')::uuid,current_date,1,1)"

printf 'commit;\\q\n' >&"$holder_fd"
exec {holder_fd}>&-
wait "$holder_pid"
unset holder_pid holder_fd
wait "$migration_pid"
unset migration_pid
docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < "$assertions"