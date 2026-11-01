import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { AUTH_PROVIDER_DEFINITIONS, DEFAULT_AUTH_PROVIDER } from '../auth/providers'
import { AppFooter } from '../components/AppFooter'
import { AppHeader } from '../components/AppHeader'
import { BenefitCorrectionQueue } from '../components/BenefitCorrectionQueue'
import { CommunityActions } from '../components/CommunityActions'
import type { BenefitCorrectionRepository } from '../data/benefitCorrectionRepository'
import type { CommunityRepository } from '../data/communityRepository'
import type { AdminBenefitCorrectionItem, BenefitCorrectionAuditCursor, BenefitCorrectionAuditEvent, BenefitCorrectionQueueFilter, BenefitCorrectionReviewAction } from '../types/benefitCorrections'

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
  const auditGeneration = useRef(0)
  const queueController = useRef<AbortController | null>(null)
  const moreController = useRef<AbortController | null>(null)
  const auditController = useRef<AbortController | null>(null)
  const auditMoreController = useRef<AbortController | null>(null)
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
  const selectedIdRef = useRef(selectedId); selectedIdRef.current = selectedId
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
  const [auditEvents, setAuditEvents] = useState<BenefitCorrectionAuditEvent[]>([])
  const auditEventsRef = useRef(auditEvents); auditEventsRef.current = auditEvents
  const [auditRequestId, setAuditRequestId] = useState<string | null>(null)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditLoadingMore, setAuditLoadingMore] = useState(false)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [auditHasMore, setAuditHasMore] = useState(false)
  const [auditCursor, setAuditCursor] = useState<BenefitCorrectionAuditCursor | null>(null)
  const [auditAttempt, setAuditAttempt] = useState(0)
  const inspectorRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const generation = ++authorizationGeneration.current
    setAuthorizedActor(null); setAdminState('checking'); setAdminError('')
    queueController.current?.abort(); moreController.current?.abort(); auditController.current?.abort(); auditMoreController.current?.abort(); reviewController.current?.abort()
    queueController.current = null; moreController.current = null; auditController.current = null; auditMoreController.current = null; reviewController.current = null; reviewOperation.current = null; reviewKey.current = null
    setItems([]); setSelectedId(null); setAuditEvents([]); setAuditRequestId(null)
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

  useEffect(() => () => { queueController.current?.abort(); moreController.current?.abort(); auditController.current?.abort(); auditMoreController.current?.abort(); reviewController.current?.abort() }, [])

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

  useEffect(() => {
    auditController.current?.abort(); auditMoreController.current?.abort()
    auditController.current = null; auditMoreController.current = null
    const generation = ++auditGeneration.current
    setAuditEvents([]); setAuditRequestId(null); setAuditLoadingMore(false); setAuditError(null); setAuditHasMore(false); setAuditCursor(null)
    if (!selectedId || !authorized || !actorId) { setAuditLoading(false); return }
    const controller = new AbortController(); auditController.current = controller
    setAuditLoading(true)
    void correctionRepository.listAdminAudit({ requestId: selectedId, limit: pageSize }, controller.signal).then(result => {
      if (controller.signal.aborted || generation !== auditGeneration.current || selectedIdRef.current !== selectedId
        || identity.current.actorId !== actorId || identity.current.correctionRepository !== correctionRepository) return
      auditController.current = null; setAuditLoading(false); setAuditRequestId(selectedId)
      if (!result.ok) { setAuditError(result.error.message); return }
      auditEventsRef.current = result.data.items
      setAuditEvents(result.data.items); setAuditHasMore(result.data.hasMore); setAuditCursor(result.data.nextCursor)
    })
    return () => { controller.abort(); if (auditGeneration.current === generation) auditGeneration.current += 1 }
  }, [actorId, auditAttempt, authorized, correctionRepository, selectedId])

  function loadMoreAudit() {
    if (!selectedId || auditMoreController.current || !auditHasMore || !auditCursor || !actorId) return
    const controller = new AbortController(); auditMoreController.current = controller
    const generation = auditGeneration.current; const requestId = selectedId; const cursor = auditCursor
    setAuditLoadingMore(true); setAuditError(null)
    void correctionRepository.listAdminAudit({ requestId, limit: pageSize, cursor }, controller.signal).then(result => {
      if (controller.signal.aborted || auditMoreController.current !== controller || generation !== auditGeneration.current
        || selectedIdRef.current !== requestId || identity.current.actorId !== actorId || identity.current.correctionRepository !== correctionRepository) return
      auditMoreController.current = null; setAuditLoadingMore(false)
      if (!result.ok) { setAuditError(result.error.message); return }
      const seen = new Set(auditEventsRef.current.map(event => event.sequence))
      const merged = [...auditEventsRef.current, ...result.data.items.filter(event => !seen.has(event.sequence))]
      auditEventsRef.current = merged; setAuditEvents(merged); setAuditHasMore(result.data.hasMore); setAuditCursor(result.data.nextCursor)
    })
  }

  function refreshAudit() {
    setAuditRequestId(null); setAuditLoading(true); setAuditAttempt(value => value + 1)
  }

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
      applyAuthoritativeItem(result.data); setAdminResponse(''); setReviewMessage('검토 결과가 저장되었습니다.'); refreshAudit()
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
        {selected ? <CorrectionDetail item={selected} response={adminResponse} reviewing={reviewing} error={reviewError} message={reviewMessage}
          auditEvents={auditRequestId === selected.id ? auditEvents : []} auditLoading={auditRequestId !== selected.id || auditLoading} auditLoadingMore={auditLoadingMore}
          auditError={auditRequestId === selected.id ? auditError : null} auditHasMore={auditRequestId === selected.id && auditHasMore}
          onResponse={setAdminResponse} onReview={submitReview} onAuditRetry={refreshAudit} onAuditLoadMore={loadMoreAudit} />
          : <div className="admin-selection-empty"><p className="community-kicker">CORRECTION FILE</p><h2>검토할 정정 요청을 선택하세요</h2><p>왼쪽 대기열에서 한 건을 선택하면 제출 내용과 허용된 검토 조치가 열립니다.</p></div>}
      </aside>
    </div>
  </AdminShell>
}

