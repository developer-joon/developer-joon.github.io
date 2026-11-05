import { expect, it } from 'vitest'
import { approvedV2ListingChunkSchema, assertCompanyDetailEvidence, categories, claimSchema, detailSchema, listingChunkSchema, manifestSchema, sourcesDocumentSchema, vNextCategoryOutcomeSchema as categoryOutcomeSchema, type CompanyListing, type Detail } from './benefits'

function validManifest() {
  const descriptor = { url: 'community/data/company-benefits/v2/taxonomy.json', sha256: 'a'.repeat(64), record_count: 10, byte_count: 100 }
  return {
    schema_version: 2,
    artifact_kind: 'company_benefits_manifest',
    artifact_protocol: 'vNext',
    data_version: 'v2',
    fixture: false,
    generated_at: '2026-10-31T00:00:00Z',
    protocol: { protocol_id: 'company-benefits-population-v4', protocol_version: '4.0.0', protocol_sha256: 'b'.repeat(64), effective_selection_sha256: 'c'.repeat(64) },
    taxonomy_version: 'benefit-taxonomy-v1', company_count: 2000, listing_chunk_size: 50, listing_chunk_count: 40, category_count: 10,
    cell_count: 20000,
    cell_state_counts: { official_verified: 1, reference: 2, community_report: 3, no_public_info: 19994 },
    ledger_sha256: Object.fromEntries(['company-category-cells.jsonl', 'research-attempts.jsonl', 'official-claims-v2.jsonl', 'reference-records.jsonl', 'community-benefit-reports.jsonl', 'sources-v2.jsonl'].map((name, index) => [name, String(index).repeat(64)])),
    taxonomy: descriptor, sources: { ...descriptor, url: 'community/data/company-benefits/v2/sources.json' }, methodology: { ...descriptor, url: 'community/data/company-benefits/v2/methodology.json' },
    listing_chunks: Array.from({ length: 40 }, (_, i) => ({ ...descriptor, url: `community/data/company-benefits/v2/listings/companies-${String(i + 1).padStart(2, '0')}.json`, chunk_index: i + 1, first_sequence: i * 50 + 1, last_sequence: i * 50 + 50, record_count: 50 })),
    company_shards: Object.fromEntries(Array.from({ length: 2000 }, (_, i) => { const id = `KR-CRN-${String(i + 1).padStart(13, '0')}`; return [id, { ...descriptor, url: `community/data/company-benefits/v2/companies/${id}.json`, company_id: id, record_count: 1 }] })),
  }
}

function validV1Manifest() {
  const manifest: Partial<ReturnType<typeof validManifest>> = validManifest()
  manifest.artifact_protocol = 'v1'
  delete manifest.cell_count
  delete manifest.cell_state_counts
  delete manifest.ledger_sha256
  return manifest as Omit<ReturnType<typeof validManifest>, 'cell_count' | 'cell_state_counts' | 'ledger_sha256'> & { artifact_protocol: 'v1' }
}

it('accepts all four explicit cell states and rejects not_researched', () => {
  const base = { category_id: 'leave', currentness: 'current', scope_status: 'exact_entity', conflict_status: 'none', assessed_at: '2026-11-01T00:00:00Z', source_tiers: [], official_claim_ids: [], reference_ids: [], community_report_ids: [], official_claim_count: 0, reference_count: 0, community_report_count: 0, kind: 'evidenced', status: 'confirmed', claim_count: 1, benefit_type_count: 0, scope: { countries: [], legal_entities: [], roles: [], employment_types: [], tenure_conditions: [] }, limitation_codes: [], last_checked_at: '2026-11-01T00:00:00Z', searched_source_ids: [] }
  const outcomes = [
    { ...base, state: 'official_verified', source_tiers: ['official_government', 'other_public_web', 'user_submission'], reliability: 'high', publication_eligibility: 'official_claim', official_claim_ids: ['official::' + 'a'.repeat(64)], reference_ids: ['reference::retained'], community_report_ids: ['community::retained'], official_claim_count: 1, reference_count: 1, community_report_count: 1, claim_count: 3 },
    { ...base, state: 'reference', source_tiers: ['other_public_web'], reliability: 'medium', publication_eligibility: 'reference_only', reference_ids: ['reference::record-1'], reference_count: 1, limitation_codes: ['lower_tier_evidence'] },
    { ...base, state: 'community_report', source_tiers: ['user_submission'], reliability: 'low', publication_eligibility: 'community_only', community_report_ids: ['community::report-1'], community_report_count: 1, status: 'bounded', limitation_codes: ['lower_tier_evidence'] },
    { ...base, state: 'no_public_info', reliability: 'none', currentness: 'unknown', scope_status: 'unresolved', publication_eligibility: 'discovery_only', kind: 'insufficient_evidence', status: 'insufficient_evidence', claim_count: 0, benefit_type_count: 0, limitation_codes: ['scope_limit', 'currentness_limit'], nonabsence_notice: '이번 조사에서 게시 가능한 공식 복지 근거를 확보하지 못했습니다. 복지가 없다는 뜻이 아닙니다.', reason_code: 'searched_not_found', searched_source_ids: [], searched_at: '2026-11-01T00:00:00Z' },
  ]
  outcomes.forEach((outcome) => expect(categoryOutcomeSchema.safeParse(outcome).success).toBe(true))
  expect(categoryOutcomeSchema.safeParse({ ...base, state: 'not_researched' }).success).toBe(false)
})

