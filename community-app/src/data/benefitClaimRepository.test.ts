import { describe, expect, it, vi } from 'vitest'
import { createBenefitClaimRepository, type BenefitClaimSessionContext } from './benefitClaimRepository'

const actor = 'a1000000-0000-4000-8000-000000000001'
const claimId = 'b1000000-0000-4000-8000-000000000001'
const publicationId = 'c1000000-0000-4000-8000-000000000001'
const now = '2026-11-23T01:00:00.000000+00:00'
const later = '2026-11-23T02:00:00.000000+00:00'
const owner = { claim_id: claimId, company_id: 'KR-BIZ-1234567890', company_name: '테스트', category_id: 'health', title: '건강 검진', description: '매년 검진', eligibility_text: null, condition_text: null, observed_on: '2026-11-22', status: 'submitted', revision: 1, created_at: now, updated_at: now, withdrawn_at: null }
const page = { items: [owner], has_more: false, next_cursor: null }
const ok = (data: unknown) => ({ data, error: null, count: null, status: 200, statusText: 'OK' })
function context(fingerprint = 'token-1', rpc: BenefitClaimSessionContext['rpc'] = vi.fn(async () => ok(page))): BenefitClaimSessionContext { return { actorId: actor, sessionFingerprint: fingerprint, rpc } }

const createInput = { clientKey: 'd1000000-0000-4000-8000-000000000001', companyId: 'KR-BIZ-1234567890', categoryId: 'health' as const, title: '건강 검진', description: '매년 검진', eligibilityText: null, conditionText: null, observedOn: '2026-11-22', sourceUrl: null }

