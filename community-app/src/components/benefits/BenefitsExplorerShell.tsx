import type { ReactNode } from 'react'
import { AppHeader } from '../AppHeader'
import { AppFooter } from '../AppFooter'

import type { Manifest } from '../../types/benefits'
export function BenefitsExplorerShell({
  route,
  query,
  manifest,
  children,
}: {
  route: string
  query: string
  manifest?: Manifest
  children: ReactNode
}) {
  return (
    <div className="community-page benefits-page">
      <AppHeader />

      <main className="benefits-workspace">
        <div className="benefits-heading">
          <div>
            <p className="benefits-kicker">공개 근거로 살펴보는 기업 복지</p>
            <h1>기업 복지 탐색기</h1>
            <p>복지의 존재보다, 확인할 수 있는 범위를 먼저 봅니다.</p>
          </div>
          <strong className="fixture-badge">예시 데이터</strong>
        </div>
        <p className="benefits-disclosure">
          모든 기업·정책·점수는 가상입니다. 실제 기업의 복지 정보가 아닙니다.
        </p>
        <nav className="benefits-tabs" aria-label="복지 탐색 화면">
          {[
            ['heatmap', '', '복지 히트맵'],
            ['rankings', 'rankings/', '분야별 순위'],
            ['fit', 'fit/', '내게 맞는 복지'],
          ].map(([key, path, label]) => (
            <a
              key={key}
              aria-current={route === key ? 'page' : undefined}
              href={`/community/benefits/${path}${query}`}
            >
              {label}
            </a>
          ))}
          <a
            aria-current={route === 'methodology' ? 'page' : undefined}
            href="/community/benefits/methodology/"
          >
            조사 기준·정정 이력
          </a>
        </nav>
        {manifest && (
          <p className="benefits-version">
            데이터 {manifest.data_version} · {manifest.company_count}개 가상
            기업 · 생성일 {manifest.generated_at.slice(0, 10)}
          </p>
        )}
        {children}
      </main>
      <AppFooter />
    </div>
  )
}
