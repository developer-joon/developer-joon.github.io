#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
db_container="supabase_db_developer-joon-community-design"
fixture_root="$repo_root/supabase/fixtures/benefit-title-upgrade"
migration_root="$repo_root/supabase/migrations"
db_prefix="benefit_title_upgrade"
run_token=""
run_nonce=""
run_base=""
writer_app=""
migration_app=""
temp_dbs=()
background_pids=()
writer_pid=""
migration_pid=""
writer_fd=""
writer_fifo=""
writer_log=""
migration_log=""
primary_before=""
cleaning_up=0

validate_db_name() {
  local db_name="${1:-}"
  [[ "$db_name" =~ ^benefit_title_upgrade_[0-9]+_[0-9a-f]{8}_(positive|race|rollback|collision)$ ]]
}

if [[ "${1:-}" == "--validate-db-name" ]]; then
  validate_db_name "${2:-}"
  exit
elif [[ "${1:-}" == "--run-token" && "${2:-}" =~ ^[0-9a-f]{8}$ && $# == 2 ]]; then
  run_token="$2"
elif (( $# != 0 )); then
  printf 'usage: %s [--validate-db-name NAME] [--run-token 8_HEX_DIGITS]\n' "$0" >&2
  exit 2
fi

if [[ -n "$run_token" ]]; then
  run_nonce="$run_token"
else
  run_nonce="$(printf '%08x' "$(( (RANDOM << 16) ^ RANDOM ))")"
fi
run_base="${db_prefix}_$$_${run_nonce}"
writer_app="benefit-title-legacy-writer-$run_nonce"
migration_app="benefit-title-migration-003-$run_nonce"

admin_psql() {
  docker exec -i "$db_container" psql -X -Aqt -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
}

is_tracked_db() {
  local requested="$1" tracked
  validate_db_name "$requested" || return 1
  for tracked in "${temp_dbs[@]}"; do
    [[ "$tracked" == "$requested" ]] && return 0
  done
  return 1
}

scenario_guard() {
  cat <<'SQL'
select current_database() <> 'postgres' and current_database() = :'expected_db' as benefit_title_safe_db \gset
\if :benefit_title_safe_db
\else
  \echo 'refusing unsafe benefit title scenario database' >&2
  \quit 3
\endif
SQL
}

scenario_psql() {
  local db_name="$1"
  shift
  if ! is_tracked_db "$db_name"; then
    printf 'refusing untracked or unsafe scenario database: %s\n' "$db_name" >&2
    return 2
  fi
  {
    scenario_guard
    cat
  } | docker exec -i -e "PGAPPNAME=${PGAPPNAME:-benefit-title-scenario-$run_nonce}" "$db_container" \
      psql -X -v ON_ERROR_STOP=1 -v "expected_db=$db_name" -U postgres -d "$db_name" "$@"
}

scenario_file() {
  local db_name="$1" sql_file="$2"
  scenario_psql "$db_name" < "$sql_file"
}

scenario_query() {
  local db_name="$1" query="$2"
  printf '%s\n' "$query" | scenario_psql "$db_name" -Aqt
}

primary_summary() {
  {
    cat <<'SQL'
select 'ledger|'||coalesce(md5(string_agg(row_to_json(m)::text,'' order by version)),'empty')
from supabase_migrations.schema_migrations m;
with catalog_objects as (
  select 'column|'||c.oid::text||'|'||a.attnum||'|'||a.attname||'|'||pg_catalog.format_type(a.atttypid,a.atttypmod)||'|'||a.attnotnull||'|'||coalesce(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'') value
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
  join pg_catalog.pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
  left join pg_catalog.pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
  union all
  select 'constraint|'||conrelid::text||'|'||conname||'|'||pg_catalog.pg_get_constraintdef(oid,true)
  from pg_catalog.pg_constraint where connamespace='public'::regnamespace
  union all
  select 'index|'||indexrelid::text||'|'||pg_catalog.pg_get_indexdef(indexrelid)
  from pg_catalog.pg_index where indrelid in (select oid from pg_catalog.pg_class where relnamespace='public'::regnamespace)
  union all
  select 'function|'||p.oid::text||'|'||pg_catalog.pg_get_functiondef(p.oid)
  from pg_catalog.pg_proc p where p.pronamespace='public'::regnamespace
  union all
  select 'policy|'||polrelid::text||'|'||polname||'|'||polcmd::text||'|'||coalesce(pg_catalog.pg_get_expr(polqual,polrelid),'')||'|'||coalesce(pg_catalog.pg_get_expr(polwithcheck,polrelid),'')
  from pg_catalog.pg_policy where polrelid in (select oid from pg_catalog.pg_class where relnamespace='public'::regnamespace)
)
select 'catalog|'||coalesce(md5(string_agg(value,'' order by value)),'empty') from catalog_objects;
select pg_catalog.format(
  'select %L||count(*)::text||''|''||coalesce(sum(pg_catalog.hashtextextended(row_to_json(t)::text,0)::numeric),0)::text from public.%I t;',
  'rows|'||tablename||'|',tablename
)
from pg_catalog.pg_tables
where schemaname='public'
order by tablename
\gexec
SQL
  } | admin_psql | sha256sum | cut -d' ' -f1
}

create_scenario_db() {
  local db_name="$1"
  validate_db_name "$db_name" || {
    printf 'refusing unsafe database name: %s\n' "$db_name" >&2
    return 2
  }
  admin_psql -c "create database \"$db_name\" template template0" >/dev/null
  temp_dbs+=("$db_name")
}

bootstrap_v2() {
  local db_name="$1"
  create_scenario_db "$db_name"
  scenario_file "$db_name" "$fixture_root/prerequisites.sql" >/dev/null
  scenario_file "$db_name" "$migration_root/202611210001_benefit_directory_read_model.sql" >/dev/null
  scenario_file "$db_name" "$migration_root/202611210002_benefit_submissions.sql" >/dev/null
  scenario_query "$db_name" "insert into supabase_migrations.schema_migrations(version,statements) values ('202611210001','{}'),('202611210002','{}');" >/dev/null
}

wait_for_sql() {
  local db_name="$1" expected="$2" query="$3" description="$4"
  local attempt actual=""
  for attempt in {1..100}; do
    actual="$(scenario_query "$db_name" "$query")"
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
  local original_status=$? cleanup_status=0 pid db_name primary_after
  (( cleaning_up == 0 )) || exit "$original_status"
  cleaning_up=1
  trap - EXIT INT TERM
  set +e

  if [[ -n "$writer_fd" ]]; then
    printf '\\q\n' >&"$writer_fd" 2>/dev/null
    eval "exec ${writer_fd}>&-"
    writer_fd=""
  fi
  for pid in "${background_pids[@]}"; do
    kill "$pid" 2>/dev/null
  done
  for db_name in "${temp_dbs[@]}"; do
    validate_db_name "$db_name" || { cleanup_status=1; continue; }
    admin_psql -c "revoke connect on database \"$db_name\" from public; select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity where datname='$db_name' and pid<>pg_catalog.pg_backend_pid();" >/dev/null 2>&1
  done
  for pid in "${background_pids[@]}"; do
    if ! timeout 5s tail --pid="$pid" -f /dev/null 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null
      timeout 2s tail --pid="$pid" -f /dev/null 2>/dev/null || cleanup_status=1
    fi
    wait "$pid" 2>/dev/null
  done
  for db_name in "${temp_dbs[@]}"; do
    validate_db_name "$db_name" || { cleanup_status=1; continue; }
    admin_psql -c "drop database if exists \"$db_name\"" >/dev/null 2>&1 || cleanup_status=1
  done
  rm -f "$writer_fifo" "$writer_log" "$migration_log"

  if [[ -n "$primary_before" ]]; then
    primary_after="$(primary_summary)" || cleanup_status=1
    if [[ "$primary_after" != "$primary_before" ]]; then
      printf 'primary postgres database changed: before=%s after=%s\n' "$primary_before" "$primary_after" >&2
      cleanup_status=1
    else
      printf 'primary postgres database unchanged: %s\n' "$primary_after"
    fi
  fi
  if (( original_status != 0 )); then exit "$original_status"; fi
  exit "$cleanup_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker inspect "$db_container" >/dev/null 2>&1 || {
  printf 'local Supabase database container is not running: %s\n' "$db_container" >&2
  exit 1
}
primary_before="$(primary_summary)"
printf 'primary postgres database baseline: %s\n' "$primary_before"

positive_db="${run_base}_positive"
race_db="${run_base}_race"
rollback_db="${run_base}_rollback"
collision_db="${run_base}_collision"

bootstrap_v2 "$positive_db"
if [[ "${BENEFIT_TITLE_UPGRADE_INJECT:-}" == "after-create" ]]; then
  printf 'injected failure after scenario database creation\n' >&2
  exit 97
elif [[ "${BENEFIT_TITLE_UPGRADE_INJECT:-}" == "pause-after-create" ]]; then
  printf 'injected pause after scenario database creation\n'
  while :; do sleep 1; done
fi
scenario_file "$positive_db" "$fixture_root/seed.sql" >/dev/null
scenario_file "$positive_db" "$migration_root/202611210003_canonical_benefit_publication_titles.sql" >/dev/null
scenario_file "$positive_db" "$fixture_root/assertions.sql" >/dev/null

bootstrap_v2 "$race_db"
scenario_file "$race_db" "$fixture_root/seed.sql" >/dev/null
writer_fifo="$(mktemp)"
rm -f "$writer_fifo"
writer_log="$(mktemp)"
migration_log="$(mktemp)"
mkfifo "$writer_fifo"
exec {writer_fd}<>"$writer_fifo"
(
  eval "exec ${writer_fd}>&-"
  PGAPPNAME="$writer_app" scenario_psql "$race_db" <"$writer_fifo"
) >"$writer_log" 2>&1 &
writer_pid=$!
background_pids+=("$writer_pid")
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
wait_for_sql "$race_db" 'idle in transaction' \
  "select state from pg_catalog.pg_stat_activity where application_name='$writer_app'" \
  'legacy writer transaction'

(
  eval "exec ${writer_fd}>&-"
  PGAPPNAME="$migration_app" scenario_file "$race_db" "$migration_root/202611210003_canonical_benefit_publication_titles.sql"
) >"$migration_log" 2>&1 &
migration_pid=$!
background_pids+=("$migration_pid")
wait_for_sql "$race_db" 't' \
  "select exists(select 1 from pg_catalog.pg_stat_activity activity join pg_catalog.pg_locks lock on lock.pid=activity.pid where activity.application_name='$migration_app' and lock.relation='public.benefit_publications'::regclass and lock.mode='AccessExclusiveLock' and not lock.granted)" \
  'migration 003 access-exclusive lock to block on the legacy writer'
if [[ "${BENEFIT_TITLE_UPGRADE_INJECT:-}" == "race-blocked" ]]; then
  printf 'injected failure with writer and migration processes active\n' >&2
  exit 98
elif [[ "${BENEFIT_TITLE_UPGRADE_INJECT:-}" == "pause-race-blocked" ]]; then
  printf 'injected pause with writer and migration processes active\n'
  while :; do sleep 1; done
fi
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

expected_key="$(scenario_query "$race_db" "select 'Concurrent legacy writer|user-'||pg_catalog.encode(extensions.digest(pg_catalog.convert_to('KR-BIZ-9970000001'||E'\\n'||'remote'||E'\\n'||'concurrent legacy writer','UTF8'),'sha256'),'hex')")"
actual_key="$(scenario_query "$race_db" "select title||'|'||dedupe_key from public.benefit_publications where publication_id='e7000000-0000-4000-8000-000000000030'")"
if [[ "$actual_key" != "$expected_key" ]]; then
  printf 'concurrent legacy writer escaped migration 003 canonical lineage rewrite\n' >&2
  exit 1
fi
if [[ "$(scenario_query "$race_db" "select exists(select 1 from public.benefit_publications where dedupe_key='legacy-concurrent-lineage')")" != "f" ]]; then
  printf 'migration 003 left the concurrent legacy dedupe key behind\n' >&2
  exit 1
fi
scenario_file "$race_db" "$fixture_root/assertions.sql" >/dev/null

bootstrap_v2 "$rollback_db"
scenario_file "$rollback_db" "$fixture_root/invalid_seed.sql" >/dev/null
original_title="$(scenario_query "$rollback_db" "select encode(convert_to(title,'UTF8'),'hex') from public.benefit_publications where publication_id='e7000000-0000-4000-8000-000000000020'")"
original_constraint="$(scenario_query "$rollback_db" "select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.benefit_publications'::regclass and conname='benefit_publications_title_check'")"
set +e
scenario_file "$rollback_db" "$migration_root/202611210003_canonical_benefit_publication_titles.sql" >"$migration_log" 2>&1
invalid_status=$?
set -e
if (( invalid_status == 0 )); then
  printf 'migration unexpectedly accepted whitespace-only legacy title\n' >&2
  exit 1
fi
if ! grep -Fq 'benefit title canonicalization preflight failed: invalid title' "$migration_log"; then
  printf 'migration failure did not include the fail-closed title preflight error\n' >&2
  cat "$migration_log" >&2
  exit 1
fi
if [[ "$(scenario_query "$rollback_db" "select exists(select 1 from supabase_migrations.schema_migrations where version='202611210003')")" != "f" ]]; then
  printf 'failed migration was recorded in the migration ledger\n' >&2
  exit 1
fi
if [[ "$(scenario_query "$rollback_db" "select encode(convert_to(title,'UTF8'),'hex') from public.benefit_publications where publication_id='e7000000-0000-4000-8000-000000000020'")" != "$original_title" ]]; then
  printf 'failed migration changed the invalid legacy title\n' >&2
  exit 1
fi
if [[ "$(scenario_query "$rollback_db" "select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.benefit_publications'::regclass and conname='benefit_publications_title_check'")" != "$original_constraint" ]]; then
  printf 'failed migration changed the legacy title constraint\n' >&2
  exit 1
fi
if [[ "$(scenario_query "$rollback_db" "select to_regprocedure('private.canonical_benefit_publication_title(text)') is null")" != "t" ]]; then
  printf 'failed migration left the canonical title helper installed\n' >&2
  exit 1
fi

bootstrap_v2 "$collision_db"
scenario_file "$collision_db" "$fixture_root/collision_seed.sql" >/dev/null
collision_exact="$(scenario_query "$collision_db" "select count(*)=2 and count(*) filter (where publication_id='e7000000-0000-4000-8000-000000000040' and title='Collision title' and description='First distinct migration 002 lineage' and eligibility_text='All employees' and condition_text='Annual enrollment' and dedupe_key='legacy-collision-lineage-a' and status='active' and provenance->>'submission_id'='e7100000-0000-4000-8000-000000000040' and provenance->>'payload'='first' and (select count(*) from jsonb_object_keys(provenance))=2)=1 and count(*) filter (where publication_id='e7000000-0000-4000-8000-000000000041' and title=E'Collision\\t title' and description='Second distinct migration 002 lineage' and eligibility_text='Full-time employees' and condition_text='Manager approval' and dedupe_key='legacy-collision-lineage-b' and status='active' and provenance->>'submission_id'='e7100000-0000-4000-8000-000000000041' and provenance->>'payload'='second' and (select count(*) from jsonb_object_keys(provenance))=2)=1 from public.benefit_publications where company_id='KR-BIZ-9970000003'")"
if [[ "$collision_exact" != "t" ]]; then
  printf 'collision fixture exact rows, payloads, lineage keys, or statuses differ from the production-shaped seed\n' >&2
  exit 1
fi
collision_shape="$(scenario_query "$collision_db" "select count(*)||'|'||count(distinct dedupe_key)||'|'||count(*) filter (where status='active')||'|'||count(distinct lower(btrim(regexp_replace(translate(title,E'\\t\\n\\v\\f\\r','     '),' +',' ','g')))) from public.benefit_publications where company_id='KR-BIZ-9970000003'")"
if [[ "$collision_shape" != "2|2|2|1" ]]; then
  printf 'collision fixture does not contain two distinct active old lineages mapping to one canonical title: %s\n' "$collision_shape" >&2
  exit 1
fi
collision_rows_before="$(scenario_query "$collision_db" "select md5(string_agg(row_to_json(publication)::text,E'\\n' order by publication.publication_id)) from public.benefit_publications publication where company_id='KR-BIZ-9970000003'")"
collision_constraint_before="$(scenario_query "$collision_db" "select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.benefit_publications'::regclass and conname='benefit_publications_title_check'")"
collision_rpc_before="$(scenario_query "$collision_db" "select md5(pg_get_functiondef('public.review_benefit_submission_v1(uuid,text,text,text,uuid,text,text,text,text,uuid)'::regprocedure))")"
collision_ledger_before="$(scenario_query "$collision_db" "select md5(string_agg(row_to_json(m)::text,E'\\n' order by version)) from supabase_migrations.schema_migrations m")"
if [[ "$(scenario_query "$collision_db" "select string_agg(version,',' order by version) from supabase_migrations.schema_migrations")" != "202611210001,202611210002" ]]; then
  printf 'collision fixture did not start from the exact migration 002 ledger state\n' >&2
  exit 1
fi
if [[ "$(scenario_query "$collision_db" "select to_regprocedure('private.canonical_benefit_publication_title(text)') is null")" != "t" ]]; then
  printf 'collision fixture unexpectedly started with canonical helper installed\n' >&2
  exit 1
fi
set +e
scenario_file "$collision_db" "$migration_root/202611210003_canonical_benefit_publication_titles.sql" >"$migration_log" 2>&1
collision_status=$?
set -e
if (( collision_status == 0 )); then
  printf 'migration unexpectedly merged colliding legacy lineages\n' >&2
  exit 1
fi
if ! grep -Fq 'benefit title canonicalization preflight failed: canonical lineage collision' "$migration_log"; then
  printf 'migration failure did not include the canonical lineage collision error\n' >&2
  cat "$migration_log" >&2
  exit 1
fi
if [[ "$(scenario_query "$collision_db" "select md5(string_agg(row_to_json(publication)::text,E'\\n' order by publication.publication_id)) from public.benefit_publications publication where company_id='KR-BIZ-9970000003'")" != "$collision_rows_before" ]]; then
  printf 'failed collision migration changed exact publication rows or payloads\n' >&2
  exit 1
fi
if [[ "$(scenario_query "$collision_db" "select count(*)||'|'||count(distinct dedupe_key)||'|'||count(*) filter (where status='active')||'|'||count(distinct lower(btrim(regexp_replace(translate(title,E'\\t\\n\\v\\f\\r','     '),' +',' ','g')))) from public.benefit_publications where company_id='KR-BIZ-9970000003'")" != "$collision_shape" ]]; then
  printf 'failed collision migration changed old lineage keys, statuses, or canonical mapping\n' >&2
  exit 1
fi
if [[ "$(scenario_query "$collision_db" "select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.benefit_publications'::regclass and conname='benefit_publications_title_check'")" != "$collision_constraint_before" ]]; then
  printf 'failed collision migration changed the legacy title constraint\n' >&2
  exit 1
fi
if [[ "$(scenario_query "$collision_db" "select md5(pg_get_functiondef('public.review_benefit_submission_v1(uuid,text,text,text,uuid,text,text,text,text,uuid)'::regprocedure))")" != "$collision_rpc_before" ]]; then
  printf 'failed collision migration replaced the review RPC\n' >&2
  exit 1
fi
if [[ "$(scenario_query "$collision_db" "select to_regprocedure('private.canonical_benefit_publication_title(text)') is null")" != "t" ]]; then
  printf 'failed collision migration left the canonical helper installed\n' >&2
  exit 1
fi
if [[ "$(scenario_query "$collision_db" "select md5(string_agg(row_to_json(m)::text,E'\\n' order by version)) from supabase_migrations.schema_migrations m")" != "$collision_ledger_before" ]] || [[ "$(scenario_query "$collision_db" "select exists(select 1 from supabase_migrations.schema_migrations where version='202611210003')")" != "f" ]]; then
  printf 'failed collision migration advanced or changed the migration ledger\n' >&2
  exit 1
fi
printf 'canonical collision rollback preserved rows=%s constraint and RPC fingerprints\n' "$collision_rows_before"

printf 'benefit title upgrade, lock race, invalid-title rollback, and canonical collision rollback fixtures passed\n'
printf 'Tests=4\n'
