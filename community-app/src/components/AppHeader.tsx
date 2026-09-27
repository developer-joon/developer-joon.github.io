import { useAuth } from '../auth/AuthProvider'

function userLabel(user: ReturnType<typeof useAuth>['user']) {
  const metadataLogin = user?.user_metadata?.user_name
  if (typeof metadataLogin === 'string' && metadataLogin.trim()) return metadataLogin
  return user?.email ?? 'GitHub 사용자'
}

export function AppHeader() {
  const auth = useAuth()
  const disabled = auth.loading || auth.pending
  const loginLabel = auth.loading ? '로그인 상태 확인 중' : auth.pending ? 'GitHub 연결 중' : 'GitHub로 로그인'

  return (
    <header className="community-header">
      <a className="community-brand" href="/" aria-label="Breadlab 홈">BREADLAB</a>
      <nav aria-label="커뮤니티 메뉴">
        <a href="/blog/">블로그</a>
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
              onClick={() => void auth.signInWithGitHub()}
            >
              {auth.loading ? '확인 중' : auth.pending ? 'GitHub 연결 중' : 'GitHub 로그인'}
            </button>
          )}
          {auth.error && <span className="auth-error" role="status">{auth.error}</span>}
        </div>
      </nav>
    </header>
  )
}