interface CorrectionDetailProps {
  item: AdminBenefitCorrectionItem
  response: string
  reviewing: boolean
  error: string | null
  message: string
  auditEvents: BenefitCorrectionAuditEvent[]
  auditLoading: boolean
  auditLoadingMore: boolean
  auditError: string | null
  auditHasMore: boolean
  onResponse(value: string): void
  onReview(action: BenefitCorrectionReviewAction): void
  onAuditRetry(): void
  onAuditLoadMore(): void
}

function CorrectionDetail({ item, response, reviewing, error, message, auditEvents, auditLoading, auditLoadingMore, auditError, auditHasMore, onResponse, onReview, onAuditRetry, onAuditLoadMore }: CorrectionDetailProps) {
  return <section className="correction-detail" aria-labelledby="correction-detail-title">
    <div className="admin-section-heading"><div><p>REVIEW FILE</p><h2 id="correction-detail-title">정정 요청 상세</h2></div><span>{item.status}</span></div>
    <dl>
      <div><dt>회사</dt><dd>{item.companyId}</dd></div><div><dt>카테고리</dt><dd>{item.categoryId}</dd></div>
      <div><dt>현재 내용</dt><dd>{item.currentText}</dd></div><div><dt>제안 내용</dt><dd>{item.proposedText}</dd></div>
      <div><dt>적용 범위</dt><dd>{item.scopeText}</dd></div><div><dt>관찰 데이터 버전</dt><dd>{item.observedDataVersion}</dd></div>
      <div><dt>근거</dt><dd><a href={item.sourceUrl} target="_blank" rel="noreferrer">근거 자료 열기</a><span className="evidence-url">{item.sourceUrl}</span></dd></div>
      <div><dt>감사 상태</dt><dd>{item.status === 'approved' ? '승인됨 · 데이터 적용 대기' : item.status === 'applied' ? '서버에서 적용 완료로 확인됨' : item.status === 'rejected' ? '반려됨' : item.status === 'reviewing' ? '검토 중' : '접수됨'}</dd></div>
      {item.adminResponse && <div><dt>최근 관리자 응답</dt><dd>{item.adminResponse}</dd></div>}
      {item.reviewedAt && <div><dt>최근 검토 시각</dt><dd><time dateTime={item.reviewedAt}>{new Date(item.reviewedAt).toLocaleString('ko-KR')}</time></dd></div>}
      {item.appliedDataVersion && <div><dt>적용 버전</dt><dd>{item.appliedDataVersion}</dd></div>}
      {item.appliedAt && <div><dt>적용 시각</dt><dd><time dateTime={item.appliedAt}>{new Date(item.appliedAt).toLocaleString('ko-KR')}</time></dd></div>}
    </dl>
    {(item.status === 'submitted' || item.status === 'reviewing') && <div className="correction-review-controls">
      <label htmlFor="correction-admin-response">관리자 응답</label>
      <textarea id="correction-admin-response" maxLength={2000} value={response} disabled={reviewing} onChange={event => onResponse(event.target.value)} />
      {error && <p className="moderation-message error" role="alert">{error}</p>}{message && <p className="moderation-message" role="status">{message}</p>}
      <div className="moderation-action-group">{item.status === 'submitted'
        ? <button type="button" disabled={reviewing} onClick={() => onReview('start_review')}>검토 시작</button>
        : <><button type="button" disabled={reviewing} onClick={() => onReview('request_additional_material')}>추가 자료 요청</button><button type="button" disabled={reviewing} onClick={() => onReview('approve')}>승인</button><button type="button" className="destructive" disabled={reviewing} onClick={() => onReview('reject')}>반려</button></>}</div>
    </div>}
    <AuditTimeline events={auditEvents} loading={auditLoading} loadingMore={auditLoadingMore} error={auditError} hasMore={auditHasMore} onRetry={onAuditRetry} onLoadMore={onAuditLoadMore} />
  </section>
}

