import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CommunityRepository } from '../data/communityRepository'
import type { CommunityResult, CommentPage, PublicPostRead, ReactionState } from '../types/community'
import { AuthContext, type AuthContextValue } from '../auth/AuthProvider'
import { DEFAULT_AUTH_PROVIDER } from '../auth/providers'
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
    attachmentCount: 0, viewerReacted: false,
    author: { id: '56000000-0000-4000-8000-000000000030', login: 'bread', displayName: null, avatarUrl: null },
    tags: [{ id: '56000000-0000-4000-8000-000000000040', slug: 'security', label: '보안' }],
  },
}
const rootComment = {
  kind: 'published' as const, id: rootId, parentId: null, bodyMarkdown: '첫 댓글',
  createdAt: '2026-09-27T00:00:00Z', updatedAt: '2026-09-27T00:00:00Z',
  author: { id: '56000000-0000-4000-8000-000000000031', login: 'root', displayName: '루트 작성자', avatarUrl: null }, reactionCount: 1, viewerReacted: false,
}
const replyComment = {
  kind: 'published' as const, id: replyId, parentId: rootId, bodyMarkdown: '**답글**',
  createdAt: '2026-09-27T00:01:00Z', updatedAt: '2026-09-27T00:01:00Z',
  author: { id: '56000000-0000-4000-8000-000000000032', login: 'reply', displayName: null, avatarUrl: null }, reactionCount: 0, viewerReacted: false,
}

function success<T>(data: T): CommunityResult<T> { return { ok: true, data } }
function failure<T>(): CommunityResult<T> {
  return { ok: false, error: { code: 'network', sourceCode: 'NETWORK_ERROR', message: '네트워크 연결을 확인해 주세요.' } }
}
function repository(
  getPost: () => Promise<CommunityResult<PublicPostRead>>,
  listComments = () => Promise.resolve(success<CommentPage>({ items: [], hasMore: false, nextCursor: null })),
  overrides: Partial<CommunityRepository> = {},
) {
  return { getPost: vi.fn(getPost), listComments: vi.fn(listComments), ...overrides } as unknown as CommunityRepository
}

