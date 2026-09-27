import type { PostDetail } from '../types/community'

function readableDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(value))
}

export function PostMeta({ post }: { post: PostDetail }) {
  const authorName = post.author.displayName?.trim() || post.author.login
  return (
    <div className="post-detail-meta">
      <span className="post-detail-author">{authorName}</span>
      <span>작성 <time dateTime={post.createdAt}>{readableDate(post.createdAt)}</time></span>
      {post.updatedAt !== post.createdAt && <span>수정 <time dateTime={post.updatedAt}>{readableDate(post.updatedAt)}</time></span>}
    </div>
  )
}
