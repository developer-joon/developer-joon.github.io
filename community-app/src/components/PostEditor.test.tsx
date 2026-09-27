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
  it('does not re-date an untouched initial value and only emits real edits', () => {
    const change = vi.fn()
    render(<PostEditor initialValue={{ title: '제목', bodyMarkdown: '본문', tagIds: [tags[0].id] }} tags={tags} onChange={change} onSubmit={vi.fn()} submitLabel="수정" />)
    expect(change).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '바뀐 제목' } })
    expect(change).toHaveBeenCalledWith({ title: '바뀐 제목', bodyMarkdown: '본문', tagIds: [tags[0].id] })
  })

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

  it('disables every editor control and auxiliary action while externally pending', () => {
    render(<PostEditor initialValue={{ title: '제목', bodyMarkdown: '본문', tagIds: [tags[0].id] }} tags={tags} onSubmit={vi.fn()} submitLabel="수정" disabled auxiliaryActions={<button type="button">글 삭제</button>} />)

    expect(screen.getByLabelText('제목')).toBeDisabled()
    expect(screen.getByLabelText('본문')).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'TypeScript' })).toBeDisabled()
    expect(screen.getByRole('tab', { name: '미리보기' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '수정' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '글 삭제' })).toBeDisabled()
  })

  it('focuses and scrolls a new asynchronous submission alert without focusing on ordinary render', async () => {
    const scrollIntoView = vi.fn()
    HTMLElement.prototype.scrollIntoView = scrollIntoView
    const view = render(<PostEditor initialValue={{ title: '제목', bodyMarkdown: '본문', tagIds: [tags[0].id] }} tags={tags} onSubmit={vi.fn()} submitLabel="발행" />)
    expect(screen.getByLabelText('제목')).not.toHaveFocus()

    view.rerender(<PostEditor initialValue={{ title: '제목', bodyMarkdown: '본문', tagIds: [tags[0].id] }} tags={tags} onSubmit={vi.fn()} submitLabel="발행" submissionError="저장 실패" />)

    const alert = await screen.findByRole('alert')
    await waitFor(() => expect(alert).toHaveFocus())
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
  })

  it('only references rendered tag descriptions', () => {
    const view = render(<PostEditor initialValue={{ title: '제목', bodyMarkdown: '본문', tagIds: [] }} tags={tags} onSubmit={vi.fn()} submitLabel="발행" />)
    expect(screen.getByRole('group', { name: '태그' })).toHaveAttribute('aria-describedby', 'tag-help')

    view.unmount()
    render(<PostEditor initialValue={{ title: '제목', bodyMarkdown: '본문', tagIds: ['56000000-0000-4000-8000-000000000099'] }} tags={tags} unavailableTagLabels={['비활성 태그']} onSubmit={vi.fn()} submitLabel="발행" />)
    expect(screen.getByRole('group', { name: '태그' })).toHaveAttribute('aria-describedby', expect.stringContaining('unavailable-tags'))
  })

  it('renders a sanitized keyboard-accessible preview without raw HTML execution', () => {
    render(<PostEditor initialValue={{ title: '제목', bodyMarkdown: '**안전**\n\n<script>alert(1)</script>', tagIds: [tags[0].id] }} tags={tags} onSubmit={vi.fn()} submitLabel="발행" />)
    fireEvent.click(screen.getByRole('tab', { name: '미리보기' }))
    expect(screen.queryByText('alert(1)', { selector: 'script' })).not.toBeInTheDocument()
    expect(screen.getByText('안전')).toBeInTheDocument()
  })

  it('implements roving keyboard tabs with an associated tabpanel', async () => {
    render(<PostEditor initialValue={{ title: '제목', bodyMarkdown: '본문', tagIds: [tags[0].id] }} tags={tags} onSubmit={vi.fn()} submitLabel="발행" />)
    const writeTab = screen.getByRole('tab', { name: '작성' })
    const previewTab = screen.getByRole('tab', { name: '미리보기' })
    expect(writeTab).toHaveAttribute('aria-controls', 'post-editor-panel')
    expect(writeTab).toHaveAttribute('tabindex', '0')
    expect(previewTab).toHaveAttribute('tabindex', '-1')

    fireEvent.keyDown(writeTab, { key: 'ArrowRight' })
    await waitFor(() => expect(previewTab).toHaveFocus())
    expect(previewTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', previewTab.id)

    fireEvent.keyDown(previewTab, { key: 'ArrowRight' })
    await waitFor(() => expect(writeTab).toHaveFocus())
    fireEvent.keyDown(writeTab, { key: 'ArrowLeft' })
    await waitFor(() => expect(previewTab).toHaveFocus())
  })

  it('returns to the write panel when hidden body validation fails', async () => {
    render(<PostEditor initialValue={{ title: '제목', bodyMarkdown: '', tagIds: [tags[0].id] }} tags={tags} onSubmit={vi.fn()} submitLabel="발행" />)
    fireEvent.click(screen.getByRole('tab', { name: '미리보기' }))
    fireEvent.click(screen.getByRole('button', { name: '발행' }))

    expect(screen.getByRole('tab', { name: '작성' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('본문을 1자 이상 50,000자 이하로 입력해 주세요.')).toBeInTheDocument()
  })

  it('blocks unavailable edit tags until active replacements are chosen', () => {
    const submit = vi.fn()
    render(<PostEditor initialValue={{ title: '제목', bodyMarkdown: '본문', tagIds: ['56000000-0000-4000-8000-000000000099'] }} tags={tags} unavailableTagLabels={['비활성 태그']} onSubmit={submit} submitLabel="수정" />)
    expect(screen.getByRole('alert')).toHaveTextContent('비활성 태그')
    fireEvent.click(screen.getByRole('button', { name: '수정' }))
    expect(submit).not.toHaveBeenCalled()
  })
})
