import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { User } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../auth/AuthProvider'
import { DEFAULT_AUTH_PROVIDER } from '../auth/providers'
import { benefitsClient } from '../data/benefitsArtifactClient'
import type { BenefitCorrectionRepository } from '../data/benefitCorrectionRepository'
import type { BenefitCorrectionAccountScope, BenefitCorrectionDraft, BenefitCorrectionItem } from '../types/benefitCorrections'
import { categories, type CompanyListing, type Manifest } from '../types/benefits'
import { BenefitCorrectionPage } from './BenefitCorrectionPage'
import { MyBenefitCorrectionsPage } from './MyBenefitCorrectionsPage'
import { benefitsCorrectionUrl } from '../components/benefits/BenefitsCorrectionLink'
import { createBenefitCorrectionDraft, saveBenefitCorrectionDraft } from '../lib/benefitCorrectionDraftStore'

const actor = '56000000-0000-4000-8000-0000000000a1'
const scope = 'a'.repeat(64) as BenefitCorrectionAccountScope
const scopeB = 'b'.repeat(64) as BenefitCorrectionAccountScope
const company: CompanyListing = {
  company_id: 'KR-CRN-1101112948086', population_sequence: 1, legal_name: '테스트 주식회사', display_name: '테스트 기업', scope: 'domestic', jurisdiction: 'KR', incorporation_country: 'KR', registered_head_office_country: 'KR', selected_reporting_legal_entity: '테스트 주식회사', sector: 'non_financial',
  category_outcomes: categories.map(category_id => ({ kind: 'insufficient_evidence', category_id, reason_code: 'not_researched', nonabsence_notice: '이번 조사에서 게시 가능한 공식 복지 근거를 확보하지 못했습니다. 복지가 없다는 뜻이 아닙니다.', searched_source_ids: [], searched_at: null })),
}
const manifest = { data_version: 'company-benefits-2026-10-31-v1' } as Manifest
const item: BenefitCorrectionItem = {
  id: '76000000-0000-4000-8000-0000000000a1', companyId: company.company_id, categoryId: 'health', currentText: '근거 부족', proposedText: '건강검진 지원', scopeText: '대한민국 정규직', sourceUrl: 'https://example.com/benefits', observedDataVersion: manifest.data_version, status: 'submitted', adminResponse: null, appliedDataVersion: null, appliedAt: null, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
}
function auth(userId: string | null, overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return { loading: false, pending: false, session: userId ? {} as never : null, user: userId ? { id: userId } as User : null, error: null, signIn: vi.fn(), signOut: vi.fn(), invalidateStaleSession: vi.fn(() => true), ...overrides }
}
function repository(overrides: Partial<BenefitCorrectionRepository> = {}): BenefitCorrectionRepository {
  return {
    getCurrentAccountScope: vi.fn(async () => ({ ok: true as const, data: scope })),
    createRequest: vi.fn(async () => ({ ok: true as const, data: item })),
    listMyRequests: vi.fn(async () => ({ ok: true as const, data: { items: [item], hasMore: false, nextCursor: null } })),
    listAdminQueue: vi.fn(), listAdminAudit: vi.fn(), reviewRequest: vi.fn(), ...overrides,
  }
}
function storage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), values }
}
function wrap(ui: React.ReactNode, value: AuthContextValue) { return render(<AuthContext.Provider value={value}>{ui}</AuthContext.Provider>) }

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(benefitsClient, 'loadManifest').mockResolvedValue(manifest)
  vi.spyOn(benefitsClient, 'loadListingChunks').mockResolvedValue([company])
})

it('uses the authenticated local correction route instead of public issue creation', () => {
  expect(benefitsCorrectionUrl(company, 'health')).toBe(`/community/benefits/correction/?company=${company.company_id}&category=health`)
  expect(benefitsCorrectionUrl(company, 'health')).not.toMatch(/github|issues\/new|template=/i)
})

