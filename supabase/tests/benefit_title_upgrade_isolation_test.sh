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

run_harness_case() {
  local timeout_seconds="$1" token="$2" log_file="$3" injection="$4" ready_marker="$5" signal_name="$6"
  shift 6
  HARNESS="$harness" RUN_TOKEN="$token" LOG_FILE="$log_file" INJECTION="$injection" \
    READY_MARKER="$ready_marker" SIGNAL_NAME="$signal_name" CASE_TIMEOUT="$timeout_seconds" \
    python3 - "$@" <<'PY'
import os
import signal
import subprocess
import sys
import time

harness = os.environ["HARNESS"]
token = os.environ["RUN_TOKEN"]
log_file = os.environ["LOG_FILE"]
injection = os.environ["INJECTION"]
ready_marker = os.environ["READY_MARKER"].encode()
signal_name = os.environ["SIGNAL_NAME"]
timeout_seconds = float(os.environ["CASE_TIMEOUT"])
environment = os.environ.copy()
if injection:
    environment["BENEFIT_TITLE_UPGRADE_INJECT"] = injection
else:
    environment.pop("BENEFIT_TITLE_UPGRADE_INJECT", None)
command = [harness, *sys.argv[1:]]
if token:
    command.extend(["--run-token", token])


def kill_group(process, sig):
    try:
        os.killpg(process.pid, sig)
    except ProcessLookupError:
        pass


def reap_after_timeout(process):
    kill_group(process, signal.SIGTERM)
    try:
        process.wait(timeout=20)
    except subprocess.TimeoutExpired:
        kill_group(process, signal.SIGKILL)
        process.wait()
    else:
        # The direct child may finish before every descendant in its session.
        kill_group(process, signal.SIGKILL)


with open(log_file, "wb", buffering=0) as log:
    process = subprocess.Popen(
        command,
        env=environment,
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    ready_deadline = time.monotonic() + 30
    case_deadline = None if ready_marker else time.monotonic() + timeout_seconds
    while True:
        status = process.poll()
        if status is not None:
            process.wait()
            kill_group(process, signal.SIGKILL)
            raise SystemExit(status)

        now = time.monotonic()
        if ready_marker and case_deadline is None:
            try:
                ready = ready_marker in open(log_file, "rb").read()
            except FileNotFoundError:
                ready = False
            if ready:
                if signal_name:
                    os.kill(process.pid, getattr(signal, f"SIG{signal_name}"))
                case_deadline = now + timeout_seconds
            elif now >= ready_deadline:
                reap_after_timeout(process)
                print("bounded runner timed out waiting for ready marker", file=sys.stderr)
                raise SystemExit(124)
        elif now >= case_deadline:
            reap_after_timeout(process)
            print(f"bounded runner timed out after {timeout_seconds:g} seconds", file=sys.stderr)
            raise SystemExit(124)
        time.sleep(0.05)
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
if ! grep -Eq '^run_harness_case\(\)' "$BASH_SOURCE"; then
  printf 'isolation guard: child harness cases need one bounded runner\n' >&2
  exit 1
fi
if ! grep -Eq '^timeout_token=' "$BASH_SOURCE"; then
  printf 'isolation guard: bounded runner needs a deterministic timeout cleanup case\n' >&2
  exit 1
fi

if run_harness_case 5 '' "$work_dir/invalid-postgres.log" '' '' '' --validate-db-name postgres; then
  printf 'database-name guard accepted postgres\n' >&2
  exit 1
fi
if run_harness_case 5 '' "$work_dir/invalid-unsafe.log" '' '' '' --validate-db-name \
    'benefit_title_upgrade_12_deadbeef_positive;drop database postgres'; then
  printf 'database-name guard accepted unsafe characters\n' >&2
  exit 1
fi
run_harness_case 5 '' "$work_dir/valid-positive.log" '' '' '' --validate-db-name \
  benefit_title_upgrade_12_deadbeef_positive
run_harness_case 5 '' "$work_dir/valid-collision.log" '' '' '' --validate-db-name \
  benefit_title_upgrade_12_deadbeef_collision

assert_no_temp_state preflight

success_token="$(token_for_case success)"
run_harness_case 120 "$success_token" "$work_dir/success.log" '' '' ''
grep -Fq 'benefit title upgrade, lock race, invalid-title rollback, and canonical collision rollback fixtures passed' "$work_dir/success.log"
grep -Fq 'canonical collision rollback preserved rows=' "$work_dir/success.log"
grep -Eq 'primary postgres database unchanged: [0-9a-f]{64}' "$work_dir/success.log"
assert_no_temp_state 'success path' "$success_token"

failure_token="$(token_for_case failure)"
set +e
run_harness_case 120 "$failure_token" "$work_dir/failure.log" race-blocked '' ''
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

timeout_token="$(token_for_case timeout)"
set +e
run_harness_case 1 "$timeout_token" "$work_dir/timeout.log" pause-race-blocked \
  'injected pause with writer and migration processes active' ''
timeout_status=$?
set -e
[[ "$timeout_status" == "124" ]] || {
  printf 'injected timeout returned %s instead of 124\n' "$timeout_status" >&2
  cat "$work_dir/timeout.log" >&2
  exit 1
}
grep -Fq 'injected pause with writer and migration processes active' "$work_dir/timeout.log"
grep -Eq 'primary postgres database unchanged: [0-9a-f]{64}' "$work_dir/timeout.log"
assert_no_temp_state 'bounded timeout' "$timeout_token"

int_token="$(token_for_case int)"
set +e
run_harness_case 20 "$int_token" "$work_dir/int.log" pause-race-blocked \
  'injected pause with writer and migration processes active' INT
int_status=$?
set -e
[[ "$int_status" == "130" ]] || {
  printf 'INT cleanup returned %s instead of 130\n' "$int_status" >&2
  cat "$work_dir/int.log" >&2
  exit 1
}
grep -Eq 'primary postgres database unchanged: [0-9a-f]{64}' "$work_dir/int.log"
assert_no_temp_state 'INT cleanup' "$int_token"

term_token="$(token_for_case term)"
set +e
run_harness_case 20 "$term_token" "$work_dir/term.log" pause-race-blocked \
  'injected pause with writer and migration processes active' TERM
term_status=$?
set -e
[[ "$term_status" == "143" ]] || {
  printf 'TERM cleanup returned %s instead of 143\n' "$term_status" >&2
  cat "$work_dir/term.log" >&2
  exit 1
}
grep -Eq 'primary postgres database unchanged: [0-9a-f]{64}' "$work_dir/term.log"
assert_no_temp_state 'TERM cleanup' "$term_token"

printf 'benefit title upgrade isolation success/failure/timeout/INT/TERM cleanup and primary-preservation probes passed\n'
