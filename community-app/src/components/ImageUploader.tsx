import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react'
import type { UploadRepository, UploadedAttachment } from '../data/uploadRepository'
import type { DraftAttachment } from '../lib/draftStore'
import { validateImageCount, validateImageFile } from '../lib/imageValidation'

export interface OwnedUploadedAttachment extends UploadedAttachment { idempotencyKey: string; fileName: string }
export interface ImageUploaderState { blocked: boolean; attachments: OwnedUploadedAttachment[] }
interface Props {
  repository: UploadRepository
  actorId: string
  bodyLength: number
  onInsert(markdown: string): void
  onStateChange(state: ImageUploaderState): void
  initialAttachments?: DraftAttachment[]
  existingCount?: number
  disabled?: boolean
}
type Status = 'queued' | 'uploading' | 'uploaded' | 'failed' | 'cleaning' | 'cleanup-failed'
interface Item { localId: string; idempotencyKey: string; file?: File; fileName: string; previewUrl?: string; status: Status; attachment?: OwnedUploadedAttachment; error?: string }

export function ImageUploader({ repository, actorId, bodyLength, onInsert, onStateChange, initialAttachments = [], existingCount = 0, disabled = false }: Props) {
  const initial = useRef<Item[] | null>(null)
  if (!initial.current) initial.current = initialAttachments.map(value => ({
    localId: value.idempotencyKey, idempotencyKey: value.idempotencyKey, fileName: value.fileName, status: 'uploaded',
    attachment: { ...value, storagePath: `${actorId}/${value.idempotencyKey}`, publicUrl: repository.publicAttachmentUrl(value.attachmentId) },
  }))
  const [items, setItems] = useState<Item[]>(initial.current ?? [])
  const inputRef = useRef<HTMLInputElement>(null)
  const itemsRef = useRef(items); itemsRef.current = items
  const [error, setError] = useState<string | null>(null)
  const queue = useRef<string[]>([]); const active = useRef(0); const generation = useRef(0); const mounted = useRef(true); const actorRef = useRef(actorId); const repositoryRef = useRef(repository)
  const cleaning = useRef(new Set<string>())
  const revoked = useRef(new Set<string>())
  function revokeOnce(url?: string) { if (url && !revoked.current.has(url)) { revoked.current.add(url); URL.revokeObjectURL(url) } }

  useEffect(() => { onStateChange({ blocked: items.some(item => item.status !== 'uploaded'), attachments: items.flatMap(item => item.attachment ? [item.attachment] : []) }) }, [items, onStateChange])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; itemsRef.current.forEach(item => revokeOnce(item.previewUrl)) }
  }, [])
  useEffect(() => {
    if (actorRef.current === actorId && repositoryRef.current === repository) return

    // Invalidate the old actor before cleanup so every late upload response
    // follows the stale-response discard path below.
    const staleRepository = repositoryRef.current
    actorRef.current = actorId
    repositoryRef.current = repository
    generation.current += 1
    active.current = 0
    queue.current = []
    const staleItems = itemsRef.current
    staleItems.forEach(item => revokeOnce(item.previewUrl))
    itemsRef.current = []
    setItems([])
    setError(null)

    if (!disabled) {
      for (const item of staleItems) {
        if (!item.attachment || cleaning.current.has(item.localId)) continue
        void staleRepository.discard({ attachmentId: item.attachment.attachmentId, storagePath: item.attachment.storagePath })
      }
    }
  }, [actorId, disabled, repository])

  function pump() {
    while (active.current < 2 && queue.current.length) {
      const localId = queue.current.shift()!; const item = itemsRef.current.find(value => value.localId === localId)
      if (!item?.file) continue
      active.current += 1
      setItems(current => current.map(value => value.localId === localId ? { ...value, status: 'uploading' } : value))
      const uploadActor = actorId
      const uploadRepository = repository
      const uploadGeneration = generation.current
      void uploadRepository.upload(item.file, item.idempotencyKey, uploadActor).then(result => {
        if (!mounted.current || generation.current !== uploadGeneration || actorRef.current !== uploadActor || repositoryRef.current !== uploadRepository) {
          if (result.ok) void uploadRepository.discard({ attachmentId: result.data.attachmentId, storagePath: `${uploadActor}/${item.idempotencyKey}` })
          return
        }
        setItems(current => current.map(value => value.localId !== localId ? value : result.ok
          ? { ...value, status: 'uploaded', attachment: { ...result.data, idempotencyKey: value.idempotencyKey, fileName: value.fileName }, error: undefined }
          : { ...value, status: 'failed', error: result.error.message }))
      }).finally(() => {
        if (generation.current !== uploadGeneration) return
        active.current -= 1
        if (mounted.current) queueMicrotask(pump)
      })
    }
  }
  function enqueue(localId: string) { queue.current.push(localId); queueMicrotask(pump) }
  function addFiles(fileList: FileList | File[]) {
    if (disabled) return
    setError(null)
    const validFiles: File[] = []
    let validationMessage: string | null = null
    for (const file of Array.from(fileList)) {
      const validation = validateImageFile(file)
      if (!validation.ok) { validationMessage = validation.error.message; continue }
      validFiles.push(file)
    }
    if (!validFiles.length) { if (validationMessage) setError(validationMessage); return }
    const count = validateImageCount(existingCount + itemsRef.current.length, validFiles.length)
    if (!count.ok) { setError(count.error.message); return }
    const accepted = validFiles.map<Item>(file => {
      const localId = crypto.randomUUID()
      return { localId, idempotencyKey: crypto.randomUUID(), file, fileName: file.name, previewUrl: URL.createObjectURL(file), status: 'queued' }
    })
    if (validationMessage) setError(validationMessage)
    const next = [...itemsRef.current, ...accepted]; itemsRef.current = next; setItems(next); accepted.forEach(item => enqueue(item.localId))
  }
  function choose(event: ChangeEvent<HTMLInputElement>) { if (event.currentTarget.files) addFiles(event.currentTarget.files); event.currentTarget.value = '' }
  function drop(event: DragEvent<HTMLDivElement>) { event.preventDefault(); if (!disabled) addFiles(event.dataTransfer.files) }
  function openPicker() { if (!disabled) inputRef.current?.click() }
  function dropKey(event: KeyboardEvent<HTMLDivElement>) { if (!disabled && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openPicker() } }
  function retry(item: Item) { if (disabled || !item.file) return; setError(null); setItems(current => current.map(value => value.localId === item.localId ? { ...value, status: 'queued', error: undefined } : value)); enqueue(item.localId) }
  function removeLocal(localId: string) { const item = itemsRef.current.find(value => value.localId === localId); revokeOnce(item?.previewUrl); setItems(current => current.filter(value => value.localId !== localId)) }
  async function cleanup(item: Item) {
    if (disabled || !item.attachment || cleaning.current.has(item.localId)) return
    cleaning.current.add(item.localId); setError(null)
    setItems(current => current.map(value => value.localId === item.localId ? { ...value, status: 'cleaning', error: undefined } : value))
    const result = await repository.discard({ attachmentId: item.attachment.attachmentId, storagePath: item.attachment.storagePath })
    cleaning.current.delete(item.localId)
    if (!mounted.current) return
    if (result.ok) removeLocal(item.localId); else setItems(current => current.map(value => value.localId === item.localId ? { ...value, status: 'cleanup-failed', error: result.error.message } : value))
  }
  function remove(item: Item) {
    if (disabled) return
    if (!item.attachment) { removeLocal(item.localId); return }
    void cleanup(item)
  }
  function insert(item: Item) {
    if (disabled || !item.attachment) return
    const markdown = `![업로드한 이미지](${item.attachment.publicUrl})`
    if (bodyLength + markdown.length > 50_000) { setError('이미지를 삽입하면 본문이 50,000자를 초과합니다.'); return }
    setError(null); onInsert(markdown)
  }
  const frozen = disabled
  return <section className="image-uploader" aria-labelledby="image-uploader-title">
    <div className="image-uploader-heading"><h2 id="image-uploader-title">이미지</h2><p>JPEG, PNG, WebP · 파일당 5 MiB 이하 · 최대 5개</p></div>
    <div className="image-dropzone" role="button" tabIndex={frozen ? -1 : 0} aria-label="이미지를 끌어다 놓거나 선택하기" aria-disabled={frozen} onClick={openPicker} onDragOver={event => event.preventDefault()} onDrop={drop} onKeyDown={dropKey}>
      <span>이미지를 끌어다 놓거나 <strong>파일 선택</strong></span>
    </div>
    <input ref={inputRef} className="image-dropzone-input" id="community-image-files" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={frozen} tabIndex={-1} aria-hidden="true" aria-label="이미지 파일 선택" onChange={choose} />
    {error && <p className="image-uploader-error" role="alert">{error}</p>}
    {items.length > 0 && <ul className="image-upload-list">{items.map(item => <li key={item.localId} className={`image-upload-item is-${item.status}${item.previewUrl ? '' : ' without-preview'}`}>
      {item.previewUrl && <img src={item.previewUrl} alt="" />}<div className="image-upload-copy"><strong>{item.fileName}</strong>
      {item.status === 'queued' && <span role="status">{item.fileName} 업로드 대기 중</span>}{item.status === 'uploading' && <><span role="status">{item.fileName} 업로드 중</span><progress aria-label={`${item.fileName} 업로드 진행 중`} /></>}
      {item.status === 'cleaning' && <span role="status">{item.fileName} 정리 중</span>}
      {item.status === 'uploaded' && <span className="image-upload-success" role="status">업로드 완료</span>}{(item.status === 'failed' || item.status === 'cleanup-failed') && <span className="image-uploader-error" role="alert">{item.error}</span>}</div>
      <div className="image-upload-actions">{item.status === 'uploaded' && <button type="button" disabled={frozen} aria-label={`${item.fileName} 본문에 삽입`} onClick={() => insert(item)}>본문에 삽입</button>}
      {item.status === 'failed' && <button type="button" disabled={frozen} aria-label={`${item.fileName} 다시 시도`} onClick={() => retry(item)}>다시 시도</button>}
      {item.status === 'cleanup-failed' && <button type="button" disabled={frozen} aria-label={`${item.fileName} 정리 다시 시도`} onClick={() => void cleanup(item)}>정리 다시 시도</button>}
      {item.status !== 'cleanup-failed' && item.status !== 'cleaning' && <button type="button" disabled={frozen || item.status === 'uploading' || item.status === 'queued'} aria-label={`${item.fileName} 제거`} onClick={() => remove(item)}>제거</button>}</div>
    </li>)}</ul>}
  </section>
}
