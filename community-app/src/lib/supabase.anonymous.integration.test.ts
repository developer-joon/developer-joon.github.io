import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAnonymousSupabaseClient } from './supabase'

afterEach(() => vi.unstubAllGlobals())

describe('anonymous Supabase client authorization pinning', () => {
  it('uses the public key for RPC after a consumer attempts to install a session', async () => {
    const publicKey = 'sb_publishable_production-shaped-test-key'
    const syntheticAccessToken = [
      btoa(JSON.stringify({ alg: 'none' })),
      btoa(JSON.stringify({ sub: '00000000-0000-0000-0000-000000000001', role: 'authenticated' })),
      'synthetic-signature',
    ].join('.')
    const requests: Request[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request)
      if (request.url.includes('/auth/v1/')) {
        return new Response(JSON.stringify({ user: null }), { status: 401, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    const client = createAnonymousSupabaseClient('https://abcdefghijklmnopqrst.supabase.co', publicKey)
    expect(() => client.auth.setSession({ access_token: syntheticAccessToken, refresh_token: 'synthetic-refresh-token' })).toThrow('accessToken option')
    await client.rpc('get_benefit_company_v1', { p_company_id: 'KR-BIZ-1234567890' })

    const rpcRequest = requests.find(request => request.url.includes('/rest/v1/rpc/get_benefit_company_v1'))
    expect(rpcRequest?.headers.get('authorization')).toBe(`Bearer ${publicKey}`)
    expect(rpcRequest?.headers.get('authorization')).not.toContain(syntheticAccessToken)
    expect(requests.filter(request => request.url.includes('/auth/v1/'))).toHaveLength(0)
    expect(localStorage).toHaveLength(0)
  })
})
