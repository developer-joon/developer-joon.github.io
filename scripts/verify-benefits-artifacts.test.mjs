import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { assertApprovedProjectionBaseHash, assertExactArtifactInventory, assertExactReleaseRootInventory, assertNoBenefitsFixtureLeaks, assertProjectionCompanyJoin, assertUniqueProjectionEvidenceIds, verifyApprovedV2Projection } from './verify-benefits-artifacts.mjs'
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

test('release root rejects secret-unmanifested.txt and rogue versions', () => fixture(async (root, value) => {
  const releaseRoot = path.join(root, 'community/data/company-benefits')
  await writeFile(path.join(releaseRoot, 'manifest.json'), '{}\n')
  await assert.doesNotReject(assertExactReleaseRootInventory(root, value))
  for (const name of ['secret-unmanifested.txt', '.hidden-release-note']) {
    const target = path.join(releaseRoot, name)
    await writeFile(target, 'private')
    await assert.rejects(assertExactReleaseRootInventory(root, value), /release root inventory/i)
    await rm(target)
  }
  const rogue = path.join(releaseRoot, 'rogue-version')
  await mkdir(rogue)
  await assert.rejects(assertExactReleaseRootInventory(root, value), /release root inventory/i)
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
  const identity = { company_id: 'KR-CRN-0000000000001', population_sequence: 1, legal_name: 'Test Co', display_name: 'Test Co', scope: 'domestic', jurisdiction: 'KR', incorporation_country: 'KR', registered_head_office_country: 'KR', selected_reporting_legal_entity: 'Test Co', sector: 'non_financial' }
  const base = new Map([[identity.company_id, identity]])
  assert.doesNotThrow(() => assertProjectionCompanyJoin([identity], base))
  assert.throws(() => assertProjectionCompanyJoin([{ company_id: 'KR-CRN-0000000000002', population_sequence: 1 }], base), /canonical company/)
  assert.throws(() => assertProjectionCompanyJoin([{ ...identity, population_sequence: 2 }], base), /identity/)
  assert.throws(() => assertProjectionCompanyJoin([{ ...identity, legal_name: 'Rebound Name' }], base), /identity/)
  assert.throws(() => assertProjectionCompanyJoin([{ ...identity, jurisdiction: 'US' }], base), /identity/)
})

const canonicalJson = (value) => `${JSON.stringify(value)}\n`

async function writeProjectionArtifact(root, version, relative, value, record_count) {
  const url = `community/data/company-benefits/${version}/${relative}`
  const raw = canonicalJson(value)
  const target = path.join(root, url)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, raw)
  return { url, sha256: createHash('sha256').update(raw).digest('hex'), record_count, byte_count: Buffer.byteLength(raw) }
}

function projectedOutcome(category_id) {
  const base = { category_id, source_tiers: [], official_claim_ids: [], reference_ids: [], community_report_ids: [], official_claim_count: 0, reference_count: 0, community_report_count: 0, benefit_type_count: 0, scope: { countries: [], legal_entities: [], roles: [], employment_types: [], tenure_conditions: [] }, assessed_at: '2026-11-01T00:00:00Z', last_checked_at: '2026-11-01T00:00:00Z', searched_source_ids: [], conflict_status: 'none' }
  if (category_id === 'leave') return { ...base, state: 'reference', reliability: 'medium', currentness: 'current', scope_status: 'exact_entity', publication_eligibility: 'reference_only', kind: 'evidenced', status: 'confirmed', claim_count: 1, reference_ids: ['reference::record-1'], reference_count: 1, source_tiers: ['other_public_web'], limitation_codes: ['lower_tier_evidence'] }
  return { ...base, state: 'no_public_info', reliability: 'none', currentness: 'unknown', scope_status: 'unresolved', publication_eligibility: 'discovery_only', kind: 'insufficient_evidence', status: 'insufficient_evidence', claim_count: 0, limitation_codes: ['scope_limit', 'currentness_limit'], nonabsence_notice: '이번 조사에서 게시 가능한 공식 복지 근거를 확보하지 못했습니다. 복지가 없다는 뜻이 아닙니다.', reason_code: 'searched_not_found', searched_at: '2026-11-01T00:00:00Z' }
}

