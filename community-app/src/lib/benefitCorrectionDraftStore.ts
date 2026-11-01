import { decodeBenefitCorrectionItem, isBenefitCorrectionDataVersion, isBenefitCorrectionSourceUrl, isBenefitCorrectionTimestamp, type BenefitCorrectionRepository } from '../data/benefitCorrectionRepository'
import { isStrictUuid } from './uuid'
import { BENEFIT_CATEGORIES, type BenefitCorrectionDraft, type BenefitCorrectionItem, type BenefitCorrectionResult } from '../types/benefitCorrections'

export const BENEFIT_CORRECTION_DRAFT_KEY = 'breadlab:benefit-correction:draft:v1'
const MAX_STORED_LENGTH = 15_000
const draftKeys = ['version', 'draftId', 'submissionScopeId', 'companyId', 'categoryId', 'currentText', 'proposedText', 'scopeText', 'sourceUrl', 'observedDataVersion', 'updatedAt'] as const
const itemKeys = ['id', 'companyId', 'categoryId', 'currentText', 'proposedText', 'scopeText', 'sourceUrl', 'observedDataVersion', 'status', 'adminResponse', 'appliedDataVersion', 'appliedAt', 'createdAt', 'updatedAt'] as const

export type BenefitCorrectionDraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

type DraftRepository = Pick<BenefitCorrectionRepository, 'createRequest'>

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort(); const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}
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
function parseDraft(value: unknown): BenefitCorrectionDraft | null {
  if (!isRecord(value) || !hasExactKeys(value, draftKeys) || value.version !== 1 || !isStrictUuid(value.draftId) || !isStrictUuid(value.submissionScopeId)
    || typeof value.companyId !== 'string' || (value.companyId !== '' && !/^(?:KR-CRN-[0-9]{13}|US-CIK[0-9]{10})$/.test(value.companyId))
    || typeof value.categoryId !== 'string' || (value.categoryId !== '' && !(BENEFIT_CATEGORIES as readonly string[]).includes(value.categoryId))
    || typeof value.currentText !== 'string' || value.currentText.length > 5000
    || typeof value.proposedText !== 'string' || value.proposedText.length > 5000
    || typeof value.scopeText !== 'string' || value.scopeText.length > 2000
    || typeof value.sourceUrl !== 'string' || (value.sourceUrl !== '' && !isBenefitCorrectionSourceUrl(value.sourceUrl))
    || typeof value.observedDataVersion !== 'string' || (value.observedDataVersion !== '' && !isBenefitCorrectionDataVersion(value.observedDataVersion))
    || !draftTimestamp(value.updatedAt)) return null
  return {
    version: 1, draftId: value.draftId.toLowerCase(), submissionScopeId: value.submissionScopeId.toLowerCase(),
    companyId: value.companyId, categoryId: value.categoryId as BenefitCorrectionDraft['categoryId'],
    currentText: value.currentText, proposedText: value.proposedText, scopeText: value.scopeText,
    sourceUrl: value.sourceUrl, observedDataVersion: value.observedDataVersion, updatedAt: value.updatedAt,
  }
}
function serializeDraft(draft: BenefitCorrectionDraft): string | null {
  try {
    const parsed = parseDraft(draft)
    return parsed ? JSON.stringify(parsed) : null
  } catch { return null }
}
function submissionReady(draft: BenefitCorrectionDraft) {
  return draft.companyId !== '' && draft.categoryId !== '' && draft.currentText.length > 0 && draft.currentText.trim() === draft.currentText
    && draft.proposedText.length > 0 && draft.proposedText.trim() === draft.proposedText
    && draft.scopeText.length > 0 && draft.scopeText.trim() === draft.scopeText
    && isBenefitCorrectionSourceUrl(draft.sourceUrl) && isBenefitCorrectionDataVersion(draft.observedDataVersion)
}

export function createBenefitCorrectionDraft(
  uuid: () => string = randomUuid,
  submissionScopeUuid: () => string = randomUuid,
  now: () => string = () => new Date().toISOString(),
): BenefitCorrectionDraft {
  const draft: BenefitCorrectionDraft = {
    version: 1, draftId: uuid(), submissionScopeId: submissionScopeUuid(), companyId: '', categoryId: '',
    currentText: '', proposedText: '', scopeText: '', sourceUrl: '', observedDataVersion: '', updatedAt: now(),
  }
  const parsed = parseDraft(draft)
  if (!parsed) throw new Error('secure draft identity or timestamp is invalid')
  return parsed
}

