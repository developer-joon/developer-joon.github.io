import { useEffect, useState } from 'react'
import { benefitsClient } from '../data/benefitsArtifactClient'
import type { Manifest, CompanyIndex, Rankings } from '../types/benefits'
export function useBenefitsRankings(
  manifest: Manifest,
  index: CompanyIndex,
  enabled = true,
) {
  const [data, setData] = useState<Rankings>()
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let active = true
    benefitsClient
      .loadRankings(manifest, index)
      .then((d) => {
        if (active) setData(d)
      })
      .catch(() => {
        if (active) setError(true)
      })
    return () => {
      active = false
    }
  }, [manifest, index, enabled, attempt])
  return {
    data,
    error,
    retry: () => {
      setError(false)
      setAttempt((a) => a + 1)
    },
  }
}
