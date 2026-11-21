#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
harness="$repo_root/supabase/tests/benefit_title_upgrade.sh"
db_container="supabase_db_developer-joon-community-design"
work_dir="$(mktemp -d)"
cleanup_test() {
  local status=$? job
  trap - EXIT INT TERM
  set +e
  for job in $(jobs -pr); do kill "$job" 2>/dev/null; wait "$job" 2>/dev/null; done
  rm -rf "$work_dir"
  exit "$status"
}
trap cleanup_test EXIT INT TERM

temp_db_count() {
  docker exec "$db_container" psql -X -Aqt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "select count(*) from pg_catalog.pg_database where datname like 'benefit_title_upgrade\\_%' escape '\\'"
}

assert_no_temp_state() {
  local description="$1" count activities
  count="$(temp_db_count)"
  [[ "$count" == "0" ]] || {
    printf '%s left %s temporary databases\n' "$description" "$count" >&2
    return 1
  }
  activities="$(docker exec "$db_container" psql -X -Aqt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "select count(*) from pg_catalog.pg_stat_activity where application_name like 'benefit-title-%'")"
  [[ "$activities" == "0" ]] || {
    printf '%s left %s benefit-title database sessions\n' "$description" "$activities" >&2
    return 1
  }
}

if grep -Eq '"\$cli" db reset|supabase[[:space:]]+db[[:space:]]+reset' "$harness"; then
  printf 'isolation guard: upgrade harness must not invoke the primary reset command\n' >&2
  exit 1
fi
if ! grep -Fq "current_database() <> 'postgres' and current_database() = :'expected_db'" "$harness"; then
  printf 'isolation guard: every scenario connection needs the centralized identity assertion\n' >&2
  exit 1
fi
if grep -Eq 'scenario_(file|query)[[:space:]]+"?postgres|-[dD][[:space:]]+postgres[^[:space:]]*[[:space:]]*<' "$harness"; then
  printf 'isolation guard: scenario mutation targets primary postgres database\n' >&2
  exit 1
fi

if "$harness" --validate-db-name postgres 2>/dev/null; then
  printf 'database-name guard accepted postgres\n' >&2
  exit 1
fi
if "$harness" --validate-db-name 'benefit_title_upgrade_12_deadbeef_positive;drop database postgres' 2>/dev/null; then
  printf 'database-name guard accepted unsafe characters\n' >&2
  exit 1
fi
"$harness" --validate-db-name benefit_title_upgrade_12_deadbeef_positive

assert_no_temp_state preflight
"$harness" >"$work_dir/success.log" 2>&1
grep -Fq 'benefit title upgrade, lock race, and rollback fixtures passed' "$work_dir/success.log"
grep -Eq 'primary postgres database unchanged: [0-9a-f]{64}' "$work_dir/success.log"
assert_no_temp_state 'success path'

set +e
BENEFIT_TITLE_UPGRADE_INJECT=race-blocked "$harness" >"$work_dir/failure.log" 2>&1
failure_status=$?
set -e
[[ "$failure_status" == "98" ]] || {
  printf 'injected failure returned %s instead of 98\n' "$failure_status" >&2
  cat "$work_dir/failure.log" >&2
  exit 1
}
grep -Fq 'injected failure with writer and migration processes active' "$work_dir/failure.log"
grep -Eq 'primary postgres database unchanged: [0-9a-f]{64}' "$work_dir/failure.log"
assert_no_temp_state 'injected failure'

BENEFIT_TITLE_UPGRADE_INJECT=pause-race-blocked "$harness" >"$work_dir/signal.log" 2>&1 &
signal_pid=$!
for _ in {1..200}; do
  grep -Fq 'injected pause with writer and migration processes active' "$work_dir/signal.log" 2>/dev/null && break
  kill -0 "$signal_pid" 2>/dev/null || {
    printf 'signal probe harness exited before pause\n' >&2
    cat "$work_dir/signal.log" >&2
    exit 1
  }
  sleep 0.05
done
grep -Fq 'injected pause with writer and migration processes active' "$work_dir/signal.log" || {
  printf 'timed out waiting for signal probe pause\n' >&2
  exit 1
}
kill -TERM "$signal_pid"
set +e
wait "$signal_pid"
signal_status=$?
set -e
[[ "$signal_status" == "143" ]] || {
  printf 'signal cleanup returned %s instead of 143\n' "$signal_status" >&2
  cat "$work_dir/signal.log" >&2
  exit 1
}
grep -Eq 'primary postgres database unchanged: [0-9a-f]{64}' "$work_dir/signal.log"
assert_no_temp_state 'signal cleanup'

printf 'benefit title upgrade isolation, cleanup, and primary-preservation probes passed\n'
