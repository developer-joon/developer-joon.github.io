import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CommunityRepository } from '../data/communityRepository'
import { parseCommunityQuery, serializeCommunityQuery } from '../lib/queryState'
import { CommunityHomePage } from './CommunityHomePage'
import { AuthContext, type AuthContextValue } from '../auth/AuthProvider'

const tagId = 'a1000000-0000-0000-0000-000000000001'

const post = {
  id: 'post-1',
  title: 'RLS를 운영하며 배운 점',
  excerpt: '브라우저 권한을 데이터베이스에서 다시 확인한 기록입니다.',
  createdAt: '2026-09-27T00:00:00Z',
  updatedAt: '2026-09-27T00:00:00Z',
  isLocked: false,
  isPinned: true,
  commentCount: 4,
  reactionCount: 9,
  popularityScore: 22,
  author: { id: 'author-1', login: 'breaddev', displayName: '브레드 개발자', avatarUrl: null },
  tags: [{ id: tagId, slug: 'development', label: '개발' }],
}

const secondPost = { ...post, id: 'post-2', title: '두 번째 글', isPinned: false }
const cursor = {
  isPinned: true,
  searchRank: 0.8,
  createdAt: post.createdAt,
  id: '22222222-2222-4222-8222-222222222222',
  rank: null,
}

function repository(overrides: Partial<CommunityRepository> = {}): CommunityRepository {
  return {
    listPosts: vi.fn().mockResolvedValue({ ok: true, data: { items: [post], nextCursor: null } }),
    listTags: vi.fn().mockResolvedValue({ ok: true, data: [{ id: tagId, slug: 'development', label: '개발' }] }),
    getPost: vi.fn(),
    createPost: vi.fn(),
    updatePost: vi.fn(),
    deletePost: vi.fn(),
    ...overrides,
  } as CommunityRepository
}

