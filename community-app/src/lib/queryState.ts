import type { PostCursor, PostSort } from '../types/community'

export interface CommunityQueryState {
  search: string
  tagId: string | null
  sort: PostSort
  cursor: PostCursor | null
}

const sorts = new Set<PostSort>(['newest', 'popular', 'comments'])
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const timestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
export const maxCommunitySearchLength = 200

export function normalizeCommunitySearch(value: string) {
  return value.trim().slice(0, maxCommunitySearchLength)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = timestampPattern.exec(value)
  if (!match || !Number.isFinite(Date.parse(value))) return false

  const [, yearValue, monthValue, dayValue, hourValue, minuteValue, secondValue] = match
  const [year, month, day, hour, minute, second] = [
    yearValue,
    monthValue,
    dayValue,
    hourValue,
    minuteValue,
    secondValue,
  ].map(Number)
  const roundTrip = new Date(0)
  roundTrip.setUTCFullYear(year, month - 1, day)
  roundTrip.setUTCHours(hour, minute, second, 0)

  return roundTrip.getUTCFullYear() === year
    && roundTrip.getUTCMonth() === month - 1
    && roundTrip.getUTCDate() === day
    && roundTrip.getUTCHours() === hour
    && roundTrip.getUTCMinutes() === minute
    && roundTrip.getUTCSeconds() === second
}

export function isValidPostCursor(value: unknown, sort: PostSort): value is PostCursor {
  if (typeof value !== 'object' || value === null) return false
  const cursor = value as Record<string, unknown>
  return typeof cursor.isPinned === 'boolean'
    && isFiniteNumber(cursor.searchRank)
    && cursor.searchRank >= 0
    && cursor.searchRank < 1
    && isCanonicalTimestamp(cursor.createdAt)
    && typeof cursor.id === 'string'
    && uuidPattern.test(cursor.id)
    && (sort === 'newest'
      ? cursor.rank === null
      : isNonnegativeSafeInteger(cursor.rank))
}

function parseCursor(value: string | null, sort: PostSort): PostCursor | null {
  if (!value) return null
  try {
    const candidate: unknown = JSON.parse(value)
    return isValidPostCursor(candidate, sort) ? candidate : null
  } catch {
    return null
  }
}

export function parseCommunityQuery(search: string): CommunityQueryState {
  const params = new URLSearchParams(search)
  const candidate = params.get('sort') as PostSort | null
  const sort = candidate && sorts.has(candidate) ? candidate : 'newest'
  const tag = params.get('tag')?.trim() ?? ''
  return {
    search: normalizeCommunitySearch(params.get('q') ?? ''),
    tagId: uuidPattern.test(tag) ? tag : null,
    sort,
    cursor: parseCursor(params.get('cursor'), sort),
  }
}

export function serializeCommunityQuery(state: CommunityQueryState): string {
  const params = new URLSearchParams()
  const search = normalizeCommunitySearch(state.search)
  if (search) params.set('q', search)
  if (state.tagId) params.set('tag', state.tagId)
  if (state.sort !== 'newest') params.set('sort', state.sort)
  if (state.cursor) params.set('cursor', JSON.stringify(state.cursor))
  const value = params.toString()
  return value ? `?${value}` : ''
}
