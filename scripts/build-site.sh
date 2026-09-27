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

npm --prefix community-app ci
npm --prefix community-app run check
npm --prefix community-app run build

rm -rf _site
JEKYLL_ENV=production bundle exec jekyll build --config _config.yml,"$build_time_config" --destination _site

rm -rf _site/community
mkdir -p _site/community
cp -a community-app/dist/. _site/community/

node --test scripts/verify-site.test.mjs
node scripts/verify-site.mjs _site
