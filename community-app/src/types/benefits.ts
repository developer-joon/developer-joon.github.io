import { z } from 'zod'

export const categories = ['leave','family','health','growth','housing','commute','remote','retirement','meals','inclusion'] as const
export type Category = (typeof categories)[number]
export const categoryLabels: Record<Category, string> = {
  leave: '휴가·근무시간', family: '육아·가족', health: '건강·보험', growth: '교육·성장', housing: '주거·금융', commute: '이동·통근', remote: '유연근무·원격근무', retirement: '퇴직·장기근속', meals: '식사·생활편의', inclusion: '포용·접근성',
}
export const outcomeStatuses = ['confirmed', 'bounded', 'insufficient_evidence'] as const
export const outcomeLabels = { confirmed: '확인됨', bounded: '범위 제한 확인', insufficient_evidence: '근거 부족' } as const
export const researchStates = ['official_verified', 'reference', 'community_report', 'no_public_info'] as const
export type ResearchState = (typeof researchStates)[number]
export const researchStateLabels: Record<ResearchState, string> = {
  official_verified: '공식 확인', reference: '참고 정보', community_report: '커뮤니티 보고', no_public_info: '공개 정보 없음',
}
export const sourceTiers = ['official_government', 'company_recruiting_major_media', 'other_public_web', 'community_employee_review', 'user_submission'] as const
export type SourceTier = (typeof sourceTiers)[number]
export const sourceTierLabels: Record<SourceTier, string> = {
  official_government: '공식 확인', company_recruiting_major_media: '채용·언론 참고', other_public_web: '기타 공개자료',
  community_employee_review: '커뮤니티 보고', user_submission: '커뮤니티 보고',
}

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const companyId = z.string().regex(/^(?:KR-CRN-\d{13}|US-CIK\d{10})$/)
export const safePublicSourceUrlSchema = z.string().url().refine((value) => {
  const url = new URL(value)
  return url.protocol === 'https:' && !url.username && !url.password
}, '안전하지 않은 출처 URL').brand<'SafePublicSourceUrl'>()
export const canonicalCellId = (company_id: string, category_id: Category) => `cell::${company_id}::${category_id}`
const version = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/)
const artifactUrl = z.string().regex(/^community\/data\/company-benefits\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.json$/)
const descriptorSchema = z.strictObject({ url: artifactUrl, sha256: hash, record_count: z.number().int().nonnegative(), byte_count: z.number().int().positive() })
export const categoryScopeSchema = z.strictObject({ countries: z.array(z.string()), legal_entities: z.array(z.string()), roles: z.array(z.string()), employment_types: z.array(z.string()), tenure_conditions: z.array(z.string()) })
const insufficientNotice = z.literal('이번 조사에서 게시 가능한 공식 복지 근거를 확보하지 못했습니다. 복지가 없다는 뜻이 아닙니다.')
const uniqueStringArray = z.array(z.string().min(1)).superRefine((values, ctx) => { if (values.length !== new Set(values).size) ctx.addIssue({ code: 'custom', message: 'ID 배열 중복' }) })
export const categoryOutcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('evidenced'), category_id: z.enum(categories), status: z.enum(['confirmed','bounded']), claim_count: z.number().int().positive(), benefit_type_count: z.number().int().positive(), scope: categoryScopeSchema, limitation_codes: z.array(z.string()), last_checked_at: z.iso.datetime() }),
  z.strictObject({ kind: z.literal('insufficient_evidence'), category_id: z.enum(categories), reason_code: z.enum(['not_researched','searched_not_found','entity_binding_missing']), nonabsence_notice: insufficientNotice, searched_source_ids: uniqueStringArray, searched_at: z.iso.datetime().nullable() }),
])
const cellEvidenceIds = {
  official_claim_ids: uniqueStringArray, reference_ids: uniqueStringArray, community_report_ids: uniqueStringArray,
}
const uniqueSourceTiers = z.array(z.enum(sourceTiers)).superRefine((values, ctx) => { if (values.length !== new Set(values).size) ctx.addIssue({ code: 'custom', message: '출처 계층 중복' }) })
const explicitCellBase = {
  category_id: z.enum(categories), currentness: z.enum(['current', 'historical', 'unknown'] as const),
  scope_status: z.enum(['exact_entity', 'bounded_entity', 'group_only', 'unresolved'] as const), conflict_status: z.enum(['none', 'disclosed', 'contradictory'] as const),
  assessed_at: z.iso.datetime(), ...cellEvidenceIds, benefit_type_count: z.number().int().nonnegative(), scope: categoryScopeSchema,
  limitation_codes: z.array(z.string()), last_checked_at: z.iso.datetime(), searched_source_ids: uniqueStringArray, source_tiers: uniqueSourceTiers,
  official_claim_count: z.number().int().nonnegative(), reference_count: z.number().int().nonnegative(), community_report_count: z.number().int().nonnegative(), specific_benefit_count: z.number().int().nonnegative(),
}
const evidenceProjection = {
  ...explicitCellBase, kind: z.literal('evidenced'), status: z.enum(['confirmed', 'bounded'] as const), claim_count: z.number().int().positive(),
}
const refineEvidence = <T extends { state: string; source_tiers: SourceTier[]; official_claim_ids: string[]; reference_ids: string[]; community_report_ids: string[]; official_claim_count: number; reference_count: number; community_report_count: number; claim_count: number; reliability: string; scope_status: string; currentness: string; conflict_status: string; status: string; limitation_codes: string[]; assessed_at: string; last_checked_at: string }>(outcome: T, ctx: z.RefinementCtx) => {
  const evidenceIds = [...outcome.official_claim_ids, ...outcome.reference_ids, ...outcome.community_report_ids]
  const count = new Set(evidenceIds).size
  const status = outcome.scope_status === 'exact_entity' && ['high', 'medium'].includes(outcome.reliability) ? 'confirmed' : 'bounded'
  const limitations = [outcome.scope_status !== 'exact_entity' && 'scope_limit', outcome.currentness !== 'current' && 'currentness_limit', outcome.conflict_status !== 'none' && 'conflicting_evidence', ['reference', 'community_report'].includes(outcome.state) && 'lower_tier_evidence'].filter(Boolean)
  const tiers = new Set(outcome.source_tiers)
  const hasOfficial = tiers.has('official_government')
  const hasReference = tiers.has('company_recruiting_major_media') || tiers.has('other_public_web')
  const hasCommunity = tiers.has('community_employee_review') || tiers.has('user_submission')
  const countsMatch = outcome.official_claim_count === outcome.official_claim_ids.length && outcome.reference_count === outcome.reference_ids.length && outcome.community_report_count === outcome.community_report_ids.length
  const tiersMatch = (outcome.reference_count === 0 ? !hasReference : hasReference || hasOfficial) && (outcome.community_report_count === 0 ? !hasCommunity : hasCommunity)
  const stateMatches = outcome.state === 'official_verified' ? outcome.official_claim_count > 0 && hasOfficial : outcome.state === 'reference' ? outcome.official_claim_count === 0 && outcome.reference_count > 0 && (hasReference || hasOfficial) : outcome.official_claim_count === 0 && outcome.reference_count === 0 && outcome.community_report_count > 0 && hasCommunity
  if (evidenceIds.length !== count || !countsMatch || !tiersMatch || !stateMatches || outcome.claim_count !== count || outcome.status !== status || outcome.last_checked_at !== outcome.assessed_at || JSON.stringify(outcome.limitation_codes) !== JSON.stringify(limitations)) ctx.addIssue({ code: 'custom', message: 'cell 파생 메타데이터 불일치' })
}
const officialOutcomeSchema = z.strictObject({ ...evidenceProjection, state: z.literal('official_verified'), reliability: z.enum(['high', 'medium']), scope_status: z.literal('exact_entity'), publication_eligibility: z.literal('official_claim'), official_claim_ids: z.array(z.string().min(1)).min(1) }).superRefine(refineEvidence)
const referenceOutcomeSchema = z.strictObject({ ...evidenceProjection, state: z.literal('reference'), reliability: z.enum(['medium', 'low']), publication_eligibility: z.literal('reference_only'), official_claim_ids: z.array(z.string()).length(0), reference_ids: z.array(z.string().min(1)).min(1) }).superRefine(refineEvidence)
const communityOutcomeSchema = z.strictObject({ ...evidenceProjection, state: z.literal('community_report'), reliability: z.literal('low'), publication_eligibility: z.literal('community_only'), official_claim_ids: z.array(z.string()).length(0), reference_ids: z.array(z.string()).length(0), community_report_ids: z.array(z.string().min(1)).min(1) }).superRefine(refineEvidence)
const noPublicInfoOutcomeSchema = z.strictObject({
  ...explicitCellBase, state: z.literal('no_public_info'), reliability: z.literal('none'), currentness: z.literal('unknown'), publication_eligibility: z.literal('discovery_only'),
  official_claim_ids: z.array(z.string()).length(0), reference_ids: z.array(z.string()).length(0), community_report_ids: z.array(z.string()).length(0),
  source_tiers: uniqueSourceTiers.length(0), official_claim_count: z.literal(0), reference_count: z.literal(0), community_report_count: z.literal(0), specific_benefit_count: z.literal(0),
  kind: z.literal('insufficient_evidence'), status: z.literal('insufficient_evidence'), claim_count: z.literal(0), benefit_type_count: z.literal(0), nonabsence_notice: insufficientNotice,
  reason_code: z.enum(['searched_not_found', 'entity_binding_missing']), searched_source_ids: uniqueStringArray, searched_at: z.iso.datetime(),
}).superRefine((value, ctx) => {
  const limitations = [value.scope_status !== 'exact_entity' && 'scope_limit', 'currentness_limit'].filter(Boolean)
  if (value.assessed_at !== value.last_checked_at || value.assessed_at !== value.searched_at || JSON.stringify(value.limitation_codes) !== JSON.stringify(limitations)) ctx.addIssue({ code: 'custom', message: '근거 부족 파생 메타데이터 불일치' })
})
const explicitCellOutcomeSchema = z.union([officialOutcomeSchema, referenceOutcomeSchema, communityOutcomeSchema, noPublicInfoOutcomeSchema])
export const vNextCategoryOutcomeSchema = explicitCellOutcomeSchema
export const compatibleCategoryOutcomeSchema = z.union([categoryOutcomeSchema, explicitCellOutcomeSchema])
export type CategoryOutcome = z.infer<typeof compatibleCategoryOutcomeSchema>
export type ResearchedCategoryOutcome = z.infer<typeof explicitCellOutcomeSchema>