it('requires an explicit protocol and rejects contradictory derived outcome projections', () => {
  const manifest = validManifest()
  expect(manifestSchema.safeParse({ ...manifest, artifact_protocol: undefined }).success).toBe(false)
  for (const field of ['cell_count', 'cell_state_counts', 'ledger_sha256'] as const) {
    const invalid = { ...manifest }
    delete invalid[field]
    expect(manifestSchema.safeParse(invalid).success).toBe(false)
  }
  const official = { category_id: 'leave', state: 'official_verified', source_tiers: ['official_government'], reliability: 'high', currentness: 'current', scope_status: 'exact_entity', conflict_status: 'none', publication_eligibility: 'official_claim', assessed_at: '2026-11-01T00:00:00Z', official_claim_ids: ['official::' + 'a'.repeat(64)], reference_ids: [], community_report_ids: [], official_claim_count: 1, reference_count: 0, community_report_count: 0, kind: 'evidenced', status: 'confirmed', claim_count: 1, benefit_type_count: 0, scope: { countries: [], legal_entities: [], roles: [], employment_types: [], tenure_conditions: [] }, limitation_codes: [], last_checked_at: '2026-11-01T00:00:00Z', searched_source_ids: [] }
  expect(categoryOutcomeSchema.safeParse({ ...official, claim_count: 0 }).success).toBe(false)
  expect(categoryOutcomeSchema.safeParse({ ...official, kind: 'insufficient_evidence', reason_code: 'searched_not_found', searched_source_ids: [], searched_at: official.assessed_at }).success).toBe(false)
  expect(categoryOutcomeSchema.safeParse({ ...official, official_claim_ids: [official.official_claim_ids[0], official.official_claim_ids[0]], claim_count: 2 }).success).toBe(false)
  expect(categoryOutcomeSchema.safeParse({ ...official, limitation_codes: ['lower_tier_evidence'] }).success).toBe(false)
  expect(categoryOutcomeSchema.safeParse({ ...official, limitation_codes: ['scope_limit', 'scope_limit'] }).success).toBe(false)
})

it('requires exact searched-source closure in company details', () => {
  const insufficient = { category_id: 'leave', state: 'no_public_info', source_tiers: [], reliability: 'none', currentness: 'unknown', scope_status: 'unresolved', conflict_status: 'none', publication_eligibility: 'discovery_only', assessed_at: '2026-11-01T00:00:00Z', official_claim_ids: [], reference_ids: [], community_report_ids: [], official_claim_count: 0, reference_count: 0, community_report_count: 0, kind: 'insufficient_evidence', status: 'insufficient_evidence', claim_count: 0, benefit_type_count: 0, scope: { countries: [], legal_entities: [], roles: [], employment_types: [], tenure_conditions: [] }, limitation_codes: ['scope_limit', 'currentness_limit'], last_checked_at: '2026-11-01T00:00:00Z', nonabsence_notice: '이번 조사에서 게시 가능한 공식 복지 근거를 확보하지 못했습니다. 복지가 없다는 뜻이 아닙니다.', reason_code: 'searched_not_found', searched_source_ids: ['source::searched'], searched_at: '2026-11-01T00:00:00Z' } as const
  const detail = {
    schema_version: 1, artifact_kind: 'company_detail', artifact_protocol: 'vNext', data_version: 'v2', taxonomy_version: 'benefit-taxonomy-v1',
    company: { company_id: 'KR-CRN-0000000000001', population_sequence: 1, legal_name: 'Search Co', scope: 'domestic', jurisdiction: 'KR', registry_id: '1', selected_reporting_legal_entity: 'Search Co', incorporation_country: 'KR', registered_head_office_country: 'KR', financial_consolidation_parent: { kind: 'unknown', reason: 'unknown' }, ultimate_parent: { kind: 'unknown', reason: 'unknown' }, benefit_policy_owner: { kind: 'unknown', reason: 'unknown' }, sector: 'non_financial', employment_evidence_scope: '', employment_boundary_note: '' },
    category_outcomes: Array.from({ length: 10 }, (_, index) => ({ ...insufficient, category_id: ['leave','family','health','growth','housing','commute','remote','retirement','meals','inclusion'][index], searched_source_ids: index ? [] : insufficient.searched_source_ids })),
    claims: [], official_claims: [], references: [], community_reports: [], sources: [],
  } as const
  expect(detailSchema.safeParse(detail).success).toBe(false)
})

it('accepts schema v2 and rejects ranking semantics', () => {
  const manifest = validManifest()
  expect(manifestSchema.parse(manifest).fixture).toBe(false)
  expect(manifestSchema.safeParse({ ...manifest, rankings_url: '/x' }).success).toBe(false)
})

