import { describe, expect, it } from 'vitest'
import {
  AUTH_PROVIDER_DEFINITIONS,
  DEFAULT_AUTH_PROVIDER,
  ENABLED_AUTH_PROVIDERS,
  isEnabledAuthProvider,
} from './providers'

describe('community OAuth providers', () => {
  it('enables only Google for the initial release', () => {
    expect(ENABLED_AUTH_PROVIDERS).toEqual(['google'])
    expect(DEFAULT_AUTH_PROVIDER).toBe('google')
    expect(isEnabledAuthProvider('google')).toBe(true)
    expect(isEnabledAuthProvider('kakao')).toBe(false)
    expect(isEnabledAuthProvider('github')).toBe(false)
    expect(isEnabledAuthProvider('naver')).toBe(false)
    expect(isEnabledAuthProvider(null)).toBe(false)
  })

  it('owns exact Korean product copy in one registry', () => {
    expect(AUTH_PROVIDER_DEFINITIONS).toEqual({
      google: {
        id: 'google',
        loginLabel: 'Google로 로그인',
        adminLoginLabel: 'Google로 관리자 로그인',
        buttonLabel: 'Google 로그인',
        pendingLabel: 'Google 연결 중',
        unavailableMessage: 'Google 로그인이 현재 활성화되어 있지 않습니다. 운영자에게 알려 주세요.',
      },
      kakao: {
        id: 'kakao',
        loginLabel: '카카오로 로그인',
        adminLoginLabel: '카카오로 관리자 로그인',
        buttonLabel: '카카오 로그인',
        pendingLabel: '카카오 연결 중',
        unavailableMessage: '카카오 로그인이 현재 활성화되어 있지 않습니다. 운영자에게 알려 주세요.',
      },
      github: {
        id: 'github',
        loginLabel: 'GitHub로 로그인',
        adminLoginLabel: 'GitHub로 관리자 로그인',
        buttonLabel: 'GitHub 로그인',
        pendingLabel: 'GitHub 연결 중',
        unavailableMessage: 'GitHub 로그인이 현재 활성화되어 있지 않습니다. 운영자에게 알려 주세요.',
      },
    })
  })

  it('freezes the registry, every definition, and the enabled set', () => {
    expect(Object.isFrozen(AUTH_PROVIDER_DEFINITIONS)).toBe(true)
    expect(Object.values(AUTH_PROVIDER_DEFINITIONS).every(Object.isFrozen)).toBe(true)
    expect(Object.isFrozen(ENABLED_AUTH_PROVIDERS)).toBe(true)
  })
})
