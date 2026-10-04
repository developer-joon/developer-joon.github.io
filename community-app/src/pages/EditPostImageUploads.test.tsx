import type { ComponentProps, ComponentType, ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { User } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../auth/AuthProvider'
import type { CommunityRepository } from '../data/communityRepository'
import type { UploadRepository, UploadedAttachment } from '../data/uploadRepository'
import { draftKey, type DraftStorage, type EditDraft } from '../lib/draftStore'
import type { PostDetail } from '../types/community'
import { EditPostPage } from './EditPostPage'

const postId = '56000000-0000-4000-8000-000000000010'
const ownerId = '56000000-0000-4000-8000-000000000030'
const otherOwnerId = '56000000-0000-4000-8000-000000000031'
const newAttachmentId = '56000000-0000-4000-8000-000000000070'
const uploadKey = '56000000-0000-4000-8000-000000000080'
const existingIds = [
  '56000000-0000-4000-8000-000000000071',
  '56000000-0000-4000-8000-000000000072',
  '56000000-0000-4000-8000-000000000073',
  '56000000-0000-4000-8000-000000000074',
  '56000000-0000-4000-8000-000000000075',
  '56000000-0000-4000-8000-000000000076',
]
const origin = 'https://example.com'
const tag = { id: '56000000-0000-4000-8000-000000000040', slug: 'typescript', label: 'TypeScript' }

type UploadEnabledEditProps = ComponentProps<typeof EditPostPage> & { uploadRepository?: UploadRepository }
const UploadEnabledEditPostPage = EditPostPage as unknown as ComponentType<UploadEnabledEditProps>

function canonicalImage(id: string) {
  return `![서버 이미지](${origin}/functions/v1/public-attachment/${id})`
}

function serverBody(count: number) {
  return ['서버 본문', ...existingIds.slice(0, count).map(canonicalImage)].join('\n\n')
}

function post(bodyMarkdown = '서버 본문'): PostDetail {
  const attachmentCount = existingIds.filter(id => bodyMarkdown.includes(id)).length
  return {
    id: postId,
    title: '서버 제목',
    excerpt: '',
    bodyMarkdown,
    createdAt: '2026-09-27T00:00:00Z',
    updatedAt: '2026-09-27T00:00:00Z',
    isLocked: false,
    isPinned: false,
    commentCount: 0,
    reactionCount: 0,
    popularityScore: 0,
    attachmentCount,
    viewerReacted: false,
    author: { id: ownerId, login: 'bread', displayName: null, avatarUrl: null },
    tags: [tag],
  }
}

function storage(): DraftStorage & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: key => { values.delete(key) },
    values,
  }
}

function auth(userId: string | null): AuthContextValue {
  return {
    loading: false,
    pending: false,
    session: userId ? {} as never : null,
    user: userId ? { id: userId } as User : null,
    error: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }
}

function repository(bodyMarkdown: string, overrides: Partial<CommunityRepository> = {}) {
  return {
    publicAttachmentOrigin: origin,
    listTags: vi.fn().mockResolvedValue({ ok: true, data: [tag] }),
    getPost: vi.fn().mockResolvedValue({ ok: true, data: { kind: 'published', post: post(bodyMarkdown) } }),
    createPost: vi.fn(),
    updatePost: vi.fn().mockResolvedValue({ ok: true, data: postId }),
    deletePost: vi.fn(),
    ...overrides,
  } as unknown as CommunityRepository
}

function uploaded(idempotencyKey = uploadKey): UploadedAttachment {
  return {
    attachmentId: newAttachmentId,
    storagePath: `${ownerId}/${idempotencyKey}`,
    mimeType: 'image/png',
    byteSize: 1,
    width: 1,
    height: 1,
    publicUrl: `${origin}/functions/v1/public-attachment/${newAttachmentId}`,
  }
}

function uploads(overrides: Partial<UploadRepository> = {}) {
  return {
    publicAttachmentUrl: (id: string) => `${origin}/functions/v1/public-attachment/${id}`,
    upload: vi.fn((_file: File, idempotencyKey: string) => Promise.resolve({ ok: true, data: uploaded(idempotencyKey) })),
    attach: vi.fn((_postId: string, _ids: string[], expectedTotal: number) => Promise.resolve({ ok: true, data: expectedTotal })),
    discard: vi.fn().mockResolvedValue({ ok: true, data: true }),
    ...overrides,
  } as UploadRepository
}

function wrap(ui: ReactNode, value = auth(ownerId)) {
  return render(<AuthContext.Provider value={value}>{ui}</AuthContext.Provider>)
}