export function isResearchedOutcome(outcome: CategoryOutcome): outcome is ResearchedCategoryOutcome { return 'state' in outcome }
export function hasOutcomeScope(outcome: CategoryOutcome): outcome is CategoryOutcome & { scope: z.infer<typeof categoryScopeSchema> } { return 'scope' in outcome }
export function researchStateFor(outcome: CategoryOutcome): ResearchState { return isResearchedOutcome(outcome) ? outcome.state : outcome.kind === 'evidenced' ? 'official_verified' : 'no_public_info' }
export const researchStatePrecedence: Record<ResearchState, number> = { official_verified: 0, reference: 1, community_report: 2, no_public_info: 3 }
export const reliabilityLabels = { high: '신뢰도 높음', medium: '신뢰도 보통', low: '신뢰도 낮음', none: '신뢰도 없음' } as const
export const currentnessLabels = { current: '현재 정보', historical: '과거 정보', unknown: '현재성 미확인' } as const
export const scopeStatusLabels = { exact_entity: '선택 법인 확인', bounded_entity: '적용 범위 제한', group_only: '그룹 범위', unresolved: '적용 범위 미확인' } as const
export const conflictStatusLabels = { none: '상충 없음', disclosed: '상충 정보 공개', contradictory: '정보 상충' } as const

