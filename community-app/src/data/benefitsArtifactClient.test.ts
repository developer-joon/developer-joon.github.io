import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash, webcrypto } from 'node:crypto'
import { BenefitsArtifactClient } from './benefitsArtifactClient'
import { detailsSchema } from '../types/benefits'
const root = `${process.cwd()}/public/`
const fixture = (url: string) =>
  readFileSync(root + url.replace('/community/', ''), 'utf8')
const manifest = '/community/data/company-benefits/manifest.json'
function client(change?: (url: string, raw: string) => string) {
  return new BenefitsArtifactClient(
    async (url: string) =>
      new Response(change?.(url, fixture(url)) ?? fixture(url)),
    webcrypto.subtle as SubtleCrypto,
  )
}
const fixtureManifest = () => JSON.parse(fixture(manifest))
const detailUrl = (id = 'example-001') => fixtureManifest().detail_shards[id]
const encoder = new TextEncoder()
const DETAIL_SHARD_LIMIT = 256_000
const DETAIL_BATCH_LIMIT = 1_000_000

function chunkedResponse(
  chunks: Uint8Array[],
  options: { contentLength?: number; delayMs?: number; onCancel?: () => void } = {},
) {
  let pulls = 0
  let cancelled = false
  const response = new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs))
      if (cancelled) return
      const chunk = chunks[pulls++]
      if (chunk) controller.enqueue(chunk)
      else controller.close()
    },
    cancel() {
      cancelled = true
      options.onCancel?.()
    },
  }, { highWaterMark: 0 }), {
    headers: options.contentLength === undefined
      ? undefined
      : { 'content-length': String(options.contentLength) },
  })
  return { response, pulls: () => pulls }
}

async function loadedClient(
  detailResponse: (url: string, signal?: AbortSignal) => Promise<Response>,
) {
  const c = new BenefitsArtifactClient(async (url, signal) =>
    url.includes('/details/')
      ? detailResponse(url, signal)
      : new Response(fixture(url)), webcrypto.subtle as SubtleCrypto)
  const m = await c.loadManifest()
  const i = await c.loadCompanyIndex(m)
  return { c, m, i }
}
describe('strict immutable benefits artifacts', () => {
  it('loads exact index, rankings and delayed detail counts', async () => {
    const c = client()
    const m = await c.loadManifest()
    const index = await c.loadCompanyIndex(m)
    expect(index.companies).toHaveLength(56)
    expect((await c.loadRankings(m, index)).rows).toHaveLength(560)
    expect(
      (await c.loadCompanyDetail(m, index, 'example-001')).company_id,
    ).toBe('example-001')
    expect(
      (await c.loadCompanyDetails(m, index, ['example-001', 'example-002'])).map(
        (detail) => detail.company_id,
      ),
    ).toEqual(['example-001', 'example-002'])
  })
  it.each([
    'company_count',
    'unknown',
    'status',
    'url',
    'version',
    'score',
    'record',
    'hash',
  ])('fails closed on %s corruption', async (kind) => {
    const c = client((url, raw) => {
      const data = JSON.parse(raw)
      if (url === manifest) {
        if (kind === 'company_count') data.company_count++
        if (kind === 'unknown') data.extra = true
        if (kind === 'url') data.index_url = 'https://evil.test/index.json'
      } else {
        if (kind === 'status' && data.companies)
          data.companies[0].category_summaries.leave.status = 'invented'
        if (kind === 'version') data.data_version = 'other'
        if (kind === 'score' && data.rows) data.rows[0].score = 999
        if (kind === 'record' && data.rows) data.rows[0].company_id = 'unknown'
        if (kind === 'hash') return raw + ' '
      }
      return JSON.stringify(data) + '\n'
    })
    await expect(
      (async () => {
        const m = await c.loadManifest()
        const i = await c.loadCompanyIndex(m)
        await c.loadRankings(m, i)
      })(),
    ).rejects.toThrow()
  })
})

