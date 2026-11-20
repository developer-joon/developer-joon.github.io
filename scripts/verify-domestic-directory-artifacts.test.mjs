import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { verifyDomesticDirectoryArtifacts } from './verify-domestic-directory-artifacts.mjs'

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../community-app/public/data/company-benefits')
const relative = 'community/data/company-benefits'
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'directory-verifier-'))
  const release = path.join(root, relative)
  try {
    await cp(source, release, { recursive: true })
    await run(root, path.join(release, 'domestic-directory-v1'), release)
  } finally { await rm(root, { recursive: true, force: true }) }
}

async function mutate(directory, change) {
  const manifestPath = path.join(directory, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const shardPath = path.join(directory, manifest.chunks[0].path)
  const shard = JSON.parse(await readFile(shardPath, 'utf8'))
  change(shard.records, manifest)
  const bytes = Buffer.from(JSON.stringify(shard) + '\n')
  await writeFile(shardPath, bytes)
  manifest.chunks[0].bytes = bytes.length
  manifest.chunks[0].sha256 = hash(bytes)
  await writeFile(manifestPath, JSON.stringify(manifest) + '\n')
}

test('tracked directory validates 73 shards and 36,084 unique identities', async () => fixture(async (root) => {
  assert.match(await verifyDomesticDirectoryArtifacts(root), /36084.*73/)
}))

test('rehashed deletion of one base alias with recomputed totals is rejected', async () => fixture(async (root, directory) => {
  const manifestPath = path.join(directory, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  let deleted = false
  for (const chunk of manifest.chunks) {
    const shardPath = path.join(directory, chunk.path)
    const shard = JSON.parse(await readFile(shardPath, 'utf8'))
    const index = shard.records.findIndex((row) => row.id.startsWith('KR-CRN-'))
    if (index < 0) continue
    shard.records.splice(index, 1)
    const bytes = Buffer.from(JSON.stringify(shard) + '\n')
    await writeFile(shardPath, bytes)
    chunk.bytes = bytes.length
    chunk.count = shard.records.length
    chunk.sha256 = hash(bytes)
    deleted = true
    break
  }
  assert.ok(deleted, 'fixture has a base alias to remove')
  manifest.totals.base_aliases -= 1
  manifest.totals.listing_records -= 1
  manifest.totals.excluded_last_day_name_conflict += 1
  await writeFile(manifestPath, JSON.stringify(manifest) + '\n')
  await assert.rejects(verifyDomesticDirectoryArtifacts(root), /directory.*(epoch|totals|alias)/i)
}))

test('source SHA replacement in self-consistent manifest is rejected', async () => fixture(async (root, directory) => {
  const manifestPath = path.join(directory, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.sources.recruitment.sha256 = '0'.repeat(64)
  await writeFile(manifestPath, JSON.stringify(manifest) + '\n')
  await assert.rejects(verifyDomesticDirectoryArtifacts(root), /directory.*(source|epoch)/i)
}))

test('self-consistently rehashed invalid identity, source, size, and duplicate are rejected', async () => fixture(async (root, directory) => {
  const original = await readFile(path.join(directory, 'shards/0000.json'))
  const manifest = await readFile(path.join(directory, 'manifest.json'))
  for (const [label, change] of [
    ['duplicate', (rows) => { rows[1].id = rows[0].id }],
    ['unknown source', (rows) => { rows[0].source_type = 'legal_employer' }],
    ['false size', (rows) => { rows[0].size_class = 'small' }],
    ['invalid ID', (rows) => { rows[0].id = 'KR-BIZ-123' }],
    ['false alias', (rows, m) => { rows[0].id = 'KR-CRN-9999999999999'; m.totals.new_records -= 1; m.totals.base_aliases += 1 }],
  ]) {
    await writeFile(path.join(directory, 'shards/0000.json'), original)
    await writeFile(path.join(directory, 'manifest.json'), manifest)
    await mutate(directory, change)
    await assert.rejects(verifyDomesticDirectoryArtifacts(root), /directory/i, label)
  }
}))

test('missing, stale, linked, and rehashed manifest/byte tampering fail closed', async () => fixture(async (root, directory, release) => {
  const manifestPath = path.join(directory, 'manifest.json')
  const original = await readFile(manifestPath)
  const shardPath = path.join(directory, 'shards/0000.json')
  const shard = await readFile(shardPath)
  await writeFile(path.join(directory, 'shards/extra.json'), shard)
  await assert.rejects(verifyDomesticDirectoryArtifacts(root), /directory.*inventory/i)
  await rm(path.join(directory, 'shards/extra.json'))
  await rm(shardPath)
  await assert.rejects(verifyDomesticDirectoryArtifacts(root), /directory/i)
  await symlink(path.join(source, 'domestic-directory-v1/shards/0000.json'), shardPath)
  await assert.rejects(verifyDomesticDirectoryArtifacts(root), /directory/i)
  await rm(shardPath)
  await writeFile(shardPath, shard)
  const m = JSON.parse(original)
  m.base_manifest_sha256 = '0'.repeat(64)
  await writeFile(manifestPath, JSON.stringify(m))
  await assert.rejects(verifyDomesticDirectoryArtifacts(root), /directory.*base/i)
  await writeFile(manifestPath, original)
  const byteManifest = JSON.parse(original)
  byteManifest.chunks[0].bytes = 1
  await writeFile(manifestPath, JSON.stringify(byteManifest))
  await assert.rejects(verifyDomesticDirectoryArtifacts(root), /directory.*byte/i)
  await writeFile(manifestPath, original)
  await writeFile(path.join(release, 'manifest.json'), '{}')
  await assert.rejects(verifyDomesticDirectoryArtifacts(root), /directory.*base/i)
}))
