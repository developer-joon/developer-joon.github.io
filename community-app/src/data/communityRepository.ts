import type {
  AdminReportItem,
  AdminReportListInput,
  AdminReportPage,
  CommunityError,
  CommunityResult,
  CommunityTag,
  CommentListInput,
  CommentPage,
  CreateCommentInput,
  CreatePostInput,
  CreateReportInput,
  ModerateCommentInput,
  ModeratedCommentState,
  ModeratedPostState,
  ModeratedTagState,
  ModeratePostInput,
  ModerationAuditItem,
  ModerationAuditListInput,
  ModerationAuditMetadata,
  ModerationAuditMetadataValue,
  ModerationAuditPage,
  ModerationAuditTargetType,
  ModerationCursor,
  PostDetail,
  PublicComment,
  ReactionState,
  PostListInput,
  PostListItem,
  PostPage,
  PublicPostRead,
  SetReportStatusInput,
  SetTagActiveInput,
  UpdatePostInput,
} from '../types/community'
import type { Database } from '../types/database'
import { getAnonymousSupabaseClient, getSupabaseClient } from '../lib/supabase'
import { parseEnv } from '../config/env'
import { isCanonicalUuid, isStrictUuid } from '../lib/uuid'

export interface QueryResponse { data: unknown; error: unknown }
type Functions = Database['public']['Functions']
type ExistingMutationName = 'create_post' | 'update_post' | 'soft_delete_post'
type NewMutationName = 'create_comment_v2' | 'set_post_reaction' | 'set_comment_reaction'
type ReadName = 'list_public_posts' | 'get_public_post_v3' | 'list_public_post_comments_v2'
type ModerationName = 'is_admin' | 'create_report_v2' | 'list_moderation_reports_v1' | 'set_report_status_v1'
  | 'moderate_post_v1' | 'moderate_comment_v1' | 'set_tag_active_v1' | 'list_moderation_audit_logs_v1'
type RpcName = ReadName | ExistingMutationName | NewMutationName | ModerationName
type RpcArgs<Name extends RpcName> = Name extends 'create_comment_v2'
  ? Omit<Functions['create_comment_v2']['Args'], 'p_parent_id'> & { p_parent_id: string | null }
  : Name extends 'create_report_v2'
    ? Omit<Functions['create_report_v2']['Args'], 'p_detail'> & { p_detail: string | null }
  : Name extends keyof Functions
    ? Functions[Name] extends { Args: infer Args } ? Args : never
    : never

export interface CommunityClient {
  publicAttachmentUrl(attachmentId: string): string
  listTags(): PromiseLike<QueryResponse>
  rpc<Name extends RpcName>(name: Name, args: RpcArgs<Name>): PromiseLike<QueryResponse>
}

interface PublicReadRecovery {
  anonymousClient: CommunityClient
}

interface RawTag { id: string; slug: string; label: string }
type GeneratedPublicPostRow = Functions['list_public_posts']['Returns'][number]
type PublicPostRow = Omit<GeneratedPublicPostRow, 'author_avatar_url' | 'author_display_name' | 'rank_key'> & {
  author_avatar_url: string | null
  author_display_name: string | null
  rank_key: number | null
}
type GeneratedPublicPostDetailRow = Functions['get_public_post']['Returns'][number]
type PublicPostDetailRow = Omit<GeneratedPublicPostDetailRow, 'author_avatar_url' | 'author_display_name'> & {
  author_avatar_url: string | null
  author_display_name: string | null
  attachment_count: number
  viewer_reacted: boolean
}

