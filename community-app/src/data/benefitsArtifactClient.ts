import { z } from 'zod'
import { assertCompanyDetailEvidence, assertListingOutcomes, detailSchema, listingChunkSchema, manifestSchema, methodologySchema, type CompanyListing, type Manifest } from '../types/benefits'

const RESPONSE_LIMIT = 12_000_000
const SHARD_LIMIT = 256_000
const BATCH_LIMIT = 1_000_000

type Descriptor = { url: string; sha256: string; record_count: number; byte_count: number }

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
    const manifest = manifestSchema.parse(JSON.parse(await this.raw('/community/data/company-benefits/manifest.json', signal)))
    signal?.throwIfAborted()
    return manifest
  }

  private async payload<T>(manifest: Manifest, descriptor: Descriptor, schema: z.ZodType<T>, count: (value: T) => number, signal?: AbortSignal, limits?: { maxBytes: number; account?: (bytes: number) => void }) {
    if (!descriptor.url.startsWith(`/community/data/company-benefits/${manifest.data_version}/`)) throw new Error('artifact 버전 경로 불일치')
    const key = `${manifest.data_version}:${descriptor.url}:${descriptor.sha256}`
    const load = async () => {
      const raw = await this.raw(descriptor.url, signal, limits?.maxBytes, limits?.account)
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
          if (chunk.data_version !== manifest.data_version || chunk.taxonomy_version !== manifest.taxonomy_version || chunk.chunk_index !== descriptor.chunk_index || chunk.sequence_start !== descriptor.first_sequence || chunk.sequence_end !== descriptor.last_sequence) throw new Error('목록 chunk 메타데이터 불일치')
          chunk.companies.forEach((company, offset) => { if (company.population_sequence !== descriptor.first_sequence + offset || !manifest.company_shards[company.company_id]) throw new Error('목록 회사 참조 불일치') })
          results[index] = chunk.companies
        } catch (error) { failure ??= error; controller.abort(error) }
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker))
    if (failure) throw failure
    const companies = results.flat(); if (companies.length !== manifest.company_count) throw new Error('회사 개수 불일치')
    assertListingOutcomes(companies)
    return companies
  }

  async loadCompanyDetail(manifest: Manifest, listings: CompanyListing[], id: string, signal?: AbortSignal) { return (await this.loadCompanyDetails(manifest, listings, [id], signal))[0] }

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
          if (detail.data_version !== manifest.data_version || detail.taxonomy_version !== manifest.taxonomy_version || detail.company.company_id !== id) throw new Error('상세 shard 메타데이터 불일치')
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
