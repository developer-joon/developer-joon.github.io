#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { chmod, mkdir, mkdtemp, open, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyDomesticSearchIndexBytes } from './verify-domestic-search-index.mjs'

export const PINNED_SOURCE = Object.freeze({
  schemaVersion: 'domestic-search-index-v1',
  sha256: 'b7e61860d69f289735f42a6ae275c8a5303cbde367036f77865c7b20de7b9594',
  byteCount: 8392604,
  companyCount: 40053,
  identityCounts: Object.freeze({ base_legal_identity: 1000, recruitment_observation: 35910, ftc_affiliate: 3143 }),
})

const ROW_KEYS = Object.freeze(['company_id', 'identity_class', 'display_name', 'normalized_name', 'industry', 'size_class', 'region', 'source_edition', 'source_binding'])
const BINDING_KEYS = Object.freeze(['artifact_sha256', 'identity_kind', 'source_type', 'observation_date'])
const ENTRY_KEYS = new Set(['employee_count', 'group', 'id', 'name', 'observation_date', 'region', 'research_count', 'size_class', 'size_evidence', 'source_type'])
const TOP_KEYS = ['approved', 'edition', 'entries', 'schema_version', 'totals']
const TOTAL_KEYS = ['base_aliases', 'ftc_only', 'new_records', 'records', 'research_companies', 'research_leads']
const SOURCE_SIZE_CLASSES = new Set(['unclassified', 'large_affiliate', 'mid_history', 'sme_unspecified'])
const MAX_SOURCE_BYTES = 8_500_000
const MAX_MANIFEST_BYTES = 64_000
const MAX_NDJSON_BYTES = 30_000_000
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const exactKeys = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${label} wrong type`)
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw Error(`${label} exact key shape mismatch`)
}
const boundedText = (value, label, max, { nullable = false, trim = false } = {}) => {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || value.length < 1 || value.length > max || Buffer.byteLength(value) > max * 4 || /[\u0000-\u001f\u007f]/u.test(value)) throw Error(`${label} invalid text`)
  const result = trim ? value.trim() : value
  if (!result || (!trim && result !== result.trim())) throw Error(`${label} invalid whitespace`)
  return result
}
const utf8Compare = (left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))

async function readNoFollowBounded(filePath, maximum, label) {
  const absolute = path.resolve(filePath)
  const parts = absolute.split(path.sep).filter(Boolean)
  const handles = []
  try {
    let parent = await open(path.parse(absolute).root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    handles.push(parent)
    for (const component of parts.slice(0, -1)) {
      parent = await open(`/proc/self/fd/${parent.fd}/${component}`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
      handles.push(parent)
      if (!(await parent.stat()).isDirectory()) throw Error(`${label} unsafe directory component`)
    }
    const file = await open(`/proc/self/fd/${parent.fd}/${parts.at(-1)}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    handles.push(file)
    const before = await file.stat({ bigint: true })
    if (!before.isFile() || before.size < 1n || before.size > BigInt(maximum)) throw Error(`${label} unsafe file or byte bound`)
    const bytes = Buffer.alloc(Number(before.size))
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) throw Error(`${label} truncated during bounded read`)
      offset += bytesRead
    }
    const after = await file.stat({ bigint: true })
    if (after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) throw Error(`${label} changed during read`)
    return bytes
  } catch (error) {
    if (['ELOOP', 'ENOTDIR'].includes(error?.code)) throw Error(`${label} unsafe symlink component`, { cause: error })
    throw error
  } finally {
    for (const handle of handles.reverse()) await handle.close()
  }
}

function parseJson(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')) } catch (error) { throw Error(`${label} invalid JSON`, { cause: error }) }
}

