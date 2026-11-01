import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { AUTH_PROVIDER_DEFINITIONS, DEFAULT_AUTH_PROVIDER } from '../auth/providers'
import { AppFooter } from '../components/AppFooter'
import { AppHeader } from '../components/AppHeader'
import { BenefitCorrectionQueue } from '../components/BenefitCorrectionQueue'
import { CommunityActions } from '../components/CommunityActions'
import type { BenefitCorrectionRepository } from '../data/benefitCorrectionRepository'
import type { CommunityRepository } from '../data/communityRepository'
import type { AdminBenefitCorrectionItem, BenefitCorrectionQueueFilter, BenefitCorrectionReviewAction } from '../types/benefitCorrections'

interface Props {
  authorizationRepository: CommunityRepository
  correctionRepository: BenefitCorrectionRepository
  currentPath: string
}
type AdminState = 'checking' | 'allowed' | 'denied' | 'error'
const pageSize = 50

function remainsInFilter(item: AdminBenefitCorrectionItem, filter: BenefitCorrectionQueueFilter) {
  return filter === 'all' || (filter === 'active' ? item.status === 'submitted' || item.status === 'reviewing' : item.status === filter)
}

function uniqueItems(items: AdminBenefitCorrectionItem[]) {
  const seen = new Set<string>()
  return items.filter(item => !seen.has(item.id) && Boolean(seen.add(item.id)))
}

