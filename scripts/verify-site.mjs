#!/usr/bin/env node

import { verifyBenefitsArtifacts } from './verify-benefits-artifacts.mjs'
import { verifyBenefitsResearchArtifacts } from './verify-benefits-research-artifacts.mjs'
import { verifyDomesticDirectoryArtifacts } from './verify-domestic-directory-artifacts.mjs'
import { verifyDomesticSizeArtifacts } from './verify-domestic-size-artifacts.mjs'
import { verifyDomesticSearchIndex } from './verify-domestic-search-index.mjs'
import { constants, createReadStream } from 'node:fs'
import { lstat, open, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const siteRoot = path.resolve(process.argv[2] ?? '_site')
const errors = []
let artifactInventorySafe = true

const requiredFiles = [
  'index.html',
  'blog/index.html',
  'lab/index.html',
  'blog/ceph-cluster-install-with-helm.html',
  '404.html',
  'CNAME',
  'robots.txt',
  'sitemap.xml',
  'css/style.css',
  'js/personal-min.js',
  'images/favicon.ico',
  'community/index.html',
  'community/write/index.html',
  'community/post/index.html',
  'community/edit/index.html',
  'community/admin/reports/index.html',
  'community/auth/callback/index.html',
  'community/benefits/index.html',
  'community/benefits/fit/index.html',
  'community/benefits/company/index.html',
  'community/benefits/directory/index.html',
  'community/benefits/methodology/index.html',
  'community/benefits/correction/index.html',
  'community/benefits/my-corrections/index.html',
  'benefits/index.html',
  'benefits/company/index.html',
]

const forbiddenSegments = new Set([
  '.git',
  '.github',
  '.idea',
  '_data',
  '_drafts',
  '_includes',
  '_layouts',
  '_pages',
  '_plugins',
  '_posts',
  '_projects',
  '_sass',
  'community-app',
  'docs',
  'migrations',
  'node_modules',
  'scripts',
  'src',
  'supabase',
])
const forbiddenNames = [
  /^Dockerfile.*$/i,
  /^(?:docker-)?compose(?:\.[^.]+)?\.ya?ml$/i,
  /^\.dockerignore$/i,
  /^\.env(?:\..*)?$/i,
  /^\.npmrc$/i,
  /^_config(?:\.[^.]+)*\.ya?ml$/i,
  /^\.ruby-version$/i,
  /^deno\.lock$/i,
  /^Gemfile(?:\.lock)?$/,
  /^Rakefile$/,
  /^package(?:-lock)?\.json$/i,
  /^tsconfig(?:\..*)?\.json$/i,
  /^(?:babel|eslint|next|postcss|prettier|rollup|tailwind|vite|webpack)\.config\.[cm]?[jt]s$/i,
  /\.(?:sql|ts|tsx|jsx|vue|svelte|scss|sass|less|map)$/i,
  /^(?:id_rsa|id_ed25519)$/i,
  /\.(?:key|pem)$/i,
]
const forbiddenCommunityOperationsNames = new Set([
  'community-release-runbook.md',
  'community-backup-restore.md',
  'community-rollback.md',
  'community-release-checklist.md',
])
const secretPatterns = [
  /\bsb_secret_[A-Za-z0-9._-]+/,
  /\b(?:gh[opusr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bpostgres(?:ql)?:\/\/[^\s"'<>]+/i,
]
const allowedDotfiles = new Set(['.nojekyll'])

function containsServiceRoleJwt(text) {
  const candidates = text.match(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g) ?? []
  return candidates.some((token) => {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
      return payload.role === 'service_role'
    } catch {
      return false
    }
  })
}

function fail(message) {
  errors.push(message)
}

async function stat(relativePath) {
  try {
    return await lstat(path.join(siteRoot, relativePath))
  } catch {
    fail(`missing required artifact: ${relativePath}`)
    return null
  }
}

async function readText(relativePath) {
  try {
    return await readFile(path.join(siteRoot, relativePath), 'utf8')
  } catch (error) {
    fail(`cannot read ${relativePath}: ${error.message}`)
    return ''
  }
}

function assertIncludes(content, expected, relativePath, behavior) {
  if (!content.includes(expected)) {
    fail(`${relativePath} is missing ${behavior}: ${expected}`)
  }
}

const htmlWhitespace = /[\t\n\f\r ]/
const htmlWhitespaceSequence = /[\t\n\f\r ]+/
const rawTextElements = new Set(['iframe', 'noembed', 'noframes', 'noscript', 'script', 'style', 'textarea', 'title', 'xmp'])
const inertElements = new Set(['frameset', 'select', 'template'])

function findTagEnd(html, start) {
  let quote = null
  for (let position = start; position < html.length; position += 1) {
    const character = html[position]
    if (quote) {
      if (character === quote) quote = null
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '>') {
      return position
    }
  }
  return -1
}

function parseStartTag(source) {
  let position = 0
  while (htmlWhitespace.test(source[position] ?? '')) position += 1
  const nameStart = position
  while (/[A-Za-z0-9:-]/.test(source[position] ?? '')) position += 1
  if (position === nameStart) return null

  const name = source.slice(nameStart, position).toLowerCase()
  const attributes = new Map()
  let selfClosing = false
  while (position < source.length) {
    while (htmlWhitespace.test(source[position] ?? '')) position += 1
    if (position === source.length) break
    if (source[position] === '/' && position === source.length - 1) {
      selfClosing = true
      break
    }

    const attributeStart = position
    while (position < source.length && !htmlWhitespace.test(source[position]) && !['/', '=', '"', "'", '<'].includes(source[position])) {
      position += 1
    }
    if (position === attributeStart) return null
    const attributeName = source.slice(attributeStart, position).toLowerCase()
    if (attributes.has(attributeName)) return null

    while (htmlWhitespace.test(source[position] ?? '')) position += 1
    let value = null
    if (source[position] === '=') {
      position += 1
      while (htmlWhitespace.test(source[position] ?? '')) position += 1
      if (position === source.length) return null
      const quote = source[position]
      if (quote === '"' || quote === "'") {
        const valueStart = ++position
        while (position < source.length && source[position] !== quote) position += 1
        if (position === source.length) return null
        value = source.slice(valueStart, position)
        position += 1
      } else {
        const valueStart = position
        while (position < source.length && !htmlWhitespace.test(source[position])) position += 1
        value = source.slice(valueStart, position)
        if (!value || /["'<=`]/.test(value)) return null
      }
    }
    attributes.set(attributeName, value)
  }
  return { attributes, name, selfClosing }
}

function findRawTextClosingTag(html, lowerHtml, position, name) {
  const closingPrefix = `</${name}`
  while (position < html.length) {
    const closingStart = lowerHtml.indexOf(closingPrefix, position)
    if (closingStart === -1) return null
    const boundary = html[closingStart + closingPrefix.length]
    if (boundary === '>' || htmlWhitespace.test(boundary ?? '')) {
      const closingEnd = findTagEnd(html, closingStart + closingPrefix.length)
      if (closingEnd === -1) return null
      const suffix = html.slice(closingStart + closingPrefix.length, closingEnd)
      return { start: closingStart, end: closingEnd + 1, invalid: /[^\t\n\f\r ]/.test(suffix) }
    }
    position = closingStart + closingPrefix.length
  }
  return null
}

function skipRawTextElement(html, lowerHtml, position, name) {
  const closingTag = findRawTextClosingTag(html, lowerHtml, position, name)
  return closingTag && !closingTag.invalid ? closingTag.end : -1
}

function extractDocumentTitle(html) {
  const lowerHtml = html.toLowerCase()
  const titles = []
  const canonicalLinks = []
  const scriptTags = []
  let position = 0
  const inertStack = []
  let htmlStarts = 0
  let htmlEnds = 0
  let headStarts = 0
  let headEnds = 0
  let inHtml = false
  let inHead = false
  let inBody = false
  let bodyStarted = false
  let bodyStarts = 0
  let bodyEnds = 0
  let doctypeSeen = false
  let error = null

  while (position < html.length) {
    const tagStart = html.indexOf('<', position)
    const textEnd = tagStart === -1 ? html.length : tagStart
    const text = html.slice(position, textEnd)
    const documentText = position === 0 && text.startsWith('\uFEFF') ? text.slice(1) : text
    if (inertStack.length === 0 && /[^\t\n\f\r ]/.test(documentText)) {
      if (!inHtml) {
        error ??= 'html'
      } else if (!inHead && !bodyStarted) {
        bodyStarted = true
      }
    }
    if (tagStart === -1) break

    if (html.startsWith('<!--', tagStart)) {
      const commentEnd = html.indexOf('-->', tagStart + 4)
      if (commentEnd === -1) {
        error ??= 'html'
        break
      }
      position = commentEnd + 3
      continue
    }

    const next = html[tagStart + 1]
    if (!next || !/[A-Za-z!/?]/.test(next)) {
      error ??= 'html'
      break
    }

    const tagEnd = findTagEnd(html, tagStart + 1)
    if (tagEnd === -1) {
      error ??= 'html'
      break
    }
    let source = html.slice(tagStart + 1, tagEnd)
    const closing = source.startsWith('/')
    if (closing) source = source.slice(1)
    if (/^!doctype\b/i.test(source)) {
      if (!/^!doctype[\t\n\f\r ]+html[\t\n\f\r ]*$/i.test(source)) error ??= 'html'
      if (inHtml || htmlStarts !== 0 || doctypeSeen) error ??= 'html'
      doctypeSeen = true
      position = tagEnd + 1
      continue
    }
    if (/^\s*[!?]/.test(source)) {
      error ??= 'html'
      position = tagEnd + 1
      continue
    }

    if (closing) {
      const match = /^([A-Za-z0-9:-]+)\s*$/.exec(source)
      if (!match) {
        error ??= 'html'
        position = tagEnd + 1
        continue
      }
      const name = match[1].toLowerCase()
      if (!inHtml) error ??= 'html'
      if (inHtml && headStarts === 0 && name !== 'title') error ??= 'head'
      if (inertStack.length > 0) {
        if (inertStack.at(-1) === name) inertStack.pop()
      } else if (name === 'html') {
        htmlEnds += 1
        if (!inHtml || inHead || htmlEnds !== 1) error ??= 'html'
        inHtml = false
      } else if (name === 'head') {
        headEnds += 1
        if (!inHead || !inHtml || bodyStarted || headEnds !== 1) error ??= 'head'
        inHead = false
      } else if (name === 'body') {
        bodyEnds += 1
        if (!inBody || !inHtml || bodyEnds !== 1) error ??= 'body'
        inBody = false
      } else if (name === 'title') {
        error ??= 'title-outside-head'
      }
      position = tagEnd + 1
      continue
    }

    const tag = parseStartTag(source)
    if (!tag) {
      error ??= 'html'
      position = tagEnd + 1
      continue
    }

    if (!inHtml && tag.name !== 'html') error ??= 'html'
    if (inHtml && headStarts === 0 && !['head', 'title'].includes(tag.name)) error ??= 'head'

    if (tag.name === 'script' && inertStack.length === 0 && (inHead || inBody)) {
      scriptTags.push(tag)
    }

    if (rawTextElements.has(tag.name) && tag.name !== 'title') {
      const afterRawText = skipRawTextElement(html, lowerHtml, tagEnd + 1, tag.name)
      if (afterRawText === -1) break
      position = afterRawText
      continue
    }
    if (inertElements.has(tag.name)) {
      inertStack.push(tag.name)
      position = tagEnd + 1
      continue
    }
    if (inertStack.length > 0) {
      if (tag.name === 'title') {
        const afterTitle = skipRawTextElement(html, lowerHtml, tagEnd + 1, tag.name)
        if (afterTitle === -1) break
        position = afterTitle
      } else {
        position = tagEnd + 1
      }
      continue
    }

    if (tag.name === 'html') {
      htmlStarts += 1
      if (tag.selfClosing || inHtml || htmlStarts !== 1 || htmlEnds !== 0) error ??= 'html'
      inHtml = true
      position = tagEnd + 1
      continue
    }
    if (tag.name === 'head') {
      headStarts += 1
      if (tag.selfClosing || !inHtml || inHead || bodyStarted || headStarts !== 1 || headEnds !== 0) error ??= 'head'
      inHead = true
      position = tagEnd + 1
      continue
    }
    if (tag.name === 'body') {
      bodyStarts += 1
      if (!inHtml || inHead || headEnds !== 1) error ??= 'head'
      if (tag.selfClosing || inBody || bodyStarts !== 1 || bodyEnds !== 0) error ??= 'body'
      bodyStarted = true
      inBody = true
      position = tagEnd + 1
      continue
    }
    if (tag.name === 'title') {
      const closingTag = findRawTextClosingTag(html, lowerHtml, tagEnd + 1, tag.name)
      if (!closingTag || closingTag.invalid) return { error: 'unclosed-title', titles, canonicalLinks }
      titles.push(html.slice(tagEnd + 1, closingTag.start).trim())
      if (!inHead) error ??= 'title-outside-head'
      position = closingTag.end
      continue
    }

    if (tag.name === 'link' && inHead &&
        (tag.attributes.get('rel') ?? '').toLowerCase().split(htmlWhitespaceSequence).includes('canonical')) {
      canonicalLinks.push(tag.attributes.get('href'))
    }

    position = tagEnd + 1
  }

  if (htmlStarts !== 1 || htmlEnds !== 1 || inHtml) error ??= 'html'
  if (headStarts !== 1 || headEnds !== 1 || inHead) error ??= 'head'
  if (bodyStarts !== 1 || bodyEnds !== 1 || inBody) error ??= 'body'
  return { error, titles, canonicalLinks, scriptTags }
}

function hasNavigationAjaxOptOut(html, expectedHref, expectedText, requireMenuList = false) {
  const lowerHtml = html.toLowerCase()
  const inertStack = []
  let anchor = null
  let foundMenuLinks = 0
  let allMenuLinksOptOut = true
  const menuListStack = []
  let position = 0

  while (position < html.length) {
    const tagStart = html.indexOf('<', position)
    const textEnd = tagStart === -1 ? html.length : tagStart
    if (anchor && inertStack.length === 0) anchor.text += html.slice(position, textEnd)
    if (tagStart === -1) break

    if (html.startsWith('<!--', tagStart)) {
      const commentEnd = html.indexOf('-->', tagStart + 4)
      if (commentEnd === -1) return false
      position = commentEnd + 3
      continue
    }

    const next = html[tagStart + 1]
    if (!next || (!/[A-Za-z!/]/.test(next))) {
      if (anchor && inertStack.length === 0) anchor.text += '<'
      position = tagStart + 1
      continue
    }

    const tagEnd = findTagEnd(html, tagStart + 1)
    if (tagEnd === -1) return false
    let source = html.slice(tagStart + 1, tagEnd)
    const closing = /^\s*\//.test(source)
    if (closing) source = source.replace(/^\s*\/\s*/, '')
    if (/^\s*[!?]/.test(source)) {
      position = tagEnd + 1
      continue
    }

    if (closing) {
      const match = /^([A-Za-z0-9:-]+)\s*$/.exec(source)
      if (!match) return false
      const name = match[1].toLowerCase()
      if (inertElements.has(name)) {
        if (inertStack.at(-1) !== name) return false
        inertStack.pop()
      } else if (name === 'a' && inertStack.length === 0) {
        if (!anchor) return false
        const classes = anchor.attributes.get('class')?.split(htmlWhitespaceSequence) ?? []
        const isExpectedMenuLink = anchor.attributes.get('href') === expectedHref
          && anchor.text.trim() === expectedText
          && classes.includes('menu__list__item__link')
          && (!requireMenuList || anchor.inMenuList)
        if (isExpectedMenuLink) {
          foundMenuLinks += 1
          if (!classes.includes('js-no-ajax')) allMenuLinksOptOut = false
        }
        anchor = null
      } else if (name === 'ul' && inertStack.length === 0) {
        if (menuListStack.length === 0) return false
        menuListStack.pop()
      }
      position = tagEnd + 1
      continue
    }

    const tag = parseStartTag(source)
    if (!tag) return false
    if (tag.name === 'plaintext') {
      if (anchor) return false
      position = html.length
      continue
    }
    if (rawTextElements.has(tag.name)) {
      const afterRawText = skipRawTextElement(html, lowerHtml, tagEnd + 1, tag.name)
      if (afterRawText === -1) return false
      position = afterRawText
      continue
    }
    if (inertElements.has(tag.name)) {
      inertStack.push(tag.name)
    } else if (tag.name === 'ul' && inertStack.length === 0) {
      const classes = tag.attributes.get('class')?.split(htmlWhitespaceSequence) ?? []
      menuListStack.push((menuListStack.at(-1) ?? false) || classes.includes('menu__list'))
    } else if (tag.name === 'a' && inertStack.length === 0) {
      if (anchor || tag.selfClosing) return false
      anchor = { attributes: tag.attributes, text: '', inMenuList: menuListStack.at(-1) ?? false }
    }
    position = tagEnd + 1
  }

  return anchor === null
    && inertStack.length === 0
    && menuListStack.length === 0
    && (requireMenuList ? foundMenuLinks === 1 : foundMenuLinks > 0)
    && allMenuLinksOptOut
}

function hasCommunityAjaxOptOut(html) {
  return hasNavigationAjaxOptOut(html, '/community/', 'Community')
}

function hasBenefitsAjaxOptOut(html) {
  return hasNavigationAjaxOptOut(html, '/benefits/', '기업 복지', true)
}

function communityAssetReferences(html, shellPath) {
  const references = []
  const attributePattern = /\b(src|href|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi
  for (const match of html.matchAll(attributePattern)) {
    const value = match[2] ?? match[3] ?? match[4]
    const candidates = match[1].toLowerCase() === 'srcset'
      ? srcsetCandidates(value)
      : [value]
    for (const candidate of candidates) {
      try {
        const url = new URL(candidate, `https://www.breadlab.ai/${shellPath}`)
        if (url.origin === 'https://www.breadlab.ai' && url.pathname.startsWith('/community/assets/')) {
          references.push(url.pathname)
        }
      } catch {
        // Other verifier checks handle malformed or missing asset references.
      }
    }
  }
  return references
}

function srcsetCandidates(srcset) {
  const candidates = []
  let position = 0
  while (position < srcset.length) {
    while (/[\s,]/.test(srcset[position] ?? '')) position += 1
    const start = position
    while (position < srcset.length && !/[\s,]/.test(srcset[position])) position += 1
    const candidate = srcset.slice(start, position)
    if (candidate) candidates.push(candidate)
    while (position < srcset.length && srcset[position] !== ',') position += 1
    if (srcset[position] === ',') position += 1
  }
  return candidates
}

async function scanFileForSecrets(relativePath) {
  const reportedPatterns = new Set()
  let reportedServiceRole = false
  let overlap = Buffer.alloc(0)
  let bytesRead = 0

  for await (const chunk of createReadStream(path.join(siteRoot, relativePath), { highWaterMark: 64 * 1024 })) {
    const combined = Buffer.concat([overlap, chunk])
    const combinedOffset = bytesRead - overlap.length
    const alignedStart = Math.abs(combinedOffset % 2)
    const utf16Bytes = combined.subarray(alignedStart, combined.length - (combined.length - alignedStart) % 2)
    const utf16beBytes = Buffer.from(utf16Bytes)
    utf16beBytes.swap16()
    const texts = [
      combined.toString('latin1'),
      utf16Bytes.toString('utf16le'),
      utf16beBytes.toString('utf16le'),
    ]
    for (const text of texts) {
      for (const pattern of secretPatterns) {
        if (!reportedPatterns.has(pattern) && pattern.test(text)) {
          fail(`possible secret leaked into artifact: ${relativePath} (${pattern})`)
          reportedPatterns.add(pattern)
        }
      }
      if (!reportedServiceRole && containsServiceRoleJwt(text)) {
        fail(`Supabase service-role token leaked into artifact: ${relativePath}`)
        reportedServiceRole = true
      }
    }
    bytesRead += chunk.length
    overlap = combined.subarray(-64 * 1024)
  }
}

function isContentHashedAsset(assetPath) {
  return /^.+-[A-Za-z0-9_-]{8,}\.[^./]+$/i.test(path.posix.basename(assetPath))
}

const MAX_ARTIFACT_ENTRIES = 100_000
const MAX_ARTIFACT_DEPTH = 64

function artifactEntryType(entryStat) {
  if (entryStat.isSymbolicLink()) return 'symbolic link'
  if (entryStat.isFIFO()) return 'FIFO'
  if (entryStat.isSocket()) return 'socket'
  if (entryStat.isBlockDevice()) return 'block device'
  if (entryStat.isCharacterDevice()) return 'character device'
  return 'unknown nonregular type'
}

async function walk(relativeDirectory = '', traversal = { entries: 0 }, depth = 0) {
  if (depth > MAX_ARTIFACT_DEPTH) {
    artifactInventorySafe = false
    fail(`artifact traversal exceeds maximum depth at: ${relativeDirectory}`)
    return []
  }
  const absoluteDirectory = path.join(siteRoot, relativeDirectory)
  let entries
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true })
  } catch (error) {
    artifactInventorySafe = false
    fail(`cannot inspect artifact directory ${relativeDirectory || '.'}: ${error.message}`)
    return []
  }

  const files = []
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name)
    traversal.entries += 1
    if (traversal.entries > MAX_ARTIFACT_ENTRIES) {
      artifactInventorySafe = false
      fail(`artifact traversal exceeds ${MAX_ARTIFACT_ENTRIES} entries at: ${relativePath}`)
      return files
    }
    let entryStat
    try {
      entryStat = await lstat(path.join(siteRoot, relativePath))
    } catch (error) {
      artifactInventorySafe = false
      fail(`cannot inspect artifact entry ${relativePath}: ${error.message}`)
      continue
    }
    if (!entryStat.isDirectory() && !entryStat.isFile()) {
      artifactInventorySafe = false
      const entryType = artifactEntryType(entryStat)
      if (entryType === 'symbolic link') {
        fail(`symbolic link is not allowed: ${relativePath} (${entryType})`)
      } else {
        fail(`special artifact entry is not allowed: ${relativePath} (${entryType})`)
      }
      continue
    }

    const segments = relativePath.split('/')
    const hasForbiddenPathSegment = segments.some((segment) => forbiddenSegments.has(segment))
    if (hasForbiddenPathSegment) {
      fail(`implementation/private path leaked into artifact: ${relativePath}`)
    }
    const isVerifiedViteManifestPath = relativePath === 'community/.vite'
      || relativePath === 'community/.vite/manifest.json'
    if (!hasForbiddenPathSegment && entry.name.startsWith('.') && !allowedDotfiles.has(entry.name) && !isVerifiedViteManifestPath) {
      const kind = entryStat.isDirectory() ? 'path' : 'file'
      fail(`implementation/private ${kind} leaked into artifact: ${relativePath}`)
    } else if (forbiddenNames.some((pattern) => pattern.test(entry.name))) {
      fail(`implementation/private file leaked into artifact: ${relativePath}`)
    }
    if (forbiddenCommunityOperationsNames.has(entry.name)) {
      fail(`community operations source leaked into artifact: ${relativePath}`)
    }

    if (entryStat.isDirectory()) {
      files.push(...await walk(relativePath, traversal, depth + 1))
    } else {
      files.push(relativePath)
    }
  }
  return files
}

async function assertDuplicateBenefitsRootAbsent() {
  const communityPath = path.join(siteRoot, 'community')
  let communityStat
  try {
    communityStat = await lstat(communityPath)
  } catch (error) {
    if (error.code !== 'ENOENT') fail(`cannot inspect community for duplicate benefits-root path: ${error.message}`)
    return
  }
  if (!communityStat.isDirectory() || communityStat.isSymbolicLink()) return

  try {
    await lstat(path.join(communityPath, 'benefits-root'))
    fail('community/benefits-root duplicate path must be absent')
  } catch (error) {
    if (error.code !== 'ENOENT') fail(`cannot inspect community/benefits-root duplicate path: ${error.message}`)
  }
}

async function canonicalBenefitsEntry(document, relativePath) {
  if (document.error) {
    fail(`${relativePath} must contain exactly one executable external Vite module entry in a valid document head or body`)
    return null
  }
  const scripts = document.scriptTags ?? []
  if (scripts.length !== 1) {
    fail(`${relativePath} must contain exactly one executable external Vite module entry (found ${scripts.length} script tags)`)
    return null
  }

  const allowedAttributes = new Set(['type', 'src', 'crossorigin'])
  for (const { attributes, selfClosing } of scripts) {
    const type = attributes.get('type')
    const src = attributes.get('src')
    const crossorigin = attributes.get('crossorigin')
    const attributesAllowed = [...attributes.keys()].every((name) => allowedAttributes.has(name))
    const crossoriginAllowed = !attributes.has('crossorigin')
      || crossorigin === null
      || crossorigin === ''
      || crossorigin?.toLowerCase() === 'anonymous'
    const validSrc = typeof src === 'string'
      && /^\/community\/assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.js$/.test(src)
    if (selfClosing
        || type?.toLowerCase() !== 'module'
        || !validSrc
        || !attributesAllowed
        || !crossoriginAllowed) {
      fail(`${relativePath} must contain exactly one executable external Vite module entry with allowlisted attributes and a hashed /community/assets/*.js src`)
      return null
    }
    const assetRelativePath = src.slice(1)
    const assetPath = path.resolve(siteRoot, assetRelativePath)
    if (!assetPath.startsWith(`${siteRoot}${path.sep}`)) {
      fail(`${relativePath} canonical benefits entry escapes the bound site root: ${src}`)
      return null
    }
    try {
      const entryStat = await lstat(assetPath)
      if (!entryStat.isFile() || entryStat.isSymbolicLink()) throw new Error('not a regular file')
    } catch {
      fail(`${relativePath} canonical benefits entry is not a regular non-symlink file: ${src}`)
      return null
    }
    if (!/^\/community\/assets\/benefits-main-[A-Za-z0-9_-]{8,}\.js$/.test(src)) {
      fail(`${relativePath} must contain exactly one executable external Vite module entry (found 0)`)
      return null
    }
    return { entry: src }
  }
  return null
}

function parseJsonRejectingDuplicateKeys(text) {
  let position = 0
  const whitespace = /[\t\n\r ]/
  const skipWhitespace = () => {
    while (whitespace.test(text[position] ?? '')) position += 1
  }
  const parseString = () => {
    const start = position
    if (text[position] !== '"') throw new SyntaxError('expected JSON string')
    position += 1
    while (position < text.length) {
      const character = text[position]
      if (character === '"') {
        position += 1
        return JSON.parse(text.slice(start, position))
      }
      if (character === '\\') {
        position += 2
      } else {
        position += 1
      }
    }
    throw new SyntaxError('unterminated JSON string')
  }
  const parseValue = () => {
    skipWhitespace()
    if (text[position] === '{') return parseObject()
    if (text[position] === '[') return parseArray()
    if (text[position] === '"') {
      parseString()
      return
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(position))
    if (!match) throw new SyntaxError('invalid JSON value')
    position += match[0].length
  }
  const parseObject = () => {
    position += 1
    skipWhitespace()
    const keys = new Set()
    if (text[position] === '}') {
      position += 1
      return
    }
    while (position < text.length) {
      const key = parseString()
      if (keys.has(key)) throw new SyntaxError(`duplicate JSON key ${JSON.stringify(key)}`)
      keys.add(key)
      skipWhitespace()
      if (text[position] !== ':') throw new SyntaxError('expected JSON object colon')
      position += 1
      parseValue()
      skipWhitespace()
      if (text[position] === '}') {
        position += 1
        return
      }
      if (text[position] !== ',') throw new SyntaxError('expected JSON object separator')
      position += 1
      skipWhitespace()
    }
    throw new SyntaxError('unterminated JSON object')
  }
  const parseArray = () => {
    position += 1
    skipWhitespace()
    if (text[position] === ']') {
      position += 1
      return
    }
    while (position < text.length) {
      parseValue()
      skipWhitespace()
      if (text[position] === ']') {
        position += 1
        return
      }
      if (text[position] !== ',') throw new SyntaxError('expected JSON array separator')
      position += 1
    }
    throw new SyntaxError('unterminated JSON array')
  }

  parseValue()
  skipWhitespace()
  if (position !== text.length) throw new SyntaxError('unexpected trailing JSON content')
  return JSON.parse(text)
}

async function readBoundedRegularFile(relativePath, maximumBytes) {
  const absolutePath = path.join(siteRoot, relativePath)
  let handle
  try {
    handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW)
    const fileStat = await handle.stat()
    if (!fileStat.isFile() || fileStat.size < 1 || fileStat.size > maximumBytes) {
      throw new Error('not a nonempty bounded regular file')
    }
    const buffer = Buffer.alloc(maximumBytes + 1)
    let bytesRead = 0
    while (bytesRead < buffer.length) {
      const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, null)
      if (result.bytesRead === 0) break
      bytesRead += result.bytesRead
    }
    if (bytesRead < 1 || bytesRead > maximumBytes) throw new Error('not a nonempty bounded regular file')
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle?.close()
  }
}

