#!/usr/bin/env node

import { constants as fsConstants } from 'node:fs'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE_ORIGIN = 'https://www.breadlab.ai'
const RPC_NAME = 'list_public_community_snapshots_v1'
const PAGE_SIZE = 100
const MAX_POSTS = 5000
const MAX_BODY_CHARS = 200_000
const MAX_BODY_BYTES = 200_000
const MAX_TOTAL_BODY_BYTES = 50_000_000
const MAX_RESPONSE_BYTES = 25_000_000
const PAGE_KEYS = ['has_more', 'items', 'next_cursor_created_at', 'next_cursor_id', 'snapshot_at']
const POST_KEYS = ['author', 'body_markdown', 'created_at', 'id', 'tags', 'title', 'updated_at']
const AUTHOR_KEYS = ['display_name', 'login']
const TAG_KEYS = ['id', 'label', 'slug']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/

function fail(message) {
  throw new Error(message)
}

function exactKeys(value, expected, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`invalid ${context}`)
  const actual = Object.keys(value).sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`invalid ${context} keys`)
  }
}

function validText(value, min, max, context) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) fail(`invalid ${context}`)
}

function validTimestamp(value, context) {
  const match = typeof value === 'string' ? TIMESTAMP_RE.exec(value) : null
  if (!match) fail(`invalid ${context}`)
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number)
  if (year < 1000 || hour > 23 || minute > 59 || second > 59) fail(`invalid ${context}`)
  const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day
    || calendar.getUTCHours() !== hour || calendar.getUTCMinutes() !== minute || calendar.getUTCSeconds() !== second) {
    fail(`invalid ${context}`)
  }
  if (match[8] !== 'Z') {
    const offsetHour = Number(match[10])
    const offsetMinute = Number(match[11])
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) fail(`invalid ${context}`)
  }
  const fraction = BigInt((match[7] || '').padEnd(6, '0'))
  const offsetMinutes = match[8] === 'Z' ? 0 : (Number(match[10]) * 60 + Number(match[11])) * (match[9] === '+' ? 1 : -1)
  return BigInt(Date.UTC(year, month - 1, day, hour, minute, second)) * 1000n
    + fraction - BigInt(offsetMinutes) * 60_000_000n
}

function validatePost(value) {
  exactKeys(value, POST_KEYS, 'snapshot post')
  if (!UUID_RE.test(value.id)) fail('invalid snapshot post id')
  validText(value.title, 2, 120, 'snapshot title')
  validText(value.body_markdown, 1, MAX_BODY_CHARS, 'snapshot body')
  if (Buffer.byteLength(value.body_markdown) > MAX_BODY_BYTES) fail('snapshot body exceeds byte limit')
  const createdAt = validTimestamp(value.created_at, 'created timestamp')
  const updatedAt = validTimestamp(value.updated_at, 'updated timestamp')
  if (updatedAt < createdAt) fail('snapshot timestamps are inconsistent')
  exactKeys(value.author, AUTHOR_KEYS, 'snapshot author')
  validText(value.author.login, 1, 39, 'author login')
  if (value.author.display_name !== null) validText(value.author.display_name, 1, 120, 'author display name')
  if (!Array.isArray(value.tags) || value.tags.length > 3) fail('invalid snapshot tags')
  const slugs = new Set()
  for (const tag of value.tags) {
    exactKeys(tag, TAG_KEYS, 'snapshot tag')
    if (!UUID_RE.test(tag.id)) fail('invalid tag id')
    if (typeof tag.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag.slug) || tag.slug.length > 80) fail('invalid tag slug')
    validText(tag.label, 1, 50, 'tag label')
    if (slugs.has(tag.slug)) fail('duplicate tag slug')
    slugs.add(tag.slug)
  }
  return value
}

function validatePage(value) {
  exactKeys(value, PAGE_KEYS, 'snapshot page')
  if (typeof value.has_more !== 'boolean') fail('invalid snapshot has_more')
  if (!Array.isArray(value.items) || value.items.length > PAGE_SIZE) fail('invalid snapshot page size')
  const snapshotAt = validTimestamp(value.snapshot_at, 'snapshot timestamp')
  for (const post of value.items) {
    validatePost(post)
    if (validTimestamp(post.created_at, 'created timestamp') > snapshotAt
      || validTimestamp(post.updated_at, 'updated timestamp') > snapshotAt) {
      fail('snapshot item exceeds cutoff')
    }
  }
  if (value.has_more) {
    if (value.items.length === 0 || !UUID_RE.test(value.next_cursor_id)) fail('invalid snapshot cursor')
    const cursorCreatedAt = validTimestamp(value.next_cursor_created_at, 'snapshot cursor timestamp')
    const last = value.items.at(-1)
    if (value.next_cursor_id !== last.id || cursorCreatedAt !== validTimestamp(last.created_at, 'created timestamp')) fail('snapshot cursor/item mismatch')
  } else if (value.next_cursor_id !== null || value.next_cursor_created_at !== null) {
    fail('invalid terminal snapshot cursor')
  }
  return value
}

