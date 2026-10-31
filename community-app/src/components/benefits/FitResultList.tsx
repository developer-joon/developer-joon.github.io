import { categoryLabels, type CompanyListing } from '../../types/benefits'
import { conditionGroup, type ConditionGroup, type QueryState } from '../../lib/benefitsQueryState'

const groupLabels: Record<ConditionGroup, string> = { matches_visible_scope: '공개 범위와 조건 일치', scope_mismatch: '공개 범위와 조건 불일치', scope_unknown: '적용 범위 미상', insufficient_evidence: '근거 부족' }
export function buildConditionResults(companies: CompanyListing[], state: QueryState) {
  const order: ConditionGroup[] = ['matches_visible_scope','scope_mismatch','scope_unknown','insufficient_evidence']
  return order.flatMap((group) => companies.map((company) => ({ company, ...conditionGroup(company, state) })).filter((result) => result.group === group))
}
export function FitResultList({ companies, state, link }: { companies: CompanyListing[]; state: QueryState; link: (id: string) => string }) {
  const results = buildConditionResults(companies, state)
  const start = (state.page - 1) * 50
  return <div>{results.slice(start, start + 50).map(({ company, group, reasons }) => <article className="benefits-result" data-company-id={company.company_id} key={company.company_id}><h3><a href={link(company.company_id)}>{company.display_name}</a></h3><strong>{groupLabels[group]}</strong><ul>{reasons.map((reason) => <li key={reason}>{reason.startsWith('leave:') ? `${categoryLabels.leave}:${reason.split(':')[1]}` : reason}</li>)}</ul></article>)}{results.length > 50 && <p>페이지당 최대 50개 기업을 표시합니다.</p>}{!results.length && <p>검색 결과가 없습니다.</p>}</div>
}
