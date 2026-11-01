import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { DEFAULT_AUTH_PROVIDER } from '../auth/providers'
import { AppFooter } from '../components/AppFooter'
import { AppHeader } from '../components/AppHeader'
import { getBenefitCorrectionRepository, type BenefitCorrectionRepository } from '../data/benefitCorrectionRepository'
import { categoryLabels } from '../types/benefits'
import type { BenefitCorrectionCursor, BenefitCorrectionError, BenefitCorrectionItem } from '../types/benefitCorrections'

const statusLabels = { submitted: '접수됨', reviewing: '검토 중', approved: '승인됨', rejected: '반려됨', applied: '반영 완료' } as const
const listPath = '/community/benefits/my-corrections/'
const rejectedListError: BenefitCorrectionError = { code: 'unknown', message: '요청 내역을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }

function date(value: string) { return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) }
function appendUnique(current: BenefitCorrectionItem[], incoming: BenefitCorrectionItem[]) {
  const ids = new Set(current.map(item => item.id))
  const appended: BenefitCorrectionItem[] = []
  for (const item of incoming) {
    if (ids.has(item.id)) continue
    ids.add(item.id)
    appended.push(item)
  }
  return [...current, ...appended]
}

export function MyBenefitCorrectionsPage({ repository = getBenefitCorrectionRepository(), currentPath = `${window.location.pathname}${window.location.search}` }: { repository?: BenefitCorrectionRepository; currentPath?: string }) {
  const auth = useAuth()
  const [items, setItems] = useState<BenefitCorrectionItem[] | null>(null)
  const [error, setError] = useState<BenefitCorrectionError | null>(null)
  const [cursor, setCursor] = useState<BenefitCorrectionCursor | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const lifecycle = useRef(0)
  const pageController = useRef<AbortController | null>(null)

  useEffect(() => {
    pageController.current?.abort()
    const generation = ++lifecycle.current
    setError(null); setItems(null); setCursor(null); setHasMore(false); setLoadingMore(false)
    if (!auth.user) return
    const controller = new AbortController()
    pageController.current = controller
    void (async () => {
      try {
        const result = await repository.listMyRequests({ limit: 50 }, controller.signal)
        if (generation !== lifecycle.current || controller.signal.aborted) return
        if (!result.ok) { setError(result.error); return }
        setItems(result.data.items)
        setHasMore(result.data.hasMore)
        setCursor(result.data.nextCursor)
      } catch {
        if (generation === lifecycle.current && !controller.signal.aborted) setError(rejectedListError)
      }
    })()
    return () => {
      controller.abort()
      if (pageController.current === controller) pageController.current = null
      lifecycle.current += 1
    }
  }, [auth.user?.id, attempt, repository])

  async function loadMore() {
    if (!auth.user || !items || !hasMore || !cursor || loadingMore) return
    pageController.current?.abort()
    const controller = new AbortController()
    pageController.current = controller
    const generation = lifecycle.current
    setError(null); setLoadingMore(true)
    try {
      const result = await repository.listMyRequests({ limit: 50, cursor }, controller.signal)
      if (generation !== lifecycle.current || controller.signal.aborted || pageController.current !== controller) return
      if (!result.ok) { setError(result.error); return }
      setItems(current => appendUnique(current ?? [], result.data.items))
      setHasMore(result.data.hasMore)
      setCursor(result.data.nextCursor)
    } catch {
      if (generation === lifecycle.current && !controller.signal.aborted && pageController.current === controller) setError(rejectedListError)
    } finally {
      if (generation === lifecycle.current && pageController.current === controller) {
        pageController.current = null
        setLoadingMore(false)
      }
    }
  }

  if (auth.loading) return <Shell><p role="status">로그인 상태를 확인하고 있습니다.</p></Shell>
  const loginReturnPath = currentPath === listPath ? currentPath : listPath
  if (!auth.user) return <Shell><section><h1>내 수정 요청</h1><p>본인이 제출한 요청만 확인할 수 있습니다.</p><button type="button" onClick={() => void auth.signIn(DEFAULT_AUTH_PROVIDER, loginReturnPath)}>Google로 로그인</button></section></Shell>
  const retry = error && (error.code === 'auth_required'
    ? <button type="button" onClick={() => void auth.signIn(DEFAULT_AUTH_PROVIDER, loginReturnPath)}>다시 로그인</button>
    : <button type="button" onClick={() => items === null ? setAttempt(value => value + 1) : void loadMore()}>다시 시도</button>)
  return <Shell><section className="benefit-corrections-list"><h1>내 수정 요청</h1>
    {error && <div role="alert"><p>{error.message}</p>{retry}</div>}
    {items === null ? !error && <p role="status">요청 내역을 불러오고 있습니다.</p> : items.length === 0 ? <p>아직 제출한 수정 요청이 없습니다.</p> : items.map(item => <article key={item.id} className="benefit-correction-card"><header><strong>{item.companyId}</strong><span>{statusLabels[item.status]}</span></header><dl><dt>분야</dt><dd>{categoryLabels[item.categoryId]}</dd><dt>제안</dt><dd>{item.proposedText}</dd><dt>제출</dt><dd>{date(item.createdAt)}</dd><dt>최근 변경</dt><dd>{date(item.updatedAt)}</dd>{item.adminResponse && <><dt>관리자 답변</dt><dd>{item.adminResponse}</dd></>}{item.appliedDataVersion && <><dt>반영 데이터 버전</dt><dd><code>{item.appliedDataVersion}</code></dd></>}</dl></article>)}
    {items !== null && hasMore && !error && <button type="button" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? '불러오는 중…' : '더 보기'}</button>}
  </section></Shell>
}
function Shell({ children }: { children: React.ReactNode }) { return <div className="community-page benefits-page"><AppHeader /><main className="benefits-workspace benefit-correction-workspace">{children}</main><AppFooter /></div> }
