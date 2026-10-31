import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { manifestSchema, listingChunkSchema, detailSchema, methodologySchema, categories, assertCompanyDetailEvidence, assertListingOutcomes } from '../community-app/src/types/benefits.ts'

const forbiddenText = [/fixture-v1/i, /"fixture"\s*:\s*true/i, /example-\d{3}/i, /example\.org/i, /rankings\.json/i, /rankings_url/i, /\/benefits\/rankings\//i, /가상 별빛|가상 검증기업|예시 데이터|모든 기업·정책·점수는 가상/]
const forbiddenKey = /score|rank|percentile|coverage(?:_percent)?|fitScore|rankOrder/i

async function filesRecursively(root) {
  const output = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(target)
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
    rejectForbiddenKeys(child, location)
  }
}
export async function assertNoBenefitsFixtureLeaks(root) {
  const benefitsRoot = path.join(root, 'community')
  let files
  try { files = await filesRecursively(benefitsRoot) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  for (const file of files) {
    if (!/benefits|company-benefits|assets/.test(file)) continue
    const raw = await readFile(file, 'utf8').catch(() => '')
    for (const pattern of forbiddenText) if (pattern.test(raw) || pattern.test(file)) throw Error(`forbidden benefits release content ${pattern}: ${file}`)
    if (file.endsWith('.json')) { const value = JSON.parse(raw); rejectForbiddenKeys(value, file); if (JSON.stringify(value).includes('"publishable":false')) throw Error(`historical nonpublishable record: ${file}`) }
  }
}

export async function verifyBenefitsArtifacts(root) {
  const manifestPath = path.join(root, 'community/data/company-benefits/manifest.json')
  let manifestRaw
  try { manifestRaw = await readFile(manifestPath, 'utf8') } catch (error) { if (error.code === 'ENOENT') { await assertNoBenefitsFixtureLeaks(root); return 'Benefits artifacts unavailable: no approved manifest.' } throw error }
  const manifest = manifestSchema.parse(JSON.parse(manifestRaw)); const companies = []; const byId = new Map()
  const load = async (descriptor) => {
    const target = path.join(root, descriptor.url.slice(1)); const raw = await readFile(target, 'utf8')
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
  await load(manifest.taxonomy); await load(manifest.sources); await assertNoBenefitsFixtureLeaks(root)
  return `Benefits artifacts v2: ${companies.length} companies; ${manifest.listing_chunks.length} listing chunks; ${categories.length} categories.`
}
