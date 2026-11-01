import { expect, it } from 'vitest'
import type { CompanyListing } from '../types/benefits'
import { filterBenefitsCompanies, parseQuery } from './benefitsQueryState'

const insufficient = (category_id: CompanyListing['category_outcomes'][number]['category_id']) => ({
  kind: 'insufficient_evidence' as const,
  category_id,
  reason_code: 'not_researched' as const,
  nonabsence_notice: '이번 조사에서 게시 가능한 공식 복지 근거를 확보하지 못했습니다. 복지가 없다는 뜻이 아닙니다.' as const,
  searched_source_ids: [],
  searched_at: null,
})
const cats = ['leave','family','health','growth','housing','commute','remote','retirement','meals','inclusion'] as const
const companies: CompanyListing[] = Array.from({ length: 2000 }, (_, index) => ({
  company_id: index < 1000 ? `KR-CRN-${String(index + 1).padStart(13, '0')}` as const : `US-CIK${String(index + 1).padStart(10, '0')}` as const,
  population_sequence: index + 1,
  legal_name: `Company ${index + 1}`,
  display_name: `Company ${index + 1}`,
  scope: index < 1000 ? 'domestic' : 'international',
  jurisdiction: index < 1000 ? 'KR' : 'US',
  incorporation_country: index < 1000 ? 'KR' : 'US',
  registered_head_office_country: index < 1000 ? 'KR' : 'US',
  selected_reporting_legal_entity: `Company ${index + 1}`,
  sector: 'non_financial',
  category_outcomes: cats.map(insufficient),
}))

it('filters 2000 records without changing canonical order', () => {
  const result = filterBenefitsCompanies(companies, parseQuery('?q=Company 1999'))
  expect(result.map((company) => company.population_sequence)).toEqual([1999])
})
