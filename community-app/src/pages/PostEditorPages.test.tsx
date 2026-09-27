import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import { AuthContext, type AuthContextValue } from '../auth/AuthProvider'
import type { CommunityRepository } from '../data/communityRepository'
import { draftKey } from '../lib/draftStore'
import { WritePostPage } from './WritePostPage'
import { EditPostPage } from './EditPostPage'

const postId = '56000000-0000-4000-8000-000000000010'
const authorId = '56000000-0000-4000-8000-000000000030'
const tag = { id: '56000000-0000-4000-8000-000000000040', slug: 'typescript', label: 'TypeScript' }
const post = { id: postId, title: '서버 제목', excerpt: '', bodyMarkdown: '서버 본문', createdAt: '2026-09-27T00:00:00Z', updatedAt: '2026-09-27T00:00:00Z', isLocked: false, isPinned: false, commentCount: 0, reactionCount: 0, popularityScore: 0, author: { id: authorId, login: 'bread', displayName: null, avatarUrl: null }, tags: [tag] }

function storage() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) }, values }
}
function auth(userId: string | null): AuthContextValue {
  return { loading: false, pending: false, session: userId ? {} as never : null, user: userId ? { id: userId } as User : null, error: null, signInWithGitHub: vi.fn(), signOut: vi.fn() }
}
function wrap(ui: React.ReactNode, value: AuthContextValue) { return render(<AuthContext.Provider value={value}>{ui}</AuthContext.Provider>) }
function repository(overrides: Partial<CommunityRepository> = {}) {
  return { publicAttachmentOrigin: 'https://example.com', listTags: vi.fn().mockResolvedValue({ ok: true, data: [tag] }), getPost: vi.fn().mockResolvedValue({ ok: true, data: { kind: 'published', post } }), createPost: vi.fn(), updatePost: vi.fn(), deletePost: vi.fn(), ...overrides } as unknown as CommunityRepository
}
function fillValid() {
  fireEvent.change(screen.getByLabelText('제목'), { target: { value: '새 제목' } })
  fireEvent.change(screen.getByLabelText('본문'), { target: { value: '새 본문' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'TypeScript' }))
}

describe('WritePostPage', () => {
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

  it('keeps an anonymous draft and logs in with the exact safe write path', async () => {
    const local = storage(); const a = auth(null)
    wrap(<WritePostPage repository={repository()} storage={local} navigate={vi.fn()} currentPath="/community/write/?from=home" />, a)
    await screen.findByRole('checkbox', { name: 'TypeScript' }); fillValid()
    fireEvent.click(screen.getByRole('button', { name: '발행' }))
    expect(a.signInWithGitHub).toHaveBeenCalledWith('/community/write/?from=home')
    expect(local.values.has(draftKey('write'))).toBe(true)
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
    expect(a.signInWithGitHub).toHaveBeenCalledWith('/community/write/')
    fireEvent.click(screen.getByRole('button', { name: '발행' }))
    expect(await screen.findByText('서버 응답을 확인할 수 없습니다. 다시 시도해 주세요.')).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled(); expect(local.values.has(draftKey('write'))).toBe(true)
  })
})

describe('EditPostPage', () => {
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

  it('retains an edit draft and offers safe re-login when the session expires', async () => {
    const local = storage(); const a = auth(authorId)
    const updatePost = vi.fn().mockResolvedValue({ ok: false, error: { code: 'auth_required', sourceCode: 'PGRST301', message: '로그인이 필요합니다.' } })
    wrap(<EditPostPage repository={repository({ updatePost })} search={`?id=${postId}`} storage={local} navigate={vi.fn()} />, a)
    await screen.findByDisplayValue('서버 제목')
    fireEvent.click(screen.getByRole('button', { name: '수정' }))
    expect(await screen.findByText('로그인이 필요합니다.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다시 로그인' }))
    expect(a.signInWithGitHub).toHaveBeenCalledWith(`/community/edit/?id=${postId}`)
    expect(local.values.has(draftKey('edit', postId))).toBe(true)
  })

  it('requires confirmation, cancels without RPC, and keeps the draft on delete failure', async () => {
    const local = storage(); const deletePost = vi.fn().mockResolvedValue({ ok: false, error: { code: 'network', sourceCode: 'NETWORK_ERROR', message: '네트워크 연결을 확인해 주세요.' } }); const confirmDelete = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    wrap(<EditPostPage repository={repository({ deletePost })} search={`?id=${postId}`} storage={local} navigate={vi.fn()} confirmDelete={confirmDelete} />, auth(authorId))
    await screen.findByDisplayValue('서버 제목')
    fireEvent.click(screen.getByRole('button', { name: '글 삭제' })); expect(deletePost).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '글 삭제' })); expect(await screen.findByText('네트워크 연결을 확인해 주세요.')).toBeInTheDocument()
    expect(deletePost).toHaveBeenCalledTimes(1); expect(local.values.has(draftKey('edit', postId))).toBe(true)
  })
})