function identityFor(row) {
  if (row.source_type === 'ftc_affiliate' && row.id.startsWith('KR-CRN-')) return ['ftc_affiliate', 'group_affiliate']
  if (row.source_type === 'dated_recruitment_observation' && row.id.startsWith('KR-BIZ-')) return ['recruitment_observation', 'recruitment_observation']
  if ((row.source_type === 'base_legal_identity' || row.source_type === 'dated_recruitment_observation') && row.id.startsWith('KR-CRN-')) return ['base_legal_identity', 'legal_corporation']
  throw Error('source identity class binding invalid')
}

function validateSource(doc, contract) {
  exactKeys(doc, TOP_KEYS, 'source document')
  exactKeys(doc.totals, TOTAL_KEYS, 'source totals')
  if (doc.schema_version !== PINNED_SOURCE.schemaVersion || typeof doc.edition !== 'string' || !/^\d{4}-\d{2}-\d{2}$|^fixture-edition$/.test(doc.edition) || doc.approved !== 0 || !Array.isArray(doc.entries)) throw Error('source contract header invalid')
  for (const [key, value] of Object.entries(doc.totals)) if (!Number.isSafeInteger(value) || value < 0) throw Error(`source total ${key} wrong type`)
  if (doc.entries.length !== contract.companyCount || doc.totals.records !== contract.companyCount) throw Error('source company count does not match frozen authority')
  const ids = new Set()
  const counts = { base_legal_identity: 0, recruitment_observation: 0, ftc_affiliate: 0 }
  for (const row of doc.entries) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some(key => !ENTRY_KEYS.has(key))) throw Error('source entry exact key shape mismatch')
    if (!/^KR-(?:BIZ-\d{10}|CRN-\d{13})$/.test(row.id ?? '') || ids.has(row.id)) throw Error('source duplicate or invalid company ID')
    ids.add(row.id)
    boundedText(row.name, 'source display name', 200)
    if (!SOURCE_SIZE_CLASSES.has(row.size_class)) throw Error('source size class invalid')
    if (row.region !== undefined) boundedText(row.region, 'source region', 100, { trim: true })
    if (row.observation_date !== undefined && (typeof row.observation_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.observation_date))) throw Error('source observation date invalid')
    if (row.employee_count !== undefined && (!Number.isSafeInteger(row.employee_count) || row.employee_count < 0)) throw Error('source employee count wrong type')
    if (row.research_count !== undefined && (!Number.isSafeInteger(row.research_count) || row.research_count < 1)) throw Error('source research count wrong type')
    if (row.group !== undefined) boundedText(row.group, 'source group', 200)
    if (row.size_evidence !== undefined && (!row.size_evidence || typeof row.size_evidence !== 'object' || Array.isArray(row.size_evidence))) throw Error('source size evidence wrong type')
    const [kind] = identityFor(row)
    counts[kind]++
  }
  if (Object.keys(counts).some(key => counts[key] !== contract.identityCounts[key])) throw Error('source identity counts do not match frozen authority')
  return counts
}

