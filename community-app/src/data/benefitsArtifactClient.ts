import { z } from 'zod'
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
  type Manifest,
  type CompanyIndex,
} from '../types/benefits'
export class BenefitsArtifactClient {
  private cache = new Map<string, Promise<unknown>>()
  constructor(
    private request: (url: string) => Promise<Response> = (url) =>
      fetch(url, { credentials: 'omit', redirect: 'error' }),
    private subtle: SubtleCrypto = crypto.subtle,
  ) {}
  private async raw(url: string) {
    const response = await this.request(url)
    if (!response.ok) throw new Error('데이터 요청 실패')
    const raw = await response.text()
    if (raw.length > 12_000_000) throw new Error('데이터 크기 초과')
    return raw
  }
  async loadManifest() {
    const m = manifestSchema.parse(
      JSON.parse(
        await this.raw('/community/data/company-benefits/manifest.json'),
      ),
    )
    if (
      new Set(m.category_taxonomy).size !== categories.length ||
      new Set(m.status_taxonomy).size !== statuses.length ||
      Object.keys(m.detail_shards).length !== m.company_count
    )
      throw new Error('manifest 개수 불일치')
    return m
  }
  private async payload<T>(
    m: Manifest,
    url: string,
    schema: z.ZodType<T>,
    count: (data: T) => number,
  ): Promise<T> {
    const descriptor = m.artifact_sha256[url]
    if (!descriptor) throw new Error('등록되지 않은 artifact')
    const key = `${m.data_version}:${url}:${descriptor.sha256}`
    if (!this.cache.has(key))
      this.cache.set(
        key,
        (async () => {
          const raw = await this.raw(url)
          const digest = await this.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(raw),
          )
          if (
            Array.from(new Uint8Array(digest), (b) =>
              b.toString(16).padStart(2, '0'),
            ).join('') !== descriptor.sha256
          )
            throw new Error('무결성 오류')
          const data = schema.parse(JSON.parse(raw))
          if (count(data) !== descriptor.record_count)
            throw new Error('record count 불일치')
          return data
        })().catch((e) => {
          this.cache.delete(key)
          throw e
        }),
      )
    return this.cache.get(key) as Promise<T>
  }
  async loadCompanyIndex(m: Manifest) {
    const data = await this.payload(
      m,
      m.index_url,
      indexSchema,
      (d) => d.companies.length,
    )
    const ids = new Set(data.companies.map((c) => c.company_id))
    if (
      ids.size !== m.company_count ||
      data.companies.length !== m.company_count ||
      [...ids].some((id) => !m.detail_shards[id])
    )
      throw new Error('회사 개수/참조 불일치')
    return data
  }
  async loadRankings(m: Manifest, index: CompanyIndex) {
    const data = await this.payload(
      m,
      m.rankings_url,
      rankingsSchema,
      (d) => d.rows.length,
    )
    const ids = new Set(index.companies.map((c) => c.company_id))
    const keys = new Set(data.rows.map((r) => `${r.company_id}:${r.category}`))
    if (
      data.rows.some((r) => !ids.has(r.company_id)) ||
      keys.size !== data.rows.length ||
      keys.size !== ids.size * categories.length
    )
      throw new Error('순위 회사 참조 불일치')
    assertRankingEvidence(index, data)
    return data
  }
  async loadCompanyDetail(m: Manifest, index: CompanyIndex, id: string) {
    const [result] = await this.loadCompanyDetails(m, index, [id])
    return result
  }
  async loadCompanyDetails(
    m: Manifest,
    index: CompanyIndex,
    requestedIds: string[],
  ) {
    const requested = [...new Set(requestedIds)]
    const companies = new Map(
      index.companies.map((company) => [company.company_id, company]),
    )
    if (requested.some((id) => !companies.has(id) || !m.detail_shards[id]))
      throw new Error('기업을 찾을 수 없습니다')
    const shardUrls = [...new Set(requested.map((id) => m.detail_shards[id]))]
    const loaded = new Map<string, z.infer<typeof detailsSchema>['companies'][number]>()
    for (const shardUrl of shardUrls) {
      const data = await this.payload(
        m,
        shardUrl,
        detailsSchema,
        (payload) => payload.companies.length,
      )
      const ids = new Set(data.companies.map((detail) => detail.company_id))
      if (
        ids.size !== data.companies.length ||
        data.companies.some(
          (detail) =>
            !companies.has(detail.company_id) ||
            m.detail_shards[detail.company_id] !== shardUrl,
        )
      )
        throw new Error('상세 회사/shard 참조 불일치')
      for (const detail of data.companies) {
        assertDetailEvidence(companies.get(detail.company_id)!, detail)
        loaded.set(detail.company_id, detail)
      }
    }
    const results = requested.map((id) => loaded.get(id))
    if (results.some((detail) => !detail)) throw new Error('상세 누락')
    return results as z.infer<typeof detailsSchema>['companies']
  }
  loadMethodology(m: Manifest) {
    return this.payload(
      m,
      m.methodology_url,
      methodologySchema,
      (d) => d.paragraphs.length,
    )
  }
}
export const benefitsClient = new BenefitsArtifactClient()