const auditLabels: Record<BenefitCorrectionAuditEvent['eventType'], string> = {
  submitted: '정정 요청 접수',
  start_review: '검토 시작',
  additional_material_requested: '추가 자료 요청',
  approved: '정정 승인',
  rejected: '정정 반려',
  applied: '데이터 적용 완료',
}

function AuditTimeline({ events, loading, loadingMore, error, hasMore, onRetry, onLoadMore }: {
  events: BenefitCorrectionAuditEvent[]
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasMore: boolean
  onRetry(): void
  onLoadMore(): void
}) {
  return <section className="correction-audit" aria-labelledby="correction-audit-title">
    <div className="admin-section-heading"><div><p>APPEND-ONLY AUDIT</p><h2 id="correction-audit-title">검토 감사 이력</h2></div><span>{events.length}건</span></div>
    {loading ? <p className="audit-state" role="status">감사 이력을 불러오는 중입니다.</p>
      : error ? <div className="audit-state admin-error" role="alert"><p>{error}</p><button type="button" onClick={onRetry}>감사 이력 다시 시도</button></div>
        : events.length === 0 ? <p className="audit-state">기록된 감사 이벤트가 없습니다.</p>
          : <ol className="correction-audit-list" aria-label="검토 감사 타임라인">{events.map(event => <li key={event.sequence}>
            <div><strong>{auditLabels[event.eventType]}</strong><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString('ko-KR')}</time></div>
            <p>{event.fromStatus === null ? event.toStatus : `${event.fromStatus} → ${event.toStatus}`}</p>
            {event.adminResponse && <blockquote>{event.adminResponse}</blockquote>}
            {event.appliedVersion && <p><strong>적용 버전</strong> {event.appliedVersion}</p>}
          </li>)}</ol>}
    {!loading && !error && hasMore && <div className="admin-load-more"><button type="button" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? '감사 이력을 불러오는 중…' : '감사 이력 더 불러오기'}</button></div>}
  </section>
}

function AdminShell({ children }: { children: React.ReactNode }) {
  return <div className="community-page admin-reports-page admin-benefit-corrections-page"><AppHeader /><CommunityActions /><main>{children}</main><AppFooter /></div>
}
