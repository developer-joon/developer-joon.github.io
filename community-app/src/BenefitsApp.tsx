import { lazy, Suspense } from 'react'
import { benefitsRoute } from './benefitsRoutes'
import { AppHeader } from './components/AppHeader'
import { AppFooter } from './components/AppFooter'
import type { BenefitDirectoryRepository } from './data/benefitDirectoryRepository'

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
const BenefitsDirectoryPage = lazy(() => import('./pages/BenefitsDirectoryPage').then((module) => ({ default: module.BenefitsDirectoryPage })))

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
  benefitDirectoryRepository,
}: {
  pathname?: string
  search?: string
  benefitDirectoryRepository?: BenefitDirectoryRepository
}) {
  const route = benefitsRoute(pathname)
  if (!route) throw new Error('복지 탐색기 경로가 아닙니다.')
  return (
    <Suspense fallback={<BenefitsFallback />}>
      {route === 'directory' ? (
        <BenefitsDirectoryPage search={search} repository={benefitDirectoryRepository} />
      ) : route === 'methodology' ? (
        <BenefitsMethodologyPage search={search} />
      ) : (
        <BenefitsExplorerPage route={route} search={search} />
      )}
    </Suspense>
  )
}
