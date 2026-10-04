import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { AUTH_PROVIDER_DEFINITIONS, DEFAULT_AUTH_PROVIDER } from '../auth/providers'
import { AppHeader } from '../components/AppHeader'
import { AppFooter } from '../components/AppFooter'
import { ModerationActions } from '../components/ModerationActions'
import { ReportQueue } from '../components/ReportQueue'
import type { CommunityRepository } from '../data/communityRepository'
import type {
  AdminReportItem,
  AvailableReportTarget,
  ModerationAuditItem,
  ModerationAuditTargetType,
  ModerationCursor,
  ReportStatusFilter,
} from '../types/community'

interface Props { repository: CommunityRepository; currentPath: string }
type AdminState = 'checking' | 'allowed' | 'denied' | 'error'
interface AuthorizedIdentity { actorId: string; repository: CommunityRepository; currentPath: string }
interface AuditSource {
  key: string
  targetType: ModerationAuditTargetType
  targetId: string
  cursor: ModerationCursor | null
  hasMore: boolean
}
const pageSize = 50

function matchesFilter(item: AdminReportItem, filter: ReportStatusFilter) {
  return filter === 'all' || (filter === 'active' ? item.status === 'open' || item.status === 'reviewing' : item.status === filter)
}

function mergeAudit(current: ModerationAuditItem[], added: ModerationAuditItem[]) {
  const byId = new Map(current.map(item => [item.id, item]))
  for (const item of added) byId.set(item.id, item)
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
}

