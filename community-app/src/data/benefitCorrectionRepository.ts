import { getSupabaseClient } from '../lib/supabase'
import { parseEnv } from '../config/env'
import { isCanonicalUuid, isStrictUuid } from '../lib/uuid'
import {
  BENEFIT_CATEGORIES,
  BENEFIT_CORRECTION_QUEUE_FILTERS,
  BENEFIT_CORRECTION_REVIEW_ACTIONS,
  BENEFIT_CORRECTION_STATUSES,
  type AdminBenefitCorrectionItem,
  type BenefitCategory,
  type BenefitCorrectionCursor,
  type BenefitCorrectionAccountScope,
  type BenefitCorrectionItem,
  type BenefitCorrectionListInput,
  type BenefitCorrectionPage,
  type BenefitCorrectionQueueInput,
  type BenefitCorrectionResult,
  type CreateBenefitCorrectionInput,
  type ReviewBenefitCorrectionInput,
} from '../types/benefitCorrections'

export interface BenefitCorrectionRpcResponse { data: unknown; error: unknown }
export interface BenefitCorrectionRpcClient {
  rpc(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<BenefitCorrectionRpcResponse>
}
export interface BenefitCorrectionSessionContext extends BenefitCorrectionRpcClient {
  readonly actorId: string
  readonly sessionFingerprint: string
}
export type BenefitCorrectionSessionProvider = () => BenefitCorrectionSessionContext | null | Promise<BenefitCorrectionSessionContext | null>

export interface BenefitCorrectionRepository {
  getCurrentAccountScope(signal?: AbortSignal): Promise<BenefitCorrectionResult<BenefitCorrectionAccountScope>>
  createRequest(input: CreateBenefitCorrectionInput, expectedAccountScope: BenefitCorrectionAccountScope, signal?: AbortSignal): Promise<BenefitCorrectionResult<BenefitCorrectionItem>>
  listMyRequests(input: BenefitCorrectionListInput, signal?: AbortSignal): Promise<BenefitCorrectionResult<BenefitCorrectionPage<BenefitCorrectionItem>>>
  listAdminQueue(input: BenefitCorrectionQueueInput, signal?: AbortSignal): Promise<BenefitCorrectionResult<BenefitCorrectionPage<AdminBenefitCorrectionItem>>>
  reviewRequest(input: ReviewBenefitCorrectionInput, signal?: AbortSignal): Promise<BenefitCorrectionResult<AdminBenefitCorrectionItem>>
}

const ownerKeys = ['id', 'company_id', 'category_id', 'current_text', 'proposed_text', 'scope_text', 'source_url', 'observed_data_version', 'status', 'admin_response', 'applied_data_version', 'applied_at', 'created_at', 'updated_at'] as const
const adminKeys = [...ownerKeys, 'reviewed_at'] as const
const timestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/
const dataVersionPattern = /^company-benefits-(\d{4})-(\d{2})-(\d{2})-v[1-9][0-9]*$/
const companyPattern = /^(?:KR-CRN-[0-9]{13}|US-CIK[0-9]{10})$/
const accountScopePattern = /^[0-9a-f]{64}$/
const ACCOUNT_SCOPE_DOMAIN = 'breadlab:benefit-correction:account-scope:v1'
const SESSION_FINGERPRINT_DOMAIN = 'breadlab:benefit-correction:session-fingerprint:v1'

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort(); const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}
function isLeapYear(year: number) { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) }
function daysInMonth(year: number, month: number) { return month === 2 ? (isLeapYear(year) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31 }
export function isBenefitCorrectionTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = timestampPattern.exec(value); if (!match) return false
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = match.slice(1).map(Number)
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
    && hour <= 23 && minute <= 59 && second <= 59
    && (Number.isNaN(offsetHour) || (offsetHour <= 23 && offsetMinute <= 59))
    && Number.isFinite(Date.parse(value))
}
function codePointLength(value: string) { return Array.from(value).length }
export function isBenefitCorrectionDataVersion(value: unknown): value is string {
  if (typeof value !== 'string' || codePointLength(value) < 30 || codePointLength(value) > 100 || value.trim() !== value) return false
  const match = dataVersionPattern.exec(value); if (!match) return false
  const [, year, month, day] = match.map(Number)
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}
export function isBenefitCorrectionSourceUrl(value: unknown): value is string {
  if (typeof value !== 'string' || codePointLength(value) < 9 || codePointLength(value) > 2048 || value.trim() !== value
    || /\s/u.test(value) || [...value].some(character => { const code = character.charCodeAt(0); return code <= 31 || code === 127 })) return false
  const match = /^https:\/\/([^/?#]+)(?:[/?#].*)?$/.exec(value); if (!match) return false
  const authority = match[1]
  if (authority.includes('@') || authority.includes('[') || authority.includes(']') || !/^[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/.test(authority)) return false
  const [hostValue, portValue = ''] = authority.split(':'); const host = hostValue.toLowerCase()
  if (portValue && (Number(portValue) < 1 || Number(portValue) > 65535)) return false
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.test') || host.endsWith('.invalid') || /^[0-9.]+$/.test(host)) return false
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(host)
}
function boundedText(value: unknown, max: number): value is string { return typeof value === 'string' && codePointLength(value) >= 1 && codePointLength(value) <= max && value.trim() === value }
function isCategory(value: unknown): value is BenefitCategory { return typeof value === 'string' && (BENEFIT_CATEGORIES as readonly string[]).includes(value) }
function timestampOrder(...values: Array<string | null>) {
  const present = values.filter((value): value is string => value !== null)
  return present.every((value, index) => index === 0 || Date.parse(value) >= Date.parse(present[index - 1]))
}

export function decodeBenefitCorrectionItem(value: unknown, admin = false): BenefitCorrectionItem | AdminBenefitCorrectionItem {
  if (!isRecord(value) || !hasExactKeys(value, admin ? adminKeys : ownerKeys)) throw new Error('invalid response keys')
  if (!isCanonicalUuid(value.id) || typeof value.company_id !== 'string' || !companyPattern.test(value.company_id) || !isCategory(value.category_id)
    || !boundedText(value.current_text, 5000) || !boundedText(value.proposed_text, 5000) || !boundedText(value.scope_text, 2000)
    || !isBenefitCorrectionSourceUrl(value.source_url) || !isBenefitCorrectionDataVersion(value.observed_data_version)
    || typeof value.status !== 'string' || !(BENEFIT_CORRECTION_STATUSES as readonly string[]).includes(value.status)
    || (value.admin_response !== null && !boundedText(value.admin_response, 2000))
    || (value.applied_data_version !== null && !isBenefitCorrectionDataVersion(value.applied_data_version))
    || (value.applied_at !== null && !isBenefitCorrectionTimestamp(value.applied_at))
    || !isBenefitCorrectionTimestamp(value.created_at) || !isBenefitCorrectionTimestamp(value.updated_at)) throw new Error('invalid response values')
  const status = value.status as BenefitCorrectionItem['status']
  const submitted = status === 'submitted'; const applied = status === 'applied'
  if ((submitted && (value.admin_response !== null || value.applied_data_version !== null || value.applied_at !== null))
    || (!submitted && value.admin_response === null)
    || (applied !== (value.applied_data_version !== null && value.applied_at !== null))
    || !timestampOrder(value.created_at, value.updated_at)
    || (value.applied_at !== null && !timestampOrder(value.created_at, value.applied_at, value.updated_at))) throw new Error('invalid response state')
  const item: BenefitCorrectionItem = {
    id: value.id.toLowerCase(), companyId: value.company_id as string, categoryId: value.category_id,
    currentText: value.current_text, proposedText: value.proposed_text, scopeText: value.scope_text,
    sourceUrl: value.source_url, observedDataVersion: value.observed_data_version, status,
    adminResponse: value.admin_response as string | null, appliedDataVersion: value.applied_data_version as string | null,
    appliedAt: value.applied_at as string | null, createdAt: value.created_at, updatedAt: value.updated_at,
  }
  if (!admin) return item
  if (value.reviewed_at !== null && !isBenefitCorrectionTimestamp(value.reviewed_at)) throw new Error('invalid reviewed timestamp')
  if ((submitted && value.reviewed_at !== null) || (!submitted && value.reviewed_at === null)
    || (value.reviewed_at !== null && !timestampOrder(value.created_at, value.reviewed_at, value.applied_at as string | null, value.updated_at))) throw new Error('invalid reviewed state')
  return { ...item, reviewedAt: value.reviewed_at as string | null }
}

function decodeCursor(value: unknown): BenefitCorrectionCursor {
  if (!isRecord(value) || !hasExactKeys(value, ['created_at', 'id']) || !isBenefitCorrectionTimestamp(value.created_at) || !isCanonicalUuid(value.id)) throw new Error('invalid cursor')
  return { createdAt: value.created_at, id: value.id.toLowerCase() }
}
function decodePage<T extends BenefitCorrectionItem>(value: unknown, admin: boolean): BenefitCorrectionPage<T> {
  if (!isRecord(value) || !hasExactKeys(value, ['items', 'has_more', 'next_cursor']) || !Array.isArray(value.items) || typeof value.has_more !== 'boolean') throw new Error('invalid page')
  if ((value.has_more && value.next_cursor === null) || (!value.has_more && value.next_cursor !== null)) throw new Error('invalid page cursor state')
  return { items: value.items.map(item => decodeBenefitCorrectionItem(item, admin) as T), hasMore: value.has_more, nextCursor: value.next_cursor === null ? null : decodeCursor(value.next_cursor) }
}

function invalidArgument<T>(): BenefitCorrectionResult<T> { return { ok: false, error: { code: 'invalid_argument', message: '입력 내용을 확인해 주세요.' } } }
function sourceCodeFrom(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined
  if (error.code === 'PGRST' && typeof error.message === 'string') {
    try {
      const payload: unknown = JSON.parse(error.message)
      return isRecord(payload) && typeof payload.code === 'string' ? payload.code : 'PGRST'
    } catch { return 'PGRST' }
  }
  return typeof error.code === 'string' ? error.code : undefined
}
function mapRpcError(error: unknown): BenefitCorrectionResult<never> {
  if (error instanceof TypeError) return { ok: false, error: { code: 'network', sourceCode: 'NETWORK_ERROR', message: '네트워크 요청에 실패했습니다.' } }
  if (!isRecord(error)) return { ok: false, error: { code: 'unknown', message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' } }
  if ((error.code === undefined || error.code === 'FETCH_ERROR') && typeof error.message === 'string'
    && /failed to fetch|networkerror|network request failed/i.test(error.message)) {
    return { ok: false, error: { code: 'network', sourceCode: 'NETWORK_ERROR', message: '네트워크 요청에 실패했습니다.' } }
  }
  const sourceCode = sourceCodeFrom(error)
  const status = typeof error.status === 'number' ? error.status : undefined
  const code = status === 429 || sourceCode === 'rate_limit_exceeded' ? 'rate_limited'
    : status === 401 || sourceCode === 'PGRST303' ? 'auth_required'
      : status === 403 || sourceCode === '42501' ? 'forbidden'
        : sourceCode === '40001' ? 'conflict' : 'unknown'
  return { ok: false, error: { code, sourceCode, message: code === 'auth_required' ? '로그인이 필요합니다.' : code === 'forbidden' ? '권한이 없습니다.' : code === 'conflict' ? '요청 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.' : code === 'rate_limited' ? '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' } }
}
function validListInput(input: BenefitCorrectionListInput) {
  return Number.isSafeInteger(input.limit) && input.limit >= 1 && input.limit <= 100
    && (!input.cursor || (isBenefitCorrectionTimestamp(input.cursor.createdAt) && isCanonicalUuid(input.cursor.id)))
}
function validCreateInput(input: CreateBenefitCorrectionInput) {
  return isStrictUuid(input.clientKey) && companyPattern.test(input.companyId) && isCategory(input.categoryId)
    && boundedText(input.currentText, 5000) && boundedText(input.proposedText, 5000) && boundedText(input.scopeText, 2000)
    && isBenefitCorrectionSourceUrl(input.sourceUrl) && isBenefitCorrectionDataVersion(input.observedDataVersion)
}
function validAccountScope(value: unknown): value is BenefitCorrectionAccountScope {
  return typeof value === 'string' && accountScopePattern.test(value)
}
function validReviewInput(input: ReviewBenefitCorrectionInput) {
  const validExpectedStatus = input.expectedStatus === 'submitted' || input.expectedStatus === 'reviewing'
  const transitionAllowed = input.expectedStatus === 'submitted'
    ? input.action === 'start_review'
    : input.expectedStatus === 'reviewing' && input.action !== 'start_review'
  return isCanonicalUuid(input.requestId) && isStrictUuid(input.clientKey) && validExpectedStatus
    && (BENEFIT_CORRECTION_REVIEW_ACTIONS as readonly string[]).includes(input.action)
    && transitionAllowed && boundedText(input.adminResponse, 2000)
}

async function sha256Hex(material: string, subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<string> {
  const digest = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(material)))
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function deriveBenefitCorrectionAccountScope(
  actorId: string,
  subtle: SubtleCrypto = globalThis.crypto.subtle,
): Promise<BenefitCorrectionAccountScope> {
  if (!isCanonicalUuid(actorId)) throw new Error('invalid account id')
  return sha256Hex(`${ACCOUNT_SCOPE_DOMAIN}\0${actorId.toLowerCase()}`, subtle) as Promise<BenefitCorrectionAccountScope>
}

type SessionResult = { data: { session: { user: { id: string }; access_token: string } | null } }
type SessionAuthClient = { getSession(): Promise<SessionResult> }
type SupabasePublicConfig = { supabaseUrl: string; supabasePublishableKey: string }

export function createBenefitCorrectionSessionProvider(
  auth: SessionAuthClient,
  config: SupabasePublicConfig,
  fetcher: typeof fetch = globalThis.fetch,
): BenefitCorrectionSessionProvider {
  return async () => {
    const session = (await auth.getSession()).data.session
    if (!session || !isCanonicalUuid(session.user.id) || typeof session.access_token !== 'string' || session.access_token.length === 0) return null
    const actorId = session.user.id.toLowerCase()
    const accessToken = session.access_token
    const sessionFingerprint = await sha256Hex(`${SESSION_FINGERPRINT_DOMAIN}\0${accessToken}`)
    return {
      actorId,
      sessionFingerprint,
      async rpc(name, args, signal) {
        const response = await fetcher(`${config.supabaseUrl}/rest/v1/rpc/${encodeURIComponent(name)}`, {
          method: 'POST',
          headers: {
            apikey: config.supabasePublishableKey,
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(args),
          signal,
        })
        const payload: unknown = await response.json()
        return response.ok
          ? { data: payload, error: null }
          : { data: null, error: isRecord(payload) ? { ...payload, status: response.status } : { status: response.status } }
      },
    }
  }
}

function validSessionContext(value: unknown): value is BenefitCorrectionSessionContext {
  return isRecord(value) && isCanonicalUuid(value.actorId)
    && typeof value.sessionFingerprint === 'string' && value.sessionFingerprint.length > 0 && value.sessionFingerprint.length <= 256
    && typeof value.rpc === 'function'
}
function sameSession(left: BenefitCorrectionSessionContext, right: BenefitCorrectionSessionContext) {
  return left.actorId.toLowerCase() === right.actorId.toLowerCase() && left.sessionFingerprint === right.sessionFingerprint
}

export function createBenefitCorrectionRepository(options: { getSessionContext: BenefitCorrectionSessionProvider }): BenefitCorrectionRepository {
  if (!options || typeof options.getSessionContext !== 'function') throw new Error('session context provider is required')
  const aborted = <T>(): BenefitCorrectionResult<T> => ({ ok: false, error: { code: 'aborted', message: '요청이 취소되었습니다.' } })
  const authRequired = <T>(): BenefitCorrectionResult<T> => ({ ok: false, error: { code: 'auth_required', message: '로그인이 필요합니다.' } })
  const stale = <T>(message: string): BenefitCorrectionResult<T> => ({ ok: false, error: { code: 'stale_response', message } })
  async function captureSession(signal?: AbortSignal): Promise<BenefitCorrectionResult<BenefitCorrectionSessionContext>> {
    if (signal?.aborted) return aborted()
    try {
      const context = await options.getSessionContext()
      if (signal?.aborted) return aborted()
      if (context === null) return authRequired()
      if (!validSessionContext(context)) return { ok: false, error: { code: 'unknown', message: '로그인 세션을 확인할 수 없습니다.' } }
      return { ok: true, data: context }
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) return aborted()
      return { ok: false, error: { code: 'unknown', message: '로그인 세션을 확인할 수 없습니다.' } }
    }
  }
  async function currentAccountScope(signal?: AbortSignal): Promise<BenefitCorrectionResult<BenefitCorrectionAccountScope>> {
    const captured = await captureSession(signal)
    if (!captured.ok) return captured
    try { return { ok: true, data: await deriveBenefitCorrectionAccountScope(captured.data.actorId) } }
    catch { return { ok: false, error: { code: 'unknown', message: '로그인 계정을 확인할 수 없습니다.' } } }
  }
  async function execute<T>(name: string, args: Record<string, unknown>, decode: (value: unknown) => T, signal?: AbortSignal, expectedAccountScope?: BenefitCorrectionAccountScope): Promise<BenefitCorrectionResult<T>> {
    const initial = await captureSession(signal)
    if (!initial.ok) return initial
    const initialScope = await deriveBenefitCorrectionAccountScope(initial.data.actorId)
    if (expectedAccountScope !== undefined && initialScope !== expectedAccountScope) return stale('현재 로그인 계정과 초안 계정이 일치하지 않습니다.')

    const preflight = await captureSession(signal)
    if (!preflight.ok) return preflight
    if (!sameSession(initial.data, preflight.data)) return stale('로그인 세션이 변경되어 요청을 중단했습니다.')

    let response: BenefitCorrectionRpcResponse
    try { response = await initial.data.rpc(name, args, signal) }
    catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) return aborted()
      return mapRpcError(error)
    }
    if (signal?.aborted) return aborted()

    const after = await captureSession(signal)
    if (!after.ok) return after
    if (!sameSession(initial.data, after.data)) return stale('로그인 세션이 변경되어 이전 응답을 폐기했습니다.')
    if (response.error) return mapRpcError(response.error)
    try { return { ok: true, data: decode(response.data) } }
    catch { return { ok: false, error: { code: 'invalid_response', message: '서버 응답을 확인할 수 없습니다.' } } }
  }
  return {
    getCurrentAccountScope: currentAccountScope,
    createRequest(input, expectedAccountScope, signal) {
      if (!validCreateInput(input) || !validAccountScope(expectedAccountScope)) return Promise.resolve(invalidArgument())
      return execute('create_benefit_correction_request_v1', {
        p_client_key: input.clientKey, p_company_id: input.companyId, p_category_id: input.categoryId,
        p_current_text: input.currentText, p_proposed_text: input.proposedText, p_scope_text: input.scopeText,
        p_source_url: input.sourceUrl, p_observed_data_version: input.observedDataVersion,
      }, value => decodeBenefitCorrectionItem(value), signal, expectedAccountScope)
    },
    listMyRequests(input, signal) {
      if (!validListInput(input)) return Promise.resolve(invalidArgument())
      return execute('list_my_benefit_correction_requests_v1', {
        p_limit: input.limit, p_cursor_created_at: input.cursor?.createdAt, p_cursor_id: input.cursor?.id,
      }, value => decodePage<BenefitCorrectionItem>(value, false), signal)
    },
    listAdminQueue(input, signal) {
      if (!validListInput(input) || !(BENEFIT_CORRECTION_QUEUE_FILTERS as readonly string[]).includes(input.status)) return Promise.resolve(invalidArgument())
      return execute('list_benefit_correction_queue_v1', {
        p_status: input.status, p_limit: input.limit, p_cursor_created_at: input.cursor?.createdAt, p_cursor_id: input.cursor?.id,
      }, value => decodePage<AdminBenefitCorrectionItem>(value, true), signal)
    },
    reviewRequest(input, signal) {
      if (!validReviewInput(input)) return Promise.resolve(invalidArgument())
      return execute('review_benefit_correction_request_v1', {
        p_request_id: input.requestId, p_expected_status: input.expectedStatus, p_action: input.action,
        p_admin_response: input.adminResponse, p_client_key: input.clientKey,
      }, value => decodeBenefitCorrectionItem(value, true) as AdminBenefitCorrectionItem, signal)
    },
  }
}

let browserRepository: BenefitCorrectionRepository | undefined
export function getBenefitCorrectionRepository(): BenefitCorrectionRepository {
  if (browserRepository) return browserRepository
  const supabase = getSupabaseClient()
  const config = parseEnv(import.meta.env)
  browserRepository = createBenefitCorrectionRepository({
    getSessionContext: createBenefitCorrectionSessionProvider(supabase.auth, config),
  })
  return browserRepository
}
