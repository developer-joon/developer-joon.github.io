import { categoryLabels, outcomeFor, type CompanyListing } from '../../types/benefits'
import { conditionGroup, presetCategories, type ConditionGroup, type QueryState } from '../../lib/benefitsQueryState'
import { BenefitEvidenceCounts, BenefitSourceBadges } from './BenefitSourceBadges'
import { BenefitLineageBadge } from './BenefitLineageBadge'

const groupLabels: Record<ConditionGroup, string> = { matches_visible_scope: '공개 범위와 조건 일치', scope_mismatch: '공개 범위와 조건 불일치', scope_unknown: '적용 범위 미상', insufficient_evidence: '근거 부족' }
export function buildConditionResults(companies: CompanyListing[], state: QueryState) {
  const order: ConditionGroup[] = ['matches_visible_scope','scope_mismatch','scope_unknown','insufficient_evidence']
  return order.flatMap((group) => companies.map((company) => ({ company, ...conditionGroup(company, state) })).filter((result) => result.group === group))
}
export function FitResultList({ companies, state, link, projectionActive = false }: { companies: CompanyListing[]; state: QueryState; link: (id: string) => string; projectionActive?: boolean }) {
  const results = buildConditionResults(companies, state)
  const start = (state.page - 1) * 50
  const wanted = state.preferred_categories.length ? state.preferred_categories : presetCategories(state.preset)
  return <div>{results.slice(start, start + 50).map(({ company, group, reasons }) => <article className="benefits-result" data-company-id={company.company_id} key={company.company_id}><h3><a href={link(company.company_id)}>{company.display_name}</a></h3><BenefitLineageBadge company={company} projectionActive={projectionActive} /><strong>{groupLabels[group]}</strong><ul>{reasons.map((reason) => <li key={reason}>{reason.startsWith('leave:') ? `${categoryLabels.leave}:${reason.split(':')[1]}` : reason}</li>)}</ul><div className="benefits-result-evidence" aria-label="선택 분야 근거">{wanted.map((category) => { const outcome = outcomeFor(company, category); return <section key={category} aria-label={categoryLabels[category]}><h4>{categoryLabels[category]}</h4><BenefitSourceBadges outcome={outcome} metadata /><BenefitEvidenceCounts outcome={outcome} /></section> })}</div></article>)}{results.length > 50 && <p>페이지당 최대 50개 기업을 표시합니다.</p>}{!results.length && <p>검색 결과가 없습니다.</p>}</div>
}