const MAX_MANIFEST_RECORDS = 4_096
const MAX_MANIFEST_IMPORTS = 256
const MAX_MANIFEST_STRING_LENGTH = 1_024
const SAFE_EAGER_JS_PATH = /^assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.js$/
const EAGER_BENEFITS_ROLES = new Map([
  ['benefits-main', {
    key: /^_benefits-main-([A-Za-z0-9_-]{8,})\.js$/,
    file: /^assets\/benefits-main-([A-Za-z0-9_-]{8,})\.js$/,
    imports: new Set(['benefits', 'react', 'jsx-runtime']),
  }],
  ['benefits', {
    key: /^_benefits-([A-Za-z0-9_-]{8,})\.js$/,
    file: /^assets\/benefits-([A-Za-z0-9_-]{8,})\.js$/,
    imports: new Set(['react', 'jsx-runtime']),
  }],
  ['react', {
    key: /^_react-([A-Za-z0-9_-]{8,})\.js$/,
    file: /^assets\/react-([A-Za-z0-9_-]{8,})\.js$/,
    imports: new Set(['jsx-runtime']),
  }],
  ['jsx-runtime', {
    key: /^_jsx-runtime-([A-Za-z0-9_-]{8,})\.js$/,
    file: /^assets\/jsx-runtime-([A-Za-z0-9_-]{8,})\.js$/,
    imports: new Set(),
  }],
])

