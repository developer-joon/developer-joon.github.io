import { describe, expect, it } from 'vitest'
import { createCommunityRepository, type CommunityClient, type QueryResponse } from './communityRepository'

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

function setup() {
  const calls: Array<{ method: string; args: unknown }> = []
  let listResponse: QueryResponse = { data: [], error: null }
  let detailResponse: QueryResponse = { data: null, error: null }
  let mutationResponse: QueryResponse = { data: 'post-1', error: null }
  const client: CommunityClient = {
    listPublicPosts(args) { calls.push({ method: 'listPublicPosts', args }); return Promise.resolve(listResponse) },
    getPost(postId) { calls.push({ method: 'getPost', args: postId }); return Promise.resolve(detailResponse) },
    listTags() { calls.push({ method: 'listTags', args: null }); return Promise.resolve({ data: [], error: null }) },
    rpc(fn, args) { calls.push({ method: fn, args }); return Promise.resolve(mutationResponse) },
  }
  return {
    repository: createCommunityRepository(client), calls,
    setListResponse(value: QueryResponse) { listResponse = value },
    setDetailResponse(value: QueryResponse) { detailResponse = value },
    setMutationResponse(value: QueryResponse) { mutationResponse = value },
  }
}

describe('community repository public list contract', () => {
  it('calls only the typed list RPC and maps server excerpt, counters, and every tag', async () => {
    const value = setup()
    value.setListResponse({ data: [row], error: null })
    const result = await value.repository.listPosts({ limit: 20, sort: 'popular', search: 'needle', tagId: 'tag-1' })
    expect(value.calls).toEqual([{ method: 'listPublicPosts', args: {
      p_sort: 'popular', p_limit: 20, p_search: 'needle', p_tag_id: 'tag-1',
      p_cursor_is_pinned: undefined, p_cursor_created_at: undefined, p_cursor_rank: undefined, p_cursor_id: undefined,
      p_cursor_search_rank: undefined,
    } }])
    expect(result.ok && result.data.items[0]).toMatchObject({
      excerpt: '서버 요약', commentCount: 3, reactionCount: 4, popularityScore: 11,
      tags: [{ id: 'tag-1' }, { id: 'tag-2' }],
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
  it('maps detail body, counters, and all tags from the controlled detail RPC', async () => {
    const value = setup()
    value.setDetailResponse({
      data: {
        ...row,
        body_markdown: '전체 본문',
      },
      error: null,
    })

    const result = await value.repository.getPost('post-1')

    expect(value.calls).toEqual([{ method: 'getPost', args: 'post-1' }])
    expect(result).toMatchObject({
      ok: true,
      data: {
        id: 'post-1',
        bodyMarkdown: '전체 본문',
        commentCount: 3,
        reactionCount: 4,
        popularityScore: 11,
        tags: [{ id: 'tag-1' }, { id: 'tag-2' }],
      },
    })
  })

  it('maps a missing public detail to the stable not-found error', async () => {
    const value = setup()

    expect(await value.repository.getPost('missing')).toEqual({
      ok: false,
      error: { code: 'not_found', sourceCode: 'PGRST116', message: '게시글을 찾을 수 없습니다.' },
    })
  })

  it('does not misclassify a malformed RPC response as a network failure', async () => {
    const value = setup()
    value.setDetailResponse({ data: { ...row, body_markdown: undefined }, error: null })

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
      listPublicPosts: () => Promise.resolve({ data: [], error: null }),
      getPost: () => Promise.resolve({ data: null, error: null }),
      listTags: () => {
        calls.push('listTags')
        return Promise.resolve({ data: [{ id: 'tag-1', slug: 'typescript', label: 'TypeScript' }], error: null })
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    }

    expect(await createCommunityRepository(client).listTags()).toEqual({
      ok: true,
      data: [{ id: 'tag-1', slug: 'typescript', label: 'TypeScript' }],
    })
    expect(calls).toEqual(['listTags'])
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
      listPublicPosts: () => Promise.reject(new TypeError('Failed to fetch')),
      getPost: () => Promise.reject(new TypeError('Failed to fetch')),
      listTags: () => Promise.reject(new TypeError('Failed to fetch')),
      rpc: () => Promise.reject(new TypeError('Failed to fetch')),
    }

    expect(await createCommunityRepository(client).listTags()).toEqual({
      ok: false,
      error: { code: 'network', sourceCode: 'NETWORK_ERROR', message: '네트워크 연결을 확인해 주세요.' },
    })
  })
})
