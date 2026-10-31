import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { BenefitsHeatmapTable } from './BenefitsHeatmapTable'
import { FitResultList } from './FitResultList'
import { categories, type CategoryOutcome, type CompanyListing } from '../../types/benefits'
import { parseQuery } from '../../lib/benefitsQueryState'
const notice = '이번 조사에서 게시 가능한 공식 복지 근거를 확보하지 못했습니다. 복지가 없다는 뜻이 아닙니다.'
const insufficient = (category_id: (typeof categories)[number]): CategoryOutcome => ({ kind: 'insufficient_evidence', category_id, reason_code: 'not_researched', nonabsence_notice: notice, searched_source_ids: [], searched_at: null })
const evidenced = (category_id: (typeof categories)[number], status: 'confirmed'|'bounded'): CategoryOutcome => ({ kind: 'evidenced', category_id, status, claim_count: 1, benefit_type_count: 1, scope: { countries: ['KR'], legal_entities: ['Test Co'], roles: ['engineer'], employment_types: ['full-time'], tenure_conditions: [] }, limitation_codes: status === 'bounded' ? ['scope_limited'] : [], last_checked_at: '2026-10-31T00:00:00Z' })
const company = (index: number): CompanyListing => ({ company_id: `KR-CRN-${String(index).padStart(13, '0')}`, population_sequence: index, legal_name: `Test ${index}`, display_name: `Test ${index}`, scope: 'domestic', jurisdiction: 'KR', incorporation_country: 'KR', registered_head_office_country: 'KR', selected_reporting_legal_entity: `Test ${index}`, sector: 'non_financial', category_outcomes: categories.map((category, offset) => offset === 0 ? evidenced(category, 'confirmed') : offset === 1 ? evidenced(category, 'bounded') : insufficient(category)) })
it('renders confirmed, bounded and insufficient outcomes with source-scope facts', () => {
  render(<BenefitsHeatmapTable companies={[company(1)]} selectedCategories={[]} compare={[]} toggle={() => undefined} link={() => '#'} />)
  expect(screen.getByText('확인됨')).toBeVisible(); expect(screen.getByText('범위 제한 확인')).toBeVisible(); expect(screen.getAllByText('근거 부족')).toHaveLength(8); expect(screen.getAllByText(/KR/).length).toBeGreaterThan(0)
})
it('caps heatmap rows and condition cards at fifty DOM companies', () => {
  const companies = Array.from({ length: 75 }, (_, index) => company(index + 1))
  const { container, rerender } = render(<BenefitsHeatmapTable companies={companies} selectedCategories={['leave']} compare={[]} toggle={() => undefined} link={() => '#'} />)
  expect(container.querySelectorAll('tr[data-company-id]')).toHaveLength(50)
  rerender(<FitResultList companies={companies} state={parseQuery('?preset=remote')} link={() => '#'} />)
  expect(container.querySelectorAll('article[data-company-id]')).toHaveLength(50)
})
