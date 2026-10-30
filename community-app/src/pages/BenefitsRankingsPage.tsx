import { useEffect } from 'react'
import { categories, categoryLabels } from '../types/benefits'
import type { Category } from '../types/benefits'
import type { ExplorerViewProps } from './BenefitsExplorerPage'
import { useBenefitsRankings } from '../lib/useBenefitsRankings'
import {
  CategoryRankingList,
  orderCategoryRankingRows,
} from '../components/benefits/CategoryRankingList'
export function BenefitsRankingsPage({
  manifest,
  index,
  state,
  update,
  companies,
  link,
}: ExplorerViewProps) {
  const category = state.categories.length === 1 ? state.categories[0] : null
  const { data, error, retry } = useBenefitsRankings(
    manifest,
    index,
    !!category,
  )
  const companyIds = new Set(companies.map((company) => company.company_id))
  const rows = data && category
    ? orderCategoryRankingRows(
        data.rows.filter(
          (row) => row.category === category && companyIds.has(row.company_id),
        ),
      )
    : []
  const pages = Math.max(1, Math.ceil(rows.length / 50))
  const page = Math.min(state.page, pages)
  useEffect(() => {
    if (data && state.page > pages) update({ page: pages })
  }, [data, pages, state.page, update])
  return (
    <>
      <h2>공식 공개자료로 확인된 복지 분야별 강도</h2>
      <p>분야별 근거의 범위·적용 대상·구체성·최신성을 비교합니다.</p>
      <label>
        순위 분야
        <select
          value={category ?? ''}
          onChange={(e) =>
            update({
              categories: e.target.value ? [e.target.value as Category] : [],
              page: 1,
            })
          }
        >
          <option value="">분야 선택</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {categoryLabels[c]}
            </option>
          ))}
        </select>
      </label>
      {!category ? (
        <p>순위를 볼 복지 분야 하나를 선택하세요.</p>
      ) : error ? (
        <div role="alert" className="benefits-error">
          순위 무결성 오류 · 이 화면의 평가를 표시하지 않습니다.
          <button onClick={retry}>순위 다시 시도</button>
        </div>
      ) : !data ? (
        <p role="status">분야별 근거를 불러오고 있습니다.</p>
      ) : (
        <>
          <p>
            동점: 공식성·최신성 → 적용 대상의 폭 → canonical company ID
            순서입니다.
          </p>
          <CategoryRankingList
            rows={rows.slice((page - 1) * 50, page * 50)}
            companies={companies}
            link={(id) => link(id, category)}
          />
          <nav aria-label="순위 페이지" className="benefits-pagination">
            <button
              disabled={page === 1}
              onClick={() => update({ page: page - 1 })}
            >
              이전 페이지
            </button>
            <span>
              {page} / {pages} · 페이지당 최대 50개
            </span>
            <button
              disabled={page >= pages}
              onClick={() => update({ page: page + 1 })}
            >
              다음 페이지
            </button>
          </nav>
        </>
      )}
    </>
  )
}
