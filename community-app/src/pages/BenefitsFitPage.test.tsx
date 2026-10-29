import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
it('labels matching results, insufficient evidence and custom URL weights without storing personal data', async () => {
  render(<BenefitsExplorerPage route="fit" search="?preset=parenting" />)
  expect(
    await screen.findByRole('heading', { name: '조건 일치 기업' }),
  ).toBeVisible()
  expect(await screen.findAllByText(/자료 부족/)).not.toHaveLength(0)
  fireEvent.change(screen.getByLabelText('생활 우선순위'), {
    target: { value: 'custom' },
  })
  fireEvent.change(screen.getByLabelText('육아·가족 중요도'), {
    target: { value: '5' },
  })
  expect(window.location.search).toContain('weights=family%3A5')
  expect(screen.getByText(/URL과 현재 브라우저 메모리/)).toBeVisible()
  expect(screen.getAllByText(/판단 자료 부족/).length).toBeGreaterThan(0)
})

it('ranks 2,000 companies before loading details and requests only the 50 displayed IDs', async () => {
  const companies = Array.from({ length: 2000 }, (_, indexPosition) => ({
    ...index.companies[indexPosition % index.companies.length],
    company_id: companyId(indexPosition + 1),
    display_name: `맞춤 경계기업 ${indexPosition + 1}`,
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
      eligible: true,
      reason: '',
      components: {
        breadth: indexPosition < 50 ? 35 : 1,
        applicability: indexPosition < 50 ? 30 : 0,
        specificity: indexPosition < 50 ? 20 : 0,
        freshness: indexPosition < 50 ? 15 : 0,
      },
      score: indexPosition < 50 ? 100 : 1,
    })),
  })
  vi.mocked(benefitsClient.loadCompanyDetails).mockImplementation(
    () => new Promise(() => undefined),
  )

  const { container } = render(
    <BenefitsExplorerPage
      route="fit"
      search="?preset=custom&weights=family:5"
    />,
  )

  await waitFor(() =>
    expect(container.querySelectorAll('article.benefits-result')).toHaveLength(50),
  )
  expect(screen.getByText('맞춤 경계기업 1')).toBeVisible()
  expect(screen.queryByText('맞춤 경계기업 51')).not.toBeInTheDocument()
  expect(screen.getAllByText('적용 범위 근거를 불러오는 중입니다.')).toHaveLength(
    50,
  )
  await waitFor(() => expect(benefitsClient.loadCompanyDetails).toHaveBeenCalled())
  const requestedIds = vi.mocked(benefitsClient.loadCompanyDetails).mock.calls[0][2]
  expect(requestedIds).toEqual(
    Array.from({ length: 50 }, (_, indexPosition) => companyId(indexPosition + 1)),
  )
})
