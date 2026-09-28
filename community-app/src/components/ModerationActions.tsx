import { useEffect, useRef, useState } from 'react'
import type { CommunityRepository } from '../data/communityRepository'
import type { AdminReportItem, AvailableReportTarget, CommentModerationAction, PostModerationAction, ReportStatus } from '../types/community'

interface Props {
  report: AdminReportItem
  repository: CommunityRepository
  onReportUpdated(report: AdminReportItem): void
  onTargetUpdated(target: AvailableReportTarget): void
  onConflictReload(): void
  uuidFactory?: () => string
}

type Intent = { kind: 'report'; desired: ReportStatus; label: string } | { kind: 'post'; action: PostModerationAction; label: string; danger?: boolean } | { kind: 'comment'; action: CommentModerationAction; label: string; danger?: boolean }

function keyFor(intent: Intent) { return `${intent.kind}:${intent.kind === 'report' ? intent.desired : intent.action}` }

function stateIdentity(report: AdminReportItem) {
  if (!report.target.available) return `${report.status}:${report.target.type}:${report.target.id}:missing`
  if (report.target.type === 'post') return `${report.status}:post:${report.target.id}:${report.target.status}:${report.target.isLocked}:${report.target.isPinned}`
  return `${report.status}:comment:${report.target.id}:${report.target.status}`
}

function intents(report: AdminReportItem): Intent[] {
  const result: Intent[] = []
  if (report.status === 'open') result.push({ kind: 'report', desired: 'reviewing', label: '검토 중으로 변경' })
  if (report.status === 'open' || report.status === 'reviewing') {
    result.push({ kind: 'report', desired: 'resolved', label: '신고 해결 처리' })
    result.push({ kind: 'report', desired: 'dismissed', label: '신고 기각 처리' })
  }
  if (!report.target.available || report.target.status === 'deleted') return result
  const target = report.target
  if (target.type === 'post') {
    if (target.status === 'published') result.push({ kind: 'post', action: 'hide', label: '게시글 숨기기' })
    if (target.status === 'hidden') result.push({ kind: 'post', action: 'restore', label: '게시글 복원' })
    result.push({ kind: 'post', action: target.isLocked ? 'unlock' : 'lock', label: target.isLocked ? '게시글 잠금 해제' : '게시글 잠그기' })
    if (target.status === 'published' || target.isPinned) {
      result.push({ kind: 'post', action: target.isPinned ? 'unpin' : 'pin', label: target.isPinned ? '게시글 고정 해제' : '게시글 고정' })
    }
    result.push({ kind: 'post', action: 'delete', label: '게시글 삭제 처리', danger: true })
  } else {
    if (target.status === 'published') result.push({ kind: 'comment', action: 'hide', label: '댓글 숨기기' })
    if (target.status === 'hidden') result.push({ kind: 'comment', action: 'restore', label: '댓글 복원' })
    result.push({ kind: 'comment', action: 'delete', label: '댓글 삭제 처리', danger: true })
  }
  return result
}

