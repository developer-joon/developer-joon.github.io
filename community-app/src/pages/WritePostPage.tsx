import { useCallback, useEffect, useRef, useState } from 'react'
import { AppHeader } from '../components/AppHeader'
import { DraftNotice } from '../components/DraftNotice'
import { PostEditor } from '../components/PostEditor'
import { useAuth } from '../auth/AuthProvider'
import { normalizeCommunityReturnPath } from '../auth/auth'
import type { CommunityRepository } from '../data/communityRepository'
import type { UploadRepository } from '../data/uploadRepository'
import type { ImageUploaderState, OwnedUploadedAttachment } from '../components/ImageUploader'
import { DraftLockUnavailableError, withDraftLock } from '../lib/draftLock'
import { clearDraft, createWriteDraft, draftKey, isPersistableDraft, loadDraft, matchesDraftSnapshot, readDraftSnapshot, saveDraft, type DraftAttachment, type DraftSnapshot, type DraftStorage, type DraftSubmission, type WriteDraft } from '../lib/draftStore'
import { isStrictUuid, type PostInput } from '../lib/validation'
import type { CommunityTag } from '../types/community'

interface Props {
  repository: CommunityRepository
  storage?: DraftStorage
  navigate?: (path: string) => void
  currentPath?: string
  uploadRepository?: UploadRepository
}

function safeWritePath(path: string) {
  const safe = normalizeCommunityReturnPath(path)
  if (!safe) return '/community/write/'
  const parsed = new URL(safe, 'https://community.invalid')
  if (parsed.pathname !== '/community/write' && parsed.pathname !== '/community/write/') return '/community/write/'
  return `/community/write/${parsed.search}${parsed.hash}`
}

const lockError = '초안 잠금을 사용할 수 없습니다. 브라우저 설정을 확인해 주세요.'

