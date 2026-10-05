import { useEffect, useRef, useState } from 'react'
import type { CommunityRepository } from '../data/communityRepository'
import { parsePostId } from '../lib/postQuery'
import type { CommentCursor, PublicComment, PublicPostRead } from '../types/community'
import { useAuth } from '../auth/AuthProvider'
import { DEFAULT_AUTH_PROVIDER } from '../auth/providers'
import { AppHeader } from '../components/AppHeader'
import { AppFooter } from '../components/AppFooter'
import { CommentComposer, type CommentSubmitIntent } from '../components/CommentComposer'
import { CommentThread } from '../components/CommentThread'
import { MarkdownContent } from '../components/MarkdownContent'
import { PostMeta } from '../components/PostMeta'
import { ReactionButton } from '../components/ReactionButton'
import { ReportDialog } from '../components/ReportDialog'
import { SessionRecoveryNotice, useSessionRecoveryNotice } from '../components/SessionRecoveryNotice'

const commentPageSize = 50

interface PostDetailPageProps {
  repository: CommunityRepository
  search: string
  currentPath: string
}

function appendUnique(current: PublicComment[], incoming: PublicComment[]) {
  const ids = new Set(current.map((comment) => comment.id))
  return [...current, ...incoming.filter((comment) => {
    if (ids.has(comment.id)) return false
    ids.add(comment.id)
    return true
  })]
}

function visibleCommentCount(comments: PublicComment[]) {
  const rootIds = new Set(comments.filter((comment) => comment.parentId === null).map((comment) => comment.id))
  return comments.filter((comment) => comment.parentId === null || rootIds.has(comment.parentId)).length
}

function PageState({ title, role, children }: { title: string; role?: 'alert' | 'status'; children?: React.ReactNode }) {
  return (
    <section className="post-state" role={role} aria-label={title}>
      <p className="post-detail-kicker">COMMUNITY NOTE</p>
      <h1>{title}</h1>
      {children}
      <a className="post-list-link" href="/community/">커뮤니티 글 목록으로</a>
    </section>
  )
}

