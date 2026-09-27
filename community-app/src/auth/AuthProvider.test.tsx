import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth, type AuthClient } from './AuthProvider'

const user = { id: 'user-1', email: 'dev@example.com', user_metadata: { user_name: 'breaddev' } }
const session = { user, access_token: 'secret-token' }

function client(overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    signInWithOAuth: vi.fn().mockResolvedValue({ data: {}, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    exchangeCodeForSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
    ...overrides,
  }
}

function Harness({ onState }: { onState?: (value: ReturnType<typeof useAuth>) => void }) {
  const auth = useAuth()
  useEffect(() => { onState?.(auth) }, [auth, onState])
  return (
    <div>
      <span>{auth.loading ? 'loading' : auth.user?.email ?? 'signed-out'}</span>
      <span>{auth.error}</span>
      <button onClick={() => void auth.signInWithGitHub('/community/write/')}>login</button>
      <button onClick={() => void auth.signOut()}>logout</button>
    </div>
  )
}

describe('AuthProvider', () => {
  it('restores the initial session and subscribes to session changes', async () => {
    let listener: ((event: string, session: unknown) => void) | undefined
    const unsubscribe = vi.fn()
    const authClient = client({
      getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
      onAuthStateChange: vi.fn((callback) => {
        listener = callback
        return { data: { subscription: { unsubscribe } } }
      }),
    })
    const view = render(<AuthProvider client={authClient}><Harness /></AuthProvider>)

    expect(await screen.findByText('dev@example.com')).toBeInTheDocument()
    act(() => listener?.('SIGNED_OUT', null))
    expect(screen.getByText('signed-out')).toBeInTheDocument()

    view.unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('does not update after an unmounted initialization resolves', async () => {
    let resolve: ((value: unknown) => void) | undefined
    const getSession = vi.fn(() => new Promise((done) => { resolve = done }))
    const renders: Array<string | undefined> = []
    const view = render(
      <AuthProvider client={client({ getSession: getSession as AuthClient['getSession'] })}>
        <Harness onState={(auth) => renders.push(auth.user?.email)} />
      </AuthProvider>,
    )
    view.unmount()

    await act(async () => resolve?.({ data: { session }, error: null }))
    expect(renders).toEqual([undefined])
  })

  it('does not overwrite a newer auth event with a stale initial session result', async () => {
    let resolveInitial: ((value: unknown) => void) | undefined
    let listener: ((event: string, session: unknown) => void) | undefined
    const getSession = vi.fn(() => new Promise((done) => { resolveInitial = done }))
    const authClient = client({
      getSession: getSession as AuthClient['getSession'],
      onAuthStateChange: vi.fn((callback) => {
        listener = callback
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      }),
    })
    render(<AuthProvider client={authClient}><Harness /></AuthProvider>)

    act(() => listener?.('SIGNED_IN', session))
    expect(screen.getByText('dev@example.com')).toBeInTheDocument()
    await act(async () => resolveInitial?.({ data: { session: null }, error: null }))

    expect(screen.getByText('dev@example.com')).toBeInTheDocument()
  })

  it('starts GitHub login and reports a disabled provider in Korean', async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({
      data: {},
      error: { message: 'Unsupported provider: provider is not enabled' },
    })
    render(<AuthProvider client={client({ signInWithOAuth })} origin="https://www.breadlab.ai"><Harness /></AuthProvider>)
    await screen.findByText('signed-out')

    fireEvent.click(screen.getByRole('button', { name: 'login' }))

    expect(await screen.findByText('GitHub 로그인이 현재 활성화되어 있지 않습니다. 운영자에게 알려 주세요.')).toBeInTheDocument()
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'github',
      options: { redirectTo: 'https://www.breadlab.ai/community/auth/callback/' },
    })
  })

  it('logs out and reports rejected logout calls without clearing browser drafts', async () => {
    localStorage.setItem('community-draft:v1', 'keep me')
    const signOut = vi.fn().mockRejectedValue(new Error('network unavailable'))
    render(<AuthProvider client={client({ getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }), signOut })}><Harness /></AuthProvider>)
    await screen.findByText('dev@example.com')

    fireEvent.click(screen.getByRole('button', { name: 'logout' }))

    expect(await screen.findByText('로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.')).toBeInTheDocument()
    expect(localStorage.getItem('community-draft:v1')).toBe('keep me')
  })

  it('surfaces initialization errors and leaves the user signed out', async () => {
    render(<AuthProvider client={client({ getSession: vi.fn().mockRejectedValue(new Error('offline')) })}><Harness /></AuthProvider>)

    await waitFor(() => expect(screen.getByText('로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.')).toBeInTheDocument())
    expect(screen.getByText('signed-out')).toBeInTheDocument()
  })
})
