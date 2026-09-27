#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "Usage: $0 BUILD_1_DIR BUILD_2_DIR [EVIDENCE_DIR]" >&2
  exit 2
fi

first="$(cd "$1" && pwd)"
second="$(cd "$2" && pwd)"
evidence="${3:-reproducibility-evidence}"
mkdir -p "$evidence"
evidence="$(cd "$evidence" && pwd)"

write_manifest() {
  local site_dir="$1"
  local output="$2"
  (
    cd "$site_dir"
    LC_ALL=C find . -type f -print0 | LC_ALL=C sort -z | xargs -0r sha256sum
  ) > "$output"
}

write_manifest "$first" "$evidence/build-1.sha256"
write_manifest "$second" "$evidence/build-2.sha256"

if ! cmp -s "$evidence/build-1.sha256" "$evidence/build-2.sha256"; then
  diff -u "$evidence/build-1.sha256" "$evidence/build-2.sha256" >&2 || true
  echo 'site builds are not byte-reproducible' >&2
  exit 1
fi

file_count="$(wc -l < "$evidence/build-1.sha256")"
manifest_sha="$(sha256sum "$evidence/build-1.sha256" | cut -d ' ' -f 1)"
printf 'site builds are byte-reproducible: %s files, manifest sha256 %s\n' "$file_count" "$manifest_sha"
