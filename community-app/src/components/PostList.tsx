import type { PostListItem } from '../types/community'
import { PostCard } from './PostCard'

export function PostList({ posts }: { posts: PostListItem[] }) {
  return <div className="post-list">{posts.map((post) => <PostCard key={post.id} post={post} />)}</div>
}
