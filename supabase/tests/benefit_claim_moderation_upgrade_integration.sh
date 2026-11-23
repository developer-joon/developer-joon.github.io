#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migration_root="$repo_root/supabase/migrations"
prerequisite="$repo_root/supabase/fixtures/benefit-title-upgrade/prerequisites.sql"
project_id="$(python3 -c 'import pathlib,sys,tomllib; print(tomllib.loads(pathlib.Path(sys.argv[1]).read_text())["project_id"])' "$repo_root/supabase/config.toml")"
db_container="supabase_db_${project_id}"
token="$(printf '%s' "$$-$RANDOM-$RANDOM" | sha256sum | cut -c1-8)"
prefix="benefit_claim_moderation_upgrade_${token}"
temp_dbs=()
work_dir="$(mktemp -d)"

valid_name() { [[ "${1:-}" =~ ^benefit_claim_moderation_upgrade_[0-9a-f]{8}_(accepted|rejected)$ ]]; }
admin_psql() { docker exec -i "$db_container" psql -X -Aqt -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }
tracked() { local d="$1" x; valid_name "$d" || return 1; for x in "${temp_dbs[@]}"; do [[ "$x" == "$d" ]] && return 0; done; return 1; }
scenario_psql() {
  local db="$1"; shift; tracked "$db" || return 2
  { printf '%s\n' "select current_database() = '$db' and current_database()<>'postgres' as safe \\gset" '\if :safe' '\else' '\quit' '\endif'; cat; } |
    docker exec -i -e "PGAPPNAME=benefit-claim-moderation-upgrade-$token" "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$db" "$@"
}
scenario_file() { local db="$1" file="$2"; scenario_psql "$db" <"$file"; }
scenario_query() { local db="$1" sql="$2"; printf '%s\n' "$sql" | scenario_psql "$db" -Aqt; }
cleanup() {
  local original="${1:-$?}" cleanup_status=0 db
  trap - EXIT INT TERM; set +e
  for db in "${temp_dbs[@]}"; do
    valid_name "$db" || { cleanup_status=1; continue; }
    admin_psql -c "revoke connect on database \"$db\" from public; select pg_terminate_backend(pid) from pg_stat_activity where datname='$db' and pid<>pg_backend_pid();" >/dev/null 2>&1 || cleanup_status=1
    admin_psql -c "drop database if exists \"$db\"" >/dev/null 2>&1 || cleanup_status=1
  done
  rm -rf "$work_dir" || cleanup_status=1
  (( original != 0 )) && return "$original"; return "$cleanup_status"
}
trap 'cleanup "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker inspect "$db_container" >/dev/null 2>&1 || { echo "local Supabase database container is not running" >&2; exit 1; }
create_db() { local db="$1"; valid_name "$db"; admin_psql -c "create database \"$db\" template template0" >/dev/null; temp_dbs+=("$db"); }
apply_through_006() {
  local db="$1" m
  create_db "$db"
  scenario_file "$db" "$prerequisite" >/dev/null
  scenario_query "$db" "alter table public.profiles add column display_name text, add column role text;" >/dev/null
  for m in \
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
    202611230005_benefit_claims.sql \
    202611230006_benefit_claim_reactions.sql
  do scenario_file "$db" "$migration_root/$m" >/dev/null; done
  scenario_query "$db" "insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,source_edition) values ('KR-BIZ-0000000007','registered_business','Task 7 Upgrade Company','task 7 upgrade company','upgrade-test');" >/dev/null
}