function editPage(repo: CommunityRepository, uploadRepo: UploadRepository, local: DraftStorage, navigate = vi.fn()) {
  return <UploadEnabledEditPostPage repository={repo} uploadRepository={uploadRepo} search={`?id=${postId}`} storage={local} navigate={navigate} />
}

function chooseImage(name = 'new.png') {
  const file = new File(['x'], name, { type: 'image/png' })
  fireEvent.change(screen.getByLabelText('이미지 파일 선택'), { target: { files: [file] } })
  return file
}

function savedDraft(local: DraftStorage & { values: Map<string, string> }) {
  return JSON.parse(local.values.get(draftKey('edit', postId))!) as EditDraft
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  URL.createObjectURL = vi.fn((value: Blob) => `blob:${(value as File).name}`)
  URL.revokeObjectURL = vi.fn()
})

describe('EditPostPage image upload lifecycle', () => {
  it('attaches only the newly uploaded ID after updating a post with four trusted existing images', async () => {
    const local = storage()
    const updatePost = vi.fn().mockResolvedValue({ ok: true, data: postId })
    const attach = vi.fn().mockResolvedValue({ ok: true, data: 5 })
    const repo = repository(serverBody(4), { updatePost })
    const uploadRepo = uploads({ attach })
    const navigate = vi.fn()

    wrap(editPage(repo, uploadRepo, local, navigate))
    await screen.findByDisplayValue('서버 제목')
    chooseImage()
    await screen.findByText('업로드 완료')
    await waitFor(() => expect(savedDraft(local).uploadWorkflow?.phase).toBe('uploaded'))
    fireEvent.click(screen.getByRole('button', { name: '수정' }))

    await waitFor(() => expect(attach).toHaveBeenCalledWith(postId, [newAttachmentId], 5))
    expect(updatePost).toHaveBeenCalledTimes(1)
    expect(attach).toHaveBeenCalledTimes(1)
    expect(local.values.has(draftKey('edit', postId))).toBe(false)
    expect(navigate).toHaveBeenCalledWith(`/community/post/?id=${postId}`)
  })

  it('keeps all five server-captured slots occupied even when an existing URL is deleted from the textarea', async () => {
    const updatePost = vi.fn()
    const upload = vi.fn()
    const attach = vi.fn()
    const repo = repository(serverBody(5), { updatePost })
    const uploadRepo = uploads({ upload, attach })

    wrap(editPage(repo, uploadRepo, storage()))
    await screen.findByDisplayValue('서버 제목')
    chooseImage('blocked-before-edit.png')
    expect(await screen.findByRole('alert')).toHaveTextContent('최대 5개')
    fireEvent.change(screen.getByLabelText('본문'), { target: { value: '기존 URL을 모두 지운 본문' } })
    chooseImage('blocked-after-edit.png')
    expect(await screen.findByRole('alert')).toHaveTextContent('최대 5개')
    fireEvent.click(screen.getByRole('button', { name: '수정' }))

    expect(upload).not.toHaveBeenCalled()
    await waitFor(() => expect(updatePost).toHaveBeenCalledTimes(1))
    expect(attach).not.toHaveBeenCalled()
  })

  it('retries only attach from a preserved attaching checkpoint after remount', async () => {
    const local = storage()
    const updatePost = vi.fn().mockResolvedValue({ ok: true, data: postId })
    const attach = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'network', message: '첨부 연결 실패' } })
      .mockResolvedValueOnce({ ok: true, data: 5 })
    const repo = repository(serverBody(4), { updatePost })
    repo.getPost = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: { kind: 'published', post: post(serverBody(4)) } })
      .mockResolvedValueOnce({ ok: true, data: { kind: 'published', post: { ...post(`${serverBody(4)}\n\n${canonicalImage(newAttachmentId)}`), updatedAt: '2026-09-28T00:00:00Z' } } })
    const uploadRepo = uploads({ attach })
    const navigate = vi.fn()

    const first = wrap(editPage(repo, uploadRepo, local, navigate))
    await screen.findByDisplayValue('서버 제목')
    chooseImage()
    await screen.findByText('업로드 완료')
    await waitFor(() => expect(savedDraft(local).uploadWorkflow?.phase).toBe('uploaded'))
    fireEvent.click(screen.getByRole('button', { name: '수정' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('첨부 연결 실패')
    const checkpoint = savedDraft(local).uploadWorkflow
    expect(checkpoint).toMatchObject({
      phase: 'attaching',
      createdPostId: postId,
      submission: { attachmentIds: [newAttachmentId] },
    })
    expect(navigate).not.toHaveBeenCalled()
    first.unmount()

    wrap(editPage(repo, uploadRepo, local, navigate))
    await waitFor(() => expect(attach).toHaveBeenCalledTimes(2))
    expect(attach.mock.calls[1]).toEqual([postId, [newAttachmentId], 5])
    expect(updatePost).toHaveBeenCalledTimes(1)
    expect(local.values.has(draftKey('edit', postId))).toBe(false)
    expect(navigate).toHaveBeenCalledWith(`/community/post/?id=${postId}`)
  })

  it('rolls back to uploaded and retries update when the post-created checkpoint cannot be verified', async () => {
    const local = storage()
    let rejectCheckpoint = false
    const guarded = { ...local, setItem: (key: string, value: string) => {
      if (rejectCheckpoint && value.includes('post-created')) { rejectCheckpoint = false; throw new Error('quota') }
      local.setItem(key, value)
    } }
    const updatePost = vi.fn().mockResolvedValue({ ok: true, data: postId })
    const attach = vi.fn().mockResolvedValue({ ok: true, data: 1 })
    const navigate = vi.fn()
    wrap(editPage(repository(serverBody(0), { updatePost }), uploads({ attach }), guarded, navigate))
    await screen.findByDisplayValue('서버 제목'); chooseImage(); await screen.findByText('업로드 완료')
    await waitFor(() => expect(savedDraft(local).uploadWorkflow?.phase).toBe('uploaded'))
    rejectCheckpoint = true
    fireEvent.click(screen.getByRole('button', { name: '수정' }))
    await waitFor(() => expect(updatePost).toHaveBeenCalledTimes(1))
    expect(savedDraft(local).uploadWorkflow?.phase).toBe('uploaded')
    expect(attach).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '수정' }))
    await waitFor(() => expect(updatePost).toHaveBeenCalledTimes(2))
    expect(attach).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith(`/community/post/?id=${postId}`)
  })

  it('retains the existing update-only behavior when there are no new uploads', async () => {
    const local = storage()
    const updatePost = vi.fn().mockResolvedValue({ ok: true, data: postId })
    const attach = vi.fn()
    const navigate = vi.fn()

    wrap(editPage(repository(serverBody(2), { updatePost }), uploads({ attach }), local, navigate))
    await screen.findByDisplayValue('서버 제목')
    fireEvent.click(screen.getByRole('button', { name: '수정' }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/community/post/?id=${postId}`))
    expect(updatePost).toHaveBeenCalledTimes(1)
    expect(attach).not.toHaveBeenCalled()
    expect(local.values.has(draftKey('edit', postId))).toBe(false)
  })

  it('does not treat pasted trusted or evil Markdown as new attachments or recount server slots', async () => {
    const local = storage()
    const updatePost = vi.fn().mockResolvedValue({ ok: true, data: postId })
    const attach = vi.fn().mockResolvedValue({ ok: true, data: 5 })
    const navigate = vi.fn()

    wrap(editPage(repository(serverBody(4), { updatePost }), uploads({ attach }), local, navigate))
    await screen.findByDisplayValue('서버 제목')
    const pastedTrusted = canonicalImage('56000000-0000-4000-8000-000000000077')
    const pastedEvil = '![evil](https://evil.example/functions/v1/public-attachment/56000000-0000-4000-8000-000000000078)'
    fireEvent.change(screen.getByLabelText('본문'), { target: { value: `${serverBody(4)}\n\n${pastedTrusted}\n\n${pastedEvil}` } })
    chooseImage()
    await screen.findByText('업로드 완료')
    await waitFor(() => expect(savedDraft(local).uploadWorkflow?.phase).toBe('uploaded'))
    fireEvent.click(screen.getByRole('button', { name: '수정' }))

    await waitFor(() => expect(attach).toHaveBeenCalledWith(postId, [newAttachmentId], 5))
    expect(attach).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith(`/community/post/?id=${postId}`)
  })

  it('surfaces an invalid attach total and preserves the attaching checkpoint', async () => {
    const local = storage()
    const attach = vi.fn().mockResolvedValue({ ok: false, error: { code: 'invalid_response', message: '첨부 파일 연결 결과를 확인할 수 없습니다. 다시 시도해 주세요.' } })
    const navigate = vi.fn()

    wrap(editPage(repository(serverBody(4)), uploads({ attach }), local, navigate))
    await screen.findByDisplayValue('서버 제목')
    chooseImage()
    await screen.findByText('업로드 완료')
    await waitFor(() => expect(savedDraft(local).uploadWorkflow?.phase).toBe('uploaded'))
    fireEvent.click(screen.getByRole('button', { name: '수정' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('첨부 파일 연결 결과를 확인할 수 없습니다')
    expect(savedDraft(local).uploadWorkflow).toMatchObject({ phase: 'attaching', createdPostId: postId })
    expect(local.values.has(draftKey('edit', postId))).toBe(true)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('retries a failed attach checkpoint in the current edit session', async () => {
    const local = storage()
    const pending = deferred<{ ok: true; data: number }>()
    const attach = vi.fn().mockResolvedValueOnce({ ok: false, error: { code: 'network', message: '첨부 연결 실패' } }).mockImplementationOnce(() => pending.promise)
    const updatePost = vi.fn().mockResolvedValue({ ok: true, data: postId })
    const navigate = vi.fn()
    wrap(editPage(repository(serverBody(4), { updatePost }), uploads({ attach }), local, navigate))
    await screen.findByDisplayValue('서버 제목'); chooseImage(); await screen.findByText('업로드 완료')
    await waitFor(() => expect(savedDraft(local).uploadWorkflow?.phase).toBe('uploaded'))
    fireEvent.click(screen.getByRole('button', { name: '수정' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('첨부 연결 실패')

    const retryButton = screen.getByRole('button', { name: '첨부 연결 다시 시도' })
    fireEvent.click(retryButton)
    await waitFor(() => expect(retryButton).toBeDisabled())
    fireEvent.click(retryButton)
    pending.resolve({ ok: true, data: 5 })

    await waitFor(() => expect(attach).toHaveBeenCalledTimes(2))
    expect(updatePost).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith(`/community/post/?id=${postId}`)
  })

  it('preserves a replacement draft that appears while edit attach is pending', async () => {
    const local = storage()
    const pending = deferred<{ ok: true; data: number }>()
    const attach = vi.fn(() => pending.promise)
    const navigate = vi.fn()
    wrap(editPage(repository(serverBody(4)), uploads({ attach }), local, navigate))
    await screen.findByDisplayValue('서버 제목'); chooseImage(); await screen.findByText('업로드 완료')
    await waitFor(() => expect(savedDraft(local).uploadWorkflow?.phase).toBe('uploaded'))
    fireEvent.click(screen.getByRole('button', { name: '수정' }))
    await waitFor(() => expect(attach).toHaveBeenCalledOnce())
    local.setItem(draftKey('edit', postId), '{"replacement":true}')
    pending.resolve({ ok: true, data: 5 })

    await screen.findByRole('alert')
    expect(local.values.get(draftKey('edit', postId))).toBe('{"replacement":true}')
    expect(navigate).not.toHaveBeenCalled()
  })

  it.each(['unmount', 'account switch'] as const)('ignores a pending attach completion after %s', async transition => {
    const local = storage()
    const pending = deferred<{ ok: true; data: number }>()
    const attach = vi.fn(() => pending.promise)
    const repo = repository(serverBody(4))
    const uploadRepo = uploads({ attach })
    const navigate = vi.fn()
    const view = wrap(editPage(repo, uploadRepo, local, navigate))
    await screen.findByDisplayValue('서버 제목')
    chooseImage()
    await screen.findByText('업로드 완료')
    await waitFor(() => expect(savedDraft(local).uploadWorkflow?.phase).toBe('uploaded'))
    fireEvent.click(screen.getByRole('button', { name: '수정' }))
    await waitFor(() => expect(attach).toHaveBeenCalledTimes(1))
    const checkpointRaw = local.values.get(draftKey('edit', postId))

    if (transition === 'unmount') view.unmount()
    else view.rerender(<AuthContext.Provider value={auth(otherOwnerId)}>{editPage(repo, uploadRepo, local, navigate)}</AuthContext.Provider>)
    await act(async () => {
      pending.resolve({ ok: true, data: 5 })
      await pending.promise
    })

    expect(navigate).not.toHaveBeenCalled()
    expect(local.values.get(draftKey('edit', postId))).toBe(checkpointRaw)
    expect(savedDraft(local).uploadWorkflow?.phase).toBe('attaching')
  })

  it.each([
    ['more than five canonical server attachments', serverBody(6), origin],
    ['an invalid configured attachment origin', serverBody(1), 'https://example.com/path'],
  ])('fails closed at load for %s', async (_case, bodyMarkdown, publicAttachmentOrigin) => {
    const updatePost = vi.fn()
    const attach = vi.fn()
    const repo = repository(bodyMarkdown, { updatePost })
    repo.publicAttachmentOrigin = publicAttachmentOrigin

    wrap(editPage(repo, uploads({ attach }), storage()))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/서버 응답|첨부|이미지/)
    expect(screen.queryByRole('button', { name: '수정' })).not.toBeInTheDocument()
    expect(updatePost).not.toHaveBeenCalled()
    expect(attach).not.toHaveBeenCalled()
  })
})
