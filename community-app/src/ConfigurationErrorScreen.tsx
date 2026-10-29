import { AppHeader } from './components/AppHeader'
import { AppFooter } from './components/AppFooter'

export function ConfigurationErrorScreen() {
  return (
    <div className="community-page error">
      <AppHeader />
      <main>
        <section
          className="community-hero"
          role="alert"
          aria-labelledby="configuration-error-title"
        >
          <div>
            <p className="community-kicker">COMMUNITY · CONFIGURATION</p>
            <h1 id="configuration-error-title">커뮤니티 설정을 확인해 주세요</h1>
          </div>
          <p>
            현재 커뮤니티 연결 정보를 불러올 수 없습니다. 운영자에게 알려 주세요.
          </p>
        </section>
        <a className="footer-link" href="/">
          기존 블로그로 돌아가기
        </a>
      </main>
      <AppFooter />
    </div>
  )
}
