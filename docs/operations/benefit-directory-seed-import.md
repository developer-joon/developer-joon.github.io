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

1. migration `202611210001` applied, with `public.benefit_companies` and `public.benefit_publications` available;
2. a real PostgreSQL `psql` executable on `PATH`;
3. `DATABASE_URL` set to the intended PostgreSQL database;
4. a private, owner-controlled `TMPDIR` (mode `0700`, not a symlink).

Use only the loopback Supabase stack for local verification. Do not point this command at a hosted or production database unless a separate deployment authorization explicitly names that target. The CLI validates the environment and complete bundle against the pinned source before opening a database connection. It does not print `DATABASE_URL` or its password.

## Dry run and import

```bash
export DATABASE_URL='postgresql://postgres:...@127.0.0.1:54322/postgres'
node scripts/apply-benefit-directory-seed.mjs --dry-run
node scripts/apply-benefit-directory-seed.mjs
```

The importer creates an owner-only mode-`0700` temporary directory and a mode-`0600`, single-link TSV. It loads the TSV with `psql` `\copy` into a temporary staging table. One transaction then:

- obtains the advisory transaction lock `benefit-directory-seed-import-v1`;
- verifies the required migration, exact row and identity counts, and the ordered ID-set digest;
- rejects a canonical identity-class mismatch;
- upserts `public.benefit_companies` without deleting unrelated rows;
- stores the minimal private binding in `private.benefit_company_sources`;
- records `private.benefit_import_receipts`, keyed by the manifest-byte digest with a unique pinned-source import key;
- verifies source rows, receipt, and unchanged publication count before finishing.

A replay of the same bundle is idempotent. A different bundle claiming the same pinned source import key is rejected. `--dry-run` executes the same COPY, validation, upsert, and receipt path and then rolls back. Temporary artifacts are removed after success, failure, `SIGINT`, or `SIGTERM`.

For local rollback testing only, `BENEFIT_SEED_INJECT_LATE_FAILURE=1` raises after the upserts and before the receipt. The transaction must leave company/source/receipt/publication state unchanged.

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
