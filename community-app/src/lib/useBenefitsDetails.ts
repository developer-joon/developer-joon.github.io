import { useEffect, useState } from 'react'
import { benefitsClient } from '../data/benefitsArtifactClient'
import type { CompanyListing, Detail, Manifest } from '../types/benefits'

type DetailsState = { key: string; data?: Detail[]; error: boolean }
export function useBenefitsDetails(manifest: Manifest | undefined, listings: CompanyListing[] | undefined, ids: string[]) {
  const key = ids.slice(0, 4).join(','); const [attempt, setAttempt] = useState(0); const [result, setResult] = useState<DetailsState>({ key: '', error: false })
  useEffect(() => {
    if (!manifest || !listings || !key) return
    let active = true; const controller = new AbortController()
    benefitsClient.loadCompanyDetails(manifest, listings, key.split(','), controller.signal).then((data) => { if (active) setResult({ key, data, error: false }) }).catch(() => { if (active) setResult({ key, error: true }) })
    return () => { active = false; controller.abort() }
  }, [manifest, listings, key, attempt])
  const current = result.key === key ? result : { key, error: false }
  return { data: key ? current.data : [], error: current.error, retry: () => setAttempt((value) => value + 1) }
}
