#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { constants } from 'node:fs'
import { access, chmod, lstat, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifySeedBundle } from './generate-benefit-directory-seed.mjs'

const sqlLiteral = value => `'${String(value).replaceAll("'", "''")}'`
const assertHex = (value, label) => { if (!/^[0-9a-f]{64}$/.test(value ?? '')) throw Error(`${label} must be sha256`) }
const assertInt = (value, label) => { if (!Number.isSafeInteger(value) || value < 0) throw Error(`${label} must be a nonnegative integer`) }

function safeField(value) {
  if (value === null) return '\\N'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (/[\t\r\n\u0000]/u.test(text)) throw Error('seed value contains an unsafe COPY control')
  return `"${text.replaceAll('"', '""')}"`
}

export function buildImportSql({ tsvPath, manifest, bundleSha256, dryRun, injectLateFailure = false }) {
  if (!path.isAbsolute(tsvPath) || /[\r\n\u0000]/u.test(tsvPath)) throw Error('unsafe TSV path')
  assertHex(bundleSha256, 'bundle digest')
  assertHex(manifest.ordered_id_set_sha256, 'ordered ID-set digest')
  assertHex(manifest.source_artifact?.sha256, 'source artifact digest')
  assertInt(manifest.company_count, 'company count')
  for (const key of ['base_legal_identity', 'recruitment_observation', 'ftc_affiliate']) assertInt(manifest.identity_counts?.[key], `${key} count`)
  const importKey = `${manifest.schema_version}:${manifest.source_artifact.sha256}`
  const expectedCounts = JSON.stringify(manifest.identity_counts)
  const finish = dryRun ? 'ROLLBACK;' : 'COMMIT;'
  return String.raw`\set ON_ERROR_STOP on
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('benefit-directory-seed-import-v1',0));
DO $preflight$
BEGIN
  IF pg_catalog.to_regclass('public.benefit_companies') IS NULL
     OR pg_catalog.to_regclass('public.benefit_publications') IS NULL
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='202611210001') THEN
    RAISE EXCEPTION 'required benefit directory migration 202611210001 is unavailable';
  END IF;
END $preflight$;

CREATE TABLE IF NOT EXISTS private.benefit_company_sources (
  company_id text PRIMARY KEY REFERENCES public.benefit_companies(company_id) ON DELETE RESTRICT,
  source_contract text NOT NULL,
  source_digest text NOT NULL CHECK (source_digest ~ '^[0-9a-f]{64}$'),
  source_binding jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(source_binding)='object'),
  bundle_digest text NOT NULL CHECK (bundle_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK (updated_at>=created_at)
);
CREATE TABLE IF NOT EXISTS private.benefit_import_receipts (
  bundle_digest text PRIMARY KEY CHECK (bundle_digest ~ '^[0-9a-f]{64}$'),
  import_key text NOT NULL UNIQUE,
  schema_version text NOT NULL,
  source_digest text NOT NULL CHECK (source_digest ~ '^[0-9a-f]{64}$'),
  company_count integer NOT NULL CHECK (company_count>=0),
  identity_counts jsonb NOT NULL CHECK (pg_catalog.jsonb_typeof(identity_counts)='object'),
  ordered_id_set_sha256 text NOT NULL CHECK (ordered_id_set_sha256 ~ '^[0-9a-f]{64}$'),
  imported_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
CREATE OR REPLACE FUNCTION private.reject_benefit_import_receipt_change()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  RAISE EXCEPTION 'benefit import receipts are immutable' USING errcode='23514';
END $$;
REVOKE ALL ON FUNCTION private.reject_benefit_import_receipt_change() FROM PUBLIC,anon,authenticated,service_role;
DO $receipt_trigger$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid='private.benefit_import_receipts'::pg_catalog.regclass AND tgname='benefit_import_receipts_immutable') THEN
    CREATE TRIGGER benefit_import_receipts_immutable
      BEFORE UPDATE OR DELETE ON private.benefit_import_receipts
      FOR EACH ROW EXECUTE FUNCTION private.reject_benefit_import_receipt_change();
  END IF;
END $receipt_trigger$;
REVOKE ALL ON TABLE private.benefit_company_sources,private.benefit_import_receipts FROM PUBLIC,anon,authenticated,service_role;

CREATE TEMP TABLE seed_stage (
  company_id text PRIMARY KEY,
  identity_class text NOT NULL,
  display_name text NOT NULL,
  normalized_name text NOT NULL,
  industry text,
  size_class text NOT NULL,
  region text,
  source_edition text NOT NULL,
  source_binding jsonb NOT NULL
) ON COMMIT DROP;
\copy seed_stage(company_id,identity_class,display_name,normalized_name,industry,size_class,region,source_edition,source_binding) FROM ${sqlLiteral(tsvPath)} WITH (FORMAT csv, DELIMITER E'\t', NULL '\N', QUOTE '"')

DO $validate$
DECLARE
  v_count bigint;
  v_base bigint;
  v_recruitment bigint;
  v_ftc bigint;
  v_digest text;
  v_publications bigint;
BEGIN
  SELECT pg_catalog.count(*),
    pg_catalog.count(*) FILTER (WHERE source_binding->>'identity_kind'='base_legal_identity'),
    pg_catalog.count(*) FILTER (WHERE source_binding->>'identity_kind'='recruitment_observation'),
    pg_catalog.count(*) FILTER (WHERE source_binding->>'identity_kind'='ftc_affiliate'),
    pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.string_agg(company_id,E'\n' ORDER BY company_id)||E'\n','UTF8'),'sha256'),'hex')
  INTO v_count,v_base,v_recruitment,v_ftc,v_digest FROM seed_stage;
  IF v_count<>${manifest.company_count} OR v_base<>${manifest.identity_counts.base_legal_identity}
     OR v_recruitment<>${manifest.identity_counts.recruitment_observation} OR v_ftc<>${manifest.identity_counts.ftc_affiliate}
     OR v_digest<>${sqlLiteral(manifest.ordered_id_set_sha256)} THEN
    RAISE EXCEPTION 'staged seed count, identity count, or ID digest mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM seed_stage s JOIN public.benefit_companies c USING(company_id)
    WHERE c.identity_class<>s.identity_class
  ) THEN RAISE EXCEPTION 'canonical company identity class mismatch'; END IF;
  IF EXISTS (
    SELECT 1 FROM private.benefit_import_receipts
    WHERE import_key=${sqlLiteral(importKey)} AND bundle_digest<>${sqlLiteral(bundleSha256)}
  ) THEN RAISE EXCEPTION 'import receipt mismatch for pinned source contract'; END IF;
  SELECT pg_catalog.count(*) INTO v_publications FROM public.benefit_publications;
  PERFORM pg_catalog.set_config('benefit_seed.publication_count',v_publications::text,true);
END $validate$;

INSERT INTO public.benefit_companies(
  company_id,identity_class,display_name,normalized_name,industry,size_class,region,summary,is_searchable,source_edition,provenance
)
SELECT company_id,identity_class,display_name,normalized_name,industry,size_class,region,NULL,true,source_edition,'{}'::jsonb
FROM seed_stage
ON CONFLICT(company_id) DO UPDATE SET
  display_name=excluded.display_name,
  normalized_name=excluded.normalized_name,
  industry=excluded.industry,
  size_class=excluded.size_class,
  region=excluded.region,
  is_searchable=true,
  source_edition=excluded.source_edition,
  updated_at=pg_catalog.clock_timestamp()
WHERE (benefit_companies.display_name,benefit_companies.normalized_name,benefit_companies.industry,benefit_companies.size_class,benefit_companies.region,benefit_companies.is_searchable,benefit_companies.source_edition)
  IS DISTINCT FROM (excluded.display_name,excluded.normalized_name,excluded.industry,excluded.size_class,excluded.region,excluded.is_searchable,excluded.source_edition);

INSERT INTO private.benefit_company_sources(company_id,source_contract,source_digest,source_binding,bundle_digest)
SELECT company_id,${sqlLiteral(manifest.source_contract_version ?? 'domestic-search-index-v1')},${sqlLiteral(manifest.source_artifact.sha256)},source_binding,${sqlLiteral(bundleSha256)} FROM seed_stage
ON CONFLICT(company_id) DO UPDATE SET
  source_contract=excluded.source_contract,source_digest=excluded.source_digest,
  source_binding=excluded.source_binding,bundle_digest=excluded.bundle_digest,updated_at=pg_catalog.clock_timestamp()
WHERE (benefit_company_sources.source_contract,benefit_company_sources.source_digest,benefit_company_sources.source_binding,benefit_company_sources.bundle_digest)
  IS DISTINCT FROM (excluded.source_contract,excluded.source_digest,excluded.source_binding,excluded.bundle_digest);

${injectLateFailure ? "DO $$ BEGIN RAISE EXCEPTION 'injected late seed failure'; END $$;" : ''}
INSERT INTO private.benefit_import_receipts(bundle_digest,import_key,schema_version,source_digest,company_count,identity_counts,ordered_id_set_sha256)
VALUES (${sqlLiteral(bundleSha256)},${sqlLiteral(importKey)},${sqlLiteral(manifest.schema_version)},${sqlLiteral(manifest.source_artifact.sha256)},${manifest.company_count},${sqlLiteral(expectedCounts)}::jsonb,${sqlLiteral(manifest.ordered_id_set_sha256)})
ON CONFLICT(bundle_digest) DO NOTHING;

DO $final$
BEGIN
  IF (SELECT pg_catalog.count(*) FROM seed_stage)<>${manifest.company_count}
     OR (SELECT pg_catalog.count(*) FROM private.benefit_company_sources s JOIN seed_stage t USING(company_id)
         WHERE s.bundle_digest=${sqlLiteral(bundleSha256)})<>${manifest.company_count}
     OR NOT EXISTS (SELECT 1 FROM private.benefit_import_receipts WHERE bundle_digest=${sqlLiteral(bundleSha256)}
       AND company_count=${manifest.company_count} AND identity_counts=${sqlLiteral(expectedCounts)}::jsonb
       AND ordered_id_set_sha256=${sqlLiteral(manifest.ordered_id_set_sha256)})
     OR (SELECT pg_catalog.count(*) FROM public.benefit_publications)<>pg_catalog.current_setting('benefit_seed.publication_count')::bigint THEN
    RAISE EXCEPTION 'late seed verification mismatch';
  END IF;
END $final$;
\echo benefit-directory-seed validated companies=${manifest.company_count} base=${manifest.identity_counts.base_legal_identity} recruitment=${manifest.identity_counts.recruitment_observation} ftc=${manifest.identity_counts.ftc_affiliate}
${finish}
`
}

