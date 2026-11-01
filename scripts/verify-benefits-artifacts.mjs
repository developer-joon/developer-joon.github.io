import { createHash } from 'node:crypto'
import { lstat, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { manifestSchema, listingChunkSchema, detailSchema, methodologySchema, categories, assertCompanyDetailEvidence, assertExplicitCellInventory, assertListingOutcomes } from '../community-app/src/types/benefits.ts'

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

export async function verifyBenefitsArtifacts(root) {
  const manifestPath = path.join(root, 'community/data/company-benefits/manifest.json')
  let manifestRaw
  try { manifestRaw = await readFile(manifestPath, 'utf8') } catch (error) { if (error.code === 'ENOENT') { await assertNoBenefitsFixtureLeaks(root); return 'Benefits artifacts unavailable: no approved manifest.' } throw error }
  const manifest = manifestSchema.parse(JSON.parse(manifestRaw)); const companies = []; const byId = new Map()
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
    if (chunk.companies.length !== descriptor.record_count || chunk.chunk_index !== descriptor.chunk_index || chunk.sequence_start !== descriptor.first_sequence || chunk.sequence_end !== descriptor.last_sequence) throw Error(`benefits listing metadata mismatch: ${descriptor.url}`)
    companies.push(...chunk.companies)
  }
  assertListingOutcomes(companies)
  assertExplicitCellInventory(companies, manifest)
  if (companies.length !== 2000 || companies.some((company, index) => company.population_sequence !== index + 1)) throw Error('benefits canonical population mismatch')
  companies.forEach((company) => byId.set(company.company_id, company))
  for (const [id, descriptor] of Object.entries(manifest.company_shards)) {
    const { value } = await load(descriptor); const detail = detailSchema.parse(value)
    if (descriptor.record_count !== 1 || descriptor.company_id !== id || detail.company.company_id !== id || detail.data_version !== manifest.data_version) throw Error(`benefits company shard mismatch: ${id}`)
    assertCompanyDetailEvidence(byId.get(id), detail)
    for (const outcome of detail.category_outcomes) if (outcome.kind === 'insufficient_evidence' && !outcome.nonabsence_notice) throw Error(`missing nonabsence notice: ${id}`)
  }
  if (Object.keys(manifest.company_shards).length !== 2000) throw Error('benefits company shard count mismatch')
  const methodology = methodologySchema.parse((await load(manifest.methodology)).value)
  if (methodology.data_version !== manifest.data_version) throw Error('benefits methodology version mismatch')
  await load(manifest.taxonomy); await load(manifest.sources)
  const descriptors = manifestDescriptors(manifest)
  await assertNoBenefitsFixtureLeaks(root, descriptors, manifest.data_version)
  return `Benefits artifacts ${manifest.data_version}: ${companies.length} companies; ${manifest.listing_chunks.length} listing chunks; ${categories.length} categories.`
}
