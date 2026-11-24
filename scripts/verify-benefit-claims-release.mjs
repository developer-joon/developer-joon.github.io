#!/usr/bin/env node

import { constants } from 'node:fs'
import { lstat, open, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_FILE_BYTES = 2 * 1024 * 1024
const SCAN_ROOTS = ['community-app/src', 'scripts', 'supabase/functions', 'supabase/migrations']
const SYNTHETIC_ALLOWLIST = [
  /(?:^|\/)supabase\/functions\/verify-benefit-company\/index\.test\.ts$/,
  /(?:^|\/)scripts\/verify-benefit-claims-release\.test\.mjs$/,
  /(?:^|\/)scripts\/community-snapshots\.test\.mjs$/,
  /(?:^|\/)scripts\/release-gate\.test\.mjs$/,
  /(?:^|\/)scripts\/test_domestic_company_directory\.py$/,
  /(?:^|\/)community-app\/src\/data\/adminBenefitCompanyRequestRepository\.test\.ts$/,
  /(?:^|\/)community-app\/src\/data\/benefitCompanyRequestRepository\.test\.ts$/,
  /(?:^|\/)community-app\/src\/data\/benefitParity\.test\.ts$/,
  /(?:^|\/)community-app\/src\/data\/benefitSessionBoundary\.test\.ts$/,
  /(?:^|\/)community-app\/src\/lib\/benefitCompanyRequestDraftStore\.test\.ts$/,
  /(?:^|\/)scripts\/opendart-(?:authority-json|text|zip)-test-corpus\.mjs$/,
]
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'public'])
const SECRET_NAMES = '(?:NTS_SERVICE_KEY|BUSINESS_NUMBER_HMAC_SECRET|SUPABASE_SERVICE_ROLE_KEY)'
const SENSITIVE_PATTERNS = [
  { label: 'representative name', pattern: /(?:representative_name|representativeName|대표자(?:명)?)\s*["']?\s*[:=]\s*["'][^\s"'`,}\]]{2,}/iu },
  { label: 'opening date', pattern: /(?:opening_date|openingDate|개업일자)\s*["']?\s*[:=]\s*["']\d{8}/iu },
  { label: 'raw business number', pattern: /(?:(?<![A-Za-z0-9-])\d{3}-\d{2}-\d{5}(?![A-Za-z0-9-])|(?:business_number|businessNumber|사업자등록번호)\s*["']?\s*[:=]\s*["']?\d{10})/iu },
  { label: 'secret assignment', pattern: new RegExp(`${SECRET_NAMES}\\s*["']?\\s*[:=]\\s*["']?(?![\\s"']*(?:process\\.env|Deno\\.env|getEnv|\\$\\{|<|\\*{3}|redacted))[A-Za-z0-9._~+\\/-]{8,}`, 'iu') },
]

function syntheticFixtureAllowed(relativePath) {
  const normalized = relativePath.split(path.sep).join('/')
  return SYNTHETIC_ALLOWLIST.some(pattern => pattern.test(normalized))
}

async function regularFiles(root, relative = '') {
  const directory = path.join(root, relative)
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (SKIP_DIRECTORIES.has(entry.name)) continue
    const child = path.join(relative, entry.name)
    const stat = await lstat(path.join(root, child))
    if (stat.isSymbolicLink()) throw new Error(`sensitive scan rejects symbolic link: ${child}`)
    if (stat.isDirectory()) files.push(...await regularFiles(root, child))
    else if (stat.isFile()) files.push(child)
    else throw new Error(`sensitive scan rejects non-regular file: ${child}`)
  }
  return files
}

async function readBounded(filePath) {
  const handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error(`sensitive scan file exceeds byte limit: ${filePath}`)
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
  return [bytes.toString('utf8'), bytes.toString('latin1'), even.toString('utf16le'), swapped.toString('utf16le')]
}

export async function scanSensitiveReleaseFiles(repoRoot) {
  const root = path.resolve(repoRoot)
  const scanRoots = []
  for (const candidate of SCAN_ROOTS) {
    try {
      const stat = await lstat(path.join(root, candidate))
      if (stat.isDirectory()) scanRoots.push(candidate)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  const targets = scanRoots.length > 0
    ? (await Promise.all(scanRoots.map(relative => regularFiles(root, relative)))).flat()
    : await regularFiles(root)
  let checkedFiles = 0
  for (const relativePath of targets) {
    const bytes = await readBounded(path.join(root, relativePath))
    checkedFiles += 1
    if (syntheticFixtureAllowed(relativePath)) continue
    for (const text of decodedViews(bytes)) {
      for (const { label, pattern } of SENSITIVE_PATTERNS) {
        pattern.lastIndex = 0
        if (pattern.test(text)) throw new Error(`${label} leaked outside an explicitly synthetic test fixture: ${relativePath}`)
      }
    }
  }
  return { checkedFiles }
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

export async function verifyBenefitClaimsRelease(repoRoot) {
  const root = path.resolve(repoRoot)
  const contracts = new Map([
    ['supabase/migrations/202611230003_benefit_company_identifiers.sql', [/benefit_company_identifiers/, /opendart_corp_code/]],
    ['supabase/migrations/202611230004_benefit_company_add_requests.sql', [/benefit_company_add_requests/, /business_number_hmac/]],
    ['supabase/migrations/202611230005_benefit_claims.sql', [/get_benefit_company_v2/, /benefit_claims/]],
    ['supabase/migrations/202611230006_benefit_claim_reactions.sql', [/benefit_claim_reactions/, /community_confirmed/]],
    ['supabase/migrations/202611230011_admin_company_review_v2.sql', [/review_benefit_company_request_v2/, /get_benefit_claim_moderation_detail_v1/]],
    ['supabase/tests/database/benefit_claims.test.sql', [/get_benefit_company_v2/, /exact browser read roles/, /raw claim/]],
    ['supabase/tests/database/benefit_company_identifiers.test.sql', [/benefit_company_identifiers/, /HMAC/i]],
    ['supabase/tests/database/zz_benefit_claim_reactions_concurrency.test.sql', [/dblink_connect/, /dblink_disconnect/]],
    ['supabase/tests/database/zz_benefit_company_add_concurrency.test.sql', [/dblink_connect/, /dblink_disconnect/]],
    ['supabase/functions/verify-benefit-company/index.ts', [/NTS_SERVICE_KEY/, /BUSINESS_NUMBER_HMAC_SECRET/, /SUPABASE_SERVICE_ROLE_KEY/]],
    ['supabase/functions/verify-benefit-company/index.test.ts', [/representative/, /opening/, /business/]],
    ['community-app/src/data/benefitDirectoryRepository.test.ts', [/reviewer_id/, /source_url/, /length:\s*201/]],
    ['community-app/vite.config.ts', [/benefitsCompanyRequest/, /benefitsClaimReaction/, /adminBenefitClaims/]],
    ['community-app/benefits/company-request/index.html', [/기업 추가 요청/]],
    ['community-app/benefits/claim/index.html', [/구조화된 복지 제보/]],
    ['community-app/benefits/claim-reaction/index.html', [/복지 제보 반응/]],
    ['community-app/admin/benefit-company-requests/index.html', [/기업 추가 요청 검토/]],
    ['community-app/admin/benefit-claims/index.html', [/복지 claim 검토/]],
  ])
  for (const [relativePath, patterns] of contracts) await requireText(root, relativePath, patterns)
  const packageJson = JSON.parse(await readFile(path.join(root, 'community-app/package.json'), 'utf8'))
  if (packageJson.scripts?.['release:check'] !== 'node ../scripts/release-gate.mjs') throw new Error('release:check must thin-forward to the root release gate')
  if (packageJson.scripts?.['db:test:opendart-benefit-importer'] !== 'bash ../supabase/tests/opendart_benefit_importer_integration.sh') throw new Error('OpenDART importer integration package command mismatch')
  const scan = await scanSensitiveReleaseFiles(root)
  return { checkedFiles: scan.checkedFiles + contracts.size, migration: '202611230011_admin_company_review_v2.sql' }
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const result = await verifyBenefitClaimsRelease(repoRoot)
  console.log(`Benefit claims release contracts verified across ${result.checkedFiles} files; latest migration ${result.migration}.`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
