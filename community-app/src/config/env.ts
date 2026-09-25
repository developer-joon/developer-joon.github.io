import { z } from 'zod'

const secretKeyPattern = /^(?:sb_secret_|service_role)|service_role/i
const supabaseUrlPattern = /^https:\/\/[a-z0-9]+\.supabase\.co$/
const publishableKeyPattern = /^sb_publishable_[A-Za-z0-9_-]+$/

const publicEnvSchema = z
  .object({
    VITE_SUPABASE_URL: z.string().trim().min(1, '환경 설정에 Supabase URL이 없습니다.'),
    VITE_SUPABASE_PUBLISHABLE_KEY: z
      .string()
      .trim()
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
      !publishableKeyPattern.test(env.VITE_SUPABASE_PUBLISHABLE_KEY)
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
