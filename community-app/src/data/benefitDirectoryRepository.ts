import { getAnonymousSupabaseClient } from '../lib/supabase'
import { isCanonicalUuid } from '../lib/uuid'
import { comparePostgresTimestamps, parsePostgresTimestampMicros } from '../lib/postgresTimestamp'
import { isBenefitCompanyId } from '../lib/benefitCompanyId'
import {
  BENEFIT_DIRECTORY_CATEGORIES,
  BENEFIT_DIRECTORY_IDENTITY_LABELS,
  BENEFIT_DIRECTORY_PUBLIC_CLAIM_STATUSES,
  BENEFIT_DIRECTORY_SIZE_CLASSES,
  BENEFIT_DIRECTORY_SIZE_LABELS,
  BENEFIT_DIRECTORY_TRUST_LABELS,
  type BenefitCompanyDetail,
  type BenefitCompanyDetailV1,
  type BenefitCompanyDetailV2,
  type BenefitDirectoryCategory,
  type BenefitDirectoryCompanySummary,
  type BenefitDirectoryErrorCode,
  type BenefitDirectoryPage,
  type BenefitDirectoryPublicationV1,
  type BenefitDirectoryPublicationV2,
  type BenefitDirectoryPublicClaim,
  type BenefitDirectorySearchInput,
  type BenefitDirectorySearchItem,
  type Result,
} from '../types/benefitDirectory'
import type { Database } from '../types/database'

type GeneratedSearchRpcArgs = Database['public']['Functions']['search_benefit_companies_v1']['Args']
type SearchRpcArgs = { [Key in keyof GeneratedSearchRpcArgs]-?: Exclude<GeneratedSearchRpcArgs[Key], undefined> }
type DetailRpcArgs = Database['public']['Functions']['get_benefit_company_v2']['Args']

export interface BenefitDirectoryRepository {
  search(input: BenefitDirectorySearchInput, signal?: AbortSignal): Promise<Result<BenefitDirectoryPage>>
  detail(companyId: string, signal?: AbortSignal): Promise<Result<BenefitCompanyDetail>>
}

const searchPageKeys = ['items', 'has_more', 'next_cursor', 'total'] as const
// search_benefit_companies_v1 already separates active official_verified and community_reviewed publications exactly.
const searchItemKeys = ['company_id', 'display_name', 'identity_label', 'industry', 'size_label', 'region', 'summary', 'benefit_count', 'official_count', 'community_count', 'categories'] as const
const detailKeys = ['company', 'publications', 'claims'] as const
const companyKeys = ['company_id', 'display_name', 'identity_label', 'industry', 'size_label', 'region', 'summary'] as const
const publicationV1Keys = ['publication_id', 'category_id', 'title', 'description', 'eligibility_text', 'condition_text', 'trust_label', 'revision'] as const
const publicationV2Keys = [...publicationV1Keys, 'origin_claim_id'] as const
const publicClaimKeys = ['claim_id','category_id','category_name','title','description','eligibility_text','condition_text','status_code','status_label','nickname','submitted_at','observed_on','confirm_count','dispute_count','last_confirmation_at'] as const
const searchInputKeys = ['query', 'categories', 'industry', 'size', 'region', 'hasBenefitsOnly', 'pageSize', 'cursor'] as const

export const MAX_BENEFIT_DETAIL_PUBLICATIONS = 200

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDenseArray(value: unknown[]) {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return false
  }
  return true
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}
function hasOnlyKnownKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every(key => allowed.includes(key))
}

function codePointLength(value: string) { return Array.from(value).length }
function byteLength(value: string) { return new TextEncoder().encode(value).length }
function boundedWireText(value: unknown, max: number): value is string {
  return typeof value === 'string' && codePointLength(value) >= 1 && codePointLength(value) <= max && value.trim() === value
}
function nullableBoundedWireText(value: unknown, max: number): value is string | null {
  return value === null || boundedWireText(value, max)
}
function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}
function inValues<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value)
}
function isCompanyId(value: unknown): value is string {
  return isBenefitCompanyId(value)
}
function isCategory(value: unknown): value is BenefitDirectoryCategory {
  return inValues(value, BENEFIT_DIRECTORY_CATEGORIES)
}