it('accepts an additive approved-v2 checkpoint without relabeling the active v1 lineage', () => {
  const manifest = validV1Manifest()
  const sparseBounds = [
    [1, 50], [51, 100], [101, 150], [151, 200], [201, 250], [251, 300], [301, 350], [351, 400], [401, 450], [451, 500],
    [501, 575], [576, 625], [626, 675], [676, 725], [726, 800], [801, 850], [851, 900], [901, 950], [951, 1000],
  ]
  const projection = {
    projection_kind: 'approved_v2_additive', projection_status: 'in_progress',
    base_data_version: manifest.data_version, base_manifest_sha256: 'f'.repeat(64), data_version: 'approved-v2-checkpoint-38',
    approved_batch_count: 38, total_batch_count: 80, projected_company_count: 950,
    total_company_count: 2000, cell_count: 9500,
    cell_state_counts: { official_verified: 142, reference: 1811, community_report: 49, no_public_info: 7498 },
    listing_chunk_size: 50, listing_chunk_count: 19,
    ledger_sha256: validManifest().ledger_sha256,
    taxonomy: { ...manifest.taxonomy, url: 'community/data/company-benefits/approved-v2-checkpoint-38/taxonomy.json' },
    sources: { ...manifest.sources, url: 'community/data/company-benefits/approved-v2-checkpoint-38/sources.json' },
    methodology: { ...manifest.methodology, url: 'community/data/company-benefits/approved-v2-checkpoint-38/methodology.json' },
    listing_chunks: Array.from({ length: 19 }, (_, i) => {
      const [first_sequence, last_sequence] = sparseBounds[i]
      return { ...manifest.taxonomy, url: `community/data/company-benefits/approved-v2-checkpoint-38/listings/companies-${String(i + 1).padStart(2, '0')}.json`, chunk_index: i + 1, first_sequence, last_sequence, record_count: 50 }
    }),
    company_shards: Object.fromEntries(Object.entries(manifest.company_shards).slice(0, 950).map(([id, value]) => [id, { ...value, url: `community/data/company-benefits/approved-v2-checkpoint-38/companies/${id}.json` }])),
  }
  expect(manifestSchema.safeParse({ ...manifest, approved_v2_projection: projection }).success).toBe(true)
  expect(manifestSchema.safeParse({ ...manifest, artifact_protocol: 'vNext', approved_v2_projection: projection }).success).toBe(false)
  expect(manifestSchema.safeParse({ ...manifest, approved_v2_projection: { ...projection, base_data_version: 'other' } }).success).toBe(false)
  expect(manifestSchema.safeParse({ ...manifest, approved_v2_projection: { ...projection, cell_count: 9499 } }).success).toBe(false)

  const overlapping = structuredClone(projection)
  overlapping.listing_chunks[11].first_sequence = overlapping.listing_chunks[10].last_sequence
  expect(manifestSchema.safeParse({ ...manifest, approved_v2_projection: overlapping }).success).toBe(false)

  const reversed = structuredClone(projection)
  reversed.listing_chunks[10].last_sequence = reversed.listing_chunks[10].first_sequence - 1
  expect(manifestSchema.safeParse({ ...manifest, approved_v2_projection: reversed }).success).toBe(false)
})

it('accepts a 39-batch projection descriptor inventory with one final 25-company chunk', () => {
  const manifest = validV1Manifest()
  const dataVersion = 'approved-v2-checkpoint-39'
  const projection = {
    projection_kind: 'approved_v2_additive', projection_status: 'in_progress',
    base_data_version: manifest.data_version, base_manifest_sha256: 'f'.repeat(64), data_version: dataVersion,
    approved_batch_count: 39, total_batch_count: 80, projected_company_count: 975,
    total_company_count: 2000, cell_count: 9750,
    cell_state_counts: { official_verified: 0, reference: 0, community_report: 0, no_public_info: 9750 },
    listing_chunk_size: 50, listing_chunk_count: 20,
    ledger_sha256: validManifest().ledger_sha256,
    taxonomy: { ...manifest.taxonomy, url: `community/data/company-benefits/${dataVersion}/taxonomy.json` },
    sources: { ...manifest.sources, url: `community/data/company-benefits/${dataVersion}/sources.json` },
    methodology: { ...manifest.methodology, url: `community/data/company-benefits/${dataVersion}/methodology.json` },
    listing_chunks: Array.from({ length: 20 }, (_, index) => {
      const record_count = index === 19 ? 25 : 50
      const first_sequence = index <= 10 ? index * 50 + 1 : index * 50 + 26
      const last_sequence = index < 10 ? index * 50 + 50 : index === 10 ? 575 : index === 19 ? 1000 : index * 50 + 75
      return { ...manifest.taxonomy, url: `community/data/company-benefits/${dataVersion}/listings/companies-${String(index + 1).padStart(2, '0')}.json`, chunk_index: index + 1, first_sequence, last_sequence, record_count }
    }),
    company_shards: Object.fromEntries(Object.entries(manifest.company_shards).slice(0, 975).map(([id, value]) => [id, { ...value, url: `community/data/company-benefits/${dataVersion}/companies/${id}.json` }])),
  }
  expect(manifestSchema.safeParse({ ...manifest, approved_v2_projection: projection }).success).toBe(true)
  for (const mutation of [
    { index: 19, values: { record_count: 0, last_sequence: 950 } },
    { index: 19, values: { record_count: 51, last_sequence: 1001 } },
    { index: 0, values: { record_count: 49, last_sequence: 49 } },
    { index: 1, values: { first_sequence: 50, last_sequence: 100 } },
  ]) {
    const invalid = structuredClone(projection)
    Object.assign(invalid.listing_chunks[mutation.index], mutation.values)
    expect(manifestSchema.safeParse({ ...manifest, approved_v2_projection: invalid }).success).toBe(false)
  }
})

