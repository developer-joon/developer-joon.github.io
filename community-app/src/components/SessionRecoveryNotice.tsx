import { useCallback, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useAuth } from '../auth/AuthProvider'
import type { CommunityRecovery } from '../types/community'

export function useSessionRecoveryNotice() {
  const auth = useAuth()
  const invalidateStaleSession = useRef(auth.invalidateStaleSession)
  invalidateStaleSession.current = auth.invalidateStaleSession
  const [recovery, setRecovery] = useState<CommunityRecovery | null>(null)
  const handled = useRef(false)
  const consumeRecovery = useCallback((next: CommunityRecovery | undefined, requestSession: Session | null) => {
    if (!next || handled.current || !invalidateStaleSession.current(requestSession)) return
    handled.current = true
    setRecovery(next)
  }, [])
  return [recovery, consumeRecovery] as const
}

export function SessionRecoveryNotice({ recovery }: { recovery: CommunityRecovery | null }) {
  if (!recovery) return null
  return (
    <p className="session-recovery-notice" role="alert" aria-label="로그인 세션 만료">
      {recovery.message}
    </p>
  )
}