describe('CommunityHomePage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.history.replaceState({}, '', '/')
  })

  it('lets anonymous visitors read the public post list', async () => {
    render(<CommunityHomePage repository={repository()} initialSearch="" />)

    expect(screen.getByRole('heading', { level: 1, name: '자유게시판' })).toBeInTheDocument()
    expect(screen.queryByText('COMMUNITY · 공개 개발 기록')).not.toBeInTheDocument()
    expect(screen.queryByText('개발자가 쓰고 답하는 공간')).not.toBeInTheDocument()
    expect(screen.queryByText('질문보다 오래 남는 경험, 답변보다 구체적인 시행착오를 나눕니다. 모든 공개 글은 로그인 없이 읽을 수 있습니다.')).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: post.title })).toBeInTheDocument()
    expect(screen.getByText('공지')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: '글쓰기' })).toHaveLength(1)
    expect(screen.getByRole('link', { name: '글쓰기' })).toHaveAttribute('href', '/community/write/')
  })

  it('shows one accessible session-expiry notice for concurrent recovered public reads', async () => {
    const recovery = { code: 'session_stale' as const, message: '로그인 세션이 만료되었습니다. Google로 다시 로그인해 주세요.' }
    const auth = { loading: false, pending: false, session: null, user: null, error: null, signIn: vi.fn(), signOut: vi.fn(), invalidateStaleSession: vi.fn(() => true) } satisfies AuthContextValue
    render(<AuthContext.Provider value={auth}><CommunityHomePage repository={repository({
      listPosts: vi.fn().mockResolvedValue({ ok: true, data: { items: [post], nextCursor: null }, recovery }),
      listTags: vi.fn().mockResolvedValue({ ok: true, data: [{ id: tagId, slug: 'development', label: '개발' }], recovery }),
    })} initialSearch="" /></AuthContext.Provider>)

    await screen.findByRole('heading', { name: post.title })
    expect(screen.getAllByRole('alert', { name: '로그인 세션 만료' })).toHaveLength(1)
    expect(screen.getByRole('alert', { name: '로그인 세션 만료' })).toHaveTextContent(recovery.message)
    expect(auth.invalidateStaleSession).toHaveBeenCalledOnce()
  })

  it('preserves filters in the URL query contract', async () => {
    const onQueryChange = vi.fn()
    render(<CommunityHomePage repository={repository()} initialSearch="?sort=popular" onQueryChange={onQueryChange} />)

    await screen.findByRole('heading', { name: post.title })
    fireEvent.change(screen.getByRole('searchbox', { name: '게시글 검색' }), { target: { value: '보안' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))

    expect(onQueryChange).toHaveBeenCalledWith('?q=%EB%B3%B4%EC%95%88&sort=popular')
  })

  it('preserves a seeded tag filter after selecting its button', async () => {
    const onQueryChange = vi.fn()
    const listPosts = vi.fn().mockResolvedValue({ ok: true, data: { items: [post], nextCursor: null } })
    render(<CommunityHomePage repository={repository({ listPosts })} initialSearch="" onQueryChange={onQueryChange} />)
    await screen.findByRole('heading', { name: post.title })

    fireEvent.click(screen.getByRole('button', { name: '개발' }))

    expect(onQueryChange).toHaveBeenCalledWith(`?tag=${tagId}`)
    await waitFor(() => expect(listPosts).toHaveBeenLastCalledWith(expect.objectContaining({ tagId })))
    expect(screen.getByRole('button', { name: '개발' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('enforces the 200-character search limit in the input and submitted state', async () => {
    const onQueryChange = vi.fn()
    const listPosts = vi.fn().mockResolvedValue({ ok: true, data: { items: [post], nextCursor: null } })
    render(<CommunityHomePage repository={repository({ listPosts })} initialSearch="" onQueryChange={onQueryChange} />)
    await screen.findByRole('heading', { name: post.title })

    const searchbox = screen.getByRole('searchbox', { name: '게시글 검색' })
    expect(searchbox).toHaveAttribute('maxlength', '200')
    fireEvent.change(searchbox, { target: { value: 'x'.repeat(201) } })
    expect(searchbox).toHaveValue('x'.repeat(200))
    fireEvent.click(screen.getByRole('button', { name: '검색' }))

    expect(onQueryChange).toHaveBeenCalledWith(`?q=${'x'.repeat(200)}`)
    await waitFor(() => expect(listPosts).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'x'.repeat(200) })))
  })

  it('exposes the selected tag and sort as pressed buttons', async () => {
    render(<CommunityHomePage repository={repository()} initialSearch={`?tag=${tagId}&sort=popular`} />)

    await screen.findByRole('heading', { name: post.title })
    expect(screen.getByRole('button', { name: '개발' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '전체' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: '인기순' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '최신순' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('groups tag and sort controls with accessible labels', async () => {
    render(<CommunityHomePage repository={repository()} initialSearch="" />)
    await screen.findByRole('heading', { name: post.title })

    expect(screen.getByRole('group', { name: '태그 필터' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '게시글 정렬' })).toBeInTheDocument()
  })

  it('restores filters and the search draft from browser navigation', async () => {
    const listPosts = vi.fn().mockResolvedValue({ ok: true, data: { items: [post], nextCursor: null } })
    window.history.replaceState({}, '', '/?q=before')
    render(<CommunityHomePage repository={repository({ listPosts })} />)
    await screen.findByRole('heading', { name: post.title })

    window.history.pushState({}, '', '/?q=after&sort=comments')
    window.dispatchEvent(new PopStateEvent('popstate'))

    await waitFor(() => expect(screen.getByRole('searchbox', { name: '게시글 검색' })).toHaveValue('after'))
    await waitFor(() => expect(listPosts).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'after', sort: 'comments' })))
    expect(screen.getByRole('button', { name: '댓글순' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('loads the next cursor page, keeps repository order, and removes duplicate posts', async () => {
    const onQueryChange = vi.fn()
    const listPosts = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { items: [post], nextCursor: cursor } })
      .mockResolvedValueOnce({ ok: true, data: { items: [secondPost, secondPost], nextCursor: null } })
    render(<CommunityHomePage repository={repository({ listPosts })} initialSearch="" onQueryChange={onQueryChange} />)

    await screen.findByRole('button', { name: '다음 페이지' })
    fireEvent.click(screen.getByRole('button', { name: '다음 페이지' }))

    expect(await screen.findByRole('heading', { name: secondPost.title })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: post.title })).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: secondPost.title })).toHaveLength(1)
    expect(listPosts).toHaveBeenLastCalledWith(expect.objectContaining({ cursor }))
    expect(parseCommunityQuery(onQueryChange.mock.lastCall?.[0] ?? '').cursor).toEqual(cursor)
    const postLinks = screen.getAllByRole('link').filter((link) => link.getAttribute('href')?.startsWith('/community/post/'))
    expect(postLinks.map((link) => link.textContent)).toEqual([secondPost.title])
  })

  it('keeps long pagination bounded to one page and offers previous navigation', async () => {
    const pages = Array.from({ length: 12 }, (_, index) => ({ ...post, id: `post-${index}`, title: `페이지 ${index + 1}` }))
    const cursors = pages.slice(1).map((_, index) => ({
      ...cursor,
      id: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
    }))
    const listPosts = vi.fn()
    pages.forEach((item, index) => {
      listPosts.mockResolvedValueOnce({ ok: true, data: { items: [item], nextCursor: cursors[index] ?? null } })
    })
    render(<CommunityHomePage repository={repository({ listPosts })} />)

    for (let index = 0; index < pages.length - 1; index += 1) {
      fireEvent.click(await screen.findByRole('button', { name: '다음 페이지' }))
      await screen.findByRole('heading', { name: pages[index + 1].title })
      expect(screen.queryByRole('heading', { name: pages[index].title })).not.toBeInTheDocument()
      expect(document.querySelectorAll('.post-card')).toHaveLength(1)
      await waitFor(() => expect(window.history.state.communityListing.posts.map((item: typeof post) => item.id))
        .toEqual([pages[index + 1].id]))
    }

    expect(screen.getByRole('button', { name: '이전 페이지' })).toBeInTheDocument()
    expect(listPosts).toHaveBeenCalledTimes(12)
  })

  it('continues pagination when History API snapshot writes exceed quota', async () => {
    const listPosts = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { items: [post], nextCursor: cursor } })
      .mockResolvedValueOnce({ ok: true, data: { items: [secondPost], nextCursor: null } })
    const originalPushState = window.history.pushState.bind(window.history)
    const pushState = vi.spyOn(window.history, 'pushState')
      .mockImplementationOnce(() => { throw new DOMException('quota', 'DataCloneError') })
      .mockImplementation(originalPushState)

    render(<CommunityHomePage repository={repository({ listPosts })} />)
    fireEvent.click(await screen.findByRole('button', { name: '다음 페이지' }))

    expect(await screen.findByRole('heading', { name: secondPost.title })).toBeInTheDocument()
    expect(pushState).toHaveBeenCalledTimes(2)
  })

  it('restores bounded pages on back, forward, and cursor URL reload', async () => {
    const firstVisit = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { items: [post], nextCursor: cursor } })
      .mockResolvedValueOnce({ ok: true, data: { items: [secondPost], nextCursor: null } })
      .mockResolvedValueOnce({ ok: true, data: { items: [post], nextCursor: cursor } })
      .mockResolvedValueOnce({ ok: true, data: { items: [secondPost], nextCursor: null } })
    const firstRender = render(<CommunityHomePage repository={repository({ listPosts: firstVisit })} />)

    const pageOne = { search: window.location.search, state: window.history.state }
    fireEvent.click(await screen.findByRole('button', { name: '다음 페이지' }))
    expect(await screen.findByRole('heading', { name: secondPost.title })).toBeInTheDocument()
    const pageTwo = { search: window.location.search, state: window.history.state }

    window.history.replaceState(pageOne.state, '', pageOne.search)
    window.dispatchEvent(new PopStateEvent('popstate', { state: pageOne.state }))
    expect(await screen.findByRole('heading', { name: post.title })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: secondPost.title })).not.toBeInTheDocument()

    window.history.replaceState(pageTwo.state, '', pageTwo.search)
    window.dispatchEvent(new PopStateEvent('popstate', { state: pageTwo.state }))
    expect(await screen.findByRole('heading', { name: secondPost.title })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: post.title })).not.toBeInTheDocument()
    firstRender.unmount()

    const reload = vi.fn().mockResolvedValue({ ok: true, data: { items: [secondPost], nextCursor: null } })
    render(<CommunityHomePage repository={repository({ listPosts: reload })} />)

    expect(await screen.findByRole('heading', { name: secondPost.title })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: post.title })).not.toBeInTheDocument()
    expect(reload).toHaveBeenCalledWith(expect.objectContaining({ cursor }))
  })

  it('clears a shared cursor URL instead of leaving the app through browser history', async () => {
    const cursorSearch = serializeCommunityQuery({ search: '', tagId: null, sort: 'newest', cursor })
    window.history.replaceState({}, '', `/${cursorSearch}`)
    const back = vi.spyOn(window.history, 'back')
    const listPosts = vi.fn().mockResolvedValue({ ok: true, data: { items: [secondPost], nextCursor: null } })
    render(<CommunityHomePage repository={repository({ listPosts })} />)
    await screen.findByRole('heading', { name: secondPost.title })

    fireEvent.click(screen.getByRole('button', { name: '첫 페이지' }))

    await waitFor(() => expect(window.location.search).toBe(''))
    expect(back).not.toHaveBeenCalled()
    expect(listPosts).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: undefined }))
  })

  it('uses browser back only for a previous listing page owned by this app', async () => {
    const listPosts = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { items: [post], nextCursor: cursor } })
      .mockResolvedValueOnce({ ok: true, data: { items: [secondPost], nextCursor: null } })
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined)
    render(<CommunityHomePage repository={repository({ listPosts })} />)

    fireEvent.click(await screen.findByRole('button', { name: '다음 페이지' }))
    await screen.findByRole('heading', { name: secondPost.title })
    fireEvent.click(screen.getByRole('button', { name: '이전 페이지' }))

    expect(back).toHaveBeenCalledOnce()
  })

  it('discards a history snapshot containing a malformed post', async () => {
    const listPosts = vi.fn().mockResolvedValue({ ok: true, data: { items: [post], nextCursor: null } })
    window.history.replaceState({
      communityListing: { version: 1, query: '', posts: [null] },
    }, '', '/')

    render(<CommunityHomePage repository={repository({ listPosts })} />)

    expect(await screen.findByRole('heading', { name: post.title })).toBeInTheDocument()
    expect(listPosts).toHaveBeenCalledWith(expect.objectContaining({ cursor: undefined }))
  })

  it('discards a history snapshot bound to a different serialized query', async () => {
    const rankedCursor = { ...cursor, rank: 22 }
    const currentSearch = serializeCommunityQuery({ search: 'fresh', tagId, sort: 'popular', cursor: rankedCursor })
    const staleSearch = serializeCommunityQuery({ search: 'stale', tagId: null, sort: 'comments', cursor: rankedCursor })
    const listPosts = vi.fn().mockResolvedValue({ ok: true, data: { items: [post], nextCursor: null } })
    window.history.replaceState({
      communityListing: { version: 2, query: staleSearch, posts: [secondPost], nextCursor: null },
    }, '', `/${currentSearch}`)

    render(<CommunityHomePage repository={repository({ listPosts })} />)

    expect(await screen.findByRole('heading', { name: post.title })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: secondPost.title })).not.toBeInTheDocument()
    expect(listPosts).toHaveBeenCalledWith(expect.objectContaining({
      search: 'fresh',
      tagId,
      sort: 'popular',
      cursor: rankedCursor,
    }))
  })

  it('keeps loaded posts while a next page fails and retries that cursor', async () => {
    const listPosts = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { items: [post], nextCursor: cursor } })
      .mockResolvedValueOnce({ ok: false, error: { code: 'network', sourceCode: 'NETWORK_ERROR', message: '네트워크 연결을 확인해 주세요.' } })
      .mockResolvedValueOnce({ ok: true, data: { items: [secondPost], nextCursor: null } })
    render(<CommunityHomePage repository={repository({ listPosts })} initialSearch="" />)

    fireEvent.click(await screen.findByRole('button', { name: '다음 페이지' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('네트워크 연결을 확인해 주세요.')
    expect(screen.getByRole('heading', { name: post.title })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))

    expect(await screen.findByRole('heading', { name: secondPost.title })).toBeInTheDocument()
    expect(listPosts).toHaveBeenLastCalledWith(expect.objectContaining({ cursor }))
  })

  it('announces next-page loading while keeping the current posts visible', async () => {
    let resolveNextPage: ((value: { ok: true; data: { items: (typeof post)[]; nextCursor: null } }) => void) | undefined
    const nextPage = new Promise<{ ok: true; data: { items: (typeof post)[]; nextCursor: null } }>((resolve) => {
      resolveNextPage = resolve
    })
    const listPosts = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { items: [post], nextCursor: cursor } })
      .mockReturnValueOnce(nextPage)
    render(<CommunityHomePage repository={repository({ listPosts })} />)

    fireEvent.click(await screen.findByRole('button', { name: '다음 페이지' }))

    expect(screen.getByRole('heading', { name: post.title })).toBeInTheDocument()
    expect(await screen.findByRole('status', { name: '다음 페이지를 불러오고 있습니다' })).toHaveAttribute('aria-live', 'polite')
    resolveNextPage?.({ ok: true, data: { items: [secondPost], nextCursor: null } })
    expect(await screen.findByRole('heading', { name: secondPost.title })).toBeInTheDocument()
  })

  it('resets the cursor and replaces posts when the sort changes', async () => {
    const listPosts = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { items: [post], nextCursor: cursor } })
      .mockResolvedValueOnce({ ok: true, data: { items: [secondPost], nextCursor: null } })
    render(<CommunityHomePage repository={repository({ listPosts })} initialSearch="" />)

    await screen.findByRole('heading', { name: post.title })
    fireEvent.click(screen.getByRole('button', { name: '인기순' }))

    expect(await screen.findByRole('heading', { name: secondPost.title })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: post.title })).not.toBeInTheDocument()
    expect(listPosts).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'popular', cursor: undefined }))
  })

  it('renders an accessible empty state', async () => {
    const repo = repository({ listPosts: vi.fn().mockResolvedValue({ ok: true, data: { items: [], nextCursor: null } }) })
    render(<CommunityHomePage repository={repo} initialSearch="" />)
    expect(await screen.findByText('아직 공개된 글이 없습니다')).toBeInTheDocument()
  })

  it('explains how to recover from an empty filtered result', async () => {
    const repo = repository({ listPosts: vi.fn().mockResolvedValue({ ok: true, data: { items: [], nextCursor: null } }) })
    render(<CommunityHomePage repository={repo} initialSearch="?q=missing" />)

    expect(await screen.findByText('검색 결과가 없습니다')).toBeInTheDocument()
    expect(screen.getByText('검색어를 지우거나 다른 태그를 선택해 보세요.')).toBeInTheDocument()
  })

  it('shows and retries tag loading errors while preserving a selected URL tag', async () => {
    const selectedTag = '11111111-1111-4111-8111-111111111111'
    const listTags = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'network', sourceCode: 'NETWORK_ERROR', message: '네트워크 연결을 확인해 주세요.' } })
      .mockResolvedValueOnce({ ok: true, data: [{ id: selectedTag, slug: 'development', label: '개발' }] })
    render(<CommunityHomePage repository={repository({ listTags })} initialSearch={`?tag=${selectedTag}`} />)

    expect(await screen.findByRole('alert', { name: '태그를 불러오지 못했습니다' })).toHaveTextContent('네트워크 연결을 확인해 주세요.')
    expect(screen.getByRole('button', { name: `선택한 태그 ${selectedTag}` })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '태그 다시 시도' }))

    expect(await screen.findByRole('button', { name: '개발' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('alert', { name: '태그를 불러오지 못했습니다' })).not.toBeInTheDocument()
  })

  it('normalizes invalid URL state before calling the repository', async () => {
    const listPosts = vi.fn().mockResolvedValue({ ok: true, data: { items: [post], nextCursor: null } })
    window.history.replaceState({}, '', `/?tag=bad&q=${'x'.repeat(201)}&sort=popular&cursor=${encodeURIComponent(JSON.stringify({ ...cursor, rank: null }))}`)

    render(<CommunityHomePage repository={repository({ listPosts })} />)
    await screen.findByRole('heading', { name: post.title })

    expect(listPosts).toHaveBeenCalledWith(expect.objectContaining({
      search: 'x'.repeat(200),
      tagId: undefined,
      sort: 'popular',
      cursor: undefined,
    }))
    expect(window.location.search).toBe(`?q=${'x'.repeat(200)}&sort=popular`)
  })

  it('renders a retryable Korean error state', async () => {
    const listPosts = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'network', sourceCode: 'NETWORK_ERROR', message: '네트워크 연결을 확인해 주세요.' } })
      .mockResolvedValueOnce({ ok: true, data: { items: [post], nextCursor: null } })
    render(<CommunityHomePage repository={repository({ listPosts })} initialSearch="" />)

    expect(await screen.findByRole('alert')).toHaveTextContent('네트워크 연결을 확인해 주세요.')
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: post.title })).toBeInTheDocument())
  })
})
