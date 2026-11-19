import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { verifyBenefitsResearchArtifacts } from './verify-benefits-research-artifacts.mjs'

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../community-app/public/data/company-benefits')
const relative = 'community/data/company-benefits'
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'research-verifier-'))
  const base = path.join(root, relative)
  try {
    await cp(source, base, { recursive: true })
    await run(root, path.join(base, 'research-leads-v1'))
  } finally { await rm(root, { recursive: true, force: true }) }
}

async function rewrite(research, change) {
  const leadsPath = path.join(research, 'leads.json')
  const manifestPath = path.join(research, 'manifest.json')
  const payload = JSON.parse(await readFile(leadsPath, 'utf8'))
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  change(payload, manifest)
  const bytes = Buffer.from(JSON.stringify(payload) + '\n')
  manifest.leads_byte_count = bytes.length
  manifest.leads_sha256 = hash(bytes)
  manifest.record_count = payload.leads.length
  manifest.company_count = new Set(payload.leads.map((lead) => lead.company_id)).size
  await writeFile(leadsPath, bytes)
  await writeFile(manifestPath, JSON.stringify(manifest) + '\n')
}

test('accepts the tracked 128-row research-only sibling beside its exact base', async () => {
  await fixture(async (root) => assert.match(await verifyBenefitsResearchArtifacts(root), /128.*12/))
})

// Frozen, self-rehashed mutations against the real 128-row release artifact.
// Each case was previously accepted despite violating the producer/browser contract.
const contractMutations = [
  ['null conditions', (rows) => { rows[0].scope.conditions = null }, /research lead 0 scope conditions invalid/],
  ['301-character action', (rows) => { rows[0].benefit_action = 'x'.repeat(301) }, /research lead 0 benefit_action invalid/],
  ['credential query', (rows) => { rows[0].source_url = 'https://example.com/benefit?api_key=test' }, /research source URL unsafe query/],
  ['unfrozen category', (rows) => { rows[0].primary_category = 'not_a_category' }, /research lead 0 primary_category invalid/],
  ['Unicode casefold duplicate', (rows) => { rows[0].benefit_action = 'Straße benefit'; rows[1].company_id = rows[0].company_id; rows[1].scope.legal_entity = rows[0].scope.legal_entity; rows[1].benefit_action = 'STRASSE benefit' }, /research lead 1 duplicate atomic benefit action/],
]
test('frozen five-case research contract mutation matrix', async (t) => {
  for (const [label, mutation, message] of contractMutations) {
    await t.test(label, async () => fixture(async (root, research) => {
      await rewrite(research, (payload) => mutation(payload.leads))
      await assert.rejects(verifyBenefitsResearchArtifacts(root), message)
    }))
  }
})

test('distinct actions for the same company remain valid', async () => fixture(async (root, research) => {
  await rewrite(research, (payload) => {
    payload.leads[1].company_id = payload.leads[0].company_id
    payload.leads[1].scope.legal_entity = payload.leads[0].scope.legal_entity
    payload.leads[1].benefit_action = 'A separately named benefit action'
  })
  assert.match(await verifyBenefitsResearchArtifacts(root), /128.*12/)
}))

for (const [label, mutation, message] of [
  ['roles with nine entries', (row) => { row.scope.roles = Array(9).fill('employee') }, /research lead 0 scope roles invalid/],
  ['empty employment types', (row) => { row.scope.employment_types = [] }, /research lead 0 scope employment_types invalid/],
  ['unknown condition key', (row) => { row.scope.conditions = { unknown_condition: 'yes' } }, /research lead 0 scope conditions invalid/],
  ['long limitation', (row) => { row.limitations = ['x'.repeat(241)] }, /research lead 0 limitation invalid/],
  ['long source ID', (row) => { row.source_registry_id = 'x'.repeat(241) }, /research lead 0 source_registry_id invalid/],
  ['encoded credential name', (row) => { row.source_url = 'https://example.com/benefit?api%5Fkey=test' }, /research source URL unsafe query/],
  ['raw body field', (row) => { row.body = 'private source' }, /research lead 0 schema mismatch/],
]) {
  test(`rejects contract boundary: ${label}`, async () => fixture(async (root, research) => {
    await rewrite(research, (payload) => mutation(payload.leads[0]))
    await assert.rejects(verifyBenefitsResearchArtifacts(root), message)
  }))
}

