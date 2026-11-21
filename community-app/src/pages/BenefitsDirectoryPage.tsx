import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BenefitsExplorerShell } from '../components/benefits/BenefitsExplorerShell'
import { getBenefitDirectoryRepository, type BenefitDirectoryRepository } from '../data/benefitDirectoryRepository'
import {
  canonicalizeBenefitDirectoryQuery,
  parseBenefitDirectoryQuery,
  serializeBenefitDirectoryQuery,
  type BenefitDirectoryQueryState,
} from '../lib/benefitDirectoryQueryState'
import {
  BENEFIT_DIRECTORY_CATEGORIES,
  BENEFIT_DIRECTORY_SIZE_CLASSES,
  type BenefitDirectoryCategory,
  type BenefitDirectoryPage,
  type BenefitDirectorySearchInput,
  type BenefitDirectorySearchItem,
} from '../types/benefitDirectory'

const PAGE_SIZE = 50
const categoryLabels: Record<BenefitDirectoryCategory, string> = {
  leave: '휴가', family: '가족', health: '건강', growth: '성장', housing: '주거', commute: '통근',
  remote: '원격근무', retirement: '퇴직', meals: '식사', inclusion: '포용',
}
const sizeLabels: Record<(typeof BENEFIT_DIRECTORY_SIZE_CLASSES)[number], string> = {
  large: '대기업', medium: '중견기업', small: '중소기업', large_affiliate: '대규모기업집단 소속', unclassified: '분류 미확인',
}

type VisibleResults = BenefitDirectoryPage & { queryKey: string; repository: BenefitDirectoryRepository; sourceId: number }
type SearchPhase = 'loading' | 'ready' | 'refreshing' | 'error'

function searchInput(state: BenefitDirectoryQueryState, cursor: string | null): BenefitDirectorySearchInput {
  return {
    query: state.q.trim() || null,
    categories: state.categories.length ? state.categories : null,
    industry: state.industry.trim() || null,
    size: state.size,
    region: null,
    hasBenefitsOnly: state.hasBenefitsOnly,
    pageSize: PAGE_SIZE,
    cursor,
  }
}
function historyUrl(query: string) {
  return `${window.location.pathname}${query}${window.location.hash}`
}
function detailLink(companyId: string) {
  return `/benefits/company/?id=${encodeURIComponent(companyId)}`
}
function mergeItems(current: BenefitDirectorySearchItem[], next: BenefitDirectorySearchItem[]) {
  const seen = new Set(current.map(item => item.companyId))
  return [...current, ...next.filter(item => !seen.has(item.companyId))]
}

function DirectoryCard({ item }: { item: BenefitDirectorySearchItem }) {
  const facts = [item.industry, item.sizeLabel, item.region].filter(Boolean).join(' · ')
  return <article className="domestic-directory__record">
    <p className="domestic-directory__identity">{item.identityLabel}</p>
    <h3><a href={detailLink(item.companyId)}>{item.displayName} <span aria-hidden="true">↗</span></a></h3>
    <p className="domestic-directory__size">{facts}</p>
    {item.summary && <p>{item.summary}</p>}
    {item.benefitCount === 0
      ? <p className="domestic-directory__status" role="status">게시 가능한 공개 복지 근거 미확인</p>
      : <p className="domestic-directory__counts">복지 {item.benefitCount}건 · 공식 확인 {item.officialCount}건 · 사용자 제보 {item.communityCount}건</p>}
    {item.categories.length > 0 && <ul className="domestic-directory__badges" aria-label="복지 범주">
      {item.categories.map(category => <li key={category}>{categoryLabels[category]}</li>)}
    </ul>}
  </article>
}

