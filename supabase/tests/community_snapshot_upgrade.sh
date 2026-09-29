#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cli="$repo_root/community-app/node_modules/.bin/supabase"
db_container="supabase_db_developer-joon-community-design"
seed="$repo_root/supabase/fixtures/community-snapshot-upgrade/seed.sql"
assertions="$repo_root/supabase/fixtures/community-snapshot-upgrade/assertions.sql"

cleanup() {
  original_status=$?
  trap - EXIT
  set +e
  "$cli" db reset --local >/dev/null
  cleanup_status=$?
  if (( original_status != 0 )); then exit "$original_status"; fi
  exit "$cleanup_status"
}
trap cleanup EXIT

"$cli" db reset --local --version 202609280004 --no-seed
docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < "$seed"
"$cli" migration up --local
docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < "$assertions"
