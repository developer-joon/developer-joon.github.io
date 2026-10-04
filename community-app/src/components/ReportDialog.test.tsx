import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CommunityRepository } from '../data/communityRepository'
import type { CommunityResult } from '../types/community'
import { ReportDialog } from './ReportDialog'

function success(data = '76000000-0000-4000-8000-000000000001'): CommunityResult<string> {
  return { ok: true, data }
}

function failure(): CommunityResult<string> {
  return { ok: false, error: { code: 'network', sourceCode: 'NETWORK_ERROR', message: '네트워크 연결을 확인해 주세요.' } }
}

function props(overrides: Partial<React.ComponentProps<typeof ReportDialog>> = {}): React.ComponentProps<typeof ReportDialog> {
  return {
    repository: { createReport: vi.fn().mockResolvedValue(success()) } as Pick<CommunityRepository, 'createReport'>,
    targetType: 'post',
    targetId: '56000000-0000-4000-8000-000000000010',
    targetLabel: '게시글 “안전한 상세 글”',
    actorId: 'actor-a',
    currentPath: '/community/post?id=56000000-0000-4000-8000-000000000010#discussion',
    authLoading: false,
    authPending: false,
    onLogin: vi.fn(),
    uuidFactory: vi.fn(() => '66000000-0000-4000-8000-000000000001'),
    ...overrides,
  }
}

