import { z } from 'zod'

export const categories = ['leave','family','health','growth','housing','commute','remote','retirement','meals','inclusion'] as const
export type Category = (typeof categories)[number]
export const categoryLabels: Record<Category, string> = {
  leave: '휴가·근무시간', family: '육아·가족', health: '건강·보험', growth: '교육·성장', housing: '주거·금융', commute: '이동·통근', remote: '유연근무·원격근무', retirement: '퇴직·장기근속', meals: '식사·생활편의', inclusion: '포용·접근성',
}
export const outcomeStatuses = ['confirmed', 'bounded', 'insufficient_evidence'] as const
export const outcomeLabels = { confirmed: '확인됨', bounded: '범위 제한 확인', insufficient_evidence: '근거 부족' } as const

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const companyId = z.string().regex(/^(?:KR-CRN-\d{13}|US-CIK\d{10})$/)
const version = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/)
const artifactUrl = z.string().regex(/^community\/data\/company-benefits\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.json$/)
const descriptorSchema = z.strictObject({ url: artifactUrl, sha256: hash, record_count: z.number().int().nonnegative(), byte_count: z.number().int().positive() })
export const categoryScopeSchema = z.strictObject({ countries: z.array(z.string()), legal_entities: z.array(z.string()), roles: z.array(z.string()), employment_types: z.array(z.string()), tenure_conditions: z.array(z.string()) })
const insufficientNotice = z.literal('이번 조사에서 게시 가능한 공식 복지 근거를 확보하지 못했습니다. 복지가 없다는 뜻이 아닙니다.')
export const categoryOutcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('evidenced'), category_id: z.enum(categories), status: z.enum(['confirmed','bounded']), claim_count: z.number().int().positive(), benefit_type_count: z.number().int().positive(), scope: categoryScopeSchema, limitation_codes: z.array(z.string()), last_checked_at: z.iso.datetime() }),
  z.strictObject({ kind: z.literal('insufficient_evidence'), category_id: z.enum(categories), reason_code: z.enum(['not_researched','searched_not_found','entity_binding_missing']), nonabsence_notice: insufficientNotice, searched_source_ids: z.array(z.string()), searched_at: z.iso.datetime().nullable() }),
])
const explicitCellOutcomeSchema = z.strictObject({
  category_id: z.enum(categories), state: z.enum(['official_verified', 'reference', 'community_report', 'no_public_info']),
  reliability: z.enum(['high', 'medium', 'low', 'none']), currentness: z.enum(['current', 'historical', 'unknown']),
  scope_status: z.enum(['exact_entity', 'bounded_entity', 'group_only', 'unresolved']), conflict_status: z.enum(['none', 'disclosed', 'contradictory']),
  publication_eligibility: z.enum(['official_claim', 'reference_only', 'community_only', 'discovery_only']), assessed_at: z.iso.datetime(),
  official_claim_ids: z.array(z.string().min(1)), reference_ids: z.array(z.string().min(1)), community_report_ids: z.array(z.string().min(1)),
  nonabsence_notice: insufficientNotice.optional(),
  kind: z.enum(['evidenced', 'insufficient_evidence']), status: z.enum(['confirmed', 'bounded']),
  claim_count: z.number().int().nonnegative(), benefit_type_count: z.number().int().nonnegative(), scope: categoryScopeSchema,
  limitation_codes: z.array(z.string()), last_checked_at: z.iso.datetime(), reason_code: z.enum(['searched_not_found', 'entity_binding_missing']),
  searched_source_ids: z.array(z.string()), searched_at: z.iso.datetime(),
}).superRefine((outcome: {
  state: 'official_verified' | 'reference' | 'community_report' | 'no_public_info'; reliability: 'high' | 'medium' | 'low' | 'none'; currentness: 'current' | 'historical' | 'unknown'; publication_eligibility: 'official_claim' | 'reference_only' | 'community_only' | 'discovery_only'; official_claim_ids: string[]; reference_ids: string[]; community_report_ids: string[]; nonabsence_notice?: string
}, ctx: z.RefinementCtx) => {
  const ids = [outcome.official_claim_ids.length, outcome.reference_ids.length, outcome.community_report_ids.length]
  const valid = outcome.state === 'official_verified' ? ids[0] > 0 && !ids[1] && !ids[2] && ['high', 'medium'].includes(outcome.reliability) && outcome.publication_eligibility === 'official_claim'
    : outcome.state === 'reference' ? !ids[0] && ids[1] > 0 && !ids[2] && ['medium', 'low'].includes(outcome.reliability) && outcome.publication_eligibility === 'reference_only'
      : outcome.state === 'community_report' ? !ids[0] && !ids[1] && ids[2] > 0 && outcome.reliability === 'low' && outcome.publication_eligibility === 'community_only'
        : !ids[0] && !ids[1] && !ids[2] && outcome.reliability === 'none' && outcome.currentness === 'unknown' && outcome.publication_eligibility === 'discovery_only' && outcome.nonabsence_notice === insufficientNotice.value
  if (!valid) ctx.addIssue({ code: 'custom', message: '명시적 cell 상태 메타데이터 불일치' })
})
export const vNextCategoryOutcomeSchema = explicitCellOutcomeSchema
export const compatibleCategoryOutcomeSchema = z.union([categoryOutcomeSchema, explicitCellOutcomeSchema])
export type CategoryOutcome = z.infer<typeof compatibleCategoryOutcomeSchema>