export function ModerationActions({ report, repository, onReportUpdated, onTargetUpdated, onConflictReload, uuidFactory = () => crypto.randomUUID() }: Props) {
  const currentStateIdentity = stateIdentity(report)
  const currentIdentity = useRef({ reportId: report.id, targetId: report.target.id, state: currentStateIdentity, repository })
  currentIdentity.current = { reportId: report.id, targetId: report.target.id, state: currentStateIdentity, repository }
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const activeOperation = useRef<object | null>(null)
  const generation = useRef(0)
  const keys = useRef(new Map<string, string>())
  const messageRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => { if (message) messageRef.current?.focus() }, [message])
  useEffect(() => {
    generation.current += 1
    activeOperation.current = null
    keys.current.clear()
    setReason('')
    setMessage(null)
    setPending(false)
    return () => {
      generation.current += 1
      activeOperation.current = null
    }
  }, [currentStateIdentity, report.id, repository])

  async function run(intent: Intent) {
    if (activeOperation.current) return
    const cleanReason = reason.trim()
    if (!cleanReason) { setMessage({ kind: 'error', text: '처리 사유를 입력해 주세요.' }); return }
    const operation = {}
    const operationGeneration = generation.current
    const operationIdentity = currentIdentity.current
    activeOperation.current = operation
    setPending(true)
    setMessage(null)
    const targetState = report.target.available ? `${report.target.status}:${report.target.isLocked}:${report.target.isPinned}` : 'missing'
    const intentIdentity = `${report.id}:${report.target.id}:${keyFor(intent)}:${report.status}:${targetState}:${cleanReason}`
    const idempotencyKey = keys.current.get(intentIdentity) ?? uuidFactory()
    keys.current.set(intentIdentity, idempotencyKey)
    let result
    let applySuccess: (() => void) | null = null
    if (intent.kind === 'report') {
      const response = await repository.setReportStatus({ reportId: report.id, expectedStatus: report.status, desiredStatus: intent.desired, reason: cleanReason, idempotencyKey })
      result = response
      if (response.ok) applySuccess = () => onReportUpdated(response.data)
    } else if (intent.kind === 'post' && report.target.available && report.target.type === 'post') {
      const target = report.target
      const response = await repository.moderatePost({ postId: target.id, expectedStatus: target.status, expectedLocked: target.isLocked, expectedPinned: target.isPinned, action: intent.action, reason: cleanReason, idempotencyKey })
      result = response
      if (response.ok) applySuccess = () => onTargetUpdated({ ...target, status: response.data.status, isLocked: response.data.isLocked, isPinned: response.data.isPinned })
    } else if (intent.kind === 'comment' && report.target.available && report.target.type === 'comment') {
      const target = report.target
      const response = await repository.moderateComment({ commentId: target.id, expectedStatus: target.status, action: intent.action, reason: cleanReason, idempotencyKey })
      result = response
      if (response.ok) applySuccess = () => onTargetUpdated({ ...target, status: response.data.status })
    } else {
      result = { ok: false as const, error: { code: 'conflict' as const, sourceCode: 'STALE_TARGET', message: '대상 상태가 변경되었습니다.' } }
    }

    if (generation.current !== operationGeneration || activeOperation.current !== operation
      || currentIdentity.current.reportId !== operationIdentity.reportId
      || currentIdentity.current.targetId !== operationIdentity.targetId
      || currentIdentity.current.state !== operationIdentity.state
      || currentIdentity.current.repository !== operationIdentity.repository) return
    if (result.ok) {
      applySuccess?.()
      keys.current.delete(intentIdentity)
      setMessage({ kind: 'success', text: '관리 작업이 반영되었습니다.' })
    } else if (result.error.code === 'conflict') {
      setMessage({ kind: 'error', text: '상태가 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.' })
      onConflictReload()
    } else setMessage({ kind: 'error', text: result.error.message })
    activeOperation.current = null
    setPending(false)
  }

  const availableIntents = intents(report)
  const reportIntents = availableIntents.filter(intent => intent.kind === 'report')
  const contentIntents = availableIntents.filter(intent => intent.kind !== 'report')
  return <section className="moderation-actions" aria-labelledby="moderation-actions-title">
    <div className="admin-section-heading"><div><p>DECISION</p><h2 id="moderation-actions-title">조치 기록</h2></div></div>
    <label htmlFor="moderation-reason">처리 사유</label>
    <textarea id="moderation-reason" value={reason} onChange={event => setReason(event.target.value)} disabled={pending} placeholder="판단 근거를 기록해 주세요." />
    {message && <p ref={messageRef} tabIndex={-1} role={message.kind === 'error' ? 'alert' : 'status'} className={`moderation-message ${message.kind}`}>{message.text}</p>}
    {reportIntents.length > 0 && <div className="moderation-action-group" aria-label="신고 상태 조치">
      <h3>신고 상태</h3>{reportIntents.map(intent => <button key={keyFor(intent)} type="button" disabled={pending} onClick={() => void run(intent)}>{intent.label}</button>)}
    </div>}
    {report.target.available ? <div className="moderation-action-group" aria-label="콘텐츠 조치"><h3>콘텐츠 조치</h3>{contentIntents.length ? contentIntents.map(intent => <button key={keyFor(intent)} type="button" className={intent.danger ? 'destructive' : ''} disabled={pending} onClick={() => void run(intent)}>{intent.label}</button>) : <p>삭제된 콘텐츠에는 추가 조치를 할 수 없습니다.</p>}</div> : <p className="dangling-note">삭제되어 원문을 확인할 수 없어 콘텐츠 조치를 제공하지 않습니다.</p>}
  </section>
}
