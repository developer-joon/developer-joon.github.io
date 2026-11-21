import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { parseEnv } from '../config/env'
import type { Database } from '../types/database'

let browserClient: SupabaseClient<Database> | undefined
let anonymousBrowserClient: SupabaseClient<Database> | undefined

// Keep public RPC traffic entirely separate from browser auth persistence.
const anonymousAuthStorage = {
  getItem: (key: string) => { void key; return null },
  setItem: (key: string, value: string) => { void key; void value },
  removeItem: (key: string) => { void key },
}

export function getSupabaseClient(): SupabaseClient<Database> {
  if (browserClient) {
    return browserClient
  }

  const env = parseEnv(import.meta.env)
  browserClient = createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  })
  return browserClient
}

export function createAnonymousSupabaseClient(
  supabaseUrl: string,
  supabasePublishableKey: string,
): SupabaseClient<Database> {
  return createClient<Database>(supabaseUrl, supabasePublishableKey, {
    // The SDK gives this callback precedence over every mutable auth session.
    // Returning null makes fetchWithAuth fall back to the public API key.
    accessToken: async () => null,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: anonymousAuthStorage,
    },
  })
}

export function getAnonymousSupabaseClient(): SupabaseClient<Database> {
  if (anonymousBrowserClient) {
    return anonymousBrowserClient
  }

  const env = parseEnv(import.meta.env)
  anonymousBrowserClient = createAnonymousSupabaseClient(env.supabaseUrl, env.supabasePublishableKey)
  return anonymousBrowserClient
}
