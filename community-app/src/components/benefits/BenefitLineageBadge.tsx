import { hasApprovedV2Projection, type BenefitCompanyView, type CompanyListing } from '../../types/benefits'

export function BenefitLineageBadge({ company, projectionActive = false }: { company: CompanyListing | BenefitCompanyView; projectionActive?: boolean }) {
  if (hasApprovedV2Projection(company)) return <span className="benefits-lineage-badge" aria-label="추가 조사 자료">조사 자료</span>
  if (projectionActive) return <span className="benefits-lineage-pending">추가 조사 미적용</span>
  return null
}