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
  attachmentCount: number
  viewerReacted: boolean
}

export type PublicPostRead =
  | { kind: 'published'; post: PostDetail }
  | { kind: 'hidden' }
  | { kind: 'deleted'; commentCount: number }
  | { kind: 'not_found' }

export interface PublishedComment {
  kind: 'published'
  id: string
  parentId: string | null
  bodyMarkdown: string
  createdAt: string
  updatedAt: string
  author: ProfileSummary
  reactionCount: number
  viewerReacted: boolean
}

export interface CommentPlaceholder {
  kind: 'hidden' | 'deleted'
  id: string
  parentId: string | null
}

export type PublicComment = PublishedComment | CommentPlaceholder

export interface CreateCommentInput {
  postId: string
  parentId: string | null
  bodyMarkdown: string
  idempotencyKey: string
}

export interface ReactionState {
  reacted: boolean
  reactionCount: number
}

export interface CommentCursor {
  rootCreatedAt: string
  rootId: string
  isReply: boolean
  createdAt: string
  id: string
}

export interface CommentListInput {
  postId: string
  limit: number
  cursor?: CommentCursor
}

export interface CommentPage {
  items: PublicComment[]
  hasMore: boolean
  nextCursor: CommentCursor | null
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

export type ReportTargetType = 'post' | 'comment'
export type ReportReasonCode = 'spam' | 'harassment' | 'harmful' | 'other'
export type ReportStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed'
export type ReportStatusFilter = 'active' | ReportStatus | 'all'
export type ModerationContentStatus = 'published' | 'hidden' | 'deleted'

export interface ModerationCursor { createdAt: string; id: string }
export interface CreateReportInput { targetType: ReportTargetType; targetId: string; reasonCode: ReportReasonCode; detail: string | null; idempotencyKey: string }
export interface AdminReportListInput { status: ReportStatusFilter; limit: number; cursor?: ModerationCursor }
export interface ModerationProfile { id: string; login: string; displayName: string | null; avatarUrl: string | null }
export interface AvailableReportTarget {
  type: ReportTargetType; id: string; available: true; postId: string; status: ModerationContentStatus
  title: string; excerpt: string; isLocked: boolean; isPinned: boolean
}
export interface DanglingReportTarget { type: ReportTargetType; id: string; available: false }
export type ReportTargetSummary = AvailableReportTarget | DanglingReportTarget
export interface AdminReportItem {
  id: string; status: ReportStatus; reasonCode: ReportReasonCode; detail: string | null; createdAt: string
  resolvedAt: string | null; resolvedBy: string | null; reporter: ModerationProfile; target: ReportTargetSummary
}
export interface AdminReportPage { items: AdminReportItem[]; hasMore: boolean; nextCursor: ModerationCursor | null }
export interface SetReportStatusInput { reportId: string; expectedStatus: ReportStatus; desiredStatus: ReportStatus; reason: string; idempotencyKey: string }

export type PostModerationAction = 'hide' | 'restore' | 'lock' | 'unlock' | 'pin' | 'unpin' | 'delete'
export type CommentModerationAction = 'hide' | 'restore' | 'delete'
export interface ModeratePostInput {
  postId: string; expectedStatus: ModerationContentStatus; expectedLocked: boolean; expectedPinned: boolean
  action: PostModerationAction; reason: string; idempotencyKey: string
}
export interface ModeratedPostState {
  id: string; status: ModerationContentStatus; isLocked: boolean; isPinned: boolean; updatedAt: string; deletedAt: string | null
}
export interface ModerateCommentInput { commentId: string; expectedStatus: ModerationContentStatus; action: CommentModerationAction; reason: string; idempotencyKey: string }
export interface ModeratedCommentState { id: string; postId: string; status: ModerationContentStatus; updatedAt: string; deletedAt: string | null }
export interface SetTagActiveInput { tagId: string; expectedActive: boolean; desiredActive: boolean; reason: string; idempotencyKey: string }
export interface ModeratedTagState { id: string; slug: string; label: string; isActive: boolean; sortOrder: number }

export type ModerationAuditTargetType = 'report' | 'post' | 'comment' | 'tag'
export type ModerationAuditMetadataValue = string | number | boolean | null | ModerationAuditMetadataValue[] | { [key: string]: ModerationAuditMetadataValue }
export type ModerationAuditMetadata = Record<string, ModerationAuditMetadataValue>
export interface ModerationAuditListInput {
  limit: number; cursor?: ModerationCursor; targetType?: ModerationAuditTargetType; targetId?: string
}
export interface ModerationAuditItem {
  id: string; actor: ModerationProfile | null; action: string; targetType: ModerationAuditTargetType; targetId: string
  reason: string | null; metadata: ModerationAuditMetadata; createdAt: string
}
export interface ModerationAuditPage { items: ModerationAuditItem[]; hasMore: boolean; nextCursor: ModerationCursor | null }

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

export interface CommunityRecovery {
  code: 'session_cleared'
  message: string
}

export type CommunityResult<T> =
  | { ok: true; data: T; recovery?: CommunityRecovery }
  | { ok: false; error: CommunityError }
