import { useId, useRef, useState } from 'react'
import { validateCommentBody } from '../lib/commentValidation'

export interface CommentSubmitIntent { bodyMarkdown: string; idempotencyKey: string }
interface Props { onSubmit(intent: CommentSubmitIntent): Promise<boolean>; disabled?: boolean; label?: string; submitLabel?: string; onCancel?: () => void }

export function CommentComposer({ onSubmit, disabled = false, label = '댓글 내용', submitLabel = '댓글 작성', onCancel }: Props) {
  const id = useId()
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const submitting = useRef(false)
  const intent = useRef<{ body: string; key: string } | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (disabled || submitting.current) return
    const validated = validateCommentBody(body)
    if (!validated.valid) { setError(validated.message); return }
    const current = intent.current?.body === body ? intent.current : { body, key: crypto.randomUUID() }
    intent.current = current
    submitting.current = true; setPending(true); setError(null)
    try {
      if (await onSubmit({ bodyMarkdown: validated.body, idempotencyKey: current.key })) {
        setBody(''); intent.current = null
      }
    } finally { submitting.current = false; setPending(false) }
  }

  return <form className="comment-composer" onSubmit={submit} noValidate>
    <label htmlFor={`${id}-body`}>{label}</label>
    <textarea id={`${id}-body`} value={body} disabled={disabled || pending} maxLength={5001}
      aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`} aria-invalid={Boolean(error)}
      onChange={(event) => { setBody(event.target.value); setError(null); if (intent.current?.body !== event.target.value) intent.current = null }} />
    <p id={`${id}-help`} className="comment-help">공백을 제외하고 1~5000자</p>
    {error && <p id={`${id}-error`} className="comment-error" role="alert">{error}</p>}
    <div className="comment-composer-actions">
      {onCancel && <button type="button" className="secondary-action" onClick={onCancel} disabled={pending}>답글 취소</button>}
      <button type="submit" className="primary-action" disabled={disabled || pending}>{pending ? '등록 중' : submitLabel}</button>
    </div>
  </form>
}
