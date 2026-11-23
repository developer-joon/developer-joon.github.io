import { describe, expect, it, vi } from 'vitest'
import {
  createBenefitSubmissionRepository,
  createBenefitSubmissionSessionProvider,
  decodeBenefitSubmissionItem,
  type BenefitSubmissionSessionContext,
} from './benefitSubmissionRepository'
import type { CreateBenefitSubmissionInput } from '../types/benefitSubmissions'

const actor = '11111111-1111-4111-8111-111111111111'
const wire = {
  id: '22222222-2222-4222-8222-222222222222',
  company_id: 'KR-BIZ-1234567890',
  category_id: 'leave',
  benefit_text: '연 5일의 유급 가족 돌봄 휴가',
  eligibility_text: null,
  condition_text: null,
  source_url: null,
  status: 'submitted',
  admin_response: null,
  publication_id: null,
  reviewed_at: null,
  created_at: '2026-11-21T00:00:00Z',
  updated_at: '2026-11-21T00:00:00Z',
}
const input: CreateBenefitSubmissionInput = {
  clientKey: '33333333-3333-4333-8333-333333333333',
  companyId: 'KR-BIZ-1234567890', categoryId: 'leave', benefitText: wire.benefit_text,
  eligibilityText: null, conditionText: null, sourceUrl: null,
}
function context(rpc = vi.fn().mockResolvedValue({ data: wire, error: null, status: 200, statusText: 'OK' })): BenefitSubmissionSessionContext {
  return { actorId: actor, sessionFingerprint: 'session-a', rpc }
}

