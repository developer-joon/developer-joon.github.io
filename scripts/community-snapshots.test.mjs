#!/usr/bin/env node

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadLivePages, publishSnapshotArtifacts } from './community-snapshots.mjs'

const scripts = path.dirname(fileURLToPath(import.meta.url))
const generator = path.join(scripts, 'community-snapshots.mjs')
const publishedFixture = path.join(scripts, 'fixtures/community-snapshots.json')
const UUID = '11111111-1111-4111-8111-111111111111'
const SNAPSHOT_AT = '2026-09-30T00:00:00.123456Z'
const PUBLISHABLE_KEY = 'sb_publishable_1234567890123456789012_12345678'

function post(overrides = {}) {
  return {
    id: UUID,
    title: 'Safe <title> & test',
    body_markdown: '# Hello\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(2)) [private](https://demo.supabase.co/storage/v1/object/sign/private/a.png?token=SECRET_BODY_TOKEN) [session](https://example.com/a?session=SECRET_SESSION) [jwt](https://example.com/a?jwt=SECRET_JWT)\n\n**bold** and `code`',
    created_at: '2026-09-28T01:02:03.000Z',
    updated_at: '2026-09-29T04:05:06.000Z',
    author: { login: 'octo<cat>', display_name: 'Octo & Cat' },
    tags: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', slug: 'news', label: 'News & Updates' }],
    ...overrides,
  }
}

function page(items, has_more = false, overrides = {}) {
  const last = items.at(-1)
  return {
    items,
    has_more,
    snapshot_at: SNAPSHOT_AT,
    next_cursor_created_at: has_more ? last.created_at : null,
    next_cursor_id: has_more ? last.id : null,
    ...overrides,
  }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value))
}

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'community-snapshots-'))
  const fixture = path.join(root, 'fixture.json')
  const output = path.join(root, 'content')
  const sitemap = path.join(root, 'sitemap.xml')
  await writeFile(sitemap, '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://www.breadlab.ai/</loc></url>\n</urlset>\n')
  return { root, fixture, output, sitemap }
}

function run({ fixture, output, sitemap }, env = {}) {
  return spawnSync(process.execPath, [generator, '--fixture', fixture, '--output', output, '--sitemap', sitemap], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...env },
  })
}

async function withSetup(fn) {
  const context = await setup()
  try { await fn(context) } finally { await rm(context.root, { recursive: true, force: true }) }
}

test('published fixture generates canonical metadata, JSON-LD, author, tags, dates, and SPA link', async () => {
  await withSetup(async (ctx) => {
    ctx.fixture = publishedFixture
    const result = run(ctx)
    assert.equal(result.status, 0, result.stderr)
    const html = await readFile(path.join(ctx.output, UUID, 'index.html'), 'utf8')
    const canonical = `https://www.breadlab.ai/community/content/${UUID}/`
    assert.match(html, new RegExp(`<link rel="canonical" href="${canonical}">`))
    assert.match(html, new RegExp(`<meta property="og:url" content="${canonical}">`))
    assert.match(html, /<meta property="og:type" content="article">/)
    assert.match(html, /<meta name="twitter:card" content="summary">/)
    assert.match(html, /<script type="application\/ld\+json">/)
    assert.match(html, /"@type":"BlogPosting"/)
    assert.match(html, /Octo &amp; Cat/)
    assert.match(html, /News &amp; Updates/)
    assert.match(html, /datetime="2026-09-28T01:02:03.000Z"/)
    assert.match(html, new RegExp(`href="/community/post/\\?id=${UUID}"`))
  })
})

test('accepts PostgreSQL canonical seeded tag IDs in live snapshot rows', async () => {
  await withSetup(async (ctx) => {
    const seededTag = { id: 'a1000000-0000-0000-0000-000000000006', slug: 'revenue-model', label: '수익모델' }
    await writeJson(ctx.fixture, [page([post({ tags: [seededTag] })])])

    const result = run(ctx)

    assert.equal(result.status, 0, result.stderr)
    const html = await readFile(path.join(ctx.output, UUID, 'index.html'), 'utf8')
    assert.match(html, /수익모델/)
  })
})