function decodeCompany(value: unknown): BenefitDirectoryCompanySummary {
  if (!isRecord(value) || !hasExactKeys(value, companyKeys)
    || !isCompanyId(value.company_id) || !boundedWireText(value.display_name, 200)
    || !inValues(value.identity_label, BENEFIT_DIRECTORY_IDENTITY_LABELS)
    || !nullableBoundedWireText(value.industry, 100) || !inValues(value.size_label, BENEFIT_DIRECTORY_SIZE_LABELS)
    || !nullableBoundedWireText(value.region, 100) || !nullableBoundedWireText(value.summary, 500)) {
    throw new Error('invalid company projection')
  }
  return {
    companyId: value.company_id, displayName: value.display_name, identityLabel: value.identity_label,
    industry: value.industry, sizeLabel: value.size_label, region: value.region, summary: value.summary,
  }
}

function decodeSearchItem(value: unknown): BenefitDirectorySearchItem {
  if (!isRecord(value) || !hasExactKeys(value, searchItemKeys)) throw new Error('invalid search item keys')
  const company = decodeCompany(Object.fromEntries(companyKeys.map(key => [key, value[key]])))
  if (!nonnegativeInteger(value.benefit_count) || !nonnegativeInteger(value.official_count)
    || !nonnegativeInteger(value.community_count) || !Array.isArray(value.categories)
    || value.categories.length > BENEFIT_DIRECTORY_CATEGORIES.length || !isDenseArray(value.categories)
    || value.categories.some(category => !isCategory(category))) throw new Error('invalid search aggregates')
  const categories = value.categories as BenefitDirectoryCategory[]
  const uniqueCategories = new Set(categories)
  const sortedCategories = [...categories].sort()
  if (uniqueCategories.size !== categories.length || categories.some((category, index) => category !== sortedCategories[index])
    || value.benefit_count !== value.official_count + value.community_count
    || (value.benefit_count === 0) !== (categories.length === 0)
    || categories.length > value.benefit_count) throw new Error('inconsistent search aggregates')
  return {
    ...company, benefitCount: value.benefit_count, officialCount: value.official_count,
    communityCount: value.community_count, categories,
  }
}

function validOpaqueCursor(value: unknown): value is string {
  return typeof value === 'string' && codePointLength(value) >= 1 && codePointLength(value) <= 500 && byteLength(value) <= 2000
}

function decodePage(value: unknown, input: BenefitDirectorySearchInput): BenefitDirectoryPage {
  if (!isRecord(value) || !hasExactKeys(value, searchPageKeys) || !Array.isArray(value.items)
    || value.items.length > input.pageSize || value.items.length > 50 || !isDenseArray(value.items)
    || typeof value.has_more !== 'boolean' || !nonnegativeInteger(value.total)) throw new Error('invalid search page')
  if ((value.has_more && (!validOpaqueCursor(value.next_cursor) || value.items.length !== input.pageSize))
    || (!value.has_more && value.next_cursor !== null)) throw new Error('invalid search cursor state')
  const items = value.items.map(decodeSearchItem)
  if (new Set(items.map(item => item.companyId)).size !== items.length || value.total < items.length
    || (value.has_more && value.total <= items.length)
    || ((input.cursor === null || input.cursor === undefined) && !value.has_more && value.total !== items.length)) {
    throw new Error('inconsistent search page')
  }
  return { items, hasMore: value.has_more, nextCursor: value.next_cursor as string | null, total: value.total }
}

function decodePublicationBase(value: unknown, exactKeys: readonly string[]): BenefitDirectoryPublicationV1 {
  if (!isRecord(value) || !hasExactKeys(value, exactKeys) || !isCanonicalUuid(value.publication_id)
    || !isCategory(value.category_id) || !boundedWireText(value.title, 200) || !boundedWireText(value.description, 5000)
    || !nullableBoundedWireText(value.eligibility_text, 2000) || !nullableBoundedWireText(value.condition_text, 2000)
    || !inValues(value.trust_label, BENEFIT_DIRECTORY_TRUST_LABELS) || !nonnegativeInteger(value.revision)) {
    throw new Error('invalid publication projection')
  }
  return {
    publicationId: value.publication_id, categoryId: value.category_id, title: value.title,
    description: value.description, eligibilityText: value.eligibility_text, conditionText: value.condition_text,
    trustLabel: value.trust_label, revision: value.revision,
  }
}

function decodePublicationV1(value: unknown): BenefitDirectoryPublicationV1 {
  return decodePublicationBase(value, publicationV1Keys)
}

