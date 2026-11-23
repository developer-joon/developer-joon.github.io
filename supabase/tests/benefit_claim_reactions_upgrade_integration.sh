#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migration_root="$repo_root/supabase/migrations"
prerequisite="$repo_root/supabase/fixtures/benefit-title-upgrade/prerequisites.sql"
project_id="$(python3 -c 'import pathlib,sys,tomllib; print(tomllib.loads(pathlib.Path(sys.argv[1]).read_text())["project_id"])' "$repo_root/supabase/config.toml")"
db_container="supabase_db_${project_id}"
run_token="$(printf '%s' "$$-$RANDOM-$RANDOM" | sha256sum | cut -c1-8)"
db_prefix="benefit_claim_reactions_upgrade_${run_token}"
temp_dbs=()
work_dir="$(mktemp -d)"

validate_db_name() {
  [[ "${1:-}" =~ ^benefit_claim_reactions_upgrade_[0-9a-f]{8}_(rejected|accepted)$ ]]
}

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

scenario_psql() {
  local db_name="$1"
  shift
  is_tracked_db "$db_name" || {
    printf 'refusing untracked upgrade database: %s\n' "$db_name" >&2
    return 2
  }
  {
    cat <<'SQL'
select current_database() <> 'postgres' and current_database() = :'expected_db' as safe_upgrade_database \gset
\if :safe_upgrade_database
\else
  \echo 'refusing unsafe benefit claim reaction upgrade database' >&2
  \quit 3
\endif
SQL
    cat
  } | docker exec -i -e "PGAPPNAME=benefit-claim-reactions-upgrade-$run_token" "$db_container" \
      psql -X -v ON_ERROR_STOP=1 -v "expected_db=$db_name" -U postgres -d "$db_name" "$@"
}

scenario_file() {
  local db_name="$1" sql_file="$2"
  scenario_psql "$db_name" <"$sql_file"
}

scenario_query() {
  local db_name="$1" query="$2"
  printf '%s\n' "$query" | scenario_psql "$db_name" -Aqt
}

cleanup() {
  local original_status="${1:-$?}" cleanup_status=0 db_name
  trap - EXIT INT TERM
  set +e
  for db_name in "${temp_dbs[@]}"; do
    if ! validate_db_name "$db_name"; then
      printf 'refusing unsafe tracked database during cleanup: %s\n' "$db_name" >&2
      cleanup_status=1
      continue
    fi
    admin_psql -c "revoke connect on database \"$db_name\" from public; select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity where datname='$db_name' and pid<>pg_catalog.pg_backend_pid();" >/dev/null 2>&1 || cleanup_status=1
    admin_psql -c "drop database if exists \"$db_name\"" >/dev/null 2>&1 || cleanup_status=1
  done
  rm -rf "$work_dir" || cleanup_status=1
  if (( original_status != 0 )); then return "$original_status"; fi
  return "$cleanup_status"
}
trap 'cleanup "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker inspect "$db_container" >/dev/null 2>&1 || {
  printf 'local Supabase database container is not running: %s\n' "$db_container" >&2
  exit 1
}

create_scenario_db() {
  local db_name="$1"
  validate_db_name "$db_name" || {
    printf 'refusing unsafe upgrade database name: %s\n' "$db_name" >&2
    return 2
  }
  admin_psql -c "create database \"$db_name\" template template0" >/dev/null
  temp_dbs+=("$db_name")
}

apply_through_task5() {
  local db_name="$1" migration
  create_scenario_db "$db_name"
  scenario_file "$db_name" "$prerequisite" >/dev/null
  scenario_query "$db_name" "alter table public.profiles add column display_name text, add column role text;" >/dev/null
  for migration in \
    202611010001_benefit_correction_requests.sql \
    202611010002_benefit_correction_audit_history.sql \
    202611210001_benefit_directory_read_model.sql \
    202611210002_benefit_submissions.sql \
    202611210003_canonical_benefit_publication_titles.sql \
    202611210004_benefit_directory_seed_import.sql \
    202611210005_bound_benefit_company_detail.sql \
    202611230001_improve_benefit_company_search.sql \
    202611230002_store_benefit_company_search_name.sql \
    202611230003_benefit_company_identifiers.sql \
    202611230004_benefit_company_add_requests.sql \
    202611230005_benefit_claims.sql
  do
    scenario_file "$db_name" "$migration_root/$migration" >/dev/null
  done
  scenario_query "$db_name" "
    insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,source_edition)
    values ('KR-BIZ-0000000001','registered_business','Upgrade Fixture Company','upgrade fixture company','upgrade-test');
  " >/dev/null
}