export const companyListingSchema = z.strictObject({
  company_id: companyId, population_sequence: z.number().int().min(1).max(2000), legal_name: z.string().min(1), display_name: z.string().min(1), scope: z.enum(['domestic','international']), jurisdiction: z.enum(['KR','US']), incorporation_country: z.string().length(2), registered_head_office_country: z.string().length(2), selected_reporting_legal_entity: z.string().min(1), sector: z.enum(['financial','non_financial']), category_outcomes: z.array(compatibleCategoryOutcomeSchema).length(10),
}).superRefine((company, ctx) => {
  if (company.category_outcomes.some((outcome, index) => outcome.category_id !== categories[index])) ctx.addIssue({ code: 'custom', message: '분야 결과 순서/완전성 오류' })
})
export type CompanyListing = z.infer<typeof companyListingSchema>
export type Company = CompanyListing
export type BenefitCompanyView = CompanyListing & {
  lineage: {
    legacy: CompanyListing
    approved_v2?: CompanyListing
  }
}

export function hasApprovedV2Projection(company: CompanyListing | BenefitCompanyView): company is BenefitCompanyView & { lineage: { legacy: CompanyListing; approved_v2: CompanyListing } } {
  return 'lineage' in company && company.lineage.approved_v2 !== undefined
}

export function companyListingIdentity(company: CompanyListing): Omit<CompanyListing, 'category_outcomes'> {
  return Object.fromEntries(Object.entries(company).filter(([key]) => key !== 'category_outcomes')) as Omit<CompanyListing, 'category_outcomes'>
}

export function assertCompanyIdentityProjection(base: CompanyListing, listing: CompanyListing, detailCompany?: Detail['company']) {
  const baseIdentity = companyListingIdentity(base)
  const listingIdentity = companyListingIdentity(listing)
  const identityKeys = Object.keys(baseIdentity) as (keyof typeof baseIdentity)[]
  if (identityKeys.length !== Object.keys(listingIdentity).length || identityKeys.some((key) => JSON.stringify(baseIdentity[key]) !== JSON.stringify(listingIdentity[key]))) throw new Error('approved projection canonical company identity mismatch')
  if (detailCompany) {
    const sharedIdentityKeys = identityKeys.filter((key) => key in detailCompany)
    if (sharedIdentityKeys.some((key) => JSON.stringify(listingIdentity[key]) !== JSON.stringify(detailCompany[key as keyof typeof detailCompany]))) throw new Error('approved projection detail company identity mismatch')
  }
}

