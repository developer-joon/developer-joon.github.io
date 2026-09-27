import { useCallback, useEffect, useRef, useState } from 'react'
import { AppHeader } from '../components/AppHeader'
import { DraftNotice } from '../components/DraftNotice'
import { PostEditor } from '../components/PostEditor'
import { useAuth } from '../auth/AuthProvider'
import type { CommunityRepository } from '../data/communityRepository'
import { clearDraft, createEditDraft, loadDraft, saveDraft, type DraftStorage, type EditDraft } from '../lib/draftStore'
import { parsePostId } from '../lib/postQuery'
import { isStrictUuid, type PostInput } from '../lib/validation'
import type { CommunityTag, PostDetail, PublicPostRead } from '../types/community'

interface Props {
  repository: CommunityRepository
  search: string
  storage?: DraftStorage
  navigate?: (path: string) => void
  confirmDelete?: (message: string) => boolean
}

function State({ title, children }: { title: string; children?: React.ReactNode }) {
  return <section className="post-state"><p className="post-detail-kicker">EDITORIAL DESK</p><h1>{title}</h1>{children}<a className="post-list-link" href="/community/">커뮤니티 글 목록으로</a></section>
}

function stateTitle(read: Exclude<PublicPostRead, { kind: 'published' }>) {
  if (read.kind === 'not_found') return '게시글을 찾을 수 없습니다'
  if (read.kind === 'hidden') return '공개되지 않은 글은 수정할 수 없습니다'
  return '삭제된 글은 수정할 수 없습니다'
}

function sameEditDraft(draft: EditDraft, submitted: EditDraft) {
  return draft.postId === submitted.postId && draft.updatedAt === submitted.updatedAt
    && draft.title === submitted.title && draft.bodyMarkdown === submitted.bodyMarkdown
    && draft.tagIds.length === submitted.tagIds.length
    && draft.tagIds.every((tagId, index) => tagId === submitted.tagIds[index])
}