function assertEagerRoleRecord(key, record) {
  const descriptor = EAGER_BENEFITS_ROLES.get(record.name)
  if (!descriptor) {
    throw new Error(`eager import record ${JSON.stringify(key)} does not match an allowed eager role descriptor`)
  }
  const keyMatch = descriptor.key.exec(key)
  const fileMatch = typeof record.file === 'string' ? descriptor.file.exec(record.file) : null
  if (!keyMatch || !fileMatch || keyMatch[1] !== fileMatch[1]) {
    throw new Error(`eager import record ${JSON.stringify(key)} does not match the ${JSON.stringify(record.name)} role descriptor`)
  }
  for (const field of ['src', 'isEntry', 'isDynamicEntry']) {
    if (Object.hasOwn(record, field)) {
      throw new Error(`eager import record ${JSON.stringify(key)} has forbidden field ${field}`)
    }
  }
  return descriptor
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every(value => right.has(value))
}

function preflightManifest(manifest, relativePath) {
  const keys = Object.keys(manifest)
  if (keys.length > MAX_MANIFEST_RECORDS) {
    throw new Error(`has too many records (maximum ${MAX_MANIFEST_RECORDS})`)
  }
  for (const key of keys) {
    if (key.length < 1 || key.length > MAX_MANIFEST_STRING_LENGTH) {
      throw new Error('manifest key is not a bounded nonempty string')
    }
    const record = manifest[key]
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue
    for (const field of ['file', 'name', 'src']) {
      if (record[field] !== undefined
          && (typeof record[field] !== 'string' || record[field].length < 1 || record[field].length > MAX_MANIFEST_STRING_LENGTH)) {
        throw new Error(`${key} ${field} must be a bounded nonempty string`)
      }
    }
    for (const field of ['imports', 'dynamicImports']) {
      const imports = record[field]
      if (imports === undefined) continue
      if (!Array.isArray(imports) || imports.length > MAX_MANIFEST_IMPORTS) {
        throw new Error(`${key} ${field} must be a bounded array (maximum ${MAX_MANIFEST_IMPORTS})`)
      }
      if (imports.some((importKey) => typeof importKey !== 'string'
          || importKey.length < 1
          || importKey.length > MAX_MANIFEST_STRING_LENGTH)) {
        throw new Error(`${key} ${field} must contain bounded nonempty string keys`)
      }
    }
  }
  return keys
}

