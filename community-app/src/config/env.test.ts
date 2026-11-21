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

  it('accepts a bounded legacy JWT whose payload has the exact anon role', () => {
    const legacyAnonKey = [
      btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_'),
      btoa(JSON.stringify({ role: 'anon', iss: 'supabase' })).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_'),
      'test-signature',
    ].join('.')
    expect(parseEnv({ ...validEnv, VITE_SUPABASE_PUBLISHABLE_KEY: legacyAnonKey }).supabasePublishableKey).toBe(legacyAnonKey)
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

  it.each([
    ['service role JWT', { role: 'service_role' }],
    ['missing role JWT', { iss: 'supabase' }],
    ['non-object payload JWT', ['anon']],
  ])('rejects a %s', (_description, payload) => {
    const segment = btoa(JSON.stringify(payload)).replaceAll('=', '').replaceAll('+', '-').replaceAll('/', '_')
    expect(() => parseEnv({ ...validEnv, VITE_SUPABASE_PUBLISHABLE_KEY: `e30.${segment}.signature` })).toThrow('publishable key')
  })

  it.each([
    'e30.***.signature',
    `e30.${btoa('{not json}').replaceAll('=', '')}.signature`,
    `e30.${btoa('{"role":"anon","role":"service_role"}').replaceAll('=', '')}.signature`,
    `e30.${btoa(JSON.stringify({ role: 'anon', padding: 'x'.repeat(9000) })).replaceAll('=', '')}.signature`,
    'e30.eyJyb2xlIjoiYW5vbiJ9.signature\n',
  ])('rejects a malformed, ambiguous, oversized, or control-bearing legacy key', (key) => {
    expect(() => parseEnv({ ...validEnv, VITE_SUPABASE_PUBLISHABLE_KEY: key })).toThrow('publishable key')
  })
})
