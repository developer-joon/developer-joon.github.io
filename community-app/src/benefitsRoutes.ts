import { isBenefitCompanyId } from './lib/benefitCompanyId'
export const BENEFIT_SUBMISSION_PATH = '/community/benefits/submit/'
export const MY_BENEFIT_SUBMISSIONS_PATH = '/community/benefits/my-submissions/'

export function benefitSubmissionHref(companyId: string): string {
  if (!isBenefitCompanyId(companyId)) throw new Error('Invalid canonical company ID')
  const query = new URLSearchParams({ companyId })
  return `${BENEFIT_SUBMISSION_PATH}?${query.toString()}`
}

export function benefitsRoute(path: string): string | null {
  const normalized = path.replace(/\/+$/, '')
  const routes: Record<string, string> = {
    '/community/benefits': 'heatmap',
    '/community/benefits/directory': 'directory',
    '/community/benefits/fit': 'fit',
    '/community/benefits/company': 'company',
    '/benefits': 'directory',
    '/benefits/company': 'company',
    '/community/benefits/methodology': 'methodology',
  }
  return routes[normalized] ?? null
}

export function legacyBenefitsRedirect(pathname: string, search: string, hash: string): string | null {
  const destinations: Record<string, string> = {
    '/community/benefits/directory': '/benefits/',
    '/community/benefits/directory/': '/benefits/',
    '/community/benefits/company': '/benefits/company/',
    '/community/benefits/company/': '/benefits/company/',
  }
  const destination = destinations[pathname]
  return destination ? `${destination}${search}${hash}` : null
}
