#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cli="$repo_root/community-app/node_modules/.bin/supabase"
db_container="supabase_db_developer-joon-community-design"
original_001="$repo_root/supabase/fixtures/oauth-profile-upgrade/202610040001_original.sql"
canonical_001="$repo_root/supabase/migrations/202610040001_provider_neutral_profile_provisioning.sql"
prior_behavior="$repo_root/supabase/fixtures/oauth-profile-upgrade/prior_behavior.sql"
assertions="$repo_root/supabase/fixtures/oauth-profile-upgrade/assertions.sql"

if ! cmp --silent "$original_001" "$canonical_001"; then
  printf 'Canonical OAuth migration 001 differs from its immutable fixture.\n' >&2
  exit 1
fi

cleanup() {
  original_status=$?
  trap - EXIT
  set +e
  "$cli" db reset --local --no-seed >/dev/null
  cleanup_status=$?
  if (( original_status != 0 )); then exit "$original_status"; fi
  exit "$cleanup_status"
}
trap cleanup EXIT

"$cli" db reset --local --version 202609280005 --no-seed
docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < "$original_001"
docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < "$prior_behavior"
"$cli" migration repair 202610040001 --status applied --local
"$cli" migration up --local
docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < "$assertions"
