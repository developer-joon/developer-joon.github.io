import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { App } from './App'
import { AuthContext, type AuthContextValue } from './auth/AuthProvider'
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
  ['/community/benefits/rankings/', 'rankings'],
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
