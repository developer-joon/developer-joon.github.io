import { lazy, Suspense, useEffect, useState } from 'react'
import { benefitsClient } from '../data/benefitsArtifactClient'
import type {
  Category,
  Company,
  CompanyIndex,
  Manifest,
} from '../types/benefits'
import { categories, categoryLabels } from '../types/benefits'
import {
  parseQuery,
  filterBenefitsCompanies,
  serializeQuery,
  type QueryState,
} from '../lib/benefitsQueryState'
import { BenefitsExplorerShell } from '../components/benefits/BenefitsExplorerShell'
import { BenefitsFilterPanel } from '../components/benefits/BenefitsFilterPanel'
import { BenefitsHeatmapTable } from '../components/benefits/BenefitsHeatmapTable'
import { CategoryRankingSummary } from '../components/benefits/CategoryRankingSummary'
import { CompanyCompareTray } from '../components/benefits/CompanyCompareTray'
import { useBenefitsDetails } from '../lib/useBenefitsDetails'
const RankingsPage = lazy(() =>
  import('./BenefitsRankingsPage').then((m) => ({
    default: m.BenefitsRankingsPage,
  })),
)
const CompanyPage = lazy(() =>
  import('./BenefitsCompanyPage').then((m) => ({
    default: m.BenefitsCompanyPage,
  })),
)
const FitPage = lazy(() =>
  import('./BenefitsFitPage').then((m) => ({ default: m.BenefitsFitPage })),
)
export type ExplorerData = { manifest: Manifest; index: CompanyIndex }
export type ExplorerViewProps = ExplorerData & {
  state: QueryState
  update: (patch: Partial<QueryState>) => void
  companies: Company[]
  link: (id: string, category?: Category) => string
}
export function BenefitsExplorerPage({
  route,
  search,
}: {
  route: string
  search: string
}) {
  const [data, setData] = useState<ExplorerData>()
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [raw, setRaw] = useState(search)
  useEffect(() => {
    let active = true
    benefitsClient
      .loadManifest()
      .then(async (manifest) => ({
        manifest,
        index: await benefitsClient.loadCompanyIndex(manifest),
      }))
      .then((d) => {
        if (active) setData(d)
      })
      .catch(() => {
        if (active) setError(true)
      })
    return () => {
      active = false
    }
  }, [attempt])
  useEffect(() => {
    const listener = () => setRaw(window.location.search)
    window.addEventListener('popstate', listener)
    return () => window.removeEventListener('popstate', listener)
  }, [])
  const state = parseQuery(
    raw,
    data?.index.companies.map((c) => c.company_id) ?? [],
  )
  const companies = data
    ? filterBenefitsCompanies(data.index.companies, state)
    : []
  const comparedCompanies = data
    ? data.index.companies.filter((company) =>
        state.compare.includes(company.company_id),
      )
    : []
  const comparison = useBenefitsDetails(
    data?.manifest,
    data?.index,
    comparedCompanies.map((company) => company.company_id),
  )
  const pages = Math.max(1, Math.ceil(companies.length / 50))
  if (data && route === 'heatmap' && state.page > pages) {
    state.page = pages
    state.notice = true
  }
  const requestedId =
    raw.length <= 8000 ? (new URLSearchParams(raw).get('id') ?? '') : ''
  const query = serializeQuery(state)
  const detailQuery =
    route === 'company' &&
    data?.index.companies.some((c) => c.company_id === requestedId)
      ? '&id=' + encodeURIComponent(requestedId)
      : ''
  useEffect(() => {
    if (!data) return
    const normalized = query + detailQuery
    if (window.location.search !== normalized)
      window.history.replaceState(
        {},
        '',
        window.location.pathname + normalized + window.location.hash,
      )
  }, [data, query, detailQuery])
  const update = (patch: Partial<QueryState>) => {
    const next =
      serializeQuery({ ...state, ...patch }) +
      (route === 'company'
        ? '&id=' + encodeURIComponent(new URLSearchParams(raw).get('id') ?? '')
        : '')
    window.history.pushState({}, '', window.location.pathname + next)
    setRaw(next)
  }
  const link = (id: string, category?: Category) =>
    `/community/benefits/company/${query}&id=${encodeURIComponent(id)}${category ? '#' + category : ''}`
  let body
  if (error)
    body = (
      <section role="alert">
        <h2>데이터를 불러올 수 없습니다</h2>
        <p>
          무결성 또는 연결 오류입니다. 다른 버전의 데이터를 섞어 표시하지
          않습니다.
        </p>
        <button
          onClick={() => {
            setError(false)
            setAttempt((a) => a + 1)
          }}
        >
          다시 시도
        </button>
        <a href="/community/benefits/methodology/">조사 기준 확인</a>
      </section>
    )
  else if (!data) body = <p role="status">예시 데이터를 불러오고 있습니다.</p>
  else {
    const page = Math.min(state.page, pages)
    const props = { ...data, state, update, companies, link }
    body = (
      <>
        {state.notice && (
          <p role="status">잘못된 URL 조건을 안전한 값으로 정리했습니다.</p>
        )}
        <div className="benefits-layout">
          <BenefitsFilterPanel
            state={state}
            update={update}
            companies={data.index.companies}
          />
          <section className="benefits-results">
            <p className="benefits-muted">
              확인 불가는 복지가 없다는 뜻이 아닙니다.
            </p>
            {route === 'heatmap' ? (
              <>
                <h2>
                  복지 히트맵 <small>{companies.length}개 기업</small>
                </h2>
                {!companies.length ? (
                  <div>
                    <p>검색 결과가 없습니다</p>
                    <p>{activeFilterSummary(state)}</p>
                  </div>
                ) : (
                  <BenefitsHeatmapTable
                    companies={companies.slice((page - 1) * 50, page * 50)}
                    selectedCategories={state.categories}
                    compare={state.compare}
                    toggle={(id) =>
                      update({
                        compare: state.compare.includes(id)
                          ? state.compare.filter((v) => v !== id)
                          : [...state.compare, id].slice(0, 4),
                      })
                    }
                    link={link}
                  />
                )}
                <nav aria-label="기업 페이지" className="benefits-pagination">
                  <button
                    disabled={page === 1}
                    onClick={() => update({ page: page - 1 })}
                  >
                    이전 페이지
                  </button>
                  <span>
                    {page} / {pages} · 페이지당 최대 50개
                  </span>
                  <button
                    disabled={page >= pages}
                    onClick={() => update({ page: page + 1 })}
                  >
                    다음 페이지
                  </button>
                </nav>
              </>
            ) : (
              <RouteView
                route={route}
                id={
                  raw.length <= 8000
                    ? (new URLSearchParams(raw).get('id') ?? '')
                    : ''
                }
                {...props}
              />
            )}
            <CompanyCompareTray
              companies={comparedCompanies}
              details={comparison.data}
              error={comparison.error}
              retry={comparison.retry}
              remove={(id) =>
                update({ compare: state.compare.filter((v) => v !== id) })
              }
            />
          </section>
          <aside className="benefits-summary">
            {route === 'heatmap' && <CategoryRankingSummary {...props} />}
            <h2>근거를 읽는 방법</h2>
            <p>색과 함께 상태 문자열을 확인하세요.</p>
            <p>범위 제한·상충·과거 자료를 구분합니다.</p>
            <h3>분야 탐색</h3>
            {categories.map((c) => (
              <a
                key={c}
                href={`/community/benefits/rankings/${serializeQuery({ ...state, categories: [c], page: 1 })}`}
              >
                {categoryLabels[c]} →
              </a>
            ))}
          </aside>
        </div>
      </>
    )
  }
  return (
    <BenefitsExplorerShell
      route={route}
      query={query}
      manifest={data?.manifest}
    >
      {body}
    </BenefitsExplorerShell>
  )
}

function activeFilterSummary(state: QueryState) {
  const filters = [
    state.q && `검색어 “${state.q}”`,
    state.scope !== 'all' &&
      `범위 ${state.scope === 'domestic' ? '국내' : '해외'}`,
    state.industry && `업종 ${state.industry}`,
    state.country && `국가 ${state.country}`,
    state.scale && `규모 ${state.scale}`,
    state.categories.length &&
      `분야 ${state.categories.map((category) => categoryLabels[category]).join(', ')}`,
    state.statuses.length && `상태 ${state.statuses.join(', ')}`,
  ].filter(Boolean)
  return `적용 중인 필터: ${filters.join(' · ') || '없음'}`
}

function RouteView({
  route,
  id,
  ...props
}: ExplorerViewProps & { route: string; id: string }) {
  return (
    <Suspense fallback={<p role="status">화면을 준비하고 있습니다.</p>}>
      {route === 'rankings' ? (
        <RankingsPage {...props} />
      ) : route === 'fit' ? (
        <FitPage {...props} />
      ) : (
        <CompanyPage key={id} id={id} {...props} />
      )}
    </Suspense>
  )
}
