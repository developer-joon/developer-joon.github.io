import type { Tables } from './database'

export type ProfileSummary = Pick<Tables<'profiles'>, 'id' | 'login'> & {
  displayName: string | null
  avatarUrl: string | null
}

export type CommunityTag = Pick<Tables<'tags'>, 'id' | 'slug' | 'label'>

export interface PostListItem {
  id: string
  title: string
  excerpt: string
  createdAt: string
  updatedAt: string
  isLocked: boolean
  isPinned: boolean
  commentCount: number
  reactionCount: number
  popularityScore: number
  author: ProfileSummary
  tags: CommunityTag[]
}

export interface PostDetail extends PostListItem {
  bodyMarkdown: string
}

export interface PostCursor {
  isPinned: boolean
  searchRank: number
  createdAt: string
  id: string
  rank: number | null
}

export type PostSort = 'newest' | 'popular' | 'comments'

export interface PostListInput {
  limit: number
  sort?: PostSort
  cursor?: PostCursor
  search?: string
  tagId?: string
}

export interface PostPage {
  items: PostListItem[]
  nextCursor: PostCursor | null
}

export interface CreatePostInput {
  title: string
  bodyMarkdown: string
  tagIds: string[]
  idempotencyKey: string
}

export interface UpdatePostInput {
  postId: string
  title: string
  bodyMarkdown: string
  tagIds: string[]
}

export type CommunityErrorCode =
  | 'auth_required'
  | 'conflict'
  | 'forbidden'
  | 'network'
  | 'not_found'
  | 'rate_limited'
  | 'unknown'
  | 'validation'

export interface CommunityError {
  code: CommunityErrorCode
  sourceCode: string
  message: string
}

export type CommunityResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: CommunityError }
