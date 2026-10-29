import { render, screen, fireEvent } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { BenefitsExplorerPage } from './BenefitsExplorerPage'
import { benefitsClient } from '../data/benefitsArtifactClient'
import { manifest, index, details } from '../test/benefitsFixture'
vi.mock('../data/benefitsArtifactClient', () => ({
  benefitsClient: {
    loadManifest: vi.fn(),
    loadCompanyIndex: vi.fn(),
    loadCompanyDetail: vi.fn(),
  },
}))
beforeEach(() => {
  vi.mocked(benefitsClient.loadManifest).mockResolvedValue(manifest)
  vi.mocked(benefitsClient.loadCompanyIndex).mockResolvedValue(index)
  vi.mocked(benefitsClient.loadCompanyDetail).mockResolvedValue(
    details.companies[0],
  )
})
it.each(['', '?id=unknown', '?id=example-999'])(
  'rejects missing or unknown id %s without fetching shard',
  async (search) => {
    render(<BenefitsExplorerPage route="company" search={search} />)
    expect(await screen.findByText('기업을 찾을 수 없습니다')).toBeVisible()
    expect(benefitsClient.loadCompanyDetail).not.toHaveBeenCalled()
  },
)
it('shows entity, applicability, claim, source evidence and preserved return URL', async () => {
  render(
    <BenefitsExplorerPage
      route="company"
      search="?id=example-001&scope=domestic&compare=example-002"
    />,
  )
  expect(await screen.findByText('예시 leave 지원')).toBeVisible()
  expect(screen.getByText('예시 데이터')).toBeVisible()
  expect(screen.getByText('정확한 전체 매출순위가 아님')).toBeVisible()
  expect(
    screen.getAllByText('가상 별빛연구소 1 주식회사').length,
  ).toBeGreaterThan(0)
  expect(screen.getAllByText('예시 연구직').length).toBeGreaterThan(0)
  expect(screen.getAllByText('예시 정규직').length).toBeGreaterThan(0)
  const source = screen.getAllByRole('link', {
    name: '가상 공식 복지 안내 (예시)',
  })[0]
  expect(source).toHaveAttribute('href', 'https://example.org/benefits')
  expect(source).toHaveAttribute('rel', 'noopener noreferrer')
  expect(screen.getAllByText(/등급 A/).length).toBeGreaterThan(0)
  expect(
    screen
      .getByRole('link', { name: '히트맵으로 돌아가기' })
      .getAttribute('href'),
  ).toContain('scope=domestic')
  expect(
    screen
      .getByRole('link', { name: '히트맵으로 돌아가기' })
      .getAttribute('href'),
  ).toContain('compare=example-002')
  expect(
    screen.getByText('확인 불가는 복지가 없다는 뜻이 아닙니다.'),
  ).toBeVisible()
  expect(
    screen.queryByRole('link', { name: '관련 Community 글' }),
  ).not.toBeInTheDocument()
})
it('keeps index on detail failure and retries', async () => {
  vi.mocked(benefitsClient.loadCompanyDetail).mockRejectedValueOnce(
    Error('shard'),
  )
  render(<BenefitsExplorerPage route="company" search="?id=example-001" />)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '상세 근거를 불러올 수 없습니다',
  )
  expect(screen.getByRole('link', { name: '복지 히트맵' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: '상세 다시 시도' }))
  expect(await screen.findByText('예시 leave 지원')).toBeVisible()
})
it('focuses a linked category after its delayed evidence renders', async () => {
  window.history.replaceState(
    {},
    '',
    '/community/benefits/company/?id=example-001#family',
  )
  render(<BenefitsExplorerPage route="company" search="?id=example-001" />)
  const section = await screen.findByRole('region', { name: '육아·가족 근거' })
  expect(section).toHaveFocus()
})