claim_values() {
  local claim_id="$1" client_key="$2" title="$3" status="$4" withdrawn_at="$5"
  printf "('%s','KR-BIZ-0000000001',null,'%s','%064d','leave','%s','%s','Upgrade fixture description',null,'',null,date '2026-11-23',null,'%s',1,null,timestamptz '2026-11-23 00:00:00+00',timestamptz '2026-11-23 00:00:00+00',%s)" \
    "$claim_id" "$client_key" 0 "$title" "${title,,}" "$status" "$withdrawn_at"
}

rejected_db="${db_prefix}_rejected"
apply_through_task5 "$rejected_db"
scenario_query "$rejected_db" "
  insert into public.benefit_claims(
    claim_id,company_id,submitter_id,client_key,payload_fingerprint,category_id,title,normalized_title,
    description,eligibility_text,normalized_eligibility,condition_text,observed_on,source_url,status,revision,
    active_publication_id,created_at,updated_at,withdrawn_at
  ) values $(claim_values 'b6000000-0000-4000-8000-000000000101' 'b6000000-0000-4000-8000-000000000201' 'Legacy confirmed claim' 'community_confirmed' 'null');
" >/dev/null

set +e
scenario_file "$rejected_db" "$migration_root/202611230006_benefit_claim_reactions.sql" >"$work_dir/rejected.log" 2>&1
rejected_status=$?
set -e
[[ "$rejected_status" != "0" ]] || {
  printf 'migration 006 accepted an incompatible Task 5 claim\n' >&2
  exit 1
}
grep -Fq 'benefit claim reaction upgrade blocked: 1 incompatible Task 5 claim(s); resolve claims to submitted or withdrawn with no active publication before retry' "$work_dir/rejected.log" || {
  printf 'migration 006 did not return the bounded actionable preflight error\n' >&2
  sed -E 's#(postgresql://)[^@]+@#\1<redacted>@#g' "$work_dir/rejected.log" >&2
  exit 1
}
[[ "$(scenario_query "$rejected_db" "select count(*) from pg_catalog.pg_constraint where conrelid='public.benefit_claims'::regclass and conname='benefit_claims_task5_no_active_publication_check';")" == "1" ]]
[[ "$(scenario_query "$rejected_db" "select pg_catalog.to_regclass('public.benefit_claim_reactions') is null;")" == "t" ]]
[[ "$(scenario_query "$rejected_db" "select status||'|'||coalesce(active_publication_id::text,'NULL') from public.benefit_claims;")" == "community_confirmed|NULL" ]]

accepted_db="${db_prefix}_accepted"
apply_through_task5 "$accepted_db"
scenario_query "$accepted_db" "
  insert into public.benefit_claims(
    claim_id,company_id,submitter_id,client_key,payload_fingerprint,category_id,title,normalized_title,
    description,eligibility_text,normalized_eligibility,condition_text,observed_on,source_url,status,revision,
    active_publication_id,created_at,updated_at,withdrawn_at
  ) values
    $(claim_values 'b6000000-0000-4000-8000-000000000102' 'b6000000-0000-4000-8000-000000000202' 'Legacy submitted claim' 'submitted' 'null'),
    $(claim_values 'b6000000-0000-4000-8000-000000000103' 'b6000000-0000-4000-8000-000000000203' 'Legacy withdrawn claim' 'withdrawn' "timestamptz '2026-11-23 00:00:00+00'");
" >/dev/null
scenario_file "$accepted_db" "$migration_root/202611230006_benefit_claim_reactions.sql" >/dev/null
[[ "$(scenario_query "$accepted_db" "select pg_catalog.to_regclass('public.benefit_claim_reactions') is not null;")" == "t" ]]
[[ "$(scenario_query "$accepted_db" "select count(*) from pg_catalog.pg_constraint where conrelid='public.benefit_claims'::regclass and conname='benefit_claims_task5_no_active_publication_check';")" == "0" ]]
[[ "$(scenario_query "$accepted_db" "select string_agg(status||'|'||coalesce(active_publication_id::text,'NULL'),',' order by claim_id) from public.benefit_claims;")" == "submitted|NULL,withdrawn|NULL" ]]
[[ "$(scenario_query "$accepted_db" "select (select count(*) from public.benefit_claim_reactions)||'|'||(select count(*) from public.benefit_publications);")" == "0|0" ]]

printf 'benefit claim reactions exact Task 5 to Task 6 upgrade preflight passed\n'
