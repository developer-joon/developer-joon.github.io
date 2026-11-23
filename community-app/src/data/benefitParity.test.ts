import { describe, expect, it, vi } from 'vitest'
import { createBenefitClaimRepository } from './benefitClaimRepository'
import { createBenefitCompanyRequestRepository } from './benefitCompanyRequestRepository'

const actorId = 'a1000000-0000-4000-8000-000000000001'
const clientKey = 'c1000000-0000-4000-8000-000000000001'
const claim = { clientKey, companyId: 'KR-BIZ-1234567890', categoryId: 'health' as const, title: '검진', description: '설명', eligibilityText: null, conditionText: null, observedOn: '2020-02-29', sourceUrl: null as string | null }
const nts = { clientKey, businessName: '테스트 기업', businessNumber: '1234567890', openingDate: '20200101', representativeName: '홍길동', region: null, industry: null, website: null }
const urlFixtures = [
  ['https://example.com/path?view=public', true], ['https://example.com/?sig=x', false],
  ['https://example.com/?q=%00', false], ['https://example.com/?q=%GG', false],
  ['https://example.com/?q=x;auth=y', false], ['https://example.com/?a%75th=x', false],
  ['https://user@example.com/', false], ['https://127.0.0.1/', false], ['https://example.com/#x', false],
] as const

describe('Task8 shared input parity fixtures', () => {
  it.each(urlFixtures)('claim source %s accepted=%s', async (sourceUrl, valid) => {
    const rpc = vi.fn(async () => ({ data: { claim_id: actorId, outcome: 'created' }, error: null, status: 200, statusText: 'OK' }))
    const repo = createBenefitClaimRepository({ getSessionContext: async () => ({ actorId, sessionFingerprint: 'x', rpc }) })
    const result = await repo.createClaim({ ...claim, sourceUrl })
    expect(result.ok).toBe(valid)
    expect(rpc).toHaveBeenCalledTimes(valid ? 1 : 0)
  })
  it('manual websites follow the SQL authority rules', async () => {
    const rpc = vi.fn()
    const repo = createBenefitCompanyRequestRepository({ getSessionContext: async () => ({ actorId, sessionFingerprint: 'x', rpc, invokeFunction: vi.fn() }) })
    await expect(repo.createManual({ clientKey, proposedName: '기업', region: null, industry: null, website: 'https://123example.com' })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each(['두  칸', '제어\u007f문자', '제어\u0001문자'])('NTS rejects invalid text without transport', async businessName => {
    const invokeFunction = vi.fn()
    const repo = createBenefitCompanyRequestRepository({ getSessionContext: async () => ({ actorId, sessionFingerprint: 'x', rpc: vi.fn(), invokeFunction }) })
    await expect(repo.verifyWithNts({ ...nts, businessName })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(invokeFunction).not.toHaveBeenCalled()
  })
})