const listingChunkFields = { schema_version: z.literal(1), artifact_kind: z.literal('company_listing_chunk'), artifact_protocol: z.enum(['v1', 'vNext']).optional(), data_version: version, taxonomy_version: z.literal('benefit-taxonomy-v1'), chunk_index: z.number().int().min(1).max(40), sequence_start: z.number().int().min(1), sequence_end: z.number().int().max(2000) }
const refineListingChunk = (chunk: { artifact_protocol?: 'v1' | 'vNext'; sequence_start: number; sequence_end: number; companies: CompanyListing[] }, ctx: z.RefinementCtx) => {
  if (chunk.companies.some((company) => company.category_outcomes.some((outcome) => chunk.artifact_protocol === 'vNext' ? !('state' in outcome) : 'state' in outcome))) ctx.addIssue({ code: 'custom', message: 'artifact protocol/outcome 불일치' })
  const sequences = chunk.companies.map((company) => company.population_sequence)
  if (sequences[0] !== chunk.sequence_start || sequences.at(-1) !== chunk.sequence_end || sequences.some((sequence, index) => index > 0 && sequence <= sequences[index - 1])) ctx.addIssue({ code: 'custom', message: '목록 canonical sequence/경계 불일치' })
}
export const listingChunkSchema = z.strictObject({ ...listingChunkFields, companies: z.array(companyListingSchema).length(50) }).superRefine(refineListingChunk)
export const approvedV2ListingChunkSchema = z.strictObject({ ...listingChunkFields, companies: z.array(companyListingSchema).min(1).max(50) }).superRefine(refineListingChunk)
export type ListingChunk = z.infer<typeof listingChunkSchema>
export type CompanyIndex = { data_version: string; companies: CompanyListing[] }

