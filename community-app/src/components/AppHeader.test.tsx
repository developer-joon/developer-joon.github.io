/// <reference types="node" />

import { fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext, AuthProvider, type AuthClient, type AuthContextValue } from '../auth/AuthProvider'
import { DEFAULT_AUTH_PROVIDER } from '../auth/providers'
import { AppHeader } from './AppHeader'

const communityCss = readFileSync(resolve(process.cwd(), 'src/styles/community.css'), 'utf8')

vi.mock('../auth/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/providers')>()
  return { ...actual, ENABLED_AUTH_PROVIDERS: ['github', 'google'] as const }
})

function client(session: unknown, overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
    onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    signInWithOAuth: vi.fn().mockResolvedValue({ data: {}, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    exchangeCodeForSession: vi.fn(),
    ...overrides,
  }
}

describe('AppHeader authentication', () => {
  it('offers exactly one Google login using the default auth provider', () => {
    const signIn = vi.fn().mockResolvedValue(undefined)
    const auth: AuthContextValue = {
      loading: false,
      pending: false,
      session: null,
      user: null,
      error: null,
      signIn,
      signOut: vi.fn(),
    }
    render(<AuthContext.Provider value={auth}><AppHeader /></AuthContext.Provider>)

    const button = screen.getByRole('button', { name: 'Google로 로그인' })
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(button).toHaveTextContent('Google 로그인')
    expect(screen.queryByText(/카카오|Kakao|GitHub/)).not.toBeInTheDocument()
    fireEvent.click(button)
    expect(signIn).toHaveBeenCalledWith(DEFAULT_AUTH_PROVIDER)
  })

  it('shows safe user identity and logout while signed in', async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null })
    const longIdentity = '<img src=x onerror=alert(1)>'.repeat(12)
    const session = {
      user: {
        id: 'user-1',
        email: 'dev@example.com',
        user_metadata: { user_name: longIdentity },
      },
    }
    const stylesheet = document.createElement('style')
    stylesheet.textContent = communityCss
    document.head.append(stylesheet)

    try {
      const view = render(<AuthProvider client={client(session, { signOut })}><AppHeader /></AuthProvider>)

      const identity = await screen.findByText(longIdentity)
      expect(identity).toHaveAttribute('title', longIdentity)
      expect(identity).toHaveClass('auth-identity')
      expect(identity.querySelector('img')).toBeNull()
      const identityStyle = getComputedStyle(identity)
      expect(identityStyle.overflow).toBe('hidden')
      expect(identityStyle.textOverflow).toBe('ellipsis')
      expect(identityStyle.whiteSpace).toBe('nowrap')
      expect(identityStyle.minWidth).toBe('0px')
      expect(identityStyle.maxWidth).toBe('256px')

      const mobileRule = [...stylesheet.sheet!.cssRules]
        .filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule)
        .find((rule) => [...rule.cssRules].some(
          (nestedRule) => nestedRule instanceof CSSStyleRule && nestedRule.selectorText === '.auth-identity',
        ))
      expect(mobileRule?.conditionText).toBe('(max-width: 700px)')
      const narrowIdentityRule = [...(mobileRule?.cssRules ?? [])]
        .find((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === '.auth-identity')
      expect(narrowIdentityRule?.style.maxWidth).toBe('min(20vw, 5rem)')

      expect(screen.getByRole('link', { name: '글쓰기' })).toHaveClass('header-write')
      const logout = screen.getByRole('button', { name: '로그아웃' })
      expect(logout).toBeInTheDocument()
      expect(view.container.querySelector('header')).toContainElement(identity)
      fireEvent.click(logout)
      expect(signOut).toHaveBeenCalledOnce()
    } finally {
      stylesheet.remove()
    }
  })

  it('disables auth actions while the session is loading', () => {
    const getSession = vi.fn(() => new Promise(() => undefined))
    render(<AuthProvider client={client(null, { getSession: getSession as AuthClient['getSession'] })}><AppHeader /></AuthProvider>)

    expect(screen.getByRole('button', { name: '로그인 상태 확인 중' })).toBeDisabled()
  })

  it('announces the pending Google connection state through the button name', async () => {
    const signInWithOAuth = vi.fn(() => new Promise(() => undefined))
    render(<AuthProvider client={client(null, { signInWithOAuth: signInWithOAuth as AuthClient['signInWithOAuth'] })}><AppHeader /></AuthProvider>)
    const login = await screen.findByRole('button', { name: 'Google로 로그인' })

    fireEvent.click(login)

    expect(screen.getByRole('button', { name: 'Google 연결 중' })).toBeDisabled()
  })

  it('uses the provider-neutral fallback for users without identity metadata', async () => {
    const session = { user: { id: 'user-1', email: null, user_metadata: {} } }
    render(<AuthProvider client={client(session)}><AppHeader /></AuthProvider>)

    expect(await screen.findByText('커뮤니티 사용자')).toBeInTheDocument()
  })
})
