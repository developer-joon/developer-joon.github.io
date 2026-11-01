import { describe, expect, it, vi } from 'vitest'
import { createBenefitCorrectionRepository, type BenefitCorrectionRepository, type BenefitCorrectionRpcClient, type BenefitCorrectionRpcResponse } from './benefitCorrectionRepository'
import type { BenefitCorrectionAccountScope, CreateBenefitCorrectionInput } from '../types/benefitCorrections'

const requestId = '56000000-0000-4000-8000-000000000010'
const clientKey = '56000000-0000-4000-8000-000000000011'
const createdAt = '2026-11-01T00:00:00.000Z'
const accountAId = '56000000-0000-4000-8000-0000000000a1'
const accountBId = '56000000-0000-4000-8000-0000000000b2'

const ownerItem = {
  id: requestId,
  company_id: 'KR-CRN-1234567890123',
  category_id: 'health' as const,
  current_text: '현재 내용',
  proposed_text: '제안 내용',
  scope_text: '대한민국 정규직',
  source_url: 'https://example.com/benefits',
  observed_data_version: 'company-benefits-2026-11-01-v1',
  status: 'submitted',
  admin_response: null,
  applied_data_version: null,
  applied_at: null,
  created_at: createdAt,
  updated_at: createdAt,
}

const createInput: CreateBenefitCorrectionInput = {
  clientKey,
  companyId: ownerItem.company_id,
  categoryId: ownerItem.category_id,
  currentText: ownerItem.current_text,
  proposedText: ownerItem.proposed_text,
  scopeText: ownerItem.scope_text,
  sourceUrl: ownerItem.source_url,
  observedDataVersion: ownerItem.observed_data_version,
}

function setup(initial = { data: ownerItem as unknown, error: null as unknown }) {
  const calls: Array<{ name: string; args: Record<string, unknown>; signal?: AbortSignal }> = []
  let response = initial
  let actorScope = accountAId
  const client: BenefitCorrectionRpcClient = {
    rpc(name, args, signal) {
      calls.push({ name, args, signal })
      return Promise.resolve(response)
    },
  }
  return {
    repository: createBenefitCorrectionRepository(client, { getActorId: () => actorScope }),
    calls,
    setResponse(next: typeof response) { response = next },
    switchActor() { actorScope = accountBId },
  }
}

async function currentScope(repository: BenefitCorrectionRepository): Promise<BenefitCorrectionAccountScope> {
  const result = await repository.getCurrentAccountScope()
  if (!result.ok) throw new Error('expected current account scope')
  return result.data
}

async function scopeForActor(actorId: string): Promise<BenefitCorrectionAccountScope> {
  return currentScope(createBenefitCorrectionRepository({ rpc: vi.fn() }, { getActorId: () => actorId }))
}

async function createFor(
  repository: BenefitCorrectionRepository,
  input: CreateBenefitCorrectionInput,
  signal?: AbortSignal,
) {
  return repository.createRequest(input, await currentScope(repository), signal)
}