function decodePublicationV2(value: unknown): BenefitDirectoryPublicationV2 {
  const publication = decodePublicationBase(value, publicationV2Keys)
  if (!isRecord(value) || (value.origin_claim_id !== null && !isCanonicalUuid(value.origin_claim_id))) {
    throw new Error('invalid publication projection')
  }
  return {
    ...publication,
    originClaimId: value.origin_claim_id === null ? null : value.origin_claim_id.toLowerCase(),
  }
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return year >= 2000 && parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
}
function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && parsePostgresTimestampMicros(value) !== null
}
const categoryNames: Record<BenefitDirectoryCategory,string> = { leave:'휴가', family:'가족', health:'건강', growth:'성장', housing:'주거', commute:'통근', remote:'유연근무', retirement:'퇴직', meals:'식사', inclusion:'포용' }
const statusLabels = { submitted:'제보됨', community_confirmed:'커뮤니티 확인', disputed:'재확인 필요' } as const
function decodePublicClaim(value: unknown): BenefitDirectoryPublicClaim {
  if (!isRecord(value) || !hasExactKeys(value, publicClaimKeys) || !isCanonicalUuid(value.claim_id)
    || !isCategory(value.category_id) || value.category_name !== categoryNames[value.category_id]
    || !boundedWireText(value.title, 200) || !boundedWireText(value.description, 1000)
    || !nullableBoundedWireText(value.eligibility_text, 500) || !nullableBoundedWireText(value.condition_text, 500)
    || !inValues(value.status_code, BENEFIT_DIRECTORY_PUBLIC_CLAIM_STATUSES)
    || value.status_label !== statusLabels[value.status_code]
    || !boundedWireText(value.nickname, 200) || !isTimestamp(value.submitted_at) || !isCalendarDate(value.observed_on)
    || !nonnegativeInteger(value.confirm_count) || !nonnegativeInteger(value.dispute_count)
    || (value.last_confirmation_at !== null && !isTimestamp(value.last_confirmation_at))) throw new Error('invalid public claim')
  const stateValid = value.status_code === 'disputed' ? value.dispute_count >= 1
    : value.status_code === 'community_confirmed' ? value.dispute_count === 0 && value.confirm_count >= 3
      : value.dispute_count === 0 && value.confirm_count < 3
  if (!stateValid || (value.confirm_count === 0) !== (value.last_confirmation_at === null)
    || (value.last_confirmation_at !== null && comparePostgresTimestamps(value.last_confirmation_at, value.submitted_at) < 0)
    || Date.parse(`${value.observed_on}T00:00:00Z`) > Date.parse(value.submitted_at)) throw new Error('inconsistent public claim')
  return { claimId:value.claim_id.toLowerCase(), categoryId:value.category_id, categoryName:value.category_name,
    title:value.title, description:value.description, eligibilityText:value.eligibility_text, conditionText:value.condition_text,
    statusCode:value.status_code, statusLabel:value.status_label as string, nickname:value.nickname, submittedAt:value.submitted_at,
    observedOn:value.observed_on, confirmCount:value.confirm_count, disputeCount:value.dispute_count,
    lastConfirmationAt:value.last_confirmation_at }
}

export function decodeBenefitCompanyDetailV1(value: unknown, requestedCompanyId: string): BenefitCompanyDetailV1 {
  if (!isRecord(value) || !hasExactKeys(value, ['company', 'publications']) || !Array.isArray(value.publications)
    || value.publications.length > MAX_BENEFIT_DETAIL_PUBLICATIONS || !isDenseArray(value.publications)) throw new Error('invalid detail projection')
  const company = decodeCompany(value.company)
  const publications = value.publications.map(decodePublicationV1)
  if (company.companyId !== requestedCompanyId
    || new Set(publications.map(publication => publication.publicationId.toLowerCase())).size !== publications.length) {
    throw new Error('inconsistent detail projection')
  }
  return { company, publications }
}

