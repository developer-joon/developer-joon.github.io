import { categories, categoryLabels, type Category, type ResearchLead } from '../../types/benefits'

const scopeList = (value: string | string[]) => Array.isArray(value) ? value.join(', ') || '명시되지 않음' : value
const conditionLabels: Record<string, string> = {
  occasion: '상황', education_level: '학력', covered_persons: '대상', purpose: '용도',
  residence: '거주 조건', tenure: '재직 조건', price: '금액',
}
function conditionText(conditions: ResearchLead['scope']['conditions']) {
  if (typeof conditions === 'string' || Array.isArray(conditions)) return scopeList(conditions)
  const entries = Object.entries(conditions)
  return entries.length ? entries.map(([key, value]) => `${conditionLabels[key]} ${value}`).join(' · ') : '명시되지 않음'
}

export function SourceBackedResearchGroup({ leads }: { leads: ResearchLead[] }) {
  return <section className="benefits-research-section" aria-labelledby="research-heading">
    <h2 id="research-heading">회사 공식 출처 조사 기록 ({leads.length}건)</h2>
    <p>아래는 독립적인 출처·권리 검토를 거친 조사 항목입니다. 현재 제공되는 복지 혜택으로 독립 검토·승인된 것은 아닙니다. 확인된 복지 혜택·비교·적합도 집계에 포함되지 않습니다.</p>
    {leads.length === 0 ? <p className="benefits-official-only-notice">공개 복지 정보 미확인</p> : categories.filter((category) => leads.some((lead) => lead.primary_category === category)).map((category: Category) =>
      <section key={category} id={`research-${category}`} tabIndex={-1} className="benefits-research-group" aria-labelledby={`research-${category}-heading`}>
        <h3 id={`research-${category}-heading`}>{categoryLabels[category]}</h3>
        <div className="benefits-research-cards">{leads.filter((lead) => lead.primary_category === category).map((lead, index) =>
          <article key={`${lead.source_registry_id}-${lead.benefit_action}`} className="benefits-research-card" aria-labelledby={`research-${category}-action-${index}`}>
            <h4 id={`research-${category}-action-${index}`}>{lead.benefit_action}<span className="sr-only"> — {categoryLabels[category]} 조사 중 {index + 1}번</span></h4>
            <p className="benefits-research-card__excerpt">{categoryLabels[category]} · 조사 중—확인된 혜택 아님</p>
            <details className="benefits-research-card__details">
              <summary aria-label={`${lead.benefit_action} 적용 범위·조사 한계·출처 보기`}>적용 범위·조사 한계·출처 보기</summary>
              <dl className="benefits-research-card__scope">
                <dt>적용 범위</dt><dd>법인 {lead.scope.legal_entity} · 직군 {scopeList(lead.scope.roles)} · 고용형태 {scopeList(lead.scope.employment_types)} · 조건 {conditionText(lead.scope.conditions)}</dd>
                <dt>현재성</dt><dd>{lead.currentness === 'unknown' ? '현재성 미확인' : lead.currentness === 'historical' ? '과거 정보' : '현재 정보'}</dd>
                <dt>출처 확인일</dt><dd><time dateTime={lead.observed_at}>{lead.observed_at.slice(0, 10)}</time></dd>
              </dl>
              <div className="benefits-research-card__limits"><strong>조사 한계</strong><ul>{lead.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></div>
              <a href={lead.source_url} target="_blank" rel="noopener noreferrer">회사 공식 출처 열기</a>
            </details>
          </article>)}</div>
      </section>)}
  </section>
}
