import { beforeEach, describe, expect, it, vi } from 'vitest'

const getAnonymousSupabaseClient = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase', () => ({ getAnonymousSupabaseClient }))

import { createBenefitDirectoryRepository } from './benefitDirectoryRepository'

const company = {
  company_id: 'KR-CRN-1101111111111', display_name: '가나다 공식', identity_label: '법인',
  industry: 'software', size_label: '대기업', region: '서울', summary: '공식 기업',
}
const sortKey = (value:string) => Array.from(new TextEncoder().encode(value), byte => byte.toString(16).padStart(2,'0')).join('')
const searchItem = {
  ...company, sort_key: sortKey(company.display_name.toLowerCase()), benefit_count: 1, official_count: 1, community_count: 0, categories: ['health'],
}
const publication = {
  publication_id: 'b1000000-0000-0000-0000-000000000001', category_id: 'health', title: '건강검진',
  description: '연 1회 건강검진', eligibility_text: '재직자', condition_text: '회사 기준',
  trust_label: '공식 확인', revision: 1,
}
const page = { items: [searchItem], has_more: false, next_cursor: null, total: 1 }
const detail = { company, publications: [publication] }
const publicClaim = {
  claim_id: 'b2000000-0000-0000-0000-000000000001', category_id: 'health', category_name: '건강',
  title: '건강 지원', description: '건강 지원 설명', eligibility_text: null, condition_text: null,
  status_code: 'community_confirmed', status_label: '커뮤니티 확인', nickname: '빵친구',
  submitted_at: '2026-11-22T01:00:00.000000+00:00', observed_on: '2026-11-21',
  confirm_count: 3, dispute_count: 0, last_confirmation_at: '2026-11-22T02:00:00.000000+00:00',
}
const detailV2 = { ...detail, claims: [publicClaim] }

function sparseAtZero<T>(value: T): T[] {
  const values = Array<T>(2)
  values[1] = value
  return values
}

function sparseInMiddle<T>(first: T, last: T): T[] {
  const values = Array<T>(3)
  values[0] = first
  values[2] = last
  return values
}

function oversizedSparseArray<T>(length: number, value: T) {
  let accesses = 0
  const values = Array<T>(length)
  Object.defineProperty(values, 0, {
    configurable: true,
    get() {
      accesses += 1
      return value
    },
  })
  return { values, accesses: () => accesses }
}

function countDenseIndexChecks() {
  let checks = 0
  const original = Object.prototype.hasOwnProperty
  const spy = vi.spyOn(Object.prototype, 'hasOwnProperty').mockImplementation(function (this: object, property: PropertyKey) {
    if (typeof property === 'number') checks += 1
    return Reflect.apply(original, this, [property])
  })
  return { checks: () => checks, restore: () => spy.mockRestore() }
}

type Response = { data: unknown; error: unknown; count?: unknown; status?: unknown; statusText?: unknown }
const success = (data: unknown, status = 200): Response => ({ data, error: null, count: null, status, statusText: status === 200 ? 'OK' : 'No Content' })
function rpcClient(response: Response | Promise<Response>) {
  const resolved = Promise.resolve(response)
  const abortSignal = vi.fn(() => resolved)
  const request = Object.assign(resolved, { abortSignal })
  const rpc = vi.fn(() => request)
  return { client: { rpc }, rpc, abortSignal }
}

beforeEach(() => vi.clearAllMocks())

