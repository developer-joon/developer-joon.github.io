import { expect, it } from 'vitest'
import { categories, companyListingSchema, researchLeadSchema, type CategoryOutcome, type CompanyListing } from '../types/benefits'
import { buildResearchLeadIndex, filterBenefitsCompanies, parseQuery, serializeQuery } from './benefitsQueryState'

const ids = [
  'KR-CRN-1101112948086',
  'US-CIK0001411342',
  'KR-CRN-1234567890123',
  'US-CIK0000000004',
  'US-CIK0000000005',
]

it('normalizes URL-only condition state and caps compare at four unique real IDs', () => {
  const state = parseQuery(
    `?country=KR&employment_type=full-time&role=engineer&preferred_categories=family,bad,health&preset=custom&compare=${ids[0]},${ids[0]},${ids.slice(1).join(',')}&page=-2&weights=family:5`,
    ids,
  )
  expect(state.country).toBe('KR')
  expect(state.employment_type).toBe('full-time')
  expect(state.role).toBe('engineer')
  expect(state.preferred_categories).toEqual(['family', 'health'])
  expect(state.compare).toEqual(ids.slice(0, 4))
  expect(state.page).toBe(1)
  expect(state.notice).toBe(true)
  const encoded = serializeQuery(state)
  expect(encoded).not.toContain('weights')
  expect(parseQuery(encoded, ids).compare).toEqual(ids.slice(0, 4))
})

it('rejects fixture, malformed and cross-version company IDs', () => {
  const state = parseQuery(`?compare=example-001,${ids[0]},KR-CRN-123`, ids)
  expect(state.compare).toEqual([ids[0]])
  expect(state.notice).toBe(true)
})

it('keeps legacy evidence tiers available in explicit all mode', () => {
  const notice = '이번 조사에서 게시 가능한 공식 복지 근거를 확보하지 못했습니다. 복지가 없다는 뜻이 아닙니다.'
  const insufficient = (category_id: (typeof categories)[number]): CategoryOutcome => ({ kind: 'insufficient_evidence', category_id, reason_code: 'not_researched', nonabsence_notice: notice, searched_source_ids: [], searched_at: null })
  const listing = (index: number, evidenced: boolean): CompanyListing => ({
    company_id: `KR-CRN-${String(index).padStart(13, '0')}`,
    population_sequence: index,
    legal_name: `Test ${index}`,
    display_name: `Test ${index}`,
    scope: 'domestic',
    jurisdiction: 'KR',
    incorporation_country: 'KR',
    registered_head_office_country: 'KR',
    selected_reporting_legal_entity: `Test ${index}`,
    sector: 'non_financial',
    category_outcomes: categories.map((category, categoryIndex) => evidenced && categoryIndex === 0
      ? { kind: 'evidenced', category_id: category, status: 'confirmed', claim_count: 1, benefit_type_count: 1, scope: { countries: ['KR'], legal_entities: [`Test ${index}`], roles: [], employment_types: [], tenure_conditions: [] }, limitation_codes: [], last_checked_at: '2026-10-31T00:00:00Z' }
      : insufficient(category)),
  })
  const companies = [listing(1, false), listing(2, true)]

  const verified = parseQuery('?evidence=verified')
  expect(verified.evidence).toBe('verified')
  expect(filterBenefitsCompanies(companies, verified).map((company) => company.company_id)).toEqual([companies[1].company_id])

  const all = parseQuery('?evidence=all')
  expect(filterBenefitsCompanies(companies, all)).toHaveLength(2)
  expect(serializeQuery(all)).toContain('evidence=all')

  expect(filterBenefitsCompanies(companies, parseQuery('?categories=family&evidence=verified'))).toHaveLength(1)
  expect(filterBenefitsCompanies(companies, parseQuery('?categories=family&evidence=all'))).toHaveLength(2)
})

