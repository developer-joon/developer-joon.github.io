import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommentComposer } from './CommentComposer'

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }

describe('CommentComposer', () => {
  it('connects label, help and validation error and rejects whitespace/5001', async () => {
    const submit = vi.fn()
    render(<CommentComposer onSubmit={submit} />)
    const input = screen.getByRole('textbox', { name: '댓글 내용' })
    expect(input).toHaveAttribute('aria-describedby', expect.stringContaining('help'))
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: '댓글 작성' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('1자 이상')
    fireEvent.change(input, { target: { value: 'a'.repeat(5001) } })
    fireEvent.click(screen.getByRole('button', { name: '댓글 작성' }))
    expect(screen.getByRole('alert')).toHaveTextContent('5000자 이하')
    expect(submit).not.toHaveBeenCalled()
  })

  it('reuses key after failure, changes it after edit, and clears only on success', async () => {
    const submit = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    render(<CommentComposer onSubmit={submit} />)
    const input = screen.getByRole('textbox', { name: '댓글 내용' })
    fireEvent.change(input, { target: { value: ' 첫 댓글 ' } })
    fireEvent.click(screen.getByRole('button', { name: '댓글 작성' }))
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
    const firstKey = submit.mock.calls[0][0].idempotencyKey
    expect(input).toHaveValue(' 첫 댓글 ')
    fireEvent.click(screen.getByRole('button', { name: '댓글 작성' }))
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2))
    expect(submit.mock.calls[1][0].idempotencyKey).toBe(firstKey)
    fireEvent.change(input, { target: { value: '편집 댓글' } })
    fireEvent.click(screen.getByRole('button', { name: '댓글 작성' }))
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(3))
    expect(submit.mock.calls[2][0].idempotencyKey).not.toBe(firstKey)
    await waitFor(() => expect(input).toHaveValue(''))
  })

  it('guards double submit synchronously', async () => {
    const pending = deferred<boolean>()
    const submit = vi.fn(() => pending.promise)
    render(<CommentComposer onSubmit={submit} />)
    fireEvent.change(screen.getByRole('textbox', { name: '댓글 내용' }), { target: { value: '댓글' } })
    const button = screen.getByRole('button', { name: '댓글 작성' })
    fireEvent.click(button); fireEvent.click(button)
    expect(submit).toHaveBeenCalledOnce()
    pending.resolve(true)
  })
})
