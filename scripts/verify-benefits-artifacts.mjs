import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { manifestSchema, listingChunkSchema, approvedV2ListingChunkSchema, detailSchema, methodologySchema, sourcesDocumentSchema, categories, assertCompanyDetailEvidence, assertCompanyDetailIdentityProjection, assertCompanyIdentityProjection, assertExplicitCellInventory, assertListingOutcomes } from '../community-app/src/types/benefits.ts'

const forbiddenText = [/fixture-v1/i, /"fixture"\s*:\s*true/i, /example-\d{3}/i, /example\.org/i, /rankings\.json/i, /rankings_url/i, /\/benefits\/rankings\//i, /가상 별빛|가상 검증기업|예시 데이터|모든 기업·정책·점수는 가상/]
const forbiddenKey = /score|rank|percentile|coverage(?:_percent)?|fitScore|rankOrder/i
const internalReviewKeys = new Set(['review', 'review_id', 'researcher_id', 'reviewer_id', 'reviewed_at', 'requested_at', 'review_status', 'decision', 'quote_entailment_confirmed', 'source_entailment_reviews', 'conflict_determination', 'approval', 'approval_status', 'approved', 'approved_at', 'approved_by'])
const manifestByteLimit = 16 * 1024 * 1024
const descriptorByteLimits = { company: 2 * 1024 * 1024, listing: 16 * 1024 * 1024, sources: 64 * 1024 * 1024, small: 4 * 1024 * 1024 }

const descriptorPath = (handle) => `/proc/self/fd/${handle.fd}`
const isDescriptorRoot = (root) => root.startsWith('/proc/self/fd/')
const isWithin = (parent, child) => child === parent || child.startsWith(`${parent}${path.sep}`)

async function withBoundVerifierRoot(root, run) {
  if (isDescriptorRoot(root)) return run(root, root)
  if (constants.O_NOFOLLOW === undefined || constants.O_DIRECTORY === undefined) throw Error('safe benefits directory flags unavailable')
  const displayRoot = path.resolve(root)
  const handles = []
  try {
    const site = await open(displayRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    handles.push(site)
    if (!(await site.stat()).isDirectory()) throw Error('unsafe benefits parent chain directory: site root')
    const resolvedSite = await realpath(displayRoot)
    if (await realpath(descriptorPath(site)) !== resolvedSite) throw Error('unsafe benefits parent chain identity: site root')
    let parent = site
    for (const component of ['community', 'data', 'company-benefits']) {
      let child
      try {
        child = await open(path.join(descriptorPath(parent), component), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
      } catch (error) {
        if (error.code === 'ENOENT') return await run(descriptorPath(site), displayRoot)
        throw Error(`unsafe benefits parent chain directory: ${component}`, { cause: error })
      }
      handles.push(child)
      if (!(await child.stat()).isDirectory()) throw Error(`unsafe benefits parent chain directory: ${component}`)
      const resolvedChild = await realpath(descriptorPath(child))
      if (!isWithin(resolvedSite, resolvedChild)) throw Error(`unsafe benefits parent chain escaped site root: ${component}`)
      parent = child
    }
    return await run(descriptorPath(site), displayRoot)
  } finally {
    await Promise.allSettled(handles.reverse().map((handle) => handle.close()))
  }
}

const stableFileIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs

async function readBoundedRegularFile(pathname, limit, label, hooks = {}, displayPath = pathname) {
  if (constants.O_NOFOLLOW === undefined) throw Error(`safe no-follow reads unavailable: ${label}`)
  let handle
  try {
    handle = await open(pathname, constants.O_RDONLY | constants.O_NOFOLLOW)
    const initial = await handle.stat({ bigint: true })
    if (!initial.isFile() || initial.size > BigInt(limit)) throw Error(`${label} exceeds byte limit or is unsafe`)
    await hooks.afterInitialStat?.({ pathname: displayPath, limit, stat: initial })
    const beforeRead = await handle.stat({ bigint: true })
    if (!beforeRead.isFile() || beforeRead.size > BigInt(limit) || !stableFileIdentity(initial, beforeRead)) throw Error(`${label} changed during bounded read or exceeds byte limit`)
    const buffer = Buffer.alloc(Number(initial.size))
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (bytesRead === 0) throw Error(`${label} changed during bounded read`)
      offset += bytesRead
    }
    const final = await handle.stat({ bigint: true })
    if (!final.isFile() || final.size > BigInt(limit) || !stableFileIdentity(initial, final)) throw Error(`${label} changed during bounded read or exceeds byte limit`)
    return buffer.toString('utf8')
  } finally {
    await handle?.close()
  }
}

async function filesRecursively(root) {
  const rootMetadata = await lstat(root)
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) throw Error(`unsafe artifact entry: ${root}`)
  const output = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      const metadata = await lstat(target)
      if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) throw Error(`unsafe artifact entry: ${target}`)
      if (metadata.isDirectory()) await visit(target)
      else output.push(target)
    }
  }
  await visit(root)
  return output
}
function rejectForbiddenKeys(value, location) {
  if (Array.isArray(value)) return value.forEach((entry) => rejectForbiddenKeys(entry, location))
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKey.test(key)) throw Error(`forbidden benefits key ${key}: ${location}`)
    if (internalReviewKeys.has(key)) throw Error(`internal review field ${key}: ${location}`)
    rejectForbiddenKeys(child, location)
  }
}
const manifestDescriptors = (manifest) => [manifest.taxonomy, manifest.sources, manifest.methodology, ...manifest.listing_chunks, ...Object.values(manifest.company_shards)]