it.each([
  '/community/data/company-benefits/v2/taxonomy.json',
  'community/data/company-benefits/v2/../taxonomy.json',
  'community/data/company-benefits/v2/./taxonomy.json',
  'community\\data\\company-benefits\\v2\\taxonomy.json',
  'community/data/company-benefits/v2/%2e%2e/taxonomy.json',
  'community/data/company-benefits/v2/%2Ftaxonomy.json',
  'community/data/company-benefits/v2/taxonomy.json?download=1',
  'community/data/company-benefits/v2/taxonomy.json#fragment',
  'community/data/company-benefits/other/taxonomy.json',
  'community/data/company-benefits/v2/companies/taxonomy.json',
])('rejects a non-canonical or role-inconsistent descriptor path: %s', (url) => {
  const manifest = validManifest()
  manifest.taxonomy = { ...manifest.taxonomy, url }
  expect(manifestSchema.safeParse(manifest).success).toBe(false)
})

it('rejects duplicate descriptor aliases across roles', () => {
  const manifest = validManifest()
  manifest.sources = { ...manifest.sources, url: manifest.taxonomy.url }
  expect(manifestSchema.safeParse(manifest).success).toBe(false)
})

it('rejects listing and shard filenames inconsistent with descriptor identity', () => {
  const listingMutation = validManifest()
  listingMutation.listing_chunks[0].url = 'community/data/company-benefits/v2/listings/companies-02.json'
  expect(manifestSchema.safeParse(listingMutation).success).toBe(false)

  const shardMutation = validManifest()
  shardMutation.company_shards['KR-CRN-0000000000001'].url = 'community/data/company-benefits/v2/companies/KR-CRN-0000000000002.json'
  expect(manifestSchema.safeParse(shardMutation).success).toBe(false)
})

it('accepts public claims without internal review diagnostics and rejects leaked review fields', () => {
  const claim = {
    claim_id: 'claim-1', benefit_type_ids: ['paid-leave'], category_ids: ['leave'],
    benefit_name: 'Paid leave', detail: 'Employees receive paid leave.', research_status: 'confirmed',
    current_validity: 'current', evidence_grade: 'A',
    application_scope: { countries: ['KR'], legal_entities: ['Example Co.'], roles: ['all'], employment_types: ['full_time'], tenure_condition: 'none' },
    limitation_codes: [], publication_date: '2026-01-01', checked_at: '2026-10-30T02:00:00Z',
    source_evidence: [{
      source_id: 'source-1', role: 'primary_claim_evidence', proposition: 'Employees receive paid leave.',
      source_locator: 'benefits', supporting_quote: 'Employees receive paid leave.', content_sha256: 'a'.repeat(64),
      source: { title: 'Official benefits', owner: 'Example Co.', source_type: 'official_company_report', jurisdiction: 'KR', url: 'https://example.com/benefits', final_owner_domain: 'example.com', publication_date: '2026-01-01', checked_at: '2026-10-30T02:00:00Z', evidence_eligibility: 'A' },
    }],
  } as const
  expect(claimSchema.safeParse(claim).success).toBe(true)
  expect(claimSchema.safeParse({ ...claim, review: { review_id: 'internal-review-1' } }).success).toBe(false)
})

const task7Scope = { countries: ['KR'], legal_entities: ['Test Co'], roles: [], employment_types: [], tenure_conditions: [] }
const task7Official = {
  category_id: 'leave', state: 'official_verified', source_tiers: ['official_government'],
  official_claim_ids: ['official::claim-1'], reference_ids: [], community_report_ids: [],
  official_claim_count: 1, reference_count: 0, community_report_count: 0,
  reliability: 'high', currentness: 'current', scope_status: 'exact_entity', conflict_status: 'none',
  publication_eligibility: 'official_claim', scope: task7Scope, assessed_at: '2026-11-01T00:00:00Z', last_checked_at: '2026-11-01T00:00:00Z',
  kind: 'evidenced', status: 'confirmed', claim_count: 1, benefit_type_count: 1, limitation_codes: [], searched_source_ids: [],
} as const

