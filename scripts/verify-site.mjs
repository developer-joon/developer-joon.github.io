#!/usr/bin/env node

import { createReadStream } from 'node:fs'
import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const siteRoot = path.resolve(process.argv[2] ?? '_site')
const errors = []

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
]

const forbiddenSegments = new Set([
  '.github',
  '_data',
  '_includes',
  '_layouts',
  '_posts',
  'community-app',
  'docs',
  'migrations',
  'node_modules',
  'scripts',
  'src',
  'supabase',
])
const forbiddenNames = [
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
const secretPatterns = [
  /\bsb_secret_[A-Za-z0-9._-]+/,
  /\b(?:gh[opusr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bpostgres(?:ql)?:\/\/[^\s"'<>]+/i,
]

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

async function walk(relativeDirectory = '') {
  const absoluteDirectory = path.join(siteRoot, relativeDirectory)
  let entries
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true })
  } catch (error) {
    fail(`cannot inspect artifact directory ${relativeDirectory || '.'}: ${error.message}`)
    return []
  }

  const files = []
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name)
    const entryStat = await lstat(path.join(siteRoot, relativePath))
    if (entryStat.isSymbolicLink()) {
      fail(`symbolic link is not allowed: ${relativePath}`)
      continue
    }

    const segments = relativePath.split('/')
    if (segments.some((segment) => forbiddenSegments.has(segment))) {
      fail(`implementation/private path leaked into artifact: ${relativePath}`)
    }
    if (forbiddenNames.some((pattern) => pattern.test(entry.name))) {
      fail(`implementation/private file leaked into artifact: ${relativePath}`)
    }

    if (entryStat.isDirectory()) {
      files.push(...await walk(relativePath))
    } else if (entryStat.isFile()) {
      files.push(relativePath)
    }
  }
  return files
}

async function main() {
  const rootStat = await stat('')
  if (!rootStat?.isDirectory()) {
    fail(`site artifact is not a directory: ${siteRoot}`)
  }

  for (const relativePath of requiredFiles) {
    const fileStat = await stat(relativePath)
    if (fileStat && !fileStat.isFile()) {
      fail(`required artifact is not a regular file: ${relativePath}`)
    }
  }

  const files = rootStat?.isDirectory() ? await walk() : []
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
    ['index.html', '<title>Ria & Seoa PaPa – 0 → 1</title>', 'https://www.breadlab.ai/'],
    ['blog/index.html', '<title>Blog – Ria & Seoa PaPa</title>', 'https://www.breadlab.ai/blog/'],
    ['lab/index.html', '<title>0 → 1 – Ria & Seoa PaPa</title>', 'https://www.breadlab.ai/lab/'],
    [
      'blog/ceph-cluster-install-with-helm.html',
      '<title>[Kubernets] Ceph Cluster install with helm – Ria & Seoa PaPa</title>',
      'https://www.breadlab.ai/blog/ceph-cluster-install-with-helm',
    ],
    ['404.html', '<title>Page Not Found – Ria & Seoa PaPa</title>', 'https://www.breadlab.ai/404.html'],
  ]
  for (const [relativePath, expectedTitle, canonical] of routeChecks) {
    const html = await readText(relativePath)
    assertIncludes(html, expectedTitle, relativePath, 'expected title')
    assertIncludes(html, `<link rel="canonical" href="${canonical}">`, relativePath, 'canonical URL')
  }
  const home = await readText('index.html')
  if (!/<a href="\/community\/"[^>]*>Community<\/a>/.test(home)) {
    fail('index.html is missing the Community navigation link')
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
    assertIncludes(privacy, 'GitHub OAuth', privacyPath, 'GitHub OAuth privacy disclosure')
    assertIncludes(privacy, '처리 완료 후 최대 3년', privacyPath, 'report retention disclosure')
  }

  const communityShells = [
    ['community/index.html', '<title>Breadlab 커뮤니티</title>'],
    ['community/write/index.html', '<title>글쓰기 | Breadlab 커뮤니티</title>'],
    ['community/post/index.html', '<title>게시글 | Breadlab 커뮤니티</title>'],
    ['community/edit/index.html', '<title>글 수정 | Breadlab 커뮤니티</title>'],
    ['community/admin/reports/index.html', '<title>신고 관리 | Breadlab 커뮤니티</title>'],
    ['community/auth/callback/index.html', '<title>로그인 처리 | Breadlab 커뮤니티</title>'],
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
  for (const location of [
    'https://www.breadlab.ai/',
    'https://www.breadlab.ai/blog/',
    'https://www.breadlab.ai/lab/',
    'https://www.breadlab.ai/blog/ceph-cluster-install-with-helm',
    'https://www.breadlab.ai/privacy',
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
  console.log('Required Jekyll routes, six community shells, canonical URLs, and leak checks passed.')
}

await main()
