import { fireEvent, render, screen, within } from '@testing-library/react'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { BenefitsHeatmapTable } from './BenefitsHeatmapTable'
import { BenefitClaimGroup } from './BenefitClaimGroup'
import { BenefitV2EvidenceGroup, BenefitV2EvidenceSection } from './BenefitV2EvidenceGroup'
import { CompanyCompareTray } from './CompanyCompareTray'
import { FitResultList } from './FitResultList'
import { categories, detailSchema, type BenefitCompanyView, type CategoryOutcome, type CompanyListing, type Detail } from '../../types/benefits'
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
it('keeps legacy raw benefit text out of the detail when a research-only projection is active', () => {
  const manifest = JSON.parse(readFileSync('public/data/company-benefits/manifest.json', 'utf8'))
  const descriptor = manifest.company_shards['US-CIK0000038725']
  const detail = detailSchema.parse(JSON.parse(readFileSync(`public/${descriptor.url.replace(/^community\//, '')}`, 'utf8')))
  const claim = detail.claims[0]
  expect(claim.detail.length).toBeGreaterThan(200)
  const category = claim.category_ids[0]
  const outcome = detail.category_outcomes.find((item) => item.category_id === category)!

  render(<BenefitClaimGroup category={category} outcome={outcome} claims={[claim]} hideUnreviewedClaims />)
  expect(screen.getByRole('heading', { name: /기존 조사 자료 1/ })).toBeVisible()
  expect(screen.getByText('과거 자료 (현재 제공 여부 미확인)')).toBeVisible()
  expect(screen.getByText('적용 범위 또는 조사 한계, 과거 근거')).toBeVisible()
  expect(document.body).not.toHaveTextContent(claim.detail)
  expect(document.body).not.toHaveTextContent(claim.source_evidence[0].supporting_quote)
  expect(screen.queryByRole('heading', { name: claim.benefit_name })).not.toBeInTheDocument()
  expect(screen.getAllByRole('link').length).toBeGreaterThan(0)
  expect(screen.queryByText(/확인된 claim/)).not.toBeInTheDocument()
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
  expect(screen.getByText('공식 자료')).toBeVisible()
  expect(screen.getByText('채용·언론 참고')).toBeVisible()
  expect(screen.getByText('기타 공개자료')).toBeVisible()
  expect(screen.getAllByText('커뮤니티 보고').length).toBeGreaterThan(0)
  expect(screen.getByText('게시 가능한 공개 근거 미확인')).toBeVisible()
  expect(screen.getByText('과거 정보')).toBeVisible()
  expect(screen.getAllByText('적용 범위 미확인').length).toBeGreaterThan(0)
  expect(screen.getByText('정보 상충')).toBeVisible()
  expect(screen.getByText('공식 근거 2건')).toBeVisible()
  expect(screen.getByText('커뮤니티 보고 2건')).toBeVisible()
  expect(screen.queryByText(/총 4건/)).not.toBeInTheDocument()
})

it('exposes structured heatmap state, counts, currentness, scope, date and conflict context', () => {
  render(<BenefitsHeatmapTable companies={[researchedCompany(1)]} selectedCategories={['health']} compare={[]} toggle={() => undefined} link={() => '#'} />)
  const link = screen.getByRole('link', { name: 'Test 1 건강·보험 구체 혜택 확인 필요' })
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
  expect(screen.getByLabelText('추가 조사 자료')).toBeVisible()
  expect(screen.getAllByText('추가 조사 미적용').length).toBeGreaterThanOrEqual(1)
})

it('distinguishes specific content, evidence-only, no-public-info, and pending cells in visible and accessible heatmap labels', () => {
  const withSpecific = researchedCompany(11)
  withSpecific.category_outcomes[0] = researched('leave', 'official_verified', ['official_government'], { specific_benefit_count: 2 })
  const evidenceOnly = researchedCompany(12)
  evidenceOnly.category_outcomes[0] = researched('leave', 'official_verified', ['official_government'], { specific_benefit_count: 0 })
  const noPublicInfo = researchedCompany(13)
  noPublicInfo.category_outcomes[0] = researched('leave', 'no_public_info', [], { specific_benefit_count: 0 })
  const pending = company(14)
  const companies = [
    { ...withSpecific, lineage: { legacy: company(11), approved_v2: withSpecific } },
    { ...evidenceOnly, lineage: { legacy: company(12), approved_v2: evidenceOnly } },
    { ...noPublicInfo, lineage: { legacy: company(13), approved_v2: noPublicInfo } },
    { ...pending, lineage: { legacy: pending } },
  ] as BenefitCompanyView[]

  render(<BenefitsHeatmapTable companies={companies} selectedCategories={['leave']} compare={[]} toggle={() => undefined} link={() => '#'} projectionActive />)

  expect(screen.getByText('혜택 내용 확인 2건')).toBeVisible()
  expect(screen.getByText('구체 혜택 확인 필요')).toBeVisible()
  expect(screen.getByText('게시 가능한 공개 근거 미확인')).toBeVisible()
  expect(screen.getAllByText('추가 조사 미적용').length).toBeGreaterThanOrEqual(2)
  expect(screen.getByRole('link', { name: /Test 11 휴가·근무시간 혜택 내용 확인 2건/ })).toBeVisible()
  expect(screen.getByRole('link', { name: /Test 12 휴가·근무시간 구체 혜택 확인 필요/ })).toBeVisible()
  expect(screen.getByRole('link', { name: /Test 13 휴가·근무시간 게시 가능한 공개 근거 미확인/ })).toBeVisible()
  expect(screen.getByRole('link', { name: /Test 14 휴가·근무시간 추가 조사 미적용/ })).toBeVisible()
})

