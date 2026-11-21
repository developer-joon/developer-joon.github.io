import { lazy, Suspense } from 'react'
import { BenefitsApp } from './BenefitsApp'
import { benefitsRoute, legacyBenefitsRedirect } from './benefitsRoutes'
import { ConfigurationErrorScreen } from './ConfigurationErrorScreen'
import { parseEnv } from './config/env'

const CommunityApplication = lazy(() => import('./CommunityApplication'))

export function createApplication(env: Record<string, unknown>) {
  const redirect = legacyBenefitsRedirect(window.location.pathname, window.location.search, window.location.hash)
  if (redirect) {
    window.location.replace(redirect)
    return null
  }
  if (benefitsRoute(window.location.pathname)) return <BenefitsApp />
  try {
    parseEnv(env)
    return (
      <Suspense fallback={null}>
        <CommunityApplication />
      </Suspense>
    )
  } catch {
    return <ConfigurationErrorScreen />
  }
}
