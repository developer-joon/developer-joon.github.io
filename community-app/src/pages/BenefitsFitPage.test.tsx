import { render, screen, fireEvent } from '@testing-library/react'
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
