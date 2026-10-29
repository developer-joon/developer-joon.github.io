import { render, screen, fireEvent, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { BenefitsExplorerPage } from './BenefitsExplorerPage'
import { benefitsClient } from '../data/benefitsArtifactClient'
import { manifest, index, rankings, details } from '../test/benefitsFixture'
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
