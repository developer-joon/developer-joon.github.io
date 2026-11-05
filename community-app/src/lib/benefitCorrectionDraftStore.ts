import { decodeBenefitCorrectionItem, deriveBenefitCorrectionAccountScope, isBenefitCorrectionDataVersion, isBenefitCorrectionSourceUrl, isBenefitCorrectionTimestamp, type BenefitCorrectionRepository } from '../data/benefitCorrectionRepository'
import { isStrictUuid } from './uuid'
import { BENEFIT_CATEGORIES, type BenefitCorrectionAccountScope, type BenefitCorrectionDraft, type BenefitCorrectionItem, type BenefitCorrectionResult } from '../types/benefitCorrections'

const BENEFIT_CORRECTION_DRAFT_PREFIX = 'breadlab:benefit-correction:draft:v2'
const ACCOUNT_SCOPE_PATTERN = /^[0-9a-f]{64}$/
const MAX_STORED_LENGTH = 40_000
const draftKeys = ['version', 'accountScope', 'draftId', 'companyId', 'categoryId', 'currentText', 'proposedText', 'scopeText', 'sourceUrl', 'observedDataVersion', 'updatedAt'] as const
const itemKeys = ['id', 'companyId', 'categoryId', 'currentText', 'proposedText', 'scopeText', 'sourceUrl', 'observedDataVersion', 'status', 'adminResponse', 'appliedDataVersion', 'appliedAt', 'createdAt', 'updatedAt'] as const

export type BenefitCorrectionDraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type DraftRepository = Pick<BenefitCorrectionRepository, 'createRequest' | 'getCurrentAccountScope'>

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort(); const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}
function codePointLength(value: string) { return Array.from(value).length }
function boundedDraftText(value: unknown, max: number): value is string { return typeof value === 'string' && codePointLength(value) <= max }
function isAccountScope(value: unknown): value is BenefitCorrectionAccountScope { return typeof value === 'string' && ACCOUNT_SCOPE_PATTERN.test(value) }
function randomUuid(): string {
  const cryptoObject = globalThis.crypto
  if (typeof cryptoObject?.randomUUID === 'function') return cryptoObject.randomUUID()
  if (!cryptoObject?.getRandomValues) throw new Error('secure randomness unavailable')
  const bytes = cryptoObject.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
function defaultStorage(): BenefitCorrectionDraftStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage } catch { return undefined }
}
function draftTimestamp(value: unknown): value is string {
  return isBenefitCorrectionTimestamp(value) && Date.parse(value) <= Date.now() + 5 * 60 * 1000
}

export { deriveBenefitCorrectionAccountScope }

export function benefitCorrectionDraftKey(scope: BenefitCorrectionAccountScope): string {
  if (!isAccountScope(scope)) throw new Error('invalid account scope')
  return `${BENEFIT_CORRECTION_DRAFT_PREFIX}:${scope}`
}

