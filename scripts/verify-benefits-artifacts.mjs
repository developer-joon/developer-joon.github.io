import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { gzipSync, brotliCompressSync } from 'node:zlib'
import {
  manifestSchema,
  indexSchema,
  rankingsSchema,
  detailsSchema,
  methodologySchema,
  categories,
  statuses,
  assertRankingEvidence,
  assertDetailEvidence,
} from '../community-app/src/types/benefits.ts'

export function buildBenefitsLookupMaps(manifest, index) {
  const companyById = new Map(
    index.companies.map((company) => [company.company_id, company]),
  )
  const expectedIdsByUrl = new Map()
  for (const [companyId, url] of Object.entries(manifest.detail_shards)) {
    const expected = expectedIdsByUrl.get(url)
    if (expected) expected.push(companyId)
    else expectedIdsByUrl.set(url, [companyId])
  }
  return { companyById, expectedIdsByUrl }
}

export async function verifyBenefitsArtifacts(root) {
  const get = (relative) => readFile(path.join(root, relative), 'utf8')
  const manifest = manifestSchema.parse(
    JSON.parse(await get('community/data/company-benefits/manifest.json')),
  )
  if (
    new Set(manifest.category_taxonomy).size !== categories.length ||
    new Set(manifest.status_taxonomy).size !== statuses.length
  )
    throw Error('benefits taxonomy mismatch')
  const results = new Map()
  for (const [url, descriptor] of Object.entries(manifest.artifact_sha256)) {
    const raw = await get(url.slice(1))
    if (createHash('sha256').update(raw).digest('hex') !== descriptor.sha256)
      throw Error(`benefits hash 무결성 오류: ${url}`)
    const schema =
      url === manifest.index_url
        ? indexSchema
        : url === manifest.rankings_url
          ? rankingsSchema
          : url === manifest.methodology_url
            ? methodologySchema
            : detailsSchema
    const data = schema.parse(JSON.parse(raw))
    const records = data.companies ?? data.rows ?? data.paragraphs
    if (records.length !== descriptor.record_count)
      throw Error(`benefits record count mismatch: ${url}`)
    results.set(url, data)
  }
  const index = results.get(manifest.index_url),
    rankings = results.get(manifest.rankings_url),
    methodology = results.get(manifest.methodology_url)
  if (!index || !rankings || !methodology)
    throw Error('benefits required payload missing')
  const ids = new Set(index.companies.map((c) => c.company_id))
  if (
    ids.size !== index.companies.length ||
    ids.size !== manifest.company_count ||
    Object.keys(manifest.detail_shards).length !== ids.size
  )
    throw Error('benefits company count mismatch')
  const { companyById, expectedIdsByUrl } = buildBenefitsLookupMaps(
    manifest,
    index,
  )
  assertRankingEvidence(index, rankings)
  const keys = new Set(
    rankings.rows.map((r) => `${r.company_id}:${r.category}`),
  )
  if (
    keys.size !== rankings.rows.length ||
    keys.size !== ids.size * categories.length ||
    rankings.rows.some((r) => !ids.has(r.company_id))
  )
    throw Error('benefits rankings references mismatch')
  const verifiedDetailIds = new Set()
  for (const [url, data] of results) {
    if (!url.includes('/details/')) continue
    const seen = new Set()
    const expected = expectedIdsByUrl.get(url) ?? []
    for (const c of data.companies) {
      if (
        !ids.has(c.company_id) ||
        seen.has(c.company_id) ||
        manifest.detail_shards[c.company_id] !== url
      )
        throw Error('benefits detail references mismatch')
      seen.add(c.company_id)
      verifiedDetailIds.add(c.company_id)
      assertDetailEvidence(
        companyById.get(c.company_id),
        c,
      )
    }
    if (
      expected.length === 0 ||
      seen.size !== expected.length ||
      expected.some((companyId) => !seen.has(companyId))
    )
      throw Error('benefits detail shard completeness mismatch')
  }
  if (
    verifiedDetailIds.size !== ids.size ||
    [...ids].some((id) => !verifiedDetailIds.has(id))
  )
    throw Error('benefits detail mapping missing')
  const raw = await get(manifest.index_url.slice(1))
  return `Benefits fixture: ${ids.size} companies; index ${Buffer.byteLength(raw)} bytes, gzip ${gzipSync(raw).length}, brotli ${brotliCompressSync(raw).length}.`
}