it('ranks projected concrete benefits ahead of evidence-only categories without changing pending legacy matching', () => {
  const evidenceOnly = researchedCompany(21)
  evidenceOnly.category_outcomes[0] = researched('leave', 'official_verified', ['official_government'], { specific_benefit_count: 0 })
  const concrete = researchedCompany(22)
  concrete.category_outcomes[0] = researched('leave', 'reference', ['other_public_web'], { specific_benefit_count: 1 })
  const pending = company(23)
  const { container } = render(<FitResultList
    companies={[evidenceOnly, concrete, pending]}
    state={parseQuery('?preset=custom&preferred_categories=leave&evidence=all')}
    link={() => '#'}
    projectionActive
  />)

  const cards = [...container.querySelectorAll('article[data-company-id]')]
  expect(cards.map((card) => card.getAttribute('data-company-id'))).toEqual([concrete.company_id, evidenceOnly.company_id, pending.company_id])
  expect(cards[0]).toHaveTextContent('혜택 내용 확인 1건')
  expect(cards[1]).toHaveTextContent('구체 혜택 확인 필요')
  expect(cards[2]).toHaveTextContent('추가 조사 미적용')
  expect(cards[2]).toHaveTextContent('근거 부족')
})

it('uses concrete projected and legacy semantics across every fit state while excluding official-only evidence', () => {
  const community = researchedCompany(41)
  community.category_outcomes[0] = researched('leave', 'community_report', ['user_submission'], { specific_benefit_count: 1 })
  const official = researchedCompany(42)
  official.category_outcomes[0] = researched('leave', 'official_verified', ['official_government'], { specific_benefit_count: 1 })
  const reference = researchedCompany(43)
  reference.category_outcomes[0] = researched('leave', 'reference', ['other_public_web'], { specific_benefit_count: 1 })
  const noPublicInfo = researchedCompany(44)
  noPublicInfo.category_outcomes[0] = researched('leave', 'no_public_info', [], { specific_benefit_count: 0 })
  const officialOnly = researchedCompany(45)
  officialOnly.category_outcomes[0] = researched('leave', 'official_verified', ['official_government'], { specific_benefit_count: 0 })
  const legacyConfirmed = company(46)
  const legacyBounded = company(47)
  legacyBounded.category_outcomes[0] = evidenced('leave', 'bounded')
  const legacyInsufficient = company(48)
  legacyInsufficient.category_outcomes[0] = insufficient('leave')
  const companies = [community, official, reference, noPublicInfo, officialOnly, legacyConfirmed, legacyBounded, legacyInsufficient]

  const { container } = render(<FitResultList
    companies={companies}
    state={parseQuery('?preset=custom&preferred_categories=leave&evidence=all')}
    link={() => '#'}
    projectionActive
  />)

  const cards = [...container.querySelectorAll<HTMLElement>('article[data-company-id]')]
  expect(cards.map((card) => card.dataset.companyId)).toEqual([
    community.company_id,
    official.company_id,
    reference.company_id,
    noPublicInfo.company_id,
    officialOnly.company_id,
    legacyConfirmed.company_id,
    legacyBounded.company_id,
    legacyInsufficient.company_id,
  ])
  for (const card of cards.slice(0, 3)) expect(card).toHaveTextContent('공개 범위와 조건 일치')
  for (const card of cards.slice(3)) expect(card).toHaveTextContent('근거 부족')
  expect(cards[0]).toHaveTextContent('커뮤니티 보고')
  expect(cards[0]).toHaveTextContent('혜택 내용 확인 1건')
  expect(cards[3]).toHaveTextContent('게시 가능한 공개 근거 미확인')
  expect(cards[4]).toHaveTextContent('구체 혜택 확인 필요')
  for (const card of cards.slice(5)) expect(card).toHaveTextContent('추가 조사 미적용')
})

it('represents every projected and legacy status mutation in comparison without treating evidence context as a benefit', () => {
  const projectedStates = [
    ['official_verified', ['official_government'], 1],
    ['reference', ['other_public_web'], 1],
    ['community_report', ['user_submission'], 1],
    ['no_public_info', [], 0],
  ] as const
  const projected = projectedStates.map(([state, tiers, specificBenefitCount], index) => {
    const item = researchedCompany(51 + index)
    item.category_outcomes[0] = researched('leave', state, [...tiers], { specific_benefit_count: specificBenefitCount })
    return item
  })
  const officialOnly = researchedCompany(55)
  officialOnly.category_outcomes[0] = researched('leave', 'official_verified', ['official_government'], { specific_benefit_count: 0 })
  const legacyConfirmed = company(56)
  const legacyBounded = company(57)
  legacyBounded.category_outcomes[0] = evidenced('leave', 'bounded')
  const legacyInsufficient = company(58)
  legacyInsufficient.category_outcomes[0] = insufficient('leave')

  const props = { details: [], error: false, retry: () => undefined, remove: () => undefined, projectionActive: true }
  const { rerender } = render(<CompanyCompareTray {...props} companies={projected} />)

  const projectedRow = screen.getByRole('row', { name: /휴가·근무시간/ })
  expect(within(projectedRow).getByText('공식 자료')).toBeVisible()
  expect(within(projectedRow).getByText('기타 공개자료')).toBeVisible()
  expect(within(projectedRow).getByText('커뮤니티 보고')).toBeVisible()
  expect(within(projectedRow).getByText('게시 가능한 공개 근거 미확인')).toBeVisible()

  rerender(<CompanyCompareTray {...props} companies={[officialOnly, legacyConfirmed, legacyBounded, legacyInsufficient]} />)
  const legacyRow = screen.getByRole('row', { name: /휴가·근무시간/ })
  expect(within(legacyRow).getByText('구체 혜택 확인 필요')).toBeVisible()
  expect(within(legacyRow).getAllByText('추가 조사 미적용')).toHaveLength(3)
  expect(within(legacyRow).queryByText('혜택 내용 확인 1건')).not.toBeInTheDocument()
})

