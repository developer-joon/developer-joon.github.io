import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { App } from './App'
import { AuthContext, type AuthContextValue } from './auth/AuthProvider'
import { BenefitsExplorerShell } from './components/benefits/BenefitsExplorerShell'
import type { Manifest } from './types/benefits'
vi.mock('./pages/BenefitsExplorerPage', () => ({
  BenefitsExplorerPage: ({
    route,
    search,
  }: {
    route: string
    search: string
  }) => (
    <main>
      <h1>복지 {route}</h1>
      <p>{search}</p>
    </main>
  ),
}))
const loadingAuth = {
  loading: true,
  pending: false,
  session: null,
  user: null,
  error: null,
  signIn: vi.fn(),
  signOut: vi.fn(),
  invalidateStaleSession: vi.fn(),
} as AuthContextValue
it('preserves header/footer in the public lazy fallback', async () => {
  render(
    <AuthContext.Provider value={loadingAuth}>
      <App pathname="/community/benefits/" search="?scope=domestic" />
    </AuthContext.Provider>,
  )
  expect(screen.getByRole('status')).toHaveTextContent(
    '복지 탐색기를 준비하고 있습니다.',
  )
  expect(screen.getByRole('banner')).toBeInTheDocument()
  expect(screen.getByRole('contentinfo')).toBeInTheDocument()
  expect(
    await screen.findByRole('heading', { name: '복지 heatmap' }),
  ).toBeVisible()
  expect(screen.getByText('?scope=domestic')).toBeVisible()
})
it.each([
  ['/community/benefits', 'heatmap'],
  ['/community/benefits/fit/', 'fit'],
  ['/community/benefits/company/', 'company'],
])(
  'forwards public route %s while auth initializes',
  async (pathname, route) => {
    render(
      <AuthContext.Provider value={loadingAuth}>
        <App pathname={pathname} search="?q=예시" />
      </AuthContext.Provider>,
    )
    expect(
      await screen.findByRole('heading', { name: `복지 ${route}` }),
    ).toBeVisible()
    expect(screen.getByText('?q=예시')).toBeVisible()
  },
)

it('keeps correction pages behind Community authentication initialization', () => {
  render(
    <AuthContext.Provider value={loadingAuth}>
      <App pathname="/community/benefits/correction/" search="?company=KR-CRN-1101112948086" />
    </AuthContext.Provider>,
  )
  expect(screen.getByRole('status')).toHaveTextContent('로그인 상태를 확인하고 있습니다.')
  expect(screen.queryByText('복지 heatmap')).not.toBeInTheDocument()
})

it('brands the explorer shell as Benefit Atlas while preserving its Korean tabs', () => {
  render(
    <BenefitsExplorerShell route="fit" query="?q=예시">
      <p>탐색 결과</p>
    </BenefitsExplorerShell>,
  )

  expect(screen.getByRole('heading', { level: 1, name: 'Benefit Atlas' })).toBeVisible()
  expect(screen.queryByText('기업 복지 탐색기')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '복지 현황' })).toHaveAttribute('href', '/community/benefits/?q=예시')
  expect(screen.getByRole('link', { name: '조건 탐색' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('link', { name: '조사 기준·정정 이력' })).toHaveAttribute('href', '/community/benefits/methodology/?q=예시')
})

it('renders the Benefit Atlas evidence banner outside the explorer workspace with manifest facts', () => {
  const manifest = {
    data_version: 'company-benefits-2026-10-31-v1',
    company_count: 2000,
    generated_at: '2026-10-31T14:59:59Z',
  } as unknown as Manifest
  const { container } = render(
    <BenefitsExplorerShell route="heatmap" query="" manifest={manifest}>
      <p>탐색 결과</p>
    </BenefitsExplorerShell>,
  )

  const hero = container.querySelector<HTMLElement>('.benefit-atlas-hero')
  const workspace = container.querySelector<HTMLElement>('.benefits-workspace')
  const heading = screen.getByRole('heading', { level: 1, name: 'Benefit Atlas' })

  expect(hero).toBeInTheDocument()
  expect(hero).toContainElement(heading)
  expect(hero?.querySelector('.benefit-atlas-hero__inner')).toHaveClass('community-wrap')
  expect(container.querySelectorAll('h1')).toHaveLength(1)
  expect(hero?.parentElement).toBe(workspace?.parentElement)
  expect(hero?.nextElementSibling).toBe(workspace)
  expect(workspace).not.toContainElement(hero)
  expect(hero).toHaveTextContent('공개 근거')
  expect(hero).toHaveTextContent('데이터 company-benefits-2026-10-31-v1')
  expect(hero).toHaveTextContent('2000개 기업')
  expect(hero).toHaveTextContent('생성일 2026-10-31')
})
