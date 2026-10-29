import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { BenefitsArtifactClient } from './benefitsArtifactClient'
const root = `${process.cwd()}/public/`
const fixture = (url: string) => readFileSync(root + url.replace('/community/', ''), 'utf8')
const manifest = '/community/data/company-benefits/manifest.json'
function client(change?: (url: string, raw: string) => string) {
  return new BenefitsArtifactClient(async (url: string) => new Response(change?.(url, fixture(url)) ?? fixture(url)), webcrypto.subtle as SubtleCrypto)
}
describe('strict immutable benefits artifacts', () => {
  it('loads exact index, rankings and delayed detail counts', async () => {
    const c = client(); const m = await c.loadManifest(); const index = await c.loadCompanyIndex(m)
    expect(index.companies).toHaveLength(56)
    expect((await c.loadRankings(m, index)).rows).toHaveLength(560)
    expect((await c.loadCompanyDetail(m, index, 'example-001')).company_id).toBe('example-001')
  })
  it.each(['company_count', 'unknown', 'status', 'url', 'version', 'score', 'record', 'hash'])('fails closed on %s corruption', async kind => {
    const c = client((url, raw) => {
      const data = JSON.parse(raw)
      if (url === manifest) {
        if (kind === 'company_count') data.company_count++
        if (kind === 'unknown') data.extra = true
        if (kind === 'url') data.index_url = 'https://evil.test/index.json'
      } else {
        if (kind === 'status' && data.companies) data.companies[0].category_summaries.leave.status = 'invented'
        if (kind === 'version') data.data_version = 'other'
        if (kind === 'score' && data.rows) data.rows[0].score = 999
        if (kind === 'record' && data.rows) data.rows[0].company_id = 'unknown'
        if (kind === 'hash') return raw + ' '
      }
      return JSON.stringify(data) + '\n'
    })
    await expect((async () => { const m = await c.loadManifest(); const i = await c.loadCompanyIndex(m); await c.loadRankings(m, i) })()).rejects.toThrow()
  })
})
