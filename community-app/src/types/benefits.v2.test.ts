import { expect, it } from 'vitest'
import { manifestSchema } from './benefits'

it('accepts schema v2 and rejects ranking semantics', () => {
  const descriptor = { url: '/community/data/company-benefits/v2/taxonomy.json', sha256: 'a'.repeat(64), record_count: 10, byte_count: 100 }
  const manifest = {
    schema_version: 2,
    artifact_kind: 'company_benefits_manifest',
    data_version: 'v2',
    fixture: false,
    generated_at: '2026-10-31T00:00:00Z',
    protocol: { protocol_id: 'company-benefits-population-v4', protocol_version: '4.0.0', protocol_sha256: 'b'.repeat(64), effective_selection_sha256: 'c'.repeat(64) },
    taxonomy_version: 'benefit-taxonomy-v1', company_count: 2000, listing_chunk_size: 50, listing_chunk_count: 40, category_count: 10,
    taxonomy: descriptor, sources: { ...descriptor, url: '/community/data/company-benefits/v2/sources.json' }, methodology: { ...descriptor, url: '/community/data/company-benefits/v2/methodology.json' },
    listing_chunks: Array.from({ length: 40 }, (_, i) => ({ ...descriptor, url: `/community/data/company-benefits/v2/listings/${String(i + 1).padStart(4, '0')}.json`, chunk_index: i + 1, first_sequence: i * 50 + 1, last_sequence: i * 50 + 50, record_count: 50 })),
    company_shards: Object.fromEntries(Array.from({ length: 2000 }, (_, i) => { const id = `KR-CRN-${String(i + 1).padStart(13, '0')}`; return [id, { ...descriptor, url: `/community/data/company-benefits/v2/companies/${id}.json`, company_id: id, record_count: 1 }] })),
  }
  expect(manifestSchema.parse(manifest).fixture).toBe(false)
  expect(manifestSchema.safeParse({ ...manifest, rankings_url: '/x' }).success).toBe(false)
})