it('shows comparison loading and retryable error lifecycle before rendering details', () => {
  const retry = vi.fn()
  const item = researchedCompany(61)
  const props = { companies: [item], retry, remove: () => undefined, projectionActive: true }
  const { rerender } = render(<CompanyCompareTray {...props} details={undefined} error={false} />)

  expect(screen.getByRole('status')).toHaveTextContent('비교 근거를 불러오고 있습니다.')
  rerender(<CompanyCompareTray {...props} details={undefined} error />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('상세 근거 무결성 오류')
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(retry).toHaveBeenCalledOnce()

  const detail = { company: { company_id: item.company_id }, references: [], community_reports: [], sources: [] } as unknown as Detail
  rerender(<CompanyCompareTray {...props} details={[{ legacy: detail, approvedV2: detail }]} error={false} />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: '기업 비교 표' })).toBeVisible()
})

it('keeps the comparison UI bound to the first four unique query companies', () => {
  const companies = Array.from({ length: 5 }, (_, index) => company(71 + index))
  const raw = `?compare=${companies.map((item) => item.company_id).join(',')}`
  const state = parseQuery(raw, companies.map((item) => item.company_id))
  const compared = state.compare.map((id) => companies.find((item) => item.company_id === id)!)

  render(<CompanyCompareTray companies={compared} details={[]} error={false} retry={() => undefined} remove={() => undefined} />)

  expect(state.notice).toBe(true)
  expect(screen.getByRole('heading', { name: '선택 기업 비교 · 4/4' })).toBeVisible()
  expect(screen.getAllByRole('button', { name: /비교 해제/ })).toHaveLength(4)
  expect(screen.queryByRole('button', { name: `${companies[4].display_name} 비교 해제` })).not.toBeInTheDocument()
})

it('does not disclose a raw reference statement as a compare benefit', () => {
  const rawStatement = '원시 참고 기록의 휴가 문장입니다.'
  const concrete = researchedCompany(31)
  concrete.category_outcomes[0] = researched('leave', 'reference', ['other_public_web'], { specific_benefit_count: 1 })
  const officialOnly = researchedCompany(32)
  officialOnly.category_outcomes[0] = researched('leave', 'official_verified', ['official_government'], { specific_benefit_count: 0 })
  for (const [index, category] of categories.entries()) if (index > 0) {
    concrete.category_outcomes[index] = researched(category, 'no_public_info', [], { specific_benefit_count: 0 })
    officialOnly.category_outcomes[index] = researched(category, 'no_public_info', [], { specific_benefit_count: 0 })
  }
  const detail = {
    company: { company_id: concrete.company_id },
    references: [{ reference_id: 'reference::full', category_id: 'leave', source_id: 'source::full', statement: rawStatement, publication_eligibility: 'reference_only' }],
    community_reports: [],
    sources: [{ source_id: 'source::full', publication_eligibility: 'reference_only' }],
  } as unknown as Detail
  const officialDetail = { company: { company_id: officialOnly.company_id }, references: [], community_reports: [], sources: [] } as unknown as Detail

  render(<CompanyCompareTray
    companies={[concrete, officialOnly]}
    details={[{ legacy: detail, approvedV2: detail }, { legacy: officialDetail, approvedV2: officialDetail }]}
    error={false}
    retry={() => undefined}
    remove={() => undefined}
    projectionActive
  />)

  expect(screen.queryByText(rawStatement)).not.toBeInTheDocument()
  expect(screen.queryByRole('group', { name: '혜택 내용 확인 1건' })).not.toBeInTheDocument()
  expect(screen.getAllByText('구체 혜택 확인 필요')).toHaveLength(2)
})

