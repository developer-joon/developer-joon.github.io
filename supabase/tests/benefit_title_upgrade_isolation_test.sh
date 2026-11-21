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

token_for_case() {
  local case_name="$1"
  printf '%s' "$$-$case_name-$RANDOM" | sha256sum | cut -c1-8
}

temp_db_count() {
  docker exec "$db_container" psql -X -Aqt -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "select count(*) from pg_catalog.pg_database where datname like 'benefit_title_upgrade\\_%' escape '\\'"
}

exact_host_processes() {
  local token="$1" proc pid start command
  for proc in /proc/[0-9]*; do
    [[ -r "$proc/cmdline" && -r "$proc/stat" ]] || continue
    pid="${proc##*/}"
    command="$(tr '\0' ' ' <"$proc/cmdline" 2>/dev/null)" || continue
    [[ "$command" == *"$token"* ]] || continue
    start="$(cut -d' ' -f22 <"$proc/stat" 2>/dev/null)" || continue
    printf '%s:%s:%s\n' "$pid" "$start" "$command"
  done
}

assert_no_temp_state() {
  local description="$1" token="${2:-}" count activities locks residue="" attempt
  if [[ -n "$token" ]]; then
    count="$(docker exec "$db_container" psql -X -Aqt -v ON_ERROR_STOP=1 -U postgres -d postgres \
      -c "select count(*) from pg_catalog.pg_database where datname like 'benefit_title_upgrade\\_%\\_${token}\\_%' escape '\\'")"
  else
    count="$(temp_db_count)"
  fi
  [[ "$count" == "0" ]] || {
    printf '%s left %s exact-token temporary databases\n' "$description" "$count" >&2
    return 1
  }
  if [[ -n "$token" ]]; then
    activities="$(docker exec "$db_container" psql -X -Aqt -v ON_ERROR_STOP=1 -U postgres -d postgres \
      -c "select count(*) from pg_catalog.pg_stat_activity where right(application_name,9)='-${token}'")"
    locks="$(docker exec "$db_container" psql -X -Aqt -v ON_ERROR_STOP=1 -U postgres -d postgres \
      -c "select count(*) from pg_catalog.pg_locks lock join pg_catalog.pg_stat_activity activity on activity.pid=lock.pid where not lock.granted and right(activity.application_name,9)='-${token}'")"
  else
    activities="$(docker exec "$db_container" psql -X -Aqt -v ON_ERROR_STOP=1 -U postgres -d postgres \
      -c "select count(*) from pg_catalog.pg_stat_activity where application_name like 'benefit-title-%'")"
    locks="$(docker exec "$db_container" psql -X -Aqt -v ON_ERROR_STOP=1 -U postgres -d postgres \
      -c "select count(*) from pg_catalog.pg_locks lock join pg_catalog.pg_stat_activity activity on activity.pid=lock.pid where not lock.granted and activity.application_name like 'benefit-title-%'")"
  fi
  [[ "$activities" == "0" ]] || {
    printf '%s left %s exact-token benefit-title database sessions\n' "$description" "$activities" >&2
    return 1
  }
  [[ "$locks" == "0" ]] || {
    printf '%s left %s exact-token ungranted database locks\n' "$description" "$locks" >&2
    return 1
  }
  if [[ -n "$token" ]]; then
    for attempt in {1..100}; do
      residue="$(exact_host_processes "$token")"
      [[ -z "$residue" ]] && break
      sleep 0.05
    done
    [[ -z "$residue" ]] || {
      printf '%s left exact-token host processes (pid:start:argv):\n%s\n' "$description" "$residue" >&2
      return 1
    }
  fi
  printf 'residue query %s: token=%s temp_dbs=%s sessions=%s ungranted_locks=%s host_processes=0\n' \
    "$description" "${token:-all}" "$count" "$activities" "$locks"
}

