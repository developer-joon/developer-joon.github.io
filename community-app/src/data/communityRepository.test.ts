import { describe, expect, it, vi } from 'vitest'

const browserClient = vi.hoisted(() => ({ rpc: vi.fn(), auth: { getSession: vi.fn(), signOut: vi.fn() } }))
const anonymousBrowserClient = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({
  getSupabaseClient: () => browserClient,
  getAnonymousSupabaseClient: () => anonymousBrowserClient,
}))
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
  reaction_count: row.reaction_count, popularity_score: row.popularity_score, attachment_count: 4, viewer_reacted: false,
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
      if (fn === 'get_public_post_v3') return Promise.resolve(detailResponse)
      if (fn === 'list_public_post_comments_v2') return Promise.resolve(commentsResponse)
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

function staleSessionRecoverySetup() {
  const primaryCalls: string[] = []
  const anonymousCalls: string[] = []
  let primaryResponse: QueryResponse = { data: null, error: { code: 'PGRST303', message: 'JWT expired' } }
  let anonymousResponse: QueryResponse = { data: [], error: null }
  const client = (calls: string[], response: () => QueryResponse): CommunityClient => ({
    publicAttachmentUrl: attachmentId => `https://abcdefghijklmnopqrst.supabase.co/functions/v1/public-attachment/${attachmentId}`,
    listTags: () => { calls.push('listTags'); return Promise.resolve(response()) },
    rpc: (name) => { calls.push(name); return Promise.resolve(response()) },
  })
  const primary = client(primaryCalls, () => primaryResponse)
  const anonymous = client(anonymousCalls, () => anonymousResponse)
  return {
    repository: createCommunityRepository(primary, { anonymousClient: anonymous }),
    primaryCalls,
    anonymousCalls,
    setPrimaryResponse(value: QueryResponse) { primaryResponse = value },
    setAnonymousResponse(value: QueryResponse) { anonymousResponse = value },
  }
}