export function buildSeedFromDocument(doc, sourceBytes, contract = {
  artifactSha256: PINNED_SOURCE.sha256,
  artifactBytes: PINNED_SOURCE.byteCount,
  companyCount: PINNED_SOURCE.companyCount,
  identityCounts: PINNED_SOURCE.identityCounts,
}) {
  const actualDigest = sha256(sourceBytes)
  if (contract.artifactSha256 !== 'fixture' && actualDigest !== contract.artifactSha256) throw Error('source SHA mismatch')
  if (contract.artifactBytes !== null && sourceBytes.length !== contract.artifactBytes) throw Error('source byte count mismatch')
  const counts = validateSource(doc, contract)
  const bindingDigest = contract.artifactSha256 === 'fixture' ? actualDigest : contract.artifactSha256
  const rows = doc.entries.map(source => {
    const [identityKind, identityClass] = identityFor(source)
    const displayName = boundedText(source.name, 'display name', 200)
    const normalizedName = displayName.toLowerCase()
    const region = source.region === undefined ? null : boundedText(source.region, 'region', 100, { trim: true })
    const sizeClass = source.size_class === 'large_affiliate' ? 'large_affiliate' : 'unclassified'
    return {
      company_id: source.id,
      identity_class: identityClass,
      display_name: displayName,
      normalized_name: normalizedName,
      industry: null,
      size_class: sizeClass,
      region,
      source_edition: doc.edition,
      source_binding: {
        artifact_sha256: bindingDigest,
        identity_kind: identityKind,
        source_type: source.source_type,
        observation_date: source.observation_date ?? null,
      },
    }
  }).sort((left, right) => utf8Compare(left.company_id, right.company_id))
  const ndjson = Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n')
  const idBytes = Buffer.from(rows.map(row => row.company_id).join('\n') + '\n')
  const manifest = {
    schema_version: 'benefit-directory-seed-v1',
    source_contract_version: PINNED_SOURCE.schemaVersion,
    source_artifact: {
      schema_version: doc.schema_version,
      sha256: bindingDigest,
      byte_count: sourceBytes.length,
      edition: doc.edition,
    },
    company_count: rows.length,
    identity_counts: counts,
    ordered_id_set_sha256: sha256(idBytes),
    companies: { path: 'companies.ndjson', byte_count: ndjson.length, sha256: sha256(ndjson) },
    generation_contract: {
      row_schema_version: 'benefit-company-seed-v1',
      ordering: 'utf8-byte-order-of-exact-company_id',
      display_name: 'preserved-exactly',
      normalized_fields: 'normalized_name,region,size_class-only',
      publication_rows: 0,
    },
  }
  return { manifest, rows, ndjson, manifestBytes: Buffer.from(JSON.stringify(manifest) + '\n') }
}

async function loadSource(sourceFile, contract) {
  const bytes = await readNoFollowBounded(sourceFile, MAX_SOURCE_BYTES, 'source artifact')
  if (contract === undefined) {
    if (bytes.length !== PINNED_SOURCE.byteCount || sha256(bytes) !== PINNED_SOURCE.sha256) throw Error('source artifact does not match pinned integrity contract')
    verifyDomesticSearchIndexBytes(bytes)
  }
  const doc = parseJson(bytes, 'source artifact')
  return { bytes, doc }
}

function validateRow(row) {
  exactKeys(row, ROW_KEYS, 'company row')
  exactKeys(row.source_binding, BINDING_KEYS, 'company source binding')
  if (!/^KR-(?:BIZ-\d{10}|CRN-\d{13})$/.test(row.company_id)) throw Error('company row ID invalid')
  if (!['legal_corporation', 'recruitment_observation', 'group_affiliate'].includes(row.identity_class)) throw Error('company row identity class invalid')
  boundedText(row.display_name, 'company row display name', 200)
  if (row.normalized_name !== row.normalized_name?.trim().toLowerCase() || !row.normalized_name) throw Error('company row normalized name invalid')
  if (row.industry !== null) boundedText(row.industry, 'company row industry', 100)
  if (!['large', 'medium', 'small', 'large_affiliate', 'unclassified'].includes(row.size_class)) throw Error('company row size class invalid')
  if (row.region !== null) boundedText(row.region, 'company row region', 100)
  boundedText(row.source_edition, 'company row source edition', 100)
  if (!/^[0-9a-f]{64}$/.test(row.source_binding.artifact_sha256) || !['base_legal_identity', 'recruitment_observation', 'ftc_affiliate'].includes(row.source_binding.identity_kind) || !['base_legal_identity', 'dated_recruitment_observation', 'ftc_affiliate'].includes(row.source_binding.source_type) || (row.source_binding.observation_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(row.source_binding.observation_date))) throw Error('company source binding invalid')
}