run_signal_case() {
  local signal_name="$1" expected_status="$2" token="$3" log_file="$4"
  HARNESS="$harness" RUN_TOKEN="$token" LOG_FILE="$log_file" SIGNAL_NAME="$signal_name" \
    EXPECTED_STATUS="$expected_status" python3 - <<'PY'
import os
import signal
import subprocess
import sys
import time

harness = os.environ["HARNESS"]
token = os.environ["RUN_TOKEN"]
log_file = os.environ["LOG_FILE"]
signal_name = os.environ["SIGNAL_NAME"]
expected = int(os.environ["EXPECTED_STATUS"])
marker = "injected pause with writer and migration processes active"
with open(log_file, "wb", buffering=0) as log:
    process = subprocess.Popen(
        [harness, "--run-token", token],
        env={**os.environ, "BENEFIT_TITLE_UPGRADE_INJECT": "pause-race-blocked"},
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if process.poll() is not None:
            break
        try:
            if marker.encode() in open(log_file, "rb").read():
                break
        except FileNotFoundError:
            pass
        time.sleep(0.05)
    else:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
        raise SystemExit("timed out waiting for signal probe pause")
    if process.poll() is not None:
        raise SystemExit(f"signal probe harness exited before pause: {process.returncode}")
    os.kill(process.pid, getattr(signal, f"SIG{signal_name}"))
    try:
        status = process.wait(timeout=20)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
        raise SystemExit("signal cleanup exceeded 20 seconds")
if status != expected:
    print(f"{signal_name} cleanup returned {status} instead of {expected}", file=sys.stderr)
    raise SystemExit(1)
print(f"{signal_name} cleanup exit={status} parent={process.pid} pgid={process.pid}")
PY
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
if ! grep -Fq 'collision_seed.sql' "$harness" || ! grep -Fq 'canonical lineage collision' "$harness"; then
  printf 'isolation guard: upgrade harness does not exercise canonical lineage collision rollback\n' >&2
  exit 1
fi
if ! grep -Fq 'run_token' "$harness"; then
  printf 'isolation guard: upgrade harness does not expose exact-run host process tracking\n' >&2
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
"$harness" --validate-db-name benefit_title_upgrade_12_deadbeef_collision

assert_no_temp_state preflight

success_token="$(token_for_case success)"
"$harness" --run-token "$success_token" >"$work_dir/success.log" 2>&1
grep -Fq 'benefit title upgrade, lock race, invalid-title rollback, and canonical collision rollback fixtures passed' "$work_dir/success.log"
grep -Fq 'canonical collision rollback preserved rows=' "$work_dir/success.log"
grep -Eq 'primary postgres database unchanged: [0-9a-f]{64}' "$work_dir/success.log"
assert_no_temp_state 'success path' "$success_token"

failure_token="$(token_for_case failure)"
set +e
BENEFIT_TITLE_UPGRADE_INJECT=race-blocked "$harness" --run-token "$failure_token" >"$work_dir/failure.log" 2>&1
failure_status=$?
set -e
[[ "$failure_status" == "98" ]] || {
  printf 'injected failure returned %s instead of 98\n' "$failure_status" >&2
  cat "$work_dir/failure.log" >&2
  exit 1
}
grep -Fq 'injected failure with writer and migration processes active' "$work_dir/failure.log"
grep -Eq 'primary postgres database unchanged: [0-9a-f]{64}' "$work_dir/failure.log"
assert_no_temp_state 'injected failure' "$failure_token"

int_token="$(token_for_case int)"
run_signal_case INT 130 "$int_token" "$work_dir/int.log"
grep -Eq 'primary postgres database unchanged: [0-9a-f]{64}' "$work_dir/int.log"
assert_no_temp_state 'INT cleanup' "$int_token"

term_token="$(token_for_case term)"
run_signal_case TERM 143 "$term_token" "$work_dir/term.log"
grep -Eq 'primary postgres database unchanged: [0-9a-f]{64}' "$work_dir/term.log"
assert_no_temp_state 'TERM cleanup' "$term_token"

printf 'benefit title upgrade isolation success/failure/INT/TERM cleanup and primary-preservation probes passed\n'