function descriptorByteLimit(url) {
  if (url.includes('/companies/')) return descriptorByteLimits.company
  if (url.includes('/listings/')) return descriptorByteLimits.listing
  if (url.endsWith('/sources.json')) return descriptorByteLimits.sources
  return descriptorByteLimits.small
}

async function readDescriptor(root, descriptor, options = {}) {
  const limit = descriptorByteLimit(descriptor.url)
  if (descriptor.byte_count > limit) throw Error(`benefits descriptor byte count exceeds artifact limit: ${descriptor.url}`)
  const target = path.join(root, descriptor.url)
  const displayTarget = path.join(options.displayRoot ?? root, descriptor.url)
  const raw = await readBoundedRegularFile(target, limit, `benefits artifact ${descriptor.url}`, options.boundedReadHooks, displayTarget)
  if (Buffer.byteLength(raw) !== descriptor.byte_count) throw Error(`benefits byte count mismatch: ${descriptor.url}`)
  if (createHash('sha256').update(raw).digest('hex') !== descriptor.sha256) throw Error(`benefits hash mismatch: ${descriptor.url}`)
  return raw
}

async function assertExactReleaseRootInventoryBound(root, manifest) {
  const releaseRoot = path.join(root, 'community/data/company-benefits')
  const expected = new Map([['manifest.json', 'file'], [manifest.data_version, 'directory']])
  if (manifest.approved_v2_projection) expected.set(manifest.approved_v2_projection.data_version, 'directory')
  const entries = await readdir(releaseRoot, { withFileTypes: true })
  if (entries.length !== expected.size || entries.some((entry) => !expected.has(entry.name))) throw Error('benefits release root inventory mismatch')
  for (const entry of entries) {
    const metadata = await lstat(path.join(releaseRoot, entry.name))
    const kind = metadata.isFile() ? 'file' : metadata.isDirectory() ? 'directory' : 'unsafe'
    if (metadata.isSymbolicLink() || kind !== expected.get(entry.name)) throw Error('benefits release root inventory mismatch')
  }
}

export async function assertExactReleaseRootInventory(root, manifest) {
  return withBoundVerifierRoot(root, (boundRoot) => assertExactReleaseRootInventoryBound(boundRoot, manifest))
}

async function assertExactArtifactInventoryBound(root, manifest) {
  const prefix = `community/data/company-benefits/${manifest.data_version}`
  const benefitsRoot = path.join(root, prefix)
  const files = await filesRecursively(benefitsRoot)
  const actual = files.map((file) => path.relative(root, file).split(path.sep).join('/')).sort()
  const expected = manifestDescriptors(manifest).map((descriptor) => descriptor.url).sort()
  if (actual.length !== expected.length || actual.some((file, index) => file !== expected[index])) throw Error('benefits artifact inventory mismatch')
}

