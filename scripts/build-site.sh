#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
site_build_time="$(./scripts/resolve-site-build-time.sh)"
build_time_config="$(mktemp "${TMPDIR:-/tmp}/breadlab-jekyll-time.XXXXXX.yml")"
cleanup() {
  rm -f "$build_time_config"
}
trap cleanup EXIT
printf 'time: "%s"\n' "$site_build_time" > "$build_time_config"

node --test scripts/community-snapshots.test.mjs

npm --prefix community-app ci
npm --prefix community-app run check
npm --prefix community-app run build

rm -rf _site
JEKYLL_ENV=production bundle exec jekyll build --config _config.yml,"$build_time_config" --destination _site

rm -rf _site/community
mkdir -p _site/community
cp -a community-app/dist/. _site/community/

case "${COMMUNITY_SNAPSHOT_MODE:-fixture}" in
  fixture)
    node scripts/community-snapshots.mjs --output _site/community/content --sitemap _site/sitemap.xml --fixture scripts/fixtures/community-snapshots.json
    ;;
  live)
    : "${SUPABASE_URL:?SUPABASE_URL is required in live mode}"
    : "${SUPABASE_PUBLISHABLE_KEY:?SUPABASE_PUBLISHABLE_KEY is required in live mode}"
    node scripts/community-snapshots.mjs --output _site/community/content --sitemap _site/sitemap.xml
    ;;
  *)
    printf 'Unsupported COMMUNITY_SNAPSHOT_MODE: %s\n' "$COMMUNITY_SNAPSHOT_MODE" >&2
    exit 1
    ;;
esac

node --test scripts/verify-site.test.mjs
node scripts/verify-site.mjs _site
