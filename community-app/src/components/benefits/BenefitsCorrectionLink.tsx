import type { BenefitCategory } from '../../types/benefitCorrections'
import type { CompanyListing } from '../../types/benefits'

export function benefitsCorrectionUrl(company?: Pick<CompanyListing, 'company_id'>, category?: BenefitCategory) {
  const params = new URLSearchParams()
  if (company) params.set('company', company.company_id)
  if (category) params.set('category', category)
  const query = params.toString()
  return `/community/benefits/correction/${query ? `?${query}` : ''}`
}

export function BenefitsCorrectionLink({ company, category }: { company?: Pick<CompanyListing, 'company_id'>; category?: BenefitCategory }) {
  return <a className="benefits-correction-link" href={benefitsCorrectionUrl(company, category)}>정보 수정 요청</a>
}
