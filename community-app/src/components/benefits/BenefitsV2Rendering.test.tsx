import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { BenefitsHeatmapTable } from './BenefitsHeatmapTable'
import { BenefitClaimGroup } from './BenefitClaimGroup'
import { CompanyCompareTray } from './CompanyCompareTray'
import { FitResultList } from './FitResultList'
import { categories, type CategoryOutcome, type CompanyListing } from '../../types/benefits'
import { parseQuery } from '../../lib/benefitsQueryState'
const notice = '이번 조사에서 게시 가능한 공식 복지 근거를 확보하지 못했습니다. 복지가 없다는 뜻이 아닙니다.'
const insufficient = (category_id: (typeof categories)[number]): CategoryOutcome => ({ kind: 'insufficient_evidence', category_id, reason_code: 'not_researched', nonabsence_notice: notice, searched_source_ids: [], searched_at: null })
const evidenced = (category_id: (typeof categories)[number], status: 'confirmed'|'bounded'): CategoryOutcome => ({ kind: 'evidenced', category_id, status, claim_count: 1, benefit_type_count: 1, scope: { countries: ['KR'], legal_entities: ['Test Co'], roles: ['engineer'], employment_types: ['full-time'], tenure_conditions: [] }, limitation_codes: status === 'bounded' ? ['scope_limited'] : [], last_checked_at: '2026-10-31T00:00:00Z' })
const company = (index: number): CompanyListing => ({ company_id: `KR-CRN-${String(index).padStart(13, '0')}`, population_sequence: index, legal_name: `Test ${index}`, display_name: `Test ${index}`, scope: 'domestic', jurisdiction: 'KR', incorporation_country: 'KR', registered_head_office_country: 'KR', selected_reporting_legal_entity: `Test ${index}`, sector: 'non_financial', category_outcomes: categories.map((category, offset) => offset === 0 ? evidenced(category, 'confirmed') : offset === 1 ? evidenced(category, 'bounded') : insufficient(category)) })
const researched = (
  category_id: (typeof categories)[number],
  state: 'official_verified'|'reference'|'community_report'|'no_public_info',
  source_tiers: ('official_government'|'company_recruiting_major_media'|'other_public_web'|'community_employee_review'|'user_submission')[],
  overrides: Record<string, unknown> = {},
): CategoryOutcome => ({
  category_id,
  state,
  source_tiers,
  official_claim_count: state === 'official_verified' ? 2 : 0,
  reference_count: state === 'reference' ? 1 : 0,
  community_report_count: state === 'community_report' ? 3 : 0,
  reliability: state === 'official_verified' ? 'high' : state === 'reference' ? 'medium' : state === 'community_report' ? 'low' : 'none',
  currentness: 'current',
  scope_status: 'exact_entity',
  conflict_status: 'none',
  scope: { countries: ['KR'], legal_entities: ['Test Co'], roles: ['engineer'], employment_types: ['full-time'], tenure_conditions: [] },
  last_checked_at: '2026-11-01T00:00:00Z',
  ...overrides,
} as unknown as CategoryOutcome)
const researchedCompany = (index: number): CompanyListing => ({
  ...company(index),
  category_outcomes: categories.map((category, offset) => {
    if (offset === 0) return researched(category, 'official_verified', ['official_government'], { community_report_count: 2 })
    if (offset === 1) return researched(category, 'reference', ['company_recruiting_major_media'], { currentness: 'historical', scope_status: 'group_only' })
    if (offset === 2) return researched(category, 'reference', ['other_public_web'], { scope_status: 'unresolved', conflict_status: 'contradictory' })
    if (offset === 3) return researched(category, 'community_report', ['community_employee_review', 'user_submission'])
    return researched(category, 'no_public_info', [])
  }),
})
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

it('renders every source tier and state warning without combining official and community counts', () => {
  render(<BenefitsHeatmapTable companies={[researchedCompany(1)]} selectedCategories={['leave', 'family', 'health', 'growth', 'housing']} compare={[]} toggle={() => undefined} link={() => '#'} />)
  expect(screen.getByText('공식 확인')).toBeVisible()
  expect(screen.getByText('채용·언론 참고')).toBeVisible()
  expect(screen.getByText('기타 공개자료')).toBeVisible()
  expect(screen.getByText('커뮤니티 보고')).toBeVisible()
  expect(screen.getByText('공개 정보 없음')).toBeVisible()
  expect(screen.getByText('과거 정보')).toBeVisible()
  expect(screen.getByText('적용 범위 미확인')).toBeVisible()
  expect(screen.getByText('정보 상충')).toBeVisible()
  expect(screen.getByText('공식 근거 2건')).toBeVisible()
  expect(screen.getByText('커뮤니티 보고 2건')).toBeVisible()
  expect(screen.queryByText(/총 4건/)).not.toBeInTheDocument()
})

it('shows reliability, currentness, scope and conflict semantics in category detail', () => {
  const outcome = researched('leave', 'reference', ['other_public_web'], {
    reliability: 'low', currentness: 'historical', scope_status: 'unresolved', conflict_status: 'contradictory',
  })
  render(<BenefitClaimGroup category="leave" outcome={outcome} claims={[]} />)
  expect(screen.getByText('신뢰도 낮음')).toBeVisible()
  expect(screen.getByText('과거 정보')).toBeVisible()
  expect(screen.getByText('적용 범위 미확인')).toBeVisible()
  expect(screen.getByText('정보 상충')).toBeVisible()
})

it('includes community-only cells in fit and comparison while retaining separate counts', () => {
  const item = researchedCompany(1)
  render(<><FitResultList companies={[item]} state={parseQuery('?preset=custom&preferred_categories=growth&evidence=all')} link={() => '#'} /><CompanyCompareTray companies={[item]} details={[]} error={false} retry={() => undefined} remove={() => undefined} /></>)
  expect(screen.getAllByText('커뮤니티 보고').length).toBeGreaterThan(0)
  expect(screen.getAllByText('커뮤니티 보고 3건').length).toBeGreaterThan(0)
  expect(screen.getByRole('region', { name: '기업 비교 표' })).toHaveAttribute('tabindex', '0')
  expect(screen.getByRole('button', { name: 'Test 1 비교 해제' })).toBeVisible()
})

it('keeps mobile targets at 56px and wraps long evidence URLs', () => {
  const css = readFileSync('src/styles/benefits.css', 'utf8')
  const mobileStart = css.indexOf('@media (max-width: 699px)')
  const mobileEnd = css.indexOf('@media (prefers-reduced-motion: reduce)', mobileStart)
  const mobile = css.slice(mobileStart, mobileEnd)
  expect(mobile).toMatch(/\.benefits-status,[\s\S]*min-height:\s*56px/)
  expect(css).toContain('.benefits-evidence a,')
  expect(css).toMatch(/\.benefits-evidence a,[^}]+overflow-wrap:\s*anywhere/)
})
