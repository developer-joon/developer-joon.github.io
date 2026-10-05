import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../auth/AuthProvider'
import { DEFAULT_AUTH_PROVIDER } from '../auth/providers'
import { AdminReportsPage } from './AdminReportsPage'
import type { CommunityRepository } from '../data/communityRepository'
import type { AdminReportItem } from '../types/community'

const report: AdminReportItem = {
  id: '10000000-0000-4000-8000-000000000001', status: 'open', reasonCode: 'spam', detail: '광고', createdAt: '2026-09-29T01:00:00Z', resolvedAt: null, resolvedBy: null,
  reporter: { id: '20000000-0000-4000-8000-000000000001', login: 'reporter', displayName: null, avatarUrl: null },
  target: { type: 'comment', id: '30000000-0000-4000-8000-000000000001', available: false },
}
const signedOut = { loading: false, pending: false, session: null, user: null, error: null, signIn: vi.fn(), signOut: vi.fn(), invalidateStaleSession: vi.fn(() => false) } satisfies AuthContextValue
const signedIn = { ...signedOut, session: {} as never, user: { id: '40000000-0000-4000-8000-000000000001' } as never }
function repo(overrides: Partial<CommunityRepository> = {}) {
  return { isAdmin: vi.fn(), listAdminReports: vi.fn(), listModerationAuditLogs: vi.fn(), setReportStatus: vi.fn(), moderatePost: vi.fn(), moderateComment: vi.fn(), ...overrides } as unknown as CommunityRepository
}

