import { z } from 'zod'
export const categories = ['leave', 'family', 'health', 'growth', 'housing', 'commute', 'remote', 'retirement', 'meals', 'inclusion'] as const
export const categoryLabels: Record<Category, string> = { leave: '휴가·근무시간', family: '육아·가족', health: '건강·보험', growth: '교육·성장', housing: '주거·금융', commute: '이동·통근', remote: '유연근무·원격근무', retirement: '퇴직·장기근속', meals: '식사·생활편의', inclusion: '포용·접근성' }
export const statuses = ['확인됨', '범위 제한 확인', '과거 확인', '명칭만 확인', '확인 불가', '상충', '해당 없음'] as const
export type Category = typeof categories[number]
const text = z.string().min(1).max(2000)
const id = z.string().regex(/^example-\d{3}$/)
const date = z.iso.date()
const version = z.literal('fixture-v1')
const url = z.string().max(500).refine(v => { try { const u = new URL(v); return u.protocol === 'https:' && u.hostname === 'example.org' && !u.username && !u.password } catch { return false } }, '허용되지 않은 원문 URL')
const artifactUrl = z.string().regex(/^\/community\/data\/company-benefits\/fixture-v1\/(?:company-index|rankings|methodology|details\/companies)\.json$/)
const summary = z.strictObject({ status: z.enum(statuses), confirmed_count: z.number().int().nonnegative(), limited: z.boolean(), last_verified_at: date, coverage: z.number().min(0).max(1) })
export const companySchema = z.strictObject({ company_id: id, legal_name: text, display_name: text, scope: z.enum(['domestic', 'international']), headquarters_country: text, industry: text, scale_band: text, fiscal_year: z.number().int(), category_summaries: z.record(z.enum(categories), summary), source_coverage: z.number().min(0).max(1), last_verified_at: date })
const meta = { data_version: version }
export const indexSchema = z.strictObject({ ...meta, companies: z.array(companySchema).max(2000) })
const components = z.strictObject({ breadth: z.number().min(0).max(35), applicability: z.number().min(0).max(30), specificity: z.number().min(0).max(20), freshness: z.number().min(0).max(15) })
export const rankingSchema = z.strictObject({ company_id: id, category: z.enum(categories), eligible: z.boolean(), reason: z.string().max(500), components, score: z.number().min(0).max(100) }).refine(r => Object.values(r.components).reduce((a,b) => a+b, 0) === r.score, '점수 합계 불일치')
export const rankingsSchema = z.strictObject({ ...meta, rows: z.array(rankingSchema).max(20000) })
export const sourceSchema = z.strictObject({ title: text, owner: text, published_at: date, verified_at: date, location: text, grade: z.enum(['A','B']), url })
export const claimSchema = z.strictObject({ claim_id: text, category: z.enum(categories), benefit_type: text, name: text, status: z.enum(statuses), description: text, country: text, legal_entity: text, jobs: text, employment: text, conditions: text, source: sourceSchema })
export const detailSchema = z.strictObject({ company_id: id, claims: z.array(claimSchema), community_post_id: z.uuid().nullable() })
export const detailsSchema = z.strictObject({ ...meta, companies: z.array(detailSchema) })
export const methodologySchema = z.strictObject({ ...meta, title: text, paragraphs: z.array(text) })
export const manifestSchema = z.strictObject({ schema_version: z.literal(1), data_version: version, fixture: z.literal(true), generated_at: z.iso.datetime(), protocol_hash: z.string().regex(/^[a-f0-9]{64}$/), effective_selection_hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).length(1), company_count: z.number().int().min(1).max(2000), category_taxonomy: z.array(z.enum(categories)).length(10), status_taxonomy: z.array(z.enum(statuses)).length(7), index_url: artifactUrl, rankings_url: artifactUrl, methodology_url: artifactUrl, detail_shards: z.record(id, artifactUrl), artifact_sha256: z.record(artifactUrl, z.strictObject({ sha256: z.string().regex(/^[a-f0-9]{64}$/), record_count: z.number().int().nonnegative() })) })
export type Manifest = z.infer<typeof manifestSchema>
export type Company = z.infer<typeof companySchema>
export type CompanyIndex = z.infer<typeof indexSchema>
export type Rankings = z.infer<typeof rankingsSchema>
export type Ranking = z.infer<typeof rankingSchema>
export type Detail = z.infer<typeof detailSchema>
export type Claim = z.infer<typeof claimSchema>
