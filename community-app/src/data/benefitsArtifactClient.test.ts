import { createHash, webcrypto } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { BenefitsArtifactClient } from './benefitsArtifactClient'
import { categories, type CompanyListing } from '../types/benefits'

const notice = '이번 조사에서 게시 가능한 공식 복지 근거를 확보하지 못했습니다. 복지가 없다는 뜻이 아닙니다.'
const json = (value: unknown) => `${JSON.stringify(value)}\n`
const descriptor = (url: string, body: string, record_count: number) => ({ url, sha256: createHash('sha256').update(body).digest('hex'), record_count, byte_count: new TextEncoder().encode(body).byteLength })
function artifacts() {
  const version = 'approved-v2'; const bodies = new Map<string, string>(); const listing_chunks = []; const company_shards: Record<string, ReturnType<typeof descriptor> & { company_id: string }> = {}
  for (let chunkIndex = 1; chunkIndex <= 40; chunkIndex++) {
    const companies = Array.from({ length: 50 }, (_, offset) => { const sequence = (chunkIndex - 1) * 50 + offset + 1; const company_id = sequence <= 1000 ? `KR-CRN-${String(sequence).padStart(13, '0')}` : `US-CIK${String(sequence).padStart(10, '0')}`; company_shards[company_id] = { ...descriptor(`community/data/company-benefits/${version}/companies/${company_id}.json`, '{}\n', 1), company_id }; return { company_id, population_sequence: sequence, legal_name: `Company ${sequence}`, display_name: `Company ${sequence}`, scope: sequence <= 1000 ? 'domestic' : 'international', jurisdiction: sequence <= 1000 ? 'KR' : 'US', incorporation_country: sequence <= 1000 ? 'KR' : 'US', registered_head_office_country: sequence <= 1000 ? 'KR' : 'US', selected_reporting_legal_entity: `Company ${sequence}`, sector: 'non_financial', category_outcomes: categories.map((category_id) => ({ kind: 'insufficient_evidence', category_id, reason_code: 'not_researched', nonabsence_notice: notice, searched_source_ids: [], searched_at: null })) } })
    const url = `community/data/company-benefits/${version}/listings/companies-${String(chunkIndex).padStart(2, '0')}.json`; const body = json({ schema_version: 1, artifact_kind: 'company_listing_chunk', artifact_protocol: 'v1', data_version: version, taxonomy_version: 'benefit-taxonomy-v1', chunk_index: chunkIndex, sequence_start: (chunkIndex - 1) * 50 + 1, sequence_end: chunkIndex * 50, companies }); bodies.set(`/${url}`, body); listing_chunks.push({ ...descriptor(url, body, 50), chunk_index: chunkIndex, first_sequence: (chunkIndex - 1) * 50 + 1, last_sequence: chunkIndex * 50 })
  }
  const base = (name: string) => descriptor(`community/data/company-benefits/${version}/${name}.json`, '{}\n', name === 'taxonomy' ? 10 : 0)
  const manifest = { schema_version: 2, artifact_kind: 'company_benefits_manifest', artifact_protocol: 'v1', data_version: version, fixture: false, generated_at: '2026-10-31T00:00:00Z', protocol: { protocol_id: 'company-benefits-population-v4', protocol_version: '4.0.0', protocol_sha256: 'a'.repeat(64), effective_selection_sha256: 'b'.repeat(64) }, taxonomy_version: 'benefit-taxonomy-v1', company_count: 2000, listing_chunk_size: 50, listing_chunk_count: 40, category_count: 10, taxonomy: base('taxonomy'), sources: base('sources'), methodology: base('methodology'), listing_chunks, company_shards }
  bodies.set('/community/data/company-benefits/manifest.json', json(manifest)); return { bodies }
}

