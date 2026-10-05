import { useAuth } from '../auth/AuthProvider'
import { AUTH_PROVIDER_DEFINITIONS, DEFAULT_AUTH_PROVIDER } from '../auth/providers'

function userLabel(user: ReturnType<typeof useAuth>['user']) {
  const metadataLogin = user?.user_metadata?.user_name
  if (typeof metadataLogin === 'string' && metadataLogin.trim()) return metadataLogin
  return user?.email ?? '커뮤니티 사용자'
}

export function CommunityActions() {
  const auth = useAuth()
  const disabled = auth.loading || auth.pending
  const definition = AUTH_PROVIDER_DEFINITIONS[DEFAULT_AUTH_PROVIDER]
  const loginLabel = auth.loading ? '로그인 상태 확인 중' : auth.pending ? definition.pendingLabel : definition.loginLabel

  return (
    <section className="community-actions" aria-label="커뮤니티 작업">
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
  )
}
