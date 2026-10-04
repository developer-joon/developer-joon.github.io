import { useEffect, useRef, useState } from 'react'
import { consumePendingReturnPath, DEFAULT_COMMUNITY_RETURN_PATH, peekPendingReturnPath } from '../auth/auth'
import type { AuthClient } from '../auth/AuthProvider'
import { getSupabaseClient } from '../lib/supabase'

interface AuthCallbackPageProps {
  client?: AuthClient
  search?: string
  navigate?: (path: string) => void
  storage?: Pick<Storage, 'getItem' | 'removeItem'>
}

type CallbackState =
  | { kind: 'loading'; message: string }
  | { kind: 'error'; message: string; returnPath: string }

export function AuthCallbackPage({
  client,
  search = window.location.search,
  navigate = (path) => window.location.replace(path),
  storage = window.sessionStorage,
}: AuthCallbackPageProps) {
  const authClient = client ?? (getSupabaseClient().auth as unknown as AuthClient)
  const started = useRef(false)
  const mounted = useRef(false)
  const [state, setState] = useState<CallbackState>({ kind: 'loading', message: '로그인을 확인하고 있습니다.' })

  useEffect(() => {
    mounted.current = true
    if (started.current) return () => { mounted.current = false }
    started.current = true
    const params = new URLSearchParams(search)
    const oauthError = params.get('error')
    const code = params.get('code')
    const returnPath = peekPendingReturnPath(storage, params.get('returnTo'))

    if (oauthError) {
      setState({
        kind: 'error',
        message: '로그인이 취소되었거나 완료되지 않았습니다.',
        returnPath,
      })
      return () => { mounted.current = false }
    }

    if (!code) {
      setState({ kind: 'error', message: '로그인 확인 코드를 찾을 수 없습니다.', returnPath })
      return () => { mounted.current = false }
    }

    void authClient.exchangeCodeForSession(code)
      .then((result) => {
        if (!mounted.current) return
        if (result.error || !result.data.session) {
          setState({ kind: 'error', message: '로그인을 완료하지 못했습니다. 다시 시도해 주세요.', returnPath })
          return
        }
        const destination = consumePendingReturnPath(storage as Storage, params.get('returnTo'))
        navigate(destination)
      })
      .catch(() => {
        if (mounted.current) setState({ kind: 'error', message: '로그인을 완료하지 못했습니다. 다시 시도해 주세요.', returnPath })
      })

    return () => { mounted.current = false }
  }, [authClient, navigate, search, storage])

  return (
    <div className="community-page auth-callback-page">
      <main>
        <section className="auth-callback-state" role={state.kind === 'loading' ? 'status' : 'alert'}>
          <p className="post-detail-kicker">OAUTH AUTHENTICATION</p>
          <h1>{state.message}</h1>
          {state.kind === 'error' && (
            <div className="auth-callback-actions">
              <button className="secondary-action" type="button" onClick={() => navigate(state.returnPath)}>
                원래 화면에서 다시 시도
              </button>
              <a className="post-list-link" href={DEFAULT_COMMUNITY_RETURN_PATH}>커뮤니티로 돌아가기</a>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
