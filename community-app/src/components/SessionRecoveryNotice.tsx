import { useCallback, useState } from 'react'
import type { CommunityRecovery } from '../types/community'

export function useSessionRecoveryNotice() {
  const [recovery, setRecovery] = useState<CommunityRecovery | null>(null)
  const consumeRecovery = useCallback((next: CommunityRecovery | undefined) => {
    if (next) setRecovery((current) => current ?? next)
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
