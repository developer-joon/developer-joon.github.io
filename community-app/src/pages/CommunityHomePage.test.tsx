import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CommunityRepository } from '../data/communityRepository'
import { parseCommunityQuery, serializeCommunityQuery } from '../lib/queryState'
import { CommunityHomePage } from './CommunityHomePage'

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
  tags: [{ id: 'tag-1', slug: 'development', label: '개발' }],
}

const secondPost = { ...post, id: 'post-2', title: '두 번째 글', isPinned: false }
const cursor = {
  isPinned: true,
  searchRank: 0.8,
  createdAt: post.createdAt,
  id: post.id,
  rank: null,
}

function repository(overrides: Partial<CommunityRepository> = {}): CommunityRepository {
  return {
    listPosts: vi.fn().mockResolvedValue({ ok: true, data: { items: [post], nextCursor: null } }),
    listTags: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'tag-1', slug: 'development', label: '개발' }] }),
    getPost: vi.fn(),
    createPost: vi.fn(),
    updatePost: vi.fn(),
    deletePost: vi.fn(),
    ...overrides,
  } as CommunityRepository
}

describe('CommunityHomePage', () => {
  afterEach(() => window.history.replaceState({}, '', '/'))

  it('lets anonymous visitors read the public post list', async () => {
    render(<CommunityHomePage repository={repository()} initialSearch="" />)

    expect(screen.getByRole('heading', { name: '개발자가 쓰고 답하는 공간' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: post.title })).toBeInTheDocument()
    expect(screen.getByText('공지')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: '글쓰기' })).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: '글쓰기' })[0]).toHaveAttribute('href', '/community/write/')
  })

  it('preserves filters in the URL query contract', async () => {
    const onQueryChange = vi.fn()
    render(<CommunityHomePage repository={repository()} initialSearch="?sort=popular" onQueryChange={onQueryChange} />)

    await screen.findByRole('heading', { name: post.title })
    fireEvent.change(screen.getByRole('searchbox', { name: '게시글 검색' }), { target: { value: '보안' } })
    fireEvent.click(screen.getByRole('button', { name: '검색' }))

    expect(onQueryChange).toHaveBeenCalledWith('?q=%EB%B3%B4%EC%95%88&sort=popular')
  })

  it('exposes the selected tag and sort as pressed buttons', async () => {
    render(<CommunityHomePage repository={repository()} initialSearch="?tag=tag-1&sort=popular" />)

    await screen.findByRole('heading', { name: post.title })
    expect(screen.getByRole('button', { name: '개발' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '전체' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: '인기순' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '최신순' })).toHaveAttribute('aria-pressed', 'false')
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
      .mockResolvedValueOnce({ ok: true, data: { items: [post, secondPost], nextCursor: null } })
    render(<CommunityHomePage repository={repository({ listPosts })} initialSearch="" onQueryChange={onQueryChange} />)

    await screen.findByRole('button', { name: '더 불러오기' })
    fireEvent.click(screen.getByRole('button', { name: '더 불러오기' }))

    expect(await screen.findByRole('heading', { name: secondPost.title })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { name: post.title })).toHaveLength(1)
    expect(listPosts).toHaveBeenLastCalledWith(expect.objectContaining({ cursor }))
    expect(parseCommunityQuery(onQueryChange.mock.lastCall?.[0] ?? '').cursor).toEqual(cursor)
    const postLinks = screen.getAllByRole('link').filter((link) => link.getAttribute('href')?.startsWith('/community/post/'))
    expect(postLinks.map((link) => link.textContent)).toEqual([post.title, secondPost.title])
  })

  it('restores accumulated posts on forward navigation and cursor URL reload', async () => {
    const firstVisit = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { items: [post], nextCursor: cursor } })
      .mockResolvedValueOnce({ ok: true, data: { items: [secondPost], nextCursor: null } })
      .mockResolvedValueOnce({ ok: true, data: { items: [post], nextCursor: cursor } })
      .mockResolvedValueOnce({ ok: true, data: { items: [secondPost], nextCursor: null } })
    const firstRender = render(<CommunityHomePage repository={repository({ listPosts: firstVisit })} />)

    fireEvent.click(await screen.findByRole('button', { name: '더 불러오기' }))
    expect(await screen.findByRole('heading', { name: secondPost.title })).toBeInTheDocument()
    const pageTwo = { search: window.location.search, state: window.history.state }

    window.history.replaceState({}, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: secondPost.title })).not.toBeInTheDocument())

    window.history.replaceState(pageTwo.state, '', pageTwo.search)
    window.dispatchEvent(new PopStateEvent('popstate', { state: pageTwo.state }))
    expect(await screen.findByRole('heading', { name: secondPost.title })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: post.title })).toBeInTheDocument()
    firstRender.unmount()

    const reload = vi.fn().mockResolvedValue({ ok: true, data: { items: [secondPost], nextCursor: null } })
    render(<CommunityHomePage repository={repository({ listPosts: reload })} />)

    expect(await screen.findByRole('heading', { name: post.title })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: secondPost.title })).toBeInTheDocument()
    expect(reload).toHaveBeenCalledWith(expect.objectContaining({ cursor }))
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
    const currentSearch = serializeCommunityQuery({ search: 'fresh', tagId: 'tag-1', sort: 'popular', cursor })
    const staleSearch = serializeCommunityQuery({ search: 'stale', tagId: null, sort: 'comments', cursor })
    const listPosts = vi.fn().mockResolvedValue({ ok: true, data: { items: [post], nextCursor: null } })
    window.history.replaceState({
      communityListing: { version: 1, query: staleSearch, posts: [secondPost] },
    }, '', `/${currentSearch}`)

    render(<CommunityHomePage repository={repository({ listPosts })} />)

    expect(await screen.findByRole('heading', { name: post.title })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: secondPost.title })).not.toBeInTheDocument()
    expect(listPosts).toHaveBeenCalledWith(expect.objectContaining({
      search: 'fresh',
      tagId: 'tag-1',
      sort: 'popular',
      cursor,
    }))
  })

  it('keeps loaded posts while a next page fails and retries that cursor', async () => {
    const listPosts = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { items: [post], nextCursor: cursor } })
      .mockResolvedValueOnce({ ok: false, error: { code: 'network', sourceCode: 'NETWORK_ERROR', message: '네트워크 연결을 확인해 주세요.' } })
      .mockResolvedValueOnce({ ok: true, data: { items: [secondPost], nextCursor: null } })
    render(<CommunityHomePage repository={repository({ listPosts })} initialSearch="" />)

    fireEvent.click(await screen.findByRole('button', { name: '더 불러오기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('네트워크 연결을 확인해 주세요.')
    expect(screen.getByRole('heading', { name: post.title })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))

    expect(await screen.findByRole('heading', { name: secondPost.title })).toBeInTheDocument()
    expect(listPosts).toHaveBeenLastCalledWith(expect.objectContaining({ cursor }))
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
    expect(await screen.findByText('조건에 맞는 글이 없습니다')).toBeInTheDocument()
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
