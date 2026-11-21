import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import {
  FROZEN_SEED_CONTRACT,
  verifyBenefitDirectorySeed,
} from './verify-benefit-directory-seed.mjs'

const execFileAsync = promisify(execFile)
const repo = path.resolve(import.meta.dirname, '..')
const canonicalSource = path.join(repo, 'community-app/public/data/company-benefits/domestic-search-index-v1/index.json')
const canonicalBundle = path.join(repo, 'supabase/fixtures/benefit-directory')
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

async function mutateBundle(root, mutation) {
  const bundleDir = path.join(root, mutation)
  await cp(canonicalBundle, bundleDir, { recursive: true })
  const companiesPath = path.join(bundleDir, 'companies.ndjson')
  const rows = (await readFile(companiesPath, 'utf8')).trimEnd().split('\n').map(JSON.parse)
  if (mutation === 'delete') rows.pop()
  else rows[0].source_binding.identity_kind = rows[0].source_binding.identity_kind === 'ftc_affiliate'
    ? 'base_legal_identity'
    : 'ftc_affiliate'
  const companiesBytes = Buffer.from(`${rows.map(row => JSON.stringify(row)).join('\n')}\n`)
  await writeFile(companiesPath, companiesBytes)
  const manifestPath = path.join(bundleDir, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.company_count = rows.length
  manifest.identity_counts = Object.fromEntries(
    ['base_legal_identity', 'recruitment_observation', 'ftc_affiliate']
      .map(key => [key, rows.filter(row => row.source_binding.identity_kind === key).length]),
  )
  manifest.ordered_id_set_sha256 = sha256(Buffer.from(`${rows.map(row => row.company_id).join('\n')}\n`))
  manifest.companies = {
    path: 'companies.ndjson',
    byte_count: companiesBytes.length,
    sha256: sha256(companiesBytes),
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`)
  return bundleDir
}

test('canonical seed passes the independent frozen byte and row contract', async () => {
  const result = await verifyBenefitDirectorySeed({ sourceFile: canonicalSource, bundleDir: canonicalBundle })
  assert.deepEqual(result.summary, {
    companyCount: 40053,
    identityCounts: { base_legal_identity: 1000, recruitment_observation: 35910, ftc_affiliate: 3143 },
    companiesByteCount: 18848420,
    companiesSha256: '80c89e90b0af6b31f1e2478494aff313c926d234d381294b173f26320115ca23',
    manifestSha256: '29fcc16e4d643ec2955241737cba1cacbe5f0c7f86c7c2d5f7d3522510f040ec',
    orderedIdSha256: 'c96f906973da37cf14138e0ef027a05374c1fa08a6906d8c2ef2b900f7ccbf97',
    sourceArtifactSha256: 'b7e61860d69f289735f42a6ae275c8a5303cbde367036f77865c7b20de7b9594',
  })
  assert.equal(Object.isFrozen(FROZEN_SEED_CONTRACT), true)
})

test('self-consistent row deletion and identity mutation cannot override independent constants through the manifest', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'independent-benefit-seed-'))
  try {
    for (const mutation of ['delete', 'identity']) {
      const bundleDir = await mutateBundle(root, mutation)
      await assert.rejects(
        verifyBenefitDirectorySeed({ sourceFile: canonicalSource, bundleDir }),
        /frozen|authority|drift|count|digest|identity/i,
        mutation,
      )
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('symlinked and nonregular bundle inputs fail closed through the inherited verifier', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'independent-benefit-seed-inputs-'))
  try {
    const linked = path.join(root, 'linked')
    await mkdir(linked)
    await symlink(path.join(canonicalBundle, 'manifest.json'), path.join(linked, 'manifest.json'))
    await cp(path.join(canonicalBundle, 'companies.ndjson'), path.join(linked, 'companies.ndjson'))
    await assert.rejects(
      verifyBenefitDirectorySeed({ sourceFile: canonicalSource, bundleDir: linked }),
      /symlink|unsafe|ELOOP/i,
    )

    const nonregular = path.join(root, 'nonregular')
    await cp(canonicalBundle, nonregular, { recursive: true })
    await rm(path.join(nonregular, 'companies.ndjson'))
    await mkdir(path.join(nonregular, 'companies.ndjson'))
    await assert.rejects(
      verifyBenefitDirectorySeed({ sourceFile: canonicalSource, bundleDir: nonregular }),
      /unsafe|file|bound|directory|EISDIR/i,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('CLI accepts no path injection and emits one sanitized bounded summary line', async () => {
  const script = path.join(repo, 'scripts/verify-benefit-directory-seed.mjs')
  const { stdout, stderr } = await execFileAsync(process.execPath, [script], { cwd: repo })
  assert.equal(stderr, '')
  const lines = stdout.trimEnd().split('\n')
  assert.equal(lines.length, 1)
  assert.match(lines[0], /^benefit directory seed verified: 40053 companies; identities 1000\/35910\/3143; companies 18848420 bytes sha256 [0-9a-f]{64}; manifest sha256 [0-9a-f]{64}; ordered IDs sha256 [0-9a-f]{64}; source sha256 [0-9a-f]{64}$/)
  assert.ok(Buffer.byteLength(lines[0]) < 512)
  assert.doesNotMatch(lines[0], /KR-(?:BIZ|CRN)|source_binding|display_name|https?:/i)
  await assert.rejects(
    execFileAsync(process.execPath, [script, '--source', canonicalSource], { cwd: repo }),
    error => error.code !== 0 && /usage/i.test(error.stderr),
  )
})