test('escapes raw HTML and strips dangerous or credential-bearing Markdown URLs', async () => {
  await withSetup(async (ctx) => {
    await writeJson(ctx.fixture, [page([post()])])
    const result = run(ctx)
    assert.equal(result.status, 0, result.stderr)
    const html = await readFile(path.join(ctx.output, UUID, 'index.html'), 'utf8')
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
    assert.doesNotMatch(html, /<script>alert/)
    assert.doesNotMatch(html, /javascript:/i)
    assert.doesNotMatch(html, /data:/i)
    assert.doesNotMatch(html, /SECRET_BODY_TOKEN/)
    assert.doesNotMatch(html, /SECRET_SESSION|SECRET_JWT/)
    assert.match(html, /<strong>bold<\/strong>/)
    assert.match(html, /<code>code<\/code>/)
  })
})

test('merges deterministic snapshot URLs without duplicating existing locs', async () => {
  await withSetup(async (ctx) => {
    const second = '22222222-2222-4222-8222-222222222222'
    await writeJson(ctx.fixture, [page([post(), post({ id: second, title: 'Second' })])])
    const existing = `https://www.breadlab.ai/community/content/${UUID}/`
    await writeFile(ctx.sitemap, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${existing}</loc></url></urlset>`)
    assert.equal(run(ctx).status, 0)
    const xml = await readFile(ctx.sitemap, 'utf8')
    assert.equal(xml.split(existing).length - 1, 1)
    assert.ok(xml.indexOf(UUID) < xml.indexOf(second), 'snapshot locations must be sorted')
  })
})

test('removes stale snapshot locations while merging the current deterministic set', async () => {
  await withSetup(async (ctx) => {
    const stale = 'https://www.breadlab.ai/community/content/33333333-3333-4333-8333-333333333333/'
    await writeFile(ctx.sitemap, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${stale}</loc><lastmod>2020-01-01</lastmod></url></urlset>`)
    await writeJson(ctx.fixture, [page([post()])])
    assert.equal(run(ctx).status, 0)
    const xml = await readFile(ctx.sitemap, 'utf8')
    assert.doesNotMatch(xml, /33333333-3333-4333-8333-333333333333/)
    assert.match(xml, new RegExp(UUID))
  })
})

test('atomically replaces output and removes stale snapshots', async () => {
  await withSetup(async (ctx) => {
    await mkdir(path.join(ctx.output, 'stale'), { recursive: true })
    await writeFile(path.join(ctx.output, 'stale/index.html'), 'stale')
    await writeJson(ctx.fixture, [page([post()])])
    assert.equal(run(ctx).status, 0)
    await assert.rejects(readFile(path.join(ctx.output, 'stale/index.html')))
  })
})