describe('PostDetailPage', () => {
  it.each(['', '?id=bad', `?id=${postId}&id=${postId}`, `?id=${postId.toUpperCase()}x`])('rejects a missing, malformed, or multiple id before repository calls: %s', async (search) => {
    const repo = repository(() => Promise.resolve(success({ kind: 'not_found' })))
    render(<PostDetailPage repository={repo} search={search} currentPath={`/community/post${search}`} />)

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
    render(<PostDetailPage repository={repo} search={`?id=${postId}`} currentPath={`/community/post?id=${postId}#discussion`} />)

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
    render(<PostDetailPage repository={repo} search={`?id=${postId}`} currentPath={`/community/post?id=${postId}#discussion`} />)

    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
    expect(repo.listComments).not.toHaveBeenCalled()
  })

  it('renders the exact deleted tombstone and preserved bounded comments without leaked post fields', async () => {
    const repo = repository(
      () => Promise.resolve(success({ kind: 'deleted', commentCount: 1 })),
      () => Promise.resolve(success({ items: [rootComment], hasMore: false, nextCursor: null })),
    )
    render(<PostDetailPage repository={repo} search={`?id=${postId}`} currentPath={`/community/post?id=${postId}#discussion`} />)

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
    const { container } = render(<PostDetailPage repository={repo} search={`?id=${postId}`} currentPath={`/community/post?id=${postId}#discussion`} />)

    expect(await screen.findByRole('heading', { name: '안전한 상세 글', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('bread')).toBeInTheDocument()
    expect(screen.getByLabelText('게시글 태그')).toHaveTextContent('#보안')
    expect(screen.getByRole('button', { name: '로그인하고 반응 남기기, 현재 7개' })).toBeEnabled()
    expect(screen.getByRole('heading', { name: '본문' })).toBeInTheDocument()
    expect(container.querySelector('script')).toBeNull()
    const comments = screen.getByRole('region', { name: '댓글 2' })
    expect(await within(comments).findByText('루트 작성자')).toBeInTheDocument()
    expect(await within(comments).findByText('reply')).toBeInTheDocument()
  })

  it('disables post and comment reactions when the published post is locked', async () => {
    const setPostReaction = vi.fn()
    const setCommentReaction = vi.fn()
    const repo = repository(
      () => Promise.resolve(success({ ...published, post: { ...published.post, isLocked: true } })),
      () => Promise.resolve(success({ items: [rootComment], hasMore: false, nextCursor: null })),
      { setPostReaction, setCommentReaction },
    )
    const auth = authValue({ user: { id: 'user-1' } as AuthContextValue['user'] })
    render(<AuthContext.Provider value={auth}><PostDetailPage repository={repo} search={`?id=${postId}`} currentPath={`/community/post?id=${postId}#discussion`} /></AuthContext.Provider>)

    expect(await screen.findByRole('status', { name: '댓글 작성이 잠겼습니다' })).toBeInTheDocument()
    expect(await screen.findByText('첫 댓글')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /댓글 작성/ })).not.toBeInTheDocument()
    const postReaction = screen.getByRole('button', { name: '반응 7개, 읽기 전용' })
    const commentReaction = screen.getByRole('button', { name: '반응 1개, 읽기 전용' })
    expect(postReaction).toBeDisabled()
    expect(commentReaction).toBeDisabled()
    fireEvent.click(postReaction)
    fireEvent.click(commentReaction)
    expect(setPostReaction).not.toHaveBeenCalled()
    expect(setCommentReaction).not.toHaveBeenCalled()
  })

  it('announces an asynchronously loaded empty comment state', async () => {
    const repo = repository(() => Promise.resolve(success(published)))
    render(<PostDetailPage repository={repo} search={`?id=${postId}`} currentPath={`/community/post?id=${postId}#discussion`} />)

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
    const { container } = render(<PostDetailPage repository={repo} search={`?id=${postId}`} currentPath={`/community/post?id=${postId}#discussion`} />)

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
    render(<PostDetailPage repository={repo} search={`?id=${postId}`} currentPath={`/community/post?id=${postId}#discussion`} />)

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



function authValue(overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return { loading:false, pending:false, session:null, user:null, error:null, signIn:vi.fn(), signOut:vi.fn(), ...overrides }
}

describe('PostDetailPage interactions', () => {
  it('offers signed-out readers an explicit comment login CTA without issuing a comment mutation', async () => {
    const createComment = vi.fn()
    const setCommentReaction = vi.fn()
    const repo = repository(() => Promise.resolve(success({ ...published, post: { ...published.post, commentCount: 0 } })), undefined, {
      createComment,
      setCommentReaction,
    })
    const currentPath = `/community/post?id=${postId}#discussion`
    const auth = authValue()
    const { rerender } = render(
      <AuthContext.Provider value={auth}>
        <PostDetailPage repository={repo} search={`?id=${postId}`} currentPath={currentPath} />
      </AuthContext.Provider>,
    )

    const login = await screen.findByRole('button', { name: '로그인하고 댓글 작성하기' })
    expect(await screen.findByText('아직 공개된 댓글이 없습니다.')).toBeInTheDocument()
    fireEvent.click(login)
    expect(auth.signIn).toHaveBeenCalledWith(DEFAULT_AUTH_PROVIDER, currentPath)
    expect(createComment).not.toHaveBeenCalled()
    expect(setCommentReaction).not.toHaveBeenCalled()

    rerender(
      <AuthContext.Provider value={authValue({ loading: true })}>
        <PostDetailPage repository={repo} search={`?id=${postId}`} currentPath={currentPath} />
      </AuthContext.Provider>,
    )
    expect(screen.getByRole('button', { name: '로그인하고 댓글 작성하기' })).toBeDisabled()

    rerender(
      <AuthContext.Provider value={authValue({ pending: true })}>
        <PostDetailPage repository={repo} search={`?id=${postId}`} currentPath={currentPath} />
      </AuthContext.Provider>,
    )
    expect(screen.getByRole('button', { name: '로그인하고 댓글 작성하기' })).toBeDisabled()
  })

  it('uses the exact current path for signed-out post reaction login CTA and makes no RPC', async () => {
    const setPostReaction = vi.fn()
    const repo = repository(() => Promise.resolve(success(published)), undefined, { setPostReaction })
    const auth = authValue()
    render(<AuthContext.Provider value={auth}><PostDetailPage repository={repo} search={`?id=${postId}`} currentPath={`/community/post?id=${postId}#discussion`} /></AuthContext.Provider>)
    fireEvent.click(await screen.findByRole('button', { name: '로그인하고 반응 남기기, 현재 7개' }))
    expect(auth.signIn).toHaveBeenCalledWith(DEFAULT_AUTH_PROVIDER, `/community/post?id=${postId}#discussion`)
    expect(setPostReaction).not.toHaveBeenCalled()
  })

  it('uses explicit signed-out report login controls without report RPCs and disables them during auth', async () => {
    const createReport = vi.fn()
    const repo = repository(
      () => Promise.resolve(success(published)),
      () => Promise.resolve(success({ items: [rootComment], hasMore: false, nextCursor: null })),
      { createReport },
    )
    const currentPath = `/community/post?id=${postId}#discussion`
    const auth = authValue()
    const { rerender } = render(
      <AuthContext.Provider value={auth}>
        <PostDetailPage repository={repo} search={`?id=${postId}`} currentPath={currentPath} />
      </AuthContext.Provider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: '로그인하고 게시글 신고하기' }))
    fireEvent.click(await screen.findByRole('button', { name: '로그인하고 댓글 신고하기' }))
    expect(auth.signIn).toHaveBeenNthCalledWith(1, DEFAULT_AUTH_PROVIDER, currentPath)
    expect(auth.signIn).toHaveBeenNthCalledWith(2, DEFAULT_AUTH_PROVIDER, currentPath)
    expect(createReport).not.toHaveBeenCalled()

    rerender(
      <AuthContext.Provider value={authValue({ pending: true })}>
        <PostDetailPage repository={repo} search={`?id=${postId}`} currentPath={currentPath} />
      </AuthContext.Provider>,
    )
    expect(screen.getByRole('button', { name: '로그인하고 게시글 신고하기' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '로그인하고 댓글 신고하기' })).toBeDisabled()
  })

  it('submits exact post and comment report targets', async () => {
    const createReport = vi.fn().mockResolvedValue(success('76000000-0000-4000-8000-000000000001'))
    const repo = repository(
      () => Promise.resolve(success(published)),
      () => Promise.resolve(success({ items: [rootComment], hasMore: false, nextCursor: null })),
      { createReport },
    )
    const auth = authValue({ user: { id: 'actor-a' } as AuthContextValue['user'] })
    render(
      <AuthContext.Provider value={auth}>
        <PostDetailPage repository={repo} search={`?id=${postId}`} currentPath="/community/post" />
      </AuthContext.Provider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: '게시글 신고하기' }))
    fireEvent.click(screen.getByRole('button', { name: '신고 제출' }))
    await screen.findByRole('status', { name: '신고 접수 완료' })
    expect(createReport.mock.calls[0][0]).toMatchObject({ targetType: 'post', targetId: postId, reasonCode: 'spam', detail: null })
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))

    fireEvent.click(screen.getByRole('button', { name: '댓글 신고하기' }))
    fireEvent.change(screen.getByRole('combobox', { name: '신고 사유' }), { target: { value: 'harassment' } })
    fireEvent.click(screen.getByRole('button', { name: '신고 제출' }))
    await screen.findByRole('status', { name: '신고 접수 완료' })
    expect(createReport.mock.calls[1][0]).toMatchObject({ targetType: 'comment', targetId: rootId, reasonCode: 'harassment', detail: null })
  })

  it('optimistically toggles post reaction, accepts authoritative count and guards rapid clicks', async () => {
    let resolve!: (value: CommunityResult<ReactionState>) => void
    const promise = new Promise<CommunityResult<ReactionState>>((r)=>{resolve=r})
    const setPostReaction = vi.fn(() => promise)
    const repo = repository(() => Promise.resolve(success(published)), undefined, { setPostReaction })
    const auth = authValue({user:{id:'user-1'} as AuthContextValue['user']})
    render(<AuthContext.Provider value={auth}><PostDetailPage repository={repo} search={`?id=${postId}`} currentPath="/community/post" /></AuthContext.Provider>)
    const button=await screen.findByRole('button',{name:'반응 남기기, 현재 7개'})
    fireEvent.click(button); fireEvent.click(button)
    expect(setPostReaction).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button',{name:'반응 취소, 현재 8개'})).toHaveAttribute('aria-busy','true')
    resolve(success({reacted:true,reactionCount:11}))
    expect(await screen.findByRole('button',{name:'반응 취소, 현재 11개'})).toBeEnabled()
  })

  it('rolls back an orphaned optimistic post reaction when the route context changes', async () => {
    let resolveReaction!: (value: CommunityResult<ReactionState>) => void
    const pendingReaction = new Promise<CommunityResult<ReactionState>>((done) => { resolveReaction = done })
    const setPostReaction = vi.fn(() => pendingReaction)
    const repo = repository(() => Promise.resolve(success(published)), undefined, { setPostReaction })
    const auth = authValue({ user: { id: 'user-1' } as AuthContextValue['user'] })
    const { rerender } = render(
      <AuthContext.Provider value={auth}>
        <PostDetailPage repository={repo} search={`?id=${postId}`} currentPath="/community/post" />
      </AuthContext.Provider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: '반응 남기기, 현재 7개' }))
    expect(screen.getByRole('button', { name: '반응 취소, 현재 8개' })).toHaveAttribute('aria-busy', 'true')

    rerender(
      <AuthContext.Provider value={auth}>
        <PostDetailPage repository={repo} search={`?id=${postId}`} currentPath="/community/post?from=search" />
      </AuthContext.Provider>,
    )

    expect(await screen.findByRole('button', { name: '반응 남기기, 현재 7개' })).toBeEnabled()
    resolveReaction(success({ reacted: true, reactionCount: 11 }))
    await pendingReaction
    expect(screen.getByRole('button', { name: '반응 남기기, 현재 7개' })).toBeEnabled()
  })

  it('dispatches at most one comment reaction while the first request is pending', async () => {
    let resolve!: (value: CommunityResult<ReactionState>) => void
    const pendingReaction = new Promise<CommunityResult<ReactionState>>((done) => { resolve = done })
    const setCommentReaction = vi.fn(() => pendingReaction)
    const repo = repository(
      () => Promise.resolve(success(published)),
      () => Promise.resolve(success({ items: [rootComment], hasMore: false, nextCursor: null })),
      { setCommentReaction },
    )
    const auth = authValue({ user: { id: 'user-1' } as AuthContextValue['user'] })
    render(
      <AuthContext.Provider value={auth}>
        <PostDetailPage repository={repo} search={`?id=${postId}`} currentPath="/community/post" />
      </AuthContext.Provider>,
    )

    const button = await screen.findByRole('button', { name: '반응 남기기, 현재 1개' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(setCommentReaction).toHaveBeenCalledTimes(1)

    resolve(success({ reacted: true, reactionCount: 4 }))
    expect(await screen.findByRole('button', { name: '반응 취소, 현재 4개' })).toBeEnabled()
  })

  it('refetches viewer state when the mounted auth actor changes and ignores actor A mutation completion', async () => {
    let resolveActorAReaction!: (value: CommunityResult<ReactionState>) => void
    const actorAReaction = new Promise<CommunityResult<ReactionState>>((done) => { resolveActorAReaction = done })
    const actorBPost = { ...published, post: { ...published.post, viewerReacted: true, reactionCount: 12 } }
    const actorBComment = { ...rootComment, viewerReacted: true, reactionCount: 6 }
    const getPost = vi.fn()
      .mockResolvedValueOnce(success(published))
      .mockResolvedValueOnce(success(actorBPost))
    const listComments = vi.fn()
      .mockResolvedValueOnce(success<CommentPage>({ items: [rootComment], hasMore: false, nextCursor: null }))
      .mockResolvedValueOnce(success<CommentPage>({ items: [actorBComment], hasMore: false, nextCursor: null }))
    const repo = repository(getPost, listComments, { setCommentReaction: vi.fn(() => actorAReaction) })
    const actorA = authValue({ user: { id: 'actor-a' } as AuthContextValue['user'] })
    const actorB = authValue({ user: { id: 'actor-b' } as AuthContextValue['user'] })
    const currentPath = `/community/post?id=${postId}#discussion`
    const { rerender } = render(
      <AuthContext.Provider value={actorA}>
        <PostDetailPage repository={repo} search={`?id=${postId}`} currentPath={currentPath} />
      </AuthContext.Provider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: '반응 남기기, 현재 1개' }))
    rerender(
      <AuthContext.Provider value={actorB}>
        <PostDetailPage repository={repo} search={`?id=${postId}`} currentPath={currentPath} />
      </AuthContext.Provider>,
    )

    await waitFor(() => {
      expect(getPost).toHaveBeenCalledTimes(2)
      expect(listComments).toHaveBeenCalledTimes(2)
    })
    expect(await screen.findByRole('button', { name: '반응 취소, 현재 12개' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '반응 취소, 현재 6개' })).toBeInTheDocument()

    resolveActorAReaction(success({ reacted: false, reactionCount: 1 }))
    await actorAReaction
    expect(screen.getByRole('button', { name: '반응 취소, 현재 6개' })).toBeInTheDocument()
  })

  it('rolls back failed reaction and retries the same desired state', async () => {
    const setPostReaction = vi.fn().mockResolvedValueOnce(failure<ReactionState>()).mockResolvedValueOnce(success({reacted:true,reactionCount:9}))
    const repo=repository(()=>Promise.resolve(success(published)), undefined, { setPostReaction })
    const auth=authValue({user:{id:'user-1'} as AuthContextValue['user']})
    render(<AuthContext.Provider value={auth}><PostDetailPage repository={repo} search={`?id=${postId}`} currentPath="/community/post" /></AuthContext.Provider>)
    fireEvent.click(await screen.findByRole('button',{name:'반응 남기기, 현재 7개'}))
    const alert=await screen.findByRole('alert',{name:'게시글 반응 오류'})
    expect(screen.getByRole('button',{name:'반응 남기기, 현재 7개'})).toBeEnabled()
    fireEvent.click(within(alert).getByRole('button',{name:'다시 시도'}))
    await screen.findByRole('button',{name:'반응 취소, 현재 9개'})
    expect(setPostReaction.mock.calls.map((call)=>call[1])).toEqual([true,true])
  })

  it('merges canonical created comments uniquely and does not lose one to a late first page', async () => {
    let resolveList!: (value: CommunityResult<CommentPage>)=>void
    const listPromise=new Promise<CommunityResult<CommentPage>>((r)=>{resolveList=r})
    const created={...rootComment,id:'56000000-0000-4000-8000-000000000055',bodyMarkdown:'새 댓글'}
    const createComment = vi.fn().mockResolvedValue(success(created))
    const repo=repository(()=>Promise.resolve(success(published)),()=>listPromise, { createComment })
    const auth=authValue({user:{id:'user-1'} as AuthContextValue['user']})
    render(<AuthContext.Provider value={auth}><PostDetailPage repository={repo} search={`?id=${postId}`} currentPath="/community/post" /></AuthContext.Provider>)
    fireEvent.change(await screen.findByRole('textbox',{name:'댓글 내용'}),{target:{value:'새 댓글'}})
    fireEvent.click(screen.getByRole('button',{name:'댓글 작성'}))
    expect(await screen.findByText('새 댓글')).toBeInTheDocument()
    resolveList(success({items:[created,rootComment],hasMore:false,nextCursor:null}))
    await screen.findByText('첫 댓글')
    expect(screen.getAllByText('새 댓글')).toHaveLength(1)
    expect(screen.getByRole('heading',{name:'댓글 3'})).toBeInTheDocument()
  })

  it('preserves a newly created comment when a pending later page resolves', async () => {
    let resolveNextPage!: (value: CommunityResult<CommentPage>) => void
    const nextPage = new Promise<CommunityResult<CommentPage>>((resolve) => { resolveNextPage = resolve })
    const listComments = vi.fn()
      .mockResolvedValueOnce(success<CommentPage>({ items: [rootComment], hasMore: true, nextCursor: cursor }))
      .mockReturnValueOnce(nextPage)
    const created = { ...rootComment, id: '56000000-0000-4000-8000-000000000056', bodyMarkdown: '페이지 요청 중 작성한 댓글' }
    const repo = repository(() => Promise.resolve(success(published)), listComments, {
      createComment: vi.fn().mockResolvedValue(success(created)),
    })
    const auth = authValue({ user: { id: 'user-1' } as AuthContextValue['user'] })
    render(<AuthContext.Provider value={auth}><PostDetailPage repository={repo} search={`?id=${postId}`} currentPath="/community/post" /></AuthContext.Provider>)

    fireEvent.click(await screen.findByRole('button', { name: '댓글 더 보기' }))
    fireEvent.change(screen.getByRole('textbox', { name: '댓글 내용' }), { target: { value: created.bodyMarkdown } })
    fireEvent.click(screen.getByRole('button', { name: '댓글 작성' }))
    expect(await screen.findByText(created.bodyMarkdown)).toBeInTheDocument()

    resolveNextPage(success({ items: [replyComment], hasMore: false, nextCursor: null }))
    expect(await screen.findByText('답글')).toBeInTheDocument()
    expect(screen.getByText(created.bodyMarkdown)).toBeInTheDocument()
    expect(screen.getByRole('status', { name: '댓글 추가 로드 결과' })).toHaveTextContent('댓글 1개를 더 불러왔습니다.')
  })

  it('announces and focuses a successful top-level comment submission', async () => {
    const created = { ...rootComment, id: '56000000-0000-4000-8000-000000000057', bodyMarkdown: '등록 완료 댓글' }
    const repo = repository(() => Promise.resolve(success(published)), undefined, {
      createComment: vi.fn().mockResolvedValue(success(created)),
    })
    const auth = authValue({ user: { id: 'user-1' } as AuthContextValue['user'] })
    render(<AuthContext.Provider value={auth}><PostDetailPage repository={repo} search={`?id=${postId}`} currentPath="/community/post" /></AuthContext.Provider>)

    fireEvent.change(await screen.findByRole('textbox', { name: '댓글 내용' }), { target: { value: created.bodyMarkdown } })
    fireEvent.click(screen.getByRole('button', { name: '댓글 작성' }))

    const status = await screen.findByRole('status', { name: '댓글 작성 완료' })
    expect(status).toHaveTextContent('댓글을 등록했습니다.')
    await waitFor(() => expect(document.activeElement).toBe(status))
  })

  it('announces and focuses a successful reply submission', async () => {
    const createdReply = { ...replyComment, id: '56000000-0000-4000-8000-000000000058', bodyMarkdown: '등록 완료 답글' }
    const repo = repository(
      () => Promise.resolve(success(published)),
      () => Promise.resolve(success({ items: [rootComment], hasMore: false, nextCursor: null })),
      { createComment: vi.fn().mockResolvedValue(success(createdReply)) },
    )
    const auth = authValue({ user: { id: 'user-1' } as AuthContextValue['user'] })
    render(<AuthContext.Provider value={auth}><PostDetailPage repository={repo} search={`?id=${postId}`} currentPath="/community/post" /></AuthContext.Provider>)

    fireEvent.click(await screen.findByRole('button', { name: '답글 작성' }))
    const replyInput = screen.getByRole('textbox', { name: '답글 내용' })
    fireEvent.change(replyInput, { target: { value: createdReply.bodyMarkdown } })
    fireEvent.click(within(replyInput.closest('form') as HTMLFormElement).getByRole('button', { name: '답글 작성' }))

    const status = await screen.findByRole('status', { name: '답글 작성 완료' })
    expect(status).toHaveTextContent('답글을 등록했습니다.')
    await waitFor(() => expect(document.activeElement).toBe(status))
  })

  it.each(['actor', 'route', 'repository'] as const)('clears a successful comment announcement when the %s changes', async (change) => {
    const created = { ...rootComment, id: '56000000-0000-4000-8000-000000000059', bodyMarkdown: '전환 전 댓글' }
    const firstRepo = repository(() => Promise.resolve(success(published)), undefined, {
      createComment: vi.fn().mockResolvedValue(success(created)),
    })
    const nextRepo = repository(() => Promise.resolve(success(published)))
    const actorA = authValue({ user: { id: 'actor-a' } as AuthContextValue['user'] })
    const actorB = authValue({ user: { id: 'actor-b' } as AuthContextValue['user'] })
    const { rerender } = render(
      <AuthContext.Provider value={actorA}>
        <PostDetailPage repository={firstRepo} search={`?id=${postId}`} currentPath="/community/post#before" />
      </AuthContext.Provider>,
    )
    fireEvent.change(await screen.findByRole('textbox', { name: '댓글 내용' }), { target: { value: created.bodyMarkdown } })
    fireEvent.click(screen.getByRole('button', { name: '댓글 작성' }))
    expect(await screen.findByRole('status', { name: '댓글 작성 완료' })).toBeInTheDocument()

    rerender(
      <AuthContext.Provider value={change === 'actor' ? actorB : actorA}>
        <PostDetailPage
          repository={change === 'repository' ? nextRepo : firstRepo}
          search={`?id=${postId}`}
          currentPath={change === 'route' ? '/community/post#after' : '/community/post#before'}
        />
      </AuthContext.Provider>,
    )

    await waitFor(() => expect(screen.queryByRole('status', { name: '댓글 작성 완료' })).not.toBeInTheDocument())
  })
})
