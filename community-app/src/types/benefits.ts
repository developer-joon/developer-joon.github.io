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
const artifactUrl = z.string().regex(/^\/community\/data\/company-benefits\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/.+\.json$/)
const descriptorSchema = z.strictObject({ url: artifactUrl, sha256: hash, record_count: z.number().int().nonnegative(), byte_count: z.number().int().positive() })
export const categoryScopeSchema = z.strictObject({ countries: z.array(z.string()), legal_entities: z.array(z.string()), roles: z.array(z.string()), employment_types: z.array(z.string()), tenure_conditions: z.array(z.string()) })
const insufficientNotice = z.literal('이번 조사에서 게시 가능한 공식 복지 근거를 확보하지 못했습니다. 복지가 없다는 뜻이 아닙니다.')
export const categoryOutcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('evidenced'), category_id: z.enum(categories), status: z.enum(['confirmed','bounded']), claim_count: z.number().int().positive(), benefit_type_count: z.number().int().positive(), scope: categoryScopeSchema, limitation_codes: z.array(z.string()), last_checked_at: z.iso.datetime() }),
  z.strictObject({ kind: z.literal('insufficient_evidence'), category_id: z.enum(categories), reason_code: z.enum(['not_researched','searched_not_found','entity_binding_missing']), nonabsence_notice: insufficientNotice, searched_source_ids: z.array(z.string()), searched_at: z.iso.datetime().nullable() }),
])
export type CategoryOutcome = z.infer<typeof categoryOutcomeSchema>

