#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, lstat, mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifySeedBundle } from './generate-benefit-directory-seed.mjs'

const sqlLiteral = value => `'${String(value).replaceAll("'", "''")}'`
const assertHex = (value, label) => { if (!/^[0-9a-f]{64}$/.test(value ?? '')) throw Error(`${label} must be sha256`) }
const assertInt = (value, label) => { if (!Number.isSafeInteger(value) || value < 0) throw Error(`${label} must be a nonnegative integer`) }
const ROW_DIGEST_DOMAIN = Buffer.from('benefit-seed-row-v1\0', 'utf8')

export function computeRowDigest(fields) {
  if (!Array.isArray(fields) || fields.length !== 9) throw Error('row digest requires exactly nine fields')
  const framed = [ROW_DIGEST_DOMAIN]
  for (const value of fields) {
    if (value === null) { framed.push(Buffer.from([0])); continue }
    if (typeof value !== 'string') throw Error('row digest fields must be text or null')
    const bytes = Buffer.from(value, 'utf8')
    const length = Buffer.alloc(8)
    length.writeBigUInt64BE(BigInt(bytes.length))
    framed.push(Buffer.from([1]), length, bytes)
  }
  return createHash('sha256').update(Buffer.concat(framed)).digest('hex')
}

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
  IF (SELECT pg_catalog.count(*) FROM supabase_migrations.schema_migrations
      WHERE version IN ('202611210001','202611210004'))<>2 THEN
    RAISE EXCEPTION 'required benefit directory migrations are unavailable';
  END IF;
  IF EXISTS (
    WITH expected(schema_name,table_name,ordinal,column_name,type_name,is_not_null,default_expr) AS (VALUES
      ('public','benefit_companies',1,'company_id','text',true,NULL),
      ('public','benefit_companies',2,'identity_class','text',true,NULL),
      ('public','benefit_companies',3,'display_name','text',true,NULL),
      ('public','benefit_companies',4,'normalized_name','text',true,NULL),
      ('public','benefit_companies',5,'industry','text',false,NULL),
      ('public','benefit_companies',6,'size_class','text',false,NULL),
      ('public','benefit_companies',7,'region','text',false,NULL),
      ('public','benefit_companies',8,'summary','text',false,NULL),
      ('public','benefit_companies',9,'is_searchable','boolean',true,'true'),
      ('public','benefit_companies',10,'source_edition','text',true,NULL),
      ('public','benefit_companies',11,'provenance','jsonb',true,'''{}''::jsonb'),
      ('public','benefit_companies',12,'created_at','timestamp with time zone',true,'clock_timestamp()'),
      ('public','benefit_companies',13,'updated_at','timestamp with time zone',true,'clock_timestamp()'),
      ('public','benefit_publications',1,'publication_id','uuid',true,'gen_random_uuid()'),
      ('public','benefit_publications',2,'company_id','text',true,NULL),
      ('public','benefit_publications',3,'category_id','text',true,NULL),
      ('public','benefit_publications',4,'title','text',true,NULL),
      ('public','benefit_publications',5,'description','text',true,NULL),
      ('public','benefit_publications',6,'eligibility_text','text',false,NULL),
      ('public','benefit_publications',7,'condition_text','text',false,NULL),
      ('public','benefit_publications',8,'trust_tier','text',true,NULL),
      ('public','benefit_publications',9,'status','text',true,'''active''::text'),
      ('public','benefit_publications',10,'dedupe_key','text',true,NULL),
      ('public','benefit_publications',11,'revision','integer',true,NULL),
      ('public','benefit_publications',12,'supersedes_publication_id','uuid',false,NULL),
      ('public','benefit_publications',13,'source_url','text',false,NULL),
      ('public','benefit_publications',14,'source_type','text',true,NULL),
      ('public','benefit_publications',15,'observed_at','timestamp with time zone',false,NULL),
      ('public','benefit_publications',16,'verified_at','timestamp with time zone',false,NULL),
      ('public','benefit_publications',17,'provenance','jsonb',true,'''{}''::jsonb'),
      ('public','benefit_publications',18,'reviewer_id','text',false,NULL),
      ('public','benefit_publications',19,'created_at','timestamp with time zone',true,'clock_timestamp()'),
      ('public','benefit_publications',20,'updated_at','timestamp with time zone',true,'clock_timestamp()'),
      ('private','benefit_company_sources',1,'company_id','text',true,NULL),
      ('private','benefit_company_sources',2,'source_contract','text',true,NULL),
      ('private','benefit_company_sources',3,'source_digest','text',true,NULL),
      ('private','benefit_company_sources',4,'source_binding','jsonb',true,NULL),
      ('private','benefit_company_sources',5,'bundle_digest','text',true,NULL),
      ('private','benefit_company_sources',6,'created_at','timestamp with time zone',true,'clock_timestamp()'),
      ('private','benefit_company_sources',7,'updated_at','timestamp with time zone',true,'clock_timestamp()'),
      ('private','benefit_import_receipts',1,'bundle_digest','text',true,NULL),
      ('private','benefit_import_receipts',2,'import_key','text',true,NULL),
      ('private','benefit_import_receipts',3,'schema_version','text',true,NULL),
      ('private','benefit_import_receipts',4,'source_digest','text',true,NULL),
      ('private','benefit_import_receipts',5,'company_count','integer',true,NULL),
      ('private','benefit_import_receipts',6,'identity_counts','jsonb',true,NULL),
      ('private','benefit_import_receipts',7,'ordered_id_set_sha256','text',true,NULL),
      ('private','benefit_import_receipts',8,'imported_at','timestamp with time zone',true,'clock_timestamp()')
    ), actual AS (
      SELECT n.nspname,c.relname,a.attnum,a.attname,
        pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,
        pg_catalog.pg_get_expr(d.adbin,d.adrelid),a.attgenerated::text,a.attidentity::text
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE (n.nspname,c.relname) IN (
        ('public','benefit_companies'),('public','benefit_publications'),
        ('private','benefit_company_sources'),('private','benefit_import_receipts')
      ) AND a.attnum>0 AND NOT a.attisdropped
    )
    (SELECT schema_name,table_name,ordinal,column_name,type_name,is_not_null,default_expr,''::text,''::text FROM expected
     EXCEPT ALL SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual
     EXCEPT ALL SELECT schema_name,table_name,ordinal,column_name,type_name,is_not_null,default_expr,''::text,''::text FROM expected)
  ) THEN
    RAISE EXCEPTION 'benefit seed schema contract mismatch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE (n.nspname,c.relname) IN (
      ('public','benefit_companies'),('public','benefit_publications'),
      ('private','benefit_company_sources'),('private','benefit_import_receipts')
    ) AND (pg_catalog.pg_get_userbyid(c.relowner)<>'postgres'
      OR c.relrowsecurity<>(n.nspname='public'))
  ) THEN RAISE EXCEPTION 'benefit seed ownership or RLS contract mismatch'; END IF;
END $preflight$;

-- SHARE blocks concurrent publication INSERT/UPDATE/DELETE until verification and
-- commit/rollback, so the bounded snapshot cannot race ordinary writers.
LOCK TABLE public.benefit_publications IN SHARE MODE;
DO $publication_bound$
BEGIN
  IF (SELECT pg_catalog.count(*) FROM public.benefit_publications)>100000
     OR coalesce((SELECT pg_catalog.sum(pg_catalog.pg_column_size(p)) FROM public.benefit_publications p),0::bigint)>268435456 THEN
    RAISE EXCEPTION 'benefit publication snapshot exceeds 100000 rows or 256 MiB';
  END IF;
END $publication_bound$;
CREATE TEMP TABLE publication_snapshot ON COMMIT DROP AS
SELECT publication_id,company_id,category_id,title,description,eligibility_text,condition_text,
  trust_tier,status,dedupe_key,revision,supersedes_publication_id,source_url,source_type,
  observed_at,verified_at,provenance,reviewer_id,created_at,updated_at
FROM public.benefit_publications;

CREATE TEMP TABLE seed_stage_raw (
  company_id text,
  identity_class text,
  display_name text,
  normalized_name text,
  industry text,
  size_class text,
  region text,
  source_edition text,
  source_binding_text text,
  client_digest text NOT NULL
) ON COMMIT DROP;
\copy seed_stage_raw(company_id,identity_class,display_name,normalized_name,industry,size_class,region,source_edition,source_binding_text,client_digest) FROM ${sqlLiteral(tsvPath)} WITH (FORMAT csv, DELIMITER E'\t', NULL '\N', QUOTE '"')

CREATE FUNCTION pg_temp.seed_text_frame(value text) RETURNS bytea
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path='' AS $$
  SELECT CASE WHEN value IS NULL THEN pg_catalog.decode('00','hex')
    ELSE pg_catalog.decode('01','hex') || pg_catalog.int8send(pg_catalog.octet_length(pg_catalog.convert_to(value,'UTF8'))::bigint) || pg_catalog.convert_to(value,'UTF8') END
$$;
DO $encoding_integrity$
BEGIN
  IF EXISTS (
    SELECT 1 FROM seed_stage_raw
    WHERE client_digest !~ '^[0-9a-f]{64}$'
       OR client_digest <> pg_catalog.encode(extensions.digest(
         pg_catalog.convert_to('benefit-seed-row-v1','UTF8') || pg_catalog.decode('00','hex')
         || pg_temp.seed_text_frame(company_id) || pg_temp.seed_text_frame(identity_class)
         || pg_temp.seed_text_frame(display_name) || pg_temp.seed_text_frame(normalized_name)
         || pg_temp.seed_text_frame(industry) || pg_temp.seed_text_frame(size_class)
         || pg_temp.seed_text_frame(region) || pg_temp.seed_text_frame(source_edition)
         || pg_temp.seed_text_frame(source_binding_text), 'sha256'), 'hex')
  ) THEN RAISE EXCEPTION 'client/server UTF-8 row digest mismatch'; END IF;
END $encoding_integrity$;

CREATE TEMP TABLE seed_stage ON COMMIT DROP AS
SELECT company_id,identity_class,display_name,normalized_name,industry,size_class,region,
  source_edition,source_binding_text::jsonb AS source_binding
FROM seed_stage_raw;
ALTER TABLE seed_stage ALTER company_id SET NOT NULL, ALTER identity_class SET NOT NULL,
  ALTER display_name SET NOT NULL, ALTER normalized_name SET NOT NULL, ALTER size_class SET NOT NULL,
  ALTER source_edition SET NOT NULL, ALTER source_binding SET NOT NULL;
CREATE UNIQUE INDEX seed_stage_company_id_key ON seed_stage(company_id);

DO $validate$
DECLARE
  v_count bigint;
  v_base bigint;
  v_recruitment bigint;
  v_ftc bigint;
  v_digest text;
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
END $validate$;

CREATE TEMP TABLE expected_company_sources ON COMMIT DROP AS
SELECT company_id,${sqlLiteral(manifest.source_contract_version ?? 'domestic-search-index-v1')}::text source_contract,
  ${sqlLiteral(manifest.source_artifact.sha256)}::text source_digest,source_binding,
  ${sqlLiteral(bundleSha256)}::text bundle_digest
FROM seed_stage;

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
SELECT company_id,source_contract,source_digest,source_binding,bundle_digest FROM expected_company_sources
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
     OR EXISTS (
       (SELECT company_id,identity_class,display_name,normalized_name,industry,size_class,region,
          NULL::text summary,true is_searchable,source_edition,'{}'::jsonb provenance
        FROM seed_stage
        EXCEPT ALL
        SELECT c.company_id,c.identity_class,c.display_name,c.normalized_name,c.industry,c.size_class,c.region,
          c.summary,c.is_searchable,c.source_edition,c.provenance
        FROM public.benefit_companies c JOIN seed_stage s USING(company_id))
       UNION ALL
       (SELECT c.company_id,c.identity_class,c.display_name,c.normalized_name,c.industry,c.size_class,c.region,
          c.summary,c.is_searchable,c.source_edition,c.provenance
        FROM public.benefit_companies c JOIN seed_stage s USING(company_id)
        EXCEPT ALL
        SELECT company_id,identity_class,display_name,normalized_name,industry,size_class,region,
          NULL::text,true,source_edition,'{}'::jsonb FROM seed_stage)
     )
     OR EXISTS (
       (SELECT * FROM expected_company_sources
        EXCEPT ALL
        SELECT company_id,source_contract,source_digest,source_binding,bundle_digest
        FROM private.benefit_company_sources WHERE bundle_digest=${sqlLiteral(bundleSha256)})
       UNION ALL
       (SELECT company_id,source_contract,source_digest,source_binding,bundle_digest
        FROM private.benefit_company_sources WHERE bundle_digest=${sqlLiteral(bundleSha256)}
        EXCEPT ALL SELECT * FROM expected_company_sources)
     )
     OR NOT EXISTS (
       SELECT 1 FROM private.benefit_import_receipts
       WHERE bundle_digest=${sqlLiteral(bundleSha256)}
         AND import_key=${sqlLiteral(importKey)}
         AND schema_version=${sqlLiteral(manifest.schema_version)}
         AND source_digest=${sqlLiteral(manifest.source_artifact.sha256)}
         AND company_count=${manifest.company_count}
         AND identity_counts=${sqlLiteral(expectedCounts)}::jsonb
         AND ordered_id_set_sha256=${sqlLiteral(manifest.ordered_id_set_sha256)}
     )
     OR (SELECT pg_catalog.count(*) FROM publication_snapshot)<>(SELECT pg_catalog.count(*) FROM public.benefit_publications)
     OR EXISTS (
       (SELECT * FROM publication_snapshot EXCEPT ALL SELECT
          publication_id,company_id,category_id,title,description,eligibility_text,condition_text,
          trust_tier,status,dedupe_key,revision,supersedes_publication_id,source_url,source_type,
          observed_at,verified_at,provenance,reviewer_id,created_at,updated_at
        FROM public.benefit_publications)
       UNION ALL
       (SELECT publication_id,company_id,category_id,title,description,eligibility_text,condition_text,
          trust_tier,status,dedupe_key,revision,supersedes_publication_id,source_url,source_type,
          observed_at,verified_at,provenance,reviewer_id,created_at,updated_at
        FROM public.benefit_publications EXCEPT ALL SELECT * FROM publication_snapshot)
     ) THEN
    RAISE EXCEPTION 'late seed exact-state verification mismatch';
  END IF;
END $final$;
\echo benefit-directory-seed validated companies=${manifest.company_count} base=${manifest.identity_counts.base_legal_identity} recruitment=${manifest.identity_counts.recruitment_observation} ftc=${manifest.identity_counts.ftc_affiliate}
${finish}
`
}

async function resolvePsql(psqlBin) {
  if (typeof psqlBin !== 'string' || !path.isAbsolute(psqlBin) || /[\r\n\u0000]/u.test(psqlBin)) throw Error('PSQL_BIN is required and must be an absolute path')
  let canonical
  try { canonical = await realpath(psqlBin) } catch (error) { throw Error('PSQL_BIN does not resolve to an executable', { cause: error }) }
  const stat = await lstat(canonical)
  if (!stat.isFile() || ![0, process.getuid()].includes(stat.uid) || (stat.mode & 0o022) !== 0) throw Error('PSQL_BIN must be a trusted regular file owned by root or the current user and not group/world-writable')
  try { await access(canonical, constants.X_OK) } catch (error) { throw Error('PSQL_BIN is not executable', { cause: error }) }
  const probe = spawnSync(canonical, ['--version'], {
    encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024,
    env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
  })
  if (probe.error || probe.signal || probe.status !== 0 || !/^psql \(PostgreSQL\) \d+/u.test(probe.stdout ?? '')) throw Error('PSQL_BIN failed the PostgreSQL psql version contract')
  return canonical
}

function boundedTimeout(value, allowUnsafe = false) {
  const parsed = value === undefined ? 1_200_000 : Number(value)
  const minimum = allowUnsafe ? 25 : 30_000
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > 1_800_000) throw Error(`BENEFIT_SEED_TIMEOUT_MS must be an integer from ${minimum} to 1800000`)
  return parsed
}

function databaseEnvironment(databaseUrl, timeoutMs) {
  if (typeof databaseUrl !== 'string' || /[\r\n\u0000]/u.test(databaseUrl)) throw Error('DATABASE_URL is required')
  let url
  try { url = new URL(databaseUrl) } catch { throw Error('DATABASE_URL must be a valid PostgreSQL URL') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || url.pathname.length < 2) throw Error('DATABASE_URL must identify a PostgreSQL database')
  const allowed = new Set(['sslmode'])
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) throw Error(`DATABASE_URL query parameter is not allowed: ${key}`)
    if (url.searchParams.getAll(key).length !== 1) throw Error(`DATABASE_URL query parameter must occur once: ${key}`)
  }
  const sslmode = url.searchParams.get('sslmode')
  if (sslmode !== null && !['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(sslmode)) throw Error('DATABASE_URL sslmode is not supported')
  let database; let user; let password
  try {
    database = decodeURIComponent(url.pathname.slice(1)); user = decodeURIComponent(url.username); password = decodeURIComponent(url.password)
  } catch { throw Error('DATABASE_URL contains invalid percent encoding') }
  if (!database || !user || [database, user, password].some(value => /[\r\n\u0000]/u.test(value))) throw Error('DATABASE_URL contains an invalid connection field')
  const statementTimeout = Math.max(1_000, timeoutMs - 5_000)
  return {
    PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8',
    PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: database, PGUSER: user, PGPASSWORD: password,
    PGCLIENTENCODING: 'UTF8', PGCONNECT_TIMEOUT: String(Math.min(60, Math.max(2, Math.ceil(timeoutMs / 1000)))),
    PGOPTIONS: `-c search_path=pg_catalog -c statement_timeout=${statementTimeout} -c lock_timeout=30000 -c idle_in_transaction_session_timeout=${statementTimeout}`,
    ...(sslmode === null ? {} : { PGSSLMODE: sslmode }),
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
  const bytes = Buffer.from(rows.map(row => {
    const fields = [
      row.company_id, row.identity_class, row.display_name, row.normalized_name, row.industry,
      row.size_class, row.region, row.source_edition, JSON.stringify(row.source_binding),
    ]
    return [...fields, computeRowDigest(fields)].map(safeField).join('\t')
  }).join('\n') + '\n')
  if (bytes.length > 30_000_000) throw Error('TSV byte cap exceeded')
  return bytes
}

function redactExact(text, sensitiveValues) {
  let sanitized = String(text)
  const values = [...new Set(sensitiveValues.filter(value => typeof value === 'string' && value.length > 0))]
    .sort((a, b) => b.length - a.length)
  for (const value of values) sanitized = sanitized.replaceAll(value, '<redacted>')
  return sanitized
}

function renderChildFailure({ code, signal, stderr, sensitiveValues }) {
  const classification = code === null ? `signal ${signal ?? 'unknown'}` : `exit ${code}`
  const detail = redactExact(stderr, sensitiveValues).trim().slice(-12_000)
  return Error(`psql seed import failed with ${classification}${detail ? `: ${detail}` : ''}`)
}

async function runPsql(executable, env, sqlFile, sensitiveValues, { timeoutMs, termGraceMs }) {
  const outputLimit = 1_048_576
  const child = spawn(executable, ['-X', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--file', sqlFile], {
    env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''; let stderr = ''; let stdoutBytes = 0; let stderrBytes = 0
  let terminationReason = null; let spawnError = null; let killTimer = null
  const append = (current, chunk) => (current + chunk.toString('utf8')).slice(-16_384)
  const killTree = signal => {
    if (!child.pid) return
    try {
      if (process.platform === 'win32') child.kill(signal)
      else process.kill(-child.pid, signal)
    } catch (error) { if (error?.code !== 'ESRCH') throw error }
  }
  const terminate = (reason, signal = 'SIGTERM') => {
    if (terminationReason !== null) return
    terminationReason = reason
    killTree(signal)
    killTimer = setTimeout(() => killTree('SIGKILL'), termGraceMs)
    killTimer.unref()
  }
  child.stdout.on('data', chunk => {
    stdoutBytes += chunk.length; stdout = append(stdout, chunk)
    if (stdoutBytes > outputLimit) terminate('stdout exceeded the 1048576-byte bound')
  })
  child.stderr.on('data', chunk => {
    stderrBytes += chunk.length; stderr = append(stderr, chunk)
    if (stderrBytes > outputLimit) terminate('stderr exceeded the 1048576-byte bound')
  })
  const signalHandlers = new Map()
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => terminate(`interrupted by ${signal}`, signal)
    signalHandlers.set(signal, handler); process.once(signal, handler)
  }
  child.once('error', error => { spawnError = error })
  const timeout = setTimeout(() => terminate(`timed out after ${timeoutMs}ms`), timeoutMs)
  timeout.unref()
  const { code, signal } = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })))
  clearTimeout(timeout); if (killTimer !== null) clearTimeout(killTimer)
  for (const [name, handler] of signalHandlers) process.removeListener(name, handler)
  if (spawnError) throw Error(`unable to start trusted psql: ${redactExact(spawnError.message, sensitiveValues)}`, { cause: spawnError })
  if (terminationReason !== null) {
    const classification = code === null ? `signal ${signal ?? 'unknown'}` : `exit ${code}`
    const detail = redactExact(stderr, sensitiveValues).trim().slice(-12_000)
    throw Error(`psql seed import ${terminationReason} (${classification})${detail ? `: ${detail}` : ''}`)
  }
  if (code === 0) { if (stdout.trim()) console.log(stdout.trim()); return }
  throw renderChildFailure({ code, signal, stderr, sensitiveValues })
}

export async function applySeed({
  databaseUrl, bundleDir, sourceFile, dryRun = false, injectLateFailure = false,
  psqlBin = process.env.PSQL_BIN, timeoutMs = process.env.BENEFIT_SEED_TIMEOUT_MS,
  testOnly,
} = {}) {
  const allowUnsafeTimeout = testOnly?.allowUnsafeTimeout === true
  const bounded = boundedTimeout(timeoutMs, allowUnsafeTimeout)
  const termGraceMs = allowUnsafeTimeout && Number.isSafeInteger(testOnly?.termGraceMs) ? testOnly.termGraceMs : 2_000
  if (termGraceMs < 10 || termGraceMs > 10_000) throw Error('psql termination grace is out of bounds')
  const executable = await resolvePsql(psqlBin)
  const env = databaseEnvironment(databaseUrl, bounded)
  const parsedDatabaseUrl = new URL(databaseUrl)
  const decodedUser = decodeURIComponent(parsedDatabaseUrl.username)
  const decodedPassword = decodeURIComponent(parsedDatabaseUrl.password)
  const credentials = [
    databaseUrl,
    process.env.DATABASE_URL,
    decodedPassword,
    `${decodedUser}:${decodedPassword}`,
    `${parsedDatabaseUrl.username}:${parsedDatabaseUrl.password}`,
  ]
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
    await runPsql(executable, env, sqlPath, [directory, sqlPath, tsvPath, ...credentials], { timeoutMs: bounded, termGraceMs })
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