async function resolvePsql() {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.resolve(directory, 'psql')
    try {
      await access(candidate, constants.X_OK)
      const canonical = await realpath(candidate)
      const stat = await lstat(canonical)
      if (!stat.isFile()) continue
      const probe = spawnSync(canonical, ['--version'], { encoding: 'utf8', timeout: 10_000 })
      if (probe.status === 0 && /^psql \(PostgreSQL\)/.test(probe.stdout)) return canonical
    } catch {}
  }
  throw Error('a real psql executable is required on PATH')
}

function databaseEnvironment(databaseUrl) {
  if (typeof databaseUrl !== 'string' || /[\r\n\u0000]/u.test(databaseUrl)) throw Error('DATABASE_URL is required')
  let url
  try { url = new URL(databaseUrl) } catch { throw Error('DATABASE_URL must be a valid PostgreSQL URL') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || url.pathname.length < 2) throw Error('DATABASE_URL must identify a PostgreSQL database')
  const allowed = new Set(['sslmode'])
  for (const key of url.searchParams.keys()) if (!allowed.has(key)) throw Error(`DATABASE_URL query parameter is not allowed: ${key}`)
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    ...(url.searchParams.has('sslmode') ? { PGSSLMODE: url.searchParams.get('sslmode') } : {}),
  }
}

