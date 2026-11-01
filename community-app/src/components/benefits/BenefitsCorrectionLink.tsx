import type { CompanyListing } from '../../types/benefits'

const correctionIssueUrl = 'https://github.com/developer-joon/developer-joon.github.io/issues/new'

export function benefitsCorrectionUrl(company?: Pick<CompanyListing, 'company_id' | 'display_name'>) {
  const url = new URL(correctionIssueUrl)
  url.searchParams.set('template', 'company-benefits-correction.yml')
  url.searchParams.set('title', company
    ? `[복지 정보 정정] ${company.display_name} (${company.company_id})`
    : '[복지 정보 정정] 기업명')
  return url.toString()
}

export function BenefitsCorrectionLink({ company }: { company?: Pick<CompanyListing, 'company_id' | 'display_name'> }) {
  return <a className="benefits-correction-link" href={benefitsCorrectionUrl(company)} target="_blank" rel="noreferrer">정보 수정 요청</a>
}