export const companyListingSchema = z.strictObject({
  company_id: companyId, population_sequence: z.number().int().min(1).max(2000), legal_name: z.string().min(1), display_name: z.string().min(1), scope: z.enum(['domestic','international']), jurisdiction: z.enum(['KR','US']), incorporation_country: z.string().length(2), registered_head_office_country: z.string().length(2), selected_reporting_legal_entity: z.string().min(1), sector: z.enum(['financial','non_financial']), category_outcomes: z.array(categoryOutcomeSchema).length(10),
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
const reviewSchema = z.strictObject({ review_id: z.string().min(1), researcher_id: z.string().min(1), reviewer_id: z.string().min(1), decision: z.literal('approved'), reviewed_at: z.iso.datetime(), quote_entailment_confirmed: z.literal(true), source_entailment_reviews: z.array(z.strictObject({ source_id: z.string().min(1), reviewed_role: z.string().min(1), reviewed_proposition: z.string().min(1), source_locator: z.string().min(1), reviewed_quote: z.string().min(1), content_sha256: hash, entailment_confirmed: z.literal(true), reviewer_id: z.string().min(1) })), conflict_determination: z.enum(['resolved_supports','resolved_contradicts','unresolved']).optional() }).refine((review) => review.researcher_id !== review.reviewer_id, '독립 검토 필요')
export const claimSchema = z.strictObject({ claim_id: z.string().min(1), benefit_type_ids: z.array(z.string().min(1)).min(1), category_ids: z.array(z.enum(categories)).min(1), benefit_name: z.string().min(1), detail: z.string().min(1), research_status: z.enum(['confirmed','limited','past','name_only','conflict']), current_validity: z.enum(['current','undated_current','historical']), evidence_grade: z.enum(['A','B']), application_scope: z.strictObject({ countries: z.array(z.string()), legal_entities: z.array(z.string()), roles: z.array(z.string()), employment_types: z.array(z.string()), tenure_condition: z.string() }), limitation_codes: z.array(z.string()), publication_date: z.iso.date().nullable(), checked_at: z.iso.datetime(), source_evidence: z.array(sourceEvidenceSchema).min(1), review: reviewSchema })
export type Claim = z.infer<typeof claimSchema>
const unknownValueSchema = z.union([z.string().min(1), z.strictObject({ kind: z.literal('unknown'), reason: z.string().min(1) })])
export const detailSchema = z.strictObject({ schema_version: z.literal(1), artifact_kind: z.literal('company_detail'), data_version: version, taxonomy_version: z.literal('benefit-taxonomy-v1'), company: z.strictObject({ company_id: companyId, population_sequence: z.number().int().min(1).max(2000), legal_name: z.string().min(1), scope: z.enum(['domestic','international']), jurisdiction: z.enum(['KR','US']), registry_id: z.string().min(1), selected_reporting_legal_entity: z.string().min(1), incorporation_country: z.string().length(2), registered_head_office_country: z.string().length(2), financial_consolidation_parent: unknownValueSchema, ultimate_parent: unknownValueSchema, benefit_policy_owner: unknownValueSchema, sector: z.enum(['financial','non_financial']), employment_evidence_scope: z.string(), employment_boundary_note: z.string() }), category_outcomes: z.array(categoryOutcomeSchema).length(10), claims: z.array(claimSchema) })
export type Detail = z.infer<typeof detailSchema>

export const methodologySchema = z.strictObject({ schema_version: z.literal(1), artifact_kind: z.literal('company_benefits_methodology'), data_version: version, taxonomy_version: z.literal('benefit-taxonomy-v1'), title: z.string().min(1), paragraphs: z.array(z.string().min(1)).min(1) })

export const manifestSchema = z.strictObject({
  schema_version: z.literal(2), artifact_kind: z.literal('company_benefits_manifest'), data_version: version, fixture: z.literal(false), generated_at: z.iso.datetime(),
  protocol: z.strictObject({ protocol_id: z.literal('company-benefits-population-v4'), protocol_version: z.literal('4.0.0'), protocol_sha256: hash, effective_selection_sha256: hash }), taxonomy_version: z.literal('benefit-taxonomy-v1'), company_count: z.literal(2000), listing_chunk_size: z.literal(50), listing_chunk_count: z.literal(40), category_count: z.literal(10), taxonomy: descriptorSchema, sources: descriptorSchema, methodology: descriptorSchema,
  listing_chunks: z.array(descriptorSchema.extend({ chunk_index: z.number().int().min(1).max(40), first_sequence: z.number().int().min(1), last_sequence: z.number().int().max(2000) })).length(40),
  company_shards: z.record(companyId, descriptorSchema.extend({ company_id: companyId })),
}).superRefine((manifest, ctx) => {
  const prefix = `/community/data/company-benefits/${manifest.data_version}/`
  const descriptors = [manifest.taxonomy, manifest.sources, manifest.methodology, ...manifest.listing_chunks, ...Object.values(manifest.company_shards)]
  if (descriptors.some((descriptor) => !descriptor.url.startsWith(prefix))) ctx.addIssue({ code: 'custom', message: 'artifact 버전 경로 불일치' })
  if (Object.keys(manifest.company_shards).length !== 2000) ctx.addIssue({ code: 'custom', message: '회사 shard 개수 불일치' })
  manifest.listing_chunks.forEach((chunk, index) => { if (chunk.chunk_index !== index + 1 || chunk.first_sequence !== index * 50 + 1 || chunk.last_sequence !== index * 50 + 50 || chunk.record_count !== 50) ctx.addIssue({ code: 'custom', message: '목록 chunk 범위 불일치' }) })
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
export function assertCompanyDetailEvidence(listing: CompanyListing, detail: Detail) {
  if (listing.company_id !== detail.company.company_id) throw new Error('상세 기업 참조 불일치')
  for (const category of categories) {
    const listed = outcomeFor(listing, category)
    const detailed = detail.category_outcomes.find((outcome) => outcome.category_id === category)
    if (JSON.stringify(listed) !== JSON.stringify(detailed)) throw new Error('상세와 목록 결과 불일치')
    if (listed.kind === 'evidenced') {
      const claims = detail.claims.filter((claim) => claim.category_ids.includes(category))
      if (claims.length !== listed.claim_count) throw new Error('결과와 claim 개수 불일치')
    }
  }
}
