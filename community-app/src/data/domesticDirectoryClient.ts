import { z } from 'zod'

const prefix = '/community/data/company-benefits/'
const pinnedSources = {
  recruitment: '16756d002508995b70f158bd279a48fb825af6a79820eb82b0009efcbeb82365',
  dart_bridge: '6dcf6031e8e9eecbcefc120a7461f9a7bd3ef97c88ba55d20d80f416285de1c3',
  ftc: '080238dc8e95bc7cff0100534854d317ed6948a25a291688f451fa5be23053fb',
  mid: '962e10cb95b8b8ee274d420f4e89293dbc8da8e4ba9966178ef6af068fe6e040',
  sme: 'c8242d45872ffb1d35241b434b4dfce828a39697fc27bb6f9d8b565730bed4ba',
} as const
// Immutable v1 artifact epoch; changing it requires an explicit client contract update.
const pinnedArtifacts = {
  base: 'cd971b70d4fb0d9860a6c9f0903610cb20d9cc8f9d98757478a1592cf82ed99b',
  directory: '3ffb2259bb618e70c820005aebea1be24422d831faea908121d4884406c7ea0b',
  overlay: 'a75a6edb58e1c4258fd79451cb64efdc936fcd1cfaaccb0cd2391267b86adbd4',
  records: 'e9f3eb2e877459815b1ce075fb4c4dc834d762accac6538d6c7c4aec31b6bd43',
  shards: 73,
  listing: 36084,
  newRecords: 35910,
  aliases: 174,
  labels: 402,
  ftcOnly: 3143,
} as const
const sha = z.string().regex(/^[0-9a-f]{64}$/)
const date = z.iso.date()
const text = z.string().min(1).max(120).refine(s => !/[<>]/.test(s) && [...s].every(c => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127))
const id = z.string().regex(/^KR-(?:BIZ-[0-9]{10}|CRN-[0-9]{13})$/)
const descriptor = z.strictObject({ path: z.string(), bytes: z.number().int().positive(), sha256: sha, count: z.number().int().positive() })
const listing = z.strictObject({ id, name: text, observation_date: date, source_type: z.literal('dated_recruitment_observation'), size_class: z.literal('unclassified'), region: text.optional(), employee_count: z.number().int().min(0).max(10000000).optional() })
const label = z.strictObject({ id, as_of: date, source: z.enum(['ftc', 'mid', 'sme']), size_class: z.enum(['large_affiliate', 'mid_history', 'sme_unspecified']), expires_on: date.optional() })
const affiliate = label.extend({ name: text, group: text })
export type DomesticEntry = { id: string; name: string; source_type: 'dated_recruitment_observation' | 'base_legal_identity' | 'ftc_affiliate'; observation_date?: string; region?: string; employee_count?: number; size_class: 'unclassified' | 'large_affiliate' | 'mid_history' | 'sme_unspecified' | 'medium' | 'small'; size_evidence?: z.infer<typeof label>; group?: string }
export type SizeFilter = 'all' | 'large' | 'mid' | 'sme' | 'medium' | 'small' | 'unknown'
export type DomesticState = { q: string; size: SizeFilter; benefits: boolean; page: number }

const normalizedNames = new WeakMap<DomesticEntry[], string[]>()
export function selectDomestic(entries: DomesticEntry[], state: DomesticState, research: Map<string, number>) {
  let names = normalizedNames.get(entries)
  if (!names) { names = entries.map(entry => entry.name.normalize('NFKC').toLocaleLowerCase()); normalizedNames.set(entries, names) }
  const query = state.q.trim().normalize('NFKC').toLocaleLowerCase()
  const match = entries.filter((entry, index) => {
    if (!names[index].includes(query)) return false
    if (state.benefits && !(entry.id.startsWith('KR-CRN-') && research.has(entry.id))) return false
    const kind = entry.size_class
    return state.size === 'all' || (state.size === 'large' && kind === 'large_affiliate') || (state.size === 'mid' && kind === 'mid_history') || (state.size === 'sme' && ['sme_unspecified', 'medium', 'small'].includes(kind)) || (state.size === 'unknown' && kind === 'unclassified') || (state.size === 'medium' && kind === 'medium') || (state.size === 'small' && kind === 'small')
  })
  const pages = Math.max(1, Math.ceil(match.length / 50)); const page = Math.min(Math.max(1, state.page), pages)
  return { total: match.length, pages, page, pageEntries: match.slice((page - 1) * 50, page * 50) }
}
function assert(ok: unknown, reason: string): asserts ok { if (!ok) throw new Error(`국내 기업 데이터 무결성 오류: ${reason}`) }
const digest = async (bytes: Uint8Array, subtle: SubtleCrypto) => Array.from(new Uint8Array(await subtle.digest('SHA-256', bytes as BufferSource)), b => b.toString(16).padStart(2, '0')).join('')
const sourceShape = z.object({ sha256: sha }).passthrough()
const directorySchema = z.object({ schema_version: z.literal('domestic-directory-v1'), base_manifest_sha256: sha, sources: z.object({ recruitment: sourceShape.extend({ edition: date }), dart_bridge: sourceShape }), limits: z.strictObject({ max_records_per_shard: z.literal(500), max_shard_bytes: z.literal(262144), max_shards: z.literal(400) }), chunks: z.array(descriptor).min(1).max(400), totals: z.object({ listing_records: z.number().int().positive(), new_records: z.number().int().positive(), base_aliases: z.number().int().nonnegative() }) }).passthrough()
const overlaySchema = z.object({ schema_version: z.literal('domestic-size-evidence-v1'), base_manifest_sha256: sha, directory_manifest_sha256: sha, records: descriptor.extend({ labels: z.number().int().nonnegative(), ftc_only: z.number().int().nonnegative() }), sources: z.object({ ftc: sourceShape.extend({ as_of: date }), mid: sourceShape.extend({ as_of: date }), sme: sourceShape.extend({ as_of: date }), dart_bridge: sourceShape, recruitment: sourceShape }), totals: z.object({ labels: z.number().int().nonnegative(), ftc_only: z.number().int().nonnegative(), records: z.number().int().nonnegative() }) }).passthrough()