export function AdminBenefitCorrectionsPage({ authorizationRepository, correctionRepository, currentPath }: Props) {
  const auth = useAuth()
  const actorId = auth.user?.id ?? null
  const identity = useRef({ actorId, authorizationRepository, correctionRepository, currentPath })
  identity.current = { actorId, authorizationRepository, correctionRepository, currentPath }
  const authorizationGeneration = useRef(0)
  const queueGeneration = useRef(0)
  const queueController = useRef<AbortController | null>(null)
  const moreController = useRef<AbortController | null>(null)
  const reviewController = useRef<AbortController | null>(null)
  const reviewOperation = useRef<object | null>(null)
  const reviewKey = useRef<{ signature: string; value: string } | null>(null)
  const [adminState, setAdminState] = useState<AdminState>('checking')
  const [authorizedActor, setAuthorizedActor] = useState<string | null>(null)
  const [adminError, setAdminError] = useState('')
  const [adminAttempt, setAdminAttempt] = useState(0)
  const [filter, setFilter] = useState<BenefitCorrectionQueueFilter>('active')
  const filterRef = useRef(filter); filterRef.current = filter
  const [items, setItems] = useState<AdminBenefitCorrectionItem[]>([])
  const itemsRef = useRef(items); itemsRef.current = items
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [queueError, setQueueError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<{ createdAt: string; id: string } | null>(null)
  const [queueAttempt, setQueueAttempt] = useState(0)
  const [announcement, setAnnouncement] = useState('')
  const [adminResponse, setAdminResponse] = useState('')
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [reviewMessage, setReviewMessage] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const inspectorRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const generation = ++authorizationGeneration.current
    setAuthorizedActor(null); setAdminState('checking'); setAdminError('')
    queueController.current?.abort(); moreController.current?.abort(); reviewController.current?.abort()
    queueController.current = null; moreController.current = null; reviewController.current = null; reviewOperation.current = null; reviewKey.current = null
    setItems([]); setSelectedId(null)
    if (auth.loading || !actorId) return
    void authorizationRepository.isAdmin().then(result => {
      if (generation !== authorizationGeneration.current || identity.current.actorId !== actorId || identity.current.authorizationRepository !== authorizationRepository || identity.current.currentPath !== currentPath) return
      if (!result.ok) { setAdminState('error'); setAdminError(result.error.message) }
      else if (!result.data) setAdminState('denied')
      else { setAuthorizedActor(actorId); setAdminState('allowed') }
    })
    return () => { if (authorizationGeneration.current === generation) authorizationGeneration.current += 1 }
  }, [actorId, adminAttempt, auth.loading, authorizationRepository, correctionRepository, currentPath])

  const authorized = adminState === 'allowed' && authorizedActor === actorId

  useEffect(() => {
    if (!authorized || !actorId) return
    const generation = ++queueGeneration.current
    queueController.current?.abort(); moreController.current?.abort()
    moreController.current = null
    const controller = new AbortController(); queueController.current = controller
    setLoading(true); setLoadingMore(false); setQueueError(null); setItems([]); setSelectedId(null); setHasMore(false); setNextCursor(null); setAnnouncement('')
    void correctionRepository.listAdminQueue({ status: filter, limit: pageSize }, controller.signal).then(result => {
      if (controller.signal.aborted || generation !== queueGeneration.current || identity.current.actorId !== actorId || identity.current.correctionRepository !== correctionRepository || filterRef.current !== filter) return
      setLoading(false)
      if (!result.ok) { setQueueError(result.error.message); return }
      const unique = uniqueItems(result.data.items)
      itemsRef.current = unique
      setItems(unique); setHasMore(result.data.hasMore); setNextCursor(result.data.nextCursor)
      setAnnouncement(`정정 요청 ${unique.length}건을 불러왔습니다.`)
    })
    return () => { controller.abort(); if (queueGeneration.current === generation) queueGeneration.current += 1 }
  }, [actorId, authorized, correctionRepository, filter, queueAttempt])

  useEffect(() => () => { queueController.current?.abort(); moreController.current?.abort(); reviewController.current?.abort() }, [])

  const reloadQueue = useCallback(() => setQueueAttempt(value => value + 1), [])
  function loadMoreItems() {
    if (moreController.current || !hasMore || !nextCursor || !actorId) return
    const controller = new AbortController(); moreController.current = controller
    const generation = queueGeneration.current; const requestedFilter = filter; const cursor = nextCursor
    setLoadingMore(true); setQueueError(null)
    void correctionRepository.listAdminQueue({ status: requestedFilter, limit: pageSize, cursor }, controller.signal).then(result => {
      if (controller.signal.aborted || moreController.current !== controller || generation !== queueGeneration.current || filterRef.current !== requestedFilter || identity.current.actorId !== actorId) return
      moreController.current = null; setLoadingMore(false)
      if (!result.ok) { setQueueError(result.error.message); return }
      const seen = new Set(itemsRef.current.map(item => item.id))
      const added = result.data.items.filter(item => !seen.has(item.id))
      const merged = [...itemsRef.current, ...added]
      itemsRef.current = merged; setItems(merged); setHasMore(result.data.hasMore); setNextCursor(result.data.nextCursor)
      setAnnouncement(`정정 요청 ${added.length}건을 더 불러와 총 ${merged.length}건입니다.`)
    })
  }

  const selected = items.find(item => item.id === selectedId) ?? null
  useEffect(() => {
    if (!selectedId) return
    setAdminResponse(''); setReviewError(null); setReviewMessage('')
    inspectorRef.current?.focus()
  }, [selectedId])

  function applyAuthoritativeItem(updated: AdminBenefitCorrectionItem) {
    const next = remainsInFilter(updated, filterRef.current)
      ? itemsRef.current.map(item => item.id === updated.id ? updated : item)
      : itemsRef.current.filter(item => item.id !== updated.id)
    itemsRef.current = next; setItems(next)
    if (!remainsInFilter(updated, filterRef.current)) setSelectedId(null)
  }

  function submitReview(action: BenefitCorrectionReviewAction) {
    if (!selected || reviewOperation.current || (selected.status !== 'submitted' && selected.status !== 'reviewing')) return
    const response = adminResponse.trim()
    if (response.length === 0 || Array.from(response).length > 2000) { setReviewError('관리자 응답은 1자 이상 2,000자 이하로 입력해 주세요.'); return }
    const expectedStatus = selected.status
    const signature = JSON.stringify([selected.id, expectedStatus, action, response])
    if (reviewKey.current?.signature !== signature) reviewKey.current = { signature, value: crypto.randomUUID() }
    const operation = {}; const controller = new AbortController()
    reviewOperation.current = operation; reviewController.current = controller
    setReviewing(true); setReviewError(null); setReviewMessage('')
    void correctionRepository.reviewRequest({ requestId: selected.id, expectedStatus, action, adminResponse: response, clientKey: reviewKey.current.value }, controller.signal).then(result => {
      if (controller.signal.aborted || reviewOperation.current !== operation || identity.current.actorId !== actorId || identity.current.correctionRepository !== correctionRepository) return
      reviewOperation.current = null; reviewController.current = null; setReviewing(false)
      if (!result.ok) {
        setReviewError(result.error.message)
        if (result.error.code === 'conflict' || result.error.code === 'stale_response') { reviewKey.current = null; reloadQueue() }
        return
      }
      reviewKey.current = null
      applyAuthoritativeItem(result.data); setAdminResponse(''); setReviewMessage('검토 결과가 저장되었습니다.')
    })
  }

  if (auth.loading) return <AdminShell><p className="admin-gate" role="status">로그인 상태를 확인하고 있습니다.</p></AdminShell>
  if (!actorId) return <AdminShell><section className="admin-gate"><p className="community-kicker">ADMIN ACCESS</p><h1>관리자 로그인이 필요합니다</h1><p>복지 정정 요청은 인증된 운영자만 확인할 수 있습니다.</p><button type="button" disabled={auth.pending} onClick={() => void auth.signIn(DEFAULT_AUTH_PROVIDER, currentPath)}>{auth.pending ? AUTH_PROVIDER_DEFINITIONS[DEFAULT_AUTH_PROVIDER].pendingLabel : AUTH_PROVIDER_DEFINITIONS[DEFAULT_AUTH_PROVIDER].adminLoginLabel}</button></section></AdminShell>
  if (adminState === 'checking' || !authorized) {
    if (adminState === 'denied') return <AdminShell><section className="admin-gate"><p className="community-kicker">ACCESS DENIED</p><h1>접근 권한이 없습니다</h1><p>이 계정에는 복지 정정 검토 권한이 없습니다.</p></section></AdminShell>
    if (adminState === 'error') return <AdminShell><section className="admin-gate admin-error" role="alert"><h1>권한을 확인하지 못했습니다</h1><p>{adminError}</p><button type="button" onClick={() => setAdminAttempt(value => value + 1)}>다시 시도</button></section></AdminShell>
    return <AdminShell><p className="admin-gate" role="status">데이터베이스에서 관리자 권한을 확인하고 있습니다.</p></AdminShell>
  }

  return <AdminShell>
    <header className="admin-title"><p className="community-kicker">BENEFIT DATA · CORRECTION REVIEW</p><h1>복지 정정 검토 데스크</h1><p>제출 근거를 검토하고 상태만 기록합니다. 승인은 데이터 적용을 뜻하지 않습니다.</p></header>
    <nav className="admin-local-nav" aria-label="관리자 도구"><a href="/community/admin/reports/">신고 관리</a><a href="/community/admin/benefit-corrections/" aria-current="page">복지 정정</a></nav>
    {reviewError && !selected && <p className="admin-operation-error" role="alert">{reviewError}</p>}
    <div className="admin-workspace">
      <BenefitCorrectionQueue items={items} selectedId={selectedId} filter={filter} loading={loading} loadingMore={loadingMore} error={queueError} hasMore={hasMore} announcement={announcement} onSelect={setSelectedId} onFilterChange={setFilter} onRetry={reloadQueue} onLoadMore={loadMoreItems} />
      <aside ref={inspectorRef} tabIndex={-1} className="admin-inspector correction-inspector" aria-label="선택한 복지 정정 검토">
        {selected ? <CorrectionDetail item={selected} response={adminResponse} reviewing={reviewing} error={reviewError} message={reviewMessage} onResponse={setAdminResponse} onReview={submitReview} />
          : <div className="admin-selection-empty"><p className="community-kicker">CORRECTION FILE</p><h2>검토할 정정 요청을 선택하세요</h2><p>왼쪽 대기열에서 한 건을 선택하면 제출 내용과 허용된 검토 조치가 열립니다.</p></div>}
      </aside>
    </div>
  </AdminShell>
}

