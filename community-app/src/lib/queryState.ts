import type { PostSort } from '../types/community'

export interface CommunityQueryState {
  search: string
  tagId: string | null
  sort: PostSort
}

const sorts = new Set<PostSort>(['newest', 'popular', 'comments'])

export function parseCommunityQuery(search: string): CommunityQueryState {
  const params = new URLSearchParams(search)
  const candidate = params.get('sort') as PostSort | null
  return {
    search: params.get('q')?.trim() ?? '',
    tagId: params.get('tag')?.trim() || null,
    sort: candidate && sorts.has(candidate) ? candidate : 'newest',
  }
}

export function serializeCommunityQuery(state: CommunityQueryState): string {
  const params = new URLSearchParams()
  if (state.search.trim()) params.set('q', state.search.trim())
  if (state.tagId) params.set('tag', state.tagId)
  if (state.sort !== 'newest') params.set('sort', state.sort)
  const value = params.toString()
  return value ? `?${value}` : ''
}
