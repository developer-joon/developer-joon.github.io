#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migration_root="$repo_root/supabase/migrations"
prerequisite="$repo_root/supabase/fixtures/benefit-title-upgrade/prerequisites.sql"
project_id="$(python3 -c 'import pathlib,sys,tomllib; print(tomllib.loads(pathlib.Path(sys.argv[1]).read_text())["project_id"])' "$repo_root/supabase/config.toml")"
db_container="supabase_db_${project_id}"
token="$(printf '%s' "$$-$RANDOM-$RANDOM" | sha256sum | cut -c1-8)"
db="benefit_claim_utc_upgrade_${token}"
work_dir="$(mktemp -d)"
created=0

valid_name(){ [[ "${1:-}" =~ ^benefit_claim_utc_upgrade_[0-9a-f]{8}$ ]]; }
admin_psql(){ docker exec -i "$db_container" psql -X -Aqt -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }
scenario_psql(){
  valid_name "$db" || return 2
  { printf '%s\n' "select current_database()='$db' and current_database()<>'postgres' as safe \\gset" '\if :safe' '\else' '\quit' '\endif'; cat; } |
    docker exec -i -e "PGAPPNAME=benefit-claim-utc-upgrade-$token" "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$db" "$@"
}
scenario_file(){ scenario_psql <"$1"; }
scenario_query(){ printf '%s\n' "$1" | scenario_psql -Aqt; }
cleanup(){
  local original="${1:-$?}" cleanup_status=0
  trap - EXIT INT TERM; set +e
  if (( created )); then
    admin_psql -c "revoke connect on database \"$db\" from public; select pg_terminate_backend(pid) from pg_stat_activity where datname='$db' and pid<>pg_backend_pid();" >/dev/null 2>&1 || cleanup_status=1
    admin_psql -c "drop database if exists \"$db\"" >/dev/null 2>&1 || cleanup_status=1
  fi
  rm -rf "$work_dir" || cleanup_status=1
  (( original != 0 )) && return "$original"; return "$cleanup_status"
}
trap 'cleanup "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker inspect "$db_container" >/dev/null 2>&1 || { echo 'local Supabase database container is not running' >&2; exit 1; }
valid_name "$db"
admin_psql -c "create database \"$db\" template template0" >/dev/null
created=1
scenario_file "$prerequisite" >/dev/null
scenario_query "alter table public.profiles add column display_name text, add column role text;" >/dev/null
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
  202611230005_benefit_claims.sql \
  202611230006_benefit_claim_reactions.sql \
  202611230007_benefit_claim_moderation.sql
do scenario_file "$migration_root/$migration" >/dev/null; done

scenario_query "
 insert into public.profiles(id) values ('bc800000-0000-4000-8000-000000000001');
 create or replace function private.require_google_user() returns uuid language sql stable security definer set search_path='' as \$\$select 'bc800000-0000-4000-8000-000000000001'::uuid\$\$;
 create or replace function private.require_read_committed() returns void language plpgsql stable set search_path='' as \$\$begin return; end\$\$;
 create or replace function private.consume_rate_limit(uuid,text,text) returns void language plpgsql volatile set search_path='' as \$\$begin return; end\$\$;
 insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,is_searchable,source_edition)
 values ('KR-BIZ-9980000001','registered_business','UTC Upgrade Company','utc upgrade company',true,'007-to-008-test');
 update private.benefit_feature_settings set enabled=true,updated_at=clock_timestamp() where setting_key='claims_write_enabled';
 set role authenticated; set request.jwt.claim.sub='bc800000-0000-4000-8000-000000000001';
 select public.create_benefit_claim_v1('bc810000-0000-4000-8000-000000000001','KR-BIZ-9980000001','health','Preserved claim','Preserved evidence',null,null,date '2026-01-01','https://example.com/evidence');
 reset role;
" >/dev/null

