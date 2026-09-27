#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cli="$repo_root/community-app/node_modules/.bin/supabase"
db_container="supabase_db_developer-joon-community-design"
edge_container="supabase_edge_runtime_developer-joon-community-design"
fixture="$repo_root/supabase/fixtures/public_attachment_integration.sql"
attachment_id="e3000000-0000-4000-8000-000000000001"
owner_id="e1000000-0000-4000-8000-000000000001"
object_token="e4000000-0000-4000-8000-000000000001"
storage_path="$owner_id/$object_token"
tmpdir="$(mktemp -d)"

cd "$repo_root"

cleanup() {
  local test_status=$? cleanup_status=0 storage_status curl_status
  trap - EXIT
  set +e

  if [[ -n "${API_URL:-}" && -n "${SERVICE_ROLE_KEY:-}" ]]; then
    storage_status="$(curl --silent --show-error --output "$tmpdir/cleanup-storage.json" \
      --write-out '%{http_code}' --request DELETE \
      "$API_URL/storage/v1/object/community-images" \
      --header "apikey: $SERVICE_ROLE_KEY" \
      --header "authorization: Bearer $SERVICE_ROLE_KEY" \
      --header "content-type: application/json" \
      --data "{\"prefixes\":[\"$storage_path\"]}")"
    curl_status=$?
    if (( curl_status != 0 )) || [[ "$storage_status" != "200" ]]; then
      printf 'public attachment integration: Storage cleanup failed (curl=%s, http=%s)\n' \
        "$curl_status" "${storage_status:-unavailable}" >&2
      cleanup_status=1
    fi
  fi

  if ! docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
begin;
delete from public.attachments where id = 'e3000000-0000-4000-8000-000000000001';
delete from public.posts where id = 'e2000000-0000-4000-8000-000000000001';
delete from public.profiles where id = 'e1000000-0000-4000-8000-000000000001';
delete from auth.users where id = 'e1000000-0000-4000-8000-000000000001';
commit;

do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'community-images' and name = 'e1000000-0000-4000-8000-000000000001/e4000000-0000-4000-8000-000000000001')
     or exists (select 1 from public.attachments where id = 'e3000000-0000-4000-8000-000000000001')
     or exists (select 1 from public.posts where id = 'e2000000-0000-4000-8000-000000000001')
     or exists (select 1 from public.profiles where id = 'e1000000-0000-4000-8000-000000000001')
     or exists (select 1 from auth.users where id = 'e1000000-0000-4000-8000-000000000001') then
    raise exception 'public attachment integration fixture rows remain after cleanup';
  end if;
end
$$;
SQL
  then
    printf 'public attachment integration: database cleanup or zero-row assertion failed\n' >&2
    cleanup_status=1
  fi

  rm -rf "$tmpdir"
  if (( cleanup_status != 0 )); then
    printf 'public attachment integration: cleanup failed (test exit=%s)\n' "$test_status" >&2
  fi
  if (( test_status != 0 )); then
    exit "$test_status"
  fi
  exit "$cleanup_status"
}
trap cleanup EXIT

fail() {
  printf 'public attachment integration: %s\n' "$*" >&2
  exit 1
}

header_value() {
  local wanted="${1,,}" name value
  while IFS=: read -r name value; do
    name="${name,,}"
    value="${value//$'\r'/}"
    value="${value# }"
    if [[ "$name" == "$wanted" ]]; then
      printf '%s' "$value"
      return 0
    fi
  done < "$2"
}

"$cli" start >/dev/null
"$cli" db reset --local >/dev/null
eval "$("$cli" status -o env)"
[[ -n "${API_URL:-}" ]] || fail "supabase status did not return API_URL"
[[ -n "${ANON_KEY:-}" ]] || fail "supabase status did not return ANON_KEY"
[[ -n "${SERVICE_ROLE_KEY:-}" ]] || fail "supabase status did not return SERVICE_ROLE_KEY"

# The per-worker runtime can retain an isolate across source changes. Restart it
# so this test always exercises the function currently present in the worktree.
docker restart "$edge_container" >/dev/null
function_ready=false
for _ in $(seq 1 30); do
  ready_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
    "$API_URL/functions/v1/public-attachment/not-a-uuid" || true)"
  if [[ "$ready_status" == "400" ]]; then
    function_ready=true
    break
  fi
  sleep 1
done
[[ "$function_ready" == true ]] || fail "Edge function did not become ready"

docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < "$fixture" >/dev/null
printf '\x89PNG\r\n\x1a\n' > "$tmpdir/image.png"

anon_rpc_status="$(curl --silent --show-error --output "$tmpdir/anon-rpc.json" \
  --write-out '%{http_code}' --request POST \
  "$API_URL/rest/v1/rpc/resolve_public_attachment" \
  --header "apikey: $ANON_KEY" \
  --header "authorization: Bearer $ANON_KEY" \
  --header 'content-type: application/json' \
  --data "{\"p_attachment_id\":\"$attachment_id\"}")"
