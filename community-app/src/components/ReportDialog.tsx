import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { CommunityRepository } from '../data/communityRepository'
import type { ReportReasonCode, ReportTargetType } from '../types/community'

export interface ReportDialogProps {
  repository: Pick<CommunityRepository, 'createReport'>
  targetType: ReportTargetType
  targetId: string
  targetLabel: string
  actorId: string | null
  currentPath: string
  authLoading: boolean
  authPending: boolean
  onLogin(): void
  uuidFactory?: () => string
}

const reasons: Array<{ value: ReportReasonCode; label: string }> = [
  { value: 'spam', label: '스팸' },
  { value: 'harassment', label: '괴롭힘' },
  { value: 'harmful', label: '유해한 콘텐츠' },
  { value: 'other', label: '기타' },
]

export function ReportDialog({
  repository,
  targetType,
  targetId,
  targetLabel,
  actorId,
  currentPath,
  authLoading,
  authPending,
  onLogin,
  uuidFactory = () => crypto.randomUUID(),
}: ReportDialogProps) {
  const identityRef = useRef({ actorId, currentPath, repository, targetId, targetType })
  identityRef.current = { actorId, currentPath, repository, targetId, targetType }
  const targetName = targetType === 'post' ? '게시글' : '댓글'
  const titleId = useId()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const reasonSelectRef = useRef<HTMLSelectElement>(null)
  const successRef = useRef<HTMLDivElement>(null)
  const generationRef = useRef(0)
  const activeOperationRef = useRef<object | null>(null)
  const idempotencyKeysRef = useRef(new Map<string, string>())
  const openRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [reasonCode, setReasonCode] = useState<ReportReasonCode>('spam')
  const [detail, setDetail] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    const restoreFocus = openRef.current
    generationRef.current += 1
    activeOperationRef.current = null
    idempotencyKeysRef.current.clear()
    openRef.current = false
    setOpen(false)
    setReasonCode('spam')
    setDetail('')
    setPending(false)
    setError(null)
    setSuccess(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [actorId, currentPath, repository, targetId, targetType])

  useEffect(() => {
    if (open && !success) reasonSelectRef.current?.focus()
    if (success) successRef.current?.focus()
  }, [open, success])

  function resetIntent() {
    generationRef.current += 1
    activeOperationRef.current = null
    idempotencyKeysRef.current.clear()
    setReasonCode('spam')
    setDetail('')
    setPending(false)
    setError(null)
    setSuccess(false)
  }

  function openDialog(event: React.MouseEvent<HTMLButtonElement>) {
    if (!actorId) {
      onLogin()
      return
    }
    triggerRef.current = event.currentTarget
    resetIntent()
    openRef.current = true
    setOpen(true)
  }

  function closeDialog() {
    if (pending) return
    resetIntent()
    openRef.current = false
    setOpen(false)
    triggerRef.current?.focus()
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeDialog()
      return
    }
    if (event.key !== 'Tab') return

    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'),
    )
    if (focusable.length === 0) {
      event.preventDefault()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (successRef.current && document.activeElement === successRef.current) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!actorId || activeOperationRef.current) return
    if (reasonCode === 'other' && !detail.trim()) {
      setError('기타 사유는 상세 내용을 입력해 주세요.')
      return
    }

    const normalizedDetail = detail.trim() || null
    const payloadIdentity = JSON.stringify([targetType, targetId, reasonCode, normalizedDetail])
    const operation = {}
    const generation = generationRef.current
    const operationIdentity = identityRef.current
    const idempotencyKey = idempotencyKeysRef.current.get(payloadIdentity) ?? uuidFactory()
    idempotencyKeysRef.current.set(payloadIdentity, idempotencyKey)
    activeOperationRef.current = operation
    setPending(true)
    setError(null)

    const result = await repository.createReport({
      targetType,
      targetId,
      reasonCode,
      detail: normalizedDetail,
      idempotencyKey,
    })

    if (generation !== generationRef.current || activeOperationRef.current !== operation
      || identityRef.current.actorId !== operationIdentity.actorId
      || identityRef.current.currentPath !== operationIdentity.currentPath
      || identityRef.current.repository !== operationIdentity.repository
      || identityRef.current.targetId !== operationIdentity.targetId
      || identityRef.current.targetType !== operationIdentity.targetType) return
    activeOperationRef.current = null
    setPending(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    idempotencyKeysRef.current.delete(payloadIdentity)
    setSuccess(true)
  }

  return (
    <>
      <button
        type="button"
        className="report-trigger"
        disabled={authLoading || authPending}
        onClick={openDialog}
      >
        {actorId ? `${targetName} 신고하기` : `로그인하고 ${targetName} 신고하기`}
      </button>
      {open && (
        <div className="report-dialog-backdrop">
          <section className="report-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={handleDialogKeyDown}>
            <h2 id={titleId}>{targetName} 신고</h2>
            {success ? (
              <div
                ref={successRef}
                className="report-success"
                role="status"
                aria-live="polite"
                aria-label="신고 접수 완료"
                tabIndex={-1}
              >
                <p>신고가 접수되었습니다.</p>
                <button type="button" onClick={closeDialog}>닫기</button>
              </div>
            ) : (
              <form className="report-form" onSubmit={submit}>
                <p>{targetLabel}</p>
                <label>
                  신고 사유
                  <select ref={reasonSelectRef} value={reasonCode} onChange={(event) => setReasonCode(event.target.value as ReportReasonCode)} disabled={pending}>
                    {reasons.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
                  </select>
                </label>
                <label>
                  상세 내용 (선택)
                  <textarea maxLength={2000} value={detail} onChange={(event) => setDetail(event.target.value)} disabled={pending} />
                </label>
                {error && <p role="alert">{error}</p>}
                <div>
                  <button type="button" onClick={closeDialog} disabled={pending}>취소</button>
                  <button type="submit" disabled={pending} aria-busy={pending}>신고 제출</button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
    </>
  )
}
