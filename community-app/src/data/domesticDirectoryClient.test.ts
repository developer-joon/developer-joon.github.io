import { createHash, webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DomesticDirectoryClient, selectDomestic, type DomesticEntry } from './domesticDirectoryClient'

const root = 'public/data/company-benefits/'
const urlRoot = '/community/data/company-benefits/'
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
function fixture() {
  const base = readFileSync(`${root}manifest.json`, 'utf8')
  const b = new Map<string, string>([[`${urlRoot}manifest.json`, base]])
  const sample = { records: [{ id: 'KR-BIZ-1234567890', name: '가상테크', observation_date: '2020-01-02', size_class: 'unclassified', source_type: 'dated_recruitment_observation' }, { id: 'KR-CRN-1101112948086', name: '가상회사', observation_date: '2021-01-01', size_class: 'unclassified', source_type: 'dated_recruitment_observation' }] }
  const shard = JSON.stringify(sample)
  const directory = { schema_version: 'domestic-directory-v1', base_manifest_sha256: hash(base), sources: JSON.parse(readFileSync(`${root}domestic-directory-v1/manifest.json`, 'utf8')).sources, limits: { max_records_per_shard: 500, max_shard_bytes: 262144, max_shards: 400 }, chunks: [{ path: 'shards/0000.json', bytes: Buffer.byteLength(shard), sha256: hash(shard), count: 2 }], totals: { listing_records: 2, new_records: 1, base_aliases: 1 } }
  b.set(`${urlRoot}domestic-directory-v1/shards/0000.json`, shard)
  const dirRaw = JSON.stringify(directory)
  b.set(`${urlRoot}domestic-directory-v1/manifest.json`, dirRaw)
  const records = JSON.stringify({ labels: [{ id: 'KR-BIZ-1234567890', as_of: '2025-12-31', expires_on: '2027-01-01', source: 'sme', size_class: 'sme_unspecified' }], ftc_only: [{ id: 'KR-CRN-3333333333333', name: '공식 계열사', group: '가상집단', as_of: '2026-11-02', source: 'ftc', size_class: 'large_affiliate' }] })
  b.set(`${urlRoot}domestic-size-evidence-v1/records.json`, records)
  b.set(`${urlRoot}domestic-size-evidence-v1/manifest.json`, JSON.stringify({ schema_version: 'domestic-size-evidence-v1', base_manifest_sha256: hash(base), directory_manifest_sha256: hash(dirRaw), sources: JSON.parse(readFileSync(`${root}domestic-size-evidence-v1/manifest.json`, 'utf8')).sources, records: { path: 'records.json', bytes: Buffer.byteLength(records), sha256: hash(records), count: 2, labels: 1, ftc_only: 1 }, totals: { labels: 1, ftc_only: 1, records: 2 } }))
  return { b, directory, sample }
}
const client = (b: Map<string, string>, onRequest?: (url: string, signal?: AbortSignal) => Promise<Response>) => new DomesticDirectoryClient(onRequest ?? (async (url) => new Response(b.get(url), { status: b.has(url) ? 200 : 404 })), webcrypto.subtle as SubtleCrypto)
const baseIds = new Set(Object.keys(JSON.parse(readFileSync(`${root}manifest.json`, 'utf8')).company_shards).filter(id => id.startsWith('KR-CRN-')))

