import { describe, expect, it } from 'vitest'
import { benefitSubmissionHref, benefitsRoute } from './benefitsRoutes'

describe('Task 7 benefit submission route contract', () => {
  it('builds the canonical company-prefilled submission URL', () => {
    expect(benefitSubmissionHref('KR-BIZ-1234567890')).toBe('/community/benefits/submit/?companyId=KR-BIZ-1234567890')
  })

  it.each(['', 'KR-BIZ-123', 'kr-biz-1234567890', 'KR-BIZ-1234567890&admin=true'])(
    'rejects non-canonical company ID %s',
    companyId => expect(() => benefitSubmissionHref(companyId)).toThrow('Invalid canonical company ID'),
  )
})

describe('non-ranking benefits routes', () => {
  it.each([
    ['', 'heatmap'],
    ['directory', 'directory'],
    ['fit', 'fit'],
    ['company', 'company'],
    ['methodology', 'methodology'],
  ])('resolves %s with optional trailing slash', (part, route) => {
    expect(benefitsRoute(`/community/benefits/${part}/`)).toBe(route)
    expect(benefitsRoute(`/community/benefits/${part}`)).toBe(route)
  })

  it('maps the canonical company shell to the dynamic company route without enabling the Task 9 root shell', () => {
    expect(benefitsRoute('/benefits/company/')).toBe('company')
    expect(benefitsRoute('/benefits')).toBe(null)
  })

  it('does not expose a rankings route', () => {
    expect(benefitsRoute('/community/benefits/rankings')).toBe(null)
  })

  it.each([
    '/community/benefits/correction',
    '/community/benefits/my-corrections/',
  ])('keeps authenticated route %s outside the public bundle', (path) => {
    expect(benefitsRoute(path)).toBe(null)
  })
})
