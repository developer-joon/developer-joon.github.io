# OpenDART benefit-directory expansion import

This pipeline adds official OpenDART corporation identities without modifying the frozen 40,053-row base bundle and without merging by company name. The generated production bundle is intentionally absent until an authentic official `corpCode` ZIP is retained locally and its edition, retrieval time, source URL, and reuse-rights note are known.

## Authority and acquisition

The generator never fetches the network. Obtain the ZIP from the official OpenDART `corpCode.xml` API using an owner-managed `OPENDART_API_KEY` outside this command. An owner must then review and create a separate authority descriptor (the planned tracked production path is `supabase/fixtures/benefit-directory-opendart-authority.json`) with exactly these keys:

```json
{"schema_version":"benefit-directory-opendart-authority-v1","source_edition":"<reviewed edition>","official_url":"https://opendart.fss.or.kr/api/corpCode.xml","reuse_rights_note":"<reviewed bounded note>","source_sha256":"<sha256 of retained ZIP>","retrieved_at":"<YYYY-MM-DDTHH:mm:ssZ>"}
```

The descriptor is caller/owner controlled, bounded, read without following symlinks, and is never generated or overwritten by the generator. The URL is an exact allowlist, not an arbitrary HTTPS URL. Do **not** create the planned production descriptor or bundle until authentic official bytes and reuse-rights review exist. That external source/review remains the production blocker.

Do not put API keys, request URLs containing keys, or credentials in the repository, shell history, manifest, or logs. There is no acquisition command in this repository because no key is present and a source must not be fabricated or substituted.

The reader uses bounded no-follow descriptor reads. The ZIP contract is exact and versioned by this document: classic ZIP only; one disk; one case-sensitive UTF-8 `CORPCODE.xml` member; creator version `3.20` (Unix) and extraction version `2.0`; stored or raw-deflate compression only; no encryption, data descriptor, or unsupported flags; no symlink or other non-regular file mode; local-header offset zero; central/local flags, method, CRC, compressed size, uncompressed size, and name byte-for-byte equal; bounded compressed/uncompressed sizes and expansion ratio; member data ending exactly at the central-directory offset with no prefix, padding, overlap, or trailing member; one exact central record; and an exact EOCD ending at EOF with zero disk numbers, exact entry counts, central size, and central offset. `scripts/opendart-zip-contract-test-corpus.mjs` is the shared accept/reject mutation corpus; the generator and verifier deliberately keep separate parser implementations and each runs that corpus.

The narrow XML reader rejects DTDs, declared/custom entities, CDATA, unknown structure, malformed UTF-8, duplicate/invalid eight-digit `corp_code`, invalid six-digit stock codes, blank or overlong names, and invalid `YYYYMMDD` dates. Authority and retrieval timestamps use exactly `YYYY-MM-DDTHH:mm:ssZ`: no fractional seconds or offsets, and every calendar/time component must round-trip exactly (including leap-day validation). Generator, independent verifier, and importer each enforce that contract independently.

## Generate, check, and verify

Use a pre-existing caller-owned output parent that is not a symlink and is not group/world writable (`mode & 0022 == 0`; tracked `0755` fixture parents are valid). Generation arguments are explicit:

```bash
node scripts/generate-opendart-benefit-directory.mjs \
  --source "$HOME/private/opendart/corpCode-2026-11-23.zip" \
  --authority supabase/fixtures/benefit-directory-opendart-authority.json \
  --output supabase/fixtures/benefit-directory-opendart

node scripts/generate-opendart-benefit-directory.mjs --check \
  --source "$HOME/private/opendart/corpCode-2026-11-23.zip" \
  --authority supabase/fixtures/benefit-directory-opendart-authority.json \
  --output supabase/fixtures/benefit-directory-opendart

node scripts/verify-opendart-benefit-directory.mjs \
  --source "$HOME/private/opendart/corpCode-2026-11-23.zip" \
  --authority supabase/fixtures/benefit-directory-opendart-authority.json \
  --bundle supabase/fixtures/benefit-directory-opendart
```

`--check` is strictly read-only: it creates no directory, lock, stage, backup, or temporary file. Missing production output fails with an actionable message. Normal generation uses an owner-only advisory lock, same-filesystem mode-0700 staging, mode-0600 fsynced files, exact inventory validation, and rollback-preserving directory replacement.

The independent verifier does not import generator code. It parses the source and all bundle bytes independently, recomputes source/output hashes, row counts, deterministic IDs, aliases, provenance, ordering, and exact sets. Rewriting mutable manifest fields cannot make deletion or substitution pass.

Company IDs are `KR-CAN-` plus the first 32 lowercase hex characters of SHA-256 over the domain `benefit-directory-opendart-company-v1`, a NUL separator, and a length-framed exact edition plus `corp_code`. Identifier UUIDs use a separate domain and RFC-4122-shaped bits. Both sets are collision checked. Names never cause reuse. The English name is an alias only when nonblank and different from the official Korean/name field. No activity, workforce, size, region, or benefit status is inferred.

## Dry run and apply

Use only an explicitly authorized database. Local verification uses loopback Supabase:

```bash
export PSQL_BIN="$(realpath "$(command -v psql)")"
export DATABASE_URL='postgresql://postgres:***@127.0.0.1:54322/postgres'
node scripts/apply-opendart-benefit-directory.mjs \
  --source "$HOME/private/opendart/corpCode-2026-11-23.zip" \
  --authority supabase/fixtures/benefit-directory-opendart-authority.json \
  --bundle supabase/fixtures/benefit-directory-opendart --dry-run
node scripts/apply-opendart-benefit-directory.mjs \
  --source "$HOME/private/opendart/corpCode-2026-11-23.zip" \
  --authority supabase/fixtures/benefit-directory-opendart-authority.json \
  --bundle supabase/fixtures/benefit-directory-opendart --apply
```

Exactly one of `--dry-run` or `--apply` is required. The importer independently verifies the bundle before connecting, accepts only a trusted absolute `psql`, supplies a clean UTF-8 PostgreSQL environment, uses owner-only temporary custody, client/server length-framed UTF-8 row digests, a transaction advisory lock, staging uniqueness, and exact read-back checks. Before COPY or any target write it compares migration-derived normalized catalog hashes for every relied-on column/type/nullability/default/generated expression, PK/unique/check/FK definition and delete action, owner/RLS/ACL state, plus the immutable-receipt function metadata/body hash/ACL and exact trigger table/events/enabled/function binding. A `corp_code` already bound to another company, a deterministic company with a different payload, or a conflicting receipt fails. Existing exact rows replay idempotently. Existing receipts and every publication row are snapshotted and checked unchanged. Dry-run executes the complete path and rolls back.

For local rollback testing, `OPENDART_IMPORT_INJECT_LATE_FAILURE=1` raises after inserts but before receipt creation. Run the Docker-backed regression with:

```bash
cd community-app
npm run db:test:opendart-benefit-importer
```

Unit tests use only synthetic production-shaped ZIP/XML and temporary bundles; synthetic bytes must never be committed under `supabase/fixtures/benefit-directory-opendart`.
