import { useEffect, useState } from 'react'
import { categories, outcomeFor, type Detail } from '../types/benefits'
import { benefitsClient } from '../data/benefitsArtifactClient'
import { serializeQuery } from '../lib/benefitsQueryState'
import type { ExplorerViewProps } from './BenefitsExplorerPage'
import { CompanyEvidenceHeader } from '../components/benefits/CompanyEvidenceHeader'
import { BenefitClaimGroup } from '../components/benefits/BenefitClaimGroup'

export function BenefitsCompanyPage({ manifest, listings, state, id }: { id: string } & ExplorerViewProps) {
  const company = listings.find((item) => item.company_id === id); const [data, setData] = useState<Detail>(); const [error, setError] = useState(false); const [attempt, setAttempt] = useState(0)
  useEffect(() => { if (!company) return; let active = true; const controller = new AbortController(); benefitsClient.loadCompanyDetail(manifest, listings, id, controller.signal).then((detail) => { if (active) setData(detail) }).catch(() => { if (active) setError(true) }); return () => { active = false; controller.abort() } }, [company, manifest, listings, id, attempt])
  useEffect(() => { if (!data || !categories.some((category) => `#${category}` === window.location.hash)) return; const section = document.getElementById(window.location.hash.slice(1)); section?.scrollIntoView?.(); section?.focus() }, [data])
  const back = <a href={`/community/benefits/${serializeQuery(state)}`}>복지 현황으로 돌아가기</a>
  if (!company) return <section><h2>기업을 찾을 수 없습니다</h2>{back}</section>
  return <>{back}<CompanyEvidenceHeader company={company} version={manifest.data_version} />{error ? <section role="alert">상세 근거를 불러올 수 없습니다<button onClick={() => { setError(false); setAttempt((value) => value + 1) }}>상세 다시 시도</button></section> : !data ? <p role="status">상세 근거를 불러오고 있습니다.</p> : <>{categories.map((category) => <BenefitClaimGroup key={category} category={category} outcome={outcomeFor(company, category)} claims={data.claims.filter((claim) => claim.category_ids.includes(category))} />)}<p><a href="/community/benefits/methodology/#corrections">Community 정정 제보·댓글·신고 정책</a></p></>}</>
}
