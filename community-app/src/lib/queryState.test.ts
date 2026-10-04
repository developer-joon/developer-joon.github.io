import { describe, expect, it } from 'vitest'
import { parseCommunityQuery, serializeCommunityQuery } from './queryState'

const tagId = 'a1000000-0000-0000-0000-000000000001'
const postId = '22222222-2222-4222-8222-222222222222'

const cursor = {
  isPinned: true,
  searchRank: 0.75,
  createdAt: '2026-09-27T00:00:00Z',
  id: postId,
  rank: 12,
}

describe('community query state', () => {
  it('round-trips a seeded tag id from the initial URL', () => {
    const initialSearch = `?tag=${tagId}&sort=popular`
    const state = parseCommunityQuery(initialSearch)

    expect(state.tagId).toBe(tagId)
    expect(serializeCommunityQuery(state)).toBe(initialSearch)
  })

  it('parses supported search, tag, and sort values', () => {
    expect(parseCommunityQuery(`?q=react&tag=${tagId}&sort=popular`)).toEqual({
      search: 'react',
      tagId,
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
    expect(serializeCommunityQuery({ search: '', tagId, sort: 'comments', cursor: null })).toBe(`?tag=${tagId}&sort=comments`)
  })

  it('bounds serialized search values to the database limit', () => {
    expect(serializeCommunityQuery({
      search: `  ${'a'.repeat(201)}  `,
      tagId: null,
      sort: 'newest',
      cursor: null,
    })).toBe(`?q=${'a'.repeat(200)}`)
  })

  it('round-trips a complete cursor', () => {
    const state = { search: 'RLS', tagId, sort: 'popular' as const, cursor }
    expect(parseCommunityQuery(serializeCommunityQuery(state))).toEqual(state)
  })

  it.each([
    '?cursor=not-json',
    `?cursor=${encodeURIComponent(JSON.stringify({ ...cursor, id: '' }))}`,
    `?cursor=${encodeURIComponent(JSON.stringify({ ...cursor, searchRank: '0.75' }))}`,
  ])('ignores an unsafe cursor value: %s', (search) => {
    expect(parseCommunityQuery(search).cursor).toBeNull()
  })

  it('normalizes non-UUID tag ids and searches longer than 200 characters', () => {
    const state = parseCommunityQuery(`?tag=not-a-uuid&q=${'a'.repeat(201)}`)

    expect(state.tagId).toBeNull()
    expect(state.search).toHaveLength(200)
    expect(serializeCommunityQuery(state)).toBe(`?q=${'a'.repeat(200)}`)
  })

  it.each([
    ['non-UUID post id', 'popular', { ...cursor, id: 'post-1' }],
    ['invalid timestamp', 'popular', { ...cursor, createdAt: 'not-a-date' }],
    ['search rank below zero', 'popular', { ...cursor, searchRank: -0.01 }],
    ['search rank equal to one', 'popular', { ...cursor, searchRank: 1 }],
    ['null ranked cursor for ranked sort', 'comments', { ...cursor, rank: null }],
    ['negative rank for ranked sort', 'popular', { ...cursor, rank: -1 }],
    ['fractional rank for ranked sort', 'comments', { ...cursor, rank: 1.5 }],
    ['unsafe integer rank for ranked sort', 'popular', { ...cursor, rank: Number.MAX_SAFE_INTEGER + 1 }],
    ['ranked cursor for newest sort', 'newest', { ...cursor, rank: 3 }],
  ])('rejects a semantically invalid %s', (_label, sort, value) => {
    const search = `?sort=${sort}&cursor=${encodeURIComponent(JSON.stringify(value))}`
    expect(parseCommunityQuery(search).cursor).toBeNull()
  })

  it.each([
    ['overflow date', '2026-02-30T00:00:00Z'],
    ['shorthand date', '0'],
    ['timezone-less timestamp', '2026-09-27T00:00:00'],
    ['invalid leap day', '2025-02-29T00:00:00Z'],
  ])('rejects a cursor with an %s', (_label, createdAt) => {
    const value = { ...cursor, createdAt }
    const search = `?sort=popular&cursor=${encodeURIComponent(JSON.stringify(value))}`
    expect(parseCommunityQuery(search).cursor).toBeNull()
  })

  it.each([
    '2026-09-27T00:00:00.123456Z',
    '2026-09-27T09:30:00.123456+09:30',
    '2026-09-26T16:30:00-07:30',
  ])('accepts a canonical timestamptz cursor: %s', (createdAt) => {
    const value = { ...cursor, createdAt }
    const search = `?sort=popular&cursor=${encodeURIComponent(JSON.stringify(value))}`
    expect(parseCommunityQuery(search).cursor).toEqual(value)
  })

  it('accepts a null rank only for newest sorting', () => {
    const newestCursor = { ...cursor, rank: null }
    const search = `?cursor=${encodeURIComponent(JSON.stringify(newestCursor))}`
    expect(parseCommunityQuery(search).cursor).toEqual(newestCursor)
  })
})