describe('ReportDialog', () => {
  it('uses an explicit disabled login affordance for signed-out readers without an RPC', () => {
    const onLogin = vi.fn()
    const createReport = vi.fn()
    const base = props({ actorId: null, onLogin, repository: { createReport } as Pick<CommunityRepository, 'createReport'> })
    const { rerender } = render(<ReportDialog {...base} />)

    fireEvent.click(screen.getByRole('button', { name: '로그인하고 게시글 신고하기' }))
    expect(onLogin).toHaveBeenCalledTimes(1)
    expect(createReport).not.toHaveBeenCalled()

    rerender(<ReportDialog {...base} authLoading />)
    expect(screen.getByRole('button', { name: '로그인하고 게시글 신고하기' })).toBeDisabled()
    rerender(<ReportDialog {...base} authPending />)
    expect(screen.getByRole('button', { name: '로그인하고 게시글 신고하기' })).toBeDisabled()
  })

  it('opens an accessible form and requires detail for other', async () => {
    const createReport = vi.fn()
    render(<ReportDialog {...props({ repository: { createReport } as Pick<CommunityRepository, 'createReport'> })} />)

    fireEvent.click(screen.getByRole('button', { name: '게시글 신고하기' }))
    const dialog = screen.getByRole('dialog', { name: '게시글 신고' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByText('게시글 “안전한 상세 글”')).toBeInTheDocument()
    expect(within(dialog).getByRole('option', { name: '스팸' })).toBeInTheDocument()
    expect(within(dialog).getByRole('option', { name: '괴롭힘' })).toBeInTheDocument()
    expect(within(dialog).getByRole('option', { name: '유해한 콘텐츠' })).toBeInTheDocument()
    expect(within(dialog).getByRole('option', { name: '기타' })).toBeInTheDocument()
    expect(within(dialog).getByRole('combobox', { name: '신고 사유' })).toHaveFocus()
    expect(within(dialog).getByRole('textbox', { name: '상세 내용 (선택)' })).toHaveAttribute('maxLength', '2000')

    fireEvent.change(within(dialog).getByRole('combobox', { name: '신고 사유' }), { target: { value: 'other' } })
    fireEvent.change(within(dialog).getByRole('textbox', { name: '상세 내용 (선택)' }), { target: { value: '   ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '신고 제출' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('기타 사유는 상세 내용을 입력해 주세요.')
    expect(createReport).not.toHaveBeenCalled()
  })

  it('single-flights submission, reuses the UUID on retry, and returns focus on close', async () => {
    let resolveFirst!: (result: CommunityResult<string>) => void
    const first = new Promise<CommunityResult<string>>((resolve) => { resolveFirst = resolve })
    const createReport = vi.fn().mockReturnValueOnce(first).mockResolvedValue(success())
    const uuidFactory = vi.fn()
      .mockReturnValueOnce('66000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('66000000-0000-4000-8000-000000000002')
    render(<ReportDialog {...props({ repository: { createReport } as Pick<CommunityRepository, 'createReport'>, uuidFactory })} />)

    const trigger = screen.getByRole('button', { name: '게시글 신고하기' })
    fireEvent.click(trigger)
    const submit = screen.getByRole('button', { name: '신고 제출' })
    fireEvent.click(submit)
    fireEvent.click(submit)
    expect(createReport).toHaveBeenCalledTimes(1)
    expect(submit).toBeDisabled()
    expect(submit).toHaveAttribute('aria-busy', 'true')

    resolveFirst(failure())
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('네트워크 연결을 확인해 주세요.')
    expect(screen.getByRole('combobox', { name: '신고 사유' })).toHaveValue('spam')
    fireEvent.click(screen.getByRole('button', { name: '신고 제출' }))
    expect(createReport).toHaveBeenCalledTimes(2)
    expect(createReport.mock.calls[0][0].idempotencyKey).toBe('66000000-0000-4000-8000-000000000001')
    expect(createReport.mock.calls[1][0].idempotencyKey).toBe('66000000-0000-4000-8000-000000000001')

    const status = await screen.findByRole('status', { name: '신고 접수 완료' })
    expect(status).toHaveTextContent('신고가 접수되었습니다.')
    await waitFor(() => expect(document.activeElement).toBe(status))
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).toBe(trigger))

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: '신고 제출' }))
    await screen.findByRole('status', { name: '신고 접수 완료' })
    expect(createReport.mock.calls[2][0].idempotencyKey).toBe('66000000-0000-4000-8000-000000000002')
  })

  it('rotates the idempotency key when a failed report payload is edited', async () => {
    const createReport = vi.fn().mockResolvedValueOnce(failure()).mockResolvedValueOnce(success())
    const uuidFactory = vi.fn()
      .mockReturnValueOnce('66000000-0000-4000-8000-000000000021')
      .mockReturnValueOnce('66000000-0000-4000-8000-000000000022')
    render(<ReportDialog {...props({ repository: { createReport } as Pick<CommunityRepository, 'createReport'>, uuidFactory })} />)
    fireEvent.click(screen.getByRole('button', { name: '게시글 신고하기' }))
    fireEvent.click(screen.getByRole('button', { name: '신고 제출' }))
    await screen.findByRole('alert')

    fireEvent.change(screen.getByRole('combobox', { name: '신고 사유' }), { target: { value: 'harmful' } })
    fireEvent.change(screen.getByRole('textbox', { name: '상세 내용 (선택)' }), { target: { value: '변경된 신고 내용' } })
    fireEvent.click(screen.getByRole('button', { name: '신고 제출' }))
    await screen.findByRole('status', { name: '신고 접수 완료' })

    expect(createReport.mock.calls.map(call => call[0].idempotencyKey)).toEqual([
      '66000000-0000-4000-8000-000000000021',
      '66000000-0000-4000-8000-000000000022',
    ])
  })

  it('reuses the normalized payload key after editing away and back following failure', async () => {
    const createReport = vi.fn().mockResolvedValueOnce(failure()).mockResolvedValueOnce(success())
    const uuidFactory = vi.fn()
      .mockReturnValueOnce('66000000-0000-4000-8000-000000000031')
      .mockReturnValueOnce('66000000-0000-4000-8000-000000000032')
    render(<ReportDialog {...props({ repository: { createReport } as Pick<CommunityRepository, 'createReport'>, uuidFactory })} />)
    fireEvent.click(screen.getByRole('button', { name: '게시글 신고하기' }))
    fireEvent.click(screen.getByRole('button', { name: '신고 제출' }))
    await screen.findByRole('alert')

    fireEvent.change(screen.getByRole('combobox', { name: '신고 사유' }), { target: { value: 'harmful' } })
    fireEvent.change(screen.getByRole('combobox', { name: '신고 사유' }), { target: { value: 'spam' } })
    fireEvent.change(screen.getByRole('textbox', { name: '상세 내용 (선택)' }), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: '신고 제출' }))
    await screen.findByRole('status', { name: '신고 접수 완료' })

    expect(createReport.mock.calls.map(call => call[0].idempotencyKey)).toEqual([
      '66000000-0000-4000-8000-000000000031',
      '66000000-0000-4000-8000-000000000031',
    ])
    expect(uuidFactory).toHaveBeenCalledTimes(1)
  })

  it('cancels to the invoking button and gives the next intent a fresh UUID', async () => {
    const createReport = vi.fn().mockResolvedValueOnce(failure()).mockResolvedValueOnce(success())
    const uuidFactory = vi.fn()
      .mockReturnValueOnce('66000000-0000-4000-8000-000000000011')
      .mockReturnValueOnce('66000000-0000-4000-8000-000000000012')
    render(<ReportDialog {...props({ repository: { createReport } as Pick<CommunityRepository, 'createReport'>, uuidFactory })} />)
    const trigger = screen.getByRole('button', { name: '게시글 신고하기' })

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: '신고 제출' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: '신고 제출' }))
    await screen.findByRole('status', { name: '신고 접수 완료' })
    expect(uuidFactory).toHaveBeenCalledTimes(2)
    expect(createReport.mock.calls.map((call) => call[0].idempotencyKey)).toEqual([
      '66000000-0000-4000-8000-000000000011',
      '66000000-0000-4000-8000-000000000012',
    ])
  })

  it('traps keyboard focus, closes on Escape, and cannot cancel an in-flight submission', async () => {
    let resolveRequest!: (result: CommunityResult<string>) => void
    const request = new Promise<CommunityResult<string>>((resolve) => { resolveRequest = resolve })
    const createReport = vi.fn().mockReturnValue(request)
    render(<ReportDialog {...props({ repository: { createReport } as Pick<CommunityRepository, 'createReport'> })} />)
    const trigger = screen.getByRole('button', { name: '게시글 신고하기' })

    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: '게시글 신고' })
    const first = within(dialog).getByRole('combobox', { name: '신고 사유' })
    const last = within(dialog).getByRole('button', { name: '신고 제출' })
    last.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(first).toHaveFocus()
    first.focus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: '신고 제출' }))
    const cancel = screen.getByRole('button', { name: '취소' })
    expect(cancel).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(createReport).toHaveBeenCalledTimes(1)

    resolveRequest(success())
    const successStatus = await screen.findByRole('status', { name: '신고 접수 완료' })
    expect(successStatus).toHaveFocus()
    const close = screen.getByRole('button', { name: '닫기' })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true })
    expect(close).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' })
    expect(close).toHaveFocus()
  })

  it('invalidates late completion on actor change without unlocking a newer operation', async () => {
    let resolveOld!: (result: CommunityResult<string>) => void
    let resolveNew!: (result: CommunityResult<string>) => void
    const oldRequest = new Promise<CommunityResult<string>>((resolve) => { resolveOld = resolve })
    const newRequest = new Promise<CommunityResult<string>>((resolve) => { resolveNew = resolve })
    const createReport = vi.fn().mockReturnValueOnce(oldRequest).mockReturnValueOnce(newRequest)
    const base = props({ repository: { createReport } as Pick<CommunityRepository, 'createReport'> })
    const { rerender } = render(<ReportDialog {...base} />)

    fireEvent.click(screen.getByRole('button', { name: '게시글 신고하기' }))
    fireEvent.click(screen.getByRole('button', { name: '신고 제출' }))
    rerender(<ReportDialog {...base} actorId="actor-b" />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '게시글 신고하기' })).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: '게시글 신고하기' }))
    fireEvent.click(screen.getByRole('button', { name: '신고 제출' }))
    resolveOld(success())
    await oldRequest
    await waitFor(() => expect(screen.getByRole('button', { name: '신고 제출' })).toBeDisabled())
    expect(screen.queryByRole('status', { name: '신고 접수 완료' })).not.toBeInTheDocument()

    resolveNew(success())
    expect(await screen.findByRole('status', { name: '신고 접수 완료' })).toBeInTheDocument()
  })
})
