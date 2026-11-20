import { createHash, webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DomesticSearchIndexClient } from './domesticSearchIndexClient'
import { selectDomestic } from './domesticDirectoryClient'

const file = 'public/data/company-benefits/domestic-search-index-v1/index.json'
const url = '/community/data/company-benefits/domestic-search-index-v1/index.json'
const original = () => readFileSync(file)
const client = (bytes: Uint8Array, calls: string[]) => new DomesticSearchIndexClient(async path => {
  calls.push(path)
  return new Response(bytes as BodyInit)
}, webcrypto.subtle as SubtleCrypto)

describe('one-request domestic search snapshot', () => {
  afterEach(() => { vi.useRealTimers() })
  it('settles a request that ignores abort at the end-to-end deadline', async () => {
    vi.useFakeTimers()
    const request = vi.fn((path: string, signal?: AbortSignal): Promise<Response> => { void path; void signal; return new Promise(() => {}) })
    const load = new DomesticSearchIndexClient(request, webcrypto.subtle as SubtleCrypto).load()
    const rejection = expect(load).rejects.toThrow(/시간 초과/)
    await vi.advanceTimersByTimeAsync(30_000)
    await rejection
    expect(request.mock.calls[0][1]?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('settles a stalled stream at the same deadline and cancels its reader', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    const request = vi.fn(async () => new Response(body))
    const load = new DomesticSearchIndexClient(request, webcrypto.subtle as SubtleCrypto).load()
    const rejection = expect(load).rejects.toThrow(/시간 초과/)
    await vi.advanceTimersByTimeAsync(30_000)
    await rejection
    expect(cancel).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('caller cancellation settles an uncooperative request before the deadline', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const request = vi.fn((path: string, signal?: AbortSignal): Promise<Response> => { void path; void signal; return new Promise(() => {}) })
    const load = new DomesticSearchIndexClient(request, webcrypto.subtle as SubtleCrypto).load(controller.signal)
    const rejection = expect(load).rejects.toThrow(/abort/i)
    controller.abort()
    await rejection
    expect(request.mock.calls[0][1]?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cleans the deadline after a successful snapshot', async () => {
    vi.useFakeTimers()
    const result = await client(original(), []).load()
    expect(result.entries).toHaveLength(40053)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('loads exactly 40,053 distinct identities with 174 base aliases and no Atlas requests', async () => {
    const calls: string[] = []
    const result = await client(original(), calls).load()
    expect(calls).toEqual([url])
    expect(result.entries).toHaveLength(40053)
    expect(new Set(result.entries.map(x => x.id)).size).toBe(40053)
    expect(result.totals).toMatchObject({ base_aliases: 174, new_records: 35910 })
    expect(result.approved).toBe(0)
    expect([...result.research.values()].reduce((a, b) => a + b, 0)).toBe(128)
    expect(selectDomestic(result.entries, { q: '', size: 'all', benefits: true, page: 1 }, result.research).total).toBe(result.research.size)
  })
  it('rejects a deleted row even when an attacker recomputes self-declared digest and totals', async () => {
    const doc = JSON.parse(original().toString('utf8'))
    doc.entries.pop()
    doc.totals.records--
    doc.digest = createHash('sha256').update(JSON.stringify(doc.entries)).digest('hex')
    await expect(client(Buffer.from(JSON.stringify(doc)), []).load()).rejects.toThrow(/snapshot|지문|합계/)
  })
  it('rejects an overlong streamed response even if content-length is absent', async () => {
    const calls: string[] = []
    await expect(client(Buffer.alloc(9_000_001), calls).load()).rejects.toThrow(/크기/)
    expect(calls).toEqual([url])
  })
})
