import { categoryLabels, isResearchedOutcome, outcomeLabels, researchStateLabels, type Category, type CategoryOutcome, type Claim } from '../../types/benefits'
import { OfficialSourceList } from './OfficialSourceList'
import { BenefitEvidenceCounts, BenefitSourceBadges } from './BenefitSourceBadges'

const legacyResearchStatusLabels: Record<Claim['research_status'], string> = { confirmed: '기존 조사에서 확인 (혜택 승인 아님)', limited: '범위 제한', past: '과거 조사', name_only: '명칭만 확인', conflict: '상충 근거' }
const legacyCurrentnessLabels: Record<Claim['current_validity'], string> = { current: '자료상 현재 정보', undated_current: '현재성 확인 필요', historical: '과거 자료 (현재 제공 여부 미확인)' }
const legacyLimitationLabels: Record<string, string> = { scope_or_research_limit: '적용 범위 또는 조사 한계', historical_evidence: '과거 근거' }

export function BenefitClaimGroup({ category, outcome, claims, sectionId = true, hideUnreviewedClaims = false }: { category: Category; outcome: CategoryOutcome; claims: Claim[]; sectionId?: boolean; hideUnreviewedClaims?: boolean }) {
  const claimCards = claims.map((claim, index) => <article className="benefits-evidence" key={claim.claim_id}>
    {hideUnreviewedClaims ? <><h4>기존 조사 자료 {index + 1}</h4><p>원문 복지 항목은 분야·법인별로 분리 검토되지 않아 표시하지 않습니다.</p><dl><dt>조사 상태</dt><dd>{legacyResearchStatusLabels[claim.research_status]}</dd><dt>현재성</dt><dd>{legacyCurrentnessLabels[claim.current_validity]}</dd><dt>자료 발행일</dt><dd>{claim.publication_date ?? '미상'}</dd><dt>조사 확인일</dt><dd>{claim.checked_at.slice(0, 10)}</dd><dt>한계</dt><dd>{claim.limitation_codes.map((code) => legacyLimitationLabels[code] ?? code).join(', ') || '명시되지 않음'}</dd></dl></> : <><h4>{claim.benefit_name}</h4><p><strong>{claim.research_status}</strong> · {claim.detail}</p></>}
    <dl><dt>적용 국가</dt><dd>{claim.application_scope.countries.join(', ') || '명시되지 않음'}</dd><dt>고용 법인</dt><dd>{claim.application_scope.legal_entities.join(', ') || '명시되지 않음'}</dd><dt>대상 직군</dt><dd>{claim.application_scope.roles.join(', ') || '명시되지 않음'}</dd><dt>고용형태</dt><dd>{claim.application_scope.employment_types.join(', ') || '명시되지 않음'}</dd><dt>근속·자격 조건</dt><dd>{claim.application_scope.tenure_condition || '명시되지 않음'}</dd></dl>
    <OfficialSourceList evidence={claim.source_evidence} hideQuote={hideUnreviewedClaims} />
  </article>)

  if (isResearchedOutcome(outcome)) return <section id={sectionId ? category : undefined} tabIndex={-1} aria-label={`${categoryLabels[category]} 근거`}>
    <h3>{categoryLabels[category]} · {researchStateLabels[outcome.state]}</h3>
    <BenefitSourceBadges outcome={outcome} metadata />
    <p><BenefitEvidenceCounts outcome={outcome} /></p>
    <p>적용 국가 {outcome.scope.countries.join(', ') || '명시되지 않음'} · 법인 {outcome.scope.legal_entities.join(', ') || '명시되지 않음'} · 직군 {outcome.scope.roles.join(', ') || '명시되지 않음'} · 고용형태 {outcome.scope.employment_types.join(', ') || '명시되지 않음'}</p>
    {claimCards}
  </section>
  const status = outcome.kind === 'evidenced' ? outcome.status : 'insufficient_evidence'
  return <section id={sectionId ? category : undefined} tabIndex={-1} aria-label={`${categoryLabels[category]} 근거`}><h3>{categoryLabels[category]} · {hideUnreviewedClaims ? '기존 조사 자료' : outcomeLabels[status]}</h3>
    {outcome.kind === 'insufficient_evidence' ? <><p>{outcome.nonabsence_notice}</p><p>사유: {outcome.reason_code} · 조사일: {outcome.searched_at?.slice(0, 10) ?? '미조사'}</p></> : <p>{hideUnreviewedClaims ? '기존 조사 기록' : '확인된 claim'} {outcome.claim_count}건 · 적용 국가 {outcome.scope.countries.join(', ') || '명시되지 않음'} · 법인 {outcome.scope.legal_entities.join(', ') || '명시되지 않음'} · 직군 {outcome.scope.roles.join(', ') || '명시되지 않음'} · 고용형태 {outcome.scope.employment_types.join(', ') || '명시되지 않음'}</p>}
    {claimCards}
  </section>
}
