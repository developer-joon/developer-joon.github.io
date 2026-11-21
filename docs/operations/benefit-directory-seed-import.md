# Benefit directory seed import

This runbook generates and imports the searchable-company identity read model. It does **not** create or change `benefit_publications`; an identity without an approved publication remains a company with no published benefit evidence.

## Authority and bundle

The sole population authority is the pinned `domestic-search-index-v1/index.json` already enforced by `scripts/verify-domestic-search-index.mjs`:

- SHA-256: `b7e61860d69f289735f42a6ae275c8a5303cbde367036f77865c7b20de7b9594`
- bytes: `8,392,604`
- identities: `40,053`
- canonical identity kinds: `1,000` base legal identities, `35,910` recruitment observations, and `3,143` FTC affiliates

`companies.ndjson` is sorted by the UTF-8 bytes of the exact `company_id`. The manifest contains no timestamp or machine path, so regeneration is byte-identical. `mid_history` and `sme_unspecified` are not silently converted to the migration's `medium` or `small` classes; they remain `unclassified`. Display names and IDs are preserved exactly.

Generate or check the tracked bundle from the repository root:

```bash
node scripts/generate-benefit-directory-seed.mjs
node scripts/generate-benefit-directory-seed.mjs --check
node --test scripts/generate-benefit-directory-seed.test.mjs
```

`--check` generates and independently validates a private staging bundle, then byte-compares both tracked files without writing them. A source symlink, source digest change, row deletion, duplicate ID, identity mutation, malformed row, or tracked output drift fails closed.

## Prerequisites

The apply CLI requires:

1. migrations `202611210001` and `202611210004` applied, with the exact public and private import schemas available;
2. `PSQL_BIN` set to an absolute trusted PostgreSQL `psql` executable path. Its canonical file must be owned by the current UID or root, be executable, and not be group/world-writable;
3. `DATABASE_URL` set to the intended PostgreSQL database;
4. a private, owner-controlled `TMPDIR` (mode `0700`, not a symlink).

Use only the loopback Supabase stack for local verification. Do not point this command at a hosted or production database unless a separate deployment authorization explicitly names that target. The CLI validates the environment and complete bundle against the pinned source before opening a database connection. It does not print `DATABASE_URL` or its password.

## Dry run and import

```bash
export DATABASE_URL='postgresql://postgres:***@127.0.0.1:54322/postgres'
export PSQL_BIN="$(realpath "$(command -v psql)")"
# Optional: 30,000..1,800,000 ms; default 1,200,000 for the 40,053-row import.
export BENEFIT_SEED_TIMEOUT_MS=1200000
node scripts/apply-benefit-directory-seed.mjs --dry-run
node scripts/apply-benefit-directory-seed.mjs
```

The importer probes `PSQL_BIN --version` with a minimal credential-free environment. The import child receives only connection fields parsed from `DATABASE_URL`, approved `sslmode`, stable locale values, controlled timeouts/search path, and `PGCLIENTENCODING=UTF8`; inherited `PG*`, service, passfile, and option variables are never forwarded. It creates an owner-only mode-`0700` temporary directory and a mode-`0600`, single-link TSV. It loads the TSV with `psql` `\copy` into a temporary staging table. Every row carries a client-computed SHA-256 over an explicitly framed, versioned sequence of exact UTF-8 field bytes (including distinct null/empty representations); PostgreSQL recomputes this digest immediately after COPY and before any upsert. One transaction then:

- obtains the advisory transaction lock `benefit-directory-seed-import-v1`;
- verifies exact column order/types/nullability/default/generated state, PostgreSQL ownership, and RLS for all four tables before COPY;
- takes a full logical publication snapshot after a `SHARE` table lock, rejecting snapshots over 100,000 rows or 256 MiB;
- rejects a canonical identity-class mismatch;
- upserts `public.benefit_companies` without deleting unrelated rows;
- stores the minimal private binding in `private.benefit_company_sources`;
- records `private.benefit_import_receipts`, keyed by the manifest-byte digest with a unique pinned-source import key;
- compares imported company and source rows field-for-field in both directions, compares the exact receipt, and compares every publication column in both directions before finishing.

A replay of the same bundle is idempotent. A different bundle claiming the same pinned source import key is rejected. `--dry-run` executes the same COPY, validation, upsert, and receipt path and then rolls back. The child runs in its own process group with a total timeout, bounded drained output, and TERM-to-KILL escalation. The parent always waits for child close before removing temporary artifacts after success, failure, timeout, `SIGINT`, or `SIGTERM`.

Bundle publication is serialized by an owner-only sibling `*.generate.lock` created before staging. A collision-safe private backup container receives the old directory before the staged directory is installed. Pre-commit failure restores the old directory without deleting the destination; failure to restore preserves the backup and reports its relative recovery location. The staged-directory rename is the commit boundary. Failure to delete an old backup after that point emits a warning but does not turn a successful publication into a failure. A crash before commit can leave the lock, staging directory, or a `.benefit-directory.previous-*` backup; after confirming no generator is running, restore the backup's `bundle` entry if the destination is absent, then remove stale artifacts and the lock. `--check` does not acquire the publication lock and never writes the tracked destination.

For local rollback testing only, `BENEFIT_SEED_INJECT_LATE_FAILURE=1` raises after the upserts and before the receipt. The transaction must leave company/source/receipt/publication state unchanged. The Docker-required regression is intentionally separate from frontend checks:

```bash
cd community-app
npm run db:test:benefit-seed-importer
```

It resets and stops the local stack, reproduces unexpected company/source `BEFORE` trigger rewrites, mutates the schema contract, and verifies receipt conflict, late-failure, dry-run, normal apply, replay, and exact unrelated publication preservation.

## Read-back checks

After a normal local import, verify bounded scalar results with `psql`:

```sql
select count(*) from public.benefit_companies
where source_edition = '2026-03-06';

select source_binding->>'identity_kind', count(*)
from private.benefit_company_sources
where source_digest = 'b7e61860d69f289735f42a6ae275c8a5303cbde367036f77865c7b20de7b9594'
group by 1 order by 1;

select company_count, identity_counts, ordered_id_set_sha256
from private.benefit_import_receipts
where source_digest = 'b7e61860d69f289735f42a6ae275c8a5303cbde367036f77865c7b20de7b9594';
```

Expected counts are `40,053`, split `1,000 / 35,910 / 3,143`. Record the publication count before dry-run, normal import, replay, and injected failure; it must remain unchanged throughout.