it('retains lower-tier records while enforcing state precedence and exact counts', () => {
  const official = {
    ...task7Official, source_tiers: ['official_government', 'other_public_web', 'user_submission'],
    reference_ids: ['reference::record-1'], community_report_ids: ['community::report-1'],
    reference_count: 1, community_report_count: 1, claim_count: 3,
  }
  expect(categoryOutcomeSchema.parse(official)).toMatchObject({ official_claim_count: 1, reference_count: 1, community_report_count: 1 })

  const reference = {
    ...task7Official, state: 'reference', source_tiers: ['other_public_web', 'user_submission'], official_claim_ids: [], official_claim_count: 0,
    reference_ids: ['reference::record-1'], reference_count: 1, community_report_ids: ['community::report-1'], community_report_count: 1,
    reliability: 'medium', scope_status: 'bounded_entity', publication_eligibility: 'reference_only', status: 'bounded', claim_count: 2,
    limitation_codes: ['scope_limit', 'lower_tier_evidence'],
  }
  expect(categoryOutcomeSchema.safeParse(reference).success).toBe(true)
})

it.each(['exact_entity', 'bounded_entity', 'group_only', 'unresolved'] as const)(
  'accepts no-public-info with authoritative scope status: %s',
  (scope_status) => {
    const outcome = {
      ...task7Official, state: 'no_public_info', source_tiers: [], official_claim_ids: [], official_claim_count: 0,
      reliability: 'none', currentness: 'unknown', scope_status, publication_eligibility: 'discovery_only',
      kind: 'insufficient_evidence', status: 'insufficient_evidence', claim_count: 0, benefit_type_count: 0,
      limitation_codes: scope_status === 'exact_entity' ? ['currentness_limit'] : ['scope_limit', 'currentness_limit'],
      nonabsence_notice: '이번 조사에서 게시 가능한 공식 복지 근거를 확보하지 못했습니다. 복지가 없다는 뜻이 아닙니다.',
      reason_code: 'searched_not_found', searched_at: '2026-11-01T00:00:00Z',
    }
    expect(categoryOutcomeSchema.safeParse(outcome).success).toBe(true)
  },
)

it.each([
  ['official reliability', { ...task7Official, reliability: 'low' }],
  ['official scope', { ...task7Official, scope_status: 'group_only', status: 'bounded', limitation_codes: ['scope_limit'] }],
  ['reference reliability', { ...task7Official, state: 'reference', source_tiers: ['other_public_web'], official_claim_ids: [], official_claim_count: 0, reference_ids: ['reference::record-1'], reference_count: 1, reliability: 'high', publication_eligibility: 'reference_only', limitation_codes: ['lower_tier_evidence'] }],
  ['community source', { ...task7Official, state: 'community_report', source_tiers: ['other_public_web'], official_claim_ids: [], official_claim_count: 0, community_report_ids: ['community::report-1'], community_report_count: 1, reliability: 'low', publication_eligibility: 'community_only', limitation_codes: ['lower_tier_evidence'] }],
])('rejects malformed company-category state: %s', (_name, outcome) => {
  expect(categoryOutcomeSchema.safeParse(outcome).success).toBe(false)
})

function task7Outcome(category_id: (typeof categories)[number]) {
  if (category_id === 'leave') return { ...task7Official, category_id }
  return {
    ...task7Official, category_id, state: 'no_public_info', source_tiers: [], official_claim_ids: [], official_claim_count: 0,
    reliability: 'none', currentness: 'unknown', scope_status: 'unresolved', publication_eligibility: 'discovery_only',
    kind: 'insufficient_evidence', status: 'insufficient_evidence', claim_count: 0, benefit_type_count: 0,
    limitation_codes: ['scope_limit', 'currentness_limit'], nonabsence_notice: '이번 조사에서 게시 가능한 공식 복지 근거를 확보하지 못했습니다. 복지가 없다는 뜻이 아닙니다.',
    reason_code: 'searched_not_found', searched_at: '2026-11-01T00:00:00Z',
  }
}

it('scopes partial listing chunks to the additive approved-v2 projection schema', () => {
  const companies = Array.from({ length: 25 }, (_, index) => ({
    company_id: `KR-CRN-${String(index + 1).padStart(13, '0')}`,
    population_sequence: 951 + index,
    legal_name: `Company ${index + 1}`,
    display_name: `Company ${index + 1}`,
    scope: 'domestic', jurisdiction: 'KR', incorporation_country: 'KR', registered_head_office_country: 'KR',
    selected_reporting_legal_entity: `Company ${index + 1}`, sector: 'non_financial',
    category_outcomes: categories.map(task7Outcome),
  }))
  const chunk = { schema_version: 1, artifact_kind: 'company_listing_chunk', artifact_protocol: 'vNext', data_version: 'approved-v2-checkpoint-39', taxonomy_version: 'benefit-taxonomy-v1', chunk_index: 20, sequence_start: 951, sequence_end: 975, companies }
  expect(approvedV2ListingChunkSchema.safeParse(chunk).success).toBe(true)
  expect(listingChunkSchema.safeParse(chunk).success).toBe(false)
})