function failure(error: CommunityError): CommunityResult<never> { return { ok: false, error } }
function sourceCodeFrom(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'UNKNOWN_ERROR'
  const value = error as { code?: unknown; message?: unknown }
  if (value.code === 'PGRST' && typeof value.message === 'string') {
    try {
      const payload: unknown = JSON.parse(value.message)
      if (typeof payload === 'object' && payload !== null && typeof (payload as { code?: unknown }).code === 'string') {
        return (payload as { code: string }).code
      }
    } catch { return 'PGRST' }
  }
  return typeof value.code === 'string' ? value.code : 'UNKNOWN_ERROR'
}
function mapError(error: unknown): CommunityError {
  if (error instanceof TypeError) return { code: 'network', sourceCode: 'NETWORK_ERROR', message: '네트워크 연결을 확인해 주세요.' }
  if (typeof error === 'object' && error !== null) {
    const value = error as { code?: unknown; message?: unknown }
    if ((!value.code || value.code === 'FETCH_ERROR') && typeof value.message === 'string' && /failed to fetch|networkerror|network request failed/i.test(value.message)) {
      return { code: 'network', sourceCode: 'NETWORK_ERROR', message: '네트워크 연결을 확인해 주세요.' }
    }
  }
  const sourceCode = sourceCodeFrom(error)
  switch (sourceCode) {
    case 'PGRST301': case 'PGRST303': return { code: 'auth_required', sourceCode, message: '로그인이 필요합니다.' }
    case '42501': return { code: 'forbidden', sourceCode, message: '요청할 권한이 없습니다.' }
    case '22023': case '23514': return { code: 'validation', sourceCode, message: '입력 내용을 확인해 주세요.' }
    case '23505': return { code: 'conflict', sourceCode, message: '이미 처리된 요청입니다.' }
    case '40001': return { code: 'conflict', sourceCode, message: '상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요.' }
    case 'rate_limit_exceeded': return { code: 'rate_limited', sourceCode, message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' }
    case 'PGRST116': return { code: 'not_found', sourceCode, message: '게시글을 찾을 수 없습니다.' }
    default: return { code: 'unknown', sourceCode, message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
  }
}
async function execute<T>(operation: () => PromiseLike<QueryResponse>, map: (data: unknown) => T): Promise<CommunityResult<T>> {
  let response: QueryResponse
  try {
    response = await operation()
  } catch (error) {
    return failure(mapError(error))
  }
  if (response.error) {
    return failure(mapError(response.error))
  }
  try {
    return { ok: true, data: map(response.data) }
  } catch {
    return failure({
      code: 'unknown',
      sourceCode: 'INVALID_RESPONSE',
      message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    })
  }
}
async function executePublic<T>(
  client: CommunityClient,
  recovery: PublicReadRecovery | undefined,
  operation: (target: CommunityClient) => PromiseLike<QueryResponse>,
  map: (data: unknown) => T,
): Promise<CommunityResult<T>> {
  const first = await execute(() => operation(client), map)
  if (first.ok || first.error.code !== 'auth_required' || !recovery) return first
  const retry = await execute(() => operation(recovery.anonymousClient), map)
  return retry.ok
    ? { ...retry, recovery: { code: 'session_stale', message: '로그인 세션이 만료되었습니다. Google로 다시 로그인해 주세요.' } }
    : retry
}
function mapTag(tag: RawTag): CommunityTag { return { id: tag.id, slug: tag.slug, label: tag.label } }
function tagsFrom(value: unknown): CommunityTag[] { return Array.isArray(value) ? (value as RawTag[]).map(mapTag) : [] }
function mapListPost(row: PublicPostRow): PostListItem {
  return {
    id: row.id, title: row.title, excerpt: row.excerpt, createdAt: row.created_at, updatedAt: row.updated_at,
    isLocked: row.is_locked, isPinned: row.is_pinned, commentCount: row.comment_count,
    reactionCount: row.reaction_count, popularityScore: row.popularity_score,
    author: { id: row.author_id, login: row.author_login, displayName: row.author_display_name, avatarUrl: row.author_avatar_url },
    tags: tagsFrom(row.tags),
  }
}
const publicAttachmentPath = /\/functions\/v1\/public-attachment\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g

function mapDetailPost(row: PublicPostDetailRow, publicAttachmentUrl: (attachmentId: string) => string): PostDetail {
  const bodyMarkdown = row.body_markdown.replace(publicAttachmentPath, (_path, attachmentId: string) => publicAttachmentUrl(attachmentId))
  return {
    id: row.id, title: row.title, excerpt: bodyMarkdown.slice(0, 180), bodyMarkdown,
    createdAt: row.created_at, updatedAt: row.updated_at, isLocked: row.is_locked, isPinned: row.is_pinned,
    commentCount: row.comment_count, reactionCount: row.reaction_count, popularityScore: row.popularity_score, attachmentCount: row.attachment_count,
    viewerReacted: row.viewer_reacted,
    author: { id: row.author_id, login: row.author_login, displayName: row.author_display_name, avatarUrl: row.author_avatar_url },
    tags: tagsFrom(row.tags),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}
function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null
}
function isSafeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
const isoTimestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/
function isUuid(value: unknown): value is string {
  return isStrictUuid(value)
}
function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}
function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}
function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = isoTimestampPattern.exec(value)
  if (!match) return false
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = match.slice(1).map(Number)
  return year >= 1 && month >= 1 && month <= 12
    && day >= 1 && day <= daysInMonth(year, month)
    && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59
    && (Number.isNaN(offsetHour) || (offsetHour <= 23 && offsetMinute <= 59))
}
const detailKeys = [
  'id', 'title', 'body_markdown', 'created_at', 'updated_at', 'is_locked', 'is_pinned',
  'author_id', 'author_login', 'author_display_name', 'author_avatar_url', 'tags',
  'comment_count', 'reaction_count', 'popularity_score',
  'attachment_count', 'viewer_reacted',
] as const
function isTag(value: unknown): value is RawTag {
  return isRecord(value) && hasExactKeys(value, ['id', 'slug', 'label'])
    && typeof value.id === 'string' && typeof value.slug === 'string' && typeof value.label === 'string'
}
function isDetailTag(value: unknown): value is RawTag {
  return isTag(value) && isCanonicalUuid(value.id)
}
function isPublicPostDetail(value: unknown): value is PublicPostDetailRow {
  if (!isRecord(value) || !hasExactKeys(value, detailKeys)) return false
  return isUuid(value.id) && typeof value.title === 'string'
    && typeof value.body_markdown === 'string' && isIsoTimestamp(value.created_at)
    && isIsoTimestamp(value.updated_at) && typeof value.is_locked === 'boolean'
    && typeof value.is_pinned === 'boolean' && isUuid(value.author_id)
    && typeof value.author_login === 'string' && isNullableString(value.author_display_name)
    && isNullableString(value.author_avatar_url) && Array.isArray(value.tags)
    && value.tags.every(isDetailTag) && isSafeCount(value.comment_count)
    && isSafeCount(value.reaction_count) && isSafeCount(value.popularity_score)
    && isSafeCount(value.attachment_count) && value.attachment_count <= 5
    && typeof value.viewer_reacted === 'boolean'
}
function mapPublicPostRead(data: unknown, publicAttachmentUrl: (attachmentId: string) => string): PublicPostRead {
  if (!isRecord(data) || typeof data.kind !== 'string') throw new Error('invalid public post response')
  if (data.kind === 'not_found' || data.kind === 'hidden') {
    if (!hasExactKeys(data, ['kind'])) throw new Error('invalid public post response')
    return { kind: data.kind }
  }
  if (data.kind === 'deleted') {
    if (!hasExactKeys(data, ['kind', 'comment_count']) || !isSafeCount(data.comment_count)) throw new Error('invalid public post response')
    return { kind: 'deleted', commentCount: data.comment_count }
  }
  if (data.kind === 'published') {
    if (!hasExactKeys(data, ['kind', 'post']) || !isPublicPostDetail(data.post)) throw new Error('invalid public post response')
    return { kind: 'published', post: mapDetailPost(data.post, publicAttachmentUrl) }
  }
  throw new Error('invalid public post response')
}

