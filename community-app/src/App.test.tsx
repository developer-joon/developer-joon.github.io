import { render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { App, ConfigurationErrorScreen } from './App'
import type { AuthClient } from './auth/AuthProvider'
import type { CommunityRepository } from './data/communityRepository'
import type { UploadRepository } from './data/uploadRepository'
import { AuthContext, type AuthContextValue } from './auth/AuthProvider'


function uploadRepositoryStub() {
  return { publicAttachmentUrl: vi.fn(), upload: vi.fn(), attach: vi.fn(), discard: vi.fn() } as unknown as UploadRepository
}

describe('App', () => {
  it('keeps the shared header and footer visible while a lazy route loads', () => {
    const repository = {
      getPost: () => new Promise(() => undefined),
      listComments: () => new Promise(() => undefined),
    } as unknown as CommunityRepository

    render(<App pathname="/community/post/" search="?id=56000000-0000-4000-8000-000000000010" repository={repository} />)

    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('게시글 화면을 준비하고 있습니다.')
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
  })

  it('renders the public community home route', async () => {
    const repository = {
      listPosts: async () => ({ ok: true, data: { items: [], nextCursor: null } }),
      listTags: async () => ({ ok: true, data: [] }),
    } as unknown as CommunityRepository
    render(<App pathname="/community/" search="?q=missing" repository={repository} />)
    expect(screen.getByRole('heading', { name: 'Where ideas connect' })).toBeInTheDocument()
    expect(screen.getByText('질문과 경험이 이어지는 자유로운 공간입니다.')).toBeInTheDocument()
    expect(await screen.findByText('검색 결과가 없습니다')).toBeInTheDocument()
  })

  it('waits for auth initialization before mounting a route that issues public reads', async () => {
    const listPosts = vi.fn().mockResolvedValue({ ok: true, data: { items: [], nextCursor: null } })
    const listTags = vi.fn().mockResolvedValue({ ok: true, data: [] })
    const repository = { listPosts, listTags } as unknown as CommunityRepository
    const base = { pending: false, session: null, user: null, error: null, signIn: vi.fn(), signOut: vi.fn(), invalidateStaleSession: vi.fn(() => false) }
    const view = render(<AuthContext.Provider value={{ ...base, loading: true }}><App pathname="/community/" repository={repository} /></AuthContext.Provider>)

    expect(screen.getByRole('status')).toHaveTextContent('로그인 상태를 확인하고 있습니다.')
    expect(listPosts).not.toHaveBeenCalled()
    expect(listTags).not.toHaveBeenCalled()

    view.rerender(<AuthContext.Provider value={{ ...base, loading: false }}><App pathname="/community/" repository={repository} /></AuthContext.Provider>)
    await waitFor(() => expect(listPosts).toHaveBeenCalledOnce())
    expect(listTags).toHaveBeenCalledOnce()
  })

  it('routes the post shell to the real detail page with its search and repository', async () => {
    const repository = {
      getPost: async () => ({ ok: true, data: { kind: 'not_found' } }),
      listComments: async () => ({ ok: true, data: { items: [], hasMore: false, nextCursor: null } }),
    } as unknown as CommunityRepository

    render(<App pathname="/community/post/" search="?id=56000000-0000-4000-8000-000000000010" repository={repository} />)

    expect(await screen.findByRole('heading', { name: '게시글을 찾을 수 없습니다' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '커뮤니티 글 목록으로' })).toHaveAttribute('href', '/community/')
  })

  it('routes the auth callback shell to the real callback page', async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
      error: null,
    })
    const navigate = vi.fn()

    render(<App
      pathname="/community/auth/callback/"
      search="?code=callback-code"
      authClient={{ exchangeCodeForSession } as unknown as AuthClient}
      onAuthCallbackNavigate={navigate}
    />)

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/community/'))
    expect(exchangeCodeForSession).toHaveBeenCalledWith('callback-code')
  })

  it('routes write and edit shells to lazy real editor pages', async () => {
    const repository = {
      publicAttachmentOrigin: 'https://example.com',
      listTags: async () => ({ ok: true, data: [] }),
      getPost: async () => ({ ok: true, data: { kind: 'not_found' } }),
    } as unknown as CommunityRepository
    const uploadRepository = uploadRepositoryStub()
    const write = render(<App pathname="/community/write/" repository={repository} uploadRepository={uploadRepository} />)
    expect(await screen.findByRole('heading', { name: '새 글 쓰기' })).toBeInTheDocument()
    write.unmount()
    render(<App pathname="/community/edit/" search="?id=56000000-0000-4000-8000-000000000010" repository={repository} uploadRepository={uploadRepository} />)
    expect(await screen.findByRole('heading', { name: '게시글을 찾을 수 없습니다' })).toBeInTheDocument()
  })

  it('injects the upload repository into the write route', async () => {
    const repository = {
      publicAttachmentOrigin: 'https://example.com',
      listTags: async () => ({ ok: true, data: [] }),
    } as unknown as CommunityRepository
    const uploadRepository = uploadRepositoryStub()
    const auth = {
      loading: false, pending: false, session: {} as never, user: { id: '56000000-0000-4000-8000-000000000030' } as never,
      error: null, signIn: vi.fn(), signOut: vi.fn(), invalidateStaleSession: vi.fn(() => false),
    } satisfies AuthContextValue

    render(<AuthContext.Provider value={auth}><App pathname="/community/write/" repository={repository} uploadRepository={uploadRepository} /></AuthContext.Provider>)

    expect(await screen.findByLabelText('이미지 파일 선택')).toBeInTheDocument()
  })

  it('accepts a hash-bearing write route without falling back to the placeholder shell', async () => {
    const repository = {
      publicAttachmentOrigin: 'https://example.com',
      listTags: async () => ({ ok: true, data: [] }),
    } as unknown as CommunityRepository
    render(<App pathname="/community/write" search="?from=home" hash="#draft" repository={repository} uploadRepository={uploadRepositoryStub()} />)
    expect(await screen.findByRole('heading', { name: '새 글 쓰기' })).toBeInTheDocument()
  })

  it('accepts a hash-bearing edit route without falling back to the placeholder shell', async () => {
    const repository = {
      publicAttachmentOrigin: 'https://example.com',
      listTags: async () => ({ ok: true, data: [] }),
      getPost: async () => ({ ok: true, data: { kind: 'not_found' } }),
    } as unknown as CommunityRepository
    render(<App pathname="/community/edit" search="?id=56000000-0000-4000-8000-000000000010&from=list" hash="#editor" repository={repository} uploadRepository={uploadRepositoryStub()} />)
    expect(await screen.findByRole('heading', { name: '게시글을 찾을 수 없습니다' })).toBeInTheDocument()
  })

  it('routes the admin report shell to the lazy real page with repository and exact path', async () => {
    const repository = {
      isAdmin: vi.fn().mockResolvedValue({ ok: true, data: true }),
      listAdminReports: vi.fn().mockResolvedValue({ ok: true, data: { items: [], hasMore: false, nextCursor: null } }),
      listModerationAuditLogs: vi.fn(),
    } as unknown as CommunityRepository
    const auth = {
      loading: false, pending: false, session: {} as never, user: { id: '56000000-0000-4000-8000-000000000030' } as never,
      error: null, signIn: vi.fn(), signOut: vi.fn(), invalidateStaleSession: vi.fn(() => false),
    } satisfies AuthContextValue

    render(<AuthContext.Provider value={auth}><App pathname="/community/admin/reports/" search="?status=open" hash="#queue" repository={repository} /></AuthContext.Provider>)

    expect(await screen.findByRole('heading', { name: '신고 운영 데스크' })).toBeInTheDocument()
    expect(repository.isAdmin).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(repository.listAdminReports).toHaveBeenCalledWith({ status: 'active', limit: 50 }))
  })

  it('renders a friendly Korean configuration error', () => {
    render(<ConfigurationErrorScreen />)

    expect(
      screen.getByRole('heading', { name: '커뮤니티 설정을 확인해 주세요' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/운영자에게 알려 주세요/)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: '기존 블로그로 돌아가기' }),
    ).toHaveAttribute('href', '/')

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('현재 커뮤니티 연결 정보를 불러올 수 없습니다.')
    expect(alert).not.toContainElement(screen.getByRole('banner'))
    expect(alert).not.toContainElement(screen.getByRole('navigation', { name: '주요 메뉴' }))
    expect(alert).not.toContainElement(screen.getByRole('contentinfo'))
    expect(screen.queryByRole('region', { name: '커뮤니티 작업' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '글쓰기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Google.*로그인/ })).not.toBeInTheDocument()
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Ria & Seoa PaPa' })).toBeInTheDocument()
  })
})
