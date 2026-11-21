import { describe, expect, it, vi } from 'vitest'

const createClient = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient }))
vi.mock('../config/env', () => ({
  parseEnv: () => ({
    supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
    supabasePublishableKey: 'sb_publishable_test',
  }),
}))

import { getAnonymousSupabaseClient } from './supabase'

describe('anonymous Supabase client', () => {
  it('is cached without persisting or refreshing sessions', () => {
    const anonymousClient = { kind: 'anonymous' }
    createClient.mockReturnValue(anonymousClient)

    const localGet = vi.spyOn(Storage.prototype, 'getItem')
    const localSet = vi.spyOn(Storage.prototype, 'setItem')
    const localRemove = vi.spyOn(Storage.prototype, 'removeItem')

    expect(getAnonymousSupabaseClient()).toBe(anonymousClient)
    expect(getAnonymousSupabaseClient()).toBe(anonymousClient)
    expect(createClient).toHaveBeenCalledOnce()
    expect(createClient).toHaveBeenCalledWith(
      'https://abcdefghijklmnopqrst.supabase.co',
      'sb_publishable_test',
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storage: expect.any(Object) } },
    )
    const options = createClient.mock.calls[0][2]
    expect(options.auth.storage.getItem('session')).toBeNull()
    expect(options.auth.storage.setItem('session', 'private')).toBeUndefined()
    expect(options.auth.storage.removeItem('session')).toBeUndefined()
    expect(localGet).not.toHaveBeenCalled()
    expect(localSet).not.toHaveBeenCalled()
    expect(localRemove).not.toHaveBeenCalled()
  })
})