async function validateTempRoot(root) {
  const absolute = path.resolve(root)
  const canonical = await realpath(absolute)
  if (canonical !== absolute) throw Error('unsafe temporary root symlink')
  const stat = await lstat(canonical)
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o022) !== 0) throw Error('unsafe temporary root permissions or ownership')
  return canonical
}

function makeTsv(rows) {
  const bytes = Buffer.from(rows.map(row => [
    row.company_id, row.identity_class, row.display_name, row.normalized_name, row.industry,
    row.size_class, row.region, row.source_edition, row.source_binding,
  ].map(safeField).join('\t')).join('\n') + '\n')
  if (bytes.length > 30_000_000) throw Error('TSV byte cap exceeded')
  return bytes
}

async function runPsql(executable, env, sqlFile) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, ['-X', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--file', sqlFile], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''; let stderr = ''
    const append = (current, chunk) => (current + chunk.toString('utf8')).slice(-16_384)
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk) })
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk) })
    const signalHandlers = new Map()
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const handler = () => child.kill(signal)
      signalHandlers.set(signal, handler); process.once(signal, handler)
    }
    child.once('error', reject)
    child.once('close', code => {
      for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler)
      if (code === 0) { if (stdout.trim()) console.log(stdout.trim()); resolve() }
      else reject(Error(`psql seed import failed with exit ${code}: ${stderr.trim().slice(-4000)}`))
    })
  })
}

