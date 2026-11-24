import { isBenefitCompanyId } from './lib/benefitCompanyId'
export const BENEFIT_SUBMISSION_PATH = '/community/benefits/submit/'
export const MY_BENEFIT_SUBMISSIONS_PATH = '/community/benefits/my-submissions/'
export const BENEFIT_COMPANY_REQUEST_PATH = '/community/benefits/company-request/'
export const BENEFIT_CLAIM_PATH = '/community/benefits/claim/'
export const BENEFIT_CLAIM_REACTION_PATH = '/community/benefits/claim-reaction/'
export function benefitCompanyRequestHref(name?:string):string{const value=name?.trim()??'';if(!value)return BENEFIT_COMPANY_REQUEST_PATH;if(Array.from(value).length>100||[...value].some(character=>{const code=character.charCodeAt(0);return code<=31||code===127}))return BENEFIT_COMPANY_REQUEST_PATH;return `${BENEFIT_COMPANY_REQUEST_PATH}?${new URLSearchParams({name:value})}`}
export function benefitClaimHref(companyId:string):string{if(!isBenefitCompanyId(companyId))throw new Error('Invalid canonical company ID');return `${BENEFIT_CLAIM_PATH}?${new URLSearchParams({company:companyId})}`}
export function benefitClaimReactionHref(companyId:string,claimId:string):string{if(!isBenefitCompanyId(companyId)||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(claimId))throw new Error('Invalid public claim target');return `${BENEFIT_CLAIM_REACTION_PATH}?${new URLSearchParams({company:companyId,claim:claimId})}`}

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
