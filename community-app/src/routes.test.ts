import { describe, expect, it } from 'vitest'
import { resolveCommunityRoute } from './routes'

const routeCases = [
  ['/community', '커뮤니티를 준비하고 있습니다'],
  ['/community/write', '글쓰기 화면을 준비하고 있습니다'],
  ['/community/post', '게시글 화면을 준비하고 있습니다'],
  ['/community/edit', '글 수정 화면을 준비하고 있습니다'],
  ['/community/admin/reports', '신고 관리 화면을 준비하고 있습니다'],
  ['/community/auth/callback', '로그인 확인 화면을 준비하고 있습니다'],
] as const

describe('resolveCommunityRoute', () => {
  it('uses provider-neutral callback copy', () => {
    expect(resolveCommunityRoute('/community/auth/callback').statusDescription).toBe('로그인 결과를 안전하게 확인하는 화면을 만들고 있습니다.')
  })

  it.each(routeCases)('resolves %s to its Korean placeholder', (pathname, statusTitle) => {
    expect(resolveCommunityRoute(pathname).statusTitle).toBe(statusTitle)
  })

  it.each(routeCases)('normalizes a trailing slash for %s', (pathname, statusTitle) => {
    expect(resolveCommunityRoute(`${pathname}/`).statusTitle).toBe(statusTitle)
  })

  it.each(['/community/unknown', '/outside-community'])(
    'returns a Korean not-found state for unknown path %s',
    (pathname) => {
      expect(resolveCommunityRoute(pathname).statusTitle).toBe('페이지를 찾을 수 없습니다')
    },
  )
})
