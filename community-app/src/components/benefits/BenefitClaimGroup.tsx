import { categoryLabels,type Category,type Claim } from '../../types/benefits'
import { OfficialSourceList } from './OfficialSourceList'
export function BenefitClaimGroup({category,claims}:{category:Category;claims:Claim[]}) {
 return <section id={category} tabIndex={-1} aria-label={`${categoryLabels[category]} 근거`}><h3>{categoryLabels[category]}</h3>{claims.map(claim=><article className="benefits-evidence" key={claim.claim_id}><h4>{claim.name}</h4><p><strong>{claim.status}</strong> · {claim.description}</p><dl><dt>적용 국가</dt><dd>{claim.country}</dd><dt>고용 법인</dt><dd>{claim.legal_entity}</dd><dt>대상 직군</dt><dd>{claim.jobs}</dd><dt>고용형태</dt><dd>{claim.employment}</dd><dt>근속·기간 조건</dt><dd>{claim.conditions}</dd></dl><OfficialSourceList source={claim.source}/></article>)}{!claims.length&&<p>판단 자료 부족 · 공개 근거가 확인되지 않았습니다.</p>}</section>
}
