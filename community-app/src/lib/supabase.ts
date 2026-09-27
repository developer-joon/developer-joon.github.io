import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { parseEnv } from '../config/env'
import type { Database } from '../types/database'

let browserClient: SupabaseClient<Database> | undefined

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
