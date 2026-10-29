import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { BenefitsArtifactClient } from './benefitsArtifactClient'
const root = `${process.cwd()}/public/`
const fixture = (url: string) =>
  readFileSync(root + url.replace('/community/', ''), 'utf8')
const manifest = '/community/data/company-benefits/manifest.json'
function client(change?: (url: string, raw: string) => string) {
  return new BenefitsArtifactClient(
    async (url: string) =>
      new Response(change?.(url, fixture(url)) ?? fixture(url)),
    webcrypto.subtle as SubtleCrypto,
  )
}
describe('strict immutable benefits artifacts', () => {
  it('loads exact index, rankings and delayed detail counts', async () => {
    const c = client()
    const m = await c.loadManifest()
    const index = await c.loadCompanyIndex(m)
    expect(index.companies).toHaveLength(56)
    expect((await c.loadRankings(m, index)).rows).toHaveLength(560)
    expect(
      (await c.loadCompanyDetail(m, index, 'example-001')).company_id,
    ).toBe('example-001')
  })
  it.each([
    'company_count',
    'unknown',
    'status',
    'url',
    'version',
    'score',
    'record',
    'hash',
  ])('fails closed on %s corruption', async (kind) => {
    const c = client((url, raw) => {
      const data = JSON.parse(raw)
      if (url === manifest) {
        if (kind === 'company_count') data.company_count++
        if (kind === 'unknown') data.extra = true
        if (kind === 'url') data.index_url = 'https://evil.test/index.json'
      } else {
        if (kind === 'status' && data.companies)
          data.companies[0].category_summaries.leave.status = 'invented'
        if (kind === 'version') data.data_version = 'other'
        if (kind === 'score' && data.rows) data.rows[0].score = 999
        if (kind === 'record' && data.rows) data.rows[0].company_id = 'unknown'
        if (kind === 'hash') return raw + ' '
      }
      return JSON.stringify(data) + '\n'
    })
    await expect(
      (async () => {
        const m = await c.loadManifest()
        const i = await c.loadCompanyIndex(m)
        await c.loadRankings(m, i)
      })(),
    ).rejects.toThrow()
  })
})

// Re-sign mutations to test semantic validation independently of byte integrity.
function signedMutation(
  target: string,
  mutate: (data: Record<string, unknown>) => void,
) {
  const raw = JSON.parse(fixture(target))
  mutate(raw)
  const body = JSON.stringify(raw) + '\n'
  const m = JSON.parse(fixture(manifest))
  return webcrypto.subtle
    .digest('SHA-256', new TextEncoder().encode(body))
    .then((hash) => {
      m.artifact_sha256[target].sha256 = Array.from(new Uint8Array(hash), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('')
      return new BenefitsArtifactClient(
        async (url) =>
          new Response(
            url === manifest
              ? JSON.stringify(m)
              : url === target
                ? body
                : fixture(url),
          ),
        webcrypto.subtle as SubtleCrypto,
      )
    })
}
it('rejects a re-signed ranking of an unknown category as eligible', async () => {
  const c = await signedMutation(
    '/community/data/company-benefits/fixture-v1/rankings.json',
    (data) => {
      const rows = data.rows as { eligible: boolean; reason: string }[]
      rows[4].eligible = true
      rows[4].reason = ''
    },
  )
  const m = await c.loadManifest()
  const i = await c.loadCompanyIndex(m)
  await expect(c.loadRankings(m, i)).rejects.toThrow('근거')
})
it('rejects duplicate claims even with correct shard hash', async () => {
  const c = await signedMutation(
    '/community/data/company-benefits/fixture-v1/details/companies.json',
    (data) => {
      const companies = data.companies as { claims: unknown[] }[]
      companies[0].claims.push(companies[0].claims[0])
    },
  )
  const m = await c.loadManifest()
  const i = await c.loadCompanyIndex(m)
  await expect(c.loadCompanyDetail(m, i, 'example-001')).rejects.toThrow()
})
it('rejects contradictory summary counts in a correctly hashed detail shard', async () => {
  const c = await signedMutation(
    '/community/data/company-benefits/fixture-v1/details/companies.json',
    (data) => {
      const companies = data.companies as { claims: { status: string }[] }[]
      companies[0].claims[0].status = '상충'
    },
  )
  const m = await c.loadManifest()
  const i = await c.loadCompanyIndex(m)
  await expect(c.loadCompanyDetail(m, i, 'example-001')).rejects.toThrow()
})

it.each([
  'http://example.org/benefits',
  'https://evil.test/benefits',
  'https://user:pass@example.org/benefits',
  'javascript:alert(1)',
])('rejects unsafe original source %s even with valid bytes', async (url) => {
  const c = await signedMutation(
    '/community/data/company-benefits/fixture-v1/details/companies.json',
    (data) => {
      const companies = data.companies as {
        claims: { source: { url: string } }[]
      }[]
      companies[0].claims[0].source.url = url
    },
  )
  const m = await c.loadManifest()
  const i = await c.loadCompanyIndex(m)
  await expect(c.loadCompanyDetail(m, i, 'example-001')).rejects.toThrow()
})
it.each(['sum', 'reference', 'extra'])(
  'checks ranking %s independently of the hash',
  async (kind) => {
    const c = await signedMutation(
      '/community/data/company-benefits/fixture-v1/rankings.json',
      (data) => {
        const rows = data.rows as {
          score: number
          company_id: string
          extra?: boolean
        }[]
        if (kind === 'sum') rows[0].score = 99
        if (kind === 'reference') rows[0].company_id = 'example-1999'
        if (kind === 'extra') rows[0].extra = true
      },
    )
    const m = await c.loadManifest()
    const i = await c.loadCompanyIndex(m)
    await expect(c.loadRankings(m, i)).rejects.toThrow()
  },
)
it('does not poison immutable caches after a failed read', async () => {
  let fail = true
  const c = new BenefitsArtifactClient(async (url) => {
    const raw = fixture(url)
    return new Response(
      url.endsWith('/rankings.json') && fail ? raw + ' ' : raw,
    )
  }, webcrypto.subtle as SubtleCrypto)
  const m = await c.loadManifest()
  const i = await c.loadCompanyIndex(m)
  await expect(c.loadRankings(m, i)).rejects.toThrow('무결성')
  fail = false
  expect((await c.loadRankings(m, i)).rows).toHaveLength(560)
})
