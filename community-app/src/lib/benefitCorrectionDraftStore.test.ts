import { describe, expect, it, vi } from 'vitest'
import {
  BENEFIT_CORRECTION_DRAFT_KEY,
  clearBenefitCorrectionDraft,
  createBenefitCorrectionDraft,
  deriveBenefitCorrectionClientKey,
  loadBenefitCorrectionDraft,
  rotateBenefitCorrectionSubmissionScope,
  saveBenefitCorrectionDraft,
  submitBenefitCorrectionDraft,
} from './benefitCorrectionDraftStore'

const draftId = '56000000-0000-4000-8000-000000000020'
const scopeId = '56000000-0000-4000-8000-000000000021'
const nextScopeId = '56000000-0000-4000-8000-000000000022'
const requestId = '56000000-0000-4000-8000-000000000010'

function memoryStorage(initial?: string) {
  const values = new Map<string, string>()
  if (initial !== undefined) values.set(BENEFIT_CORRECTION_DRAFT_KEY, initial)
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
    removeItem: vi.fn((key: string) => { values.delete(key) }),
    values,
  }
}

function draft() {
  return {
    ...createBenefitCorrectionDraft(() => draftId, () => scopeId, () => '2026-11-01T00:00:00.000Z'),
    companyId: 'KR-CRN-1234567890123',
    categoryId: 'health' as const,
    currentText: '현재 내용',
    proposedText: '제안 내용',
    scopeText: '대한민국 정규직',
    sourceUrl: 'https://example.com/benefits',
    observedDataVersion: 'company-benefits-2026-11-01-v1',
  }
}

const successItem = {
  id: requestId, companyId: 'KR-CRN-1234567890123', categoryId: 'health' as const,
  currentText: '현재 내용', proposedText: '제안 내용', scopeText: '대한민국 정규직',
  sourceUrl: 'https://example.com/benefits', observedDataVersion: 'company-benefits-2026-11-01-v1',
  status: 'submitted' as const, adminResponse: null, appliedDataVersion: null, appliedAt: null,
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
}

