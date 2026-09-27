import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AuthProvider, type AuthClient } from '../auth/AuthProvider'
import { AppHeader } from './AppHeader'

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
  it('offers an accessible GitHub login while signed out', async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({ data: {}, error: null })
    render(<AuthProvider client={client(null, { signInWithOAuth })}><AppHeader /></AuthProvider>)

    const button = await screen.findByRole('button', { name: 'GitHub로 로그인' })
    fireEvent.click(button)
    expect(signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({ provider: 'github' }))
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
    render(<AuthProvider client={client(session, { signOut })}><AppHeader /></AuthProvider>)

    expect(await screen.findByText(longIdentity)).toHaveAttribute('title', longIdentity)
    expect(document.querySelector('.auth-identity img')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }))
    expect(signOut).toHaveBeenCalledOnce()
  })

  it('disables auth actions while the session is loading', () => {
    const getSession = vi.fn(() => new Promise(() => undefined))
    render(<AuthProvider client={client(null, { getSession: getSession as AuthClient['getSession'] })}><AppHeader /></AuthProvider>)

    expect(screen.getByRole('button', { name: '로그인 상태 확인 중' })).toBeDisabled()
  })

  it('announces the pending GitHub connection state through the button name', async () => {
    const signInWithOAuth = vi.fn(() => new Promise(() => undefined))
    render(<AuthProvider client={client(null, { signInWithOAuth: signInWithOAuth as AuthClient['signInWithOAuth'] })}><AppHeader /></AuthProvider>)
    const login = await screen.findByRole('button', { name: 'GitHub로 로그인' })

    fireEvent.click(login)

    expect(screen.getByRole('button', { name: 'GitHub 연결 중' })).toBeDisabled()
  })
})
