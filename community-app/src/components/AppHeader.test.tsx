/// <reference types="node" />

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, AuthProvider, type AuthClient, type AuthContextValue } from '../auth/AuthProvider'
import { DEFAULT_AUTH_PROVIDER } from '../auth/providers'
import { AppHeader } from './AppHeader'

const communityCss = readFileSync(resolve(process.cwd(), 'src/styles/community.css'), 'utf8')

function stubMobileViewport(initialMatches = true) {
  let matches = initialMatches
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const media = '(max-width: 1023px)'
  const result = {
    get matches() { return matches },
    media,
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeListener: (listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    dispatchEvent: () => true,
  } as MediaQueryList
  vi.stubGlobal('matchMedia', vi.fn(() => result))
  return {
    listenerCount: () => listeners.size,
    setMatches(next: boolean) {
      matches = next
      const event = { matches, media } as MediaQueryListEvent
      listeners.forEach((listener) => listener(event))
    },
  }
}

afterEach(() => {
  document.body.style.overflow = ''
  vi.unstubAllGlobals()
})

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

function authValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    loading: false,
    pending: false,
    session: null,
    user: null,
    error: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
    ...overrides,
  }
}

function globalShell() {
  const header = screen.getByRole('banner')
  const navigation = within(header).getByRole('navigation', { name: '주요 메뉴' })
  const actions = screen.getByRole('region', { name: '커뮤니티 작업' })
  return { header, navigation, actions }
}

