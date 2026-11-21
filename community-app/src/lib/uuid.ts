const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const strictUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** PostgreSQL canonical UUID text; version and variant bits may be arbitrary. */
export function isCanonicalUuid(value: unknown): value is string {
  return parseCanonicalUuid(value) !== null
}

/** Parse PostgreSQL UUID text and return its lowercase wire representation. */
export function parseCanonicalUuid(value: unknown): string | null {
  return typeof value === 'string' && canonicalUuidPattern.test(value) ? value.toLowerCase() : null
}

/** UUID text with an RFC version and variant used for generated identities. */
export function isStrictUuid(value: unknown): value is string {
  return parseStrictUuid(value) !== null
}

/** Parse a generated UUID and return its lowercase wire representation. */
export function parseStrictUuid(value: unknown): string | null {
  return typeof value === 'string' && strictUuidPattern.test(value) ? value.toLowerCase() : null
}

/** Compare valid UUID text by canonical ASCII code units. */
export function compareCanonicalUuids(left: string, right: string): number {
  const canonicalLeft = parseCanonicalUuid(left)
  const canonicalRight = parseCanonicalUuid(right)
  if (canonicalLeft === null || canonicalRight === null) throw new Error('invalid UUID')
  return canonicalLeft < canonicalRight ? -1 : canonicalLeft > canonicalRight ? 1 : 0
}
