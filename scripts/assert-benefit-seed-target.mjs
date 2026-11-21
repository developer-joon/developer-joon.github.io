#!/usr/bin/env node

function fail(message) {
  throw new Error(message)
}

export function assertBenefitSeedTarget(environment = process.env, argv = process.argv.slice(2)) {
  if (argv.length !== 0) fail('usage: assert-benefit-seed-target.mjs')
  const target = environment.TARGET_PROJECT_REF
  if (!/^[a-z0-9]{20}$/.test(target ?? '')) fail('TARGET_PROJECT_REF must be exactly 20 lowercase letters or digits')
  const databaseUrl = environment.DATABASE_URL
  if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
    fail('DATABASE_URL is required')
  }
  if (/[\p{White_Space}\p{Cc}]/u.test(databaseUrl)) fail('DATABASE_URL contains whitespace or control characters')

  let parsed
  try {
    parsed = new URL(databaseUrl)
  } catch {
    fail('DATABASE_URL is malformed')
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) {
    fail('DATABASE_URL must be a PostgreSQL URL with a canonical Supabase target identifier')
  }
  if (parsed.hash) fail('DATABASE_URL fragments are not allowed')

  const authorityStart = databaseUrl.indexOf('://') + 3
  const authorityEndOffset = databaseUrl.slice(authorityStart).search(/[/?#]/)
  const authorityEnd = authorityEndOffset === -1 ? databaseUrl.length : authorityStart + authorityEndOffset
  const authority = databaseUrl.slice(authorityStart, authorityEnd)
  const rawHostPort = authority.slice(authority.lastIndexOf('@') + 1)
  const rawHost = rawHostPort.replace(/:[0-9]+$/, '')
  const host = parsed.hostname.toLowerCase()
  if (!/^[\x00-\x7f]+$/.test(rawHost) || rawHost.includes('%') || rawHost.toLowerCase() !== host) {
    fail('DATABASE_URL host is not canonical')
  }

  const username = parsed.username
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(host)
  const poolerHost = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.pooler\.supabase\.com$/.exec(host)
  if (poolerHost?.[1].startsWith('xn--')) fail('DATABASE_URL pooler host is not canonical')

  const canonicalPoolerUsername = /^postgres\.([a-z0-9]{20})$/.exec(username)
  const identifiers = []
  if (direct) {
    identifiers.push(direct[1])
    if (username === 'postgres') {
      // The direct endpoint carries its project identifier in the hostname.
    } else if (canonicalPoolerUsername) {
      identifiers.push(canonicalPoolerUsername[1])
    } else {
      fail('DATABASE_URL direct username is not canonical')
    }
  } else if (host.startsWith('db.') && host.endsWith('.supabase.co')) {
    fail('DATABASE_URL direct host identifier is malformed')
  } else if (poolerHost) {
    if (!canonicalPoolerUsername) fail('DATABASE_URL pooler username identifier is malformed')
    identifiers.push(canonicalPoolerUsername[1])
  } else if (host.endsWith('.pooler.supabase.com')) {
    fail('DATABASE_URL pooler host is not canonical')
  } else {
    fail('DATABASE_URL has no canonical Supabase project identifier')
  }

  if (new Set(identifiers).size !== 1) fail('DATABASE_URL contains conflicting Supabase project identifiers')
  if (identifiers[0] !== target) fail('DATABASE_URL does not match TARGET_PROJECT_REF')
}

try {
  assertBenefitSeedTarget()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
