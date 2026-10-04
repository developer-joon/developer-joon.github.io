import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { AUTH_PROVIDER_DEFINITIONS, DEFAULT_AUTH_PROVIDER } from '../auth/providers'

function userLabel(user: ReturnType<typeof useAuth>['user']) {
  const metadataLogin = user?.user_metadata?.user_name
  if (typeof metadataLogin === 'string' && metadataLogin.trim()) return metadataLogin
  return user?.email ?? '커뮤니티 사용자'
}

const globalLinks = [
  { label: '0 → 1', href: '/lab/', current: false },
  { label: 'Blog', href: '/blog/', current: false },
  { label: 'Community', href: '/community/', current: true },
  { label: 'Shop', href: '/shop/', current: false },
  { label: 'About', href: '/about', current: false },
] as const

export function AppHeader() {
  const auth = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const disabled = auth.loading || auth.pending
  const definition = AUTH_PROVIDER_DEFINITIONS[DEFAULT_AUTH_PROVIDER]
  const loginLabel = auth.loading ? '로그인 상태 확인 중' : auth.pending ? definition.pendingLabel : definition.loginLabel

  return (
    <>
      <header className="community-header">
        <a className="community-brand" href="/">Ria &amp; Seoa PaPa</a>
        <button
          className="menu-toggle"
          type="button"
          aria-controls="global-navigation"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? '주요 메뉴 닫기' : '주요 메뉴 열기'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden="true">Menu</span>
        </button>
        <nav id="global-navigation" className={menuOpen ? 'global-navigation is-open' : 'global-navigation'} aria-label="주요 메뉴">
          {globalLinks.map((link) => (
            <a
              key={link.href}
              className={link.current ? 'active-link' : undefined}
              href={link.href}
              aria-current={link.current ? 'page' : undefined}
            >
              {link.label}
            </a>
          ))}
        </nav>
      </header>
      <section className="community-actions" aria-label="커뮤니티 작업">
        <a className="header-write" href="/community/write/">글쓰기</a>
        <div className="header-auth">
          {auth.user ? (
            <>
              <span className="auth-identity" title={userLabel(auth.user)}>{userLabel(auth.user)}</span>
              <button type="button" disabled={disabled} onClick={() => void auth.signOut()}>
                {auth.pending ? '로그아웃 중' : '로그아웃'}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={disabled}
              aria-label={loginLabel}
              onClick={() => void auth.signIn(DEFAULT_AUTH_PROVIDER)}
            >
              {auth.loading ? '확인 중' : auth.pending ? definition.pendingLabel : definition.buttonLabel}
            </button>
          )}
          {auth.error && <span className="auth-error" role="status">{auth.error}</span>}
        </div>
      </section>
    </>
  )
}
