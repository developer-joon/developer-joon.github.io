import { useEffect, useState } from 'react'
import type { CommunityRepository } from '../data/communityRepository'
import { parsePostId } from '../lib/postQuery'
import type { CommentCursor, PublicComment, PublicPostRead } from '../types/community'
import { AppHeader } from '../components/AppHeader'
import { CommentList } from '../components/CommentList'
import { MarkdownContent } from '../components/MarkdownContent'
import { PostMeta } from '../components/PostMeta'
import { ReactionButton } from '../components/ReactionButton'

const commentPageSize = 50

interface PostDetailPageProps {
  repository: CommunityRepository
  search: string
}

function appendUnique(current: PublicComment[], incoming: PublicComment[]) {
  const ids = new Set(current.map((comment) => comment.id))
  return [...current, ...incoming.filter((comment) => {
    if (ids.has(comment.id)) return false
    ids.add(comment.id)
    return true
  })]
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

export function PostDetailPage({ repository, search }: PostDetailPageProps) {
  const postId = parsePostId(search)
  const [attempt, setAttempt] = useState(0)
  const [read, setRead] = useState<PublicPostRead | null>(null)
  const [postError, setPostError] = useState<string | null>(null)
  const [comments, setComments] = useState<PublicComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentsError, setCommentsError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<CommentCursor | null>(null)
  const [hasMore, setHasMore] = useState(false)

  useEffect(() => {
    if (!postId) return
    let active = true
    setRead(null)
    setPostError(null)
    setComments([])
    setNextCursor(null)
    setHasMore(false)
    setCommentsError(null)
    void repository.getPost(postId).then((result) => {
      if (!active) return
      if (result.ok) setRead(result.data)
      else setPostError(result.error.message)
    })
    return () => { active = false }
  }, [attempt, postId, repository])

  useEffect(() => {
    if (!postId || (read?.kind !== 'published' && read?.kind !== 'deleted')) return
    let active = true
    setCommentsLoading(true)
    setCommentsError(null)
    void repository.listComments({ postId, limit: commentPageSize }).then((result) => {
      if (!active) return
      if (result.ok) {
        setComments(appendUnique([], result.data.items))
        setHasMore(result.data.hasMore)
        setNextCursor(result.data.nextCursor)
      } else {
        setCommentsError(result.error.message)
      }
      setCommentsLoading(false)
    })
    return () => { active = false }
  }, [postId, read, repository])

  function loadMoreComments() {
    if (!postId || !nextCursor || commentsLoading) return
    setCommentsLoading(true)
    setCommentsError(null)
    void repository.listComments({ postId, limit: commentPageSize, cursor: nextCursor }).then((result) => {
      if (result.ok) {
        setComments((current) => appendUnique(current, result.data.items))
        setHasMore(result.data.hasMore)
        setNextCursor(result.data.nextCursor)
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
    const commentCount = deleted ? read.commentCount : read.post.commentCount
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
                <h1>{read.post.title}</h1>
                <PostMeta post={read.post} />
                <div className="post-detail-tags" aria-label="게시글 태그">
                  {read.post.tags.map((tag) => <span key={tag.id}>#{tag.label}</span>)}
                </div>
                <ReactionButton count={read.post.reactionCount} />
              </header>
              <MarkdownContent markdown={read.post.bodyMarkdown} className="post-detail-body" />
            </>
          )}
        </article>

        <section className="comments-section" aria-labelledby="comments-heading" aria-label="댓글">
          <div className="comments-heading">
            <p className="post-detail-kicker">DISCUSSION ARCHIVE</p>
            <h2 id="comments-heading">댓글 <span>{commentCount}</span></h2>
          </div>
          {!deleted && read.post.isLocked && <p className="locked-notice" role="status" aria-label="댓글 작성이 잠겼습니다">이 글은 댓글 작성이 잠겨 있습니다. 기존 댓글은 계속 읽을 수 있습니다.</p>}
          {comments.length > 0 && <CommentList comments={comments} />}
          {commentsLoading && comments.length === 0 && <p className="comments-status" role="status">댓글을 불러오고 있습니다.</p>}
          {!commentsLoading && !commentsError && comments.length === 0 && <p className="comments-status">아직 공개된 댓글이 없습니다.</p>}
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
        </section>
      </>
    )
  }

  return (
    <div className="community-page post-detail-page">
      <AppHeader />
      <main>{content}</main>
      <footer className="community-footer"><span>BREADLAB · 개발 기록과 열린 대화</span><a href="/privacy/">개인정보 처리방침</a></footer>
    </div>
  )
}
