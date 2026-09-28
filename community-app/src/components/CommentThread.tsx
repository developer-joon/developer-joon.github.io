import { useState } from 'react'
import type { PublicComment } from '../types/community'
import { MarkdownContent } from './MarkdownContent'
import { ReactionButton } from './ReactionButton'
import { ReplyComposer } from './ReplyComposer'
import { ReportDialog, type ReportDialogProps } from './ReportDialog'
import type { CommentSubmitIntent } from './CommentComposer'

type ReportingContext = Pick<ReportDialogProps, 'repository' | 'actorId' | 'currentPath' | 'authLoading' | 'authPending' | 'uuidFactory'>

interface Props {
  comments: PublicComment[]
  canMutate: boolean
  allowReplies?: boolean
  readOnly?: boolean
  reactionPending?: ReadonlySet<string>
  onReply(parentId: string, intent: CommentSubmitIntent): Promise<boolean>
  onReact(comment: Extract<PublicComment, { kind:'published' }>): void
  onLogin?: () => void
  reporting?: ReportingContext
}

export function CommentThread({ comments, canMutate, allowReplies = true, readOnly = false, reactionPending = new Set(), onReply, onReact, onLogin, reporting }: Props) {
  const [activeReply, setActiveReply] = useState<string | null>(null)
  const roots = comments.filter((comment) => comment.parentId === null)
  function renderComment(comment: PublicComment, reply: boolean) {
    if (comment.kind !== 'published') return <article key={comment.id} className={`comment comment-placeholder${reply ? ' comment-reply' : ''}`}><p>{comment.kind === 'hidden' ? '숨김 처리된 댓글입니다.' : '삭제된 댓글입니다.'}</p></article>
    const author = comment.author.displayName?.trim() || comment.author.login
    return <article key={comment.id} className={`comment${reply ? ' comment-reply' : ''}`}>
      <header><strong>{author}</strong><time dateTime={comment.createdAt}>{new Intl.DateTimeFormat('ko-KR', { dateStyle:'medium' }).format(new Date(comment.createdAt))}</time></header>
      <MarkdownContent markdown={comment.bodyMarkdown} className="comment-body" allowImages={false} />
      <div className="comment-actions"><ReactionButton count={comment.reactionCount} pressed={comment.viewerReacted} pending={reactionPending.has(comment.id)} readOnly={readOnly} loginRequired={!canMutate} onToggle={() => canMutate ? onReact(comment) : onLogin?.()} />
        {!reply && allowReplies && <button type="button" className="reply-action" aria-label={canMutate ? undefined : '로그인하고 답글 작성'} onClick={() => canMutate ? setActiveReply(comment.id) : onLogin?.()}>답글 작성</button>}
        {reporting && <ReportDialog {...reporting} targetType="comment" targetId={comment.id} targetLabel={`${author}님의 댓글`} onLogin={() => onLogin?.()} />}
      </div>
      {!reply && activeReply === comment.id && <ReplyComposer onCancel={() => setActiveReply(null)} onSubmit={async (intent) => { const ok = await onReply(comment.id, intent); if (ok) setActiveReply(null); return ok }} />}
    </article>
  }
  return <div className="comment-list">{roots.map((root) => <div className="comment-thread" key={root.id}>{renderComment(root, false)}{comments.filter((item) => item.parentId === root.id).map((item) => renderComment(item, true))}</div>)}</div>
}
