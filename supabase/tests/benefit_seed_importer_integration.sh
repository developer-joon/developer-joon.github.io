#!/usr/bin/env bash
set -euo pipefail

script_dir="${BASH_SOURCE[0]%/*}"
repo="$(cd "$script_dir/../.." && pwd -P)"
cli="$repo/community-app/node_modules/.bin/supabase"
apply=(node "$repo/scripts/apply-benefit-directory-seed.mjs")
log=''
encoding_wrapper=''
started=0

fail() { printf 'benefit seed importer integration: %s\n' "$*" >&2; exit 1; }
command -v psql >/dev/null 2>&1 || fail "psql executable is required on PATH"
export PSQL_BIN="${PSQL_BIN:-$(realpath "$(command -v psql)")}"

cleanup() {
  status=$?
  trap - EXIT INT TERM
  set +e
  cleanup_failed=0
  cleanup_diagnostics=''
  if [[ -n "$log" ]]; then
    output="$(rm -f -- "$log" 2>&1)"
    step_status=$?
    if (( step_status != 0 )); then
      cleanup_failed=1
      cleanup_diagnostics+=$'log cleanup failed:\n'"$output"$'\n'
    fi
  fi
  if [[ -n "$encoding_wrapper" ]]; then
    output="$(rm -f -- "$encoding_wrapper" 2>&1)"
    step_status=$?
    if (( step_status != 0 )); then
      cleanup_failed=1
      cleanup_diagnostics+=$'psql wrapper cleanup failed:\n'"$output"$'\n'
    fi
  fi
  if (( started == 1 )); then
    output="$("$cli" db reset --local --no-seed 2>&1)"
    step_status=$?
    if (( step_status != 0 )); then
      cleanup_failed=1
      cleanup_diagnostics+=$'database cleanup failed:\n'"$output"$'\n'
    fi
    output="$("$cli" stop 2>&1)"
    step_status=$?
    if (( step_status != 0 )); then
      cleanup_failed=1
      cleanup_diagnostics+=$'Supabase stop failed:\n'"$output"$'\n'
    fi
  fi
  if (( cleanup_failed != 0 )); then
    printf 'benefit seed importer integration cleanup: %s\n' "${cleanup_diagnostics: -4000}" >&2
    (( status != 0 )) || status=1
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

psqlq() { psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "$1"; }
apply_must_fail() {
  if "${apply[@]}" "$@" >"$log" 2>&1; then
    fail "import unexpectedly succeeded"
  fi
  grep -Eq 'exact-state verification mismatch|schema contract mismatch|receipt mismatch|injected late seed failure|UTF-8 row digest mismatch|invalid byte sequence' "$log" || {
    tail -40 "$log" >&2
    fail "import failed for an unexpected reason"
  }
}
assert_preserved() {
  local now
  now="$(psqlq "$state_query")"
  [[ "$now" == "$baseline" ]] || fail "unrelated company/publication state changed or importer residue remains"
}

"$cli" start >/dev/null
started=1
"$cli" db reset --local --no-seed >/dev/null
eval "$("$cli" status -o env 2>/dev/null)"
export DATABASE_URL="$DB_URL"
log="$(mktemp "${TMPDIR:-$HOME}/benefit-seed-integration.XXXXXX")"

psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
insert into public.benefit_companies(
  company_id,identity_class,display_name,normalized_name,industry,size_class,region,summary,
  is_searchable,source_edition,provenance,created_at,updated_at
) values (
  'KR-BIZ-9999999999','registered_business','Unrelated Fixture','unrelated fixture','testing','small','서울','preserve exactly',
  true,'integration-fixture','{"fixture":"benefit-seed-import"}',
  '2026-01-02 03:04:05+00','2026-01-02 03:04:06+00'
);
insert into public.benefit_publications(
  publication_id,company_id,category_id,title,description,eligibility_text,condition_text,trust_tier,status,
  dedupe_key,revision,supersedes_publication_id,source_url,source_type,observed_at,verified_at,provenance,reviewer_id,
  created_at,updated_at
) values (
  'ba000000-0000-0000-0000-000000000001','KR-BIZ-9999999999','health','Unrelated publication','must remain exact',
  'everyone','none','community_reviewed','active','unrelated-fixture',1,null,'https://example.test/benefit','integration-fixture',
  '2026-01-01 00:00:00+00','2026-01-01 01:00:00+00','{"fixture":"benefit-seed-import"}','integration-reviewer',
  '2026-01-02 03:04:05+00','2026-01-02 03:04:06+00'
);
SQL

state_query="select encode(extensions.digest(convert_to((select row_to_json(c)::text from public.benefit_companies c where company_id='KR-BIZ-9999999999')||E'\\n'||(select row_to_json(p)::text from public.benefit_publications p where publication_id='ba000000-0000-0000-0000-000000000001'),'UTF8'),'sha256'),'hex')||':'||(select count(*) from public.benefit_companies where company_id<>'KR-BIZ-9999999999')||':'||(select count(*) from private.benefit_company_sources)||':'||(select count(*) from private.benefit_import_receipts)"
baseline="$(psqlq "$state_query")"
[[ "$baseline" == *":0:0:0" ]] || fail "fixture baseline is not isolated"

# A psql process that overrides the controlled client encoding cannot pass the
# independent client/server digest gate or leave transaction residue.
trusted_psql="$PSQL_BIN"
encoding_wrapper="$(mktemp "${TMPDIR:-$HOME}/benefit-seed-psql-wrapper.XXXXXX")"
printf '#!/usr/bin/env bash\nif [[ " $* " != *" --version "* ]]; then export PGCLIENTENCODING=LATIN1; fi\nexec %q "$@"\n' "$trusted_psql" >"$encoding_wrapper"
chmod 700 "$encoding_wrapper"
PSQL_BIN="$encoding_wrapper" apply_must_fail
assert_preserved
rm -f -- "$encoding_wrapper"
encoding_wrapper=''

# BEFORE company trigger rewrites a valid target row; exact read-back must abort all writes.
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
create function private.test_rewrite_seed_company() returns trigger language plpgsql set search_path='' as $$
begin
  if new.company_id='KR-BIZ-1010175441' then
    new.display_name:='trigger rewritten'; new.normalized_name:='trigger rewritten';
  end if;
  return new;
end $$;
create trigger test_rewrite_seed_company before insert or update on public.benefit_companies
for each row execute function private.test_rewrite_seed_company();
SQL
apply_must_fail
assert_preserved
psqlq "drop trigger test_rewrite_seed_company on public.benefit_companies; drop function private.test_rewrite_seed_company()"

# BEFORE source trigger rewrites provenance; jsonb equality must abort all writes.
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
create function private.test_rewrite_seed_source() returns trigger language plpgsql set search_path='' as $$
begin
  if new.company_id='KR-BIZ-1010175441' then
    new.source_binding:=new.source_binding||'{"unexpected_trigger":true}'::jsonb;
  end if;
  return new;
end $$;
create trigger test_rewrite_seed_source before insert or update on private.benefit_company_sources
for each row execute function private.test_rewrite_seed_source();
SQL
apply_must_fail
assert_preserved
psqlq "drop trigger test_rewrite_seed_source on private.benefit_company_sources; drop function private.test_rewrite_seed_source()"

# Extra import-table columns are rejected before COPY or target writes.
psqlq "alter table private.benefit_company_sources add column unexpected_column text"
apply_must_fail
assert_preserved
psqlq "alter table private.benefit_company_sources drop column unexpected_column"

# Conflicting receipt, injected late failure, and dry-run all leave exact baseline state.
psqlq "insert into private.benefit_import_receipts(bundle_digest,import_key,schema_version,source_digest,company_count,identity_counts,ordered_id_set_sha256) values (repeat('a',64),'benefit-directory-seed-v1:b7e61860d69f289735f42a6ae275c8a5303cbde367036f77865c7b20de7b9594','other',repeat('b',64),0,'{}',repeat('c',64))"
apply_must_fail
psqlq "set session_replication_role=replica; delete from private.benefit_import_receipts; set session_replication_role=origin"
assert_preserved
BENEFIT_SEED_INJECT_LATE_FAILURE=1 apply_must_fail
assert_preserved
"${apply[@]}" --dry-run >"$log" 2>&1
assert_preserved

# Normal apply and replay succeed; unrelated logical rows remain byte-for-byte equal.
PGCLIENTENCODING=LATIN1 PGOPTIONS='-c search_path=evil' "${apply[@]}" >"$log" 2>&1
first_counts="$(psqlq "select count(*)||':'||(select count(*) from private.benefit_company_sources)||':'||(select count(*) from private.benefit_import_receipts) from public.benefit_companies where company_id<>'KR-BIZ-9999999999'")"
[[ "$first_counts" == '40053:40053:1' ]] || fail "normal import counts are not exact"
[[ "$(PGCLIENTENCODING=UTF8 psqlq "select encode(convert_to(display_name,'UTF8'),'hex') from public.benefit_companies where company_id='KR-CRN-1101110193740'")" == 'ec9790ec9db4ecb998ec97a0ec97a028eca3bc29' ]] || fail "UTF-8 Korean display name changed across import"
fixture_fingerprint="${baseline%%:*}"
[[ "$(psqlq "select encode(extensions.digest(convert_to((select row_to_json(c)::text from public.benefit_companies c where company_id='KR-BIZ-9999999999')||E'\\n'||(select row_to_json(p)::text from public.benefit_publications p where publication_id='ba000000-0000-0000-0000-000000000001'),'UTF8'),'sha256'),'hex')")" == "$fixture_fingerprint" ]] || fail "normal import changed unrelated rows"
"${apply[@]}" >"$log" 2>&1
[[ "$(psqlq "select count(*)||':'||(select count(*) from private.benefit_company_sources)||':'||(select count(*) from private.benefit_import_receipts) from public.benefit_companies where company_id<>'KR-BIZ-9999999999'")" == "$first_counts" ]] || fail "replay changed exact counts"

printf 'benefit seed importer integration PASS: trigger rewrites rolled back; schema, dry-run, receipt, late-failure, apply, replay verified\n'
printf 'Tests=7\n'