function validateManifest(manifest) {
  exactKeys(manifest, ['schema_version', 'source_contract_version', 'source_artifact', 'company_count', 'identity_counts', 'ordered_id_set_sha256', 'companies', 'generation_contract'], 'manifest')
  exactKeys(manifest.source_artifact, ['schema_version', 'sha256', 'byte_count', 'edition'], 'manifest source artifact')
  exactKeys(manifest.identity_counts, ['base_legal_identity', 'recruitment_observation', 'ftc_affiliate'], 'manifest identity counts')
  exactKeys(manifest.companies, ['path', 'byte_count', 'sha256'], 'manifest companies')
  exactKeys(manifest.generation_contract, ['row_schema_version', 'ordering', 'display_name', 'normalized_fields', 'publication_rows'], 'manifest generation contract')
  if (manifest.schema_version !== 'benefit-directory-seed-v1' || manifest.source_contract_version !== PINNED_SOURCE.schemaVersion || manifest.companies.path !== 'companies.ndjson') throw Error('manifest contract version invalid')
}

function validateSeedBytes(manifestBytes, ndjson) {
  const manifest = parseJson(manifestBytes, 'bundle manifest')
  validateManifest(manifest)
  if (manifest.companies.byte_count !== ndjson.length || manifest.companies.sha256 !== sha256(ndjson)) throw Error('bundle companies byte/hash drift')
  if (ndjson.at(-1) !== 0x0a) throw Error('bundle companies must end with newline')
  const lines = ndjson.toString('utf8').slice(0, -1).split('\n')
  if (lines.length > PINNED_SOURCE.companyCount) throw Error('bundle row cap exceeded')
  const rows = lines.map((line, index) => {
    const row = parseJson(Buffer.from(line), `company row ${index + 1}`)
    validateRow(row)
    return row
  })
  const ids = rows.map(row => row.company_id)
  if (new Set(ids).size !== ids.length || ids.some((id, index) => index > 0 && utf8Compare(ids[index - 1], id) >= 0)) throw Error('bundle duplicate or unordered company ID')
  if (manifest.company_count !== rows.length || manifest.ordered_id_set_sha256 !== sha256(Buffer.from(ids.join('\n') + '\n'))) throw Error('bundle company count or ID digest mismatch')
  const counts = { base_legal_identity: 0, recruitment_observation: 0, ftc_affiliate: 0 }
  for (const row of rows) counts[row.source_binding.identity_kind]++
  if (Object.keys(counts).some(key => counts[key] !== manifest.identity_counts[key])) throw Error('bundle identity count mismatch')
  return { manifest, rows }
}

export async function verifySeedBundle({ sourceFile, bundleDir }) {
  const inventory = await readdir(bundleDir)
  if (inventory.length !== 2 || !inventory.includes('manifest.json') || !inventory.includes('companies.ndjson')) throw Error('bundle inventory mismatch')
  const [manifestBytes, ndjson] = await Promise.all([
    readNoFollowBounded(path.join(bundleDir, 'manifest.json'), MAX_MANIFEST_BYTES, 'bundle manifest'),
    readNoFollowBounded(path.join(bundleDir, 'companies.ndjson'), MAX_NDJSON_BYTES, 'bundle companies'),
  ])
  const { manifest, rows } = validateSeedBytes(manifestBytes, ndjson)
  const { bytes, doc } = await loadSource(sourceFile)
  const expected = buildSeedFromDocument(doc, bytes)
  if (!manifestBytes.equals(expected.manifestBytes) || !ndjson.equals(expected.ndjson)) throw Error('bundle drift from pinned source authority')
  return { manifest, rows, manifestBytes, ndjson, sourceBytes: bytes, bundleSha256: sha256(manifestBytes) }
}

