# OpenDART benefit-directory expansion import

This pipeline adds official OpenDART corporation identities without modifying the frozen 40,053-row base bundle and without merging by company name. The generated production bundle is intentionally absent until an authentic official `corpCode` ZIP is retained locally and its edition, retrieval time, source URL, and reuse-rights note are known.

## Authority and acquisition

The generator never fetches the network. Obtain the ZIP from the official OpenDART `corpCode.xml` API using an owner-managed `OPENDART_API_KEY` outside this command, retain the original response bytes, and record:

- the exact edition assigned to those bytes;
- an RFC 3339 UTC retrieval timestamp;
- `https://opendart.fss.or.kr/api/corpCode.xml` as the official source URL;
- the reviewed reuse-rights/attribution note.

Do not put API keys, request URLs containing keys, or credentials in the repository, shell history, manifest, or logs. There is no acquisition command in this repository because no key is present and a source must not be fabricated or substituted.

The reader uses bounded no-follow descriptor reads. It validates one exact case-sensitive `CORPCODE.xml` ZIP member, central/local header agreement, stored/deflate methods, flags, encryption, symlink metadata, size and expansion-ratio ceilings before decompression. The narrow XML reader rejects DTDs, declared/custom entities, CDATA, unknown structure, malformed UTF-8, duplicate/invalid eight-digit `corp_code`, invalid six-digit stock codes, blank or overlong names, and invalid `YYYYMMDD` dates.

## Generate, check, and verify

Use a private owner-only output parent. Generation arguments are all explicit:

```bash
node scripts/generate-opendart-benefit-directory.mjs \
  --source "$HOME/private/opendart/corpCode-2026-11-23.zip" \
  --edition 2026-11-23 \
  --retrieved-at 2026-11-23T00:00:00Z \
  --source-url https://opendart.fss.or.kr/api/corpCode.xml \
  --reuse-rights 'reviewed attribution note' \
  --output supabase/fixtures/benefit-directory-opendart

node scripts/generate-opendart-benefit-directory.mjs --check \
  --source "$HOME/private/opendart/corpCode-2026-11-23.zip" \
  --edition 2026-11-23 --retrieved-at 2026-11-23T00:00:00Z \
  --source-url https://opendart.fss.or.kr/api/corpCode.xml \
  --reuse-rights 'reviewed attribution note' \
  --output supabase/fixtures/benefit-directory-opendart

node scripts/verify-opendart-benefit-directory.mjs \
  --source "$HOME/private/opendart/corpCode-2026-11-23.zip" \
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
  --bundle supabase/fixtures/benefit-directory-opendart --dry-run
node scripts/apply-opendart-benefit-directory.mjs \
  --source "$HOME/private/opendart/corpCode-2026-11-23.zip" \
  --bundle supabase/fixtures/benefit-directory-opendart --apply
```

Exactly one of `--dry-run` or `--apply` is required. The importer independently verifies the bundle before connecting, accepts only a trusted absolute `psql`, supplies a clean UTF-8 PostgreSQL environment, uses owner-only temporary custody, client/server length-framed UTF-8 row digests, a transaction advisory lock, staging uniqueness, and exact read-back checks. A `corp_code` already bound to another company, a deterministic company with a different payload, or a conflicting receipt fails. Existing exact rows replay idempotently. Existing receipts and every publication row are snapshotted and checked unchanged. Dry-run executes the complete path and rolls back.

For local rollback testing, `OPENDART_IMPORT_INJECT_LATE_FAILURE=1` raises after inserts but before receipt creation. Run the Docker-backed regression with:

```bash
cd community-app
npm run db:test:opendart-benefit-importer
```

Unit tests use only synthetic production-shaped ZIP/XML and temporary bundles; synthetic bytes must never be committed under `supabase/fixtures/benefit-directory-opendart`.
