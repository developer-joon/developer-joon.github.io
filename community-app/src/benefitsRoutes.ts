const CANONICAL_COMPANY_ID = /^(?:KR-CRN-[0-9]{13}|KR-BIZ-[0-9]{10})$/
const BENEFIT_SUBMISSION_PATH = '/community/benefits/submit/'

export function benefitSubmissionHref(companyId: string): string {
  if (!CANONICAL_COMPANY_ID.test(companyId)) throw new Error('Invalid canonical company ID')
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
    '/benefits/company': 'company',
    '/community/benefits/methodology': 'methodology',
  }
  return routes[normalized] ?? null
}
