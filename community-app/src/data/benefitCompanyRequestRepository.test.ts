import { describe, expect, it, vi } from 'vitest'
import { createBenefitCompanyRequestRepository, type BenefitCompanyRequestSessionContext } from './benefitCompanyRequestRepository'

const actor = 'a1000000-0000-4000-8000-000000000001'
const requestId = 'b1000000-0000-4000-8000-000000000001'
const clientKey = 'c1000000-0000-4000-8000-000000000001'
const created = '2026-11-23T01:00:00.000000+00:00'
const item = { request_id: requestId, proposed_name: '테스트 기업', region: '서울', industry: '소프트웨어', website: 'https://example.com', verification_status: 'pending', status: 'pending_review', revision: 1, resolved_company_id: null, created_at: created, updated_at: created }
const ok = (data: unknown) => ({ data, error: null, status: 200, statusText: 'OK' })
function ctx(fingerprint = 'one', rpc: BenefitCompanyRequestSessionContext['rpc'] = vi.fn(async () => ok(item)), invoke: BenefitCompanyRequestSessionContext['invokeFunction'] = vi.fn(async () => new Response(JSON.stringify({ requestId, status: 'approved', verificationStatus: 'matched', message: '사업자 확인이 완료되었습니다.' }), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } }))): BenefitCompanyRequestSessionContext { return { actorId: actor, sessionFingerprint: fingerprint, rpc, invokeFunction: invoke } }
const manual = { clientKey, proposedName: '테스트 기업', region: '서울', industry: '소프트웨어', website: 'https://example.com' }

