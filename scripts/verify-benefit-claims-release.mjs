#!/usr/bin/env node

import { constants } from 'node:fs'
import { lstat, open, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  decodeBenefitCompanyDetailV2,
  decodeBenefitDirectoryPage,
} from '../community-app/src/data/benefitDirectoryRepository.ts'

const DEFAULT_SCAN_LIMITS = Object.freeze({
  maxFileBytes: 32 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  maxFiles: 10_000,
  maxDepth: 32,
})
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules'])
const SECRET_NAMES = '(?:NTS_SERVICE_KEY|BUSINESS_NUMBER_HMAC_SECRET|SUPABASE_SERVICE_ROLE_KEY)'
const SECRET_KEY = `(?:\\[\\s*["']${SECRET_NAMES}["']\\s*\\]|["']${SECRET_NAMES}["']|${SECRET_NAMES})`
const SENSITIVE_PATTERNS = [
  { label: 'representative name', pattern: /(?:representative_name|representativeName|대표자(?:명)?)\s*["']?\s*[:=]\s*["'][^\s"'`,}\]]{2,}/iu },
  { label: 'opening date', pattern: /(?:opening_date|openingDate|개업일자)\s*["']?\s*[:=]\s*["']\d{8}/iu },
  { label: 'raw business number', pattern: /(?:(?<![A-Za-z0-9-])\d{3}-\d{2}-\d{5}(?![A-Za-z0-9-])|(?:business_number|businessNumber|사업자등록번호)\s*["']?\s*[:=]\s*["']?\d{10})/iu },
  { label: 'secret assignment', pattern: new RegExp(`${SECRET_KEY}\\s*[:=]\\s*["']?(?![\\s"']*(?:process\\.env|Deno\\.env|getEnv|\\$\\{|<|\\*{3}|redacted))[A-Za-z0-9._~+\\/-]{8,}`, 'iu') },
]

const TEMPLATE_ASSIGNMENTS = [
  { label: 'representative name', names: ['representative_name', 'representativeName', '대표자', '대표자명'] },
  { label: 'opening date', names: ['opening_date', 'openingDate', '개업일자'] },
  { label: 'raw business number', names: ['business_number', 'businessNumber', '사업자등록번호'] },
  { label: 'secret assignment', names: ['NTS_SERVICE_KEY', 'BUSINESS_NUMBER_HMAC_SECRET', 'SUPABASE_SERVICE_ROLE_KEY'] },
]

function templateLiteral(text, start) {
  const segments = ['']
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index]
    if (character === '\\') {
      if (index + 1 < text.length) segments.at(-1) += text[++index]
    } else if (character === '`') {
      return { end: index + 1, segments }
    } else if (character === '$' && text[index + 1] === '{') {
      let depth = 1
      index += 2
      for (; index < text.length && depth > 0; index += 1) {
        if (text[index] === '\\') index += 1
        else if (text[index] === '{') depth += 1
        else if (text[index] === '}') depth -= 1
      }
      if (depth !== 0) return null
      index -= 1
      segments.push('')
    } else {
      segments[segments.length - 1] += character
    }
  }
  return null
}

function templateSegmentSensitive(label, segment) {
  if (label === 'opening date') return /\d{8}/u.test(segment)
  if (label === 'raw business number') return /(?:\d{3}-\d{2}-\d{5}|\d{10})/u.test(segment)
  if (label === 'representative name') return /[^\s`$,{\]}]{2,}/u.test(segment)
  return /[A-Za-z0-9._~+/-]{8,}/u.test(segment)
    && !/(?:process\.env|Deno\.env|getEnv|<|\*{3}|redacted)/iu.test(segment)
}

function * templateAssignmentFindings(text) {
  for (const { label, names } of TEMPLATE_ASSIGNMENTS) {
    const alternatives = names.map(name => name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|')
    const key = `(?:\\[\\s*["'](?:${alternatives})["']\\s*\\]|["'](?:${alternatives})["']|(?<![\\p{L}\\p{N}_])(?:${alternatives})(?![\\p{L}\\p{N}_]))\\s*[:=]\\s*`
    const matcher = new RegExp(key, 'giu')
    for (const match of text.matchAll(matcher)) {
      const valueStart = match.index + match[0].length
      if (text[valueStart] !== '`') continue
      const literal = templateLiteral(text, valueStart)
      if (literal && literal.segments.some(segment => templateSegmentSensitive(label, segment))) {
        yield { label, span: text.slice(match.index, literal.end) }
      }
    }
  }
}

// Identity-fixture exemptions are exact path + label + matched source span rules.
// Exact known-fake placeholder spans may be exempted; real-like values never are.
function fixtureSpans(encoded) {
  return new Map(Object.entries(encoded).map(([fixturePath, labels]) => [
    fixturePath,
    new Map(Object.entries(labels).map(([label, spans]) => [
      label,
      new Set(spans.map(span => Buffer.from(span, 'base64').toString('utf8'))),
    ])),
  ]))
}

const SYNTHETIC_FIXTURE_SPANS = fixtureSpans({
  'community-app/src/data/adminBenefitCompanyRequestRepository.test.ts': {
    'raw business number': ['YnVzaW5lc3NfbnVtYmVyOicxMjM0NTY3ODkw'],
  },
  'community-app/src/data/benefitCompanyRequestRepository.test.ts': {
    'representative name': ['cmVwcmVzZW50YXRpdmVOYW1lOiAn7ZmN6ri464+Z', 'cmVwcmVzZW50YXRpdmVOYW1lOiftmY3quLjrj5k='],
    'opening date': ['b3BlbmluZ0RhdGU6ICcyMDI2MDEzMQ==', 'b3BlbmluZ0RhdGU6JzIwMjAwMTAx'],
    'raw business number': ['MTIzLTQ1LTY3ODkw', 'YnVzaW5lc3NOdW1iZXI6ICcxMjM0NTY3ODkw', 'YnVzaW5lc3NOdW1iZXI6JzEyMzQ1Njc4OTA='],
  },
  'community-app/src/data/benefitParity.test.ts': {
    'representative name': ['cmVwcmVzZW50YXRpdmVOYW1lOiAn7ZmN6ri464+Z'],
    'opening date': ['b3BlbmluZ0RhdGU6ICcyMDIwMDEwMQ=='],
    'raw business number': ['YnVzaW5lc3NOdW1iZXI6ICcxMjM0NTY3ODkw'],
  },
  'community-app/src/data/benefitSessionBoundary.test.ts': {
    'representative name': ['cmVwcmVzZW50YXRpdmVOYW1lOiftmY3quLjrj5k='],
    'opening date': ['b3BlbmluZ0RhdGU6JzIwMjYwMTMx'],
    'raw business number': ['MTIzLTQ1LTY3ODkw'],
  },
  'community-app/src/lib/benefitCompanyRequestDraftStore.test.ts': {
    'representative name': ['cmVwcmVzZW50YXRpdmVOYW1lOifrr7zqsJDrjIDtkZw='],
    'opening date': ['b3BlbmluZ0RhdGU6JzIwMjAwMTAx'],
    'raw business number': ['YnVzaW5lc3NOdW1iZXI6JzEyMzQ1Njc4OTA='],
  },
  'scripts/test_domestic_company_directory.py': {
    'raw business number': ['MDAwLTAwLTAwMDAy'],
  },
  'scripts/verify-benefit-claims-release.test.mjs': {
    'representative name': ['cmVwcmVzZW50YXRpdmVfbmFtZSI6Iu2Zjeq4uOuPmQ==', 'cmVwcmVzZW50YXRpdmVfbmFtZToi64uk66W464yA7ZGc', 'cmVwcmVzZW50YXRpdmVfbmFtZToi7YWM7Iqk7Yq464yA7ZGc', 'cmVwcmVzZW50YXRpdmVfbmFtZT0i7ZmN6ri464+Z'],
    'opening date': ['b3BlbmluZ19kYXRlIjoiMjAyNjAxMDI=', 'b3BlbmluZ19kYXRlOiIyMDI1MTIzMQ==', 'b3BlbmluZ19kYXRlOiIyMDI2MDEwMg=='],
    'raw business number': ['MTIzLTQ1LTY3ODkw', 'OTk5LTg4LTc3Nzc3'],
    'secret assignment': ['U1VQQUJBU0VfU0VSVklDRV9ST0xFX0tFWTogInRlc3Qtb25seS1wbGFjZWhvbGRlcg=='],
  },
  'scripts/community-snapshots.test.mjs': {
    'secret assignment': ['U1VQQUJBU0VfU0VSVklDRV9ST0xFX0tFWTogJ3Rlc3Qtb25seS1wbGFjZWhvbGRlcg=='],
  },
  'scripts/release-gate.test.mjs': {
    'secret assignment': ['c3VwYWJhc2Vfc2VydmljZV9yb2xlX2tleTogJ3Rvby1zaG9ydA=='],
  },
  'scripts/tests/test_generate_company_benefits_artifacts.py': {
    'raw business number': ['MTIzLTQ1LTY3ODkw', '7IKs7JeF7J6Q65Ox66Gd67KI7Zi4OiAxMjM0NTY3ODkw'],
  },
  'supabase/functions/verify-benefit-company/index.test.ts': {
    'representative name': ['cmVwcmVzZW50YXRpdmVfbmFtZToi7YWM7Iqk7Yq464yA7ZGc', 'cmVwcmVzZW50YXRpdmVOYW1lIjoiJHtSRVBSRVNFTlRBVElWRQ==', 'cmVwcmVzZW50YXRpdmVOYW1lOiAi66+86rCQXG7rjIDtkZw='],
    'opening date': ['b3BlbmluZ19kYXRlOiIyMDI2MDEwMg==', 'T1BFTklOR19EQVRFID0gIjIwMjAwMTAy', 'b3BlbmluZ0RhdGU6ICIyMDIzMDIyOQ=='],
    'raw business number': ['MTIzLTQ1LTY3ODkw'],
    'secret assignment': ['U1VQQUJBU0VfU0VSVklDRV9ST0xFX0tFWTogInRlc3Qtb25seS1wbGFjZWhvbGRlcg==', 'QlVTSU5FU1NfTlVNQkVSX0hNQUNfU0VDUkVUOiAidG9vLXNob3J0'],
  },
})

function normalizedRelative(relativePath) {
  return relativePath.split(path.sep).join('/')
}

function sensitiveSpanAllowed(relativePath, label, span) {
  const normalized = normalizedRelative(relativePath)
  return SYNTHETIC_FIXTURE_SPANS.get(normalized)?.get(label)?.has(span) === true
}

async function regularFiles(root, limits, relative = '', inventory = { files: [], totalBytes: 0 }) {
  const depth = relative === '' ? 0 : relative.split(path.sep).length
  if (depth > limits.maxDepth) throw new Error(`sensitive scan path depth exceeds inventory limit: ${relative}`)
  const entries = await readdir(path.join(root, relative), { withFileTypes: true })
  for (const entry of entries) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue
    const child = path.join(relative, entry.name)
    const childDepth = child.split(path.sep).length
    if (childDepth > limits.maxDepth) throw new Error(`sensitive scan path depth exceeds inventory limit: ${child}`)
    const stat = await lstat(path.join(root, child))
    if (stat.isSymbolicLink()) throw new Error(`sensitive scan rejects symbolic link: ${child}`)
    if (stat.isDirectory()) {
      await regularFiles(root, limits, child, inventory)
    } else if (stat.isFile()) {
      if (stat.size > limits.maxFileBytes) throw new Error(`sensitive scan file exceeds byte limit: ${child}`)
      inventory.files.push(child)
      inventory.totalBytes += stat.size
      if (inventory.files.length > limits.maxFiles) throw new Error('sensitive scan file count exceeds inventory limit')
      if (inventory.totalBytes > limits.maxTotalBytes) throw new Error('sensitive scan total bytes exceed inventory limit')
    } else {
      throw new Error(`sensitive scan rejects non-regular file: ${child}`)
    }
  }
  return inventory.files
}

async function readBounded(filePath, maxFileBytes) {
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > maxFileBytes) throw new Error(`sensitive scan file exceeds byte limit: ${filePath}`)
    const bytes = Buffer.alloc(stat.size)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, null)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset !== bytes.length) throw new Error(`sensitive scan file changed during read: ${filePath}`)
    return bytes
  } finally {
    await handle.close()
  }
}

