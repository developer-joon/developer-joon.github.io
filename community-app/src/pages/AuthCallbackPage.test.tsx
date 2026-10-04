import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTH_RETURN_PATH_KEY } from '../auth/auth'
import type { AuthClient } from '../auth/AuthProvider'
import { AuthCallbackPage } from './AuthCallbackPage'

function callbackClient(exchangeCodeForSession = vi.fn().mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null })) {
  return { exchangeCodeForSession } as unknown as AuthClient
}

describe('AuthCallbackPage', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })

  it('exchanges the authorization code exactly once across Strict Mode and rerenders, then consumes the stored safe path', async () => {
    sessionStorage.setItem(AUTH_RETURN_PATH_KEY, '/community/write/?draft=local')
    const client = callbackClient()
    const navigate = vi.fn()
    const callback = <AuthCallbackPage client={client} search="?code=one-time-code" navigate={navigate} />

    const view = render(<StrictMode>{callback}</StrictMode>)

    expect(screen.getByRole('heading', { name: '로그인을 확인하고 있습니다.' })).toBeInTheDocument()
    expect(screen.queryByText(/GitHub/)).not.toBeInTheDocument()
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/community/write/?draft=local'))
    expect(client.exchangeCodeForSession).toHaveBeenCalledOnce()
    expect(client.exchangeCodeForSession).toHaveBeenCalledWith('one-time-code')
    expect(sessionStorage.getItem(AUTH_RETURN_PATH_KEY)).toBeNull()

    view.rerender(<StrictMode>{callback}</StrictMode>)
    await Promise.resolve()
    expect(client.exchangeCodeForSession).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledOnce()
  })

  it('shows OAuth callback errors without attempting an exchange', () => {
    sessionStorage.setItem(AUTH_RETURN_PATH_KEY, '/community/write/?draft=kept')
    const client = callbackClient()
    const navigate = vi.fn()
    const rawDescription = 'The user denied access with tenant-internal detail'
    render(<AuthCallbackPage client={client} search={`?error=access_denied&error_description=${encodeURIComponent(rawDescription)}`} navigate={navigate} />)

    expect(screen.getByRole('heading', { name: '로그인이 취소되었거나 완료되지 않았습니다.' })).toBeInTheDocument()
    expect(screen.queryByText(rawDescription)).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(rawDescription)
    expect(client.exchangeCodeForSession).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '원래 화면에서 다시 시도' }))
    expect(navigate).toHaveBeenCalledWith('/community/write/?draft=kept')
    expect(sessionStorage.getItem(AUTH_RETURN_PATH_KEY)).toBe('/community/write/?draft=kept')
  })

  it('shows a missing-code error with retry and back states', () => {
    const client = callbackClient()
    render(<AuthCallbackPage client={client} search="" navigate={vi.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent('로그인 확인 코드를 찾을 수 없습니다.')
    expect(screen.getByRole('button', { name: '원래 화면에서 다시 시도' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '커뮤니티로 돌아가기' })).toBeInTheDocument()
  })

  it('shows exchange failures, keeps a draft, and never exchanges the code twice', async () => {
    localStorage.setItem('community-draft:v1', 'keep me')
    const exchangeCodeForSession = vi.fn()
      .mockResolvedValue({ data: { session: null }, error: { message: 'bad verifier' } })
    const navigate = vi.fn()
    render(<AuthCallbackPage client={callbackClient(exchangeCodeForSession)} search="?code=retry-code&returnTo=%2Fcommunity%2Fpost%2F%3Fid%3D123" navigate={navigate} />)

    expect(await screen.findByRole('heading', { name: '로그인을 완료하지 못했습니다. 다시 시도해 주세요.' })).toBeInTheDocument()
    expect(localStorage.getItem('community-draft:v1')).toBe('keep me')
    fireEvent.click(screen.getByRole('button', { name: '원래 화면에서 다시 시도' }))

    expect(navigate).toHaveBeenCalledWith('/community/post/?id=123')
    expect(exchangeCodeForSession).toHaveBeenCalledOnce()
  })

  it('falls back to community for unsafe returnTo values', async () => {
    const navigate = vi.fn()
    render(<AuthCallbackPage client={callbackClient()} search="?code=ok&returnTo=https%3A%2F%2Fevil.example%2F" navigate={navigate} />)

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/community/'))
  })

  it('does not read provider tokens from the exchanged session or persist them in callback storage', async () => {
    const providerToken = vi.fn(() => 'provider-secret')
    const providerRefreshToken = vi.fn(() => 'provider-refresh-secret')
    const session = { user: { id: 'user-1' } }
    Object.defineProperties(session, {
      provider_token: { enumerable: true, get: providerToken },
      provider_refresh_token: { enumerable: true, get: providerRefreshToken },
    })
    const storageValues = new Map([[AUTH_RETURN_PATH_KEY, '/community/write/']])
    const storage = {
      getItem: vi.fn((key: string) => storageValues.get(key) ?? null),
      removeItem: vi.fn((key: string) => { storageValues.delete(key) }),
    }
    const navigate = vi.fn()

    render(<AuthCallbackPage
      client={callbackClient(vi.fn().mockResolvedValue({ data: { session }, error: null }))}
      search="?code=one-time-code"
      navigate={navigate}
      storage={storage}
    />)

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/community/write/'))
    expect(providerToken).not.toHaveBeenCalled()
    expect(providerRefreshToken).not.toHaveBeenCalled()
    expect(storage.getItem).toHaveBeenCalledWith(AUTH_RETURN_PATH_KEY)
    expect(storage.removeItem).toHaveBeenCalledOnce()
    expect([...storageValues.values()]).not.toContain('provider-secret')
    expect([...storageValues.values()]).not.toContain('provider-refresh-secret')
  })
})