const noPublicInfo = (category_id: (typeof categories)[number]) => ({
  category_id, state: 'no_public_info', reliability: 'none', currentness: 'unknown', scope_status: 'unresolved', conflict_status: 'none', publication_eligibility: 'discovery_only',
  assessed_at: '2026-11-01T00:00:00Z', official_claim_ids: [], reference_ids: [], community_report_ids: [], official_claim_count: 0, reference_count: 0, community_report_count: 0,
  benefit_type_count: 0, specific_benefit_count: 0, scope: { countries: [], legal_entities: [], roles: [], employment_types: [], tenure_conditions: [] }, limitation_codes: ['scope_limit', 'currentness_limit'], last_checked_at: '2026-11-01T00:00:00Z', searched_source_ids: [],
  kind: 'insufficient_evidence', status: 'insufficient_evidence', claim_count: 0, nonabsence_notice: notice, reason_code: 'searched_not_found', searched_at: '2026-11-01T00:00:00Z', source_tiers: [],
})

function withProjection(corrupt: 'none'|'hash'|'join' = 'none', projectedCount = 25) {
  const fixture = artifacts(); const manifestUrl = '/community/data/company-benefits/manifest.json'; const manifest = JSON.parse(fixture.bodies.get(manifestUrl)!)
  const version = 'approved-v2-projection'; const companies: CompanyListing[] = []
  const company_shards: Record<string, ReturnType<typeof descriptor> & { company_id: string }> = {}
  const baseCompanies = Array.from(fixture.bodies.entries()).filter(([url]) => url.includes('/listings/')).flatMap(([, body]) => JSON.parse(body).companies)
  for (const base of baseCompanies.slice(0, projectedCount)) {
    const projected = { ...base, legal_name: corrupt === 'join' && base.population_sequence === 1 ? 'Wrong canonical entity' : base.legal_name, category_outcomes: categories.map(noPublicInfo) }
    companies.push(projected)
    company_shards[base.company_id] = { ...descriptor(`community/data/company-benefits/${version}/companies/${base.company_id}.json`, '{}\n', 1), company_id: base.company_id }
  }
  const listingDescriptors = companies.reduce<Array<ReturnType<typeof descriptor> & { chunk_index: number; first_sequence: number; last_sequence: number }>>((chunks, _company, index) => {
    if (index % 50) return chunks
    const chunkCompanies = companies.slice(index, index + 50); const chunkIndex = chunks.length + 1
    const first = chunkCompanies[0]!; const last = chunkCompanies.at(-1)!
    const listingUrl = `community/data/company-benefits/${version}/listings/companies-${String(chunkIndex).padStart(2, '0')}.json`
    const listingBody = json({ schema_version: 1, artifact_kind: 'company_listing_chunk', artifact_protocol: 'vNext', data_version: version, taxonomy_version: 'benefit-taxonomy-v1', chunk_index: chunkIndex, sequence_start: first.population_sequence, sequence_end: last.population_sequence, companies: chunkCompanies })
    fixture.bodies.set(`/${listingUrl}`, corrupt === 'hash' && chunkIndex === 1 ? listingBody.replace('"chunk_index":1', '"chunk_index":2') : listingBody)
    chunks.push({ ...descriptor(listingUrl, listingBody, chunkCompanies.length), chunk_index: chunkIndex, first_sequence: first.population_sequence, last_sequence: last.population_sequence })
    return chunks
  }, [])
  const sourceUrl = `community/data/company-benefits/${version}/sources.json`; const sourceBody = json({ schema_version: 1, artifact_kind: 'company_benefits_sources', data_version: version, sources: [] }); fixture.bodies.set(`/${sourceUrl}`, sourceBody)
  const empty = (name: string, count = 0) => descriptor(`community/data/company-benefits/${version}/${name}.json`, '{}\n', count)
  manifest.taxonomy = { byte_count: manifest.taxonomy.byte_count, record_count: manifest.taxonomy.record_count, sha256: manifest.taxonomy.sha256, url: manifest.taxonomy.url }
  const active = { ...manifest }; const canonicalBase = `${JSON.stringify(active)}\n`
  manifest.approved_v2_projection = {
    projection_kind: 'approved_v2_additive', projection_status: 'in_progress', base_data_version: manifest.data_version, base_manifest_sha256: createHash('sha256').update(canonicalBase).digest('hex'), data_version: version,
    approved_batch_count: projectedCount / 25, total_batch_count: 80, projected_company_count: projectedCount, total_company_count: 2000, cell_count: projectedCount * 10, cell_state_counts: { official_verified: 0, reference: 0, community_report: 0, no_public_info: projectedCount * 10 }, listing_chunk_size: 50, listing_chunk_count: listingDescriptors.length,
    ledger_sha256: { 'company-category-cells.jsonl': 'a'.repeat(64), 'research-attempts.jsonl': 'b'.repeat(64), 'official-claims-v2.jsonl': 'c'.repeat(64), 'reference-records.jsonl': 'd'.repeat(64), 'community-benefit-reports.jsonl': 'e'.repeat(64), 'sources-v2.jsonl': 'f'.repeat(64) },
    taxonomy: empty('taxonomy', 10), sources: descriptor(sourceUrl, sourceBody, 0), methodology: empty('methodology'), listing_chunks: listingDescriptors, company_shards,
  }
  fixture.bodies.set(manifestUrl, json(manifest)); return fixture
}

