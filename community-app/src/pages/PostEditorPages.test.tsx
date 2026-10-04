import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import { AuthContext, type AuthContextValue } from '../auth/AuthProvider'
import { DEFAULT_AUTH_PROVIDER } from '../auth/providers'
import type { CommunityRepository } from '../data/communityRepository'
import type { UploadRepository } from '../data/uploadRepository'
import { draftKey } from '../lib/draftStore'
import { withDraftLock } from '../lib/draftLock'
import { WritePostPage } from './WritePostPage'
import { EditPostPage } from './EditPostPage'

const postId = '56000000-0000-4000-8000-000000000010'
const authorId = '56000000-0000-4000-8000-000000000030'
const tag = { id: '56000000-0000-4000-8000-000000000040', slug: 'typescript', label: 'TypeScript' }
const post = { id: postId, title: '서버 제목', excerpt: '', bodyMarkdown: '서버 본문', createdAt: '2026-09-27T00:00:00Z', updatedAt: '2026-09-27T00:00:00Z', isLocked: false, isPinned: false, commentCount: 0, reactionCount: 0, popularityScore: 0, attachmentCount: 0, author: { id: authorId, login: 'bread', displayName: null, avatarUrl: null }, tags: [tag] }
const attachmentId = '56000000-0000-4000-8000-000000000070'
const uploadKey = '56000000-0000-4000-8000-000000000080'

function storage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) }, values }
}
function auth(userId: string | null): AuthContextValue {
  return { loading: false, pending: false, session: userId ? {} as never : null, user: userId ? { id: userId } as User : null, error: null, signIn: vi.fn(), signOut: vi.fn() }
}
function wrap(ui: React.ReactNode, value: AuthContextValue) { return render(<AuthContext.Provider value={value}>{ui}</AuthContext.Provider>) }
function repository(overrides: Partial<CommunityRepository> = {}) {
  return { publicAttachmentOrigin: 'https://example.com', listTags: vi.fn().mockResolvedValue({ ok: true, data: [tag] }), getPost: vi.fn().mockResolvedValue({ ok: true, data: { kind: 'published', post } }), createPost: vi.fn(), updatePost: vi.fn(), deletePost: vi.fn(), ...overrides } as unknown as CommunityRepository
}
function uploads(overrides: Partial<UploadRepository> = {}) {
  return {
    publicAttachmentUrl: (id: string) => `https://example.com/functions/v1/public-attachment/${id}`,
    upload: vi.fn().mockResolvedValue({ ok: true, data: { attachmentId, storagePath: `${authorId}/${uploadKey}`, mimeType: 'image/png', byteSize: 1, width: 1, height: 1, publicUrl: `https://example.com/functions/v1/public-attachment/${attachmentId}` } }),
    attach: vi.fn().mockResolvedValue({ ok: true, data: 1 }),
    discard: vi.fn().mockResolvedValue({ ok: true, data: true }),
    ...overrides,
  } as UploadRepository
}
function chooseImage(name = 'bread.png') {
  fireEvent.change(screen.getByLabelText('이미지 파일 선택'), { target: { files: [new File(['x'], name, { type: 'image/png' })] } })
}
beforeEach(() => {
  URL.createObjectURL = vi.fn((value: Blob) => `blob:${(value as File).name}`)
  URL.revokeObjectURL = vi.fn()
})
function fillValid() {
  fireEvent.change(screen.getByLabelText('제목'), { target: { value: '새 제목' } })
  fireEvent.change(screen.getByLabelText('본문'), { target: { value: '새 본문' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'TypeScript' }))
}