export function PostDetailPage({ repository, search, currentPath }: PostDetailPageProps) {
  const auth = useAuth()
  const postId = parsePostId(search)
  const [attempt, setAttempt] = useState(0)
  const [read, setRead] = useState<PublicPostRead | null>(null)
  const [postError, setPostError] = useState<string | null>(null)
  const [comments, setComments] = useState<PublicComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentsError, setCommentsError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<CommentCursor | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [commentAnnouncement, setCommentAnnouncement] = useState<string | null>(null)
  const [commentMutationAnnouncement, setCommentMutationAnnouncement] = useState<{ label: string; message: string } | null>(null)
  const [createdCommentCount, setCreatedCommentCount] = useState(0)
  const [postReaction, setPostReaction] = useState<{ reacted: boolean; count: number } | null>(null)
  const [postReactionPending, setPostReactionPending] = useState(false)
  const [postReactionError, setPostReactionError] = useState<string | null>(null)
  const [failedPostReaction, setFailedPostReaction] = useState<boolean | null>(null)
  const [commentReactionPending, setCommentReactionPending] = useState<Set<string>>(new Set())
  const [commentMutationError, setCommentMutationError] = useState<string | null>(null)
  const [recovery, consumeRecovery] = useSessionRecoveryNotice()
  const commentRequestGeneration = useRef(0)
  const mutationGeneration = useRef(0)
  const postReactionInvoking = useRef(false)
  const postReactionRollback = useRef<{ reacted: boolean; count: number } | null>(null)
  const commentReactionInvoking = useRef(new Set<string>())
  const locallyCreatedCommentIds = useRef(new Set<string>())
  const commentsRef = useRef<PublicComment[]>([])
  const commentAnnouncementRef = useRef<HTMLParagraphElement>(null)
  const commentMutationAnnouncementRef = useRef<HTMLParagraphElement>(null)
  commentsRef.current = comments

  useEffect(() => {
    mutationGeneration.current += 1
    if (postReactionInvoking.current) setPostReaction(postReactionRollback.current)
    postReactionInvoking.current = false
    postReactionRollback.current = null
    commentReactionInvoking.current.clear()
    setPostReactionPending(false)
    setPostReactionError(null)
    setFailedPostReaction(null)
    setCommentReactionPending(new Set())
    setCommentMutationError(null)
    setCommentAnnouncement(null)
    setCommentMutationAnnouncement(null)
  }, [auth.user?.id, currentPath, postId, repository])

  useEffect(() => {
    if (commentAnnouncement) commentAnnouncementRef.current?.focus()
  }, [commentAnnouncement])

  useEffect(() => {
    if (commentMutationAnnouncement) commentMutationAnnouncementRef.current?.focus()
  }, [commentMutationAnnouncement])

  useEffect(() => {
    if (!postId) return
    commentRequestGeneration.current += 1
    let active = true
    const requestSession = auth.session
    setRead(null)
    setPostReaction(null)
    setPostError(null)
    setComments([])
    commentsRef.current = []
    setNextCursor(null)
    setHasMore(false)
    setCommentsError(null)
    setCommentAnnouncement(null)
    setCommentMutationAnnouncement(null)
    setCreatedCommentCount(0)
    locallyCreatedCommentIds.current = new Set()
    void repository.getPost(postId).then((result) => {
      if (!active) return
      if (result.ok) {
        consumeRecovery(result.recovery, requestSession)
        setPostReaction(result.data.kind === 'published'
          ? { reacted: result.data.post.viewerReacted, count: result.data.post.reactionCount }
          : null)
        setRead(result.data)
      } else {
        setPostError(result.error.message)
      }
    })
    return () => { active = false }
  }, [attempt, auth.session, auth.user?.id, consumeRecovery, postId, repository])

  useEffect(() => {
    if (!postId || (read?.kind !== 'published' && read?.kind !== 'deleted')) return
    let active = true
    const requestSession = auth.session
    setCommentsLoading(true)
    setCommentsError(null)
    void repository.listComments({ postId, limit: commentPageSize }).then((result) => {
      if (!active) return
      if (result.ok) {
        consumeRecovery(result.recovery, requestSession)
        commentsRef.current = appendUnique(commentsRef.current, result.data.items)
        setComments((current) => appendUnique(current, result.data.items))
        setHasMore(result.data.hasMore)
        setNextCursor(result.data.nextCursor)
      } else {
        setCommentsError(result.error.message)
      }
      setCommentsLoading(false)
    })
    return () => { active = false }
  }, [auth.session, consumeRecovery, postId, read, repository])

  function login() {
    void auth.signIn(DEFAULT_AUTH_PROVIDER, currentPath)
  }

  function setPostReactionDesired(desired: boolean) {
    if (!postId || read?.kind !== 'published' || read.post.isLocked || postReactionPending || postReactionInvoking.current) return
    if (!auth.user) { login(); return }
    const previous = postReaction ?? { reacted: read.post.viewerReacted, count: read.post.reactionCount }
    const generation = mutationGeneration.current
    postReactionRollback.current = previous
    postReactionInvoking.current = true
    setPostReactionPending(true)
    setPostReactionError(null)
    setPostReaction({ reacted: desired, count: Math.max(0, previous.count + (desired ? 1 : -1)) })
    void repository.setPostReaction(postId, desired).then((result) => {
      if (generation !== mutationGeneration.current) return
      if (result.ok) {
        setPostReaction({ reacted: result.data.reacted, count: result.data.reactionCount })
        setFailedPostReaction(null)
      } else {
        setPostReaction(previous)
        setPostReactionError(result.error.message)
        setFailedPostReaction(desired)
      }
      setPostReactionPending(false)
      postReactionInvoking.current = false
      postReactionRollback.current = null
    })
  }

  async function createComment(parentId: string | null, intent: CommentSubmitIntent) {
    if (!postId || !auth.user || read?.kind !== 'published' || read.post.isLocked) return false
    const generation = mutationGeneration.current
    setCommentMutationError(null)
    const result = await repository.createComment({ postId, parentId, ...intent })
    if (generation !== mutationGeneration.current) return false
    if (!result.ok) {
      setCommentMutationError(result.error.message)
      return false
    }
    if (!locallyCreatedCommentIds.current.has(result.data.id)) {
      locallyCreatedCommentIds.current.add(result.data.id)
      commentsRef.current = appendUnique(commentsRef.current, [result.data])
      setComments((current) => appendUnique(current, [result.data]))
      setCreatedCommentCount((count) => count + 1)
    }
    setCommentMutationAnnouncement(parentId === null
      ? { label: '댓글 작성 완료', message: '댓글을 등록했습니다.' }
      : { label: '답글 작성 완료', message: '답글을 등록했습니다.' })
    return true
  }

  function reactToComment(comment: Extract<PublicComment, { kind: 'published' }>) {
    if (read?.kind !== 'published' || read.post.isLocked) return
    if (!auth.user || commentReactionInvoking.current.has(comment.id)) { if (!auth.user) login(); return }
    const desired = !comment.viewerReacted
    const generation = mutationGeneration.current
    commentReactionInvoking.current.add(comment.id)
    setCommentMutationError(null)
    setCommentReactionPending((current) => new Set(current).add(comment.id))
    setComments((current) => current.map((item) => item.id === comment.id && item.kind === 'published'
      ? { ...item, viewerReacted: desired, reactionCount: Math.max(0, item.reactionCount + (desired ? 1 : -1)) }
      : item))
    void repository.setCommentReaction(comment.id, desired).then((result) => {
      if (generation !== mutationGeneration.current) return
      if (result.ok) {
        setComments((current) => current.map((item) => item.id === comment.id && item.kind === 'published'
          ? { ...item, viewerReacted: result.data.reacted, reactionCount: result.data.reactionCount }
          : item))
      } else {
        setComments((current) => current.map((item) => item.id === comment.id ? comment : item))
        setCommentMutationError(result.error.message)
      }
      setCommentReactionPending((current) => {
        const next = new Set(current)
        next.delete(comment.id)
        return next
      })
      commentReactionInvoking.current.delete(comment.id)
    })
  }

  function loadMoreComments() {
    if (!postId || !nextCursor || commentsLoading) return
    const requestGeneration = commentRequestGeneration.current
    const requestSession = auth.session
    setCommentsLoading(true)
    setCommentsError(null)
    setCommentAnnouncement(null)
    void repository.listComments({ postId, limit: commentPageSize, cursor: nextCursor }).then((result) => {
      if (requestGeneration !== commentRequestGeneration.current) return
      if (result.ok) {
        consumeRecovery(result.recovery, requestSession)
        const currentComments = commentsRef.current
        const nextComments = appendUnique(currentComments, result.data.items)
        const addedCount = visibleCommentCount(nextComments) - visibleCommentCount(currentComments)
        commentsRef.current = nextComments
        setComments((current) => appendUnique(current, result.data.items))
        setHasMore(result.data.hasMore)
        setNextCursor(result.data.nextCursor)
        setCommentAnnouncement(`댓글 ${addedCount}개를 더 불러왔습니다.`)
      } else {
        setCommentsError(result.error.message)
      }
      setCommentsLoading(false)
    })
  }

  if (!postId) {
    return (
      <div className="community-page post-detail-page">
        <AppHeader />
        <main><PageState title="올바르지 않은 게시글 주소입니다" /></main>
        <AppFooter />
      </div>
    )
  }

  let content: React.ReactNode
  if (postError) {
    content = (
      <PageState title={postError} role="alert">
        <button className="secondary-action" type="button" onClick={() => setAttempt((value) => value + 1)}>다시 시도</button>
      </PageState>
    )
  } else if (!read) {
    content = <PageState title="게시글을 불러오고 있습니다" role="status" />
  } else if (read.kind === 'not_found') {
    content = <PageState title="게시글을 찾을 수 없습니다" />
  } else if (read.kind === 'hidden') {
    content = <PageState title="운영 정책에 따라 공개되지 않은 글입니다" />
  } else {
    const deleted = read.kind === 'deleted'
    const commentCount = (deleted ? read.commentCount : read.post.commentCount) + createdCommentCount
    content = (
      <>
        <article className={deleted ? 'post-detail post-tombstone' : 'post-detail'}>
          <a className="post-list-link" href="/community/">← 커뮤니티 글 목록으로</a>
          {deleted ? (
            <header className="post-detail-heading">
              <p className="post-detail-kicker">DELETED NOTE</p>
              <h1>삭제된 글입니다</h1>
              <p>본문 정보는 남아 있지 않으며, 기존 공개 댓글만 보존됩니다.</p>
            </header>
          ) : (
            <>
              <header className="post-detail-heading">
                <p className="post-detail-kicker">PUBLIC JOURNAL</p>
                <h1 className="post-detail-title">{read.post.title}</h1>
                <PostMeta post={read.post} />
                <div className="post-detail-tags" aria-label="게시글 태그">
                  {read.post.tags.map((tag) => <span key={tag.id}>#{tag.label}</span>)}
                </div>
                <ReactionButton
                  count={postReaction?.count ?? read.post.reactionCount}
                  pressed={postReaction?.reacted ?? read.post.viewerReacted}
                  pending={postReactionPending}
                  disabled={auth.loading || auth.pending}
                  readOnly={read.post.isLocked}
                  loginRequired={!auth.user}
                  onToggle={() => setPostReactionDesired(!(postReaction?.reacted ?? read.post.viewerReacted))}
                />
                <ReportDialog
                  repository={repository}
                  targetType="post"
                  targetId={read.post.id}
                  targetLabel={`게시글 “${read.post.title}”`}
                  actorId={auth.user?.id ?? null}
                  currentPath={currentPath}
                  authLoading={auth.loading}
                  authPending={auth.pending}
                  onLogin={login}
                />
                {postReactionError && (
                  <div role="alert" aria-label="게시글 반응 오류">
                    <p>{postReactionError}</p>
                    <button type="button" className="secondary-action" onClick={() => failedPostReaction !== null && setPostReactionDesired(failedPostReaction)}>다시 시도</button>
                  </div>
                )}
              </header>
              <MarkdownContent
                markdown={read.post.bodyMarkdown}
                className="post-detail-body"
                allowedImageOrigin={repository.publicAttachmentOrigin}
              />
            </>
          )}
        </article>

        <section className="comments-section" aria-labelledby="comments-heading" aria-label="댓글">
          <div className="comments-heading">
            <p className="post-detail-kicker">DISCUSSION ARCHIVE</p>
            <h2 id="comments-heading">댓글 <span>{commentCount}</span></h2>
          </div>
          {!deleted && read.post.isLocked && <p className="locked-notice" role="status" aria-label="댓글 작성이 잠겼습니다">이 글은 댓글 작성이 잠겨 있습니다. 기존 댓글은 계속 읽을 수 있습니다.</p>}
          {!deleted && !read.post.isLocked && !auth.user && (
            <button className="secondary-action" type="button" disabled={auth.loading || auth.pending} onClick={login}>
              로그인하고 댓글 작성하기
            </button>
          )}
          {!deleted && !read.post.isLocked && auth.user && <CommentComposer onSubmit={(intent) => createComment(null, intent)} />}
          {commentMutationError && <p className="comments-status" role="alert">{commentMutationError}</p>}
          {commentMutationAnnouncement && (
            <p
              ref={commentMutationAnnouncementRef}
              className="comments-status"
              role="status"
              aria-label={commentMutationAnnouncement.label}
              tabIndex={-1}
            >
              {commentMutationAnnouncement.message}
            </p>
          )}
          {comments.length > 0 && (
            <CommentThread
              comments={comments}
              canMutate={Boolean(auth.user)}
              allowReplies={!deleted && !read.post.isLocked}
              readOnly={deleted || read.post.isLocked}
              reactionPending={commentReactionPending}
              onReply={(parentId, intent) => createComment(parentId, intent)}
              onReact={reactToComment}
              onLogin={login}
              reporting={{
                repository,
                actorId: auth.user?.id ?? null,
                currentPath,
                authLoading: auth.loading,
                authPending: auth.pending,
              }}
            />
          )}
          {commentsLoading && comments.length === 0 && <p className="comments-status" role="status">댓글을 불러오고 있습니다.</p>}
          {!commentsLoading && !commentsError && comments.length === 0 && <p className="comments-status" role="status">아직 공개된 댓글이 없습니다.</p>}
          {commentsError && (
            <div className="comments-status" role="alert" aria-label="댓글을 더 불러오지 못했습니다">
              <p>{commentsError}</p>
              <button className="secondary-action" type="button" onClick={comments.length > 0 ? loadMoreComments : () => setAttempt((value) => value + 1)}>댓글 다시 시도</button>
            </div>
          )}
          {!commentsError && hasMore && nextCursor && (
            <div className="comments-status">
              <button className="secondary-action" type="button" disabled={commentsLoading} onClick={loadMoreComments}>
                {commentsLoading ? '불러오는 중' : '댓글 더 보기'}
              </button>
            </div>
          )}
          {commentAnnouncement && (
            <p
              ref={commentAnnouncementRef}
              className="comments-status"
              role="status"
              aria-label="댓글 추가 로드 결과"
              tabIndex={-1}
            >
              {commentAnnouncement}
            </p>
          )}
        </section>
      </>
    )
  }

  return (
    <div className="community-page post-detail-page">
      <AppHeader />
      <main><SessionRecoveryNotice recovery={recovery} />{content}</main>
      <AppFooter />
    </div>
  )
}
