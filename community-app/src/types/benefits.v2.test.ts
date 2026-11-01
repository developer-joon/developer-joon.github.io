import { expect, it } from 'vitest'
import { claimSchema, manifestSchema, vNextCategoryOutcomeSchema as categoryOutcomeSchema } from './benefits'

function validManifest() {
  const descriptor = { url: 'community/data/company-benefits/v2/taxonomy.json', sha256: 'a'.repeat(64), record_count: 10, byte_count: 100 }
  return {
    schema_version: 2,
    artifact_kind: 'company_benefits_manifest',
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

it('accepts all four explicit cell states and rejects not_researched', () => {
  const base = { category_id: 'leave', currentness: 'current', scope_status: 'exact_entity', conflict_status: 'none', assessed_at: '2026-11-01T00:00:00Z', official_claim_ids: [], reference_ids: [], community_report_ids: [], kind: 'evidenced', status: 'confirmed', claim_count: 0, benefit_type_count: 0, scope: { countries: [], legal_entities: [], roles: [], employment_types: [], tenure_conditions: [] }, limitation_codes: [], last_checked_at: '2026-11-01T00:00:00Z', reason_code: 'searched_not_found', searched_source_ids: [], searched_at: '2026-11-01T00:00:00Z' }
  const outcomes = [
    { ...base, state: 'official_verified', reliability: 'high', publication_eligibility: 'official_claim', official_claim_ids: ['official::' + 'a'.repeat(64)] },
    { ...base, state: 'reference', reliability: 'medium', publication_eligibility: 'reference_only', reference_ids: ['reference::record-1'] },
    { ...base, state: 'community_report', reliability: 'low', publication_eligibility: 'community_only', community_report_ids: ['community::report-1'] },
    { ...base, state: 'no_public_info', reliability: 'none', currentness: 'unknown', scope_status: 'unresolved', publication_eligibility: 'discovery_only', nonabsence_notice: '이번 조사에서 게시 가능한 공식 복지 근거를 확보하지 못했습니다. 복지가 없다는 뜻이 아닙니다.' },
  ]
  outcomes.forEach((outcome) => expect(categoryOutcomeSchema.safeParse(outcome).success).toBe(true))
  expect(categoryOutcomeSchema.safeParse({ ...base, state: 'not_researched' }).success).toBe(false)
})

it('accepts schema v2 and rejects ranking semantics', () => {
  const manifest = validManifest()
  expect(manifestSchema.parse(manifest).fixture).toBe(false)
  expect(manifestSchema.safeParse({ ...manifest, rankings_url: '/x' }).success).toBe(false)
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