export const companyListingSchema = z.strictObject({
  company_id: companyId, population_sequence: z.number().int().min(1).max(2000), legal_name: z.string().min(1), display_name: z.string().min(1), scope: z.enum(['domestic','international']), jurisdiction: z.enum(['KR','US']), incorporation_country: z.string().length(2), registered_head_office_country: z.string().length(2), selected_reporting_legal_entity: z.string().min(1), sector: z.enum(['financial','non_financial']), category_outcomes: z.array(compatibleCategoryOutcomeSchema).length(10),
}).superRefine((company, ctx) => {
  if (company.category_outcomes.some((outcome, index) => outcome.category_id !== categories[index])) ctx.addIssue({ code: 'custom', message: '분야 결과 순서/완전성 오류' })
})
export type CompanyListing = z.infer<typeof companyListingSchema>
export type Company = CompanyListing

export const listingChunkSchema = z.strictObject({ schema_version: z.literal(1), artifact_kind: z.literal('company_listing_chunk'), data_version: version, taxonomy_version: z.literal('benefit-taxonomy-v1'), chunk_index: z.number().int().min(1).max(40), sequence_start: z.number().int().min(1), sequence_end: z.number().int().max(2000), companies: z.array(companyListingSchema).length(50) })
export type ListingChunk = z.infer<typeof listingChunkSchema>
export type CompanyIndex = { data_version: string; companies: CompanyListing[] }