it('includes every evidence tier in legacy verified mode and orders tiers by precedence', () => {
  const base = (index: number, state: 'official_verified'|'reference'|'community_report'|'no_public_info'): CompanyListing => ({
    company_id: `KR-CRN-${String(index).padStart(13, '0')}`,
    population_sequence: index,
    legal_name: `Tier ${index}`,
    display_name: `Tier ${index}`,
    scope: 'domestic', jurisdiction: 'KR', incorporation_country: 'KR', registered_head_office_country: 'KR', selected_reporting_legal_entity: `Tier ${index}`, sector: 'non_financial',
    category_outcomes: categories.map((category) => ({
      category_id: category, state,
      source_tiers: state === 'official_verified' ? ['official_government'] : state === 'reference' ? ['other_public_web'] : state === 'community_report' ? ['user_submission'] : [],
      official_claim_count: state === 'official_verified' ? 1 : 0,
      reference_count: state === 'reference' ? 1 : 0,
      community_report_count: state === 'community_report' ? 1 : 0,
      reliability: state === 'official_verified' ? 'high' : state === 'reference' ? 'medium' : state === 'community_report' ? 'low' : 'none',
      currentness: state === 'no_public_info' ? 'unknown' : 'current', scope_status: state === 'no_public_info' ? 'unresolved' : 'exact_entity', conflict_status: 'none',
      scope: { countries: ['KR'], legal_entities: [`Tier ${index}`], roles: [], employment_types: [], tenure_conditions: [] }, last_checked_at: '2026-11-01T00:00:00Z',
    } as unknown as CategoryOutcome)),
  })
  const companies = [base(1, 'community_report'), base(2, 'no_public_info'), base(3, 'reference'), base(4, 'official_verified')]
  expect(filterBenefitsCompanies(companies, parseQuery('?categories=leave&evidence=verified')).map((company) => company.population_sequence)).toEqual([4, 3, 1])
  expect(filterBenefitsCompanies(companies, parseQuery('?categories=leave&evidence=all')).map((company) => company.population_sequence)).toEqual([4, 3, 1, 2])
})

it('keeps projected reference and community evidence in legacy verified mode before category filters', () => {
  const base = (index: number, evidenceCategory: number | undefined, state: 'reference'|'community_report'|'no_public_info'): CompanyListing => ({
    company_id: `KR-CRN-${String(index).padStart(13, '0')}`, population_sequence: index, legal_name: `Projected ${index}`, display_name: `Projected ${index}`,
    scope: 'domestic', jurisdiction: 'KR', incorporation_country: 'KR', registered_head_office_country: 'KR', selected_reporting_legal_entity: `Projected ${index}`, sector: 'non_financial',
    category_outcomes: categories.map((category, offset) => ({
      category_id: category, state: offset === evidenceCategory ? state : 'no_public_info',
      source_tiers: offset === evidenceCategory && state === 'reference' ? ['other_public_web'] : offset === evidenceCategory && state === 'community_report' ? ['user_submission'] : [],
      official_claim_count: 0, reference_count: offset === evidenceCategory && state === 'reference' ? 1 : 0, community_report_count: offset === evidenceCategory && state === 'community_report' ? 1 : 0,
      reliability: offset === evidenceCategory && state !== 'no_public_info' ? (state === 'reference' ? 'medium' : 'low') : 'none', currentness: offset === evidenceCategory && state !== 'no_public_info' ? 'current' : 'unknown',
      scope_status: offset === evidenceCategory && state !== 'no_public_info' ? 'exact_entity' : 'unresolved', conflict_status: 'none', scope: { countries: ['KR'], legal_entities: [], roles: [], employment_types: [], tenure_conditions: [] }, last_checked_at: '2026-11-01T00:00:00Z',
    } as unknown as CategoryOutcome)),
  })
  const companies = [base(1, 0, 'reference'), base(2, 2, 'community_report'), base(3, undefined, 'no_public_info')]
  expect(filterBenefitsCompanies(companies, parseQuery('?categories=family&evidence=verified')).map((company) => company.population_sequence)).toEqual([1, 2])
  expect(filterBenefitsCompanies(companies, parseQuery('?categories=family&statuses=insufficient_evidence&evidence=verified')).map((company) => company.population_sequence)).toEqual([1, 2])
})

it('defaults to source-backed concrete research actions, not raw outcomes, and scopes categories', () => {
  const listing = (index: number): CompanyListing => ({
    company_id: `KR-CRN-${String(index).padStart(13, '0')}`, population_sequence: index,
    legal_name: `Test ${index}`, display_name: `Test ${index}`, scope: 'domestic', jurisdiction: 'KR', incorporation_country: 'KR', registered_head_office_country: 'KR', selected_reporting_legal_entity: `Test ${index}`, sector: 'non_financial',
    category_outcomes: categories.map((category) => ({ kind: 'insufficient_evidence', category_id: category, reason_code: 'not_researched', nonabsence_notice: '이번 조사에서 게시 가능한 공식 복지 근거를 확보하지 못했습니다. 복지가 없다는 뜻이 아닙니다.', searched_source_ids: [], searched_at: null })),
  })
  const companies = [listing(1), listing(2), listing(3)]
  const lead = researchLeadSchema.parse({
    company_id: companies[0].company_id, primary_category: 'leave', benefit_action: '유급 휴가 지원',
    source_url: 'https://example.org/benefits', source_registry_id: 'registry::1', source_text_sha256: 'a'.repeat(64),
    scope: { legal_entity: companies[0].legal_name, roles: 'all', employment_types: ['full_time'], conditions: { tenure: 'one year' } },
    currentness: 'unknown', observed_at: '2026-11-19T00:00:00Z', limitations: ['조사 단계'], status: 'research_only',
  })
  const index = buildResearchLeadIndex([lead])
  expect(parseQuery('').evidence).toBe('research')
  expect(filterBenefitsCompanies(companies, parseQuery(''), index).map((company) => company.company_id)).toEqual([lead.company_id])
  expect(filterBenefitsCompanies(companies, parseQuery('?categories=health'), index)).toEqual([])
  expect(filterBenefitsCompanies(companies, parseQuery('?categories=health&evidence=all'), index)).toHaveLength(3)
  expect(parseQuery('?statuses=confirmed').evidence).toBe('verified')
  expect(index.get(lead.company_id)?.get('leave')).toHaveLength(1)
})