function decodedViews(bytes) {
  const even = bytes.subarray(0, bytes.length - (bytes.length % 2))
  const swapped = Buffer.from(even)
  swapped.swap16()
  return [bytes.toString('utf8'), even.toString('utf16le'), swapped.toString('utf16le')]
}

export async function scanSensitiveReleaseFiles(repoRoot, overrides = {}) {
  const root = path.resolve(repoRoot)
  const limits = { ...DEFAULT_SCAN_LIMITS, ...overrides }
  const rootStat = await lstat(root)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('sensitive scan root must be a regular directory')
  const targets = await regularFiles(root, limits)
  for (const relativePath of targets) {
    const bytes = await readBounded(path.join(root, relativePath), limits.maxFileBytes)
    for (const text of decodedViews(bytes)) {
      for (const { label, pattern } of SENSITIVE_PATTERNS) {
        const matcher = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
        for (const match of text.matchAll(matcher)) {
          if (!sensitiveSpanAllowed(relativePath, label, match[0])) {
            throw new Error(`${label} leaked outside an exact approved source span: ${relativePath}`)
          }
        }
      }
      for (const { label, span } of templateAssignmentFindings(text)) {
        if (!sensitiveSpanAllowed(relativePath, label, span)) {
          throw new Error(`${label} leaked outside an exact approved source span: ${relativePath}`)
        }
      }
    }
  }
  return { checkedFiles: targets.length }
}

