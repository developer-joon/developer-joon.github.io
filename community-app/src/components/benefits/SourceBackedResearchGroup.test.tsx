import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { SourceBackedResearchGroup } from './SourceBackedResearchGroup'
import { afterEach, expect, it, vi } from 'vitest'
import { detailSchema, listingChunkSchema, researchLeadSchema, type BenefitCompanyView, type ResearchLead } from '../../types/benefits'
import { BenefitsCompanyPage } from '../../pages/BenefitsCompanyPage'
import { benefitsClient, type BenefitAtlasData, type BenefitCompanyDetailView } from '../../data/benefitsArtifactClient'
import { parseQuery } from '../../lib/benefitsQueryState'

const item = {
  company_id: 'KR-CRN-1101110193740', legal_name: '에이치엠엠(주)', display_name: '에이치엠엠',
  selected_reporting_legal_entity: '에이치엠엠(주)', scope: 'domestic', jurisdiction: 'KR', registered_head_office_country: 'KR', sector: 'non_financial',
  lineage: { legacy: { category_outcomes: [] } },
} as unknown as BenefitCompanyView
const lead = (action: string, category: 'commute' | 'family', scope: Record<string, unknown> = {}): ResearchLead => researchLeadSchema.parse({
  company_id: item.company_id, primary_category: category, benefit_action: action,
  source_url: 'https://company.example/benefits', source_registry_id: 'company-benefits::entry', source_text_sha256: 'a'.repeat(64),
  scope: { legal_entity: item.legal_name, roles: ['engineer', 'designer'], employment_types: 'full-time', conditions: { tenure: '1년', covered_persons: '본인' }, ...scope },
  currentness: 'unknown', observed_at: '2026-11-19T00:00:00Z',
  limitations: ['2025년 보고서 기반; 현재 운영 여부 미확인', '법인별 적용 여부 독립 확인 필요'], status: 'research_only',
})
const props = (leads: ResearchLead[]) => ({
  id: item.company_id, atlas: { research: { manifest: { record_count: leads.length }, leads, companyIds: leads.length ? [item.company_id] : [] } } as BenefitAtlasData,
  manifest: { data_version: 'legacy-v1' } as never, listings: [item], state: parseQuery(''), update: () => undefined,
  companies: [], link: () => '#',
})
const ketId = 'KR-CRN-1201110002957'
const hmmId = 'KR-CRN-1101110193740'
const artifact = (path: string) => JSON.parse(readFileSync(`public/data/company-benefits/${path}`, 'utf8')) as unknown
const ketLeads = () => (artifact('research-leads-v1/leads.json') as { leads: unknown[] }).leads.map((value) => researchLeadSchema.parse(value)).filter((value) => value.company_id === ketId)
const ketDetail = (): BenefitCompanyDetailView => ({
  legacy: detailSchema.parse(artifact(`company-benefits-2026-10-31-v1/companies/${ketId}.json`)),
  approvedV2: detailSchema.parse(artifact(`approved-v2-projection-2026-11-06/companies/${ketId}.json`)),
})
const ketProps = () => {
  const legacy = listingChunkSchema.parse(artifact('company-benefits-2026-10-31-v1/listings/companies-01.json')).companies.find((company) => company.company_id === ketId)!
  const projected = listingChunkSchema.parse(artifact('approved-v2-projection-2026-11-06/listings/companies-01.json')).companies.find((company) => company.company_id === ketId)!
  const leads = ketLeads()
  return { ...props(leads), id: ketId, listings: [{ ...projected, lineage: { legacy, approved_v2: projected } }] }
}
const routeProps = (id: string) => {
  const legacy = listingChunkSchema.parse(artifact('company-benefits-2026-10-31-v1/listings/companies-01.json')).companies
  const projected = listingChunkSchema.parse(artifact('approved-v2-projection-2026-11-06/listings/companies-01.json')).companies
  const listings = [ketId, hmmId].map((companyId) => ({
    ...projected.find((company) => company.company_id === companyId)!,
    lineage: { legacy: legacy.find((company) => company.company_id === companyId)!, approved_v2: projected.find((company) => company.company_id === companyId)! },
  }))
  const leads = (artifact('research-leads-v1/leads.json') as { leads: unknown[] }).leads.map((value) => researchLeadSchema.parse(value)).filter((value) => value.company_id === ketId || value.company_id === hmmId)
  return { ...props(leads), id, listings }
}
const routeDetail = (id: string): BenefitCompanyDetailView => ({
  legacy: detailSchema.parse(artifact(`company-benefits-2026-10-31-v1/companies/${id}.json`)),
  approvedV2: detailSchema.parse(artifact(`approved-v2-projection-2026-11-06/companies/${id}.json`)),
})
const deferred = () => {
  let resolve!: (detail: BenefitCompanyDetailView) => void
  let reject!: (error: Error) => void
  const promise = new Promise<BenefitCompanyDetailView>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
afterEach(() => { vi.restoreAllMocks(); delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView; window.history.replaceState({}, '', '/') })

it('puts all real KET atomic research before approved-v2 context while retaining the evidence sections', async () => {
  const detail = ketDetail()
  expect(detail.approvedV2?.references).toHaveLength(8)
  vi.spyOn(benefitsClient, 'loadAtlasCompanyDetail').mockResolvedValue(detail)
  render(<BenefitsCompanyPage {...ketProps()} />)
  await screen.findByRole('heading', { name: '기존 공개 조사 기록 (혜택 승인 아님)' })
  const notice = screen.getByText('확인된 복지 혜택 0건 · 아래 조사 기록은 승인 혜택이 아닙니다.')
  const research = screen.getByRole('heading', { name: '회사 공식 출처 조사 기록 (14건)' })
  const confirmed = screen.getByRole('heading', { name: '확인된 복지 혜택 (0건)' })
  const approvedContext = document.querySelector('.benefits-v2-evidence')!
  const legacy = screen.getByRole('heading', { name: '기존 공개 조사 기록 (혜택 승인 아님)' })
  expect(notice.compareDocumentPosition(research) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(research.compareDocumentPosition(approvedContext) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(research.compareDocumentPosition(confirmed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(research.compareDocumentPosition(legacy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(document.querySelectorAll('.benefits-v2-evidence')).toHaveLength(10)
  expect(document.querySelectorAll('.benefits-evidence--reference')).toHaveLength(8)
  expect(screen.getAllByRole('article', { name: /조사 중/ })).toHaveLength(14)
  expect(document.querySelectorAll('#research-family')).toHaveLength(1)
  expect(document.querySelectorAll('#family')).toHaveLength(1)
})

it('hides KET detail immediately on HMM route while HMM loads, then shows only HMM detail', async () => {
  const hmm = deferred()
  vi.spyOn(benefitsClient, 'loadAtlasCompanyDetail').mockImplementation((_atlas, id) => id === ketId ? Promise.resolve(routeDetail(ketId)) : hmm.promise)
  const { rerender } = render(<BenefitsCompanyPage {...routeProps(ketId)} />)
  await screen.findByRole('heading', { name: '기존 공개 조사 기록 (혜택 승인 아님)' })
  expect(document.querySelectorAll('.benefits-evidence--reference')).toHaveLength(8)

  rerender(<BenefitsCompanyPage {...routeProps(hmmId)} />)
  expect(screen.getAllByRole('article', { name: /조사 중/ })).toHaveLength(19)
  expect(screen.getByRole('heading', { name: '회사 공식 출처 조사 기록 (19건)' })).toBeVisible()
  expect(screen.getByRole('status')).toHaveTextContent('상세 근거를 불러오고 있습니다.')
  expect(document.querySelectorAll('.benefits-v2-evidence')).toHaveLength(0)
  expect(screen.queryByRole('heading', { name: '기존 공개 조사 기록 (혜택 승인 아님)' })).not.toBeInTheDocument()

  await act(async () => { hmm.resolve(routeDetail(hmmId)); await hmm.promise })
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(document.querySelectorAll('.benefits-evidence--reference')).toHaveLength(9)
  expect(screen.getByRole('heading', { name: '기존 공개 조사 기록 (혜택 승인 아님)' })).toBeVisible()
  expect(screen.getAllByRole('article', { name: /조사 중/ })).toHaveLength(19)
})

it.each(['resolve', 'reject'] as const)('ignores late KET %s after changing to HMM', async (completion) => {
  const ket = deferred()
  const hmm = deferred()
  vi.spyOn(benefitsClient, 'loadAtlasCompanyDetail').mockImplementation((_atlas, id) => id === ketId ? ket.promise : hmm.promise)
  const { rerender } = render(<BenefitsCompanyPage {...routeProps(ketId)} />)
  rerender(<BenefitsCompanyPage {...routeProps(hmmId)} />)
  await act(async () => {
    if (completion === 'resolve') ket.resolve(routeDetail(ketId))
    else ket.reject(new Error('stale KET failure'))
    await ket.promise.catch(() => undefined)
  })
  expect(screen.getAllByRole('article', { name: /조사 중/ })).toHaveLength(19)
  expect(screen.getByRole('status')).toHaveTextContent('상세 근거를 불러오고 있습니다.')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(document.querySelectorAll('.benefits-v2-evidence')).toHaveLength(0)
  expect(screen.queryByRole('heading', { name: '기존 공개 조사 기록 (혜택 승인 아님)' })).not.toBeInTheDocument()
})

it('clears KET error on HMM route and retries only HMM', async () => {
  const hmm = deferred()
  const load = vi.spyOn(benefitsClient, 'loadAtlasCompanyDetail').mockImplementation((_atlas, id) => id === ketId ? Promise.reject(new Error('KET offline')) : hmm.promise)
  const { rerender } = render(<BenefitsCompanyPage {...routeProps(ketId)} />)
  await screen.findByRole('alert')
  rerender(<BenefitsCompanyPage {...routeProps(hmmId)} />)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('상세 근거를 불러오고 있습니다.')
  expect(screen.getAllByRole('article', { name: /조사 중/ })).toHaveLength(19)
  await act(async () => { hmm.reject(new Error('HMM offline')); await hmm.promise.catch(() => undefined) })
  expect(screen.getByRole('alert')).toHaveTextContent('상세 근거를 불러올 수 없습니다')
  fireEvent.click(screen.getByRole('button', { name: '상세 다시 시도' }))
  expect(load.mock.calls.map(([, id]) => id)).toEqual([ketId, hmmId, hmmId])
  expect(screen.getByRole('status')).toHaveTextContent('상세 근거를 불러오고 있습니다.')
})

it('distinguishes completed preview review from unapproved current benefits and translates unknown currentness', () => {
  const ket = ketLeads()
  expect(ket).toHaveLength(14)
  render(<SourceBackedResearchGroup leads={ket} />)
  expect(screen.getByText(/독립적인 출처·권리 검토를 거친 조사 항목/)).toBeVisible()
  expect(screen.getByText(/현재 제공되는 복지 혜택으로 독립 검토·승인된 것은 아닙니다/)).toBeVisible()
  expect(document.body).not.toHaveTextContent('독립 검토가 완료되지 않았으며')
  expect(document.body).not.toHaveTextContent('(unknown)')
  for (const card of screen.getAllByRole('article', { name: /조사 중/ })) {
    expect(card).toHaveTextContent('현재성 미확인')
    expect(card).toHaveTextContent('2025년 지속가능경영보고서에 기재된 내용이며 현재 운영 여부는 미확인')
    const limitations = within(card).getAllByRole('listitem')
    expect(limitations).toHaveLength(ket[0].limitations.length)
    for (const limitation of ket[0].limitations) expect(card).toHaveTextContent(limitation)
  }
})

it('retains real KET research cards while legacy detail is pending or fails', async () => {
  const pending = new Promise<BenefitCompanyDetailView>(() => {})
  vi.spyOn(benefitsClient, 'loadAtlasCompanyDetail').mockReturnValue(pending)
  const { unmount } = render(<BenefitsCompanyPage {...ketProps()} />)
  expect(screen.getAllByRole('article', { name: /조사 중/ })).toHaveLength(14)
  expect(screen.getByRole('status')).toHaveTextContent('상세 근거를 불러오고 있습니다.')
  unmount()
  vi.mocked(benefitsClient.loadAtlasCompanyDetail).mockRejectedValue(new Error('offline'))
  render(<BenefitsCompanyPage {...ketProps()} />)
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('상세 근거를 불러올 수 없습니다'))
  expect(screen.getAllByRole('article', { name: /조사 중/ })).toHaveLength(14)
  expect(document.querySelectorAll('#research-family')).toHaveLength(1)
})

it('renders separate atomic research cards by category with full scope and limitations before legacy detail loads', () => {
  vi.spyOn(benefitsClient, 'loadAtlasCompanyDetail').mockImplementation(() => new Promise(() => {}))
  render(<BenefitsCompanyPage {...props([
    lead('통근버스를 운행한다', 'commute'),
    lead('자녀 학자금을 지원한다', 'family', { roles: '출처에 명시되지 않음', employment_types: ['정규직', '계약직'], conditions: [] }),
  ])} />)
  expect(screen.getByRole('heading', { name: '확인된 복지 혜택 (0건)' })).toBeVisible()
  const cards = screen.getAllByRole('article', { name: /조사 중/ })
  expect(cards).toHaveLength(2)
  const commute = within(document.getElementById('research-commute')!).getByRole('article')
  const family = within(document.getElementById('research-family')!).getByRole('article')
  expect(commute).toHaveTextContent('통근버스를 운행한다')
  expect(commute).not.toHaveTextContent('자녀 학자금을 지원한다')
  expect(family).toHaveTextContent('자녀 학자금을 지원한다')
  expect(family).not.toHaveTextContent('통근버스를 운행한다')
  expect(commute).toHaveTextContent(`법인 ${item.legal_name}`)
  expect(commute).toHaveTextContent('직군 engineer, designer')
  expect(commute).toHaveTextContent('고용형태 full-time')
  expect(commute).toHaveTextContent('재직 조건 1년')
  expect(commute).toHaveTextContent('대상 본인')
  expect(family).toHaveTextContent('직군 출처에 명시되지 않음')
  expect(family).toHaveTextContent('고용형태 정규직, 계약직')
  expect(family).toHaveTextContent('조건 명시되지 않음')
  for (const card of cards) {
    expect(card).toHaveTextContent('회사 공식 출처에 기재 · 조사 중 / 확인된 혜택 아님')
    expect(card).toHaveTextContent('현재성 미확인')
    expect(card).toHaveTextContent('2025년 보고서 기반; 현재 운영 여부 미확인')
    expect(card).toHaveTextContent('법인별 적용 여부 독립 확인 필요')
    expect(within(card).getByRole('link', { name: /출처/ })).toHaveAttribute('href', 'https://company.example/benefits')
    expect(within(card).getByRole('time')).toHaveAttribute('datetime', '2026-11-19T00:00:00Z')
  }
  expect(screen.getByRole('status')).toHaveTextContent('상세 근거를 불러오고 있습니다.')
})

it('renders a nonabsence empty state without inventing a card when legacy detail fails', async () => {
  vi.spyOn(benefitsClient, 'loadAtlasCompanyDetail').mockRejectedValue(new Error('offline'))
  render(<BenefitsCompanyPage {...props([])} />)
  expect(screen.getByText('공개된 구체 혜택 자료 미확인 · 복지 없음 아님')).toBeVisible()
  expect(screen.queryByRole('article', { name: /조사 중/ })).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('상세 근거를 불러올 수 없습니다'))
  expect(screen.getByText('공개된 구체 혜택 자료 미확인 · 복지 없음 아님')).toBeVisible()
})

it('shows the first 2025-report limitation on every actual KET research card', () => {
  const raw = JSON.parse(readFileSync('public/data/company-benefits/research-leads-v1/leads.json', 'utf8')) as { leads: unknown[] }
  const ket = raw.leads.map((value) => researchLeadSchema.parse(value)).filter((value) => value.company_id === 'KR-CRN-1201110002957')
  expect(ket).toHaveLength(14)
  render(<SourceBackedResearchGroup leads={ket} />)
  const cards = screen.getAllByRole('article', { name: /조사 중/ })
  expect(cards).toHaveLength(14)
  for (const card of cards) {
    expect(card).toHaveTextContent(ket[0].limitations[0])
    expect(within(card).getAllByRole('listitem')).toHaveLength(ket[0].limitations.length)
  }
  expect(screen.queryByRole('heading', { name: /확인된 복지 혜택 \(14건\)/ })).not.toBeInTheDocument()
})

it('keeps legacy category hashes for correction prefill without using research anchors', () => {
  window.history.replaceState({}, '', '#commute')
  vi.spyOn(benefitsClient, 'loadAtlasCompanyDetail').mockImplementation(() => new Promise(() => {}))
  render(<BenefitsCompanyPage {...props([lead('통근버스를 운행한다', 'commute')])} />)
  expect(screen.getByRole('link', { name: '정보 수정 요청' })).toHaveAttribute('href', expect.stringContaining('category=commute'))
  expect(document.getElementById('research-commute')).toBeInTheDocument()
  expect(document.getElementById('commute')).toBeNull()
})

it('scrolls research hashes without turning them into correction category prefill', () => {
  window.history.replaceState({}, '', '#research-commute')
  const scroll = vi.fn()
  const focus = vi.fn()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll })
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(focus)
  vi.spyOn(benefitsClient, 'loadAtlasCompanyDetail').mockImplementation(() => new Promise(() => {}))
  render(<BenefitsCompanyPage {...props([lead('통근버스를 운행한다', 'commute')])} />)
  expect(scroll).toHaveBeenCalledOnce()
  expect(focus).toHaveBeenCalledOnce()
  expect(screen.getByRole('link', { name: '정보 수정 요청' })).not.toHaveAttribute('href', expect.stringContaining('category='))
  expect(document.getElementById('commute')).toBeNull()
  expect(document.getElementById('research-commute')).toBeInTheDocument()
})
