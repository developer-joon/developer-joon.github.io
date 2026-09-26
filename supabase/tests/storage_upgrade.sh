#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cli="$repo_root/community-app/node_modules/.bin/supabase"
db_container="supabase_db_developer-joon-community-design"
seed="$repo_root/supabase/fixtures/storage-upgrade/storage_upgrade_seed.sql"
assertions="$repo_root/supabase/fixtures/storage-upgrade/storage_upgrade_assertions.sql"

# The fixture is destructive by design. Prefer restoring the clean latest
# schema. If the migration under test is broken, fall back to migration 002
# while preserving the original failing status for the caller.
cleanup() {
  original_status=$?
  trap - EXIT
  set +e

  "$cli" db reset --local --no-seed >/dev/null
  latest_status=$?
  if (( latest_status != 0 )); then
    printf 'latest-schema cleanup failed; restoring migration 002 fallback\n' >&2
    "$cli" db reset --local --version 202609260002 --no-seed >/dev/null
    fallback_status=$?
    if (( fallback_status != 0 )); then
      printf 'migration-002 fallback cleanup also failed\n' >&2
    fi
  fi

  if (( original_status != 0 )); then
    exit "$original_status"
  fi
  exit "$latest_status"
}
trap cleanup EXIT

"$cli" db reset --local --version 202609260002 --no-seed
docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < "$seed"
"$cli" migration up --local
"$cli" test db --local "$assertions"
