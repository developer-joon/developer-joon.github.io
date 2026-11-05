import { describe, expect, it, vi } from 'vitest'
import * as api from './benefitCorrectionDraftStore'
import { createBenefitCorrectionRepository } from '../data/benefitCorrectionRepository'

const draftId = '56000000-0000-4000-8000-000000000020'
const requestId = '56000000-0000-4000-8000-000000000010'
const accountAId = '56000000-0000-4000-8000-0000000000a1'
const accountBId = '56000000-0000-4000-8000-0000000000b2'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
    removeItem: vi.fn((key: string) => { values.delete(key) }),
    values,
  }
}

function repositoryFor(scope: Awaited<ReturnType<typeof api.deriveBenefitCorrectionAccountScope>>, createRequest: ReturnType<typeof vi.fn>) {
  return { getCurrentAccountScope: vi.fn().mockResolvedValue({ ok: true, data: scope }), createRequest } as unknown as Parameters<typeof api.submitBenefitCorrectionDraft>[1] & { createRequest: typeof createRequest }
}

async function fixture() {
  const accountA = await api.deriveBenefitCorrectionAccountScope(accountAId)
  const accountB = await api.deriveBenefitCorrectionAccountScope(accountBId)
  const value = {
    ...api.createBenefitCorrectionDraft(accountA, () => draftId, () => '2026-11-01T00:00:00.000Z'),
    companyId: 'KR-CRN-1234567890123',
    categoryId: 'health' as const,
    currentText: '현재 내용',
    proposedText: '제안 내용',
    scopeText: '대한민국 정규직',
    sourceUrl: 'https://example.com/benefits',
    observedDataVersion: 'company-benefits-2026-11-01-v1',
  }
  return { accountA, accountB, value }
}

const successItem = {
  id: requestId, companyId: 'KR-CRN-1234567890123', categoryId: 'health' as const,
  currentText: '현재 내용', proposedText: '제안 내용', scopeText: '대한민국 정규직',
  sourceUrl: 'https://example.com/benefits', observedDataVersion: 'company-benefits-2026-11-01-v1',
  status: 'submitted' as const, adminResponse: null, appliedDataVersion: null, appliedAt: null,
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
}

