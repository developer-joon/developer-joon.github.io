import type { PostCursor, PostSort } from '../types/community'

export interface CommunityQueryState {
  search: string
  tagId: string | null
  sort: PostSort
  cursor: PostCursor | null
}

const sorts = new Set<PostSort>(['newest', 'popular', 'comments'])

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseCursor(value: string | null): PostCursor | null {
  if (!value) return null
  try {
    const candidate: unknown = JSON.parse(value)
    if (typeof candidate !== 'object' || candidate === null) return null
    const cursor = candidate as Record<string, unknown>
    if (
      typeof cursor.isPinned !== 'boolean'
      || !isFiniteNumber(cursor.searchRank)
      || typeof cursor.createdAt !== 'string'
      || cursor.createdAt.trim() === ''
      || typeof cursor.id !== 'string'
      || cursor.id.trim() === ''
      || (cursor.rank !== null && !isFiniteNumber(cursor.rank))
    ) return null
    return {
      isPinned: cursor.isPinned,
      searchRank: cursor.searchRank,
      createdAt: cursor.createdAt,
      id: cursor.id,
      rank: cursor.rank,
    }
  } catch {
    return null
  }
}

export function parseCommunityQuery(search: string): CommunityQueryState {
  const params = new URLSearchParams(search)
  const candidate = params.get('sort') as PostSort | null
  return {
    search: params.get('q')?.trim() ?? '',
    tagId: params.get('tag')?.trim() || null,
    sort: candidate && sorts.has(candidate) ? candidate : 'newest',
    cursor: parseCursor(params.get('cursor')),
  }
}

export function serializeCommunityQuery(state: CommunityQueryState): string {
  const params = new URLSearchParams()
  if (state.search.trim()) params.set('q', state.search.trim())
  if (state.tagId) params.set('tag', state.tagId)
  if (state.sort !== 'newest') params.set('sort', state.sort)
  if (state.cursor) params.set('cursor', JSON.stringify(state.cursor))
  const value = params.toString()
  return value ? `?${value}` : ''
}
