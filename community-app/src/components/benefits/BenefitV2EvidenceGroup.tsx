import { categoryLabels, type Category, type Detail } from '../../types/benefits'

const scopeText = (scope: { countries: string[]; legal_entities: string[]; roles: string[]; employment_types: string[] }) => `국가 ${scope.countries.join(', ') || '명시되지 않음'} · 법인 ${scope.legal_entities.join(', ') || '명시되지 않음'} · 직군 ${scope.roles.join(', ') || '명시되지 않음'} · 고용형태 ${scope.employment_types.join(', ') || '명시되지 않음'}`

export function BenefitV2EvidenceGroup({ category, detail }: { category: Category; detail: Detail }) {
  const sources = new Map((detail.sources ?? []).map((source) => [source.source_id, source]))
  const official = (detail.official_claims ?? []).filter((record) => record.category_id === category)
  const references = (detail.references ?? []).filter((record) => record.category_id === category)
  const community = (detail.community_reports ?? []).filter((record) => record.category_id === category)
  return <section id={category} tabIndex={-1} className="benefits-v2-evidence" aria-label={`${categoryLabels[category]} 승인 v2 근거`}>
    <h3>{categoryLabels[category]}</h3>
    {official.map((record) => <article className="benefits-evidence" key={record.claim_id}><h4>공식 기록</h4><dl><dt>분야</dt><dd>{categoryLabels[record.category_id]}</dd><dt>적용 범위</dt><dd>{scopeText(record.scope)}</dd><dt>출처</dt><dd>{record.source_ids.map((sourceId) => { const source = sources.get(sourceId); return source ? <a key={sourceId} href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a> : null })}</dd></dl></article>)}
    {references.map((record) => { const source = sources.get(record.source_id); return <article className="benefits-evidence" key={record.reference_id}><h4>참고 자료</h4><p>{record.statement}</p><blockquote>{record.supporting_quote}</blockquote><p>{source && <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>}</p></article> })}
    {community.map((record) => { const source = sources.get(record.source_id); return <article className="benefits-evidence benefits-evidence--community" key={record.community_report_id}><h4>커뮤니티 보고 · 하위 근거 계층</h4><p>{record.statement}</p><p>{source && <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>}</p></article> })}
    {!official.length && !references.length && !community.length && <p>이 분야에 게시 가능한 승인 v2 근거가 없습니다.</p>}
  </section>
}