export function AdminReportsPage({ repository, currentPath }: Props) {
  const auth = useAuth()
  const actorId = auth.user?.id ?? null
  const identity = useRef({ actorId, repository, currentPath })
  identity.current = { actorId, repository, currentPath }
  const lifecycle = useRef(0)
  const queueGeneration = useRef(0)
  const queueMoreOperation = useRef<object | null>(null)
  const [adminState, setAdminState] = useState<AdminState>('checking')
  const [authorizedIdentity, setAuthorizedIdentity] = useState<AuthorizedIdentity | null>(null)
  const [adminError, setAdminError] = useState('')
  const [adminAttempt, setAdminAttempt] = useState(0)
  const [filter, setFilter] = useState<ReportStatusFilter>('active')
  const filterRef = useRef(filter)
  filterRef.current = filter
  const [reports, setReports] = useState<AdminReportItem[]>([])
  const reportsRef = useRef<AdminReportItem[]>([])
  reportsRef.current = reports
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const [queueLoading, setQueueLoading] = useState(false)
  const [queueMore, setQueueMore] = useState(false)
  const [queueError, setQueueError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<ModerationCursor | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [queueAttempt, setQueueAttempt] = useState(0)
  const [announcement, setAnnouncement] = useState('')
  const [audit, setAudit] = useState<ModerationAuditItem[]>([])
  const auditRef = useRef<ModerationAuditItem[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditMore, setAuditMore] = useState(false)
  const [auditError, setAuditError] = useState<string | null>(null)
  const [auditAttempt, setAuditAttempt] = useState(0)
  const [auditAnnouncement, setAuditAnnouncement] = useState('')
  const [auditSources, setAuditSources] = useState<AuditSource[]>([])
  const auditSourcesRef = useRef<AuditSource[]>([])
  const auditGeneration = useRef(0)
  const auditMoreOperation = useRef<object | null>(null)
  const auditPageSequence = useRef(0)
  const inspectorRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const generation = ++lifecycle.current
    queueGeneration.current += 1
    queueMoreOperation.current = null
    setAuthorizedIdentity(null)
    reportsRef.current = []
    setReports([]); setSelectedId(null); setAudit([]); setQueueError(null); setAuditError(null); setAnnouncement('')
    if (auth.loading || !actorId) { setAdminState('checking'); return }
    setAdminState('checking'); setAdminError('')
    void repository.isAdmin().then(result => {
      if (generation !== lifecycle.current || identity.current.actorId !== actorId || identity.current.repository !== repository || identity.current.currentPath !== currentPath) return
      if (!result.ok) { setAdminState('error'); setAdminError(result.error.message) }
      else if (result.data) {
        setAuthorizedIdentity({ actorId, repository, currentPath })
        setAdminState('allowed')
      } else setAdminState('denied')
    })
    return () => { if (lifecycle.current === generation) lifecycle.current += 1 }
  }, [actorId, adminAttempt, auth.loading, currentPath, repository])

  const isAuthorized = adminState === 'allowed'
    && authorizedIdentity?.actorId === actorId
    && authorizedIdentity.repository === repository
    && authorizedIdentity.currentPath === currentPath

  useEffect(() => {
    if (!isAuthorized || !actorId) return
    const generation = ++queueGeneration.current
    queueMoreOperation.current = null
    reportsRef.current = []
    setQueueLoading(true); setQueueMore(false); setQueueError(null); setReports([]); setSelectedId(null); setNextCursor(null); setHasMore(false); setAnnouncement('')
    void repository.listAdminReports({ status: filter, limit: pageSize }).then(result => {
      if (generation !== queueGeneration.current || identity.current.actorId !== actorId || identity.current.repository !== repository || identity.current.currentPath !== currentPath) return
      setQueueLoading(false)
      if (!result.ok) { setQueueError(result.error.message); return }
      reportsRef.current = result.data.items
      setReports(result.data.items); setNextCursor(result.data.nextCursor); setHasMore(result.data.hasMore)
      setAnnouncement(`신고 ${result.data.items.length}건을 불러왔습니다.`)
    })
    return () => { if (queueGeneration.current === generation) queueGeneration.current += 1 }
  }, [actorId, filter, isAuthorized, queueAttempt, repository])

  const reloadQueue = useCallback(() => setQueueAttempt(value => value + 1), [])
  function loadMore() {
    if (queueMoreOperation.current || !hasMore || !nextCursor) return
    const operation = {}
    const generation = queueGeneration.current
    const cursor = nextCursor
    const requestFilter = filter
    queueMoreOperation.current = operation
    setQueueMore(true); setQueueError(null)
    void repository.listAdminReports({ status: requestFilter, limit: pageSize, cursor }).then(result => {
      if (queueMoreOperation.current !== operation || generation !== queueGeneration.current || filterRef.current !== requestFilter || identity.current.actorId !== actorId || identity.current.repository !== repository || identity.current.currentPath !== currentPath) return
      queueMoreOperation.current = null
      setQueueMore(false)
      if (!result.ok) { setQueueError(result.error.message); return }
      const current = reportsRef.current
      const seen = new Set(current.map(item => item.id))
      const added = result.data.items.filter(item => !seen.has(item.id))
      const merged = [...current, ...added]
      reportsRef.current = merged
      setReports(merged)
      setAnnouncement(`신고 ${added.length}건을 더 불러와 총 ${merged.length}건입니다.`)
      setNextCursor(result.data.nextCursor); setHasMore(result.data.hasMore)
    })
  }

  const selected = reports.find(item => item.id === selectedId) ?? null
  useEffect(() => {
    if (selectedId) inspectorRef.current?.focus()
  }, [selectedId])

  useEffect(() => {
    const generation = ++auditGeneration.current
    auditMoreOperation.current = null
    if (!selected || !isAuthorized) {
      auditRef.current = []; auditSourcesRef.current = []
      setAudit([]); setAuditSources([]); setAuditError(null); setAuditLoading(false); setAuditMore(false); setAuditAnnouncement('')
      return
    }
    const targets = [
      { key: `report:${selected.id}`, targetType: 'report' as const, targetId: selected.id },
      { key: `${selected.target.type}:${selected.target.id}`, targetType: selected.target.type, targetId: selected.target.id },
    ]
    auditRef.current = []; auditSourcesRef.current = []
    auditPageSequence.current = 0
    setAudit([]); setAuditSources([]); setAuditError(null); setAuditLoading(true); setAuditMore(false); setAuditAnnouncement('')
    void Promise.all(targets.map(target => repository.listModerationAuditLogs({ targetType: target.targetType, targetId: target.targetId, limit: pageSize }))).then(results => {
      if (generation !== auditGeneration.current || identity.current.actorId !== actorId || identity.current.repository !== repository || identity.current.currentPath !== currentPath) return
      setAuditLoading(false)
      const failed = results.find(result => !result.ok)
      if (failed && !failed.ok) { setAuditError(failed.error.message); return }
      const pages = results.map(result => result.ok ? result.data : null)
      const items = mergeAudit([], pages.flatMap(page => page?.items ?? []))
      const sources = targets.map((target, index) => ({ ...target, cursor: pages[index]?.nextCursor ?? null, hasMore: pages[index]?.hasMore ?? false }))
      auditRef.current = items; auditSourcesRef.current = sources
      setAudit(items); setAuditSources(sources)
      setAuditAnnouncement(`사례 감사 기록 ${items.length}건을 불러왔습니다.`)
    })
    return () => { if (auditGeneration.current === generation) auditGeneration.current += 1 }
  }, [actorId, auditAttempt, isAuthorized, repository, selected?.id, selected?.target.id, selected?.target.type])

  function loadMoreAudit() {
    const pendingSources = auditSourcesRef.current.filter(source => source.hasMore && source.cursor)
    if (auditMoreOperation.current || pendingSources.length === 0 || !selected) return
    const operation = {}
    const generation = auditGeneration.current
    const selectedReportId = selected.id
    auditMoreOperation.current = operation
    setAuditMore(true); setAuditError(null)
    void Promise.all(pendingSources.map(source => repository.listModerationAuditLogs({
      targetType: source.targetType,
      targetId: source.targetId,
      limit: pageSize,
      cursor: source.cursor ?? undefined,
    }))).then(results => {
      if (auditMoreOperation.current !== operation || generation !== auditGeneration.current || selectedReportId !== selectedIdRef.current || identity.current.actorId !== actorId || identity.current.repository !== repository || identity.current.currentPath !== currentPath) return
      auditMoreOperation.current = null
      setAuditMore(false)
      const failed = results.find(result => !result.ok)
      if (failed && !failed.ok) { setAuditError(failed.error.message); return }
      const resultByKey = new Map(pendingSources.map((source, index) => [source.key, results[index]]))
      const sources = auditSourcesRef.current.map(source => {
        const result = resultByKey.get(source.key)
        return result?.ok ? { ...source, cursor: result.data.nextCursor, hasMore: result.data.hasMore } : source
      })
      const added = results.flatMap(result => result.ok ? result.data.items : [])
      const previousCount = auditRef.current.length
      const merged = mergeAudit(auditRef.current, added)
      const uniqueAdded = merged.length - previousCount
      const pageSequence = ++auditPageSequence.current
      auditRef.current = merged; auditSourcesRef.current = sources
      setAudit(merged); setAuditSources(sources)
      setAuditAnnouncement(`사례 감사 기록 새 기록 ${uniqueAdded}건을 더 불러와 총 ${merged.length}건입니다. 추가 요청 ${pageSequence}.`)
    })
  }

  function updateReport(updated: AdminReportItem) {
    if (identity.current.actorId !== actorId || identity.current.repository !== repository || identity.current.currentPath !== currentPath) return
    const remainsVisible = matchesFilter(updated, filter)
    const next = remainsVisible
      ? reportsRef.current.map(item => item.id === updated.id ? updated : item)
      : reportsRef.current.filter(item => item.id !== updated.id)
    reportsRef.current = next
    setReports(next)
    if (!remainsVisible && selectedId === updated.id) setSelectedId(null)
    setAuditAttempt(value => value + 1)
  }
  function updateTarget(target: AvailableReportTarget) {
    if (identity.current.actorId !== actorId || identity.current.repository !== repository || identity.current.currentPath !== currentPath) return
    const next = reportsRef.current.map(item => item.id === selectedId ? { ...item, target } : item)
    reportsRef.current = next
    setReports(next)
    setAuditAttempt(value => value + 1)
  }

  if (auth.loading) return <AdminShell><p className="admin-gate" role="status">로그인 상태를 확인하고 있습니다.</p></AdminShell>
  if (!actorId) return <AdminShell><section className="admin-gate"><p className="community-kicker">ADMIN ACCESS</p><h1>관리자 로그인이 필요합니다</h1><p>신고 기록은 인증된 운영자만 확인할 수 있습니다.</p><button type="button" disabled={auth.pending} onClick={() => void auth.signIn(DEFAULT_AUTH_PROVIDER, currentPath)}>{auth.pending ? AUTH_PROVIDER_DEFINITIONS[DEFAULT_AUTH_PROVIDER].pendingLabel : AUTH_PROVIDER_DEFINITIONS[DEFAULT_AUTH_PROVIDER].adminLoginLabel}</button></section></AdminShell>
  if (adminState === 'checking' || (adminState === 'allowed' && !isAuthorized)) return <AdminShell><p className="admin-gate" role="status">데이터베이스에서 관리자 권한을 확인하고 있습니다.</p></AdminShell>
  if (adminState === 'denied') return <AdminShell><section className="admin-gate"><p className="community-kicker">ACCESS DENIED</p><h1>접근 권한이 없습니다</h1><p>이 계정에는 신고 관리 권한이 없습니다.</p></section></AdminShell>
  if (adminState === 'error') return <AdminShell><section className="admin-gate admin-error" role="alert"><h1>권한을 확인하지 못했습니다</h1><p>{adminError}</p><button type="button" onClick={() => setAdminAttempt(value => value + 1)}>다시 시도</button></section></AdminShell>

  return <AdminShell>
    <header className="admin-title"><p className="community-kicker">EDITORIAL OPERATIONS · MODERATION</p><h1>신고 운영 데스크</h1><p>신고 판단, 콘텐츠 조치, 변경 이력을 한 자리에서 검토합니다.</p></header>
    <div className="admin-workspace">
      <ReportQueue items={reports} selectedId={selectedId} filter={filter} loading={queueLoading} loadingMore={queueMore} error={queueError} hasMore={hasMore} announcement={announcement} onSelect={setSelectedId} onFilterChange={setFilter} onRetry={reloadQueue} onLoadMore={loadMore} />
      <aside ref={inspectorRef} tabIndex={-1} className="admin-inspector" aria-label="선택한 신고 검토">
        {selected ? <>
          <ModerationActions report={selected} repository={repository} onReportUpdated={updateReport} onTargetUpdated={updateTarget} onConflictReload={reloadQueue} />
          <section className="audit-log" aria-labelledby="audit-title"><div className="admin-section-heading"><div><p>AUDIT TRAIL</p><h2 id="audit-title">사례 감사 기록</h2></div></div>
            <p className="sr-only" role="status" aria-live="polite">{auditAnnouncement}</p>
            {auditLoading ? <p role="status">감사 기록을 불러오는 중입니다.</p> : auditError ? <div role="alert" className="admin-error"><p>{auditError}</p><button type="button" onClick={() => setAuditAttempt(value => value + 1)}>감사 기록 다시 시도</button></div> : audit.length === 0 ? <p>기록된 변경 이력이 없습니다.</p> : <ol>{audit.map(item => <li key={item.id}><div><strong>{item.action}</strong><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('ko-KR')}</time></div><p>{item.actor ? `@${item.actor.login}` : '시스템'}</p>{item.reason && <p>{item.reason}</p>}<pre>{JSON.stringify(item.metadata, null, 2)}</pre></li>)}</ol>}
            {auditSources.some(source => source.hasMore) && <p className="admin-load-more"><button type="button" disabled={auditMore} onClick={loadMoreAudit}>감사 기록 더 불러오기</button></p>}
          </section>
        </> : <div className="admin-selection-empty"><p className="community-kicker">CASE FILE</p><h2>검토할 신고를 선택하세요</h2><p>왼쪽 대기열에서 한 건을 선택하면 조치와 감사 기록이 열립니다.</p></div>}
      </aside>
    </div>
  </AdminShell>
}

function AdminShell({ children }: { children: React.ReactNode }) {
  return <div className="community-page admin-reports-page"><AppHeader /><main>{children}</main><AppFooter /></div>
}
