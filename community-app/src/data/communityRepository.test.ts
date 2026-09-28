import { describe, expect, it, vi } from 'vitest'

const browserClient = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ getSupabaseClient: () => browserClient }))
vi.mock('../config/env', () => ({
  parseEnv: () => ({
    supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co',
    supabasePublishableKey: 'sb_publishable_test',
  }),
}))

import { createCommunityRepository, getCommunityRepository, type CommunityClient, type QueryResponse } from './communityRepository'

const row = {
  row_number: 1,
  id: 'post-1', title: '첫 글', excerpt: '서버 요약',
  created_at: '2026-09-27T00:00:00Z', updated_at: '2026-09-27T00:00:00Z',
  is_locked: false, is_pinned: true,
  author_id: 'author-1', author_login: 'bread', author_display_name: null, author_avatar_url: null,
  tags: [
    { id: 'tag-1', slug: 'typescript', label: 'TypeScript' },
    { id: 'tag-2', slug: 'testing', label: 'Testing' },
  ],
  comment_count: 3, reaction_count: 4, popularity_score: 11, rank_key: 11, search_rank: 0.8,
}

const detailRow = {
  id: '56000000-0000-4000-8000-000000000010', title: row.title, body_markdown: '전체 본문',
  created_at: row.created_at, updated_at: row.updated_at,
  is_locked: row.is_locked, is_pinned: row.is_pinned,
  author_id: '56000000-0000-4000-8000-000000000030', author_login: row.author_login,
  author_display_name: row.author_display_name, author_avatar_url: row.author_avatar_url,
  tags: [
    { id: '56000000-0000-4000-8000-000000000040', slug: 'typescript', label: 'TypeScript' },
    { id: '56000000-0000-4000-8000-000000000041', slug: 'testing', label: 'Testing' },
  ], comment_count: row.comment_count,
  reaction_count: row.reaction_count, popularity_score: row.popularity_score, attachment_count: 4,
}

function setup() {
  const calls: Array<{ method: string; args: unknown }> = []
  let listResponse: QueryResponse = { data: [], error: null }
  let detailResponse: QueryResponse = { data: null, error: null }
  let commentsResponse: QueryResponse = { data: { items: [], has_more: false, next_cursor: null }, error: null }
  let mutationResponse: QueryResponse = { data: 'post-1', error: null }
  const client: CommunityClient = {
    publicAttachmentUrl(attachmentId) { return `https://abcdefghijklmnopqrst.supabase.co/functions/v1/public-attachment/${attachmentId}` },
    listTags() { calls.push({ method: 'listTags', args: null }); return Promise.resolve({ data: [], error: null }) },
    rpc(fn, args) {
      calls.push({ method: fn, args })
      if (fn === 'list_public_posts') return Promise.resolve(listResponse)
      if (fn === 'get_public_post_v2') return Promise.resolve(detailResponse)
      if (fn === 'list_public_post_comments') return Promise.resolve(commentsResponse)
      return Promise.resolve(mutationResponse)
    },
  }
  return {
    repository: createCommunityRepository(client), calls,
    setListResponse(value: QueryResponse) { listResponse = value },
    setDetailResponse(value: QueryResponse) { detailResponse = value },
    setCommentsResponse(value: QueryResponse) { commentsResponse = value },
    setMutationResponse(value: QueryResponse) { mutationResponse = value },
  }
}

