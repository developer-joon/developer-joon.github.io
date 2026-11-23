#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "${BASH_SOURCE[0]%/*}/../.." && pwd -P)"
cli="$repo/community-app/node_modules/.bin/supabase"
root="$(mktemp -d "${TMPDIR:-$HOME}/opendart-import.XXXXXX")"
started=0
cleanup(){ status=$?; trap - EXIT; if ((started)); then "$cli" db reset --local --no-seed >/dev/null 2>&1 || true; "$cli" stop >/dev/null 2>&1 || true; fi; rm -rf -- "$root"; exit "$status"; }
trap cleanup EXIT INT TERM
python3 - "$root/source.zip" <<'PY'
import sys,zipfile
xml='''<?xml version="1.0" encoding="UTF-8"?><result><list><corp_code>00123456</corp_code><corp_name>Integration Alpha</corp_name><corp_eng_name>INTEGRATION ALPHA</corp_eng_name><stock_code>123456</stock_code><modify_date>20261122</modify_date></list><list><corp_code>00999999</corp_code><corp_name>Integration Alpha</corp_name><corp_eng_name></corp_eng_name><stock_code></stock_code><modify_date>20260101</modify_date></list></result>'''
with zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED) as z:z.writestr('CORPCODE.xml',xml)
PY
chmod 600 "$root/source.zip"
node "$repo/scripts/generate-opendart-benefit-directory.mjs" --source "$root/source.zip" --output "$root/bundle" --edition 2026-11-23 --retrieved-at 2026-11-23T00:00:00Z --source-url https://opendart.fss.or.kr/api/corpCode.xml --reuse-rights 'OpenDART attribution required' >/dev/null
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
args=(node "$repo/scripts/apply-opendart-benefit-directory.mjs" --source "$root/source.zip" --bundle "$root/bundle")
"${args[@]}" --dry-run >/dev/null
[[ "$(q "select count(*)||':'||(select count(*) from public.benefit_company_identifiers where identifier_type='opendart_corp_code')||':'||(select count(*) from private.benefit_import_receipts)")" == "${base_before%%:*}:0:${base_before##*:}" ]]
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
echo 'OpenDART importer integration PASS: dry-run, apply, replay, collision, rollback, preservation'
