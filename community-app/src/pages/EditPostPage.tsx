import { useCallback, useEffect, useRef, useState } from 'react'
import { AppHeader } from '../components/AppHeader'
import { AppFooter } from '../components/AppFooter'
import { DraftNotice } from '../components/DraftNotice'
import { SessionRecoveryNotice, useSessionRecoveryNotice } from '../components/SessionRecoveryNotice'
import { PostEditor } from '../components/PostEditor'
import { useAuth } from '../auth/AuthProvider'
import { normalizeCommunityReturnPath } from '../auth/auth'
import { DEFAULT_AUTH_PROVIDER } from '../auth/providers'
import type { CommunityRepository } from '../data/communityRepository'
import type { UploadRepository } from '../data/uploadRepository'
import type { ImageUploaderState, OwnedUploadedAttachment } from '../components/ImageUploader'
import { DraftLockUnavailableError, withDraftLock } from '../lib/draftLock'
import { clearDraft, createEditDraft, draftKey, isPersistableDraft, loadDraft, matchesDraftSnapshot, readDraftSnapshot, saveDraft, type DraftAttachment, type DraftSnapshot, type DraftStorage, type DraftSubmission, type EditDraft } from '../lib/draftStore'
import { extractExistingAttachmentIds } from '../lib/attachmentMarkdown'
import { parsePostId } from '../lib/postQuery'
import { isStrictUuid, type PostInput } from '../lib/validation'
import type { CommunityTag, PostDetail, PublicPostRead } from '../types/community'

interface Props {
  repository: CommunityRepository
  search: string
  storage?: DraftStorage
  navigate?: (path: string) => void
  confirmDelete?: (message: string) => boolean
  currentPath?: string
  uploadRepository?: UploadRepository
}

function State({ title, children, alert = false }: { title: string; children?: React.ReactNode; alert?: boolean }) {
  return <section className="post-state" role={alert ? 'alert' : undefined}><p className="post-detail-kicker">COMMUNITY</p><h1>{title}</h1>{children}<a className="post-list-link" href="/community/">커뮤니티 글 목록으로</a></section>
}

function stateTitle(read: Exclude<PublicPostRead, { kind: 'published' }>) {
  if (read.kind === 'not_found') return '게시글을 찾을 수 없습니다'
  if (read.kind === 'hidden') return '공개되지 않은 글은 수정할 수 없습니다'
  return '삭제된 글은 수정할 수 없습니다'
}

function safeEditPath(path: string, postId: string) {
  const fallback = `/community/edit/?id=${postId}`
  const safe = normalizeCommunityReturnPath(path)
  if (!safe) return fallback
  const parsed = new URL(safe, 'https://community.invalid')
  if ((parsed.pathname !== '/community/edit' && parsed.pathname !== '/community/edit/') || parsePostId(parsed.search) !== postId) return fallback
  return `/community/edit/${parsed.search}${parsed.hash}`
}

const lockError = '초안 잠금을 사용할 수 없습니다. 브라우저 설정을 확인해 주세요.'

