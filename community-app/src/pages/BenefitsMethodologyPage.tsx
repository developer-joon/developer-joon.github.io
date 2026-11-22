import { useEffect, useState } from 'react'
import { BenefitsExplorerShell } from '../components/benefits/BenefitsExplorerShell'
import { benefitsClient } from '../data/benefitsArtifactClient'
import { parseQuery, serializeQuery } from '../lib/benefitsQueryState'
import type { Manifest } from '../types/benefits'
import { BenefitsCorrectionLink } from '../components/benefits/BenefitsCorrectionLink'

export function BenefitsMethodologyPage({ search = window.location.search }: { search?: string }) {
  const query = serializeQuery(parseQuery(search))
  const [manifest, setManifest] = useState<Manifest>()
  const [method, setMethod] = useState<{ title: string; paragraphs: string[] }>()
  const [error, setError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    benefitsClient.loadManifest(controller.signal).then(async (loaded) => {
      const methodology = await benefitsClient.loadMethodology(loaded, controller.signal)
      setManifest(loaded)
      setMethod(methodology)
    }).catch(() => setError(true))
    return () => controller.abort()
  }, [])

  return <BenefitsExplorerShell route="methodology" query={query} manifest={manifest}>
    <section className="benefits-evidence">
      {error ? <div role="alert"><h2>조사 기준을 사용할 수 없습니다</h2><p>조사 데이터 manifest와 방법론 artifact를 확인할 수 없습니다.</p></div> : !method ? <p role="status">조사 기준을 확인하고 있습니다.</p> : <>
        <h2>{method.title}</h2>
        {method.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        <h3 id="corrections">정정 요청</h3>
        <p>표시 내용이 실제와 다르거나 공개 근거를 알고 있다면 Google 로그인 후 요청할 수 있습니다. 공개적으로 접근 가능한 HTTPS URL과 국가·관할, 대상 법인, 직군, 고용 형태, 적용 시점·기간을 함께 남겨주세요.</p>
        <p>개인정보, 비공개·사내 문서, 로그인해야 볼 수 있는 문서, 유료 자료는 제출하지 마세요. 승인은 검토 결정이며 공개 데이터가 즉시 변경되지 않습니다. 게시는 별도의 조사·산출물 검증과 운영자 적용을 거칩니다.</p>
        <p><BenefitsCorrectionLink /> <a className="benefits-correction-link" href="/community/benefits/my-corrections/">내 수정 요청</a></p>
      </>}
    </section>
    <section className="benefits-legacy-links" aria-labelledby="legacy-analysis-title">
      <h2 id="legacy-analysis-title">기존 분석 자료</h2>
      <p>이전 분석 화면은 기존 링크와 조회 조건을 유지합니다.</p>
      <ul>
        <li><a href={`/community/benefits/${query}`}>복지 현황</a></li>
        <li><a href={`/community/benefits/fit/${query}`}>조건 탐색</a></li>
      </ul>
    </section>
  </BenefitsExplorerShell>
}