export async function assertExactArtifactInventory(root, manifest) {
  return withBoundVerifierRoot(root, (boundRoot) => assertExactArtifactInventoryBound(boundRoot, manifest))
}

async function assertNoBenefitsFixtureLeaksBound(root, descriptors, activeVersion, options) {
  const benefitsRoot = path.join(root, `community/data/company-benefits/${activeVersion}`)
  let files = []
  try { files = await filesRecursively(benefitsRoot) } catch (error) { if (error.code !== 'ENOENT') throw error }
  files.push(...descriptors.map((descriptor) => path.join(root, descriptor.url)))
  files = [...new Set(files)]
  for (const file of files) {
    const artifactPath = path.relative(root, file).split(path.sep).join('/')
    const displayFile = path.join(options.displayRoot ?? root, artifactPath)
    const raw = await readBoundedRegularFile(file, descriptorByteLimit(artifactPath), `benefits fixture scan ${artifactPath}`, options.boundedReadHooks, displayFile)
    for (const pattern of forbiddenText) if (pattern.test(raw) || pattern.test(artifactPath)) throw Error(`forbidden benefits release content ${pattern}: ${displayFile}`)
    if (file.endsWith('.json')) { const value = JSON.parse(raw); rejectForbiddenKeys(value, displayFile); if (JSON.stringify(value).includes('"publishable":false')) throw Error(`historical nonpublishable record: ${displayFile}`) }
  }
}

export async function assertNoBenefitsFixtureLeaks(root, descriptors = [], activeVersion = 'v2', options = {}) {
  return withBoundVerifierRoot(root, (boundRoot, displayRoot) => assertNoBenefitsFixtureLeaksBound(boundRoot, descriptors, activeVersion, { ...options, displayRoot }))
}

export function assertApprovedProjectionBaseHash(rawManifest) {
  const expected = rawManifest.approved_v2_projection?.base_manifest_sha256
  if (!expected) return
  const activeManifest = { ...rawManifest }; delete activeManifest.approved_v2_projection
  const actual = createHash('sha256').update(`${JSON.stringify(activeManifest)}\n`).digest('hex')
  if (actual !== expected) throw Error('approved projection base manifest hash drift')
}

export function assertProjectionCompanyJoin(companies, baseById) {
  if (!(baseById instanceof Map) || baseById.size === 0) throw Error('approved projection canonical base listing index unavailable')
  for (const company of companies) {
    const base = baseById.get(company.company_id)
    if (!base) throw Error('approved projection canonical company identity mismatch')
    assertCompanyIdentityProjection(base, company)
  }
}

export function assertUniqueProjectionEvidenceIds(details) {
  const seen = { claim_id: new Set(), reference_id: new Set(), community_report_id: new Set() }
  for (const detail of details) recordProjectionEvidenceIds(detail, seen)
}

function recordProjectionEvidenceIds(detail, seen) {
  const records = [
    ...detail.claims.map((record) => ['claim_id', record]),
    ...detail.official_claims.map((record) => ['claim_id', record]),
    ...detail.references.map((record) => ['reference_id', record]),
    ...detail.community_reports.map((record) => ['community_report_id', record]),
  ]
  for (const [idField, record] of records) {
    const id = record[idField]
    if (seen[idField].has(id)) throw Error(`approved projection duplicate ${idField}: ${id}`)
    seen[idField].add(id)
  }
}