search_catalog_before="$(scenario_query "select md5(jsonb_build_object('schema',n.nspname,'owner',pg_get_userbyid(p.proowner),'security',p.prosecdef,'config',p.proconfig,'acl',p.proacl,'definition',pg_get_functiondef(p.oid))::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.oid='public.search_benefit_companies_v1(text,text[],text,text,text,boolean,integer,text)'::regprocedure;")"
search_result_before="$(scenario_query "select public.search_benefit_companies_v1(p_query=>'UTC Upgrade')::text;")"
data_before="$(scenario_query "select md5(jsonb_build_object('claims',(select jsonb_agg(to_jsonb(c) order by claim_id) from public.benefit_claims c),'events',(select jsonb_agg(to_jsonb(e) order by event_id) from public.benefit_claim_events e))::text);")"

scenario_file "$migration_root/202611230008_pin_benefit_validation_timezone.sql" >/dev/null

[[ "$(scenario_query "select md5(jsonb_build_object('schema',n.nspname,'owner',pg_get_userbyid(p.proowner),'security',p.prosecdef,'config',p.proconfig,'acl',p.proacl,'definition',pg_get_functiondef(p.oid))::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.oid='public.search_benefit_companies_v1(text,text[],text,text,text,boolean,integer,text)'::regprocedure;")" == "$search_catalog_before" ]]
[[ "$(scenario_query "select public.search_benefit_companies_v1(p_query=>'UTC Upgrade')::text;")" == "$search_result_before" ]]
[[ "$(scenario_query "select md5(jsonb_build_object('claims',(select jsonb_agg(to_jsonb(c) order by claim_id) from public.benefit_claims c),'events',(select jsonb_agg(to_jsonb(e) order by event_id) from public.benefit_claim_events e))::text);")" == "$data_before" ]]

[[ "$(scenario_query "select n.nspname||'|'||pg_get_userbyid(p.proowner)||'|'||p.prosecdef||'|'||p.pronargs||'|'||p.pronargdefaults||'|'||(p.proconfig @> array['search_path=\"\"','TimeZone=UTC']) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.oid='public.create_benefit_claim_v1(uuid,text,text,text,text,text,text,date,text)'::regprocedure;")" == 'public|postgres|true|9|0|true' ]]
[[ "$(scenario_query "select proargnames::text from pg_proc where oid='public.create_benefit_claim_v1(uuid,text,text,text,text,text,text,date,text)'::regprocedure;")" == '{p_client_key,p_company_id,p_category_id,p_title,p_description,p_eligibility_text,p_condition_text,p_observed_on,p_source_url}' ]]
[[ "$(scenario_query "select string_agg(coalesce(r.rolname,'PUBLIC'),',' order by coalesce(r.rolname,'PUBLIC')) from aclexplode((select proacl from pg_proc where oid='public.create_benefit_claim_v1(uuid,text,text,text,text,text,text,date,text)'::regprocedure)) a left join pg_roles r on r.oid=a.grantee where a.privilege_type='EXECUTE';")" == 'authenticated,postgres' ]]
[[ "$(scenario_query "select to_regprocedure('private.create_benefit_claim_impl_v1(uuid,text,text,text,text,text,text,date,text)') is not null and not has_function_privilege('anon','private.create_benefit_claim_impl_v1(uuid,text,text,text,text,text,text,date,text)','execute') and not has_function_privilege('authenticated','private.create_benefit_claim_impl_v1(uuid,text,text,text,text,text,text,date,text)','execute') and not has_function_privilege('service_role','private.create_benefit_claim_impl_v1(uuid,text,text,text,text,text,text,date,text)','execute');")" == 't' ]]
[[ "$(scenario_query "select bool_and(proconfig @> array['TimeZone=UTC']) from pg_proc where oid=any(array['private.create_benefit_claim_impl_v1(uuid,text,text,text,text,text,text,date,text)'::regprocedure,'private.validate_benefit_claim_official_review()'::regprocedure,'public.officially_verify_benefit_claim_v1(uuid,text,bigint,text,text,text,text,text,text,date,text,uuid)'::regprocedure,'public.moderate_benefit_claim_v1(uuid,uuid,bigint,text,text,uuid,text,text,date,text)'::regprocedure]);")" == 't' ]]

set +e
scenario_query "set role authenticated; set request.jwt.claim.sub='bc800000-0000-4000-8000-000000000001'; select public.create_benefit_claim_v1('bc810000-0000-4000-8000-000000000002','KR-BIZ-9980000001','health','Omitted date','Must fail');" >"$work_dir/omitted.log" 2>&1
omitted_status=$?
set -e
[[ "$omitted_status" != 0 ]]
grep -Fq 'function public.create_benefit_claim_v1' "$work_dir/omitted.log"

scenario_query "set role authenticated; set request.jwt.claim.sub='bc800000-0000-4000-8000-000000000001'; set timezone='Pacific/Kiritimati'; select public.create_benefit_claim_v1('bc810000-0000-4000-8000-000000000003','KR-BIZ-9980000001','health','UTC plus fourteen','Accepted',null,null,timezone('UTC',statement_timestamp())::date,null); reset role;" >/dev/null
set +e
scenario_query "set role authenticated; set request.jwt.claim.sub='bc800000-0000-4000-8000-000000000001'; set timezone='Pacific/Kiritimati'; select public.create_benefit_claim_v1('bc810000-0000-4000-8000-000000000004','KR-BIZ-9980000001','health','UTC tomorrow','Rejected',null,null,timezone('UTC',statement_timestamp())::date+1,null);" >"$work_dir/tomorrow.log" 2>&1
tomorrow_status=$?
set -e
[[ "$tomorrow_status" != 0 ]]
grep -Fq 'invalid observed date' "$work_dir/tomorrow.log"
scenario_query "set role authenticated; set request.jwt.claim.sub='bc800000-0000-4000-8000-000000000001'; set timezone='Etc/GMT+12'; select public.create_benefit_claim_v1('bc810000-0000-4000-8000-000000000005','KR-BIZ-9980000001','leave','UTC minus twelve','Accepted',null,null,timezone('UTC',statement_timestamp())::date,null); reset role;" >/dev/null

printf 'benefit claim exact 007 to 008 UTC upgrade passed\n'