export function decodeBenefitCompanyDetailV2(value: unknown, requestedCompanyId: string): BenefitCompanyDetailV2 {
  if (!isRecord(value) || !hasExactKeys(value, detailKeys) || !Array.isArray(value.publications)
    || value.publications.length > MAX_BENEFIT_DETAIL_PUBLICATIONS || !isDenseArray(value.publications)
    || !Array.isArray(value.claims) || value.claims.length > 200 || !isDenseArray(value.claims)) throw new Error('invalid detail projection')
  const company = decodeCompany(value.company)
  const publications = value.publications.map(decodePublicationV2)
  const claims = value.claims.map(decodePublicClaim)
  const linkedClaimIds = publications.flatMap(publication => publication.originClaimId ? [publication.originClaimId] : [])
  const claimIds = new Set(claims.map(claim => claim.claimId))
  if (company.companyId !== requestedCompanyId
    || new Set(publications.map(publication => publication.publicationId.toLowerCase())).size !== publications.length
    || claimIds.size !== claims.length
    || new Set(linkedClaimIds).size !== linkedClaimIds.length
    || linkedClaimIds.some(claimId => !claimIds.has(claimId))) {
    throw new Error('inconsistent detail projection')
  }
  return { company, publications, claims }
}

function invalidArgument<T>(): Result<T> {
  return { ok: false, error: { code: 'invalid_argument', message: '입력 내용을 확인해 주세요.' } }
}
function aborted<T>(): Result<T> {
  return { ok: false, error: { code: 'aborted', message: '요청이 취소되었습니다.' } }
}
function failure<T>(code: BenefitDirectoryErrorCode, message: string): Result<T> {
  return { ok: false, error: { code, message } }
}
function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}
function errorCode(error: unknown) {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined
}
function responseStatus(status: unknown) {
  return Number.isInteger(status) && (status as number) >= 100 && (status as number) <= 599
    ? status as number
    : undefined
}
function validStatusText(value: unknown): value is string {
  return typeof value === 'string' && byteLength(value) <= 800
    && !Array.from(value).some(character => {
      const code = character.charCodeAt(0)
      return code <= 31 || code === 127
    })
}
function validTransportError(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  try {
    const encoded = JSON.stringify(value)
    if (encoded === undefined || byteLength(encoded) > 8192) return false
  } catch {
    return false
  }
  return hasExactKeys(value,['code','message','details','hint'])
    && typeof value.code === 'string' && value.code.length>=1 && byteLength(value.code) <= 100
    && typeof value.message === 'string' && value.message.length>=1 && byteLength(value.message) <= 4000
    && (value.details === null || (typeof value.details === 'string' && byteLength(value.details) <= 4000))
    && (value.hint === null || (typeof value.hint === 'string' && byteLength(value.hint) <= 4000))
}