describe('benefit submission repository', () => {
  it('decodes only the exact owner-safe projection and enforces terminal consistency', () => {
    expect(decodeBenefitSubmissionItem(wire)).toMatchObject({ companyId: wire.company_id, sourceUrl: null, status: 'submitted' })
    expect(() => decodeBenefitSubmissionItem({ ...wire, reviewer_id: actor })).toThrow()
    expect(() => decodeBenefitSubmissionItem({ ...wire, status: 'approved', admin_response: '승인', publication_id: null, reviewed_at: wire.updated_at })).toThrow()
    expect(() => decodeBenefitSubmissionItem({ ...wire, created_at: '2026-02-30T00:00:00Z' })).toThrow()
  })

  it('sends the exact nullable create RPC args and binds completion to one immutable session', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: wire, error: null, status: 200, statusText: 'OK' })
    const getSessionContext = vi.fn().mockResolvedValue(context(rpc))
    const repository = createBenefitSubmissionRepository({ getSessionContext })
    await expect(repository.createSubmission(input)).resolves.toEqual({ ok: true, data: decodeBenefitSubmissionItem(wire) })
    expect(rpc).toHaveBeenCalledWith('create_benefit_submission_v1', {
      p_client_key: input.clientKey, p_company_id: input.companyId, p_category_id: input.categoryId,
      p_benefit_text: input.benefitText, p_eligibility_text: null, p_condition_text: null, p_source_url: null,
    }, undefined)
    expect(getSessionContext).toHaveBeenCalledTimes(3)
  })

  it('normalizes an optional empty source URL to null', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: wire, error: null, status: 200, statusText: 'OK' })
    const repository = createBenefitSubmissionRepository({ getSessionContext: async () => context(rpc) })
    await expect(repository.createSubmission({ ...input, sourceUrl: '' })).resolves.toMatchObject({ ok: true })
    expect(rpc).toHaveBeenCalledWith('create_benefit_submission_v1', expect.objectContaining({ p_source_url: null }), undefined)
  })

  it('accepts and preserves opaque canonical company IDs through create and decode', async () => {
    const companyId = `KR-CAN-${'b'.repeat(32)}`
    const opaqueWire = { ...wire, company_id: companyId }
    const rpc = vi.fn().mockResolvedValue({ data: opaqueWire, error: null, status: 200, statusText: 'OK' })
    const repository = createBenefitSubmissionRepository({ getSessionContext: async () => context(rpc) })
    await expect(repository.createSubmission({ ...input, companyId })).resolves.toMatchObject({ ok: true, data: { companyId } })
    expect(rpc).toHaveBeenCalledWith('create_benefit_submission_v1', expect.objectContaining({ p_company_id: companyId }), undefined)
  })

  it('rejects an A-B-A session switch even when actor returns to A', async () => {
    const contexts = [context(), { ...context(), sessionFingerprint: 'session-b' }, context()]
    const repository = createBenefitSubmissionRepository({ getSessionContext: vi.fn().mockImplementation(async () => contexts.shift() ?? context()) })
    await expect(repository.createSubmission(input)).resolves.toMatchObject({ ok: false, error: { code: 'stale_response' } })
  })

  it('rejects an A-B-A switch observed as a newer session generation', async () => {
    const original = context()
    const repository = createBenefitSubmissionRepository({ getSessionContext: vi.fn()
      .mockResolvedValueOnce(original).mockResolvedValueOnce(original)
      .mockResolvedValueOnce({ ...original, sessionFingerprint: 'session-a-generation-2' }) })
    await expect(repository.createSubmission(input)).resolves.toMatchObject({ ok: false, error: { code: 'stale_response' } })
  })

  it('advances the immutable session fingerprint across A-B-A auth events', async () => {
    let onChange: (() => void) | undefined
    const auth = {
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: actor }, access_token: 'token-a' } } }),
      onAuthStateChange: vi.fn((callback: () => void) => { onChange = callback; return { data: { subscription: { unsubscribe: vi.fn() } } } }),
    }
    const provider = createBenefitSubmissionSessionProvider(auth, { supabaseUrl: 'https://example.supabase.co', supabasePublishableKey: 'sb_publishable_test' }, vi.fn() as never)
    const before = await provider(); onChange?.(); onChange?.(); const after = await provider()
    expect(before?.sessionFingerprint).not.toBe(after?.sessionFingerprint)
  })

  it('validates strict source URLs, canonical IDs, bounds and idempotency UUIDs before RPC', async () => {
    const rpc = vi.fn()
    const repository = createBenefitSubmissionRepository({ getSessionContext: async () => context(rpc) })
    for (const invalid of [
      { ...input, sourceUrl: 'http://example.com' },
      { ...input, sourceUrl: 'https://user@example.com' },
      { ...input, sourceUrl: 'https://127.0.0.1/x' },
      { ...input, companyId: 'KR-BIZ-123' },
      { ...input, clientKey: 'not-a-uuid' },
      { ...input, benefitText: ' '.repeat(2) },
    ]) await expect(repository.createSubmission(invalid as CreateBenefitSubmissionInput)).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('decodes bounded dense duplicate-free list pages and exact cursors', async () => {
    const second = { ...wire, id: '44444444-4444-4444-8444-444444444444', created_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-20T00:00:00Z' }
    const rpc = vi.fn().mockResolvedValue({ data: { items: [wire, second], has_more: true, next_cursor: { created_at: second.created_at, id: second.id } }, error: null, status: 200, statusText: 'OK' })
    const repository = createBenefitSubmissionRepository({ getSessionContext: async () => context(rpc) })
    await expect(repository.listMySubmissions({ limit: 2 })).resolves.toMatchObject({ ok: true, data: { hasMore: true, items: [{ id: wire.id }, { id: second.id }] } })
    rpc.mockResolvedValueOnce({ data: { items: [wire, wire], has_more: false, next_cursor: null }, error: null, status: 200, statusText: 'OK' })
    await expect(repository.listMySubmissions({ limit: 2 })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it('rejects owner pages that replay or cross the request boundary or claim a short next page', async () => {
    const boundary=JSON.stringify({created_at:'2026-11-21T00:00:00Z',id:'55555555-5555-4555-8555-555555555555'})
    const above={...wire,id:'66666666-6666-4666-8666-666666666666'}
    const rpc=vi.fn().mockResolvedValue({data:{items:[above],has_more:false,next_cursor:null},error:null,status:200,statusText:'OK'})
    const repository=createBenefitSubmissionRepository({getSessionContext:async()=>context(rpc)})
    await expect(repository.listMySubmissions({limit:2,cursor:boundary as never})).resolves.toMatchObject({ok:false,error:{code:'invalid_response'}})
    rpc.mockResolvedValueOnce({data:{items:[{...wire,created_at:'2026-11-20T00:00:00Z',updated_at:'2026-11-20T00:00:00Z'}],has_more:true,next_cursor:{created_at:'2026-11-20T00:00:00Z',id:wire.id}},error:null,status:200,statusText:'OK'})
    await expect(repository.listMySubmissions({limit:2,cursor:boundary as never})).resolves.toMatchObject({ok:false,error:{code:'invalid_response'}})
  })

  it('forwards a valid opaque cursor literal without normalizing its timestamp or UUID',async()=>{
    const literal='{"created_at":"2026-11-21T09:00:00+09:00","id":"55555555-5555-4555-8555-AAAAAAAAAAAA"}'
    const rpc=vi.fn().mockResolvedValue({data:{items:[],has_more:false,next_cursor:null},error:null,status:200,statusText:'OK'}),repository=createBenefitSubmissionRepository({getSessionContext:async()=>context(rpc)})
    await expect(repository.listMySubmissions({limit:2,cursor:literal})).resolves.toMatchObject({ok:true})
    expect(rpc).toHaveBeenCalledWith('list_my_benefit_submissions_v1',{p_limit:2,p_cursor_created_at:'2026-11-21T09:00:00+09:00',p_cursor_id:'55555555-5555-4555-8555-AAAAAAAAAAAA'},undefined)
  })

  it.each(['{}',`{"created_at":"2026-11-21T00:00:00Z","id":"bad"}`,`{"id":"55555555-5555-4555-8555-555555555555","created_at":"2026-11-21T00:00:00Z","extra":1}`])('rejects malformed opaque owner cursor %s',async cursor=>{
    const rpc=vi.fn(),repository=createBenefitSubmissionRepository({getSessionContext:async()=>context(rpc)})
    await expect(repository.listMySubmissions({limit:2,cursor:cursor as never})).resolves.toMatchObject({ok:false,error:{code:'invalid_argument'}})
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    [401, { code: 'PGRST303', message: 'jwt expired', details: null, hint: null }, 'auth_required'],
    [429, { code: 'PGRST429', message: 'limit', details: null, hint: null }, 'rate_limited'],
    [400, { code: '22023', message: 'client key reused with different payload', details: null, hint: null }, 'idempotency_mismatch'],
    [409, { code: '40001', message: 'conflict', details: null, hint: null }, 'conflict'],
  ])('maps transport errors without exposing server detail', async (status, error, code) => {
    const repository = createBenefitSubmissionRepository({ getSessionContext: async () => context(vi.fn().mockResolvedValue({ data: null, error, status, statusText: 'Error' })) })
    const result = await repository.createSubmission(input)
    expect(result).toMatchObject({ ok: false, error: { code } })
    if (!result.ok) expect(result.error.message).not.toContain(error.message)
  })

  it.each([
    { data: wire, error: null, status: 200, statusText: 'OK', extra: 'private' },
    { data: null, error: { code: 'XX000', message: 'private', details: null, hint: null, reviewer_id: actor }, status: 500, statusText: 'Error' },
    { data: null, error: { code: 'XX000', message: 'private', details: { nested: true }, hint: null }, status: 500, statusText: 'Error' },
  ])('rejects outer and nested transport leak keys', async envelope => {
    const repository = createBenefitSubmissionRepository({ getSessionContext: async () => context(vi.fn().mockResolvedValue(envelope)) })
    const result = await repository.createSubmission(input)
    expect(result).toEqual({ ok: false, error: { code: 'invalid_response', message: '서버 응답을 확인할 수 없습니다.' } })
    expect(JSON.stringify(result)).not.toContain('private')
  })
})