const publishedCommentKeys = [
  'kind', 'id', 'parent_id', 'body_markdown', 'created_at', 'updated_at', 'author_id',
  'author_login', 'author_display_name', 'author_avatar_url', 'reaction_count', 'viewer_reacted',
] as const
const placeholderCommentKeys = ['kind', 'id', 'parent_id'] as const
const commentCursorKeys = ['root_created_at', 'root_id', 'is_reply', 'created_at', 'id'] as const
function isParentId(value: unknown): value is string | null { return value === null || isUuid(value) }
function mapComment(value: unknown): PublicComment {
  if (!isRecord(value) || (value.kind !== 'published' && value.kind !== 'hidden' && value.kind !== 'deleted')) throw new Error('invalid comment')
  if (value.kind === 'hidden' || value.kind === 'deleted') {
    if (!hasExactKeys(value, placeholderCommentKeys) || !isUuid(value.id) || !isParentId(value.parent_id)) throw new Error('invalid comment')
    return { kind: value.kind, id: value.id, parentId: value.parent_id }
  }
  if (!hasExactKeys(value, publishedCommentKeys) || !isUuid(value.id) || !isParentId(value.parent_id)
    || typeof value.body_markdown !== 'string' || !isIsoTimestamp(value.created_at) || !isIsoTimestamp(value.updated_at)
    || !isUuid(value.author_id) || typeof value.author_login !== 'string' || !isNullableString(value.author_display_name)
    || !isNullableString(value.author_avatar_url) || !isSafeCount(value.reaction_count) || typeof value.viewer_reacted !== 'boolean') throw new Error('invalid comment')
  return { kind:'published', id:value.id, parentId:value.parent_id, bodyMarkdown:value.body_markdown,
    createdAt:value.created_at, updatedAt:value.updated_at, reactionCount:value.reaction_count, viewerReacted:value.viewer_reacted,
    author:{ id:value.author_id, login:value.author_login, displayName:value.author_display_name, avatarUrl:value.author_avatar_url } }
}
function isCommentCursor(value: unknown): value is Record<(typeof commentCursorKeys)[number], unknown> {
  return isRecord(value) && hasExactKeys(value, commentCursorKeys)
    && isIsoTimestamp(value.root_created_at) && isUuid(value.root_id)
    && typeof value.is_reply === 'boolean' && isIsoTimestamp(value.created_at) && isUuid(value.id)
    && (value.is_reply || (value.root_created_at === value.created_at && value.root_id === value.id))
    && (!value.is_reply || value.root_id !== value.id)
}
function mapCommentPage(data: unknown): CommentPage {
  if (!isRecord(data) || !hasExactKeys(data, ['items', 'has_more', 'next_cursor']) || !Array.isArray(data.items)
    || typeof data.has_more !== 'boolean' || (data.next_cursor !== null && !isCommentCursor(data.next_cursor))
    || data.has_more !== (data.next_cursor !== null)) throw new Error('invalid comment response')
  const items = data.items.map(mapComment)
  return {
    items, hasMore:data.has_more,
    nextCursor:data.next_cursor === null ? null : { rootCreatedAt:data.next_cursor.root_created_at as string,
      rootId:data.next_cursor.root_id as string, isReply:data.next_cursor.is_reply as boolean,
      createdAt:data.next_cursor.created_at as string, id:data.next_cursor.id as string },
  }
}
function mapReactionState(data: unknown): ReactionState {
  if (!isRecord(data) || !hasExactKeys(data, ['reacted','reaction_count']) || typeof data.reacted !== 'boolean' || !isSafeCount(data.reaction_count)) throw new Error('invalid reaction response')
  return { reacted:data.reacted, reactionCount:data.reaction_count }
}