describe('hash-bound directory', () => {
  it('accepts producer-shaped manifests and merges labels by exact identity', async () => {
    const { b } = fixture(); const result = await client(b).load(baseIds)
    expect(result.entries).toHaveLength(3)
    expect(result.entries.find(x => x.id === 'KR-BIZ-1234567890')?.size_class).toBe('sme_unspecified')
  })
  it('rejects changed bytes and stale base binding', async () => {
    const { b } = fixture(); b.set(`${urlRoot}domestic-directory-v1/shards/0000.json`, b.get(`${urlRoot}domestic-directory-v1/shards/0000.json`)! + ' ')
    await expect(client(b).load(baseIds)).rejects.toThrow()
    const next = fixture().b; next.set(`${urlRoot}manifest.json`, next.get(`${urlRoot}manifest.json`)! + ' ')
    await expect(client(next).load(baseIds)).rejects.toThrow()
  })
  it('rejects a rehashed manifest that lies about its recruitment source digest', async () => {
    const { b } = fixture()
    const dir = JSON.parse(b.get(`${urlRoot}domestic-directory-v1/manifest.json`)!)
    dir.sources.recruitment.sha256 = 'f'.repeat(64)
    const raw = JSON.stringify(dir)
    b.set(`${urlRoot}domestic-directory-v1/manifest.json`, raw)
    const overlay = JSON.parse(b.get(`${urlRoot}domestic-size-evidence-v1/manifest.json`)!)
    overlay.directory_manifest_sha256 = hash(raw)
    b.set(`${urlRoot}domestic-size-evidence-v1/manifest.json`, JSON.stringify(overlay))
    await expect(client(b).load(baseIds)).rejects.toThrow()
  })
  it('rejects duplicate and alien labels even with self-consistent hashes', async () => {
    const { b, sample, directory } = fixture(); sample.records.push({ ...sample.records[0] }); const shard = JSON.stringify(sample)
    directory.chunks[0] = { ...directory.chunks[0], count: 3, bytes: Buffer.byteLength(shard), sha256: hash(shard) }; directory.totals.listing_records = 3
    b.set(`${urlRoot}domestic-directory-v1/shards/0000.json`, shard); b.set(`${urlRoot}domestic-directory-v1/manifest.json`, JSON.stringify(directory))
    await expect(client(b).load(baseIds)).rejects.toThrow()
    const second = fixture(); const rec = JSON.parse(second.b.get(`${urlRoot}domestic-size-evidence-v1/records.json`)!); rec.labels[0].id = 'KR-BIZ-9999999999'; const raw = JSON.stringify(rec)
    second.b.set(`${urlRoot}domestic-size-evidence-v1/records.json`, raw)
    const overlay = JSON.parse(second.b.get(`${urlRoot}domestic-size-evidence-v1/manifest.json`)!); overlay.records.sha256 = hash(raw); overlay.records.bytes = Buffer.byteLength(raw)
    second.b.set(`${urlRoot}domestic-size-evidence-v1/manifest.json`, JSON.stringify(overlay))
    await expect(client(second.b).load(baseIds)).rejects.toThrow()
  })
  it('rejects overlarge payload and aborts superseded work', async () => {
    const { b } = fixture(); const response = async (url: string) => new Response(b.get(url), { status: b.has(url) ? 200 : 404, headers: { 'content-length': '100000000' } })
    await expect(client(b, response).load(baseIds)).rejects.toThrow()
    const controller = new AbortController(); controller.abort()
    await expect(client(b).load(baseIds, controller.signal)).rejects.toThrow()
  })
  it('rejects an in-flight load after caller cancellation, even when transport returns late', async () => {
    const { b } = fixture()
    const controller = new AbortController()
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const request = async (url: string) => {
      if (url.endsWith('/manifest.json')) await gate
      return new Response(b.get(url), { status: b.has(url) ? 200 : 404 })
    }
    const pending = client(b, request).load(baseIds, controller.signal)
    controller.abort()
    release?.()
    await expect(pending).rejects.toThrow()
  })
  it('searches and pages at most 50 entries without treating unknown as SME or welfare', () => {
    const entries: DomesticEntry[] = Array.from({ length: 101 }, (_, i) => ({ id: `KR-BIZ-${String(i).padStart(10, '0')}`, name: `가상 ${i}`, source_type: 'dated_recruitment_observation', observation_date: '2020-01-01', size_class: i === 0 ? 'sme_unspecified' : 'unclassified' }))
    expect(selectDomestic(entries, { q: '가상', size: 'sme', page: 1, benefits: false }, new Map()).total).toBe(1)
    expect(selectDomestic(entries, { q: '', size: 'small', page: 1, benefits: false }, new Map()).total).toBe(0)
    expect(selectDomestic(entries, { q: '', size: 'all', page: 2, benefits: false }, new Map()).pageEntries).toHaveLength(50)
    expect(selectDomestic(entries, { q: '', size: 'all', page: 3, benefits: true }, new Map()).total).toBe(0)
  })
  it('loads the actual pinned directory with the declared number of entries', async () => {
    const { b } = fixture()
    for (const part of ['domestic-directory-v1/manifest.json', 'domestic-size-evidence-v1/manifest.json', 'domestic-size-evidence-v1/records.json']) b.set(`${urlRoot}${part}`, readFileSync(`${root}${part}`, 'utf8'))
    const directory = JSON.parse(b.get(`${urlRoot}domestic-directory-v1/manifest.json`)!)
    for (const chunk of directory.chunks) b.set(`${urlRoot}domestic-directory-v1/${chunk.path}`, readFileSync(`${root}domestic-directory-v1/${chunk.path}`, 'utf8'))
    const real = await client(b).load(new Set(JSON.parse(readFileSync(`${root}manifest.json`, 'utf8')).company_shards ? Object.keys(JSON.parse(readFileSync(`${root}manifest.json`, 'utf8')).company_shards).filter(id => id.startsWith('KR-CRN-')) : []))
    expect(real.entries).toHaveLength(directory.totals.listing_records + 3143)
  })
})
