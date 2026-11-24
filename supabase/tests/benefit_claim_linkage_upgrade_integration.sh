#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
migration_root="$repo_root/supabase/migrations"
prerequisite="$repo_root/supabase/fixtures/benefit-title-upgrade/prerequisites.sql"
project_id="$(python3 -c 'import pathlib,sys,tomllib; print(tomllib.loads(pathlib.Path(sys.argv[1]).read_text())["project_id"])' "$repo_root/supabase/config.toml")"
db_container="supabase_db_${project_id}"
token="$(printf '%s' "$$-$RANDOM-$RANDOM" | sha256sum | cut -c1-8)"
db="benefit_claim_linkage_upgrade_${token}"
valid_name() { [[ "${1:-}" =~ ^benefit_claim_linkage_upgrade_[0-9a-f]{8}$ ]]; }
admin_psql() { docker exec -i "$db_container" psql -X -Aqt -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }
scenario_psql() {
  valid_name "$db"
  { printf '%s\n' "select current_database()='$db' and current_database()<>'postgres' as safe \\gset" '\if :safe' '\else' '\quit' '\endif'; cat; } |
    docker exec -i -e "PGAPPNAME=benefit-claim-linkage-upgrade-$token" "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d "$db" "$@"
}
scenario_file() { scenario_psql <"$1"; }
scenario_query() { printf '%s\n' "$1" | scenario_psql -Aqt; }
cleanup() {
  local original="${1:-$?}" cleanup_status=0
  trap - EXIT INT TERM; set +e
  if valid_name "$db"; then
    admin_psql -c "revoke connect on database \"$db\" from public; select pg_terminate_backend(pid) from pg_stat_activity where datname='$db' and pid<>pg_backend_pid();" >/dev/null 2>&1 || cleanup_status=1
    admin_psql -c "drop database if exists \"$db\"" >/dev/null 2>&1 || cleanup_status=1
  else cleanup_status=1; fi
  (( original != 0 )) && return "$original"; return "$cleanup_status"
}
trap 'cleanup "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker inspect "$db_container" >/dev/null 2>&1 || { echo "local Supabase database container is not running" >&2; exit 1; }
valid_name "$db"
admin_psql -c "create database \"$db\" template template0" >/dev/null
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
  202611230007_benefit_claim_moderation.sql \
  202611230008_pin_benefit_validation_timezone.sql
do scenario_file "$migration_root/$migration" >/dev/null; done

scenario_query "
 insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,is_searchable,source_edition) values ('KR-BIZ-0000000009','registered_business','Link Upgrade Company','link upgrade company',true,'upgrade-test');
 insert into public.benefit_publications(publication_id,company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,source_type,provenance) values ('c9900000-0000-4000-8000-000000000001','KR-BIZ-0000000009','leave','Legacy leave','Legacy detail','official_verified','active','legacy',1,'manual','{}');
 insert into public.benefit_claims(claim_id,company_id,client_key,payload_fingerprint,category_id,title,normalized_title,description,normalized_eligibility,observed_on) values ('c9900000-0000-4000-8000-000000000002','KR-BIZ-0000000009',gen_random_uuid(),repeat('9',64),'health','Linked health','linked health','Linked detail','',date '2026-01-01');
 do \$seed\$ declare p uuid; begin
   insert into public.benefit_publications(company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,source_type,observed_at,verified_at,provenance) values ('KR-BIZ-0000000009','health','Linked health','Linked detail','community_reviewed','active','claim-c9900000-0000-4000-8000-000000000002',1,'claim_reaction',date '2026-01-01',clock_timestamp(),jsonb_build_object('claim_id','c9900000-0000-4000-8000-000000000002')) returning publication_id into p;
   update public.benefit_claims set status='community_confirmed',active_publication_id=p,revision=2 where claim_id='c9900000-0000-4000-8000-000000000002';
   set constraints all immediate; set constraints all deferred;
 end \$seed\$;
" >/dev/null

v1_function_before="$(scenario_query "select md5(pg_get_functiondef('public.get_benefit_company_v1(text)'::regprocedure));")"
search_function_before="$(scenario_query "select md5(pg_get_functiondef('public.search_benefit_companies_v1(text,text[],text,text,text,boolean,integer,text)'::regprocedure));")"
v1_result_before="$(scenario_query "select md5(public.get_benefit_company_v1('KR-BIZ-0000000009')::text);")"
search_result_before="$(scenario_query "select md5(public.search_benefit_companies_v1(null,null,null,null,null,false,20,null)::text);")"
v1_acl_before="$(scenario_query "select proacl::text from pg_proc where oid='public.get_benefit_company_v1(text)'::regprocedure;")"
data_before="$(scenario_query "select md5(jsonb_build_object('companies',(select jsonb_agg(to_jsonb(c) order by company_id) from public.benefit_companies c),'publications',(select jsonb_agg(to_jsonb(p) order by publication_id) from public.benefit_publications p),'claims',(select jsonb_agg(to_jsonb(c) order by claim_id) from public.benefit_claims c))::text);")"
scenario_file "$migration_root/202611230009_link_public_benefit_claims.sql" >/dev/null

[[ "$(scenario_query "select md5(pg_get_functiondef('public.get_benefit_company_v1(text)'::regprocedure));")" == "$v1_function_before" ]]
[[ "$(scenario_query "select md5(pg_get_functiondef('public.search_benefit_companies_v1(text,text[],text,text,text,boolean,integer,text)'::regprocedure));")" == "$search_function_before" ]]
[[ "$(scenario_query "select md5(public.get_benefit_company_v1('KR-BIZ-0000000009')::text);")" == "$v1_result_before" ]]
[[ "$(scenario_query "select md5(public.search_benefit_companies_v1(null,null,null,null,null,false,20,null)::text);")" == "$search_result_before" ]]
[[ "$(scenario_query "select proacl::text from pg_proc where oid='public.get_benefit_company_v1(text)'::regprocedure;")" == "$v1_acl_before" ]]
[[ "$(scenario_query "select md5(jsonb_build_object('companies',(select jsonb_agg(to_jsonb(c) order by company_id) from public.benefit_companies c),'publications',(select jsonb_agg(to_jsonb(p) order by publication_id) from public.benefit_publications p),'claims',(select jsonb_agg(to_jsonb(c) order by claim_id) from public.benefit_claims c))::text);")" == "$data_before" ]]
[[ "$(scenario_query "select count(*) from jsonb_array_elements(public.get_benefit_company_v2('KR-BIZ-0000000009')->'publications') item where item->>'origin_claim_id'='c9900000-0000-4000-8000-000000000002';")" == "1" ]]
[[ "$(scenario_query "select count(*) from jsonb_array_elements(public.get_benefit_company_v2('KR-BIZ-0000000009')->'publications') item where item->>'title'='Legacy leave' and item->'origin_claim_id'='null'::jsonb;")" == "1" ]]
[[ "$(scenario_query "select pg_get_userbyid(proowner)||'|'||prosecdef||'|'||(proconfig @> array['search_path=\"\"'])||'|'||has_function_privilege('anon',oid,'EXECUTE')||'|'||has_function_privilege('authenticated',oid,'EXECUTE')||'|'||has_function_privilege('service_role',oid,'EXECUTE') from pg_proc where oid='public.get_benefit_company_v2(text)'::regprocedure;")" == "postgres|t|t|t|t|f" ]]

printf 'benefit claim linkage exact 008 to 009 upgrade passed\n'