// Re-sign mutations to test semantic validation independently of byte integrity.
function signedMutation(
  target: string,
  mutate: (data: Record<string, unknown>) => void,
) {
  const raw = JSON.parse(fixture(target))
  mutate(raw)
  const body = JSON.stringify(raw) + '\n'
  const m = JSON.parse(fixture(manifest))
  return webcrypto.subtle
    .digest('SHA-256', new TextEncoder().encode(body))
    .then((hash) => {
      m.artifact_sha256[target].sha256 = Array.from(new Uint8Array(hash), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('')
      return new BenefitsArtifactClient(
        async (url) =>
          new Response(
            url === manifest
              ? JSON.stringify(m)
              : url === target
                ? body
                : fixture(url),
          ),
        webcrypto.subtle as SubtleCrypto,
      )
    })
}
it('rejects a re-signed ranking of an unknown category as eligible', async () => {
  const c = await signedMutation(
    '/community/data/company-benefits/fixture-v1/rankings.json',
    (data) => {
      const rows = data.rows as { eligible: boolean; reason: string }[]
      rows[4].eligible = true
      rows[4].reason = ''
    },
  )
  const m = await c.loadManifest()
  const i = await c.loadCompanyIndex(m)
  await expect(c.loadRankings(m, i)).rejects.toThrow('근거')
})
it('rejects duplicate claims even with correct shard hash', async () => {
  const c = await signedMutation(
    detailUrl(),
    (data) => {
      const companies = data.companies as { claims: unknown[] }[]
      companies[0].claims.push(companies[0].claims[0])
    },
  )
  const m = await c.loadManifest()
  const i = await c.loadCompanyIndex(m)
  await expect(c.loadCompanyDetail(m, i, 'example-001')).rejects.toThrow()
})
it('rejects contradictory summary counts in a correctly hashed detail shard', async () => {
  const c = await signedMutation(
    detailUrl(),
    (data) => {
      const companies = data.companies as { claims: { status: string }[] }[]
      companies[0].claims[0].status = '상충'
    },
  )
  const m = await c.loadManifest()
  const i = await c.loadCompanyIndex(m)
  await expect(c.loadCompanyDetail(m, i, 'example-001')).rejects.toThrow()
})
it('rejects a re-signed detail whose claim status contradicts its category summary', async () => {
  const c = await signedMutation(detailUrl(), (data) => {
    const companies = data.companies as {
      claims: { category: string; status: string }[]
    }[]
    companies[0].claims.find((claim) => claim.category === 'health')!.status =
      '확인 불가'
  })
  const m = await c.loadManifest()
  const i = await c.loadCompanyIndex(m)
  await expect(c.loadCompanyDetail(m, i, 'example-001')).rejects.toThrow(
    '상세와 요약 근거 불일치',
  )
})

it.each([
  'http://example.org/benefits',
  'https://evil.test/benefits',
  'https://user:pass@example.org/benefits',
  'javascript:alert(1)',
])('rejects unsafe original source %s even with valid bytes', async (url) => {
  const c = await signedMutation(
    detailUrl(),
    (data) => {
      const companies = data.companies as {
        claims: { source: { url: string } }[]
      }[]
      companies[0].claims[0].source.url = url
    },
  )
  const m = await c.loadManifest()
  const i = await c.loadCompanyIndex(m)
  await expect(c.loadCompanyDetail(m, i, 'example-001')).rejects.toThrow()
})
it.each(['sum', 'reference', 'extra'])(
  'checks ranking %s independently of the hash',
  async (kind) => {
    const c = await signedMutation(
      '/community/data/company-benefits/fixture-v1/rankings.json',
      (data) => {
        const rows = data.rows as {
          score: number
          company_id: string
          extra?: boolean
        }[]
        if (kind === 'sum') rows[0].score = 99
        if (kind === 'reference') rows[0].company_id = 'example-1999'
        if (kind === 'extra') rows[0].extra = true
      },
    )
    const m = await c.loadManifest()
    const i = await c.loadCompanyIndex(m)
    await expect(c.loadRankings(m, i)).rejects.toThrow()
  },
)
it('does not poison immutable caches after a failed read', async () => {
  let fail = true
  const c = new BenefitsArtifactClient(async (url) => {
    const raw = fixture(url)
    return new Response(
      url.endsWith('/rankings.json') && fail ? raw + ' ' : raw,
    )
  }, webcrypto.subtle as SubtleCrypto)
  const m = await c.loadManifest()
  const i = await c.loadCompanyIndex(m)
  await expect(c.loadRankings(m, i)).rejects.toThrow('무결성')
  fail = false
  expect((await c.loadRankings(m, i)).rows).toHaveLength(560)
})
it('requests only the independently bounded shards needed by displayed companies', async () => {
  const requests: { url: string; bytes: number }[] = []
  const c = new BenefitsArtifactClient(async (url) => {
    const raw = fixture(url)
    requests.push({ url, bytes: new TextEncoder().encode(raw).byteLength })
    return new Response(raw)
  }, webcrypto.subtle as SubtleCrypto)
  const m = await c.loadManifest()
  const i = await c.loadCompanyIndex(m)
  requests.length = 0
  await c.loadCompanyDetails(m, i, ['example-001', 'example-002'])
  expect(requests.map(({ url }) => url).sort()).toEqual(
    [m.detail_shards['example-001'], m.detail_shards['example-002']].sort(),
  )
  expect(new Set(requests.map(({ url }) => url))).toHaveLength(2)
  expect(requests.reduce((sum, request) => sum + request.bytes, 0)).toBeLessThan(
    100_000,
  )
})
it('loads detail shards with a fixed concurrency ceiling', async () => {
  let active = 0
  let peak = 0
  const c = new BenefitsArtifactClient(async (url, signal) => {
    if (url.includes('/details/')) {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      signal?.throwIfAborted()
      active--
    }
    return new Response(fixture(url))
  }, webcrypto.subtle as SubtleCrypto)
  const m = await c.loadManifest()
  const i = await c.loadCompanyIndex(m)
  await c.loadCompanyDetails(
    m,
    i,
    i.companies.slice(0, 20).map(({ company_id }) => company_id),
  )
  expect(peak).toBeGreaterThan(1)
  expect(peak).toBeLessThanOrEqual(4)
})
it('fails closed when aggregate detail bytes exceed the batch budget', async () => {
  const changedManifest = fixtureManifest()
  const padded = new Map<string, string>()
  for (const url of Object.values(changedManifest.detail_shards) as string[]) {
    const raw = fixture(url) + ' '.repeat(30_000)
    padded.set(url, raw)
    changedManifest.artifact_sha256[url].sha256 = createHash('sha256')
      .update(raw)
      .digest('hex')
  }
  const c = new BenefitsArtifactClient(async (url) => {
    return new Response(
      url === manifest
        ? JSON.stringify(changedManifest)
        : padded.get(url) ?? fixture(url),
    )
  }, webcrypto.subtle as SubtleCrypto)
  const m = await c.loadManifest()
  const i = await c.loadCompanyIndex(m)
  await expect(
    c.loadCompanyDetails(
      m,
      i,
      i.companies.slice(0, 50).map(({ company_id }) => company_id),
    ),
  ).rejects.toThrow(/상세 데이터.*초과/)
})
it('cancels an oversized streamed shard before reading the remaining network bytes', async () => {
  const chunks = Array.from({ length: 16 }, () => new Uint8Array(32_000).fill(0x20))
  let cancelled = 0
  let stream: ReturnType<typeof chunkedResponse> | undefined
  const state = await loadedClient(async () => {
    stream = chunkedResponse(chunks, { onCancel: () => cancelled++ })
    return stream.response
  })
  await expect(
    state.c.loadCompanyDetail(state.m, state.i, 'example-001'),
  ).rejects.toThrow('데이터 크기 초과')
  expect(cancelled).toBe(1)
  expect(stream!.pulls()).toBeLessThan(chunks.length)
})
it('rejects an over-limit Content-Length without reading even when the body is smaller', async () => {
  let cancelled = 0
  let stream: ReturnType<typeof chunkedResponse> | undefined
  const state = await loadedClient(async (url) => {
    stream = chunkedResponse([encoder.encode(fixture(url))], {
      contentLength: DETAIL_SHARD_LIMIT + 1,
      onCancel: () => cancelled++,
    })
    return stream.response
  })
  await expect(
    state.c.loadCompanyDetail(state.m, state.i, 'example-001'),
  ).rejects.toThrow('데이터 크기 초과')
  expect(stream!.pulls()).toBe(0)
  expect(cancelled).toBe(1)
})
it('does not trust an underreported Content-Length and counts multibyte network bytes', async () => {
  const raw = fixture(detailUrl()) + '가'.repeat(90_000)
  expect(raw.length).toBeLessThan(DETAIL_SHARD_LIMIT)
  expect(encoder.encode(raw).byteLength).toBeGreaterThan(DETAIL_SHARD_LIMIT)
  let cancelled = 0
  const state = await loadedClient(async () => {
    const bytes = encoder.encode(raw)
    return chunkedResponse(
      Array.from({ length: Math.ceil(bytes.length / 32_000) }, (_, index) =>
        bytes.slice(index * 32_000, (index + 1) * 32_000)),
      { contentLength: 1, onCancel: () => cancelled++ },
    ).response
  })
  await expect(
    state.c.loadCompanyDetail(state.m, state.i, 'example-001'),
  ).rejects.toThrow('데이터 크기 초과')
  expect(cancelled).toBe(1)
})
it('bounds aggregate streamed bytes across four workers and cancels the batch', async () => {
  const requestedIds = ['example-001', 'example-002', 'example-003', 'example-004']
  let delivered = 0
  let cancelled = 0
  const state = await loadedClient(async (url) => {
    const fixtureBytes = encoder.encode(fixture(url))
    const bytes = new Uint8Array(255_000).fill(0x20)
    bytes.set(fixtureBytes)
    const chunks = Array.from({ length: Math.ceil(bytes.length / 32_000) }, (_, index) =>
      bytes.slice(index * 32_000, (index + 1) * 32_000))
    return new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift()
        if (!chunk) return controller.close()
        delivered += chunk.byteLength
        controller.enqueue(chunk)
      },
      cancel() { cancelled++ },
    }, { highWaterMark: 0 }))
  })
  await expect(
    state.c.loadCompanyDetails(state.m, state.i, requestedIds),
  ).rejects.toThrow('상세 데이터 배치 크기 초과')
  expect(cancelled).toBeGreaterThan(0)
  expect(delivered).toBeLessThanOrEqual(DETAIL_BATCH_LIMIT + 4 * 32_000)
})
it('cancels a pending response reader when its caller aborts', async () => {
  const controller = new AbortController()
  let cancelled = 0
  const state = await loadedClient(async () => chunkedResponse(
    [encoder.encode(fixture(detailUrl()))],
    { delayMs: 50, onCancel: () => cancelled++ },
  ).response)
  const pending = state.c.loadCompanyDetail(
    state.m,
    state.i,
    'example-001',
    controller.signal,
  )
  await new Promise((resolve) => setTimeout(resolve, 5))
  controller.abort()
  await expect(pending).rejects.toHaveProperty('name', 'AbortError')
  expect(cancelled).toBe(1)
})
it('uses bounded text fallback for fetch mocks without a response body', async () => {
  const state = await loadedClient(async (url) => ({
    ok: true,
    headers: new Headers(),
    body: null,
    text: async () => fixture(url),
  }) as Response)
  await expect(
    state.c.loadCompanyDetail(state.m, state.i, 'example-001'),
  ).resolves.toHaveProperty('company_id', 'example-001')
})
it('rejects malformed UTF-8 instead of replacement-decoding accepted bytes', async () => {
  const state = await loadedClient(async () => new Response(
    new Uint8Array([0x7b, 0xff, 0x7d]),
  ))
  await expect(
    state.c.loadCompanyDetail(state.m, state.i, 'example-001'),
  ).rejects.toThrow('UTF-8')
})
it('rejects a company with more than the schema claim/source cap', async () => {
  const data = JSON.parse(fixture(detailUrl()))
  const company = (data.companies as { claims: Record<string, unknown>[] }[])[0]
  const original = company.claims[0]
  company.claims = Array.from({ length: 101 }, (_, index) => ({
      ...original,
      claim_id: `bounded-claim-${index}`,
      benefit_type: `bounded-benefit-${index}`,
  }))
  const result = detailsSchema.safeParse(data)
  expect(result.success).toBe(false)
  if (!result.success) expect(result.error.issues).toContainEqual(
    expect.objectContaining({ code: 'too_big', path: ['companies', 0, 'claims'] }),
  )
})
it('aborts in-flight detail requests and does not start queued shards after failure', async () => {
  const started: string[] = []
  const aborted: string[] = []
  const c = new BenefitsArtifactClient(async (url, signal) => {
    if (!url.includes('/details/')) return new Response(fixture(url))
    started.push(url)
    if (started.length === 1) return new Response(fixture(url) + 'corrupt')
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 500)
      signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        aborted.push(url)
        reject(signal.reason)
      }, { once: true })
    })
    return new Response(fixture(url))
  }, webcrypto.subtle as SubtleCrypto)
  const m = await c.loadManifest()
  const i = await c.loadCompanyIndex(m)
  await expect(
    c.loadCompanyDetails(
      m,
      i,
      i.companies.slice(0, 20).map(({ company_id }) => company_id),
    ),
  ).rejects.toThrow()
  expect(started.length).toBeLessThanOrEqual(4)
  expect(aborted.length).toBeGreaterThan(0)
})
it('propagates abort through fetch and stops before artifact CPU validation', async () => {
  const controller = new AbortController()
  let receivedSignal: AbortSignal | undefined
  const c = new BenefitsArtifactClient(
    async (url, signal) => {
      receivedSignal = signal
      await new Promise((resolve) => setTimeout(resolve, 0))
      signal?.throwIfAborted()
      return new Response(fixture(url))
    },
    webcrypto.subtle as SubtleCrypto,
  )
  const pending = c.loadManifest(controller.signal)
  controller.abort()
  await expect(pending).rejects.toHaveProperty('name', 'AbortError')
  expect(receivedSignal).toBe(controller.signal)

  const m = fixtureManifest()
  const cpuController = new AbortController()
  let digestCalls = 0
  const abortingSubtle = {
    async digest(...args: Parameters<SubtleCrypto['digest']>) {
      digestCalls++
      cpuController.abort()
      return webcrypto.subtle.digest(...args)
    },
  } as SubtleCrypto
  const cpuClient = new BenefitsArtifactClient(
    async (url) => new Response(fixture(url)),
    abortingSubtle,
  )
  await expect(
    cpuClient.loadCompanyIndex(m, cpuController.signal),
  ).rejects.toHaveProperty('name', 'AbortError')
  expect(digestCalls).toBe(1)
})