describe('account-scoped benefit correction drafts', () => {
  it('derives a deterministic opaque scope from a canonical non-PII auth account id', async () => {
    const first = await api.deriveBenefitCorrectionAccountScope(accountAId)
    expect(await api.deriveBenefitCorrectionAccountScope(accountAId.toUpperCase())).toBe(first)
    expect(await api.deriveBenefitCorrectionAccountScope(accountBId)).not.toBe(first)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(first).not.toContain(accountAId.replaceAll('-', ''))
    await expect(api.deriveBenefitCorrectionAccountScope('person@example.com')).rejects.toThrow('invalid account id')
    await expect(api.deriveBenefitCorrectionAccountScope('access-token')).rejects.toThrow('invalid account id')
  })

  it('uses separate opaque storage keys and content scopes for each account', async () => {
    const { accountA, accountB, value } = await fixture()
    const storage = memoryStorage()
    expect(api.saveBenefitCorrectionDraft(accountA, value, storage)).toBe(true)
    expect(api.loadBenefitCorrectionDraft(accountA, storage)).toEqual(value)
    expect(api.loadBenefitCorrectionDraft(accountB, storage)).toBeNull()
    const accountAKey = api.benefitCorrectionDraftKey(accountA)
    const accountBKey = api.benefitCorrectionDraftKey(accountB)
    expect(accountAKey).not.toBe(accountBKey)
    storage.values.set(accountBKey, storage.values.get(accountAKey)!)
    expect(api.loadBenefitCorrectionDraft(accountB, storage)).toBeNull()
    const persisted = `${[...storage.values.keys()]} ${[...storage.values.values()]}`
    expect(persisted).not.toContain(accountAId)
    expect(persisted).not.toMatch(/email|token|provider|userId/i)
  })

  it('rejects saving or deriving idempotency for a draft owned by another account scope', async () => {
    const { accountA, accountB, value } = await fixture()
    const storage = memoryStorage()
    expect(api.saveBenefitCorrectionDraft(accountB, value, storage)).toBe(false)
    await expect(api.deriveBenefitCorrectionClientKey(accountB, value)).rejects.toThrow('account scope mismatch')
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(await api.deriveBenefitCorrectionClientKey(accountA, value)).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('keeps idempotency stable for one actor and separates it across actor and domain-scoped drafts', async () => {
    const { accountA, accountB, value } = await fixture()
    const first = await api.deriveBenefitCorrectionClientKey(accountA, value)
    expect(await api.deriveBenefitCorrectionClientKey(accountA, value)).toBe(first)
    const accountBValue = { ...value, accountScope: accountB }
    expect(await api.deriveBenefitCorrectionClientKey(accountB, accountBValue)).not.toBe(first)
  })

  it('cannot submit an in-memory draft after the authenticated account switches', async () => {
    const { accountB, value } = await fixture()
    const repository = repositoryFor(accountB, vi.fn().mockResolvedValue({ ok: true, data: successItem }))
    await expect(api.submitBenefitCorrectionDraft(value, repository)).resolves.toMatchObject({ ok: false, error: { code: 'stale_response' } })
    expect(repository.createRequest).not.toHaveBeenCalled()
  })

  it('makes zero RPC calls and retains account A snapshot when account B repository receives account A draft', async () => {
    const { accountA, value } = await fixture()
    const storage = memoryStorage()
    expect(api.saveBenefitCorrectionDraft(accountA, value, storage)).toBe(true)
    const rpc = vi.fn().mockResolvedValue({ data: {
      id: requestId, company_id: successItem.companyId, category_id: successItem.categoryId,
      current_text: successItem.currentText, proposed_text: successItem.proposedText, scope_text: successItem.scopeText,
      source_url: successItem.sourceUrl, observed_data_version: successItem.observedDataVersion, status: successItem.status,
      admin_response: null, applied_data_version: null, applied_at: null,
      created_at: successItem.createdAt, updated_at: successItem.updatedAt,
    }, error: null })
    const repository = createBenefitCorrectionRepository({
      getSessionContext: () => ({ actorId: accountBId, sessionFingerprint: 'session-b', rpc }),
    })

    await expect(api.submitBenefitCorrectionDraft(value, repository, storage))
      .resolves.toMatchObject({ ok: false })
    expect(rpc).not.toHaveBeenCalled()
    expect(api.loadBenefitCorrectionDraft(accountA, storage)).toEqual(value)
  })

  it('rechecks actor scope immediately before RPC and retains the snapshot when the account switches', async () => {
    const { accountA, value } = await fixture()
    const storage = memoryStorage()
    expect(api.saveBenefitCorrectionDraft(accountA, value, storage)).toBe(true)
    let actorReads = 0
    const rpc = vi.fn()
    const repository = createBenefitCorrectionRepository({
      getSessionContext: () => {
        const actorId = ++actorReads < 3 ? accountAId : accountBId
        return { actorId, sessionFingerprint: `session-${actorId}`, rpc }
      },
    })

    await expect(api.submitBenefitCorrectionDraft(value, repository, storage))
      .resolves.toMatchObject({ ok: false, error: { code: 'stale_response' } })
    expect(rpc).not.toHaveBeenCalled()
    expect(api.loadBenefitCorrectionDraft(accountA, storage)).toEqual(value)
  })

  it('enforces PostgreSQL char_length bounds by Unicode code points in drafts and submissions', async () => {
    const { accountA, value } = await fixture()
    const storage = memoryStorage()
    expect(api.saveBenefitCorrectionDraft(accountA, { ...value, currentText: '😀'.repeat(5000), proposedText: '😀'.repeat(5000), scopeText: '😀'.repeat(2000) }, storage)).toBe(true)
    expect(api.saveBenefitCorrectionDraft(accountA, { ...value, currentText: '😀'.repeat(5001) }, storage)).toBe(false)
    expect(api.saveBenefitCorrectionDraft(accountA, { ...value, scopeText: '😀'.repeat(2001) }, storage)).toBe(false)
  })

  it('preserves retry state and clears only the same scoped snapshot after validated success', async () => {
    const { accountA, value } = await fixture()
    const storage = memoryStorage()
    expect(api.saveBenefitCorrectionDraft(accountA, value, storage)).toBe(true)
    const repository = repositoryFor(accountA, vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'network', message: 'retry' } })
      .mockResolvedValueOnce({ ok: true, data: successItem }))

    await expect(api.submitBenefitCorrectionDraft(value, repository, storage)).resolves.toMatchObject({ ok: false })
    expect(api.loadBenefitCorrectionDraft(accountA, storage)).toEqual(value)
    await expect(api.submitBenefitCorrectionDraft(value, repository, storage)).resolves.toEqual({ ok: true, data: successItem })
    expect(api.loadBenefitCorrectionDraft(accountA, storage)).toBeNull()
    expect(repository.createRequest.mock.calls[0][0]).toMatchObject({ clientKey: await api.deriveBenefitCorrectionClientKey(accountA, value) })
  })

  it('does not clear another account or a newer edit after success', async () => {
    const { accountA, accountB, value } = await fixture()
    const storage = memoryStorage()
    const accountBDraft = { ...api.createBenefitCorrectionDraft(accountB, () => '56000000-0000-4000-8000-000000000030', () => '2026-11-01T00:00:00.000Z'), proposedText: '' }
    expect(api.saveBenefitCorrectionDraft(accountA, value, storage)).toBe(true)
    expect(api.saveBenefitCorrectionDraft(accountB, accountBDraft, storage)).toBe(true)
    const newer = { ...value, proposedText: '로그인 중 변경됨', updatedAt: '2026-11-01T00:01:00.000Z' }
    const repository = repositoryFor(accountA, vi.fn(async () => {
      api.saveBenefitCorrectionDraft(accountA, newer, storage)
      return { ok: true as const, data: successItem }
    }))
    await api.submitBenefitCorrectionDraft(value, repository, storage)
    expect(api.loadBenefitCorrectionDraft(accountA, storage)).toEqual(newer)
    expect(api.loadBenefitCorrectionDraft(accountB, storage)).toEqual(accountBDraft)
  })

  it('retains the scoped draft when a nominal success response is malformed or mismatched', async () => {
    const { accountA, value } = await fixture()
    const storage = memoryStorage()
    expect(api.saveBenefitCorrectionDraft(accountA, value, storage)).toBe(true)
    const malformed = repositoryFor(accountA, vi.fn().mockResolvedValue({ ok: true, data: { ...successItem, leak: true } }))
    await expect(api.submitBenefitCorrectionDraft(value, malformed as never, storage)).resolves.toMatchObject({ ok: false, error: { code: 'invalid_response' } })
    expect(api.loadBenefitCorrectionDraft(accountA, storage)).toEqual(value)

    const mismatched = repositoryFor(accountA, vi.fn().mockResolvedValue({ ok: true, data: { ...successItem, proposedText: '다른 요청' } }))
    await expect(api.submitBenefitCorrectionDraft(value, mismatched, storage)).resolves.toMatchObject({ ok: false, error: { code: 'invalid_response' } })
    expect(api.loadBenefitCorrectionDraft(accountA, storage)).toEqual(value)
  })

  it('rejects unknown fields and corrupt scoped storage without writing', async () => {
    const { accountA, value } = await fixture()
    const storage = memoryStorage()
    expect(api.saveBenefitCorrectionDraft(accountA, { ...value, email: 'person@example.com' } as never, storage)).toBe(false)
    expect(storage.setItem).not.toHaveBeenCalled()
    storage.values.set(api.benefitCorrectionDraftKey(accountA), '{broken')
    expect(api.loadBenefitCorrectionDraft(accountA, storage)).toBeNull()
  })

  it('fails safely with unavailable scoped storage', async () => {
    const { accountA, value } = await fixture()
    const unavailable = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('quota') }, removeItem: () => { throw new Error('blocked') } }
    expect(api.loadBenefitCorrectionDraft(accountA, unavailable)).toBeNull()
    expect(api.saveBenefitCorrectionDraft(accountA, value, unavailable)).toBe(false)
    expect(() => api.clearBenefitCorrectionDraft(accountA, unavailable)).not.toThrow()
  })
})
