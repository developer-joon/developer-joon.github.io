import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { manifestSchema, listingChunkSchema, approvedV2ListingChunkSchema, detailSchema, methodologySchema, sourcesDocumentSchema, categories, assertCompanyDetailEvidence, assertExplicitCellInventory, assertListingOutcomes } from '../community-app/src/types/benefits.ts'

const forbiddenText = [/fixture-v1/i, /"fixture"\s*:\s*true/i, /example-\d{3}/i, /example\.org/i, /rankings\.json/i, /rankings_url/i, /\/benefits\/rankings\//i, /가상 별빛|가상 검증기업|예시 데이터|모든 기업·정책·점수는 가상/]
const forbiddenKey = /score|rank|percentile|coverage(?:_percent)?|fitScore|rankOrder/i
const internalReviewKeys = new Set(['review', 'review_id', 'researcher_id', 'reviewer_id', 'reviewed_at', 'requested_at', 'review_status', 'decision', 'quote_entailment_confirmed', 'source_entailment_reviews', 'conflict_determination', 'approval', 'approval_status', 'approved', 'approved_at', 'approved_by'])

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

export async function assertExactArtifactInventory(root, manifest) {
  const prefix = `community/data/company-benefits/${manifest.data_version}`
  const benefitsRoot = path.join(root, prefix)
  const files = await filesRecursively(benefitsRoot)
  const actual = files.map((file) => path.relative(root, file).split(path.sep).join('/')).sort()
  const expected = manifestDescriptors(manifest).map((descriptor) => descriptor.url).sort()
  if (actual.length !== expected.length || actual.some((file, index) => file !== expected[index])) throw Error('benefits artifact inventory mismatch')
}

export async function assertNoBenefitsFixtureLeaks(root, descriptors = [], activeVersion = 'v2') {
  const benefitsRoot = path.join(root, `community/data/company-benefits/${activeVersion}`)
  let files = []
  try { files = await filesRecursively(benefitsRoot) } catch (error) { if (error.code !== 'ENOENT') throw error }
  files.push(...descriptors.map((descriptor) => path.join(root, descriptor.url)))
  files = [...new Set(files)]
  for (const file of files) {
    const artifactPath = path.relative(root, file).split(path.sep).join('/')
    const raw = await readFile(file, 'utf8').catch(() => '')
    for (const pattern of forbiddenText) if (pattern.test(raw) || pattern.test(artifactPath)) throw Error(`forbidden benefits release content ${pattern}: ${file}`)
    if (file.endsWith('.json')) { const value = JSON.parse(raw); rejectForbiddenKeys(value, file); if (JSON.stringify(value).includes('"publishable":false')) throw Error(`historical nonpublishable record: ${file}`) }
  }
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
    if (!base || base.population_sequence !== company.population_sequence) throw Error('approved projection canonical company/population_sequence join mismatch')
  }
}

export async function verifyApprovedV2Projection(root, projection, baseById) {
  const load = async (descriptor) => {
    const target = path.join(root, descriptor.url); const raw = await readFile(target, 'utf8')
    if (Buffer.byteLength(raw) !== descriptor.byte_count) throw Error(`benefits byte count mismatch: ${descriptor.url}`)
    if (createHash('sha256').update(raw).digest('hex') !== descriptor.sha256) throw Error(`benefits hash mismatch: ${descriptor.url}`)
    const value = JSON.parse(raw); rejectForbiddenKeys(value, descriptor.url); return value
  }
  await assertExactArtifactInventory(root, projection)
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
  for (const [id, descriptor] of Object.entries(projection.company_shards)) {
    const detail = detailSchema.parse(await load(descriptor))
    const listingCompany = byId.get(id)
    if (!listingCompany || detail.artifact_protocol !== 'vNext' || descriptor.company_id !== id || detail.company.company_id !== id || detail.company.population_sequence !== listingCompany.population_sequence || detail.data_version !== projection.data_version) throw Error(`approved projection company shard mismatch: ${id}`)
    assertCompanyDetailEvidence(listingCompany, detail)
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
  await assertNoBenefitsFixtureLeaks(root, manifestDescriptors(projection), projection.data_version)
  return companies.length
}

export async function verifyBenefitsArtifacts(root) {
  const manifestPath = path.join(root, 'community/data/company-benefits/manifest.json')
  let manifestRaw
  try { manifestRaw = await readFile(manifestPath, 'utf8') } catch (error) { if (error.code === 'ENOENT') { await assertNoBenefitsFixtureLeaks(root); return 'Benefits artifacts unavailable: no approved manifest.' } throw error }
  const rawManifest = JSON.parse(manifestRaw); const manifest = manifestSchema.parse(rawManifest); const companies = []; const byId = new Map()
  await assertExactArtifactInventory(root, manifest)
  const load = async (descriptor) => {
    const target = path.join(root, descriptor.url); const raw = await readFile(target, 'utf8')
    if (Buffer.byteLength(raw) !== descriptor.byte_count) throw Error(`benefits byte count mismatch: ${descriptor.url}`)
    if (createHash('sha256').update(raw).digest('hex') !== descriptor.sha256) throw Error(`benefits hash mismatch: ${descriptor.url}`)
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
    for (const outcome of detail.category_outcomes) if (outcome.kind === 'insufficient_evidence' && !outcome.nonabsence_notice) throw Error(`missing nonabsence notice: ${id}`)
  }
  if (Object.keys(manifest.company_shards).length !== 2000) throw Error('benefits company shard count mismatch')
  const methodology = methodologySchema.parse((await load(manifest.methodology)).value)
  if (methodology.data_version !== manifest.data_version) throw Error('benefits methodology version mismatch')
  await load(manifest.taxonomy); await load(manifest.sources)
  const descriptors = manifestDescriptors(manifest)
  await assertNoBenefitsFixtureLeaks(root, descriptors, manifest.data_version)
  let projectionMessage = ''
  if (manifest.approved_v2_projection) {
    assertApprovedProjectionBaseHash(rawManifest)
    const projected = await verifyApprovedV2Projection(root, manifest.approved_v2_projection, byId)
    projectionMessage = ` Additive approved-v2 projection: ${projected} approved companies; status in_progress.`
  }
  return `Benefits artifacts ${manifest.data_version}: ${companies.length} companies; ${manifest.listing_chunks.length} listing chunks; ${categories.length} categories.${projectionMessage}`
}
