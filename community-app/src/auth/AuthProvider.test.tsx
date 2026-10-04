import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTH_RETURN_PATH_KEY } from './auth'
import { AuthProvider, useAuth, type AuthClient } from './AuthProvider'
import { draftKey } from '../lib/draftStore'

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
      <span>{auth.pending ? 'pending' : 'idle'}</span>
      <button onClick={() => void auth.signIn('google', '/community/write/')}>login</button>
      <button onClick={() => void auth.signIn('github', '/community/private/')}>disabled login</button>
      <button onClick={() => void auth.signOut()}>logout</button>
    </div>
  )
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('AuthProvider', () => {
  it('exposes only the provider-neutral sign-in API', async () => {
    let auth: ReturnType<typeof useAuth> | undefined
    render(
      <AuthProvider client={client()}>
        <Harness onState={(value) => { auth = value }} />
      </AuthProvider>,
    )

    await screen.findByText('signed-out')
    expect(auth).toBeDefined()
    expect(auth).not.toHaveProperty('signInWithGitHub')
    expect(auth!.signIn).toEqual(expect.any(Function))
  })

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

  it('starts Google login with the canonical callback', async () => {
    const providerToken = vi.fn(() => { throw new Error('provider_token must not be read') })
    const providerRefreshToken = vi.fn(() => { throw new Error('provider_refresh_token must not be read') })
    const data = {}
    Object.defineProperties(data, {
      provider_token: { enumerable: true, get: providerToken },
      provider_refresh_token: { enumerable: true, get: providerRefreshToken },
    })
    const signInWithOAuth = vi.fn().mockResolvedValue({ data, error: null })
    render(<AuthProvider client={client({ signInWithOAuth })} origin="https://www.breadlab.ai"><Harness /></AuthProvider>)
    await screen.findByText('signed-out')

    fireEvent.click(screen.getByRole('button', { name: 'login' }))

    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'https://www.breadlab.ai/community/auth/callback/' },
    }))
    await waitFor(() => expect(screen.getByText('idle')).toBeInTheDocument())
    expect(providerToken).not.toHaveBeenCalled()
    expect(providerRefreshToken).not.toHaveBeenCalled()
  })

  it('preserves real write and edit draft storage bytes after Google OAuth starts', async () => {
    const writeKey = draftKey('write')
    const editKey = draftKey('edit', '56000000-0000-4000-8000-000000000010')
    const writeSentinel = '  {"kind":"write","title":"keep Ω write"}\n'
    const editSentinel = '\t{"kind":"edit","title":"keep edit 🔒"}  '
    localStorage.setItem(writeKey, writeSentinel)
    localStorage.setItem(editKey, editSentinel)
    const signInWithOAuth = vi.fn().mockResolvedValue({ data: {}, error: null })

    render(<AuthProvider client={client({ signInWithOAuth })} origin="https://www.breadlab.ai"><Harness /></AuthProvider>)
    await screen.findByText('signed-out')
    fireEvent.click(screen.getByRole('button', { name: 'login' }))

    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.getByText('idle')).toBeInTheDocument())
    expect(localStorage.getItem(writeKey)).toBe(writeSentinel)
    expect(localStorage.getItem(editKey)).toBe(editSentinel)
  })

  it('rejects a runtime disabled provider without SDK access and clears pending with fixed Korean copy', async () => {
    const signInWithOAuth = vi.fn()
    const states: Array<{ pending: boolean; error: string | null }> = []
    render(
      <AuthProvider client={client({ signInWithOAuth })} origin="https://www.breadlab.ai">
        <Harness onState={({ pending, error }) => states.push({ pending, error })} />
      </AuthProvider>,
    )
    await screen.findByText('signed-out')

    fireEvent.click(screen.getByRole('button', { name: 'disabled login' }))

    const fixedMessage = 'GitHub 로그인이 현재 활성화되어 있지 않습니다. 운영자에게 알려 주세요.'
    expect(await screen.findByText(fixedMessage)).toBeInTheDocument()
    expect(signInWithOAuth).not.toHaveBeenCalled()
    expect(states).toContainEqual({ pending: true, error: null })
    expect(screen.getByText('idle')).toBeInTheDocument()
    await waitFor(() => expect(states.at(-1)).toEqual({ pending: false, error: fixedMessage }))
    expect(screen.queryByText(/OAuth provider is not enabled/iu)).not.toBeInTheDocument()
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

  it('preserves write and edit drafts when Google OAuth start fails', async () => {
    const writeKey = draftKey('write')
    const editKey = draftKey('edit', '56000000-0000-4000-8000-000000000010')
    localStorage.setItem(writeKey, '{"kind":"write","title":"keep write"}')
    localStorage.setItem(editKey, '{"kind":"edit","title":"keep edit"}')
    const rawError = 'provider upstream leaked internal detail'
    const signInWithOAuth = vi.fn().mockResolvedValue({
      data: { provider_token: 'provider-secret', provider_refresh_token: 'provider-refresh-secret' },
      error: { message: rawError },
    })

    render(<AuthProvider client={client({ signInWithOAuth })} origin="https://www.breadlab.ai"><Harness /></AuthProvider>)
    await screen.findByText('signed-out')
    fireEvent.click(screen.getByRole('button', { name: 'login' }))

    expect(await screen.findByText('Google 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.')).toBeInTheDocument()
    expect(screen.queryByText(rawError)).not.toBeInTheDocument()
    expect(localStorage.getItem(writeKey)).toBe('{"kind":"write","title":"keep write"}')
    expect(localStorage.getItem(editKey)).toBe('{"kind":"edit","title":"keep edit"}')
    expect(sessionStorage.getItem(AUTH_RETURN_PATH_KEY)).toBe('/community/write/')
    const persistedValues = [localStorage, sessionStorage]
      .flatMap((storage) => [...Array(storage.length)].map((_, index) => storage.getItem(storage.key(index)!)))
      .join('\n')
    expect(persistedValues).not.toContain('provider-secret')
    expect(persistedValues).not.toContain('provider-refresh-secret')
  })

  it('reads only the user from a restored session and never accesses or persists provider tokens', async () => {
    const providerToken = vi.fn(() => 'provider-secret')
    const providerRefreshToken = vi.fn(() => 'provider-refresh-secret')
    const restoredSession = { user, access_token: 'supabase-access-token' }
    Object.defineProperties(restoredSession, {
      provider_token: { enumerable: true, get: providerToken },
      provider_refresh_token: { enumerable: true, get: providerRefreshToken },
    })
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }

    render(<AuthProvider
      client={client({ getSession: vi.fn().mockResolvedValue({ data: { session: restoredSession }, error: null }) })}
      storage={storage}
    ><Harness /></AuthProvider>)

    expect(await screen.findByText('dev@example.com')).toBeInTheDocument()
    expect(providerToken).not.toHaveBeenCalled()
    expect(providerRefreshToken).not.toHaveBeenCalled()
    expect(storage.getItem).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.removeItem).not.toHaveBeenCalled()
  })
})
