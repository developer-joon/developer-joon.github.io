import { createHash, webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DomesticDirectoryClient, selectDomestic, type DomesticEntry } from './domesticDirectoryClient'

const root = 'public/data/company-benefits/'
const urlRoot = '/community/data/company-benefits/'
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const url = (path: string) => `${urlRoot}${path}`
const directoryPath = 'domestic-directory-v1/manifest.json'
const overlayPath = 'domestic-size-evidence-v1/manifest.json'
const recordsPath = 'domestic-size-evidence-v1/records.json'
type DirectoryFixture = { chunks: Array<{ path: string; sha256: string; bytes: number; count: number }>; totals: { listing_records: number; new_records: number; base_aliases: number }; sources: { recruitment: { sha256: string } } }
type OverlayFixture = { directory_manifest_sha256: string; records: { sha256: string; bytes: number; count: number; labels: number; ftc_only: number }; totals: { labels: number; ftc_only: number; records: number } }
type RecordsFixture = { labels: Array<{ id: string }>; ftc_only: Array<{ id: string }> }
function fixture() {
  const b = new Map<string, string>()
  for (const path of ['manifest.json', directoryPath, overlayPath, recordsPath]) b.set(url(path), readFileSync(`${root}${path}`, 'utf8'))
  const directory = JSON.parse(b.get(url(directoryPath))!)
  for (const chunk of directory.chunks) {
    const path = `domestic-directory-v1/${chunk.path}`
    b.set(url(path), readFileSync(`${root}${path}`, 'utf8'))
  }
  return b
}
function editDirectory(b: Map<string, string>, edit: (directory: DirectoryFixture) => void) {
  const directory = JSON.parse(b.get(url(directoryPath))!) as DirectoryFixture
  edit(directory)
  const raw = JSON.stringify(directory)
  b.set(url(directoryPath), raw)
  const overlay = JSON.parse(b.get(url(overlayPath))!)
  overlay.directory_manifest_sha256 = hash(raw)
  b.set(url(overlayPath), JSON.stringify(overlay))
}
function editRecords(b: Map<string, string>, edit: (records: RecordsFixture, overlay: OverlayFixture) => void) {
  const records = JSON.parse(b.get(url(recordsPath))!) as RecordsFixture
  const overlay = JSON.parse(b.get(url(overlayPath))!) as OverlayFixture
  edit(records, overlay)
  const raw = JSON.stringify(records)
  b.set(url(recordsPath), raw)
  overlay.records.sha256 = hash(raw)
  overlay.records.bytes = Buffer.byteLength(raw)
  b.set(url(overlayPath), JSON.stringify(overlay))
}
const client = (b: Map<string, string>, onRequest?: (url: string, signal?: AbortSignal) => Promise<Response>) => new DomesticDirectoryClient(onRequest ?? (async (path: string) => new Response(b.get(path), { status: b.has(path) ? 200 : 404 })), webcrypto.subtle as SubtleCrypto)
const baseIds = new Set(Object.keys(JSON.parse(readFileSync(`${root}manifest.json`, 'utf8')).company_shards).filter(id => id.startsWith('KR-CRN-')))