async function projectionFixture(run, populationSequences = 50) {
  const root = await mkdtemp(path.join(tmpdir(), 'benefits-projection-'))
  const version = 'approved-v2-test'
  const source = { source_id: 'source::reference', source_tier: 'other_public_web', title: 'Reference', url: 'https://reference.example/leave', retrieved_at: '2026-11-01T00:00:00Z', content_sha256: 'a'.repeat(64), reliability: 'medium', currentness: 'current', scope_status: 'exact_entity', scope: { countries: ['KR'], legal_entities: ['Test Co'], roles: [], employment_types: [] }, conflict_status: 'none', publication_eligibility: 'reference_only' }
  const sequences = typeof populationSequences === 'number' ? Array.from({ length: populationSequences }, (_, index) => index + 1) : populationSequences
  const companyCount = sequences.length
  const companies = []
  const details = new Map()
  for (const sequence of sequences) {
    const company_id = `KR-CRN-${String(sequence).padStart(13, '0')}`
    const reference_id = `reference::record-${sequence}`
    const outcomes = categories.map((category) => {
      const outcome = projectedOutcome(category)
      return category === 'leave' ? { ...outcome, reference_ids: [reference_id] } : outcome
    })
    companies.push({ company_id, population_sequence: sequence, legal_name: 'Test Co', display_name: 'Test Co', scope: 'domestic', jurisdiction: 'KR', incorporation_country: 'KR', registered_head_office_country: 'KR', selected_reporting_legal_entity: 'Test Co', sector: 'non_financial', category_outcomes: outcomes })
    const reference = { reference_id, cell_id: `cell::${company_id}::leave`, company_id, category_id: 'leave', source_id: source.source_id, source_tier: 'other_public_web', statement: 'Paid leave is reported.', supporting_quote: 'Paid leave', source_locator: source.url, reliability: 'medium', currentness: 'current', scope: { status: 'exact_entity', countries: ['KR'], legal_entities: ['Test Co'], roles: [], employment_types: [] }, conflict_status: 'none', publication_eligibility: 'reference_only', checked_at: '2026-11-01T00:00:00Z' }
    details.set(company_id, { schema_version: 1, artifact_kind: 'company_detail', artifact_protocol: 'vNext', data_version: version, taxonomy_version: 'benefit-taxonomy-v1', company: { company_id, population_sequence: sequence, legal_name: 'Test Co', scope: 'domestic', jurisdiction: 'KR', registry_id: String(sequence), selected_reporting_legal_entity: 'Test Co', incorporation_country: 'KR', registered_head_office_country: 'KR', financial_consolidation_parent: { kind: 'unknown', reason: 'unknown' }, ultimate_parent: { kind: 'unknown', reason: 'unknown' }, benefit_policy_owner: { kind: 'unknown', reason: 'unknown' }, sector: 'non_financial', employment_evidence_scope: '', employment_boundary_note: '' }, category_outcomes: outcomes, claims: [], official_claims: [], references: [reference], community_reports: [], sources: [source] })
  }
  try {
    const listing_chunks = []
    for (let offset = 0; offset < companies.length; offset += 50) {
      const rows = companies.slice(offset, offset + 50)
      const chunk_index = listing_chunks.length + 1
      const listing = await writeProjectionArtifact(root, version, `listings/companies-${String(chunk_index).padStart(2, '0')}.json`, { schema_version: 1, artifact_kind: 'company_listing_chunk', artifact_protocol: 'vNext', data_version: version, taxonomy_version: 'benefit-taxonomy-v1', chunk_index, sequence_start: rows[0].population_sequence, sequence_end: rows.at(-1).population_sequence, companies: rows }, rows.length)
      listing_chunks.push({ ...listing, chunk_index, first_sequence: rows[0].population_sequence, last_sequence: rows.at(-1).population_sequence })
    }
    const company_shards = {}
    for (const [company_id, detail] of details) company_shards[company_id] = { company_id, ...await writeProjectionArtifact(root, version, `companies/${company_id}.json`, detail, 1) }
    const sources = await writeProjectionArtifact(root, version, 'sources.json', { schema_version: 1, artifact_kind: 'company_benefits_sources', data_version: version, sources: [source] }, 1)
    const methodology = await writeProjectionArtifact(root, version, 'methodology.json', { schema_version: 1, artifact_kind: 'company_benefits_methodology', data_version: version, taxonomy_version: 'benefit-taxonomy-v1', title: 'Method', paragraphs: ['Method'] }, 1)
    const taxonomy = await writeProjectionArtifact(root, version, 'taxonomy.json', {}, 0)
    const projection = { data_version: version, projected_company_count: companyCount, cell_count: companyCount * 10, cell_state_counts: { official_verified: 0, reference: companyCount, community_report: 0, no_public_info: companyCount * 9 }, listing_chunks, company_shards, sources, methodology, taxonomy }
    const company_id = companies[0].company_id
    const baseById = new Map(companies.map((company) => [company.company_id, company]))
    const baseDetailById = new Map([...details].map(([id, detail]) => [id, structuredClone(detail.company)]))
    await run({ root, projection, company_id, detail: details.get(company_id), source, version, baseById, baseDetailById })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('projection verifier accepts a final partial listing chunk and rejects malformed chunk boundaries', () => projectionFixture(async ({ root, projection, version, baseById, baseDetailById }) => {
  await assert.doesNotReject(verifyApprovedV2Projection(root, projection, baseById, baseDetailById))
  const original = structuredClone(projection)
  const rewriteChunk = async (index, companies, metadata = {}) => {
    const descriptor = original.listing_chunks[index]
    const document = JSON.parse(await readFile(path.join(root, descriptor.url), 'utf8'))
    document.companies = companies
    document.sequence_start = metadata.sequence_start ?? companies[0]?.population_sequence ?? descriptor.first_sequence
    document.sequence_end = metadata.sequence_end ?? companies.at(-1)?.population_sequence ?? descriptor.last_sequence
    const rebound = await writeProjectionArtifact(root, version, `listings/companies-${String(index + 1).padStart(2, '0')}.json`, document, metadata.record_count ?? companies.length)
    projection.listing_chunks[index] = { ...rebound, chunk_index: index + 1, first_sequence: metadata.first_sequence ?? document.sequence_start, last_sequence: metadata.last_sequence ?? document.sequence_end }
  }
  const first = JSON.parse(await readFile(path.join(root, original.listing_chunks[0].url), 'utf8')).companies
  const final = JSON.parse(await readFile(path.join(root, original.listing_chunks[1].url), 'utf8')).companies
  const mutations = [
    async () => rewriteChunk(1, []),
    async () => rewriteChunk(1, [...final, ...first.slice(0, 26)]),
    async () => rewriteChunk(0, first.slice(0, 49)),
    async () => rewriteChunk(1, final.slice(1)),
    async () => rewriteChunk(1, [first.at(-1), ...final.slice(1)]),
    async () => rewriteChunk(1, [final[1], final[0], ...final.slice(2)]),
    async () => rewriteChunk(1, final, { record_count: 24 }),
  ]
  for (const mutate of mutations) {
    Object.assign(projection, structuredClone(original))
    await mutate()
    await assert.rejects(verifyApprovedV2Projection(root, projection, baseById, baseDetailById), /chunk|listing|sequence|count|canonical|duplicate|companies|array|expected/i)
  }
  Object.assign(projection, structuredClone(original), { projected_company_count: 74 })
  await assert.rejects(verifyApprovedV2Projection(root, projection, baseById, baseDetailById), /count/i)
}, 75))

test('projection verifier accepts sparse canonical sequences and binds truthful chunk descriptors', () => projectionFixture(async ({ root, projection, baseById, baseDetailById }) => {
  await assert.doesNotReject(verifyApprovedV2Projection(root, projection, baseById, baseDetailById))
  assert.deepEqual(projection.listing_chunks.map(({ record_count, first_sequence, last_sequence }) => ({ record_count, first_sequence, last_sequence })), [
    { record_count: 50, first_sequence: 1, last_sequence: 50 },
    { record_count: 25, first_sequence: 76, last_sequence: 100 },
  ])
}, [...Array.from({ length: 50 }, (_, index) => index + 1), ...Array.from({ length: 25 }, (_, index) => index + 76)]))

test('projection verifier rejects oversized descriptor byte counts before artifact reads', () => projectionFixture(async ({ root, projection, baseById, baseDetailById }) => {
  projection.taxonomy.byte_count = 100 * 1024 * 1024
  await assert.rejects(
    verifyApprovedV2Projection(root, projection, baseById, baseDetailById),
    /byte count exceeds.*limit/i,
  )
}))

for (const [name, mutate] of [
  ['projection company sequence changed while descriptor is rebound', (chunks) => { chunks[1][0].population_sequence = 75 }],
  ['company IDs are swapped without their canonical sequences', (chunks) => { [chunks[1][0].company_id, chunks[1][1].company_id] = [chunks[1][1].company_id, chunks[1][0].company_id] }],
  ['company is duplicated across chunks', (chunks) => { chunks[1][0] = structuredClone(chunks[0][49]) }],
  ['pending company is inserted with a correct-looking canonical sequence', (chunks) => { chunks[1][0] = { ...structuredClone(chunks[1][0]), company_id: 'KR-CRN-0000000000051', population_sequence: 51 } }],
  ['sparse canonical sequences are reordered', (chunks) => { [chunks[1][0], chunks[1][1]] = [chunks[1][1], chunks[1][0]] }],
]) {
  test(`projection verifier rejects ${name}`, () => projectionFixture(async ({ root, projection, version, baseById, baseDetailById }) => {
    const chunks = await Promise.all(projection.listing_chunks.map(async (entry) => JSON.parse(await readFile(path.join(root, entry.url), 'utf8')).companies))
    mutate(chunks)
    for (const [index, companies] of chunks.entries()) {
      const document = JSON.parse(await readFile(path.join(root, projection.listing_chunks[index].url), 'utf8'))
      document.companies = companies
      document.sequence_start = companies[0].population_sequence
      document.sequence_end = companies.at(-1).population_sequence
      const rebound = await writeProjectionArtifact(root, version, `listings/companies-${String(index + 1).padStart(2, '0')}.json`, document, companies.length)
      projection.listing_chunks[index] = { ...rebound, chunk_index: index + 1, first_sequence: document.sequence_start, last_sequence: document.sequence_end }
    }
    await assert.rejects(verifyApprovedV2Projection(root, projection, baseById, baseDetailById), /chunk|listing|sequence|canonical|duplicate|company|shard/i)
  }, [...Array.from({ length: 50 }, (_, index) => index + 1), ...Array.from({ length: 25 }, (_, index) => index + 76)]))
}

test('projection verifier rejects cross-company and bogus-cell evidence after descriptor rebinding', () => projectionFixture(async ({ root, projection, company_id, detail, version, baseById, baseDetailById }) => {
  await assert.doesNotReject(verifyApprovedV2Projection(root, projection, baseById, baseDetailById))
  const mutated = structuredClone(detail)
  mutated.references[0].company_id = 'KR-CRN-0000000000002'
  mutated.references[0].cell_id = 'cell::KR-CRN-0000000000002::leave'
  const rebound = await writeProjectionArtifact(root, version, `companies/${company_id}.json`, mutated, 1)
  projection.company_shards[company_id] = { company_id, ...rebound }
  await assert.rejects(verifyApprovedV2Projection(root, projection, baseById, baseDetailById), /company|cell|binding/i)
}))

test('projection verifier rejects listing and full base-detail identity drift after descriptor rebinding', () => projectionFixture(async ({ root, projection, company_id, detail, version, baseById, baseDetailById }) => {
  const listingDescriptor = projection.listing_chunks[0]
  const listing = JSON.parse(await readFile(path.join(root, listingDescriptor.url), 'utf8'))
  listing.companies[0].legal_name = 'Rebound Listing Name'
  const reboundListing = await writeProjectionArtifact(root, version, 'listings/companies-01.json', listing, listing.companies.length)
  projection.listing_chunks[0] = { ...listingDescriptor, ...reboundListing }
  await assert.rejects(verifyApprovedV2Projection(root, projection, baseById, baseDetailById), /identity/i)

  listing.companies[0] = structuredClone(baseById.get(company_id))
  const restoredListing = await writeProjectionArtifact(root, version, 'listings/companies-01.json', listing, listing.companies.length)
  projection.listing_chunks[0] = { ...listingDescriptor, ...restoredListing }
  const mutatedDetail = structuredClone(detail)
  mutatedDetail.company.registry_id = 'rebound-detail-only-registry'
  const reboundDetail = await writeProjectionArtifact(root, version, `companies/${company_id}.json`, mutatedDetail, 1)
  projection.company_shards[company_id] = { company_id, ...reboundDetail }
  await assert.rejects(verifyApprovedV2Projection(root, projection, baseById, baseDetailById), /identity/i)
}))

test('projection evidence IDs are globally unique across company shards', () => {
  const first = { company: { company_id: 'KR-CRN-0000000000001' }, claims: [{ claim_id: 'claim::shared' }], official_claims: [], references: [{ reference_id: 'reference::shared' }], community_reports: [{ community_report_id: 'community::shared' }] }
  const second = { company: { company_id: 'KR-CRN-0000000000002' }, claims: [{ claim_id: 'claim::other' }], official_claims: [], references: [{ reference_id: 'reference::other' }], community_reports: [{ community_report_id: 'community::other' }] }
  assert.doesNotThrow(() => assertUniqueProjectionEvidenceIds([first, second]))
  for (const [collection, idField] of [['claims', 'claim_id'], ['references', 'reference_id'], ['community_reports', 'community_report_id']]) {
    const replayed = structuredClone(second)
    replayed[collection][0][idField] = first[collection][0][idField]
    assert.throws(() => assertUniqueProjectionEvidenceIds([first, replayed]), new RegExp(`duplicate ${idField}`))
  }
})

test('projection verifier rejects a cross-company reference ID replay after descriptor rebinding', () => projectionFixture(async ({ root, projection, version, baseById, baseDetailById }) => {
  const [firstId, secondId] = Object.keys(projection.company_shards).slice(0, 2)
  const firstDescriptor = projection.company_shards[firstId]
  const secondDescriptor = projection.company_shards[secondId]
  const first = JSON.parse(await readFile(path.join(root, firstDescriptor.url), 'utf8'))
  const second = JSON.parse(await readFile(path.join(root, secondDescriptor.url), 'utf8'))
  second.references[0].reference_id = first.references[0].reference_id
  second.category_outcomes[0].reference_ids = [first.references[0].reference_id]
  projection.company_shards[secondId] = { company_id: secondId, ...await writeProjectionArtifact(root, version, `companies/${secondId}.json`, second, 1) }

  const listingDescriptor = projection.listing_chunks[0]
  const listing = JSON.parse(await readFile(path.join(root, listingDescriptor.url), 'utf8'))
  listing.companies.find((company) => company.company_id === secondId).category_outcomes = second.category_outcomes
  const reboundListing = await writeProjectionArtifact(root, version, 'listings/companies-01.json', listing, listing.companies.length)
  projection.listing_chunks[0] = { ...listingDescriptor, ...reboundListing }
  await assert.rejects(verifyApprovedV2Projection(root, projection, baseById, baseDetailById), /duplicate reference_id/i)
}))

test('projection verifier requires exact unique global source closure', () => projectionFixture(async ({ root, projection, source, version, baseById, baseDetailById }) => {
  const base = { schema_version: 1, artifact_kind: 'company_benefits_sources', data_version: version }
  for (const inventory of [[], [source, source], [source, { ...source, source_id: 'source::orphan' }]]) {
    projection.sources = await writeProjectionArtifact(root, version, 'sources.json', { ...base, sources: inventory }, inventory.length)
    await assert.rejects(verifyApprovedV2Projection(root, projection, baseById, baseDetailById), /source|record_count|duplicate|inventory/i)
  }
  for (const document of [{ ...base, schema_version: 2, sources: [source] }, { ...base, data_version: 'other-version', sources: [source] }]) {
    projection.sources = await writeProjectionArtifact(root, version, 'sources.json', document, 1)
    await assert.rejects(verifyApprovedV2Projection(root, projection, baseById, baseDetailById), /source|version|schema/i)
  }
  projection.sources = await writeProjectionArtifact(root, version, 'sources.json', { ...base, sources: [source] }, 2)
  await assert.rejects(verifyApprovedV2Projection(root, projection, baseById, baseDetailById), /source|record_count|inventory/i)
}))