describe('benefit correction resilient draft store', () => {
  it('stores and restores a strict bounded versioned draft without account or server identity', () => {
    const storage = memoryStorage()
    const value = draft()
    expect(saveBenefitCorrectionDraft(value, storage)).toBe(true)
    expect(loadBenefitCorrectionDraft(storage)).toEqual(value)
    const raw = storage.values.get(BENEFIT_CORRECTION_DRAFT_KEY)!
    expect(raw).not.toMatch(/userId|email|token|provider|admin|requestId|reviewer|operator/i)
  })

  it.each([
    ['unknown key', { ...draft(), email: 'person@example.com' }],
    ['oversized current text', { ...draft(), currentText: 'x'.repeat(5001) }],
    ['oversized scope', { ...draft(), scopeText: 'x'.repeat(2001) }],
    ['non-HTTPS URL', { ...draft(), sourceUrl: 'http://example.com' }],
    ['private host', { ...draft(), sourceUrl: 'https://localhost/private' }],
    ['bad company', { ...draft(), companyId: 'company-1' }],
    ['bad version', { ...draft(), observedDataVersion: 'company-benefits-2026-02-30-v1' }],
    ['future timestamp', { ...draft(), updatedAt: '9999-01-01T00:00:00Z' }],
  ])('rejects unsafe or unbounded drafts before storage: %s', (_label, value) => {
    const storage = memoryStorage()
    expect(saveBenefitCorrectionDraft(value as never, storage)).toBe(false)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it.each(['{broken', JSON.stringify({ version: 99 }), JSON.stringify({ ...draft(), token: 'secret' }), 'x'.repeat(20_000)])(
    'fails closed for corrupt, wrong-version, forbidden, or oversized storage', raw => {
      expect(loadBenefitCorrectionDraft(memoryStorage(raw))).toBeNull()
    },
  )

  it('is safe during SSR, blocked storage, and quota failures', () => {
    const unavailable = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('quota') }, removeItem: () => { throw new Error('blocked') } }
    const browserWindow = window
    vi.stubGlobal('window', undefined)
    expect(loadBenefitCorrectionDraft()).toBeNull()
    expect(saveBenefitCorrectionDraft(draft())).toBe(false)
    vi.stubGlobal('window', browserWindow)
    expect(loadBenefitCorrectionDraft(unavailable)).toBeNull()
    expect(saveBenefitCorrectionDraft(draft(), unavailable)).toBe(false)
    expect(() => clearBenefitCorrectionDraft(unavailable)).not.toThrow()
    vi.unstubAllGlobals()
  })

  it('derives a stable UUID idempotency key from canonical content and local identities', async () => {
    const value = draft()
    const first = await deriveBenefitCorrectionClientKey(value)
    const reordered = { ...value, proposedText: value.proposedText }
    expect(await deriveBenefitCorrectionClientKey(reordered)).toBe(first)
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(JSON.stringify(value)).not.toContain(first)
    expect(await deriveBenefitCorrectionClientKey({ ...value, proposedText: '다른 제안' })).not.toBe(first)
  })

  it('rotates only local submission identity on account switching so keys cannot be reused', async () => {
    const value = draft()
    const previousKey = await deriveBenefitCorrectionClientKey(value)
    const switched = rotateBenefitCorrectionSubmissionScope(value, () => nextScopeId, () => '2026-11-01T00:01:00.000Z')
    expect(switched).toEqual({ ...value, submissionScopeId: nextScopeId, updatedAt: '2026-11-01T00:01:00.000Z' })
    expect(await deriveBenefitCorrectionClientKey(switched)).not.toBe(previousKey)
    expect(switched.draftId).toBe(value.draftId)
  })

  it('preserves a draft through retry and clears only the same snapshot after a validated success', async () => {
    const storage = memoryStorage()
    const value = draft()
    saveBenefitCorrectionDraft(value, storage)
    const repository = { createRequest: vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'network', message: 'retry' } })
      .mockResolvedValueOnce({ ok: true, data: successItem }) }

    await expect(submitBenefitCorrectionDraft(value, repository, storage)).resolves.toMatchObject({ ok: false })
    expect(loadBenefitCorrectionDraft(storage)).toEqual(value)
    await expect(submitBenefitCorrectionDraft(value, repository, storage)).resolves.toEqual({ ok: true, data: successItem })
    expect(loadBenefitCorrectionDraft(storage)).toBeNull()
    expect(repository.createRequest.mock.calls[0][0]).toMatchObject({ clientKey: await deriveBenefitCorrectionClientKey(value) })
  })

  it('does not clear newer edits, malformed success objects, aborted calls, or another account scope', async () => {
    const storage = memoryStorage()
    const value = draft()
    saveBenefitCorrectionDraft(value, storage)
    const newer = { ...value, proposedText: '로그인 중 변경됨', updatedAt: '2026-11-01T00:01:00.000Z' }
    const repository = { createRequest: vi.fn(async () => {
      saveBenefitCorrectionDraft(newer, storage)
      return { ok: true as const, data: successItem }
    }) }
    await submitBenefitCorrectionDraft(value, repository, storage)
    expect(loadBenefitCorrectionDraft(storage)).toEqual(newer)

    const malformed = { createRequest: vi.fn().mockResolvedValue({ ok: true, data: { ...successItem, leak: true } }) }
    await submitBenefitCorrectionDraft(newer, malformed as never, storage)
    expect(loadBenefitCorrectionDraft(storage)).toEqual(newer)

    const mismatched = { createRequest: vi.fn().mockResolvedValue({ ok: true, data: { ...successItem, proposedText: '다른 요청' } }) }
    await submitBenefitCorrectionDraft(newer, mismatched, storage)
    expect(loadBenefitCorrectionDraft(storage)).toEqual(newer)

    const switched = rotateBenefitCorrectionSubmissionScope(newer, () => nextScopeId)
    saveBenefitCorrectionDraft(switched, storage)
    const oldAccount = { createRequest: vi.fn().mockResolvedValue({ ok: true, data: successItem }) }
    await submitBenefitCorrectionDraft(newer, oldAccount, storage)
    expect(loadBenefitCorrectionDraft(storage)).toEqual(switched)
  })
})
