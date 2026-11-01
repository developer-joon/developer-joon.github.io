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

it('shows companies with verified public evidence by default and keeps all researched companies opt-in', () => {
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

  expect(filterBenefitsCompanies(companies, parseQuery('?categories=family'))).toHaveLength(0)
  expect(filterBenefitsCompanies(companies, parseQuery('?categories=family&evidence=all'))).toHaveLength(2)
})