export async function applySeed({ databaseUrl, bundleDir, sourceFile, dryRun = false, injectLateFailure = false } = {}) {
  const executable = await resolvePsql()
  const env = databaseEnvironment(databaseUrl)
  const tempRoot = await validateTempRoot(tmpdir())
  const verified = await verifySeedBundle({ sourceFile, bundleDir })
  const directory = await mkdtemp(path.join(tempRoot, 'benefit-directory-import-'))
  await chmod(directory, 0o700)
  try {
    const tsvPath = path.join(directory, 'companies.tsv')
    const sqlPath = path.join(directory, 'apply.sql')
    const tsv = makeTsv(verified.rows)
    const tsvHandle = await open(tsvPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    try { await tsvHandle.writeFile(tsv); await tsvHandle.sync() } finally { await tsvHandle.close() }
    const tsvStat = await lstat(tsvPath)
    if (!tsvStat.isFile() || tsvStat.nlink !== 1 || (tsvStat.mode & 0o777) !== 0o600) throw Error('unsafe TSV file identity or mode')
    const sql = buildImportSql({ tsvPath, manifest: verified.manifest, bundleSha256: verified.bundleSha256, dryRun, injectLateFailure })
    await writeFile(sqlPath, sql, { mode: 0o600, flag: 'wx' })
    await runPsql(executable, env, sqlPath)
    return { companyCount: verified.manifest.company_count, bundleSha256: verified.bundleSha256, dryRun }
  } finally { await rm(directory, { recursive: true, force: true }) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.some(arg => !['--dry-run'].includes(arg))) throw Error('usage: apply-benefit-directory-seed.mjs [--dry-run]')
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const result = await applySeed({
    databaseUrl: process.env.DATABASE_URL,
    bundleDir: path.join(repo, 'supabase/fixtures/benefit-directory'),
    sourceFile: path.join(repo, 'community-app/public/data/company-benefits/domestic-search-index-v1/index.json'),
    dryRun: args.includes('--dry-run'),
    injectLateFailure: process.env.BENEFIT_SEED_INJECT_LATE_FAILURE === '1',
  })
  console.log(`benefit directory seed ${result.dryRun ? 'dry-run rolled back' : 'committed'}: ${result.companyCount} companies; bundle ${result.bundleSha256}`)
}