describe('benefit claim repository', () => {
  it('captures the trusted session before validation and rejects invalid input without RPC', async () => {
    const rpc = vi.fn(); const provider = vi.fn(async () => context('one', rpc))
    const result = await createBenefitClaimRepository({ getSessionContext: provider }).createClaim({ ...createInput, title: '' })
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(provider).toHaveBeenCalledTimes(1); expect(rpc).not.toHaveBeenCalled()
  })

  it('captures the trusted session before reading input fields', async () => {
    const order: string[] = []
    const input = new Proxy({ ...createInput, title: '' }, {
      ownKeys(target) { order.push('input'); return Reflect.ownKeys(target) },
    })
    const provider = async () => { order.push('session'); return context('one', vi.fn()) }
    await createBenefitClaimRepository({ getSessionContext: provider }).createClaim(input)
    expect(order[0]).toBe('session')
  })

  it('maps a getter that throws during argument construction to invalid_argument', async () => {
    const input = { ...createInput, get title(): string { throw new Error('secret') } }
    const rpc = vi.fn()
    const repo = createBenefitClaimRepository({ getSessionContext: async () => context('one', rpc) })
    await expect(repo.createClaim(input)).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('validates the same input snapshot that it sends', async () => {
    let reads = 0
    const input = { ...createInput, get title() { return ++reads === 1 ? '정상' : '' } }
    const rpc = vi.fn(async () => ok({ claim_id: claimId, outcome: 'created' }))
    const repo = createBenefitClaimRepository({ getSessionContext: async () => context('one', rpc) })
    await expect(repo.createClaim(input)).resolves.toMatchObject({ ok: true })
    expect(rpc).toHaveBeenCalledWith('create_benefit_claim_v1', expect.objectContaining({p_title:'정상'}), undefined)
  })

  it('captures immutable session identity when a provider reuses its context object', async () => {
    const session = context('one', vi.fn(async () => { Object.assign(session, { sessionFingerprint: 'two' }); return ok({ claim_id: claimId, outcome: 'created' }) }))
    const repo = createBenefitClaimRepository({ getSessionContext: async () => session })
    await expect(repo.createClaim(createInput)).resolves.toMatchObject({ ok: false, error: { code: 'stale_session' } })
  })

  it('rejects a session change caused by a response getter', async () => {
    let fingerprint = 'one'
    const data = { get claim_id() { fingerprint = 'two'; return claimId }, outcome: 'created' }
    const rpc = vi.fn(async () => ok(data))
    const repo = createBenefitClaimRepository({ getSessionContext: async () => context(fingerprint, rpc) })
    await expect(repo.createClaim(createInput)).resolves.toMatchObject({ ok: false, error: { code: 'stale_session' } })
  })

  it('returns aborted if the session provider rejects after abort', async () => {
    const controller = new AbortController()
    const repo = createBenefitClaimRepository({ getSessionContext: async () => { controller.abort(); throw new TypeError('secret') } })
    await expect(repo.createClaim(createInput, controller.signal)).resolves.toMatchObject({ ok: false, error: { code: 'aborted' } })
  })

  it.each(['createClaim','withdrawClaim','listMyClaims','setReaction','listModerationQueue','listAudit','moderateClaim','officiallyVerifyClaim'] as const)('%s captures before touching a throwing input', async method => {
    const order: string[] = []
    const repo = createBenefitClaimRepository({ getSessionContext: async () => { order.push('session'); return context('one', vi.fn()) } })
    const input = new Proxy({}, { ownKeys() { order.push('input'); throw Error('secret') }, get() { order.push('input'); throw Error('secret') } })
    const call = repo[method] as (value: never) => Promise<unknown>
    await expect(call(input as never)).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(order).toEqual(['session', 'input'])
  })

  it('honors abort while asynchronously capturing the session', async () => {
    const controller = new AbortController()
    const rpc = vi.fn()
    const repo = createBenefitClaimRepository({ getSessionContext: async () => { controller.abort(); return context('one', rpc) } })
    await expect(repo.createClaim(createInput, controller.signal)).resolves.toMatchObject({ ok: false, error: { code: 'aborted' } })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns aborted when a fulfilled RPC settles after cancellation', async () => {
    const controller = new AbortController()
    const rpc = vi.fn(async () => { controller.abort(); return ok({ claim_id: claimId, outcome: 'created' }) })
    const repo = createBenefitClaimRepository({ getSessionContext: async () => context('one', rpc) })
    await expect(repo.createClaim(createInput, controller.signal)).resolves.toMatchObject({ ok: false, error: { code: 'aborted' } })
  })

  it('rejects future observations before transport', async () => {
    const rpc = vi.fn()
    const repo = createBenefitClaimRepository({ getSessionContext: async () => context('one', rpc) })
    await expect(repo.createClaim({ ...createInput, observedOn: '9999-01-01' })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each(['https://example.com/?sig=secret', 'https://example.com/?x=%23', 'https://example.com/?x=1;y=2', 'https://example.com/?%61uth=x', 'https://example.com/#fragment'])('rejects unsafe source URL %s', async sourceUrl => {
    const rpc = vi.fn()
    const repo = createBenefitClaimRepository({ getSessionContext: async () => context('one', rpc) })
    await expect(repo.createClaim({ ...createInput, sourceUrl })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('requires the shared exact submission transport envelope', async () => {
    for (const envelope of [{ data:{claim_id:claimId,outcome:'created'},error:null,status:200,statusText:'OK' }, { data: { claim_id: claimId }, error: { code: 'XX000', message: 'secret' }, count:null, status: 500, statusText: '' }]) {
      const repo = createBenefitClaimRepository({ getSessionContext: async () => context('one', vi.fn(async () => envelope) as never) })
      const result = await repo.createClaim(createInput)
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid_response' } })
    }
  })

  it.each([
    { ...ok({ claim_id: claimId, outcome: 'created' }), extra: 'private' },
    { data: null, error: { code: 'XX000', message: 'private', details: null, hint: null, reviewer_id: actor }, count:null, status: 500, statusText: 'Error' },
    { data: null, error: { code: 'XX000', message: 'private', details: { nested: true }, hint: null }, count:null, status: 500, statusText: 'Error' },
  ])('rejects outer and nested transport leak keys', async envelope => {
    const result = await createBenefitClaimRepository({ getSessionContext: async () => context('one', vi.fn(async () => envelope)) }).createClaim(createInput)
    expect(result).toEqual({ ok: false, error: { code: 'invalid_response', message: '서버 응답을 확인할 수 없습니다.' } })
    expect(JSON.stringify(result)).not.toContain('private')
  })

  it.each([
    '2026-01-01T00:30:00.000Z', // UTC-12 is still on the preceding local day.
    '2026-01-01T23:30:00.000Z', // UTC+14 is already on the following local day.
  ])('uses injected UTC instant %s independently of an extreme local date', async instant => {
    const rpc = vi.fn(async () => ok({ claim_id: claimId, outcome: 'created' }))
    const repo = createBenefitClaimRepository({ getSessionContext: async () => context('one', rpc), now: () => new Date(instant) })
    await expect(repo.createClaim({ ...createInput, observedOn: '2026-01-01' })).resolves.toMatchObject({ ok: true })
    await expect(repo.createClaim({ ...createInput, observedOn: '2026-01-02' })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
  })

  it('sends exact create args and decodes the exact outcome', async () => {
    const rpc = vi.fn(async () => ok({ claim_id: claimId, outcome: 'created' })); const ctx = context('one', rpc)
    const result = await createBenefitClaimRepository({ getSessionContext: async () => ctx }).createClaim(createInput)
    expect(result).toEqual({ ok: true, data: { claimId, outcome: 'created' } })
    expect(rpc).toHaveBeenCalledWith('create_benefit_claim_v1', { p_client_key: createInput.clientKey, p_company_id: createInput.companyId, p_category_id: 'health', p_title: '건강 검진', p_description: '매년 검진', p_eligibility_text: null, p_condition_text: null, p_observed_on: '2026-11-22', p_source_url: null }, undefined)
  })

  it('lists mine with exact strict owner projection and cursor args', async () => {
    const rpc = vi.fn(async () => ok(page)); const repo = createBenefitClaimRepository({ getSessionContext: async () => context('one', rpc) })
    const result = await repo.listMyClaims({ limit: 20, cursor: null })
    expect(result).toMatchObject({ ok: true, data: { items: [{ claimId, status: 'submitted', revision: 1 }], hasMore: false, nextCursor: null } })
    expect(rpc).toHaveBeenCalledWith('list_my_benefit_claims_v1', { p_limit: 20, p_cursor_created_at: null, p_cursor_id: null }, undefined)
  })

  it.each(['email','submitter_id','user_id','provider_id','reviewer_id','client_key','payload_fingerprint','source_url'])('rejects prohibited owner leak key %s', async key => {
    const rpc = vi.fn(async () => ok({ ...page, items: [{ ...owner, [key]: 'secret' }] }))
    const result = await createBenefitClaimRepository({ getSessionContext: async () => context('one', rpc) }).listMyClaims({ limit: 20 })
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it('rejects sparse and oversized list responses', async () => {
    const sparse = Array(2); sparse[1] = owner
    for (const items of [sparse, Array.from({ length: 101 }, () => owner)]) {
      const rpc = vi.fn(async () => ok({ ...page, items }))
      await expect(createBenefitClaimRepository({ getSessionContext: async () => context('one', rpc) }).listMyClaims({ limit: 100 })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_response' } })
    }
  })

  it('rejects out-of-order pages and mismatched next cursors', async () => {
    const newer = { ...owner, claim_id: 'b1000000-0000-4000-8000-000000000002', created_at: later, updated_at: later }
    for (const result of [{ items: [owner, newer], has_more: false, next_cursor: null }, { items: [newer], has_more: true, next_cursor: { created_at: now, claim_id: claimId } }]) {
      const repo = createBenefitClaimRepository({ getSessionContext: async () => context('one', vi.fn(async () => ok(result))) })
      await expect(repo.listMyClaims({ limit: result.has_more ? 1 : 2 })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_response' } })
    }
  })

  it('sets and clears reactions with explicit null and validates aggregate response', async () => {
    const response = { claim_id: claimId, reaction: null, status: 'submitted', revision: 2, confirm_count: 0, dispute_count: 0, active_publication_id: null, outcome: 'cleared' }
    const rpc = vi.fn(async () => ok(response)); const repo = createBenefitClaimRepository({ getSessionContext: async () => context('one', rpc) })
    expect(await repo.setReaction({ claimId, reaction: null, clientKey: createInput.clientKey })).toMatchObject({ ok: true, data: { reaction: null, outcome: 'cleared' } })
    expect(rpc).toHaveBeenCalledWith('set_benefit_claim_reaction_v1', { p_claim_id: claimId, p_reaction: null, p_client_key: createInput.clientKey }, undefined)
  })

  it('rejects reaction responses for another claim or reaction', async () => {
    const response = { claim_id: 'b1000000-0000-4000-8000-000000000002', reaction: 'confirm', status: 'submitted', revision: 2, confirm_count: 1, dispute_count: 0, active_publication_id: null, outcome: 'set' }
    const repo = createBenefitClaimRepository({ getSessionContext: async () => context('one', vi.fn(async () => ok(response))) })
    await expect(repo.setReaction({ claimId, reaction: null, clientKey: createInput.clientKey })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it('rejects reaction aggregates that contradict the derived status', async () => {
    const response = { claim_id: claimId, reaction: 'confirm', status: 'submitted', revision: 2, confirm_count: 3, dispute_count: 0, active_publication_id: null, outcome: 'set' }
    const repo = createBenefitClaimRepository({ getSessionContext: async () => context('one', vi.fn(async () => ok(response))) })
    await expect(repo.setReaction({ claimId, reaction: 'confirm', clientKey: createInput.clientKey })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it('rejects audit branches with impossible action and nullability', async () => {
    const event = { event_id: claimId, event_kind: 'merge', action: 'verify', from_status: null, to_status: 'submitted', evidence_type: null, evidence_observed_on: null, related_claim_id: null, publication_id: null, created_at: now }
    const repo = createBenefitClaimRepository({ getSessionContext: async () => context('one', vi.fn(async () => ok({ items: [event], has_more: false, next_cursor: null }))) })
    await expect(repo.listAudit({ claimId, limit: 20 })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it('orders equal-time audit events by kind then ID and respects cross-kind cursors', async () => {
    const review = { event_id: 'b1000000-0000-4000-8000-000000000003', event_kind:'official_review', action:'verify', from_status:null, to_status:null, evidence_type:'official_website', evidence_observed_on:'2020-01-01', related_claim_id:null, publication_id:publicationId, created_at:now }
    // SQL intentionally reuses a review UUID for the paired claim_event on official withdrawal;
    // identity and cursor uniqueness are therefore the complete (kind, id) discriminator.
    const merge = { event_id:review.event_id, event_kind:'merge', action:'merged', from_status:null, to_status:'merged', evidence_type:null, evidence_observed_on:null, related_claim_id:claimId, publication_id:null, created_at:now }
    const rpc = vi.fn(async () => ok({items:[review,merge],has_more:true,next_cursor:{created_at:now,event_kind:'merge',event_id:merge.event_id}}))
    const repo = createBenefitClaimRepository({getSessionContext:async()=>context('one',rpc)})
    const result = await repo.listAudit({claimId,limit:2,cursor:JSON.stringify({created_at:later,event_kind:'claim_event',event_id:claimId})})
    expect(result).toMatchObject({ok:true,data:{hasMore:true,items:[{eventKind:'official_review'},{eventKind:'merge'}]}})
    expect(rpc).toHaveBeenCalledWith('list_benefit_claim_audit_v1',{p_claim_id:claimId,p_limit:2,p_cursor_created_at:later,p_cursor_kind:'claim_event',p_cursor_id:claimId},undefined)
  })

  it('supports withdrawal, admin queue, audit, moderation, and official verification RPC signatures', async () => {
    const responses: Record<string, unknown> = {
      withdraw_benefit_claim_v1: { claim_id: claimId, status: 'withdrawn', revision: 2, outcome: 'withdrawn' },
      list_benefit_claim_moderation_queue_v1: { items: [{ claim_id: claimId, company_id: 'KR-BIZ-1234567890', company_name: '테스트', category_id: 'health', title: '건강 검진', status: 'submitted', revision: 1, confirm_count: 0, dispute_count: 0, community_publication_active: false, official_publication_active: false, created_at: now, updated_at: now }], has_more: false, next_cursor: null },
      list_benefit_claim_audit_v1: { items: [{ event_id: claimId, event_kind: 'claim_event', action: 'submitted', from_status: null, to_status: 'submitted', evidence_type: null, evidence_observed_on: null, related_claim_id: null, publication_id: null, created_at: now }], has_more: false, next_cursor: null },
      moderate_benefit_claim_v1: { claim_id: claimId, status: 'hidden', revision: 2, community_publication_id: null, official_publication_id: null, outcome: 'hide', target_claim_id: null },
      officially_verify_benefit_claim_v1: { claim_id: claimId, status: 'submitted', revision: 2, official_publication_id: publicationId, outcome: 'verify' },
    }
    const rpc = vi.fn(async (name: string) => ok(responses[name])); const repo = createBenefitClaimRepository({ getSessionContext: async () => context('one', rpc) })
    expect((await repo.withdrawClaim({ claimId, clientKey: createInput.clientKey, expectedStatus: 'submitted', expectedRevision: 1 })).ok).toBe(true)
    expect((await repo.listModerationQueue({ status: 'active', limit: 20 })).ok).toBe(true)
    expect((await repo.listAudit({ claimId, limit: 20 })).ok).toBe(true)
    expect((await repo.moderateClaim({ claimId, clientKey: createInput.clientKey, expectedStatus: 'submitted', expectedRevision: 1, action: 'hide', targetClaimId: null, reason: '정책 위반', evidenceType: null, evidenceObservedOn: null, evidenceSourceUrl: null })).ok).toBe(true)
    expect((await repo.officiallyVerifyClaim({ claimId, clientKey: createInput.clientKey, expectedStatus: 'submitted', expectedRevision: 1, title: '공식 건강 검진', description: '공식 설명', eligibilityText: null, conditionText: null, evidenceType: 'official_website', evidenceSourceUrl: 'https://example.com/policy', evidenceObservedOn: '2026-11-22', verificationNote: '확인 완료' })).ok).toBe(true)
  })

  it.each([
    ['account switch before RPC', [context('one'), context('two')], 0],
    ['logout before RPC', [context('one'), null], 0],
    ['token replacement after RPC', [context('one'), context('one'), context('two')], 1],
  ] as const)('rejects stale session: %s', async (_name, sequence, calls) => {
    const rpc = vi.fn(async () => ok({ claim_id: claimId, outcome: 'created' })); let index = 0
    const values = sequence.map(value => value && context(value.sessionFingerprint, rpc))
    const result = await createBenefitClaimRepository({ getSessionContext: async () => values[index++] ?? null }).createClaim(createInput)
    expect(result).toMatchObject({ ok: false, error: { code: 'stale_session' } }); expect(rpc).toHaveBeenCalledTimes(calls)
  })

  it('maps backend errors without leaking raw details', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: 'XX000', message: 'secret SQL https://project.supabase.co/rest/v1/rpc/create_benefit_claim_v1', details: null, hint: null }, count:null, status: 500, statusText: 'secret' }))
    const result = await createBenefitClaimRepository({ getSessionContext: async () => context('one', rpc) }).createClaim(createInput)
    expect(result).toMatchObject({ ok: false, error: { code: 'unavailable' } }); expect(JSON.stringify(result)).not.toMatch(/secret|SQL|supabase|rpc/i)
  })

  it('rejects response mutation fields, invalid chronology, dates, counts, enums, and duplicate audit IDs', async () => {
    const bad = [
      { ...page, items: [{ ...owner, updated_at: '2026-11-22T00:00:00Z' }] },
      { ...page, items: [{ ...owner, observed_on: '2026-02-30' }] },
      { ...page, items: [{ ...owner, status: 'pending' }] },
      { items: [{ event_id: claimId, event_kind: 'claim_event', action: 'submitted', from_status: null, to_status: 'submitted', evidence_type: null, evidence_observed_on: null, related_claim_id: null, publication_id: null, created_at: later }, { event_id: claimId, event_kind: 'claim_event', action: 'submitted', from_status: null, to_status: 'submitted', evidence_type: null, evidence_observed_on: null, related_claim_id: null, publication_id: null, created_at: now }], has_more: false, next_cursor: null },
    ]
    for (const value of bad.slice(0, 3)) {
      const rpc = vi.fn(async () => ok(value)); await expect(createBenefitClaimRepository({ getSessionContext: async () => context('one', rpc) }).listMyClaims({ limit: 20 })).resolves.toMatchObject({ ok: false })
    }
    const rpc = vi.fn(async () => ok(bad[3])); await expect(createBenefitClaimRepository({ getSessionContext: async () => context('one', rpc) }).listAudit({ claimId, limit: 20 })).resolves.toMatchObject({ ok: false })
  })
})