function CorrectionDetail({ item, response, reviewing, error, message, onResponse, onReview }: { item: AdminBenefitCorrectionItem; response: string; reviewing: boolean; error: string | null; message: string; onResponse(value: string): void; onReview(action: BenefitCorrectionReviewAction): void }) {
  return <section className="correction-detail" aria-labelledby="correction-detail-title">
    <div className="admin-section-heading"><div><p>REVIEW FILE</p><h2 id="correction-detail-title">정정 요청 상세</h2></div><span>{item.status}</span></div>
    <dl>
      <div><dt>회사</dt><dd>{item.companyId}</dd></div><div><dt>카테고리</dt><dd>{item.categoryId}</dd></div>
      <div><dt>현재 내용</dt><dd>{item.currentText}</dd></div><div><dt>제안 내용</dt><dd>{item.proposedText}</dd></div>
      <div><dt>적용 범위</dt><dd>{item.scopeText}</dd></div><div><dt>관찰 데이터 버전</dt><dd>{item.observedDataVersion}</dd></div>
      <div><dt>근거</dt><dd><a href={item.sourceUrl} target="_blank" rel="noreferrer">근거 자료 열기</a><span className="evidence-url">{item.sourceUrl}</span></dd></div>
      <div><dt>감사 상태</dt><dd>{item.status === 'approved' ? '승인됨 · 데이터 적용 대기' : item.status === 'applied' ? '서버에서 적용 완료로 확인됨' : item.status === 'rejected' ? '반려됨' : item.status === 'reviewing' ? '검토 중' : '접수됨'}</dd></div>
      {item.adminResponse && <div><dt>최근 관리자 응답</dt><dd>{item.adminResponse}</dd></div>}
      {item.appliedDataVersion && <div><dt>적용 버전</dt><dd>{item.appliedDataVersion}</dd></div>}
    </dl>
    {(item.status === 'submitted' || item.status === 'reviewing') && <div className="correction-review-controls">
      <label htmlFor="correction-admin-response">관리자 응답</label>
      <textarea id="correction-admin-response" maxLength={2000} value={response} disabled={reviewing} onChange={event => onResponse(event.target.value)} />
      {error && <p className="moderation-message error" role="alert">{error}</p>}{message && <p className="moderation-message" role="status">{message}</p>}
      <div className="moderation-action-group">{item.status === 'submitted'
        ? <button type="button" disabled={reviewing} onClick={() => onReview('start_review')}>검토 시작</button>
        : <><button type="button" disabled={reviewing} onClick={() => onReview('request_additional_material')}>추가 자료 요청</button><button type="button" disabled={reviewing} onClick={() => onReview('approve')}>승인</button><button type="button" className="destructive" disabled={reviewing} onClick={() => onReview('reject')}>반려</button></>}</div>
    </div>}
  </section>
}

function AdminShell({ children }: { children: React.ReactNode }) {
  return <div className="community-page admin-reports-page admin-benefit-corrections-page"><AppHeader /><CommunityActions /><main>{children}</main><AppFooter /></div>
}
