import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { CommunityTag } from '../types/community'
import { validatePostInput, type PostErrors, type PostInput } from '../lib/validation'
import { MarkdownPreview } from './MarkdownPreview'
import { TagSelector } from './TagSelector'

interface PostEditorProps {
  initialValue: PostInput
  tags: CommunityTag[]
  submitLabel: string
  onSubmit(value: PostInput): Promise<void> | void
  onChange?(value: PostInput): void
  unavailableTagLabels?: string[]
  allowedImageOrigin?: string
  submissionError?: string | null
  auxiliaryActions?: ReactNode
}

export function PostEditor({ initialValue, tags, submitLabel, onSubmit, onChange, unavailableTagLabels = [], allowedImageOrigin, submissionError, auxiliaryActions }: PostEditorProps) {
  const [value, setValue] = useState(initialValue)
  const [errors, setErrors] = useState<PostErrors>({})
  const [preview, setPreview] = useState(false)
  const [pending, setPending] = useState(false)
  const submitting = useRef(false)
  const errorSummary = useRef<HTMLDivElement>(null)
  const writeTab = useRef<HTMLButtonElement>(null)
  const previewTab = useRef<HTMLButtonElement>(null)
  const activeIds = new Set(tags.map(tag => tag.id))
  const hasUnavailableTags = value.tagIds.some(id => !activeIds.has(id))

  function update(next: PostInput) {
    setValue(next)
    onChange?.(next)
  }
  function selectPreview(next: boolean, focus = false) {
    setPreview(next)
    if (focus) requestAnimationFrame(() => (next ? previewTab : writeTab).current?.focus())
  }
  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'Home') selectPreview(false, true)
    else if (event.key === 'End') selectPreview(true, true)
    else selectPreview(!preview, true)
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current) return
    const result = validatePostInput(value)
    const nextErrors = result.ok ? {} : result.errors
    if (hasUnavailableTags) nextErrors.tagIds = '현재 사용할 수 없는 태그를 해제하고 활성 태그를 선택해 주세요.'
    setErrors(nextErrors)
    if (!result.ok || hasUnavailableTags) {
      if (!result.ok && result.errors.bodyMarkdown) setPreview(false)
      requestAnimationFrame(() => errorSummary.current?.focus())
      return
    }
    submitting.current = true
    setPending(true)
    try { await onSubmit(result.value) } finally { submitting.current = false; setPending(false) }
  }

  const hasErrors = Object.keys(errors).length > 0
  return (
    <form className="post-editor" onSubmit={submit} noValidate>
      {hasErrors && <div ref={errorSummary} className="editor-error-summary" role="alert" tabIndex={-1}>입력 내용을 확인해 주세요.</div>}
      {submissionError && <p className="editor-submit-error" role="alert">{submissionError}</p>}
      <div className="editor-field">
        <label htmlFor="post-title">제목</label>
        <input id="post-title" value={value.title} maxLength={121} disabled={pending} aria-invalid={Boolean(errors.title)} aria-describedby={`title-help${errors.title ? ' title-error' : ''}`} onChange={event => update({ ...value, title: event.currentTarget.value })} />
        <p id="title-help" className="editor-hint">2–120자 · {value.title.trim().length}자</p>
        {errors.title && <p id="title-error" className="field-error">{errors.title}</p>}
      </div>
      <div className="editor-tabs" role="tablist" aria-label="본문 편집 모드">
        <button ref={writeTab} id="post-editor-write-tab" type="button" role="tab" aria-selected={!preview} aria-controls="post-editor-panel" tabIndex={preview ? -1 : 0} disabled={pending} onKeyDown={handleTabKey} onClick={() => selectPreview(false)}>작성</button>
        <button ref={previewTab} id="post-editor-preview-tab" type="button" role="tab" aria-selected={preview} aria-controls="post-editor-panel" tabIndex={preview ? 0 : -1} disabled={pending} onKeyDown={handleTabKey} onClick={() => selectPreview(true)}>미리보기</button>
      </div>
      <div id="post-editor-panel" role="tabpanel" aria-labelledby={preview ? 'post-editor-preview-tab' : 'post-editor-write-tab'}>
      {preview ? <MarkdownPreview markdown={value.bodyMarkdown} allowedImageOrigin={allowedImageOrigin} /> : <div className="editor-field editor-body-field">
        <label htmlFor="post-body">본문</label>
        <textarea id="post-body" value={value.bodyMarkdown} maxLength={50001} disabled={pending} aria-invalid={Boolean(errors.bodyMarkdown)} aria-describedby={`body-help${errors.bodyMarkdown ? ' body-error' : ''}`} onChange={event => update({ ...value, bodyMarkdown: event.currentTarget.value })} />
        <p id="body-help" className="editor-hint">Markdown · 1–50,000자 · {value.bodyMarkdown.trim().length.toLocaleString()}자</p>
        {errors.bodyMarkdown && <p id="body-error" className="field-error">{errors.bodyMarkdown}</p>}
      </div>}
      </div>
      <TagSelector tags={tags} selected={value.tagIds} onChange={tagIds => update({ ...value, tagIds })} error={errors.tagIds} unavailableLabels={unavailableTagLabels} disabled={pending} />
      <div className="editor-actions">
        <button className="editor-submit" type="submit" disabled={pending}>{pending ? '처리 중' : submitLabel}</button>
        {auxiliaryActions}
      </div>
      {pending && <span className="sr-only" role="status">처리 중입니다.</span>}
    </form>
  )
}
