#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

npm --prefix community-app ci
npm --prefix community-app run check
npm --prefix community-app run build

rm -rf _site
JEKYLL_ENV=production bundle exec jekyll build --destination _site

rm -rf _site/community
mkdir -p _site/community
cp -a community-app/dist/. _site/community/

node --test scripts/verify-site.test.mjs
node scripts/verify-site.mjs _site