function vNextDetailWithReference() {
  const company_id = 'KR-CRN-0000000000001'
  const category_outcomes = categories.map((category_id) => category_id === 'leave' ? {
    ...task7Official, category_id, state: 'reference', source_tiers: ['other_public_web'],
    official_claim_ids: [], official_claim_count: 0, reference_ids: ['reference::record-1'], reference_count: 1,
    reliability: 'medium', publication_eligibility: 'reference_only', limitation_codes: ['lower_tier_evidence'],
  } : task7Outcome(category_id))
  return {
    schema_version: 1, artifact_kind: 'company_detail', artifact_protocol: 'vNext', data_version: 'v2', taxonomy_version: 'benefit-taxonomy-v1',
    company: { company_id, population_sequence: 1, legal_name: 'Test Co', scope: 'domestic', jurisdiction: 'KR', registry_id: '1', selected_reporting_legal_entity: 'Test Co', incorporation_country: 'KR', registered_head_office_country: 'KR', financial_consolidation_parent: { kind: 'unknown', reason: 'unknown' }, ultimate_parent: { kind: 'unknown', reason: 'unknown' }, benefit_policy_owner: { kind: 'unknown', reason: 'unknown' }, sector: 'non_financial', employment_evidence_scope: '', employment_boundary_note: '' },
    category_outcomes, claims: [], official_claims: [],
    references: [{ reference_id: 'reference::record-1', cell_id: `cell::${company_id}::leave`, company_id, category_id: 'leave', source_id: 'source::reference', source_tier: 'other_public_web', statement: 'Paid leave is reported.', supporting_quote: 'Paid leave', source_locator: 'https://reference.example/leave', reliability: 'medium', currentness: 'current', scope: { status: 'exact_entity', countries: ['KR'], legal_entities: ['Test Co'], roles: [], employment_types: [] }, conflict_status: 'none', publication_eligibility: 'reference_only', checked_at: '2026-11-01T00:00:00Z' }],
    community_reports: [],
    sources: [{ source_id: 'source::reference', source_tier: 'other_public_web', title: 'Reference', url: 'https://reference.example/leave', retrieved_at: '2026-11-01T00:00:00Z', content_sha256: 'a'.repeat(64), reliability: 'medium', currentness: 'current', scope_status: 'exact_entity', scope: { countries: ['KR'], legal_entities: ['Test Co'], roles: [], employment_types: [] }, conflict_status: 'none', publication_eligibility: 'reference_only' }],
  }
}

function vNextDetailWithOfficial(
  outcome: { reliability: 'high' | 'medium'; currentness: 'current' | 'historical' | 'unknown' },
  source: { reliability: 'high' | 'medium' | 'low' | 'unrated'; currentness: 'current' | 'historical' | 'unknown' },
) {
  const detail = vNextDetailWithReference()
  const claimId = `official::${'a'.repeat(64)}`
  detail.references = []
  Object.assign(detail.category_outcomes[0], task7Official, outcome, {
    official_claim_ids: [claimId],
    limitation_codes: outcome.currentness === 'current' ? [] : ['currentness_limit'],
  })
  Object.assign(detail, {
    official_claims: [{
      claim_id: claimId,
      cell_id: `cell::${detail.company.company_id}::leave`,
      company_id: detail.company.company_id,
      category_id: 'leave',
      jurisdiction: 'KR',
      source_ids: ['source::reference'],
      source_tier: 'official_government',
      scope_status: 'exact_entity',
      scope: detail.sources[0].scope,
      conflict_status: 'none',
      publication_eligibility: 'eligible',
    }],
  })
  Object.assign(detail.sources[0], source, {
    source_tier: 'official_government',
    publication_eligibility: 'eligible',
  })
  return detail
}

it.each([
  'http://reference.example/leave',
  'javascript:alert(1)',
  'data:text/html,unsafe',
  'https://user:password@reference.example/leave',
])('rejects unsafe approved-v2 public source URL: %s', (url) => {
  const detail = vNextDetailWithReference()
  detail.sources[0].url = url
  expect(detailSchema.safeParse(detail).success).toBe(false)

  const inventory = {
    schema_version: 1,
    artifact_kind: 'company_benefits_sources',
    data_version: 'approved-v2-checkpoint-39',
    sources: detail.sources,
  }
  expect(sourcesDocumentSchema.safeParse(inventory).success).toBe(false)
})

it('rejects v2 evidence bound to another company or a noncanonical cell', () => {
  const valid = vNextDetailWithReference()
  expect(detailSchema.safeParse(valid).success).toBe(true)
  expect(detailSchema.safeParse({ ...valid, references: [{ ...valid.references[0], company_id: 'KR-CRN-0000000000002' }] }).success).toBe(false)
  expect(detailSchema.safeParse({ ...valid, references: [{ ...valid.references[0], cell_id: 'cell::KR-CRN-0000000000002::leave' }] }).success).toBe(false)
})

