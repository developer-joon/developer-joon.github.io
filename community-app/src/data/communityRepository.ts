import type {
  CommunityError,
  CommunityResult,
  CommunityTag,
  CreatePostInput,
  PostDetail,
  PostListInput,
  PostListItem,
  PostPage,
  PublicPostRead,
  UpdatePostInput,
} from '../types/community'
import type { Database } from '../types/database'
import { getSupabaseClient } from '../lib/supabase'
import { parseEnv } from '../config/env'

export interface QueryResponse { data: unknown; error: unknown }
type Functions = Database['public']['Functions']
type MutationName = 'create_post' | 'update_post' | 'soft_delete_post'
type ReadName = 'list_public_posts' | 'get_public_post_v2'
type RpcName = ReadName | MutationName

export interface CommunityClient {
  publicAttachmentUrl(attachmentId: string): string
  listTags(): PromiseLike<QueryResponse>
  rpc<Name extends RpcName>(name: Name, args: Functions[Name]['Args']): PromiseLike<QueryResponse>
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
    case 'PGRST301': return { code: 'auth_required', sourceCode, message: '로그인이 필요합니다.' }
    case '42501': return { code: 'forbidden', sourceCode, message: '요청할 권한이 없습니다.' }
    case '22023': case '23514': return { code: 'validation', sourceCode, message: '입력 내용을 확인해 주세요.' }
    case '23505': return { code: 'conflict', sourceCode, message: '이미 처리된 요청입니다.' }
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
    commentCount: row.comment_count, reactionCount: row.reaction_count, popularityScore: row.popularity_score,
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
const detailKeys = [
  'id', 'title', 'body_markdown', 'created_at', 'updated_at', 'is_locked', 'is_pinned',
  'author_id', 'author_login', 'author_display_name', 'author_avatar_url', 'tags',
  'comment_count', 'reaction_count', 'popularity_score',
] as const
function isTag(value: unknown): value is RawTag {
  return isRecord(value) && hasExactKeys(value, ['id', 'slug', 'label'])
    && typeof value.id === 'string' && typeof value.slug === 'string' && typeof value.label === 'string'
}
function isPublicPostDetail(value: unknown): value is PublicPostDetailRow {
  if (!isRecord(value) || !hasExactKeys(value, detailKeys)) return false
  return typeof value.id === 'string' && typeof value.title === 'string'
    && typeof value.body_markdown === 'string' && typeof value.created_at === 'string'
    && typeof value.updated_at === 'string' && typeof value.is_locked === 'boolean'
    && typeof value.is_pinned === 'boolean' && typeof value.author_id === 'string'
    && typeof value.author_login === 'string' && isNullableString(value.author_display_name)
    && isNullableString(value.author_avatar_url) && Array.isArray(value.tags)
    && value.tags.every(isTag) && isSafeCount(value.comment_count)
    && isSafeCount(value.reaction_count) && isSafeCount(value.popularity_score)
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

export function createCommunityRepository(client: CommunityClient) {
  return {
    async listPosts(input: PostListInput): Promise<CommunityResult<PostPage>> {
      const sort = input.sort ?? 'newest'
      return execute(() => client.rpc('list_public_posts', {
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
      return execute(
        () => client.rpc('get_public_post_v2', { p_post_id: postId }),
        data => mapPublicPostRead(data, client.publicAttachmentUrl),
      )
    },
    async listTags(): Promise<CommunityResult<CommunityTag[]>> {
      return execute(() => client.listTags(), data => ((data ?? []) as RawTag[]).map(mapTag))
    },
    async createPost(input: CreatePostInput): Promise<CommunityResult<string>> {
      return execute(() => client.rpc('create_post', { p_title: input.title, p_body_markdown: input.bodyMarkdown, p_tag_ids: input.tagIds, p_idempotency_key: input.idempotencyKey }), data => data as string)
    },
    async updatePost(input: UpdatePostInput): Promise<CommunityResult<string>> {
      return execute(() => client.rpc('update_post', { p_post_id: input.postId, p_title: input.title, p_body_markdown: input.bodyMarkdown, p_tag_ids: input.tagIds }), data => data as string)
    },
    async deletePost(postId: string): Promise<CommunityResult<string>> {
      return execute(() => client.rpc('soft_delete_post', { p_post_id: postId }), data => data as string)
    },
  }
}
export type CommunityRepository = ReturnType<typeof createCommunityRepository>

function createBrowserCommunityClient(): CommunityClient {
  const client = getSupabaseClient()
  const { supabaseUrl } = parseEnv(import.meta.env)
  return {
    publicAttachmentUrl: attachmentId => new URL(`/functions/v1/public-attachment/${attachmentId}`, supabaseUrl).toString(),
    listTags: () => client.from('tags').select('id,slug,label').eq('is_active', true).order('sort_order', { ascending: true }).order('label', { ascending: true }),
    rpc: (name, args) => client.rpc(name, args),
  }
}
let browserRepository: CommunityRepository | undefined
export function getCommunityRepository(): CommunityRepository {
  browserRepository ??= createCommunityRepository(createBrowserCommunityClient())
  return browserRepository
}
