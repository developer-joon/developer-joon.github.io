import { categories, categoryLabels, outcomeLabels, type CompanyListing } from '../../types/benefits'
import type { QueryState } from '../../lib/benefitsQueryState'

export function BenefitsFilterPanel({ state, update, companies }: { state: QueryState; update: (patch: Partial<QueryState>) => void; companies: CompanyListing[] }) {
  const countries = [...new Set(companies.flatMap((company) => [company.incorporation_country, company.registered_head_office_country]))]
  return <details className="benefits-filters" open><summary>검색·필터</summary><div className="benefits-filter-content">
    <label>기업 검색<input type="search" value={state.q} maxLength={100} onChange={(event) => update({ q: event.target.value, page: 1 })} /></label>
    <label>기업 범위<select value={state.scope} onChange={(event) => update({ scope: event.target.value as QueryState['scope'], page: 1 })}><option value="all">전체 기업</option><option value="domestic">국내</option><option value="international">해외</option></select></label>
    <label>국가<select value={state.country} onChange={(event) => update({ country: event.target.value, page: 1 })}><option value="">전체</option>{countries.map((country) => <option key={country}>{country}</option>)}</select></label>
    <fieldset><legend>복지 분야</legend>{categories.map((category) => <label key={category}><input type="checkbox" checked={state.categories.includes(category)} onChange={(event) => update({ categories: event.target.checked ? [...state.categories, category] : state.categories.filter((value) => value !== category), page: 1 })} />{categoryLabels[category]}</label>)}</fieldset>
    <fieldset><legend>근거 상태</legend>{(['confirmed','bounded','insufficient_evidence'] as const).map((status) => <label key={status}><input type="checkbox" checked={state.statuses.includes(status)} onChange={(event) => update({ statuses: event.target.checked ? [...state.statuses, status] : state.statuses.filter((value) => value !== status), page: 1 })} />{outcomeLabels[status]}</label>)}</fieldset>
    <button onClick={() => update({ scope: 'all', q: '', categories: [], statuses: [], country: '', page: 1 })}>필터 초기화</button>
  </div></details>
}
