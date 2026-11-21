import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { App } from './App'
import { AuthContext, type AuthContextValue } from './auth/AuthProvider'
import { BenefitsExplorerShell } from './components/benefits/BenefitsExplorerShell'
import { BenefitsHeatmapTable } from './components/benefits/BenefitsHeatmapTable'
import { BenefitsFilterPanel } from './components/benefits/BenefitsFilterPanel'
import { buildResearchLeadIndex, parseQuery } from './lib/benefitsQueryState'
import { benefitsClient, type BenefitAtlasData } from './data/benefitsArtifactClient'
import manifestFixture from '../public/data/company-benefits/manifest.json'
import researchManifestFixture from '../public/data/company-benefits/research-leads-v1/manifest.json'
import { categories, companyListingSchema, manifestSchema, researchLeadSchema, researchManifestSchema, type CompanyListing, type Manifest } from './types/benefits'
vi.mock('./pages/BenefitsExplorerPage', () => ({
  BenefitsExplorerPage: ({
    route,
    search,
  }: {
    route: string
    search: string
  }) => (
    <main>
      <h1>복지 {route}</h1>
      <p>{search}</p>
    </main>
  ),
}))
const loadingAuth = {
  loading: true,
  pending: false,
  session: null,
  user: null,
  error: null,
  signIn: vi.fn(),
  signOut: vi.fn(),
  invalidateStaleSession: vi.fn(),
} as AuthContextValue
it('preserves header/footer in the public lazy fallback', async () => {
  render(
    <AuthContext.Provider value={loadingAuth}>
      <App pathname="/community/benefits/" search="?scope=domestic" />
    </AuthContext.Provider>,
  )
  expect(screen.getByRole('status')).toHaveTextContent(
    '복지 탐색기를 준비하고 있습니다.',
  )
  expect(screen.getByRole('banner')).toBeInTheDocument()
  expect(screen.getByRole('contentinfo')).toBeInTheDocument()
  expect(
    await screen.findByRole('heading', { name: '복지 heatmap' }),
  ).toBeVisible()
  expect(screen.getByText('?scope=domestic')).toBeVisible()
})
it.each([
  ['/community/benefits', 'heatmap'],
  ['/community/benefits/fit/', 'fit'],
  ['/community/benefits/company/', 'company'],
])(
  'forwards public route %s while auth initializes',
  async (pathname, route) => {
    render(
      <AuthContext.Provider value={loadingAuth}>
        <App pathname={pathname} search="?q=예시" />
      </AuthContext.Provider>,
    )
    expect(
      await screen.findByRole('heading', { name: `복지 ${route}` }),
    ).toBeVisible()
    expect(screen.getByText('?q=예시')).toBeVisible()
  },
)

it('keeps correction pages behind Community authentication initialization', () => {
  render(
    <AuthContext.Provider value={loadingAuth}>
      <App pathname="/community/benefits/correction/" search="?company=KR-CRN-1101112948086" />
    </AuthContext.Provider>,
  )
  expect(screen.getByRole('status')).toHaveTextContent('로그인 상태를 확인하고 있습니다.')
  expect(screen.queryByText('복지 heatmap')).not.toBeInTheDocument()
})

it('keeps exactly two primary Benefit Atlas links and preserves methodology query state', () => {
  render(
    <BenefitsExplorerShell route="methodology" query="?q=예시">
      <p>탐색 결과</p>
    </BenefitsExplorerShell>,
  )

  expect(screen.getByRole('heading', { level: 1, name: 'Benefit Atlas' })).toBeVisible()
  expect(screen.queryByText('기업 복지 탐색기')).not.toBeInTheDocument()
  const primaryNavigation = screen.getByRole('navigation', { name: '복지 탐색 화면' })
  expect(within(primaryNavigation).getAllByRole('link')).toHaveLength(2)
  expect(within(primaryNavigation).getByRole('link', { name: '기업 검색' })).toHaveAttribute('href', '/benefits/')
  expect(within(primaryNavigation).getByRole('link', { name: '기업 검색' })).not.toHaveAttribute('aria-current')
  expect(within(primaryNavigation).getByRole('link', { name: '조사 기준' })).toHaveAttribute('href', '/community/benefits/methodology/?q=예시')
  expect(within(primaryNavigation).getByRole('link', { name: '조사 기준' })).toHaveAttribute('aria-current', 'page')
  expect(within(primaryNavigation).queryByRole('link', { name: '복지 현황' })).not.toBeInTheDocument()
  expect(within(primaryNavigation).queryByRole('link', { name: '조건 탐색' })).not.toBeInTheDocument()
})

it.each([
  ['directory', '기업 검색'],
  ['methodology', '조사 기준'],
] as const)('marks only the exact %s primary route current', (route, currentLabel) => {
  render(<BenefitsExplorerShell route={route} query=""><p>탐색 결과</p></BenefitsExplorerShell>)
  const primaryNavigation = screen.getByRole('navigation', { name: '복지 탐색 화면' })
  const links = within(primaryNavigation).getAllByRole('link')
  expect(links.filter(link => link.getAttribute('aria-current') === 'page')).toHaveLength(1)
  expect(within(primaryNavigation).getByRole('link', { name: currentLabel })).toHaveAttribute('aria-current', 'page')
})

