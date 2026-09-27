import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PostEditor } from './PostEditor'

const tags = [
  { id: '56000000-0000-4000-8000-000000000040', slug: 'typescript', label: 'TypeScript' },
  { id: '56000000-0000-4000-8000-000000000041', slug: 'testing', label: 'Testing with an extremely long editorial label that must wrap' },
  { id: '56000000-0000-4000-8000-000000000042', slug: 'react', label: 'React' },
  { id: '56000000-0000-4000-8000-000000000043', slug: 'css', label: 'CSS' },
]

describe('PostEditor', () => {
  it('shows field errors, links them to controls, and does not publish invalid input', async () => {
    const submit = vi.fn()
    render(<PostEditor initialValue={{ title: '', bodyMarkdown: '', tagIds: [] }} tags={tags} onSubmit={submit} submitLabel="발행" />)
    fireEvent.click(screen.getByRole('button', { name: '발행' }))
    expect(submit).not.toHaveBeenCalled()
    expect(screen.getByLabelText('제목')).toHaveAttribute('aria-describedby', expect.stringContaining('title-error'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())
  })

  it('limits tags to three and exposes count and help', () => {
    render(<PostEditor initialValue={{ title: '제목', bodyMarkdown: '본문', tagIds: [] }} tags={tags} onSubmit={vi.fn()} submitLabel="발행" />)
    tags.slice(0, 3).forEach(({ label }) => fireEvent.click(screen.getByRole('checkbox', { name: label })))
    expect(screen.getByText('3 / 3개 선택')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: tags[3].label })).toBeDisabled()
  })

  it('prevents duplicate submit while pending', async () => {
    let resolve!: () => void
    const submit = vi.fn(() => new Promise<void>((done) => { resolve = done }))
    render(<PostEditor initialValue={{ title: '제목', bodyMarkdown: '본문', tagIds: [tags[0].id] }} tags={tags} onSubmit={submit} submitLabel="발행" />)
    const button = screen.getByRole('button', { name: '발행' })
    fireEvent.click(button); fireEvent.click(button)
    expect(submit).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent('처리 중')
    resolve()
    await waitFor(() => expect(button).not.toBeDisabled())
  })

  it('renders a sanitized keyboard-accessible preview without raw HTML execution', () => {
    render(<PostEditor initialValue={{ title: '제목', bodyMarkdown: '**안전**\n\n<script>alert(1)</script>', tagIds: [tags[0].id] }} tags={tags} onSubmit={vi.fn()} submitLabel="발행" />)
    fireEvent.click(screen.getByRole('tab', { name: '미리보기' }))
    expect(screen.queryByText('alert(1)', { selector: 'script' })).not.toBeInTheDocument()
    expect(screen.getByText('안전')).toBeInTheDocument()
  })

  it('blocks unavailable edit tags until active replacements are chosen', () => {
    const submit = vi.fn()
    render(<PostEditor initialValue={{ title: '제목', bodyMarkdown: '본문', tagIds: ['56000000-0000-4000-8000-000000000099'] }} tags={tags} unavailableTagLabels={['비활성 태그']} onSubmit={submit} submitLabel="수정" />)
    expect(screen.getByRole('alert')).toHaveTextContent('비활성 태그')
    fireEvent.click(screen.getByRole('button', { name: '수정' }))
    expect(submit).not.toHaveBeenCalled()
  })
})
