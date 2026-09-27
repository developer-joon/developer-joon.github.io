import { lazy, Suspense } from 'react'
import { resolveCommunityRoute } from './routes'
import { getCommunityRepository, type CommunityRepository } from './data/communityRepository'
import { CommunityHomePage } from './pages/CommunityHomePage'

const PostDetailPage = lazy(async () => {
  const module = await import('./pages/PostDetailPage')
  return { default: module.PostDetailPage }
})

const sharedStyles = `
  :root { color: #20201d; background: #f4f0e7; font-family: Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", sans-serif; font-synthesis: none; }
  * { box-sizing: border-box; }
  body { margin: 0; min-width: 320px; background: #f4f0e7; }
  a { color: inherit; }
  .page { min-height: 100vh; padding: 0 6vw 4rem; }
  .masthead { display: flex; align-items: center; justify-content: space-between; min-height: 5.25rem; border-bottom: 1px solid #20201d; }
  .wordmark { font-family: Georgia, "Noto Serif KR", serif; font-size: .95rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
  .issue { font-size: .75rem; color: #67645d; }
  main { width: min(1120px, 100%); margin: 0 auto; }
  .hero { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(15rem, .7fr); gap: clamp(2rem, 8vw, 7rem); padding: clamp(4.5rem, 11vw, 9rem) 0 3rem; border-bottom: 1px solid #aaa59a; }
  .eyebrow { margin: 0 0 1.4rem; color: #1557b0; font-size: .75rem; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
  h1 { max-width: 10ch; margin: 0; font-family: Georgia, "Noto Serif KR", serif; font-size: clamp(3.4rem, 9vw, 7.8rem); font-weight: 500; letter-spacing: -.06em; line-height: .92; }
  .dek { align-self: end; margin: 0 0 .35rem; font-family: Georgia, "Noto Serif KR", serif; font-size: clamp(1.35rem, 2.2vw, 2rem); line-height: 1.45; word-break: keep-all; }
  .status { display: grid; grid-template-columns: auto 1fr; gap: 1rem; padding: 2rem 0; }
  .status-mark { width: .7rem; height: .7rem; margin-top: .35rem; border-radius: 50%; background: #1557b0; }
  .status h2 { margin: 0 0 .6rem; font-family: Georgia, "Noto Serif KR", serif; font-size: 1.35rem; }
  .status p { max-width: 48rem; margin: 0; color: #67645d; line-height: 1.75; }
  .footer-link { display: inline-block; margin-top: 3rem; border-bottom: 2px solid #1557b0; padding-bottom: .22rem; font-size: .9rem; font-weight: 700; text-decoration: none; }
  .footer-link:focus-visible { outline: 3px solid #1557b0; outline-offset: 5px; }
  .error .hero { grid-template-columns: 1fr; }
  .error h1 { max-width: 13ch; font-size: clamp(2.8rem, 7vw, 6rem); }
  @media (max-width: 700px) {
    .page { padding-inline: 1.25rem; }
    .hero { grid-template-columns: 1fr; gap: 2.25rem; padding-top: 4rem; }
    .masthead { min-height: 4.5rem; }
  }
`

function Masthead() {
  return (
    <header className="masthead">
      <span className="wordmark">Breadlab Journal</span>
      <span className="issue">COMMUNITY · 2026</span>
    </header>
  )
}

interface AppProps {
  pathname?: string
  search?: string
  repository?: CommunityRepository
}

export function App({ pathname = window.location.pathname, search = window.location.search, repository }: AppProps) {
  const normalizedPathname = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (normalizedPathname === '/community') {
    return <CommunityHomePage repository={repository ?? getCommunityRepository()} initialSearch={search} />
  }
  if (normalizedPathname === '/community/post') {
    return (
      <Suspense fallback={<div className="page" role="status">게시글 화면을 준비하고 있습니다.</div>}>
        <PostDetailPage repository={repository ?? getCommunityRepository()} search={search} />
      </Suspense>
    )
  }
  const route = resolveCommunityRoute(pathname)

  return (
    <div className="page">
      <style>{sharedStyles}</style>
      <Masthead />
      <main>
        <section className="hero" aria-labelledby="community-title">
          <div>
            <p className="eyebrow">Open developer desk</p>
            <h1 id="community-title">Breadlab 커뮤니티</h1>
          </div>
          <p className="dek">개발자가 쓰고 답하는 공간</p>
        </section>
        <section className="status" aria-labelledby="preparation-title">
          <span className="status-mark" aria-hidden="true" />
          <div>
            <h2 id="preparation-title">{route.statusTitle}</h2>
            <p>{route.statusDescription}</p>
          </div>
        </section>
        <a className="footer-link" href="/">기존 블로그로 돌아가기</a>
      </main>
    </div>
  )
}

export function ConfigurationErrorScreen() {
  return (
    <div className="page error" role="alert">
      <style>{sharedStyles}</style>
      <Masthead />
      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">Configuration notice</p>
            <h1>커뮤니티 설정을 확인해 주세요</h1>
          </div>
          <p className="dek">현재 커뮤니티 연결 정보를 불러올 수 없습니다. 운영자에게 알려 주세요.</p>
        </section>
        <a className="footer-link" href="/">기존 블로그로 돌아가기</a>
      </main>
    </div>
  )
}
