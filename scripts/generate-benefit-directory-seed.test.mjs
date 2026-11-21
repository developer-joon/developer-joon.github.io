import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmod, cp, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  PINNED_SOURCE,
  buildSeedFromDocument,
  generateSeedBundle,
  verifySeedBundle,
} from './generate-benefit-directory-seed.mjs'

const repo = path.resolve(import.meta.dirname, '..')
const realSource = path.join(repo, 'community-app/public/data/company-benefits/domestic-search-index-v1/index.json')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const fixtureContract = {
  artifactSha256: 'fixture',
  artifactBytes: null,
  companyCount: 3,
  identityCounts: { base_legal_identity: 1, recruitment_observation: 1, ftc_affiliate: 1 },
}
const fixtureDoc = () => ({
  schema_version: 'domestic-search-index-v1',
  edition: 'fixture-edition',
  approved: 0,
  totals: { records: 3, new_records: 1, base_aliases: 0, ftc_only: 1, research_companies: 0, research_leads: 0 },
  entries: [
    { id: 'KR-BIZ-0000000001', name: 'Recruitment One', observation_date: '2026-01-02', region: ' 서울 ', size_class: 'unclassified', source_type: 'dated_recruitment_observation' },
    { id: 'KR-CRN-0000000000001', name: 'Legal One', size_class: 'mid_history', source_type: 'base_legal_identity' },
    { id: 'KR-CRN-0000000000002', name: 'Affiliate One', group: 'Group', size_class: 'large_affiliate', source_type: 'ftc_affiliate', size_evidence: { as_of: '2026-01-01', group: 'Group', id: 'KR-CRN-0000000000002', name: 'Affiliate One', size_class: 'large_affiliate', source: 'ftc' } },
  ],
})

function fixtureBuild(mutator = () => {}) {
  const doc = fixtureDoc()
  mutator(doc)
  return buildSeedFromDocument(doc, Buffer.from(JSON.stringify(doc)), fixtureContract)
}

test('fixture emits exact rows, approved normalization, counts, and UTF-8 ID order', () => {
  const { manifest, rows, ndjson } = fixtureBuild()
  assert.equal(manifest.company_count, 3)
  assert.deepEqual(manifest.identity_counts, fixtureContract.identityCounts)
  assert.deepEqual(rows.map(row => row.company_id), [...rows.map(row => row.company_id)].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))))
  assert.deepEqual(Object.keys(rows[0]), ['company_id', 'identity_class', 'display_name', 'normalized_name', 'industry', 'size_class', 'region', 'source_edition', 'source_binding'])
  assert.equal(rows.find(row => row.company_id.startsWith('KR-BIZ')).region, '서울')
  assert.equal(rows.find(row => row.display_name === 'Legal One').size_class, 'unclassified')
  assert.equal(ndjson.at(-1), 0x0a)
})

test('fixture rejects duplicate ID, empty display name, extra keys, wrong types, and identity-count mutation', () => {
  assert.throws(() => fixtureBuild(doc => { doc.entries[1].id = doc.entries[0].id }), /duplicate|identity/i)
  assert.throws(() => fixtureBuild(doc => { doc.entries[0].name = '' }), /name|display/i)
  assert.throws(() => fixtureBuild(doc => { doc.entries[0].unexpected = true }), /key|shape/i)
  assert.throws(() => fixtureBuild(doc => { doc.entries[0].region = 7 }), /region|type/i)
  assert.throws(() => fixtureBuild(doc => { doc.entries[0].source_type = 'base_legal_identity' }), /identity|count/i)
})

