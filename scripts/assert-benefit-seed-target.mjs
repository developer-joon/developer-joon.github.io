#!/usr/bin/env node

function fail(message) {
  throw new Error(message)
}

export function assertBenefitSeedTarget(environment = process.env, argv = process.argv.slice(2)) {
  if (argv.length !== 0) fail('usage: assert-benefit-seed-target.mjs')
  const target = environment.TARGET_PROJECT_REF
  if (!/^[a-z0-9]{20}$/.test(target ?? '')) fail('TARGET_PROJECT_REF must be exactly 20 lowercase letters or digits')
  if (typeof environment.DATABASE_URL !== 'string' || environment.DATABASE_URL.length === 0) {
    fail('DATABASE_URL is required')
  }
  let parsed
  try {
    parsed = new URL(environment.DATABASE_URL)
  } catch {
    fail('DATABASE_URL is malformed')
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) {
    fail('DATABASE_URL must be a PostgreSQL URL with a canonical Supabase target identifier')
  }

  const host = parsed.hostname.toLowerCase()
  let username
  try {
    username = decodeURIComponent(parsed.username)
  } catch {
    fail('DATABASE_URL username is malformed')
  }
  const identifiers = []
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(host)
  if (direct) identifiers.push(direct[1])
  else if (host.startsWith('db.') && host.endsWith('.supabase.co')) fail('DATABASE_URL direct host identifier is malformed')

  const pooler = /^postgres\.([a-z0-9]{20})$/.exec(username)
  if (pooler) {
    if (!direct && !/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)) {
      fail('DATABASE_URL pooler host is not canonical')
    }
    identifiers.push(pooler[1])
  } else if (username.startsWith('postgres.') || host.endsWith('.pooler.supabase.com')) {
    fail('DATABASE_URL pooler username identifier is malformed')
  }

  if (identifiers.length === 0) fail('DATABASE_URL has no canonical Supabase project identifier')
  if (new Set(identifiers).size !== 1) fail('DATABASE_URL contains conflicting Supabase project identifiers')
  if (identifiers[0] !== target) fail('DATABASE_URL does not match TARGET_PROJECT_REF')
}

try {
  assertBenefitSeedTarget()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
