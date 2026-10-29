import {
  categories,
  categoryLabels,
  type Company,
  type Rankings,
  type Category,
  type Detail,
} from '../../types/benefits'
import { fitScore } from '../../lib/benefitsScoring'
import { ClaimApplicability } from './ClaimApplicability'
export function FitResultList({
  companies,
  rankings,
  details,
  weights,
  link,
}: {
  companies: Company[]
  rankings: Rankings
  details: Detail[]
  weights: Partial<Record<Category, number>>
  link: (id: string) => string
}) {
  const wanted = categories.filter((c) => (weights[c] ?? 0) > 0)
  const results = companies
    .map((company) => {
      const rows = rankings.rows.filter(
        (r) => r.company_id === company.company_id && r.eligible,
      )
      return {
        company,
        rows,
        fit: fitScore(
          weights,
          Object.fromEntries(rows.map((r) => [r.category, r.score])),
        ),
      }
    })
    .sort(
      (a, b) =>
        (b.fit.score ?? -1) - (a.fit.score ?? -1) ||
        a.company.company_id.localeCompare(b.company.company_id),
    )
  return (
    <div>
      {results.slice(0, 50).map(({ company, rows, fit }) => (
        <article className="benefits-result" key={company.company_id}>
          <h3>
            <a href={link(company.company_id)}>{company.display_name}</a> ·{' '}
            {fit.score === null ? '자료 부족' : `일치도 ${fit.score}%`}
          </h3>
          <p>
            비교 가능한 분야 {fit.comparable}/{fit.requested} · 근거 coverage{' '}
            {Math.round(company.source_coverage * 100)}%
          </p>
          <ul>
            {wanted.map((category) => {
              const claims =
                details
                  .find(
                    (detail) => detail.company_id === company.company_id,
                  )
                  ?.claims.filter((claim) => claim.category === category) ?? []
              return (
                <li key={category}>
                  {categoryLabels[category]} ·{' '}
                  {rows.some((row) => row.category === category)
                    ? `일치한 우선순위 · 확인된 복지 claim ${company.category_summaries[category].confirmed_count}건`
                    : '판단 자료 부족 · 확인되지 않거나 평가에서 제외된 조건'}
                  <ClaimApplicability claims={claims} />
                </li>
              )
            })}
          </ul>
        </article>
      ))}
      {results.length > 50 && (
        <p>조건 일치 결과 상위 50개를 표시합니다. 필터로 범위를 좁혀 주세요.</p>
      )}
      {!results.length && <p>검색 결과가 없습니다</p>}
    </div>
  )
}