async function verifyApprovedV2ProjectionBound(root, projection, baseById, baseDetailById, options) {
  const load = async (descriptor) => {
    const raw = await readDescriptor(root, descriptor, options)
    const value = JSON.parse(raw); rejectForbiddenKeys(value, descriptor.url); return value
  }
  await assertExactArtifactInventoryBound(root, projection)
  const companies = []; const byId = new Map(); let previousSequence = 0
  const expectedChunkCount = Math.ceil(projection.projected_company_count / 50)
  if (projection.listing_chunks.length !== expectedChunkCount) throw Error('approved projection listing chunk count mismatch')
  for (const [index, descriptor] of projection.listing_chunks.entries()) {
    const chunk = approvedV2ListingChunkSchema.parse(await load(descriptor))
    const recordCount = Math.min(50, projection.projected_company_count - index * 50)
    const firstSequence = chunk.companies[0]?.population_sequence
    const lastSequence = chunk.companies.at(-1)?.population_sequence
    if (chunk.artifact_protocol !== 'vNext' || chunk.data_version !== projection.data_version || descriptor.chunk_index !== index + 1 || descriptor.record_count !== recordCount || descriptor.first_sequence !== firstSequence || descriptor.last_sequence !== lastSequence || chunk.companies.length !== recordCount || chunk.chunk_index !== index + 1 || chunk.sequence_start !== firstSequence || chunk.sequence_end !== lastSequence || firstSequence <= previousSequence || chunk.companies.some((company, row) => row > 0 && company.population_sequence <= chunk.companies[row - 1].population_sequence)) throw Error(`approved projection listing chunk metadata/sequence mismatch: ${descriptor.url}`)
    previousSequence = lastSequence
    companies.push(...chunk.companies)
  }
  assertListingOutcomes(companies)
  assertExplicitCellInventory(companies, { artifact_protocol: 'vNext', cell_count: projection.cell_count, cell_state_counts: projection.cell_state_counts })
  if (companies.length !== projection.projected_company_count) throw Error('approved projection company count mismatch')
  assertProjectionCompanyJoin(companies, baseById)
  for (const company of companies) byId.set(company.company_id, company)
  if (byId.size !== companies.length) throw Error('approved projection duplicate company')
  const shardIds = Object.keys(projection.company_shards)
  if (shardIds.length !== byId.size || shardIds.some((id) => !byId.has(id))) throw Error('approved projection listing/shard company set mismatch')
  const requiredSourceIds = new Set()
  const evidenceIds = { claim_id: new Set(), reference_id: new Set(), community_report_id: new Set() }
  for (const [id, descriptor] of Object.entries(projection.company_shards)) {
    const detail = detailSchema.parse(await load(descriptor))
    const listingCompany = byId.get(id)
    if (!listingCompany || detail.artifact_protocol !== 'vNext' || descriptor.company_id !== id || detail.company.company_id !== id || detail.company.population_sequence !== listingCompany.population_sequence || detail.data_version !== projection.data_version) throw Error(`approved projection company shard mismatch: ${id}`)
    assertCompanyIdentityProjection(baseById.get(id), listingCompany, detail.company)
    const baseDetailCompany = baseDetailById?.get(id)
    if (!baseDetailCompany) throw Error(`approved projection canonical base detail identity unavailable: ${id}`)
    assertCompanyDetailIdentityProjection(baseDetailCompany, detail.company)
    assertCompanyDetailEvidence(listingCompany, detail)
    recordProjectionEvidenceIds(detail, evidenceIds)
    for (const sourceId of detail.category_outcomes.flatMap((outcome) => outcome.searched_source_ids)) requiredSourceIds.add(sourceId)
    for (const sourceId of detail.claims.flatMap((claim) => claim.source_evidence.map((evidence) => evidence.source_id))) requiredSourceIds.add(sourceId)
    for (const sourceId of detail.official_claims.flatMap((claim) => claim.source_ids)) requiredSourceIds.add(sourceId)
    for (const record of [...detail.references, ...detail.community_reports]) requiredSourceIds.add(record.source_id)
  }
  if (Object.keys(projection.company_shards).length !== projection.projected_company_count) throw Error('approved projection shard count mismatch')
  const methodology = methodologySchema.parse(await load(projection.methodology))
  if (methodology.data_version !== projection.data_version) throw Error('approved projection methodology version mismatch')
  await load(projection.taxonomy)
  const sourceDocument = sourcesDocumentSchema.parse(await load(projection.sources))
  const sourceIds = sourceDocument.sources.map((source) => source.source_id)
  if (sourceDocument.data_version !== projection.data_version || sourceIds.length !== projection.sources.record_count || sourceIds.length !== requiredSourceIds.size || sourceIds.some((sourceId) => !requiredSourceIds.has(sourceId))) throw Error('approved projection source inventory mismatch')
  await assertNoBenefitsFixtureLeaksBound(root, manifestDescriptors(projection), projection.data_version, options)
  return companies.length
}

export async function verifyApprovedV2Projection(root, projection, baseById, baseDetailById, options = {}) {
  return withBoundVerifierRoot(root, (boundRoot, displayRoot) => verifyApprovedV2ProjectionBound(boundRoot, projection, baseById, baseDetailById, { ...options, displayRoot }))
}

