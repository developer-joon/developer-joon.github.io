import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { assertExactArtifactInventory, assertNoBenefitsFixtureLeaks } from './verify-benefits-artifacts.mjs'

const descriptor = (url) => ({ url })
const manifest = (version = 'release-v9') => ({
  data_version: version,
  taxonomy: descriptor(`community/data/company-benefits/${version}/taxonomy.json`),
  sources: descriptor(`community/data/company-benefits/${version}/sources.json`),
  methodology: descriptor(`community/data/company-benefits/${version}/methodology.json`),
  listing_chunks: [descriptor(`community/data/company-benefits/${version}/listings/companies-01.json`)],
  company_shards: { company: descriptor(`community/data/company-benefits/${version}/companies/KR-CRN-0000000000001.json`) },
})

async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'benefits-inventory-'))
  const value = manifest()
  try {
    for (const entry of [value.taxonomy, value.sources, value.methodology, ...value.listing_chunks, ...Object.values(value.company_shards)]) {
      const target = path.join(root, entry.url)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, '{}\n')
    }
    await run(root, value)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('inventory follows the active manifest data_version instead of a hardcoded version', () => fixture(async (root, value) => {
  await assert.doesNotReject(assertExactArtifactInventory(root, value))
}))

for (const name of ['secret.txt', 'fixture.json', 'rankings.json']) {
  test(`rejects unreferenced active-version file ${name}`, () => fixture(async (root, value) => {
    await writeFile(path.join(root, `community/data/company-benefits/${value.data_version}/${name}`), 'private')
    await assert.rejects(assertExactArtifactInventory(root, value), /inventory mismatch/)
  }))
}

test('rejects symlinks and non-regular entries in the active tree', () => fixture(async (root, value) => {
  const target = path.join(root, value.taxonomy.url)
  await rm(target)
  await symlink(path.join(root, value.sources.url), target)
  await assert.rejects(assertExactArtifactInventory(root, value), /unsafe artifact entry/)
}))

test('rejects internal review diagnostics in public artifacts', () => fixture(async (root, value) => {
  const target = path.join(root, value.company_shards.company.url)
  const artifact = JSON.parse(await readFile(target, 'utf8'))
  artifact.claims = [{ review: { review_id: 'internal-review-1', reviewer_id: 'reviewer-a' } }]
  await writeFile(target, `${JSON.stringify(artifact)}\n`)
  await assert.rejects(
    assertNoBenefitsFixtureLeaks(root, [], value.data_version),
    /internal review/i,
  )
}))