import type { ReactNode } from 'react'
import { AppHeader } from '../AppHeader'
import { AppFooter } from '../AppFooter'
import type { Manifest } from '../../types/benefits'

export function BenefitsExplorerShell({ route, query, manifest, children }: { route: string; query: string; manifest?: Manifest; children: ReactNode }) {
  return <div className="community-page benefits-page">
    <AppHeader />
    <main className="benefits-workspace">
      <div className="benefits-heading"><div><p className="benefits-kicker">공개 근거로 살펴보는 기업 복지</p><h1>기업 복지 탐색기</h1><p>확인된 내용과 근거의 한계를 함께 표시합니다.</p></div></div>
      <nav className="benefits-tabs" aria-label="복지 탐색 화면">
        <a aria-current={route === 'heatmap' ? 'page' : undefined} href={`/community/benefits/${query}`}>복지 현황</a>
        <a aria-current={route === 'fit' ? 'page' : undefined} href={`/community/benefits/fit/${query}`}>조건 탐색</a>
        <a aria-current={route === 'methodology' ? 'page' : undefined} href={`/community/benefits/methodology/${query}`}>조사 기준·정정 이력</a>
      </nav>
      {manifest && <p className="benefits-version">데이터 {manifest.data_version} · {manifest.company_count}개 기업 · 생성일 {manifest.generated_at.slice(0, 10)}</p>}
      {children}
    </main>
    <AppFooter />
  </div>
}
