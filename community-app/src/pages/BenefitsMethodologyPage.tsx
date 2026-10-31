import { useEffect, useState } from 'react'
import { BenefitsExplorerShell } from '../components/benefits/BenefitsExplorerShell'
import { benefitsClient } from '../data/benefitsArtifactClient'
import { parseQuery, serializeQuery } from '../lib/benefitsQueryState'
import type { Manifest } from '../types/benefits'

export function BenefitsMethodologyPage({ search = window.location.search }: { search?: string }) {
  const query = serializeQuery(parseQuery(search)); const [manifest, setManifest] = useState<Manifest>(); const [method, setMethod] = useState<{ title: string; paragraphs: string[] }>(); const [error, setError] = useState(false)
  useEffect(() => { const controller = new AbortController(); benefitsClient.loadManifest(controller.signal).then(async (loaded) => { const methodology = await benefitsClient.loadMethodology(loaded, controller.signal); setManifest(loaded); setMethod(methodology) }).catch(() => setError(true)); return () => controller.abort() }, [])
  return <BenefitsExplorerShell route="methodology" query={query} manifest={manifest}><section className="benefits-evidence">{error ? <div role="alert"><h2>조사 기준을 사용할 수 없습니다</h2><p>승인된 manifest와 방법론 artifact를 확인할 수 없습니다.</p></div> : !method ? <p role="status">조사 기준을 확인하고 있습니다.</p> : <><h2>{method.title}</h2>{method.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}<h3 id="corrections">정정 제보</h3><p>Community 댓글·신고 기능으로 제보하면 원장 검증 후 다음 버전에 반영합니다. 비공개 문서나 개인정보를 게시하지 마세요.</p></>}</section></BenefitsExplorerShell>
}