async function requireText(root, relativePath, patterns) {
  const absolute = path.join(root, relativePath)
  const stat = await lstat(absolute)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`required release contract is not a regular file: ${relativePath}`)
  const text = await readFile(absolute, 'utf8')
  for (const pattern of patterns) {
    if (!pattern.test(text)) throw new Error(`release contract mismatch in ${relativePath}: ${pattern}`)
  }
}

function expectDecoderRejection(decode, value, label) {
  try {
    decode(value)
  } catch {
    return
  }
  throw new Error(`actual browser projection decoder accepted mutation: ${label}`)
}

export function verifyActualBrowserProjectionDecoders() {
  const companyId = 'KR-CRN-1101111111111'
  const company = {
    company_id: companyId,
    display_name: '가나다 공식',
    identity_label: '법인',
    industry: 'software',
    size_label: '대기업',
    region: '서울',
    summary: '공식 기업',
  }
  const claim = {
    claim_id: 'b2000000-0000-0000-0000-000000000001',
    category_id: 'health',
    category_name: '건강',
    title: '건강 지원',
    description: '건강 지원 설명',
    eligibility_text: null,
    condition_text: null,
    status_code: 'community_confirmed',
    status_label: '커뮤니티 확인',
    nickname: '빵친구',
    submitted_at: '2026-11-22T01:00:00.000000+00:00',
    observed_on: '2026-11-21',
    confirm_count: 3,
    dispute_count: 0,
    last_confirmation_at: '2026-11-22T02:00:00.000000+00:00',
  }
  const publication = {
    publication_id: 'b1000000-0000-0000-0000-000000000001',
    category_id: 'health',
    title: '건강검진',
    description: '연 1회 건강검진',
    eligibility_text: '재직자',
    condition_text: '회사 기준',
    trust_label: '공식 확인',
    revision: 1,
    origin_claim_id: claim.claim_id,
  }
  const detail = { company, publications: [publication], claims: [claim] }
  decodeBenefitCompanyDetailV2(detail, companyId)
  for (const [label, mutation] of [
    ['top-level unknown key', { ...detail, submitter_id: 'private' }],
    ['company private key', { ...detail, company: { ...company, provenance: 'private' } }],
    ['publication private key', { ...detail, publications: [{ ...publication, reviewer_id: 'private' }] }],
    ['publication unknown key', { ...detail, publications: [{ ...publication, source_url: 'https://private.example' }] }],
    ...['email', 'submitter_id', 'source_url', 'reviewer_id'].map(key => [
      `claim private key ${key}`,
      { ...detail, claims: [{ ...claim, [key]: 'private' }] },
    ]),
    ['201 claims', { ...detail, publications: [], claims: Array.from({ length: 201 }, (_, index) => ({ ...claim, claim_id: `b2000000-0000-0000-0000-${index.toString(16).padStart(12, '0')}` })) }],
  ]) expectDecoderRejection(value => decodeBenefitCompanyDetailV2(value, companyId), mutation, label)

  const searchItem = {
    ...company,
    benefit_count: 1,
    official_count: 1,
    community_count: 0,
    categories: ['health'],
  }
  const page = { items: [searchItem], has_more: false, next_cursor: null, total: 1 }
  const input = { pageSize: 20 }
  decodeBenefitDirectoryPage(page, input)
  expectDecoderRejection(value => decodeBenefitDirectoryPage(value, input), { ...page, source_url: 'https://private.example' }, 'listing top-level private key')
  expectDecoderRejection(value => decodeBenefitDirectoryPage(value, input), { ...page, items: [{ ...searchItem, reviewer_id: 'private' }] }, 'listing item private key')
  return 'actual-v2-detail-and-listing-decoders'
}

