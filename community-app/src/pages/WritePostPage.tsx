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
  const draftRef = useRef<WriteDraft | null>(null)
  const lifecycle = useRef(0)
  const authUserId = useRef(auth.user?.id ?? null)
  authUserId.current = auth.user?.id ?? null
  if (!draftRef.current) draftRef.current = loadDraft(storage, 'write') ?? createWriteDraft()
  const restored = loadDraft(storage, 'write') !== null
  const [tags, setTags] = useState<CommunityTag[] | null>(null)
  const [tagError, setTagError] = useState<string | null>(null)
  const [tagAttempt, setTagAttempt] = useState(0)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [needsLogin, setNeedsLogin] = useState(false)
  const draftSaveFailed = useRef(false)

  useEffect(() => {
    draftSaveFailed.current = !saveDraft(storage, draftRef.current!)
  }, [storage])

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

  const autosave = useCallback((value: PostInput) => {
    const current = draftRef.current!
    const next: WriteDraft = { ...current, ...value, updatedAt: new Date().toISOString() }
    draftRef.current = next
    const saved = saveDraft(storage, next)
    draftSaveFailed.current = !saved
    if (!saved) setSubmitError('초안을 저장할 수 없습니다. 저장 공간과 브라우저 설정을 확인해 주세요.')
    return saved
  }, [storage])

  async function publish(value: PostInput) {
    setSubmitError(null); setNeedsLogin(false)
    if (draftSaveFailed.current) {
      setSubmitError('초안을 저장할 수 없어 발행하지 않았습니다. 저장 공간과 브라우저 설정을 확인해 주세요.')
      return
    }
    const current = draftRef.current!
    const currentSnapshot = readDraftSnapshot(storage, 'write')
    if (!currentSnapshot.ok) {
      setSubmitError('초안 저장소를 확인할 수 없어 발행하지 않았습니다. 브라우저 설정을 확인해 주세요.')
      return
    }
    if (currentSnapshot.raw !== null && !matchesDraftSnapshot(currentSnapshot, current)) {
      setSubmitError('다른 탭에서 초안이 변경되어 발행하지 않았습니다.')
      return
    }
    const saved = autosave(value)
    const submitted: WriteDraft = { ...draftRef.current!, tagIds: [...draftRef.current!.tagIds] }
    const submittedSnapshot = readDraftSnapshot(storage, 'write')
    if (!saved || !matchesDraftSnapshot(submittedSnapshot, submitted)) {
      setSubmitError(saved ? '다른 탭에서 초안이 변경되어 발행하지 않았습니다.' : '초안을 저장할 수 없어 발행하지 않았습니다. 저장 공간과 브라우저 설정을 확인해 주세요.')
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
      setSubmitError('다른 탭에서 초안이 변경되어 현재 화면을 이동하지 않았습니다.')
      return
    }
    clearDraft(storage, 'write')
    draftRef.current = createWriteDraft()
    navigate(`/community/post/?id=${result.data}`)
  }

  return <div className="community-page editor-page"><AppHeader /><main>
    <header className="editor-heading"><p className="post-detail-kicker">NEW COMMUNITY NOTE</p><h1>새 글 쓰기</h1><p>생각을 다듬어 기록하세요. 입력 내용은 이 기기에 안전하게 임시 저장됩니다.</p></header>
    <DraftNotice restored={restored} />
    {auth.loading && <p className="editor-auth-note" role="status">로그인 상태를 확인하고 있습니다. 작성 내용은 유지됩니다.</p>}
    {tagError && <section className="editor-load-state" role="alert"><p>{tagError}</p><button type="button" className="secondary-action" onClick={() => setTagAttempt(value => value + 1)}>태그 다시 불러오기</button></section>}
    {!tagError && !tags && <p className="editor-load-state" role="status">태그를 불러오고 있습니다.</p>}
    {tags && <PostEditor initialValue={draftRef.current} tags={tags} submitLabel="발행" onChange={autosave} onSubmit={publish} submissionError={submitError} allowedImageOrigin={repository.publicAttachmentOrigin} auxiliaryActions={needsLogin ? <button type="button" className="secondary-action" onClick={() => void auth.signInWithGitHub(safeWritePath(currentPath))}>다시 로그인</button> : null} />}
  </main><footer className="community-footer"><span>BREADLAB · EDITORIAL DESK</span><a href="/community/">글 목록</a></footer></div>
}