test('real pinned artifact deterministically emits 40,053 unique identities with frozen classes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'benefit-seed-real-'))
  try {
    await generateSeedBundle({ sourceFile: realSource, outputDir: root })
    const result = await verifySeedBundle({ sourceFile: realSource, bundleDir: root })
    assert.equal(result.manifest.company_count, 40053)
    assert.equal(new Set(result.rows.map(row => row.company_id)).size, 40053)
    assert.deepEqual(result.manifest.identity_counts, {
      base_legal_identity: 1000,
      recruitment_observation: 35910,
      ftc_affiliate: 3143,
    })
    const again = await mkdtemp(path.join(tmpdir(), 'benefit-seed-again-'))
    try {
      await generateSeedBundle({ sourceFile: realSource, outputDir: again })
      assert.deepEqual(await readFile(path.join(root, 'manifest.json')), await readFile(path.join(again, 'manifest.json')))
      assert.deepEqual(await readFile(path.join(root, 'companies.ndjson')), await readFile(path.join(again, 'companies.ndjson')))
    } finally { await rm(again, { recursive: true, force: true }) }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('real input rejects deletion with recomputed mutable fields, source drift, and symlink at every component', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'benefit-seed-source-mutations-'))
  try {
    const source = path.join(root, 'a/b/c/index.json')
    await mkdir(path.dirname(source), { recursive: true })
    const original = await readFile(realSource)
    const doc = JSON.parse(original)
    doc.entries.pop()
    doc.totals.records--
    doc.digest = sha(Buffer.from(JSON.stringify(doc.entries)))
    await writeFile(source, JSON.stringify(doc))
    await assert.rejects(generateSeedBundle({ sourceFile: source, outputDir: path.join(root, 'out') }), /SHA|byte|source|contract/i)
    await writeFile(source, Buffer.concat([original.subarray(0, -1), Buffer.from(' ')]))
    await assert.rejects(generateSeedBundle({ sourceFile: source, outputDir: path.join(root, 'out') }), /SHA|source/i)

    for (const component of ['a', 'b', 'c', 'index.json']) {
      await rm(path.join(root, 'a'), { recursive: true, force: true })
      await mkdir(path.join(root, 'real/a/b/c'), { recursive: true })
      await writeFile(path.join(root, 'real/a/b/c/index.json'), original)
      if (component === 'a') await symlink(path.join(root, 'real/a'), path.join(root, 'a'))
      else {
        await mkdir(path.join(root, 'a'), { recursive: true })
        if (component === 'b') await symlink(path.join(root, 'real/a/b'), path.join(root, 'a/b'))
        else {
          await mkdir(path.join(root, 'a/b'), { recursive: true })
          if (component === 'c') await symlink(path.join(root, 'real/a/b/c'), path.join(root, 'a/b/c'))
          else {
            await mkdir(path.join(root, 'a/b/c'), { recursive: true })
            await symlink(path.join(root, 'real/a/b/c/index.json'), path.join(root, 'a/b/c/index.json'))
          }
        }
      }
      await assert.rejects(generateSeedBundle({ sourceFile: source, outputDir: path.join(root, 'out') }), /symlink|unsafe|ELOOP/i)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('bundle verification rejects self-consistent deletion, duplicate ID, display-name loss, class mutation, extra keys, and output drift', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'benefit-seed-bundle-mutations-'))
  try {
    const clean = path.join(root, 'clean')
    await generateSeedBundle({ sourceFile: realSource, outputDir: clean })
    for (const mutation of ['delete', 'duplicate', 'name', 'class', 'extra']) {
      const target = path.join(root, mutation)
      await cp(clean, target, { recursive: true })
      const file = path.join(target, 'companies.ndjson')
      const rows = (await readFile(file, 'utf8')).trimEnd().split('\n').map(JSON.parse)
      if (mutation === 'delete') rows.pop()
      if (mutation === 'duplicate') rows[1].company_id = rows[0].company_id
      if (mutation === 'name') rows[0].display_name = ''
      if (mutation === 'class') rows[0].identity_class = rows[0].identity_class === 'group_affiliate' ? 'legal_corporation' : 'group_affiliate'
      if (mutation === 'extra') rows[0].unexpected = true
      const bytes = Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n')
      await writeFile(file, bytes)
      const manifestPath = path.join(target, 'manifest.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      manifest.company_count = rows.length
      manifest.companies.byte_count = bytes.length
      manifest.companies.sha256 = sha(bytes)
      manifest.identity_counts = Object.fromEntries(['base_legal_identity', 'recruitment_observation', 'ftc_affiliate'].map(key => [key, rows.filter(row => row.source_binding.identity_kind === key).length]))
      manifest.ordered_id_set_sha256 = sha(Buffer.from(rows.map(row => row.company_id).join('\n') + '\n'))
      await writeFile(manifestPath, JSON.stringify(manifest) + '\n')
      await assert.rejects(verifySeedBundle({ sourceFile: realSource, bundleDir: target }), /authority|drift|duplicate|display|identity|key|count/i, mutation)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('--check writes no tracked output and late failure preserves previous bundle', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'benefit-seed-atomic-'))
  try {
    const output = path.join(root, 'output')
    await generateSeedBundle({ sourceFile: realSource, outputDir: output })
    const beforeManifest = await readFile(path.join(output, 'manifest.json'))
    const beforeRows = await readFile(path.join(output, 'companies.ndjson'))
    await generateSeedBundle({ sourceFile: realSource, outputDir: output, check: true })
    await assert.rejects(generateSeedBundle({ sourceFile: realSource, outputDir: output, injectBeforeCommit: () => { throw Error('late injected failure') } }), /late injected/)
    assert.deepEqual(await readFile(path.join(output, 'manifest.json')), beforeManifest)
    assert.deepEqual(await readFile(path.join(output, 'companies.ndjson')), beforeRows)
    await writeFile(path.join(output, 'manifest.json'), '{}\n')
    await assert.rejects(generateSeedBundle({ sourceFile: realSource, outputDir: output, check: true }), /drift|differ/i)
    assert.deepEqual(await readFile(path.join(output, 'manifest.json')), Buffer.from('{}\n'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('a pre-existing legacy backup collision never removes the published bundle', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'benefit-seed-backup-collision-'))
  try {
    const output = path.join(root, 'output')
    await generateSeedBundle({ sourceFile: realSource, outputDir: output })
    const beforeManifest = await readFile(path.join(output, 'manifest.json'))
    const beforeRows = await readFile(path.join(output, 'companies.ndjson'))
    const collision = `${output}.previous-${process.pid}`
    await mkdir(collision)
    await writeFile(path.join(collision, 'occupied'), 'do not replace')

    await assert.rejects(generateSeedBundle({
      sourceFile: realSource, outputDir: output,
      testOnly: { injectBeforeInstall: () => { throw Error('injected install failure') } },
    }), /injected install failure/i)
    assert.deepEqual(await readFile(path.join(output, 'manifest.json')), beforeManifest)
    assert.deepEqual(await readFile(path.join(output, 'companies.ndjson')), beforeRows)
    assert.equal(await readFile(path.join(collision, 'occupied'), 'utf8'), 'do not replace')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('concurrent generators serialize without mixing the published bundle', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'benefit-seed-concurrent-'))
  try {
    const output = path.join(root, 'output')
    await generateSeedBundle({ sourceFile: realSource, outputDir: output })
    let release
    const hold = new Promise(resolve => { release = resolve })
    let announceLocked
    const locked = new Promise(resolve => { announceLocked = resolve })
    const first = generateSeedBundle({
      sourceFile: realSource, outputDir: output,
      injectBeforeCommit: async () => { announceLocked(); await hold },
    })
    await locked
    await assert.rejects(generateSeedBundle({ sourceFile: realSource, outputDir: output }), /generation lock is already held/i)
    release()
    await first
    const verified = await verifySeedBundle({ sourceFile: realSource, bundleDir: output })
    assert.equal(verified.manifest.company_count, 40053)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('post-commit backup cleanup failure warns but keeps the installed bundle valid', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'benefit-seed-cleanup-warning-'))
  const warnings = []
  const originalWarn = console.warn
  try {
    const output = path.join(root, 'output')
    await generateSeedBundle({ sourceFile: realSource, outputDir: output })
    console.warn = message => warnings.push(String(message))
    await generateSeedBundle({
      sourceFile: realSource, outputDir: output,
      testOnly: { injectBackupCleanupFailure: () => { throw Error('cleanup unavailable') } },
    })
    assert.match(warnings.join('\n'), /committed; stale backup remains/)
    await verifySeedBundle({ sourceFile: realSource, bundleDir: output })
  } finally {
    console.warn = originalWarn
    await rm(root, { recursive: true, force: true })
  }
})

test('row integrity digest distinguishes UTF-8, null, empty, and field boundaries', async () => {
  const { computeRowDigest } = await import('./apply-benefit-directory-seed.mjs')
  assert.equal(typeof computeRowDigest, 'function')
  const base = ['KR-BIZ-0000000001', 'legal_corporation', '한글 회사', '한글 회사', null, 'unclassified', '', 'fixture-edition', '{}']
  const digests = [
    computeRowDigest(base),
    computeRowDigest(base.with(4, '')),
    computeRowDigest(base.with(2, '한글회사')),
    computeRowDigest(base.with(2, 'a').with(3, 'bc')),
    computeRowDigest(base.with(2, 'ab').with(3, 'c')),
  ]
  assert.equal(new Set(digests).size, digests.length)
  for (const digest of digests) assert.match(digest, /^[0-9a-f]{64}$/)
})

test('PSQL_BIN is absolute and the version probe receives no database credentials', async () => {
  const { applySeed } = await import('./apply-benefit-directory-seed.mjs')
  const root = await mkdtemp(path.join(tmpdir(), 'benefit-seed-psql-probe-'))
  const fakePsql = path.join(root, 'psql')
  const capture = path.join(root, 'probe.json')
  const databaseUrl = 'postgresql://private_user:private_password@127.0.0.1:5432/private_db'
  const previous = Object.fromEntries(['PATH', 'PSQL_BIN', 'DATABASE_URL', 'PGPASSWORD', 'PGCLIENTENCODING', 'PGOPTIONS'].map(key => [key, process.env[key]]))
  try {
    process.env.PSQL_BIN = 'psql'
    process.env.PATH = root
    await assert.rejects(applySeed({ databaseUrl, bundleDir: path.join(repo, 'supabase/fixtures/benefit-directory'), sourceFile: realSource }), /PSQL_BIN.*absolute/i)

    await writeFile(fakePsql, `#!${process.execPath}\n` + `
import { writeFileSync } from 'node:fs'
if (process.argv.includes('--version')) {
  writeFileSync(${JSON.stringify(capture)}, JSON.stringify(process.env))
  console.log('psql (PostgreSQL) 17.0')
  process.exit(0)
}
process.exit(19)
`)
    await chmod(fakePsql, 0o700)
    process.env.PSQL_BIN = fakePsql
    process.env.DATABASE_URL = databaseUrl
    process.env.PGPASSWORD = 'inherited-password'
    process.env.PGCLIENTENCODING = 'LATIN1'
    process.env.PGOPTIONS = '-c evil=1'
    await assert.rejects(applySeed({ databaseUrl, bundleDir: path.join(repo, 'supabase/fixtures/benefit-directory'), sourceFile: realSource }), /exit 19/)
    const probeEnv = JSON.parse(await readFile(capture, 'utf8'))
    assert.equal(probeEnv.DATABASE_URL, undefined)
    assert.equal(probeEnv.PGPASSWORD, undefined)
    assert.equal(probeEnv.PGCLIENTENCODING, undefined)
    assert.equal(probeEnv.PGOPTIONS, undefined)
    assert.ok(Object.keys(probeEnv).every(key => !key.startsWith('PG')))
  } finally {
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value
    await rm(root, { recursive: true, force: true })
  }
})

test('hung psql is killed, reaped, and its private temp directory is removed within the bound', async () => {
  const { applySeed } = await import('./apply-benefit-directory-seed.mjs')
  const root = await mkdtemp(path.join(tmpdir(), 'benefit-seed-psql-timeout-'))
  const tempRoot = path.join(root, 'tmp')
  const fakePsql = path.join(root, 'psql')
  const pidFile = path.join(root, 'pid')
  const previous = Object.fromEntries(['TMPDIR', 'PSQL_BIN'].map(key => [key, process.env[key]]))
  try {
    await mkdir(tempRoot, { mode: 0o700 })
    await writeFile(fakePsql, `#!${process.execPath}\n` + `
import { writeFileSync } from 'node:fs'
if (process.argv.includes('--version')) { console.log('psql (PostgreSQL) 17.0'); process.exit(0) }
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid) + '\\n' + String(Date.now()))
process.on('SIGTERM', () => {})
setTimeout(() => process.exit(42), 2000)
`)
    await chmod(fakePsql, 0o700)
    process.env.TMPDIR = tempRoot
    process.env.PSQL_BIN = fakePsql
    await assert.rejects(applySeed({
      databaseUrl: 'postgresql://user:password@127.0.0.1:5432/db',
      bundleDir: path.join(repo, 'supabase/fixtures/benefit-directory'), sourceFile: realSource,
      timeoutMs: 100, testOnly: { allowUnsafeTimeout: true, termGraceMs: 50 },
    }), /timed out|SIGKILL|exit 42/i)
    const [pidText, childStartedText] = (await readFile(pidFile, 'utf8')).split('\n')
    assert.ok(Date.now() - Number(childStartedText) < 1000, 'timeout did not bound the TERM-ignoring child')
    const pid = Number(pidText)
    assert.throws(() => process.kill(pid, 0), error => error?.code === 'ESRCH')
    assert.deepEqual((await readdir(tempRoot)).filter(name => name.startsWith('benefit-directory-import-')), [])
  } finally {
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value
    await rm(root, { recursive: true, force: true })
  }
})

test('SIGTERM waits for child group reap before importer temp cleanup', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'benefit-seed-psql-signal-'))
  const tempRoot = path.join(root, 'tmp')
  const fakePsql = path.join(root, 'psql')
  const pidFile = path.join(root, 'pid')
  try {
    await mkdir(tempRoot, { mode: 0o700 })
    await writeFile(fakePsql, `#!${process.execPath}\n` + `
import { writeFileSync } from 'node:fs'
if (process.argv.includes('--version')) { console.log('psql (PostgreSQL) 17.0'); process.exit(0) }
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid) + '\\n' + String(Date.now()))
process.on('SIGTERM', () => {})
setInterval(() => {}, 1000)
`)
    await chmod(fakePsql, 0o700)
    const importer = spawn(process.execPath, [path.join(repo, 'scripts/apply-benefit-directory-seed.mjs')], {
      cwd: repo,
      env: {
        ...process.env, TMPDIR: tempRoot, PSQL_BIN: fakePsql,
        DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/db',
        BENEFIT_SEED_TIMEOUT_MS: '30000', PGCLIENTENCODING: 'LATIN1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    importer.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16_384) })
    for (let attempt = 0; attempt < 400; attempt++) {
      try { await readFile(pidFile); break } catch {
        if (attempt === 399) throw Error('fake psql did not start')
        await new Promise(resolve => setTimeout(resolve, 25))
      }
    }
    importer.kill('SIGTERM')
    const closed = await Promise.race([
      new Promise(resolve => importer.once('close', (code, signal) => resolve({ code, signal }))),
      new Promise((_, reject) => setTimeout(() => reject(Error('signalled importer did not exit')), 5000)),
    ])
    assert.notEqual(closed.code, 0)
    assert.match(stderr, /interrupted by SIGTERM/)
    const [pidText, childStartedText] = (await readFile(pidFile, 'utf8')).split('\n')
    assert.ok(Date.now() - Number(childStartedText) < 4000, 'signal cleanup exceeded TERM-to-KILL grace')
    assert.throws(() => process.kill(Number(pidText), 0), error => error?.code === 'ESRCH')
    assert.deepEqual((await readdir(tempRoot)).filter(name => name.startsWith('benefit-directory-import-')), [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('apply plan is exact and child failures are bounded without private paths or credentials', async () => {
  const { applySeed, buildImportSql } = await import('./apply-benefit-directory-seed.mjs')
  const sql = buildImportSql({
    tsvPath: '/safe/import.tsv',
    manifest: {
      schema_version: 'benefit-directory-seed-v1', company_count: 40053,
      identity_counts: { base_legal_identity: 1000, recruitment_observation: 35910, ftc_affiliate: 3143 },
      ordered_id_set_sha256: 'a'.repeat(64), source_artifact: { sha256: PINNED_SOURCE.sha256 },
    },
    bundleSha256: 'b'.repeat(64), dryRun: true, injectLateFailure: false,
  })
  assert.match(sql, /BEGIN;/)
  assert.match(sql, /pg_advisory_xact_lock/)
  assert.match(sql, /\\copy seed_stage/)
  assert.match(sql, /benefit_company_sources/)
  assert.match(sql, /benefit_import_receipts/)
  assert.match(sql, /LOCK TABLE public\.benefit_publications IN SHARE MODE/)
  assert.match(sql, /CREATE TEMP TABLE publication_snapshot/)
  assert.match(sql, /EXCEPT ALL/)
  assert.match(sql, /pg_catalog\.pg_attribute/)
  assert.match(sql, /relrowsecurity/)
  assert.match(sql, /seed_stage[\s\S]*benefit_companies[\s\S]*EXCEPT ALL/)
  assert.match(sql, /expected_company_sources[\s\S]*benefit_company_sources[\s\S]*EXCEPT ALL/)
  assert.match(sql, /ROLLBACK;/)
  assert.doesNotMatch(sql, /^(?:INSERT INTO|UPDATE|DELETE FROM) public\.benefit_publications/im)

  const root = await mkdtemp(path.join(tmpdir(), 'benefit-seed-psql-failure-'))
  const fakeBin = path.join(root, 'bin')
  const capture = path.join(root, 'sql-path.txt')
  const databaseUrl = 'postgresql://seed_private_user:pa%24%24word@127.0.0.1:5432/seed_private_db'
  const password = 'pa$$word'
  const oldPath = process.env.PATH
  const oldPsqlBin = process.env.PSQL_BIN
  const oldDatabaseUrl = process.env.DATABASE_URL
  try {
    await mkdir(fakeBin)
    const fakePsql = path.join(fakeBin, 'psql')
    await writeFile(fakePsql, `#!${process.execPath}\n` + String.raw`
import { writeFileSync } from 'node:fs'
import path from 'node:path'
if (process.argv.includes('--version')) {
  console.log('psql (PostgreSQL) 17.0')
  process.exit(0)
}
const sqlPath = process.argv[process.argv.indexOf('--file') + 1]
writeFileSync(${JSON.stringify(capture)}, sqlPath)
console.error('x'.repeat(20_000))
console.error('injected psql failure at ' + sqlPath + ' under ' + path.dirname(sqlPath))
console.error('DATABASE_URL=postgresql://seed_private_user:pa%24%24word@127.0.0.1:5432/seed_private_db')
console.error('PGPASSWORD=pa$$word password=pa$$word credential=seed_private_user:pa$$word')
process.exit(23)
`)
    await chmod(fakePsql, 0o700)
    process.env.PATH = fakeBin
    process.env.PSQL_BIN = fakePsql
    process.env.DATABASE_URL = databaseUrl
    let failure
    try {
      await applySeed({
        databaseUrl,
        bundleDir: path.join(repo, 'supabase/fixtures/benefit-directory'),
        sourceFile: realSource,
      })
    } catch (error) { failure = error }
    assert.ok(failure, 'injected psql failure must reject')
    const output = String(failure.stack ?? failure)
    const privateSqlPath = await readFile(capture, 'utf8')
    assert.match(output, /psql seed import failed with exit 23/)
    assert.ok(output.length <= 13_000, `child failure output is unbounded: ${output.length}`)
    for (const secret of [privateSqlPath, path.dirname(privateSqlPath), databaseUrl, password, 'seed_private_user:pa$$word']) {
      assert.ok(!output.includes(secret), `child failure exposed ${secret}`)
    }
  } finally {
    if (oldPath === undefined) delete process.env.PATH
    else process.env.PATH = oldPath
    if (oldPsqlBin === undefined) delete process.env.PSQL_BIN
    else process.env.PSQL_BIN = oldPsqlBin
    if (oldDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = oldDatabaseUrl

    await rm(root, { recursive: true, force: true })
  }
})

assert.equal(PINNED_SOURCE.sha256, 'b7e61860d69f289735f42a6ae275c8a5303cbde367036f77865c7b20de7b9594')