it('keeps an unbroken comparison statement intact and applies semantic wrapping to its list content', () => {
  const longToken = `benefit-${'x'.repeat(240)}`
  const item = researchedCompany(33)
  item.category_outcomes[0] = researched('leave', 'reference', ['other_public_web'], { specific_benefit_count: 1 })
  const detail = {
    company: { company_id: item.company_id },
    references: [{ reference_id: 'reference::long-compare', category_id: 'leave', source_id: 'source::long-compare', statement: longToken, publication_eligibility: 'reference_only' }],
    community_reports: [],
    verified_benefits: [{ benefit_id: `benefit::${'b'.repeat(64)}`, primary_category_id: 'leave', title: '긴 검증 혜택', description: longToken }],
    sources: [{ source_id: 'source::long-compare', publication_eligibility: 'reference_only' }],
  } as unknown as Detail

  render(<CompanyCompareTray companies={[item]} details={[{ legacy: detail, approvedV2: detail }]} error={false} retry={() => undefined} remove={() => undefined} projectionActive />)

  expect(screen.getByText(longToken)).toBeInTheDocument()
  const css = readFileSync('src/styles/benefits.css', 'utf8')
  expect(css).toMatch(/\.benefits-compare-specific\s+(?:ul|li)[^{]*\{[^}]*overflow-wrap:\s*anywhere/)
})

it('renders approved-v2 evidence in distinct official, reference and lower-tier community sections', () => {
  const detail = {
    official_claims: [{ claim_id: `official::${'a'.repeat(64)}`, category_id: 'leave', source_ids: ['source::official'], scope: { countries: ['KR'], legal_entities: ['Test Co'], roles: ['engineer'], employment_types: ['full-time'] }, scope_status: 'exact_entity', source_tier: 'official_government', conflict_status: 'none' }],
    references: [{ reference_id: 'reference::1', category_id: 'leave', source_id: 'source::reference', statement: '연차 휴가 제도를 안내합니다.', supporting_quote: '연차 휴가를 사용할 수 있습니다.', publication_eligibility: 'reference_only' }],
    community_reports: [{ community_report_id: 'community::1', category_id: 'leave', source_id: 'source::community', statement: '직원 커뮤니티의 휴가 사용 보고입니다.', publication_eligibility: 'eligible' }],
    sources: [
      { source_id: 'source::official', title: '고용노동부 공개 기록', url: 'https://official.example/record' },
      { source_id: 'source::reference', title: '기업 채용 안내', url: 'https://company.example/benefits', publication_eligibility: 'reference_only' },
      { source_id: 'source::community', title: '직원 커뮤니티 스냅샷', url: 'https://community.example/report', publication_eligibility: 'eligible' },
    ],
  } as unknown as Detail
  render(<><h2>추가 복지 조사 근거</h2><BenefitV2EvidenceGroup category="leave" detail={detail} /></>)
  expect(screen.getByRole('heading', { name: '추가 복지 조사 근거' })).toBeVisible()
  expect(screen.getByText('공식 자료 조사 맥락')).toBeVisible()
  expect(screen.getByText('참고 조사 근거 · 구체 혜택으로 집계하지 않음')).toBeVisible()
  expect(screen.queryByText('연차 휴가 제도를 안내합니다.')).not.toBeInTheDocument()
  expect(screen.queryByText('연차 휴가를 사용할 수 있습니다.')).not.toBeInTheDocument()
  expect(screen.getAllByText('원문 복지 항목은 분야·법인별로 분리 검토되지 않아 표시하지 않습니다.')).toHaveLength(2)
  expect(screen.getByText('커뮤니티 조사 맥락 · 구체 혜택으로 집계하지 않음')).toBeVisible()
  expect(screen.queryByText('직원 커뮤니티의 휴가 사용 보고입니다.')).not.toBeInTheDocument()
  expect(screen.getAllByRole('link')).toHaveLength(3)
  for (const link of screen.getAllByRole('link')) { expect(link).toHaveAttribute('target', '_blank'); expect(link).toHaveAttribute('rel', 'noopener noreferrer') }
})

it('does not repeat a multi-benefit source paragraph inside category-specific reference cards', () => {
  const manifest = JSON.parse(readFileSync('public/data/company-benefits/manifest.json', 'utf8'))
  const descriptor = manifest.approved_v2_projection.company_shards['KR-CRN-1101112948086']
  const detail = detailSchema.parse(JSON.parse(readFileSync(`public/${descriptor.url.replace(/^community\//, '')}`, 'utf8')))
  const broadQuote = detail.references?.find((record) => record.category_id === 'commute')?.supporting_quote
  const commuteStatement = detail.references?.find((record) => record.category_id === 'commute')?.statement
  expect(broadQuote).toContain('통근버스 운행')
  expect(broadQuote).toContain('자녀 학자금 지원')
  expect(commuteStatement).toContain('통근버스 지원')

  render(<BenefitV2EvidenceSection detail={detail} />)
  expect(screen.getByRole('heading', { name: '확인된 복지 혜택 (0건)' })).toBeVisible()
  expect(within(document.getElementById('commute')!).getByRole('heading', { name: '이동·통근' })).toBeVisible()
  expect(within(document.getElementById('family')!).getByRole('heading', { name: '육아·가족' })).toBeVisible()
  expect(document.body).not.toHaveTextContent(commuteStatement!)
  expect(within(document.getElementById('commute')!).queryByText(broadQuote!)).not.toBeInTheDocument()
  expect(within(document.getElementById('family')!).queryByText(broadQuote!)).not.toBeInTheDocument()
  expect(document.querySelectorAll('.benefits-evidence--reference blockquote')).toHaveLength(0)
  expect(within(document.getElementById('family')!).getAllByRole('link').length).toBeGreaterThan(0)
})

it('renders material reference and community evidence limitations with accessible Korean labels', () => {
  const detail = {
    official_claims: [],
    references: [{
      reference_id: 'reference::limited', category_id: 'leave', source_id: 'source::reference', statement: '과거 그룹 단위 참고 자료입니다.', supporting_quote: '휴가 제도 운영',
      reliability: 'low', currentness: 'historical', scope: { status: 'group_only', countries: ['KR'], legal_entities: ['Test Group'], roles: ['engineer'], employment_types: ['full-time'] }, conflict_status: 'contradictory', publication_eligibility: 'reference_only',
    }],
    community_reports: [{
      community_report_id: 'community::limited', category_id: 'leave', source_id: 'source::community', statement: '범위 미확인 커뮤니티 보고입니다.',
      reliability: 'low', currentness: 'unknown', scope_status: 'unresolved', scope: { countries: ['KR'], legal_entities: [], roles: [], employment_types: [] }, conflict_status: 'disclosed', publication_eligibility: 'eligible',
    }],
    sources: [
      { source_id: 'source::reference', title: '과거 참고 자료', url: 'https://reference.example/benefits', publication_eligibility: 'reference_only' },
      { source_id: 'source::community', title: '커뮤니티 스냅샷', url: 'https://community.example/report', publication_eligibility: 'eligible' },
    ],
  } as unknown as Detail
  render(<BenefitV2EvidenceGroup category="leave" detail={detail} />)
  const reference = screen.getByRole('article', { name: /참고 자료 1.*참고 조사 근거 1번/ })
  expect(reference).toHaveTextContent('신뢰도: 낮음')
  expect(reference).toHaveTextContent('현재성: 과거 정보')
  expect(reference).toHaveTextContent('적용 범위 상태: 그룹 단위')
  expect(reference).toHaveTextContent('법인 Test Group')
  expect(reference).toHaveTextContent('상충 상태: 모순됨')
  const community = screen.getByRole('article', { name: /커뮤니티 자료 1.*커뮤니티 조사 맥락 1번/ })
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
    references: [{ reference_id: 'reference::1', category_id: 'leave', source_id: 'source::reference', statement: '참고 자료입니다.', supporting_quote: '근거 인용문', publication_eligibility: 'reference_only' }],
    community_reports: [],
    sources: [{ source_id: 'source::reference', title: '안전하지 않은 출처', url, publication_eligibility: 'reference_only' }],
  } as unknown as Detail
  render(<BenefitV2EvidenceGroup category="leave" detail={detail} />)
  expect(screen.getByRole('article', { name: /참고 자료 1.*참고 조사 근거 1번/ })).toHaveTextContent('원문 복지 항목은 분야·법인별로 분리 검토되지 않아 표시하지 않습니다.')
  expect(screen.queryByRole('link', { name: /안전하지 않은 출처/ })).not.toBeInTheDocument()
  expect(document.querySelectorAll('a')).toHaveLength(0)
})

