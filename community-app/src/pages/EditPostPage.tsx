import { useCallback, useEffect, useRef, useState } from 'react'
import { AppHeader } from '../components/AppHeader'
import { DraftNotice } from '../components/DraftNotice'
import { PostEditor } from '../components/PostEditor'
import { useAuth } from '../auth/AuthProvider'
import { normalizeCommunityReturnPath } from '../auth/auth'
import type { CommunityRepository } from '../data/communityRepository'
import { DraftLockUnavailableError, withDraftLock } from '../lib/draftLock'
import { clearDraft, createEditDraft, draftKey, isPersistableDraft, loadDraft, matchesDraftSnapshot, readDraftSnapshot, saveDraft, type DraftSnapshot, type DraftStorage, type EditDraft } from '../lib/draftStore'
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
}

function State({ title, children }: { title: string; children?: React.ReactNode }) {
  return <section className="post-state"><p className="post-detail-kicker">EDITORIAL DESK</p><h1>{title}</h1>{children}<a className="post-list-link" href="/community/">커뮤니티 글 목록으로</a></section>
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

export function EditPostPage({ repository, search, storage = window.localStorage, navigate = path => window.location.assign(path), confirmDelete = message => window.confirm(message), currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}` }: Props) {
  const postId = parsePostId(search)
  const key = postId ? draftKey('edit', postId) : null
  const auth = useAuth()
  const [post, setPost] = useState<PostDetail | null>(null)
  const [readState, setReadState] = useState<Exclude<PublicPostRead, { kind: 'published' }> | null>(null)
  const [tags, setTags] = useState<CommunityTag[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
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
  const mutationLock = useRef(false)
  const draftSaveFailed = useRef(false)
  const conflictRef = useRef(false)
  const [conflict, setConflict] = useState(false)
  const [editorRevision, setEditorRevision] = useState(0)

  useEffect(() => {
    const generation = ++lifecycle.current
    return () => { if (lifecycle.current === generation) lifecycle.current += 1 }
  }, [postId, repository, storage])

  useEffect(() => {
    if (!postId || !key) return
    let active = true
    setLoadError(null); setPost(null); setReadState(null); setTags(null); setInitialDraft(null); setRestoredDraft(false)
    setSubmitError(null); setConflict(false); conflictRef.current = false; baseline.current = { ok: false }; draftSaveFailed.current = false
    void Promise.all([repository.getPost(postId), repository.listTags()]).then(async ([postResult, tagResult]) => {
      if (!active) return
      if (!postResult.ok) { setLoadError(postResult.error.message); return }
      if (!tagResult.ok) { setLoadError(tagResult.error.message); return }
      setTags(tagResult.data)
      if (postResult.data.kind !== 'published') { setReadState(postResult.data); return }
      const serverPost = postResult.data.post
      if (serverPost.id !== postId) { setLoadError('서버 응답을 확인할 수 없습니다. 다시 시도해 주세요.'); return }
      try {
        await withDraftLock(key, () => {
          if (!active) return
          const snapshot = readDraftSnapshot(storage, 'edit', postId)
          const saved = loadDraft(storage, 'edit', postId)
          const serverDraft = createEditDraft(postId, serverPost.title, serverPost.bodyMarkdown, serverPost.tags.map(tag => tag.id), serverPost.updatedAt)
          const hasNewerDraft = Boolean(saved && Date.parse(saved.updatedAt) > Date.parse(serverPost.updatedAt))
          const chosen = hasNewerDraft ? saved! : serverDraft
          baseline.current = snapshot
          draftSaveFailed.current = !snapshot.ok
          if (!snapshot.ok || (snapshot.raw !== null && !saved)) {
            conflictRef.current = true
            setConflict(true)
            setSubmitError('로컬 초안 상태를 확인할 수 없습니다. 사용할 내용을 선택해 주세요.')
          }
          draftRef.current = chosen; setRestoredDraft(hasNewerDraft); setPost(serverPost); setInitialDraft(chosen)
        })
      } catch (error) {
        if (active && error instanceof DraftLockUnavailableError) setLoadError('초안 잠금을 사용할 수 없어 수정 화면을 열 수 없습니다. 브라우저 설정을 확인해 주세요.')
      }
    })
    return () => { active = false }
  }, [attempt, key, postId, repository, storage])

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
    if (!postId || !key || mutationLock.current) return
    mutationLock.current = true; setMutationPending(true); setSubmitError(null); setNeedsLogin(false)
    const generation = lifecycle.current
    try {
      await withDraftLock(key, async () => {
        if (generation !== lifecycle.current) return
        if (conflictRef.current) { enterConflict('다른 탭의 초안과 충돌했습니다. 사용할 내용을 선택해 주세요.'); return }
        const current = draftRef.current
        const before = readDraftSnapshot(storage, 'edit', postId)
        if (!current || !before.ok) { setSubmitError('초안 저장소를 확인할 수 없어 수정하지 않았습니다. 브라우저 설정을 확인해 주세요.'); return }
        if (!baseline.current.ok || before.raw !== baseline.current.raw) {
          enterConflict('다른 탭에서 초안이 변경되어 수정하지 않았습니다.'); return
        }
        if (draftSaveFailed.current && !persistExactLocked(current)) {
          setSubmitError('초안을 저장할 수 없어 수정하지 않았습니다. 저장 공간과 브라우저 설정을 확인해 주세요.'); return
        }
        const next: EditDraft = { ...current, ...value, updatedAt: new Date().toISOString() }
        draftRef.current = next
        const saved = persistAutosaveLocked(next)
        const actorId = auth.user?.id ?? null
        const submitted: EditDraft = { ...next, tagIds: [...next.tagIds] }
        if (!actorId) { setSubmitError('로그인이 필요합니다.'); setNeedsLogin(true); return }
        const submittedSnapshot = readDraftSnapshot(storage, 'edit', postId)
        if (!saved || !matchesDraftSnapshot(submittedSnapshot, submitted)) {
          if (saved) enterConflict('다른 탭에서 초안이 변경되어 수정하지 않았습니다.')
          else setSubmitError('초안을 저장할 수 없어 수정하지 않았습니다. 저장 공간과 브라우저 설정을 확인해 주세요.')
          return
        }
        const result = await repository.updatePost({ postId, ...value })
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
      if (generation === lifecycle.current && error instanceof DraftLockUnavailableError) setSubmitError('초안 잠금을 사용할 수 없어 수정하지 않았습니다. 브라우저 설정을 확인해 주세요.')
    } finally {
      mutationLock.current = false
      if (generation === lifecycle.current) setMutationPending(false)
    }
  }

  async function remove() {
    if (!postId || !key || mutationLock.current || !confirmDelete('이 글을 삭제하시겠습니까? 삭제 후에는 본문을 복구할 수 없습니다.')) return
    mutationLock.current = true; setMutationPending(true); setSubmitError(null); setNeedsLogin(false)
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
      mutationLock.current = false
      if (generation === lifecycle.current) setMutationPending(false)
    }
  }

  let content: React.ReactNode
  if (!postId) content = <State title="올바르지 않은 게시글 주소입니다" />
  else if (loadError) content = <State title={loadError}><button type="button" className="secondary-action" onClick={() => setAttempt(value => value + 1)}>다시 시도</button></State>
  else if (readState) content = <State title={stateTitle(readState)} />
  else if (!post || !tags || !initialDraft || auth.loading) content = <State title="수정할 글을 불러오고 있습니다" />
  else if (!auth.user) content = <State title="로그인이 필요합니다"><button type="button" className="secondary-action" onClick={() => void auth.signInWithGitHub(safeEditPath(currentPath, postId))}>로그인하고 수정하기</button></State>
  else if (auth.user.id !== post.author.id) content = <State title="이 글을 수정할 권한이 없습니다" />
  else {
    const activeIds = new Set(tags.map(tag => tag.id))
    const unavailable = initialDraft.tagIds.filter(id => !activeIds.has(id)).map(id => post.tags.find(tag => tag.id === id)?.label ?? id)
    const conflictActions = conflict ? <div className="editor-conflict-actions"><button type="button" className="secondary-action" onClick={() => void loadConflictingDraft()}>다른 탭 초안 불러오기</button><button type="button" className="secondary-action" onClick={() => void overwriteConflictingDraft()}>현재 내용으로 덮어쓰기</button></div> : null
    content = <><header className="editor-heading"><p className="post-detail-kicker">REVISE COMMUNITY NOTE</p><h1>글 수정</h1><p>수정과 삭제 권한은 서버에서도 현재 로그인 사용자 기준으로 다시 확인됩니다.</p></header><DraftNotice restored={restoredDraft} /><PostEditor key={editorRevision} initialValue={initialDraft} tags={tags} unavailableTagLabels={unavailable} submitLabel="수정" onChange={autosave} onSubmit={update} disabled={mutationPending} submissionError={submitError} submissionActions={conflictActions} allowedImageOrigin={repository.publicAttachmentOrigin} auxiliaryActions={<>{needsLogin && <button type="button" className="secondary-action" onClick={() => void auth.signInWithGitHub(safeEditPath(currentPath, postId))}>다시 로그인</button>}<button type="button" className="danger-action" onClick={() => void remove()}>글 삭제</button></>} /></>
  }

  return <div className="community-page editor-page"><AppHeader /><main>{content}</main><footer className="community-footer"><span>BREADLAB · EDITORIAL DESK</span><a href="/community/">글 목록</a></footer></div>
}
