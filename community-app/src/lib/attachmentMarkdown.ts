const imageDestinationPattern = /!\[[^\]\r\n]*\]\(\s*(https?:\/\/[^\s)]+)\s*(?:"[^"\r\n]*"|'[^'\r\n]*')?\s*\)/g
const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/**
 * Reads attachment identities only from the canonical server representation.
 * The result is for existing-slot accounting, never for attaching new uploads.
 */
export function extractExistingAttachmentIds(markdown: string, allowedOrigin: string): string[] | null {
  let origin: URL
  try {
    origin = new URL(allowedOrigin)
  } catch {
    return null
  }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password
    || origin.origin !== allowedOrigin || origin.pathname !== '/' || origin.search || origin.hash) return null

  const ids: string[] = []
  const seen = new Set<string>()
  for (const match of markdown.matchAll(imageDestinationPattern)) {
    const candidate = match[1]
    let url: URL
    try {
      url = new URL(candidate)
    } catch {
      continue
    }
    if (url.origin !== origin.origin || url.username || url.password || url.search || url.hash) continue
    const prefix = '/functions/v1/public-attachment/'
    if (!url.pathname.startsWith(prefix)) continue
    const attachmentId = url.pathname.slice(prefix.length)
    if (!canonicalUuidPattern.test(attachmentId) || candidate !== `${origin.origin}${prefix}${attachmentId}` || seen.has(attachmentId)) continue
    seen.add(attachmentId)
    ids.push(attachmentId)
    if (ids.length > 5) return null
  }
  return ids
}
