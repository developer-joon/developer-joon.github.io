import {
  AUTH_PROVIDER_DEFINITIONS,
  DEFAULT_AUTH_PROVIDER,
  isEnabledAuthProvider,
  type CommunityOAuthProvider,
} from './providers'

export const AUTH_RETURN_PATH_KEY = 'breadlab.community.auth.return-path:v1'
export const DEFAULT_COMMUNITY_RETURN_PATH = '/community/'
export const COMMUNITY_AUTH_CALLBACK_PATH = '/community/auth/callback/'

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

type OAuthError = { message?: string; code?: string } | null

export interface OAuthClient {
  signInWithOAuth(options: {
    provider: CommunityOAuthProvider
    options: { redirectTo: string }
  }): Promise<{ data: unknown; error: OAuthError }>
}

export function normalizeCommunityReturnPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null
  if (!value.startsWith('/') || value.startsWith('//')) return null
  if (value.includes('\\') || Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })) return null
  if (/%(?:0[0-9a-f]|1[0-9a-f]|7f)/iu.test(value)) return null

  const pathEnd = value.search(/[?#]/u)
  const rawPath = pathEnd === -1 ? value : value.slice(0, pathEnd)
  if (rawPath.includes('%')) return null

  try {
    decodeURI(value)
    const parsed = new URL(value, 'https://return-path.invalid')
    if (parsed.origin !== 'https://return-path.invalid' || parsed.username || parsed.password) return null
    if (parsed.pathname !== '/community' && !parsed.pathname.startsWith('/community/')) return null
    if (`${parsed.pathname}${parsed.search}${parsed.hash}` !== value) return null
    return value
  } catch {
    return null
  }
}

function safeStorageRemove(storage: StorageLike) {
  try {
    storage.removeItem(AUTH_RETURN_PATH_KEY)
  } catch {
    // Authentication can continue with the safe fallback when storage is unavailable.
  }
}

export function storePendingReturnPath(storage: StorageLike, returnPath: unknown): string {
  const safePath = normalizeCommunityReturnPath(returnPath) ?? DEFAULT_COMMUNITY_RETURN_PATH
  try {
    storage.setItem(AUTH_RETURN_PATH_KEY, safePath)
  } catch {
    // A blocked sessionStorage only loses the optional post-login destination.
  }
  return safePath
}

export function peekPendingReturnPath(storage: Pick<StorageLike, 'getItem'>, queryReturnPath?: unknown): string {
  let stored: string | null = null
  try {
    stored = storage.getItem(AUTH_RETURN_PATH_KEY)
  } catch {
    // Use query/fallback below.
  }

  return normalizeCommunityReturnPath(stored)
    ?? normalizeCommunityReturnPath(queryReturnPath)
    ?? DEFAULT_COMMUNITY_RETURN_PATH
}

export function consumePendingReturnPath(storage: StorageLike, queryReturnPath?: unknown): string {
  const returnPath = peekPendingReturnPath(storage, queryReturnPath)
  safeStorageRemove(storage)
  return returnPath
}

export function authErrorMessage(
  error: unknown,
  action: 'initialize' | 'sign-in' | 'sign-out',
  provider: CommunityOAuthProvider = DEFAULT_AUTH_PROVIDER,
): string {
  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : error instanceof Error ? error.message : String(error ?? '')
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : ''
  const providerDisabled = /provider.*(?:disabled|not enabled|unsupported)|unsupported.*provider/iu.test(`${code} ${message}`)
  const providerDefinition = AUTH_PROVIDER_DEFINITIONS[provider]
    ?? AUTH_PROVIDER_DEFINITIONS[DEFAULT_AUTH_PROVIDER]

  if (action === 'sign-in' && providerDisabled) {
    return providerDefinition.unavailableMessage
  }
  if (action === 'initialize') return '로그인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'
  if (action === 'sign-out') return '로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.'
  return `${providerDefinition.buttonLabel}을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.`
}

export async function startOAuthSignIn(
  client: OAuthClient,
  provider: CommunityOAuthProvider,
  returnPath: unknown,
  origin: string,
  storage: StorageLike,
): Promise<void> {
  if (!isEnabledAuthProvider(provider)) throw new Error('OAuth provider is not enabled')
  storePendingReturnPath(storage, returnPath)
  const redirectTo = new URL(COMMUNITY_AUTH_CALLBACK_PATH, origin).toString()
  const result = await client.signInWithOAuth({ provider, options: { redirectTo } })
  if (result.error) throw result.error
}
