import { describe, expect, it, vi } from 'vitest'
import {
  AUTH_RETURN_PATH_KEY,
  consumePendingReturnPath,
  normalizeCommunityReturnPath,
  signInWithGitHub,
} from './auth'

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

describe('signInWithGitHub', () => {
  it('stores a validated path and starts GitHub OAuth at the same-origin callback', async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({ data: {}, error: null })
    const storage = window.sessionStorage

    await signInWithGitHub(
      { signInWithOAuth },
      '/community/post/?id=123',
      'https://www.breadlab.ai',
      storage,
    )

    expect(storage.getItem(AUTH_RETURN_PATH_KEY)).toBe('/community/post/?id=123')
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'github',
      options: { redirectTo: 'https://www.breadlab.ai/community/auth/callback/' },
    })
  })

  it('stores only the safe fallback before OAuth', async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({ data: {}, error: null })
    const storage = window.sessionStorage

    await signInWithGitHub({ signInWithOAuth }, 'https://evil.example/', 'https://www.breadlab.ai', storage)

    expect(storage.getItem(AUTH_RETURN_PATH_KEY)).toBe('/community/')
  })
})