describe('AppHeader global shell', () => {
  it('matches the Jekyll brand and exact global navigation order', () => {
    render(<AuthContext.Provider value={authValue()}><AppHeader /></AuthContext.Provider>)

    const { header, navigation } = globalShell()
    expect(within(header).getByRole('link', { name: 'Ria & Seoa PaPa' })).toHaveAttribute('href', '/')
    expect(within(navigation).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['0 → 1', '/lab/'],
      ['Blog', '/blog/'],
      ['Community', '/community/'],
      ['Shop', '/shop/'],
      ['About', '/about'],
    ])
    expect(within(navigation).getByRole('link', { name: 'Community' })).toHaveAttribute('aria-current', 'page')
  })

  it('keeps account controls and identity outside the global header and navigation', () => {
    const user = { id: 'user-1', email: 'dev@example.com', user_metadata: { user_name: 'breaddev' } } as unknown as AuthContextValue['user']
    render(<AuthContext.Provider value={authValue({ user })}><AppHeader /></AuthContext.Provider>)

    const { header, navigation, actions } = globalShell()
    expect(within(header).queryByText('breaddev')).not.toBeInTheDocument()
    expect(within(header).queryByRole('button', { name: /로그인|로그아웃/ })).not.toBeInTheDocument()
    expect(within(navigation).queryByText('breaddev')).not.toBeInTheDocument()
    expect(within(navigation).queryByRole('button')).not.toBeInTheDocument()
    expect(header).not.toContainElement(actions)
    expect(navigation).not.toContainElement(actions)
    expect(within(actions).getByText('breaddev')).toBeInTheDocument()
    expect(within(actions).getByRole('button', { name: '로그아웃' })).toBeInTheDocument()
  })

  it('provides an accessible mobile menu toggle without removing links from the DOM', () => {
    stubMobileViewport()
    render(<AuthContext.Provider value={authValue()}><AppHeader /></AuthContext.Provider>)

    const navigation = screen.getByRole('navigation', { name: '주요 메뉴' })
    const toggle = screen.getByRole('button', { name: '주요 메뉴 열기' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAttribute('aria-controls', navigation.id)
    expect(toggle).not.toHaveTextContent(/menu|메뉴/i)
    expect(toggle.querySelector('.menu-toggle__icon')).toHaveAttribute('aria-hidden', 'true')
    expect(within(navigation).getAllByRole('link')).toHaveLength(5)

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAccessibleName('주요 메뉴 닫기')
    expect(within(navigation).getAllByRole('link')).toHaveLength(5)
  })

  it('moves focus into the mobile menu, traps Tab, closes on Escape, and restores focus and scroll', () => {
    stubMobileViewport()
    document.body.style.overflow = 'clip'
    render(<AuthContext.Provider value={authValue()}><AppHeader /></AuthContext.Provider>)
    const navigation = screen.getByRole('navigation', { name: '주요 메뉴' })
    const links = within(navigation).getAllByRole('link')
    const toggle = screen.getByRole('button', { name: '주요 메뉴 열기' })

    toggle.focus()
    fireEvent.click(toggle)
    expect(links[0]).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')

    fireEvent.keyDown(links[0], { key: 'Tab', shiftKey: true })
    expect(toggle).toHaveFocus()
    links.at(-1)!.focus()
    fireEvent.keyDown(links.at(-1)!, { key: 'Tab' })
    expect(toggle).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
    expect(document.body.style.overflow).toBe('clip')
  })

  it('closes the mobile menu on link activation', () => {
    stubMobileViewport()
    render(<AuthContext.Provider value={authValue()}><AppHeader /></AuthContext.Provider>)
    fireEvent.click(screen.getByRole('button', { name: '주요 메뉴 열기' }))
    const blogLink = screen.getByRole('link', { name: 'Blog' })
    blogLink.addEventListener('click', (event) => event.preventDefault(), { once: true })
    fireEvent.click(blogLink)
    expect(screen.getByRole('button', { name: '주요 메뉴 열기' })).toHaveAttribute('aria-expanded', 'false')
    expect(document.body.style.overflow).toBe('')
  })

  it('cleans up the modal menu when desktop navigation activates or the header unmounts', () => {
    const viewport = stubMobileViewport()
    document.body.style.overflow = 'auto'
    const view = render(<AuthContext.Provider value={authValue()}><AppHeader /></AuthContext.Provider>)
    const toggle = screen.getByRole('button', { name: '주요 메뉴 열기' })
    fireEvent.click(toggle)
    expect(viewport.listenerCount()).toBe(1)
    expect(document.body.style.overflow).toBe('hidden')

    act(() => viewport.setMatches(false))
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(document.body.style.overflow).toBe('auto')
    expect(screen.getByRole('navigation', { name: '주요 메뉴' })).not.toHaveClass('is-open')
    expect(within(screen.getByRole('navigation', { name: '주요 메뉴' })).getAllByRole('link')).toHaveLength(5)

    act(() => viewport.setMatches(true))
    fireEvent.click(toggle)
    view.unmount()
    expect(document.body.style.overflow).toBe('auto')
    expect(viewport.listenerCount()).toBe(0)
  })
})

describe('AppHeader community actions', () => {
  it('offers one Write link and one Google login using the default auth provider', () => {
    const signIn = vi.fn().mockResolvedValue(undefined)
    render(<AuthContext.Provider value={authValue({ signIn })}><AppHeader /></AuthContext.Provider>)

    const { actions } = globalShell()
    const write = within(actions).getByRole('link', { name: '글쓰기' })
    const login = within(actions).getByRole('button', { name: 'Google로 로그인' })
    expect(screen.getAllByRole('link', { name: '글쓰기' })).toHaveLength(1)
    expect(write).toHaveAttribute('href', '/community/write/')
    expect(login).toHaveTextContent('Google 로그인')
    expect(screen.queryByText(/카카오|Kakao|GitHub/)).not.toBeInTheDocument()

    fireEvent.click(login)

    expect(signIn).toHaveBeenCalledWith(DEFAULT_AUTH_PROVIDER)
  })

  it('shows a bounded safe identity and logout while signed in', async () => {
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
      render(<AuthProvider client={client(session, { signOut })}><AppHeader /></AuthProvider>)

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
      expect(mobileRule?.conditionText).toBe('(max-width: 1023px)')
      const narrowIdentityRule = [...(mobileRule?.cssRules ?? [])]
        .find((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.selectorText === '.auth-identity')
      expect(narrowIdentityRule?.style.maxWidth).toBe('min(20vw, 5rem)')

      const logout = screen.getByRole('button', { name: '로그아웃' })
      fireEvent.click(logout)
      expect(signOut).toHaveBeenCalledOnce()
    } finally {
      stylesheet.remove()
    }
  })

  it('keeps loading and pending auth actions accessible and disabled', async () => {
    const getSession = vi.fn(() => new Promise(() => undefined))
    const loadingView = render(<AuthProvider client={client(null, { getSession: getSession as AuthClient['getSession'] })}><AppHeader /></AuthProvider>)
    expect(screen.getByRole('button', { name: '로그인 상태 확인 중' })).toBeDisabled()
    loadingView.unmount()

    const signInWithOAuth = vi.fn(() => new Promise(() => undefined))
    render(<AuthProvider client={client(null, { signInWithOAuth: signInWithOAuth as AuthClient['signInWithOAuth'] })}><AppHeader /></AuthProvider>)
    const login = await screen.findByRole('button', { name: 'Google로 로그인' })
    fireEvent.click(login)
    expect(screen.getByRole('button', { name: 'Google 연결 중' })).toBeDisabled()
  })

  it('announces auth errors in the community action row', () => {
    render(<AuthContext.Provider value={authValue({ error: '로그인에 실패했습니다.' })}><AppHeader /></AuthContext.Provider>)

    const { actions } = globalShell()
    expect(within(actions).getByRole('status')).toHaveTextContent('로그인에 실패했습니다.')
  })

  it('uses the provider-neutral fallback for users without identity metadata', async () => {
    const session = { user: { id: 'user-1', email: null, user_metadata: {} } }
    render(<AuthProvider client={client(session)}><AppHeader /></AuthProvider>)

    expect(await screen.findByText('커뮤니티 사용자')).toBeInTheDocument()
  })
})