it('fails closed when projected evidence or its bound source is not publication eligible', () => {
  const valid = vNextDetailWithReference()
  expect(detailSchema.safeParse(valid).success).toBe(true)

  const ineligibleRecord = structuredClone(valid)
  ineligibleRecord.references[0].publication_eligibility = 'ineligible'
  expect(detailSchema.safeParse(ineligibleRecord).success).toBe(false)

  for (const publication_eligibility of ['discovery_only', 'ineligible'] as const) {
    const ineligibleSource = structuredClone(valid)
    ineligibleSource.sources[0].publication_eligibility = publication_eligibility
    expect(detailSchema.safeParse(ineligibleSource).success).toBe(false)
  }

  const conservative = structuredClone(valid)
  conservative.references[0].publication_eligibility = 'reference_only'
  conservative.sources[0].publication_eligibility = 'reference_only'
  expect(detailSchema.safeParse(conservative).success).toBe(true)

  type MutableVNextDetail = Record<string, unknown> & { company: { company_id: string }; category_outcomes: unknown[]; references: unknown[]; official_claims: unknown[]; community_reports: unknown[]; sources: Array<Record<string, unknown>> }
  const official = structuredClone(valid) as unknown as MutableVNextDetail
  const claimId = `official::${'a'.repeat(64)}`
  official.category_outcomes[0] = { ...task7Official, official_claim_ids: [claimId] }
  official.references = []
  official.official_claims = [{ claim_id: claimId, cell_id: `cell::${official.company.company_id}::leave`, company_id: official.company.company_id, category_id: 'leave', jurisdiction: 'KR', source_ids: ['source::reference'], source_tier: 'official_government', scope_status: 'exact_entity', scope: official.sources[0].scope, conflict_status: 'none', publication_eligibility: 'eligible' }]
  official.sources[0] = { ...official.sources[0], source_tier: 'official_government', reliability: 'high', publication_eligibility: 'eligible' }
  expect(detailSchema.safeParse(official).success).toBe(true)
  official.sources[0].publication_eligibility = 'reference_only'
  expect(detailSchema.safeParse(official).success).toBe(false)

  const community = structuredClone(valid) as unknown as MutableVNextDetail
  community.category_outcomes[0] = { ...task7Official, state: 'community_report', source_tiers: ['user_submission'], official_claim_ids: [], official_claim_count: 0, community_report_ids: ['community::record-1'], community_report_count: 1, reliability: 'low', publication_eligibility: 'community_only', status: 'bounded', limitation_codes: ['lower_tier_evidence'] }
  community.references = []
  community.community_reports = [{ community_report_id: 'community::record-1', cell_id: `cell::${community.company.company_id}::leave`, company_id: community.company.company_id, category_id: 'leave', source_id: 'source::reference', source_tier: 'user_submission', statement: 'Employee report.', reliability: 'low', currentness: 'current', scope_status: 'exact_entity', scope: community.sources[0].scope, conflict_status: 'none', frozen_snapshot: { locator: 'https://reference.example/snapshot', content_sha256: 'b'.repeat(64), frozen_at: '2026-11-01T00:00:00Z' }, publication_eligibility: 'eligible' }]
  community.sources[0] = { ...community.sources[0], source_tier: 'user_submission', reliability: 'low', publication_eligibility: 'eligible' }
  expect(detailSchema.safeParse(community).success).toBe(true)
  community.sources[0].publication_eligibility = 'discovery_only'
  expect(detailSchema.safeParse(community).success).toBe(false)
})

it.each([
  ['reliability', (detail: ReturnType<typeof vNextDetailWithReference>) => { Object.assign(detail.sources[0], { reliability: 'low' }) }],
  ['currentness', (detail: ReturnType<typeof vNextDetailWithReference>) => { Object.assign(detail.sources[0], { currentness: 'historical' }) }],
  ['scope status', (detail: ReturnType<typeof vNextDetailWithReference>) => { Object.assign(detail.sources[0], { scope_status: 'bounded_entity' }) }],
  ['scope values', (detail: ReturnType<typeof vNextDetailWithReference>) => { Object.assign(detail.sources[0].scope, { roles: ['executives'] }) }],
  ['conflict status', (detail: ReturnType<typeof vNextDetailWithReference>) => { Object.assign(detail.sources[0], { conflict_status: 'contradictory' }) }],
])('rejects a reference whose bound source disagrees on %s', (_field, mutate) => {
  const detail = vNextDetailWithReference()
  const listing = { company_id: detail.company.company_id, category_outcomes: detail.category_outcomes } as unknown as CompanyListing
  expect(() => assertCompanyDetailEvidence(listing, detail as unknown as Detail)).not.toThrow()
  mutate(detail)
  expect(() => assertCompanyDetailEvidence(listing, detail as unknown as Detail)).toThrow(/limitation metadata/)
})

it('rejects favorable/adverse limitation metadata rebound in either direction', () => {
  const favorableRecord = vNextDetailWithReference()
  const listing = { company_id: favorableRecord.company.company_id, category_outcomes: favorableRecord.category_outcomes } as unknown as CompanyListing
  Object.assign(favorableRecord.sources[0], { reliability: 'low', currentness: 'historical', scope_status: 'group_only', conflict_status: 'contradictory' })
  expect(() => assertCompanyDetailEvidence(listing, favorableRecord as unknown as Detail)).toThrow(/limitation metadata/)

  const favorableSource = vNextDetailWithReference()
  Object.assign(favorableSource.references[0], { reliability: 'low', currentness: 'historical', conflict_status: 'contradictory' })
  favorableSource.references[0].scope.status = 'group_only'
  expect(() => assertCompanyDetailEvidence(listing, favorableSource as unknown as Detail)).toThrow(/limitation metadata/)
})