it('renders the Benefit Atlas evidence banner outside the explorer workspace with manifest facts', () => {
  const manifest = {
    data_version: 'company-benefits-2026-10-31-v1',
    company_count: 2000,
    generated_at: '2026-10-31T14:59:59Z',
  } as unknown as Manifest
  const { container } = render(
    <BenefitsExplorerShell route="heatmap" query="" manifest={manifest}>
      <p>탐색 결과</p>
    </BenefitsExplorerShell>,
  )

  const hero = container.querySelector<HTMLElement>('.benefit-atlas-hero')
  const workspace = container.querySelector<HTMLElement>('.benefits-workspace')
  const heading = screen.getByRole('heading', { level: 1, name: 'Benefit Atlas' })

  expect(hero).toBeInTheDocument()
  expect(hero).toContainElement(heading)
  expect(hero?.querySelector('.benefit-atlas-hero__inner')).toHaveClass('community-wrap')
  expect(container.querySelectorAll('h1')).toHaveLength(1)
  expect(hero?.parentElement).toBe(workspace?.parentElement)
  expect(hero?.nextElementSibling).toBe(workspace)
  expect(workspace).not.toContainElement(hero)
  expect(hero).toHaveTextContent('공개 근거')
  expect(hero).toHaveTextContent('기준 명부 2,000개 기업')
  expect(hero).not.toHaveTextContent(/2026-10-31|생성일/)
})

it('labels research coverage without claiming approved benefits', () => {
  const manifest = {
    data_version: 'company-benefits-2026-10-31-v1', company_count: 2000, generated_at: '2026-10-31T14:59:59Z',
    approved_v2_projection: { approved_batch_count: 38, total_batch_count: 80, projected_company_count: 950, total_company_count: 2000, verified_proposition_count: 0 },
  } as unknown as Manifest
  render(<BenefitsExplorerShell route="heatmap" query="" manifest={manifest}><p>탐색 결과</p></BenefitsExplorerShell>)
  expect(screen.getByText('추가 복지 조사 · 전체 80개 중 38개 batch · 950/2,000개 기업 · 확인된 혜택 0건')).toBeVisible()
  expect(screen.queryByText(/승인 v2 조사/)).not.toBeInTheDocument()
})

it('does not invent a verified-benefit count for an older projection without that field', () => {
  const manifest = {
    data_version: 'company-benefits-2026-10-31-v1', company_count: 2000, generated_at: '2026-10-31T14:59:59Z',
    approved_v2_projection: { approved_batch_count: 38, total_batch_count: 80, projected_company_count: 950, total_company_count: 2000 },
  } as unknown as Manifest
  render(<BenefitsExplorerShell route="heatmap" query="" manifest={manifest}><p>탐색 결과</p></BenefitsExplorerShell>)
  expect(screen.getByText(/혜택 검증 수 미집계/)).toBeVisible()
  expect(screen.queryByText(/확인된 혜택 0건/)).not.toBeInTheDocument()
})

it('keeps research counts separate from population, projection and verified benefits', () => {
  const manifest = { data_version: 'v1', company_count: 2000, generated_at: '2026-10-31T14:59:59Z', approved_v2_projection: { approved_batch_count: 38, total_batch_count: 80, projected_company_count: 950, total_company_count: 2000, verified_proposition_count: 0 } } as unknown as Manifest
  render(<BenefitsExplorerShell route="heatmap" query="" manifest={manifest} researchSummary={{ companies: 12, items: 128 }}><p>탐색 결과</p></BenefitsExplorerShell>)
  expect(screen.getByText(/구체적 조사 항목 128건 · 12개 기업/)).toBeVisible()
  expect(screen.getByText(/확인된 혜택 0건/)).toBeVisible()
  expect(screen.getByText(/950\/2,000개 기업/)).toBeVisible()
})

