import { useEffect, useState } from 'react'
import { benefitsClient } from '../data/benefitsArtifactClient'
import type { BenefitAtlasData, BenefitCompanyDetailView } from '../data/benefitsArtifactClient'

type DetailsState = { atlas?: BenefitAtlasData; key: string; attempt: number; data?: BenefitCompanyDetailView[]; error: boolean }
export function useBenefitsDetails(atlas: BenefitAtlasData | undefined, ids: string[]) {
  const key = ids.slice(0, 4).join(','); const [attempt, setAttempt] = useState(0); const [result, setResult] = useState<DetailsState>({ key: '', attempt: -1, error: false })
  useEffect(() => {
    if (!atlas || !key) return
    let active = true; const controller = new AbortController()
    benefitsClient.loadAtlasCompanyDetails(atlas, key.split(','), controller.signal).then((data) => { if (active) setResult({ atlas, key, attempt, data, error: false }) }).catch(() => { if (active) setResult({ atlas, key, attempt, error: true }) })
    return () => { active = false; controller.abort() }
  }, [atlas, key, attempt])
  const current = result.atlas === atlas && result.key === key && result.attempt === attempt ? result : { atlas, key, attempt, error: false }
  return { data: key ? current.data : [], error: current.error, retry: () => setAttempt((value) => value + 1) }
}
