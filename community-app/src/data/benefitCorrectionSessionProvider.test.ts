import { describe, expect, it, vi } from 'vitest'
import { createBenefitCorrectionSessionProvider } from './benefitCorrectionRepository'

const actorA = '56000000-0000-4000-8000-0000000000a1'
const actorB = '56000000-0000-4000-8000-0000000000b2'

function session(actorId: string, accessToken: string) {
  return { data: { session: { user: { id: actorId }, access_token: accessToken } } }
}

describe('benefit correction operation-scoped session provider', () => {
  it('binds RPC authorization to the exact captured session without exposing the token', async () => {
    let current = session(actorA, 'secret-token-a')
    const auth = { getSession: vi.fn(async () => current) }
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const provider = createBenefitCorrectionSessionProvider(
      auth,
      { supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', supabasePublishableKey: 'sb_publishable_test' },
      fetcher,
    )

    const captured = await provider()
    current = session(actorB, 'secret-token-b')
    const response = await captured?.rpc('create_benefit_correction_request_v1', { p_value: 'safe' })

    expect(response).toEqual({ data: { ok: true }, error: null })
    expect(fetcher).toHaveBeenCalledWith(
      'https://abcdefghijklmnopqrst.supabase.co/rest/v1/rpc/create_benefit_correction_request_v1',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer secret-token-a', apikey: 'sb_publishable_test' }),
        body: JSON.stringify({ p_value: 'safe' }),
      }),
    )
    expect(captured).toMatchObject({ actorId: actorA })
    expect(captured?.sessionFingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(captured)).not.toContain('secret-token-a')
  })

  it('returns structured PostgREST failures with HTTP status', async () => {
    const auth = { getSession: vi.fn(async () => session(actorA, 'secret-token-a')) }
    const envelope = { code: 'PGRST', message: '{"code":"rate_limit_exceeded","message":"Too many requests"}', details: null, hint: null }
    const fetcher = vi.fn(async () => new Response(JSON.stringify(envelope), { status: 429 }))
    const provider = createBenefitCorrectionSessionProvider(
      auth,
      { supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', supabasePublishableKey: 'sb_publishable_test' },
      fetcher,
    )

    const response = await (await provider())?.rpc('list_my_benefit_correction_requests_v1', {})

    expect(response).toEqual({ data: null, error: { ...envelope, status: 429 } })
  })

  it('fails closed on malformed success JSON and does not capture unauthenticated sessions', async () => {
    const fetcher = vi.fn(async () => new Response('not-json', { status: 200 }))
    const authenticated = createBenefitCorrectionSessionProvider(
      { getSession: vi.fn(async () => session(actorA, 'secret-token-a')) },
      { supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', supabasePublishableKey: 'sb_publishable_test' },
      fetcher,
    )
    await expect((await authenticated())?.rpc('list_my_benefit_correction_requests_v1', {})).rejects.toBeInstanceOf(SyntaxError)

    const anonymous = createBenefitCorrectionSessionProvider(
      { getSession: vi.fn(async () => ({ data: { session: null } })) },
      { supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', supabasePublishableKey: 'sb_publishable_test' },
      fetcher,
    )
    await expect(anonymous()).resolves.toBeNull()
  })
})
