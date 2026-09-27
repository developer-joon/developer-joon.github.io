#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cli="$repo_root/community-app/node_modules/.bin/supabase"
db_container="supabase_db_developer-joon-community-design"
seed="$repo_root/supabase/fixtures/public-listing-upgrade/seed.sql"
assertions="$repo_root/supabase/fixtures/public-listing-upgrade/assertions.sql"

cleanup() {
  original_status=$?
  trap - EXIT
  set +e
  wait "${holder_pid:-}" 2>/dev/null
  wait "${migration_pid:-}" 2>/dev/null
  "$cli" db reset --local --no-seed >/dev/null
  cleanup_status=$?
  if (( original_status != 0 )); then exit "$original_status"; fi
  exit "$cleanup_status"
}
trap cleanup EXIT

"$cli" db reset --local --version 202609270004 --no-seed
docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < "$seed"

docker exec "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
  "begin; update public.posts set updated_at=updated_at where id=md5('listing-upgrade-1')::uuid; update private.post_reaction_daily_counts set reaction_count=reaction_count where post_id=md5('listing-upgrade-1')::uuid; select pg_sleep(3); commit" >/dev/null &
holder_pid=$!
sleep 0.25
"$cli" migration up --local >/dev/null &
migration_pid=$!
sleep 0.5

# A queued blocking index rebuild would make both writes time out behind it.
docker exec "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres -c \
  "set lock_timeout='1s'; update public.posts set updated_at=clock_timestamp() where id=md5('listing-upgrade-2')::uuid; insert into private.post_reaction_daily_counts values(md5('listing-upgrade-2')::uuid,current_date,1,1)"

wait "$holder_pid"
wait "$migration_pid"
docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < "$assertions"