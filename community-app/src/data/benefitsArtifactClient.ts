import { z } from 'zod'
import { approvedV2ListingChunkSchema, assertCompanyDetailEvidence, assertCompanyDetailIdentityProjection, assertCompanyIdentityProjection, assertExplicitCellInventory, assertListingOutcomes, detailSchema, listingChunkSchema, manifestSchema, methodologySchema, sourcesDocumentSchema, type BenefitCompanyView, type CompanyListing, type Detail, type Manifest, type SourcesDocument } from '../types/benefits'

const RESPONSE_LIMIT = 12_000_000
const SHARD_LIMIT = 256_000
const BATCH_LIMIT = 1_000_000

type Descriptor = { url: string; sha256: string; record_count: number; byte_count: number }
type ArtifactContext = { data_version: string }
export type BenefitAtlasData = { manifest: Manifest; companies: BenefitCompanyView[]; approvedV2Sources?: SourcesDocument }
export type BenefitCompanyDetailView = { legacy: Detail; approvedV2?: Detail }
const safePathSegment = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/
const requestUrl = (manifest: ArtifactContext, descriptor: Descriptor) => {
  const segments = descriptor.url.split('/')
  if (descriptor.url !== `community/data/company-benefits/${manifest.data_version}/${segments.slice(4).join('/')}` || segments.some((segment) => !safePathSegment.test(segment))) throw new Error('artifact 경로 오류')
  return `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`
}

export class BenefitsArtifactClient {
  private cache = new Map<string, Promise<unknown>>()
  constructor(private request: (url: string, signal?: AbortSignal) => Promise<Response> = (url, signal) => fetch(url, { credentials: 'omit', redirect: 'error', signal }), private subtle: SubtleCrypto = crypto.subtle) {}