describe('hash-bound directory', () => {
  it('accepts the real pinned artifacts and merges labels by exact identity', async () => {
    const result = await client(fixture()).load(baseIds)
    expect(result.entries).toHaveLength(39227)
    expect(new Set([...result.entries.map((entry: DomesticEntry) => entry.id), ...result.baseIds]).size).toBe(40053)
    expect(result.baseIds).toHaveLength(1000)
    expect(result.totals).toMatchObject({ listing_records: 36084, new_records: 35910, base_aliases: 174 })
    const labeled = JSON.parse(readFileSync(`${root}${recordsPath}`, 'utf8')).labels[0] as { id: string; size_class: DomesticEntry['size_class'] }
    expect(result.entries.find((x: DomesticEntry) => x.id === labeled.id)?.size_class ?? result.baseLabels.get(labeled.id)?.size_class).toBe(labeled.size_class)
  })
  it('rejects a self-consistently rehashed directory shrunk by one base alias', async () => {
    const b = fixture()
    editDirectory(b, directory => {
      const chunkIndex = directory.chunks.findIndex((chunk: { path: string }) => {
        const shard = JSON.parse(b.get(url(`domestic-directory-v1/${chunk.path}`))!)
        return shard.records.some((row: { id: string }) => row.id.startsWith('KR-CRN-'))
      })
      const chunk = directory.chunks[chunkIndex]
      const shardPath = url(`domestic-directory-v1/${chunk.path}`)
      const shard = JSON.parse(b.get(shardPath)!)
      const aliasIndex = shard.records.findIndex((row: { id: string }) => row.id.startsWith('KR-CRN-'))
      shard.records.splice(aliasIndex, 1)
      const raw = JSON.stringify(shard)
      b.set(shardPath, raw)
      chunk.sha256 = hash(raw); chunk.bytes = Buffer.byteLength(raw); chunk.count--
      directory.totals.listing_records--; directory.totals.base_aliases--
    })
    await expect(client(b).load(baseIds)).rejects.toThrow(/manifest 지문|directory 고정 합계/)
  })
  it('rejects changed shard bytes', async () => {
    const b = fixture(); const path = url('domestic-directory-v1/shards/0000.json')
    b.set(path, b.get(path)! + ' ')
    await expect(client(b).load(baseIds)).rejects.toThrow(/해시·바이트 불일치/)
  })
  it('rejects a rehashed base manifest even when its identity set is unchanged', async () => {
    const b = fixture(); b.set(url('manifest.json'), b.get(url('manifest.json'))! + ' ')
    await expect(client(b).load(baseIds)).rejects.toThrow(/manifest 지문/)
  })
  it('rejects a rehashed directory that lies about its recruitment source digest', async () => {
    const b = fixture()
    editDirectory(b, directory => { directory.sources.recruitment.sha256 = 'f'.repeat(64) })
    await expect(client(b).load(baseIds)).rejects.toThrow(/manifest 지문|원본 지문/)
  })
  it('rejects a directory manifest with changed totals and consistent overlay binding', async () => {
    const b = fixture(); editDirectory(b, directory => { directory.totals.base_aliases-- })
    await expect(client(b).load(baseIds)).rejects.toThrow(/manifest 지문|directory 고정 합계/)
  })
  it('rejects a directory manifest with a rewritten chunk digest', async () => {
    const b = fixture(); editDirectory(b, directory => { directory.chunks[0].sha256 = 'f'.repeat(64) })
    await expect(client(b).load(baseIds)).rejects.toThrow(/manifest 지문/)
  })
  it('rejects a self-consistently rehashed overlay with one fewer FTC-only identity', async () => {
    const b = fixture()
    editRecords(b, (records, overlay) => {
      records.ftc_only.pop(); overlay.records.ftc_only--; overlay.records.count--
      overlay.totals.ftc_only--; overlay.totals.records--
    })
    await expect(client(b).load(baseIds)).rejects.toThrow(/manifest 지문|규모 고정 합계/)
  })
  it('rejects altered overlay records even with a recomputed descriptor', async () => {
    const b = fixture()
    editRecords(b, records => { records.labels[0].id = 'KR-BIZ-9999999999' })
    await expect(client(b).load(baseIds)).rejects.toThrow(/manifest 지문|records 지문/)
  })
  it('rejects a rehashed overlay manifest with unchanged records', async () => {
    const b = fixture(); const overlay = JSON.parse(b.get(url(overlayPath))!)
    overlay.totals.labels--
    b.set(url(overlayPath), JSON.stringify(overlay))
    await expect(client(b).load(baseIds)).rejects.toThrow(/manifest 지문|규모 고정 합계/)
  })
  it('rejects overlarge payload and aborts superseded work', async () => {
    const b = fixture(); const response = async (path: string) => new Response(b.get(path), { status: b.has(path) ? 200 : 404, headers: { 'content-length': '100000000' } })
    await expect(client(b, response).load(baseIds)).rejects.toThrow(/크기 초과/)
    const controller = new AbortController(); controller.abort()
    await expect(client(b).load(baseIds, controller.signal)).rejects.toThrow()
  })
  it('rejects an in-flight load after caller cancellation, even when transport returns late', async () => {
    const b = fixture()
    const controller = new AbortController()
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const request = async (path: string) => {
      if (path.endsWith('/manifest.json')) await gate
      return new Response(b.get(path), { status: b.has(path) ? 200 : 404 })
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
})
