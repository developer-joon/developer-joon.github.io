#!/usr/bin/env node

import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifySeedBundle } from './generate-benefit-directory-seed.mjs'

const freeze = value => {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child)
  return Object.freeze(value)
}

export const FROZEN_SEED_CONTRACT = freeze({
  companyCount: 40053,
  identityCounts: {
    base_legal_identity: 1000,
    recruitment_observation: 35910,
    ftc_affiliate: 3143,
  },
  companiesByteCount: 18848420,
  companiesSha256: '80c89e90b0af6b31f1e2478494aff313c926d234d381294b173f26320115ca23',
  manifestSha256: '29fcc16e4d643ec2955241737cba1cacbe5f0c7f86c7c2d5f7d3522510f040ec',
  orderedIdSha256: 'c96f906973da37cf14138e0ef027a05374c1fa08a6906d8c2ef2b900f7ccbf97',
  sourceArtifactSha256: 'b7e61860d69f289735f42a6ae275c8a5303cbde367036f77865c7b20de7b9594',
})

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

function assertFrozen(actual, expected, label) {
  if (actual !== expected) throw Error(`${label} does not match the independent frozen seed contract`)
}

export async function verifyBenefitDirectorySeed({ sourceFile, bundleDir } = {}) {
  if (!sourceFile || !bundleDir) throw Error('sourceFile and bundleDir are required')
  const verified = await verifySeedBundle({ sourceFile, bundleDir })
  const identityCounts = { base_legal_identity: 0, recruitment_observation: 0, ftc_affiliate: 0 }
  const idHash = createHash('sha256')
  for (const row of verified.rows) {
    identityCounts[row.source_binding.identity_kind]++
    idHash.update(row.company_id)
    idHash.update('\n')
  }
  const summary = {
    companyCount: verified.rows.length,
    identityCounts,
    companiesByteCount: verified.ndjson.length,
    companiesSha256: sha256(verified.ndjson),
    manifestSha256: sha256(verified.manifestBytes),
    orderedIdSha256: idHash.digest('hex'),
    sourceArtifactSha256: sha256(verified.sourceBytes),
  }
  assertFrozen(summary.companyCount, FROZEN_SEED_CONTRACT.companyCount, 'company count')
  for (const key of Object.keys(FROZEN_SEED_CONTRACT.identityCounts)) {
    assertFrozen(summary.identityCounts[key], FROZEN_SEED_CONTRACT.identityCounts[key], `${key} count`)
  }
  for (const key of ['companiesByteCount', 'companiesSha256', 'manifestSha256', 'orderedIdSha256', 'sourceArtifactSha256']) {
    assertFrozen(summary[key], FROZEN_SEED_CONTRACT[key], key)
  }
  return { summary: freeze(summary) }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  if (process.argv.length !== 2) {
    console.error('usage: verify-benefit-directory-seed.mjs')
    process.exitCode = 2
  } else {
    const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const result = await verifyBenefitDirectorySeed({
      sourceFile: path.join(repo, 'community-app/public/data/company-benefits/domestic-search-index-v1/index.json'),
      bundleDir: path.join(repo, 'supabase/fixtures/benefit-directory'),
    })
    const { summary } = result
    console.log(
      `benefit directory seed verified: ${summary.companyCount} companies; identities ` +
      `${summary.identityCounts.base_legal_identity}/${summary.identityCounts.recruitment_observation}/${summary.identityCounts.ftc_affiliate}; ` +
      `companies ${summary.companiesByteCount} bytes sha256 ${summary.companiesSha256}; ` +
      `manifest sha256 ${summary.manifestSha256}; ordered IDs sha256 ${summary.orderedIdSha256}; ` +
      `source sha256 ${summary.sourceArtifactSha256}`,
    )
  }
}