function mapMutationUuid(data: unknown): string {
  if (!isUuid(data)) throw new Error('invalid mutation response')
  return data.toLowerCase()
}

function isBoundedString(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= max && (allowEmpty || value.length > 0)
}
function isOneOf<const Values extends readonly string[]>(value: unknown, values: Values): value is Values[number] {
  return typeof value === 'string' && values.includes(value)
}
function mapModerationProfile(value: unknown) {
  if (!isRecord(value) || !hasExactKeys(value, ['id', 'login', 'display_name', 'avatar_url'])
    || !isUuid(value.id) || !isBoundedString(value.login, 100)
    || !(value.display_name === null || isBoundedString(value.display_name, 200, true))
    || !(value.avatar_url === null || isBoundedString(value.avatar_url, 2048, true))) throw new Error('invalid moderation profile')
  return { id: value.id, login: value.login, displayName: value.display_name, avatarUrl: value.avatar_url }
}
function isContentStatus(value: unknown): value is 'published' | 'hidden' | 'deleted' {
  return isOneOf(value, ['published', 'hidden', 'deleted'])
}
function mapModerationCursor(value: unknown): ModerationCursor {
  if (!isRecord(value) || !hasExactKeys(value, ['created_at', 'id']) || !isIsoTimestamp(value.created_at) || !isUuid(value.id)) {
    throw new Error('invalid moderation cursor')
  }
  return { createdAt: value.created_at, id: value.id }
}
function mapReportTarget(value: unknown) {
  if (!isRecord(value) || !isOneOf(value.type, ['post', 'comment']) || !isUuid(value.id) || typeof value.available !== 'boolean') {
    throw new Error('invalid report target')
  }
  if (!value.available) {
    if (!hasExactKeys(value, ['type', 'id', 'available'])) throw new Error('invalid unavailable report target')
    return { type: value.type, id: value.id, available: false as const }
  }
  if (!hasExactKeys(value, ['type', 'id', 'available', 'post_id', 'status', 'title', 'excerpt', 'is_locked', 'is_pinned'])
    || !isUuid(value.post_id)
    || !isContentStatus(value.status) || !isBoundedString(value.title, 300)
    || !isBoundedString(value.excerpt, 240, true) || typeof value.is_locked !== 'boolean' || typeof value.is_pinned !== 'boolean'
    || (value.type === 'post' && value.id !== value.post_id) || (value.type === 'comment' && value.id === value.post_id)) {
    throw new Error('invalid report target')
  }
  return {
    type: value.type, id: value.id, available: true as const, postId: value.post_id, status: value.status, title: value.title,
    excerpt: value.excerpt, isLocked: value.is_locked, isPinned: value.is_pinned,
  }
}
function mapAdminReportItem(value: unknown): AdminReportItem {
  if (!isRecord(value) || !hasExactKeys(value, [
    'id', 'status', 'reason_code', 'detail', 'created_at', 'resolved_at', 'resolved_by', 'reporter', 'target',
  ]) || !isUuid(value.id) || !isOneOf(value.status, ['open', 'reviewing', 'resolved', 'dismissed'])
    || !isOneOf(value.reason_code, ['spam', 'harassment', 'harmful', 'other'])
    || !(value.detail === null || isBoundedString(value.detail, 2000, true)) || !isIsoTimestamp(value.created_at)) {
    throw new Error('invalid report item')
  }
  const terminal = value.status === 'resolved' || value.status === 'dismissed'
  if (terminal !== (value.resolved_at !== null) || terminal !== (value.resolved_by !== null)
    || (value.resolved_at !== null && !isIsoTimestamp(value.resolved_at))
    || (value.resolved_by !== null && !isUuid(value.resolved_by))) throw new Error('invalid report resolution')
  return {
    id: value.id, status: value.status, reasonCode: value.reason_code, detail: value.detail,
    createdAt: value.created_at, resolvedAt: value.resolved_at, resolvedBy: value.resolved_by,
    reporter: mapModerationProfile(value.reporter), target: mapReportTarget(value.target),
  }
}
function mapAdminReportPage(data: unknown, limit: number): AdminReportPage {
  if (!isRecord(data) || !hasExactKeys(data, ['items', 'has_more', 'next_cursor']) || !Array.isArray(data.items)
    || data.items.length > limit || typeof data.has_more !== 'boolean'
    || data.has_more !== (data.next_cursor !== null)) throw new Error('invalid report page')
  const items = data.items.map(mapAdminReportItem)
  const nextCursor = data.next_cursor === null ? null : mapModerationCursor(data.next_cursor)
  const last = items.at(-1)
  if (nextCursor && (!last || nextCursor.id !== last.id || nextCursor.createdAt !== last.createdAt)) throw new Error('mismatched report cursor')
  return { items, hasMore: data.has_more, nextCursor }
}
function mapModeratedPostState(data: unknown): ModeratedPostState {
  if (!isRecord(data) || !hasExactKeys(data, ['id', 'status', 'is_locked', 'is_pinned', 'updated_at', 'deleted_at'])
    || !isUuid(data.id) || !isContentStatus(data.status) || typeof data.is_locked !== 'boolean'
    || typeof data.is_pinned !== 'boolean' || !isIsoTimestamp(data.updated_at)
    || (data.status === 'deleted' ? !isIsoTimestamp(data.deleted_at) : data.deleted_at !== null)) throw new Error('invalid post state')
  return { id: data.id, status: data.status, isLocked: data.is_locked, isPinned: data.is_pinned, updatedAt: data.updated_at, deletedAt: data.deleted_at as string | null }
}
function mapModeratedCommentState(data: unknown): ModeratedCommentState {
  if (!isRecord(data) || !hasExactKeys(data, ['id', 'post_id', 'status', 'updated_at', 'deleted_at'])
    || !isUuid(data.id) || !isUuid(data.post_id) || data.id === data.post_id || !isContentStatus(data.status)
    || !isIsoTimestamp(data.updated_at) || (data.status === 'deleted' ? !isIsoTimestamp(data.deleted_at) : data.deleted_at !== null)) {
    throw new Error('invalid comment state')
  }
  return { id: data.id, postId: data.post_id, status: data.status, updatedAt: data.updated_at, deletedAt: data.deleted_at as string | null }
}
function mapModeratedTagState(data: unknown): ModeratedTagState {
  if (!isRecord(data) || !hasExactKeys(data, ['id', 'slug', 'label', 'is_active', 'sort_order'])
    || !isCanonicalUuid(data.id) || !isBoundedString(data.slug, 100) || !isBoundedString(data.label, 200)
    || typeof data.is_active !== 'boolean' || !isSafeCount(data.sort_order)) throw new Error('invalid tag state')
  return { id: data.id, slug: data.slug, label: data.label, isActive: data.is_active, sortOrder: data.sort_order }
}
const sensitiveMetadataKey = /(?:password|passphrase|token|secret|credential|authorization|cookie|body|content|api[_-]?key|private[_-]?key|session|jwt)/i
function isAuditMetadataValue(value: unknown, depth = 0, budget = { remaining: 200 }): value is ModerationAuditMetadataValue {
  budget.remaining -= 1
  if (budget.remaining < 0) return false
  if (value === null || typeof value === 'boolean') return true
  if (typeof value === 'string') return value.length <= 2000
  if (typeof value === 'number') return Number.isSafeInteger(value)
  if (depth >= 4) return false
  if (Array.isArray(value)) return value.length <= 50 && value.every((item) => isAuditMetadataValue(item, depth + 1, budget))
  if (!isRecord(value)) return false
  const entries = Object.entries(value)
  return entries.length <= 50 && entries.every(([key, item]) => key.length > 0 && key.length <= 100
    && !sensitiveMetadataKey.test(key) && isAuditMetadataValue(item, depth + 1, budget))
}
function mapAuditMetadata(value: unknown): ModerationAuditMetadata {
  if (!isRecord(value) || !isAuditMetadataValue(value)) throw new Error('invalid audit metadata')
  return value
}
function mapModerationAuditItem(value: unknown): ModerationAuditItem {
  if (!isRecord(value) || !hasExactKeys(value, ['id', 'actor', 'action', 'target_type', 'target_id', 'reason', 'metadata', 'created_at'])
    || !isUuid(value.id) || !(value.actor === null || isRecord(value.actor)) || !isBoundedString(value.action, 200)
    || !isOneOf(value.target_type, ['report', 'post', 'comment', 'tag']) || !isUuid(value.target_id)
    || !(value.reason === null || isBoundedString(value.reason, 2000)) || !isIsoTimestamp(value.created_at)) throw new Error('invalid audit item')
  return {
    id: value.id, actor: value.actor === null ? null : mapModerationProfile(value.actor), action: value.action,
    targetType: value.target_type, targetId: value.target_id, reason: value.reason,
    metadata: mapAuditMetadata(value.metadata), createdAt: value.created_at,
  }
}
function mapModerationAuditPage(data: unknown, limit: number, targetType?: ModerationAuditTargetType, targetId?: string): ModerationAuditPage {
  if (!isRecord(data) || !hasExactKeys(data, ['items', 'has_more', 'next_cursor']) || !Array.isArray(data.items)
    || data.items.length > limit || typeof data.has_more !== 'boolean'
    || data.has_more !== (data.next_cursor !== null)) throw new Error('invalid audit page')
  const items = data.items.map(mapModerationAuditItem)
  if (targetType !== undefined && items.some(item => item.targetType !== targetType || item.targetId !== targetId)) {
    throw new Error('mismatched audit target')
  }
  const nextCursor = data.next_cursor === null ? null : mapModerationCursor(data.next_cursor)
  const last = items.at(-1)
  if (nextCursor && (!last || nextCursor.id !== last.id || nextCursor.createdAt !== last.createdAt)) throw new Error('mismatched audit cursor')
  return { items, hasMore: data.has_more, nextCursor }
}