export function WritePostPage({ repository, uploadRepository, storage = window.localStorage, navigate = path => window.location.assign(path), currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}` }: Props) {
  const auth = useAuth()
  const initial = useRef<{ draft: WriteDraft; restored: boolean; snapshot: DraftSnapshot; conflict: boolean; storageFailed: boolean } | null>(null)
  if (!initial.current) {
    const snapshot = readDraftSnapshot(storage, 'write')
    const loaded = loadDraft(storage, 'write')
    initial.current = {
      draft: loaded ?? createWriteDraft(),
      restored: loaded !== null,
      snapshot,
      conflict: !snapshot.ok || (snapshot.raw !== null && loaded === null),
      storageFailed: !snapshot.ok,
    }
  }
  const key = draftKey('write')
  const draftRef = useRef<WriteDraft>(initial.current.draft)
  const baseline = useRef<DraftSnapshot>(initial.current.snapshot)
  const draftSaveFailed = useRef(initial.current.storageFailed)
  const conflictRef = useRef(initial.current.conflict)
  const lifecycle = useRef(0)
  const authUserId = useRef(auth.user?.id ?? null)
  authUserId.current = auth.user?.id ?? null
  const [tags, setTags] = useState<CommunityTag[] | null>(null)
  const [tagError, setTagError] = useState<string | null>(null)
  const [tagAttempt, setTagAttempt] = useState(0)
  const [submitError, setSubmitError] = useState<string | null>(initial.current.conflict ? '로컬 초안 상태를 확인할 수 없습니다. 사용할 내용을 선택해 주세요.' : null)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [conflict, setConflict] = useState(initial.current.conflict)
  const [editorRevision, setEditorRevision] = useState(0)
  const [mutationPending, setMutationPending] = useState(false)
  const [recoveryAttempt, setRecoveryAttempt] = useState(0)
  const mutationLock = useRef<symbol | null>(null)
  const uploadState = useRef<ImageUploaderState>({ blocked: false, attachments: [] })
  const [workflowFrozen, setWorkflowFrozen] = useState(Boolean(initial.current.draft.uploadWorkflow && initial.current.draft.uploadWorkflow.phase !== 'uploaded'))

  const persistExactLocked = useCallback((draft: WriteDraft) => {
    if (!isPersistableDraft(draft)) return false
    const saved = saveDraft(storage, draft)
    const snapshot = readDraftSnapshot(storage, 'write')
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

  const persistAutosaveLocked = useCallback((draft: WriteDraft) => {
    if (conflictRef.current) return false
    const before = readDraftSnapshot(storage, 'write')
    if (!baseline.current.ok || !before.ok || before.raw !== baseline.current.raw) {
      enterConflict('다른 탭에서 초안이 변경되었습니다. 사용할 내용을 선택해 주세요.')
      return false
    }
    const saved = persistExactLocked(draft)
    if (!saved) setSubmitError('초안을 저장할 수 없습니다. 저장 공간과 브라우저 설정을 확인해 주세요.')
    return saved
  }, [persistExactLocked, storage])

  useEffect(() => {
    const generation = ++lifecycle.current
    return () => { if (lifecycle.current === generation) lifecycle.current += 1 }
  }, [repository, storage, uploadRepository])

  useEffect(() => {
    const generation = lifecycle.current
    const initialBaseline = baseline.current
    if (conflictRef.current || !initialBaseline.ok || initialBaseline.raw !== null) return
    void withDraftLock(key, () => {
      if (generation !== lifecycle.current) return
      const before = readDraftSnapshot(storage, 'write')
      if (!before.ok || before.raw !== initialBaseline.raw) {
        enterConflict('다른 탭에서 초안 상태가 변경되었습니다. 사용할 내용을 선택해 주세요.')
        return
      }
      persistExactLocked(draftRef.current)
    }).catch(error => {
      if (generation === lifecycle.current && error instanceof DraftLockUnavailableError) setSubmitError(lockError)
    })
  }, [key, persistExactLocked, storage])

  useEffect(() => {
    let active = true
    setTags(null); setTagError(null)
    void repository.listTags().then(result => {
      if (!active) return
      if (result.ok) setTags(result.data)
      else setTagError(result.error.message)
    })
    return () => { active = false }
  }, [repository, tagAttempt])

  useEffect(() => {
    const actorId = auth.user?.id
    const pending = draftRef.current.uploadWorkflow
    if (!actorId || !pending || pending.phase === 'uploaded' || mutationLock.current) return
    const generation = lifecycle.current
    const operation = Symbol('recover-attachments')
    setMutationPending(true); mutationLock.current = operation; setWorkflowFrozen(true)
    void withDraftLock(key, async () => {
      if (generation !== lifecycle.current || authUserId.current !== actorId) return
      let current = loadDraft(storage, 'write')
      if (!current?.uploadWorkflow || current.uploadWorkflow.ownerId !== actorId || !current.uploadWorkflow.submission || !current.uploadWorkflow.createdPostId) {
        setSubmitError('저장된 첨부 복구 상태를 확인할 수 없습니다.'); return
      }
      const recoverySnapshot = readDraftSnapshot(storage, 'write')
      if (!baseline.current.ok || !recoverySnapshot.ok || recoverySnapshot.raw !== baseline.current.raw) { enterConflict('다른 탭에서 초안이 변경되어 복구하지 않았습니다.'); return }
      if (current.uploadWorkflow.phase === 'attached') {
        lifecycle.current += 1; clearDraft(storage, 'write'); navigate(`/community/post/?id=${current.uploadWorkflow!.createdPostId}`); return
      }
      if (!uploadRepository) { setSubmitError('이미지 첨부를 복구할 수 없습니다. 다시 시도해 주세요.'); return }
      current = { ...current, uploadWorkflow: { ...current.uploadWorkflow, phase: 'attaching' } }
      draftRef.current = current
      if (!persistExactLocked(current) || !matchesDraftSnapshot(readDraftSnapshot(storage, 'write'), current)) { setSubmitError('첨부 복구 상태를 안전하게 저장하지 못했습니다.'); return }
      const result = await uploadRepository.attach(current.uploadWorkflow!.createdPostId!, current.uploadWorkflow!.submission!.attachmentIds, current.uploadWorkflow!.submission!.expectedAttachmentTotal)
      if (generation !== lifecycle.current || authUserId.current !== actorId) return
      const completionSnapshot = readDraftSnapshot(storage, 'write')
      if (!baseline.current.ok || !completionSnapshot.ok || completionSnapshot.raw !== baseline.current.raw) { enterConflict('다른 탭에서 초안이 변경되어 첨부 완료 상태를 저장하지 않았습니다.'); return }
      if (!result.ok) { setSubmitError(result.error.message); return }
      current = { ...current, uploadWorkflow: { ...current.uploadWorkflow!, phase: 'attached' } }
      draftRef.current = current
      if (!persistExactLocked(current) || !matchesDraftSnapshot(readDraftSnapshot(storage, 'write'), current)) { setSubmitError('첨부 완료 상태를 안전하게 저장하지 못했습니다.'); return }
      lifecycle.current += 1; clearDraft(storage, 'write'); navigate(`/community/post/?id=${current.uploadWorkflow!.createdPostId}`)
    }).catch(error => {
      if (generation === lifecycle.current && error instanceof DraftLockUnavailableError) setSubmitError(lockError)
    }).finally(() => {
      if (mutationLock.current === operation) {
        mutationLock.current = null
        setMutationPending(false)
        if (generation !== lifecycle.current) setRecoveryAttempt(value => value + 1)
      }
    })
  }, [auth.user?.id, key, navigate, persistExactLocked, recoveryAttempt, storage, uploadRepository])

  const autosave = useCallback((value: PostInput) => {
    const next: WriteDraft = { ...draftRef.current, ...value, updatedAt: new Date().toISOString() }
    draftRef.current = next
    if (conflictRef.current) return
    const generation = lifecycle.current
    void withDraftLock(key, () => {
      if (generation !== lifecycle.current) return
      persistAutosaveLocked(next)
    }).catch(error => {
      if (generation === lifecycle.current && error instanceof DraftLockUnavailableError) setSubmitError(lockError)
    })
  }, [key, persistAutosaveLocked])

  function persistedAttachment(value: OwnedUploadedAttachment): DraftAttachment {
    return { attachmentId: value.attachmentId, idempotencyKey: value.idempotencyKey, fileName: value.fileName, mimeType: value.mimeType, byteSize: value.byteSize, width: value.width, height: value.height }
  }

  const uploadChanged = useCallback((state: ImageUploaderState) => {
    uploadState.current = state
    const actorId = authUserId.current
    const generation = lifecycle.current
    const currentWorkflow = draftRef.current.uploadWorkflow
    if (!actorId || workflowFrozen || mutationLock.current || (currentWorkflow && currentWorkflow.ownerId !== actorId)) return
    void withDraftLock(key, () => {
      if (generation !== lifecycle.current || authUserId.current !== actorId || conflictRef.current) return
      const before = readDraftSnapshot(storage, 'write')
      if (!baseline.current.ok || !before.ok || before.raw !== baseline.current.raw) { enterConflict('다른 탭에서 초안이 변경되었습니다. 사용할 내용을 선택해 주세요.'); return }
      const attachments = state.attachments.map(persistedAttachment)
      const next: WriteDraft = {
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

  async function loadConflictingDraft() {
    const generation = lifecycle.current
    try {
      await withDraftLock(key, () => {
        if (generation !== lifecycle.current) return
        const snapshot = readDraftSnapshot(storage, 'write')
        const loaded = loadDraft(storage, 'write')
        if (!snapshot.ok || snapshot.raw === null || !loaded) {
          setSubmitError('다른 탭 초안을 확인할 수 없습니다. 저장 공간과 브라우저 설정을 확인해 주세요.')
          return
        }
        draftRef.current = loaded
        baseline.current = snapshot
        draftSaveFailed.current = false
        conflictRef.current = false
        setConflict(false)
        setSubmitError(null)
        setEditorRevision(value => value + 1)
      })
    } catch (error) {
      if (generation === lifecycle.current && error instanceof DraftLockUnavailableError) setSubmitError(lockError)
    }
  }

  async function overwriteConflictingDraft() {
    const generation = lifecycle.current
    try {
      await withDraftLock(key, () => {
        if (generation !== lifecycle.current) return
        if (!isPersistableDraft(draftRef.current)) {
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

  async function publish(value: PostInput) {
    if (mutationLock.current || uploadState.current.blocked) {
      setSubmitError('이미지 업로드 또는 정리를 완료한 뒤 발행해 주세요.')
      return
    }
    const operation = Symbol('publish')
    mutationLock.current = operation; setMutationPending(true); setSubmitError(null); setNeedsLogin(false)
    const generation = lifecycle.current
    try {
      await withDraftLock(key, async () => {
        if (generation !== lifecycle.current) return
        if (conflictRef.current) { enterConflict('다른 탭의 초안과 충돌했습니다. 사용할 내용을 선택해 주세요.'); return }
        const actorId = auth.user?.id ?? null
        if (!actorId) { await auth.signInWithGitHub(safeWritePath(currentPath)); return }
        const before = readDraftSnapshot(storage, 'write')
        if (!before.ok) { setSubmitError('초안 저장소를 확인할 수 없어 발행하지 않았습니다. 브라우저 설정을 확인해 주세요.'); return }
        if (!baseline.current.ok || before.raw !== baseline.current.raw) { enterConflict('다른 탭에서 초안이 변경되어 발행하지 않았습니다.'); return }
        if (draftSaveFailed.current && !persistExactLocked(draftRef.current)) { setSubmitError('초안을 저장할 수 없어 발행하지 않았습니다. 저장 공간과 브라우저 설정을 확인해 주세요.'); return }
        let next: WriteDraft = { ...draftRef.current, ...value, updatedAt: new Date().toISOString() }
        draftRef.current = next
        if (!persistAutosaveLocked(next)) { setSubmitError('초안을 저장할 수 없어 발행하지 않았습니다. 저장 공간과 브라우저 설정을 확인해 주세요.'); return }

        const persisted = loadDraft(storage, 'write')
        if (!persisted || !matchesDraftSnapshot(readDraftSnapshot(storage, 'write'), next)) { enterConflict('다른 탭에서 초안이 변경되어 발행하지 않았습니다.'); return }
        const liveIds = uploadState.current.attachments.map(item => item.attachmentId).sort()
        const workflowIds = persisted.uploadWorkflow?.attachments.map(item => item.attachmentId).sort() ?? []
        if (liveIds.join() !== workflowIds.join()) { setSubmitError('업로드 상태가 안전하게 저장되지 않아 발행하지 않았습니다. 다시 시도해 주세요.'); return }

        if (!persisted.uploadWorkflow) {
          const result = await repository.createPost({ ...value, idempotencyKey: persisted.idempotencyKey })
          if (generation !== lifecycle.current || authUserId.current !== actorId) return
          if (!result.ok) { setSubmitError(result.error.message); setNeedsLogin(result.error.code === 'auth_required'); return }
          if (!isStrictUuid(result.data)) { setSubmitError('서버 응답을 확인할 수 없습니다. 다시 시도해 주세요.'); return }
          if (!matchesDraftSnapshot(readDraftSnapshot(storage, 'write'), next)) { enterConflict('다른 탭에서 초안이 변경되어 현재 화면을 이동하지 않았습니다.'); return }
          lifecycle.current += 1; clearDraft(storage, 'write'); draftRef.current = createWriteDraft(); navigate(`/community/post/?id=${result.data}`)
          return
        }
        if (persisted.uploadWorkflow.ownerId !== actorId) { setSubmitError('현재 로그인 사용자와 업로드 소유자가 일치하지 않습니다.'); return }
        const submission: DraftSubmission = persisted.uploadWorkflow.submission ?? {
          submissionId: crypto.randomUUID(), title: value.title, bodyMarkdown: value.bodyMarkdown, tagIds: [...value.tagIds], attachmentIds: persisted.uploadWorkflow.attachments.map(item => item.attachmentId), expectedAttachmentTotal: persisted.uploadWorkflow.attachments.length,
        }
        next = { ...persisted, uploadWorkflow: { ...persisted.uploadWorkflow, phase: 'uploaded', createdPostId: null, submission } }
        draftRef.current = next
        if (!persistExactLocked(next) || !matchesDraftSnapshot(readDraftSnapshot(storage, 'write'), next)) { setSubmitError('제출 상태를 안전하게 저장할 수 없어 발행하지 않았습니다.'); return }

        const created = await repository.createPost({ title: submission.title, bodyMarkdown: submission.bodyMarkdown, tagIds: submission.tagIds, idempotencyKey: next.idempotencyKey })
        if (generation !== lifecycle.current || authUserId.current !== actorId) return
        if (!created.ok) { setSubmitError(created.error.message); setNeedsLogin(created.error.code === 'auth_required'); return }
        if (!isStrictUuid(created.data)) { setSubmitError('서버 응답을 확인할 수 없습니다. 다시 시도해 주세요.'); return }
        next = { ...next, uploadWorkflow: { ...next.uploadWorkflow!, phase: 'post-created', createdPostId: created.data } }
        draftRef.current = next; setWorkflowFrozen(true)
        if (!persistExactLocked(next) || !matchesDraftSnapshot(readDraftSnapshot(storage, 'write'), next)) {
          draftRef.current = persisted; setWorkflowFrozen(false)
          setSubmitError('게시글 생성 상태를 안전하게 저장하지 못했습니다. 같은 요청으로 다시 시도해 주세요.'); return
        }
        next = { ...next, uploadWorkflow: { ...next.uploadWorkflow!, phase: 'attaching' } }
        draftRef.current = next
        if (!persistExactLocked(next) || !matchesDraftSnapshot(readDraftSnapshot(storage, 'write'), next)) { setSubmitError('첨부 시작 상태를 안전하게 저장하지 못했습니다. 다시 시도해 주세요.'); return }
        const attached = await uploadRepository!.attach(created.data, submission.attachmentIds, submission.expectedAttachmentTotal)
        if (generation !== lifecycle.current || authUserId.current !== actorId) return
        const attachCompletionSnapshot = readDraftSnapshot(storage, 'write')
        if (!baseline.current.ok || !attachCompletionSnapshot.ok || attachCompletionSnapshot.raw !== baseline.current.raw) { enterConflict('다른 탭에서 초안이 변경되어 첨부 완료 상태를 저장하지 않았습니다.'); return }
        if (!attached.ok) { setSubmitError(attached.error.message); return }
        next = { ...next, uploadWorkflow: { ...next.uploadWorkflow!, phase: 'attached' } }
        draftRef.current = next
        if (!persistExactLocked(next) || !matchesDraftSnapshot(readDraftSnapshot(storage, 'write'), next)) { setSubmitError('첨부 완료 상태를 안전하게 저장하지 못했습니다. 다시 시도해 주세요.'); return }
        lifecycle.current += 1; clearDraft(storage, 'write'); draftRef.current = createWriteDraft(); navigate(`/community/post/?id=${created.data}`)
      })
    } catch (error) {
      if (generation === lifecycle.current && error instanceof DraftLockUnavailableError) setSubmitError('초안 잠금을 사용할 수 없어 발행하지 않았습니다. 브라우저 설정을 확인해 주세요.')
    } finally {
      if (mutationLock.current === operation) {
        mutationLock.current = null
        setMutationPending(false)
        if (generation !== lifecycle.current) setRecoveryAttempt(value => value + 1)
      }
    }
  }

  const conflictActions = conflict ? <div className="editor-conflict-actions"><button type="button" className="secondary-action" onClick={() => void loadConflictingDraft()}>다른 탭 초안 불러오기</button><button type="button" className="secondary-action" onClick={() => void overwriteConflictingDraft()}>현재 내용으로 덮어쓰기</button></div> : null
  const currentWorkflow = draftRef.current.uploadWorkflow
  const actorMismatch = Boolean(currentWorkflow && currentWorkflow.ownerId !== auth.user?.id)
  const retryAttachmentAction = submitError && currentWorkflow && currentWorkflow.phase !== 'uploaded' && !conflict
    ? <button type="button" className="secondary-action" disabled={mutationPending} onClick={() => { if (!mutationLock.current) setRecoveryAttempt(value => value + 1) }}>첨부 연결 다시 시도</button>
    : null

  return <div className="community-page editor-page"><AppHeader /><main>
    <header className="editor-heading"><p className="post-detail-kicker">NEW COMMUNITY NOTE</p><h1>새 글 쓰기</h1><p>이 브라우저의 로컬 저장소에 임시 저장을 시도합니다.</p></header>
    <DraftNotice restored={initial.current.restored} />
    {auth.loading && <p className="editor-auth-note" role="status">로그인 상태를 확인하고 있습니다. 작성 내용은 유지됩니다.</p>}
    {tagError && <section className="editor-load-state" role="alert"><p>{tagError}</p><button type="button" className="secondary-action" onClick={() => setTagAttempt(value => value + 1)}>태그 다시 불러오기</button></section>}
    {!tagError && !tags && <p className="editor-load-state" role="status">태그를 불러오고 있습니다.</p>}
    {actorMismatch && <section className="editor-load-state" role="alert"><p>이 초안의 이미지는 다른 계정에서 업로드되었습니다. 원래 계정으로 로그인해 계속해 주세요.</p><button type="button" className="secondary-action" onClick={() => void auth.signOut()}>계정 바꾸기</button></section>}
    {tags && <PostEditor key={`${editorRevision}:${draftRef.current.idempotencyKey}:${auth.user?.id ?? 'anonymous'}`} initialValue={draftRef.current} tags={tags} submitLabel="발행" onChange={autosave} onSubmit={publish} disabled={mutationPending || workflowFrozen || actorMismatch} submissionError={submitError} submissionActions={<>{conflictActions}{retryAttachmentAction}</>} allowedImageOrigin={repository.publicAttachmentOrigin} uploadRepository={uploadRepository} uploadActorId={auth.user?.id} initialAttachments={currentWorkflow && currentWorkflow.ownerId === auth.user?.id ? currentWorkflow.attachments : []} onUploadStateChange={uploadChanged} auxiliaryActions={needsLogin ? <button type="button" className="secondary-action" onClick={() => void auth.signInWithGitHub(safeWritePath(currentPath))}>다시 로그인</button> : null} />}
  </main><footer className="community-footer"><span>BREADLAB · EDITORIAL DESK</span><a href="/community/">글 목록</a></footer></div>
}
