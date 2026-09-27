import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CommunityRepository } from '../data/communityRepository'
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
