import { describe, expect, it } from 'vitest'
import { parseCommunityQuery, serializeCommunityQuery } from './queryState'

describe('community query state', () => {
  it('parses supported search, tag, and sort values', () => {
    expect(parseCommunityQuery('?q=react&tag=tag-1&sort=popular')).toEqual({
      search: 'react',
      tagId: 'tag-1',
      sort: 'popular',
    })
  })

  it('normalizes unsupported and blank values', () => {
    expect(parseCommunityQuery('?q=%20%20&tag=&sort=unknown')).toEqual({
      search: '',
      tagId: null,
      sort: 'newest',
    })
  })

  it('serializes only non-default state', () => {
    expect(serializeCommunityQuery({ search: 'RLS', tagId: null, sort: 'newest' })).toBe('?q=RLS')
    expect(serializeCommunityQuery({ search: '', tagId: 'tag-2', sort: 'comments' })).toBe('?tag=tag-2&sort=comments')
  })
})
