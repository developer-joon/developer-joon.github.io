import { useEffect, useState } from 'react'
import { benefitsClient } from '../data/benefitsArtifactClient'
import type { BenefitAtlasData, BenefitCompanyDetailView } from '../data/benefitsArtifactClient'

type DetailsState = { key: string; data?: BenefitCompanyDetailView[]; error: boolean }
export function useBenefitsDetails(atlas: BenefitAtlasData | undefined, ids: string[]) {
  const key = ids.slice(0, 4).join(','); const [attempt, setAttempt] = useState(0); const [result, setResult] = useState<DetailsState>({ key: '', error: false })
  useEffect(() => {
    if (!atlas || !key) return
    let active = true; const controller = new AbortController()
    benefitsClient.loadAtlasCompanyDetails(atlas, key.split(','), controller.signal).then((data) => { if (active) setResult({ key, data, error: false }) }).catch(() => { if (active) setResult({ key, error: true }) })
    return () => { active = false; controller.abort() }
  }, [atlas, key, attempt])
  const current = result.key === key ? result : { key, error: false }
  return { data: key ? current.data : [], error: current.error, retry: () => setAttempt((value) => value + 1) }
}
