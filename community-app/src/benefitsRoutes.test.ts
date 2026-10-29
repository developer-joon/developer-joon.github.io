import { describe, it, expect } from 'vitest'
import { benefitsRoute } from './benefitsRoutes'
describe('static benefits routes', () => {
  it.each(['', 'rankings', 'fit', 'company'])('resolves %s with optional trailing slash', part => {
    expect(benefitsRoute(`/community/benefits/${part}/`)).toBe(part || 'heatmap')
    expect(benefitsRoute(`/community/benefits/${part}`)).toBe(part || 'heatmap')
  })
  it('rejects unknown paths', () => expect(benefitsRoute('/community/benefits/other')).toBe(null))
})
