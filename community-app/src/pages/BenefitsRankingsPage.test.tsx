import { render, screen, fireEvent, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { BenefitsExplorerPage } from './BenefitsExplorerPage'
import { benefitsClient } from '../data/benefitsArtifactClient'
import { manifest, index, rankings, details } from '../test/benefitsFixture'

const companyId = (position: number) =>
  `example-${String(position).padStart(position < 1000 ? 3 : 4, '0')}`
vi.mock('../data/benefitsArtifactClient', () => ({
  benefitsClient: {
    loadManifest: vi.fn(),
    loadCompanyIndex: vi.fn(),
    loadRankings: vi.fn(),
    loadCompanyDetails: vi.fn(),
  },
}))
beforeEach(() => {
  vi.mocked(benefitsClient.loadManifest).mockResolvedValue(manifest)
  vi.mocked(benefitsClient.loadCompanyIndex).mockResolvedValue(index)
  vi.mocked(benefitsClient.loadRankings).mockResolvedValue(rankings)
  vi.mocked(benefitsClient.loadCompanyDetails).mockImplementation(
    async (_manifest, _index, ids) =>
      details.companies.filter((detail) => ids.includes(detail.company_id)),
  )
})
it('requires one category, displays four components and separates insufficient evidence', async () => {
  render(
    <BenefitsExplorerPage
      route="rankings"
      search="?scope=domestic&compare=example-001"
    />,
  )
  expect(
    await screen.findByText('순위를 볼 복지 분야 하나를 선택하세요.'),
  ).toBeVisible()
  expect(benefitsClient.loadRankings).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('순위 분야'), {
    target: { value: 'family' },
  })
  expect(
    await screen.findByRole('heading', { name: '평가 근거 부족' }),
  ).toBeVisible()
  const list = screen.getByRole('region', { name: '분야별 평가 결과' })
  expect(within(list).getAllByText(/세부 유형 범위/).length).toBeGreaterThan(0)
  expect(list).toHaveTextContent('적용 대상의 폭')
  expect(list).toHaveTextContent('구체성')
  expect(list).toHaveTextContent('공식성·최신성')
  expect(
    screen.getByRole('link', { name: '내게 맞는 복지' }).getAttribute('href'),
  ).toContain('compare=example-001')
})
it('blocks only rankings on integrity error, offers retry', async () => {
  vi.mocked(benefitsClient.loadRankings).mockRejectedValueOnce(
    Error('integrity'),
  )
  render(<BenefitsExplorerPage route="rankings" search="?categories=family" />)
  expect(await screen.findByRole('alert')).toHaveTextContent('순위 무결성 오류')
  expect(screen.getByRole('link', { name: '복지 히트맵' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '순위 다시 시도' }))
  expect(
    await screen.findByRole('region', { name: '분야별 평가 결과' }),
  ).toBeVisible()
})

it('paginates 2,000 ranked and insufficient companies with at most 50 company rows total', async () => {
  const companies = Array.from({ length: 2000 }, (_, indexPosition) => ({
    ...index.companies[indexPosition % index.companies.length],
    company_id: companyId(indexPosition + 1),
    display_name: `순위 경계기업 ${indexPosition + 1}`,
  }))
  vi.mocked(benefitsClient.loadCompanyIndex).mockResolvedValue({
    ...index,
    companies,
  })
  vi.mocked(benefitsClient.loadRankings).mockResolvedValue({
    ...rankings,
    rows: companies.map((company, indexPosition) => ({
      company_id: company.company_id,
      category: 'family' as const,
      eligible: indexPosition < 1500,
      reason: indexPosition < 1500 ? '' : '공개 근거 부족',
      components: {
        breadth: indexPosition < 1500 ? 35 : 0,
        applicability: indexPosition < 1500 ? 30 : 0,
        specificity: indexPosition < 1500 ? 20 : 0,
        freshness: indexPosition < 1500 ? 15 : 0,
      },
      score: indexPosition < 1500 ? 100 : 0,
    })),
  })

  render(
    <BenefitsExplorerPage route="rankings" search="?categories=family" />,
  )

  const ranked = await screen.findByRole('region', {
    name: '분야별 평가 결과',
  })
  const insufficient = screen.getByRole('region', { name: '평가 근거 부족' })
  expect(
    within(ranked).getAllByRole('listitem').length +
      within(insufficient).queryAllByRole('listitem').length,
  ).toBe(50)
  expect(ranked).toHaveTextContent('순위 경계기업 1')
  expect(ranked).not.toHaveTextContent('순위 경계기업 51')

  fireEvent.click(screen.getByRole('button', { name: '다음 페이지' }))

  expect(await screen.findByText('순위 경계기업 51')).toBeVisible()
  expect(new URLSearchParams(window.location.search).get('page')).toBe('2')
  expect(
    within(ranked).getAllByRole('listitem').length +
      within(insufficient).queryAllByRole('listitem').length,
  ).toBe(50)
})
