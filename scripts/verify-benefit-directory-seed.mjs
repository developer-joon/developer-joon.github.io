#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateSeedBytes } from './generate-benefit-directory-seed.mjs'

const MAX_SOURCE_BYTES = 8_400_000
const MAX_MANIFEST_BYTES = 64_000
const MAX_NDJSON_BYTES = 20 * 1024 * 1024

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
const descriptorPath = descriptor => `/proc/self/fd/${descriptor}`

async function openDirectoryNoFollow(directoryPath, label) {
  const absolute = path.resolve(directoryPath)
  const parts = absolute.split(path.sep).filter(Boolean)
  const handles = []
  try {
    let directory = await open(path.parse(absolute).root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    handles.push(directory)
    for (const component of parts) {
      directory = await open(
        path.join(descriptorPath(directory.fd), component),
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      )
      handles.push(directory)
      if (!(await directory.stat()).isDirectory()) throw Error(`${label} has an unsafe directory component`)
    }
    return { directory, handles }
  } catch (error) {
    for (const handle of handles.reverse()) await handle.close()
    if (['ELOOP', 'ENOTDIR'].includes(error?.code)) throw Error(`${label} has an unsafe symlink component`, { cause: error })
    throw error
  }
}

async function readOpenedFile(parent, name, maximum, label) {
  let file
  try {
    file = await open(
      path.join(descriptorPath(parent.fd), name),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    )
    const before = await file.stat({ bigint: true })
    if (!before.isFile() || before.size < 1n || before.size > BigInt(maximum)) {
      throw Error(`${label} is not a regular file within its byte bound`)
    }
    const bytes = Buffer.alloc(Number(before.size))
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) throw Error(`${label} was truncated during bounded read`)
      offset += bytesRead
    }
    const after = await file.stat({ bigint: true })
    if (after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) {
      throw Error(`${label} changed during bounded read`)
    }
    return bytes
  } catch (error) {
    if (error?.code === 'ELOOP') throw Error(`${label} must not be a symlink`, { cause: error })
    throw error
  } finally {
    await file?.close()
  }
}

async function readNoFollowBounded(filePath, maximum, label) {
  const absolute = path.resolve(filePath)
  const opened = await openDirectoryNoFollow(path.dirname(absolute), label)
  try {
    return await readOpenedFile(opened.directory, path.basename(absolute), maximum, label)
  } finally {
    for (const handle of opened.handles.reverse()) await handle.close()
  }
}

async function readBundle(bundleDir) {
  const opened = await openDirectoryNoFollow(bundleDir, 'bundle directory')
  try {
    const inventory = (await readdir(descriptorPath(opened.directory.fd))).sort()
    if (inventory.length !== 2 || inventory[0] !== 'companies.ndjson' || inventory[1] !== 'manifest.json') {
      throw Error('bundle inventory must contain exactly manifest.json and companies.ndjson')
    }
    const [manifestBytes, ndjson] = await Promise.all([
      readOpenedFile(opened.directory, 'manifest.json', MAX_MANIFEST_BYTES, 'bundle manifest'),
      readOpenedFile(opened.directory, 'companies.ndjson', MAX_NDJSON_BYTES, 'bundle companies'),
    ])
    return { manifestBytes, ndjson }
  } finally {
    for (const handle of opened.handles.reverse()) await handle.close()
  }
}

function assertFrozen(actual, expected, label) {
  if (actual !== expected) throw Error(`${label} does not match the independent frozen seed contract`)
}

export async function verifyBenefitDirectorySeed({ sourceFile, bundleDir } = {}) {
  if (!sourceFile || !bundleDir) throw Error('sourceFile and bundleDir are required')
  const { manifestBytes, ndjson } = await readBundle(bundleDir)
  const { rows } = validateSeedBytes(manifestBytes, ndjson)
  const identityCounts = { base_legal_identity: 0, recruitment_observation: 0, ftc_affiliate: 0 }
  const idHash = createHash('sha256')
  for (const row of rows) {
    identityCounts[row.source_binding.identity_kind]++
    idHash.update(row.company_id)
    idHash.update('\n')
  }
  const sourceBytes = await readNoFollowBounded(sourceFile, MAX_SOURCE_BYTES, 'source artifact')
  const summary = {
    companyCount: rows.length,
    identityCounts,
    companiesByteCount: ndjson.length,
    companiesSha256: sha256(ndjson),
    manifestSha256: sha256(manifestBytes),
    orderedIdSha256: idHash.digest('hex'),
    sourceArtifactSha256: sha256(sourceBytes),
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