function comparePostKeys(left, right) {
  const leftTime = validTimestamp(left.created_at, 'created timestamp')
  const rightTime = validTimestamp(right.created_at, 'created timestamp')
  return leftTime < rightTime ? -1 : leftTime > rightTime ? 1 : left.id.localeCompare(right.id)
}

function collectPages(pages) {
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > 51) fail('invalid fixture page collection')
  const posts = []
  const ids = new Set()
  const cursors = new Set()
  let totalBodyBytes = 0
  let previous = null
  let snapshotAt = null
  pages.forEach((page, index) => {
    validatePage(page)
    const pageSnapshotAt = validTimestamp(page.snapshot_at, 'snapshot timestamp')
    if (snapshotAt === null) snapshotAt = pageSnapshotAt
    else if (pageSnapshotAt !== snapshotAt) fail('snapshot timestamp changed between pages')
    const final = index === pages.length - 1
    if (final === page.has_more) fail('snapshot cursor/page mismatch')
    if (page.has_more) {
      const cursor = `${page.next_cursor_created_at}\u0000${page.next_cursor_id}`
      if (cursors.has(cursor)) fail('snapshot cursor loop')
      cursors.add(cursor)
    }
    for (const post of page.items) {
      if (previous && comparePostKeys(previous, post) >= 0) fail('snapshot items are not strictly ordered')
      previous = post
      if (ids.has(post.id)) fail('duplicate snapshot post id')
      ids.add(post.id)
      posts.push(post)
      totalBodyBytes += Buffer.byteLength(post.body_markdown)
      if (posts.length > MAX_POSTS) fail('snapshot post capacity exceeded')
      if (totalBodyBytes > MAX_TOTAL_BODY_BYTES) fail('snapshot body capacity exceeded')
    }
  })
  return posts.sort((a, b) => a.id.localeCompare(b.id))
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function decodeComponentBounded(value) {
  let decoded = String(value)
  for (let index = 0; index < 3; index += 1) {
    let next
    try {
      next = decodeURIComponent(decoded.replaceAll('+', ' '))
    } catch {
      // Decode safe ASCII escapes even when an unrelated malformed UTF-8
      // sequence would make decodeURIComponent reject the whole component.
      next = decoded.replace(/%([0-7][0-9a-f])/gi, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    }
    if (next === decoded) break
    decoded = next
  }
  return decoded
}

function credentialParameterName(value) {
  const decoded = decodeComponentBounded(value)
  const name = decoded.split(/[=&;#]/, 1)[0]
  return /^(?:token|apikey|api[_-]?key|key|signature|sig|secret|password|access[_-]?token|session|jwt|private[_-]?key)$/i.test(name)
    || /(?:^|[-_.])(?:credential|signature|security[-_]?token|access[-_]?key(?:[-_]?id)?)(?:$|[-_.])/i.test(name)
    || /^(?:AWSAccessKeyId|GoogleAccessId)$/i.test(name)
}

function componentContainsCredential(component) {
  const decoded = decodeComponentBounded(component).replace(/^[?#]/, '')
  // A valid percent byte that remains after the bounded decode is either
  // over-nested or part of a malformed sequence. Never publish it verbatim.
  if (/%[0-9a-f]{2}/i.test(decoded)) return true
  return decoded.split(/[?&#;]/).some((token) => credentialParameterName(token.split('=', 1)[0]))
}

function fragmentContainsCredential(fragment) {
  return fragment ? componentContainsCredential(fragment) : false
}

function safeUrl(raw) {
  if (typeof raw !== 'string' || /[\u0000-\u0020\u007f]/.test(raw)) return null
  let parsed
  try { parsed = new URL(raw, SITE_ORIGIN) } catch { return null }
  if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return null
  if (parsed.username || parsed.password) return null
  if (componentContainsCredential(parsed.search)) return null
  if (fragmentContainsCredential(parsed.hash)) return null
  const storagePath = parsed.pathname.toLowerCase()
  if (storagePath.includes('/storage/v1/object/') && !storagePath.includes('/storage/v1/object/public/')) return null
  if (/\.supabase\.(?:co|in)$/.test(parsed.hostname) && storagePath.includes('/storage/') && !storagePath.includes('/object/public/')) return null
  if (raw.startsWith('/') && !raw.startsWith('//')) return `${parsed.pathname}${parsed.search}${parsed.hash}`
  if (raw.startsWith('#')) return parsed.hash
  return parsed.href
}

function inlineMarkdown(source) {
  let cursor = 0
  let result = ''
  const link = /(!?)\[([^\]\n]*)\]\(([^)\n]+)\)/g
  for (const match of source.matchAll(link)) {
    result += escapeHtml(source.slice(cursor, match.index))
    const image = match[1] === '!'
    const label = escapeHtml(match[2])
    const url = safeUrl(match[3].trim())
    if (!url) result += label
    else if (image) result += `<img src="${escapeHtml(url)}" alt="${label}" loading="lazy">`
    else result += `<a href="${escapeHtml(url)}" rel="nofollow ugc">${label}</a>`
    cursor = match.index + match[0].length
  }
  result += escapeHtml(source.slice(cursor))
  result = result.replace(/`([^`\n]+)`/g, '<code>$1</code>')
  result = result.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  result = result.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>')
  return result
}

function renderMarkdown(markdown) {
  const lines = markdown.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
  const output = []
  let paragraph = []
  let inCode = false
  let code = []
  const flush = () => {
    if (paragraph.length) output.push(`<p>${inlineMarkdown(paragraph.join('\n')).replaceAll('\n', '<br>')}</p>`)
    paragraph = []
  }
  for (const line of lines) {
    if (/^```/.test(line)) {
      flush()
      if (inCode) { output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`); code = [] }
      inCode = !inCode
      continue
    }
    if (inCode) { code.push(line); continue }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) { flush(); const level = heading[1].length; output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`); continue }
    if (line.trim() === '') { flush(); continue }
    paragraph.push(line)
  }
  if (inCode) output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`)
  flush()
  return output.join('\n')
}

function jsonForHtml(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026')
}

function markdownDescription(markdown) {
  return markdown
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[`*_#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
}

function renderSnapshot(post) {
  const canonical = `${SITE_ORIGIN}/community/content/${post.id}/`
  const author = post.author.display_name || post.author.login
  const description = markdownDescription(post.body_markdown)
  const tags = post.tags.map((tag) => tag.label)
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'BlogPosting', headline: post.title,
    datePublished: post.created_at, dateModified: post.updated_at,
    author: { '@type': 'Person', name: author }, keywords: tags, mainEntityOfPage: canonical, url: canonical,
  }
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(post.title)} | Breadlab 커뮤니티</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="article"><meta property="og:title" content="${escapeHtml(post.title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${canonical}">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="${escapeHtml(post.title)}"><meta name="twitter:description" content="${escapeHtml(description)}">
<script type="application/ld+json">${jsonForHtml(jsonLd)}</script></head>
<body><main><article><header><h1>${escapeHtml(post.title)}</h1><p>작성자 <span>${escapeHtml(author)}</span> · <time datetime="${post.created_at}">${post.created_at}</time> · 수정 <time datetime="${post.updated_at}">${post.updated_at}</time></p>${tags.length ? `<ul>${tags.map((tag) => `<li>${escapeHtml(tag)}</li>`).join('')}</ul>` : ''}</header>
<section>${renderMarkdown(post.body_markdown)}</section>
<footer><a href="/community/post/?id=${post.id}">커뮤니티에서 게시글 보기</a></footer></article></main></body></html>
`
}

function decodeXml(value) {
  if (/&(?!(?:amp|lt|gt|quot|apos);)/.test(value)) fail('malformed sitemap entity')
  return value.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'")
}

function validateXmlWellFormed(xml) {
  const stack = []
  let cursor = 0
  for (const match of xml.matchAll(/<[^>]*>/g)) {
    if (/[<>]/.test(xml.slice(cursor, match.index))) fail('malformed sitemap')
    const token = match[0]
    cursor = match.index + token.length
    if (token.startsWith('<?')) {
      if (!/^<\?xml\s[^?]*\?>$/.test(token) || match.index !== xml.search(/\S/)) fail('malformed sitemap')
      continue
    }
    if (token.startsWith('<!--')) {
      if (!/^<!--[\s\S]*-->$/.test(token) || token.slice(4, -3).includes('--')) fail('malformed sitemap')
      continue
    }
    if (token.startsWith('<!')) fail('malformed sitemap')
    const closing = /^<\/([A-Za-z_][\w:.-]*)\s*>$/.exec(token)
    if (closing) {
      if (stack.pop() !== closing[1]) fail('malformed sitemap')
      continue
    }
    const opening = /^<([A-Za-z_][\w:.-]*)(?:\s[^<>]*)?\s*(\/?)>$/.exec(token)
    if (!opening) fail('malformed sitemap')
    if (!opening[2]) stack.push(opening[1])
  }
  if (/[<>]/.test(xml.slice(cursor)) || stack.length) fail('malformed sitemap')
}

function validateAndMergeSitemap(xml, posts) {
  if (typeof xml !== 'string' || xml.length > 20_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) fail('malformed sitemap')
  validateXmlWellFormed(xml)
  const root = /^\s*(?:<\?xml[^?]*\?>\s*)?<urlset\b[^>]*>[\s\S]*<\/urlset>\s*$/.test(xml)
  if (!root || (xml.match(/<urlset\b/g) || []).length !== 1 || (xml.match(/<\/urlset>/g) || []).length !== 1) fail('malformed sitemap')
  const urlOpen = (xml.match(/<url\b/g) || []).length
  const urlClose = (xml.match(/<\/url>/g) || []).length
  if (urlOpen !== urlClose) fail('malformed sitemap')
  const snapshotLocation = /^https:\/\/www\.breadlab\.ai\/community\/content\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/$/i
  const withoutSnapshots = xml.replace(/\s*<url\b[^>]*>[\s\S]*?<\/url>/g, (node) => {
    const match = /<loc>([^<]*)<\/loc>/.exec(node)
    return match && snapshotLocation.test(decodeXml(match[1].trim())) ? '' : node
  })
  const existing = new Set()
  for (const match of withoutSnapshots.matchAll(/<loc>([^<]*)<\/loc>/g)) {
    const location = decodeXml(match[1].trim())
    let parsed
    try { parsed = new URL(location) } catch { fail('malformed sitemap location') }
    if (!['http:', 'https:'].includes(parsed.protocol)) fail('malformed sitemap location')
    existing.add(location)
  }
  const additions = posts.map((post) => `${SITE_ORIGIN}/community/content/${post.id}/`).filter((loc) => !existing.has(loc)).sort()
  if (!additions.length) return withoutSnapshots
  const nodes = additions.map((loc) => `  <url><loc>${escapeHtml(loc)}</loc></url>`).join('\n')
  return withoutSnapshots.replace(/\s*<\/urlset>\s*$/, `\n${nodes}\n</urlset>\n`)
}

async function exists(target) {
  try { await access(target, fsConstants.F_OK); return true } catch { return false }
}

async function publishSnapshotArtifacts(output, sitemap, posts, sitemapContent, operations = {}) {
  const renamePath = operations.rename || rename
  const outputParent = path.dirname(output)
  const sitemapParent = path.dirname(sitemap)
  const outputTemporary = path.join(outputParent, `.${path.basename(output)}.tmp-${process.pid}`)
  const outputBackup = path.join(outputParent, `.${path.basename(output)}.old-${process.pid}`)
  const sitemapTemporary = path.join(sitemapParent, `.${path.basename(sitemap)}.tmp-${process.pid}`)
  const sitemapBackup = path.join(sitemapParent, `.${path.basename(sitemap)}.old-${process.pid}`)
  const transactionPaths = [outputTemporary, outputBackup, sitemapTemporary, sitemapBackup]
  for (const target of transactionPaths) await rm(target, { recursive: true, force: true })
  await mkdir(outputTemporary, { recursive: true })
  await mkdir(sitemapParent, { recursive: true })

  let outputBackedUp = false
  let sitemapBackedUp = false
  let outputInstalled = false
  let sitemapInstalled = false
  let rollbackFailed = false
  try {
    for (const post of posts) {
      const directory = path.join(outputTemporary, post.id)
      await mkdir(directory, { recursive: true })
      await writeFile(path.join(directory, 'index.html'), renderSnapshot(post))
    }
    await writeFile(sitemapTemporary, sitemapContent, { flag: 'wx' })

    if (await exists(output)) {
      await renamePath(output, outputBackup)
      outputBackedUp = true
    }
    await renamePath(sitemap, sitemapBackup)
    sitemapBackedUp = true
    await renamePath(outputTemporary, output)
    outputInstalled = true
    await renamePath(sitemapTemporary, sitemap)
    sitemapInstalled = true
  } catch (error) {
    try {
      if (sitemapInstalled) await rm(sitemap, { force: true })
      if (sitemapBackedUp) await renamePath(sitemapBackup, sitemap)
      if (outputInstalled) await rm(output, { recursive: true, force: true })
      if (outputBackedUp) await renamePath(outputBackup, output)
    } catch (rollbackError) {
      rollbackFailed = true
      throw new AggregateError([error, rollbackError], 'snapshot publish and rollback failed')
    }
    throw error
  } finally {
    await rm(outputTemporary, { recursive: true, force: true })
    await rm(sitemapTemporary, { recursive: true, force: true })
    if (!rollbackFailed) {
      await rm(outputBackup, { recursive: true, force: true })
      await rm(sitemapBackup, { recursive: true, force: true })
    }
  }
}

function rejectServiceRole(env) {
  if (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY) fail('service-role credentials are forbidden')
  const key = env.SUPABASE_PUBLISHABLE_KEY
  if (!key) return
  if (/service[_-]?role/i.test(key)) fail('service-role credentials are forbidden')
  const pieces = key.split('.')
  if (pieces.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(pieces[1], 'base64url').toString('utf8'))
      if (payload.role === 'service_role') fail('service-role credentials are forbidden')
    } catch (error) {
      if (error.message.includes('service-role')) throw error
    }
  }
}

function assertPublishableCredential(key) {
  if (/^sb_publishable_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{8}$/.test(key)) return
  const parts = key.split('.')
  if (parts.length === 3 && parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part)) && parts[2].length === 43) {
    try {
      if (Buffer.from(parts[0], 'base64url').toString('base64url') !== parts[0]
        || Buffer.from(parts[1], 'base64url').toString('base64url') !== parts[1]
        || Buffer.from(parts[2], 'base64url').toString('base64url') !== parts[2]
        || Buffer.from(parts[2], 'base64url').byteLength !== 32) fail('invalid legacy JWT encoding')
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
      const plainHeader = header !== null && typeof header === 'object' && !Array.isArray(header)
      const plainPayload = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
      if (plainHeader && header.alg === 'HS256' && header.typ === 'JWT' && plainPayload && payload.role === 'anon') return
    } catch {
      // Fall through to the generic fail-closed error below.
    }
  }
  fail('SUPABASE_PUBLISHABLE_KEY must contain an anon or publishable credential')
}

async function readResponseBytes(response) {
  if (!response.body) fail('snapshot RPC response body is not streamable')
  const chunks = []
  let total = 0
  const retain = (chunk) => {
    if (!ArrayBuffer.isView(chunk)) fail('snapshot RPC response body is not streamable')
    const bytes = Buffer.from(chunk)
    total += bytes.length
    if (total > MAX_RESPONSE_BYTES) fail('snapshot RPC response exceeds limit')
    chunks.push(bytes)
  }
  if (typeof response.body[Symbol.asyncIterator] === 'function') {
    for await (const chunk of response.body) retain(chunk)
  } else if (typeof response.body.getReader === 'function') {
    const reader = response.body.getReader()
    let complete = false
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) { complete = true; break }
        retain(value)
      }
    } finally {
      if (!complete) await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  } else {
    fail('snapshot RPC response body is not streamable')
  }
  return Buffer.concat(chunks, total)
}

async function loadLiveSweep(endpoint, key) {
  const pages = []
  let snapshotAt = null
  let cursorCreatedAt = null
  let cursorId = null
  let postCount = 0
  let totalBodyBytes = 0
  const seen = new Set()
  do {
    const response = await fetch(endpoint, {
      method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ p_limit: PAGE_SIZE, p_snapshot_at: snapshotAt, p_cursor_created_at: cursorCreatedAt, p_cursor_id: cursorId }), redirect: 'error',
    })
    if (!response.ok) fail(`snapshot RPC failed with status ${response.status}`)
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) fail('snapshot RPC response exceeds limit')
    const bytes = await readResponseBytes(response)
    let page
    try { page = JSON.parse(bytes.toString('utf8')) } catch { fail('snapshot RPC returned invalid JSON') }
    validatePage(page)
    const pageSnapshotAt = validTimestamp(page.snapshot_at, 'snapshot timestamp')
    if (snapshotAt !== null && pageSnapshotAt !== validTimestamp(snapshotAt, 'snapshot timestamp')) fail('snapshot timestamp changed between pages')
    for (const post of page.items) {
      postCount += 1
      totalBodyBytes += Buffer.byteLength(post.body_markdown)
      if (postCount > MAX_POSTS) fail('snapshot post capacity exceeded')
      if (totalBodyBytes > MAX_TOTAL_BODY_BYTES) fail('snapshot body capacity exceeded')
    }
    if (pages.length >= 51) fail('snapshot page capacity exceeded')
    pages.push(page)
    if (snapshotAt === null) snapshotAt = page.snapshot_at
    if (page.has_more) {
      const cursor = `${page.next_cursor_created_at}\u0000${page.next_cursor_id}`
      if (seen.has(cursor)) fail('snapshot cursor loop')
      seen.add(cursor)
      cursorCreatedAt = page.next_cursor_created_at
      cursorId = page.next_cursor_id
    } else {
      cursorCreatedAt = null
      cursorId = null
    }
  } while (pages.at(-1).has_more)
  collectPages(pages)
  return pages
}

function normalizedPosts(pages) {
  return JSON.stringify(collectPages(pages).map((post) => ({
    author: { display_name: post.author.display_name, login: post.author.login },
    body_markdown: post.body_markdown,
    created_at: post.created_at,
    id: post.id,
    tags: post.tags.map((tag) => ({ id: tag.id, label: tag.label, slug: tag.slug })),
    title: post.title,
    updated_at: post.updated_at,
  })))
}

async function loadLivePages(env) {
  const base = env.SUPABASE_URL
  const key = env.SUPABASE_PUBLISHABLE_KEY
  if (!base || !key) fail('SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required in live mode')
  assertPublishableCredential(key)
  let endpoint
  try { endpoint = new URL(`/rest/v1/rpc/${RPC_NAME}`, base) } catch { fail('invalid SUPABASE_URL') }
  if (endpoint.protocol !== 'https:' && endpoint.hostname !== 'localhost' && endpoint.hostname !== '127.0.0.1') fail('SUPABASE_URL must use HTTPS')
  const first = await loadLiveSweep(endpoint, key)
  const second = await loadLiveSweep(endpoint, key)
  if (normalizedPosts(first) !== normalizedPosts(second)) fail('community posts changed between live snapshot sweeps')
  return second
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!['--fixture', '--output', '--sitemap'].includes(flag) || !value || value.startsWith('--')) fail('usage: community-snapshots.mjs [--fixture path] --output dir --sitemap path')
    if (options[flag]) fail(`duplicate argument ${flag}`)
    options[flag] = value
  }
  if (!options['--output'] || !options['--sitemap']) fail('usage: community-snapshots.mjs [--fixture path] --output dir --sitemap path')
  return options
}

async function main() {
  rejectServiceRole(process.env)
  const options = parseArgs(process.argv.slice(2))
  let pages
  if (options['--fixture']) {
    const raw = await readFile(options['--fixture'], 'utf8')
    if (Buffer.byteLength(raw) > 60_000_000) fail('fixture exceeds byte limit')
    try { pages = JSON.parse(raw) } catch { fail('fixture is invalid JSON') }
  } else {
    pages = await loadLivePages(process.env)
  }
  const posts = collectPages(pages)
  const sitemapPath = path.resolve(options['--sitemap'])
  const outputPath = path.resolve(options['--output'])
  if (sitemapPath === outputPath || sitemapPath.startsWith(`${outputPath}${path.sep}`)) fail('sitemap must be outside snapshot output')
  const oldSitemap = await readFile(sitemapPath, 'utf8')
  const newSitemap = validateAndMergeSitemap(oldSitemap, posts)
  await publishSnapshotArtifacts(outputPath, sitemapPath, posts, newSitemap)
  process.stdout.write(`Generated ${posts.length} community snapshot(s).\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`community snapshot generation failed: ${error instanceof Error ? error.message : 'unknown error'}\n`)
    process.exitCode = 1
  })
}

export { collectPages, loadLivePages, publishSnapshotArtifacts, renderMarkdown, renderSnapshot, validateAndMergeSitemap }