async function verifyEagerBenefitsGraph(manifest, entryKey, relativePath) {
  const visiting = new Set()
  const visited = new Set()
  const fileOwners = new Map()
  const roleOwners = new Map()
  const roleDescriptors = new Map()
  const communityRoot = path.resolve(siteRoot, 'community')

  const visit = async (key) => {
    if (visiting.has(key)) throw new Error(`contains an eager import cycle at ${JSON.stringify(key)}`)
    if (visited.has(key)) return
    if (!Object.hasOwn(manifest, key)) throw new Error(`references missing eager import record ${JSON.stringify(key)}`)
    const record = manifest[key]
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error(`eager import record ${JSON.stringify(key)} must be an object`)
    }
    if (typeof record.file !== 'string') {
      throw new Error(`eager import record ${JSON.stringify(key)} is missing a file`)
    }
    if (!SAFE_EAGER_JS_PATH.test(record.file)) {
      throw new Error(`eager import record ${JSON.stringify(key)} has unsafe eager import file ${JSON.stringify(record.file)}`)
    }
    const descriptor = assertEagerRoleRecord(key, record)
    const priorRoleOwner = roleOwners.get(record.name)
    if (priorRoleOwner !== undefined && priorRoleOwner !== key) {
      throw new Error(`duplicate eager role ${JSON.stringify(record.name)} is claimed by ${JSON.stringify(priorRoleOwner)} and ${JSON.stringify(key)}`)
    }
    roleOwners.set(record.name, key)
    roleDescriptors.set(record.name, descriptor)

    const priorOwner = fileOwners.get(record.file)
    if (priorOwner !== undefined && priorOwner !== key) {
      throw new Error(`conflicting eager records ${JSON.stringify(priorOwner)} and ${JSON.stringify(key)} claim file ${JSON.stringify(record.file)}`)
    }
    fileOwners.set(record.file, key)

    const assembledPath = path.resolve(communityRoot, record.file)
    if (!assembledPath.startsWith(`${communityRoot}${path.sep}`)) {
      throw new Error(`eager import file escapes community/: ${JSON.stringify(record.file)}`)
    }
    try {
      const fileStat = await lstat(assembledPath)
      if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new Error('not regular')
    } catch {
      throw new Error(`eager import file must be present as a regular non-symlink file: community/${record.file}`)
    }

    const imports = record.imports ?? []
    if (new Set(imports).size !== imports.length) {
      throw new Error(`record ${JSON.stringify(key)} contains a duplicate eager import`)
    }
    visiting.add(key)
    for (const importKey of imports) await visit(importKey)
    visiting.delete(key)
    visited.add(key)
  }

  try {
    await visit(entryKey)
    const actualRoles = new Set(roleOwners.keys())
    const expectedRoles = new Set(EAGER_BENEFITS_ROLES.keys())
    if (!sameSet(actualRoles, expectedRoles)) {
      const missing = [...expectedRoles].filter(role => !actualRoles.has(role))
      const extra = [...actualRoles].filter(role => !expectedRoles.has(role))
      throw new Error(`canonical eager closure roles differ (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`)
    }
    for (const [role, key] of roleOwners) {
      const imports = manifest[key].imports ?? []
      const importedRoles = new Set(imports.map(importKey => manifest[importKey].name))
      const expectedImports = roleDescriptors.get(role).imports
      if (!sameSet(importedRoles, expectedImports)) {
        throw new Error(`canonical eager role graph has invalid direct imports for ${JSON.stringify(role)}`)
      }
    }
  } catch (error) {
    fail(`${relativePath} ${error.message}`)
  }
}

