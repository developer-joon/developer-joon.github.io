import {
  conflictStatusLabels,
  currentnessLabels,
  isResearchedOutcome,
  reliabilityLabels,
  researchStateFor,
  researchStateLabels,
  scopeStatusLabels,
  sourceTierLabels,
  type CategoryOutcome,
} from '../../types/benefits'

export function BenefitSourceBadges({ outcome, metadata = false }: { outcome: CategoryOutcome; metadata?: boolean }) {
  const state = researchStateFor(outcome)
  if (!isResearchedOutcome(outcome)) return <span className={`benefits-badge badge-${state}`}>{researchStateLabels[state]}</span>
  const sourceLabels = [...new Set(outcome.source_tiers.map((tier) => sourceTierLabels[tier]))]
  const labels = sourceLabels.length ? sourceLabels : [researchStateLabels[state]]
  const warnings = [
    outcome.currentness === 'historical' ? currentnessLabels.historical : null,
    outcome.scope_status === 'unresolved' ? scopeStatusLabels.unresolved : null,
    outcome.conflict_status === 'contradictory' ? conflictStatusLabels.contradictory : null,
  ].filter((label) => label !== null)
  const facts = metadata ? [
    reliabilityLabels[outcome.reliability],
    currentnessLabels[outcome.currentness],
    scopeStatusLabels[outcome.scope_status],
    conflictStatusLabels[outcome.conflict_status],
  ] : warnings
  return <ul className="benefits-badges" aria-label="출처와 근거 상태">
    {labels.map((label) => <li className={`benefits-badge badge-${state}`} key={label}>{label}</li>)}
    {facts.map((label) => <li className="benefits-badge badge-warning" key={label}>{label}</li>)}
  </ul>
}

export function BenefitEvidenceCounts({ outcome }: { outcome: CategoryOutcome }) {
  if (!isResearchedOutcome(outcome)) return outcome.kind === 'evidenced' ? <span>공식 claim {outcome.claim_count}건</span> : null
  return <span className="benefits-evidence-counts">
    {outcome.official_claim_count > 0 && <span>공식 근거 {outcome.official_claim_count}건</span>}
    {outcome.reference_count > 0 && <span>참고 자료 {outcome.reference_count}건</span>}
    {outcome.community_report_count > 0 && <span>커뮤니티 보고 {outcome.community_report_count}건</span>}
  </span>
}