export function loadBenefitCorrectionDraft(storage: BenefitCorrectionDraftStorage | undefined = defaultStorage()): BenefitCorrectionDraft | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(BENEFIT_CORRECTION_DRAFT_KEY)
    if (raw === null || raw.length > MAX_STORED_LENGTH) return null
    return parseDraft(JSON.parse(raw))
  } catch { return null }
}

export function saveBenefitCorrectionDraft(draft: BenefitCorrectionDraft, storage: BenefitCorrectionDraftStorage | undefined = defaultStorage()): boolean {
  if (!storage) return false
  try {
    const raw = serializeDraft(draft)
    if (raw === null || raw.length > MAX_STORED_LENGTH) return false
    storage.setItem(BENEFIT_CORRECTION_DRAFT_KEY, raw)
    return true
  } catch { return false }
}

export function clearBenefitCorrectionDraft(storage: BenefitCorrectionDraftStorage | undefined = defaultStorage()): void {
  try { storage?.removeItem(BENEFIT_CORRECTION_DRAFT_KEY) } catch { /* unavailable storage is non-fatal */ }
}

export function rotateBenefitCorrectionSubmissionScope(
  draft: BenefitCorrectionDraft,
  uuid: () => string = randomUuid,
  now: () => string = () => new Date().toISOString(),
): BenefitCorrectionDraft {
  const changed = parseDraft({ ...draft, submissionScopeId: uuid(), updatedAt: now() })
  if (!changed) throw new Error('invalid submission scope rotation')
  return changed
}

function canonicalSubmission(draft: BenefitCorrectionDraft) {
  return JSON.stringify({
    draft_id: draft.draftId,
    submission_scope_id: draft.submissionScopeId,
    company_id: draft.companyId,
    category_id: draft.categoryId,
    current_text: draft.currentText,
    proposed_text: draft.proposedText,
    scope_text: draft.scopeText,
    source_url: draft.sourceUrl,
    observed_data_version: draft.observedDataVersion,
  })
}

export async function deriveBenefitCorrectionClientKey(draft: BenefitCorrectionDraft, subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<string> {
  const parsed = parseDraft(draft)
  if (!parsed || !submissionReady(parsed)) throw new Error('draft is not ready for submission')
  const digest = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(canonicalSubmission(parsed))))
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
  const canonical = parseDraft(draft)
  if (!canonical || !submissionReady(canonical)) return { ok: false, error: { code: 'invalid_argument', message: '입력 내용을 확인해 주세요.' } }
  const submittedRaw = serializeDraft(canonical)
  let clientKey: string
  try { clientKey = await deriveBenefitCorrectionClientKey(canonical) }
  catch { return { ok: false, error: { code: 'unknown', message: '안전한 제출 키를 만들 수 없습니다.' } } }
  const result = await repository.createRequest({
    clientKey, companyId: canonical.companyId, categoryId: canonical.categoryId as Exclude<BenefitCorrectionDraft['categoryId'], ''>,
    currentText: canonical.currentText, proposedText: canonical.proposedText, scopeText: canonical.scopeText,
    sourceUrl: canonical.sourceUrl, observedDataVersion: canonical.observedDataVersion,
  }, signal)
  if (!result.ok) return result
  const validated = validateMappedItem(result.data)
  if (!validated
    || validated.companyId !== canonical.companyId || validated.categoryId !== canonical.categoryId
    || validated.currentText !== canonical.currentText || validated.proposedText !== canonical.proposedText
    || validated.scopeText !== canonical.scopeText || validated.sourceUrl !== canonical.sourceUrl
    || validated.observedDataVersion !== canonical.observedDataVersion) {
    return { ok: false, error: { code: 'invalid_response', message: '서버 응답을 확인할 수 없습니다.' } }
  }
  if (storage && submittedRaw !== null) {
    try {
      if (storage.getItem(BENEFIT_CORRECTION_DRAFT_KEY) === submittedRaw) storage.removeItem(BENEFIT_CORRECTION_DRAFT_KEY)
    } catch { /* successful server submission is retained as the return value when storage is unavailable */ }
  }
  return { ok: true, data: validated }
}