describe('AdminReportsPage', () => {
  it('shows auth loading and signs in with the exact current path', () => {
    const login = vi.fn()
    const { rerender } = render(<AuthContext.Provider value={{ ...signedOut, loading: true }}><AdminReportsPage repository={repo()} currentPath="/community/admin/reports/?status=open#queue" /></AuthContext.Provider>)
    expect(screen.getByRole('status')).toHaveTextContent('로그인 상태를 확인')
    rerender(<AuthContext.Provider value={{ ...signedOut, signIn: login }}><AdminReportsPage repository={repo()} currentPath="/community/admin/reports/?status=open#queue" /></AuthContext.Provider>)
    fireEvent.click(screen.getByRole('button', { name: 'Google로 관리자 로그인' }))
    expect(login).toHaveBeenCalledWith(DEFAULT_AUTH_PROVIDER, '/community/admin/reports/?status=open#queue')
  })

  it('shows visible accessible provider copy while admin sign-in is pending', () => {
    render(<AuthContext.Provider value={{ ...signedOut, pending: true }}><AdminReportsPage repository={repo()} currentPath="/community/admin/reports/" /></AuthContext.Provider>)
    const gate = screen.getByRole('heading', { name: '관리자 로그인이 필요합니다' }).closest('section')
    expect(gate).not.toBeNull()
    const button = within(gate!).getByRole('button', { name: 'Google 연결 중' })
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Google 연결 중')
  })

  it('checks DB admin before queue access and denies non-admins', async () => {
    const listAdminReports = vi.fn()
    render(<AuthContext.Provider value={signedIn}><AdminReportsPage repository={repo({ isAdmin: vi.fn().mockResolvedValue({ ok: true, data: false }), listAdminReports })} currentPath="/community/admin/reports/" /></AuthContext.Provider>)
    expect(await screen.findByRole('heading', { name: '접근 권한이 없습니다' })).toBeInTheDocument()
    expect(listAdminReports).not.toHaveBeenCalled()
  })

  it('loads bounded queue and selected-report audit, and merges load-more without duplicates', async () => {
    const second = { ...report, id: '10000000-0000-4000-8000-000000000002', createdAt: '2026-09-29T00:00:00Z' }
    const listAdminReports = vi.fn().mockResolvedValueOnce({ ok: true, data: { items: [report], hasMore: true, nextCursor: { createdAt: report.createdAt, id: report.id } } }).mockResolvedValueOnce({ ok: true, data: { items: [report, second], hasMore: false, nextCursor: null } })
    const listModerationAuditLogs = vi.fn().mockResolvedValue({ ok: true, data: { items: [{ id: '50000000-0000-4000-8000-000000000001', actor: null, action: 'report.created', targetType: 'report', targetId: report.id, reason: null, metadata: { source: 'web' }, createdAt: report.createdAt }], hasMore: false, nextCursor: null } })
    render(<AuthContext.Provider value={signedIn}><AdminReportsPage repository={repo({ isAdmin: vi.fn().mockResolvedValue({ ok: true, data: true }), listAdminReports, listModerationAuditLogs })} currentPath="/community/admin/reports/" /></AuthContext.Provider>)
    expect(await screen.findByRole('heading', { name: '신고 운영 데스크' })).toBeInTheDocument()
    expect(listAdminReports).toHaveBeenCalledWith({ status: 'active', limit: 50 })
    fireEvent.click(await screen.findByRole('button', { name: /신고.*선택/ }))
    await waitFor(() => expect(listModerationAuditLogs).toHaveBeenCalledWith({ targetType: 'report', targetId: report.id, limit: 50 }))
    expect(await screen.findByText('시스템')).toBeInTheDocument()
    expect(screen.getByText(/"source": "web"/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '신고 더 불러오기' }))
    await waitFor(() => expect(screen.getAllByRole('button', { name: /신고.*선택/ })).toHaveLength(2))
  })

  it('ignores stale admin completion after actor changes', async () => {
    let finish!: (value: unknown) => void
    const isAdmin = vi.fn().mockReturnValueOnce(new Promise(resolve => { finish = resolve })).mockResolvedValue({ ok: true, data: false })
    const repository = repo({ isAdmin, listAdminReports: vi.fn() })
    const view = render(<AuthContext.Provider value={signedIn}><AdminReportsPage repository={repository} currentPath="/community/admin/reports/" /></AuthContext.Provider>)
    view.rerender(<AuthContext.Provider value={{ ...signedIn, user: { id: '40000000-0000-4000-8000-000000000002' } as never }}><AdminReportsPage repository={repository} currentPath="/community/admin/reports/" /></AuthContext.Provider>)
    finish({ ok: true, data: true })
    expect(await screen.findByRole('heading', { name: '접근 권한이 없습니다' })).toBeInTheDocument()
    expect(repository.listAdminReports).not.toHaveBeenCalled()
  })

  it('never renders the previous admin queue while a new actor is being authorized', async () => {
    let authorizeNext!: (value: { ok: true; data: boolean }) => void
    const isAdmin = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: true })
      .mockReturnValueOnce(new Promise(resolve => { authorizeNext = resolve }))
    const repository = repo({
      isAdmin,
      listAdminReports: vi.fn().mockResolvedValue({ ok: true, data: { items: [report], hasMore: false, nextCursor: null } }),
    })
    const view = render(<AuthContext.Provider value={signedIn}><AdminReportsPage repository={repository} currentPath="/community/admin/reports/" /></AuthContext.Provider>)
    expect(await screen.findByRole('button', { name: /신고.*선택/ })).toBeInTheDocument()

    view.rerender(<AuthContext.Provider value={{ ...signedIn, user: { id: '40000000-0000-4000-8000-000000000002' } as never }}><AdminReportsPage repository={repository} currentPath="/community/admin/reports/" /></AuthContext.Provider>)
    expect(screen.getByRole('status')).toHaveTextContent('관리자 권한을 확인')
    expect(screen.queryByRole('button', { name: /신고.*선택/ })).not.toBeInTheDocument()
    authorizeNext({ ok: true, data: false })
    expect(await screen.findByRole('heading', { name: '접근 권한이 없습니다' })).toBeInTheDocument()
  })

  it('shows target audit after a content action and moves focus to the selected inspector', async () => {
    const available = { ...report, target: { type: 'post' as const, id: '30000000-0000-4000-8000-000000000010', available: true as const, postId: '30000000-0000-4000-8000-000000000010', status: 'published' as const, title: '대상 글', excerpt: '내용', isLocked: false, isPinned: false } }
    const contentAudit = { id: '50000000-0000-4000-8000-000000000010', actor: null, action: 'post.hidden', targetType: 'post' as const, targetId: available.target.id, reason: '정책 위반', metadata: { from: 'published', to: 'hidden' }, createdAt: '2026-09-29T03:00:00Z' }
    let postAuditReads = 0
    const repository = repo({
      isAdmin: vi.fn().mockResolvedValue({ ok: true, data: true }),
      listAdminReports: vi.fn().mockResolvedValue({ ok: true, data: { items: [available], hasMore: false, nextCursor: null } }),
      listModerationAuditLogs: vi.fn().mockImplementation(async input => {
        if (input.targetType === 'post') postAuditReads += 1
        return { ok: true, data: { items: input.targetType === 'post' && postAuditReads > 1 ? [contentAudit] : [], hasMore: false, nextCursor: null } }
      }),
      moderatePost: vi.fn().mockResolvedValue({ ok: true, data: { id: available.target.id, status: 'hidden', isLocked: false, isPinned: false, updatedAt: '2026-09-29T03:00:00Z', deletedAt: null } }),
    })
    render(<AuthContext.Provider value={signedIn}><AdminReportsPage repository={repository} currentPath="/community/admin/reports/" /></AuthContext.Provider>)
    fireEvent.click(await screen.findByRole('button', { name: /신고.*선택/ }))
    expect(screen.getByRole('complementary', { name: '선택한 신고 검토' })).toHaveFocus()
    await waitFor(() => expect(repository.listModerationAuditLogs).toHaveBeenCalledWith({ targetType: 'post', targetId: available.target.id, limit: 50 }))

    fireEvent.change(screen.getByLabelText('처리 사유'), { target: { value: '정책 위반' } })
    fireEvent.click(screen.getByRole('button', { name: '게시글 숨기기' }))
    expect(await screen.findByText('post.hidden')).toBeInTheDocument()
  })

  it('loads additional audit pages with their keyset cursor', async () => {
    const cursor = { createdAt: report.createdAt, id: '50000000-0000-4000-8000-000000000001' }
    const firstAudit = { id: cursor.id, actor: null, action: 'report.created', targetType: 'report' as const, targetId: report.id, reason: null, metadata: {}, createdAt: cursor.createdAt }
    const secondAudit = { ...firstAudit, id: '50000000-0000-4000-8000-000000000002', action: 'report.status_changed', createdAt: '2026-09-29T00:00:00Z' }
    const listModerationAuditLogs = vi.fn().mockImplementation(async input => {
      if (input.targetType !== 'report') return { ok: true, data: { items: [], hasMore: false, nextCursor: null } }
      if (input.cursor) return { ok: true, data: { items: [secondAudit], hasMore: false, nextCursor: null } }
      return { ok: true, data: { items: [firstAudit], hasMore: true, nextCursor: cursor } }
    })
    const repository = repo({
      isAdmin: vi.fn().mockResolvedValue({ ok: true, data: true }),
      listAdminReports: vi.fn().mockResolvedValue({ ok: true, data: { items: [report], hasMore: false, nextCursor: null } }),
      listModerationAuditLogs,
    })
    render(<AuthContext.Provider value={signedIn}><AdminReportsPage repository={repository} currentPath="/community/admin/reports/" /></AuthContext.Provider>)
    fireEvent.click(await screen.findByRole('button', { name: /신고.*선택/ }))
    fireEvent.click(await screen.findByRole('button', { name: '감사 기록 더 불러오기' }))
    expect(await screen.findByText('report.status_changed')).toBeInTheDocument()
    expect(listModerationAuditLogs).toHaveBeenLastCalledWith({ targetType: 'report', targetId: report.id, limit: 50, cursor })
  })

  it('announces only unique audit rows and changes duplicate-only page announcements', async () => {
    const firstCursor = { createdAt: report.createdAt, id: '50000000-0000-4000-8000-000000000011' }
    const secondCursor = { createdAt: '2026-09-29T00:59:00Z', id: '50000000-0000-4000-8000-000000000012' }
    const firstAudit = { id: firstCursor.id, actor: null, action: 'report.created', targetType: 'report' as const, targetId: report.id, reason: null, metadata: {}, createdAt: firstCursor.createdAt }
    let reportRead = 0
    const listModerationAuditLogs = vi.fn().mockImplementation(async input => {
      if (input.targetType !== 'report') return { ok: true, data: { items: [], hasMore: false, nextCursor: null } }
      reportRead += 1
      if (reportRead === 1) return { ok: true, data: { items: [firstAudit], hasMore: true, nextCursor: firstCursor } }
      if (reportRead === 2) return { ok: true, data: { items: [firstAudit], hasMore: true, nextCursor: secondCursor } }
      return { ok: true, data: { items: [firstAudit], hasMore: false, nextCursor: null } }
    })
    const repository = repo({
      isAdmin: vi.fn().mockResolvedValue({ ok: true, data: true }),
      listAdminReports: vi.fn().mockResolvedValue({ ok: true, data: { items: [report], hasMore: false, nextCursor: null } }),
      listModerationAuditLogs,
    })
    render(<AuthContext.Provider value={signedIn}><AdminReportsPage repository={repository} currentPath="/community/admin/reports/" /></AuthContext.Provider>)
    fireEvent.click(await screen.findByRole('button', { name: /신고.*선택/ }))
    fireEvent.click(await screen.findByRole('button', { name: '감사 기록 더 불러오기' }))
    expect(await screen.findByText(/새 기록 0건.*추가 요청 1/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '감사 기록 더 불러오기' }))
    expect(await screen.findByText(/새 기록 0건.*추가 요청 2/)).toBeInTheDocument()
    expect(screen.getAllByText('report.created')).toHaveLength(1)
  })

  it('single-flights queue pagination and preserves a concurrent authoritative target update', async () => {
    const available = { ...report, target: { type: 'post' as const, id: '30000000-0000-4000-8000-000000000020', available: true as const, postId: '30000000-0000-4000-8000-000000000020', status: 'published' as const, title: '대상 글', excerpt: '내용', isLocked: false, isPinned: false } }
    const second = { ...report, id: '10000000-0000-4000-8000-000000000020', createdAt: '2026-09-29T00:00:00Z' }
    let finishPage!: (value: unknown) => void
    const page = new Promise(resolve => { finishPage = resolve })
    const listAdminReports = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { items: [available], hasMore: true, nextCursor: { createdAt: available.createdAt, id: available.id } } })
      .mockReturnValueOnce(page)
    const repository = repo({
      isAdmin: vi.fn().mockResolvedValue({ ok: true, data: true }),
      listAdminReports,
      listModerationAuditLogs: vi.fn().mockResolvedValue({ ok: true, data: { items: [], hasMore: false, nextCursor: null } }),
      moderatePost: vi.fn().mockResolvedValue({ ok: true, data: { id: available.target.id, status: 'hidden', isLocked: false, isPinned: false, updatedAt: '2026-09-29T03:00:00Z', deletedAt: null } }),
    })
    render(<AuthContext.Provider value={signedIn}><AdminReportsPage repository={repository} currentPath="/community/admin/reports/" /></AuthContext.Provider>)
    fireEvent.click(await screen.findByRole('button', { name: /신고.*선택/ }))
    const loadMore = screen.getByRole('button', { name: '신고 더 불러오기' })
    fireEvent.click(loadMore)
    fireEvent.click(loadMore)
    expect(listAdminReports).toHaveBeenCalledTimes(2)

    fireEvent.change(screen.getByLabelText('처리 사유'), { target: { value: '정책 위반' } })
    fireEvent.click(screen.getByRole('button', { name: '게시글 숨기기' }))
    expect(await screen.findByRole('button', { name: '게시글 복원' })).toBeInTheDocument()

    finishPage({ ok: true, data: { items: [available, second], hasMore: false, nextCursor: null } })
    await waitFor(() => expect(screen.getAllByRole('button', { name: /신고.*선택/ })).toHaveLength(2))
    expect(screen.getByRole('button', { name: '게시글 복원' })).toBeInTheDocument()
    expect(screen.getByText('신고 1건을 더 불러와 총 2건입니다.')).toBeInTheDocument()
  })

  it('removes a resolved report from the active queue using the authoritative response', async () => {
    const resolved = { ...report, status: 'resolved' as const, resolvedAt: '2026-09-29T02:00:00Z', resolvedBy: '40000000-0000-4000-8000-000000000001' }
    const repository = repo({
      isAdmin: vi.fn().mockResolvedValue({ ok: true, data: true }),
      listAdminReports: vi.fn().mockResolvedValue({ ok: true, data: { items: [report], hasMore: false, nextCursor: null } }),
      listModerationAuditLogs: vi.fn().mockResolvedValue({ ok: true, data: { items: [], hasMore: false, nextCursor: null } }),
      setReportStatus: vi.fn().mockResolvedValue({ ok: true, data: resolved }),
    })
    render(<AuthContext.Provider value={signedIn}><AdminReportsPage repository={repository} currentPath="/community/admin/reports/" /></AuthContext.Provider>)
    fireEvent.click(await screen.findByRole('button', { name: /신고.*선택/ }))
    fireEvent.change(screen.getByLabelText('처리 사유'), { target: { value: '검토 완료' } })
    fireEvent.click(screen.getByRole('button', { name: '신고 해결 처리' }))

    expect(await screen.findByText('조건에 맞는 신고가 없습니다.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /신고.*선택/ })).not.toBeInTheDocument()
  })
})
