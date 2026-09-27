import { describe, expect, it } from 'vitest'
import { parseCommunityQuery, serializeCommunityQuery } from './queryState'

const cursor = {
  isPinned: true,
  searchRank: 0.75,
  createdAt: '2026-09-27T00:00:00Z',
  id: 'post-1',
  rank: 12,
}

describe('community query state', () => {
  it('parses supported search, tag, and sort values', () => {
    expect(parseCommunityQuery('?q=react&tag=tag-1&sort=popular')).toEqual({
      search: 'react',
      tagId: 'tag-1',
      sort: 'popular',
      cursor: null,
    })
  })

  it('normalizes unsupported and blank values', () => {
    expect(parseCommunityQuery('?q=%20%20&tag=&sort=unknown')).toEqual({
      search: '',
      tagId: null,
      sort: 'newest',
      cursor: null,
    })
  })

  it('serializes only non-default state', () => {
    expect(serializeCommunityQuery({ search: 'RLS', tagId: null, sort: 'newest', cursor: null })).toBe('?q=RLS')
    expect(serializeCommunityQuery({ search: '', tagId: 'tag-2', sort: 'comments', cursor: null })).toBe('?tag=tag-2&sort=comments')
  })

  it('round-trips a complete cursor', () => {
    const state = { search: 'RLS', tagId: 'tag-1', sort: 'popular' as const, cursor }
    expect(parseCommunityQuery(serializeCommunityQuery(state))).toEqual(state)
  })

  it.each([
    '?cursor=not-json',
    `?cursor=${encodeURIComponent(JSON.stringify({ ...cursor, id: '' }))}`,
    `?cursor=${encodeURIComponent(JSON.stringify({ ...cursor, searchRank: '0.75' }))}`,
  ])('ignores an unsafe cursor value: %s', (search) => {
    expect(parseCommunityQuery(search).cursor).toBeNull()
  })
})