function withProjectionDetail(detailCount = 1) {
  const fixture = withProjection(); const manifestUrl = '/community/data/company-benefits/manifest.json'; const manifest = JSON.parse(fixture.bodies.get(manifestUrl)!)
  const baseListings = JSON.parse(fixture.bodies.get(`/${manifest.listing_chunks[0].url}`)!).companies.slice(0, detailCount)
  const projectedListings = JSON.parse(fixture.bodies.get(`/${manifest.approved_v2_projection.listing_chunks[0].url}`)!).companies.slice(0, detailCount)
  for (const [index, baseListing] of baseListings.entries()) {
    const company = { ...Object.fromEntries(Object.entries(baseListing).filter(([key]) => !['display_name', 'category_outcomes'].includes(key))), registry_id: `registry-${index + 1}`, financial_consolidation_parent: { kind: 'unknown', reason: 'unknown' }, ultimate_parent: { kind: 'unknown', reason: 'unknown' }, benefit_policy_owner: { kind: 'unknown', reason: 'unknown' }, employment_evidence_scope: '', employment_boundary_note: '' }
    const baseDetail = json({ schema_version: 1, artifact_kind: 'company_detail', artifact_protocol: 'v1', data_version: manifest.data_version, taxonomy_version: manifest.taxonomy_version, company, category_outcomes: baseListing.category_outcomes, claims: [] })
    fixture.bodies.set(`/${manifest.company_shards[baseListing.company_id].url}`, baseDetail)
    manifest.company_shards[baseListing.company_id] = { ...descriptor(manifest.company_shards[baseListing.company_id].url, baseDetail, 1), company_id: baseListing.company_id }
    const projectedListing = projectedListings[index]
    const projectedDetail = json({ schema_version: 1, artifact_kind: 'company_detail', artifact_protocol: 'vNext', data_version: manifest.approved_v2_projection.data_version, taxonomy_version: manifest.taxonomy_version, company, category_outcomes: projectedListing.category_outcomes, claims: [], official_claims: [], references: [], community_reports: [], sources: [] })
    fixture.bodies.set(`/${manifest.approved_v2_projection.company_shards[baseListing.company_id].url}`, projectedDetail)
    manifest.approved_v2_projection.company_shards[baseListing.company_id] = { ...descriptor(manifest.approved_v2_projection.company_shards[baseListing.company_id].url, projectedDetail, 1), company_id: baseListing.company_id }
  }
  const projection = manifest.approved_v2_projection; delete manifest.approved_v2_projection
  projection.base_manifest_sha256 = createHash('sha256').update(`${JSON.stringify(manifest)}\n`).digest('hex')
  manifest.approved_v2_projection = projection; fixture.bodies.set(manifestUrl, json(manifest)); return fixture
}
describe('artifact v2 listing client', () => {
  it('cancels a streaming reader when byte accounting throws without masking the accounting error', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new TextEncoder().encode('{}')) },
      cancel() { cancelled = true; throw new Error('cancel failed') },
    })
    const client = new BenefitsArtifactClient(async () => new Response(body), webcrypto.subtle as SubtleCrypto)
    const raw = client as unknown as { raw(url: string, signal: AbortSignal | undefined, maxBytes: number, account: (bytes: number) => void): Promise<string> }
    await expect(raw.raw('/accounting-failure', undefined, 100, () => { throw new Error('상세 데이터 배치 크기 초과') })).rejects.toThrow('상세 데이터 배치 크기 초과')
    expect(cancelled).toBe(true)
  })
  it('loads exactly 40 chunks with a concurrency ceiling of four', async () => { const { bodies } = artifacts(); let active = 0; let peak = 0; const client = new BenefitsArtifactClient(async (url) => { if (url.includes('/listings/')) { active++; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 1)); active-- } return new Response(bodies.get(url), { status: bodies.has(url) ? 200 : 404 }) }, webcrypto.subtle as SubtleCrypto); const manifest = await client.loadManifest(); const companies = await client.loadListingChunks(manifest); expect(companies).toHaveLength(2000); expect(companies.at(-1)?.population_sequence).toBe(2000); expect(peak).toBeGreaterThan(1); expect(peak).toBeLessThanOrEqual(4) })
  it('fails closed on a corrupt chunk and evicts the failed cache', async () => { const { bodies } = artifacts(); const target = [...bodies.keys()].find((url) => url.includes('/listings/'))!; let corrupt = true; const client = new BenefitsArtifactClient(async (url) => new Response(url === target && corrupt ? `${bodies.get(url)} ` : bodies.get(url), { status: bodies.has(url) ? 200 : 404 }), webcrypto.subtle as SubtleCrypto); const manifest = await client.loadManifest(); await expect(client.loadListingChunks(manifest)).rejects.toThrow(); corrupt = false; await expect(client.loadListingChunks(manifest)).resolves.toHaveLength(2000) })
  it('rejects legacy category outcomes when the manifest declares explicit cells', async () => { const { bodies } = artifacts(); const manifestUrl = '/community/data/company-benefits/manifest.json'; const manifest = JSON.parse(bodies.get(manifestUrl)!); manifest.artifact_protocol = 'vNext'; manifest.cell_count = 20000; manifest.cell_state_counts = { official_verified: 0, reference: 0, community_report: 0, no_public_info: 20000 }; manifest.ledger_sha256 = { 'company-category-cells.jsonl': 'a'.repeat(64), 'research-attempts.jsonl': 'b'.repeat(64), 'official-claims-v2.jsonl': 'c'.repeat(64), 'reference-records.jsonl': 'd'.repeat(64), 'community-benefit-reports.jsonl': 'e'.repeat(64), 'sources-v2.jsonl': 'f'.repeat(64) }; bodies.set(manifestUrl, json(manifest)); const client = new BenefitsArtifactClient(async (url) => new Response(bodies.get(url), { status: bodies.has(url) ? 200 : 404 }), webcrypto.subtle as SubtleCrypto); const loaded = await client.loadManifest(); await expect(client.loadListingChunks(loaded)).rejects.toThrow('메타데이터') })
  it('rejects a post-parse traversal mutation before browser URL normalization', async () => { const { bodies } = artifacts(); const requests: string[] = []; const client = new BenefitsArtifactClient(async (url) => { requests.push(url); return new Response(bodies.get(url), { status: bodies.has(url) ? 200 : 404 }) }, webcrypto.subtle as SubtleCrypto); const manifest = await client.loadManifest(); manifest.listing_chunks[0].url = `community/data/company-benefits/${manifest.data_version}/../manifest.json`; await expect(client.loadListingChunks(manifest)).rejects.toThrow('artifact 경로'); expect(requests.filter((url) => url === '/community/data/company-benefits/manifest.json')).toHaveLength(1) })
  it('fails the whole Atlas load when a declared projection hash fails instead of falling back', async () => { const { bodies } = withProjection('hash'); const client = new BenefitsArtifactClient(async (url) => new Response(bodies.get(url), { status: bodies.has(url) ? 200 : 404 }), webcrypto.subtle as SubtleCrypto); await expect(client.loadAtlas()).rejects.toThrow('무결성 오류') })
  it('bounds all projection listing and source requests to four concurrent fetches', async () => {
    const { bodies } = withProjection('none', 125); let active = 0; let peak = 0
    const client = new BenefitsArtifactClient(async (url) => {
      if (url.includes('/approved-v2-projection/')) { active++; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 2)); active-- }
      return new Response(bodies.get(url), { status: bodies.has(url) ? 200 : 404 })
    }, webcrypto.subtle as SubtleCrypto)
    await expect(client.loadAtlas()).resolves.toMatchObject({ approvedV2Sources: { sources: [] } })
    expect(peak).toBeGreaterThan(1); expect(peak).toBeLessThanOrEqual(4)
  })
  it('stops queued projection requests and aborts in-flight siblings on the first failure', async () => {
    const { bodies } = withProjection('none', 125); const started: string[] = []; const aborted: string[] = []
    const client = new BenefitsArtifactClient(async (url, signal) => {
      if (!url.includes('/approved-v2-projection/')) return new Response(bodies.get(url), { status: bodies.has(url) ? 200 : 404 })
      started.push(url)
      if (url.endsWith('companies-01.json')) return new Response(`${bodies.get(url)} `)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 20)
        signal?.addEventListener('abort', () => { clearTimeout(timer); aborted.push(url); resolve() }, { once: true })
      })
      signal?.throwIfAborted()
      return new Response(bodies.get(url), { status: bodies.has(url) ? 200 : 404 })
    }, webcrypto.subtle as SubtleCrypto)
    await expect(client.loadAtlas()).rejects.toThrow('byte count 불일치')
    expect(started.length).toBeLessThan(6)
    expect(aborted.length).toBeGreaterThan(0)
  })
  it('propagates caller abort to projection requests', async () => {
    const { bodies } = withProjection('none', 125); const controller = new AbortController(); const aborted: string[] = []
    let projectionStarted!: () => void; const started = new Promise<void>((resolve) => { projectionStarted = resolve })
    const client = new BenefitsArtifactClient(async (url, signal) => {
      if (!url.includes('/approved-v2-projection/')) return new Response(bodies.get(url), { status: bodies.has(url) ? 200 : 404 })
      projectionStarted()
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => { aborted.push(url); resolve() }, { once: true }))
      signal?.throwIfAborted(); return new Response(bodies.get(url))
    }, webcrypto.subtle as SubtleCrypto)
    const loading = client.loadAtlas(controller.signal); await started; controller.abort(new Error('caller cancelled'))
    await expect(loading).rejects.toThrow('caller cancelled')
    expect(aborted.length).toBeGreaterThan(0)
  })
  it('rejects a projected listing that does not exact-join its canonical base company sequence', async () => { const { bodies } = withProjection('join'); const client = new BenefitsArtifactClient(async (url) => new Response(bodies.get(url), { status: bodies.has(url) ? 200 : 404 }), webcrypto.subtle as SubtleCrypto); await expect(client.loadAtlas()).rejects.toThrow(/canonical company|identity/) })
  it('keeps legacy-only manifests compatible while exposing explicit lineage', async () => { const { bodies } = artifacts(); const client = new BenefitsArtifactClient(async (url) => new Response(bodies.get(url), { status: bodies.has(url) ? 200 : 404 }), webcrypto.subtle as SubtleCrypto); const atlas = await client.loadAtlas(); expect(atlas.companies).toHaveLength(2000); expect(atlas.companies[0].lineage.approved_v2).toBeUndefined(); expect(atlas.companies[0].lineage.legacy.category_outcomes[0].kind).toBe('insufficient_evidence') })
  it('loads and exact-joins both legacy and projected company details', async () => { const { bodies } = withProjectionDetail(); const client = new BenefitsArtifactClient(async (url) => new Response(bodies.get(url), { status: bodies.has(url) ? 200 : 404 }), webcrypto.subtle as SubtleCrypto); const atlas = await client.loadAtlas(); const detail = await client.loadAtlasCompanyDetail(atlas, atlas.companies[0].company_id); expect(detail.legacy.artifact_protocol).toBe('v1'); expect(detail.approvedV2?.artifact_protocol).toBe('vNext'); expect(detail.approvedV2?.company.population_sequence).toBe(detail.legacy.company.population_sequence) })
  it('bounds projected company detail fetches to the existing concurrency ceiling', async () => {
    const { bodies } = withProjectionDetail(4); let active = 0; let peak = 0
    const client = new BenefitsArtifactClient(async (url) => {
      if (url.includes('/approved-v2-projection/companies/')) { active++; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 2)); active-- }
      return new Response(bodies.get(url), { status: bodies.has(url) ? 200 : 404 })
    }, webcrypto.subtle as SubtleCrypto)
    const atlas = await client.loadAtlas()
    await expect(client.loadAtlasCompanyDetails(atlas, atlas.companies.slice(0, 4).map((company) => company.company_id))).resolves.toHaveLength(4)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(4)
  })
  it('aborts projected detail siblings, preserves the first failure, and suppresses queued work', async () => {
    const { bodies } = withProjectionDetail(4); const started: string[] = []; const aborted: string[] = []
    const client = new BenefitsArtifactClient(async (url, signal) => {
      if (!url.includes('/approved-v2-projection/companies/')) return new Response(bodies.get(url), { status: bodies.has(url) ? 200 : 404 })
      started.push(url)
      if (started.length === 1) return new Response(`${bodies.get(url)} `)
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => { aborted.push(url); resolve() }, { once: true }))
      signal?.throwIfAborted()
      return new Response(bodies.get(url))
    }, webcrypto.subtle as SubtleCrypto)
    const atlas = await client.loadAtlas()
    await expect(client.loadAtlasCompanyDetails(atlas, atlas.companies.slice(0, 4).map((company) => company.company_id))).rejects.toThrow('byte count 불일치')
    expect(started.length).toBeLessThanOrEqual(4)
    expect(aborted.length).toBeGreaterThan(0)
  })
  it('propagates caller abort while projected company details are in flight', async () => {
    const { bodies } = withProjectionDetail(4); const controller = new AbortController(); const aborted: string[] = []
    let projectedStarted!: () => void; const started = new Promise<void>((resolve) => { projectedStarted = resolve })
    const client = new BenefitsArtifactClient(async (url, signal) => {
      if (!url.includes('/approved-v2-projection/companies/')) return new Response(bodies.get(url), { status: bodies.has(url) ? 200 : 404 })
      projectedStarted()
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => { aborted.push(url); resolve() }, { once: true }))
      signal?.throwIfAborted()
      return new Response(bodies.get(url))
    }, webcrypto.subtle as SubtleCrypto)
    const atlas = await client.loadAtlas()
    const loading = client.loadAtlasCompanyDetails(atlas, atlas.companies.slice(0, 4).map((company) => company.company_id), controller.signal)
    await started; controller.abort(new Error('detail caller cancelled'))
    await expect(loading).rejects.toThrow('detail caller cancelled')
    expect(aborted.length).toBeGreaterThan(0)
  })
})
