import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ModerationActions } from './ModerationActions'
import type { CommunityRepository } from '../data/communityRepository'
import type { AdminReportItem, CommunityResult } from '../types/community'

const report: AdminReportItem = {
  id: '10000000-0000-4000-8000-000000000001', status: 'open', reasonCode: 'spam', detail: null,
  createdAt: '2026-09-29T01:00:00Z', resolvedAt: null, resolvedBy: null,
  reporter: { id: '20000000-0000-4000-8000-000000000001', login: 'reporter', displayName: null, avatarUrl: null },
  target: { type: 'post', id: '30000000-0000-4000-8000-000000000001', available: true, postId: '30000000-0000-4000-8000-000000000001', status: 'published', title: '대상', excerpt: '', isLocked: false, isPinned: false },
}

function repository(overrides: Partial<CommunityRepository> = {}) {
  return { setReportStatus: vi.fn(), moderatePost: vi.fn(), moderateComment: vi.fn(), ...overrides } as unknown as CommunityRepository
}

describe('ModerationActions', () => {
  it('requires a nonblank reason and sends explicit report CAS with an idempotency key', async () => {
    const setReportStatus = vi.fn().mockResolvedValue({ ok: true, data: { ...report, status: 'reviewing' } })
    const onReportUpdated = vi.fn()
    render(<ModerationActions report={report} repository={repository({ setReportStatus })} onReportUpdated={onReportUpdated} onTargetUpdated={vi.fn()} onConflictReload={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '검토 중으로 변경' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('처리 사유를 입력해 주세요')
    fireEvent.change(screen.getByLabelText('처리 사유'), { target: { value: '광고 여부 확인' } })
    fireEvent.click(screen.getByRole('button', { name: '검토 중으로 변경' }))
    await waitFor(() => expect(setReportStatus).toHaveBeenCalledTimes(1))
    expect(setReportStatus).toHaveBeenCalledWith(expect.objectContaining({ reportId: report.id, expectedStatus: 'open', desiredStatus: 'reviewing', reason: '광고 여부 확인', idempotencyKey: expect.any(String) }))
    expect(onReportUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 'reviewing' }))
  })

  it('globally single-flights report and content actions and uses authoritative post state', async () => {
    let finish!: (value: unknown) => void
    const moderatePost = vi.fn().mockReturnValue(new Promise(resolve => { finish = resolve }))
    const repo = repository({ moderatePost, setReportStatus: vi.fn() })
    const onTargetUpdated = vi.fn()
    render(<ModerationActions report={report} repository={repo} onReportUpdated={vi.fn()} onTargetUpdated={onTargetUpdated} onConflictReload={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('처리 사유'), { target: { value: '운영 정책 위반' } })
    fireEvent.click(screen.getByRole('button', { name: '게시글 숨기기' }))
    expect(screen.getByRole('button', { name: '신고 해결 처리' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '신고 해결 처리' }))
    expect(repo.setReportStatus).not.toHaveBeenCalled()
    finish({ ok: true, data: { id: report.target.id, status: 'hidden', isLocked: true, isPinned: false, updatedAt: '2026-09-29T02:00:00Z', deletedAt: null } })
    await waitFor(() => expect(onTargetUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 'hidden', isLocked: true })))
  })

  it('keeps the same intent key after failure, rotates it after success, and reloads on conflict', async () => {
    const calls: unknown[] = []
    const moderatePost = vi.fn(async (input) => { calls.push(input); return calls.length === 1 ? { ok: false, error: { code: 'network', message: '네트워크 오류', sourceCode: 'NETWORK_ERROR' } } : calls.length === 2 ? { ok: true, data: { id: report.target.id, status: 'hidden', isLocked: false, isPinned: false, updatedAt: '2026-09-29T02:00:00Z', deletedAt: null } } : { ok: false, error: { code: 'conflict', message: '충돌', sourceCode: '40001' } } })
    const reload = vi.fn()
    const stableRepository = repository({ moderatePost: moderatePost as CommunityRepository['moderatePost'] })
    const view = render(<ModerationActions report={report} repository={stableRepository} onReportUpdated={vi.fn()} onTargetUpdated={vi.fn()} onConflictReload={reload} />)
    fireEvent.change(screen.getByLabelText('처리 사유'), { target: { value: '정책 위반' } })
    fireEvent.click(screen.getByRole('button', { name: '게시글 숨기기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('네트워크 오류')
    fireEvent.click(screen.getByRole('button', { name: '게시글 숨기기' }))
    await screen.findByRole('status')
    expect((calls[0] as { idempotencyKey: string }).idempotencyKey).toBe((calls[1] as { idempotencyKey: string }).idempotencyKey)
    view.rerender(<ModerationActions report={report} repository={stableRepository} onReportUpdated={vi.fn()} onTargetUpdated={vi.fn()} onConflictReload={reload} />)
    fireEvent.click(screen.getByRole('button', { name: '게시글 숨기기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('새로고침')
    expect(reload).toHaveBeenCalled()
  })

  it('offers only legal actions for terminal reports and hidden posts', () => {
    const hidden = {
      ...report,
      status: 'resolved' as const,
      resolvedAt: '2026-09-29T02:00:00Z',
      resolvedBy: report.reporter.id,
      target: { ...report.target, status: 'hidden' as const, isPinned: false },
    }
    render(<ModerationActions report={hidden} repository={repository()} onReportUpdated={vi.fn()} onTargetUpdated={vi.fn()} onConflictReload={vi.fn()} />)

    expect(screen.queryByRole('group', { name: '신고 상태 조치' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '게시글 복원' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '게시글 잠그기' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '게시글 삭제 처리' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '게시글 고정' })).not.toBeInTheDocument()
    expect(screen.queryByText(/영구 삭제/)).not.toBeInTheDocument()
  })

  it('invalidates a pending completion after unmount', async () => {
    let finish!: (value: CommunityResult<AdminReportItem>) => void
    const request = new Promise<CommunityResult<AdminReportItem>>(resolve => { finish = resolve })
    const onReportUpdated = vi.fn()
    const view = render(<ModerationActions report={report} repository={repository({ setReportStatus: vi.fn().mockReturnValue(request) })} onReportUpdated={onReportUpdated} onTargetUpdated={vi.fn()} onConflictReload={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('처리 사유'), { target: { value: '검토 사유' } })
    fireEvent.click(screen.getByRole('button', { name: '검토 중으로 변경' }))
    view.unmount()

    finish({ ok: true, data: { ...report, status: 'reviewing' } })
    await request
    expect(onReportUpdated).not.toHaveBeenCalled()
  })

  it('invalidates a pending completion when the same target receives newer authoritative state', async () => {
    let finishOld!: (value: CommunityResult<{ id: string; status: 'hidden'; isLocked: boolean; isPinned: boolean; updatedAt: string; deletedAt: null }>) => void
    const oldRequest = new Promise<CommunityResult<{ id: string; status: 'hidden'; isLocked: boolean; isPinned: boolean; updatedAt: string; deletedAt: null }>>(resolve => { finishOld = resolve })
    const repo = repository({ moderatePost: vi.fn().mockReturnValue(oldRequest) })
    const onTargetUpdated = vi.fn()
    const view = render(<ModerationActions report={report} repository={repo} onReportUpdated={vi.fn()} onTargetUpdated={onTargetUpdated} onConflictReload={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('처리 사유'), { target: { value: '정책 위반' } })
    fireEvent.click(screen.getByRole('button', { name: '게시글 숨기기' }))

    const newer = { ...report, target: { ...report.target, status: 'hidden' as const, isLocked: true } }
    view.rerender(<ModerationActions report={newer} repository={repo} onReportUpdated={vi.fn()} onTargetUpdated={onTargetUpdated} onConflictReload={vi.fn()} />)
    expect(screen.getByRole('button', { name: '게시글 복원' })).toBeEnabled()

    finishOld({ ok: true, data: { id: report.target.id, status: 'hidden', isLocked: false, isPinned: false, updatedAt: '2026-09-29T03:00:00Z', deletedAt: null } })
    await oldRequest
    expect(onTargetUpdated).not.toHaveBeenCalled()
    expect(screen.queryByText('관리 작업이 반영되었습니다.')).not.toBeInTheDocument()
  })

  it('invalidates pending state and idempotency intent when the selected report changes', async () => {
    let finishOld!: (value: CommunityResult<AdminReportItem>) => void
    const oldRequest = new Promise<CommunityResult<AdminReportItem>>((resolve) => { finishOld = resolve })
    const reportB = { ...report, id: '10000000-0000-4000-8000-000000000002' }
    const uuidFactory = vi.fn()
      .mockReturnValueOnce('70000000-0000-4000-8000-000000000011')
      .mockReturnValueOnce('70000000-0000-4000-8000-000000000012')
    const setReportStatus = vi.fn()
      .mockReturnValueOnce(oldRequest)
      .mockResolvedValueOnce({ ok: false, error: { code: 'network', sourceCode: 'NETWORK_ERROR', message: '다시 시도해 주세요.' } })
    const repo = repository({ setReportStatus })
    const view = render(<ModerationActions report={report} repository={repo} uuidFactory={uuidFactory} onReportUpdated={vi.fn()} onTargetUpdated={vi.fn()} onConflictReload={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('처리 사유'), { target: { value: '같은 사유' } })
    fireEvent.click(screen.getByRole('button', { name: '검토 중으로 변경' }))
    expect(screen.getByRole('button', { name: '신고 해결 처리' })).toBeDisabled()

    view.rerender(<ModerationActions report={reportB} repository={repo} uuidFactory={uuidFactory} onReportUpdated={vi.fn()} onTargetUpdated={vi.fn()} onConflictReload={vi.fn()} />)
    expect(screen.getByRole('button', { name: '신고 해결 처리' })).toBeEnabled()
    fireEvent.change(screen.getByLabelText('처리 사유'), { target: { value: '같은 사유' } })
    fireEvent.click(screen.getByRole('button', { name: '검토 중으로 변경' }))
    expect(setReportStatus).toHaveBeenCalledTimes(2)
    expect(setReportStatus.mock.calls.map(call => call[0].idempotencyKey)).toEqual([
      '70000000-0000-4000-8000-000000000011',
      '70000000-0000-4000-8000-000000000012',
    ])

    finishOld({ ok: true, data: { ...report, status: 'reviewing' } })
    await oldRequest
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('다시 시도해 주세요.'))
    expect(screen.queryByText('조치가 반영되었습니다.')).not.toBeInTheDocument()
  })
})
