#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "${BASH_SOURCE[0]%/*}/../.." && pwd -P)"
cli="$repo/community-app/node_modules/.bin/supabase"
root="$(mktemp -d "${TMPDIR:-$HOME}/opendart-import.XXXXXX")"
started=0
cleanup() {
  local original_status="${1:-$?}" cleanup_status=0 step_status
  trap - EXIT INT TERM
  set +e
  if (( started == 1 )); then
    "$cli" db reset --local --no-seed >/dev/null 2>&1
    step_status=$?
    if (( step_status != 0 )); then
      cleanup_status=1
      printf 'database cleanup failed\n' >&2
    fi
    "$cli" stop >/dev/null 2>&1
    step_status=$?
    if (( step_status != 0 )); then
      cleanup_status=1
      printf 'Supabase stop failed\n' >&2
    fi
  fi
  rm -rf -- "$root" >/dev/null 2>&1
  step_status=$?
  if (( step_status != 0 )); then
    cleanup_status=1
    printf 'temporary directory cleanup failed\n' >&2
  fi
  if (( original_status != 0 )); then return "$original_status"; fi
  return "$cleanup_status"
}
trap 'cleanup "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
python3 - "$root/source.zip" <<'PY'
import sys,zipfile
xml='''<?xml version="1.0" encoding="UTF-8"?><result><list><corp_code>00123456</corp_code><corp_name>Integration Alpha</corp_name><corp_eng_name>INTEGRATION ALPHA</corp_eng_name><stock_code>123456</stock_code><modify_date>20261122</modify_date></list><list><corp_code>00999999</corp_code><corp_name>Integration Alpha</corp_name><corp_eng_name></corp_eng_name><stock_code></stock_code><modify_date>20260101</modify_date></list></result>'''
with zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED) as z:z.writestr('CORPCODE.xml',xml)
PY
chmod 600 "$root/source.zip"
python3 - "$root/source.zip" "$root/authority.json" <<'PY'
import hashlib,json,sys
source=open(sys.argv[1],'rb').read()
a={'schema_version':'benefit-directory-opendart-authority-v1','source_edition':'2026-11-23','official_url':'https://opendart.fss.or.kr/api/corpCode.xml','reuse_rights_note':'Reviewed synthetic integration fixture; not production authority.','source_sha256':hashlib.sha256(source).hexdigest(),'retrieved_at':'2026-11-23T00:00:00Z'}
open(sys.argv[2],'w').write(json.dumps(a,separators=(',',':'))+'\n')
PY
chmod 600 "$root/authority.json"
node "$repo/scripts/generate-opendart-benefit-directory.mjs" --source "$root/source.zip" --authority "$root/authority.json" --output "$root/bundle" >/dev/null
"$cli" start >/dev/null; started=1
"$cli" db reset --local --no-seed >/dev/null
eval "$("$cli" status -o env 2>/dev/null)"; export DATABASE_URL="$DB_URL"
container="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -n1)"
[[ -n "$container" ]] || { echo 'local Supabase database container not found' >&2; exit 1; }
if command -v psql >/dev/null 2>&1; then
  export PSQL_BIN="$(realpath "$(command -v psql)")"
  q(){ psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "$1"; }
else
  PSQL_BIN="$root/psql-wrapper"
  printf '#!/usr/bin/env bash\nset -euo pipefail\ncontainer=%q\nif [[ " $* " == *" --version "* ]]; then exec docker exec "$container" psql --version; fi\nsql=""\nfor ((i=1;i<=$#;i++)); do if [[ "${!i}" == "-f" ]]; then j=$((i+1)); sql="${!j}"; fi; done\n[[ -n "$sql" ]]\ndir="${sql%%/*}"; remote="/tmp/opendart-import-$$"\ndocker exec "$container" mkdir -m 700 "$remote"\ndocker cp "$dir/." "$container:$remote" >/dev/null\ndocker exec "$container" sed -i "s@$dir@$remote@g" "$remote/apply.sql"\nargs=("$@"); for i in "${!args[@]}"; do [[ "${args[$i]}" == "$sql" ]] && args[$i]="$remote/apply.sql"; done\nset +e\ndocker exec -i -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGCLIENTENCODING -e PGOPTIONS -e PGSSLMODE "$container" env PGHOST=127.0.0.1 PGPORT=5432 psql "${args[@]}"\nstatus=$?\nset -e\ndocker exec "$container" rm -rf "$remote"\nexit "$status"\n' "$container" >"$PSQL_BIN"
  chmod 700 "$PSQL_BIN"; export PSQL_BIN
  q(){ docker exec -i "$container" psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 -Atqc "$1"; }