  private async raw(url: string, signal?: AbortSignal, maxBytes = RESPONSE_LIMIT, account?: (bytes: number) => void) {
    signal?.throwIfAborted()
    const response = await this.request(url, signal)
    if (!response.ok) throw new Error('데이터 요청 실패')
    const declared = response.headers.get('content-length')
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) { await response.body?.cancel(); throw new Error('데이터 크기 초과') }
    if (!response.body) {
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength > maxBytes) throw new Error('데이터 크기 초과')
      account?.(bytes.byteLength)
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0
    const abort = () => { void reader.cancel(signal?.reason) }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      while (true) {
        signal?.throwIfAborted(); const { done, value } = await reader.read(); if (done) break
        if (!value || value.byteLength > maxBytes - size) { await reader.cancel(); throw new Error('데이터 크기 초과') }
        size += value.byteLength; account?.(value.byteLength); chunks.push(value)
      }
    } finally { signal?.removeEventListener('abort', abort) }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new Error('데이터 UTF-8 오류') }
  }

  async loadManifest(signal?: AbortSignal) {
    const parsed = JSON.parse(await this.raw('/community/data/company-benefits/manifest.json', signal))
    const manifest = manifestSchema.parse(parsed)
    if (manifest.approved_v2_projection) {
      const base = { ...parsed }; delete base.approved_v2_projection
      const encoded = new TextEncoder().encode(`${JSON.stringify(base)}\n`)
      const digest = await this.subtle.digest('SHA-256', encoded)
      const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
      if (actual !== manifest.approved_v2_projection.base_manifest_sha256) throw new Error('approved projection base manifest 무결성 오류')
    }
    signal?.throwIfAborted()
    return manifest
  }

  private async payload<T>(manifest: ArtifactContext, descriptor: Descriptor, schema: z.ZodType<T>, count: (value: T) => number, signal?: AbortSignal, limits?: { maxBytes: number; account?: (bytes: number) => void }) {
    if (!descriptor.url.startsWith(`community/data/company-benefits/${manifest.data_version}/`)) throw new Error('artifact 버전 경로 불일치')
    const key = `${manifest.data_version}:${descriptor.url}:${descriptor.sha256}`
    const load = async () => {
      const raw = await this.raw(requestUrl(manifest, descriptor), signal, limits?.maxBytes, limits?.account)
      const encoded = new TextEncoder().encode(raw)
      if (encoded.byteLength !== descriptor.byte_count) throw new Error('byte count 불일치')
      const digest = await this.subtle.digest('SHA-256', encoded)
      const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
      if (actual !== descriptor.sha256) throw new Error('무결성 오류')
      const value = schema.parse(JSON.parse(raw))
      if (count(value) !== descriptor.record_count) throw new Error('record count 불일치')
      return value
    }
    if (signal) return load()
    if (!this.cache.has(key)) this.cache.set(key, load().catch((error) => { this.cache.delete(key); throw error }))
    return this.cache.get(key) as Promise<T>
  }

  async loadListingChunks(manifest: Manifest, signal?: AbortSignal): Promise<CompanyListing[]> {
    const results: CompanyListing[][] = Array.from({ length: manifest.listing_chunks.length }, () => [])
    let next = 0; let failure: unknown
    const controller = new AbortController(); const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    const worker = async () => {
      while (!failure && next < manifest.listing_chunks.length) {
        const index = next++; const descriptor = manifest.listing_chunks[index]
        try {
          const chunk = await this.payload(manifest, descriptor, listingChunkSchema, (value) => value.companies.length, combined)
          if ((chunk.artifact_protocol ?? 'v1') !== manifest.artifact_protocol || chunk.data_version !== manifest.data_version || chunk.taxonomy_version !== manifest.taxonomy_version || chunk.chunk_index !== descriptor.chunk_index || chunk.sequence_start !== descriptor.first_sequence || chunk.sequence_end !== descriptor.last_sequence) throw new Error('목록 chunk 메타데이터 불일치')
          chunk.companies.forEach((company, offset) => { if (company.population_sequence !== descriptor.first_sequence + offset || !manifest.company_shards[company.company_id]) throw new Error('목록 회사 참조 불일치') })
          results[index] = chunk.companies
        } catch (error) { failure ??= error; controller.abort(error) }
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker))
    if (failure) throw failure
    const companies = results.flat(); if (companies.length !== manifest.company_count) throw new Error('회사 개수 불일치')
    assertListingOutcomes(companies)
    assertExplicitCellInventory(companies, manifest)
    return companies
  }

  private async loadApprovedV2Listings(manifest: Manifest, signal?: AbortSignal) {
    const projection = manifest.approved_v2_projection
    if (!projection) return undefined
    const chunks = await Promise.all(projection.listing_chunks.map(async (descriptor) => {
      const chunk = await this.payload(projection, descriptor, approvedV2ListingChunkSchema, (value) => value.companies.length, signal)
      if (chunk.artifact_protocol !== 'vNext' || chunk.data_version !== projection.data_version || chunk.taxonomy_version !== manifest.taxonomy_version || chunk.chunk_index !== descriptor.chunk_index || chunk.sequence_start !== descriptor.first_sequence || chunk.sequence_end !== descriptor.last_sequence) throw new Error('approved projection 목록 chunk 메타데이터 불일치')
      chunk.companies.forEach((company) => { if (!projection.company_shards[company.company_id]) throw new Error('approved projection 목록 회사 참조 불일치') })
      return chunk.companies
    }))
    const companies = chunks.flat()
    if (companies.length !== projection.projected_company_count) throw new Error('approved projection 회사 개수 불일치')
    assertListingOutcomes(companies)
    const counts = { official_verified: 0, reference: 0, community_report: 0, no_public_info: 0 }
    for (const company of companies) for (const outcome of company.category_outcomes) {
      if (!('state' in outcome)) throw new Error('approved projection에 legacy category outcome이 포함됨')
      counts[outcome.state]++
    }
    if (JSON.stringify(counts) !== JSON.stringify(projection.cell_state_counts)) throw new Error('approved projection cell inventory 불일치')
    return companies
  }

  async loadAtlas(signal?: AbortSignal): Promise<BenefitAtlasData> {
    const manifest = await this.loadManifest(signal)
    const legacy = await this.loadListingChunks(manifest, signal)
    if (!manifest.approved_v2_projection) return { manifest, companies: legacy.map((company) => ({ ...company, lineage: { legacy: company } })) }
    const projection = manifest.approved_v2_projection
    const [projected, approvedV2Sources] = await Promise.all([
      this.loadApprovedV2Listings(manifest, signal),
      this.payload(projection, projection.sources, sourcesDocumentSchema, (value) => value.sources.length, signal),
    ])
    const baseById = new Map(legacy.map((company) => [company.company_id, company]))
    const projectedById = new Map(projected!.map((company) => {
      const base = baseById.get(company.company_id)
      if (!base || base.population_sequence !== company.population_sequence) throw new Error('approved projection canonical company join mismatch')
      assertCompanyIdentityProjection(base, company)
      return [company.company_id, company]
    }))
    return {
      manifest,
      approvedV2Sources,
      companies: legacy.map((base) => {
        const approved_v2 = projectedById.get(base.company_id)
        return { ...(approved_v2 ?? base), lineage: { legacy: base, ...(approved_v2 ? { approved_v2 } : {}) } }
      }),
    }
  }

  async loadCompanyDetail(manifest: Manifest, listings: CompanyListing[], id: string, signal?: AbortSignal) { return (await this.loadCompanyDetails(manifest, listings, [id], signal))[0] }

  async loadAtlasCompanyDetail(atlas: BenefitAtlasData, id: string, signal?: AbortSignal) { return (await this.loadAtlasCompanyDetails(atlas, [id], signal))[0] }

  async loadAtlasCompanyDetails(atlas: BenefitAtlasData, requestedIds: string[], signal?: AbortSignal): Promise<BenefitCompanyDetailView[]> {
    const ids = [...new Set(requestedIds)].slice(0, 4)
    if (ids.length !== requestedIds.length || requestedIds.length > 4) throw new Error('비교는 고유 기업 네 곳까지 가능합니다')
    const byId = new Map(atlas.companies.map((company) => [company.company_id, company]))
    if (ids.some((id) => !byId.has(id))) throw new Error('기업을 찾을 수 없습니다')
    const legacyListings = atlas.companies.map((company) => company.lineage.legacy)
    const legacyDetails = await this.loadCompanyDetails(atlas.manifest, legacyListings, ids, signal)
    const legacyById = new Map(legacyDetails.map((detail) => [detail.company.company_id, detail]))
    const projection = atlas.manifest.approved_v2_projection
    if (!projection) return ids.map((id) => ({ legacy: legacyById.get(id)! }))
    let bytes = 0
    const account = (amount: number) => { if (amount > BATCH_LIMIT - bytes) throw new Error('상세 데이터 배치 크기 초과'); bytes += amount }
    const sourceById = new Map(atlas.approvedV2Sources?.sources.map((source) => [source.source_id, source]))
    return Promise.all(ids.map(async (id) => {
      const company = byId.get(id)!
      const legacy = legacyById.get(id)!
      if (!company.lineage.approved_v2) return { legacy }
      const descriptor = projection.company_shards[id]
      if (!descriptor) throw new Error('approved projection 상세 descriptor 누락')
      const approvedV2 = await this.payload(projection, descriptor, detailSchema, () => 1, signal, { maxBytes: SHARD_LIMIT, account })
      if (approvedV2.artifact_protocol !== 'vNext' || approvedV2.data_version !== projection.data_version || approvedV2.taxonomy_version !== atlas.manifest.taxonomy_version || approvedV2.company.company_id !== id) throw new Error('approved projection 상세 shard 메타데이터 불일치')
      assertCompanyIdentityProjection(company.lineage.legacy, company.lineage.approved_v2, approvedV2.company)
      assertCompanyDetailIdentityProjection(legacy.company, approvedV2.company)
      assertCompanyDetailEvidence(company.lineage.approved_v2, approvedV2)
      for (const source of approvedV2.sources ?? []) if (JSON.stringify(sourceById.get(source.source_id)) !== JSON.stringify(source)) throw new Error('approved projection source inventory 불일치')
      return { legacy, approvedV2 }
    }))
  }

  async loadCompanyDetails(manifest: Manifest, listings: CompanyListing[], requestedIds: string[], signal?: AbortSignal) {
    const ids = [...new Set(requestedIds)].slice(0, 4)
    if (ids.length !== requestedIds.length || requestedIds.length > 4) throw new Error('비교는 고유 기업 네 곳까지 가능합니다')
    const byId = new Map(listings.map((company) => [company.company_id, company]))
    if (ids.some((id) => !byId.has(id) || !manifest.company_shards[id])) throw new Error('기업을 찾을 수 없습니다')
    let bytes = 0; let next = 0; let failure: unknown
    const output = new Map<string, z.infer<typeof detailSchema>>(); const controller = new AbortController(); const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    const account = (amount: number) => { if (amount > BATCH_LIMIT - bytes) { const error = new Error('상세 데이터 배치 크기 초과'); controller.abort(error); throw error } bytes += amount }
    const worker = async () => {
      while (!failure && next < ids.length) {
        const id = ids[next++]; const descriptor = manifest.company_shards[id]
        try {
          const detail = await this.payload(manifest, descriptor, detailSchema, () => 1, combined, { maxBytes: SHARD_LIMIT, account })
          if ((detail.artifact_protocol ?? 'v1') !== manifest.artifact_protocol || detail.data_version !== manifest.data_version || detail.taxonomy_version !== manifest.taxonomy_version || detail.company.company_id !== id) throw new Error('상세 shard 메타데이터 불일치')
          assertCompanyDetailEvidence(byId.get(id)!, detail); output.set(id, detail)
        } catch (error) { failure ??= error; controller.abort(error) }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, ids.length) }, worker))
    if (failure) throw failure
    return ids.map((id) => output.get(id)!)
  }

  loadMethodology(manifest: Manifest, signal?: AbortSignal) { return this.payload(manifest, manifest.methodology, methodologySchema, (value) => value.paragraphs.length, signal) }
}
export const benefitsClient = new BenefitsArtifactClient()
