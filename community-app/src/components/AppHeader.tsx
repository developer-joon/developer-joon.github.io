import { useCallback, useEffect, useRef, useState } from 'react'
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

interface AppHeaderProps {
  showCommunityActions?: boolean
}

export function AppHeader({ showCommunityActions = true }: AppHeaderProps) {
  const auth = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const [mobileNavigation, setMobileNavigation] = useState(() => window.matchMedia?.('(max-width: 1023px)').matches ?? true)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const navigationRef = useRef<HTMLElement>(null)
  const wasModalOpen = useRef(false)
  const disabled = auth.loading || auth.pending
  const definition = AUTH_PROVIDER_DEFINITIONS[DEFAULT_AUTH_PROVIDER]
  const loginLabel = auth.loading ? '로그인 상태 확인 중' : auth.pending ? definition.pendingLabel : definition.loginLabel

  const closeMenu = useCallback(() => setMenuOpen(false), [])

  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 1023px)')
    if (!media) return
    const handleChange = (event: MediaQueryListEvent) => {
      setMobileNavigation(event.matches)
      if (!event.matches) closeMenu()
    }
    setMobileNavigation(media.matches)
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [closeMenu])

  useEffect(() => {
    const modalOpen = mobileNavigation && menuOpen
    if (wasModalOpen.current && !modalOpen) toggleRef.current?.focus()
    wasModalOpen.current = modalOpen
  }, [menuOpen, mobileNavigation])

  useEffect(() => {
    if (!mobileNavigation || !menuOpen) return
    const navigation = navigationRef.current
    const toggle = toggleRef.current
    const links = navigation ? Array.from(navigation.querySelectorAll<HTMLAnchorElement>('a[href]')) : []
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    links[0]?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMenu()
        return
      }
      if (event.key !== 'Tab' || !toggle || links.length === 0) return
      const first = links[0]
      const last = links[links.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        toggle.focus()
      } else if (event.shiftKey && document.activeElement === toggle) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        toggle.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [closeMenu, menuOpen, mobileNavigation])

  return (
    <>
      <header className="community-header">
        <a className="community-brand" href="/">Ria &amp; Seoa PaPa</a>
        <button
          ref={toggleRef}
          className="menu-toggle"
          type="button"
          aria-controls="global-navigation"
          aria-expanded={mobileNavigation && menuOpen}
          aria-label={mobileNavigation && menuOpen ? '주요 메뉴 닫기' : '주요 메뉴 열기'}
          onClick={() => { if (mobileNavigation) setMenuOpen((open) => !open) }}
        >
          <span aria-hidden="true">Menu</span>
        </button>
        <nav ref={navigationRef} id="global-navigation" className={mobileNavigation && menuOpen ? 'global-navigation is-open' : 'global-navigation'} aria-label="주요 메뉴">
          {globalLinks.map((link) => (
            <a
              key={link.href}
              className={link.current ? 'active-link' : undefined}
              href={link.href}
              aria-current={link.current ? 'page' : undefined}
              onClick={closeMenu}
            >
              {link.label}
            </a>
          ))}
        </nav>
      </header>
      {showCommunityActions && <section className="community-actions" aria-label="커뮤니티 작업">
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
      </section>}
    </>
  )
}
