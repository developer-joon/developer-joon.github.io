import { useBenefitsRankings } from '../../lib/useBenefitsRankings'
import { rankOrder } from '../../lib/benefitsScoring'
import { categoryLabels } from '../../types/benefits'
import type { ExplorerViewProps } from '../../pages/BenefitsExplorerPage'
export function CategoryRankingSummary({
  manifest,
  index,
  state,
  companies,
  link,
}: ExplorerViewProps) {
  const category = state.categories.length === 1 ? state.categories[0] : null
  const { data, error, retry } = useBenefitsRankings(
    manifest,
    index,
    !!category,
  )
  if (!category)
    return (
      <p>분야 하나를 선택하면 공식 근거가 확인된 상위 기업을 표시합니다.</p>
    )
  if (error)
    return (
      <section>
        <p>분야 요약 무결성 오류</p>
        <button onClick={retry}>요약 다시 시도</button>
      </section>
    )
  if (!data) return <p role="status">분야 요약을 불러오고 있습니다.</p>
  const rows = data.rows
    .filter(
      (r) =>
        r.category === category &&
        r.eligible &&
        companies.some((c) => c.company_id === r.company_id),
    )
    .sort(rankOrder)
    .slice(0, 3)
  return (
    <section aria-label="분야별 상위 기업">
      <h3>{categoryLabels[category]} · 공개 근거 상위</h3>
      <ol>
        {rows.map((r) => (
          <li key={r.company_id}>
            <a href={link(r.company_id, category)}>
              {
                companies.find((c) => c.company_id === r.company_id)!
                  .display_name
              }
            </a>
            <strong>{r.score}/100</strong>
          </li>
        ))}
      </ol>
      {!rows.length && <p>현재 조건에서 평가 가능한 근거가 없습니다.</p>}
    </section>
  )
}
