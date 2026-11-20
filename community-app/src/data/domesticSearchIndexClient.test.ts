import { createHash, webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
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