it('matches underlying confirmed outcomes in all and verified modes without treating research leads as insufficient evidence', () => {
  const company = companyListingSchema.parse({
    company_id: ids[0], population_sequence: 1, legal_name: 'Test', display_name: 'Test',
    scope: 'domestic', jurisdiction: 'KR', incorporation_country: 'KR', registered_head_office_country: 'KR',
    selected_reporting_legal_entity: 'Test', sector: 'non_financial',
    category_outcomes: categories.map((category) => category === 'leave'
      ? { kind: 'evidenced', category_id: category, status: 'confirmed', claim_count: 1, benefit_type_count: 1,
        scope: { countries: ['KR'], legal_entities: ['Test'], roles: [], employment_types: [], tenure_conditions: [] },
        limitation_codes: [], last_checked_at: '2026-11-19T00:00:00Z' }
      : { kind: 'insufficient_evidence', category_id: category, reason_code: 'not_researched',
        nonabsence_notice: '이번 조사에서 게시 가능한 공식 복지 근거를 확보하지 못했습니다. 복지가 없다는 뜻이 아닙니다.',
        searched_source_ids: [], searched_at: null }),
  })
  const lead = researchLeadSchema.parse({
    company_id: company.company_id, primary_category: 'leave', benefit_action: '유급 휴가 지원',
    source_url: 'https://example.org/benefits', source_registry_id: 'registry::1', source_text_sha256: 'a'.repeat(64),
    scope: { legal_entity: 'Test', roles: 'all', employment_types: ['full_time'], conditions: { tenure: 'one year' } },
    currentness: 'unknown', observed_at: '2026-11-19T00:00:00Z', limitations: ['조사 단계'], status: 'research_only',
  })
  const index = buildResearchLeadIndex([lead])
  for (const evidence of ['all', 'verified'] as const) {
    expect(filterBenefitsCompanies([company], parseQuery(`?evidence=${evidence}&categories=leave&statuses=confirmed`), index)).toEqual([company])
  }
  expect(filterBenefitsCompanies([company], parseQuery('?evidence=research&categories=leave&statuses=insufficient_evidence'), index)).toEqual([company])
  expect(filterBenefitsCompanies([company], parseQuery(''), index)).toEqual([company])
})

it('restores status-only bookmarks as visible verified filters and preserves explicit legacy modes', () => {
  const legacy = parseQuery('?statuses=confirmed')
  expect(legacy.evidence).toBe('verified')
  expect(legacy.statuses).toEqual(['confirmed'])
  expect(serializeQuery(legacy)).toContain('evidence=verified')
  for (const evidence of ['verified', 'all'] as const) {
    const state = parseQuery(`?evidence=${evidence}&statuses=confirmed`)
    expect(state.evidence).toBe(evidence)
    expect(state.statuses).toEqual(['confirmed'])
  }
})

it('discards incompatible hidden statuses from explicit research URLs and marks normalization', () => {
  const state = parseQuery('?evidence=research&statuses=confirmed')
  expect(state.evidence).toBe('research')
  expect(state.statuses).toEqual([])
  expect(state.notice).toBe(true)
  expect(serializeQuery(state)).not.toContain('statuses=')
})

it('round-trips research default and all mode while accepting old verified links', () => {
  expect(serializeQuery(parseQuery(''))).not.toContain('evidence=')
  expect(parseQuery(serializeQuery(parseQuery('?evidence=all'))).evidence).toBe('all')
  expect(parseQuery('?evidence=verified').evidence).toBe('verified')
  expect(serializeQuery(parseQuery('?evidence=verified'))).toContain('evidence=verified')
  expect(parseQuery('?evidence=bogus').notice).toBe(true)
})