describe('benefit company request repository', () => {
  it('captures before validation and calls manual RPC with explicit nullable fields', async () => {
    const rpc = vi.fn(async () => ok(item)); const provider = vi.fn(async () => ctx('one', rpc)); const repo = createBenefitCompanyRequestRepository({ getSessionContext: provider })
    expect(await repo.createManual(manual)).toMatchObject({ ok: true, data: { requestId, status: 'pending_review' } })
    expect(rpc).toHaveBeenCalledWith('create_manual_benefit_company_request_v1', { p_client_key: clientKey, p_proposed_name: '테스트 기업', p_region: '서울', p_industry: '소프트웨어', p_website: 'https://example.com' }, undefined)
    expect(await repo.createManual({ ...manual, proposedName: '' })).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(provider).toHaveBeenCalledTimes(4)
  })

  it('captures the trusted session before reading request fields', async () => {
    const order: string[] = []
    const input = new Proxy({ ...manual, proposedName: '' }, {
      ownKeys(target) { order.push('input'); return Reflect.ownKeys(target) },
    })
    const provider = async () => { order.push('session'); return ctx('one', vi.fn()) }
    await createBenefitCompanyRequestRepository({ getSessionContext: provider }).createManual(input)
    expect(order[0]).toBe('session')
  })

  it('rejects a session change during RPC decoding', async () => {
    let fingerprint = 'one'
    const response = { ...item, get proposed_name() { fingerprint = 'two'; return '테스트 기업' } }
    const rpc = vi.fn(async () => ok(response))
    const repo = createBenefitCompanyRequestRepository({ getSessionContext: async () => ctx(fingerprint, rpc) })
    await expect(repo.createManual(manual)).resolves.toMatchObject({ ok: false, error: { code: 'stale_session' } })
  })

  it('safely rejects throwing input getters', async () => {
    const repo = createBenefitCompanyRequestRepository({ getSessionContext: async () => ctx() })
    const input = new Proxy(manual, { ownKeys() { throw Error('secret') } })
    await expect(repo.createManual(input)).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    const nts = new Proxy({} as Parameters<typeof repo.verifyWithNts>[0], { ownKeys() { throw Error('secret') } })
    await expect(repo.verifyWithNts(nts)).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
  })

  it.each(['createManual','listMine','listQueue','review','verifyWithNts'] as const)('%s captures before reading a throwing input', async method => {
    const order: string[] = []
    const repo = createBenefitCompanyRequestRepository({ getSessionContext: async () => { order.push('session'); return ctx() } })
    const input = new Proxy({}, { ownKeys() { order.push('input'); throw Error('secret') }, get() { order.push('input'); throw Error('secret') } })
    const call = repo[method] as (value: never) => Promise<unknown>
    await expect(call(input as never)).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(order).toEqual(['session', 'input'])
  })

  it('honors abort when session capture rejects', async () => {
    const controller = new AbortController()
    const repo = createBenefitCompanyRequestRepository({ getSessionContext: async () => { controller.abort(); throw new TypeError('secret') } })
    await expect(repo.createManual(manual, controller.signal)).resolves.toMatchObject({ ok: false, error: { code: 'aborted' } })
  })

  it('lists owner requests with exact bounded page contract', async () => {
    const rpc = vi.fn(async () => ok({ items: [item], has_more: false, next_cursor: null })); const repo = createBenefitCompanyRequestRepository({ getSessionContext: async () => ctx('one', rpc) })
    expect(await repo.listMine({ limit: 20 })).toMatchObject({ ok: true, data: { items: [{ requestId }], hasMore: false } })
    expect(rpc).toHaveBeenCalledWith('list_my_benefit_company_requests_v1', { p_limit: 20, p_cursor_created_at: null, p_cursor_id: null }, undefined)
  })

  it('rejects out-of-order pages and mismatched next cursors', async () => {
    const newer = { ...item, request_id: 'b1000000-0000-4000-8000-000000000002', created_at: '2026-11-23T02:00:00Z', updated_at: '2026-11-23T02:00:00Z' }
    for (const result of [{ items: [item, newer], has_more: false, next_cursor: null }, { items: [newer], has_more: true, next_cursor: { created_at: created, request_id: requestId } }]) {
      const repo = createBenefitCompanyRequestRepository({ getSessionContext: async () => ctx('one', vi.fn(async () => ok(result))) })
      await expect(repo.listMine({ limit: result.has_more ? 1 : 2 })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_response' } })
    }
  })

  it.each(['requester_id','reviewer_id','business_number_digest','payload_fingerprint','client_key','email','provider_id','provenance'])('rejects prohibited request leak key %s', async key => {
    const rpc = vi.fn(async () => ok({ items: [{ ...item, [key]: 'secret' }], has_more: false, next_cursor: null }))
    const result = await createBenefitCompanyRequestRepository({ getSessionContext: async () => ctx('one', rpc) }).listMine({ limit: 20 })
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it('rejects queue items outside the requested status', async () => {
    const repo = createBenefitCompanyRequestRepository({getSessionContext:async()=>ctx('one',vi.fn(async()=>ok({items:[{...item,verification_method:'manual'}],has_more:false,next_cursor:null})))})
    await expect(repo.listQueue({status:'approved',limit:10})).resolves.toMatchObject({ok:false,error:{code:'invalid_response'}})
  })

  it('supports admin queue and review with exact RPC names', async () => {
    const admin = { ...item, verification_method: 'manual' }
    const rpc = vi.fn(async name => ok(name === 'list_benefit_company_request_queue_v1' ? { items: [admin], has_more: false, next_cursor: null } : { ...admin, status: 'approved', verification_status: 'matched', revision: 2, resolved_company_id: 'KR-CAN-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', updated_at: '2026-11-23T02:00:00Z' }))
    const repo = createBenefitCompanyRequestRepository({ getSessionContext: async () => ctx('one', rpc) })
    expect((await repo.listQueue({ status: 'pending_review', limit: 20 })).ok).toBe(true)
    expect((await repo.review({ requestId, expectedStatus: 'pending_review', expectedRevision: 1, action: 'approve', reason: '확인 완료', destinationCompanyId: null })).ok).toBe(true)
  })

  it('rejects a review result for a different action or destination', async () => {
    const admin = { ...item, verification_method: 'manual', status: 'merged', verification_status: 'matched', revision: 2, resolved_company_id: 'KR-CAN-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
    const repo = createBenefitCompanyRequestRepository({ getSessionContext: async () => ctx('one', vi.fn(async () => ok(admin))) })
    await expect(repo.review({ requestId, expectedStatus: 'pending_review', expectedRevision: 1, action: 'reject', reason: '확인', destinationCompanyId: null })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it('validates sensitive NTS input in memory and invokes only the Edge Function', async () => {
    const rpc = vi.fn(); const invoke = vi.fn(async (_name, body) => {
      expect(body).toEqual({ idempotencyKey: clientKey, body: { businessName: '테스트 기업', businessNumber: '123-45-67890', openingDate: '20260131', representativeName: '홍길동', region: null, industry: null, website: null }, signal: undefined })
      return new Response(JSON.stringify({ requestId, status: 'approved', verificationStatus: 'matched', message: '사업자 확인이 완료되었습니다.' }), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } })
    })
    const repo = createBenefitCompanyRequestRepository({ getSessionContext: async () => ctx('one', rpc, invoke) })
    expect(await repo.verifyWithNts({ clientKey, businessName: '테스트 기업', businessNumber: '123-45-67890', openingDate: '20260131', representativeName: '홍길동', region: null, industry: null, website: null })).toMatchObject({ ok: true, data: { requestId, status: 'approved' } })
    expect(invoke).toHaveBeenCalledTimes(1); expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['bad content type', new Response('{}', { status: 200, headers: { 'content-type': 'text/plain' } })],
    ['malformed body', new Response('{', { status: 200, headers: { 'content-type': 'application/json' } })],
    ['oversize body', new Response(JSON.stringify({ message: 'x'.repeat(70_000) }), { status: 200, headers: { 'content-type': 'application/json' } })],
  ])('fails closed for Edge response: %s', async (_name, response) => {
    const repo = createBenefitCompanyRequestRepository({ getSessionContext: async () => ctx('one', vi.fn(), vi.fn(async () => response)) })
    const result = await repo.verifyWithNts({ clientKey, businessName: '테스트 기업', businessNumber: '1234567890', openingDate: '20260131', representativeName: '홍길동', region: null, industry: null, website: null })
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it('recognizes a terminal rejected replay and both indeterminate responses', async () => {
    const inputs = [
      [200, { requestId, status: 'rejected', verificationStatus: 'mismatched', message: '사업자 확인이 완료되지 않았습니다.' }, 'verification_rejected'],
      [202, { code: 'verification_indeterminate', requestId, message: '처리 결과를 확인할 수 없습니다. 같은 멱등성 키로 다시 시도해 주세요.' }, 'verification_indeterminate'],
      [503, { code: 'reservation_indeterminate', message: '예약 결과를 확인할 수 없습니다. 같은 멱등성 키로 다시 시도해 주세요.' }, 'verification_indeterminate'],
    ] as const
    for (const [status, body, code] of inputs) {
      const invoke = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
      const repo = createBenefitCompanyRequestRepository({ getSessionContext: async () => ctx('one', vi.fn(), invoke) })
      await expect(repo.verifyWithNts({ clientKey, businessName: '테스트 기업', businessNumber: '1234567890', openingDate: '20260131', representativeName: '홍길동', region: null, industry: null, website: null })).resolves.toMatchObject({ ok: false, error: { code } })
    }
  })

  it.each([
    [400, 'invalid_request', '요청 형식이 올바르지 않습니다.', 'invalid_argument'],
    [401, 'authentication_required', '로그인이 필요합니다.', 'auth_required'],
    [403, 'google_identity_required', 'Google 로그인 사용자만 요청할 수 있습니다.', 'forbidden'],
    [409, 'request_conflict', '요청 상태가 변경되었습니다. 새 요청으로 다시 시도해 주세요.', 'conflict'],
    [413, 'body_too_large', '요청 본문이 너무 큽니다.', 'invalid_argument'],
    [415, 'unsupported_media_type', 'JSON 요청만 허용됩니다.', 'invalid_argument'],
    [422, 'verification_rejected', '사업자 확인이 완료되지 않았습니다.', 'verification_rejected'],
    [429, 'rate_limited', '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.', 'rate_limited'],
    [500, 'internal_error', '요청을 처리할 수 없습니다.', 'unavailable'],
    [502, 'verification_unavailable', '사업자 확인 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.', 'unavailable'],
    [503, 'service_unavailable', '사업자 확인 서비스가 준비되지 않았습니다.', 'unavailable'],
  ] as const)('decodes only the documented Edge error %s %s', async (status, code, message, expected) => {
    for (const extra of [false, true]) {
      const body = { code, message, ...(extra ? { secret: 'never expose' } : {}) }
      const invoke = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
      const repo = createBenefitCompanyRequestRepository({ getSessionContext: async () => ctx('one', vi.fn(), invoke) })
      const result = await repo.verifyWithNts({ clientKey, businessName:'기업', businessNumber:'1234567890', openingDate:'20200101', representativeName:'홍길동', region:null, industry:null, website:null })
      expect(result).toMatchObject({ok:false,error:{code:extra?'invalid_response':expected}})
      expect(JSON.stringify(result)).not.toContain('never expose')
    }
  })

  it('maps documented Edge statuses/codes and never exposes raw body or sensitive input', async () => {
    const raw = 'provider secret 1234567890 홍길동'
    const response = new Response(JSON.stringify({ code: 'verification_unavailable', message: raw }), { status: 502, headers: { 'content-type': 'application/json; charset=utf-8' } })
    const repo = createBenefitCompanyRequestRepository({ getSessionContext: async () => ctx('one', vi.fn(), vi.fn(async () => response)) })
    const result = await repo.verifyWithNts({ clientKey, businessName: '테스트 기업', businessNumber: '1234567890', openingDate: '20260131', representativeName: '홍길동', region: null, industry: null, website: null })
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_response' } }); expect(JSON.stringify(result)).not.toContain(raw); expect(JSON.stringify(result)).not.toContain('1234567890')
  })

  it.each([
    ['switch pre-call', [ctx('one'), ctx('two')], 0],
    ['logout pre-call', [ctx('one'), null], 0],
    ['refresh post-call', [ctx('one'), ctx('one'), ctx('two')], 1],
  ] as const)('rejects stale session %s', async (_name, sequence, expectedCalls) => {
    const rpc = vi.fn(async () => ok(item)); let i = 0; const values = sequence.map(value => value && ctx(value.sessionFingerprint, rpc))
    const result = await createBenefitCompanyRequestRepository({ getSessionContext: async () => values[i++] ?? null }).createManual(manual)
    expect(result).toMatchObject({ ok: false, error: { code: 'stale_session' } }); expect(rpc).toHaveBeenCalledTimes(expectedCalls)
  })

  it('does not mutate input or decoded responses', async () => {
    const input = Object.freeze({ ...manual }); const wire = Object.freeze({ ...item }); const rpc = vi.fn(async () => ok(wire))
    await expect(createBenefitCompanyRequestRepository({ getSessionContext: async () => ctx('one', rpc) }).createManual(input)).resolves.toMatchObject({ ok: true })
    expect(input).toEqual(manual); expect(wire).toEqual(item)
  })
})