async function verifyCanonicalBenefitsManifest(canonicalEntries) {
  const relativePath = 'community/.vite/manifest.json'
  let manifestText
  try {
    manifestText = await readBoundedRegularFile(relativePath, 1024 * 1024)
  } catch (error) {
    if (error.code === 'ENOENT') {
      fail(`${relativePath} assembled Vite manifest is required for canonical benefits verification`)
      return
    }
    fail(`${relativePath} must be a bounded regular non-symlink file`)
    return
  }

  let manifest
  try {
    if (manifestText.trim() === '') throw new SyntaxError('empty JSON document')
    manifest = parseJsonRejectingDuplicateKeys(manifestText)
  } catch (error) {
    fail(`${relativePath} is not valid JSON: ${error.message}`)
    return
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail(`${relativePath} must contain a Vite manifest object`)
    return
  }
  let manifestKeys
  try {
    manifestKeys = preflightManifest(manifest, relativePath)
  } catch (error) {
    fail(`${relativePath} ${error.message}`)
    return
  }
  const matches = manifestKeys.filter((key) => {
    const value = manifest[key]
    return value && typeof value === 'object' && !Array.isArray(value) && value.name === 'benefits-main'
  })
  if (matches.length !== 1) {
    fail(`${relativePath} must contain exactly one Vite record named benefits-main`)
    return
  }
  const entryKey = matches[0]
  const record = manifest[entryKey]
  if (typeof record.name !== 'string'
      || typeof record.file !== 'string'
      || !/^assets\/benefits-main-[A-Za-z0-9_-]{8,}\.js$/.test(record.file)) {
    fail(`${relativePath} benefits-main record has invalid required fields or unsafe file path`)
    return
  }
  const manifestEntry = `/community/${record.file}`
  if (canonicalEntries.some(({ entry }) => entry !== manifestEntry)) {
    fail(`${relativePath} benefits-main record must bind both canonical public entry scripts exactly`)
  }
  await verifyEagerBenefitsGraph(manifest, entryKey, relativePath)
}