describe('WritePostPage', () => {
  it('describes local draft persistence without promising success', async () => {
    wrap(<WritePostPage repository={repository()} storage={storage()} navigate={vi.fn()} />, auth(authorId))
    expect(await screen.findByText('이 브라우저의 로컬 저장소에 임시 저장을 시도합니다.')).toBeInTheDocument()
    expect(screen.queryByText(/안전하게 임시 저장/)).not.toBeInTheDocument()
  })

  it('persists a fresh idempotency key before asynchronous tag loading completes', async () => {
    const local = storage()
    const repo = repository({ listTags: vi.fn(() => new Promise(() => undefined)) as CommunityRepository['listTags'] })

    wrap(<WritePostPage repository={repo} storage={local} navigate={vi.fn()} />, auth(authorId))

    await waitFor(() => expect(local.values.get(draftKey('write'))).toBeDefined())
    const stored = local.values.get(draftKey('write'))
    expect(JSON.parse(stored!).idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('restores draft before autosave and keeps its stable key across retry/remount', async () => {
    const local = storage()
    local.setItem(draftKey('write'), JSON.stringify({ version: 1, kind: 'write', title: '복원 제목', bodyMarkdown: '복원 본문', tagIds: [tag.id], updatedAt: '2026-09-27T01:00:00.000Z', idempotencyKey: '56000000-0000-4000-8000-000000000099' }))
    const createPost = vi.fn().mockResolvedValueOnce({ ok: false, error: { code: 'network', sourceCode: 'NETWORK_ERROR', message: '네트워크 연결을 확인해 주세요.' } }).mockResolvedValueOnce({ ok: true, data: postId })
    const repo = repository({ createPost }); const navigate = vi.fn(); const a = auth(authorId)
    const view = wrap(<WritePostPage repository={repo} storage={local} navigate={navigate} />, a)
    expect(await screen.findByDisplayValue('복원 제목')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '발행' }))
    await screen.findByText('네트워크 연결을 확인해 주세요.')
    expect(local.values.has(draftKey('write'))).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '발행' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/community/post/?id=${postId}`))
    expect(createPost.mock.calls[0][0].idempotencyKey).toBe(createPost.mock.calls[1][0].idempotencyKey)
    expect(local.values.has(draftKey('write'))).toBe(false)
    view.unmount()
  })

  it('keeps an anonymous draft and canonicalizes the full query and hash return path', async () => {
    const local = storage(); const a = auth(null)
    wrap(<WritePostPage repository={repository()} storage={local} navigate={vi.fn()} currentPath="/community/write?from=home#draft" />, a)
    await screen.findByRole('checkbox', { name: 'TypeScript' }); fillValid()
    fireEvent.click(screen.getByRole('button', { name: '발행' }))
    expect(a.signIn).toHaveBeenCalledWith(DEFAULT_AUTH_PROVIDER, '/community/write/?from=home#draft')
    expect(local.values.has(draftKey('write'))).toBe(true)
  })

  it('does not let a stale create response clear a replacement draft or navigate', async () => {
    let resolve!: (value: { ok: true; data: string }) => void
    const createPost = vi.fn(() => new Promise<{ ok: true; data: string }>(done => { resolve = done }))
    const local = storage(); const navigate = vi.fn()
    wrap(<WritePostPage repository={repository({ createPost })} storage={local} navigate={navigate} />, auth(authorId))
    await screen.findByRole('checkbox', { name: 'TypeScript' }); fillValid()
    fireEvent.click(screen.getByRole('button', { name: '발행' }))
    const replacement = { version: 1, kind: 'write', title: '다른 글', bodyMarkdown: '다른 본문', tagIds: [tag.id], updatedAt: '2026-09-27T04:00:00.000Z', idempotencyKey: '56000000-0000-4000-8000-000000000098' }
    local.setItem(draftKey('write'), JSON.stringify(replacement))
    resolve({ ok: true, data: postId })

    expect(await screen.findByText('다른 탭에서 초안이 변경되어 현재 화면을 이동하지 않았습니다.')).toBeInTheDocument()
    expect(JSON.parse(local.values.get(draftKey('write'))!)).toEqual(replacement)
    expect(navigate).not.toHaveBeenCalled()
  })

  it.each([
    ['malformed replacement', '{broken'],
    ['same content with a new timestamp', null],
  ])('does not clear a %s after a late create response', async (_case, replacementRaw) => {
    let resolve!: (value: { ok: true; data: string }) => void
    const createPost = vi.fn(() => new Promise<{ ok: true; data: string }>(done => { resolve = done }))
    const local = storage(); const navigate = vi.fn()
    wrap(<WritePostPage repository={repository({ createPost })} storage={local} navigate={navigate} />, auth(authorId))
    await screen.findByRole('checkbox', { name: 'TypeScript' }); fillValid()
    fireEvent.click(screen.getByRole('button', { name: '발행' }))
    const submitted = JSON.parse(local.values.get(draftKey('write'))!)
    const replacement = replacementRaw ?? JSON.stringify({ ...submitted, updatedAt: '2026-09-27T04:00:00.000Z' })
    local.setItem(draftKey('write'), replacement)
    resolve({ ok: true, data: postId })

    expect(await screen.findByText('다른 탭에서 초안이 변경되어 현재 화면을 이동하지 않았습니다.')).toBeInTheDocument()
    expect(local.values.get(draftKey('write'))).toBe(replacement)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('does not call create when the dispatch autosave cannot be persisted', async () => {
    const local = storage(); let blocked = false
    const failingStorage = { ...local, setItem: (key: string, value: string) => {
      if (blocked) { local.values.delete(key); throw new Error('quota') }
      local.setItem(key, value)
    } }
    const createPost = vi.fn(); const navigate = vi.fn()
    wrap(<WritePostPage repository={repository({ createPost })} storage={failingStorage} navigate={navigate} />, auth(authorId))
    await screen.findByRole('checkbox', { name: 'TypeScript' }); fillValid(); blocked = true
    fireEvent.click(screen.getByRole('button', { name: '발행' }))

    expect(await screen.findByText('초안을 저장할 수 없어 발행하지 않았습니다. 저장 공간과 브라우저 설정을 확인해 주세요.')).toBeInTheDocument()
    expect(createPost).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('retries and verifies the current canonical draft on a later submit after storage recovers', async () => {
    const local = storage(); let blocked = false
    const flakyStorage = { ...local, setItem: (key: string, value: string) => {
      if (blocked) throw new Error('quota')
      local.setItem(key, value)
    } }
    const createPost = vi.fn().mockResolvedValue({ ok: true, data: postId }); const navigate = vi.fn()
    wrap(<WritePostPage repository={repository({ createPost })} storage={flakyStorage} navigate={navigate} />, auth(authorId))
    await screen.findByRole('checkbox', { name: 'TypeScript' })
    blocked = true; fillValid()
    fireEvent.click(screen.getByRole('button', { name: '발행' }))
    expect(await screen.findByText(/초안을 저장할 수 없어 발행하지 않았습니다/)).toBeInTheDocument()
    blocked = false
    fireEvent.click(screen.getByRole('button', { name: '발행' }))

    await waitFor(() => expect(createPost).toHaveBeenCalledTimes(1))
    expect(createPost).toHaveBeenCalledWith(expect.objectContaining({ title: '새 제목', bodyMarkdown: '새 본문' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/community/post/?id=${postId}`))
  })

  it('pauses write autosave on a snapshot conflict until the user loads explicitly', async () => {
    const local = storage(); const createPost = vi.fn()
    wrap(<WritePostPage repository={repository({ createPost })} storage={local} navigate={vi.fn()} />, auth(authorId))
    await screen.findByRole('checkbox', { name: 'TypeScript' }); fillValid()
    const replacement = { version: 1, kind: 'write', title: '다른 탭 제목', bodyMarkdown: '다른 탭 본문', tagIds: [tag.id], updatedAt: '2026-09-27T04:00:00.000Z', idempotencyKey: '56000000-0000-4000-8000-000000000098' }
    local.setItem(draftKey('write'), JSON.stringify(replacement))
    fireEvent.click(screen.getByRole('button', { name: '발행' }))
    expect(await screen.findByRole('button', { name: '다른 탭 초안 불러오기' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '현재 내용으로 덮어쓰기' })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '충돌 뒤 현재 제목' } })
    expect(JSON.parse(local.values.get(draftKey('write'))!).title).toBe('다른 탭 제목')
    fireEvent.click(screen.getByRole('button', { name: '다른 탭 초안 불러오기' }))
    expect(await screen.findByDisplayValue('다른 탭 제목')).toBeInTheDocument()
  })

  it('detects a write replacement before the next autosave and does not overwrite it', async () => {
    const local = storage()
    wrap(<WritePostPage repository={repository()} storage={local} navigate={vi.fn()} />, auth(authorId))
    await screen.findByRole('checkbox', { name: 'TypeScript' })
    const replacement = { version: 1, kind: 'write', title: '다른 탭 제목', bodyMarkdown: '다른 탭 본문', tagIds: [tag.id], updatedAt: '2026-09-27T04:00:00.000Z', idempotencyKey: '56000000-0000-4000-8000-000000000098' }
    local.setItem(draftKey('write'), JSON.stringify(replacement))

    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '현재 탭 제목' } })

    expect(await screen.findByRole('button', { name: '현재 내용으로 덮어쓰기' })).toBeInTheDocument()
    expect(JSON.parse(local.values.get(draftKey('write'))!)).toEqual(replacement)
  })

  it('treats an initially unreadable write baseline as a conflict after storage recovers', async () => {
    const local = storage(); let unreadable = true
    const recoveringStorage = { ...local, getItem: (key: string) => {
      if (unreadable) throw new Error('blocked')
      return local.getItem(key)
    } }
    wrap(<WritePostPage repository={repository()} storage={recoveringStorage} navigate={vi.fn()} />, auth(authorId))
    await screen.findByRole('checkbox', { name: 'TypeScript' })
    unreadable = false
    const replacement = { version: 1, kind: 'write', title: '복구된 다른 초안', bodyMarkdown: '다른 본문', tagIds: [tag.id], updatedAt: '2026-09-27T04:00:00.000Z', idempotencyKey: '56000000-0000-4000-8000-000000000098' }
    local.setItem(draftKey('write'), JSON.stringify(replacement))

    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '현재 탭 제목' } })

    expect(await screen.findByRole('button', { name: '현재 내용으로 덮어쓰기' })).toBeInTheDocument()
    expect(JSON.parse(local.values.get(draftKey('write'))!)).toEqual(replacement)
  })

  it('keeps write conflict active when explicit overwrite content is not persistable', async () => {
    const local = storage()
    wrap(<WritePostPage repository={repository()} storage={local} navigate={vi.fn()} />, auth(authorId))
    await screen.findByRole('checkbox', { name: 'TypeScript' })
    const replacement = { version: 1, kind: 'write', title: '다른 탭', bodyMarkdown: '다른 본문', tagIds: [tag.id], updatedAt: '2026-09-27T04:00:00.000Z', idempotencyKey: '56000000-0000-4000-8000-000000000098' }
    local.setItem(draftKey('write'), JSON.stringify(replacement))
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '가'.repeat(121) } })
    const overwrite = await screen.findByRole('button', { name: '현재 내용으로 덮어쓰기' })

    fireEvent.click(overwrite)

    expect(await screen.findByText('현재 내용은 로컬 초안으로 저장할 수 없습니다. 입력 길이를 확인해 주세요.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '현재 내용으로 덮어쓰기' })).toBeInTheDocument()
    expect(JSON.parse(local.values.get(draftKey('write'))!)).toEqual(replacement)
  })

  it('does not overwrite a malformed replacement already present before create dispatch', async () => {
    const local = storage(); const createPost = vi.fn(); const navigate = vi.fn()
    wrap(<WritePostPage repository={repository({ createPost })} storage={local} navigate={navigate} />, auth(authorId))
    await screen.findByRole('checkbox', { name: 'TypeScript' }); fillValid()
    local.setItem(draftKey('write'), '{broken')
    fireEvent.click(screen.getByRole('button', { name: '발행' }))

    expect(await screen.findByText('다른 탭에서 초안이 변경되어 발행하지 않았습니다.')).toBeInTheDocument()
    expect(local.values.get(draftKey('write'))).toBe('{broken')
    expect(createPost).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('preserves draft and does not navigate for auth expiry or malformed success UUID', async () => {
    const local = storage(); const navigate = vi.fn()
    const createPost = vi.fn().mockResolvedValueOnce({ ok: false, error: { code: 'auth_required', sourceCode: 'PGRST301', message: '로그인이 필요합니다.' } }).mockResolvedValueOnce({ ok: true, data: 'bad-id' })
    const a = auth(authorId)
    wrap(<WritePostPage repository={repository({ createPost })} storage={local} navigate={navigate} />, a)
    await screen.findByRole('checkbox', { name: 'TypeScript' }); fillValid()
    fireEvent.click(screen.getByRole('button', { name: '발행' }))
    expect(await screen.findByText('로그인이 필요합니다.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다시 로그인' }))
    expect(a.signIn).toHaveBeenCalledWith(DEFAULT_AUTH_PROVIDER, '/community/write/')
    fireEvent.click(screen.getByRole('button', { name: '발행' }))
    expect(await screen.findByText('서버 응답을 확인할 수 없습니다. 다시 시도해 주세요.')).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled(); expect(local.values.has(draftKey('write'))).toBe(true)
  })

  it('holds the write lock through create, clear, and navigation before a cooperating replacement writer runs', async () => {
    let resolve!: (value: { ok: true; data: string }) => void
    const createPost = vi.fn(() => new Promise<{ ok: true; data: string }>(done => { resolve = done }))
    const local = storage(); const navigate = vi.fn()
    wrap(<WritePostPage repository={repository({ createPost })} storage={local} navigate={navigate} />, auth(authorId))
    await screen.findByRole('checkbox', { name: 'TypeScript' }); fillValid()
    fireEvent.click(screen.getByRole('button', { name: '발행' }))
    await waitFor(() => expect(createPost).toHaveBeenCalledTimes(1))
    const replacement = JSON.stringify({ version: 1, kind: 'write', title: '다음 글', bodyMarkdown: '다음 본문', tagIds: [tag.id], updatedAt: '2026-09-27T04:00:00.000Z', idempotencyKey: '56000000-0000-4000-8000-000000000098' })
    let replacementWritten = false
    const writer = withDraftLock(draftKey('write'), () => { replacementWritten = true; local.setItem(draftKey('write'), replacement) })

    await Promise.resolve()
    expect(replacementWritten).toBe(false)
    resolve({ ok: true, data: postId })
    await writer

    expect(createPost).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith(`/community/post/?id=${postId}`)
    expect(local.values.get(draftKey('write'))).toBe(replacement)
  })

  it('serializes autosave compare/write before a cooperating writer', async () => {
    const local = storage(); const key = draftKey('write'); const events: string[] = []
    let trigger = false; let writer: Promise<void> | undefined
    const observedStorage = {
      ...local,
      getItem: (requested: string) => {
        const value = local.getItem(requested)
        if (trigger && requested === key && !writer) writer = withDraftLock(key, () => { events.push('writer'); local.setItem(key, '{replacement}') })
        return value
      },
      setItem: (requested: string, value: string) => {
        if (trigger && requested === key) events.push('autosave')
        local.setItem(requested, value)
      },
    }
    wrap(<WritePostPage repository={repository()} storage={observedStorage} navigate={vi.fn()} />, auth(authorId))
    await screen.findByRole('checkbox', { name: 'TypeScript' })
    await waitFor(() => expect(local.values.has(key)).toBe(true))

    trigger = true
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '잠금 제목' } })
    await waitFor(() => expect(writer).toBeDefined())
    await writer

    expect(events).toEqual(['autosave', 'writer'])
    expect(local.values.get(key)).toBe('{replacement}')
  })

  it('fails closed with an accessible error when Web Locks are unavailable', async () => {
    const local = storage(); const createPost = vi.fn(); const navigate = vi.fn()
    wrap(<WritePostPage repository={repository({ createPost })} storage={local} navigate={navigate} />, auth(authorId))
    await screen.findByRole('checkbox', { name: 'TypeScript' })
    await waitFor(() => expect(local.values.has(draftKey('write'))).toBe(true))
    const before = local.values.get(draftKey('write'))
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })

    fillValid()
    fireEvent.click(screen.getByRole('button', { name: '발행' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('초안 잠금을 사용할 수 없어 발행하지 않았습니다. 브라우저 설정을 확인해 주세요.')
    expect(local.values.get(draftKey('write'))).toBe(before)
    expect(createPost).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('blocks direct submit while an upload is pending', async () => {
    const upload = vi.fn<UploadRepository['upload']>(() => new Promise(() => undefined)); const createPost = vi.fn()
    wrap(<WritePostPage repository={repository({ createPost })} uploadRepository={uploads({ upload })} storage={storage()} navigate={vi.fn()} />, auth(authorId))
    await screen.findByRole('checkbox', { name: 'TypeScript' }); fillValid(); chooseImage()
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    fireEvent.submit(screen.getByRole('button', { name: '발행' }).closest('form')!)
    expect(createPost).not.toHaveBeenCalled()
  })

  it('remounts the uploader on actor switch without reporting or replacing the prior actor attachment', async () => {
    const local = storage(); const uploadRepo = uploads()
    const firstActor = auth(authorId); const secondActorId = '56000000-0000-4000-8000-000000000031'; const secondActor = auth(secondActorId)
    const view = wrap(<WritePostPage repository={repository()} uploadRepository={uploadRepo} storage={local} navigate={vi.fn()} />, firstActor)
    await screen.findByRole('checkbox', { name: 'TypeScript' }); chooseImage()
    await screen.findByText('업로드 완료')
    await waitFor(() => expect(JSON.parse(local.values.get(draftKey('write'))!).uploadWorkflow.ownerId).toBe(authorId))

    view.rerender(<AuthContext.Provider value={secondActor}><WritePostPage repository={repository()} uploadRepository={uploadRepo} storage={local} navigate={vi.fn()} /></AuthContext.Provider>)

    await waitFor(() => expect(screen.queryByText('bread.png')).not.toBeInTheDocument())
    expect(screen.getByLabelText('이미지 파일 선택')).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('다른 계정에서 업로드')
    fireEvent.click(screen.getByRole('button', { name: '계정 바꾸기' }))
    expect(secondActor.signOut).toHaveBeenCalledOnce()
    expect(JSON.parse(local.values.get(draftKey('write'))!).uploadWorkflow.ownerId).toBe(authorId)
  })

  it('persists attach failure and resumes exact IDs without creating twice after reload', async () => {
    const local = storage(); const navigate = vi.fn(); const createPost = vi.fn().mockResolvedValue({ ok: true, data: postId })
    const attach = vi.fn().mockResolvedValueOnce({ ok: false, error: { code: 'network', message: '연결 실패' } }).mockResolvedValueOnce({ ok: true, data: 1 })
    const uploadRepo = uploads({ attach })
    const first = wrap(<WritePostPage repository={repository({ createPost })} uploadRepository={uploadRepo} storage={local} navigate={navigate} />, auth(authorId))
    await screen.findByRole('checkbox', { name: 'TypeScript' }); fillValid(); chooseImage()
    await screen.findByText('업로드 완료')
    await waitFor(() => expect(JSON.parse(local.values.get(draftKey('write'))!).uploadWorkflow.phase).toBe('uploaded'))
    fireEvent.click(screen.getByRole('button', { name: '발행' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('연결 실패')
    expect(navigate).not.toHaveBeenCalled()
    expect(JSON.parse(local.values.get(draftKey('write'))!).uploadWorkflow.phase).toBe('attaching')
    first.unmount()

    wrap(<WritePostPage repository={repository({ createPost })} uploadRepository={uploadRepo} storage={local} navigate={navigate} />, auth(authorId))
    await waitFor(() => expect(attach).toHaveBeenCalledTimes(2))
    expect(createPost).toHaveBeenCalledTimes(1)
    expect(attach.mock.calls[1][1]).toEqual([attachmentId])
    expect(navigate).toHaveBeenCalledWith(`/community/post/?id=${postId}`)
  })

  it('retries a failed attach checkpoint in the current write session', async () => {
    const local = storage(); const navigate = vi.fn(); const createPost = vi.fn().mockResolvedValue({ ok: true, data: postId })
    let resolveRetry!: (value: { ok: true; data: number }) => void
    const retry = new Promise<{ ok: true; data: number }>(resolve => { resolveRetry = resolve })
    const attach = vi.fn().mockResolvedValueOnce({ ok: false, error: { code: 'network', message: '연결 실패' } }).mockImplementationOnce(() => retry)
    wrap(<WritePostPage repository={repository({ createPost })} uploadRepository={uploads({ attach })} storage={local} navigate={navigate} />, auth(authorId))
    await screen.findByRole('checkbox', { name: 'TypeScript' }); fillValid(); chooseImage(); await screen.findByText('업로드 완료')
    await waitFor(() => expect(JSON.parse(local.values.get(draftKey('write'))!).uploadWorkflow.phase).toBe('uploaded'))
    fireEvent.click(screen.getByRole('button', { name: '발행' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('연결 실패')

    const retryButton = screen.getByRole('button', { name: '첨부 연결 다시 시도' })
    fireEvent.click(retryButton)
    await waitFor(() => expect(retryButton).toBeDisabled())
    fireEvent.click(retryButton)
    resolveRetry({ ok: true, data: 1 })

    await waitFor(() => expect(attach).toHaveBeenCalledTimes(2))
    expect(createPost).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith(`/community/post/?id=${postId}`)
  })

  it('ignores an in-flight attach after upload repository replacement and resumes with the new repository', async () => {
    const local = storage(); const navigate = vi.fn(); const createPost = vi.fn().mockResolvedValue({ ok: true, data: postId }); const communityRepo = repository({ createPost }); const actor = auth(authorId)
    let resolveOld!: (value: { ok: true; data: number }) => void
    const oldAttach = vi.fn(() => new Promise<{ ok: true; data: number }>(resolve => { resolveOld = resolve }))
    const newAttach = vi.fn().mockResolvedValue({ ok: true, data: 1 })
    const oldDiscard = vi.fn().mockResolvedValue({ ok: true, data: true })
    const firstUploadRepo = uploads({ attach: oldAttach, discard: oldDiscard }); const secondUploadRepo = uploads({ attach: newAttach })
    const view = wrap(<WritePostPage repository={communityRepo} uploadRepository={firstUploadRepo} storage={local} navigate={navigate} />, actor)
    await screen.findByRole('checkbox', { name: 'TypeScript' }); fillValid(); chooseImage(); await screen.findByText('업로드 완료')
    await waitFor(() => expect(JSON.parse(local.values.get(draftKey('write'))!).uploadWorkflow.phase).toBe('uploaded'))
    fireEvent.click(screen.getByRole('button', { name: '발행' }))
    await waitFor(() => expect(oldAttach).toHaveBeenCalledOnce())

    view.rerender(<AuthContext.Provider value={actor}><WritePostPage repository={communityRepo} uploadRepository={secondUploadRepo} storage={local} navigate={navigate} /></AuthContext.Provider>)
    resolveOld({ ok: true, data: 1 })

    await waitFor(() => expect(newAttach).toHaveBeenCalledOnce())
    expect(oldDiscard).not.toHaveBeenCalled()
    expect(newAttach.mock.calls[0][1]).toEqual([attachmentId])
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/community/post/?id=${postId}`))
  })

  it('preserves a replacement draft that appears while write attach is pending', async () => {
    const local = storage(); const navigate = vi.fn(); const createPost = vi.fn().mockResolvedValue({ ok: true, data: postId })
    let resolveAttach!: (value: { ok: true; data: number }) => void
    const pending = new Promise<{ ok: true; data: number }>(resolve => { resolveAttach = resolve })
    const attach = vi.fn(() => pending)
    wrap(<WritePostPage repository={repository({ createPost })} uploadRepository={uploads({ attach })} storage={local} navigate={navigate} />, auth(authorId))
    await screen.findByRole('checkbox', { name: 'TypeScript' }); fillValid(); chooseImage(); await screen.findByText('업로드 완료')
    await waitFor(() => expect(JSON.parse(local.values.get(draftKey('write'))!).uploadWorkflow.phase).toBe('uploaded'))
    fireEvent.click(screen.getByRole('button', { name: '발행' }))
    await waitFor(() => expect(attach).toHaveBeenCalledOnce())
    local.setItem(draftKey('write'), '{"replacement":true}')
    resolveAttach({ ok: true, data: 1 })

    await screen.findByRole('alert')
    expect(local.values.get(draftKey('write'))).toBe('{"replacement":true}')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('rolls back to uploaded and retries create when the post-created checkpoint cannot be verified', async () => {
    const local = storage(); const createPost = vi.fn().mockResolvedValue({ ok: true, data: postId }); const attach = vi.fn().mockResolvedValue({ ok: true, data: 1 }); const navigate = vi.fn()
    let rejectCheckpoint = false
    const guarded = { ...local, setItem: (key: string, value: string) => {
      if (rejectCheckpoint && value.includes('post-created')) { rejectCheckpoint = false; throw new Error('quota') }
      local.setItem(key, value)
    } }
    wrap(<WritePostPage repository={repository({ createPost })} uploadRepository={uploads({ attach })} storage={guarded} navigate={navigate} />, auth(authorId))
    await screen.findByRole('checkbox', { name: 'TypeScript' }); fillValid(); chooseImage(); await screen.findByText('업로드 완료')
    await waitFor(() => expect(JSON.parse(local.values.get(draftKey('write'))!).uploadWorkflow.phase).toBe('uploaded'))
    rejectCheckpoint = true
    fireEvent.click(screen.getByRole('button', { name: '발행' }))
    await waitFor(() => expect(createPost).toHaveBeenCalledTimes(1))
    expect(attach).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled()
    expect(JSON.parse(local.values.get(draftKey('write'))!).uploadWorkflow.phase).toBe('uploaded')
    fireEvent.click(screen.getByRole('button', { name: '발행' }))
    await waitFor(() => expect(createPost).toHaveBeenCalledTimes(2))
    expect(createPost.mock.calls[1][0].idempotencyKey).toBe(createPost.mock.calls[0][0].idempotencyKey)
    expect(attach).toHaveBeenCalledOnce()
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/community/post/?id=${postId}`))
  })

  it('skips attach for manual image Markdown and for a no-upload post', async () => {
    const createPost = vi.fn().mockResolvedValue({ ok: true, data: postId }); const attach = vi.fn(); const navigate = vi.fn()
    wrap(<WritePostPage repository={repository({ createPost })} uploadRepository={uploads({ attach })} storage={storage()} navigate={navigate} />, auth(authorId))
    await screen.findByRole('checkbox', { name: 'TypeScript' }); fillValid()
    fireEvent.change(screen.getByLabelText('본문'), { target: { value: '![수동](https://example.com/functions/v1/public-attachment/56000000-0000-4000-8000-000000000071)' } })
    fireEvent.click(screen.getByRole('button', { name: '발행' }))
    await waitFor(() => expect(navigate).toHaveBeenCalled())
    expect(attach).not.toHaveBeenCalled()
  })
})

describe('EditPostPage', () => {
  it('announces an edit-load lock failure and focuses its retry action', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })

    wrap(<EditPostPage repository={repository()} search={`?id=${postId}`} storage={storage()} navigate={vi.fn()} />, auth(authorId))

    expect(await screen.findByRole('alert')).toHaveTextContent('초안 잠금을 사용할 수 없어 수정 화면을 열 수 없습니다. 브라우저 설정을 확인해 주세요.')
    await waitFor(() => expect(screen.getByRole('button', { name: '다시 시도' })).toHaveFocus())
  })

  it.each([
    ['?id=bad', '올바르지 않은 게시글 주소입니다', undefined],
    [`?id=${postId}`, '게시글을 찾을 수 없습니다', { kind: 'not_found' }],
    [`?id=${postId}`, '공개되지 않은 글은 수정할 수 없습니다', { kind: 'hidden' }],
    [`?id=${postId}`, '삭제된 글은 수정할 수 없습니다', { kind: 'deleted', commentCount: 0 }],
  ])('handles invalid/non-editable state %#', async (search, message, data) => {
    const repo = repository(data ? { getPost: vi.fn().mockResolvedValue({ ok: true, data }) } : {})
    wrap(<EditPostPage repository={repo} search={search} storage={storage()} navigate={vi.fn()} />, auth(authorId))
    expect(await screen.findByRole('heading', { name: message })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '수정' })).not.toBeInTheDocument()
  })

  it('forbids a different owner without mutation controls', async () => {
    wrap(<EditPostPage repository={repository()} search={`?id=${postId}`} storage={storage()} navigate={vi.fn()} />, auth('56000000-0000-4000-8000-000000000031'))
    expect(await screen.findByRole('heading', { name: '이 글을 수정할 권한이 없습니다' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '수정' })).not.toBeInTheDocument()
  })

  it('shows signed-out users a login-required action preserving the canonical full edit URL', async () => {
    const a = auth(null)
    wrap(<EditPostPage repository={repository()} search={`?id=${postId}&from=list`} currentPath={`/community/edit?id=${postId}&from=list#editor`} storage={storage()} navigate={vi.fn()} />, a)
    expect(await screen.findByRole('heading', { name: '로그인이 필요합니다' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '로그인하고 수정하기' }))
    expect(a.signIn).toHaveBeenCalledWith(DEFAULT_AUTH_PROVIDER, `/community/edit/?id=${postId}&from=list#editor`)
    expect(screen.queryByRole('heading', { name: '이 글을 수정할 권한이 없습니다' })).not.toBeInTheDocument()
  })

  it('restores a newer edit draft and blocks inactive tags until replaced', async () => {
    const local = storage()
    local.setItem(draftKey('edit', postId), JSON.stringify({ version: 1, kind: 'edit', postId, title: '드래프트 제목', bodyMarkdown: '드래프트 본문', tagIds: ['56000000-0000-4000-8000-000000000099'], updatedAt: '2026-09-27T02:00:00.000Z' }))
    wrap(<EditPostPage repository={repository()} search={`?id=${postId}`} storage={local} navigate={vi.fn()} />, auth(authorId))
    expect(await screen.findByDisplayValue('드래프트 제목')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('현재 사용할 수 없는 태그')
  })

  it('keeps content on update failure and validates matching UUID on success', async () => {
    const local = storage(); const navigate = vi.fn(); const updatePost = vi.fn().mockResolvedValueOnce({ ok: false, error: { code: 'network', sourceCode: 'NETWORK_ERROR', message: '네트워크 연결을 확인해 주세요.' } }).mockResolvedValueOnce({ ok: true, data: '56000000-0000-4000-8000-000000000011' })
    wrap(<EditPostPage repository={repository({ updatePost })} search={`?id=${postId}`} storage={local} navigate={navigate} />, auth(authorId))
    expect(await screen.findByDisplayValue('서버 제목')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '수정' })); await screen.findByText('네트워크 연결을 확인해 주세요.')
    expect(screen.getByDisplayValue('서버 본문')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '수정' }))
    expect(await screen.findByText('서버 응답을 확인할 수 없습니다. 다시 시도해 주세요.')).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('ignores an update completion after the editor unmounts', async () => {
    let resolve!: (value: { ok: true; data: string }) => void
    const updatePost = vi.fn(() => new Promise<{ ok: true; data: string }>(done => { resolve = done }))
    const local = storage(); const navigate = vi.fn()
    const view = wrap(<EditPostPage repository={repository({ updatePost })} search={`?id=${postId}`} storage={local} navigate={navigate} />, auth(authorId))
    await screen.findByDisplayValue('서버 제목')
    fireEvent.click(screen.getByRole('button', { name: '수정' }))
    view.unmount()
    resolve({ ok: true, data: postId })
    await Promise.resolve()

    expect(navigate).not.toHaveBeenCalled()
    expect(local.values.has(draftKey('edit', postId))).toBe(true)
  })

  it('ignores an update completion after the authenticated user changes', async () => {
    let resolve!: (value: { ok: true; data: string }) => void
    const updatePost = vi.fn(() => new Promise<{ ok: true; data: string }>(done => { resolve = done }))
    const repo = repository({ updatePost }); const local = storage(); const navigate = vi.fn(); const firstActor = auth(authorId); const secondActor = auth('56000000-0000-4000-8000-000000000031')
    const view = wrap(<EditPostPage repository={repo} search={`?id=${postId}`} storage={local} navigate={navigate} />, firstActor)
    await screen.findByDisplayValue('서버 제목')
    fireEvent.click(screen.getByRole('button', { name: '수정' }))
    view.rerender(<AuthContext.Provider value={secondActor}><EditPostPage repository={repo} search={`?id=${postId}`} storage={local} navigate={navigate} /></AuthContext.Provider>)
    resolve({ ok: true, data: postId })
    await Promise.resolve()

    expect(navigate).not.toHaveBeenCalled()
    expect(local.values.has(draftKey('edit', postId))).toBe(true)
    view.rerender(<AuthContext.Provider value={firstActor}><EditPostPage repository={repo} search={`?id=${postId}`} storage={local} navigate={navigate} /></AuthContext.Provider>)
    expect(await screen.findByRole('button', { name: '수정' })).toBeEnabled()
  })

  it('releases only its own pending state after repository replacement', async () => {
    let resolve!: (value: { ok: true; data: string }) => void
    const updatePost = vi.fn(() => new Promise<{ ok: true; data: string }>(done => { resolve = done }))
    const firstRepository = repository({ updatePost }); const secondRepository = repository(); const local = storage(); const navigate = vi.fn(); const actor = auth(authorId)
    const view = wrap(<EditPostPage repository={firstRepository} search={`?id=${postId}`} storage={local} navigate={navigate} />, actor)
    await screen.findByDisplayValue('서버 제목')
    fireEvent.click(screen.getByRole('button', { name: '수정' }))
    view.rerender(<AuthContext.Provider value={actor}><EditPostPage repository={secondRepository} search={`?id=${postId}`} storage={local} navigate={navigate} /></AuthContext.Provider>)
    resolve({ ok: true, data: postId })

    expect(await screen.findByRole('button', { name: '수정' })).toBeEnabled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('does not clear a malformed replacement edit draft after a late update response', async () => {
    let resolve!: (value: { ok: true; data: string }) => void
    const updatePost = vi.fn(() => new Promise<{ ok: true; data: string }>(done => { resolve = done }))
    const local = storage(); const navigate = vi.fn()
    wrap(<EditPostPage repository={repository({ updatePost })} search={`?id=${postId}`} storage={local} navigate={navigate} />, auth(authorId))
    await screen.findByDisplayValue('서버 제목')
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '수정 제목' } })
    fireEvent.click(screen.getByRole('button', { name: '수정' }))
    local.setItem(draftKey('edit', postId), '{broken')
    resolve({ ok: true, data: postId })

    expect(await screen.findByText('다른 탭에서 초안이 변경되어 현재 화면을 이동하지 않았습니다.')).toBeInTheDocument()
    expect(local.values.get(draftKey('edit', postId))).toBe('{broken')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('does not call update after an edit autosave failure', async () => {
    const local = storage(); let blocked = false
    const failingStorage = { ...local, setItem: (key: string, value: string) => {
      if (blocked) throw new Error('quota')
      local.setItem(key, value)
    } }
    const updatePost = vi.fn(); const navigate = vi.fn()
    wrap(<EditPostPage repository={repository({ updatePost })} search={`?id=${postId}`} storage={failingStorage} navigate={navigate} />, auth(authorId))
    await screen.findByDisplayValue('서버 제목'); blocked = true
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '저장 실패 제목' } })
    fireEvent.click(screen.getByRole('button', { name: '수정' }))

    expect(await screen.findByText('초안을 저장할 수 없어 수정하지 않았습니다. 저장 공간과 브라우저 설정을 확인해 주세요.')).toBeInTheDocument()
    expect(updatePost).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('retries the current edit draft on submit after transient storage recovery without another edit', async () => {
    const local = storage(); let blocked = false
    const flakyStorage = { ...local, setItem: (key: string, value: string) => {
      if (blocked) throw new Error('quota')
      local.setItem(key, value)
    } }
    const updatePost = vi.fn().mockResolvedValue({ ok: true, data: postId }); const navigate = vi.fn()
    wrap(<EditPostPage repository={repository({ updatePost })} search={`?id=${postId}`} storage={flakyStorage} navigate={navigate} />, auth(authorId))
    await screen.findByDisplayValue('서버 제목'); blocked = true
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '저장 복구 제목' } })
    fireEvent.click(screen.getByRole('button', { name: '수정' }))
    expect(await screen.findByText(/초안을 저장할 수 없어 수정하지 않았습니다/)).toBeInTheDocument()
    blocked = false
    fireEvent.click(screen.getByRole('button', { name: '수정' }))
    await waitFor(() => expect(updatePost).toHaveBeenCalledWith(expect.objectContaining({ title: '저장 복구 제목' })))
    expect(navigate).toHaveBeenCalledWith(`/community/post/?id=${postId}`)
  })

  it('prevents delete while update is pending and disables all controls', async () => {
    let resolve!: (value: { ok: true; data: string }) => void
    const updatePost = vi.fn(() => new Promise<{ ok: true; data: string }>(done => { resolve = done }))
    const deletePost = vi.fn()
    wrap(<EditPostPage repository={repository({ updatePost, deletePost })} search={`?id=${postId}`} storage={storage()} navigate={vi.fn()} confirmDelete={() => true} />, auth(authorId))
    await screen.findByDisplayValue('서버 제목')
    const deleteButton = screen.getByRole('button', { name: '글 삭제' })
    fireEvent.click(screen.getByRole('button', { name: '수정' }))
    expect(deleteButton).toBeDisabled()
    expect(screen.getByLabelText('제목')).toBeDisabled()
    fireEvent.click(deleteButton)
    expect(deletePost).not.toHaveBeenCalled()
    resolve({ ok: true, data: postId })
  })

  it('prevents update while delete is pending', async () => {
    let resolve!: (value: { ok: true; data: string }) => void
    const deletePost = vi.fn(() => new Promise<{ ok: true; data: string }>(done => { resolve = done }))
    const updatePost = vi.fn()
    wrap(<EditPostPage repository={repository({ updatePost, deletePost })} search={`?id=${postId}`} storage={storage()} navigate={vi.fn()} confirmDelete={() => true} />, auth(authorId))
    await screen.findByDisplayValue('서버 제목')
    const updateButton = screen.getByRole('button', { name: '수정' })
    fireEvent.click(screen.getByRole('button', { name: '글 삭제' }))
    expect(updateButton).toBeDisabled()
    fireEvent.submit(updateButton.closest('form')!)
    expect(updatePost).not.toHaveBeenCalled()
    resolve({ ok: true, data: postId })
  })

  it('pauses edit autosave during conflict and overwrites only after explicit verified choice', async () => {
    const local = storage(); const updatePost = vi.fn()
    wrap(<EditPostPage repository={repository({ updatePost })} search={`?id=${postId}`} storage={local} navigate={vi.fn()} />, auth(authorId))
    await screen.findByDisplayValue('서버 제목')
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '현재 제목' } })
    const replacement = { version: 1, kind: 'edit', postId, title: '다른 탭 제목', bodyMarkdown: '다른 탭 본문', tagIds: [tag.id], updatedAt: '2026-09-27T04:00:00.000Z' }
    local.setItem(draftKey('edit', postId), JSON.stringify(replacement))
    fireEvent.click(screen.getByRole('button', { name: '수정' }))
    expect(await screen.findByRole('button', { name: '현재 내용으로 덮어쓰기' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '충돌 뒤 현재 제목' } })
    expect(JSON.parse(local.values.get(draftKey('edit', postId))!).title).toBe('다른 탭 제목')
    fireEvent.click(screen.getByRole('button', { name: '현재 내용으로 덮어쓰기' }))
    expect(JSON.parse(local.values.get(draftKey('edit', postId))!).title).toBe('충돌 뒤 현재 제목')
    expect(screen.queryByRole('button', { name: '현재 내용으로 덮어쓰기' })).not.toBeInTheDocument()
  })

  it('detects an edit replacement before the next autosave and does not overwrite it', async () => {
    const local = storage()
    wrap(<EditPostPage repository={repository()} search={`?id=${postId}`} storage={local} navigate={vi.fn()} />, auth(authorId))
    await screen.findByDisplayValue('서버 제목')
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '첫 현재 제목' } })
    const replacement = { version: 1, kind: 'edit', postId, title: '다른 탭 제목', bodyMarkdown: '다른 탭 본문', tagIds: [tag.id], updatedAt: '2026-09-27T04:00:00.000Z' }
    local.setItem(draftKey('edit', postId), JSON.stringify(replacement))

    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '두 번째 현재 제목' } })

    expect(await screen.findByRole('button', { name: '현재 내용으로 덮어쓰기' })).toBeInTheDocument()
    expect(JSON.parse(local.values.get(draftKey('edit', postId))!)).toEqual(replacement)
  })

  it('does not overwrite a replacement that appears after a failed edit autosave', async () => {
    const local = storage(); let blocked = false
    const flakyStorage = { ...local, setItem: (key: string, value: string) => {
      if (blocked) throw new Error('quota')
      local.setItem(key, value)
    } }
    wrap(<EditPostPage repository={repository()} search={`?id=${postId}`} storage={flakyStorage} navigate={vi.fn()} />, auth(authorId))
    await screen.findByDisplayValue('서버 제목')
    blocked = true
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '저장 실패 제목' } })
    blocked = false
    const replacement = { version: 1, kind: 'edit', postId, title: '다른 탭 제목', bodyMarkdown: '다른 탭 본문', tagIds: [tag.id], updatedAt: '2026-09-27T04:00:00.000Z' }
    local.setItem(draftKey('edit', postId), JSON.stringify(replacement))

    fireEvent.click(screen.getByRole('button', { name: '수정' }))

    expect(await screen.findByRole('button', { name: '현재 내용으로 덮어쓰기' })).toBeInTheDocument()
    expect(JSON.parse(local.values.get(draftKey('edit', postId))!)).toEqual(replacement)
  })

  it('retains an edit draft and offers safe re-login when the session expires', async () => {
    const local = storage(); const a = auth(authorId)
    const updatePost = vi.fn().mockResolvedValue({ ok: false, error: { code: 'auth_required', sourceCode: 'PGRST301', message: '로그인이 필요합니다.' } })
    wrap(<EditPostPage repository={repository({ updatePost })} search={`?id=${postId}`} storage={local} navigate={vi.fn()} />, a)
    await screen.findByDisplayValue('서버 제목')
    fireEvent.click(screen.getByRole('button', { name: '수정' }))
    expect(await screen.findByText('로그인이 필요합니다.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다시 로그인' }))
    expect(a.signIn).toHaveBeenCalledWith(DEFAULT_AUTH_PROVIDER, `/community/edit/?id=${postId}`)
    expect(local.values.has(draftKey('edit', postId))).toBe(true)
  })

  it('requires confirmation, cancels without RPC, and keeps the draft on delete failure', async () => {
    const local = storage(); const deletePost = vi.fn().mockResolvedValue({ ok: false, error: { code: 'network', sourceCode: 'NETWORK_ERROR', message: '네트워크 연결을 확인해 주세요.' } }); const confirmDelete = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    wrap(<EditPostPage repository={repository({ deletePost })} search={`?id=${postId}`} storage={local} navigate={vi.fn()} confirmDelete={confirmDelete} />, auth(authorId))
    await screen.findByDisplayValue('서버 제목')
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '삭제 전 수정한 제목' } })
    fireEvent.click(screen.getByRole('button', { name: '글 삭제' })); expect(deletePost).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '글 삭제' })); expect(await screen.findByText('네트워크 연결을 확인해 주세요.')).toBeInTheDocument()
    expect(deletePost).toHaveBeenCalledTimes(1); expect(local.values.has(draftKey('edit', postId))).toBe(true)
  })

  it('does not clear a replacement draft after a late delete response', async () => {
    let resolve!: (value: { ok: true; data: string }) => void
    const deletePost = vi.fn(() => new Promise<{ ok: true; data: string }>(done => { resolve = done }))
    const local = storage(); const navigate = vi.fn()
    wrap(<EditPostPage repository={repository({ deletePost })} search={`?id=${postId}`} storage={local} navigate={navigate} confirmDelete={() => true} />, auth(authorId))
    await screen.findByDisplayValue('서버 제목')
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '삭제 대상 제목' } })
    fireEvent.click(screen.getByRole('button', { name: '글 삭제' }))
    local.setItem(draftKey('edit', postId), '{broken')
    resolve({ ok: true, data: postId })

    expect(await screen.findByText('다른 탭에서 초안이 변경되어 현재 화면을 이동하지 않았습니다.')).toBeInTheDocument()
    expect(local.values.get(draftKey('edit', postId))).toBe('{broken')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('does not call delete when a malformed replacement exists before dispatch', async () => {
    const local = storage(); const deletePost = vi.fn(); const navigate = vi.fn()
    wrap(<EditPostPage repository={repository({ deletePost })} search={`?id=${postId}`} storage={local} navigate={navigate} confirmDelete={() => true} />, auth(authorId))
    await screen.findByDisplayValue('서버 제목')
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '삭제 대상 제목' } })
    local.setItem(draftKey('edit', postId), '{broken')
    fireEvent.click(screen.getByRole('button', { name: '글 삭제' }))

    expect(await screen.findByText('다른 탭에서 초안이 변경되어 삭제하지 않았습니다.')).toBeInTheDocument()
    expect(local.values.get(draftKey('edit', postId))).toBe('{broken')
    expect(deletePost).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('holds the shared edit lock through update completion before a cooperating replacement writer runs', async () => {
    let resolve!: (value: { ok: true; data: string }) => void
    const updatePost = vi.fn(() => new Promise<{ ok: true; data: string }>(done => { resolve = done }))
    const local = storage(); const navigate = vi.fn(); const key = draftKey('edit', postId)
    wrap(<EditPostPage repository={repository({ updatePost })} search={`?id=${postId}`} storage={local} navigate={navigate} />, auth(authorId))
    await screen.findByDisplayValue('서버 제목')
    fireEvent.click(screen.getByRole('button', { name: '수정' }))
    await waitFor(() => expect(updatePost).toHaveBeenCalledTimes(1))
    let replacementWritten = false
    const writer = withDraftLock(key, () => { replacementWritten = true; local.setItem(key, '{replacement-after-update}') })

    await Promise.resolve()
    expect(replacementWritten).toBe(false)
    resolve({ ok: true, data: postId })
    await writer

    expect(navigate).toHaveBeenCalledWith(`/community/post/?id=${postId}`)
    expect(local.values.get(key)).toBe('{replacement-after-update}')
  })

  it('holds the shared edit lock through delete completion before a cooperating replacement writer runs', async () => {
    let resolve!: (value: { ok: true; data: string }) => void
    const deletePost = vi.fn(() => new Promise<{ ok: true; data: string }>(done => { resolve = done }))
    const local = storage(); const navigate = vi.fn(); const key = draftKey('edit', postId)
    wrap(<EditPostPage repository={repository({ deletePost })} search={`?id=${postId}`} storage={local} navigate={navigate} confirmDelete={() => true} />, auth(authorId))
    await screen.findByDisplayValue('서버 제목')
    fireEvent.click(screen.getByRole('button', { name: '글 삭제' }))
    await waitFor(() => expect(deletePost).toHaveBeenCalledTimes(1))
    let replacementWritten = false
    const writer = withDraftLock(key, () => { replacementWritten = true; local.setItem(key, '{replacement-after-delete}') })

    await Promise.resolve()
    expect(replacementWritten).toBe(false)
    resolve({ ok: true, data: postId })
    await writer

    expect(navigate).toHaveBeenCalledWith(`/community/post/?id=${postId}`)
    expect(local.values.get(key)).toBe('{replacement-after-delete}')
  })
})
