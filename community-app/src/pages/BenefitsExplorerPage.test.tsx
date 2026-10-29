import {
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { BenefitsExplorerPage } from './BenefitsExplorerPage'
import { manifest, index, rankings, details, method } from '../test/benefitsFixture'
import { benefitsClient } from '../data/benefitsArtifactClient'
vi.mock('../data/benefitsArtifactClient', () => ({
  benefitsClient: {
    loadManifest: vi.fn(),
    loadCompanyIndex: vi.fn(),
    loadRankings: vi.fn(),
    loadCompanyDetails: vi.fn(),
    loadMethodology: vi.fn(),
  },
}))
beforeEach(() => {
  window.history.replaceState({}, '', '/community/benefits/')
  vi.mocked(benefitsClient.loadManifest).mockResolvedValue(manifest)
  vi.mocked(benefitsClient.loadCompanyIndex).mockResolvedValue(index)
  vi.mocked(benefitsClient.loadRankings).mockResolvedValue(rankings)
  vi.mocked(benefitsClient.loadCompanyDetails).mockImplementation(
    async (_manifest, _index, ids) =>
      details.companies.filter((detail) => ids.includes(detail.company_id)),
  )
  vi.mocked(benefitsClient.loadMethodology).mockResolvedValue(method)
})
describe('benefits heatmap workspace', () => {
  it('discloses fixture, keeps shell, real table and 50-row pagination', async () => {
    render(<BenefitsExplorerPage route="heatmap" search="" />)
    const table = await screen.findByRole('table', {
      name: '기업 복지 공개 상태',
    })
    expect(screen.getByText('예시 데이터')).toBeVisible()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    expect(within(table).getAllByRole('row')).toHaveLength(51)
    expect(screen.getByRole('link', { name: '복지 히트맵' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(
      screen.getByRole('link', {
        name: /예시 별빛기업 01.*휴가·근무시간.*확인됨/,
      }),
    ).toHaveAttribute('href', expect.stringContaining('#leave'))
    fireEvent.click(screen.getByRole('button', { name: '다음 페이지' }))
    expect(within(table).getAllByRole('row')).toHaveLength(7)
  })
  it('filters scope, search and category/status in URL without refetch; empty reset', async () => {
    render(<BenefitsExplorerPage route="heatmap" search="" />)
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('기업 검색'), {
      target: { value: '없는회사' },
    })
    expect(await screen.findByText('검색 결과가 없습니다')).toBeVisible()
    expect(screen.getByText('적용 중인 필터: 검색어 “없는회사”')).toBeVisible()
    expect(window.location.search).toContain('q=')
    fireEvent.click(screen.getByRole('button', { name: '필터 초기화' }))
    fireEvent.change(screen.getByLabelText('기업 범위'), {
      target: { value: 'domestic' },
    })
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(
      29,
    )
    fireEvent.click(screen.getByLabelText('분야 육아·가족'))
    fireEvent.click(screen.getByLabelText('상태 확인됨'))
    expect(screen.getByRole('link', { name: '분야별 순위' })).toHaveAttribute(
      'href',
      expect.stringContaining('categories=family'),
    )
  })
  it('debounces search into one history entry and Back restores committed filters', async () => {
    render(<BenefitsExplorerPage route="heatmap" search="" />)
    await screen.findByRole('table')
    fireEvent.change(screen.getByLabelText('기업 범위'), {
      target: { value: 'domestic' },
    })
    fireEvent.change(screen.getByLabelText('기업 검색'), {
      target: { value: '없' },
    })
    fireEvent.change(screen.getByLabelText('기업 검색'), {
      target: { value: '없는' },
    })
    fireEvent.change(screen.getByLabelText('기업 검색'), {
      target: { value: '없는회사' },
    })
    await waitFor(() => expect(window.location.search).toContain('q='))
    window.history.back()
    await waitFor(() => expect(window.location.search).not.toContain('q='))
    await waitFor(() =>
      expect(screen.getByLabelText('기업 범위')).toHaveValue('domestic'),
    )
    expect(screen.getByLabelText('기업 검색')).toHaveValue('')
  })
  it('aborts stale index loading when the explorer unmounts', async () => {
    let signal: AbortSignal | undefined
    vi.mocked(benefitsClient.loadManifest).mockImplementation(
      async (candidateSignal?: AbortSignal) => {
        signal = candidateSignal
        return new Promise(() => undefined)
      },
    )
    const view = render(<BenefitsExplorerPage route="heatmap" search="" />)
    view.unmount()
    expect(signal?.aborted).toBe(true)
  })
  it('limits comparison to four and exposes claim applicability in tray', async () => {
    render(<BenefitsExplorerPage route="heatmap" search="" />)
    await screen.findByRole('table')
    const checks = screen.getAllByRole('checkbox', { name: /비교 예시/ })
    checks.slice(0, 4).forEach((c) => fireEvent.click(c))
    expect(checks[4]).toBeDisabled()
    const tray = screen.getByRole('region', { name: '선택 기업 비교' })
    expect(await within(tray).findAllByText(/예시 연구직/)).not.toHaveLength(0)
    expect(tray).toHaveTextContent('예시 정규직')
    expect(tray).toHaveTextContent('대한민국')
  })
  it('has loading and fail closed retry with methodology link', async () => {
    vi.mocked(benefitsClient.loadManifest).mockRejectedValueOnce(
      new Error('integrity'),
    )
    render(<BenefitsExplorerPage route="heatmap" search="" />)
    expect(screen.getByRole('status')).toHaveTextContent('불러오고')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '불러올 수 없습니다',
    )
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(screen.getByRole('table')).toBeVisible())
  })
})
it('loads verified claim applicability for fit results', async () => {
  render(<BenefitsExplorerPage route="fit" search="" />)
  const result = await screen.findByRole('heading', {
    name: /예시 별빛기업 01/,
  })
  const article = result.closest('article')!
  expect(
    (await within(article).findAllByText(/예시 연구직/)).length,
  ).toBeGreaterThan(0)
  expect(article).toHaveTextContent('예시 정규직')
  expect(article).toHaveTextContent('대한민국')
  expect(benefitsClient.loadCompanyDetails).toHaveBeenCalled()
})

it('labels manifest generated_at as generation time', async () => {
  render(<BenefitsExplorerPage route="heatmap" search="" />)
  expect(await screen.findByText(/생성일 2026-10-29/)).toBeVisible()
  expect(screen.queryByText(/검증일 2026-10-29/)).not.toBeInTheDocument()
})

it('summarizes the selected category using verified ranking components', async () => {
  render(<BenefitsExplorerPage route="heatmap" search="?categories=family" />)
  const summary = await screen.findByRole('region', {
    name: '분야별 상위 기업',
  })
  expect(within(summary).getAllByRole('link')).toHaveLength(3)
  expect(summary).toHaveTextContent('육아·가족')
  expect(summary).toHaveTextContent('82/100')
})
it('replaces malformed initial URL with canonical filters and bounded page', async () => {
  const search = '?page=999&evil=x&compare=example-001&q=%20%20'
  window.history.replaceState({}, '', '/community/benefits/' + search)
  render(<BenefitsExplorerPage route="heatmap" search={search} />)
  await screen.findByRole('table', { name: '기업 복지 공개 상태' })
  expect(new URLSearchParams(window.location.search).get('page')).toBe('2')
  expect(window.location.search).not.toContain('evil')
  expect(window.location.search).not.toContain('q=')
  expect(new URLSearchParams(window.location.search).get('compare')).toBe(
    'example-001',
  )
})