describe('community repository public list contract', () => {
  it('calls the bounded public comment RPC with an explicit first-page cursor', async () => {
    const value = setup()
    const repository = value.repository as unknown as {
      listComments(input: { postId: string; limit: number }): Promise<unknown>
    }

    await repository.listComments({ postId: '56000000-0000-4000-8000-000000000010', limit: 50 })

    expect(value.calls).toEqual([{ method: 'list_public_post_comments_v2', args: {
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
        kind: 'published', id: cursor.id, parent_id: cursor.rootId, body_markdown: '**답글**',
        created_at: cursor.createdAt, updated_at: cursor.createdAt,
        author_id: '56000000-0000-4000-8000-000000000030', author_login: 'reply-author',
        author_display_name: null, author_avatar_url: null, reaction_count: 2, viewer_reacted: true,
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

    expect(value.calls).toEqual([{ method: 'list_public_post_comments_v2', args: {
      p_post_id: '56000000-0000-4000-8000-000000000010', p_limit: 50,
      p_cursor_root_created_at: cursor.rootCreatedAt, p_cursor_root_id: cursor.rootId,
      p_cursor_is_reply: true, p_cursor_created_at: cursor.createdAt, p_cursor_id: cursor.id,
    } }])
    expect(result).toEqual({ ok: true, data: {
      items: [{
        kind: 'published', id: cursor.id, parentId: cursor.rootId, bodyMarkdown: '**답글**',
        createdAt: cursor.createdAt, updatedAt: cursor.createdAt,
        author: { id: '56000000-0000-4000-8000-000000000030', login: 'reply-author', displayName: null, avatarUrl: null },
        reactionCount: 2, viewerReacted: true,
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
      kind: 'published', id: '56000000-0000-4000-8000-000000000021', parent_id: null, body_markdown: 'ok',
      created_at: '2026-09-27T00:00:00Z', updated_at: '2026-09-27T00:00:00Z',
      author_id: '56000000-0000-4000-8000-000000000030', author_login: 'author',
      author_display_name: null, author_avatar_url: null, reaction_count: 0, viewer_reacted: false, leak: true,
    }], has_more: false, next_cursor: null },
  ])('rejects malformed comment payload %o as INVALID_RESPONSE', async (data) => {
    const value = setup()
    value.setCommentsResponse({ data, error: null })

    expect(await value.repository.listComments({ postId: '56000000-0000-4000-8000-000000000010', limit: 50 })).toEqual({
      ok: false,
      error: { code: 'unknown', sourceCode: 'INVALID_RESPONSE', message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
    })
  })

  it('classifies a stale authenticated JWT on public entry as auth required', async () => {
    const value = setup()
    value.setListResponse({
      data: null,
      error: { code: 'PGRST303', message: 'JWT expired', details: 'stale bearer token' },
    })

    expect(await value.repository.listPosts({ limit: 20, sort: 'newest' })).toEqual({
      ok: false,
      error: {
        code: 'auth_required',
        sourceCode: 'PGRST303',
        message: '로그인이 필요합니다.',
      },
    })
  })

  it.each([
    ['listPosts', 'list_public_posts', { data: [row], error: null }],
    ['getPost', 'get_public_post_v3', { data: { kind: 'published', post: detailRow }, error: null }],
    ['listComments', 'list_public_post_comments_v2', { data: { items: [], has_more: false, next_cursor: null }, error: null }],
    ['listTags', 'listTags', { data: [{ id: '56000000-0000-4000-8000-000000000040', slug: 'typescript', label: 'TypeScript' }], error: null }],
  ] as const)('retries stale public read %s anonymously once without clearing auth storage', async (method, expectedCall, response) => {
    const value = staleSessionRecoverySetup()
    value.setAnonymousResponse(response)
    const inputs = {
      listPosts: { limit: 20, sort: 'newest' as const },
      getPost: detailRow.id,
      listComments: { postId: detailRow.id, limit: 50 },
      listTags: undefined,
    }

    const result = await (value.repository[method] as (input?: never) => Promise<unknown>)(inputs[method] as never)

    expect(result).toMatchObject({
      ok: true,
      recovery: { code: 'session_stale', message: '로그인 세션이 만료되었습니다. Google로 다시 로그인해 주세요.' },
    })
    expect(value.primaryCalls).toEqual([expectedCall])
    expect(value.anonymousCalls).toEqual([expectedCall])
  })

  it('does not retry malformed successful public payloads anonymously', async () => {
    const value = staleSessionRecoverySetup()
    value.setPrimaryResponse({ data: { kind: 'published', post: { ...detailRow, id: 'bad' } }, error: null })

    expect(await value.repository.getPost(detailRow.id)).toMatchObject({ ok: false, error: { sourceCode: 'INVALID_RESPONSE' } })
    expect(value.anonymousCalls).toEqual([])
  })

  it('stops after one anonymous public-read retry', async () => {
    const value = staleSessionRecoverySetup()
    value.setAnonymousResponse({ data: null, error: { code: 'PGRST303', message: 'still expired' } })

    expect(await value.repository.listPosts({ limit: 20 })).toMatchObject({ ok: false, error: { code: 'auth_required', sourceCode: 'PGRST303' } })
    expect(value.primaryCalls).toEqual(['list_public_posts'])
    expect(value.anonymousCalls).toEqual(['list_public_posts'])
  })

  it('wires browser recovery to the non-persisting anonymous client without auth storage calls', async () => {
    browserClient.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST303', message: 'JWT expired' } })
    anonymousBrowserClient.rpc.mockResolvedValueOnce({ data: [row], error: null })

    const result = await getCommunityRepository().listPosts({ limit: 20, sort: 'newest' })

    expect(browserClient.auth.getSession).not.toHaveBeenCalled()
    expect(browserClient.auth.signOut).not.toHaveBeenCalled()
    expect(anonymousBrowserClient.rpc).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ ok: true, data: { items: [{ id: row.id }] }, recovery: { code: 'session_stale' } })
  })

  it('does not access auth storage when an older browser response arrives late', async () => {
    let finishOlder!: (value: QueryResponse) => void
    const olderResponse = new Promise<QueryResponse>((resolve) => { finishOlder = resolve })
    browserClient.auth.getSession.mockClear()
    browserClient.auth.signOut.mockClear()
    browserClient.rpc.mockReturnValueOnce(olderResponse)
    anonymousBrowserClient.rpc.mockResolvedValueOnce({ data: [row], error: null })

    const older = getCommunityRepository().listPosts({ limit: 20 })
    finishOlder({ data: null, error: { code: 'PGRST303', message: 'older stale response' } })

    await expect(older).resolves.toMatchObject({ ok: true, recovery: { code: 'session_stale' } })
    expect(browserClient.auth.getSession).not.toHaveBeenCalled()
    expect(browserClient.auth.signOut).not.toHaveBeenCalled()
  })

  it('does not clear or retry a non-auth public-read error', async () => {
    const value = staleSessionRecoverySetup()
    value.setPrimaryResponse({ data: null, error: { code: '42501', message: 'denied' } })

    await expect(value.repository.listPosts({ limit: 20 })).resolves.toMatchObject({ ok: false, error: { code: 'forbidden' } })
    expect(value.anonymousCalls).toEqual([])
  })

  it('fails closed when the anonymous retry payload is malformed', async () => {
    const value = staleSessionRecoverySetup()
    value.setAnonymousResponse({ data: { unexpected: true }, error: null })

    await expect(value.repository.getPost(detailRow.id)).resolves.toMatchObject({
      ok: false, error: { sourceCode: 'INVALID_RESPONSE' },
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

    expect(value.calls).toEqual([{ method: 'get_public_post_v3', args: { p_post_id: 'post-1' } }])
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
          viewerReacted: false,
          tags: [
            { id: '56000000-0000-4000-8000-000000000040' },
            { id: '56000000-0000-4000-8000-000000000041' },
          ],
        },
      },
    })

    browserClient.rpc.mockResolvedValueOnce({ data: { kind: 'published', post: detailRow }, error: null })
    await getCommunityRepository().getPost('post-1')
    expect(browserClient.rpc).toHaveBeenLastCalledWith('get_public_post_v3', { p_post_id: 'post-1' })
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
        return Promise.resolve({ data: [{ id: 'a1000000-0000-0000-0000-000000000001', slug: 'ai-agent', label: 'AI·Agent' }], error: null })
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    }

    expect(await createCommunityRepository(client).listTags()).toEqual({
      ok: true,
      data: [{ id: 'a1000000-0000-0000-0000-000000000001', slug: 'ai-agent', label: 'AI·Agent' }],
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
  it('keeps RFC version and variant validation for mutation UUIDs', async () => {
    const value = setup()
    value.setMutationResponse({ data: 'a1000000-0000-0000-0000-000000000001', error: null })

    expect(await value.repository.createPost({ title: '제목', bodyMarkdown: '본문', tagIds: ['tag-1'], idempotencyKey: 'key' }))
      .toMatchObject({ ok: false, error: { sourceCode: 'INVALID_RESPONSE' } })
  })

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
    ['createPost', { title: '제목', bodyMarkdown: '본문', tagIds: [], idempotencyKey: 'create' }],
    ['updatePost', { postId: detailRow.id, title: '제목', bodyMarkdown: '본문', tagIds: [] }],
    ['deletePost', detailRow.id],
    ['createComment', { postId: detailRow.id, parentId: null, bodyMarkdown: '댓글', idempotencyKey: 'comment' }],
    ['setPostReaction', [detailRow.id, true]],
    ['setCommentReaction', ['56000000-0000-4000-8000-000000000021', true]],
    ['createReport', { targetType: 'post', targetId: detailRow.id, reasonCode: 'spam', detail: null, idempotencyKey: 'report' }],
    ['setReportStatus', { reportId: detailRow.id, expectedStatus: 'open', desiredStatus: 'reviewing', reason: 'review', idempotencyKey: 'status' }],
    ['moderatePost', { postId: detailRow.id, expectedStatus: 'published', expectedLocked: false, expectedPinned: false, action: 'hide', reason: 'policy', idempotencyKey: 'post' }],
    ['moderateComment', { commentId: '56000000-0000-4000-8000-000000000021', expectedStatus: 'published', action: 'hide', reason: 'policy', idempotencyKey: 'moderate-comment' }],
    ['setTagActive', { tagId: '56000000-0000-4000-8000-000000000040', expectedActive: true, desiredActive: false, reason: 'retire', idempotencyKey: 'tag' }],
  ] as const)('never retries the %s mutation anonymously after a stale-session failure', async (method, input) => {
    const value = staleSessionRecoverySetup()
    const repositoryMethod = value.repository[method] as (...args: never[]) => Promise<unknown>
    const args = Array.isArray(input) ? input : [input]

    expect(await repositoryMethod(...args as never[])).toMatchObject({ ok: false, error: { code: 'auth_required', sourceCode: 'PGRST303' } })
    expect(value.anonymousCalls).toEqual([])
  })

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



describe('community discussion interaction contract', () => {
  const publishedCommentWire = {
    kind: 'published', id: '56000000-0000-4000-8000-000000000021', parent_id: null,
    body_markdown: '댓글', created_at: '2026-09-27T00:00:00Z', updated_at: '2026-09-27T00:00:00Z',
    author_id: '56000000-0000-4000-8000-000000000030', author_login: 'bread', author_display_name: null,
    author_avatar_url: null, reaction_count: 3, viewer_reacted: true,
  }

  it('passes exact create/reaction args and maps strict canonical responses', async () => {
    const value = setup()
    value.setMutationResponse({ data: publishedCommentWire, error: null })
    expect(await value.repository.createComment({ postId: detailRow.id, parentId: null, bodyMarkdown: '댓글', idempotencyKey: 'intent-1' })).toMatchObject({ ok:true, data:{ kind:'published', reactionCount:3, viewerReacted:true } })
    expect(value.calls.at(-1)).toEqual({ method:'create_comment_v2', args:{ p_post_id:detailRow.id, p_parent_id:null, p_body_markdown:'댓글', p_idempotency_key:'intent-1' } })

    value.setMutationResponse({ data:{ reacted:true, reaction_count:9 }, error:null })
    expect(await value.repository.setPostReaction(detailRow.id, true)).toEqual({ ok:true, data:{ reacted:true, reactionCount:9 } })
    expect(value.calls.at(-1)).toEqual({ method:'set_post_reaction', args:{ p_post_id:detailRow.id, p_reacted:true } })
    expect(await value.repository.setCommentReaction(publishedCommentWire.id, false)).toEqual({ ok:true, data:{ reacted:true, reactionCount:9 } })
    expect(value.calls.at(-1)).toEqual({ method:'set_comment_reaction', args:{ p_comment_id:publishedCommentWire.id, p_reacted:false } })
  })

  it.each([
    { kind:'hidden', id:'56000000-0000-4000-8000-000000000021', parent_id:null, body_markdown:'leak' },
    { kind:'deleted', id:'56000000-0000-4000-8000-000000000021', parent_id:null, author_login:'leak' },
    { ...publishedCommentWire, reaction_count:-1 },
    { ...publishedCommentWire, viewer_reacted:'yes' },
  ])('fails closed on malformed or leaky comment %o', async (item) => {
    const value=setup(); value.setCommentsResponse({data:{items:[item],has_more:false,next_cursor:null},error:null})
    expect(await value.repository.listComments({postId:detailRow.id,limit:50})).toMatchObject({ok:false,error:{sourceCode:'INVALID_RESPONSE'}})
  })

  it.each([
    { reacted:true, reaction_count:-1 },
    { reacted:true, reaction_count:1, extra:true },
    { reacted:'true', reaction_count:1 },
  ])('rejects malformed reaction state %o', async (data) => {
    const value=setup(); value.setMutationResponse({data,error:null})
    expect(await value.repository.setPostReaction(detailRow.id,true)).toMatchObject({ok:false,error:{sourceCode:'INVALID_RESPONSE'}})
  })
})

describe('community moderation strict contract', () => {
  const reportId = '66000000-0000-4000-8000-000000000001'
  const postId = '66000000-0000-4000-8000-000000000002'
  const commentId = '66000000-0000-4000-8000-000000000003'
  const actorId = '66000000-0000-4000-8000-000000000004'
  const tagId = '66000000-0000-4000-8000-000000000005'
  const createdAt = '2026-09-28T12:34:56.123Z'
  const profile = { id: actorId, login: 'moderator', display_name: 'Moderator', avatar_url: null }
  const postTarget = {
    type: 'post', id: postId, available: true, post_id: postId, status: 'published', title: 'Post title', excerpt: 'bounded excerpt',
    is_locked: false, is_pinned: true,
  }
  const report = {
    id: reportId, status: 'open', reason_code: 'spam', detail: null, created_at: createdAt,
    resolved_at: null, resolved_by: null, reporter: profile, target: postTarget,
  }
  const invalidResponse = {
    ok: false,
    error: { code: 'unknown', sourceCode: 'INVALID_RESPONSE', message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
  }

  it('uses generated moderation RPC names and exact arguments', async () => {
    const value = setup()
    value.setMutationResponse({ data: true, error: null })
    expect(await value.repository.isAdmin()).toEqual({ ok: true, data: true })
    expect(value.calls.at(-1)).toEqual({ method: 'is_admin', args: {} })

    value.setMutationResponse({ data: reportId, error: null })
    expect(await value.repository.createReport({ targetType: 'comment', targetId: commentId, reasonCode: 'harmful', detail: null, idempotencyKey: 'report-key' }))
      .toEqual({ ok: true, data: reportId })
    expect(value.calls.at(-1)).toEqual({ method: 'create_report_v2', args: {
      p_target_type: 'comment', p_target_id: commentId, p_reason_code: 'harmful', p_detail: null, p_idempotency_key: 'report-key',
    } })

    value.setMutationResponse({ data: report, error: null })
    await value.repository.setReportStatus({ reportId, expectedStatus: 'open', desiredStatus: 'reviewing', reason: 'investigate', idempotencyKey: 'status-key' })
    expect(value.calls.at(-1)).toEqual({ method: 'set_report_status_v1', args: {
      p_report_id: reportId, p_expected_status: 'open', p_desired_status: 'reviewing', p_reason: 'investigate', p_idempotency_key: 'status-key',
    } })

    value.setMutationResponse({ data: { id: postId, status: 'hidden', is_locked: true, is_pinned: false, updated_at: createdAt, deleted_at: null }, error: null })
    expect(await value.repository.moderatePost({ postId, expectedStatus: 'published', expectedLocked: true, expectedPinned: true, action: 'hide', reason: 'policy', idempotencyKey: 'post-key' }))
      .toMatchObject({ ok: true, data: { id: postId, status: 'hidden', isLocked: true, isPinned: false } })
    expect(value.calls.at(-1)).toEqual({ method: 'moderate_post_v1', args: {
      p_post_id: postId, p_expected_status: 'published', p_expected_locked: true, p_expected_pinned: true,
      p_action: 'hide', p_reason: 'policy', p_idempotency_key: 'post-key',
    } })

    value.setMutationResponse({ data: { id: commentId, post_id: postId, status: 'deleted', updated_at: createdAt, deleted_at: createdAt }, error: null })
    expect(await value.repository.moderateComment({ commentId, expectedStatus: 'hidden', action: 'delete', reason: 'policy', idempotencyKey: 'comment-key' }))
      .toMatchObject({ ok: true, data: { id: commentId, postId, status: 'deleted' } })
    expect(value.calls.at(-1)).toEqual({ method: 'moderate_comment_v1', args: {
      p_comment_id: commentId, p_expected_status: 'hidden', p_action: 'delete', p_reason: 'policy', p_idempotency_key: 'comment-key',
    } })

    value.setMutationResponse({ data: { id: tagId, slug: 'typescript', label: 'TypeScript', is_active: false, sort_order: 10 }, error: null })
    expect(await value.repository.setTagActive({ tagId, expectedActive: true, desiredActive: false, reason: 'retire', idempotencyKey: 'tag-key' }))
      .toMatchObject({ ok: true, data: { id: tagId, isActive: false, sortOrder: 10 } })
    expect(value.calls.at(-1)).toEqual({ method: 'set_tag_active_v1', args: {
      p_tag_id: tagId, p_expected_active: true, p_desired_active: false, p_reason: 'retire', p_idempotency_key: 'tag-key',
    } })
    expect(value.calls.some((call) => call.method === 'create_report')).toBe(false)
  })

  it('maps the strict report queue including a comment target and complete cursor', async () => {
    const value = setup()
    const cursor = { createdAt, id: reportId }
    const commentReport = { ...report, target: { ...postTarget, type: 'comment', id: commentId, post_id: postId } }
    value.setMutationResponse({ data: { items: [commentReport], has_more: true, next_cursor: { created_at: createdAt, id: reportId } }, error: null })
    const result = await value.repository.listAdminReports({ status: 'active', limit: 25, cursor })
    expect(value.calls.at(-1)).toEqual({ method: 'list_moderation_reports_v1', args: {
      p_status: 'active', p_limit: 25, p_cursor_created_at: createdAt, p_cursor_id: reportId,
    } })
    expect(result).toEqual({ ok: true, data: {
      items: [{
        id: reportId, status: 'open', reasonCode: 'spam', detail: null, createdAt, resolvedAt: null, resolvedBy: null,
        reporter: { id: actorId, login: 'moderator', displayName: 'Moderator', avatarUrl: null },
        target: { type: 'comment', id: commentId, available: true, postId, status: 'published', title: 'Post title', excerpt: 'bounded excerpt', isLocked: false, isPinned: true },
      }], hasMore: true, nextCursor: cursor,
    } })
  })

  it('maps an exact dangling report target without unavailable content fields', async () => {
    const value = setup()
    value.setMutationResponse({ data: {
      items: [{ ...report, target: { type: 'comment', id: commentId, available: false } }], has_more: false, next_cursor: null,
    }, error: null })
    expect(await value.repository.listAdminReports({ status: 'all', limit: 10 })).toMatchObject({ ok: true, data: {
      items: [{ target: { type: 'comment', id: commentId, available: false } }],
    } })
  })

  it.each([
    { ...report, extra: true },
    { ...report, id: 'bad' },
    { ...report, status: 'pending' },
    { ...report, created_at: '2026-02-29T00:00:00Z' },
    { ...report, reporter: { ...profile, token: 'credential' } },
    { ...report, target: { type: 'post', id: postId, available: false, post_id: postId } },
    { ...report, target: { ...postTarget, post_id: commentId } },
    { ...report, target: { ...postTarget, excerpt: 'x'.repeat(241) } },
    { ...report, status: 'resolved', resolved_at: null, resolved_by: null },
    { ...report, status: 'open', resolved_at: createdAt, resolved_by: actorId },
  ])('rejects malformed report item %o', async (item) => {
    const value = setup(); value.setMutationResponse({ data: { items: [item], has_more: false, next_cursor: null }, error: null })
    expect(await value.repository.listAdminReports({ status: 'all', limit: 10 })).toEqual(invalidResponse)
  })

  it.each([
    { items: [], has_more: false, next_cursor: null, extra: true },
    { items: [], has_more: true, next_cursor: null },
    { items: [], has_more: false, next_cursor: { created_at: createdAt, id: reportId } },
    { items: [], has_more: true, next_cursor: { created_at: 'bad', id: reportId } },
  ])('rejects malformed report page %o', async (data) => {
    const value = setup(); value.setMutationResponse({ data, error: null })
    expect(await value.repository.listAdminReports({ status: 'all', limit: 10 })).toEqual(invalidResponse)
  })

  it('rejects report and audit pages larger than the requested bound', async () => {
    const value = setup()
    value.setMutationResponse({ data: { items: [report, { ...report, id: actorId }], has_more: false, next_cursor: null }, error: null })
    expect(await value.repository.listAdminReports({ status: 'all', limit: 1 })).toEqual(invalidResponse)

    const audit = { id: reportId, actor: profile, action: 'report.created', target_type: 'report', target_id: reportId, reason: null, metadata: {}, created_at: createdAt }
    value.setMutationResponse({ data: { items: [audit, { ...audit, id: actorId }], has_more: false, next_cursor: null }, error: null })
    expect(await value.repository.listModerationAuditLogs({ limit: 1 })).toEqual(invalidResponse)
  })

  it.each([null, 0, 'true', {}, []])('accepts only a literal boolean is_admin result: %o', async (data) => {
    const value = setup(); value.setMutationResponse({ data, error: null })
    expect(await value.repository.isAdmin()).toEqual(invalidResponse)
  })

  it.each([null, 'not-a-uuid', {}, reportId.toUpperCase() + 'x'])('requires a strict UUID create_report_v2 result: %o', async (data) => {
    const value = setup(); value.setMutationResponse({ data, error: null })
    expect(await value.repository.createReport({ targetType: 'post', targetId: postId, reasonCode: 'spam', detail: null, idempotencyKey: 'key' })).toEqual(invalidResponse)
  })

  it.each([
    { id: postId, status: 'bad', is_locked: false, is_pinned: false, updated_at: createdAt, deleted_at: null },
    { id: postId, status: 'deleted', is_locked: false, is_pinned: false, updated_at: createdAt, deleted_at: null },
    { id: postId, status: 'published', is_locked: false, is_pinned: false, updated_at: createdAt, deleted_at: createdAt },
    { id: commentId, post_id: postId, status: 'deleted', updated_at: createdAt, deleted_at: null },
    { id: tagId, slug: 'tag', label: 'Tag', is_active: true, sort_order: -1 },
  ])('rejects malformed authoritative moderation state %o', async (data) => {
    const value = setup(); value.setMutationResponse({ data, error: null })
    const result = 'post_id' in data
      ? await value.repository.moderateComment({ commentId, expectedStatus: 'published', action: 'delete', reason: 'r', idempotencyKey: 'k' })
      : 'slug' in data
        ? await value.repository.setTagActive({ tagId, expectedActive: false, desiredActive: true, reason: 'r', idempotencyKey: 'k' })
        : await value.repository.moderatePost({ postId, expectedStatus: 'published', expectedLocked: false, expectedPinned: false, action: 'hide', reason: 'r', idempotencyKey: 'k' })
    expect(result).toEqual(invalidResponse)
  })

  it('maps an exact bounded audit page and filters by a target pair', async () => {
    const value = setup()
    value.setMutationResponse({ data: { items: [{
      id: reportId, actor: profile, action: 'report.status_changed', target_type: 'report', target_id: reportId,
      reason: 'investigate', metadata: { from: 'open', to: 'reviewing' }, created_at: createdAt,
    }], has_more: false, next_cursor: null }, error: null })
    expect(await value.repository.listModerationAuditLogs({ limit: 20, targetType: 'report', targetId: reportId })).toEqual({ ok: true, data: {
      items: [{ id: reportId, actor: { id: actorId, login: 'moderator', displayName: 'Moderator', avatarUrl: null }, action: 'report.status_changed', targetType: 'report', targetId: reportId, reason: 'investigate', metadata: { from: 'open', to: 'reviewing' }, createdAt }],
      hasMore: false, nextCursor: null,
    } })
    expect(value.calls.at(-1)).toEqual({ method: 'list_moderation_audit_logs_v1', args: {
      p_limit: 20, p_cursor_created_at: undefined, p_cursor_id: undefined, p_target_type: 'report', p_target_id: reportId,
    } })
  })

  it('rejects authoritative moderation responses for a different requested target', async () => {
    const value = setup()
    value.setMutationResponse({ data: { ...report, id: actorId }, error: null })
    expect(await value.repository.setReportStatus({ reportId, expectedStatus: 'open', desiredStatus: 'reviewing', reason: 'r', idempotencyKey: 'k1' })).toEqual(invalidResponse)

    value.setMutationResponse({ data: { id: actorId, status: 'hidden', is_locked: false, is_pinned: false, updated_at: createdAt, deleted_at: null }, error: null })
    expect(await value.repository.moderatePost({ postId, expectedStatus: 'published', expectedLocked: false, expectedPinned: false, action: 'hide', reason: 'r', idempotencyKey: 'k2' })).toEqual(invalidResponse)

    value.setMutationResponse({ data: { id: actorId, post_id: postId, status: 'hidden', updated_at: createdAt, deleted_at: null }, error: null })
    expect(await value.repository.moderateComment({ commentId, expectedStatus: 'published', action: 'hide', reason: 'r', idempotencyKey: 'k3' })).toEqual(invalidResponse)

    value.setMutationResponse({ data: { id: actorId, slug: 'typescript', label: 'TypeScript', is_active: false, sort_order: 10 }, error: null })
    expect(await value.repository.setTagActive({ tagId, expectedActive: true, desiredActive: false, reason: 'r', idempotencyKey: 'k4' })).toEqual(invalidResponse)

    value.setMutationResponse({ data: { items: [{ id: reportId, actor: profile, action: 'x', target_type: 'post', target_id: postId, reason: null, metadata: {}, created_at: createdAt }], has_more: false, next_cursor: null }, error: null })
    expect(await value.repository.listModerationAuditLogs({ limit: 20, targetType: 'report', targetId: reportId })).toEqual(invalidResponse)
  })

  it.each([
    null,
    { items: [], has_more: false, next_cursor: null, extra: true },
    { items: [{ id: reportId, actor: profile, action: 'x', target_type: 'post', target_id: postId, reason: null, metadata: [], created_at: createdAt }], has_more: false, next_cursor: null },
    { items: [{ id: reportId, actor: profile, action: 'x', target_type: 'post', target_id: postId, reason: null, metadata: { password: 'secret' }, created_at: createdAt }], has_more: false, next_cursor: null },
    { items: [{ id: reportId, actor: profile, action: 'x', target_type: 'post', target_id: postId, reason: null, metadata: { body_markdown: 'private' }, created_at: createdAt }], has_more: false, next_cursor: null },
    { items: [{ id: reportId, actor: profile, action: 'x', target_type: 'post', target_id: postId, reason: null, metadata: { api_key: 'secret' }, created_at: createdAt }], has_more: false, next_cursor: null },
    { items: [{ id: reportId, actor: profile, action: 'x', target_type: 'post', target_id: postId, reason: null, metadata: { private_key: 'secret' }, created_at: createdAt }], has_more: false, next_cursor: null },
    { items: [{ id: reportId, actor: profile, action: 'x', target_type: 'post', target_id: postId, reason: null, metadata: { session: 'secret' }, created_at: createdAt }], has_more: false, next_cursor: null },
    { items: [{ id: reportId, actor: profile, action: 'x', target_type: 'post', target_id: postId, reason: null, metadata: { jwt: 'secret' }, created_at: createdAt }], has_more: false, next_cursor: null },
    { items: [{ id: reportId, actor: profile, action: 'x', target_type: 'post', target_id: postId, reason: null, metadata: { groups: Array.from({ length: 5 }, () => Array.from({ length: 50 }, () => 1)) }, created_at: createdAt }], has_more: false, next_cursor: null },
    { items: [{ id: reportId, actor: { ...profile, access_token: 'secret' }, action: 'x', target_type: 'post', target_id: postId, reason: null, metadata: {}, created_at: createdAt }], has_more: false, next_cursor: null },
  ])('rejects malformed or sensitive audit payload %o', async (data) => {
    const value = setup(); value.setMutationResponse({ data, error: null })
    expect(await value.repository.listModerationAuditLogs({ limit: 20 })).toEqual(invalidResponse)
  })

  it('maps serialization failures to a retryable Korean conflict message', async () => {
    const value = setup(); value.setMutationResponse({ data: null, error: { code: '40001', message: 'secret state changed' } })
    expect(await value.repository.setTagActive({ tagId, expectedActive: true, desiredActive: false, reason: 'r', idempotencyKey: 'k' })).toEqual({
      ok: false,
      error: { code: 'conflict', sourceCode: '40001', message: '상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.' },
    })
  })
})
