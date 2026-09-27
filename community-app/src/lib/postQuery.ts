const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parsePostId(search: string): string | null {
  const params = new URLSearchParams(search)
  const ids = params.getAll('id')
  if (ids.length !== 1 || !canonicalUuid.test(ids[0])) return null
  return ids[0].toLowerCase()
}
