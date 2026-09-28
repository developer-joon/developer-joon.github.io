import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CommunityRepository } from '../data/communityRepository'
import type { CommunityResult, CommentPage, PublicPostRead } from '../types/community'
import { PostDetailPage } from './PostDetailPage'

const postId = '56000000-0000-4000-8000-000000000010'
const rootId = '56000000-0000-4000-8000-000000000020'
const replyId = '56000000-0000-4000-8000-000000000021'
const cursor = {
  rootCreatedAt: '2026-09-27T00:00:00Z', rootId, isReply: false,
  createdAt: '2026-09-27T00:00:00Z', id: rootId,
}
const published: Extract<PublicPostRead, { kind: 'published' }> = {
  kind: 'published',
  post: {
    id: postId,
    title: '안전한 상세 글',
    excerpt: '',
    bodyMarkdown: '# 본문\n\n<script>alert(1)</script>\n\n`safe`',
    createdAt: '2026-09-27T00:00:00Z',
    updatedAt: '2026-09-27T01:00:00Z',
    isLocked: false, isPinned: false,
    commentCount: 2, reactionCount: 7, popularityScore: 9,
    attachmentCount: 0,
    author: { id: '56000000-0000-4000-8000-000000000030', login: 'bread', displayName: null, avatarUrl: null },
    tags: [{ id: '56000000-0000-4000-8000-000000000040', slug: 'security', label: '보안' }],
  },
}
const rootComment = {
  id: rootId, parentId: null, bodyMarkdown: '첫 댓글',
  createdAt: '2026-09-27T00:00:00Z', updatedAt: '2026-09-27T00:00:00Z',
  author: { id: '56000000-0000-4000-8000-000000000031', login: 'root', displayName: '루트 작성자', avatarUrl: null },
}
const replyComment = {
  id: replyId, parentId: rootId, bodyMarkdown: '**답글**',
  createdAt: '2026-09-27T00:01:00Z', updatedAt: '2026-09-27T00:01:00Z',
  author: { id: '56000000-0000-4000-8000-000000000032', login: 'reply', displayName: null, avatarUrl: null },
}

function success<T>(data: T): CommunityResult<T> { return { ok: true, data } }
function failure<T>(): CommunityResult<T> {
  return { ok: false, error: { code: 'network', sourceCode: 'NETWORK_ERROR', message: '네트워크 연결을 확인해 주세요.' } }
}
function repository(getPost: () => Promise<CommunityResult<PublicPostRead>>, listComments = () => Promise.resolve(success<CommentPage>({ items: [], hasMore: false, nextCursor: null }))) {
  return { getPost: vi.fn(getPost), listComments: vi.fn(listComments) } as unknown as CommunityRepository
}