it('labels research cells as research rather than approved evidence and links to the research category', () => {
  const company = { company_id: 'KR-CRN-1101112948086', population_sequence: 1, legal_name: 'Test', display_name: 'Test', scope: 'domestic', jurisdiction: 'KR', incorporation_country: 'KR', registered_head_office_country: 'KR', selected_reporting_legal_entity: 'Test', sector: 'non_financial', category_outcomes: categories.map((category) => ({ kind: 'insufficient_evidence', category_id: category, reason_code: 'not_researched', nonabsence_notice: '이번 조사에서 게시 가능한 공식 복지 근거를 확보하지 못했습니다. 복지가 없다는 뜻이 아닙니다.', searched_source_ids: [], searched_at: null })) } as CompanyListing
  const lead = researchLeadSchema.parse({ company_id: company.company_id, primary_category: 'leave', benefit_action: '유급 휴가 지원', source_url: 'https://example.org/benefits', source_registry_id: 'registry::1', source_text_sha256: 'a'.repeat(64), scope: { legal_entity: 'Test', roles: 'all', employment_types: ['full_time'], conditions: { tenure: 'one year' } }, currentness: 'unknown', observed_at: '2026-11-19T00:00:00Z', limitations: ['조사 단계'], status: 'research_only' })
  render(<BenefitsHeatmapTable companies={[company]} selectedCategories={['leave']} compare={[]} toggle={() => undefined} link={(id, category) => `/community/benefits/company/?id=${id}${category ? `#${category}` : ''}`} researchIndex={buildResearchLeadIndex([lead])} projectionActive />)
  expect(screen.getByRole('link', { name: /조사 중 1건/ })).toHaveAttribute('href', `/community/benefits/company/?id=${company.company_id}#research-leave`)
  expect(screen.queryByText('확인된 혜택 1건')).not.toBeInTheDocument()
})

it('offers truthful data modes and resets to research', () => {
  const update = vi.fn()
  render(<BenefitsFilterPanel state={parseQuery('?evidence=all')} update={update} companies={[]} />)
  expect(screen.getByRole('option', { name: '구체적 조사 항목 있는 기업' })).toBeInTheDocument()
  expect(screen.getByRole('option', { name: '전체 조사 기업' })).toBeInTheDocument()
  screen.getByRole('button', { name: '필터 초기화' }).click()
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ evidence: 'research', page: 1 }))
})

it('hides legacy status choices in research mode and clears them when switching modes', () => {
  const update = vi.fn()
  const view = render(<BenefitsFilterPanel state={parseQuery('?evidence=all&statuses=insufficient_evidence')} update={update} companies={[]} />)
  expect(screen.getByRole('group', { name: '근거 상태' })).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('자료 표시'), { target: { value: 'research' } })
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ evidence: 'research', statuses: [], page: 1 }))
  view.rerender(<BenefitsFilterPanel state={parseQuery('?evidence=research&statuses=insufficient_evidence')} update={update} companies={[]} />)
  expect(screen.queryByRole('group', { name: '근거 상태' })).not.toBeInTheDocument()
})

it('shows the status selection on a legacy status-only bookmark', () => {
  render(<BenefitsFilterPanel state={parseQuery('?statuses=confirmed')} update={vi.fn()} companies={[]} />)
  expect(screen.getByRole('combobox', { name: '자료 표시' })).toHaveValue('verified')
  expect(screen.getByRole('checkbox', { name: '확인됨' })).toBeChecked()
})

it('explains an empty research category and offers all companies without discarding its category', async () => {
  const { BenefitsExplorerPage } = await vi.importActual<typeof import('./pages/BenefitsExplorerPage')>('./pages/BenefitsExplorerPage')
  const company = companyListingSchema.parse({ company_id: 'KR-CRN-1101112948086', population_sequence: 1, legal_name: 'Test', display_name: 'Test', scope: 'domestic', jurisdiction: 'KR', incorporation_country: 'KR', registered_head_office_country: 'KR', selected_reporting_legal_entity: 'Test', sector: 'non_financial', category_outcomes: categories.map((category) => ({ kind: 'insufficient_evidence', category_id: category, reason_code: 'not_researched', nonabsence_notice: '이번 조사에서 게시 가능한 공식 복지 근거를 확보하지 못했습니다. 복지가 없다는 뜻이 아닙니다.', searched_source_ids: [], searched_at: null })) })
  const lead = researchLeadSchema.parse({ company_id: company.company_id, primary_category: 'leave', benefit_action: '유급 휴가 지원', source_url: 'https://example.org/benefits', source_registry_id: 'registry::1', source_text_sha256: 'a'.repeat(64), scope: { legal_entity: 'Test', roles: 'all', employment_types: ['full_time'], conditions: { tenure: 'one year' } }, currentness: 'unknown', observed_at: '2026-11-19T00:00:00Z', limitations: ['조사 단계'], status: 'research_only' })
  const listing = { ...company, lineage: { legacy: company } }
  const atlas: BenefitAtlasData = { manifest: manifestSchema.parse(manifestFixture), companies: [listing], research: { manifest: researchManifestSchema.parse(researchManifestFixture), leads: [lead], companyIds: [company.company_id] } }
  const load = vi.spyOn(benefitsClient, 'loadAtlas').mockResolvedValue(atlas)
  const original = window.location.href
  window.history.replaceState({}, '', '/community/benefits/?categories=commute')
  try {
    render(<BenefitsExplorerPage route="heatmap" search="?categories=commute" />)
    expect(await screen.findByText(/이동·통근.*구체적 조사 항목/)).toBeVisible()
    expect(screen.getByText(/복지가 없다는 뜻이 아닙니다/)).toBeVisible()
    expect(screen.getByRole('checkbox', { name: '이동·통근' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '전체 조사 기업 보기' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: '자료 표시' })).toHaveValue('all'))
    expect(screen.getByRole('checkbox', { name: '이동·통근' })).toBeChecked()
    expect(window.location.search).toContain('categories=commute')
  } finally {
    load.mockRestore()
    window.history.replaceState({}, '', original)
  }
})
