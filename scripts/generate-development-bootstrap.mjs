#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDirectory = path.join(repoRoot, 'supabase/migrations')
const defaultOutput = path.join(repoRoot, 'supabase/bootstrap/development-dashboard.sql')
const immutableMigration001 = '202610040001_provider_neutral_profile_provisioning.sql'
const immutableMigration001Sha256 = '1b366c12ff7cd0ad05eb5022ae1227ecaeb906567ddc49d53e4551aa9f8f513e'

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function parseArguments(argv) {
  let output = defaultOutput
  let check = false
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--output') {
      output = path.resolve(repoRoot, argv[index + 1] ?? '')
      index += 1
    } else if (argv[index] === '--check') {
      check = true
    } else {
      throw new Error(`unknown argument: ${argv[index]}`)
    }
  }
  return { output, check }
}

async function loadSources() {
  const migrationNames = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith('.sql'))
    .sort()

  if (migrationNames.length !== 17 || new Set(migrationNames).size !== migrationNames.length) {
    throw new Error(`expected exactly 17 unique migrations, found ${migrationNames.length}`)
  }
  for (const name of migrationNames) {
    if (!/^\d{12}_[a-z0-9_]+\.sql$/.test(name)) throw new Error(`invalid migration filename: ${name}`)
  }

  const migrations = await Promise.all(migrationNames.map(async (name) => ({
    name,
    relativePath: `supabase/migrations/${name}`,
    bytes: await readFile(path.join(migrationsDirectory, name), 'utf8'),
  })))
  const guarded = migrations.find(({ name }) => name === immutableMigration001)
  if (!guarded || sha256(guarded.bytes) !== immutableMigration001Sha256) {
    throw new Error(`${immutableMigration001} is immutable; add a new migration instead of editing it`)
  }

  return {
    migrations,
    seed: {
      name: 'seed.sql',
      relativePath: 'supabase/seed.sql',
      bytes: await readFile(path.join(repoRoot, 'supabase/seed.sql'), 'utf8'),
    },
  }
}

function sourceBlock(source) {
  const separator = source.bytes.endsWith('\n') ? '' : '\n'
  return `-- BEGIN SOURCE: ${source.relativePath}\n${source.bytes}${separator}-- END SOURCE: ${source.relativePath}\n`
}

function section(number, title, body) {
  const instruction = number === 11
    ? '-- Do not run this whole section; follow the 11A/11B selections below.'
    : '-- Select only this section in SQL Editor, click Run, and stop on any error.'
  return [
    '-- ============================================================================',
    `-- DASHBOARD RUN SECTION ${String(number).padStart(2, '0')} OF 20: ${title}`,
    instruction,
    '-- ============================================================================',
    body.trimEnd(),
    '',
  ].join('\n')
}

function preflight() {
  return `do $bootstrap_preflight$
begin
  if pg_catalog.to_regclass('public.profiles') is not null
     or pg_catalog.to_regclass('public.posts') is not null
     or pg_catalog.to_regclass('public.tags') is not null
     or exists (
       select 1
         from supabase_migrations.schema_migrations
        where version in (
          '202609260001', '202609260002', '202609260003', '202609260004', '202609260005',
          '202609270001', '202609270002', '202609270003', '202609270004', '202609270005',
          '202609280001', '202609280002', '202609280003', '202609280004', '202609280005',
          '202610040001', '202610040002'
        )
     ) then
    raise exception 'fresh project preflight failed: community schema or migration history already exists';
  end if;

  if pg_catalog.to_regclass('auth.users') is null
     or pg_catalog.to_regclass('auth.identities') is null
     or pg_catalog.to_regclass('storage.buckets') is null
     or pg_catalog.to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'fresh project preflight failed: required Supabase platform schemas are missing';
  end if;

  raise notice 'FRESH PROJECT PREFLIGHT PASSED';
end
$bootstrap_preflight$;`
}

function historySql(migrations) {
  const rows = migrations.map(({ name }) => {
    const version = name.slice(0, 12)
    const migrationName = name.slice(13, -4)
    return `  ('${version}', array[]::text[], '${migrationName}')`
  }).join(',\n')

  return `-- The CLI 2.118.0 local reset schema was inspected before generating this file:
-- (version text primary key, statements text[], name text). The official CLI
-- records parsed statements, but db push determines applied status by version.
-- Empty statements truthfully avoid inventing parser output while version/name
-- prevent these already-executed files from being replayed by a future db push.
insert into supabase_migrations.schema_migrations (version, statements, name)
values
${rows};`
}

