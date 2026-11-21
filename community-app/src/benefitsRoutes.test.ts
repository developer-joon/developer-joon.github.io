import { describe, expect, it } from 'vitest'
import { benefitSubmissionHref, benefitsRoute, legacyBenefitsRedirect } from './benefitsRoutes'

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

  it('maps both canonical shells to the dynamic public routes', () => {
    expect(benefitsRoute('/benefits/')).toBe('directory')
    expect(benefitsRoute('/benefits')).toBe('directory')
    expect(benefitsRoute('/benefits/company/')).toBe('company')
    expect(benefitsRoute('/benefits/company')).toBe('company')
  })

  it.each([
    ['/community/benefits/directory/', '/benefits/'],
    ['/community/benefits/directory', '/benefits/'],
    ['/community/benefits/company/', '/benefits/company/'],
    ['/community/benefits/company', '/benefits/company/'],
  ])('redirects legacy %s with raw query and hash preserved', (pathname, destination) => {
    expect(legacyBenefitsRedirect(pathname, '?b=2&a=1&a=%2F&bad=%E0%A4%A', '#raw%2Fhash')).toBe(
      `${destination}?b=2&a=1&a=%2F&bad=%E0%A4%A#raw%2Fhash`,
    )
  })

  it.each([
    '/benefits/',
    '/benefits/company/',
    '/community/benefits/',
    '/community/benefits/directory-extra/',
    '/community/benefits/company/extra/',
  ])('does not redirect canonical, deeper, or lookalike route %s', pathname => {
    expect(legacyBenefitsRedirect(pathname, '?id=raw', '#hash')).toBe(null)
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
