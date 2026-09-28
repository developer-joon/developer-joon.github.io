import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReportQueue } from './ReportQueue'
import type { AdminReportItem } from '../types/community'

const report: AdminReportItem = {
  id: '10000000-0000-4000-8000-000000000001', status: 'open', reasonCode: 'spam', detail: '반복 광고',
  createdAt: '2026-09-29T01:00:00Z', resolvedAt: null, resolvedBy: null,
  reporter: { id: '20000000-0000-4000-8000-000000000001', login: 'reporter', displayName: '신고자', avatarUrl: null },
  target: { type: 'post', id: '30000000-0000-4000-8000-000000000001', available: true, postId: '30000000-0000-4000-8000-000000000001', status: 'published', title: '광고 게시물', excerpt: '본문 요약', isLocked: false, isPinned: false },
}

const base = { selectedId: null, filter: 'active' as const, loading: false, loadingMore: false, error: null, hasMore: false, announcement: '', onSelect: vi.fn(), onFilterChange: vi.fn(), onRetry: vi.fn(), onLoadMore: vi.fn() }

describe('ReportQueue', () => {
  it('renders dense report facts and selects a report with a button', () => {
    const onSelect = vi.fn()
    render(<ReportQueue {...base} items={[report]} onSelect={onSelect} />)
    expect(screen.getByText('반복 광고')).toBeInTheDocument()
    expect(screen.getByText(/신고자.*reporter/)).toBeInTheDocument()
    expect(screen.getByText('광고 게시물')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /신고.*광고 게시물.*선택/ }))
    expect(onSelect).toHaveBeenCalledWith(report.id)
  })

  it('marks a dangling target explicitly and exposes no content action', () => {
    render(<ReportQueue {...base} items={[{ ...report, target: { type: 'comment', id: report.target.id, available: false } }]} />)
    expect(screen.getByText('삭제되어 원문을 확인할 수 없음')).toBeInTheDocument()
    expect(screen.queryByText('본문 요약')).not.toBeInTheDocument()
  })

  it('announces queue updates without moving keyboard focus', () => {
    const view = render(<ReportQueue {...base} items={[report]} />)
    const selected = screen.getByRole('button', { name: /신고.*광고 게시물.*선택/ })
    selected.focus()
    view.rerender(<ReportQueue {...base} items={[report]} announcement="신고 1건을 불러왔습니다." />)
    expect(selected).toHaveFocus()
    expect(screen.getByRole('status')).not.toHaveAttribute('tabindex')
  })

  it('supports all filters, retry, load-more, and a polite announcement', () => {
    const onFilterChange = vi.fn(); const onRetry = vi.fn(); const onLoadMore = vi.fn()
    const view = render(<ReportQueue {...base} items={[]} filter="resolved" error="목록 실패" hasMore onFilterChange={onFilterChange} onRetry={onRetry} onLoadMore={onLoadMore} announcement="신고 2건을 더 불러왔습니다." />)
    fireEvent.click(screen.getByRole('button', { name: '전체' }))
    expect(onFilterChange).toHaveBeenCalledWith('all')
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(onRetry).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '신고 더 불러오기' }))
    expect(onLoadMore).toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('신고 2건을 더 불러왔습니다.')
    view.rerender(<ReportQueue {...base} items={[]} />)
    expect(screen.getByText('조건에 맞는 신고가 없습니다.')).toBeInTheDocument()
  })
})