it('shows zero concrete benefits when raw publishable records have no verified propositions', () => {
  const detail = {
    official_claims: [],
    references: [{
      reference_id: 'reference::canonical-1', category_id: 'leave', source_id: 'source::reference',
      statement: '매년 유급 휴가 20일을 지원합니다.', supporting_quote: '정규직은 연간 20일의 유급 휴가를 사용할 수 있습니다.',
      reliability: 'medium', currentness: 'current', scope: { status: 'exact_entity', countries: ['KR'], legal_entities: ['Test Co'], roles: ['engineer'], employment_types: ['full-time'] },
      conflict_status: 'none', publication_eligibility: 'reference_only',
    }],
    community_reports: [{
      community_report_id: 'community::canonical-1', category_id: 'leave', source_id: 'source::community',
      statement: '직원들이 반차를 사용할 수 있다고 보고했습니다.', reliability: 'low', currentness: 'current', scope_status: 'exact_entity',
      scope: { countries: ['KR'], legal_entities: ['Test Co'], roles: ['engineer'], employment_types: ['full-time'] }, conflict_status: 'disclosed', publication_eligibility: 'eligible',
    }],
    sources: [
      { source_id: 'source::reference', title: '채용 복지 안내', url: 'https://company.example/benefits', publication_eligibility: 'reference_only' },
      { source_id: 'source::community', title: '직원 보고 스냅샷', url: 'https://community.example/report', publication_eligibility: 'eligible' },
    ],
  } as unknown as Detail

  render(<BenefitV2EvidenceSection detail={detail} />)

  expect(screen.getByRole('heading', { name: '확인된 복지 혜택 (0건)' })).toBeVisible()
  expect(screen.queryByRole('article', { name: /구체 혜택/ })).not.toBeInTheDocument()
  expect(screen.getByText(/재검증 중.*구체 혜택 확인 필요/)).toBeVisible()
  expect(screen.queryByText('매년 유급 휴가 20일을 지원합니다.')).not.toBeInTheDocument()
  expect(screen.queryByText('직원들이 반차를 사용할 수 있다고 보고했습니다.')).not.toBeInTheDocument()
  expect(screen.getAllByText('원문 복지 항목은 분야·법인별로 분리 검토되지 않아 표시하지 않습니다.')).toHaveLength(2)
  for (const link of screen.getAllByRole('link')) {
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  }
})

