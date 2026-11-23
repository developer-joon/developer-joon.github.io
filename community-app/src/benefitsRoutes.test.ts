import { describe, expect, it } from 'vitest'
import { benefitClaimHref, benefitCompanyRequestHref, benefitSubmissionHref, benefitsRoute, legacyBenefitsRedirect } from './benefitsRoutes'

describe('Task 10 company and claim route contract',()=>{
  it('builds canonical slash URLs and bounds the optional public company name',()=>{expect(benefitCompanyRequestHref(' 테스트 기업 ')).toBe('/community/benefits/company-request/?name=%ED%85%8C%EC%8A%A4%ED%8A%B8+%EA%B8%B0%EC%97%85');expect(benefitCompanyRequestHref('x'.repeat(101))).toBe('/community/benefits/company-request/');expect(benefitClaimHref('KR-BIZ-1234567890')).toBe('/community/benefits/claim/?company=KR-BIZ-1234567890')})
  it('rejects a noncanonical claim company hint',()=>expect(()=>benefitClaimHref('KR-BIZ-123')).toThrow('Invalid canonical company ID'))
})

describe('Task 7 benefit submission route contract', () => {
  it('builds the canonical company-prefilled submission URL', () => {
    expect(benefitSubmissionHref('KR-BIZ-1234567890')).toBe('/community/benefits/submit/?companyId=KR-BIZ-1234567890')
    expect(benefitSubmissionHref(`KR-CAN-${'d'.repeat(32)}`)).toBe(`/community/benefits/submit/?companyId=KR-CAN-${'d'.repeat(32)}`)
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
    '/community/benefits/company-request/',
    '/community/benefits/claim/',
  ])('keeps authenticated route %s outside the public bundle', (path) => {
    expect(benefitsRoute(path)).toBe(null)
  })
})
