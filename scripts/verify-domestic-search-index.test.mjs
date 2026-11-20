import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { verifyDomesticSearchIndex } from './verify-domestic-search-index.mjs'

const source = 'community-app/public/data/company-benefits/domestic-search-index-v1/index.json'
const relative = 'community/data/company-benefits/domestic-search-index-v1/index.json'
const fixture = async run => {
  const root = await mkdtemp(path.join(tmpdir(), 'search-index-verifier-'))
  const target = path.join(root, relative)
  try {
    await mkdir(path.dirname(target), { recursive: true })
    await cp(source, target)
    await run(root, target)
  } finally { await rm(root, { recursive: true, force: true }) }
}
test('independent pinned verifier accepts complete public index', async () => fixture(async root => {
  assert.match(await verifyDomesticSearchIndex(root), /40053/)
}))
test('self-consistently rehashed deleted entry is rejected by independent pin', async () => fixture(async (root, target) => {
  const doc = JSON.parse(await readFile(target, 'utf8'))
  doc.entries.pop()
  doc.totals.records--
  doc.digest = createHash('sha256').update(JSON.stringify(doc.entries)).digest('hex')
  await writeFile(target, JSON.stringify(doc))
  await assert.rejects(verifyDomesticSearchIndex(root), /SHA|digest|count/)
}))
test('symlinked snapshot is rejected', async () => fixture(async (root, target) => {
  await rm(target)
  await symlink(path.resolve(source), target)
  await assert.rejects(verifyDomesticSearchIndex(root), /unsafe|symlink|ELOOP/)
}))