for (const [name, fixture] of [
  ['unknown page key', [page([], false, { surprise: true })]],
  ['unknown post key', [page([post({ surprise: true })])]],
  ['invalid UUID', [page([post({ id: '../escape' })])]],
  ['invalid timestamp ordering', [page([post({ updated_at: '2020-01-01T00:00:00.000Z' })])]],
  ['impossible calendar timestamp', [page([post({ created_at: '2026-02-30T01:02:03.000Z' })])]],
  ['item created after the snapshot cutoff', [page([post({ created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' })])]],
  ['item updated after the snapshot cutoff', [page([post({ updated_at: '2026-10-01T00:00:00.000Z' })])]],
  ['oversized body', [page([post({ body_markdown: 'x'.repeat(200_001) })])]],
  ['page over 100 posts', [page(Array.from({ length: 101 }, (_, index) => post({ id: `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111` })))]],
  ['cursor mismatch', [page([post()], true, { next_cursor_id: '22222222-2222-4222-8222-222222222222' })]],
  ['cursor loop', [page([post()], true), page([post()], true)]],
  ['duplicate post ID', [page([post()], true), page([post()])]],
]) {
  test(`rejects ${name} without logging post bodies`, async () => {
    await withSetup(async (ctx) => {
      await writeJson(ctx.fixture, fixture)
      const result = run(ctx)
      assert.notEqual(result.status, 0)
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, /SECRET_BODY_TOKEN|<script>alert/)
    })
  })
}

test('rejects cursor timestamps that differ below millisecond precision', async () => {
  await withSetup(async (ctx) => {
    const item = post({ created_at: '2026-09-28T01:02:03.123456Z' })
    await writeJson(ctx.fixture, [page([item], true, { next_cursor_created_at: '2026-09-28T01:02:03.123457Z' }), page([])])
    const result = run(ctx)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /cursor\/item mismatch/)
  })
})

test('orders cursor pages by exact created_at microseconds before id', async () => {
  await withSetup(async (ctx) => {
    const later = post({ created_at: '2026-09-28T01:02:03.000002Z' })
    const earlier = post({ id: '22222222-2222-4222-8222-222222222222', created_at: '2026-09-28T01:02:03.000001Z' })
    await writeJson(ctx.fixture, [page([later, earlier])])
    const result = run(ctx)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /strictly ordered/)
  })
})

test('accepts equivalent microsecond timestamps with timezone offsets', async () => {
  await withSetup(async (ctx) => {
    const item = post({ created_at: '2026-09-28T10:02:03.123456+09:00' })
    await writeJson(ctx.fixture, [page([item], true, { next_cursor_created_at: '2026-09-28T01:02:03.123456Z' }), page([])])
    const result = run(ctx)
    assert.equal(result.status, 0, result.stderr)
  })
})

test('strips cloud-signed query URLs and credential-bearing fragments but keeps benign anchors', async () => {
  await withSetup(async (ctx) => {
    const body_markdown = [
      '[aws](https://example.com/a?X-Amz-Credential=AKIA_TEST)',
      '[aws-signature](https://example.com/a?X-Amz-Signature=SECRET_AWS)',
      '[gcp](https://example.com/a?X-Goog-Signature=SECRET_GCP)',
      '[fragment](https://example.com/callback#access_token=SECRET_FRAGMENT)',
      '[encoded-query](https://example.com/a?access_token%3DSECRET_ENCODED_QUERY)',
      '[encoded-fragment](https://example.com/callback#access_token%3DSECRET_ENCODED_FRAGMENT)',
      '[nested-encoded-query](https://example.com/a?safe=ok%26access_token%3DSECRET_NESTED_QUERY)',
      '[nested-encoded-fragment](https://example.com/callback#safe%26access_token%3DSECRET_NESTED_FRAGMENT)',
      '[invalid-utf8-query](https://example.com/a?safe=ok%26access_token%3DSECRET_INVALID_UTF8%E0%A4)',
      '[depth-four-query](https://example.com/a?safe=ok%25252526access_token%2525253DSECRET_DEPTH_FOUR)',
      '[anchor](https://example.com/docs#installation)',
    ].join(' ')
    await writeJson(ctx.fixture, [page([post({ body_markdown })])])
    const result = run(ctx)
    assert.equal(result.status, 0, result.stderr)
    const html = await readFile(path.join(ctx.output, UUID, 'index.html'), 'utf8')
    assert.doesNotMatch(html, /AKIA_TEST|SECRET_AWS|SECRET_GCP|SECRET_FRAGMENT|SECRET_ENCODED_QUERY|SECRET_ENCODED_FRAGMENT|SECRET_NESTED_QUERY|SECRET_NESTED_FRAGMENT|SECRET_INVALID_UTF8|SECRET_DEPTH_FOUR/)
    assert.match(html, /href="https:\/\/example\.com\/docs#installation"/)
  })
})

test('accepts transformed exported bodies above the stored-body character limit when byte-bounded', async () => {
  await withSetup(async (ctx) => {
    await writeJson(ctx.fixture, [page([post({ body_markdown: 'x'.repeat(100_000) })])])
    const result = run(ctx)
    assert.equal(result.status, 0, result.stderr)
  })
})

test('rejects more than 5000 posts and excessive aggregate body bytes', async () => {
  await withSetup(async (ctx) => {
    const pages = []
    for (let p = 0; p < 51; p += 1) {
      const posts = Array.from({ length: 100 }, (_, i) => post({
        id: `${String(p * 100 + i).padStart(8, '0')}-1111-4111-8111-111111111111`,
        body_markdown: 'x'.repeat(20_000),
      }))
      pages.push(page(posts, p < 50))
    }
    await writeJson(ctx.fixture, pages)
    const result = run(ctx)
    assert.notEqual(result.status, 0)
  })
})

test('rejects malformed sitemap and leaves old output untouched', async () => {
  await withSetup(async (ctx) => {
    await mkdir(ctx.output, { recursive: true })
    await writeFile(path.join(ctx.output, 'sentinel'), 'old')
    await writeFile(ctx.sitemap, '<urlset><url><loc>https://example.com/</url></loc></urlset>')
    await writeJson(ctx.fixture, [page([post()])])
    const result = run(ctx)
    assert.notEqual(result.status, 0)
    assert.equal(await readFile(path.join(ctx.output, 'sentinel'), 'utf8'), 'old')
  })
})

test('restores output and sitemap when the sitemap commit rename fails', async () => {
  await withSetup(async (ctx) => {
    const oldSitemap = await readFile(ctx.sitemap, 'utf8')
    await mkdir(ctx.output, { recursive: true })
    await writeFile(path.join(ctx.output, 'sentinel'), 'old output')
    const newSitemap = oldSitemap.replace('</urlset>', `  <url><loc>https://www.breadlab.ai/community/content/${UUID}/</loc></url>\n</urlset>`)
    const renameWithSitemapCommitFailure = async (source, destination) => {
      if (destination === ctx.sitemap && path.basename(source).startsWith('.sitemap.xml.tmp-')) {
        throw new Error('injected sitemap commit failure')
      }
      await rename(source, destination)
    }

    await assert.rejects(
      publishSnapshotArtifacts(ctx.output, ctx.sitemap, [post()], newSitemap, { rename: renameWithSitemapCommitFailure }),
      /injected sitemap commit failure/,
    )
    assert.equal(await readFile(path.join(ctx.output, 'sentinel'), 'utf8'), 'old output')
    assert.equal(await readFile(ctx.sitemap, 'utf8'), oldSitemap)
    assert.deepEqual((await readdir(ctx.root)).sort(), ['content', 'sitemap.xml'])
  })
})

test('refuses service-role credentials before reading fixture', async () => {
  await withSetup(async (ctx) => {
    await writeJson(ctx.fixture, [page([])])
    const result = run(ctx, { SUPABASE_SERVICE_ROLE_KEY: 'must-not-be-used' })
    assert.notEqual(result.status, 0)
    assert.doesNotMatch(result.stderr, /must-not-be-used/)
    assert.match(result.stderr, /service-role/i)
  })
})

test('accepts legacy anon JWTs and rejects privileged, malformed, or weak publishable keys before fetch', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  const canonicalSignature = Buffer.alloc(32).toString('base64url')
  const jwt = (role, header = { alg: 'HS256', typ: 'JWT' }, payload = { role }, signature = canonicalSignature) => [
    Buffer.from(JSON.stringify(header)).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    signature,
  ].join('.')
  globalThis.fetch = async () => {
    calls += 1
    const payload = new TextEncoder().encode(JSON.stringify(page([])))
    return { ok: true, status: 200, headers: { get: () => String(payload.byteLength) }, body: new ReadableStream({ start(controller) { controller.enqueue(payload); controller.close() } }) }
  }
  try {
    await loadLivePages({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: jwt('anon') })
    assert.equal(calls, 2)
    const encodedAnon = Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')
    for (const key of [
      'sb_secret_example', jwt('service_role'), 'not-a-publishable-key', 'sb_publishable_',
      ' sb_publishable_1234567890123456789012_12345678', 'sb_publishable_short',
      'sb_publishable_123456789012345678901_12345678', 'sb_publishable_1234567890123456789012_1234567',
      `.${encodedAnon}.`, jwt('anon', { alg: 'none', typ: 'JWT' }), jwt('anon', { alg: 'HS256', typ: 'jwt' }),
      jwt('anon', []), jwt('anon', { alg: 'HS256', typ: 'JWT' }, []),
      jwt('anon', undefined, undefined, 'a'.repeat(43)),
      `${jwt('anon').split('.').slice(0, 2).join('.')}.short`, `${jwt('anon').split('.').slice(0, 2).join('.')}.$bad`,
    ]) {
      await assert.rejects(
        loadLivePages({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: key }),
        /publishable credential/i,
      )
    }
    assert.equal(calls, 2, 'invalid credentials must fail before fetch')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('live mode paginates the public RPC twice with only the publishable credential', async () => {
  const secondId = '22222222-2222-4222-8222-222222222222'
  const second = post({ id: secondId, title: 'Second', created_at: '2026-09-29T01:02:03.000Z', updated_at: '2026-09-29T04:05:06.000Z' })
  const responses = [page([post()], true), page([second]), page([post()], true), page([second])]
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options, body: JSON.parse(options.body) })
    const payload = new TextEncoder().encode(JSON.stringify(responses.shift()))
    return { ok: true, status: 200, headers: { get: () => String(payload.byteLength) }, body: new ReadableStream({ start(controller) { controller.enqueue(payload); controller.close() } }) }
  }
  try {
    const pages = await loadLivePages({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY })
    assert.equal(pages.length, 2)
    assert.equal(calls.length, 4, 'live mode must perform two independent sweeps')
    assert.equal(calls[0].url, 'https://project.supabase.co/rest/v1/rpc/list_public_community_snapshots_v1')
    assert.equal(calls[0].options.headers.apikey, PUBLISHABLE_KEY)
    assert.equal(calls[0].options.headers.Authorization, undefined)
    assert.deepEqual(Object.keys(calls[0].options.headers).sort(), ['Accept', 'Content-Type', 'apikey'].sort())
    assert.deepEqual(calls[0].body, { p_limit: 100, p_snapshot_at: null, p_cursor_created_at: null, p_cursor_id: null })
    assert.deepEqual(calls[1].body, { p_limit: 100, p_snapshot_at: SNAPSHOT_AT, p_cursor_created_at: post().created_at, p_cursor_id: UUID })
    assert.deepEqual(calls[2].body, { p_limit: 100, p_snapshot_at: null, p_cursor_created_at: null, p_cursor_id: null })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('live mode stops streaming as soon as the response byte limit is exceeded', async () => {
  const originalFetch = globalThis.fetch
  let chunks = 0
  let arrayBufferCalled = false
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      async *[Symbol.asyncIterator]() {
        while (chunks < 100) {
          chunks += 1
          yield new Uint8Array(1_000_000)
        }
      },
    },
    arrayBuffer: async () => { arrayBufferCalled = true; throw new Error('must not buffer unbounded body') },
  })
  try {
    await assert.rejects(
      loadLivePages({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY }),
      /response exceeds limit/,
    )
    assert.equal(arrayBufferCalled, false)
    assert.ok(chunks < 100, `stream was consumed after crossing its byte limit (${chunks} chunks)`)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('live mode enforces post count before fetching remaining pages', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  const pages = Array.from({ length: 52 }, (_, pageIndex) => {
    const items = Array.from({ length: 100 }, (_, itemIndex) => post({
      id: `${String(pageIndex * 100 + itemIndex).padStart(8, '0')}-1111-4111-8111-111111111111`,
    }))
    return page(items, pageIndex < 51)
  })
  globalThis.fetch = async () => {
    calls += 1
    const payload = new TextEncoder().encode(JSON.stringify(pages.shift()))
    return { ok: true, status: 200, headers: { get: () => String(payload.byteLength) }, body: new ReadableStream({ start(controller) { controller.enqueue(payload); controller.close() } }) }
  }
  try {
    await assert.rejects(
      loadLivePages({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY }),
      /post capacity exceeded/,
    )
    assert.equal(calls, 51)
    assert.equal(pages.length, 1, 'remaining page must not be fetched after the post limit fails')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('live mode enforces aggregate body bytes before fetching remaining pages', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  const pages = Array.from({ length: 5 }, (_, pageIndex) => {
    const items = Array.from({ length: 100 }, (_, itemIndex) => post({
      id: `${String(pageIndex * 100 + itemIndex).padStart(8, '0')}-1111-4111-8111-111111111111`,
      body_markdown: '한'.repeat(50_000),
    }))
    return page(items, pageIndex < 4)
  })
  globalThis.fetch = async () => {
    calls += 1
    const payload = new TextEncoder().encode(JSON.stringify(pages.shift()))
    return { ok: true, status: 200, headers: { get: () => String(payload.byteLength) }, body: new ReadableStream({ start(controller) { controller.enqueue(payload); controller.close() } }) }
  }
  try {
    await assert.rejects(
      loadLivePages({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY }),
      /body capacity exceeded/,
    )
    assert.equal(calls, 4)
    assert.equal(pages.length, 1, 'remaining page must not be fetched after the aggregate limit fails')
  } finally {
    globalThis.fetch = originalFetch
  }
})

for (const [change, secondSweep] of [
  ['update', [post({ title: 'Changed concurrently' })]],
  ['hide', []],
  ['delete', []],
  ['insert', [post(), post({ id: '22222222-2222-4222-8222-222222222222', created_at: '2026-09-29T01:02:03.000Z' })]],
]) {
  test(`live mode rejects concurrent ${change} drift between its two complete sweeps`, async () => {
    const originalFetch = globalThis.fetch
    const responses = [page([post()]), page(secondSweep)]
    let calls = 0
    globalThis.fetch = async () => {
      calls += 1
      const payload = new TextEncoder().encode(JSON.stringify(responses.shift()))
      return { ok: true, status: 200, headers: { get: () => String(payload.byteLength) }, body: new ReadableStream({ start(controller) { controller.enqueue(payload); controller.close() } }) }
    }
    try {
      await assert.rejects(
        loadLivePages({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY }),
        /changed between live snapshot sweeps/,
      )
      assert.equal(calls, 2)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
}
