import { expect, it } from 'vitest'
import { parseQuery, serializeQuery } from './benefitsQueryState'

const ids = [
  'KR-CRN-1101112948086',
  'US-CIK0001411342',
  'KR-CRN-1234567890123',
  'US-CIK0000000004',
  'US-CIK0000000005',
]

it('normalizes URL-only condition state and caps compare at four unique real IDs', () => {
  const state = parseQuery(
    `?country=KR&employment_type=full-time&role=engineer&preferred_categories=family,bad,health&preset=custom&compare=${ids[0]},${ids[0]},${ids.slice(1).join(',')}&page=-2&weights=family:5`,
    ids,
  )
  expect(state.country).toBe('KR')
  expect(state.employment_type).toBe('full-time')
  expect(state.role).toBe('engineer')
  expect(state.preferred_categories).toEqual(['family', 'health'])
  expect(state.compare).toEqual(ids.slice(0, 4))
  expect(state.page).toBe(1)
  expect(state.notice).toBe(true)
  const encoded = serializeQuery(state)
  expect(encoded).not.toContain('weights')
  expect(parseQuery(encoded, ids).compare).toEqual(ids.slice(0, 4))
})

it('rejects fixture, malformed and cross-version company IDs', () => {
  const state = parseQuery(`?compare=example-001,${ids[0]},KR-CRN-123`, ids)
  expect(state.compare).toEqual([ids[0]])
  expect(state.notice).toBe(true)
})