function parseDraft(scope: BenefitCorrectionAccountScope, value: unknown): BenefitCorrectionDraft | null {
  if (!isAccountScope(scope) || !isRecord(value) || !hasExactKeys(value, draftKeys) || value.version !== 2 || value.accountScope !== scope || !isStrictUuid(value.draftId)
    || typeof value.companyId !== 'string' || (value.companyId !== '' && !/^(?:KR-CRN-[0-9]{13}|US-CIK[0-9]{10})$/.test(value.companyId))
    || typeof value.categoryId !== 'string' || (value.categoryId !== '' && !(BENEFIT_CATEGORIES as readonly string[]).includes(value.categoryId))
    || !boundedDraftText(value.currentText, 5000) || !boundedDraftText(value.proposedText, 5000) || !boundedDraftText(value.scopeText, 2000)
    || typeof value.sourceUrl !== 'string' || (value.sourceUrl !== '' && !isBenefitCorrectionSourceUrl(value.sourceUrl))
    || typeof value.observedDataVersion !== 'string' || (value.observedDataVersion !== '' && !isBenefitCorrectionDataVersion(value.observedDataVersion))
    || !draftTimestamp(value.updatedAt)) return null
  return {
    version: 2, accountScope: scope, draftId: value.draftId.toLowerCase(), companyId: value.companyId,
    categoryId: value.categoryId as BenefitCorrectionDraft['categoryId'], currentText: value.currentText,
    proposedText: value.proposedText, scopeText: value.scopeText, sourceUrl: value.sourceUrl,
    observedDataVersion: value.observedDataVersion, updatedAt: value.updatedAt,
  }
}
function serializeDraft(scope: BenefitCorrectionAccountScope, draft: BenefitCorrectionDraft): string | null {
  try { const parsed = parseDraft(scope, draft); return parsed ? JSON.stringify(parsed) : null } catch { return null }
}
function submissionReady(draft: BenefitCorrectionDraft) {
  return draft.companyId !== '' && draft.categoryId !== '' && codePointLength(draft.currentText) > 0 && draft.currentText.trim() === draft.currentText
    && codePointLength(draft.proposedText) > 0 && draft.proposedText.trim() === draft.proposedText
    && codePointLength(draft.scopeText) > 0 && draft.scopeText.trim() === draft.scopeText
    && isBenefitCorrectionSourceUrl(draft.sourceUrl) && isBenefitCorrectionDataVersion(draft.observedDataVersion)
}

export function createBenefitCorrectionDraft(
  scope: BenefitCorrectionAccountScope,
  uuid: () => string = randomUuid,
  now: () => string = () => new Date().toISOString(),
): BenefitCorrectionDraft {
  const draft = {
    version: 2 as const, accountScope: scope, draftId: uuid(), companyId: '', categoryId: '' as const,
    currentText: '', proposedText: '', scopeText: '', sourceUrl: '', observedDataVersion: '', updatedAt: now(),
  }
  const parsed = parseDraft(scope, draft)
  if (!parsed) throw new Error('account scope, secure draft identity, or timestamp is invalid')
  return parsed
}

export function loadBenefitCorrectionDraft(scope: BenefitCorrectionAccountScope, storage: BenefitCorrectionDraftStorage | undefined = defaultStorage()): BenefitCorrectionDraft | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(benefitCorrectionDraftKey(scope))
    if (raw === null || raw.length > MAX_STORED_LENGTH) return null
    return parseDraft(scope, JSON.parse(raw))
  } catch { return null }
}

export function saveBenefitCorrectionDraft(scope: BenefitCorrectionAccountScope, draft: BenefitCorrectionDraft, storage: BenefitCorrectionDraftStorage | undefined = defaultStorage()): boolean {
  if (!storage) return false
  try {
    const raw = serializeDraft(scope, draft)
    if (raw === null || raw.length > MAX_STORED_LENGTH) return false
    storage.setItem(benefitCorrectionDraftKey(scope), raw)
    return true
  } catch { return false }
}

export function clearBenefitCorrectionDraft(scope: BenefitCorrectionAccountScope, storage: BenefitCorrectionDraftStorage | undefined = defaultStorage()): void {
  try { storage?.removeItem(benefitCorrectionDraftKey(scope)) } catch { /* unavailable storage is non-fatal */ }
}

function canonicalSubmission(scope: BenefitCorrectionAccountScope, draft: BenefitCorrectionDraft) {
  return JSON.stringify({
    account_scope: scope,
    draft_id: draft.draftId,
    company_id: draft.companyId,
    category_id: draft.categoryId,
    current_text: draft.currentText,
    proposed_text: draft.proposedText,
    scope_text: draft.scopeText,
    source_url: draft.sourceUrl,
    observed_data_version: draft.observedDataVersion,
  })
}