export function EditPostPage({ repository, search, storage = window.localStorage, navigate = path => window.location.assign(path), confirmDelete = message => window.confirm(message) }: Props) {
  const postId = parsePostId(search)
  const auth = useAuth()
  const [post, setPost] = useState<PostDetail | null>(null)
  const [readState, setReadState] = useState<Exclude<PublicPostRead, { kind: 'published' }> | null>(null)
  const [tags, setTags] = useState<CommunityTag[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [initialDraft, setInitialDraft] = useState<EditDraft | null>(null)
  const draftRef = useRef<EditDraft | null>(null)
  const lifecycle = useRef(0)
  const authUserId = useRef(auth.user?.id ?? null)
  authUserId.current = auth.user?.id ?? null
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [restoredDraft, setRestoredDraft] = useState(false)
  const [deletePending, setDeletePending] = useState(false)
  const deleteLock = useRef(false)

  useEffect(() => {
    const generation = ++lifecycle.current
    return () => { if (lifecycle.current === generation) lifecycle.current += 1 }
  }, [postId, repository, storage])

  useEffect(() => {
    if (!postId) return
    let active = true
    setLoadError(null); setPost(null); setReadState(null); setTags(null); setInitialDraft(null); setRestoredDraft(false)
    void Promise.all([repository.getPost(postId), repository.listTags()]).then(([postResult, tagResult]) => {
      if (!active) return
      if (!postResult.ok) { setLoadError(postResult.error.message); return }
      if (!tagResult.ok) { setLoadError(tagResult.error.message); return }
      setTags(tagResult.data)
      if (postResult.data.kind !== 'published') { setReadState(postResult.data); return }
      const serverPost = postResult.data.post
      if (serverPost.id !== postId) { setLoadError('서버 응답을 확인할 수 없습니다. 다시 시도해 주세요.'); return }
      const saved = loadDraft(storage, 'edit', postId)
      const serverDraft = createEditDraft(postId, serverPost.title, serverPost.bodyMarkdown, serverPost.tags.map(tag => tag.id), serverPost.updatedAt)
      const hasNewerDraft = Boolean(saved && Date.parse(saved.updatedAt) > Date.parse(serverPost.updatedAt))
      const chosen = hasNewerDraft ? saved! : serverDraft
      draftRef.current = chosen; setRestoredDraft(hasNewerDraft); setPost(serverPost); setInitialDraft(chosen)
    })
    return () => { active = false }
  }, [attempt, postId, repository, storage])

  const autosave = useCallback((value: PostInput) => {
    if (!postId || !draftRef.current) return
    const next: EditDraft = { ...draftRef.current, ...value, updatedAt: new Date().toISOString() }
    draftRef.current = next; saveDraft(storage, next)
  }, [postId, storage])

  async function update(value: PostInput) {
    if (!postId) return
    autosave(value); setSubmitError(null); setNeedsLogin(false)
    const generation = lifecycle.current
    const actorId = auth.user?.id ?? null
    const submitted = draftRef.current ? { ...draftRef.current, tagIds: [...draftRef.current.tagIds] } : null
    if (!actorId || !submitted) return
    const result = await repository.updatePost({ postId, ...value })
    if (generation !== lifecycle.current || authUserId.current !== actorId) return
    if (!result.ok) { setSubmitError(result.error.message); setNeedsLogin(result.error.code === 'auth_required'); return }
    if (!isStrictUuid(result.data) || result.data !== postId) { setSubmitError('서버 응답을 확인할 수 없습니다. 다시 시도해 주세요.'); return }
    const stored = loadDraft(storage, 'edit', postId)
    if (stored && !sameEditDraft(stored, submitted)) { setSubmitError('다른 탭에서 초안이 변경되어 현재 화면을 이동하지 않았습니다.'); return }
    clearDraft(storage, 'edit', postId); navigate(`/community/post/?id=${postId}`)
  }

  async function remove() {
    if (!postId || deleteLock.current || !confirmDelete('이 글을 삭제하시겠습니까? 삭제 후에는 본문을 복구할 수 없습니다.')) return
    deleteLock.current = true; setDeletePending(true); setSubmitError(null); setNeedsLogin(false)
    const generation = lifecycle.current
    const actorId = auth.user?.id ?? null
    const submitted = draftRef.current ? { ...draftRef.current, tagIds: [...draftRef.current.tagIds] } : null
    try {
      const result = await repository.deletePost(postId)
      if (generation !== lifecycle.current || authUserId.current !== actorId) return
      if (!result.ok) { setSubmitError(result.error.message); setNeedsLogin(result.error.code === 'auth_required'); return }
      if (!isStrictUuid(result.data) || result.data !== postId) { setSubmitError('서버 응답을 확인할 수 없습니다. 다시 시도해 주세요.'); return }
      const stored = loadDraft(storage, 'edit', postId)
      if (stored && submitted && !sameEditDraft(stored, submitted)) { setSubmitError('다른 탭에서 초안이 변경되어 현재 화면을 이동하지 않았습니다.'); return }
      clearDraft(storage, 'edit', postId); navigate(`/community/post/?id=${postId}`)
    } finally {
      deleteLock.current = false
      if (generation === lifecycle.current) setDeletePending(false)
    }
  }

  let content: React.ReactNode
  if (!postId) content = <State title="올바르지 않은 게시글 주소입니다" />
  else if (loadError) content = <State title={loadError}><button type="button" className="secondary-action" onClick={() => setAttempt(value => value + 1)}>다시 시도</button></State>
  else if (readState) content = <State title={stateTitle(readState)} />
  else if (!post || !tags || !initialDraft || auth.loading) content = <State title="수정할 글을 불러오고 있습니다" />
  else if (!auth.user || auth.user.id !== post.author.id) content = <State title="이 글을 수정할 권한이 없습니다" />
  else {
    const activeIds = new Set(tags.map(tag => tag.id))
    const unavailable = initialDraft.tagIds.filter(id => !activeIds.has(id)).map(id => post.tags.find(tag => tag.id === id)?.label ?? id)
    content = <><header className="editor-heading"><p className="post-detail-kicker">REVISE COMMUNITY NOTE</p><h1>글 수정</h1><p>수정과 삭제 권한은 서버에서도 현재 로그인 사용자 기준으로 다시 확인됩니다.</p></header><DraftNotice restored={restoredDraft} /><PostEditor initialValue={initialDraft} tags={tags} unavailableTagLabels={unavailable} submitLabel="수정" onChange={autosave} onSubmit={update} submissionError={submitError} allowedImageOrigin={repository.publicAttachmentOrigin} auxiliaryActions={<>{needsLogin && <button type="button" className="secondary-action" onClick={() => void auth.signInWithGitHub(`/community/edit/?id=${postId}`)}>다시 로그인</button>}<button type="button" className="danger-action" disabled={deletePending} onClick={() => void remove()}>{deletePending ? '삭제 중' : '글 삭제'}</button></>} /></>
  }

  return <div className="community-page editor-page"><AppHeader /><main>{content}</main><footer className="community-footer"><span>BREADLAB · EDITORIAL DESK</span><a href="/community/">글 목록</a></footer></div>
}