describe('benefit directory repository', () => {
  it('calls only the public search RPC with the exact server arguments and forwards AbortSignal', async () => {
    const transport = rpcClient(success(page))
    getAnonymousSupabaseClient.mockReturnValue(transport.client)
    const signal = new AbortController().signal

    const result = await createBenefitDirectoryRepository().search({
      query: '가나', categories: ['health'], industry: 'software', size: 'large', region: '서울',
      hasBenefitsOnly: true, pageSize: 20, cursor: 'opaque-cursor',
    }, signal)

    expect(result).toEqual({ ok: true, data: {
      items: [{ companyId: company.company_id, displayName: company.display_name, identityLabel: '법인', industry: 'software', sizeLabel: '대기업', region: '서울', summary: '공식 기업', benefitCount: 1, officialCount: 1, communityCount: 0, categories: ['health'] }],
      hasMore: false, nextCursor: null, total: 1,
    } })
    expect(transport.rpc).toHaveBeenCalledWith('search_benefit_companies_v1', {
      p_query: '가나', p_categories: ['health'], p_industry: 'software', p_size: 'large', p_region: '서울',
      p_has_benefits_only: true, p_page_size: 20, p_cursor: 'opaque-cursor',
    })
    expect(transport.abortSignal).toHaveBeenCalledWith(signal)
  })

  it('forwards duplicate valid category filters unchanged to the server', async () => {
    const transport = rpcClient(success(page))
    getAnonymousSupabaseClient.mockReturnValue(transport.client)

    const result = await createBenefitDirectoryRepository().search({
      pageSize: 20, categories: ['health', 'leave', 'health'],
    })

    expect(result).toMatchObject({ ok: true })
    expect(transport.rpc).toHaveBeenCalledWith('search_benefit_companies_v1', expect.objectContaining({
      p_categories: ['health', 'leave', 'health'],
    }))
  })

  it.each([
    { categories: sparseAtZero('health') },
    { categories: sparseInMiddle('health', 'leave') },
  ])('rejects sparse category input before calling the RPC', async ({ categories }) => {
    const transport = rpcClient(success(page))
    getAnonymousSupabaseClient.mockReturnValue(transport.client)

    const result = await createBenefitDirectoryRepository().search({
      pageSize: 20,
      categories: categories as never,
    })

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(transport.rpc).not.toHaveBeenCalled()
    expect(getAnonymousSupabaseClient).not.toHaveBeenCalled()
  })

  it('rejects oversized sparse category input before traversing its indexes', async () => {
    const categories = oversizedSparseArray(1_000_000, 'health')
    const indexChecks = countDenseIndexChecks()
    const result = await createBenefitDirectoryRepository().search({ pageSize: 20, categories: categories.values as never })
    const checks = indexChecks.checks(); indexChecks.restore()
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(checks).toBe(0)
    expect(categories.accesses()).toBe(0)
    expect(getAnonymousSupabaseClient).not.toHaveBeenCalled()
  })

  it('calls public v2 detail through the anonymous client and decodes strict public claims', async () => {
    const transport = rpcClient(success(detailV2))
    getAnonymousSupabaseClient.mockReturnValue(transport.client)
    const result = await createBenefitDirectoryRepository().detail(company.company_id)
    expect(result).toMatchObject({ ok: true, data: { claims: [{ claimId: publicClaim.claim_id, statusCode: 'community_confirmed', confirmCount: 3 }] } })
    expect(transport.rpc).toHaveBeenCalledWith('get_benefit_company_v2', { p_company_id: company.company_id })
    expect(getAnonymousSupabaseClient).toHaveBeenCalledTimes(1)
  })

  it.each([
    { ...detailV2, claims: [{ ...publicClaim, email: 'private@example.test' }] },
    { ...detailV2, claims: [{ ...publicClaim, submitter_id: 'private' }] },
    { ...detailV2, claims: [{ ...publicClaim, source_url: 'https://private.example' }] },
    { ...detailV2, claims: [{ ...publicClaim, reviewer_id: 'private' }] },
    { ...detailV2, claims: [{ ...publicClaim, confirm_count: -1 }] },
    { ...detailV2, claims: [{ ...publicClaim, status_label: '잘못됨' }] },
    { ...detailV2, claims: [{ ...publicClaim, last_confirmation_at: '2026-11-21T00:00:00Z' }] },
    { ...detailV2, claims: [publicClaim, publicClaim] },
    { ...detailV2, claims: Array.from({ length: 201 }, (_, index) => ({ ...publicClaim, claim_id: `b2000000-0000-0000-0000-${index.toString(16).padStart(12, '0')}` })) },
  ])('rejects malformed or private public-v2 claims', async wire => {
    const transport = rpcClient(success(wire)); getAnonymousSupabaseClient.mockReturnValue(transport.client)
    expect(await createBenefitDirectoryRepository().detail(company.company_id)).toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it('calls the public detail RPC and preserves PostgreSQL UUID text without version restrictions', async () => {
    const transport = rpcClient(success(detailV2))
    getAnonymousSupabaseClient.mockReturnValue(transport.client)
    const result = await createBenefitDirectoryRepository().detail(company.company_id)
    expect(result).toMatchObject({ ok: true, data: {
      company: { companyId: company.company_id, displayName: company.display_name, identityLabel: '법인', industry: 'software', sizeLabel: '대기업', region: '서울', summary: '공식 기업' },
      publications: [{ publicationId: publication.publication_id, categoryId: 'health', title: '건강검진', description: '연 1회 건강검진', eligibilityText: '재직자', conditionText: '회사 기준', trustLabel: '공식 확인', revision: 1 }],
    } })
    expect(transport.rpc).toHaveBeenCalledWith('get_benefit_company_v2', { p_company_id: company.company_id })
  })

  it('accepts an opaque canonical company ID in detail responses without rewriting it', async () => {
    const companyId = `KR-CAN-${'a'.repeat(32)}`
    const opaqueDetail = { ...detailV2, company: { ...company, company_id: companyId } }
    const transport = rpcClient(success(opaqueDetail))
    getAnonymousSupabaseClient.mockReturnValue(transport.client)
    await expect(createBenefitDirectoryRepository().detail(companyId)).resolves.toMatchObject({
      ok: true,
      data: { company: { companyId } },
    })
    expect(transport.rpc).toHaveBeenCalledWith('get_benefit_company_v2', { p_company_id: companyId })
  })

  it.each([
    [{ ...page, source_url: 'https://private.example' }, 'top-level'],
    [{ ...page, items: [{ ...searchItem, verified_at: '2026-01-01T00:00:00Z' }] }, 'search item'],
  ])('rejects an unknown/private key at the %s object level', async (wire, level) => {
    void level
    const transport = rpcClient(success(wire)); getAnonymousSupabaseClient.mockReturnValue(transport.client)
    expect(await createBenefitDirectoryRepository().search({ pageSize: 20 })).toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it.each([
    [{ ...detailV2, submitter_id: 'private' }, 'top-level'],
    [{ ...detailV2, company: { ...company, provenance: { private: true } } }, 'company'],
    [{ ...detailV2, publications: [{ ...publication, reviewer_id: 'private' }] }, 'publication'],
    [{ ...detailV2, publications: [{ ...publication, source_url: 'https://private.example' }] }, 'publication source'],
    [{ ...detailV2, publications: [{ ...publication, verified_at: '2026-01-01T00:00:00Z' }] }, 'publication timestamp'],
  ])('rejects an unknown/private detail key at the %s object level', async (wire, level) => {
    void level
    const transport = rpcClient(success(wire)); getAnonymousSupabaseClient.mockReturnValue(transport.client)
    expect(await createBenefitDirectoryRepository().detail(company.company_id)).toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it.each([
    { ...page, items: Array.from({ length: 51 }, (_, index) => ({ ...searchItem, company_id: `KR-BIZ-${String(index).padStart(10, '0')}` })), total: 51 },
    { ...page, total: -1 }, { ...page, total: 1.5 },
    { ...page, items: [{ ...searchItem, benefit_count: 2 }] },
    { ...page, items: [{ ...searchItem, categories: ['health', 'health'] }] },
    { ...page, items: [{ ...searchItem, categories: ['unknown'] }] },
    { ...page, items: [{ ...searchItem, company_id: 'US-CIK0000000001' }] },
    { ...page, items: [{ ...searchItem, size_label: '거대기업' }] },
    { ...page, items: [{ ...searchItem, identity_label: '비공개' }] },
    { ...page, has_more: true, next_cursor: null },
    { ...page, has_more: false, next_cursor: 'unexpected' },
    { ...page, items: [searchItem, searchItem], total: 2 },
  ])('rejects malformed or inconsistent search wire data', async (wire) => {
    const transport = rpcClient(success(wire)); getAnonymousSupabaseClient.mockReturnValue(transport.client)
    expect(await createBenefitDirectoryRepository().search({ pageSize: 50 })).toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it.each([
    { ...page, items: sparseAtZero(searchItem), total: 2 },
    { ...page, items: sparseInMiddle(searchItem, { ...searchItem, company_id: 'KR-BIZ-0000000002' }), total: 3 },
  ])('rejects sparse search item arrays', async (wire) => {
    const transport = rpcClient(success(wire)); getAnonymousSupabaseClient.mockReturnValue(transport.client)
    expect(await createBenefitDirectoryRepository().search({ pageSize: 50 })).toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it('rejects oversized sparse search item arrays before traversing their indexes', async () => {
    const items = oversizedSparseArray(1_000_000, searchItem)
    const transport = rpcClient(success({ ...page, items: items.values, total: 1_000_000 })); getAnonymousSupabaseClient.mockReturnValue(transport.client)
    const indexChecks = countDenseIndexChecks()
    expect(await createBenefitDirectoryRepository().search({ pageSize: 50 })).toMatchObject({ ok: false, error: { code: 'invalid_response' } })
    const checks = indexChecks.checks(); indexChecks.restore()
    expect(checks).toBe(0)
    expect(items.accesses()).toBe(0)
  })

  it.each([
    { categories: sparseAtZero('health') },
    { categories: sparseInMiddle('health', 'leave') },
  ])('rejects sparse search item category arrays', async ({ categories }) => {
    const wire = {
      ...page,
      items: [{ ...searchItem, benefit_count: categories.length, official_count: categories.length, categories }],
    }
    const transport = rpcClient(success(wire)); getAnonymousSupabaseClient.mockReturnValue(transport.client)
    expect(await createBenefitDirectoryRepository().search({ pageSize: 50 })).toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it('rejects oversized sparse search item categories before traversing their indexes', async () => {
    const categories = oversizedSparseArray(1_000_000, 'health')
    const wire = { ...page, items: [{ ...searchItem, benefit_count: 1_000_000, official_count: 1_000_000, categories: categories.values }] }
    const transport = rpcClient(success(wire)); getAnonymousSupabaseClient.mockReturnValue(transport.client)
    const indexChecks = countDenseIndexChecks()
    expect(await createBenefitDirectoryRepository().search({ pageSize: 50 })).toMatchObject({ ok: false, error: { code: 'invalid_response' } })
    const checks = indexChecks.checks(); indexChecks.restore()
    expect(checks).toBe(1) // The one-item page is checked; oversized categories are not.
    expect(categories.accesses()).toBe(0)
  })

  it.each([
    { ...detailV2, publications: [{ ...publication, publication_id: 'not-a-uuid' }] },
    { ...detailV2, publications: [{ ...publication, category_id: 'unknown' }] },
    { ...detailV2, publications: [{ ...publication, trust_label: '검증 안 됨' }] },
    { ...detailV2, publications: [{ ...publication, revision: -1 }] },
    { ...detailV2, publications: [publication, publication] },
    { ...detailV2, publications: null },
  ])('rejects malformed detail wire data', async (wire) => {
    const transport = rpcClient(success(wire)); getAnonymousSupabaseClient.mockReturnValue(transport.client)
    expect(await createBenefitDirectoryRepository().detail(company.company_id)).toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it.each([
    { publications: sparseAtZero(publication) },
    { publications: sparseInMiddle(publication, { ...publication, publication_id: 'b1000000-0000-0000-0000-000000000002' }) },
  ])('rejects sparse detail publication arrays', async ({ publications }) => {
    const transport = rpcClient(success({ ...detailV2, publications })); getAnonymousSupabaseClient.mockReturnValue(transport.client)
    expect(await createBenefitDirectoryRepository().detail(company.company_id)).toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it('rejects detail projections above the server publication limit before decoding entries', async () => {
    const publications = Array.from({ length: 201 }, (_, index) => ({
      ...publication,
      publication_id: `b1000000-0000-0000-0000-${index.toString(16).padStart(12, '0')}`,
    }))
    const transport = rpcClient(success({ company, publications, claims: [publicClaim] }))
    getAnonymousSupabaseClient.mockReturnValue(transport.client)
    expect(await createBenefitDirectoryRepository().detail(company.company_id)).toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it('rejects oversized sparse detail publications before traversing their indexes', async () => {
    const publications = oversizedSparseArray(1_000_000, publication)
    const transport = rpcClient(success({ company, publications: publications.values, claims: [publicClaim] })); getAnonymousSupabaseClient.mockReturnValue(transport.client)
    const indexChecks = countDenseIndexChecks()
    expect(await createBenefitDirectoryRepository().detail(company.company_id)).toMatchObject({ ok: false, error: { code: 'invalid_response' } })
    const checks = indexChecks.checks(); indexChecks.restore()
    expect(checks).toBe(0)
    expect(publications.accesses()).toBe(0)
  })

  it.each([
    [{ data: page, error: null, status: 503, statusText: 'Service Unavailable' }, 'valid data with non-success status'],
    [{ data: page, error: null, statusText: 'OK' }, 'missing status'],
    [{ data: page, error: undefined, status: 200, statusText: 'OK' }, 'undefined error'],
    [{ data: page, error: false, status: 200, statusText: 'OK' }, 'false error'],
    [{ data: page, error: 'failed', status: 500, statusText: 'Error' }, 'string error'],
    [{ data: page, error: null, status: 204, statusText: 'No Content' }, 'data on a no-content response'],
  ])('fails closed for a malformed response envelope: %s', async (wire, description) => {
    void description
    const transport = rpcClient(wire as Response)
    getAnonymousSupabaseClient.mockReturnValue(transport.client)
    expect(await createBenefitDirectoryRepository().search({ pageSize: 20 })).toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it.each([
    [{ pageSize: 0 }], [{ pageSize: 51 }], [{ pageSize: 1.5 }],
    [{ pageSize: 20, query: 'x'.repeat(201) }], [{ pageSize: 20, categories: [] }],
    [{ pageSize: 20, categories: ['bad'] }],
    [{ pageSize: 20, industry: ' ' }], [{ pageSize: 20, industry: 'x'.repeat(101) }],
    [{ pageSize: 20, size: 'giant' }], [{ pageSize: 20, region: ' ' }],
    [{ pageSize: 20, cursor: 'x'.repeat(501) }], [{ pageSize: 20, country: 'KR' }],
  ])('rejects invalid search input before creating a client: %j', async (input) => {
    expect(await createBenefitDirectoryRepository().search(input as never)).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(getAnonymousSupabaseClient).not.toHaveBeenCalled()
  })

  it('does not call transport when already aborted', async () => {
    const controller = new AbortController(); controller.abort()
    expect(await createBenefitDirectoryRepository().search({ pageSize: 20 }, controller.signal)).toEqual({ ok: false, error: { code: 'aborted', message: '요청이 취소되었습니다.' } })
    expect(getAnonymousSupabaseClient).not.toHaveBeenCalled()
  })

  it('maps an abort during transport distinctly', async () => {
    const controller = new AbortController()
    const transport = rpcClient(new Promise((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    getAnonymousSupabaseClient.mockReturnValue(transport.client)
    const pending = createBenefitDirectoryRepository().search({ pageSize: 20 }, controller.signal)
    controller.abort()
    expect(await pending).toMatchObject({ ok: false, error: { code: 'aborted' } })
  })

  it.each([
    [{ status: 504, error: { code: 'PGRST504', message: 'statement timeout: private SQL', details: null, hint: null } }, 'timeout'],
    [{ status: 429, error: { code: 'PGRST429', message: 'private rate detail', details: null, hint: null } }, 'rate_limited'],
    [{ status: 400, error: { code: '22023', message: 'internal invalid query', details: null, hint: null } }, 'invalid_argument'],
    [{ status: 503, error: { code: 'XX000', message: 'internal SQL stack', details: null, hint: null } }, 'unavailable'],
  ])('maps transport/PostgREST errors without leaking internals', async (wire, code) => {
    const transport = rpcClient({ data: null, count: null, statusText: 'Error', ...wire }); getAnonymousSupabaseClient.mockReturnValue(transport.client)
    const result = await createBenefitDirectoryRepository().search({ pageSize: 20 })
    expect(result).toMatchObject({ ok: false, error: { code } })
    expect(JSON.stringify(result)).not.toMatch(/SQL|select|secret|private|stack/i)
  })

  it('maps a thrown fetch failure as a network error', async () => {
    const transport = rpcClient(Promise.reject(new TypeError('Failed to fetch SQL select secret')))
    getAnonymousSupabaseClient.mockReturnValue(transport.client)
    const result = await createBenefitDirectoryRepository().search({ pageSize: 20 })
    expect(result).toMatchObject({ ok: false, error: { code: 'network' } })
    expect(JSON.stringify(result)).not.toMatch(/SQL|select|secret/i)
  })

  it.each([
    ['search', 429, 'rate_limited'],
    ['detail', 429, 'rate_limited'],
    ['search', 502, 'unavailable'],
    ['detail', 502, 'unavailable'],
    ['search', 503, 'unavailable'],
    ['detail', 503, 'unavailable'],
    ['search', 504, 'unavailable'],
    ['detail', 504, 'unavailable'],
  ] as const)('maps realistic %s response status %i to %s', async (method, status, code) => {
    const transport = rpcClient({
      data: null,
      count: null,
      error: { code: 'XX000', message: 'private SQL', details: 'internal table', hint: 'secret hint' },
      status,
      statusText: 'private upstream status',
    })
    getAnonymousSupabaseClient.mockReturnValue(transport.client)

    const repository = createBenefitDirectoryRepository()
    const result = method === 'search'
      ? await repository.search({ pageSize: 20 })
      : await repository.detail(company.company_id)

    expect(result).toMatchObject({ ok: false, error: { code } })
    expect(JSON.stringify(result)).not.toMatch(/SQL|private|internal|table|secret|hint|upstream/i)
  })

  it.each([
    [{ status: 503, error: { code: '57014', message: 'private timeout', details: null, hint: null } }, 'timeout'],
    [{ status: 503, error: { code: '22023', message: 'private invalid argument', details: null, hint: null } }, 'invalid_argument'],
    [{ status: 429, error: { code: 'PGRST504', message: 'private timeout', details: null, hint: null } }, 'timeout'],
    [{ status: 200, error: { code: 'PGRST429', message: 'private rate limit', details: null, hint: null } }, 'invalid_response'],
  ])('gives bounded domain codes precedence over top-level status: %j', async (wire, code) => {
    const transport = rpcClient({ data: null, count: null, statusText: 'Error', ...wire })
    getAnonymousSupabaseClient.mockReturnValue(transport.client)
    expect(await createBenefitDirectoryRepository().search({ pageSize: 20 })).toMatchObject({ ok: false, error: { code } })
  })

  it('ignores nested status-like fields in error payloads', async () => {
    const transport = rpcClient({
      data: null,
      count: null,
      error: { code: 'XX000', message: '{"status":429}', details: '{"status":503}', hint: null, status: 429 },
      status: 418,
      statusText: 'Too Many Requests',
    })
    getAnonymousSupabaseClient.mockReturnValue(transport.client)
    expect(await createBenefitDirectoryRepository().search({ pageSize: 20 })).toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it.each([
    ['detail', 'PGRST116', 'not_found'],
    ['detail', 'PGRST202', 'configuration'],
    ['search', 'PGRST202', 'configuration'],
    ['search', 'PGRST116', 'unknown'],
  ] as const)('distinguishes %s 404 PostgREST code %s as %s', async (method, postgrestCode, code) => {
    const transport = rpcClient({
      data: null,
      count: null,
      error: { code: postgrestCode, message: 'private RPC details', details: 'secret', hint: 'internal' },
      status: 404,
      statusText: 'Not Found',
    })
    getAnonymousSupabaseClient.mockReturnValue(transport.client)
    const repository = createBenefitDirectoryRepository()
    const result = method === 'search'
      ? await repository.search({ pageSize: 20 })
      : await repository.detail(company.company_id)
    expect(result).toMatchObject({ ok: false, error: { code } })
    expect(JSON.stringify(result)).not.toMatch(/private|secret|internal|RPC details/i)
  })

  it('rejects a malformed transport response as invalid data', async () => {
    const transport = rpcClient(null as unknown as Response); getAnonymousSupabaseClient.mockReturnValue(transport.client)
    expect(await createBenefitDirectoryRepository().search({ pageSize: 20 })).toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it('maps missing environment configuration without exposing it', async () => {
    getAnonymousSupabaseClient.mockImplementation(() => { throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY=secret') })
    const result = await createBenefitDirectoryRepository().search({ pageSize: 20 })
    expect(result).toEqual({ ok: false, error: { code: 'configuration', message: '서비스 설정을 확인할 수 없습니다.' } })
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('returns not_found for the public detail null sentinel', async () => {
    const transport = rpcClient(success(null)); getAnonymousSupabaseClient.mockReturnValue(transport.client)
    expect(await createBenefitDirectoryRepository().detail(company.company_id)).toEqual({ ok: false, error: { code: 'not_found', message: '기업 정보를 찾을 수 없습니다.' } })
  })

  it('rejects search items outside exact normalized-name and company-id order', async () => {
    const wires = [
      { ...page, items: [{ ...searchItem, company_id: 'KR-BIZ-0000000002', display_name: 'beta', sort_key: sortKey('beta') }, { ...searchItem, company_id: 'KR-BIZ-0000000001', display_name: 'alpha', sort_key: sortKey('alpha') }], total: 2 },
      { ...page, items: [{ ...searchItem, company_id: 'KR-BIZ-0000000002', display_name: 'same', sort_key: sortKey('same') }, { ...searchItem, company_id: 'KR-BIZ-0000000001', display_name: 'same', sort_key: sortKey('same') }], total: 2 },
    ]
    for (const wire of wires) {
      const transport = rpcClient(success(wire)); getAnonymousSupabaseClient.mockReturnValue(transport.client)
      await expect(createBenefitDirectoryRepository().search({ pageSize: 20 })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_response' } })
    }
  })

  it('rejects publications and public claims outside exact category-title-id order', async () => {
    const publication2 = { ...publication, publication_id: 'b1000000-0000-0000-0000-000000000002', title: '가나다' }
    const claim2 = { ...publicClaim, claim_id: 'b2000000-0000-0000-0000-000000000002', title: '가나다' }
    for (const wire of [
      { ...detailV2, publications: [{ ...publication, title: '하하하' }, publication2] },
      { ...detailV2, publications: [{ ...publication, title: '같음', publication_id: publication2.publication_id }, { ...publication, title: '같음' }] },
      { ...detailV2, claims: [{ ...publicClaim, title: '하하하' }, claim2] },
      { ...detailV2, claims: [{ ...publicClaim, title: '같음', claim_id: claim2.claim_id }, { ...publicClaim, title: '같음' }] },
    ]) {
      const transport = rpcClient(success(wire)); getAnonymousSupabaseClient.mockReturnValue(transport.client)
      await expect(createBenefitDirectoryRepository().detail(company.company_id)).resolves.toMatchObject({ ok: false, error: { code: 'invalid_response' } })
    }
  })

  it.each([
    { ...success(page), extra: 'private' },
    { data: page, error: null, status: 200, statusText: 'OK' },
    { ...success(page), count: 0 },
  ])('requires the exact five-key supabase-js response envelope', async wire => {
    const transport = rpcClient(wire); getAnonymousSupabaseClient.mockReturnValue(transport.client)
    await expect(createBenefitDirectoryRepository().search({ pageSize: 20 })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it.each([
    { code: 'XX000', message: 'private', details: null, hint: null, reviewer_id: 'private' },
    { code: 'XX000', message: 'private', details: { nested: 'private' }, hint: null },
    { code: 'XX000', message: 'private', details: null, hint: null, status: 429 },
  ])('rejects malformed or leaking PostgREST errors', async error => {
    const transport = rpcClient({ data: null, error, count: null, status: 500, statusText: 'Error' })
    getAnonymousSupabaseClient.mockReturnValue(transport.client)
    const result = await createBenefitDirectoryRepository().search({ pageSize: 20 })
    expect(result).toEqual({ ok: false, error: { code: 'invalid_response', message: '서버 응답을 확인할 수 없습니다.' } })
    expect(JSON.stringify(result)).not.toContain('private')
  })
})
