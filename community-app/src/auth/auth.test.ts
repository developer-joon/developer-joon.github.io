import { describe, expect, it, vi } from 'vitest'
import {
  AUTH_RETURN_PATH_KEY,
  authErrorMessage,
  consumePendingReturnPath,
  normalizeCommunityReturnPath,
  startOAuthSignIn,
} from './auth'
import type { CommunityOAuthProvider } from './providers'

const safeCases = [
  ['/community/', '/community/'],
  ['/community/post/?id=123&tab=answers', '/community/post/?id=123&tab=answers'],
  ['/community/write/?draft=local#editor', '/community/write/?draft=local#editor'],
  ['/community/?q=%EB%B3%B4%EC%95%88', '/community/?q=%EB%B3%B4%EC%95%88'],
] as const

const unsafeCases = [
  'https://evil.example/community/',
  '//evil.example/community/',
  '/blog/',
  String.raw`/community/\evil`,
  '/community/%5cevil',
  '/community/%2F%2Fevil.example',
  '/community/%252f%252fevil.example',
  '/community/%2e%2e/blog/',
  '/community/\u0000evil'.replace('\\u0000', '\u0000'),
  'https://breadlab.ai@evil.example/community/',
  '/community/%0d%0aLocation:https://evil.example',
] as const

describe('community OAuth return paths', () => {
  it.each(safeCases)('accepts safe return path %s', (input, expected) => {
    expect(normalizeCommunityReturnPath(input)).toBe(expected)
  })

  it.each(unsafeCases)('rejects unsafe return path %s', (input) => {
    expect(normalizeCommunityReturnPath(input)).toBeNull()
  })

  it('prefers and consumes a stored return path once', () => {
    const storage = window.sessionStorage
    storage.setItem(AUTH_RETURN_PATH_KEY, '/community/edit/?id=123')

    expect(consumePendingReturnPath(storage, '/community/post/?id=query')).toBe('/community/edit/?id=123')
    expect(storage.getItem(AUTH_RETURN_PATH_KEY)).toBeNull()
    expect(consumePendingReturnPath(storage, '/community/post/?id=query')).toBe('/community/post/?id=query')
  })

  it('clears an unsafe stored value and falls back safely', () => {
    const storage = window.sessionStorage
    storage.setItem(AUTH_RETURN_PATH_KEY, 'https://evil.example/')

    expect(consumePendingReturnPath(storage, '/blog/')).toBe('/community/')
    expect(storage.getItem(AUTH_RETURN_PATH_KEY)).toBeNull()
  })
})

describe('startOAuthSignIn', () => {
  it('stores a validated path and starts Google OAuth at the same-origin callback', async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({ data: {}, error: null })
    const storage = window.sessionStorage

    await startOAuthSignIn(
      { signInWithOAuth },
      'google',
      '/community/post/?id=123',
      'https://www.breadlab.ai',
      storage,
    )

    expect(storage.getItem(AUTH_RETURN_PATH_KEY)).toBe('/community/post/?id=123')
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'https://www.breadlab.ai/community/auth/callback/' },
    })
  })

  it('stores only the safe fallback before OAuth', async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({ data: {}, error: null })
    const storage = window.sessionStorage

    await startOAuthSignIn(
      { signInWithOAuth },
      'google',
      'https://evil.example/',
      'https://www.breadlab.ai',
      storage,
    )

    expect(storage.getItem(AUTH_RETURN_PATH_KEY)).toBe('/community/')
  })

  it.each(['kakao', 'github', 'naver'] as const)('rejects disabled provider %s before storage or SDK access', async (provider) => {
    const signInWithOAuth = vi.fn()
    const storage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    }

    await expect(startOAuthSignIn(
      { signInWithOAuth },
      provider as CommunityOAuthProvider,
      '/community/',
      'https://www.breadlab.ai',
      storage,
    )).rejects.toThrow(/not enabled/iu)

    expect(storage.getItem).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.removeItem).not.toHaveBeenCalled()
    expect(signInWithOAuth).not.toHaveBeenCalled()
  })
})

describe('authErrorMessage', () => {
  it('maps disabled-provider errors to registry copy without exposing raw text', () => {
    const rawMessage = 'provider disabled: tenant-internal-detail'
    const message = authErrorMessage({ message: rawMessage }, 'sign-in', 'google')

    expect(message).toBe('Google 로그인이 현재 활성화되어 있지 않습니다. 운영자에게 알려 주세요.')
    expect(message).not.toContain(rawMessage)
  })

  it('maps generic OAuth errors using the selected provider without exposing raw text', () => {
    const rawMessage = 'upstream exploded with secret provider detail'
    const message = authErrorMessage({ message: rawMessage }, 'sign-in', 'google')

    expect(message).toBe('Google 로그인을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    expect(message).not.toContain(rawMessage)
  })

  it('maps an arbitrary runtime provider to safe default copy', () => {
    const rawMessage = 'provider unsupported: tenant-internal-detail'
    const message = authErrorMessage(
      { message: rawMessage },
      'sign-in',
      'naver' as CommunityOAuthProvider,
    )

    expect(message).toBe('Google 로그인이 현재 활성화되어 있지 않습니다. 운영자에게 알려 주세요.')
    expect(message).not.toContain(rawMessage)
  })
})
