import { lazy, Suspense, useEffect, useState } from 'react'
import { benefitsClient } from '../data/benefitsArtifactClient'
import { categories, categoryLabels, type Category, type CompanyListing, type Manifest } from '../types/benefits'
import { filterBenefitsCompanies, parseQuery, serializeQuery, type QueryState } from '../lib/benefitsQueryState'
import { BenefitsExplorerShell } from '../components/benefits/BenefitsExplorerShell'
import { BenefitsFilterPanel } from '../components/benefits/BenefitsFilterPanel'
import { BenefitsHeatmapTable } from '../components/benefits/BenefitsHeatmapTable'
import { CompanyCompareTray } from '../components/benefits/CompanyCompareTray'
import { useBenefitsDetails } from '../lib/useBenefitsDetails'
const CompanyPage = lazy(() => import('./BenefitsCompanyPage').then((module) => ({ default: module.BenefitsCompanyPage })))
const FitPage = lazy(() => import('./BenefitsFitPage').then((module) => ({ default: module.BenefitsFitPage })))

export type ExplorerData = { manifest: Manifest; listings: CompanyListing[] }
export type ExplorerViewProps = ExplorerData & { state: QueryState; update: (patch: Partial<QueryState>) => void; companies: CompanyListing[]; link: (id: string, category?: Category) => string }

export function BenefitsExplorerPage({ route, search }: { route: string; search: string }) {
  const [data, setData] = useState<ExplorerData>(); const [error, setError] = useState(false); const [attempt, setAttempt] = useState(0); const [raw, setRaw] = useState(search)
  useEffect(() => { let active = true; const controller = new AbortController(); benefitsClient.loadManifest(controller.signal).then(async (manifest) => ({ manifest, listings: await benefitsClient.loadListingChunks(manifest, controller.signal) })).then((loaded) => { if (active) setData(loaded) }).catch(() => { if (active) setError(true) }); return () => { active = false; controller.abort() } }, [attempt])
  useEffect(() => { const listener = () => setRaw(window.location.search); window.addEventListener('popstate', listener); return () => window.removeEventListener('popstate', listener) }, [])
  const state = parseQuery(raw, data?.listings.map((company) => company.company_id) ?? [])
  const companies = data ? filterBenefitsCompanies(data.listings, state) : []
  const pages = Math.max(1, Math.ceil(companies.length / 50)); if (state.page > pages) { state.page = pages; state.notice = true }
  const requestedId = raw.length <= 8000 ? new URLSearchParams(raw).get('id') ?? '' : ''
  const query = serializeQuery(state); const detailQuery = route === 'company' && data?.listings.some((company) => company.company_id === requestedId) ? `&id=${encodeURIComponent(requestedId)}` : ''
  useEffect(() => { if (!data) return; const normalized = query + detailQuery; if (window.location.search !== normalized) window.history.replaceState({}, '', window.location.pathname + normalized + window.location.hash) }, [data, query, detailQuery])
  const update = (patch: Partial<QueryState>) => { const next = serializeQuery({ ...state, ...patch }) + (route === 'company' ? `&id=${encodeURIComponent(requestedId)}` : ''); window.history.pushState({}, '', window.location.pathname + next); setRaw(next) }
  const link = (id: string, category?: Category) => `/community/benefits/company/${query}&id=${encodeURIComponent(id)}${category ? `#${category}` : ''}`
  const compared = data ? state.compare.map((id) => data.listings.find((company) => company.company_id === id)).filter((company): company is CompanyListing => Boolean(company)) : []
  const comparison = useBenefitsDetails(data?.manifest, data?.listings, compared.map((company) => company.company_id))
  let body
  if (error) body = <section role="alert"><h2>복지 데이터를 사용할 수 없습니다</h2><p>승인된 manifest가 없거나 artifact 무결성 검증에 실패했습니다. 이전 자료나 예시 자료로 대체하지 않습니다.</p><button onClick={() => { setError(false); setAttempt((value) => value + 1) }}>다시 시도</button></section>
  else if (!data) body = <p role="status">승인된 복지 데이터를 확인하고 있습니다.</p>
  else {
    const props = { ...data, state, update, companies, link }
    body = <>{state.notice && <p role="status">잘못된 URL 조건을 안전한 값으로 정리했습니다.</p>}<div className="benefits-layout"><BenefitsFilterPanel state={state} update={update} companies={data.listings} /><section className="benefits-results">{route === 'heatmap' ? <><h2>복지 현황 <small>{companies.length}개 기업</small></h2><p>근거 부족은 복지가 없다는 뜻이 아닙니다.</p><BenefitsHeatmapTable companies={companies.slice((state.page - 1) * 50, state.page * 50)} selectedCategories={state.categories} compare={state.compare} toggle={(id) => update({ compare: state.compare.includes(id) ? state.compare.filter((value) => value !== id) : [...state.compare, id].slice(0, 4) })} link={link} /><Pagination page={state.page} pages={pages} update={update} /></> : <Suspense fallback={<p role="status">화면을 준비하고 있습니다.</p>}>{route === 'fit' ? <FitPage {...props} /> : <CompanyPage id={requestedId} {...props} />}</Suspense>}<CompanyCompareTray companies={compared} details={comparison.data} error={comparison.error} retry={comparison.retry} remove={(id) => update({ compare: state.compare.filter((value) => value !== id) })} /></section><aside className="benefits-summary"><h2>근거를 읽는 방법</h2><p>확인됨, 범위 제한 확인, 근거 부족을 구분합니다.</p>{categories.map((category) => <a key={category} href={`/community/benefits/${serializeQuery({ ...state, categories: [category], page: 1 })}`}>{categoryLabels[category]} →</a>)}</aside></div></>
  }
  return <BenefitsExplorerShell route={route} query={query} manifest={data?.manifest}>{body}</BenefitsExplorerShell>
}
function Pagination({ page, pages, update }: { page: number; pages: number; update: (patch: Partial<QueryState>) => void }) { return <nav aria-label="기업 페이지" className="benefits-pagination"><button disabled={page === 1} onClick={() => update({ page: page - 1 })}>이전 페이지</button><span>{page} / {pages} · 페이지당 최대 50개</span><button disabled={page >= pages} onClick={() => update({ page: page + 1 })}>다음 페이지</button></nav> }