function verificationSql() {
  return `do $bootstrap_verify$
declare
  trigger_definition text;
  provision_definition text;
  seed_count integer;
begin
  if pg_catalog.to_regclass('public.profiles') is null
     or pg_catalog.to_regclass('public.posts') is null
     or pg_catalog.to_regclass('public.comments') is null
     or pg_catalog.to_regclass('public.tags') is null
     or pg_catalog.to_regclass('private.post_metrics') is null then
    raise exception 'verification failed: a core community relation is missing';
  end if;

  if pg_catalog.to_regprocedure('public.list_public_posts(text,integer,text,uuid,boolean,timestamp with time zone,bigint,uuid,real)') is null
     or pg_catalog.to_regprocedure('private.provision_oauth_profile_identity(text,text,uuid,jsonb)') is null
     or pg_catalog.to_regprocedure('private.backfill_oauth_profiles()') is null then
    raise exception 'verification failed: a core function is missing';
  end if;

  select pg_catalog.pg_get_triggerdef(t.oid)
    into trigger_definition
    from pg_catalog.pg_trigger as t
    join pg_catalog.pg_class as c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
   where n.nspname = 'auth'
     and c.relname = 'identities'
     and t.tgname = 'identities_provision_oauth_profile'
     and not t.tgisinternal;
  if trigger_definition is null
     or trigger_definition not like '%EXECUTE FUNCTION private.provision_oauth_profile()%' then
    raise exception 'verification failed: Google profile trigger is missing or unexpected';
  end if;

  select pg_catalog.pg_get_functiondef('private.provision_oauth_profile_identity(text,text,uuid,jsonb)'::regprocedure)
    into provision_definition;
  if provision_definition not ilike '%identity_provider is distinct from ''google''%'
     or provision_definition ilike '%identity_provider = ''github''%'
     or provision_definition ilike '%identity_provider = ''kakao''%'
     or provision_definition ilike '%identity_provider in (%github%'
     or provision_definition ilike '%identity_provider in (%kakao%' then
    raise exception 'verification failed: DB provisioning is not statically Google-only (github/kakao found)';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_attribute
     where attrelid = 'public.profiles'::regclass
       and attname = 'metadata_provider'
       and not attisdropped
  ) or not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.profiles'::regclass
       and conname = 'profiles_metadata_provider_check'
  ) then
    raise exception 'verification failed: profile metadata provenance is missing';
  end if;

  select count(*) into seed_count from public.tags;
  if seed_count <> 5
     or (select count(*) from public.tags where id in (
       'a1000000-0000-0000-0000-000000000001'::uuid,
       'a1000000-0000-0000-0000-000000000002'::uuid,
       'a1000000-0000-0000-0000-000000000003'::uuid,
       'a1000000-0000-0000-0000-000000000004'::uuid,
       'a1000000-0000-0000-0000-000000000005'::uuid
     )) <> 5 then
    raise exception 'verification failed: expected exactly 5 development seed tags';
  end if;

  if (select count(*) from supabase_migrations.schema_migrations where version between '202609260001' and '202610040002') <> 17 then
    raise exception 'verification failed: expected 17 application migration history rows';
  end if;

  raise notice 'BOOTSTRAP VERIFIED: 17 migrations, Google-only provisioning, provenance, and 5 seed tags';
end
$bootstrap_verify$;`
}

function render({ migrations, seed }) {
  const sources = [...migrations, seed]
  const manifest = sources.map((source) => `-- sha256: ${sha256(source.bytes)}  ${source.relativePath}`).join('\n')
  const migrationSections = migrations.map((source, index) => {
    const sectionNumber = index + 2
    const concurrentInstructions = source.name === '202609270005_unbounded_public_listing.sql'
      ? `-- SECTION 11 HAS TWO RUN SELECTIONS (the source bytes below remain unchanged):\n-- 11A: select and run only the CREATE INDEX CONCURRENTLY statement (source lines 9-12).\n-- 11B: then select and run from the following DO $$ (source line 14) through COMMIT.\n-- Never send 11A and 11B as one Dashboard query.\n`
      : ''
    return section(sectionNumber, source.name, `${concurrentInstructions}${sourceBlock(source)}`)
  }).join('\n')
  const seedAndHistory = `${sourceBlock(seed)}\n${historySql(migrations)}`

  return `-- TARGET: breadlab-community-development
-- PROJECT REF: giuxonxvuqrdnmjwvhvt
-- PRODUCTION IS FORBIDDEN. Visually confirm the Dashboard project before every run.
-- SQL cannot cryptographically detect or verify the Supabase project ref.
--
-- IMPORTANT: run the marked selections separately and in order. Sections 01-10
-- and 12-20 each run once; Section 11 runs as 11A and 11B. The Dashboard sends
-- one selection as one query. Running the whole file, or all of Section 11, puts
-- CREATE INDEX CONCURRENTLY inside an implicit transaction and must not be used.
-- No section is wrapped by this bundle in a global transaction.
--
-- SOURCE MANIFEST (SHA-256 over exact repository bytes):
${manifest}

${section(1, 'FRESH PROJECT PREFLIGHT', preflight())}
${migrationSections}
${section(19, 'DEVELOPMENT SEED AND MIGRATION HISTORY', seedAndHistory)}
${section(20, 'READ-ONLY VERIFICATION', verificationSql())}`
}

const { output, check } = parseArguments(process.argv.slice(2))
const generated = render(await loadSources())
if (check) {
  let existing
  try {
    existing = await readFile(output, 'utf8')
  } catch {
    throw new Error(`generated artifact is missing: ${path.relative(repoRoot, output)}`)
  }
  if (existing !== generated) throw new Error(`generated artifact is stale: ${path.relative(repoRoot, output)}`)
  process.stdout.write(`verified ${path.relative(repoRoot, output)}\n`)
} else {
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, generated)
  process.stdout.write(`generated ${path.relative(repoRoot, output)}\n`)
}
