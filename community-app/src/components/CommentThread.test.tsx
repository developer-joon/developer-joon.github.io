import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CommunityRepository } from '../data/communityRepository'
import type { PublicComment } from '../types/community'
import { CommentThread } from './CommentThread'

const root: PublicComment = { kind:'published', id:'56000000-0000-4000-8000-000000000020', parentId:null, bodyMarkdown:'root', createdAt:'2026-09-27T00:00:00Z', updatedAt:'2026-09-27T00:00:00Z', author:{id:'56000000-0000-4000-8000-000000000030',login:'root',displayName:null,avatarUrl:null}, reactionCount:1, viewerReacted:false }
const reply: PublicComment = { ...root, id:'56000000-0000-4000-8000-000000000021', parentId:root.id, bodyMarkdown:'reply' }

describe('CommentThread', () => {
  it('offers reply only on root and keeps one active composer', () => {
    render(<CommentThread comments={[root, reply]} canMutate onReply={vi.fn().mockResolvedValue(true)} onReact={vi.fn()} />)
    expect(screen.getAllByRole('button', { name:'답글 작성' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name:'답글 작성' }))
    expect(screen.getByRole('textbox', { name:'답글 내용' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name:'답글 취소' }))
    expect(screen.queryByRole('textbox', { name:'답글 내용' })).not.toBeInTheDocument()
  })

  it('does not leak placeholder body, author, reactions or reply actions', () => {
    const hidden: PublicComment = { kind:'hidden', id:'56000000-0000-4000-8000-000000000022', parentId:null }
    render(<CommentThread comments={[hidden]} canMutate onReply={vi.fn()} onReact={vi.fn()} />)
    expect(screen.getByText('숨김 처리된 댓글입니다.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('labels signed-out reaction and reply controls as login actions', () => {
    render(<CommentThread comments={[root]} canMutate={false} onReply={vi.fn()} onReact={vi.fn()} onLogin={vi.fn()} />)

    expect(screen.getByRole('button', { name: '로그인하고 반응 남기기, 현재 1개' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '로그인하고 답글 작성' })).toBeInTheDocument()
  })

  it('offers reporting for every published comment but not hidden or deleted placeholders', () => {
    const hidden: PublicComment = { kind:'hidden', id:'56000000-0000-4000-8000-000000000022', parentId:null }
    const deleted: PublicComment = { kind:'deleted', id:'56000000-0000-4000-8000-000000000023', parentId:null }
    render(
      <CommentThread
        comments={[root, reply, hidden, deleted]}
        canMutate
        onReply={vi.fn()}
        onReact={vi.fn()}
        reporting={{
          repository: { createReport: vi.fn() } as Pick<CommunityRepository, 'createReport'>,
          actorId: 'actor-a',
          currentPath: '/community/post?id=post#discussion',
          authLoading: false,
          authPending: false,
        }}
      />,
    )

    expect(screen.getAllByRole('button', { name: '댓글 신고하기' })).toHaveLength(2)
    expect(screen.getByText('숨김 처리된 댓글입니다.').closest('article')).not.toHaveTextContent('신고')
    expect(screen.getByText('삭제된 댓글입니다.').closest('article')).not.toHaveTextContent('신고')
  })
})
