import { expect, it } from 'vitest'
import { categories, type CategoryOutcome, type CompanyListing } from '../types/benefits'
import { filterBenefitsCompanies, parseQuery, serializeQuery } from './benefitsQueryState'

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

it('shows companies with public evidence by default and keeps the full population opt-in', () => {
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

  const verified = parseQuery('')
  expect(verified.evidence).toBe('verified')
  expect(filterBenefitsCompanies(companies, verified).map((company) => company.company_id)).toEqual([companies[1].company_id])

  const all = parseQuery('?evidence=all')
  expect(filterBenefitsCompanies(companies, all)).toHaveLength(2)
  expect(serializeQuery(all)).toContain('evidence=all')

  expect(filterBenefitsCompanies(companies, parseQuery('?categories=family'))).toHaveLength(1)
  expect(filterBenefitsCompanies(companies, parseQuery('?categories=family&evidence=all'))).toHaveLength(2)
})

it('includes every evidence tier by default and orders tiers by precedence', () => {
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
  expect(filterBenefitsCompanies(companies, parseQuery('?categories=leave')).map((company) => company.population_sequence)).toEqual([4, 3, 1])
  expect(filterBenefitsCompanies(companies, parseQuery('?categories=leave&evidence=all')).map((company) => company.population_sequence)).toEqual([4, 3, 1, 2])
})

it('includes projected reference and community evidence in the default cohort before category filters', () => {
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
  expect(filterBenefitsCompanies(companies, parseQuery('?categories=family')).map((company) => company.population_sequence)).toEqual([1, 2])
  expect(filterBenefitsCompanies(companies, parseQuery('?categories=family&statuses=insufficient_evidence')).map((company) => company.population_sequence)).toEqual([1, 2])
})
