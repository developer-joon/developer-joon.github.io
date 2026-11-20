import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { verifyDomesticSizeArtifacts } from './verify-domestic-size-artifacts.mjs'

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../community-app/public/data/company-benefits')
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'size-verifier-'))
  const release = path.join(root, 'community/data/company-benefits')
  try {
    await cp(source, release, { recursive: true })
    await run(root, path.join(release, 'domestic-size-evidence-v1'), release)
  } finally { await rm(root, { recursive: true, force: true }) }
}
async function mutate(directory, change) {
  const manifestPath = path.join(directory, 'manifest.json')
  const recordsPath = path.join(directory, 'records.json')
  const manifest = JSON.parse(await readFile(manifestPath))
  const records = JSON.parse(await readFile(recordsPath))
  change(records, manifest)
  const bytes = Buffer.from(JSON.stringify(records) + '\n')
  await writeFile(recordsPath, bytes)
  manifest.records.bytes = bytes.length
  manifest.records.sha256 = sha(bytes)
  await writeFile(manifestPath, JSON.stringify(manifest) + '\n')
}

test('tracked immutable size epoch validates exact counts', async () => fixture(async (root) => {
  assert.match(await verifyDomesticSizeArtifacts(root), /402 labels.*3143 FTC-only/)
}))

test('self-consistent label deletion with refreshed mutable count and hash fails', async () => fixture(async (root, directory) => {
  await mutate(directory, (records, manifest) => {
    records.labels.pop()
    manifest.records.count--
    manifest.records.labels--
    manifest.totals.records--
    manifest.totals.labels--
    manifest.totals.directory_labels--
  })
  await assert.rejects(verifyDomesticSizeArtifacts(root), /size.*(epoch|count|totals)/i)
}))

test('source binding replacement fails independently of records hash', async () => fixture(async (root, directory) => {
  const p = path.join(directory, 'manifest.json')
  const manifest = JSON.parse(await readFile(p))
  manifest.sources.ftc.sha256 = '0'.repeat(64)
  await writeFile(p, JSON.stringify(manifest) + '\n')
  await assert.rejects(verifyDomesticSizeArtifacts(root), /size.*source/i)
}))

test('rehashed false class, foreign exact ID, and unsupported provenance fail', async () => fixture(async (root, directory) => {
  const originalRecords = await readFile(path.join(directory, 'records.json'))
  const originalManifest = await readFile(path.join(directory, 'manifest.json'))
  for (const [label, change] of [
    ['class', (r) => { r.labels[0].size_class = 'small' }],
    ['foreign ID', (r) => { r.labels[0].id = 'KR-BIZ-9999999999' }],
    ['job source', (r) => { r.labels[0].source = 'recruitment' }],
    ['fake employment', (r) => { r.labels[0].current_employment = true }],
    ['benefits', (r) => { r.ftc_only[0].benefits = ['housing'] }],
  ]) {
    await writeFile(path.join(directory, 'records.json'), originalRecords)
    await writeFile(path.join(directory, 'manifest.json'), originalManifest)
    await mutate(directory, change)
    await assert.rejects(verifyDomesticSizeArtifacts(root), /size/i, label)
  }
}))

test('raw job prose and cross-host source URL are not accepted', async () => fixture(async (root, directory) => {
  const p = path.join(directory, 'manifest.json')
  const original = await readFile(p)
  for (const change of [
    (m) => { m.methodology += ' 구인 광고 대기업이므로 현재 고용 확인.' },
    (m) => { m.sources.ftc.url = 'https://attacker.example/ftc' },
    (m) => { m.sources.ftc.license = 'unrestricted republication' },
  ]) {
    const manifest = JSON.parse(original)
    change(manifest)
    await writeFile(p, JSON.stringify(manifest) + '\n')
    await assert.rejects(verifyDomesticSizeArtifacts(root), /size/i)
  }
}))

test('missing, linked, or extra size files fail', async () => fixture(async (root, directory) => {
  const records = path.join(directory, 'records.json')
  await writeFile(path.join(directory, 'extra.json'), '{}')
  await assert.rejects(verifyDomesticSizeArtifacts(root), /size.*inventory/i)
  await rm(path.join(directory, 'extra.json'))
  await rm(records)
  await assert.rejects(verifyDomesticSizeArtifacts(root), /size/i)
  await symlink(path.join(source, 'domestic-size-evidence-v1/records.json'), records)
  await assert.rejects(verifyDomesticSizeArtifacts(root), /size/i)
}))
