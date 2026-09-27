#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

image="breadlab-site-build:local"
output="${1:-_site-docker}"
site_build_time="$(./scripts/resolve-site-build-time.sh)"
container=''
cleanup() {
  if [[ -n "$container" ]]; then
    docker rm "$container" >/dev/null
  fi
}
trap cleanup EXIT

docker build --platform linux/amd64 --build-arg SITE_BUILD_TIME="$site_build_time" --file Dockerfile.build --target build --tag "$image" .
container="$(docker create "$image")"
rm -rf "$output"
docker cp "$container:/work/_site" "$output"
