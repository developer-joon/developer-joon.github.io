import { categoryLabels, outcomeLabels, type Category, type CategoryOutcome, type Claim } from '../../types/benefits'
import { OfficialSourceList } from './OfficialSourceList'
export function BenefitClaimGroup({ category, outcome, claims }: { category: Category; outcome: CategoryOutcome; claims: Claim[] }) {
  const status = outcome.kind === 'evidenced' ? outcome.status : 'insufficient_evidence'
  return <section id={category} tabIndex={-1} aria-label={`${categoryLabels[category]} 근거`}><h3>{categoryLabels[category]} · {outcomeLabels[status]}</h3>
    {outcome.kind === 'insufficient_evidence' ? <><p>{outcome.nonabsence_notice}</p><p>사유: {outcome.reason_code} · 조사일: {outcome.searched_at?.slice(0, 10) ?? '미조사'}</p></> : <p>확인된 claim {outcome.claim_count}건 · 적용 국가 {outcome.scope.countries.join(', ') || '명시되지 않음'} · 법인 {outcome.scope.legal_entities.join(', ') || '명시되지 않음'} · 직군 {outcome.scope.roles.join(', ') || '명시되지 않음'} · 고용형태 {outcome.scope.employment_types.join(', ') || '명시되지 않음'}</p>}
    {claims.map((claim) => <article className="benefits-evidence" key={claim.claim_id}><h4>{claim.benefit_name}</h4><p><strong>{claim.research_status}</strong> · {claim.detail}</p><dl><dt>적용 국가</dt><dd>{claim.application_scope.countries.join(', ') || '명시되지 않음'}</dd><dt>고용 법인</dt><dd>{claim.application_scope.legal_entities.join(', ') || '명시되지 않음'}</dd><dt>대상 직군</dt><dd>{claim.application_scope.roles.join(', ') || '명시되지 않음'}</dd><dt>고용형태</dt><dd>{claim.application_scope.employment_types.join(', ') || '명시되지 않음'}</dd><dt>근속·자격 조건</dt><dd>{claim.application_scope.tenure_condition || '명시되지 않음'}</dd></dl><OfficialSourceList evidence={claim.source_evidence} /></article>)}
  </section>
}
