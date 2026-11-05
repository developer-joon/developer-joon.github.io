import { hasApprovedV2Projection, type BenefitCompanyView, type CompanyListing } from '../../types/benefits'

export function BenefitLineageBadge({ company, projectionActive = false }: { company: CompanyListing | BenefitCompanyView; projectionActive?: boolean }) {
  if (hasApprovedV2Projection(company)) return <span className="benefits-lineage-badge" aria-label="승인 v2 조사 적용">승인 v2</span>
  if (projectionActive) return <span className="benefits-lineage-pending">v2 승인 조사 미적용</span>
  return null
}