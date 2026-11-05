import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../auth/AuthProvider'
import type { CommunityRepository } from '../data/communityRepository'
import type { BenefitCorrectionRepository } from '../data/benefitCorrectionRepository'
import type { AdminBenefitCorrectionItem } from '../types/benefitCorrections'
import { AdminBenefitCorrectionsPage } from './AdminBenefitCorrectionsPage'

const submitted: AdminBenefitCorrectionItem = {
  id: '10000000-0000-4000-8000-000000000001', companyId: 'KR-CRN-1234567890123', categoryId: 'leave',
  currentText: '기존 휴가 15일', proposedText: '연차 20일', scopeText: '대한민국 정규직', sourceUrl: 'https://example.com/evidence',
  observedDataVersion: 'company-benefits-2026-11-01-v1', status: 'submitted', adminResponse: null,
  appliedDataVersion: null, appliedAt: null, createdAt: '2026-11-01T01:00:00Z', updatedAt: '2026-11-01T01:00:00Z', reviewedAt: null,
}
const signedOut = { loading: false, pending: false, session: null, user: null, error: null, signIn: vi.fn(), signOut: vi.fn(), invalidateStaleSession: vi.fn(() => false) } satisfies AuthContextValue
const signedIn = { ...signedOut, session: {} as never, user: { id: '40000000-0000-4000-8000-000000000001' } as never }
function adminRepo(isAdmin = vi.fn().mockResolvedValue({ ok: true, data: true })) {
  return { isAdmin } as unknown as CommunityRepository
}
function corrections(overrides: Partial<BenefitCorrectionRepository> = {}) {
  return {
    getCurrentAccountScope: vi.fn(), createRequest: vi.fn(), listMyRequests: vi.fn(),
    listAdminQueue: vi.fn().mockResolvedValue({ ok: true, data: { items: [submitted], hasMore: false, nextCursor: null } }),
    listAdminAudit: vi.fn().mockResolvedValue({ ok: true, data: { items: [], hasMore: false, nextCursor: null } }),
    reviewRequest: vi.fn(), ...overrides,
  } as BenefitCorrectionRepository
}
function page(correctionRepository: BenefitCorrectionRepository, authorizationRepository = adminRepo(), auth: AuthContextValue = signedIn) {
  return render(<AuthContext.Provider value={auth}><AdminBenefitCorrectionsPage authorizationRepository={authorizationRepository} correctionRepository={correctionRepository} currentPath="/community/admin/benefit-corrections/?status=active#queue" /></AuthContext.Provider>)
}