const sourceEvidenceSchema = z.strictObject({
  source_id: z.string().min(1), role: z.string().min(1), proposition: z.string().min(1), source_locator: z.string().min(1), supporting_quote: z.string().min(1), content_sha256: hash,
  source: z.strictObject({ title: z.string().min(1), owner: z.string().min(1), source_type: z.string().min(1), jurisdiction: z.string().min(1), url: z.string().url().refine((value) => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password }, '안전하지 않은 출처 URL'), final_owner_domain: z.string().min(1), publication_date: z.iso.date().nullable(), checked_at: z.iso.datetime(), evidence_eligibility: z.enum(['A','B']) }).superRefine((source, ctx) => { if (new URL(source.url).hostname !== source.final_owner_domain) ctx.addIssue({ code: 'custom', message: '출처 도메인 불일치' }) }),
})
export const claimSchema = z.strictObject({ claim_id: z.string().min(1), benefit_type_ids: z.array(z.string().min(1)).min(1), category_ids: z.array(z.enum(categories)).min(1), benefit_name: z.string().min(1), detail: z.string().min(1), research_status: z.enum(['confirmed','limited','past','name_only','conflict']), current_validity: z.enum(['current','undated_current','historical']), evidence_grade: z.enum(['A','B']), application_scope: z.strictObject({ countries: z.array(z.string()), legal_entities: z.array(z.string()), roles: z.array(z.string()), employment_types: z.array(z.string()), tenure_condition: z.string() }), limitation_codes: z.array(z.string()), publication_date: z.iso.date().nullable(), checked_at: z.iso.datetime(), source_evidence: z.array(sourceEvidenceSchema).min(1) })
export type Claim = z.infer<typeof claimSchema>
const unknownValueSchema = z.union([z.string().min(1), z.strictObject({ kind: z.literal('unknown'), reason: z.string().min(1) })])
export const detailSchema = z.strictObject({ schema_version: z.literal(1), artifact_kind: z.literal('company_detail'), data_version: version, taxonomy_version: z.literal('benefit-taxonomy-v1'), company: z.strictObject({ company_id: companyId, population_sequence: z.number().int().min(1).max(2000), legal_name: z.string().min(1), scope: z.enum(['domestic','international']), jurisdiction: z.enum(['KR','US']), registry_id: z.string().min(1), selected_reporting_legal_entity: z.string().min(1), incorporation_country: z.string().length(2), registered_head_office_country: z.string().length(2), financial_consolidation_parent: unknownValueSchema, ultimate_parent: unknownValueSchema, benefit_policy_owner: unknownValueSchema, sector: z.enum(['financial','non_financial']), employment_evidence_scope: z.string(), employment_boundary_note: z.string() }), category_outcomes: z.array(compatibleCategoryOutcomeSchema).length(10), claims: z.array(claimSchema) })
export type Detail = z.infer<typeof detailSchema>

export const methodologySchema = z.strictObject({ schema_version: z.literal(1), artifact_kind: z.literal('company_benefits_methodology'), data_version: version, taxonomy_version: z.literal('benefit-taxonomy-v1'), title: z.string().min(1), paragraphs: z.array(z.string().min(1)).min(1) })

