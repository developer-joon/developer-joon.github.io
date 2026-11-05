import { useEffect, useState } from 'react'
import { categories, outcomeFor } from '../types/benefits'
import type { BenefitCompanyDetailView } from '../data/benefitsArtifactClient'
import { benefitsClient } from '../data/benefitsArtifactClient'
import { serializeQuery } from '../lib/benefitsQueryState'
import type { ExplorerViewProps } from './BenefitsExplorerPage'
import { CompanyEvidenceHeader } from '../components/benefits/CompanyEvidenceHeader'
import { BenefitClaimGroup } from '../components/benefits/BenefitClaimGroup'
import { BenefitsCorrectionLink } from '../components/benefits/BenefitsCorrectionLink'
import { BenefitV2EvidenceGroup } from '../components/benefits/BenefitV2EvidenceGroup'

export function BenefitsCompanyPage({ atlas, manifest, listings, state, id }: { id: string } & ExplorerViewProps) {
  const company = listings.find((item) => item.company_id === id); const correctionCategory = categories.find(category => window.location.hash === `#${category}`); const [data, setData] = useState<BenefitCompanyDetailView>(); const [error, setError] = useState(false); const [attempt, setAttempt] = useState(0)
  useEffect(() => { if (!company) return; let active = true; const controller = new AbortController(); benefitsClient.loadAtlasCompanyDetail(atlas, id, controller.signal).then((detail) => { if (active) setData(detail) }).catch(() => { if (active) setError(true) }); return () => { active = false; controller.abort() } }, [company, atlas, id, attempt])
  useEffect(() => { if (!data || !categories.some((category) => `#${category}` === window.location.hash)) return; const section = document.getElementById(window.location.hash.slice(1)); section?.scrollIntoView?.(); section?.focus() }, [data])
  const back = <a href={`/community/benefits/${serializeQuery(state)}`}>복지 현황으로 돌아가기</a>
  if (!company) return <section><h2>기업을 찾을 수 없습니다</h2>{back}</section>
  return <>{back}<CompanyEvidenceHeader company={company} version={manifest.data_version} projectionVersion={company.lineage.approved_v2 ? manifest.approved_v2_projection?.data_version : undefined} projectionActive={Boolean(manifest.approved_v2_projection)} /><p className="benefits-correction-action"><BenefitsCorrectionLink company={company} category={correctionCategory} /> 공개 HTTPS 근거와 국가·관할, 대상 법인, 직군, 고용 형태, 적용 시점·기간을 알려주세요. 검토 승인만으로 공개 데이터가 즉시 변경되지는 않습니다.</p>{error ? <section role="alert">상세 근거를 불러올 수 없습니다<button onClick={() => { setError(false); setAttempt((value) => value + 1) }}>상세 다시 시도</button></section> : !data ? <p role="status">상세 근거를 불러오고 있습니다.</p> : <>{data.approvedV2 && <section aria-labelledby="approved-v2-evidence"><h2 id="approved-v2-evidence">승인 v2 조사 근거</h2>{categories.map((category) => <BenefitV2EvidenceGroup key={category} category={category} detail={data.approvedV2!} />)}</section>}<section aria-labelledby="legacy-evidence"><h2 id="legacy-evidence">기존 공개 기록</h2>{categories.map((category) => <BenefitClaimGroup key={category} category={category} outcome={outcomeFor(company.lineage.legacy, category)} claims={data.legacy.claims.filter((claim) => claim.category_ids.includes(category))} sectionId={!data.approvedV2} />)}</section><p><a href="/community/benefits/methodology/#corrections">정정 검토 기준 보기</a></p></>}</>
}
