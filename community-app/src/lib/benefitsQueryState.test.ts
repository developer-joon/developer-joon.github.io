import { expect, it } from 'vitest'
import { parseQuery, serializeQuery } from './benefitsQueryState'
const ids = [
  'example-001',
  'example-002',
  'example-003',
  'example-004',
  'example-005',
]
it('normalizes bounded allowed URL state and preserves round trips', () => {
  const state = parseQuery(
    '?scope=domestic&q=' +
      'x'.repeat(101) +
      '&categories=family,bad&statuses=확인됨,bad&compare=' +
      ids.join(',') +
      '&page=-2&preset=custom&weights=family:9,health:3&evil=1',
    ids,
  )
  expect(state.q).toHaveLength(100)
  expect(state.categories).toEqual(['family'])
  expect(state.statuses).toEqual(['확인됨'])
  expect(state.compare).toEqual(ids.slice(0, 4))
  expect(state.page).toBe(1)
  expect(state.weights).toEqual({ health: 3 })
  expect(state.notice).toBeTruthy()
  const encoded = serializeQuery(state)
  expect(encoded).not.toContain('evil')
  expect(parseQuery(encoded, ids).compare).toEqual(state.compare)
})
it('normalizes methodology queries without an index while preserving only canonical compare IDs', () => {
  const state = parseQuery(
    '?compare=example-001,example-000,example-2000,unknown',
  )

  expect(state.compare).toEqual(['example-001', 'example-2000'])
  expect(state.notice).toBeTruthy()
})

it('recovers oversized and malformed query safely', () => {
  expect(parseQuery('?' + 'x'.repeat(9000), ids).notice).toBeTruthy()
  expect(parseQuery('?scope=no&page=Infinity&compare=unknown', ids).scope).toBe(
    'all',
  )
})
