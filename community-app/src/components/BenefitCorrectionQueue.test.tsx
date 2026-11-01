import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AdminBenefitCorrectionItem } from '../types/benefitCorrections'
import { BenefitCorrectionQueue } from './BenefitCorrectionQueue'

const item: AdminBenefitCorrectionItem = {
  id: '10000000-0000-4000-8000-000000000001',
  companyId: 'KR-CRN-1234567890123',
  categoryId: 'leave',
  currentText: '기존 휴가 정책',
  proposedText: '연차 20일 및 리프레시 휴가',
  scopeText: '대한민국 정규직 전사 적용',
  sourceUrl: 'https://example.com/benefits/very/long/evidence/path',
  observedDataVersion: 'company-benefits-2026-11-01-v1',
  status: 'submitted',
  adminResponse: null,
  appliedDataVersion: null,
  appliedAt: null,
  createdAt: '2026-11-01T01:00:00Z',
  updatedAt: '2026-11-01T01:00:00Z',
  reviewedAt: null,
}

const baseProps = {
  items: [item], selectedId: null, filter: 'active' as const, loading: false, loadingMore: false,
  error: null, hasMore: false, announcement: '', onSelect: vi.fn(), onFilterChange: vi.fn(), onRetry: vi.fn(), onLoadMore: vi.fn(),
}

describe('BenefitCorrectionQueue', () => {
  it('renders deterministic filters and review-safe submitted fields', () => {
    render(<BenefitCorrectionQueue {...baseProps} />)
    expect(screen.getByRole('button', { name: '처리 중' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('KR-CRN-1234567890123')).toBeInTheDocument()
    expect(screen.getByText('연차 20일 및 리프레시 휴가')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /복지 정정.*선택/ })).toBeInTheDocument()
    expect(screen.queryByText(/@|이메일|actor|token/i)).not.toBeInTheDocument()
  })

  it('emits the selected stable filter and exposes accessible retry/load-more controls', () => {
    const onFilterChange = vi.fn(); const onRetry = vi.fn(); const onLoadMore = vi.fn()
    const { rerender } = render(<BenefitCorrectionQueue {...baseProps} items={[]} error="네트워크 요청에 실패했습니다." onFilterChange={onFilterChange} onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: '승인' }))
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(onFilterChange).toHaveBeenCalledWith('approved')
    expect(onRetry).toHaveBeenCalledTimes(1)

    rerender(<BenefitCorrectionQueue {...baseProps} hasMore loadingMore onLoadMore={onLoadMore} />)
    expect(screen.getByRole('button', { name: '불러오는 중' })).toBeDisabled()
  })
})