accepted="${prefix}_accepted"
apply_through_006 "$accepted"
scenario_query "$accepted" "
 insert into public.profiles(id) values ('b9700000-0000-4000-8000-000000000099');
 create or replace function private.require_google_user() returns uuid language sql stable security definer set search_path='' as \$\$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid\$\$;
 create or replace function private.require_read_committed() returns void language plpgsql stable set search_path='' as \$\$begin return; end\$\$;
 create or replace function private.consume_rate_limit(uuid,text,text) returns void language plpgsql volatile set search_path='' as \$\$begin return; end\$\$;
 insert into public.benefit_claims(claim_id,company_id,client_key,payload_fingerprint,category_id,title,normalized_title,description,normalized_eligibility,observed_on)
 values ('b9700000-0000-4000-8000-000000000001','KR-BIZ-0000000007',gen_random_uuid(),repeat('7',64),'health','Legal Task 6 claim','legal task 6 claim','Legal fixture','',date '2026-01-01');
 insert into public.benefit_claims(claim_id,company_id,submitter_id,client_key,payload_fingerprint,category_id,title,normalized_title,description,normalized_eligibility,observed_on)
 values ('b9700000-0000-4000-8000-000000000002','KR-BIZ-0000000007','b9700000-0000-4000-8000-000000000099',gen_random_uuid(),repeat('9',64),'health','Withdrawn Task 6 claim','withdrawn task 6 claim','Withdrawn fixture','',date '2026-01-01');
 insert into public.benefit_claim_reactions(claim_id,user_id,reaction) values ('b9700000-0000-4000-8000-000000000001','b9700000-0000-4000-8000-000000000002','confirm');
 update private.benefit_feature_settings set enabled=true where setting_key='claims_write_enabled';
 set role authenticated;
 set request.jwt.claim.sub='b9700000-0000-4000-8000-000000000099';
 select public.withdraw_benefit_claim_v1('b9700000-0000-4000-8000-000000000098','b9700000-0000-4000-8000-000000000002','submitted',1);
 reset role;
" >/dev/null
scenario_file "$accepted" "$migration_root/202611230007_benefit_claim_moderation.sql" >/dev/null
[[ "$(scenario_query "$accepted" "select status||'|'||revision||'|'||coalesce(official_publication_id::text,'NULL')||'|'||coalesce(merged_into_claim_id::text,'NULL') from public.benefit_claims where claim_id='b9700000-0000-4000-8000-000000000001';")" == "submitted|1|NULL|NULL" ]]
[[ "$(scenario_query "$accepted" "select count(*) from public.benefit_claim_reactions where claim_id='b9700000-0000-4000-8000-000000000001';")" == "1" ]]
[[ "$(scenario_query "$accepted" "select response::text from public.benefit_claim_moderation_requests where actor_snapshot='b9700000-0000-4000-8000-000000000099' and client_key='b9700000-0000-4000-8000-000000000098';")" == '{"status": "withdrawn", "outcome": "withdrawn", "claim_id": "b9700000-0000-4000-8000-000000000002", "revision": 2}' ]]
[[ "$(scenario_query "$accepted" "set role authenticated; set request.jwt.claim.sub='b9700000-0000-4000-8000-000000000099'; select public.withdraw_benefit_claim_v1('b9700000-0000-4000-8000-000000000098','b9700000-0000-4000-8000-000000000002','submitted',1)::text;")" == '{"status": "withdrawn", "outcome": "withdrawn", "claim_id": "b9700000-0000-4000-8000-000000000002", "revision": 2}' ]]

rejected="${prefix}_rejected"
apply_through_006 "$rejected"
scenario_query "$rejected" "
 insert into public.benefit_claims(claim_id,company_id,client_key,payload_fingerprint,category_id,title,normalized_title,description,normalized_eligibility,observed_on)
 values ('b9700000-0000-4000-8000-000000000011','KR-BIZ-0000000007',gen_random_uuid(),repeat('8',64),'health','Spoofed prior claim','spoofed prior claim','Spoof fixture','',date '2026-01-01');
 insert into public.benefit_publications(company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,source_type,source_url,observed_at,verified_at,provenance)
 values ('KR-BIZ-0000000007','health','Spoof official','Spoof official','official_verified','active','claim-b9700000-0000-4000-8000-000000000011',1,'claim_official','https://example.com/spoof',date '2026-01-01',clock_timestamp(),jsonb_build_object('claim_id','b9700000-0000-4000-8000-000000000011'));
" >/dev/null
set +e
scenario_file "$rejected" "$migration_root/202611230007_benefit_claim_moderation.sql" >"$work_dir/rejected.log" 2>&1
status=$?
set -e
[[ "$status" != 0 ]]
grep -Fq 'benefit claim moderation upgrade blocked: incomplete or spoofed Task 6 claim invariant' "$work_dir/rejected.log"
[[ "$(scenario_query "$rejected" "select to_regclass('public.benefit_claim_official_reviews') is null;")" == "t" ]]
[[ "$(scenario_query "$rejected" "select count(*) from information_schema.columns where table_schema='public' and table_name='benefit_claims' and column_name in ('official_publication_id','merged_into_claim_id');")" == "0" ]]
[[ "$(scenario_query "$rejected" "select count(*) from public.benefit_publications where source_type='claim_official';")" == "1" ]]

printf 'benefit claim moderation exact Task 6 to Task 7 upgrade passed\n'
