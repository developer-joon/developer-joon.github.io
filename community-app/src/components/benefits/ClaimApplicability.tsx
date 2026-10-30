import type { Claim } from '../../types/benefits'

export function ClaimApplicability({ claims }: { claims: Claim[] }) {
  if (!claims.length) return <small>claim 적용 범위 자료 없음</small>
  return (
    <ul className="benefits-applicability">
      {claims.map((claim) => (
        <li key={claim.claim_id}>
          <strong>{claim.name}</strong> · {claim.status}
          <small>
            국가 {claim.country} · 법인 {claim.legal_entity} · 직군 {claim.jobs} ·
            고용형태 {claim.employment}
          </small>
        </li>
      ))}
    </ul>
  )
}