export function createCommunityRepository(client: CommunityClient, recovery?: PublicReadRecovery) {
  const publicAttachmentOrigin = new URL(client.publicAttachmentUrl('00000000-0000-4000-8000-000000000000')).origin
  return {
    publicAttachmentOrigin,
    async listPosts(input: PostListInput): Promise<CommunityResult<PostPage>> {
      const sort = input.sort ?? 'newest'
      return executePublic(client, recovery, target => target.rpc('list_public_posts', {
        p_sort: sort, p_limit: input.limit, p_search: input.search?.trim() || undefined,
        p_tag_id: input.tagId, p_cursor_is_pinned: input.cursor?.isPinned,
        p_cursor_created_at: input.cursor?.createdAt, p_cursor_rank: input.cursor?.rank ?? undefined,
        p_cursor_id: input.cursor?.id, p_cursor_search_rank: input.cursor?.searchRank,
      }), data => {
        const rows = (data ?? []) as PublicPostRow[]
        const visible = rows.slice(0, input.limit)
        const last = visible.at(-1)
        return {
          items: visible.map(mapListPost),
          nextCursor: rows.length > input.limit && last ? {
            isPinned: last.is_pinned, createdAt: last.created_at, id: last.id,
            rank: sort === 'newest' ? null : last.rank_key, searchRank: last.search_rank,
          } : null,
        }
      })
    },
    async getPost(postId: string): Promise<CommunityResult<PublicPostRead>> {
      return executePublic(
        client,
        recovery,
        target => target.rpc('get_public_post_v3', { p_post_id: postId }),
        data => mapPublicPostRead(data, client.publicAttachmentUrl),
      )
    },
    async listComments(input: CommentListInput): Promise<CommunityResult<CommentPage>> {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
        return failure({ code: 'validation', sourceCode: 'INVALID_COMMENT_LIMIT', message: '입력 내용을 확인해 주세요.' })
      }
      return executePublic(client, recovery, target => target.rpc('list_public_post_comments_v2', {
        p_post_id: input.postId,
        p_limit: input.limit,
        p_cursor_root_created_at: input.cursor?.rootCreatedAt,
        p_cursor_root_id: input.cursor?.rootId,
        p_cursor_is_reply: input.cursor?.isReply,
        p_cursor_created_at: input.cursor?.createdAt,
        p_cursor_id: input.cursor?.id,
      }), mapCommentPage)
    },
    async listTags(): Promise<CommunityResult<CommunityTag[]>> {
      return executePublic(client, recovery, target => target.listTags(), data => {
        if (!Array.isArray(data) || !data.every(isDetailTag)) throw new Error('invalid tag response')
        return data.map(mapTag)
      })
    },
    async isAdmin(): Promise<CommunityResult<boolean>> {
      return execute(() => client.rpc('is_admin', {}), data => {
        if (typeof data !== 'boolean') throw new Error('invalid admin response')
        return data
      })
    },
    async createReport(input: CreateReportInput): Promise<CommunityResult<string>> {
      return execute(() => client.rpc('create_report_v2', {
        p_target_type: input.targetType, p_target_id: input.targetId, p_reason_code: input.reasonCode,
        p_detail: input.detail, p_idempotency_key: input.idempotencyKey,
      }), mapMutationUuid)
    },
    async listAdminReports(input: AdminReportListInput): Promise<CommunityResult<AdminReportPage>> {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
        return failure({ code: 'validation', sourceCode: 'INVALID_REPORT_LIMIT', message: '입력 내용을 확인해 주세요.' })
      }
      return execute(() => client.rpc('list_moderation_reports_v1', {
        p_status: input.status, p_limit: input.limit, p_cursor_created_at: input.cursor?.createdAt, p_cursor_id: input.cursor?.id,
      }), data => mapAdminReportPage(data, input.limit))
    },
    async setReportStatus(input: SetReportStatusInput): Promise<CommunityResult<AdminReportItem>> {
      return execute(() => client.rpc('set_report_status_v1', {
        p_report_id: input.reportId, p_expected_status: input.expectedStatus, p_desired_status: input.desiredStatus,
        p_reason: input.reason, p_idempotency_key: input.idempotencyKey,
      }), data => {
        const item = mapAdminReportItem(data)
        if (item.id !== input.reportId) throw new Error('mismatched report response')
        return item
      })
    },
    async moderatePost(input: ModeratePostInput): Promise<CommunityResult<ModeratedPostState>> {
      return execute(() => client.rpc('moderate_post_v1', {
        p_post_id: input.postId, p_expected_status: input.expectedStatus, p_expected_locked: input.expectedLocked,
        p_expected_pinned: input.expectedPinned, p_action: input.action, p_reason: input.reason, p_idempotency_key: input.idempotencyKey,
      }), data => {
        const state = mapModeratedPostState(data)
        if (state.id !== input.postId) throw new Error('mismatched post response')
        return state
      })
    },
    async moderateComment(input: ModerateCommentInput): Promise<CommunityResult<ModeratedCommentState>> {
      return execute(() => client.rpc('moderate_comment_v1', {
        p_comment_id: input.commentId, p_expected_status: input.expectedStatus, p_action: input.action,
        p_reason: input.reason, p_idempotency_key: input.idempotencyKey,
      }), data => {
        const state = mapModeratedCommentState(data)
        if (state.id !== input.commentId) throw new Error('mismatched comment response')
        return state
      })
    },
    async setTagActive(input: SetTagActiveInput): Promise<CommunityResult<ModeratedTagState>> {
      return execute(() => client.rpc('set_tag_active_v1', {
        p_tag_id: input.tagId, p_expected_active: input.expectedActive, p_desired_active: input.desiredActive,
        p_reason: input.reason, p_idempotency_key: input.idempotencyKey,
      }), data => {
        const state = mapModeratedTagState(data)
        if (state.id !== input.tagId) throw new Error('mismatched tag response')
        return state
      })
    },
    async listModerationAuditLogs(input: ModerationAuditListInput): Promise<CommunityResult<ModerationAuditPage>> {
      if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100 || ((input.targetType === undefined) !== (input.targetId === undefined))) {
        return failure({ code: 'validation', sourceCode: 'INVALID_AUDIT_FILTER', message: '입력 내용을 확인해 주세요.' })
      }
      return execute(() => client.rpc('list_moderation_audit_logs_v1', {
        p_limit: input.limit, p_cursor_created_at: input.cursor?.createdAt, p_cursor_id: input.cursor?.id,
        p_target_type: input.targetType, p_target_id: input.targetId,
      }), data => mapModerationAuditPage(data, input.limit, input.targetType, input.targetId))
    },
    async createComment(input: CreateCommentInput): Promise<CommunityResult<Extract<PublicComment, { kind:'published' }>>> {
      return execute(() => client.rpc('create_comment_v2', { p_post_id:input.postId, p_parent_id:input.parentId, p_body_markdown:input.bodyMarkdown, p_idempotency_key:input.idempotencyKey }), data => {
        const comment = mapComment(data)
        if (comment.kind !== 'published') throw new Error('invalid create response')
        return comment
      })
    },
    async setPostReaction(postId: string, reacted: boolean): Promise<CommunityResult<ReactionState>> {
      return execute(() => client.rpc('set_post_reaction', { p_post_id:postId, p_reacted:reacted }), mapReactionState)
    },
    async setCommentReaction(commentId: string, reacted: boolean): Promise<CommunityResult<ReactionState>> {
      return execute(() => client.rpc('set_comment_reaction', { p_comment_id:commentId, p_reacted:reacted }), mapReactionState)
    },
    async createPost(input: CreatePostInput): Promise<CommunityResult<string>> {
      return execute(() => client.rpc('create_post', { p_title: input.title, p_body_markdown: input.bodyMarkdown, p_tag_ids: input.tagIds, p_idempotency_key: input.idempotencyKey }), mapMutationUuid)
    },
    async updatePost(input: UpdatePostInput): Promise<CommunityResult<string>> {
      return execute(() => client.rpc('update_post', { p_post_id: input.postId, p_title: input.title, p_body_markdown: input.bodyMarkdown, p_tag_ids: input.tagIds }), mapMutationUuid)
    },
    async deletePost(postId: string): Promise<CommunityResult<string>> {
      return execute(() => client.rpc('soft_delete_post', { p_post_id: postId }), mapMutationUuid)
    },
  }
}
export type CommunityRepository = ReturnType<typeof createCommunityRepository>

function createBrowserCommunityClient(client = getSupabaseClient()): CommunityClient {
  const { supabaseUrl } = parseEnv(import.meta.env)
  return {
    publicAttachmentUrl: attachmentId => new URL(`/functions/v1/public-attachment/${attachmentId}`, supabaseUrl).toString(),
    listTags: () => client.from('tags').select('id,slug,label').eq('is_active', true).order('sort_order', { ascending: true }).order('label', { ascending: true }),
    rpc: (name, args) => client.rpc(name as never, args as never),
  }
}
let browserRepository: CommunityRepository | undefined
export function getCommunityRepository(): CommunityRepository {
  if (!browserRepository) {
    const client = getSupabaseClient()
    browserRepository = createCommunityRepository(createBrowserCommunityClient(client), {
      anonymousClient: createBrowserCommunityClient(getAnonymousSupabaseClient()),
    })
  }
  return browserRepository
}
