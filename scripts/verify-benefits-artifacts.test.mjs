import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { assertApprovedProjectionBaseHash, assertExactArtifactInventory, assertNoBenefitsFixtureLeaks, assertProjectionCompanyJoin } from './verify-benefits-artifacts.mjs'
import { assertExplicitCellInventory, categories } from '../community-app/src/types/benefits.ts'

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

test('vNext inventory rejects legacy outcomes and mismatched state totals', () => {
  const explicit = categories.map((category_id) => ({ category_id, state: 'no_public_info', reliability: 'none', currentness: 'unknown', scope_status: 'unresolved', conflict_status: 'none', publication_eligibility: 'discovery_only', assessed_at: '2026-11-01T00:00:00Z', official_claim_ids: [], reference_ids: [], community_report_ids: [], nonabsence_notice: '이번 조사에서 게시 가능한 공식 복지 근거를 확보하지 못했습니다. 복지가 없다는 뜻이 아닙니다.' }))
  const vNext = { cell_count: 10, cell_state_counts: { official_verified: 0, reference: 0, community_report: 0, no_public_info: 10 } }
  assert.doesNotThrow(() => assertExplicitCellInventory([{ category_outcomes: explicit }], vNext))
  assert.throws(() => assertExplicitCellInventory([{ category_outcomes: explicit }], { ...vNext, cell_state_counts: { ...vNext.cell_state_counts, no_public_info: 9 } }), /inventory/)
  assert.throws(() => assertExplicitCellInventory([{ category_outcomes: [{ kind: 'insufficient_evidence' }] }], vNext), /legacy/)
})

test('additive projection rejects base hash drift and pending company leakage', () => {
  const active = { artifact_protocol: 'v1', data_version: 'release-v9' }
  const digest = createHash('sha256').update(`${JSON.stringify(active)}\n`).digest('hex')
  assert.doesNotThrow(() => assertApprovedProjectionBaseHash({ ...active, approved_v2_projection: { base_manifest_sha256: digest } }))
  assert.throws(() => assertApprovedProjectionBaseHash({ ...active, approved_v2_projection: { base_manifest_sha256: '0'.repeat(64) } }), /hash drift/)
  const base = new Map([['KR-CRN-0000000000001', { population_sequence: 1 }]])
  assert.doesNotThrow(() => assertProjectionCompanyJoin([{ company_id: 'KR-CRN-0000000000001', population_sequence: 1 }], base))
  assert.throws(() => assertProjectionCompanyJoin([{ company_id: 'KR-CRN-0000000000002', population_sequence: 1 }], base), /canonical company/)
  assert.throws(() => assertProjectionCompanyJoin([{ company_id: 'KR-CRN-0000000000001', population_sequence: 2 }], base), /population_sequence/)
})