describe('authenticated benefit correction', () => {
  it('continues without persistence when the localStorage getter is blocked', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new DOMException('blocked', 'SecurityError') } })
    try {
      wrap(<BenefitCorrectionPage repository={repository()} search={`?company=${company.company_id}&category=health`} />, auth(actor))
      expect(await screen.findByLabelText('기업')).toHaveValue(company.company_id)
      expect(screen.getByLabelText('복지 분야')).toHaveValue('health')
      fireEvent.change(screen.getByLabelText('제안 내용'), { target: { value: '저장 없이 작성' } })
      expect(screen.getByLabelText('제안 내용')).toHaveValue('저장 없이 작성')
    } finally {
      if (descriptor) Object.defineProperty(window, 'localStorage', descriptor)
    }
  })

  it('gates anonymous users and uses a canonical correction return path', () => {
    const value = auth(null)
    wrap(<BenefitCorrectionPage repository={repository()} storage={storage()} search={`?company=${company.company_id}&category=health&returnTo=https://evil.example/`} currentPath={`/community/benefits/correction/?company=${company.company_id}&category=health&returnTo=https://evil.example/`} />, value)
    fireEvent.click(screen.getByRole('button', { name: 'Google로 로그인하고 요청하기' }))
    expect(value.signIn).toHaveBeenCalledWith(DEFAULT_AUTH_PROVIDER, `/community/benefits/correction/?company=${company.company_id}&category=health`)
    expect(screen.queryByText('evil.example')).not.toBeInTheDocument()
    expect(screen.getByText('Google 로그인 후 작성 중인 입력 내용은 이 기기에 임시 저장되며, 로그인 완료 뒤 이 수정 요청 화면으로 돌아옵니다.')).toBeVisible()
  })

  it('explains safe evidence, correction scope, and the separate publication decision', async () => {
    wrap(<BenefitCorrectionPage repository={repository()} storage={storage()} search={`?company=${company.company_id}&category=health`} />, auth(actor))

    expect(await screen.findByText('개인정보, 비공개·사내 문서, 로그인해야 볼 수 있는 문서, 유료 자료는 제출하지 마세요. 공개적으로 접근 가능한 HTTPS 근거 URL이 필요합니다.')).toBeVisible()
    expect(screen.getByText('국가·관할, 대상 법인, 직군, 고용 형태, 적용 시점·기간을 적어 주세요.')).toBeVisible()
    expect(screen.getByText('승인은 검토 결정이며 공개 데이터가 즉시 변경되지는 않습니다. 게시는 별도의 조사·산출물(artifact) 검증과 운영자 적용을 거쳐야 합니다.')).toBeVisible()
  })

  it('validates canonical company/category prefills and preserves a bounded account draft', async () => {
    const local = storage()
    const { unmount } = wrap(<BenefitCorrectionPage repository={repository()} storage={local} search={`?company=${company.company_id}&category=health&category=injected`} />, auth(actor))
    expect(await screen.findByRole('heading', { name: '복지 정보 수정 요청' })).toBeVisible()
    expect(screen.getByLabelText('기업')).toHaveValue(company.company_id)
    expect(screen.getByLabelText('복지 분야')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('복지 분야'), { target: { value: 'health' } })
    fireEvent.change(screen.getByLabelText('제안 내용'), { target: { value: '건강검진 지원' } })
    fireEvent.change(screen.getByLabelText('적용 범위'), { target: { value: '대한민국 정규직' } })
    fireEvent.change(screen.getByLabelText('공개 HTTPS 근거 URL'), { target: { value: 'https://example.com/benefits' } })
    await waitFor(() => expect(local.values.size).toBe(1))
    unmount()
    wrap(<BenefitCorrectionPage repository={repository()} storage={local} search="" />, auth(actor))
    expect(await screen.findByDisplayValue('건강검진 지원')).toBeVisible()
    expect(screen.getByDisplayValue('대한민국 정규직')).toBeVisible()
  })

  it('merges valid URL prefills into empty fields of an account-scoped saved draft', async () => {
    const local = storage()
    const emptyDraft = createBenefitCorrectionDraft(scope, () => '56000000-0000-4000-8000-0000000000d1', () => '2026-11-01T00:00:00Z')
    expect(saveBenefitCorrectionDraft(scope, emptyDraft, local)).toBe(true)

    wrap(<BenefitCorrectionPage repository={repository()} storage={local} search={`?company=${company.company_id}&category=health`} />, auth(actor))

    expect(await screen.findByLabelText('기업')).toHaveValue(company.company_id)
    expect(screen.getByLabelText('복지 분야')).toHaveValue('health')
    expect(screen.getByLabelText('현재 표시 내용')).toHaveValue('근거 부족')
    expect(screen.getByText(manifest.data_version)).toBeVisible()
  })

  it('preserves each non-empty saved draft field over explicit URL prefills', async () => {
    const local = storage()
    const saved: BenefitCorrectionDraft = {
      ...createBenefitCorrectionDraft(scope, () => '56000000-0000-4000-8000-0000000000d2', () => '2026-11-01T00:00:00Z'),
      companyId: company.company_id,
      categoryId: 'family',
      currentText: '사용자가 저장한 현재 내용',
      proposedText: '사용자가 저장한 제안',
      scopeText: '사용자가 저장한 범위',
      sourceUrl: 'https://example.com/saved',
      observedDataVersion: 'company-benefits-2026-10-30-v1',
    }
    expect(saveBenefitCorrectionDraft(scope, saved, local)).toBe(true)

    wrap(<BenefitCorrectionPage repository={repository()} storage={local} search={`?company=${company.company_id}&category=health`} />, auth(actor))

    expect(await screen.findByLabelText('복지 분야')).toHaveValue('family')
    expect(screen.getByLabelText('현재 표시 내용')).toHaveValue('사용자가 저장한 현재 내용')
    expect(screen.getByLabelText('제안 내용')).toHaveValue('사용자가 저장한 제안')
    expect(screen.getByLabelText('적용 범위')).toHaveValue('사용자가 저장한 범위')
    expect(screen.getByLabelText('공개 HTTPS 근거 URL')).toHaveValue('https://example.com/saved')
    expect(screen.getByText('company-benefits-2026-10-30-v1')).toBeVisible()
  })

  it('locks duplicate submission and clears only after a matching validated success', async () => {
    let resolve!: (value: { ok: true; data: BenefitCorrectionItem }) => void
    const createRequest = vi.fn(() => new Promise<{ ok: true; data: BenefitCorrectionItem }>(done => { resolve = done }))
    const repo = repository({ createRequest })
    const local = storage()
    wrap(<BenefitCorrectionPage repository={repo} storage={local} search={`?company=${company.company_id}&category=health`} />, auth(actor))
    await waitFor(() => expect(screen.getByLabelText('기업')).toHaveValue(company.company_id))
    fireEvent.change(screen.getByLabelText('제안 내용'), { target: { value: item.proposedText } })
    fireEvent.change(screen.getByLabelText('적용 범위'), { target: { value: item.scopeText } })
    fireEvent.change(screen.getByLabelText('공개 HTTPS 근거 URL'), { target: { value: item.sourceUrl } })
    const submit = screen.getByRole('button', { name: '수정 요청 제출' })
    fireEvent.click(submit); fireEvent.click(submit)
    await waitFor(() => expect(createRequest).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: '제출 중…' })).toBeDisabled()
    resolve({ ok: true, data: item })
    expect(await screen.findByRole('status')).toHaveTextContent('수정 요청이 접수되었습니다')
    expect(screen.getByRole('link', { name: '내 수정 요청' })).toHaveAttribute('href', '/community/benefits/my-corrections/')
    expect(local.values.size).toBe(0)
  })

  it('aborts the exact submission on unmount and retains its draft after a late success', async () => {
    let resolve!: (value: { ok: true; data: BenefitCorrectionItem }) => void
    let submittedSignal: AbortSignal | undefined
    const createRequest = vi.fn((_input, _expectedScope, signal?: AbortSignal) => {
      submittedSignal = signal
      return new Promise<{ ok: true; data: BenefitCorrectionItem }>(done => { resolve = done })
    })
    const local = storage()
    const view = wrap(<BenefitCorrectionPage repository={repository({ createRequest })} storage={local} search={`?company=${company.company_id}&category=health`} />, auth(actor))
    await waitFor(() => expect(screen.getByLabelText('기업')).toHaveValue(company.company_id))
    fireEvent.change(screen.getByLabelText('제안 내용'), { target: { value: item.proposedText } })
    fireEvent.change(screen.getByLabelText('적용 범위'), { target: { value: item.scopeText } })
    fireEvent.change(screen.getByLabelText('공개 HTTPS 근거 URL'), { target: { value: item.sourceUrl } })
    fireEvent.click(screen.getByRole('button', { name: '수정 요청 제출' }))
    await waitFor(() => expect(createRequest).toHaveBeenCalledTimes(1))
    expect(submittedSignal).toBeInstanceOf(AbortSignal)
    expect(submittedSignal?.aborted).toBe(false)

    view.unmount()

    expect(submittedSignal?.aborted).toBe(true)
    resolve({ ok: true, data: item })
    await waitFor(() => expect(local.values.size).toBe(1))
  })

  it.each(['resolve', 'reject', 'hang'] as const)('releases the submit lock for account B when account A submission will %s', async outcome => {
    const local = storage()
    const draftB: BenefitCorrectionDraft = {
      ...createBenefitCorrectionDraft(scopeB, () => '56000000-0000-4000-8000-0000000000b2', () => '2026-11-01T00:00:00Z'),
      companyId: company.company_id,
      categoryId: 'health',
      currentText: item.currentText,
      proposedText: 'B 계정 제안',
      scopeText: item.scopeText,
      sourceUrl: item.sourceUrl,
      observedDataVersion: manifest.data_version,
    }
    expect(saveBenefitCorrectionDraft(scopeB, draftB, local)).toBe(true)
    let currentScope = scope
    let finishA!: (value: Awaited<ReturnType<BenefitCorrectionRepository['createRequest']>>) => void
    const pendingA = new Promise<Awaited<ReturnType<BenefitCorrectionRepository['createRequest']>>>(resolve => { finishA = resolve })
    const createRequest = vi.fn<BenefitCorrectionRepository['createRequest']>((input, expectedScope) => {
      if (expectedScope === scope) return pendingA
      return Promise.resolve({ ok: true as const, data: {
        ...item,
        companyId: input.companyId,
        categoryId: input.categoryId,
        currentText: input.currentText,
        proposedText: input.proposedText,
        scopeText: input.scopeText,
        sourceUrl: input.sourceUrl,
        observedDataVersion: input.observedDataVersion,
      } })
    })
    const repo = repository({
      getCurrentAccountScope: vi.fn(async () => ({ ok: true as const, data: currentScope })),
      createRequest,
    })
    const view = wrap(<BenefitCorrectionPage repository={repo} storage={local} search={`?company=${company.company_id}&category=health`} />, auth(actor))
    await waitFor(() => expect(screen.getByLabelText('기업')).toHaveValue(company.company_id))
    fireEvent.change(screen.getByLabelText('제안 내용'), { target: { value: item.proposedText } })
    fireEvent.change(screen.getByLabelText('적용 범위'), { target: { value: item.scopeText } })
    fireEvent.change(screen.getByLabelText('공개 HTTPS 근거 URL'), { target: { value: item.sourceUrl } })
    fireEvent.click(screen.getByRole('button', { name: '수정 요청 제출' }))
    await waitFor(() => expect(createRequest).toHaveBeenCalledTimes(1))

    currentScope = scopeB
    view.rerender(<AuthContext.Provider value={auth('56000000-0000-4000-8000-0000000000b2')}><BenefitCorrectionPage repository={repo} storage={local} search={`?company=${company.company_id}&category=health`} /></AuthContext.Provider>)

    expect(await screen.findByDisplayValue('B 계정 제안')).toBeVisible()
    const submitB = screen.getByRole('button', { name: '수정 요청 제출' })
    expect(submitB).toBeEnabled()
    fireEvent.click(submitB)
    expect(await screen.findByRole('status')).toHaveTextContent('수정 요청이 접수되었습니다')

    if (outcome === 'resolve') finishA({ ok: true, data: item })
    if (outcome === 'reject') finishA({ ok: false, error: { code: 'network', message: '이전 요청 실패' } })
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('수정 요청이 접수되었습니다')
      expect(createRequest).toHaveBeenCalledTimes(2)
      expect(local.values.size).toBe(1)
    })
  })
})