export class DomesticDirectoryClient {
  constructor(private request: (url: string, signal?: AbortSignal) => Promise<Response> = (url, signal) => fetch(url, { signal, credentials: 'omit', redirect: 'error' }), private subtle: SubtleCrypto = crypto.subtle) {}
  private async raw(url: string, max: number, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const response = await this.request(url, signal)
    if (!response.ok) throw new Error('국내 기업 자료 요청 실패')
    const declared = response.headers.get('content-length')
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > max)) throw new Error('국내 기업 자료 크기 초과')
    const reader = response.body?.getReader()
    if (!reader) throw new Error('국내 기업 응답 본문 없음')
    const parts: Uint8Array[] = []; let total = 0
    const abort = () => { void reader.cancel().catch(() => {}) }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      while (true) {
        signal?.throwIfAborted()
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > max) throw new Error('국내 기업 자료 크기 초과')
        parts.push(value)
      }
      signal?.throwIfAborted()
    } catch (error) { void reader.cancel().catch(() => {}); throw error }
    finally { signal?.removeEventListener('abort', abort) }
    const bytes = new Uint8Array(total); let offset = 0
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength }
    return bytes
  }
  private json(bytes: Uint8Array): unknown { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  private async checked(url: string, file: z.infer<typeof descriptor>, max: number, signal?: AbortSignal) {
    const bytes = await this.raw(url, max, signal)
    assert(bytes.byteLength === file.bytes && await digest(bytes, this.subtle) === file.sha256, '해시·바이트 불일치')
    return this.json(bytes)
  }
  async load(baseIds: Set<string>, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const baseBytes = await this.raw(`${prefix}manifest.json`, 12_000_000, signal)
    assert(await digest(baseBytes, this.subtle) === pinnedArtifacts.base, '기본 manifest 지문')
    const base = z.object({ company_shards: z.record(z.string(), z.unknown()), company_count: z.literal(2000) }).parse(this.json(baseBytes))
    const canonicalIds = Object.keys(base.company_shards).filter(x => x.startsWith('KR-CRN-'))
    assert(canonicalIds.length === 1000 && canonicalIds.every(x => /^KR-CRN-[0-9]{13}$/.test(x)), '기본 기업 집합')
    assert(baseIds.size === 1000 && canonicalIds.every(x => baseIds.has(x)), '기본 기업 ID 불일치')
    const baseHash = await digest(baseBytes, this.subtle)
    const directoryBytes = await this.raw(`${prefix}domestic-directory-v1/manifest.json`, 100_000, signal)
    assert(await digest(directoryBytes, this.subtle) === pinnedArtifacts.directory, 'directory manifest 지문')
    const directory = directorySchema.parse(this.json(directoryBytes))
    assert(directory.chunks.length === pinnedArtifacts.shards && directory.totals.listing_records === pinnedArtifacts.listing && directory.totals.new_records === pinnedArtifacts.newRecords && directory.totals.base_aliases === pinnedArtifacts.aliases, 'directory 고정 합계')
    assert(directory.base_manifest_sha256 === baseHash, '기본 manifest 결합')
    assert(directory.sources.recruitment.sha256 === pinnedSources.recruitment && directory.sources.dart_bridge.sha256 === pinnedSources.dart_bridge, '채용/중복제외 원본 지문')
    const overlayBytes = await this.raw(`${prefix}domestic-size-evidence-v1/manifest.json`, 100_000, signal)
    assert(await digest(overlayBytes, this.subtle) === pinnedArtifacts.overlay, '규모 manifest 지문')
    const overlay = overlaySchema.parse(this.json(overlayBytes))
    assert(overlay.records.sha256 === pinnedArtifacts.records && overlay.records.labels === pinnedArtifacts.labels && overlay.records.ftc_only === pinnedArtifacts.ftcOnly && overlay.records.count === pinnedArtifacts.labels + pinnedArtifacts.ftcOnly && overlay.totals.labels === pinnedArtifacts.labels && overlay.totals.ftc_only === pinnedArtifacts.ftcOnly && overlay.totals.records === pinnedArtifacts.labels + pinnedArtifacts.ftcOnly, '규모 고정 합계')
    assert(overlay.base_manifest_sha256 === baseHash && overlay.directory_manifest_sha256 === await digest(directoryBytes, this.subtle), '규모 manifest 결합')
    assert(overlay.sources.ftc.sha256 === pinnedSources.ftc && overlay.sources.mid?.sha256 === pinnedSources.mid && overlay.sources.sme?.sha256 === pinnedSources.sme && overlay.sources.dart_bridge?.sha256 === pinnedSources.dart_bridge && overlay.sources.recruitment?.sha256 === pinnedSources.recruitment, '규모 원본 지문')
    assert(overlay.records.path === 'records.json' && overlay.records.bytes <= 1_000_000, '규모 records 경로/크기')
    const controller = new AbortController()
    const relay = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', relay, { once: true })
    let next = 0; let failure: unknown
    const results: Array<z.infer<typeof listing>[]> = Array.from({ length: directory.chunks.length })
    const worker = async () => {
      while (!failure && !controller.signal.aborted && next < directory.chunks.length) {
        const index = next++; const chunk = directory.chunks[index]
        try {
          assert(chunk.path === `shards/${String(index).padStart(4, '0')}.json` && chunk.bytes <= 262144 && chunk.count <= 500, 'shard 경로/상한')
          const payload = z.strictObject({ records: z.array(listing).max(500) }).parse(await this.checked(`${prefix}domestic-directory-v1/${chunk.path}`, chunk, 262144, controller.signal))
          assert(payload.records.length === chunk.count, 'shard 건수')
          results[index] = payload.records
        } catch (error) { failure ??= error; controller.abort(error) }
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(4, directory.chunks.length) }, worker))
      if (failure) throw failure
      signal?.throwIfAborted()
      const records = results.flat(); const seen = new Set<string>(); let newCount = 0; let aliases = 0
      for (const row of records) {
        assert(!seen.has(row.id), '중복 회사 ID'); seen.add(row.id)
        if (row.id.startsWith('KR-BIZ-')) newCount++
        else { aliases++; assert(canonicalIds.includes(row.id), '기본 명부 밖 CRN') }
      }
      assert(records.length === directory.totals.listing_records && newCount === directory.totals.new_records && aliases === directory.totals.base_aliases, 'directory 합계')
      assert(records.length === pinnedArtifacts.listing && newCount === pinnedArtifacts.newRecords && aliases === pinnedArtifacts.aliases, 'directory 고정 합계')
      const sizeDoc = z.strictObject({ labels: z.array(label).max(10000), ftc_only: z.array(affiliate).max(10000) }).parse(await this.checked(`${prefix}domestic-size-evidence-v1/records.json`, overlay.records, 1_000_000, controller.signal))
      assert(sizeDoc.labels.length === pinnedArtifacts.labels && sizeDoc.ftc_only.length === pinnedArtifacts.ftcOnly, '규모 고정 합계')
      assert(sizeDoc.labels.length === overlay.records.labels && sizeDoc.ftc_only.length === overlay.records.ftc_only && sizeDoc.labels.length + sizeDoc.ftc_only.length === overlay.records.count && overlay.totals.labels === sizeDoc.labels.length && overlay.totals.ftc_only === sizeDoc.ftc_only.length && overlay.totals.records === overlay.records.count, '규모 건수')
      const allIds = new Set([...seen, ...canonicalIds]); const used = new Set<string>()
      for (const item of [...sizeDoc.labels, ...sizeDoc.ftc_only]) {
        assert(!used.has(item.id), '규모 중복'); used.add(item.id)
        assert(item.source === (item.size_class === 'large_affiliate' ? 'ftc' : item.size_class === 'mid_history' ? 'mid' : 'sme'), '규모 출처')
        assert(item.as_of === overlay.sources[item.source]?.as_of, '규모 기준일')
        if (item.size_class === 'sme_unspecified') assert(Boolean(item.expires_on && item.expires_on >= '2026-11-20'), 'SME 지정 유효기간')
      }
      for (const item of sizeDoc.labels) assert(allIds.has(item.id), '미등록 규모 ID')
      for (const item of sizeDoc.ftc_only) assert(!allIds.has(item.id) && item.id.startsWith('KR-CRN-') && item.size_class === 'large_affiliate', 'FTC 전용 ID 중복')
      const labels = new Map(sizeDoc.labels.map(item => [item.id, item]))
      const entries: DomesticEntry[] = records.map(row => ({ ...row, size_class: labels.get(row.id)?.size_class ?? 'unclassified', size_evidence: labels.get(row.id) }))
      entries.push(...sizeDoc.ftc_only.map(item => ({ id: item.id, name: item.name, group: item.group, source_type: 'ftc_affiliate' as const, size_class: item.size_class, size_evidence: item })))
      return { entries, baseLabels: labels, baseIds: canonicalIds, edition: directory.sources.recruitment.edition, totals: directory.totals }
    } finally { signal?.removeEventListener('abort', relay); controller.abort() }
  }
}
export const domesticDirectoryClient = new DomesticDirectoryClient()
