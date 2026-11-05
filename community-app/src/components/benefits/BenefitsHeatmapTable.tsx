import { categories, categoryLabels, conflictStatusLabels, currentnessLabels, isResearchedOutcome, outcomeFor, outcomeLabels, reliabilityLabels, researchStateFor, scopeStatusLabels, sourceTierLabels, specificContentLabel, specificContentStatus, type Category, type CompanyListing } from '../../types/benefits'
import { BenefitEvidenceCounts, BenefitSourceBadges } from './BenefitSourceBadges'
import { BenefitLineageBadge } from './BenefitLineageBadge'

export function BenefitsHeatmapTable({ companies, selectedCategories, compare, toggle, link, projectionActive = false }: { companies: CompanyListing[]; selectedCategories: Category[]; compare: string[]; toggle: (id: string) => void; link: (id: string, category?: Category) => string; projectionActive?: boolean }) {
  const visible = selectedCategories.length ? selectedCategories : categories
  return <div className="benefits-table-scroll" role="region" aria-label="복지 현황 표" tabIndex={0}>
    <table className="benefits-heatmap"><caption>기업별 공개 근거 상태</caption><thead><tr><th scope="col">기업 / 비교 (최대 4개)</th>{visible.map((category) => <th key={category}>{categoryLabels[category]}</th>)}</tr></thead>
      <tbody>{companies.slice(0, 50).map((company) => <tr key={company.company_id} data-company-id={company.company_id}>
        <th scope="row"><a href={link(company.company_id)}>{company.display_name}</a><BenefitLineageBadge company={company} projectionActive={projectionActive} /><small>{company.registered_head_office_country} · {company.sector === 'financial' ? '금융' : '비금융'}</small><label><input type="checkbox" aria-label={`비교 ${company.display_name}`} checked={compare.includes(company.company_id)} disabled={!compare.includes(company.company_id) && compare.length >= 4} onChange={() => toggle(company.company_id)} />비교</label></th>
        {visible.map((category) => {
          const outcome = outcomeFor(company, category)
          if (isResearchedOutcome(outcome)) {
            const state = researchStateFor(outcome)
            const contentLabel = specificContentLabel(outcome)
            const contentStatus = specificContentStatus(outcome)
            const labelId = `heatmap-label-${company.company_id}-${category}`
            const descriptionId = `heatmap-description-${company.company_id}-${category}`
            const tierLabels = [...new Set(outcome.source_tiers.map((tier) => sourceTierLabels[tier]))]
            const conflictWarning = outcome.conflict_status === 'none' ? null : conflictStatusLabels[outcome.conflict_status]
            return <td key={category}><a className={`benefits-status status-${state}`} href={link(company.company_id, category)} aria-labelledby={labelId} aria-describedby={descriptionId}>
              <span className="sr-only" id={labelId}>{company.display_name} {categoryLabels[category]} {contentLabel}</span>
              <span className="sr-only" id={descriptionId}>
                출처 계층: {tierLabels.join(', ') || '공개 출처 없음'}. 신뢰도: {reliabilityLabels[outcome.reliability]}.
                근거 건수: 공식 근거 {outcome.official_claim_count}건; 참고 자료 {outcome.reference_count}건; 커뮤니티 보고 {outcome.community_report_count}건.
                현재성: {currentnessLabels[outcome.currentness]}. 범위: {scopeStatusLabels[outcome.scope_status]}; 국가: {outcome.scope.countries.join(', ') || '미상'}.
                확인일: {outcome.last_checked_at.slice(0, 10)}.{conflictWarning ? ` 경고: ${conflictWarning}.` : ''}
              </span>
              {contentStatus !== 'no_public_info' && <strong>{contentLabel}</strong>}
              <BenefitSourceBadges outcome={outcome} />
              <BenefitEvidenceCounts outcome={outcome} />
              <small>{outcome.scope.countries.join(', ') || '국가 범위 미상'} · {outcome.last_checked_at.slice(0, 10)}</small>
            </a></td>
          }
          if (projectionActive) return <td key={category}><a className="benefits-status status-projection-pending" href={link(company.company_id, category)} aria-label={`${company.display_name} ${categoryLabels[category]} ${specificContentLabel()}`}><strong>{specificContentLabel()}</strong><small>기존 자료는 기업 상세에서 확인할 수 있습니다.</small></a></td>
          const status = outcome.kind === 'evidenced' ? outcome.status : 'insufficient_evidence'
          return <td key={category}><a className={`benefits-status status-${status}`} href={link(company.company_id, category)} aria-label={`${company.display_name} ${categoryLabels[category]} ${outcomeLabels[status]}`}><strong>{outcomeLabels[status]}</strong>{outcome.kind === 'evidenced' ? <><span>근거 claim {outcome.claim_count}건 · 복지 유형 {outcome.benefit_type_count}개</span><small>{outcome.scope.countries.join(', ') || '국가 범위 미상'} · {outcome.last_checked_at.slice(0, 10)}</small></> : <small>{outcome.nonabsence_notice}</small>}</a></td>
        })}
      </tr>)}</tbody>
    </table>
  </div>
}