export const manifestSchema = z.strictObject({
  schema_version: z.literal(2), artifact_kind: z.literal('company_benefits_manifest'), data_version: version, fixture: z.literal(false), generated_at: z.iso.datetime(),
  protocol: z.strictObject({ protocol_id: z.literal('company-benefits-population-v4'), protocol_version: z.literal('4.0.0'), protocol_sha256: hash, effective_selection_sha256: hash }), taxonomy_version: z.literal('benefit-taxonomy-v1'), company_count: z.literal(2000), listing_chunk_size: z.literal(50), listing_chunk_count: z.literal(40), category_count: z.literal(10), taxonomy: descriptorSchema, sources: descriptorSchema, methodology: descriptorSchema,
  cell_count: z.literal(20000).optional(), cell_state_counts: z.strictObject({ official_verified: z.number().int().nonnegative(), reference: z.number().int().nonnegative(), community_report: z.number().int().nonnegative(), no_public_info: z.number().int().nonnegative() }).optional(),
  ledger_sha256: z.strictObject({ 'company-category-cells.jsonl': hash, 'research-attempts.jsonl': hash, 'official-claims-v2.jsonl': hash, 'reference-records.jsonl': hash, 'community-benefit-reports.jsonl': hash, 'sources-v2.jsonl': hash }).optional(),
  listing_chunks: z.array(descriptorSchema.extend({ chunk_index: z.number().int().min(1).max(40), first_sequence: z.number().int().min(1), last_sequence: z.number().int().max(2000) })).length(40),
  company_shards: z.record(companyId, descriptorSchema.extend({ company_id: companyId })),
}).superRefine((manifest, ctx) => {
  const prefix = `community/data/company-benefits/${manifest.data_version}/`
  const descriptors = [manifest.taxonomy, manifest.sources, manifest.methodology, ...manifest.listing_chunks, ...Object.values(manifest.company_shards)]
  if (descriptors.some((descriptor) => !descriptor.url.startsWith(prefix))) ctx.addIssue({ code: 'custom', message: 'artifact 버전 경로 불일치' })
  if (new Set(descriptors.map((descriptor) => descriptor.url)).size !== descriptors.length) ctx.addIssue({ code: 'custom', message: 'artifact 경로 중복' })
  if (manifest.taxonomy.url !== `${prefix}taxonomy.json` || manifest.sources.url !== `${prefix}sources.json` || manifest.methodology.url !== `${prefix}methodology.json`) ctx.addIssue({ code: 'custom', message: 'artifact 역할 경로 불일치' })
  if (Object.keys(manifest.company_shards).length !== 2000) ctx.addIssue({ code: 'custom', message: '회사 shard 개수 불일치' })
  manifest.listing_chunks.forEach((chunk, index) => { if (chunk.url !== `${prefix}listings/companies-${String(index + 1).padStart(2, '0')}.json` || chunk.chunk_index !== index + 1 || chunk.first_sequence !== index * 50 + 1 || chunk.last_sequence !== index * 50 + 50 || chunk.record_count !== 50) ctx.addIssue({ code: 'custom', message: '목록 chunk 경로/범위 불일치' }) })
  for (const [companyId, shard] of Object.entries(manifest.company_shards)) if (shard.company_id !== companyId || shard.url !== `${prefix}companies/${companyId}.json` || shard.record_count !== 1) ctx.addIssue({ code: 'custom', message: '회사 shard 경로/ID 불일치' })
  const explicit = [manifest.cell_count, manifest.cell_state_counts, manifest.ledger_sha256]
  if (explicit.some((value) => value !== undefined) && explicit.some((value) => value === undefined)) ctx.addIssue({ code: 'custom', message: '명시적 cell manifest 메타데이터 불완전' })
  if (manifest.cell_state_counts && (Object.values(manifest.cell_state_counts) as number[]).reduce((sum, count) => sum + count, 0) !== 20000) ctx.addIssue({ code: 'custom', message: 'cell 상태 합계 불일치' })
})
export type Manifest = z.infer<typeof manifestSchema>

export function outcomeFor(company: CompanyListing, category: Category) { return company.category_outcomes.find((outcome) => outcome.category_id === category)! }
export function assertListingOutcomes(companies: CompanyListing[]) {
  const ids = new Set<string>(); const sequences = new Set<number>()
  for (const company of companies) {
    if (ids.has(company.company_id) || sequences.has(company.population_sequence)) throw new Error('회사 목록 중복')
    ids.add(company.company_id); sequences.add(company.population_sequence)
  }
}
export function assertExplicitCellInventory(companies: CompanyListing[], manifest: Manifest) {
  if (manifest.cell_count === undefined) return
  const counts = { official_verified: 0, reference: 0, community_report: 0, no_public_info: 0 }
  for (const company of companies) for (const outcome of company.category_outcomes) {
    if (!('state' in outcome)) throw new Error('vNext artifact에 legacy category outcome이 포함됨')
    counts[outcome.state as keyof typeof counts]++
  }
  if (companies.length * categories.length !== manifest.cell_count || JSON.stringify(counts) !== JSON.stringify(manifest.cell_state_counts)) throw new Error('명시적 cell inventory 불일치')
}
export function assertCompanyDetailEvidence(listing: CompanyListing, detail: Detail) {
  if (listing.company_id !== detail.company.company_id) throw new Error('상세 기업 참조 불일치')
  for (const category of categories) {
    const listed = outcomeFor(listing, category)
    const detailed = detail.category_outcomes.find((outcome) => outcome.category_id === category)
    if (JSON.stringify(listed) !== JSON.stringify(detailed)) throw new Error('상세와 목록 결과 불일치')
    if (!('state' in listed) && listed.kind === 'evidenced') {
      const claims = detail.claims.filter((claim) => claim.category_ids.includes(category))
      if (claims.length !== listed.claim_count) throw new Error('결과와 claim 개수 불일치')
    }
  }
}
