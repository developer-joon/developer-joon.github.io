import { useEffect, useState } from 'react'
import { categories, outcomeFor } from '../types/benefits'
import type { BenefitCompanyDetailView } from '../data/benefitsArtifactClient'
import { benefitsClient } from '../data/benefitsArtifactClient'
import { serializeQuery } from '../lib/benefitsQueryState'
import type { ExplorerViewProps } from './BenefitsExplorerPage'
import { CompanyEvidenceHeader } from '../components/benefits/CompanyEvidenceHeader'
import { BenefitClaimGroup } from '../components/benefits/BenefitClaimGroup'
import { BenefitsCorrectionLink } from '../components/benefits/BenefitsCorrectionLink'
import { BenefitV2EvidenceSection } from '../components/benefits/BenefitV2EvidenceGroup'
import { SourceBackedResearchGroup } from '../components/benefits/SourceBackedResearchGroup'

export function BenefitsCompanyPage({ atlas, manifest, listings, state, id }: { id: string } & ExplorerViewProps) {
  const company = listings.find((item) => item.company_id === id)
  const correctionCategory = categories.find((category) => window.location.hash === `#${category}`)
  const researchLeads = atlas.research.leads.filter((lead) => lead.company_id === id)
  const [loaded, setLoaded] = useState<{ id: string; detail: BenefitCompanyDetailView }>()
  const [failedId, setFailedId] = useState<string>()
  const data = loaded?.id === id ? loaded.detail : undefined
  const error = failedId === id
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!company) return
    let active = true
    const controller = new AbortController()
    benefitsClient.loadAtlasCompanyDetail(atlas, id, controller.signal).then((detail) => { if (active) setLoaded({ id, detail }) }).catch(() => { if (active) setFailedId(id) })
    return () => { active = false; controller.abort() }
  }, [company, atlas, id, attempt])
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (!categories.some((category) => hash === `research-${category}` || (data && hash === category))) return
    const section = document.getElementById(hash)
    section?.scrollIntoView?.()
    section?.focus()
  }, [data, id])
  const back = <a href={`/community/benefits/${serializeQuery(state)}`}>복지 현황으로 돌아가기</a>
  if (!company) return <section><h2>기업을 찾을 수 없습니다</h2>{back}</section>
  return <>{back}<CompanyEvidenceHeader company={company} version={manifest.data_version} projectionVersion={company.lineage.approved_v2 ? manifest.approved_v2_projection?.data_version : undefined} projectionActive={Boolean(manifest.approved_v2_projection)} />
    {data?.approvedV2?.verified_benefits?.length === 0 && <p className="benefits-official-only-notice">확인된 복지 혜택 0건 · 아래 조사 기록은 승인 혜택이 아닙니다.</p>}
    {!data?.approvedV2 && <section className="benefits-specific-section"><h2>확인된 복지 혜택 (0건)</h2><p>현재 제공되는 복지 혜택으로 독립 검토·승인된 항목이 없습니다. 아래 조사 기록은 승인 혜택이 아닙니다.</p></section>}
    <SourceBackedResearchGroup leads={researchLeads} />
    <p className="benefits-correction-action"><BenefitsCorrectionLink company={company} category={correctionCategory} /> 공개 HTTPS 근거와 국가·관할, 대상 법인, 직군, 고용 형태, 적용 시점·기간을 알려주세요. 검토 승인만으로 공개 데이터가 즉시 변경되지는 않습니다.</p>
    {data?.approvedV2 && <BenefitV2EvidenceSection detail={data.approvedV2} />}
    {error ? <section role="alert">상세 근거를 불러올 수 없습니다<button onClick={() => { setFailedId(undefined); setAttempt((value) => value + 1) }}>상세 다시 시도</button></section> : !data ? <p role="status">상세 근거를 불러오고 있습니다.</p> : <><section aria-labelledby="legacy-evidence"><h2 id="legacy-evidence">기존 공개 조사 기록 (혜택 승인 아님)</h2>{categories.map((category) => <BenefitClaimGroup key={category} category={category} outcome={outcomeFor(company.lineage.legacy, category)} claims={data.legacy.claims.filter((claim) => claim.category_ids.includes(category))} sectionId={!data.approvedV2} hideUnreviewedClaims={Boolean(manifest.approved_v2_projection)} />)}</section><p><a href="/community/benefits/methodology/#corrections">정정 검토 기준 보기</a></p></>}</>
}