function mapTransportError<T>(
  transport: { error: unknown; status?: unknown; statusText?: unknown },
  operation?: 'search_benefit_companies_v1' | 'get_benefit_company_v2',
): Result<T> {
  const { error } = transport
  if (isAbortError(error)) return aborted()
  if (error instanceof TypeError || (isRecord(error) && typeof error.message === 'string' && /failed to fetch|networkerror|network request failed/i.test(error.message))) {
    return failure('network', '네트워크 요청에 실패했습니다.')
  }
  const code = errorCode(error)
  const status = responseStatus(transport.status)
  if (code === 'PGRST202') return failure('configuration', '서비스 설정을 확인할 수 없습니다.')
  if (operation === 'get_benefit_company_v2' && code === 'PGRST116') return failure('not_found', '기업 정보를 찾을 수 없습니다.')
  if (status === 400 || code === '22023') return invalidArgument()
  if (code === '57014' || code === 'PGRST504') return failure('timeout', '요청 시간이 초과되었습니다.')
  if (code === 'PGRST429') return failure('rate_limited', '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.')
  if (status === 408) return failure('timeout', '요청 시간이 초과되었습니다.')
  if (status === 429) return failure('rate_limited', '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.')
  if (status !== undefined && status >= 500) return failure('unavailable', '서비스를 일시적으로 이용할 수 없습니다.')
  return failure('unknown', '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
}

function validOptionalFilter(value: string | null | undefined, maxCharacters: number, maxBytes: number) {
  return value === null || value === undefined
    || (typeof value === 'string' && value.trim().length > 0 && codePointLength(value) <= maxCharacters && byteLength(value) <= maxBytes)
}
function validSearchInput(input: BenefitDirectorySearchInput) {
  if (!isRecord(input) || !hasOnlyKnownKeys(input, searchInputKeys)
    || !Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 50
    || (input.hasBenefitsOnly !== undefined && typeof input.hasBenefitsOnly !== 'boolean')
    || (input.query !== null && input.query !== undefined && (typeof input.query !== 'string' || codePointLength(input.query) > 200 || byteLength(input.query) > 800))
    || !validOptionalFilter(input.industry, 100, 400) || !validOptionalFilter(input.region, 100, 400)
    || (input.size !== null && input.size !== undefined && !inValues(input.size, BENEFIT_DIRECTORY_SIZE_CLASSES))
    || (input.cursor !== null && input.cursor !== undefined && !validOpaqueCursor(input.cursor))) return false
  if (input.categories !== null && input.categories !== undefined) {
    if (!Array.isArray(input.categories) || input.categories.length > BENEFIT_DIRECTORY_CATEGORIES.length
      || !isDenseArray(input.categories) || input.categories.length < 1
      || input.categories.some(category => !isCategory(category))) return false
  }
  return true
}

function getAnonymousClient() {
  try { return { ok: true as const, client: getAnonymousSupabaseClient() } }
  catch { return { ok: false as const } }
}

export function createBenefitDirectoryRepository(): BenefitDirectoryRepository {
  async function execute<T>(
    name: 'search_benefit_companies_v1' | 'get_benefit_company_v2',
    requestFor: (client: ReturnType<typeof getAnonymousSupabaseClient>) => PromiseLike<unknown> & { abortSignal(signal: AbortSignal): PromiseLike<unknown> },
    decode: (value: unknown) => T, signal?: AbortSignal,
  ): Promise<Result<T>> {
    if (signal?.aborted) return aborted()
    const clientResult = getAnonymousClient()
    if (!clientResult.ok) return failure('configuration', '서비스 설정을 확인할 수 없습니다.')
    const client = clientResult.client
    try {
      const request = requestFor(client)
      const response = signal ? await request.abortSignal(signal) : await request
      if (signal?.aborted) return aborted()
      if (!isRecord(response)
        || !hasExactKeys(response,['data','error','count','status','statusText'])
        || response.count !== null
        || responseStatus(response.status) === undefined || !validStatusText(response.statusText)) {
        return failure('invalid_response', '서버 응답을 확인할 수 없습니다.')
      }
      const status = response.status as number
      if (response.error === null) {
        if (status < 200 || status > 299 || status === 204) {
          return failure('invalid_response', '서버 응답을 확인할 수 없습니다.')
        }
      } else if (status >= 200 && status <= 299
        || !validTransportError(response.error) || response.data !== null) {
        return failure('invalid_response', '서버 응답을 확인할 수 없습니다.')
      } else return mapTransportError({
        error: response.error,
        status,
        statusText: response.statusText,
      }, name)
      try { return { ok: true, data: decode(response.data) } }
      catch (error) {
        return error instanceof BenefitDirectoryNotFoundError
          ? failure('not_found', '기업 정보를 찾을 수 없습니다.')
          : failure('invalid_response', '서버 응답을 확인할 수 없습니다.')
      }
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) return aborted()
      return mapTransportError({ error }, name)
    }
  }

  return {
    search(input, signal) {
      if (!validSearchInput(input)) return Promise.resolve(invalidArgument())
      const args = {
        p_query: input.query ?? null,
        p_categories: input.categories ?? null,
        p_industry: input.industry ?? null,
        p_size: input.size ?? null,
        p_region: input.region ?? null,
        p_has_benefits_only: input.hasBenefitsOnly ?? false,
        p_page_size: input.pageSize,
        p_cursor: input.cursor ?? null,
      } satisfies SearchRpcArgs
      return execute('search_benefit_companies_v1', client => client.rpc('search_benefit_companies_v1', args), value => decodePage(value, input), signal)
    },
    detail(companyId, signal) {
      if (!isCompanyId(companyId)) return Promise.resolve(invalidArgument())
      const args = { p_company_id: companyId } satisfies DetailRpcArgs
      return execute('get_benefit_company_v2', client => client.rpc('get_benefit_company_v2', args), value => {
        if (value === null) throw new BenefitDirectoryNotFoundError()
        return decodeBenefitCompanyDetailV2(value, companyId)
      }, signal)
    },
  }
}

class BenefitDirectoryNotFoundError extends Error {}

let browserRepository: BenefitDirectoryRepository | undefined
export function getBenefitDirectoryRepository(): BenefitDirectoryRepository {
  browserRepository ??= createBenefitDirectoryRepository()
  return browserRepository
}