export async function deriveBenefitCorrectionClientKey(
  scope: BenefitCorrectionAccountScope,
  draft: BenefitCorrectionDraft,
  subtle: SubtleCrypto = globalThis.crypto.subtle,
): Promise<string> {
  if (draft.accountScope !== scope) throw new Error('account scope mismatch')
  const parsed = parseDraft(scope, draft)
  if (!parsed || !submissionReady(parsed)) throw new Error('draft is not ready for submission')
  const digest = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(canonicalSubmission(scope, parsed))))
  const bytes = digest.slice(0, 16); bytes[6] = (bytes[6] & 0x0f) | 0x50; bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function validateMappedItem(value: unknown): BenefitCorrectionItem | null {
  if (!isRecord(value) || !hasExactKeys(value, itemKeys)) return null
  try {
    return decodeBenefitCorrectionItem({
      id: value.id, company_id: value.companyId, category_id: value.categoryId,
      current_text: value.currentText, proposed_text: value.proposedText, scope_text: value.scopeText,
      source_url: value.sourceUrl, observed_data_version: value.observedDataVersion, status: value.status,
      admin_response: value.adminResponse, applied_data_version: value.appliedDataVersion, applied_at: value.appliedAt,
      created_at: value.createdAt, updated_at: value.updatedAt,
    }) as BenefitCorrectionItem
  } catch { return null }
}

export async function submitBenefitCorrectionDraft(
  draft: BenefitCorrectionDraft,
  repository: DraftRepository,
  storage: BenefitCorrectionDraftStorage | undefined = defaultStorage(),
  signal?: AbortSignal,
): Promise<BenefitCorrectionResult<BenefitCorrectionItem>> {
  const aborted = (): BenefitCorrectionResult<BenefitCorrectionItem> => ({ ok: false, error: { code: 'aborted', message: '요청이 취소되었습니다.' } })
  if (signal?.aborted) return aborted()
  const currentScope = await repository.getCurrentAccountScope(signal)
  if (signal?.aborted) return aborted()
  if (!currentScope.ok) return currentScope
  const scope = currentScope.data
  if (scope !== draft.accountScope) return { ok: false, error: { code: 'stale_response', message: '현재 로그인 계정과 초안 계정이 일치하지 않습니다.' } }
  const canonical = parseDraft(scope, draft)
  if (!canonical || !submissionReady(canonical)) return { ok: false, error: { code: 'invalid_argument', message: '입력 내용을 확인해 주세요.' } }
  const submittedRaw = serializeDraft(scope, canonical)
  let clientKey: string
  try { clientKey = await deriveBenefitCorrectionClientKey(scope, canonical) }
  catch { return { ok: false, error: { code: 'unknown', message: '안전한 제출 키를 만들 수 없습니다.' } } }
  if (signal?.aborted) return aborted()
  const result = await repository.createRequest({
    clientKey, companyId: canonical.companyId, categoryId: canonical.categoryId as Exclude<BenefitCorrectionDraft['categoryId'], ''>,
    currentText: canonical.currentText, proposedText: canonical.proposedText, scopeText: canonical.scopeText,
    sourceUrl: canonical.sourceUrl, observedDataVersion: canonical.observedDataVersion,
  }, scope, signal)
  if (signal?.aborted) return aborted()
  if (!result.ok) return result
  const validated = validateMappedItem(result.data)
  if (!validated
    || validated.companyId !== canonical.companyId || validated.categoryId !== canonical.categoryId
    || validated.currentText !== canonical.currentText || validated.proposedText !== canonical.proposedText
    || validated.scopeText !== canonical.scopeText || validated.sourceUrl !== canonical.sourceUrl
    || validated.observedDataVersion !== canonical.observedDataVersion) {
    return { ok: false, error: { code: 'invalid_response', message: '서버 응답을 확인할 수 없습니다.' } }
  }
  if (signal?.aborted) return aborted()
  if (storage && submittedRaw !== null) {
    try {
      const key = benefitCorrectionDraftKey(scope)
      if (storage.getItem(key) === submittedRaw) storage.removeItem(key)
    } catch { /* successful server submission is retained as the return value when storage is unavailable */ }
  }
  return { ok: true, data: validated }
}