async function main() {
  const rootStat = await stat('')
  if (!rootStat?.isDirectory()) {
    artifactInventorySafe = false
    fail(`site artifact is not a directory: ${siteRoot}`)
  }

  if (rootStat?.isDirectory()) await assertDuplicateBenefitsRootAbsent()

  for (const relativePath of requiredFiles) {
    const fileStat = await stat(relativePath)
    if (fileStat && !fileStat.isFile()) {
      fail(`required artifact is not a regular file: ${relativePath}`)
    }
  }

  const files = rootStat?.isDirectory() ? await walk() : []
  if (!artifactInventorySafe) {
    console.error(`Site verification failed with ${errors.length} error(s):`)
    for (const error of errors) console.error(`- ${error}`)
    process.exitCode = 1
    return
  }
  for (const relativePath of files) {
    if (/^community\/assets\/.+\.(?:js|css)$/i.test(relativePath) && !isContentHashedAsset(relativePath)) {
      fail(`community JS/CSS asset lacks a Vite-style content-hashed filename: ${relativePath}`)
    }
  }

  const cname = (await readText('CNAME')).trim()
  if (cname !== 'www.breadlab.ai') {
    fail(`CNAME must contain only www.breadlab.ai (received ${JSON.stringify(cname)})`)
  }

  const routeChecks = [
    ['index.html', 'Ria & Seoa PaPa – 수익실험실', 'https://www.breadlab.ai/'],
    ['blog/index.html', 'Blog – Ria & Seoa PaPa', 'https://www.breadlab.ai/blog/'],
    ['lab/index.html', '수익실험실 – Ria & Seoa PaPa', 'https://www.breadlab.ai/lab/'],
    [
      'blog/ceph-cluster-install-with-helm.html',
      '[Kubernets] Ceph Cluster install with helm – Ria & Seoa PaPa',
      'https://www.breadlab.ai/blog/ceph-cluster-install-with-helm',
    ],
    ['404.html', 'Page Not Found – Ria & Seoa PaPa', 'https://www.breadlab.ai/404.html'],
    ['community/benefits/directory/index.html', '국내 기업 검색 · Benefit Atlas', 'https://www.breadlab.ai/community/benefits/directory/'],
    ['benefits/index.html', '기업 복지 검색 · Breadlab', 'https://breadlab.ai/benefits/'],
    ['benefits/company/index.html', '기업 복지 상세 · Breadlab', 'https://breadlab.ai/benefits/company/'],
  ]
  for (const [relativePath, expectedTitle, canonical] of routeChecks) {
    const html = await readText(relativePath)
    const documentTitle = extractDocumentTitle(html)
    if (documentTitle.error === 'unclosed-title') {
      fail(`${relativePath} document title must have a proper closing tag`)
    } else if (documentTitle.error === 'html') {
      fail(`${relativePath} must contain exactly one explicit, properly closed document html element`)
    } else if (documentTitle.error === 'head') {
      fail(`${relativePath} must contain exactly one explicit, properly closed document head`)
    } else if (documentTitle.error === 'body') {
      fail(`${relativePath} must contain exactly one explicit, properly closed document body`)
    } else if (documentTitle.error === 'title-outside-head') {
      fail(`${relativePath} document title tags must appear only inside the explicit document head`)
    } else if (documentTitle.titles.length !== 1) {
      fail(`${relativePath} must contain exactly one document title in head (found ${documentTitle.titles.length})`)
    } else if (documentTitle.titles[0] !== expectedTitle) {
      fail(`${relativePath} has unexpected document title: ${JSON.stringify(documentTitle.titles[0])} (expected ${JSON.stringify(expectedTitle)})`)
    }
    if (documentTitle.canonicalLinks.length !== 1 || documentTitle.canonicalLinks[0] !== canonical) {
      fail(`${relativePath} is missing canonical URL in the document head`)
    }
  }
  const home = await readText('index.html')
  if (!hasCommunityAjaxOptOut(home)) {
    fail('index.html Community navigation link must include the js-no-ajax class')
  }
  if (!hasBenefitsAjaxOptOut(home)) {
    fail('index.html 기업 복지 navigation link must include the js-no-ajax class in the actual menu')
  }
  const canonicalEntries = []
  for (const relativePath of ['benefits/index.html', 'benefits/company/index.html']) {
    const html = await readText(relativePath)
    assertIncludes(html, '<div id="app"></div>', relativePath, 'public React mount')
    const document = extractDocumentTitle(html)
    canonicalEntries.push(await canonicalBenefitsEntry(document, relativePath))
    if (/\/(?:src|node_modules)\//.test(html)) fail(`${relativePath} references implementation source`)
    if (/AuthProvider|supabase|benefit(?:Submission|Correction)|admin/i.test(html)) {
      fail(`${relativePath} contains an auth/private bundle marker`)
    }
  }
  if (canonicalEntries.every(Boolean) && new Set(canonicalEntries.map(({ entry }) => entry)).size !== 1) {
    fail('canonical benefits shells must use the same public entry asset')
  } else if (canonicalEntries.every(Boolean)) {
    await verifyCanonicalBenefitsManifest(canonicalEntries)
  }

  const privacyPath = files.includes('privacy.html')
    ? 'privacy.html'
    : files.includes('privacy/index.html')
      ? 'privacy/index.html'
      : null
  if (!privacyPath) {
    fail('missing required artifact: privacy.html (or privacy/index.html)')
  } else {
    const privacy = await readText(privacyPath)
    assertIncludes(privacy, '<title>개인정보처리방침 – Ria & Seoa PaPa</title>', privacyPath, 'expected title')
    assertIncludes(privacy, '<link rel="canonical" href="https://www.breadlab.ai/privacy">', privacyPath, 'canonical URL')
    assertIncludes(privacy, '커뮤니티 Google OAuth 로그인', privacyPath, 'Google community OAuth disclosure')
    assertIncludes(privacy, 'Supabase Auth', privacyPath, 'Supabase Auth processor disclosure')
    assertIncludes(privacy, '안정적인 provider subject', privacyPath, 'stable provider subject disclosure')
    assertIncludes(privacy, '인증 계층에서만', privacyPath, 'auth-layer-only provider subject use')
    assertIncludes(privacy, '개인정보가 아닌 결정적 로그인 이름', privacyPath, 'deterministic non-PII login disclosure')
    assertIncludes(privacy, '최대 120자의 Google 표시 이름', privacyPath, 'bounded Google display name disclosure')
    assertIncludes(privacy, '최대 2,048자의 HTTPS 프로필 이미지 URL', privacyPath, 'bounded Google avatar URL disclosure')
    assertIncludes(privacy, '사용자 ID와 로그인 세션', privacyPath, 'user and session identifier disclosure')
    assertIncludes(privacy, '이메일과 provider access token 또는 refresh token은 공개 프로필에 저장하지 않습니다', privacyPath, 'public-profile email and provider-token exclusion')
    if (/커뮤니티.{0,80}(?:GitHub OAuth|GitHub 계정.{0,30}(?:로그인|식별))/is.test(privacy)) {
      fail(`${privacyPath} contains obsolete GitHub community authentication disclosure`)
    }
    assertIncludes(privacy, '처리 완료 후 최대 3년', privacyPath, 'report retention disclosure')
  }

  for (const [part,title] of [['','복지 현황'],['fit/','조건 탐색'],['company/','기업 근거 상세'],['methodology/','조사 기준·정정 이력']]) {
    const relativePath=`community/benefits/${part}index.html`
    const html=await readText(relativePath)
    assertIncludes(html,`<title>${title} · Benefit Atlas</title>`,relativePath,'expected title')
    assertIncludes(html,`<link rel="canonical" href="https://www.breadlab.ai/community/benefits/${part}">`,relativePath,'canonical URL')
    assertIncludes(html,'<meta name="description" content="',relativePath,'description')
    if (/예시 데이터|가상 검증기업|fixture-v1/.test(html)) fail(`${relativePath} contains fixture disclosure`)
    if(!communityAssetReferences(html,relativePath).length)fail(`${relativePath} missing compiled assets`)
    if(/\/(?:src|node_modules)\//.test(html))fail(`${relativePath} references implementation source`)
  }
  // Research is separately verified; the base verifier reads the original root.
  const releaseRoot = path.join(siteRoot, 'community/data/company-benefits')
  const baseManifest = path.join(releaseRoot, 'manifest.json')
  let hasBase = false
  try { await lstat(baseManifest); hasBase = true } catch (error) { if (error.code !== 'ENOENT') fail(`research artifacts: ${error.message}`) }
  if (hasBase) {
    try { console.log(await verifyBenefitsResearchArtifacts(siteRoot)) } catch (error) { fail(`research artifacts: ${error.message}`) }
    try { console.log(await verifyDomesticDirectoryArtifacts(siteRoot)) } catch (error) { fail(`directory artifacts: ${error.message}`) }
    try { console.log(await verifyDomesticSizeArtifacts(siteRoot)) } catch (error) { fail(`size artifacts: ${error.message}`) }
    try { console.log(await verifyDomesticSearchIndex(siteRoot)) } catch (error) { fail(`search index artifacts: ${error.message}`) }
  }
  try { console.log(await verifyBenefitsArtifacts(siteRoot, { allowResearchSibling: hasBase, allowDirectorySibling: hasBase, allowSizeSibling: hasBase, allowSearchIndexSibling: hasBase })) } catch(error) { fail(`benefits artifacts: ${error.message}`) }
  const communityShells = [
    ['community/index.html', '<title>Community · Ria &amp; Seoa PaPa</title>'],
    ['community/write/index.html', '<title>글쓰기 · Ria &amp; Seoa PaPa</title>'],
    ['community/post/index.html', '<title>게시글 · Ria &amp; Seoa PaPa</title>'],
    ['community/edit/index.html', '<title>글 수정 · Ria &amp; Seoa PaPa</title>'],
    ['community/admin/reports/index.html', '<title>신고 관리 · Ria &amp; Seoa PaPa</title>'],
    ['community/auth/callback/index.html', '<title>로그인 처리 · Ria &amp; Seoa PaPa</title>'],
    ['community/benefits/correction/index.html', '<title>복지 정보 수정 요청 · Ria &amp; Seoa PaPa</title>'],
    ['community/benefits/my-corrections/index.html', '<title>내 복지 수정 요청 · Ria &amp; Seoa PaPa</title>'],
  ]
  for (const [relativePath, title] of communityShells) {
    const html = await readText(relativePath)
    assertIncludes(html, title, relativePath, 'expected title')
    const assetReferences = communityAssetReferences(html, relativePath)
    if (assetReferences.length === 0) {
      fail(`${relativePath} does not reference a built /community/assets/ file`)
    }
    if (/\/(?:src|node_modules)\//.test(html)) {
      fail(`${relativePath} references implementation source`)
    }
  }
  for (const relativePath of files.filter((file) => /\.html?$/i.test(file))) {
    const html = await readText(relativePath)
    const assetReferences = communityAssetReferences(html, relativePath)
    for (const assetPath of assetReferences) {
      if (!isContentHashedAsset(assetPath)) {
        fail(`${relativePath} references an asset without a Vite-style content-hashed filename: ${assetPath}`)
      }
      if (!files.includes(assetPath.slice(1))) {
        fail(`${relativePath} references a missing community asset: ${assetPath}`)
      }
    }
  }
  if (!files.some((file) => /^community\/assets\/.+\.js$/.test(file))) {
    fail('community artifact has no compiled JavaScript asset')
  }

  const sitemap = await readText('sitemap.xml')
  const snapshotPathPattern = /^community\/content\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/index\.html$/i
  const snapshotFiles = new Map()
  for (const relativePath of files) {
    const match = snapshotPathPattern.exec(relativePath)
    if (!match) continue
    const canonical = `https://www.breadlab.ai/community/content/${match[1]}/`
    snapshotFiles.set(canonical, relativePath)
    const html = await readText(relativePath)
    assertIncludes(html, `<link rel="canonical" href="${canonical}">`, relativePath, 'snapshot canonical')
    assertIncludes(html, '<meta property="og:type" content="article">', relativePath, 'snapshot OpenGraph type')
    assertIncludes(html, `<meta property="og:url" content="${canonical}">`, relativePath, 'snapshot OpenGraph URL')
    assertIncludes(html, '<script type="application/ld+json">', relativePath, 'snapshot JSON-LD')
    assertIncludes(html, '"@type":"BlogPosting"', relativePath, 'snapshot JSON-LD type')
    assertIncludes(sitemap, `<loc>${canonical}</loc>`, 'sitemap.xml', 'community snapshot URL')
  }
  for (const match of sitemap.matchAll(/<loc>(https:\/\/www\.breadlab\.ai\/community\/content\/([0-9a-f-]+)\/)<\/loc>/gi)) {
    if (!snapshotFiles.has(match[1])) {
      fail(`missing required artifact: community/content/${match[2]}/index.html`)
    }
  }
  for (const location of [
    'https://www.breadlab.ai/',
    'https://www.breadlab.ai/blog/',
    'https://www.breadlab.ai/lab/',
    'https://www.breadlab.ai/blog/ceph-cluster-install-with-helm',
    'https://www.breadlab.ai/privacy',
    'https://breadlab.ai/benefits/',
    'https://breadlab.ai/benefits/company/',
  ]) {
    assertIncludes(sitemap, `<loc>${location}</loc>`, 'sitemap.xml', 'key route')
  }

  const robots = await readText('robots.txt')
  assertIncludes(robots, 'User-agent: *', 'robots.txt', 'crawler policy')
  assertIncludes(robots, 'Allow: /', 'robots.txt', 'crawler allow rule')
  assertIncludes(
    robots,
    'Sitemap: https://www.breadlab.ai/sitemap.xml',
    'robots.txt',
    'sitemap location',
  )

  for (const relativePath of files) {
    await scanFileForSecrets(relativePath)
  }

  if (errors.length > 0) {
    console.error(`Site verification failed with ${errors.length} error(s):`)
    for (const error of errors) console.error(`- ${error}`)
    process.exitCode = 1
    return
  }

  console.log(`Verified ${files.length} files in ${siteRoot}`)
  console.log('Required Jekyll routes, community shells, legacy benefits entries, two canonical benefits routes, artifact integrity, canonical URLs, and leak checks passed.')
}

await main()