export async function verifyBenefitClaimsRelease(repoRoot) {
  const root = path.resolve(repoRoot)
  // These checks establish expected release inventory only. Database schema,
  // SQL projections, pgTAP, and dblink behavior are proved by test-database.
  const inventoryContracts = new Map([
    ['supabase/functions/verify-benefit-company/index.ts', [/NTS_SERVICE_KEY/, /BUSINESS_NUMBER_HMAC_SECRET/, /SUPABASE_SERVICE_ROLE_KEY/]],
    ['community-app/vite.config.ts', [/benefitsCompanyRequest/, /benefitsClaimReaction/, /adminBenefitClaims/]],
    ['community-app/benefits/company-request/index.html', [/기업 추가 요청/]],
    ['community-app/benefits/claim/index.html', [/구조화된 복지 제보/]],
    ['community-app/benefits/claim-reaction/index.html', [/복지 제보 반응/]],
    ['community-app/admin/benefit-company-requests/index.html', [/기업 추가 요청 검토/]],
    ['community-app/admin/benefit-claims/index.html', [/복지 claim 검토/]],
  ])
  for (const [relativePath, patterns] of inventoryContracts) await requireText(root, relativePath, patterns)
  const packageJson = JSON.parse(await readFile(path.join(root, 'community-app/package.json'), 'utf8'))
  if (packageJson.scripts?.['release:check'] !== 'node ../scripts/release-gate.mjs') throw new Error('release:check must thin-forward to the root release gate')
  if (packageJson.scripts?.['db:test:opendart-benefit-importer'] !== 'bash ../supabase/tests/opendart_benefit_importer_integration.sh') throw new Error('OpenDART importer integration package command mismatch')
  const browserProjectionDecoder = verifyActualBrowserProjectionDecoders()
  const scan = await scanSensitiveReleaseFiles(root)
  return {
    checkedFiles: scan.checkedFiles,
    contractFiles: inventoryContracts.size,
    migration: '202611230011_admin_company_review_v2.sql',
    browserProjectionDecoder,
    databaseProof: 'mandatory-release-gate-test-database-step',
  }
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const result = await verifyBenefitClaimsRelease(repoRoot)
  console.log(`Benefit claims browser projection decoded by ${result.browserProjectionDecoder} across ${result.checkedFiles} unique scanned inventory files (${result.contractFiles} release contracts checked separately); database proof is delegated to ${result.databaseProof}.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