test('rejects absent sibling and tampered manifest and base binding', async () => {
  await fixture(async (root, research) => {
    await rm(path.join(research, 'manifest.json'))
    await assert.rejects(verifyBenefitsResearchArtifacts(root), /research|manifest/i)
  })
  await fixture(async (root, research) => {
    const filename = path.join(research, 'manifest.json')
    const manifest = JSON.parse(await readFile(filename, 'utf8'))
    manifest.base_manifest_sha256 = '0'.repeat(64)
    await writeFile(filename, JSON.stringify(manifest))
    await assert.rejects(verifyBenefitsResearchArtifacts(root), /base|manifest/i)
  })
  await fixture(async (root, research) => {
    await writeFile(path.join(research, 'leads.json'), '{}')
    await assert.rejects(verifyBenefitsResearchArtifacts(root), /research|leads/i)
  })
})

for (const [label, mutation] of [
  ['swapped company ID', (row, all) => { row.company_id = all.find((other) => other.company_id !== row.company_id).company_id }],
  ['duplicate atomic benefit action', (row, all) => { all[1].benefit_action = row.benefit_action; all[1].company_id = row.company_id }],
  ['forged verified status', (row) => { row.status = 'verified' }],
  ['raw quote', (row) => { row.quote = 'raw source text' }],
  ['source body', (row) => { row.source_body = 'full page' }],
  ['unsafe URL', (row) => { row.source_url = 'https://user:password@evil.example/benefit' }],
  ['wrong legal entity', (row) => { row.scope.legal_entity = 'Wrong legal entity' }],
]) {
  test(`rejects rehashed ${label}`, async () => fixture(async (root, research) => {
    await rewrite(research, (payload) => mutation(payload.leads[0], payload.leads))
    await assert.rejects(verifyBenefitsResearchArtifacts(root), /research|lead|company|legal|URL|source/i)
  }))
}

test('rejects unexpected research inventory', async () => {
  await fixture(async (root, research) => {
    await writeFile(path.join(research, 'private-source-body.txt'), 'raw page')
    await assert.rejects(verifyBenefitsResearchArtifacts(root), /research.*inventory/i)
  })
})

test('rejects oversize JSON and symlink leaves or parents', async () => {
  await fixture(async (root, research) => {
    await writeFile(path.join(research, 'manifest.json'), ' '.repeat(1024 * 1024 + 1))
    await assert.rejects(verifyBenefitsResearchArtifacts(root), /research|byte|limit/i)
  })
  await fixture(async (root, research) => {
    await writeFile(path.join(research, 'leads.json'), ' '.repeat(1024 * 1024 + 1))
    await assert.rejects(verifyBenefitsResearchArtifacts(root), /research|byte|limit/i)
  })
  await fixture(async (root, research) => {
    const filename = path.join(research, 'leads.json')
    await rm(filename)
    await symlink(path.join(source, 'research-leads-v1/leads.json'), filename)
    await assert.rejects(verifyBenefitsResearchArtifacts(root), /research|unsafe|symbolic/i)
  })
  await fixture(async (root, research) => {
    await rm(research, { recursive: true })
    await symlink(path.join(source, 'research-leads-v1'), research)
    await assert.rejects(verifyBenefitsResearchArtifacts(root), /research|unsafe|symbolic/i)
  })
})

test('rejects a FIFO leads leaf promptly before type validation', async () => fixture(async (root, research) => {
  const filename = path.join(research, 'leads.json')
  await rm(filename)
  execFileSync('mkfifo', [filename])
  const script = `import { verifyBenefitsResearchArtifacts } from ${JSON.stringify(new URL('./verify-benefits-research-artifacts.mjs', import.meta.url).href)}; verifyBenefitsResearchArtifacts(process.argv[1]).then(() => { console.error('unexpected success'); process.exitCode = 2 }, (error) => { console.error(error.message); process.exitCode = 1 })`
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, root], { timeout: 1500, detached: true, encoding: 'utf8' })
  if (result.error?.code === 'ETIMEDOUT') {
    try { process.kill(-result.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
  }
  assert.equal(result.error, undefined, `verifier hung on FIFO: ${result.error?.message}`)
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /research unsafe leads\.json/)
}))
