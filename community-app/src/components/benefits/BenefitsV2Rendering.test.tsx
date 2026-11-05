import { render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { BenefitsHeatmapTable } from './BenefitsHeatmapTable'
import { BenefitClaimGroup } from './BenefitClaimGroup'
import { BenefitV2EvidenceGroup } from './BenefitV2EvidenceGroup'
import { CompanyCompareTray } from './CompanyCompareTray'
import { FitResultList } from './FitResultList'
import { categories, type BenefitCompanyView, type CategoryOutcome, type CompanyListing, type Detail } from '../../types/benefits'
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
  official_claim_ids: state === 'official_verified' ? ['official::claim-1', 'official::claim-2'] : [],
  reference_ids: state === 'reference' ? ['reference::record-1'] : [],
  community_report_ids: state === 'community_report' ? ['community::report-1', 'community::report-2', 'community::report-3'] : [],
  official_claim_count: state === 'official_verified' ? 2 : 0,
  reference_count: state === 'reference' ? 1 : 0,
  community_report_count: state === 'community_report' ? 3 : 0,
  reliability: state === 'official_verified' ? 'high' : state === 'reference' ? 'medium' : state === 'community_report' ? 'low' : 'none',
  currentness: state === 'no_public_info' ? 'unknown' : 'current',
  scope_status: state === 'no_public_info' ? 'unresolved' : 'exact_entity',
  conflict_status: 'none',
  publication_eligibility: state === 'official_verified' ? 'official_claim' : state === 'reference' ? 'reference_only' : state === 'community_report' ? 'community_only' : 'discovery_only',
  assessed_at: '2026-11-01T00:00:00Z',
  ...(state === 'no_public_info' ? { coverage_complete: true } : {}),
  scope: { countries: ['KR'], legal_entities: ['Test Co'], roles: ['engineer'], employment_types: ['full-time'], tenure_conditions: [] },
  last_checked_at: '2026-11-01T00:00:00Z',
  ...overrides,
} as unknown as CategoryOutcome)
const researchedCompany = (index: number): CompanyListing => ({
  ...company(index),
  category_outcomes: categories.map((category, offset) => {
    if (offset === 0) return researched(category, 'official_verified', ['official_government', 'user_submission'], { community_report_ids: ['community::report-1', 'community::report-2'], community_report_count: 2 })
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
  expect(screen.getAllByText('커뮤니티 보고').length).toBeGreaterThan(0)
  expect(screen.getByText('공개 정보 없음')).toBeVisible()
  expect(screen.getByText('과거 정보')).toBeVisible()
  expect(screen.getAllByText('적용 범위 미확인').length).toBeGreaterThan(0)
  expect(screen.getByText('정보 상충')).toBeVisible()
  expect(screen.getByText('공식 근거 2건')).toBeVisible()
  expect(screen.getByText('커뮤니티 보고 2건')).toBeVisible()
  expect(screen.queryByText(/총 4건/)).not.toBeInTheDocument()
})

it('exposes structured heatmap state, counts, currentness, scope, date and conflict context', () => {
  render(<BenefitsHeatmapTable companies={[researchedCompany(1)]} selectedCategories={['health']} compare={[]} toggle={() => undefined} link={() => '#'} />)
  const link = screen.getByRole('link', { name: 'Test 1 건강·보험 참고 정보' })
  expect(link).toHaveAttribute('aria-describedby')
  const description = document.getElementById(link.getAttribute('aria-describedby')!)
  expect(description).toHaveTextContent('출처 계층: 기타 공개자료')
  expect(description).toHaveTextContent('공식 근거 0건; 참고 자료 1건; 커뮤니티 보고 0건')
  expect(description).toHaveTextContent('현재성: 현재 정보')
  expect(description).toHaveTextContent('범위: 적용 범위 미확인; 국가: KR')
  expect(description).toHaveTextContent('확인일: 2026-11-01')
  expect(description).toHaveTextContent('경고: 정보 상충')
  expect(within(link).getByRole('list')).toBeVisible()
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

it('marks projected companies with an accessible lineage badge and pending companies explicitly', () => {
  const projected = { ...researchedCompany(1), lineage: { legacy: company(1), approved_v2: researchedCompany(1) } } as BenefitCompanyView
  const pending = { ...company(2), lineage: { legacy: company(2) } } as BenefitCompanyView
  render(<BenefitsHeatmapTable companies={[projected, pending]} selectedCategories={['leave']} compare={[]} toggle={() => undefined} link={() => '#'} projectionActive />)
  expect(screen.getByLabelText('승인 v2 조사 적용')).toBeVisible()
  expect(screen.getByText('v2 승인 조사 미적용')).toBeVisible()
})

it('renders approved-v2 evidence in distinct official, reference and lower-tier community sections', () => {
  const detail = {
    official_claims: [{ claim_id: `official::${'a'.repeat(64)}`, category_id: 'leave', source_ids: ['source::official'], scope: { countries: ['KR'], legal_entities: ['Test Co'], roles: ['engineer'], employment_types: ['full-time'] }, scope_status: 'exact_entity', source_tier: 'official_government', conflict_status: 'none' }],
    references: [{ reference_id: 'reference::1', category_id: 'leave', source_id: 'source::reference', statement: '연차 휴가 제도를 안내합니다.', supporting_quote: '연차 휴가를 사용할 수 있습니다.' }],
    community_reports: [{ community_report_id: 'community::1', category_id: 'leave', source_id: 'source::community', statement: '직원 커뮤니티의 휴가 사용 보고입니다.' }],
    sources: [
      { source_id: 'source::official', title: '고용노동부 공개 기록', url: 'https://official.example/record' },
      { source_id: 'source::reference', title: '기업 채용 안내', url: 'https://company.example/benefits' },
      { source_id: 'source::community', title: '직원 커뮤니티 스냅샷', url: 'https://community.example/report' },
    ],
  } as unknown as Detail
  render(<><h2>승인 v2 조사 근거</h2><BenefitV2EvidenceGroup category="leave" detail={detail} /></>)
  expect(screen.getByRole('heading', { name: '승인 v2 조사 근거' })).toBeVisible()
  expect(screen.getByText('공식 기록')).toBeVisible()
  expect(screen.getByText('연차 휴가 제도를 안내합니다.')).toBeVisible()
  expect(screen.getByText('연차 휴가를 사용할 수 있습니다.')).toBeVisible()
  expect(screen.getByText('커뮤니티 보고 · 하위 근거 계층')).toBeVisible()
  expect(screen.getByText('직원 커뮤니티의 휴가 사용 보고입니다.')).toBeVisible()
  expect(screen.getAllByRole('link')).toHaveLength(3)
  for (const link of screen.getAllByRole('link')) { expect(link).toHaveAttribute('target', '_blank'); expect(link).toHaveAttribute('rel', 'noopener noreferrer') }
})

it('renders material reference and community evidence limitations with accessible Korean labels', () => {
  const detail = {
    official_claims: [],
    references: [{
      reference_id: 'reference::limited', category_id: 'leave', source_id: 'source::reference', statement: '과거 그룹 단위 참고 자료입니다.', supporting_quote: '휴가 제도 운영',
      reliability: 'low', currentness: 'historical', scope: { status: 'group_only', countries: ['KR'], legal_entities: ['Test Group'], roles: ['engineer'], employment_types: ['full-time'] }, conflict_status: 'contradictory',
    }],
    community_reports: [{
      community_report_id: 'community::limited', category_id: 'leave', source_id: 'source::community', statement: '범위 미확인 커뮤니티 보고입니다.',
      reliability: 'low', currentness: 'unknown', scope_status: 'unresolved', scope: { countries: ['KR'], legal_entities: [], roles: [], employment_types: [] }, conflict_status: 'disclosed',
    }],
    sources: [
      { source_id: 'source::reference', title: '과거 참고 자료', url: 'https://reference.example/benefits' },
      { source_id: 'source::community', title: '커뮤니티 스냅샷', url: 'https://community.example/report' },
    ],
  } as unknown as Detail
  render(<BenefitV2EvidenceGroup category="leave" detail={detail} />)
  const reference = screen.getByRole('article', { name: '참고 자료 근거 제한' })
  expect(reference).toHaveTextContent('신뢰도: 낮음')
  expect(reference).toHaveTextContent('현재성: 과거 정보')
  expect(reference).toHaveTextContent('적용 범위 상태: 그룹 단위')
  expect(reference).toHaveTextContent('법인 Test Group')
  expect(reference).toHaveTextContent('상충 상태: 모순됨')
  const community = screen.getByRole('article', { name: '커뮤니티 보고 근거 제한' })
  expect(community).toHaveTextContent('신뢰도: 낮음')
  expect(community).toHaveTextContent('현재성: 확인되지 않음')
  expect(community).toHaveTextContent('적용 범위 상태: 미확인')
  expect(community).toHaveTextContent('상충 상태: 상충 정보 공개됨')
})

it.each([
  'http://company.example/benefits',
  'javascript:alert(1)',
  'data:text/html,unsafe',
  'https://user:password@company.example/benefits',
])('does not render an unsafe approved-v2 source href: %s', (url) => {
  const detail = {
    official_claims: [],
    references: [{ reference_id: 'reference::1', category_id: 'leave', source_id: 'source::reference', statement: '참고 자료입니다.', supporting_quote: '근거 인용문' }],
    community_reports: [],
    sources: [{ source_id: 'source::reference', title: '안전하지 않은 출처', url }],
  } as unknown as Detail
  render(<BenefitV2EvidenceGroup category="leave" detail={detail} />)
  expect(screen.queryByRole('link', { name: '안전하지 않은 출처' })).not.toBeInTheDocument()
  expect(document.querySelectorAll('a')).toHaveLength(0)
})
