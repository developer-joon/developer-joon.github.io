export type CommunityOAuthProvider = 'google' | 'kakao' | 'github'

export interface CommunityOAuthProviderDefinition {
  id: CommunityOAuthProvider
  loginLabel: string
  adminLoginLabel: string
  buttonLabel: string
  pendingLabel: string
  unavailableMessage: string
}

export const AUTH_PROVIDER_DEFINITIONS = Object.freeze({
  google: Object.freeze({
    id: 'google',
    loginLabel: 'Google로 로그인',
    adminLoginLabel: 'Google로 관리자 로그인',
    buttonLabel: 'Google 로그인',
    pendingLabel: 'Google 연결 중',
    unavailableMessage: 'Google 로그인이 현재 활성화되어 있지 않습니다. 운영자에게 알려 주세요.',
  }),
  kakao: Object.freeze({
    id: 'kakao',
    loginLabel: '카카오로 로그인',
    adminLoginLabel: '카카오로 관리자 로그인',
    buttonLabel: '카카오 로그인',
    pendingLabel: '카카오 연결 중',
    unavailableMessage: '카카오 로그인이 현재 활성화되어 있지 않습니다. 운영자에게 알려 주세요.',
  }),
  github: Object.freeze({
    id: 'github',
    loginLabel: 'GitHub로 로그인',
    adminLoginLabel: 'GitHub로 관리자 로그인',
    buttonLabel: 'GitHub 로그인',
    pendingLabel: 'GitHub 연결 중',
    unavailableMessage: 'GitHub 로그인이 현재 활성화되어 있지 않습니다. 운영자에게 알려 주세요.',
  }),
} satisfies Record<CommunityOAuthProvider, CommunityOAuthProviderDefinition>)

export const ENABLED_AUTH_PROVIDERS = Object.freeze(['google'] as const)
export const DEFAULT_AUTH_PROVIDER = 'google' as const

export function isEnabledAuthProvider(value: unknown): value is typeof ENABLED_AUTH_PROVIDERS[number] {
  return typeof value === 'string'
    && ENABLED_AUTH_PROVIDERS.some(provider => provider === value)
}
