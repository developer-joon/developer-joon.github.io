import type { ReactNode } from 'react'
import { AppHeader } from '../AppHeader'
import { AppFooter } from '../AppFooter'
import type { Manifest } from '../../types/benefits'

export function BenefitsExplorerShell({ route, query, manifest, children }: { route: string; query: string; manifest?: Manifest; children: ReactNode }) {
  return <div className="community-page benefits-page">
    <AppHeader />
    <main className="benefits-main">
      <section className="benefit-atlas-hero" aria-labelledby="benefit-atlas-title">
        <div className="benefit-atlas-hero__inner community-wrap">
          <p className="benefits-kicker">공개 근거로 살펴보는 기업 복지</p>
          <h1 id="benefit-atlas-title">Benefit Atlas</h1>
          <p className="benefit-atlas-hero__copy">기업별 공개 근거와 확인 범위를 한눈에 탐색하세요.</p>
          {manifest && <p className="benefits-version">데이터 {manifest.data_version} · {manifest.company_count}개 기업 · 생성일 {manifest.generated_at.slice(0, 10)}</p>}
          {manifest?.approved_v2_projection && <p className="benefits-coverage">승인 v2 조사 · 전체 {manifest.approved_v2_projection.total_batch_count}개 중 {manifest.approved_v2_projection.approved_batch_count}개 batch · {manifest.approved_v2_projection.projected_company_count.toLocaleString('en-US')}/{manifest.approved_v2_projection.total_company_count.toLocaleString('en-US')}개 기업</p>}
        </div>
      </section>
      <div className="benefits-workspace community-wrap">
        <nav className="benefits-tabs" aria-label="복지 탐색 화면">
          <a aria-current={route === 'heatmap' ? 'page' : undefined} href={`/community/benefits/${query}`}>복지 현황</a>
          <a aria-current={route === 'fit' ? 'page' : undefined} href={`/community/benefits/fit/${query}`}>조건 탐색</a>
          <a aria-current={route === 'methodology' ? 'page' : undefined} href={`/community/benefits/methodology/${query}`}>조사 기준·정정 이력</a>
        </nav>
        {children}
      </div>
    </main>
    <AppFooter />
  </div>
}