fi
base_before="$(q "select count(*)||':'||(select count(*) from public.benefit_publications)||':'||(select count(*) from private.benefit_import_receipts)")"
args=(node "$repo/scripts/apply-opendart-benefit-directory.mjs" --source "$root/source.zip" --authority "$root/authority.json" --bundle "$root/bundle")
"${args[@]}" --dry-run >/dev/null
[[ "$(q "select count(*)||':'||(select count(*) from public.benefit_company_identifiers where identifier_type='opendart_corp_code')||':'||(select count(*) from private.benefit_import_receipts)")" == "${base_before%%:*}:0:${base_before##*:}" ]]
# Catalog drift must fail before COPY/write even when object names are preserved.
for mutation in trigger_dropped trigger_disabled trigger_repointed trigger_replaced function_body check_definition fk_action unique_definition browser_grant; do
  case "$mutation" in
    trigger_dropped)
      mutate="drop trigger benefit_import_receipts_immutable on private.benefit_import_receipts"
      restore="create trigger benefit_import_receipts_immutable before update or delete on private.benefit_import_receipts for each row execute function private.reject_benefit_import_receipt_change()" ;;
    trigger_disabled)
      mutate="alter table private.benefit_import_receipts disable trigger benefit_import_receipts_immutable"
      restore="alter table private.benefit_import_receipts enable trigger benefit_import_receipts_immutable" ;;
    trigger_repointed)
      mutate="create function private.test_opendart_receipt_change() returns trigger language plpgsql set search_path='' as \$\$ begin return new; end \$\$; drop trigger benefit_import_receipts_immutable on private.benefit_import_receipts; create trigger benefit_import_receipts_immutable before update or delete on private.benefit_import_receipts for each row execute function private.test_opendart_receipt_change()"
      restore="drop trigger benefit_import_receipts_immutable on private.benefit_import_receipts; drop function private.test_opendart_receipt_change(); create trigger benefit_import_receipts_immutable before update or delete on private.benefit_import_receipts for each row execute function private.reject_benefit_import_receipt_change()" ;;
    trigger_replaced)
      mutate="drop trigger benefit_import_receipts_immutable on private.benefit_import_receipts; create trigger benefit_import_receipts_immutable before insert on private.benefit_import_receipts for each row execute function private.reject_benefit_import_receipt_change()"
      restore="drop trigger benefit_import_receipts_immutable on private.benefit_import_receipts; create trigger benefit_import_receipts_immutable before update or delete on private.benefit_import_receipts for each row execute function private.reject_benefit_import_receipt_change()" ;;
    function_body)
      mutate="create or replace function private.reject_benefit_import_receipt_change() returns trigger language plpgsql set search_path='' as \$\$ begin return new; end \$\$"
      restore="create or replace function private.reject_benefit_import_receipt_change() returns trigger language plpgsql set search_path='' as E'\\nbegin\\n  raise exception ''benefit import receipts are immutable'' using errcode=''23514'';\\nend '" ;;
    check_definition)
      mutate="alter table private.benefit_import_receipts drop constraint benefit_import_receipts_company_count_check, add constraint benefit_import_receipts_company_count_check check (company_count>=-1)"
      restore="alter table private.benefit_import_receipts drop constraint benefit_import_receipts_company_count_check, add constraint benefit_import_receipts_company_count_check check (company_count>=0)" ;;
    fk_action)
      mutate="alter table private.benefit_company_sources drop constraint benefit_company_sources_company_id_fkey, add constraint benefit_company_sources_company_id_fkey foreign key(company_id) references public.benefit_companies(company_id) on delete cascade"
      restore="alter table private.benefit_company_sources drop constraint benefit_company_sources_company_id_fkey, add constraint benefit_company_sources_company_id_fkey foreign key(company_id) references public.benefit_companies(company_id) on delete restrict" ;;
    unique_definition)
      mutate="alter table private.benefit_import_receipts drop constraint benefit_import_receipts_import_key_key, add constraint benefit_import_receipts_import_key_key unique(import_key,schema_version)"
      restore="alter table private.benefit_import_receipts drop constraint benefit_import_receipts_import_key_key, add constraint benefit_import_receipts_import_key_key unique(import_key)" ;;
    browser_grant)
      mutate="grant select on private.benefit_import_receipts to anon"
      restore="revoke all on private.benefit_import_receipts from anon" ;;
  esac
  q "$mutate"
  mutation_before="$(q "select count(*)||':'||(select count(*) from public.benefit_company_identifiers where identifier_type='opendart_corp_code')||':'||(select count(*) from private.benefit_company_sources where source_contract='opendart-corp-code-v1')||':'||(select count(*) from private.benefit_import_receipts)")"
  if "${args[@]}" --apply >/dev/null 2>&1; then echo "$mutation catalog mutation unexpectedly succeeded" >&2; exit 1; fi
  [[ "$(q "select count(*)||':'||(select count(*) from public.benefit_company_identifiers where identifier_type='opendart_corp_code')||':'||(select count(*) from private.benefit_company_sources where source_contract='opendart-corp-code-v1')||':'||(select count(*) from private.benefit_import_receipts)")" == "$mutation_before" ]]
  q "$restore"
