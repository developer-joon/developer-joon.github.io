import type { PostListItem } from '../types/community'

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value))
}

export function PostCard({ post }: { post: PostListItem }) {
  return (
    <article className="post-card">
      <div className="post-card-meta">
        {post.isPinned && <span className="pinned">공지</span>}
        <span>{post.author.displayName || post.author.login}</span>
        <time dateTime={post.createdAt}>{formatDate(post.createdAt)}</time>
      </div>
      <h2><a href={`/community/post/?id=${encodeURIComponent(post.id)}`}>{post.title}</a></h2>
      <p>{post.excerpt}</p>
      <footer>
        <div className="post-tags">{post.tags.map((tag) => <span key={tag.id}>#{tag.label}</span>)}</div>
        <div className="post-counts" aria-label={`댓글 ${post.commentCount}개, 좋아요 ${post.reactionCount}개`}>
          <span>댓글 {post.commentCount}</span><span>좋아요 {post.reactionCount}</span>
        </div>
      </footer>
    </article>
  )
}
