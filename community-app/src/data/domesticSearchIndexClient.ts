import type { DomesticEntry } from './domesticDirectoryClient'

const url = '/community/data/company-benefits/domestic-search-index-v1/index.json'
const pinnedSha256 = 'b7e61860d69f289735f42a6ae275c8a5303cbde367036f77865c7b20de7b9594'
const maxBytes = 9_000_000
const hex = async (bytes: Uint8Array, subtle: SubtleCrypto) => Array.from(new Uint8Array(await subtle.digest('SHA-256', bytes as BufferSource)), x => x.toString(16).padStart(2, '0')).join('')
export type SearchEntry = DomesticEntry & { research_count?: number }
export class DomesticSearchIndexClient {
  constructor(private request: (url: string, signal?: AbortSignal) => Promise<Response> = (path, signal) => fetch(path, { signal, credentials: 'omit', redirect: 'error' }), private subtle: SubtleCrypto = crypto.subtle) {}
  async load(signal?: AbortSignal) {
    signal?.throwIfAborted()
    const response = await this.request(url, signal)
    if (!response.ok) throw Error('국내 기업 snapshot 요청 실패')
    const declared = response.headers.get('content-length')
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw Error('snapshot 크기 초과')
    const reader = response.body?.getReader()
    if (!reader) throw Error('snapshot 본문 없음')
    const chunks: Uint8Array[] = []; let size = 0
    const abort = () => { void reader.cancel().catch(() => {}) }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      while (true) {
        signal?.throwIfAborted()
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maxBytes) throw Error('snapshot 크기 초과')
        chunks.push(value)
      }
      signal?.throwIfAborted()
    } catch (error) { void reader.cancel().catch(() => {}); throw error }
    finally { signal?.removeEventListener('abort', abort) }
    const bytes = new Uint8Array(size); let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    if (await hex(bytes, this.subtle) !== pinnedSha256) throw Error('snapshot 지문 불일치')
    const doc: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!doc || typeof doc !== 'object' || !('schema_version' in doc) || doc.schema_version !== 'domestic-search-index-v1' || !('entries' in doc) || !Array.isArray(doc.entries) || doc.entries.length !== 40053 || !('totals' in doc) || !doc.totals || typeof doc.totals !== 'object' || !('approved' in doc) || doc.approved !== 0 || !('edition' in doc) || typeof doc.edition !== 'string') throw Error('snapshot 합계/형식 오류')
    const totals = doc.totals as { records: number; new_records: number; base_aliases: number; ftc_only: number; research_companies: number; research_leads: number }
    if (totals.records !== 40053 || totals.new_records !== 35910 || totals.base_aliases !== 174 || totals.ftc_only !== 3143 || totals.research_companies !== 12 || totals.research_leads !== 128) throw Error('snapshot 합계 오류')
    const entries = doc.entries as SearchEntry[]
    const research = new Map<string, number>(); const ids = new Set<string>(); let aliases = 0; let newRecords = 0; let ftcOnly = 0
    for (const entry of entries) {
      if (!entry || !/^KR-(?:BIZ-\d{10}|CRN-\d{13})$/.test(entry.id) || typeof entry.name !== 'string' || !entry.name || ids.has(entry.id) || !['unclassified', 'large_affiliate', 'mid_history', 'sme_unspecified'].includes(entry.size_class)) throw Error('snapshot ID/분류 오류')
      ids.add(entry.id)
      if (entry.source_type === 'ftc_affiliate') ftcOnly++
      else if (entry.id.startsWith('KR-BIZ-')) newRecords++
      else if (entry.source_type === 'dated_recruitment_observation') aliases++
      if (entry.research_count !== undefined) {
        if (!entry.id.startsWith('KR-CRN-') || !Number.isSafeInteger(entry.research_count) || entry.research_count < 1) throw Error('snapshot 조사 건수 오류')
        research.set(entry.id, entry.research_count)
      }
    }
    if (aliases !== 174 || newRecords !== 35910 || ftcOnly !== 3143 || research.size !== 12 || [...research.values()].reduce((a, b) => a + b, 0) !== 128) throw Error('snapshot 파생 합계 오류')
    return { entries, research, edition: doc.edition, totals, approved: doc.approved }
  }
}
export const domesticSearchIndexClient = new DomesticSearchIndexClient()