export function EditPostPage({ repository, uploadRepository, search, storage = window.localStorage, navigate = path => window.location.assign(path), confirmDelete = message => window.confirm(message), currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}` }: Props) {
  const postId = parsePostId(search)
  const key = postId ? draftKey('edit', postId) : null
  const auth = useAuth()
  const [post, setPost] = useState<PostDetail | null>(null)
  const [readState, setReadState] = useState<Exclude<PublicPostRead, { kind: 'published' }> | null>(null)
  const [tags, setTags] = useState<CommunityTag[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const retryButtonRef = useRef<HTMLButtonElement>(null)
  const [initialDraft, setInitialDraft] = useState<EditDraft | null>(null)
  const draftRef = useRef<EditDraft | null>(null)
  const baseline = useRef<DraftSnapshot>({ ok: false })
  const lifecycle = useRef(0)
  const authUserId = useRef(auth.user?.id ?? null)
  authUserId.current = auth.user?.id ?? null
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [restoredDraft, setRestoredDraft] = useState(false)
  const [mutationPending, setMutationPending] = useState(false)
  const mutationLock = useRef<symbol | null>(null)
  const draftSaveFailed = useRef(false)
  const conflictRef = useRef(false)
  const [conflict, setConflict] = useState(false)
  const [editorRevision, setEditorRevision] = useState(0)
  const uploadState = useRef<ImageUploaderState>({ blocked: false, attachments: [] })
  const [existingAttachmentCount, setExistingAttachmentCount] = useState<number | null>(null)
  const [workflowFrozen, setWorkflowFrozen] = useState(false)
  const [recoveryAttempt, setRecoveryAttempt] = useState(0)
  const [recovery, consumeRecovery] = useSessionRecoveryNotice()

  useEffect(() => {
    const generation = ++lifecycle.current
    return () => { if (lifecycle.current === generation) lifecycle.current += 1 }
  }, [postId, repository, storage, uploadRepository])

  useEffect(() => {
    if (!postId || !key) return
    let active = true
    setLoadError(null); setPost(null); setReadState(null); setTags(null); setInitialDraft(null); setRestoredDraft(false); setExistingAttachmentCount(null); setWorkflowFrozen(false)
    setSubmitError(null); setConflict(false); conflictRef.current = false; baseline.current = { ok: false }; draftSaveFailed.current = false
    void Promise.all([repository.getPost(postId), repository.listTags()]).then(async ([postResult, tagResult]) => {
      if (!active) return
      if (postResult.ok) consumeRecovery(postResult.recovery)
      if (tagResult.ok) consumeRecovery(tagResult.recovery)
      if (!postResult.ok) { setLoadError(postResult.error.message); return }
      if (!tagResult.ok) { setLoadError(tagResult.error.message); return }
      setTags(tagResult.data)
      if (postResult.data.kind !== 'published') { setReadState(postResult.data); return }
      const serverPost = postResult.data.post
      if (serverPost.id !== postId) { setLoadError('서버 응답을 확인할 수 없습니다. 다시 시도해 주세요.'); return }
      if (extractExistingAttachmentIds('', repository.publicAttachmentOrigin) === null || serverPost.attachmentCount > 5) { setLoadError('서버의 이미지 첨부 상태를 확인할 수 없습니다. 다시 시도해 주세요.'); return }
      try {
        await withDraftLock(key, () => {
          if (!active) return
          const snapshot = readDraftSnapshot(storage, 'edit', postId)
          const saved = loadDraft(storage, 'edit', postId)
          const serverDraft = createEditDraft(postId, serverPost.title, serverPost.bodyMarkdown, serverPost.tags.map(tag => tag.id), serverPost.updatedAt)
          const hasDurableSubmission = Boolean(saved?.uploadWorkflow?.submission)
          const hasNewerDraft = Boolean(saved && (hasDurableSubmission || Date.parse(saved.updatedAt) > Date.parse(serverPost.updatedAt)))
          const chosen = hasNewerDraft ? saved! : serverDraft
          baseline.current = snapshot
          draftSaveFailed.current = !snapshot.ok
          if (!snapshot.ok || (snapshot.raw !== null && !saved)) {
            conflictRef.current = true
            setConflict(true)
            setSubmitError('로컬 초안 상태를 확인할 수 없습니다. 사용할 내용을 선택해 주세요.')
          }
          draftRef.current = chosen; setRestoredDraft(hasNewerDraft); setPost(serverPost); setInitialDraft(chosen); setExistingAttachmentCount(serverPost.attachmentCount)
          setWorkflowFrozen(Boolean(chosen.uploadWorkflow && chosen.uploadWorkflow.phase !== 'uploaded'))
        })
      } catch (error) {
        if (active && error instanceof DraftLockUnavailableError) setLoadError('초안 잠금을 사용할 수 없어 수정 화면을 열 수 없습니다. 브라우저 설정을 확인해 주세요.')
      }
    })
    return () => { active = false }
  }, [attempt, consumeRecovery, key, postId, repository, storage])

  useEffect(() => {
    if (loadError) retryButtonRef.current?.focus()
  }, [loadError])

  const persistExactLocked = useCallback((draft: EditDraft) => {
    if (!isPersistableDraft(draft)) return false
    const saved = saveDraft(storage, draft)
    const snapshot = readDraftSnapshot(storage, 'edit', draft.postId)
    const verified = saved && matchesDraftSnapshot(snapshot, draft)
    if (verified) baseline.current = snapshot
    draftSaveFailed.current = !verified
    return verified
  }, [storage])

  function enterConflict(message: string) {
    conflictRef.current = true
    setConflict(true)
    setSubmitError(message)
  }

  const persistAutosaveLocked = useCallback((draft: EditDraft) => {
    if (conflictRef.current) return false
    const before = readDraftSnapshot(storage, 'edit', draft.postId)
    if (!baseline.current.ok || !before.ok || before.raw !== baseline.current.raw) {
      enterConflict('다른 탭에서 초안이 변경되었습니다. 사용할 내용을 선택해 주세요.')
      return false
    }
    const saved = persistExactLocked(draft)
    if (!saved) setSubmitError('초안을 저장할 수 없습니다. 저장 공간과 브라우저 설정을 확인해 주세요.')
    return saved
  }, [persistExactLocked, storage])

  function persistedAttachment(value: OwnedUploadedAttachment): DraftAttachment {
    return { attachmentId: value.attachmentId, idempotencyKey: value.idempotencyKey, fileName: value.fileName, mimeType: value.mimeType, byteSize: value.byteSize, width: value.width, height: value.height }
  }

  const uploadChanged = useCallback((state: ImageUploaderState) => {
    uploadState.current = state
    const actorId = authUserId.current
    const generation = lifecycle.current
    const currentWorkflow = draftRef.current?.uploadWorkflow
    if (!key || !actorId || workflowFrozen || mutationLock.current || (currentWorkflow && currentWorkflow.ownerId !== actorId)) return
    void withDraftLock(key, () => {
      if (generation !== lifecycle.current || authUserId.current !== actorId || conflictRef.current || !draftRef.current) return
      const before = readDraftSnapshot(storage, 'edit', draftRef.current.postId)
      if (!baseline.current.ok || !before.ok || before.raw !== baseline.current.raw) { enterConflict('다른 탭에서 초안이 변경되었습니다. 사용할 내용을 선택해 주세요.'); return }
      const attachments = state.attachments.map(persistedAttachment)
      const next: EditDraft = {
        ...draftRef.current,
        updatedAt: new Date().toISOString(),
        uploadWorkflow: attachments.length ? { ownerId: actorId, phase: 'uploaded', attachments, createdPostId: null, submission: null } : null,
      }
      draftRef.current = next
      if (!persistExactLocked(next)) setSubmitError('업로드 상태를 안전하게 저장할 수 없습니다. 다시 시도해 주세요.')
    }).catch(error => {
      if (generation === lifecycle.current && error instanceof DraftLockUnavailableError) setSubmitError(lockError)
    })
  }, [key, persistExactLocked, storage, workflowFrozen])

  useEffect(() => {
    const actorId = auth.user?.id
    const pending = draftRef.current?.uploadWorkflow
    if (!postId || !key || existingAttachmentCount === null || !initialDraft || !actorId || !pending || pending.phase === 'uploaded' || mutationLock.current) return
    const generation = lifecycle.current
    const operation = Symbol('recover-attachments')
    mutationLock.current = operation; setMutationPending(true); setWorkflowFrozen(true)
    void withDraftLock(key, async () => {
      if (generation !== lifecycle.current || authUserId.current !== actorId) return
      let current = loadDraft(storage, 'edit', postId)
      if (!current?.uploadWorkflow || current.uploadWorkflow.ownerId !== actorId || !current.uploadWorkflow.submission || current.uploadWorkflow.createdPostId !== postId) {
        setSubmitError('저장된 첨부 복구 상태를 확인할 수 없습니다.'); return
      }
      const recoverySnapshot = readDraftSnapshot(storage, 'edit', postId)
      if (!baseline.current.ok || !recoverySnapshot.ok || recoverySnapshot.raw !== baseline.current.raw) { enterConflict('다른 탭에서 초안이 변경되어 복구하지 않았습니다.'); return }
      if (current.uploadWorkflow.phase === 'attached') {
        lifecycle.current += 1; clearDraft(storage, 'edit', postId); navigate(`/community/post/?id=${postId}`); return
      }
      if (!uploadRepository) { setSubmitError('이미지 첨부를 복구할 수 없습니다. 다시 시도해 주세요.'); return }
      current = { ...current, uploadWorkflow: { ...current.uploadWorkflow, phase: 'attaching' } }
      draftRef.current = current
      if (!persistExactLocked(current) || !matchesDraftSnapshot(readDraftSnapshot(storage, 'edit', postId), current)) { setSubmitError('첨부 복구 상태를 안전하게 저장하지 못했습니다.'); return }
      const submission = current.uploadWorkflow!.submission!
      const result = await uploadRepository.attach(postId, submission.attachmentIds, submission.expectedAttachmentTotal)
      if (generation !== lifecycle.current || authUserId.current !== actorId) return
      const completionSnapshot = readDraftSnapshot(storage, 'edit', postId)
      if (!baseline.current.ok || !completionSnapshot.ok || completionSnapshot.raw !== baseline.current.raw) { enterConflict('다른 탭에서 초안이 변경되어 첨부 완료 상태를 저장하지 않았습니다.'); return }
      if (!result.ok) { setSubmitError(result.error.message); return }
      current = { ...current, uploadWorkflow: { ...current.uploadWorkflow!, phase: 'attached' } }
      draftRef.current = current
      if (!persistExactLocked(current) || !matchesDraftSnapshot(readDraftSnapshot(storage, 'edit', postId), current)) { setSubmitError('첨부 완료 상태를 안전하게 저장하지 못했습니다.'); return }
      lifecycle.current += 1; clearDraft(storage, 'edit', postId); navigate(`/community/post/?id=${postId}`)
    }).catch(error => {
      if (generation === lifecycle.current && error instanceof DraftLockUnavailableError) setSubmitError(lockError)
    }).finally(() => {
      if (mutationLock.current === operation) {
        mutationLock.current = null
        setMutationPending(false)
        if (generation !== lifecycle.current) setRecoveryAttempt(value => value + 1)
      }
    })
  }, [auth.user?.id, existingAttachmentCount, initialDraft, key, navigate, persistExactLocked, postId, recoveryAttempt, storage, uploadRepository])

  const autosave = useCallback((value: PostInput) => {
    if (!postId || !key || !draftRef.current) return
    const next: EditDraft = { ...draftRef.current, ...value, updatedAt: new Date().toISOString() }
    draftRef.current = next
    if (conflictRef.current) return
    const generation = lifecycle.current
    void withDraftLock(key, () => {
      if (generation !== lifecycle.current) return
      persistAutosaveLocked(next)
    }).catch(error => {
      if (generation === lifecycle.current && error instanceof DraftLockUnavailableError) setSubmitError(lockError)
    })
  }, [key, persistAutosaveLocked, postId])

  async function loadConflictingDraft() {
    if (!postId || !key) return
    const generation = lifecycle.current
    try {
      await withDraftLock(key, () => {
        if (generation !== lifecycle.current) return
        const snapshot = readDraftSnapshot(storage, 'edit', postId)
        const loaded = loadDraft(storage, 'edit', postId)
        if (!snapshot.ok || snapshot.raw === null || !loaded) {
          setSubmitError('다른 탭 초안을 확인할 수 없습니다. 저장 공간과 브라우저 설정을 확인해 주세요.')
          return
        }
        draftRef.current = loaded
        baseline.current = snapshot
        draftSaveFailed.current = false
        conflictRef.current = false
        setInitialDraft(loaded)
        setRestoredDraft(true)
        setConflict(false)
        setSubmitError(null)
        setEditorRevision(value => value + 1)
      })
    } catch (error) {
      if (generation === lifecycle.current && error instanceof DraftLockUnavailableError) setSubmitError(lockError)
    }
  }

  async function overwriteConflictingDraft() {
    if (!key) return
    const generation = lifecycle.current
    try {
      await withDraftLock(key, () => {
        if (generation !== lifecycle.current) return
        if (!draftRef.current || !isPersistableDraft(draftRef.current)) {
          setSubmitError('현재 내용은 로컬 초안으로 저장할 수 없습니다. 입력 길이를 확인해 주세요.')
          return
        }
        if (!persistExactLocked(draftRef.current)) {
          setSubmitError('현재 초안을 저장할 수 없습니다. 저장 공간과 브라우저 설정을 확인해 주세요.')
          return
        }
        conflictRef.current = false
        setConflict(false)
        setSubmitError(null)
      })
    } catch (error) {
      if (generation === lifecycle.current && error instanceof DraftLockUnavailableError) setSubmitError(lockError)
    }
  }

  async function update(value: PostInput) {
    if (!postId || !key || mutationLock.current || uploadState.current.blocked) {
      if (uploadState.current.blocked) setSubmitError('이미지 업로드 또는 정리를 완료한 뒤 수정해 주세요.')
      return
    }
    const operation = Symbol('update')
    mutationLock.current = operation; setMutationPending(true); setSubmitError(null); setNeedsLogin(false)
    const generation = lifecycle.current
    try {
      await withDraftLock(key, async () => {
        if (generation !== lifecycle.current) return
        if (conflictRef.current) { enterConflict('다른 탭의 초안과 충돌했습니다. 사용할 내용을 선택해 주세요.'); return }
        const current = draftRef.current
        const before = readDraftSnapshot(storage, 'edit', postId)
        if (!current || !before.ok) { setSubmitError('초안 저장소를 확인할 수 없어 수정하지 않았습니다. 브라우저 설정을 확인해 주세요.'); return }
        if (!baseline.current.ok || before.raw !== baseline.current.raw) { enterConflict('다른 탭에서 초안이 변경되어 수정하지 않았습니다.'); return }
        if (draftSaveFailed.current && !persistExactLocked(current)) { setSubmitError('초안을 저장할 수 없어 수정하지 않았습니다. 저장 공간과 브라우저 설정을 확인해 주세요.'); return }

        let next: EditDraft = { ...current, ...value, updatedAt: new Date().toISOString() }
        draftRef.current = next
        if (!persistAutosaveLocked(next)) { setSubmitError('초안을 저장할 수 없어 수정하지 않았습니다. 저장 공간과 브라우저 설정을 확인해 주세요.'); return }
        const actorId = auth.user?.id ?? null
        if (!actorId) { setSubmitError('로그인이 필요합니다.'); setNeedsLogin(true); return }
        const persisted = loadDraft(storage, 'edit', postId)
        if (!persisted || !matchesDraftSnapshot(readDraftSnapshot(storage, 'edit', postId), next)) { enterConflict('다른 탭에서 초안이 변경되어 수정하지 않았습니다.'); return }
        const liveIds = uploadState.current.attachments.map(item => item.attachmentId).sort()
        const workflowIds = persisted.uploadWorkflow?.attachments.map(item => item.attachmentId).sort() ?? []
        if (liveIds.join() !== workflowIds.join()) { setSubmitError('업로드 상태가 안전하게 저장되지 않아 수정하지 않았습니다. 다시 시도해 주세요.'); return }

        let submission: DraftSubmission | null = null
        if (persisted.uploadWorkflow) {
          if (!uploadRepository || existingAttachmentCount === null) { setSubmitError('이미지 첨부 상태를 확인할 수 없습니다. 다시 시도해 주세요.'); return }
          if (persisted.uploadWorkflow.ownerId !== actorId) { setSubmitError('현재 로그인 사용자와 업로드 소유자가 일치하지 않습니다.'); return }
          submission = persisted.uploadWorkflow.submission ?? {
            submissionId: crypto.randomUUID(), title: value.title, bodyMarkdown: value.bodyMarkdown, tagIds: [...value.tagIds], attachmentIds: persisted.uploadWorkflow.attachments.map(item => item.attachmentId), expectedAttachmentTotal: existingAttachmentCount + persisted.uploadWorkflow.attachments.length,
          }
          if (submission.expectedAttachmentTotal !== existingAttachmentCount + submission.attachmentIds.length || submission.expectedAttachmentTotal > 5) { setSubmitError('이미지는 게시글당 최대 5개까지 업로드할 수 있습니다.'); return }
          next = { ...persisted, uploadWorkflow: { ...persisted.uploadWorkflow, phase: 'uploaded', createdPostId: null, submission } }
          draftRef.current = next
          if (!persistExactLocked(next) || !matchesDraftSnapshot(readDraftSnapshot(storage, 'edit', postId), next)) { setSubmitError('제출 상태를 안전하게 저장할 수 없어 수정하지 않았습니다.'); return }
        }

        const result = await repository.updatePost({ postId, title: submission?.title ?? value.title, bodyMarkdown: submission?.bodyMarkdown ?? value.bodyMarkdown, tagIds: submission?.tagIds ?? value.tagIds })
        if (generation !== lifecycle.current || authUserId.current !== actorId) return
        if (!result.ok) { setSubmitError(result.error.message); setNeedsLogin(result.error.code === 'auth_required'); return }
        if (!isStrictUuid(result.data) || result.data !== postId) { setSubmitError('서버 응답을 확인할 수 없습니다. 다시 시도해 주세요.'); return }

        if (!submission || !next.uploadWorkflow) {
          if (!matchesDraftSnapshot(readDraftSnapshot(storage, 'edit', postId), next)) { enterConflict('다른 탭에서 초안이 변경되어 현재 화면을 이동하지 않았습니다.'); return }
          lifecycle.current += 1; clearDraft(storage, 'edit', postId); navigate(`/community/post/?id=${postId}`); return
        }

        next = { ...next, uploadWorkflow: { ...next.uploadWorkflow, phase: 'post-created', createdPostId: postId } }
        draftRef.current = next; setWorkflowFrozen(true)
        if (!persistExactLocked(next) || !matchesDraftSnapshot(readDraftSnapshot(storage, 'edit', postId), next)) {
          draftRef.current = persisted; setWorkflowFrozen(false)
          setSubmitError('게시글 수정 상태를 안전하게 저장하지 못했습니다. 같은 요청으로 다시 시도해 주세요.'); return
        }
        next = { ...next, uploadWorkflow: { ...next.uploadWorkflow!, phase: 'attaching' } }
        draftRef.current = next
        if (!persistExactLocked(next) || !matchesDraftSnapshot(readDraftSnapshot(storage, 'edit', postId), next)) { setSubmitError('첨부 시작 상태를 안전하게 저장하지 못했습니다. 다시 시도해 주세요.'); return }
        const attached = await uploadRepository!.attach(postId, submission.attachmentIds, submission.expectedAttachmentTotal)
        if (generation !== lifecycle.current || authUserId.current !== actorId) return
        const attachCompletionSnapshot = readDraftSnapshot(storage, 'edit', postId)
        if (!baseline.current.ok || !attachCompletionSnapshot.ok || attachCompletionSnapshot.raw !== baseline.current.raw) { enterConflict('다른 탭에서 초안이 변경되어 첨부 완료 상태를 저장하지 않았습니다.'); return }
        if (!attached.ok) { setSubmitError(attached.error.message); return }
        next = { ...next, uploadWorkflow: { ...next.uploadWorkflow!, phase: 'attached' } }
        draftRef.current = next
        if (!persistExactLocked(next) || !matchesDraftSnapshot(readDraftSnapshot(storage, 'edit', postId), next)) { setSubmitError('첨부 완료 상태를 안전하게 저장하지 못했습니다. 다시 시도해 주세요.'); return }
        lifecycle.current += 1; clearDraft(storage, 'edit', postId); navigate(`/community/post/?id=${postId}`)
      })
    } catch (error) {
      if (generation === lifecycle.current && error instanceof DraftLockUnavailableError) setSubmitError('초안 잠금을 사용할 수 없어 수정하지 않았습니다. 브라우저 설정을 확인해 주세요.')
    } finally {
      if (mutationLock.current === operation) {
        mutationLock.current = null
        setMutationPending(false)
        if (generation !== lifecycle.current) setRecoveryAttempt(value => value + 1)
      }
    }
  }

  async function remove() {
    if (!postId || !key || mutationLock.current || !confirmDelete('이 글을 삭제하시겠습니까? 삭제 후에는 본문을 복구할 수 없습니다.')) return
    const operation = Symbol('delete')
    mutationLock.current = operation; setMutationPending(true); setSubmitError(null); setNeedsLogin(false)
    const generation = lifecycle.current
    try {
      await withDraftLock(key, async () => {
        if (generation !== lifecycle.current) return
        if (conflictRef.current) { enterConflict('다른 탭의 초안과 충돌했습니다. 사용할 내용을 선택해 주세요.'); return }
        const actorId = auth.user?.id ?? null
        const submitted = draftRef.current ? { ...draftRef.current, tagIds: [...draftRef.current.tagIds] } : null
        if (!actorId) { setSubmitError('로그인이 필요합니다.'); setNeedsLogin(true); return }
        const before = readDraftSnapshot(storage, 'edit', postId)
        if (!submitted || !before.ok) { setSubmitError('초안 저장소를 확인할 수 없어 삭제하지 않았습니다. 브라우저 설정을 확인해 주세요.'); return }
        if (!baseline.current.ok || before.raw !== baseline.current.raw) {
          enterConflict('다른 탭에서 초안이 변경되어 삭제하지 않았습니다.'); return
        }
        if (!persistExactLocked(submitted)) {
          setSubmitError('초안을 저장할 수 없어 삭제하지 않았습니다. 저장 공간과 브라우저 설정을 확인해 주세요.'); return
        }
        const submittedSnapshot = readDraftSnapshot(storage, 'edit', postId)
        if (!matchesDraftSnapshot(submittedSnapshot, submitted)) { enterConflict('다른 탭에서 초안이 변경되어 삭제하지 않았습니다.'); return }
        const result = await repository.deletePost(postId)
        if (generation !== lifecycle.current || authUserId.current !== actorId) return
        if (!result.ok) { setSubmitError(result.error.message); setNeedsLogin(result.error.code === 'auth_required'); return }
        if (!isStrictUuid(result.data) || result.data !== postId) { setSubmitError('서버 응답을 확인할 수 없습니다. 다시 시도해 주세요.'); return }
        const completionSnapshot = readDraftSnapshot(storage, 'edit', postId)
        if (!matchesDraftSnapshot(completionSnapshot, submitted)) { enterConflict('다른 탭에서 초안이 변경되어 현재 화면을 이동하지 않았습니다.'); return }
        lifecycle.current += 1
        clearDraft(storage, 'edit', postId)
        navigate(`/community/post/?id=${postId}`)
      })
    } catch (error) {
      if (generation === lifecycle.current && error instanceof DraftLockUnavailableError) setSubmitError('초안 잠금을 사용할 수 없어 삭제하지 않았습니다. 브라우저 설정을 확인해 주세요.')
    } finally {
      if (mutationLock.current === operation) {
        mutationLock.current = null
        setMutationPending(false)
        if (generation !== lifecycle.current) setRecoveryAttempt(value => value + 1)
      }
    }
  }

  let content: React.ReactNode
  if (!postId) content = <State title="올바르지 않은 게시글 주소입니다" />
  else if (loadError) content = <State title={loadError} alert><button ref={retryButtonRef} type="button" className="secondary-action" onClick={() => setAttempt(value => value + 1)}>다시 시도</button></State>
  else if (readState) content = <State title={stateTitle(readState)} />
  else if (!post || !tags || !initialDraft || existingAttachmentCount === null || auth.loading) content = <State title="수정할 글을 불러오고 있습니다" />
  else if (!auth.user) content = <State title="로그인이 필요합니다"><button type="button" className="secondary-action" onClick={() => void auth.signIn(DEFAULT_AUTH_PROVIDER, safeEditPath(currentPath, postId))}>로그인하고 수정하기</button></State>
  else if (auth.user.id !== post.author.id) content = <State title="이 글을 수정할 권한이 없습니다" />
  else {
    const activeIds = new Set(tags.map(tag => tag.id))
    const unavailable = initialDraft.tagIds.filter(id => !activeIds.has(id)).map(id => post.tags.find(tag => tag.id === id)?.label ?? id)
    const conflictActions = conflict ? <div className="editor-conflict-actions"><button type="button" className="secondary-action" onClick={() => void loadConflictingDraft()}>다른 탭 초안 불러오기</button><button type="button" className="secondary-action" onClick={() => void overwriteConflictingDraft()}>현재 내용으로 덮어쓰기</button></div> : null
    const currentWorkflow = draftRef.current?.uploadWorkflow
    const actorMismatch = Boolean(currentWorkflow && currentWorkflow.ownerId !== auth.user.id)
    const retryAttachmentAction = submitError && currentWorkflow && currentWorkflow.phase !== 'uploaded' && !conflict
      ? <button type="button" className="secondary-action" disabled={mutationPending} onClick={() => { if (!mutationLock.current) setRecoveryAttempt(value => value + 1) }}>첨부 연결 다시 시도</button>
      : null
    content = <><header className="editor-heading"><p className="post-detail-kicker">REVISE COMMUNITY NOTE</p><h1>글 수정</h1><p>수정과 삭제 권한은 서버에서도 현재 로그인 사용자 기준으로 다시 확인됩니다.</p></header><DraftNotice restored={restoredDraft} />{actorMismatch && <section className="editor-load-state" role="alert"><p>이 초안의 이미지는 다른 계정에서 업로드되었습니다. 원래 계정으로 로그인해 계속해 주세요.</p><button type="button" className="secondary-action" onClick={() => void auth.signOut()}>계정 바꾸기</button></section>}<PostEditor key={`${editorRevision}:${postId}:${auth.user.id}`} initialValue={initialDraft} tags={tags} unavailableTagLabels={unavailable} submitLabel="수정" onChange={autosave} onSubmit={update} disabled={mutationPending || workflowFrozen || actorMismatch} submissionError={submitError} submissionActions={<>{conflictActions}{retryAttachmentAction}</>} allowedImageOrigin={repository.publicAttachmentOrigin} uploadRepository={uploadRepository} uploadActorId={auth.user.id} initialAttachments={currentWorkflow && currentWorkflow.ownerId === auth.user.id ? currentWorkflow.attachments : []} existingAttachmentCount={existingAttachmentCount} onUploadStateChange={uploadChanged} auxiliaryActions={<>{needsLogin && <button type="button" className="secondary-action" onClick={() => void auth.signIn(DEFAULT_AUTH_PROVIDER, safeEditPath(currentPath, postId))}>다시 로그인</button>}<button type="button" className="danger-action" onClick={() => void remove()}>글 삭제</button></>} /></>
  }

  return <div className="community-page editor-page"><AppHeader /><main><SessionRecoveryNotice recovery={recovery} />{content}</main><AppFooter /></div>
}
