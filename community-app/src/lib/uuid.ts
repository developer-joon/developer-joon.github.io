const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const strictUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** PostgreSQL canonical UUID text; version and variant bits may be arbitrary. */
export function isCanonicalUuid(value: unknown): value is string {
  return typeof value === 'string' && canonicalUuidPattern.test(value)
}

/** UUID text with an RFC version and variant used for generated identities. */
export function isStrictUuid(value: unknown): value is string {
  return typeof value === 'string' && strictUuidPattern.test(value)
}
