import { useCallback, useEffect, useRef, useState } from 'react'
import { AppHeader } from '../components/AppHeader'
import { DraftNotice } from '../components/DraftNotice'
import { PostEditor } from '../components/PostEditor'
import { useAuth } from '../auth/AuthProvider'
import { normalizeCommunityReturnPath } from '../auth/auth'
import type { CommunityRepository } from '../data/communityRepository'
import { clearDraft, createWriteDraft, loadDraft, matchesDraftSnapshot, readDraftSnapshot, saveDraft, type DraftStorage, type WriteDraft } from '../lib/draftStore'
import { isStrictUuid, type PostInput } from '../lib/validation'
import type { CommunityTag } from '../types/community'

interface Props {
  repository: CommunityRepository
  storage?: DraftStorage
  navigate?: (path: string) => void
  currentPath?: string
}

function safeWritePath(path: string) {
  const safe = normalizeCommunityReturnPath(path)
  if (!safe) return '/community/write/'
  const parsed = new URL(safe, 'https://community.invalid')
  if (parsed.pathname !== '/community/write' && parsed.pathname !== '/community/write/') return '/community/write/'
  return `/community/write/${parsed.search}${parsed.hash}`
}

export function WritePostPage({ repository, storage = window.localStorage, navigate = path => window.location.assign(path), currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}` }: Props) {
  const auth = useAuth()
  const initial = useRef<{ draft: WriteDraft; restored: boolean; raw: string | null; conflict: boolean; storageFailed: boolean } | null>(null)
  if (!initial.current) {
    const snapshot = readDraftSnapshot(storage, 'write')
    const loaded = loadDraft(storage, 'write')
    initial.current = {
      draft: loaded ?? createWriteDraft(),
      restored: loaded !== null,
      raw: snapshot.ok ? snapshot.raw : null,
      conflict: snapshot.ok && snapshot.raw !== null && loaded === null,
      storageFailed: !snapshot.ok,
    }
  }
  const draftRef = useRef<WriteDraft>(initial.current.draft)
  const persistedRaw = useRef<string | null>(initial.current.raw)
  const draftSaveFailed = useRef(initial.current.storageFailed)
  const conflictRef = useRef(initial.current.conflict)
  const lifecycle = useRef(0)
  const authUserId = useRef(auth.user?.id ?? null)
  authUserId.current = auth.user?.id ?? null
  const [tags, setTags] = useState<CommunityTag[] | null>(null)
  const [tagError, setTagError] = useState<string | null>(null)
  const [tagAttempt, setTagAttempt] = useState(0)
  const [submitError, setSubmitError] = useState<string | null>(initial.current.conflict ? '다른 탭의 초안과 충돌했습니다. 사용할 내용을 선택해 주세요.' : null)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [conflict, setConflict] = useState(initial.current.conflict)
  const [editorRevision, setEditorRevision] = useState(0)

  const persistExact = useCallback((draft: WriteDraft) => {
    const saved = saveDraft(storage, draft)
    const snapshot = readDraftSnapshot(storage, 'write')
    const verified = saved && matchesDraftSnapshot(snapshot, draft)
    if (verified) persistedRaw.current = snapshot.ok ? snapshot.raw : null
    draftSaveFailed.current = !verified
    return verified
  }, [storage])

  useEffect(() => {
    if (persistedRaw.current === null && !conflictRef.current) persistExact(draftRef.current)
  }, [persistExact])

  useEffect(() => {
    const generation = ++lifecycle.current
    return () => { if (lifecycle.current === generation) lifecycle.current += 1 }
  }, [repository, storage])

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

  function enterConflict(message: string) {
    conflictRef.current = true
    setConflict(true)
    setSubmitError(message)
  }

  const autosave = useCallback((value: PostInput) => {
    const next: WriteDraft = { ...draftRef.current, ...value, updatedAt: new Date().toISOString() }
    draftRef.current = next
    if (conflictRef.current) return false
    const saved = persistExact(next)
    if (!saved) setSubmitError('초안을 저장할 수 없습니다. 저장 공간과 브라우저 설정을 확인해 주세요.')
    return saved
  }, [persistExact])

  function loadConflictingDraft() {
    const snapshot = readDraftSnapshot(storage, 'write')
    const loaded = loadDraft(storage, 'write')
    if (!snapshot.ok || snapshot.raw === null || !loaded) {
      setSubmitError('다른 탭 초안을 확인할 수 없습니다. 저장 공간과 브라우저 설정을 확인해 주세요.')
      return
    }
    draftRef.current = loaded
    persistedRaw.current = snapshot.raw
    draftSaveFailed.current = false
    conflictRef.current = false
    setConflict(false)
    setSubmitError(null)
    setEditorRevision(value => value + 1)
  }

  function overwriteConflictingDraft() {
    if (!persistExact(draftRef.current)) {
      setSubmitError('현재 초안을 저장할 수 없습니다. 저장 공간과 브라우저 설정을 확인해 주세요.')
      return
    }
    conflictRef.current = false
    setConflict(false)
    setSubmitError(null)
  }

  async function publish(value: PostInput) {
    setSubmitError(null); setNeedsLogin(false)
    if (conflictRef.current) {
      enterConflict('다른 탭의 초안과 충돌했습니다. 사용할 내용을 선택해 주세요.')
      return
    }
    const before = readDraftSnapshot(storage, 'write')
    if (!before.ok) {
      setSubmitError('초안 저장소를 확인할 수 없어 발행하지 않았습니다. 브라우저 설정을 확인해 주세요.')
      return
    }
    if (draftSaveFailed.current) {
      if (before.raw !== null && persistedRaw.current !== null && before.raw !== persistedRaw.current) {
        enterConflict('다른 탭에서 초안이 변경되어 발행하지 않았습니다.')
        return
      }
      if (!persistExact(draftRef.current)) {
        setSubmitError('초안을 저장할 수 없어 발행하지 않았습니다. 저장 공간과 브라우저 설정을 확인해 주세요.')
        return
      }
    } else if (before.raw !== null && !matchesDraftSnapshot(before, draftRef.current)) {
      enterConflict('다른 탭에서 초안이 변경되어 발행하지 않았습니다.')
      return
    }
    const saved = autosave(value)
    const submitted: WriteDraft = { ...draftRef.current, tagIds: [...draftRef.current.tagIds] }
    const submittedSnapshot = readDraftSnapshot(storage, 'write')
    if (!saved || !matchesDraftSnapshot(submittedSnapshot, submitted)) {
      if (saved) enterConflict('다른 탭에서 초안이 변경되어 발행하지 않았습니다.')
      else setSubmitError('초안을 저장할 수 없어 발행하지 않았습니다. 저장 공간과 브라우저 설정을 확인해 주세요.')
      return
    }
    if (!auth.user) {
      await auth.signInWithGitHub(safeWritePath(currentPath))
      return
    }
    const generation = lifecycle.current
    const actorId = auth.user.id
    const result = await repository.createPost({ ...value, idempotencyKey: submitted.idempotencyKey })
    if (generation !== lifecycle.current || authUserId.current !== actorId) return
    if (!result.ok) {
      setSubmitError(result.error.message)
      setNeedsLogin(result.error.code === 'auth_required')
      return
    }
    if (!isStrictUuid(result.data)) {
      setSubmitError('서버 응답을 확인할 수 없습니다. 다시 시도해 주세요.')
      return
    }
    const completionSnapshot = readDraftSnapshot(storage, 'write')
    if (!matchesDraftSnapshot(completionSnapshot, submitted)) {
      enterConflict('다른 탭에서 초안이 변경되어 현재 화면을 이동하지 않았습니다.')
      return
    }
    clearDraft(storage, 'write')
    draftRef.current = createWriteDraft()
    navigate(`/community/post/?id=${result.data}`)
  }

  const conflictActions = conflict ? <div className="editor-conflict-actions"><button type="button" className="secondary-action" onClick={loadConflictingDraft}>다른 탭 초안 불러오기</button><button type="button" className="secondary-action" onClick={overwriteConflictingDraft}>현재 내용으로 덮어쓰기</button></div> : null

  return <div className="community-page editor-page"><AppHeader /><main>
    <header className="editor-heading"><p className="post-detail-kicker">NEW COMMUNITY NOTE</p><h1>새 글 쓰기</h1><p>이 브라우저의 로컬 저장소에 임시 저장을 시도합니다.</p></header>
    <DraftNotice restored={initial.current.restored} />
    {auth.loading && <p className="editor-auth-note" role="status">로그인 상태를 확인하고 있습니다. 작성 내용은 유지됩니다.</p>}
    {tagError && <section className="editor-load-state" role="alert"><p>{tagError}</p><button type="button" className="secondary-action" onClick={() => setTagAttempt(value => value + 1)}>태그 다시 불러오기</button></section>}
    {!tagError && !tags && <p className="editor-load-state" role="status">태그를 불러오고 있습니다.</p>}
    {tags && <PostEditor key={editorRevision} initialValue={draftRef.current} tags={tags} submitLabel="발행" onChange={autosave} onSubmit={publish} submissionError={submitError} submissionActions={conflictActions} allowedImageOrigin={repository.publicAttachmentOrigin} auxiliaryActions={needsLogin ? <button type="button" className="secondary-action" onClick={() => void auth.signInWithGitHub(safeWritePath(currentPath))}>다시 로그인</button> : null} />}
  </main><footer className="community-footer"><span>BREADLAB · EDITORIAL DESK</span><a href="/community/">글 목록</a></footer></div>
}
