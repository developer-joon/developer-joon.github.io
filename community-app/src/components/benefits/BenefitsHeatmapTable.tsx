import { categories, categoryLabels, outcomeFor, outcomeLabels, type Category, type CompanyListing } from '../../types/benefits'

export function BenefitsHeatmapTable({ companies, selectedCategories, compare, toggle, link }: { companies: CompanyListing[]; selectedCategories: Category[]; compare: string[]; toggle: (id: string) => void; link: (id: string, category?: Category) => string }) {
  const visible = selectedCategories.length ? selectedCategories : categories
  return <div className="benefits-table-scroll" role="region" aria-label="복지 현황 표" tabIndex={0}>
    <table className="benefits-heatmap"><caption>기업별 공개 근거 상태</caption><thead><tr><th scope="col">기업 / 비교 (최대 4개)</th>{visible.map((category) => <th key={category}>{categoryLabels[category]}</th>)}</tr></thead>
      <tbody>{companies.slice(0, 50).map((company) => <tr key={company.company_id} data-company-id={company.company_id}>
        <th scope="row"><a href={link(company.company_id)}>{company.display_name}</a><small>{company.registered_head_office_country} · {company.sector === 'financial' ? '금융' : '비금융'}</small><label><input type="checkbox" aria-label={`비교 ${company.display_name}`} checked={compare.includes(company.company_id)} disabled={!compare.includes(company.company_id) && compare.length >= 4} onChange={() => toggle(company.company_id)} />비교</label></th>
        {visible.map((category) => { const outcome = outcomeFor(company, category); const status = outcome.kind === 'evidenced' ? outcome.status : 'insufficient_evidence'; return <td key={category}><a className={`benefits-status status-${status}`} href={link(company.company_id, category)} aria-label={`${company.display_name} ${categoryLabels[category]} ${outcomeLabels[status]}`}><strong>{outcomeLabels[status]}</strong>{outcome.kind === 'evidenced' ? <><span>근거 claim {outcome.claim_count}건 · 복지 유형 {outcome.benefit_type_count}개</span><small>{outcome.scope.countries.join(', ') || '국가 범위 미상'} · {outcome.last_checked_at.slice(0, 10)}</small></> : <small>{outcome.nonabsence_notice}</small>}</a></td> })}
      </tr>)}</tbody>
    </table>
  </div>
}