const sourceEvidenceSchema = z.strictObject({
  source_id: z.string().min(1), role: z.string().min(1), proposition: z.string().min(1), source_locator: z.string().min(1), supporting_quote: z.string().min(1), content_sha256: hash,
  source: z.strictObject({ title: z.string().min(1), owner: z.string().min(1), source_type: z.string().min(1), jurisdiction: z.string().min(1), url: safePublicSourceUrlSchema, final_owner_domain: z.string().min(1), publication_date: z.iso.date().nullable(), checked_at: z.iso.datetime(), evidence_eligibility: z.enum(['A','B']) }).superRefine((source, ctx) => { if (new URL(source.url).hostname !== source.final_owner_domain) ctx.addIssue({ code: 'custom', message: '출처 도메인 불일치' }) }),
})
export const claimSchema = z.strictObject({ claim_id: z.string().min(1), benefit_type_ids: z.array(z.string().min(1)).min(1), category_ids: z.array(z.enum(categories)).min(1), benefit_name: z.string().min(1), detail: z.string().min(1), research_status: z.enum(['confirmed','limited','past','name_only','conflict']), current_validity: z.enum(['current','undated_current','historical']), evidence_grade: z.enum(['A','B']), application_scope: z.strictObject({ countries: z.array(z.string()), legal_entities: z.array(z.string()), roles: z.array(z.string()), employment_types: z.array(z.string()), tenure_condition: z.string() }), limitation_codes: z.array(z.string()), publication_date: z.iso.date().nullable(), checked_at: z.iso.datetime(), source_evidence: z.array(sourceEvidenceSchema).min(1) })
export type Claim = z.infer<typeof claimSchema>
const evidenceScopeSchema = z.strictObject({ countries: z.array(z.string()), legal_entities: z.array(z.string()), roles: z.array(z.string()), employment_types: z.array(z.string()) })
const officialClaimV2Schema = z.strictObject({ claim_id: z.string().regex(/^official::[a-f0-9]{64}$/), cell_id: z.string(), company_id: companyId, category_id: z.enum(categories), jurisdiction: z.string().length(2), source_ids: uniqueStringArray.min(1), source_tier: z.literal('official_government'), scope_status: z.literal('exact_entity'), scope: evidenceScopeSchema, conflict_status: z.enum(['none', 'disclosed', 'contradictory']), publication_eligibility: z.literal('eligible') })
const nonblankStatement = z.string().refine((value) => value.trim().length > 0, '구체 혜택 문장 누락')
const referenceV2Schema = z.strictObject({ reference_id: z.string().min(1), cell_id: z.string(), company_id: companyId, category_id: z.enum(categories), source_id: z.string().min(1), source_tier: z.enum(['official_government', 'company_recruiting_major_media', 'other_public_web']), statement: nonblankStatement, supporting_quote: z.string().min(1), source_locator: z.string().url(), reliability: z.enum(['medium', 'low']), currentness: z.enum(['current', 'historical', 'unknown']), scope: evidenceScopeSchema.extend({ status: z.enum(['exact_entity', 'bounded_entity', 'group_only', 'unresolved']) }), conflict_status: z.enum(['none', 'disclosed', 'contradictory']), publication_eligibility: z.enum(['eligible', 'reference_only', 'ineligible']), checked_at: z.iso.datetime() })
const communityV2Schema = z.strictObject({ community_report_id: z.string().min(1), cell_id: z.string(), company_id: companyId, category_id: z.enum(categories), source_id: z.string().min(1), source_tier: z.enum(['community_employee_review', 'user_submission']), statement: nonblankStatement, reliability: z.literal('low'), currentness: z.enum(['current', 'historical', 'unknown']), scope_status: z.enum(['exact_entity', 'group_only', 'unresolved']), scope: evidenceScopeSchema, conflict_status: z.enum(['none', 'disclosed', 'contradictory']), frozen_snapshot: z.strictObject({ locator: z.string().url(), content_sha256: hash, frozen_at: z.iso.datetime() }), publication_eligibility: z.literal('eligible') })
const legacyPublicSourceSchema = z.strictObject({ source_id: z.string().min(1), title: z.string().min(1), owner: z.string().min(1), source_type: z.string().min(1), jurisdiction: z.string().min(1), url: safePublicSourceUrlSchema, locator: z.string().optional(), publication_date: z.iso.date().nullable().optional(), checked_at: z.iso.datetime(), evidence_eligibility: z.enum(['A', 'B']) })
const v2PublicSourceSchema = z.strictObject({ source_id: z.string().min(1), source_tier: z.enum(['official_government', 'company_recruiting_major_media', 'other_public_web', 'community_employee_review', 'user_submission']), title: z.string().min(1), url: safePublicSourceUrlSchema, retrieved_at: z.iso.datetime(), content_sha256: hash, reliability: z.enum(['high', 'medium', 'low', 'unrated']), currentness: z.enum(['current', 'historical', 'unknown']), scope_status: z.enum(['exact_entity', 'bounded_entity', 'group_only', 'unresolved']), scope: evidenceScopeSchema, conflict_status: z.enum(['none', 'disclosed', 'contradictory']), publication_eligibility: z.enum(['eligible', 'reference_only', 'discovery_only', 'ineligible']) })
export const sourcesDocumentSchema = z.strictObject({ schema_version: z.literal(1), artifact_kind: z.literal('company_benefits_sources'), data_version: version, sources: z.array(z.union([legacyPublicSourceSchema, v2PublicSourceSchema])) }).superRefine((document, ctx) => { const ids = document.sources.map((source) => source.source_id); if (ids.length !== new Set(ids).size) ctx.addIssue({ code: 'custom', message: 'source inventory ID 중복' }) })
export type SourcesDocument = z.infer<typeof sourcesDocumentSchema>
const unknownValueSchema = z.union([z.string().min(1), z.strictObject({ kind: z.literal('unknown'), reason: z.string().min(1) })])
export const detailCompanySchema = z.strictObject({ company_id: companyId, population_sequence: z.number().int().min(1).max(2000), legal_name: z.string().min(1), scope: z.enum(['domestic','international']), jurisdiction: z.enum(['KR','US']), registry_id: z.string().min(1), selected_reporting_legal_entity: z.string().min(1), incorporation_country: z.string().length(2), registered_head_office_country: z.string().length(2), financial_consolidation_parent: unknownValueSchema, ultimate_parent: unknownValueSchema, benefit_policy_owner: unknownValueSchema, sector: z.enum(['financial','non_financial']), employment_evidence_scope: z.string(), employment_boundary_note: z.string() })
export const detailSchema = z.strictObject({ schema_version: z.literal(1), artifact_kind: z.literal('company_detail'), artifact_protocol: z.enum(['v1', 'vNext']).optional(), data_version: version, taxonomy_version: z.literal('benefit-taxonomy-v1'), company: detailCompanySchema, category_outcomes: z.array(compatibleCategoryOutcomeSchema).length(10), claims: z.array(claimSchema), official_claims: z.array(officialClaimV2Schema).optional(), references: z.array(referenceV2Schema).optional(), community_reports: z.array(communityV2Schema).optional(), sources: z.array(z.union([legacyPublicSourceSchema, v2PublicSourceSchema])).optional() }).superRefine((detail, ctx) => { const vNextFields = [detail.official_claims, detail.references, detail.community_reports, detail.sources]; if (detail.artifact_protocol === 'vNext' && (vNextFields.some((value) => value === undefined) || detail.category_outcomes.some((outcome) => !('state' in outcome)))) ctx.addIssue({ code: 'custom', message: 'vNext 상세 evidence inventory 불완전' }); if (detail.artifact_protocol !== 'vNext' && (vNextFields.some((value) => value !== undefined) || detail.category_outcomes.some((outcome) => 'state' in outcome))) ctx.addIssue({ code: 'custom', message: 'v1 상세에 vNext projection 포함' }); if (detail.artifact_protocol === 'vNext') { const evidenceRecords = [...(detail.official_claims ?? []), ...(detail.references ?? []), ...(detail.community_reports ?? [])]; const evidenceIds = evidenceRecords.map((record) => 'claim_id' in record ? record.claim_id : 'reference_id' in record ? record.reference_id : record.community_report_id); if (evidenceIds.length !== new Set(evidenceIds).size) ctx.addIssue({ code: 'custom', message: '상세 evidence inventory ID 중복' }); if (evidenceRecords.some((record) => record.company_id !== detail.company.company_id || record.cell_id !== canonicalCellId(detail.company.company_id, record.category_id))) ctx.addIssue({ code: 'custom', message: '상세 evidence company/cell binding 불일치' }); const sourceIds = (detail.sources ?? []).map((source) => source.source_id); const required = detail.category_outcomes.flatMap((outcome) => 'searched_source_ids' in outcome ? outcome.searched_source_ids : []).concat(detail.claims.flatMap((claim) => claim.source_evidence.map((evidence) => evidence.source_id)), (detail.official_claims ?? []).flatMap((claim) => claim.source_ids), (detail.references ?? []).map((record) => record.source_id), (detail.community_reports ?? []).map((record) => record.source_id)); const requiredSet = new Set(required); if (sourceIds.length !== new Set(sourceIds).size || sourceIds.length !== requiredSet.size || sourceIds.some((sourceId) => !requiredSet.has(sourceId))) ctx.addIssue({ code: 'custom', message: '상세 source inventory closure 불일치' }) } }).superRefine((detail, ctx) => {
  if (detail.artifact_protocol !== 'vNext') return
  const sources = new Map((detail.sources ?? []).map((source) => [source.source_id, source]))
  const eligibility = (sourceId: string) => { const source = sources.get(sourceId); return source && 'publication_eligibility' in source ? source.publication_eligibility : undefined }
  for (const claim of detail.official_claims ?? []) if (claim.source_ids.some((sourceId) => eligibility(sourceId) !== 'eligible')) ctx.addIssue({ code: 'custom', message: `공식 근거 publication eligibility 불일치: ${claim.claim_id}` })
  for (const record of detail.references ?? []) if (!['eligible', 'reference_only'].includes(record.publication_eligibility) || !['eligible', 'reference_only'].includes(eligibility(record.source_id) ?? '')) ctx.addIssue({ code: 'custom', message: `참고 근거 publication eligibility 불일치: ${record.reference_id}` })
  for (const report of detail.community_reports ?? []) if (report.publication_eligibility !== 'eligible' || eligibility(report.source_id) !== 'eligible') ctx.addIssue({ code: 'custom', message: `커뮤니티 근거 publication eligibility 불일치: ${report.community_report_id}` })
})
export type Detail = z.infer<typeof detailSchema>

