import { useEffect, useState } from 'react'
import { benefitsClient } from '../data/benefitsArtifactClient'
import type { CompanyIndex, Detail, Manifest } from '../types/benefits'

type DetailsState = { key: string; data?: Detail[]; error: boolean }

export function useBenefitsDetails(
  manifest: Manifest | undefined,
  index: CompanyIndex | undefined,
  ids: string[],
) {
  const key = ids.join(',')
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<DetailsState>({ key: '', error: false })
  useEffect(() => {
    if (!manifest || !index || !key) return
    let active = true
    benefitsClient
      .loadCompanyDetails(manifest, index, key.split(','))
      .then((data) => {
        if (active) setResult({ key, data, error: false })
      })
      .catch(() => {
        if (active) setResult({ key, error: true })
      })
    return () => {
      active = false
    }
  }, [manifest, index, key, attempt])
  const current = result.key === key ? result : { key, error: false }
  return {
    data: key ? current.data : [],
    error: current.error,
    retry: () => setAttempt((value) => value + 1),
  }
}
