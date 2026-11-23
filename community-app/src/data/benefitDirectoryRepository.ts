import { getAnonymousSupabaseClient } from '../lib/supabase'
import { isCanonicalUuid } from '../lib/uuid'
import { isBenefitCompanyId } from '../lib/benefitCompanyId'
import {
  BENEFIT_DIRECTORY_CATEGORIES,
  BENEFIT_DIRECTORY_IDENTITY_LABELS,
  BENEFIT_DIRECTORY_SIZE_CLASSES,
  BENEFIT_DIRECTORY_SIZE_LABELS,
  BENEFIT_DIRECTORY_TRUST_LABELS,
  type BenefitCompanyDetail,
  type BenefitDirectoryCategory,
  type BenefitDirectoryCompanySummary,
  type BenefitDirectoryErrorCode,
  type BenefitDirectoryPage,
  type BenefitDirectoryPublication,
  type BenefitDirectorySearchInput,
  type BenefitDirectorySearchItem,
  type Result,
} from '../types/benefitDirectory'

export interface BenefitDirectoryRepository {
  search(input: BenefitDirectorySearchInput, signal?: AbortSignal): Promise<Result<BenefitDirectoryPage>>
  detail(companyId: string, signal?: AbortSignal): Promise<Result<BenefitCompanyDetail>>
}

const searchPageKeys = ['items', 'has_more', 'next_cursor', 'total'] as const
const searchItemKeys = ['company_id', 'display_name', 'identity_label', 'industry', 'size_label', 'region', 'summary', 'benefit_count', 'official_count', 'community_count', 'categories'] as const
const detailKeys = ['company', 'publications'] as const
const companyKeys = ['company_id', 'display_name', 'identity_label', 'industry', 'size_label', 'region', 'summary'] as const
const publicationKeys = ['publication_id', 'category_id', 'title', 'description', 'eligibility_text', 'condition_text', 'trust_label', 'revision'] as const
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

function decodePublication(value: unknown): BenefitDirectoryPublication {
  if (!isRecord(value) || !hasExactKeys(value, publicationKeys) || !isCanonicalUuid(value.publication_id)
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

function decodeDetail(value: unknown, requestedCompanyId: string): BenefitCompanyDetail {
  if (!isRecord(value) || !hasExactKeys(value, detailKeys) || !Array.isArray(value.publications)
    || value.publications.length > MAX_BENEFIT_DETAIL_PUBLICATIONS || !isDenseArray(value.publications)) throw new Error('invalid detail projection')
  const company = decodeCompany(value.company)
  const publications = value.publications.map(decodePublication)
  if (company.companyId !== requestedCompanyId
    || new Set(publications.map(publication => publication.publicationId.toLowerCase())).size !== publications.length) {
    throw new Error('inconsistent detail projection')
  }
  return { company, publications }
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
function hasOwn(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key)
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
  return typeof value.code === 'string' && byteLength(value.code) <= 100
    && typeof value.message === 'string' && byteLength(value.message) <= 4000
    && (value.details === undefined || value.details === null || (typeof value.details === 'string' && byteLength(value.details) <= 4000))
    && (value.hint === undefined || value.hint === null || (typeof value.hint === 'string' && byteLength(value.hint) <= 4000))
}
function mapTransportError<T>(
  transport: { error: unknown; status?: unknown; statusText?: unknown },
  operation?: 'search_benefit_companies_v1' | 'get_benefit_company_v1',
): Result<T> {
  const { error } = transport
  if (isAbortError(error)) return aborted()
  if (error instanceof TypeError || (isRecord(error) && typeof error.message === 'string' && /failed to fetch|networkerror|network request failed/i.test(error.message))) {
    return failure('network', '네트워크 요청에 실패했습니다.')
  }
  const code = errorCode(error)
  const status = responseStatus(transport.status)
  if (code === 'PGRST202') return failure('configuration', '서비스 설정을 확인할 수 없습니다.')
  if (operation === 'get_benefit_company_v1' && code === 'PGRST116') return failure('not_found', '기업 정보를 찾을 수 없습니다.')
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
    name: 'search_benefit_companies_v1' | 'get_benefit_company_v1',
    args: Record<string, unknown>, decode: (value: unknown) => T, signal?: AbortSignal,
  ): Promise<Result<T>> {
    if (signal?.aborted) return aborted()
    const clientResult = getAnonymousClient()
    if (!clientResult.ok) return failure('configuration', '서비스 설정을 확인할 수 없습니다.')
    const client = clientResult.client
    try {
      const request = client.rpc(name, args as never)
      const response = signal ? await request.abortSignal(signal) : await request
      if (signal?.aborted) return aborted()
      if (!isRecord(response)
        || !['data', 'error', 'status', 'statusText'].every(key => hasOwn(response, key))
        || (hasOwn(response, 'count') && response.count !== null && !nonnegativeInteger(response.count))
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
      return execute('search_benefit_companies_v1', {
        p_query: input.query ?? null,
        p_categories: input.categories ?? null,
        p_industry: input.industry ?? null,
        p_size: input.size ?? null,
        p_region: input.region ?? null,
        p_has_benefits_only: input.hasBenefitsOnly ?? false,
        p_page_size: input.pageSize,
        p_cursor: input.cursor ?? null,
      }, value => decodePage(value, input), signal)
    },
    detail(companyId, signal) {
      if (!isCompanyId(companyId)) return Promise.resolve(invalidArgument())
      return execute('get_benefit_company_v1', { p_company_id: companyId }, value => {
        if (value === null) throw new BenefitDirectoryNotFoundError()
        return decodeDetail(value, companyId)
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