export function BenefitsDirectoryPage({
  search,
  repository = getBenefitDirectoryRepository(),
  debounceMs = 300,
}: {
  search: string
  repository?: BenefitDirectoryRepository
  debounceMs?: number
}) {
  const initial = useMemo(() => parseBenefitDirectoryQuery(search), [search])
  const [draft, setDraft] = useState(initial)
  const [applied, setApplied] = useState(initial)
  const [visible, setVisible] = useState<VisibleResults>()
  const [phase, setPhase] = useState<SearchPhase>('loading')
  const [phaseSourceId, setPhaseSourceId] = useState(0)
  const [refreshError, setRefreshError] = useState<string>()
  const [nextError, setNextError] = useState<string>()
  const [nextLoading, setNextLoading] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [retry, setRetry] = useState(0)
  const generation = useRef(0)
  const source = useRef({ repository, id: 0 })
  if (source.current.repository !== repository) source.current = { repository, id: source.current.id + 1 }
  const sourceId = source.current.id
  const searchController = useRef<AbortController | undefined>(undefined)
  const nextController = useRef<AbortController | undefined>(undefined)
  const queryKey = serializeBenefitDirectoryQuery(applied)

  const applyTextDraft = useCallback((nextDraft: BenefitDirectoryQueryState) => {
    const next = canonicalizeBenefitDirectoryQuery(nextDraft)
    const nextQuery = serializeBenefitDirectoryQuery(next)
    if (nextQuery === serializeBenefitDirectoryQuery(applied)) return
    window.history.replaceState({}, '', historyUrl(nextQuery))
    setApplied(next)
  }, [applied])

  useEffect(() => {
    const next = canonicalizeBenefitDirectoryQuery(draft)
    if (next.q === applied.q && next.industry === applied.industry) return
    const timer = window.setTimeout(() => {
      applyTextDraft(draft)
    }, debounceMs)
    return () => window.clearTimeout(timer)
  }, [applied.industry, applied.q, applyTextDraft, debounceMs, draft])

  useEffect(() => {
    const restore = () => {
      const restored = parseBenefitDirectoryQuery(window.location.search)
      setDraft(restored)
      setApplied(restored)
    }
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [])

  useEffect(() => () => {
    searchController.current?.abort()
    nextController.current?.abort()
  }, [])

  useEffect(() => {
    const currentGeneration = generation.current + 1
    generation.current = currentGeneration
    const currentSourceId = sourceId
    searchController.current?.abort()
    nextController.current?.abort()
    const controller = new AbortController()
    searchController.current = controller
    setNextLoading(false)
    setNextError(undefined)
    setRefreshError(undefined)
    setPhaseSourceId(currentSourceId)
    setPhase(visible?.repository === repository ? 'refreshing' : 'loading')
    void repository.search(searchInput(applied, null), controller.signal).then(result => {
      if (controller.signal.aborted || generation.current !== currentGeneration || source.current.id !== currentSourceId) return
      if (!result.ok) {
        if (result.error.code === 'aborted') return
        setRefreshError(result.error.message)
        setPhase('error')
        return
      }
      setVisible({ ...result.data, queryKey, repository, sourceId: currentSourceId })
      setPhase('ready')
    })
    return () => controller.abort()
  }, [applied, queryKey, repository, retry, sourceId])

  const updateDiscrete = useCallback((patch: Partial<BenefitDirectoryQueryState>) => {
    const next = canonicalizeBenefitDirectoryQuery({ ...draft, ...patch })
    window.history.pushState({}, '', historyUrl(serializeBenefitDirectoryQuery(next)))
    setDraft(current => ({ ...next, q: current.q, industry: current.industry }))
    setApplied(next)
  }, [draft])

  const toggleCategory = (category: BenefitDirectoryCategory) => {
    const categories = draft.categories.includes(category)
      ? draft.categories.filter(value => value !== category)
      : [...draft.categories, category]
    updateDiscrete({ categories })
  }

  const loadNext = useCallback(() => {
    if (!visible?.hasMore || !visible.nextCursor || visible.queryKey !== queryKey || visible.sourceId !== sourceId || nextLoading) return
    nextController.current?.abort()
    const controller = new AbortController()
    nextController.current = controller
    const currentGeneration = generation.current
    const cursor = visible.nextCursor
    setNextLoading(true)
    setNextError(undefined)
    void repository.search(searchInput(applied, cursor), controller.signal).then(result => {
      if (controller.signal.aborted || generation.current !== currentGeneration || source.current.id !== sourceId) return
      setNextLoading(false)
      if (!result.ok) {
        if (result.error.code !== 'aborted') setNextError(result.error.message)
        return
      }
      setVisible(current => current && current.queryKey === queryKey && current.sourceId === sourceId ? {
        ...result.data,
        items: mergeItems(current.items, result.data.items),
        queryKey,
        repository,
        sourceId,
      } : current)
    })
  }, [applied, nextLoading, queryKey, repository, sourceId, visible])

  const activeVisible = visible?.sourceId === sourceId && visible.repository === repository ? visible : undefined
  const activePhase = phaseSourceId === sourceId ? phase : 'loading'
  const currentResults = activeVisible?.queryKey === queryKey
  const staleResults = Boolean(activeVisible && !currentResults)

  return <BenefitsExplorerShell route="directory" query="">
    <section className="domestic-directory" aria-label="국내 기업 복지 검색">
      <div className="domestic-directory__search">
        <label>기업명 검색
          <input type="search" value={draft.q} maxLength={200} placeholder="기업명을 입력하세요" onChange={event => setDraft(current => ({ ...current, q: event.target.value.slice(0, 200) }))} onBlur={() => { applyTextDraft(draft); setDraft(current => ({ ...current, q: canonicalizeBenefitDirectoryQuery(current).q })) }} />
        </label>
      </div>
      <div className="domestic-directory__filters">
        <fieldset><legend>복지 범주</legend><div className="domestic-directory__chips">
          {BENEFIT_DIRECTORY_CATEGORIES.map(category => <label key={category} className={draft.categories.includes(category) ? 'is-selected' : ''}>
            <input type="checkbox" checked={draft.categories.includes(category)} onChange={() => toggleCategory(category)} /> {categoryLabels[category]}
          </label>)}
        </div></fieldset>
        <label className="domestic-directory__check"><input type="checkbox" checked={draft.hasBenefitsOnly} onChange={event => updateDiscrete({ hasBenefitsOnly: event.target.checked })} /> 복지 정보 있는 기업만</label>
        <details className="domestic-directory__filter-details" role="group" aria-label="세부 필터" open={filtersOpen} onToggle={event => setFiltersOpen(event.currentTarget.open)}>
          <summary>{filtersOpen ? '세부 필터 접기' : '세부 필터 다시 열기'}</summary>
          <div className="domestic-directory__filter-fields">
            <label>업종<input value={draft.industry} maxLength={100} onChange={event => setDraft(current => ({ ...current, industry: event.target.value.slice(0, 100) }))} onBlur={() => { applyTextDraft(draft); setDraft(current => ({ ...current, industry: canonicalizeBenefitDirectoryQuery(current).industry })) }} /></label>
            <label>기업 규모<select value={draft.size ?? ''} onChange={event => updateDiscrete({ size: event.target.value ? event.target.value as BenefitDirectoryQueryState['size'] : null })}>
              <option value="">전체 규모</option>{BENEFIT_DIRECTORY_SIZE_CLASSES.map(size => <option key={size} value={size}>{sizeLabels[size]}</option>)}
            </select></label>
            <label>정렬<select value={draft.sort} onChange={event => updateDiscrete({ sort: event.target.value as BenefitDirectoryQueryState['sort'] })}><option value="name_asc">기업명순</option></select></label>
          </div>
        </details>
      </div>

      <div className="domestic-directory__results-status" role="status" aria-live="polite" aria-atomic="true">
        {activePhase === 'loading' && <p>기업을 검색하고 있습니다.</p>}
        {activePhase === 'refreshing' && <p>새 조건으로 검색하고 있습니다. 이전 결과를 잠시 표시합니다.</p>}
        {activeVisible && <p className="domestic-directory__count">{staleResults ? '표시 중인 이전 검색 결과' : '검색 결과'} <strong>{activeVisible.total.toLocaleString('ko-KR')}</strong>개 기업</p>}
        {nextLoading && <p>검색 결과를 더 불러오고 있습니다.</p>}
      </div>

      {activePhase === 'error' && <div className="domestic-directory__error" role="alert"><p>{refreshError}</p><button type="button" onClick={() => setRetry(value => value + 1)}>다시 시도</button></div>}
      {currentResults && activePhase === 'ready' && activeVisible.items.length === 0 && <p role="status" className="domestic-directory__empty">조건에 맞는 기업을 찾지 못했습니다</p>}
      {activeVisible && activeVisible.items.length > 0 && <section className="domestic-directory__result-section" aria-labelledby="directory-results-heading">
        <h2 id="directory-results-heading">기업 검색 결과 목록</h2>
        <div className="domestic-directory__list">{activeVisible.items.map(item => <DirectoryCard key={item.companyId} item={item} />)}</div>
      </section>}

      {phaseSourceId === sourceId && nextError && <div className="domestic-directory__error" role="alert"><p>{nextError}</p><button type="button" onClick={loadNext}>다시 시도</button></div>}
      {currentResults && activePhase === 'ready' && activeVisible.hasMore && <div className="domestic-directory__pagination">
        <button type="button" disabled={nextLoading} onClick={loadNext}>{nextLoading ? '불러오는 중…' : '더 불러오기'}</button>
      </div>}
    </section>
  </BenefitsExplorerShell>
}