async function verifyBenefitsArtifactsBound(root, options) {
  const manifestPath = path.join(root, 'community/data/company-benefits/manifest.json')
  const displayManifestPath = path.join(options.displayRoot ?? root, 'community/data/company-benefits/manifest.json')
  let manifestRaw
  try {
    manifestRaw = await readBoundedRegularFile(manifestPath, manifestByteLimit, 'benefits manifest', options.boundedReadHooks, displayManifestPath)
  } catch (error) { if (error.code === 'ENOENT') { await assertNoBenefitsFixtureLeaksBound(root, [], 'v2', options); return 'Benefits artifacts unavailable: no approved manifest.' } throw error }
  const rawManifest = JSON.parse(manifestRaw); const manifest = manifestSchema.parse(rawManifest); const companies = []; const byId = new Map(); const detailById = new Map()
  await assertExactReleaseRootInventoryBound(root, manifest)
  await assertExactArtifactInventoryBound(root, manifest)
  const load = async (descriptor) => {
    const raw = await readDescriptor(root, descriptor, options)
    rejectForbiddenKeys(JSON.parse(raw), descriptor.url)
    return { raw, value: JSON.parse(raw) }
  }
  for (const descriptor of manifest.listing_chunks) {
    const { value } = await load(descriptor); const chunk = listingChunkSchema.parse(value)
    if ((chunk.artifact_protocol ?? 'v1') !== manifest.artifact_protocol || chunk.companies.length !== descriptor.record_count || chunk.chunk_index !== descriptor.chunk_index || chunk.sequence_start !== descriptor.first_sequence || chunk.sequence_end !== descriptor.last_sequence) throw Error(`benefits listing metadata mismatch: ${descriptor.url}`)
    companies.push(...chunk.companies)
  }
  assertListingOutcomes(companies)
  assertExplicitCellInventory(companies, manifest)
  if (companies.length !== 2000 || companies.some((company, index) => company.population_sequence !== index + 1)) throw Error('benefits canonical population mismatch')
  companies.forEach((company) => byId.set(company.company_id, company))
  for (const [id, descriptor] of Object.entries(manifest.company_shards)) {
    const { value } = await load(descriptor); const detail = detailSchema.parse(value)
    if ((detail.artifact_protocol ?? 'v1') !== manifest.artifact_protocol || descriptor.record_count !== 1 || descriptor.company_id !== id || detail.company.company_id !== id || detail.data_version !== manifest.data_version) throw Error(`benefits company shard mismatch: ${id}`)
    assertCompanyDetailEvidence(byId.get(id), detail)
    detailById.set(id, detail.company)
    for (const outcome of detail.category_outcomes) if (outcome.kind === 'insufficient_evidence' && !outcome.nonabsence_notice) throw Error(`missing nonabsence notice: ${id}`)
  }
  if (Object.keys(manifest.company_shards).length !== 2000) throw Error('benefits company shard count mismatch')
  const methodology = methodologySchema.parse((await load(manifest.methodology)).value)
  if (methodology.data_version !== manifest.data_version) throw Error('benefits methodology version mismatch')
  await load(manifest.taxonomy); await load(manifest.sources)
  const descriptors = manifestDescriptors(manifest)
  await assertNoBenefitsFixtureLeaksBound(root, descriptors, manifest.data_version, options)
  let projectionMessage = ''
  if (manifest.approved_v2_projection) {
    assertApprovedProjectionBaseHash(rawManifest)
    const projected = await verifyApprovedV2ProjectionBound(root, manifest.approved_v2_projection, byId, detailById, options)
    projectionMessage = ` Additive approved-v2 projection: ${projected} approved companies; status in_progress.`
  }
  return `Benefits artifacts ${manifest.data_version}: ${companies.length} companies; ${manifest.listing_chunks.length} listing chunks; ${categories.length} categories.${projectionMessage}`
}

export async function verifyBenefitsArtifacts(root, options = {}) {
  return withBoundVerifierRoot(root, (boundRoot, displayRoot) => verifyBenefitsArtifactsBound(boundRoot, { ...options, displayRoot }))
}