describe('benefit correction repository RPC contract', () => {
  it('requires an expected account scope in the public create API', () => {
    const value = setup()
    const compileCreateCalls = () => {
      // @ts-expect-error expectedAccountScope is mandatory
      void value.repository.createRequest(createInput)
      // @ts-expect-error an AbortSignal cannot replace expectedAccountScope
      void value.repository.createRequest(createInput, new AbortController().signal)
    }
    expect(compileCreateCalls).toBeTypeOf('function')
    expect(value.calls).toEqual([])
  })

  it('makes zero RPC calls for missing, null, signal-only, or forged create scopes', async () => {
    const client: BenefitCorrectionRpcClient = { rpc: vi.fn().mockResolvedValue({ data: ownerItem, error: null }) }
    const repository = createBenefitCorrectionRepository(client, { getActorId: () => accountBId })
    const unsafeCreate = repository.createRequest as unknown as (
      input: CreateBenefitCorrectionInput,
      expectedAccountScope?: unknown,
      signal?: AbortSignal,
    ) => ReturnType<BenefitCorrectionRepository['createRequest']>
    const forgedScope = await scopeForActor(accountAId)

    await expect(unsafeCreate(createInput)).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    await expect(unsafeCreate(createInput, undefined)).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    await expect(unsafeCreate(createInput, null)).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    await expect(unsafeCreate(createInput, new AbortController().signal)).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    await expect(unsafeCreate(createInput, forgedScope)).resolves.toMatchObject({ ok: false, error: { code: 'stale_response' } })
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('requires an authenticated actor provider at construction', () => {
    const client: BenefitCorrectionRpcClient = { rpc: vi.fn() }
    expect(() => createBenefitCorrectionRepository(client, undefined as never)).toThrow('actor provider is required')
    expect(() => createBenefitCorrectionRepository(client, {} as never)).toThrow('actor provider is required')
  })

  it('exposes only a stable domain-separated opaque scope for the current actor', async () => {
    const client: BenefitCorrectionRpcClient = { rpc: vi.fn() }
    const repository = createBenefitCorrectionRepository(client, { getActorId: () => accountAId })
    const first = await repository.getCurrentAccountScope()
    expect(first).toEqual({ ok: true, data: 'c3cdc743da03b5bc2025a7bb9adc8db87bdec1a629fcc84a3d3b3b9ad66d0d0e' })
    expect(await repository.getCurrentAccountScope()).toEqual(first)
    expect(JSON.stringify(first)).not.toContain(accountAId)
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('fails closed before RPC when the mandatory actor provider has no authenticated actor', async () => {
    const client: BenefitCorrectionRpcClient = { rpc: vi.fn() }
    const repository = createBenefitCorrectionRepository(client, { getActorId: () => null })
    await expect(repository.createRequest(createInput, await scopeForActor(accountAId))).resolves.toMatchObject({ ok: false, error: { code: 'auth_required' } })
    await expect(repository.listMyRequests({ limit: 25 })).resolves.toMatchObject({ ok: false, error: { code: 'auth_required' } })
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('calls authenticated create with only the approved RPC arguments', async () => {
    const value = setup()
    expect(await createFor(value.repository, createInput)).toEqual({ ok: true, data: {
      id: requestId, companyId: ownerItem.company_id, categoryId: 'health', currentText: ownerItem.current_text,
      proposedText: ownerItem.proposed_text, scopeText: ownerItem.scope_text, sourceUrl: ownerItem.source_url,
      observedDataVersion: ownerItem.observed_data_version, status: 'submitted', adminResponse: null,
      appliedDataVersion: null, appliedAt: null, createdAt, updatedAt: createdAt,
    } })
    expect(value.calls).toEqual([{ name: 'create_benefit_correction_request_v1', args: {
      p_client_key: clientKey,
      p_company_id: ownerItem.company_id,
      p_category_id: 'health',
      p_current_text: ownerItem.current_text,
      p_proposed_text: ownerItem.proposed_text,
      p_scope_text: ownerItem.scope_text,
      p_source_url: ownerItem.source_url,
      p_observed_data_version: ownerItem.observed_data_version,
    }, signal: undefined }])
    expect(JSON.stringify(value.calls)).not.toMatch(/user|email|token|reviewer|operator/i)
  })

  it('calls own list, admin queue, and review RPCs with exact cursor/CAS arguments', async () => {
    const value = setup({ data: { items: [ownerItem], has_more: false, next_cursor: null }, error: null })
    await value.repository.listMyRequests({ limit: 25 })
    expect(value.calls[0]).toEqual({ name: 'list_my_benefit_correction_requests_v1', args: {
      p_limit: 25, p_cursor_created_at: undefined, p_cursor_id: undefined,
    }, signal: undefined })

    value.setResponse({ data: { items: [{ ...ownerItem, status: 'reviewing', admin_response: '검토 중', reviewed_at: createdAt }], has_more: false, next_cursor: null }, error: null })
    await value.repository.listAdminQueue({ status: 'active', limit: 50 })
    expect(value.calls[1]).toEqual({ name: 'list_benefit_correction_queue_v1', args: {
      p_status: 'active', p_limit: 50, p_cursor_created_at: undefined, p_cursor_id: undefined,
    }, signal: undefined })

    value.setResponse({ data: { ...ownerItem, status: 'reviewing', admin_response: '검토 시작', reviewed_at: createdAt }, error: null })
    await value.repository.reviewRequest({ requestId, expectedStatus: 'submitted', action: 'start_review', adminResponse: '검토 시작', clientKey })
    expect(value.calls[2]).toEqual({ name: 'review_benefit_correction_request_v1', args: {
      p_request_id: requestId, p_expected_status: 'submitted', p_action: 'start_review',
      p_admin_response: '검토 시작', p_client_key: clientKey,
    }, signal: undefined })
  })

  it.each([
    ['unknown key', { ...ownerItem, submitter_id: requestId }],
    ['bad UUID', { ...ownerItem, id: 'not-a-uuid' }],
    ['bad status', { ...ownerItem, status: 'pending' }],
    ['bad timestamp', { ...ownerItem, created_at: '2026-02-30T00:00:00Z' }],
    ['bad URL', { ...ownerItem, source_url: 'http://example.com/private' }],
    ['URL whitespace', { ...ownerItem, source_url: 'https://example.com/not public' }],
    ['bad version', { ...ownerItem, observed_data_version: 'company-benefits-2026-02-30-v1' }],
    ['year-zero version', { ...ownerItem, observed_data_version: 'company-benefits-0000-01-01-v1' }],
    ['non-string company', { ...ownerItem, company_id: { toString: () => ownerItem.company_id } }],
    ['inconsistent state', { ...ownerItem, status: 'applied', applied_data_version: null }],
  ])('fails closed on malformed create response: %s', async (_label, data) => {
    const value = setup({ data, error: null })
    await expect(createFor(value.repository, createInput)).resolves.toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it.each([
    { items: [], has_more: false, next_cursor: null, extra: true },
    { items: [], has_more: true, next_cursor: null },
    { items: [], has_more: false, next_cursor: { created_at: createdAt, id: requestId } },
    { items: [], has_more: true, next_cursor: { created_at: 'bad', id: requestId } },
    { items: [{ ...ownerItem, leak: true }], has_more: false, next_cursor: null },
  ])('rejects malformed page envelopes %#', async (data) => {
    const value = setup({ data, error: null })
    await expect(value.repository.listMyRequests({ limit: 25 })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it('rejects owner-shaped rows in the admin queue and validates applied fields', async () => {
    const value = setup({ data: { items: [ownerItem], has_more: false, next_cursor: null }, error: null })
    await expect(value.repository.listAdminQueue({ status: 'all', limit: 10 })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_response' } })
    value.setResponse({ data: {
      ...ownerItem, status: 'applied', admin_response: '게시 완료', reviewed_at: createdAt,
      applied_data_version: 'company-benefits-2026-11-02-v2', applied_at: '2026-11-02T00:00:00Z', updated_at: '2026-11-02T00:00:00Z',
    }, error: null })
    await expect(value.repository.reviewRequest({ requestId, expectedStatus: 'reviewing', action: 'approve', adminResponse: '승인', clientKey })).resolves.toMatchObject({ ok: true, data: { status: 'applied', appliedDataVersion: 'company-benefits-2026-11-02-v2' } })
  })

  it('validates inputs before RPC and never accepts client actor or review identity fields', async () => {
    const value = setup()
    await expect(createFor(value.repository, { ...createInput, sourceUrl: 'https://localhost/private' })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    await expect(createFor(value.repository, { ...createInput, proposedText: 'x'.repeat(5001) })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    await expect(value.repository.listMyRequests({ limit: 101 })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    await expect(value.repository.reviewRequest({ requestId, expectedStatus: 'submitted', action: 'approve', adminResponse: 'invalid transition', clientKey })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(value.calls).toEqual([])
  })

  it('forwards abort signals and rejects responses after the authenticated actor scope changes', async () => {
    let finish!: (value: { data: unknown; error: unknown }) => void
    let actorScope = accountAId
    const client: BenefitCorrectionRpcClient = { rpc: vi.fn(() => new Promise<BenefitCorrectionRpcResponse>(resolve => { finish = resolve })) }
    const repository = createBenefitCorrectionRepository(client, { getActorId: () => actorScope })
    const controller = new AbortController()
    const expectedScope = await currentScope(repository)
    const pending = repository.createRequest(createInput, expectedScope, controller.signal)
    await vi.waitFor(() => expect(client.rpc).toHaveBeenCalledWith('create_benefit_correction_request_v1', expect.any(Object), controller.signal))
    actorScope = accountBId
    finish({ data: ownerItem, error: null })
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'stale_response' } })

    controller.abort()
    await expect(repository.createRequest(createInput, expectedScope, controller.signal)).resolves.toMatchObject({ ok: false, error: { code: 'aborted' } })
  })

  it('rechecks cancellation after actor lookup and immediately before RPC', async () => {
    const controller = new AbortController()
    let releaseActor!: (value: string) => void
    const client: BenefitCorrectionRpcClient = { rpc: vi.fn().mockResolvedValue({ data: ownerItem, error: null }) }
    const repository = createBenefitCorrectionRepository(client, {
      getActorId: () => new Promise<string>(resolve => { releaseActor = resolve }),
    })
    const pending = repository.createRequest(createInput, await scopeForActor(accountAId), controller.signal)
    controller.abort()
    releaseActor(accountAId)
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'aborted' } })
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('uses Unicode code points for PostgreSQL-compatible text bounds', async () => {
    const value = setup({ data: { ...ownerItem, current_text: '😀'.repeat(5000), proposed_text: '😀'.repeat(5000), scope_text: '😀'.repeat(2000) }, error: null })
    await expect(createFor(value.repository, { ...createInput, currentText: '😀'.repeat(5000), proposedText: '😀'.repeat(5000), scopeText: '😀'.repeat(2000) })).resolves.toMatchObject({ ok: true })
    await expect(createFor(value.repository, { ...createInput, currentText: '😀'.repeat(5001) })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    await expect(createFor(value.repository, { ...createInput, scopeText: '😀'.repeat(2001) })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(value.calls).toHaveLength(1)
  })

  it('applies Unicode code-point bounds to admin responses before review RPCs', async () => {
    const value = setup({ data: { ...ownerItem, status: 'reviewing', admin_response: '😀'.repeat(2000), reviewed_at: createdAt }, error: null })
    await expect(value.repository.reviewRequest({ requestId, expectedStatus: 'submitted', action: 'start_review', adminResponse: '😀'.repeat(2000), clientKey })).resolves.toMatchObject({ ok: true })
    await expect(value.repository.reviewRequest({ requestId, expectedStatus: 'submitted', action: 'start_review', adminResponse: '😀'.repeat(2001), clientKey })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(value.calls).toHaveLength(1)
  })

  it.each([
    ['submitted', 'start_review', true],
    ['submitted', 'request_additional_material', false],
    ['submitted', 'approve', false],
    ['submitted', 'reject', false],
    ['reviewing', 'start_review', false],
    ['reviewing', 'request_additional_material', true],
    ['reviewing', 'approve', true],
    ['reviewing', 'reject', true],
  ] as const)('validates migration transition %s + %s before RPC', async (expectedStatus, action, allowed) => {
    const value = setup({ data: { ...ownerItem, status: 'reviewing', admin_response: '검토', reviewed_at: createdAt }, error: null })
    const result = await value.repository.reviewRequest({ requestId, expectedStatus, action, adminResponse: '검토', clientKey })
    expect(result.ok).toBe(allowed)
    expect(value.calls).toHaveLength(allowed ? 1 : 0)
  })

  it.each(['approved', 'rejected', 'applied', 'SUBMITTED', '', null, undefined])(
    'rejects malformed expectedStatus %# before RPC', async expectedStatus => {
      const value = setup()
      await expect(value.repository.reviewRequest({ requestId, expectedStatus, action: 'start_review', adminResponse: '검토', clientKey } as never))
        .resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
      expect(value.calls).toEqual([])
    },
  )
})