describe('AdminBenefitCorrectionsPage', () => {
  it('uses AuthProvider login and DB-backed admin gate before reading the queue', async () => {
    const signIn = vi.fn(); const listAdminQueue = vi.fn()
    const view = page(corrections({ listAdminQueue }), adminRepo(), { ...signedOut, signIn })
    fireEvent.click(screen.getByRole('button', { name: 'Google로 관리자 로그인' }))
    expect(signIn).toHaveBeenCalledWith('google', '/community/admin/benefit-corrections/?status=active#queue')
    view.unmount()

    const deniedList = vi.fn()
    page(corrections({ listAdminQueue: deniedList }), adminRepo(vi.fn().mockResolvedValue({ ok: true, data: false })))
    expect(await screen.findByRole('heading', { name: '접근 권한이 없습니다' })).toBeInTheDocument()
    expect(deniedList).not.toHaveBeenCalled()
  })

  it('loads the active keyset queue, shows review evidence, and never exposes private actor data', async () => {
    const listAdminQueue = vi.fn().mockResolvedValue({ ok: true, data: { items: [submitted, submitted], hasMore: false, nextCursor: null } })
    page(corrections({ listAdminQueue }))
    expect(await screen.findByRole('heading', { name: '복지 정정 검토 데스크' })).toBeInTheDocument()
    expect(listAdminQueue).toHaveBeenCalledWith({ status: 'active', limit: 50 }, expect.any(AbortSignal))
    expect(await screen.findAllByRole('button', { name: /복지 정정.*선택/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /복지 정정.*선택/ }))
    const inspector = screen.getByRole('complementary', { name: '선택한 복지 정정 검토' })
    expect(within(inspector).getByText('기존 휴가 15일')).toBeInTheDocument()
    expect(within(inspector).getByText('연차 20일')).toBeInTheDocument()
    expect(within(inspector).getByText('대한민국 정규직')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '근거 자료 열기' })).toHaveAttribute('href', 'https://example.com/evidence')
    expect(screen.queryByText(/submitter|actor|token|@example/i)).not.toBeInTheDocument()
  })

  it('loads a privacy-safe accessible audit timeline for the selected request', async () => {
    const listAdminAudit = vi.fn().mockResolvedValue({ ok: true, data: { items: [
      { sequence: '57000000-0000-4000-8000-000000000001', eventType: 'submitted', fromStatus: null, toStatus: 'submitted', adminResponse: null, appliedVersion: null, createdAt: '2026-11-01T01:00:00Z' },
      { sequence: '57000000-0000-4000-8000-000000000002', eventType: 'additional_material_requested', fromStatus: 'reviewing', toStatus: 'reviewing', adminResponse: '첫 번째 자료 요청', appliedVersion: null, createdAt: '2026-11-01T02:00:00Z' },
      { sequence: '57000000-0000-4000-8000-000000000003', eventType: 'additional_material_requested', fromStatus: 'reviewing', toStatus: 'reviewing', adminResponse: '두 번째 자료 요청', appliedVersion: null, createdAt: '2026-11-01T03:00:00Z' },
      { sequence: '57000000-0000-4000-8000-000000000004', eventType: 'applied', fromStatus: 'approved', toStatus: 'applied', adminResponse: null, appliedVersion: 'company-benefits-2026-11-02-v1', createdAt: '2026-11-02T02:00:00Z' },
    ], hasMore: false, nextCursor: null } })
    page(corrections({ listAdminAudit }))
    fireEvent.click(await screen.findByRole('button', { name: /복지 정정.*선택/ }))
    expect(await screen.findByRole('heading', { name: '검토 감사 이력' })).toBeInTheDocument()
    expect(listAdminAudit).toHaveBeenCalledWith({ requestId: submitted.id, limit: 50 }, expect.any(AbortSignal))
    const timeline = screen.getByRole('list', { name: '검토 감사 타임라인' })
    expect(within(timeline).getByText('첫 번째 자료 요청')).toBeInTheDocument()
    expect(within(timeline).getByText('두 번째 자료 요청')).toBeInTheDocument()
    expect(within(timeline).getByText('company-benefits-2026-11-02-v1')).toBeInTheDocument()
    expect(within(timeline).getAllByText(/2026/).length).toBeGreaterThan(0)
    expect(within(timeline).queryByText(/actor|reviewer|token|email|snapshot/i)).not.toBeInTheDocument()
  })

  it('aborts and stale-suppresses audit selection changes with accessible error retry and empty states', async () => {
    const second = { ...submitted, id: '10000000-0000-4000-8000-000000000002' }
    let finishFirst!: (value: unknown) => void
    const listAdminAudit = vi.fn()
      .mockReturnValueOnce(new Promise(resolve => { finishFirst = resolve }))
      .mockResolvedValueOnce({ ok: false, error: { code: 'network', message: '감사 이력을 불러오지 못했습니다.' } })
      .mockResolvedValueOnce({ ok: true, data: { items: [], hasMore: false, nextCursor: null } })
    page(corrections({
      listAdminQueue: vi.fn().mockResolvedValue({ ok: true, data: { items: [submitted, second], hasMore: false, nextCursor: null } }),
      listAdminAudit,
    }))
    const rows = await screen.findAllByRole('button', { name: /복지 정정.*선택/ })
    fireEvent.click(rows[0])
    expect(await screen.findByText('감사 이력을 불러오는 중입니다.')).toHaveAttribute('role', 'status')
    const firstSignal = listAdminAudit.mock.calls[0][1] as AbortSignal
    fireEvent.click(rows[1])
    expect(firstSignal.aborted).toBe(true)
    finishFirst({ ok: true, data: { items: [{ sequence: '57000000-0000-4000-8000-000000000009', eventType: 'submitted', fromStatus: null, toStatus: 'submitted', adminResponse: 'stale secret', appliedVersion: null, createdAt: '2026-11-01T00:00:00Z' }], hasMore: false, nextCursor: null } })
    expect(await screen.findByRole('alert')).toHaveTextContent('감사 이력을 불러오지 못했습니다.')
    expect(screen.queryByText('stale secret')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '감사 이력 다시 시도' }))
    expect(await screen.findByText('기록된 감사 이벤트가 없습니다.')).toBeInTheDocument()
  })

  it('does not render the previous request audit while a new selection loads', async () => {
    const second = { ...submitted, id: '10000000-0000-4000-8000-000000000002' }
    let finishSecond!: (value: unknown) => void
    const listAdminAudit = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { items: [{ sequence: '57000000-0000-4000-8000-000000000001', eventType: 'additional_material_requested', fromStatus: 'reviewing', toStatus: 'reviewing', adminResponse: '첫 요청 전용 응답', appliedVersion: null, createdAt: '2026-11-01T02:00:00Z' }], hasMore: false, nextCursor: null } })
      .mockReturnValueOnce(new Promise(resolve => { finishSecond = resolve }))
    page(corrections({ listAdminQueue: vi.fn().mockResolvedValue({ ok: true, data: { items: [submitted, second], hasMore: false, nextCursor: null } }), listAdminAudit }))
    const rows = await screen.findAllByRole('button', { name: /복지 정정.*선택/ })
    fireEvent.click(rows[0])
    expect(await screen.findByText('첫 요청 전용 응답')).toBeInTheDocument()
    fireEvent.click(rows[1])
    expect(screen.queryByText('첫 요청 전용 응답')).not.toBeInTheDocument()
    expect(screen.getByText('감사 이력을 불러오는 중입니다.')).toBeInTheDocument()
    finishSecond({ ok: true, data: { items: [], hasMore: false, nextCursor: null } })
    expect(await screen.findByText('기록된 감사 이벤트가 없습니다.')).toBeInTheDocument()
  })

  it('suppresses stale filter responses, aborts cleanup, and deduplicates keyset pages', async () => {
    let finishActive!: (value: unknown) => void; let finishMore!: (value: unknown) => void
    const active = new Promise(resolve => { finishActive = resolve }); const more = new Promise(resolve => { finishMore = resolve })
    const second = { ...submitted, id: '10000000-0000-4000-8000-000000000002', createdAt: '2026-11-01T00:00:00Z' }
    const listAdminQueue = vi.fn()
      .mockReturnValueOnce(active)
      .mockResolvedValueOnce({ ok: true, data: { items: [submitted], hasMore: true, nextCursor: { createdAt: submitted.createdAt, id: submitted.id } } })
      .mockReturnValueOnce(more)
    const view = page(corrections({ listAdminQueue }))
    await waitFor(() => expect(listAdminQueue).toHaveBeenCalledTimes(1))
    const firstSignal = listAdminQueue.mock.calls[0][1] as AbortSignal
    fireEvent.click(screen.getByRole('button', { name: '검토 중' }))
    expect(firstSignal.aborted).toBe(true)
    finishActive({ ok: true, data: { items: [{ ...submitted, companyId: 'KR-CRN-9999999999999' }], hasMore: false, nextCursor: null } })
    expect(await screen.findByRole('button', { name: /복지 정정.*선택/ })).toBeInTheDocument()
    expect(screen.queryByText('KR-CRN-9999999999999')).not.toBeInTheDocument()

    const loadMore = screen.getByRole('button', { name: '정정 요청 더 불러오기' })
    fireEvent.click(loadMore)
    fireEvent.click(loadMore)
    expect(listAdminQueue).toHaveBeenCalledTimes(3)
    finishMore({ ok: true, data: { items: [submitted, second], hasMore: false, nextCursor: null } })
    await waitFor(() => expect(screen.getAllByRole('button', { name: /복지 정정.*선택/ })).toHaveLength(2))
    view.unmount()
  })

  it('submits a single CAS review with bounded response and refreshes on stale conflict', async () => {
    const reviewing = { ...submitted, status: 'reviewing' as const, adminResponse: '검토를 시작합니다.', reviewedAt: '2026-11-01T02:00:00Z', updatedAt: '2026-11-01T02:00:00Z' }
    let finish!: (value: unknown) => void
    const reviewRequest = vi.fn().mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const listAdminQueue = vi.fn().mockResolvedValue({ ok: true, data: { items: [submitted], hasMore: false, nextCursor: null } })
    const listAdminAudit = vi.fn().mockResolvedValue({ ok: true, data: { items: [], hasMore: false, nextCursor: null } })
    page(corrections({ listAdminQueue, reviewRequest, listAdminAudit }))
    fireEvent.click(await screen.findByRole('button', { name: /복지 정정.*선택/ }))
    const response = screen.getByLabelText('관리자 응답')
    expect(response).toHaveAttribute('maxLength', '2000')
    fireEvent.change(response, { target: { value: '검토를 시작합니다.' } })
    const start = screen.getByRole('button', { name: '검토 시작' })
    fireEvent.click(start); fireEvent.click(start)
    expect(reviewRequest).toHaveBeenCalledTimes(1)
    expect(reviewRequest).toHaveBeenCalledWith(expect.objectContaining({ requestId: submitted.id, expectedStatus: 'submitted', action: 'start_review', adminResponse: '검토를 시작합니다.', clientKey: expect.any(String) }), expect.any(AbortSignal))
    finish({ ok: true, data: reviewing })
    expect(await screen.findByRole('button', { name: '추가 자료 요청' })).toBeInTheDocument()
    await waitFor(() => expect(listAdminAudit).toHaveBeenCalledTimes(2))

    reviewRequest.mockResolvedValueOnce({ ok: false, error: { code: 'conflict', message: '요청 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.' } })
    fireEvent.change(response, { target: { value: '근거가 부족합니다.' } })
    fireEvent.click(screen.getByRole('button', { name: '추가 자료 요청' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('요청 상태가 변경')
    await waitFor(() => expect(listAdminQueue).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('alert')).toHaveTextContent('요청 상태가 변경')
  })

  it('attributes a successful review completion to its submitted request after selection changes', async () => {
    const second = {
      ...submitted,
      id: '10000000-0000-4000-8000-000000000002',
      companyId: 'KR-CRN-9999999999999',
      currentText: 'B 기존 내용',
      proposedText: 'B 제안 내용',
    }
    const reviewing = { ...submitted, status: 'reviewing' as const, adminResponse: 'A 검토 시작', reviewedAt: '2026-11-01T02:00:00Z', updatedAt: '2026-11-01T02:00:00Z' }
    let finishReview!: (value: unknown) => void
    const reviewRequest = vi.fn().mockReturnValue(new Promise(resolve => { finishReview = resolve }))
    const listAdminQueue = vi.fn().mockResolvedValue({ ok: true, data: { items: [submitted, second], hasMore: false, nextCursor: null } })
    const listAdminAudit = vi.fn().mockResolvedValue({ ok: true, data: { items: [], hasMore: false, nextCursor: null } })
    page(corrections({ listAdminQueue, listAdminAudit, reviewRequest }))

    const rows = await screen.findAllByRole('button', { name: /복지 정정.*선택/ })
    fireEvent.click(rows[0])
    fireEvent.change(screen.getByLabelText('관리자 응답'), { target: { value: 'A 검토 시작' } })
    fireEvent.click(screen.getByRole('button', { name: '검토 시작' }))
    fireEvent.click(rows[1])
    const secondResponse = screen.getByLabelText('관리자 응답')
    expect(secondResponse).toBeEnabled()
    fireEvent.change(secondResponse, { target: { value: 'B 작성 중 응답' } })
    await waitFor(() => expect(listAdminAudit).toHaveBeenCalledTimes(2))

    finishReview({ ok: true, data: reviewing })

    await waitFor(() => expect(within(rows[0]).getByText('검토 중')).toBeInTheDocument())
    const secondInspector = screen.getByRole('complementary', { name: '선택한 복지 정정 검토' })
    expect(rows[1]).toHaveAttribute('aria-pressed', 'true')
    expect(within(secondInspector).getByText('B 기존 내용')).toBeInTheDocument()
    expect(within(secondInspector).getByText('B 제안 내용')).toBeInTheDocument()
    expect(secondResponse).toHaveValue('B 작성 중 응답')
    expect(screen.queryByText('검토 결과가 저장되었습니다.')).not.toBeInTheDocument()
    expect(listAdminAudit).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['failure', { ok: false, error: { code: 'network', message: 'A 검토 실패' } }],
    ['conflict', { ok: false, error: { code: 'conflict', message: 'A 상태 충돌' } }],
  ])('suppresses stale %s review callbacks after selection changes', async (_kind, result) => {
    const second = {
      ...submitted,
      id: '10000000-0000-4000-8000-000000000002',
      companyId: 'KR-CRN-9999999999999',
      currentText: 'B 기존 내용',
      proposedText: 'B 제안 내용',
    }
    let finishReview!: (value: unknown) => void
    const reviewRequest = vi.fn().mockReturnValue(new Promise(resolve => { finishReview = resolve }))
    const listAdminQueue = vi.fn().mockResolvedValue({ ok: true, data: { items: [submitted, second], hasMore: false, nextCursor: null } })
    const listAdminAudit = vi.fn().mockResolvedValue({ ok: true, data: { items: [], hasMore: false, nextCursor: null } })
    page(corrections({ listAdminQueue, listAdminAudit, reviewRequest }))

    const rows = await screen.findAllByRole('button', { name: /복지 정정.*선택/ })
    fireEvent.click(rows[0])
    fireEvent.change(screen.getByLabelText('관리자 응답'), { target: { value: 'A 검토 시작' } })
    fireEvent.click(screen.getByRole('button', { name: '검토 시작' }))
    fireEvent.click(rows[1])
    const secondResponse = screen.getByLabelText('관리자 응답')
    expect(secondResponse).toBeEnabled()
    fireEvent.change(secondResponse, { target: { value: 'B 작성 중 응답' } })
    await waitFor(() => expect(listAdminAudit).toHaveBeenCalledTimes(2))

    await act(async () => { finishReview(result) })

    const secondInspector = screen.getByRole('complementary', { name: '선택한 복지 정정 검토' })
    expect(rows[1]).toHaveAttribute('aria-pressed', 'true')
    expect(within(secondInspector).getByText('B 기존 내용')).toBeInTheDocument()
    expect(within(secondInspector).getByText('B 제안 내용')).toBeInTheDocument()
    expect(secondResponse).toHaveValue('B 작성 중 응답')
    expect(screen.queryByText(/A 검토 실패|A 상태 충돌/)).not.toBeInTheDocument()
    expect(listAdminQueue).toHaveBeenCalledTimes(1)
    expect(listAdminAudit).toHaveBeenCalledTimes(2)
  })

  it('does not imply approval was applied and only shows a server-projected applied version', async () => {
    const approved = { ...submitted, status: 'approved' as const, adminResponse: '승인', reviewedAt: '2026-11-01T02:00:00Z', updatedAt: '2026-11-01T02:00:00Z' }
    const applied = { ...approved, id: '10000000-0000-4000-8000-000000000002', status: 'applied' as const, appliedDataVersion: 'company-benefits-2026-11-02-v1', appliedAt: '2026-11-02T02:00:00Z', updatedAt: '2026-11-02T02:00:00Z' }
    page(corrections({ listAdminQueue: vi.fn().mockResolvedValue({ ok: true, data: { items: [approved, applied], hasMore: false, nextCursor: null } }) }))
    const rows = await screen.findAllByRole('button', { name: /복지 정정.*선택/ })
    fireEvent.click(rows[0])
    expect(screen.getByText('승인됨 · 데이터 적용 대기')).toBeInTheDocument()
    expect(screen.queryByText(/적용 버전/)).not.toBeInTheDocument()
    fireEvent.click(rows[1])
    expect(screen.getByText('company-benefits-2026-11-02-v1')).toBeInTheDocument()
  })

  it.each([
    ['서버 응답을 확인할 수 없습니다.'], ['로그인이 필요합니다.'], ['요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'], ['네트워크 요청에 실패했습니다.'],
  ])('fails closed with accessible retry for %s', async (message) => {
    const listAdminQueue = vi.fn().mockResolvedValueOnce({ ok: false, error: { code: 'unknown', message } }).mockResolvedValueOnce({ ok: true, data: { items: [], hasMore: false, nextCursor: null } })
    page(corrections({ listAdminQueue }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(listAdminQueue).toHaveBeenCalledTimes(2))
  })
})
