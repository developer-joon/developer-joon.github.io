import { categories, categoryLabels, isResearchedOutcome, outcomeFor, outcomeLabels, specificBenefitRecords, specificContentLabel, specificContentStatus, type CompanyListing } from '../../types/benefits'
import type { BenefitCompanyDetailView } from '../../data/benefitsArtifactClient'
import { BenefitEvidenceCounts, BenefitSourceBadges } from './BenefitSourceBadges'
import { BenefitLineageBadge } from './BenefitLineageBadge'
export function CompanyCompareTray({ companies, details, error, retry, remove, projectionActive = false }: { companies: CompanyListing[]; details?: BenefitCompanyDetailView[]; error: boolean; retry: () => void; remove: (id: string) => void; projectionActive?: boolean }) {
  if (!companies.length) return null
  const detailById = new Map(details?.map((detail) => [detail.approvedV2?.company.company_id ?? detail.legacy.company.company_id, detail]))
  return <section className="benefits-compare" aria-label="선택 기업 비교"><h2>선택 기업 비교 · {companies.length}/4</h2><p>공개 근거와 적용 범위를 나란히 표시하며 자동 평가하거나 점수화하지 않습니다.</p>{error ? <p role="alert">상세 근거 무결성 오류 <button onClick={retry}>다시 시도</button></p> : !details ? <p role="status">비교 근거를 불러오고 있습니다.</p> : null}<div className="benefits-table-scroll" role="region" aria-label="기업 비교 표" tabIndex={0}><table><caption>분야별 근거 상태와 적용 국가</caption><thead><tr><th scope="col">분야</th>{companies.map((company) => <th scope="col" key={company.company_id}>{company.display_name}<BenefitLineageBadge company={company} projectionActive={projectionActive} /><button aria-label={`${company.display_name} 비교 해제`} onClick={() => remove(company.company_id)}>해제</button></th>)}</tr></thead><tbody>{categories.map((category) => <tr key={category}><th scope="row">{categoryLabels[category]}</th>{companies.map((company) => {
    const outcome = outcomeFor(company, category)
    if (isResearchedOutcome(outcome)) {
      const contentStatus = specificContentStatus(outcome)
      const detail = detailById.get(company.company_id)?.approvedV2
      const records = detail ? specificBenefitRecords(detail, category) : []
      return <td key={company.company_id}><BenefitSourceBadges outcome={outcome} metadata /><BenefitEvidenceCounts outcome={outcome} />{contentStatus === 'specific_content' && records.length > 0 && <details className="benefits-compare-specific" aria-label={specificContentLabel(outcome)}><summary>{specificContentLabel(outcome)}</summary><ul>{records.map((record) => <li key={'reference_id' in record ? record.reference_id : record.community_report_id}>{record.statement}</li>)}</ul></details>}{contentStatus === 'evidence_only' && <strong>{specificContentLabel(outcome)}</strong>}<small>{outcome.scope.countries.join(', ') || '국가 범위 미상'}</small></td>
    }
    if (projectionActive) return <td key={company.company_id}><strong>{specificContentLabel()}</strong></td>
    return <td key={company.company_id}>{outcomeLabels[outcome.kind === 'evidenced' ? outcome.status : 'insufficient_evidence']}{outcome.kind === 'evidenced' && <small>{outcome.scope.countries.join(', ') || '국가 범위 미상'}</small>}</td>
  })}</tr>)}</tbody></table></div></section>
}