it('binds official and community limitation metadata to every source', () => {
  const official = vNextDetailWithReference()
  const claimId = `official::${'a'.repeat(64)}`
  official.references = []
  Object.assign(official.category_outcomes[0], task7Official, { official_claim_ids: [claimId] })
  Object.assign(official, { official_claims: [{ claim_id: claimId, cell_id: `cell::${official.company.company_id}::leave`, company_id: official.company.company_id, category_id: 'leave', jurisdiction: 'KR', source_ids: ['source::reference'], source_tier: 'official_government', scope_status: 'exact_entity', scope: official.sources[0].scope, conflict_status: 'none', publication_eligibility: 'eligible' }] })
  official.sources[0] = { ...official.sources[0], source_tier: 'official_government', reliability: 'high', publication_eligibility: 'eligible' }
  const officialListing = { company_id: official.company.company_id, category_outcomes: official.category_outcomes } as unknown as CompanyListing
  expect(() => assertCompanyDetailEvidence(officialListing, official as unknown as Detail)).not.toThrow()
  official.sources[0].conflict_status = 'disclosed'
  expect(() => assertCompanyDetailEvidence(officialListing, official as unknown as Detail)).toThrow(/limitation metadata/)

  const community = vNextDetailWithReference()
  community.references = []
  Object.assign(community.category_outcomes[0], task7Official, { state: 'community_report', source_tiers: ['user_submission'], official_claim_ids: [], official_claim_count: 0, community_report_ids: ['community::record-1'], community_report_count: 1, reliability: 'low', publication_eligibility: 'community_only', status: 'bounded', limitation_codes: ['lower_tier_evidence'] })
  Object.assign(community, { community_reports: [{ community_report_id: 'community::record-1', cell_id: `cell::${community.company.company_id}::leave`, company_id: community.company.company_id, category_id: 'leave', source_id: 'source::reference', source_tier: 'user_submission', statement: 'Employee report.', reliability: 'low', currentness: 'current', scope_status: 'exact_entity', scope: structuredClone(community.sources[0].scope), conflict_status: 'none', frozen_snapshot: { locator: 'https://reference.example/snapshot', content_sha256: 'b'.repeat(64), frozen_at: '2026-11-01T00:00:00Z' }, publication_eligibility: 'eligible' }] })
  community.sources[0] = { ...community.sources[0], source_tier: 'user_submission', reliability: 'low', publication_eligibility: 'eligible' }
  const communityListing = { company_id: community.company.company_id, category_outcomes: community.category_outcomes } as unknown as CompanyListing
  expect(() => assertCompanyDetailEvidence(communityListing, community as unknown as Detail)).not.toThrow()
  Object.assign(community.sources[0].scope, { roles: ['executives'] })
  expect(() => assertCompanyDetailEvidence(communityListing, community as unknown as Detail)).toThrow(/limitation metadata/)
})

it.each([
  ['favorable official outcome rebound to a low historical source', { reliability: 'high', currentness: 'current' }, { reliability: 'low', currentness: 'historical' }],
  ['bounded official outcome rebound to a favorable source', { reliability: 'medium', currentness: 'historical' }, { reliability: 'high', currentness: 'current' }],
] as const)('rejects %s', (_name, outcome, source) => {
  const detail = vNextDetailWithOfficial(outcome, source)
  const listing = { company_id: detail.company.company_id, category_outcomes: detail.category_outcomes } as unknown as CompanyListing
  expect(detailSchema.safeParse(detail).success).toBe(true)
  expect(() => assertCompanyDetailEvidence(listing, detail as unknown as Detail)).toThrow(/limitation metadata/)
})

it('accepts an official claim whose source limitations match its canonical cell outcome', () => {
  const detail = vNextDetailWithOfficial(
    { reliability: 'medium', currentness: 'historical' },
    { reliability: 'medium', currentness: 'historical' },
  )
  const listing = { company_id: detail.company.company_id, category_outcomes: detail.category_outcomes } as unknown as CompanyListing
  expect(detailSchema.safeParse(detail).success).toBe(true)
  expect(() => assertCompanyDetailEvidence(listing, detail as unknown as Detail)).not.toThrow()
})

it('requires exact detail claim IDs and rejects official claims in lower-tier cells', () => {
  const category_outcomes = categories.map(task7Outcome)
  const listing = { company_id: 'KR-CRN-0000000000001', category_outcomes } as unknown as CompanyListing
  const claim = { claim_id: 'official::claim-1', category_ids: ['leave'] } as unknown as Detail['claims'][number]
  const detail = { company: { company_id: listing.company_id }, category_outcomes, claims: [claim] } as unknown as Detail
  expect(() => assertCompanyDetailEvidence(listing, detail)).not.toThrow()
  expect(() => assertCompanyDetailEvidence(listing, { ...detail, claims: [{ ...claim, claim_id: 'official::other' }] })).toThrow(/claim ID/)

  const lowerTierDetail = structuredClone(detail)
  lowerTierDetail.category_outcomes[0] = { ...lowerTierDetail.category_outcomes[0], state: 'reference' } as never
  listing.category_outcomes[0] = lowerTierDetail.category_outcomes[0]
  expect(() => assertCompanyDetailEvidence(listing, lowerTierDetail)).toThrow(/공식 claim/)
})
