import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { manifestSchema, listingChunkSchema, approvedV2ListingChunkSchema, detailSchema, methodologySchema, sourcesDocumentSchema, categories, assertCompanyDetailEvidence, assertCompanyDetailIdentityProjection, assertCompanyIdentityProjection, assertExplicitCellInventory, assertListingOutcomes } from '../community-app/src/types/benefits.ts'

const forbiddenText = [/fixture-v1/i, /"fixture"\s*:\s*true/i, /example-\d{3}/i, /example\.org/i, /rankings\.json/i, /rankings_url/i, /\/benefits\/rankings\//i, /가상 별빛|가상 검증기업|예시 데이터|모든 기업·정책·점수는 가상/]
const forbiddenKey = /score|rank|percentile|coverage(?:_percent)?|fitScore|rankOrder/i
const internalReviewKeys = new Set(['review', 'review_id', 'researcher_id', 'reviewer_id', 'reviewed_at', 'requested_at', 'review_status', 'decision', 'quote_entailment_confirmed', 'source_entailment_reviews', 'conflict_determination', 'approval', 'approval_status', 'approved', 'approved_at', 'approved_by'])
const manifestByteLimit = 16 * 1024 * 1024
const descriptorByteLimits = { company: 2 * 1024 * 1024, listing: 16 * 1024 * 1024, sources: 64 * 1024 * 1024, small: 4 * 1024 * 1024 }

const descriptorPath = (handle) => `/proc/self/fd/${handle.fd}`
const isWithin = (parent, child) => child === parent || child.startsWith(`${parent}${path.sep}`)
const stableDirectoryIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino && left.mode === right.mode
const stableFileIdentity = (left, right) => stableDirectoryIdentity(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs

async function validateBoundEntry(parent, name, expected, label, flags) {
  let observed
  try {
    observed = await open(path.join(descriptorPath(parent), name), flags)
    const metadata = await observed.stat({ bigint: true })
    if (!stableDirectoryIdentity(expected, metadata)) throw Error(`${label} identity changed`)
  } catch (error) {
    if (error.message?.includes('identity changed')) throw error
    throw Error(`${label} identity changed`, { cause: error })
  } finally {
    await observed?.close()
  }
}

async function withBoundDirectory(parent, components, label, run, hooks = {}, displayRoot = '') {
  const handles = []
  const bindings = []
  let current = parent
  let result
  let runError
  try {
    for (const component of components) {
      const child = await open(path.join(descriptorPath(current), component), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
      handles.push(child)
      const metadata = await child.stat({ bigint: true })
      if (!metadata.isDirectory()) throw Error(`unsafe ${label} directory: ${component}`)
      bindings.push({ parent: current, name: component, metadata })
      current = child
      await hooks.afterDirectoryOpen?.({ pathname: path.join(displayRoot, ...components.slice(0, bindings.length)), component })
    }
    try { result = await run(current) } catch (error) { runError = error }
    for (const binding of bindings) {
      await validateBoundEntry(binding.parent, binding.name, binding.metadata, label, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    }
    if (runError) throw runError
    return result
  } finally {
    await Promise.allSettled(handles.reverse().map((handle) => handle.close()))
  }
}

async function withBoundVerifierRoot(root, run, hooks = {}) {
  if (constants.O_NOFOLLOW === undefined || constants.O_DIRECTORY === undefined) throw Error('safe benefits directory flags unavailable')
  const displayRoot = path.resolve(root)
  const handles = []
  const bindings = []
  let result
  let runError
  try {
    const site = await open(displayRoot, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    handles.push(site)
    if (!(await site.stat()).isDirectory()) throw Error('unsafe benefits parent chain directory: site root')
    const resolvedSite = await realpath(displayRoot)
    if (await realpath(descriptorPath(site)) !== resolvedSite) throw Error('unsafe benefits parent chain identity: site root')
    let parent = site
    let releaseRoot = null
    for (const component of ['community', 'data', 'company-benefits']) {
      let child
      try {
        child = await open(path.join(descriptorPath(parent), component), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
      } catch (error) {
        if (error.code === 'ENOENT') break
        throw Error(`unsafe benefits parent chain directory: ${component}`, { cause: error })
      }
      handles.push(child)
      const metadata = await child.stat({ bigint: true })
      bindings.push({ parent, name: component, metadata })
      if (!metadata.isDirectory()) throw Error(`unsafe benefits parent chain directory: ${component}`)
      const resolvedChild = await realpath(descriptorPath(child))
      if (!isWithin(resolvedSite, resolvedChild)) throw Error(`unsafe benefits parent chain escaped site root: ${component}`)
      parent = child
      if (component === 'company-benefits') releaseRoot = child
    }
    try { result = await run(releaseRoot, displayRoot) } catch (error) { runError = error }
    for (const binding of bindings) {
      const label = binding.name === 'company-benefits' ? 'benefits release root' : `benefits parent chain ${binding.name}`
      await validateBoundEntry(binding.parent, binding.name, binding.metadata, label, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    }
    if (runError) throw runError
    return result
  } finally {
    await Promise.allSettled(handles.reverse().map((handle) => handle.close()))
  }
}

function releaseRelative(url) {
  const prefix = 'community/data/company-benefits/'
  if (typeof url !== 'string' || !url.startsWith(prefix)) throw Error(`unsafe benefits descriptor path: ${url}`)
  const relative = url.slice(prefix.length)
  const components = relative.split('/')
  if (!relative || components.some((component) => !component || component === '.' || component === '..')) throw Error(`unsafe benefits descriptor path: ${url}`)
  return components
}

async function readBoundedRegularFile(rootHandle, relative, limit, label, hooks = {}, displayPath = relative) {
  if (constants.O_NOFOLLOW === undefined) throw Error(`safe no-follow reads unavailable: ${label}`)
  const components = Array.isArray(relative) ? relative : relative.split('/')
  const filename = components.at(-1)
  return withBoundDirectory(rootHandle, components.slice(0, -1), label, async (parent) => {
    let handle
    let result
    let runError
    let initial
    try {
      handle = await open(path.join(descriptorPath(parent), filename), constants.O_RDONLY | constants.O_NOFOLLOW)
      initial = await handle.stat({ bigint: true })
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
      result = buffer.toString('utf8')
    } catch (error) { runError = error }
    await handle?.close()
    if (initial) {
      try {
        await validateBoundEntry(parent, filename, initial, label, constants.O_RDONLY | constants.O_NOFOLLOW)
      } catch (error) {
        runError = Error(`${label} changed during bounded read`, { cause: error })
      }
    }
    if (runError) throw runError
    return result
  }, hooks, path.dirname(displayPath))
}

async function filesRecursively(rootHandle, relativeRoot, hooks = {}, displayRoot = '') {
  const output = []
  async function visit(directory, relativeComponents) {
    for (const entry of await readdir(descriptorPath(directory), { withFileTypes: true })) {
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw Error(`unsafe artifact entry: ${path.join(displayRoot, ...relativeComponents, entry.name)}`)
      if (entry.isDirectory()) {
        await withBoundDirectory(directory, [entry.name], 'benefits artifact directory', (child) => visit(child, [...relativeComponents, entry.name]), hooks, path.join(displayRoot, ...relativeComponents))
      } else {
        let file
        try {
          file = await open(path.join(descriptorPath(directory), entry.name), constants.O_RDONLY | constants.O_NOFOLLOW)
          const metadata = await file.stat({ bigint: true })
          if (!metadata.isFile()) throw Error(`unsafe artifact entry: ${entry.name}`)
          await validateBoundEntry(directory, entry.name, metadata, 'benefits artifact file', constants.O_RDONLY | constants.O_NOFOLLOW)
        } finally {
          await file?.close()
        }
        output.push([...relativeComponents, entry.name].join('/'))
      }
    }
  }
  await withBoundDirectory(rootHandle, relativeRoot, 'benefits version directory', (directory) => visit(directory, relativeRoot), hooks, displayRoot)
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

async function readDescriptor(releaseRoot, descriptor, options = {}) {
  const limit = descriptorByteLimit(descriptor.url)
  if (descriptor.byte_count > limit) throw Error(`benefits descriptor byte count exceeds artifact limit: ${descriptor.url}`)
  const relative = releaseRelative(descriptor.url)
  const displayTarget = path.join(options.displayRoot ?? '', descriptor.url)
  const raw = await readBoundedRegularFile(releaseRoot, relative, limit, `benefits artifact ${descriptor.url}`, options.boundedReadHooks, displayTarget)
  if (Buffer.byteLength(raw) !== descriptor.byte_count) throw Error(`benefits byte count mismatch: ${descriptor.url}`)
  if (createHash('sha256').update(raw).digest('hex') !== descriptor.sha256) throw Error(`benefits hash mismatch: ${descriptor.url}`)
  return raw
}

async function assertExactReleaseRootInventoryBound(releaseRoot, manifest) {
  const expected = new Map([['manifest.json', 'file'], [manifest.data_version, 'directory']])
  if (manifest.approved_v2_projection) expected.set(manifest.approved_v2_projection.data_version, 'directory')
  const entries = await readdir(descriptorPath(releaseRoot), { withFileTypes: true })
  if (entries.length !== expected.size || entries.some((entry) => !expected.has(entry.name))) throw Error('benefits release root inventory mismatch')
  for (const entry of entries) {
    const expectedKind = expected.get(entry.name)
    if (entry.isSymbolicLink() || (expectedKind === 'file' && !entry.isFile()) || (expectedKind === 'directory' && !entry.isDirectory())) throw Error('benefits release root inventory mismatch')
    if (expectedKind === 'directory') {
      await withBoundDirectory(releaseRoot, [entry.name], 'benefits release version', async () => {})
    } else {
      let file
      try {
        file = await open(path.join(descriptorPath(releaseRoot), entry.name), constants.O_RDONLY | constants.O_NOFOLLOW)
        const metadata = await file.stat({ bigint: true })
        if (!metadata.isFile()) throw Error('benefits release root inventory mismatch')
        await validateBoundEntry(releaseRoot, entry.name, metadata, 'benefits release manifest', constants.O_RDONLY | constants.O_NOFOLLOW)
      } finally {
        await file?.close()
      }
    }
  }
}

export async function assertExactReleaseRootInventory(root, manifest) {
  return withBoundVerifierRoot(root, (releaseRoot) => {
    if (!releaseRoot) throw Object.assign(Error('benefits release root unavailable'), { code: 'ENOENT' })
    return assertExactReleaseRootInventoryBound(releaseRoot, manifest)
  })
}

async function assertExactArtifactInventoryBound(releaseRoot, manifest, options = {}) {
  const files = await filesRecursively(releaseRoot, [manifest.data_version], options.boundedReadHooks, path.join(options.displayRoot ?? '', 'community/data/company-benefits'))
  const actual = files.sort()
  const expected = manifestDescriptors(manifest).map((descriptor) => releaseRelative(descriptor.url).join('/')).sort()
  if (actual.length !== expected.length || actual.some((file, index) => file !== expected[index])) throw Error('benefits artifact inventory mismatch')
}

export async function assertExactArtifactInventory(root, manifest, options = {}) {
  return withBoundVerifierRoot(root, (releaseRoot, displayRoot) => {
    if (!releaseRoot) throw Object.assign(Error('benefits release root unavailable'), { code: 'ENOENT' })
    return assertExactArtifactInventoryBound(releaseRoot, manifest, { ...options, displayRoot })
  })
}

async function assertNoBenefitsFixtureLeaksBound(releaseRoot, descriptors, activeVersion, options) {
  if (!releaseRoot) return
  let files = []
  try { files = await filesRecursively(releaseRoot, [activeVersion], options.boundedReadHooks, path.join(options.displayRoot ?? '', 'community/data/company-benefits')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  files.push(...descriptors.map((descriptor) => releaseRelative(descriptor.url).join('/')))
  files = [...new Set(files)]
  for (const file of files) {
    const artifactPath = `community/data/company-benefits/${file}`
    const displayFile = path.join(options.displayRoot ?? '', artifactPath)
    const raw = await readBoundedRegularFile(releaseRoot, file, descriptorByteLimit(artifactPath), `benefits fixture scan ${artifactPath}`, options.boundedReadHooks, displayFile)
    for (const pattern of forbiddenText) if (pattern.test(raw) || pattern.test(artifactPath)) throw Error(`forbidden benefits release content ${pattern}: ${displayFile}`)
    if (file.endsWith('.json')) { const value = JSON.parse(raw); rejectForbiddenKeys(value, displayFile); if (JSON.stringify(value).includes('"publishable":false')) throw Error(`historical nonpublishable record: ${displayFile}`) }
  }
}

export async function assertNoBenefitsFixtureLeaks(root, descriptors = [], activeVersion = 'v2', options = {}) {
  return withBoundVerifierRoot(root, (releaseRoot, displayRoot) => assertNoBenefitsFixtureLeaksBound(releaseRoot, descriptors, activeVersion, { ...options, displayRoot }))
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

export function assertSpecificBenefitInventory(listingCompany, detail) {
  const sourceEligibility = new Map(detail.sources.map((source) => [source.source_id, source.publication_eligibility]))
  const counts = new Map()
  const record = (categoryId, canonicalId) => {
    if (!counts.has(categoryId)) counts.set(categoryId, new Set())
    counts.get(categoryId).add(canonicalId)
  }
  for (const reference of detail.references) {
    if (['eligible', 'reference_only'].includes(reference.publication_eligibility)
      && ['eligible', 'reference_only'].includes(sourceEligibility.get(reference.source_id))) {
      record(reference.category_id, reference.reference_id)
    }
  }
  for (const report of detail.community_reports) {
    if (report.publication_eligibility === 'eligible' && sourceEligibility.get(report.source_id) === 'eligible') {
      record(report.category_id, report.community_report_id)
    }
  }
  for (const outcome of listingCompany.category_outcomes) {
    const actual = counts.get(outcome.category_id)?.size ?? 0
    if (actual !== outcome.specific_benefit_count) throw Error(`approved projection specific benefit inventory mismatch: ${listingCompany.company_id}:${outcome.category_id}`)
  }
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

async function verifyApprovedV2ProjectionBound(releaseRoot, projection, baseById, baseDetailById, options) {
  const load = async (descriptor) => {
    const raw = await readDescriptor(releaseRoot, descriptor, options)
    const value = JSON.parse(raw); rejectForbiddenKeys(value, descriptor.url); return value
  }
  await assertExactArtifactInventoryBound(releaseRoot, projection, options)
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
    assertSpecificBenefitInventory(listingCompany, detail)
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
  await assertNoBenefitsFixtureLeaksBound(releaseRoot, manifestDescriptors(projection), projection.data_version, options)
  return companies.length
}

export async function verifyApprovedV2Projection(root, projection, baseById, baseDetailById, options = {}) {
  return withBoundVerifierRoot(root, (releaseRoot, displayRoot) => {
    if (!releaseRoot) throw Object.assign(Error('benefits release root unavailable'), { code: 'ENOENT' })
    return verifyApprovedV2ProjectionBound(releaseRoot, projection, baseById, baseDetailById, { ...options, displayRoot })
  })
}

async function verifyBenefitsArtifactsBound(releaseRoot, options) {
  const displayManifestPath = path.join(options.displayRoot ?? '', 'community/data/company-benefits/manifest.json')
  if (!releaseRoot) return 'Benefits artifacts unavailable: no approved manifest.'
  let manifestRaw
  try {
    manifestRaw = await readBoundedRegularFile(releaseRoot, ['manifest.json'], manifestByteLimit, 'benefits manifest', options.boundedReadHooks, displayManifestPath)
  } catch (error) { if (error.code === 'ENOENT') { await assertNoBenefitsFixtureLeaksBound(releaseRoot, [], 'v2', options); return 'Benefits artifacts unavailable: no approved manifest.' } throw error }
  const rawManifest = JSON.parse(manifestRaw); const manifest = manifestSchema.parse(rawManifest); const companies = []; const byId = new Map(); const detailById = new Map()
  await assertExactReleaseRootInventoryBound(releaseRoot, manifest)
  await assertExactArtifactInventoryBound(releaseRoot, manifest, options)
  const load = async (descriptor) => {
    const raw = await readDescriptor(releaseRoot, descriptor, options)
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
  await assertNoBenefitsFixtureLeaksBound(releaseRoot, descriptors, manifest.data_version, options)
  let projectionMessage = ''
  if (manifest.approved_v2_projection) {
    assertApprovedProjectionBaseHash(rawManifest)
    const projected = await verifyApprovedV2ProjectionBound(releaseRoot, manifest.approved_v2_projection, byId, detailById, options)
    projectionMessage = ` Additive approved-v2 projection: ${projected} approved companies; status in_progress.`
  }
  return `Benefits artifacts ${manifest.data_version}: ${companies.length} companies; ${manifest.listing_chunks.length} listing chunks; ${categories.length} categories.${projectionMessage}`
}

export async function verifyBenefitsArtifacts(root, options = {}) {
  return withBoundVerifierRoot(root, (boundRoot, displayRoot) => verifyBenefitsArtifactsBound(boundRoot, { ...options, displayRoot }))
}