[[ "$anon_rpc_status" == "401" ]] || \
  fail "anonymous resolver RPC returned $anon_rpc_status instead of 401"

upload_status="$(curl --silent --show-error --output "$tmpdir/upload.json" \
  --write-out '%{http_code}' --request POST \
  "$API_URL/storage/v1/object/community-images/$storage_path" \
  --header "apikey: $SERVICE_ROLE_KEY" \
  --header "authorization: Bearer $SERVICE_ROLE_KEY" \
  --header 'content-type: image/png' \
  --header 'x-upsert: true' \
  --data-binary "@$tmpdir/image.png")"
[[ "$upload_status" == "200" ]] || fail "Storage upload returned $upload_status"

public_url="$API_URL/functions/v1/public-attachment/$attachment_id"
detail_status="$(curl --silent --show-error --output "$tmpdir/detail.json" \
  --write-out '%{http_code}' --request POST \
  "$API_URL/rest/v1/rpc/get_public_post" \
  --header "apikey: $ANON_KEY" \
  --header "authorization: Bearer $ANON_KEY" \
  --header 'content-type: application/json' \
  --data '{"p_post_id":"e2000000-0000-4000-8000-000000000001"}')"
[[ "$detail_status" == "200" ]] || fail "public detail RPC returned $detail_status"
detail_body="$(<"$tmpdir/detail.json")"
[[ "$detail_body" == *"/functions/v1/public-attachment/$attachment_id"* ]] || \
  fail "public detail omitted the attachment-ID URL"
[[ "$detail_body" != *"$storage_path"* ]] || fail "public detail leaked the Storage path"
[[ "$detail_body" != *"$SERVICE_ROLE_KEY"* ]] || fail "public detail leaked the service role key"

eligible_status="$(curl --silent --show-error --retry 10 --retry-all-errors \
  --retry-delay 1 --output "$tmpdir/eligible.body" \
  --dump-header "$tmpdir/eligible.headers" --write-out '%{http_code}' \
  "$public_url")"
[[ "$eligible_status" == "200" ]] || fail "eligible request returned $eligible_status"
cmp --silent "$tmpdir/image.png" "$tmpdir/eligible.body" || \
  fail "eligible response bytes differ from private Storage object"
[[ "$(header_value content-type "$tmpdir/eligible.headers")" == "image/png" ]] || \
  fail "eligible response MIME is not image/png"
[[ "$(header_value content-length "$tmpdir/eligible.headers")" == "8" ]] || \
  fail "eligible response length is not exact"
[[ "$(header_value cache-control "$tmpdir/eligible.headers")" == \
  "private, no-store, max-age=0, must-revalidate" ]] || \
  fail "eligible response is cacheable"
[[ "$(header_value cross-origin-resource-policy "$tmpdir/eligible.headers")" == \
  "cross-origin" ]] || fail "eligible response lacks cross-origin CORP"
if grep -Fq "$SERVICE_ROLE_KEY" "$tmpdir/eligible.headers" "$tmpdir/eligible.body"; then
  fail "eligible response leaked the service role key"
fi

direct_status="$(curl --silent --show-error --output "$tmpdir/direct.body" \
  --write-out '%{http_code}' \
  "$API_URL/storage/v1/object/community-images/$storage_path")"
[[ "$direct_status" != "200" ]] || fail "private Storage object was anonymously readable"

delete_status="$(curl --silent --show-error --output "$tmpdir/delete.json" \
  --write-out '%{http_code}' --request DELETE \
  "$API_URL/storage/v1/object/community-images" \
  --header "apikey: $SERVICE_ROLE_KEY" \
  --header "authorization: Bearer $SERVICE_ROLE_KEY" \
  --header 'content-type: application/json' \
  --data "{\"prefixes\":[\"$storage_path\"]}")"
[[ "$delete_status" == "200" ]] || fail "Storage cleanup returned $delete_status"

docker exec "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "update public.attachments set status = 'quarantined', post_id = null, attached_at = null where id = '$attachment_id';" \
  >/dev/null

quarantined_status="$(curl --silent --show-error --output "$tmpdir/quarantined.body" \
  --dump-header "$tmpdir/quarantined.headers" --write-out '%{http_code}' \
  "$public_url")"
[[ "$quarantined_status" == "404" ]] || \
  fail "quarantined request returned $quarantined_status"
[[ "$(<"$tmpdir/quarantined.body")" == '{"error":"not_found"}' ]] || \
  fail "quarantined response was not sanitized"
[[ "$(header_value cache-control "$tmpdir/quarantined.headers")" == \
  "private, no-store, max-age=0, must-revalidate" ]] || \
  fail "quarantined response is cacheable"
if grep -Fq "$SERVICE_ROLE_KEY" "$tmpdir/quarantined.headers" "$tmpdir/quarantined.body"; then
  fail "quarantined response leaked the service role key"
fi

printf 'public attachment integration: eligible stream and quarantine rejection passed\n'