function independentlyReviewedDetailFixture(item: CompanyListing, verifiedStatement: string) {
  const canonicalJson = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
    if (value && typeof value === 'object') return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`
    return JSON.stringify(value)
  }
  const sha256 = (value: unknown) => createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')
  const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')
  const canonicalScope = (scope: Record<string, string[]>) => Object.fromEntries(Object.entries(scope).map(([key, values]) => [key, values.map(normalize).sort()]))
  const checkedAt = '2026-11-01T00:00:00Z'
  const categoryScope = { countries: ['KR'], legal_entities: ['Test Co'], roles: [], employment_types: ['full-time'], tenure_conditions: [] }
  const evidenceScope = { countries: ['KR'], legal_entities: ['Test Co'], roles: [], employment_types: ['full-time'] }
  const benefitBase = {
    company_id: item.company_id,
    primary_category_id: 'leave',
    title: '연간 20일 유급 휴가',
    description: verifiedStatement,
    scope: { ...evidenceScope, family_members: ['배우자'], conditions: ['입사 3개월 이상'] },
    currentness: 'historical',
    currentness_checked_at: checkedAt,
    conflict_status: 'disclosed',
    evidence_ids: ['reference::verified'],
  }
  const proposition_sha256 = sha256({
    company_id: benefitBase.company_id,
    title: normalize(benefitBase.title),
    description: normalize(benefitBase.description),
    scope: canonicalScope(benefitBase.scope),
    currentness: benefitBase.currentness,
    currentness_checked_at: benefitBase.currentness_checked_at,
    conflict_status: benefitBase.conflict_status,
  })
  const candidateBenefit = { benefit_id: `benefit::${proposition_sha256}`, proposition_sha256, ...benefitBase }
  const reviewBinding = { reviewer_receipt_sha256: 'd'.repeat(64), reviewed_candidate_sha256: sha256([candidateBenefit]), reviewed_at: checkedAt }
  const emptyOutcome = (category_id: (typeof categories)[number]) => ({
    category_id, state: 'no_public_info', source_tiers: [], official_claim_ids: [], reference_ids: [], community_report_ids: [],
    official_claim_count: 0, reference_count: 0, community_report_count: 0, reliability: 'none', currentness: 'unknown', scope_status: 'unresolved', conflict_status: 'none',
    publication_eligibility: 'discovery_only', assessed_at: checkedAt, kind: 'insufficient_evidence', status: 'insufficient_evidence', claim_count: 0, benefit_type_count: 0,
    specific_benefit_count: 0, scope: categoryScope, limitation_codes: ['scope_limit', 'currentness_limit'], last_checked_at: checkedAt,
    nonabsence_notice: notice, reason_code: 'searched_not_found', searched_source_ids: [], searched_at: checkedAt,
  })
  const category_outcomes = categories.map((category) => category === 'leave' ? {
    category_id: category, state: 'reference', source_tiers: ['other_public_web'], official_claim_ids: [], reference_ids: ['reference::verified'], community_report_ids: [],
    official_claim_count: 0, reference_count: 1, community_report_count: 0, reliability: 'medium', currentness: 'current', scope_status: 'exact_entity', conflict_status: 'none',
    publication_eligibility: 'reference_only', assessed_at: checkedAt, kind: 'evidenced', status: 'confirmed', claim_count: 1, benefit_type_count: 1,
    specific_benefit_count: 1, scope: categoryScope, limitation_codes: ['lower_tier_evidence'], last_checked_at: checkedAt, searched_source_ids: [],
  } : emptyOutcome(category))

  return detailSchema.parse({
    schema_version: 1, artifact_kind: 'company_detail', artifact_protocol: 'vNext', data_version: 'v2', taxonomy_version: 'benefit-taxonomy-v1',
    company: {
      company_id: item.company_id, population_sequence: item.population_sequence, legal_name: item.legal_name, scope: item.scope, jurisdiction: item.jurisdiction,
      registry_id: '34', selected_reporting_legal_entity: item.selected_reporting_legal_entity, incorporation_country: item.incorporation_country,
      registered_head_office_country: item.registered_head_office_country, financial_consolidation_parent: { kind: 'unknown', reason: 'unknown' },
      ultimate_parent: { kind: 'unknown', reason: 'unknown' }, benefit_policy_owner: { kind: 'unknown', reason: 'unknown' }, sector: item.sector,
      employment_evidence_scope: '', employment_boundary_note: '',
    },
    category_outcomes, claims: [], official_claims: [],
    references: [{
      reference_id: 'reference::verified', cell_id: `cell::${item.company_id}::leave`, company_id: item.company_id, category_id: 'leave',
      source_id: 'source::verified', source_tier: 'other_public_web', statement: '검토 전 원시 문장', supporting_quote: '연간 20일 유급 휴가',
      source_locator: 'https://company.example/benefits', reliability: 'medium', currentness: 'current', scope: { status: 'exact_entity', ...evidenceScope },
      conflict_status: 'none', publication_eligibility: 'reference_only', checked_at: checkedAt,
    }],
    community_reports: [], verified_benefit_review_binding: reviewBinding,
    verified_benefits: [{ ...candidateBenefit, review: { status: 'independently_reviewed', ...reviewBinding } }],
    sources: [{
      source_id: 'source::verified', source_tier: 'other_public_web', title: '채용 복지 안내', url: 'https://company.example/benefits', retrieved_at: checkedAt,
      content_sha256: 'e'.repeat(64), reliability: 'medium', currentness: 'current', scope_status: 'exact_entity', scope: evidenceScope,
      conflict_status: 'none', publication_eligibility: 'reference_only',
    }],
  })
}

it('shows not-researched and unresolved cells as neutral without verified cards or absence', () => {
  const item = researchedCompany(34)
  const detail = independentlyReviewedDetailFixture(item, '검토된 혜택')
  const states = ['not_researched', 'research_incomplete', 'source_access_failed', 'conflicting_evidence'] as const
  const category_outcomes = detail.category_outcomes.map((outcome, index) => index < states.length ? {
    ...outcome, state: states[index], reason_code: states[index], searched_at: index ? '2026-11-01T00:00:00Z' : null,
    nonabsence_notice: '이번 조사에서 게시 가능한 공식 복지 근거를 확보하지 못했습니다. 복지가 없다는 뜻이 아닙니다.',
    conflict_status: index === 3 ? 'contradictory' : 'none',
    limitation_codes: index === 3 ? ['scope_limit', 'currentness_limit', 'conflicting_evidence'] : ['scope_limit', 'currentness_limit'],
    source_tiers: [], official_claim_ids: [], reference_ids: [], community_report_ids: [],
    official_claim_count: 0, reference_count: 0, community_report_count: 0,
    reliability: 'none', currentness: 'unknown', scope_status: 'unresolved', publication_eligibility: 'discovery_only',
    kind: 'insufficient_evidence', status: 'insufficient_evidence', claim_count: 0, benefit_type_count: 0, specific_benefit_count: 0,
    searched_source_ids: [],
  } : outcome)
  const unresolved = detailSchema.parse({ ...detail, category_outcomes, verified_benefits: [], verified_benefit_review_binding: undefined, references: [], sources: [] })
  render(<BenefitV2EvidenceSection detail={unresolved} />)
  expect(screen.getByRole('heading', { name: '확인된 복지 혜택 (0건)' })).toBeVisible()
  expect(screen.queryByRole('article', { name: /구체 혜택/ })).not.toBeInTheDocument()
  expect(document.getElementById('leave')).toHaveTextContent('조사를 시작하지 않았습니다. 복지가 없다는 뜻이 아닙니다.')
  expect(document.getElementById('family')).toHaveTextContent('현재까지 게시 가능한 공개 복지 자료를 확인하지 못했습니다. 조사 미완료이며 복지가 없다는 뜻이 아닙니다.')
  expect(document.getElementById('health')).toHaveTextContent('출처에 접근하지 못해 공개 복지 자료를 확인할 수 없습니다. 복지가 없다는 뜻이 아닙니다.')
  expect(document.getElementById('growth')).toHaveTextContent('공개 근거가 상충하여 혜택을 확인하지 못했습니다. 복지가 없다는 뜻이 아닙니다.')
  for (const category of ['leave', 'family', 'health', 'growth']) expect(document.getElementById(category)).not.toHaveTextContent('이번 조사에서 게시 가능한 공개 정보를 확인하지 못했습니다')
})

it('renders exactly one verified proposition as one concrete card and compare statement', () => {
  const item = researchedCompany(34)
  item.category_outcomes[0] = researched('leave', 'reference', ['other_public_web'], { specific_benefit_count: 1 })
  const verifiedStatement = '정규직에게 연간 20일의 유급 휴가를 제공합니다.'
  const detail = independentlyReviewedDetailFixture(item, verifiedStatement)

  render(<><BenefitV2EvidenceSection detail={detail} /><CompanyCompareTray companies={[item]} details={[{ legacy: detail, approvedV2: detail }]} error={false} retry={() => undefined} remove={() => undefined} projectionActive /></>)

  expect(screen.getByRole('heading', { name: '확인된 복지 혜택 (1건)' })).toBeVisible()
  const card = screen.getByRole('article', { name: /연간 20일 유급 휴가.*구체 혜택/ })
  expect(card).toHaveTextContent('현재성: 과거 정보')
  expect(card).toHaveTextContent('적용 범위: 국가 KR · 법인 Test Co · 직군 명시되지 않음 · 고용형태 full-time · 가족 구성원 배우자 · 조건 입사 3개월 이상')
  expect(card).toHaveTextContent('현재성 확인일: 2026년 11월 1일')
  expect(card).toHaveTextContent('상충 상태: 상충 정보 공개됨')
  expect(card).not.toHaveTextContent('적용 범위 상태:')
  expect(screen.getAllByText(verifiedStatement)).toHaveLength(2)
  expect(screen.getByRole('group', { name: '혜택 내용 확인 1건' })).toBeInTheDocument()
})

it('keeps official-only evidence as verification context and excludes it from confirmed benefits', () => {
  const detail = {
    official_claims: [{
      claim_id: `official::${'a'.repeat(64)}`, category_id: 'leave', source_ids: ['source::official'],
      scope: { countries: ['KR'], legal_entities: ['Test Co'], roles: ['engineer'], employment_types: ['full-time'] },
    }],
    references: [], community_reports: [],
    sources: [{ source_id: 'source::official', title: '정부 공개 기록', url: 'https://official.example/record', publication_eligibility: 'eligible' }],
  } as unknown as Detail

  render(<BenefitV2EvidenceSection detail={detail} />)

  expect(screen.getByRole('heading', { name: '확인된 복지 혜택 (0건)' })).toBeVisible()
  expect(screen.queryByRole('article', { name: /구체 혜택/ })).not.toBeInTheDocument()
  expect(screen.getByText('재검증 중 — 구체 혜택 확인 필요')).toBeVisible()
  expect(screen.getByRole('article', { name: '휴가·근무시간 공식 자료 조사 맥락' })).toHaveTextContent('정부 공개 기록')
})

it('gives repeated reference and community cards unique heading-based accessible names', () => {
  const scope = { countries: ['KR'], legal_entities: ['Test Co'], roles: ['engineer'], employment_types: ['full-time'] }
  const detail = {
    official_claims: [],
    references: [1, 2].map((number) => ({
      reference_id: `reference::${number}`, category_id: 'leave', source_id: 'source::shared', statement: '동일한 휴가 혜택을 제공합니다.', supporting_quote: `근거 ${number}`,
      reliability: 'medium', currentness: 'current', scope: { ...scope, status: 'exact_entity' }, conflict_status: 'none', publication_eligibility: 'reference_only',
    })),
    community_reports: [1, 2].map((number) => ({
      community_report_id: `community::${number}`, category_id: 'leave', source_id: 'source::community', statement: '동일한 휴가 혜택을 제공합니다.',
      reliability: 'low', currentness: 'current', scope_status: 'exact_entity', scope, conflict_status: 'none', publication_eligibility: 'eligible',
    })),
    sources: [
      { source_id: 'source::shared', title: '공유 참고 자료', url: 'https://reference.example/shared', publication_eligibility: 'reference_only' },
      { source_id: 'source::community', title: '공유 커뮤니티 자료', url: 'https://community.example/shared', publication_eligibility: 'eligible' },
    ],
  } as unknown as Detail

  render(<BenefitV2EvidenceSection detail={detail} />)

  const cards = screen.getAllByRole('article', { name: /(?:참고 자료|커뮤니티 자료) [12]/ })
  expect(cards).toHaveLength(4)
  const headingIds = cards.map((card) => card.getAttribute('aria-labelledby'))
  expect(headingIds.every(Boolean)).toBe(true)
  expect(new Set(headingIds).size).toBe(4)
  expect(new Set(cards.map((card) => document.getElementById(card.getAttribute('aria-labelledby')!)?.textContent)).size).toBe(4)
  for (const headingId of headingIds) expect(document.getElementById(headingId!)).toHaveAttribute('id', headingId)
})

it('does not present a long unreviewed reference statement or quote as a benefit', () => {
  const longToken = `benefit-${'x'.repeat(240)}`
  const detail = {
    official_claims: [],
    references: [{ reference_id: 'reference::long', category_id: 'leave', source_id: 'source::long', statement: longToken, supporting_quote: longToken, publication_eligibility: 'reference_only' }],
    community_reports: [],
    sources: [{ source_id: 'source::long', title: '긴 자료', url: 'https://reference.example/long', publication_eligibility: 'reference_only' }],
  } as unknown as Detail

  render(<BenefitV2EvidenceGroup category="leave" detail={detail} />)

  expect(screen.queryByText(longToken)).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '출처: 긴 자료' })).toBeVisible()
  const css = readFileSync('src/styles/benefits.css', 'utf8')
  expect(css).toContain(`.benefits-specific-card h4,
.benefits-specific-card blockquote {
  overflow-wrap: anywhere;
  word-break: break-word;
}`)
})

it('precomputes safe sources and category records once for the full evidence section', () => {
  let urlReads = 0
  let referenceCategoryReads = 0
  let officialCategoryReads = 0
  const source = { source_id: 'source::once', title: '한 번 읽는 출처', publication_eligibility: 'reference_only' }
  Object.defineProperty(source, 'url', { enumerable: true, get: () => { urlReads += 1; return 'https://reference.example/once' } })
  const reference = { reference_id: 'reference::once', source_id: 'source::once', statement: '한 번 분류하는 혜택', supporting_quote: '한 번 분류하는 근거', publication_eligibility: 'reference_only' }
  Object.defineProperty(reference, 'category_id', { enumerable: true, get: () => { referenceCategoryReads += 1; return 'leave' } })
  const official = { claim_id: `official::${'b'.repeat(64)}`, source_ids: ['source::once'], scope: { countries: ['KR'], legal_entities: [], roles: [], employment_types: [] } }
  Object.defineProperty(official, 'category_id', { enumerable: true, get: () => { officialCategoryReads += 1; return 'leave' } })
  const detail = { official_claims: [official], references: [reference], community_reports: [], sources: [source] } as unknown as Detail

  render(<BenefitV2EvidenceSection detail={detail} />)

  expect(urlReads).toBe(1)
  expect(referenceCategoryReads).toBe(1)
  expect(officialCategoryReads).toBe(1)
})

it('renders multiple official sources as a distinct semantic list', () => {
  const detail = {
    official_claims: [{
      claim_id: `official::${'c'.repeat(64)}`, category_id: 'leave', source_ids: ['source::one', 'source::two'],
      scope: { countries: ['KR'], legal_entities: ['Test Co'], roles: [], employment_types: [] },
    }],
    references: [], community_reports: [],
    sources: [
      { source_id: 'source::one', title: '첫 번째 공식 출처', url: 'https://official.example/one', publication_eligibility: 'eligible' },
      { source_id: 'source::two', title: '두 번째 공식 출처', url: 'https://official.example/two', publication_eligibility: 'eligible' },
    ],
  } as unknown as Detail

  render(<BenefitV2EvidenceGroup category="leave" detail={detail} />)

  const article = screen.getByRole('article', { name: '휴가·근무시간 공식 자료 조사 맥락' })
  const sourceList = within(article).getByRole('list')
  expect(within(sourceList).getAllByRole('listitem')).toHaveLength(2)
  expect(within(sourceList).getByRole('link', { name: '첫 번째 공식 출처' })).toHaveAttribute('href', 'https://official.example/one')
  expect(within(sourceList).getByRole('link', { name: '두 번째 공식 출처' })).toHaveAttribute('href', 'https://official.example/two')
})