export async function generateSeedBundle({ sourceFile, outputDir, check = false, injectBeforeCommit, testOnly } = {}) {
  if (!sourceFile || !outputDir) throw Error('sourceFile and outputDir are required')
  const { bytes, doc } = await loadSource(sourceFile)
  const built = buildSeedFromDocument(doc, bytes)
  const destination = path.resolve(outputDir)
  const parent = path.dirname(destination)

  if (check) {
    validateSeedBytes(built.manifestBytes, built.ndjson)
    const [actualManifest, actualRows] = await Promise.all([
      readNoFollowBounded(path.join(destination, 'manifest.json'), MAX_MANIFEST_BYTES, 'tracked manifest'),
      readNoFollowBounded(path.join(destination, 'companies.ndjson'), MAX_NDJSON_BYTES, 'tracked companies'),
    ])
    if (!actualManifest.equals(built.manifestBytes) || !actualRows.equals(built.ndjson)) throw Error('tracked benefit directory seed differs: output drift')
    return built
  }

  await mkdir(parent, { recursive: true })
  const lockPath = `${destination}.generate.lock`
  let lock
  try {
    lock = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
  } catch (error) {
    if (error?.code === 'EEXIST') throw Error('benefit seed generation lock is already held')
    throw error
  }
  let stage = null
  let backupContainer = null
  let preserveBackup = false
  try {
    const lockStat = await lock.stat()
    if (!lockStat.isFile() || lockStat.uid !== process.getuid() || lockStat.nlink !== 1 || (lockStat.mode & 0o777) !== 0o600) throw Error('unsafe benefit seed generation lock')
    stage = await mkdtemp(path.join(parent, '.benefit-directory-seed-stage-'))
    await chmod(stage, 0o700)
    await writeFile(path.join(stage, 'companies.ndjson'), built.ndjson, { mode: 0o600 })
    await writeFile(path.join(stage, 'manifest.json'), built.manifestBytes, { mode: 0o600 })
    await verifySeedBundle({ sourceFile, bundleDir: stage })
    if (injectBeforeCommit) await injectBeforeCommit()

    backupContainer = await mkdtemp(path.join(parent, `.${path.basename(destination)}.previous-`))
    await chmod(backupContainer, 0o700)
    const backup = path.join(backupContainer, 'bundle')
    let oldMoved = false
    let stageInstalled = false
    try {
      try { await rename(destination, backup); oldMoved = true } catch (error) { if (error.code !== 'ENOENT') throw error }
      if (testOnly?.injectBeforeInstall) await testOnly.injectBeforeInstall()
      await rename(stage, destination)
      stageInstalled = true
      stage = null
    } catch (error) {
      if (oldMoved && !stageInstalled) {
        try {
          if (testOnly?.injectRestoreFailure) await testOnly.injectRestoreFailure()
          await rename(backup, destination)
          oldMoved = false
        } catch (restoreError) {
          preserveBackup = true
          throw Error(`${error.message}; automatic restore failed; preserved prior bundle at ${path.basename(backupContainer)}/bundle`, { cause: restoreError })
        }
      }
      throw error
    }

    if (oldMoved || backupContainer) {
      try {
        if (testOnly?.injectBackupCleanupFailure) await testOnly.injectBackupCleanupFailure()
        await rm(backupContainer, { recursive: true, force: true })
        backupContainer = null
      } catch {
        preserveBackup = true
        console.warn(`benefit seed committed; stale backup remains at ${path.basename(backupContainer)}/bundle and may be removed after verification`)
      }
    }
    return built
  } finally {
    if (stage !== null) await rm(stage, { recursive: true, force: true })
    if (backupContainer !== null && !preserveBackup) await rm(backupContainer, { recursive: true, force: true })
    await lock.close()
    await rm(lockPath, { force: true })
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const allowed = new Set(['--check'])
  if (process.argv.slice(2).some(arg => !allowed.has(arg))) throw Error('usage: generate-benefit-directory-seed.mjs [--check]')
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const result = await generateSeedBundle({
    sourceFile: path.join(repo, 'community-app/public/data/company-benefits/domestic-search-index-v1/index.json'),
    outputDir: path.join(repo, 'supabase/fixtures/benefit-directory'),
    check: process.argv.includes('--check'),
  })
  console.log(`benefit directory seed: ${result.manifest.company_count} companies, ${result.ndjson.length} bytes, sha256 ${result.manifest.companies.sha256}${process.argv.includes('--check') ? ' checked' : ''}`)
}