export function specificBenefitRecords(detail: Detail, category: Category) {
  const sourceEligibility = new Map((detail.sources ?? []).flatMap((source) => 'publication_eligibility' in source ? [[source.source_id, source.publication_eligibility] as const] : []))
  const references = (detail.references ?? []).filter((record) => record.category_id === category && ['eligible', 'reference_only'].includes(record.publication_eligibility) && ['eligible', 'reference_only'].includes(sourceEligibility.get(record.source_id) ?? ''))
  const community = (detail.community_reports ?? []).filter((record) => record.category_id === category && record.publication_eligibility === 'eligible' && sourceEligibility.get(record.source_id) === 'eligible')
  const seen = new Set<string>()
  return [...references, ...community].filter((record) => {
    const id = 'reference_id' in record ? record.reference_id : record.community_report_id
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export function assertCompanyDetailIdentityProjection(base: Detail['company'], projected: Detail['company']) {
  const baseIdentity = detailCompanySchema.parse(base)
  const projectedIdentity = detailCompanySchema.parse(projected)
  if (JSON.stringify(baseIdentity) !== JSON.stringify(projectedIdentity)) throw new Error('approved projection full detail company identity mismatch')
}

export const methodologySchema = z.strictObject({ schema_version: z.literal(1), artifact_kind: z.literal('company_benefits_methodology'), data_version: version, taxonomy_version: z.literal('benefit-taxonomy-v1'), title: z.string().min(1), paragraphs: z.array(z.string().min(1)).min(1) })

const stateCountsSchema = z.strictObject({ official_verified: z.number().int().nonnegative(), reference: z.number().int().nonnegative(), community_report: z.number().int().nonnegative(), no_public_info: z.number().int().nonnegative() })
const ledgerHashesSchema = z.strictObject({ 'company-category-cells.jsonl': hash, 'research-attempts.jsonl': hash, 'official-claims-v2.jsonl': hash, 'reference-records.jsonl': hash, 'community-benefit-reports.jsonl': hash, 'sources-v2.jsonl': hash })
const approvedV2ProjectionSchema = z.strictObject({
  projection_kind: z.literal('approved_v2_additive'), projection_status: z.literal('in_progress'), base_data_version: version, base_manifest_sha256: hash, data_version: version,
  approved_batch_count: z.number().int().min(1).max(79), total_batch_count: z.literal(80), projected_company_count: z.number().int().positive().max(1975), total_company_count: z.literal(2000),
  cell_count: z.number().int().positive().max(19750), cell_state_counts: stateCountsSchema, listing_chunk_size: z.literal(50), listing_chunk_count: z.number().int().positive().max(40), ledger_sha256: ledgerHashesSchema,
  taxonomy: descriptorSchema, sources: descriptorSchema, methodology: descriptorSchema,
  listing_chunks: z.array(descriptorSchema.extend({ chunk_index: z.number().int().positive(), first_sequence: z.number().int().positive(), last_sequence: z.number().int().max(2000) })),
  company_shards: z.record(companyId, descriptorSchema.extend({ company_id: companyId })),
}).superRefine((projection, ctx) => {
  const prefix = `community/data/company-benefits/${projection.data_version}/`
  const descriptors = [projection.taxonomy, projection.sources, projection.methodology, ...projection.listing_chunks, ...Object.values(projection.company_shards)]
  if (projection.projected_company_count !== projection.approved_batch_count * 25 || projection.cell_count !== projection.projected_company_count * categories.length || Object.values(projection.cell_state_counts).reduce((sum, count) => sum + count, 0) !== projection.cell_count) ctx.addIssue({ code: 'custom', message: 'projection 파생 개수 불일치' })
  if (projection.listing_chunk_count !== Math.ceil(projection.projected_company_count / projection.listing_chunk_size) || projection.listing_chunks.length !== projection.listing_chunk_count || Object.keys(projection.company_shards).length !== projection.projected_company_count) ctx.addIssue({ code: 'custom', message: 'projection inventory 개수 불일치' })
  if (descriptors.some((descriptor) => !descriptor.url.startsWith(prefix)) || new Set(descriptors.map((descriptor) => descriptor.url)).size !== descriptors.length) ctx.addIssue({ code: 'custom', message: 'projection 경로 불일치' })
  if (projection.taxonomy.url !== `${prefix}taxonomy.json` || projection.sources.url !== `${prefix}sources.json` || projection.methodology.url !== `${prefix}methodology.json`) ctx.addIssue({ code: 'custom', message: 'projection 역할 경로 불일치' })
  projection.listing_chunks.forEach((chunk, index) => {
    const recordCount = index === projection.listing_chunk_count - 1 ? projection.projected_company_count - index * projection.listing_chunk_size : projection.listing_chunk_size
    const previous = projection.listing_chunks[index - 1]
    if (chunk.url !== `${prefix}listings/companies-${String(index + 1).padStart(2, '0')}.json` || chunk.chunk_index !== index + 1 || chunk.record_count !== recordCount || chunk.first_sequence > chunk.last_sequence || (previous && chunk.first_sequence <= previous.last_sequence)) ctx.addIssue({ code: 'custom', message: 'projection chunk 불일치' })
  })
  for (const [id, shard] of Object.entries(projection.company_shards)) if (shard.company_id !== id || shard.url !== `${prefix}companies/${id}.json` || shard.record_count !== 1) ctx.addIssue({ code: 'custom', message: 'projection shard 불일치' })
})

export const manifestSchema = z.strictObject({
  schema_version: z.literal(2), artifact_kind: z.literal('company_benefits_manifest'), artifact_protocol: z.enum(['v1', 'vNext']), data_version: version, fixture: z.literal(false), generated_at: z.iso.datetime(),
  protocol: z.strictObject({ protocol_id: z.literal('company-benefits-population-v4'), protocol_version: z.literal('4.0.0'), protocol_sha256: hash, effective_selection_sha256: hash }), taxonomy_version: z.literal('benefit-taxonomy-v1'), company_count: z.literal(2000), listing_chunk_size: z.literal(50), listing_chunk_count: z.literal(40), category_count: z.literal(10), taxonomy: descriptorSchema, sources: descriptorSchema, methodology: descriptorSchema,
  cell_count: z.literal(20000).optional(), cell_state_counts: stateCountsSchema.optional(),
  ledger_sha256: ledgerHashesSchema.optional(), approved_v2_projection: approvedV2ProjectionSchema.optional(),
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
  if (manifest.artifact_protocol === 'vNext' && explicit.some((value) => value === undefined)) ctx.addIssue({ code: 'custom', message: 'vNext cell manifest 메타데이터 불완전' })
  if (manifest.artifact_protocol === 'v1' && explicit.some((value) => value !== undefined)) ctx.addIssue({ code: 'custom', message: 'v1 manifest에 vNext 메타데이터 포함' })
  if (manifest.cell_state_counts && (Object.values(manifest.cell_state_counts) as number[]).reduce((sum, count) => sum + count, 0) !== 20000) ctx.addIssue({ code: 'custom', message: 'cell 상태 합계 불일치' })
  if (manifest.approved_v2_projection && (manifest.artifact_protocol !== 'v1' || manifest.approved_v2_projection.base_data_version !== manifest.data_version || manifest.approved_v2_projection.data_version === manifest.data_version)) ctx.addIssue({ code: 'custom', message: 'additive projection base binding 불일치' })
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
  if (manifest.artifact_protocol === 'v1') return
  const counts = { official_verified: 0, reference: 0, community_report: 0, no_public_info: 0 }
  for (const company of companies) for (const outcome of company.category_outcomes) {
    if (!('state' in outcome)) throw new Error('vNext artifact에 legacy category outcome이 포함됨')
    counts[outcome.state as keyof typeof counts]++
  }
  if (companies.length * categories.length !== manifest.cell_count || JSON.stringify(counts) !== JSON.stringify(manifest.cell_state_counts)) throw new Error('명시적 cell inventory 불일치')
}
export function assertCompanyDetailEvidence(listing: CompanyListing, detail: Detail) {
  if (listing.company_id !== detail.company.company_id) throw new Error('상세 기업 참조 불일치')
  for (const record of [...(detail.official_claims ?? []), ...(detail.references ?? []), ...(detail.community_reports ?? [])]) {
    if (record.company_id !== detail.company.company_id || record.cell_id !== canonicalCellId(detail.company.company_id, record.category_id)) throw new Error('상세 evidence company/cell binding 불일치')
  }
  const sources = new Map((detail.sources ?? []).flatMap((source) => 'scope_status' in source ? [[source.source_id, source] as const] : []))
  const assertLimitationBinding = (recordId: string, sourceId: string, limitation: { reliability?: string; currentness?: string; scope_status: string; scope: { countries: string[]; legal_entities: string[]; roles: string[]; employment_types: string[] }; conflict_status: string }) => {
    const source = sources.get(sourceId)
    if (!source) throw new Error(`evidence bound source 누락: ${recordId}`)
    const expected = { ...(limitation.reliability === undefined ? {} : { reliability: limitation.reliability }), ...(limitation.currentness === undefined ? {} : { currentness: limitation.currentness }), scope_status: limitation.scope_status, scope: limitation.scope, conflict_status: limitation.conflict_status }
    const actual = { ...(limitation.reliability === undefined ? {} : { reliability: source.reliability }), ...(limitation.currentness === undefined ? {} : { currentness: source.currentness }), scope_status: source.scope_status, scope: source.scope, conflict_status: source.conflict_status }
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error(`evidence/source limitation metadata 불일치: ${recordId}`)
  }
  for (const claim of detail.official_claims ?? []) {
    const outcome = detail.category_outcomes.find((candidate) => candidate.category_id === claim.category_id)
    if (!outcome || !('state' in outcome) || outcome.state !== 'official_verified') throw new Error(`공식 claim cell limitation metadata 누락: ${claim.claim_id}`)
    for (const sourceId of claim.source_ids) {
      assertLimitationBinding(claim.claim_id, sourceId, {
        ...claim,
        reliability: outcome.reliability,
        currentness: outcome.currentness,
      })
    }
  }
  for (const record of detail.references ?? []) {
    const { status: scope_status, ...scope } = record.scope
    assertLimitationBinding(record.reference_id, record.source_id, { reliability: record.reliability, currentness: record.currentness, scope_status, scope, conflict_status: record.conflict_status })
  }
  for (const report of detail.community_reports ?? []) assertLimitationBinding(report.community_report_id, report.source_id, report)
  for (const category of categories) {
    const listed = outcomeFor(listing, category)
    const detailed = detail.category_outcomes.find((outcome) => outcome.category_id === category)
    if (JSON.stringify(listed) !== JSON.stringify(detailed)) throw new Error('상세와 목록 결과 불일치')
    if (!('state' in listed) && listed.kind === 'evidenced') {
      const claims = detail.claims.filter((claim) => claim.category_ids.includes(category))
      if (claims.length !== listed.claim_count) throw new Error('결과와 claim 개수 불일치')
    }
    if (isResearchedOutcome(listed)) {
      if (specificBenefitRecords(detail, category).length !== listed.specific_benefit_count) throw new Error('listing/detail specific benefit count mismatch')
      if (listed.official_claim_count !== listed.official_claim_ids.length || listed.reference_count !== listed.reference_ids.length || listed.community_report_count !== listed.community_report_ids.length) throw new Error('결과와 근거 ID 개수 불일치')
      const official = detail.official_claims?.filter((claim) => claim.category_id === category).map((claim) => claim.claim_id) ?? []
      const references = detail.references?.filter((record) => record.category_id === category).map((record) => record.reference_id) ?? []
      const community = detail.community_reports?.filter((record) => record.category_id === category).map((record) => record.community_report_id) ?? []
      if (detail.official_claims !== undefined && (JSON.stringify(official) !== JSON.stringify(listed.official_claim_ids) || JSON.stringify(references) !== JSON.stringify(listed.reference_ids) || JSON.stringify(community) !== JSON.stringify(listed.community_report_ids))) throw new Error('cell/evidence ID inventory 불일치')
      if (detail.official_claims === undefined) {
        const claims = detail.claims.filter((claim) => claim.category_ids.includes(category))
        if (listed.state !== 'official_verified' && claims.length > 0) throw new Error('하위 계층 상태에 공식 claim 포함')
        const claimIds = claims.map((claim) => claim.claim_id).sort()
        const expectedIds = [...listed.official_claim_ids].sort()
        if (claimIds.length !== expectedIds.length || claimIds.some((id, index) => id !== expectedIds[index])) throw new Error('결과와 claim ID 불일치')
      }
    }
  }
  if (detail.artifact_protocol === 'vNext') {
    const sourceIds = new Set(detail.sources?.map((source) => source.source_id))
    const required = [
      ...(detail.category_outcomes ?? []).flatMap((outcome) => 'searched_source_ids' in outcome ? outcome.searched_source_ids : []),
      ...(detail.claims ?? []).flatMap((claim) => claim.source_evidence.map((evidence) => evidence.source_id)),
      ...(detail.official_claims ?? []).flatMap((claim) => claim.source_ids),
      ...(detail.references ?? []).map((record) => record.source_id),
      ...(detail.community_reports ?? []).map((record) => record.source_id),
    ]
    if (required.some((sourceId) => !sourceIds.has(sourceId))) throw new Error('상세 evidence/source inventory 불일치')
  }
}