describe('my benefit corrections', () => {
  it('loads more than 50 requests with the cursor and appends stable deduplicated rows', async () => {
    const firstItems = Array.from({ length: 50 }, (_, index) => ({
      ...item,
      id: `request-${index}`,
      proposedText: `제안 ${index}`,
    }))
    const cursor = { createdAt: item.createdAt, id: '76000000-0000-4000-8000-000000000050' }
    const finalItem = { ...item, id: 'request-50', proposedText: '제안 50' }
    const listMyRequests = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { items: firstItems, hasMore: true, nextCursor: cursor } })
      .mockResolvedValueOnce({ ok: true, data: { items: [firstItems[49], finalItem], hasMore: false, nextCursor: null } })

    wrap(<MyBenefitCorrectionsPage repository={repository({ listMyRequests })} />, auth(actor))
    expect(await screen.findByText('제안 0')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '더 보기' }))

    expect(await screen.findByText('제안 50')).toBeVisible()
    expect(screen.getAllByRole('article')).toHaveLength(51)
    expect(screen.getAllByText('제안 49')).toHaveLength(1)
    expect(listMyRequests).toHaveBeenNthCalledWith(2, { limit: 50, cursor }, expect.any(AbortSignal))
    expect(screen.queryByRole('button', { name: '더 보기' })).not.toBeInTheDocument()
  })

  it('keeps existing rows while load-more rejects and retries successfully', async () => {
    const cursor = { createdAt: item.createdAt, id: item.id }
    const next = { ...item, id: '76000000-0000-4000-8000-0000000000b2', proposedText: '재시도 성공' }
    let rejectMore!: (reason: Error) => void
    const listMyRequests = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { items: [item], hasMore: true, nextCursor: cursor } })
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectMore = reject }))
      .mockResolvedValueOnce({ ok: true, data: { items: [next], hasMore: false, nextCursor: null } })

    wrap(<MyBenefitCorrectionsPage repository={repository({ listMyRequests })} />, auth(actor))
    fireEvent.click(await screen.findByRole('button', { name: '더 보기' }))
    expect(screen.getByRole('button', { name: '불러오는 중…' })).toBeDisabled()
    rejectMore(new Error('offline'))
    expect(await screen.findByRole('alert')).toHaveTextContent('요청 내역을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    expect(screen.getByText(item.proposedText)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText('재시도 성공')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('discards an out-of-order page after the authenticated account changes', async () => {
    const firstPage = (value: BenefitCorrectionItem) => ({ ok: true as const, data: { items: [value], hasMore: false, nextCursor: null } })
    let resolveA!: (value: ReturnType<typeof firstPage>) => void
    let resolveB!: (value: ReturnType<typeof firstPage>) => void
    const listMyRequests = vi.fn()
      .mockImplementationOnce(() => new Promise<ReturnType<typeof firstPage>>(resolve => { resolveA = resolve }))
      .mockImplementationOnce(() => new Promise<ReturnType<typeof firstPage>>(resolve => { resolveB = resolve }))
    const repo = repository({ listMyRequests })
    const view = wrap(<MyBenefitCorrectionsPage repository={repo} />, auth(actor))
    const actorB = '56000000-0000-4000-8000-0000000000b2'

    view.rerender(<AuthContext.Provider value={auth(actorB)}><MyBenefitCorrectionsPage repository={repo} /></AuthContext.Provider>)
    const itemB = { ...item, id: '76000000-0000-4000-8000-0000000000b2', proposedText: 'B 계정 요청' }
    resolveB(firstPage(itemB))
    expect(await screen.findByText('B 계정 요청')).toBeVisible()
    resolveA(firstPage({ ...item, proposedText: 'A 계정 지연 응답' }))
    await waitFor(() => expect(screen.queryByText('A 계정 지연 응답')).not.toBeInTheDocument())
    expect(screen.getByText('B 계정 요청')).toBeVisible()
  })

  it('shows safe own status fields, timestamps and applied artifact version', async () => {
    const applied = { ...item, status: 'applied' as const, adminResponse: '공식 자료를 확인해 반영했습니다.', appliedDataVersion: 'company-benefits-2026-11-02-v1', appliedAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z' }
    const listMyRequests = vi.fn(async () => ({ ok: true as const, data: { items: [applied], hasMore: false, nextCursor: null } }))
    wrap(<MyBenefitCorrectionsPage repository={repository({ listMyRequests })} currentPath="/community/benefits/my-corrections/" />, auth(actor))
    expect(await screen.findByText('반영 완료')).toBeVisible()
    expect(screen.getByText('공식 자료를 확인해 반영했습니다.')).toBeVisible()
    expect(screen.getByText('company-benefits-2026-11-02-v1')).toBeVisible()
    expect(screen.getAllByText(/2026/).length).toBeGreaterThanOrEqual(2)
    expect(document.body.textContent).not.toContain(actor)
    expect(document.body.textContent).not.toMatch(/@|Bearer|token/i)
  })

  it('handles an expired list session with the existing Google login flow', async () => {
    const value = auth(actor)
    const listMyRequests = vi.fn(async () => ({ ok: false as const, error: { code: 'auth_required' as const, message: '로그인이 필요합니다.' } }))
    wrap(<MyBenefitCorrectionsPage repository={repository({ listMyRequests })} currentPath="/community/benefits/my-corrections/?returnTo=https://evil.example" />, value)
    expect(await screen.findByRole('alert')).toHaveTextContent('로그인이 필요합니다.')
    fireEvent.click(screen.getByRole('button', { name: '다시 로그인' }))
    expect(value.signIn).toHaveBeenCalledWith(DEFAULT_AUTH_PROVIDER, '/community/benefits/my-corrections/')
  })

  it('renders loading, empty, error and retry states', async () => {
    const listMyRequests = vi.fn().mockResolvedValueOnce({ ok: false, error: { code: 'network', message: '네트워크 요청에 실패했습니다.' } }).mockResolvedValueOnce({ ok: true, data: { items: [], hasMore: false, nextCursor: null } })
    wrap(<MyBenefitCorrectionsPage repository={repository({ listMyRequests })} />, auth(actor))
    expect(screen.getByRole('status')).toHaveTextContent('요청 내역을 불러오고 있습니다')
    expect(await screen.findByRole('alert')).toHaveTextContent('네트워크 요청에 실패했습니다')
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText('아직 제출한 수정 요청이 없습니다.')).toBeVisible()
  })

  it('maps a rejected initial list promise to a retryable Korean error and clears loading', async () => {
    const listMyRequests = vi.fn()
      .mockRejectedValueOnce(new Error('transport failed'))
      .mockResolvedValueOnce({ ok: true, data: { items: [], hasMore: false, nextCursor: null } })
    wrap(<MyBenefitCorrectionsPage repository={repository({ listMyRequests })} />, auth(actor))

    expect(await screen.findByRole('alert')).toHaveTextContent('요청 내역을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    expect(screen.queryByText('요청 내역을 불러오고 있습니다.')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText('아직 제출한 수정 요청이 없습니다.')).toBeVisible()
  })
})
