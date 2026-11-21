import { z } from 'zod'

const secretKeyPattern = /^(?:sb_secret_|service_role)|service_role/i
const supabaseUrlPattern = /^https:\/\/[a-z0-9]+\.supabase\.co$/
const publishableKeyPattern = /^sb_publishable_[A-Za-z0-9_-]+$/
const legacyJwtSegmentPattern = /^[A-Za-z0-9_-]+$/
const maxLegacyJwtLength = 8192
const maxLegacyPayloadBytes = 4096

function hasWhitespaceOrControl(value: string): boolean {
  return Array.from(value).some(character => {
    const code = character.charCodeAt(0)
    return /\s/.test(character) || code <= 31 || code === 127
  })
}

function isLegacyAnonKey(value: string): boolean {
  // This classifies public configuration; it deliberately does not authenticate
  // or verify the JWT signature. Supabase verifies the token when it is used.
  if (value.length > maxLegacyJwtLength || hasWhitespaceOrControl(value)) return false
  const segments = value.split('.')
  if (segments.length !== 3 || segments.some(segment => !legacyJwtSegmentPattern.test(segment))) return false
  try {
    const payloadSegment = segments[1]
    const padding = '='.repeat((4 - (payloadSegment.length % 4)) % 4)
    const binary = atob(payloadSegment.replaceAll('-', '+').replaceAll('_', '/') + padding)
    if (binary.length > maxLegacyPayloadBytes) return false
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    const payloadText = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    // Reject escapes so an equivalent escaped spelling cannot hide a second role key.
    if (payloadText.includes('\\') || (payloadText.match(/"role"\s*:/g)?.length ?? 0) !== 1) return false
    const payload: unknown = JSON.parse(payloadText)
    return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
      && Object.getPrototypeOf(payload) === Object.prototype
      && Object.prototype.hasOwnProperty.call(payload, 'role')
      && (payload as Record<string, unknown>).role === 'anon'
  } catch {
    return false
  }
}

const publicEnvSchema = z
  .object({
    VITE_SUPABASE_URL: z.string().trim().min(1, '환경 설정에 Supabase URL이 없습니다.'),
    VITE_SUPABASE_PUBLISHABLE_KEY: z
      .string()
      .min(1, '환경 설정에 Supabase publishable key가 없습니다.'),
  })
  .superRefine((env, context) => {
    if (!supabaseUrlPattern.test(env.VITE_SUPABASE_URL)) {
      context.addIssue({
        code: 'custom',
        path: ['VITE_SUPABASE_URL'],
        message: 'Supabase URL은 https://<project-ref>.supabase.co 형식이어야 합니다.',
      })
    }

    if (
      secretKeyPattern.test(env.VITE_SUPABASE_PUBLISHABLE_KEY) ||
      (!publishableKeyPattern.test(env.VITE_SUPABASE_PUBLISHABLE_KEY)
        && !isLegacyAnonKey(env.VITE_SUPABASE_PUBLISHABLE_KEY))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['VITE_SUPABASE_PUBLISHABLE_KEY'],
        message: '브라우저에는 sb_publishable_ 형식의 Supabase publishable key만 사용할 수 있습니다.',
      })
    }
  })

export interface PublicEnv {
  supabaseUrl: string
  supabasePublishableKey: string
}

export function parseEnv(env: Record<string, unknown>): PublicEnv {
  const parsed = publicEnvSchema.parse(env)

  return {
    supabaseUrl: parsed.VITE_SUPABASE_URL,
    supabasePublishableKey: parsed.VITE_SUPABASE_PUBLISHABLE_KEY,
  }
}