done
# Any non-internal target trigger is rejected from the complete pinned inventory
# before it can mutate unrelated target or protected state.
q "insert into public.benefit_companies(company_id,identity_class,display_name,normalized_name,is_searchable,source_edition,provenance) values('KR-BIZ-9999999999','registered_business','Trigger Sentinel','trigger sentinel',false,'integration','{}'); insert into public.benefit_publications(company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,source_type) values('KR-BIZ-9999999999','health','Sentinel title','Sentinel description','community_reviewed','withdrawn','sentinel',0,'integration')"
for target in company identifier source receipt; do
  case "$target" in
    company) table=public.benefit_companies; body="update public.benefit_companies set summary='mutated' where company_id='KR-BIZ-9999999999';" ;;
    identifier) table=public.benefit_company_identifiers; body="insert into private.benefit_company_sources(company_id,source_contract,source_digest,source_binding,bundle_digest) values('KR-BIZ-9999999999','unexpected',repeat('a',64),'{}',repeat('b',64)) on conflict do nothing;" ;;
    source) table=private.benefit_company_sources; body="insert into public.benefit_company_identifiers(identifier_id,company_id,identifier_type,identifier_digest_or_value,source_edition,verified_at) values('11111111-1111-4111-8111-111111111111','KR-BIZ-9999999999','opendart_corp_code','00888888','unexpected',pg_catalog.now()) on conflict do nothing;" ;;
    receipt) table=private.benefit_import_receipts; body="update public.benefit_publications set title='mutated' where company_id='KR-BIZ-9999999999';" ;;
  esac
  q "create function private.test_opendart_${target}_unrelated() returns trigger language plpgsql set search_path='' as \$\$ begin ${body} return new; end \$\$; create trigger test_opendart_${target}_unrelated after insert on ${table} for each row execute function private.test_opendart_${target}_unrelated()"
  inventory_before="$(q "select summary is null from public.benefit_companies where company_id='KR-BIZ-9999999999'; select title from public.benefit_publications where company_id='KR-BIZ-9999999999'; select count(*) from private.benefit_company_sources where company_id='KR-BIZ-9999999999'; select count(*) from public.benefit_company_identifiers where company_id='KR-BIZ-9999999999'")"
  if "${args[@]}" --apply >/dev/null 2>&1; then echo "$target unexpected trigger unexpectedly succeeded" >&2; exit 1; fi
  [[ "$(q "select summary is null from public.benefit_companies where company_id='KR-BIZ-9999999999'; select title from public.benefit_publications where company_id='KR-BIZ-9999999999'; select count(*) from private.benefit_company_sources where company_id='KR-BIZ-9999999999'; select count(*) from public.benefit_company_identifiers where company_id='KR-BIZ-9999999999'")" == "$inventory_before" ]]
  [[ "$(q "select count(*) from public.benefit_company_identifiers where identifier_type='opendart_corp_code' and company_id<>'KR-BIZ-9999999999'")" == 0 ]]
  q "drop trigger test_opendart_${target}_unrelated on ${table}; drop function private.test_opendart_${target}_unrelated()"
