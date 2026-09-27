#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
site_build_time="${SITE_BUILD_TIME:-}"

if [[ -z "$site_build_time" ]]; then
  if ! git -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo 'SITE_BUILD_TIME is required when git metadata is unavailable' >&2
    exit 1
  fi
  site_build_time="$(git -C "$repo_root" log -1 --format=%cI)"
fi

if [[ ! "$site_build_time" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$ ]] \
  || ! date --date="$site_build_time" +%s >/dev/null 2>&1; then
  echo 'SITE_BUILD_TIME must be an ISO 8601 timestamp with an explicit timezone' >&2
  exit 1
fi

printf '%s\n' "$site_build_time"
