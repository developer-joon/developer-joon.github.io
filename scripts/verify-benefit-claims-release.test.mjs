#!/usr/bin/env node

import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { scanSensitiveReleaseFiles, verifyBenefitClaimsRelease } from './verify-benefit-claims-release.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')

test('repository claim release contracts agree', async () => {
  const result = await verifyBenefitClaimsRelease(repoRoot)
  assert.ok(result.checkedFiles > 0)
  assert.equal(result.migration, '202611230011_admin_company_review_v2.sql')
  assert.equal(result.browserProjectionDecoder, 'actual-v2-detail-and-listing-decoders')
  assert.equal(result.databaseProof, 'mandatory-release-gate-test-database-step')
})

test('release verifier does not misrepresent migration text as database verification', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'claims-release-migration-mutation-'))
  try {
    await cp(repoRoot, root, { recursive: true, filter: source => !/(?:^|\/)(?:\.git|node_modules|dist|\.cache)(?:\/|$)/.test(source) })
    await writeFile(path.join(root, 'supabase/migrations/202611230005_benefit_claims.sql'), '-- mutation: database body removed\n')
    const result = await verifyBenefitClaimsRelease(root)
    assert.equal(result.databaseProof, 'mandatory-release-gate-test-database-step')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('sensitive scanner rejects private identity values and secret assignments outside synthetic tests', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'claims-release-scan-'))
  try {
    await mkdir(path.join(root, 'src'), { recursive: true })
    for (const [name, content, pattern] of [
      ['representative.json', '{"representative_name":"홍길동"}\n', /representative/i],
      ['opening.json', '{"opening_date":"20260102"}\n', /opening date/i],
      ['business.txt', '123-45-67890\n', /business number/i],
      ['nts.env', 'NTS_SERVICE_' + 'KEY=example-sensitive-value\n', /secret assignment/i],
      ['hmac.env', 'BUSINESS_NUMBER_HMAC_' + 'SECRET=example-sensitive-value\n', /secret assignment/i],
      ['service.env', 'SUPABASE_SERVICE_ROLE_' + 'KEY=example-sensitive-value\n', /secret assignment/i],
    ]) {
      const target = path.join(root, 'src', name)
      await writeFile(target, content)
      await assert.rejects(scanSensitiveReleaseFiles(root), pattern)
      await rm(target)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('sensitive scanner does not skip secret-bearing dotfiles', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'claims-release-dotfile-'))
  try {
    await writeFile(path.join(root, '.env'), 'NTS_SERVICE_' + 'KEY=example-sensitive-value\n')
    await assert.rejects(scanSensitiveReleaseFiles(root), /secret assignment/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('sensitive scanner fails closed on non-regular files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'claims-release-fifo-'))
  try {
    await mkdir(path.join(root, 'scripts'), { recursive: true })
    const fifo = path.join(root, 'scripts', 'sensitive-input')
    const created = spawnSync('mkfifo', [fifo], { encoding: 'utf8' })
    assert.equal(created.status, 0, created.stderr)
    await assert.rejects(scanSensitiveReleaseFiles(root), /non-regular/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('sensitive scanner does not trust an arbitrary test filename as synthetic', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'claims-release-test-name-'))
  try {
    await mkdir(path.join(root, 'community-app/src'), { recursive: true })
    await writeFile(path.join(root, 'community-app/src/not-explicitly-synthetic.test.ts'), 'const fixture={business_number:"123-45-67890"}\n')
    await assert.rejects(scanSensitiveReleaseFiles(root), /business number/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('sensitive scanner permits only narrow synthetic test fixtures', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'claims-release-synthetic-'))
  try {
    await mkdir(path.join(root, 'supabase/functions/verify-benefit-company'), { recursive: true })
    const fixture = path.join(root, 'supabase/functions/verify-benefit-company/index.test.ts')
    await writeFile(fixture, 'const fixture={representative_name:"테스트대표",opening_date:"20260102",business_number:"123-45-67890"}\n')
    await assert.doesNotReject(scanSensitiveReleaseFiles(root))
    await writeFile(fixture, 'const fixture={representative_name:"테스트대표",opening_date:"20260102",business_number:"123-45-67890"}\nNTS_SERVICE_' + 'KEY=obvious-sentinel-secret\n')
    await assert.rejects(scanSensitiveReleaseFiles(root), /secret assignment/i)
    await writeFile(fixture, 'const fixture={representative_name:"다른대표",opening_date:"20251231",business_number:"999-88-77777"}\n')
    await assert.rejects(scanSensitiveReleaseFiles(root), /representative|opening date|business number/i)
    await rm(fixture)
    await writeFile(path.join(root, 'supabase/functions/verify-benefit-company/not-a-test.ts'), 'const fixture={business_number:"123-45-67890"}\n')
    await assert.rejects(scanSensitiveReleaseFiles(root), /business number/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('sensitive scanner rejects symlinks and bounds repository inventory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'claims-release-inventory-'))
  try {
    await writeFile(path.join(root, 'target'), 'safe\n')
    await symlink('target', path.join(root, 'link'))
    await assert.rejects(scanSensitiveReleaseFiles(root), /symbolic link/i)
    await rm(path.join(root, 'link'))
    await Promise.all(Array.from({ length: 1_001 }, (_, index) => writeFile(path.join(root, `f-${index}`), '')))
    await assert.rejects(scanSensitiveReleaseFiles(root, { maxFiles: 1_000 }), /file count|inventory/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('scanner rejects chunk-split and UTF-16 encoded sensitive values and oversized files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'claims-release-encoding-'))
  try {
    await writeFile(path.join(root, 'split.txt'), `safe${'x'.repeat(65530)} 123-45-67890`)
    await assert.rejects(scanSensitiveReleaseFiles(root), /business number/i)
    await rm(path.join(root, 'split.txt'))
    await writeFile(path.join(root, 'utf16.txt'), Buffer.from('representative_name="홍길동"', 'utf16le'))
    await assert.rejects(scanSensitiveReleaseFiles(root), /representative/i)
    await rm(path.join(root, 'utf16.txt'))
    await writeFile(path.join(root, 'huge.txt'), Buffer.alloc(1025, 0x61))
    await assert.rejects(scanSensitiveReleaseFiles(root, { maxFileBytes: 1024 }), /byte limit/i)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})