describe('PostDetailPage', () => {
  it.each(['', '?id=bad', `?id=${postId}&id=${postId}`, `?id=${postId.toUpperCase()}x`])('rejects a missing, malformed, or multiple id before repository calls: %s', async (search) => {
    const repo = repository(() => Promise.resolve(success({ kind: 'not_found' })))
    render(<PostDetailPage repository={repo} search={search} />)

    expect(screen.getByRole('heading', { name: '올바르지 않은 게시글 주소입니다' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '커뮤니티 글 목록으로' })).toHaveAttribute('href', '/community/')
    expect(repo.getPost).not.toHaveBeenCalled()
    expect(repo.listComments).not.toHaveBeenCalled()
  })

  it('announces loading and retries a repository error', async () => {
    let resolveFirst!: (value: CommunityResult<PublicPostRead>) => void
    const first = new Promise<CommunityResult<PublicPostRead>>((resolve) => { resolveFirst = resolve })
    const repo = repository(vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(success({ kind: 'not_found' })))
    render(<PostDetailPage repository={repo} search={`?id=${postId}`} />)

    expect(screen.getByRole('status', { name: '게시글을 불러오고 있습니다' })).toBeInTheDocument()
    resolveFirst(failure())
    expect(await screen.findByRole('alert')).toHaveTextContent('네트워크 연결을 확인해 주세요.')
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))

    expect(await screen.findByRole('heading', { name: '게시글을 찾을 수 없습니다' })).toBeInTheDocument()
    expect(repo.getPost).toHaveBeenCalledTimes(2)
  })

  it.each([
    [{ kind: 'not_found' } as const, '게시글을 찾을 수 없습니다'],
    [{ kind: 'hidden' } as const, '운영 정책에 따라 공개되지 않은 글입니다'],
  ])('renders the contentless %s state without loading comments', async (state, heading) => {
    const repo = repository(() => Promise.resolve(success(state)))
    render(<PostDetailPage repository={repo} search={`?id=${postId}`} />)

    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    expect(repo.listComments).not.toHaveBeenCalled()
  })

  it('renders the exact deleted tombstone and preserved bounded comments without leaked post fields', async () => {
    const repo = repository(
      () => Promise.resolve(success({ kind: 'deleted', commentCount: 1 })),
      () => Promise.resolve(success({ items: [rootComment], hasMore: false, nextCursor: null })),
    )
    render(<PostDetailPage repository={repo} search={`?id=${postId}`} />)

    expect(await screen.findByRole('heading', { name: '삭제된 글입니다' })).toBeInTheDocument()
    expect(await screen.findByText('첫 댓글')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '댓글 1' })).toBeInTheDocument()
    expect(screen.queryByText('안전한 상세 글')).not.toBeInTheDocument()
    expect(screen.queryByText('bread')).not.toBeInTheDocument()
    expect(screen.queryByText('보안')).not.toBeInTheDocument()
  })

  it('renders a published post, safe Markdown, metadata, and a read-only reaction count', async () => {
    const repo = repository(
      () => Promise.resolve(success(published)),
      () => Promise.resolve(success({ items: [rootComment, replyComment], hasMore: false, nextCursor: null })),
    )
    const { container } = render(<PostDetailPage repository={repo} search={`?id=${postId}`} />)

    expect(await screen.findByRole('heading', { name: '안전한 상세 글', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('bread')).toBeInTheDocument()
    expect(screen.getByLabelText('게시글 태그')).toHaveTextContent('#보안')
    expect(screen.getByRole('button', { name: '반응 7개, 읽기 전용' })).toBeDisabled()
    expect(screen.getByRole('heading', { name: '본문' })).toBeInTheDocument()
    expect(container.querySelector('script')).toBeNull()
    const comments = screen.getByRole('region', { name: '댓글 2' })
    expect(await within(comments).findByText('루트 작성자')).toBeInTheDocument()
    expect(await within(comments).findByText('reply')).toBeInTheDocument()
  })

  it('shows locked notice with existing comments and no enabled new-comment affordance', async () => {
    const repo = repository(
      () => Promise.resolve(success({ ...published, post: { ...published.post, isLocked: true } })),
      () => Promise.resolve(success({ items: [rootComment], hasMore: false, nextCursor: null })),
    )
    render(<PostDetailPage repository={repo} search={`?id=${postId}`} />)

    expect(await screen.findByRole('status', { name: '댓글 작성이 잠겼습니다' })).toBeInTheDocument()
    expect(await screen.findByText('첫 댓글')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /댓글 작성/ })).not.toBeInTheDocument()
  })

  it('announces an asynchronously loaded empty comment state', async () => {
    const repo = repository(() => Promise.resolve(success(published)))
    render(<PostDetailPage repository={repo} search={`?id=${postId}`} />)

    expect(await screen.findByText('아직 공개된 댓글이 없습니다.')).toHaveAttribute('role', 'status')
  })

  it('renders pathological unbroken metadata inside wrapping containers', async () => {
    const longValue = '긴문자열'.repeat(80)
    const repo = repository(() => Promise.resolve(success({
      ...published,
      post: {
        ...published.post,
        title: longValue,
        author: { ...published.post.author, displayName: longValue },
        tags: [{ ...published.post.tags[0], label: longValue }],
      },
    })))
    const { container } = render(<PostDetailPage repository={repo} search={`?id=${postId}`} />)

    expect(await screen.findByRole('heading', { name: longValue })).toHaveClass('post-detail-title')
    expect(container.querySelector('.post-detail-author')).toHaveTextContent(longValue)
    expect(container.querySelector('.post-detail-tags span')).toHaveTextContent(longValue)
  })

  it('retries comment pagination and appends in server order without duplicates or orphan nesting', async () => {
    const orphan = { ...replyComment, id: '56000000-0000-4000-8000-000000000022', parentId: '56000000-0000-4000-8000-000000000099', bodyMarkdown: '고아 답글' }
    const listComments = vi.fn()
      .mockResolvedValueOnce(success<CommentPage>({ items: [rootComment], hasMore: true, nextCursor: cursor }))
      .mockResolvedValueOnce(failure<CommentPage>())
      .mockResolvedValueOnce(success<CommentPage>({ items: [rootComment, replyComment, orphan], hasMore: false, nextCursor: null }))
    const repo = repository(() => Promise.resolve(success(published)), listComments)
    render(<PostDetailPage repository={repo} search={`?id=${postId}`} />)

    fireEvent.click(await screen.findByRole('button', { name: '댓글 더 보기' }))
    expect(await screen.findByRole('alert', { name: '댓글을 더 불러오지 못했습니다' })).toBeInTheDocument()
    const retryButton = screen.getByRole('button', { name: '댓글 다시 시도' })
    retryButton.focus()
    fireEvent.click(retryButton)

    await screen.findByText('답글')
    expect(screen.getAllByText('첫 댓글')).toHaveLength(1)
    expect(screen.queryByText('고아 답글')).not.toBeInTheDocument()
    expect(listComments).toHaveBeenLastCalledWith({ postId, limit: 50, cursor })
    await waitFor(() => expect(screen.queryByRole('button', { name: '댓글 더 보기' })).not.toBeInTheDocument())
    const completionStatus = screen.getByRole('status', { name: '댓글 추가 로드 결과' })
    expect(completionStatus).toHaveTextContent('댓글 1개를 더 불러왔습니다.')
    expect(document.activeElement).toBe(completionStatus)
  })
})
