import { describe, expect, it } from 'vitest'
import { parseEnv } from './env'

const validEnv = {
  VITE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example-for-tests',
}

describe('parseEnv', () => {
  it('returns a validated public Supabase configuration', () => {
    expect(parseEnv(validEnv)).toEqual({
      supabaseUrl: validEnv.VITE_SUPABASE_URL,
      supabasePublishableKey: validEnv.VITE_SUPABASE_PUBLISHABLE_KEY,
    })
  })

  it.each(['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'] as const)(
    'rejects a missing %s value',
    (name) => {
      expect(() => parseEnv({ ...validEnv, [name]: '' })).toThrow('환경 설정')
    },
  )

  it.each([
    'http://abcdefghijklmnopqrst.supabase.co',
    'https://supabase.co',
    'https://abcdefghijklmnopqrst.supabase.co/path',
    'https://evil.example.com',
  ])('rejects an unsafe Supabase URL: %s', (url) => {
    expect(() => parseEnv({ ...validEnv, VITE_SUPABASE_URL: url })).toThrow(
      'Supabase URL',
    )
  })

  it.each([
    'sb_secret_do-not-use',
    'service_role_do-not-use',
    'eyJhbGciOiJIUzI1NiJ9.service_role',
    'publishable_without_required_prefix',
  ])('rejects a non-publishable key: %s', (key) => {
    expect(() =>
      parseEnv({ ...validEnv, VITE_SUPABASE_PUBLISHABLE_KEY: key }),
    ).toThrow('publishable key')
  })
})
