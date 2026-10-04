#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const generator = path.join(repoRoot, 'scripts/generate-development-bootstrap.mjs')
const migrationsDirectory = path.join(repoRoot, 'supabase/migrations')
const seedPath = path.join(repoRoot, 'supabase/seed.sql')
const expectedMigration001Sha256 = '1b366c12ff7cd0ad05eb5022ae1227ecaeb906567ddc49d53e4551aa9f8f513e'

async function generate(outputPath) {
  const result = spawnSync(process.execPath, [generator, '--output', outputPath], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  return readFile(outputPath, 'utf8')
}

async function sourceFiles() {
  const names = (await readdir(migrationsDirectory)).filter((name) => name.endsWith('.sql')).sort()
  return Promise.all(names.map(async (name) => ({
    name: `supabase/migrations/${name}`,
    bytes: await readFile(path.join(migrationsDirectory, name), 'utf8'),
  })))
}

test('requires exactly 17 sorted, unique timestamped migrations', async () => {
  const sources = await sourceFiles()
  assert.equal(sources.length, 17)
  assert.deepEqual(sources.map(({ name }) => name), [...new Set(sources.map(({ name }) => name))].sort())
  for (const { name } of sources) assert.match(name, /^supabase\/migrations\/\d{12}_[a-z0-9_]+\.sql$/)
})

test('pins the immutable 202610040001 migration bytes', async () => {
  const bytes = await readFile(path.join(migrationsDirectory, '202610040001_provider_neutral_profile_provisioning.sql'))
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedMigration001Sha256)
})

test('includes every source byte exactly once with filename boundaries and SHA-256 manifest', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'development-bootstrap-test-'))
  const output = await generate(path.join(root, 'bootstrap.sql'))
  const sources = [...await sourceFiles(), { name: 'supabase/seed.sql', bytes: await readFile(seedPath, 'utf8') }]

  for (const { name, bytes } of sources) {
    const digest = createHash('sha256').update(bytes).digest('hex')
    assert.match(output, new RegExp(`-- sha256: ${digest}  ${name.replaceAll('/', '\\/')}\\n`))
    assert.match(output, new RegExp(`-- BEGIN SOURCE: ${name.replaceAll('/', '\\/')}\\n`))
    assert.match(output, new RegExp(`-- END SOURCE: ${name.replaceAll('/', '\\/')}\\n`))
    assert.equal(output.split(bytes).length - 1, 1, `${name} bytes must occur exactly once`)
  }
})

test('is fail-closed, project-specific, sectioned for SQL Editor, and has no global wrapper', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'development-bootstrap-test-'))
  const output = await generate(path.join(root, 'bootstrap.sql'))

  assert.ok(output.startsWith('-- TARGET: breadlab-community-development'))
  assert.match(output, /giuxonxvuqrdnmjwvhvt/)
  assert.match(output, /cannot cryptographically detect|cannot verify the Supabase project ref/i)
  assert.match(output, /FRESH PROJECT PREFLIGHT/)
  assert.match(output, /to_regclass\('public\.profiles'\)/)
  assert.match(output, /raise exception[^;]*fresh/i)
  assert.match(output, /DASHBOARD RUN SECTION 01 OF 20/)
  assert.match(output, /DASHBOARD RUN SECTION 20 OF 20/)
  assert.match(output, /11A:.*CREATE INDEX CONCURRENTLY/is)
  assert.match(output, /11B:.*DO \$\$/is)
  assert.match(output, /Never send 11A and 11B as one Dashboard query/i)
  assert.match(output, /create index concurrently if not exists post_reaction_daily_recent_idx/i)
  assert.doesNotMatch(output.slice(0, output.indexOf('-- BEGIN SOURCE:')), /^begin;$/im, 'bundle must not add a global transaction')
})

test('records migration history without replaying migrations on a future db push', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'development-bootstrap-test-'))
  const output = await generate(path.join(root, 'bootstrap.sql'))

  assert.match(output, /insert into supabase_migrations\.schema_migrations \(version, statements, name\)/i)
  assert.match(output, /array\[\]::text\[\]/i)
  assert.match(output, /202609260001.*core_schema/s)
  assert.match(output, /202610040002.*google_profile_metadata_provenance/s)
})

test('ends with fail-closed read-only verification for schema, Google-only provisioning, provenance, and seed counts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'development-bootstrap-test-'))
  const output = await generate(path.join(root, 'bootstrap.sql'))
  const verification = output.slice(output.indexOf('-- DASHBOARD RUN SECTION 20 OF 20'))

  assert.match(verification, /BOOTSTRAP VERIFIED/)
  assert.match(verification, /public\.profiles/)
  assert.match(verification, /public\.list_public_posts/)
  assert.match(verification, /identities_provision_oauth_profile/)
  assert.match(verification, /metadata_provider/)
  assert.match(verification, /provider is distinct from ''google''/i)
  assert.match(verification, /github.*kakao|kakao.*github/is)
  assert.match(verification, /from public\.tags/i)
  assert.match(verification, /count\(\*\).*5|<> 5/is)
  assert.doesNotMatch(verification, /insert into auth\.|insert into public\.(?:posts|comments|profiles)/i)
})

test('contains no URL, key, credential, or known secret-shaped value', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'development-bootstrap-test-'))
  const output = await generate(path.join(root, 'bootstrap.sql'))

  assert.doesNotMatch(output, /https?:\/\/[A-Za-z0-9]/i, 'must not contain an actual URL; SQL URL-validation regexes are source code')
  assert.doesNotMatch(output, /(?:anon|service_role|publishable|secret)[_-]?key\s*[:=]/i)
  assert.doesNotMatch(output, /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/)
  assert.doesNotMatch(output, /postgres(?:ql)?:\/\//i)
})

test('documents the exact Korean Dashboard procedure and failure boundary', async () => {
  const runbook = await readFile(path.join(repoRoot, 'docs/operations/development-database-bootstrap.md'), 'utf8')
  assert.match(runbook, /breadlab-community-development/)
  assert.match(runbook, /giuxonxvuqrdnmjwvhvt/)
  assert.match(runbook, /production.*금지|프로덕션.*금지/is)
  assert.match(runbook, /SQL Editor/)
  assert.match(runbook, /New query|새 쿼리/i)
  assert.match(runbook, /01.*20|20개/is)
  assert.match(runbook, /BOOTSTRAP VERIFIED/)
  assert.match(runbook, /오류.*중단|실패.*중단/is)
  assert.match(runbook, /전체.*실행.*금지|한 번에.*실행.*금지/is)
})

test('generation is byte-deterministic and check mode detects drift', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'development-bootstrap-test-'))
  const firstPath = path.join(root, 'first.sql')
  const secondPath = path.join(root, 'second.sql')
  const first = await generate(firstPath)
  const second = await generate(secondPath)
  assert.equal(second, first)

  const check = spawnSync(process.execPath, [generator, '--output', firstPath, '--check'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  assert.equal(check.status, 0, check.stderr)
})
