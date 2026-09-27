import type { PublicComment } from '../types/community'
import { MarkdownContent } from './MarkdownContent'

function Comment({ comment, reply = false }: { comment: PublicComment; reply?: boolean }) {
  const author = comment.author.displayName?.trim() || comment.author.login
  return (
    <article className={reply ? 'comment comment-reply' : 'comment'}>
      <header>
        <strong>{author}</strong>
        <time dateTime={comment.createdAt}>{new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(new Date(comment.createdAt))}</time>
      </header>
      <MarkdownContent markdown={comment.bodyMarkdown} className="comment-body" allowImages={false} />
    </article>
  )
}

export function CommentList({ comments }: { comments: PublicComment[] }) {
  const roots = comments.filter((comment) => comment.parentId === null)
  return (
    <div className="comment-list">
      {roots.map((root) => (
        <div className="comment-thread" key={root.id}>
          <Comment comment={root} />
          {comments.filter((comment) => comment.parentId === root.id).map((reply) => (
            <Comment comment={reply} reply key={reply.id} />
          ))}
        </div>
      ))}
    </div>
  )
}