describe('community repository public list contract', () => {
  it('calls the bounded public comment RPC with an explicit first-page cursor', async () => {
    const value = setup()
    const repository = value.repository as unknown as {
      listComments(input: { postId: string; limit: number }): Promise<unknown>
    }

    await repository.listComments({ postId: '56000000-0000-4000-8000-000000000010', limit: 50 })

    expect(value.calls).toEqual([{ method: 'list_public_post_comments', args: {
      p_post_id: '56000000-0000-4000-8000-000000000010',
      p_limit: 50,
      p_cursor_root_created_at: undefined,
      p_cursor_root_id: undefined,
      p_cursor_is_reply: undefined,
      p_cursor_created_at: undefined,
      p_cursor_id: undefined,
    } }])
  })

  it('maps a comment page and sends every keyset cursor field exactly', async () => {
    const value = setup()
    const cursor = {
      rootCreatedAt: '2026-09-27T00:00:00Z',
      rootId: '56000000-0000-4000-8000-000000000020',
      isReply: true,
      createdAt: '2026-09-27T00:01:00Z',
      id: '56000000-0000-4000-8000-000000000021',
    }
    value.setCommentsResponse({ data: {
      items: [{
        id: cursor.id, parent_id: cursor.rootId, body_markdown: '**답글**',
        created_at: cursor.createdAt, updated_at: cursor.createdAt,
        author_id: '56000000-0000-4000-8000-000000000030', author_login: 'reply-author',
        author_display_name: null, author_avatar_url: null,
      }],
      has_more: true,
      next_cursor: {
        root_created_at: cursor.rootCreatedAt, root_id: cursor.rootId, is_reply: cursor.isReply,
        created_at: cursor.createdAt, id: cursor.id,
      },
    }, error: null })

    const result = await value.repository.listComments({
      postId: '56000000-0000-4000-8000-000000000010', limit: 50, cursor,
    })

    expect(value.calls).toEqual([{ method: 'list_public_post_comments', args: {
      p_post_id: '56000000-0000-4000-8000-000000000010', p_limit: 50,
      p_cursor_root_created_at: cursor.rootCreatedAt, p_cursor_root_id: cursor.rootId,
      p_cursor_is_reply: true, p_cursor_created_at: cursor.createdAt, p_cursor_id: cursor.id,
    } }])
    expect(result).toEqual({ ok: true, data: {
      items: [{
        id: cursor.id, parentId: cursor.rootId, bodyMarkdown: '**답글**',
        createdAt: cursor.createdAt, updatedAt: cursor.createdAt,
        author: { id: '56000000-0000-4000-8000-000000000030', login: 'reply-author', displayName: null, avatarUrl: null },
      }],
      hasMore: true,
      nextCursor: cursor,
    } })
  })

  it.each([
    { items: [], has_more: false, next_cursor: null, extra: true },
    { items: [], has_more: true, next_cursor: null },
    { items: [], has_more: false, next_cursor: { root_created_at: 'bad', root_id: 'x', is_reply: false, created_at: 'bad', id: 'x' } },
    { items: [{ id: 'bad' }], has_more: false, next_cursor: null },
    { items: [{
      id: '56000000-0000-4000-8000-000000000021', parent_id: null, body_markdown: 'ok',
      created_at: '2026-09-27T00:00:00Z', updated_at: '2026-09-27T00:00:00Z',
      author_id: '56000000-0000-4000-8000-000000000030', author_login: 'author',
      author_display_name: null, author_avatar_url: null, leak: true,
    }], has_more: false, next_cursor: null },
  ])('rejects malformed comment payload %o as INVALID_RESPONSE', async (data) => {
    const value = setup()
    value.setCommentsResponse({ data, error: null })

    expect(await value.repository.listComments({ postId: '56000000-0000-4000-8000-000000000010', limit: 50 })).toEqual({
      ok: false,
      error: { code: 'unknown', sourceCode: 'INVALID_RESPONSE', message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
    })
  })

  it('calls only the typed list RPC and maps server excerpt, counters, and every tag', async () => {
    const value = setup()
    value.setListResponse({ data: [row], error: null })
    const result = await value.repository.listPosts({ limit: 20, sort: 'popular', search: 'needle', tagId: 'tag-1' })
    expect(value.calls).toEqual([{ method: 'list_public_posts', args: {
      p_sort: 'popular', p_limit: 20, p_search: 'needle', p_tag_id: 'tag-1',
      p_cursor_is_pinned: undefined, p_cursor_created_at: undefined, p_cursor_rank: undefined, p_cursor_id: undefined,
      p_cursor_search_rank: undefined,
    } }])
    expect(result.ok && result.data.items[0]).toMatchObject({
      excerpt: '서버 요약', commentCount: 3, reactionCount: 4, popularityScore: 11,
      tags: [{ id: 'tag-1' }, { id: 'tag-2' }],
    })

    browserClient.rpc.mockResolvedValueOnce({ data: [row], error: null })
    await getCommunityRepository().listPosts({ limit: 20, sort: 'popular', search: 'needle', tagId: 'tag-1' })
    expect(browserClient.rpc).toHaveBeenLastCalledWith('list_public_posts', {
      p_sort: 'popular', p_limit: 20, p_search: 'needle', p_tag_id: 'tag-1',
      p_cursor_is_pinned: undefined, p_cursor_created_at: undefined, p_cursor_rank: undefined, p_cursor_id: undefined,
      p_cursor_search_rank: undefined,
    })
  })

  it('uses the complete sort cursor and removes the lookahead row', async () => {
    const value = setup()
    value.setListResponse({ data: [row, { ...row, id: 'post-2', is_pinned: false, rank_key: 7 }], error: null })
    const cursor = { isPinned: true, createdAt: row.created_at, id: row.id, rank: 11, searchRank: 0.8 }
    const result = await value.repository.listPosts({ limit: 1, sort: 'comments', cursor })
    expect(value.calls[0]?.args).toMatchObject({ p_sort: 'comments', p_limit: 1, p_cursor_rank: 11, p_cursor_search_rank: 0.8 })
    expect(result).toMatchObject({ ok: true, data: { items: [{ id: 'post-1' }], nextCursor: cursor } })
  })

  it('preserves repository row order so pinned announcements stay first', async () => {
    const value = setup()
    value.setListResponse({ data: [row, { ...row, id: 'post-2', title: '일반 글', is_pinned: false }], error: null })

    const result = await value.repository.listPosts({ limit: 2, sort: 'newest' })

    expect(result.ok && result.data.items.map((item) => item.id)).toEqual(['post-1', 'post-2'])
    expect(result.ok && result.data.items.map((item) => item.isPinned)).toEqual([true, false])
  })

  it('maps detail body, counters, and all tags from the controlled detail RPC', async () => {
    const value = setup()
    value.setDetailResponse({
      data: { kind: 'published', post: {
        ...detailRow,
        body_markdown: '전체 본문\n\n![one](/functions/v1/public-attachment/56000000-0000-4000-8000-000000000001)\n![two](/functions/v1/public-attachment/56000000-0000-4000-8000-000000000002)',
      } },
      error: null,
    })

    const result = await value.repository.getPost('post-1')

    expect(value.calls).toEqual([{ method: 'get_public_post_v2', args: { p_post_id: 'post-1' } }])
    expect(result).toMatchObject({
      ok: true,
      data: {
        kind: 'published',
        post: {
          id: '56000000-0000-4000-8000-000000000010',
          bodyMarkdown: '전체 본문\n\n![one](https://abcdefghijklmnopqrst.supabase.co/functions/v1/public-attachment/56000000-0000-4000-8000-000000000001)\n![two](https://abcdefghijklmnopqrst.supabase.co/functions/v1/public-attachment/56000000-0000-4000-8000-000000000002)',
          commentCount: 3,
          reactionCount: 4,
          popularityScore: 11,
          attachmentCount: 4,
          tags: [
            { id: '56000000-0000-4000-8000-000000000040' },
            { id: '56000000-0000-4000-8000-000000000041' },
          ],
        },
      },
    })

    browserClient.rpc.mockResolvedValueOnce({ data: { kind: 'published', post: detailRow }, error: null })
    await getCommunityRepository().getPost('post-1')
    expect(browserClient.rpc).toHaveBeenLastCalledWith('get_public_post_v2', { p_post_id: 'post-1' })
  })

  it.each([
    [{ kind: 'not_found' }, { kind: 'not_found' }],
    [{ kind: 'hidden' }, { kind: 'hidden' }],
    [{ kind: 'deleted', comment_count: 2 }, { kind: 'deleted', commentCount: 2 }],
  ])('returns expected content state %o as successful data', async (wire, expected) => {
    const value = setup()
    value.setDetailResponse({ data: wire, error: null })

    expect(await value.repository.getPost('post-1')).toEqual({ ok: true, data: expected })
  })

  it.each([
    null,
    { kind: 'unknown' },
    { kind: 'hidden', title: 'leak' },
    { kind: 'not_found', id: 'leak' },
    { kind: 'deleted', comment_count: -1 },
    { kind: 'deleted', comment_count: 1.5 },
    { kind: 'deleted', comment_count: Number.MAX_SAFE_INTEGER + 1 },
    { kind: 'deleted', comment_count: 1, body_markdown: 'leak' },
    { kind: 'published', post: { ...detailRow, body_markdown: undefined } },
    { kind: 'published', post: { ...detailRow, id: 'not-a-uuid' } },
    { kind: 'published', post: { ...detailRow, author_id: 'not-a-uuid' } },
    { kind: 'published', post: { ...detailRow, created_at: 'not-a-date' } },
    { kind: 'published', post: { ...detailRow, created_at: '2026-02-29T00:00:00Z' } },
    { kind: 'published', post: { ...detailRow, updated_at: '2026-04-31T00:00:00Z' } },
    { kind: 'published', post: { ...detailRow, updated_at: '2026-13-99T00:00:00Z' } },
    { kind: 'published', post: { ...detailRow, tags: [{ id: 'not-a-uuid', slug: 'bad', label: 'Bad' }] } },
    { kind: 'published', post: { ...detailRow, body_markdown: 'body' }, leak: true },
  ])('rejects malformed or leaky detail payload %o as INVALID_RESPONSE', async (data) => {
    const value = setup()
    value.setDetailResponse({ data, error: null })

    expect(await value.repository.getPost('post-1')).toEqual({
      ok: false,
      error: {
        code: 'unknown',
        sourceCode: 'INVALID_RESPONSE',
        message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      },
    })
  })

  it('maps the active tag projection', async () => {
    const calls: string[] = []
    const client: CommunityClient = {
      publicAttachmentUrl: attachmentId => `https://abcdefghijklmnopqrst.supabase.co/functions/v1/public-attachment/${attachmentId}`,
      listTags: () => {
        calls.push('listTags')
        return Promise.resolve({ data: [{ id: '56000000-0000-4000-8000-000000000040', slug: 'typescript', label: 'TypeScript' }], error: null })
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    }

    expect(await createCommunityRepository(client).listTags()).toEqual({
      ok: true,
      data: [{ id: '56000000-0000-4000-8000-000000000040', slug: 'typescript', label: 'TypeScript' }],
    })
    expect(calls).toEqual(['listTags'])
  })

  it.each([
    [{ id: 'not-a-uuid', slug: 'bad', label: 'Bad' }],
    [{ id: '56000000-0000-4000-8000-000000000040', slug: 'typescript', label: 'TypeScript', leak: true }],
    [{ id: '56000000-0000-4000-8000-000000000040', slug: 3, label: 'TypeScript' }],
  ])('rejects malformed active tag rows as INVALID_RESPONSE', async (row) => {
    const client: CommunityClient = {
      publicAttachmentUrl: attachmentId => `https://abcdefghijklmnopqrst.supabase.co/functions/v1/public-attachment/${attachmentId}`,
      listTags: () => Promise.resolve({ data: [row], error: null }),
      rpc: () => Promise.resolve({ data: null, error: null }),
    }

    expect(await createCommunityRepository(client).listTags()).toEqual({
      ok: false,
      error: { code: 'unknown', sourceCode: 'INVALID_RESPONSE', message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
    })
  })
})

describe('community repository mutation response validation', () => {
  it.each(['createPost', 'updatePost', 'deletePost'] as const)('rejects malformed %s success UUIDs', async (method) => {
    const value = setup()
    value.setMutationResponse({ data: 'not-a-uuid', error: null })
    const input = method === 'createPost'
      ? { title: '제목', bodyMarkdown: '본문', tagIds: ['tag-1'], idempotencyKey: 'key' }
      : method === 'updatePost'
        ? { postId: '56000000-0000-4000-8000-000000000010', title: '제목', bodyMarkdown: '본문', tagIds: ['tag-1'] }
        : '56000000-0000-4000-8000-000000000010'
    expect(await (value.repository[method] as (arg: never) => Promise<unknown>)(input as never)).toMatchObject({ ok: false, error: { sourceCode: 'INVALID_RESPONSE' } })
  })
})

describe('community repository mutation failures', () => {
  it.each([
    ['createPost', { title: '제목', bodyMarkdown: '본문', tagIds: ['tag-1'], idempotencyKey: 'key' }, 'PGRST301', 'auth_required'],
    ['createPost', { title: '제목', bodyMarkdown: '본문', tagIds: ['tag-1'], idempotencyKey: 'key' }, '22023', 'validation'],
    ['createPost', { title: '제목', bodyMarkdown: '본문', tagIds: ['tag-1'], idempotencyKey: 'key' }, '23505', 'conflict'],
    ['updatePost', { postId: 'post-1', title: '제목', bodyMarkdown: '본문', tagIds: ['tag-1'] }, '42501', 'forbidden'],
    ['deletePost', 'post-1', '42501', 'forbidden'],
  ] as const)('maps direct %s RPC failure without leaking details', async (method, input, sourceCode, code) => {
    const value = setup()
    value.setMutationResponse({ data: null, error: { code: sourceCode, message: 'secret', details: 'secret' } })
    const result = await (value.repository[method] as (arg: never) => Promise<unknown>)(input as never)
    const messages = {
      auth_required: '로그인이 필요합니다.',
      validation: '입력 내용을 확인해 주세요.',
      conflict: '이미 처리된 요청입니다.',
      forbidden: '요청할 권한이 없습니다.',
    }
    expect(result).toEqual({ ok: false, error: {
      code, sourceCode,
      message: messages[code],
    } })
  })

  it('preserves a domain source code without exposing its raw payload', async () => {
    const value = setup()
    value.setMutationResponse({ data: null, error: { code: 'PGRST', message: '{"code":"rate_limit_exceeded","details":"secret"}' } })
    expect(await value.repository.createPost({ title: '제목', bodyMarkdown: '본문', tagIds: ['tag-1'], idempotencyKey: 'key' }))
      .toEqual({ ok: false, error: { code: 'rate_limited', sourceCode: 'rate_limit_exceeded', message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' } })
  })

  it('maps rejected fetches to a stable network error', async () => {
    const client: CommunityClient = {
      publicAttachmentUrl: attachmentId => `https://abcdefghijklmnopqrst.supabase.co/functions/v1/public-attachment/${attachmentId}`,
      listTags: () => Promise.reject(new TypeError('Failed to fetch')),
      rpc: () => Promise.reject(new TypeError('Failed to fetch')),
    }

    expect(await createCommunityRepository(client).listTags()).toEqual({
      ok: false,
      error: { code: 'network', sourceCode: 'NETWORK_ERROR', message: '네트워크 연결을 확인해 주세요.' },
    })
  })
})