done
# Every import-owned target is verified after triggers; rewrites must roll back.
for target in company identifier source receipt; do
  case "$target" in
    company) table=public.benefit_companies; body="new.display_name:='trigger rewrite'; new.normalized_name:='trigger rewrite';" ;;
    identifier) table=public.benefit_company_identifiers; body="new.source_edition:='trigger-rewrite';" ;;
    source) table=private.benefit_company_sources; body="new.source_binding:=new.source_binding||'{\"trigger\":true}'::jsonb;" ;;
    receipt) table=private.benefit_import_receipts; body="new.company_count:=new.company_count+1;" ;;
  esac
  q "create function private.test_opendart_${target}_rewrite() returns trigger language plpgsql set search_path='' as \$\$ begin ${body} return new; end \$\$; create trigger test_opendart_${target}_rewrite before insert on ${table} for each row execute function private.test_opendart_${target}_rewrite()"
  if "${args[@]}" --apply >/dev/null 2>&1; then echo "$target trigger rewrite unexpectedly succeeded" >&2; exit 1; fi
  q "drop trigger test_opendart_${target}_rewrite on ${table}; drop function private.test_opendart_${target}_rewrite()"
  [[ "$(q "select count(*) from public.benefit_company_identifiers where identifier_type='opendart_corp_code'")" == 0 ]]
  [[ "$(q "select count(*) from private.benefit_company_sources where source_contract='opendart-corp-code-v1'")" == 0 ]]
done
# The locked protected snapshot preflight rejects the real production row cap
# before COPY or import-owned writes and leaves protected state byte-for-byte intact.
q "insert into public.benefit_publications(company_id,category_id,title,description,trust_tier,status,dedupe_key,revision,source_type) select 'KR-BIZ-9999999999','health','Snapshot '||g,'Snapshot bound fixture','community_reviewed','withdrawn','snapshot-bound',g,'integration' from generate_series(1,100000) g"
snapshot_before="$(q "select count(*)||':'||encode(extensions.digest(convert_to(jsonb_agg(to_jsonb(p) order by publication_id)::text,'UTF8'),'sha256'),'hex') from public.benefit_publications p where company_id='KR-BIZ-9999999999'")"
if "${args[@]}" --apply >/dev/null 2>&1; then echo 'oversized protected snapshot unexpectedly succeeded' >&2; exit 1; fi
[[ "$(q "select count(*)||':'||encode(extensions.digest(convert_to(jsonb_agg(to_jsonb(p) order by publication_id)::text,'UTF8'),'sha256'),'hex') from public.benefit_publications p where company_id='KR-BIZ-9999999999'")" == "$snapshot_before" ]]
[[ "$(q "select count(*) from public.benefit_company_identifiers where identifier_type='opendart_corp_code'")" == 0 ]]
q "delete from public.benefit_publications where company_id='KR-BIZ-9999999999'; delete from public.benefit_companies where company_id='KR-BIZ-9999999999'"
"${args[@]}" --apply >/dev/null
[[ "$(q "select count(*) from public.benefit_company_identifiers where identifier_type='opendart_corp_code'")" == 2 ]]
[[ "$(q "select count(*) from private.benefit_import_receipts")" == $(( ${base_before##*:} + 1 )) ]]
"${args[@]}" --apply >/dev/null
[[ "$(q "select count(*) from public.benefit_company_identifiers where identifier_type='opendart_corp_code'")" == 2 ]]
# Strong-code collision fails and preserves all rows.
q "update public.benefit_company_identifiers set company_id=(select company_id from public.benefit_company_identifiers where identifier_digest_or_value='00999999') where identifier_digest_or_value='00123456'" || true
if "${args[@]}" --apply >/dev/null 2>&1; then echo 'collision unexpectedly succeeded' >&2; exit 1; fi
# Restore, then prove a late SQL failure rolls back.
q "update public.benefit_company_identifiers i set company_id=(select company_id from public.benefit_companies c where c.provenance->>'corp_modify_date'='20261122') where identifier_digest_or_value='00123456'"
before="$(q "select count(*)||':'||(select count(*) from public.benefit_company_identifiers)||':'||(select count(*) from private.benefit_import_receipts)||':'||(select count(*) from public.benefit_publications)")"
if OPENDART_IMPORT_INJECT_LATE_FAILURE=1 "${args[@]}" --apply >/dev/null 2>&1; then echo 'late failure unexpectedly succeeded' >&2; exit 1; fi
[[ "$(q "select count(*)||':'||(select count(*) from public.benefit_company_identifiers)||':'||(select count(*) from private.benefit_import_receipts)||':'||(select count(*) from public.benefit_publications)")" == "$before" ]]
set +e
cleanup 0
cleanup_status=$?
set -e
if (( cleanup_status != 0 )); then exit "$cleanup_status"; fi
printf 'OpenDART importer integration PASS: dry-run, apply, replay, collision, rollback, preservation\n'
printf 'Tests=1\n'
