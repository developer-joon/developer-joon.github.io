import { lazy, Suspense } from 'react'
import { benefitsRoute } from './benefitsRoutes'
import { AppHeader } from './components/AppHeader'
import { AppFooter } from './components/AppFooter'

const BenefitsMethodologyPage = lazy(() =>
  import('./pages/BenefitsMethodologyPage').then((module) => ({
    default: module.BenefitsMethodologyPage,
  })),
)
const BenefitsExplorerPage = lazy(() =>
  import('./pages/BenefitsExplorerPage').then((module) => ({
    default: module.BenefitsExplorerPage,
  })),
)

function BenefitsFallback() {
  return (
    <div className="community-page benefits-page">
      <AppHeader />
      <main className="benefits-workspace">
        <p role="status">복지 탐색기를 준비하고 있습니다.</p>
      </main>
      <AppFooter />
    </div>
  )
}

export function BenefitsApp({
  pathname = window.location.pathname,
  search = window.location.search,
}: {
  pathname?: string
  search?: string
}) {
  const route = benefitsRoute(pathname)
  if (!route) throw new Error('복지 탐색기 경로가 아닙니다.')
  return (
    <Suspense fallback={<BenefitsFallback />}>
      {route === 'methodology' ? (
        <BenefitsMethodologyPage />
      ) : (
        <BenefitsExplorerPage route={route} search={search} />
      )}
    </Suspense>
  )
}
