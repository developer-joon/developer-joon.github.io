import { lazy, Suspense } from 'react'
import { resolveCommunityRoute } from './routes'
import { getCommunityRepository, type CommunityRepository } from './data/communityRepository'
import { CommunityHomePage } from './pages/CommunityHomePage'
import { AuthCallbackPage } from './pages/AuthCallbackPage'
import { useAuth, type AuthClient } from './auth/AuthProvider'
import { getUploadRepository, type UploadRepository } from './data/uploadRepository'
import { AppHeader } from './components/AppHeader'
import { AppFooter } from './components/AppFooter'

const PostDetailPage = lazy(async () => {
  const module = await import('./pages/PostDetailPage')
  return { default: module.PostDetailPage }
})
const WritePostPage = lazy(async () => {
  const module = await import('./pages/WritePostPage')
  return { default: module.WritePostPage }
})
const EditPostPage = lazy(async () => {
  const module = await import('./pages/EditPostPage')
  return { default: module.EditPostPage }
})
const AdminReportsPage = lazy(async () => {
  const module = await import('./pages/AdminReportsPage')
  return { default: module.AdminReportsPage }
})


interface AppProps {
  pathname?: string
  search?: string
  hash?: string
  repository?: CommunityRepository
  authClient?: AuthClient
  onAuthCallbackNavigate?: (path: string) => void
  uploadRepository?: UploadRepository
}

function LazyRouteFallback({ children }: { children: React.ReactNode }) {
  return (
    <div className="community-page">
      <AppHeader />
      <main><section className="state-panel" role="status">{children}</section></main>
      <AppFooter />
    </div>
  )
}

export function App({ pathname = window.location.pathname, search = window.location.search, hash = window.location.hash, repository, uploadRepository, authClient, onAuthCallbackNavigate }: AppProps) {
  const auth = useAuth()
  const normalizedPathname = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (auth.loading) return <LazyRouteFallback>로그인 상태를 확인하고 있습니다.</LazyRouteFallback>
  if (normalizedPathname === '/community') {
    return <CommunityHomePage repository={repository ?? getCommunityRepository()} initialSearch={search} />
  }
  if (normalizedPathname === '/community/post') {
    return (
      <Suspense fallback={<LazyRouteFallback>게시글 화면을 준비하고 있습니다.</LazyRouteFallback>}>
        <PostDetailPage repository={repository ?? getCommunityRepository()} search={search} currentPath={`${pathname}${search}${hash}`} />
      </Suspense>
    )
  }
  if (normalizedPathname === '/community/write') {
    return <Suspense fallback={<LazyRouteFallback>글쓰기 화면을 준비하고 있습니다.</LazyRouteFallback>}><WritePostPage repository={repository ?? getCommunityRepository()} uploadRepository={uploadRepository ?? getUploadRepository()} currentPath={`${pathname}${search}${hash}`} /></Suspense>
  }
  if (normalizedPathname === '/community/edit') {
    return <Suspense fallback={<LazyRouteFallback>글 수정 화면을 준비하고 있습니다.</LazyRouteFallback>}><EditPostPage repository={repository ?? getCommunityRepository()} uploadRepository={uploadRepository ?? getUploadRepository()} search={search} currentPath={`${pathname}${search}${hash}`} /></Suspense>
  }
  if (normalizedPathname === '/community/admin/reports') {
    return <Suspense fallback={<LazyRouteFallback>신고 운영 데스크를 준비하고 있습니다.</LazyRouteFallback>}><AdminReportsPage repository={repository ?? getCommunityRepository()} currentPath={`${pathname}${search}${hash}`} /></Suspense>
  }
  if (normalizedPathname === '/community/auth/callback') {
    return <AuthCallbackPage client={authClient} search={search} navigate={onAuthCallbackNavigate} />
  }
  const route = resolveCommunityRoute(pathname)

  return (
    <div className="community-page">
      <AppHeader />
      <main>
        <section className="community-hero" aria-labelledby="community-title">
          <div>
            <p className="community-kicker">COMMUNITY</p>
            <h1 id="community-title">커뮤니티</h1>
          </div>
          <p>개발자가 쓰고 답하는 공간</p>
        </section>
        <section className="state-panel" aria-labelledby="preparation-title">
          <h2 id="preparation-title">{route.statusTitle}</h2>
          <p>{route.statusDescription}</p>
        </section>
        <a className="footer-link" href="/">기존 블로그로 돌아가기</a>
      </main>
      <AppFooter />
    </div>
  )
}

export function ConfigurationErrorScreen() {
  return (
    <div className="community-page error">
      <AppHeader showCommunityActions={false} />
      <main>
        <section className="community-hero" role="alert" aria-labelledby="configuration-error-title">
          <div>
            <p className="community-kicker">COMMUNITY · CONFIGURATION</p>
            <h1 id="configuration-error-title">커뮤니티 설정을 확인해 주세요</h1>
          </div>
          <p>현재 커뮤니티 연결 정보를 불러올 수 없습니다. 운영자에게 알려 주세요.</p>
        </section>
        <a className="footer-link" href="/">기존 블로그로 돌아가기</a>
      </main>
      <AppFooter />
    </div>
  )
}
