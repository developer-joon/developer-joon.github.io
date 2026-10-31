import { describe, expect, it } from 'vitest'
import { benefitsRoute } from './benefitsRoutes'

describe('non-ranking benefits routes', () => {
  it.each([
    ['', 'heatmap'],
    ['fit', 'fit'],
    ['company', 'company'],
    ['methodology', 'methodology'],
  ])('resolves %s with optional trailing slash', (part, route) => {
    expect(benefitsRoute(`/community/benefits/${part}/`)).toBe(route)
    expect(benefitsRoute(`/community/benefits/${part}`)).toBe(route)
  })

  it('does not expose a rankings route', () => {
    expect(benefitsRoute('/community/benefits/rankings')).toBe(null)
  })
})
