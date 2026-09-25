import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App, ConfigurationErrorScreen } from './App'

const routeCases = [
  ['/community/', '커뮤니티를 준비하고 있습니다'],
  ['/community/write/', '글쓰기 화면을 준비하고 있습니다'],
  ['/community/post/', '게시글 화면을 준비하고 있습니다'],
  ['/community/edit/', '글 수정 화면을 준비하고 있습니다'],
  ['/community/admin/reports/', '신고 관리 화면을 준비하고 있습니다'],
  ['/community/auth/callback/', '로그인 확인 화면을 준비하고 있습니다'],
] as const

describe('App', () => {
  it.each(routeCases)('renders the route-aware placeholder for %s', (pathname, statusTitle) => {
    render(<App pathname={pathname} />)

    expect(
      screen.getByRole('heading', { name: 'Breadlab 커뮤니티', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getByText(statusTitle)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: '기존 블로그로 돌아가기' }),
    ).toHaveAttribute('href', '/')
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
  })
})
