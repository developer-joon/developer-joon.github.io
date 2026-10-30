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

export type FitResult = {
  company: Company
  rows: Rankings['rows']
  fit: ReturnType<typeof fitScore>
}

export function buildFitResults(
  companies: Company[],
  rankings: Rankings,
  weights: Partial<Record<Category, number>>,
) {
  const rowsByCompany = new Map<string, Rankings['rows']>()
  for (const row of rankings.rows) {
    if (!row.eligible) continue
    const rows = rowsByCompany.get(row.company_id) ?? []
    rows.push(row)
    rowsByCompany.set(row.company_id, rows)
  }
  return companies
    .map((company): FitResult => {
      const rows = rowsByCompany.get(company.company_id) ?? []
      return {
        company,
        rows,
        fit: fitScore(
          weights,
          Object.fromEntries(rows.map((row) => [row.category, row.score])),
        ),
      }
    })
    .sort(
      (a, b) =>
        (b.fit.score ?? -1) - (a.fit.score ?? -1) ||
        a.company.company_id.localeCompare(b.company.company_id),
    )
}

export function FitResultList({
  results,
  details,
  weights,
  link,
  totalResults,
}: {
  results: FitResult[]
  details?: Detail[]
  weights: Partial<Record<Category, number>>
  link: (id: string) => string
  totalResults: number
}) {
  const wanted = categories.filter((c) => (weights[c] ?? 0) > 0)
  return (
    <div>
      {results.map(({ company, rows, fit }) => (
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
              const claims = details &&
                details
                  .find(
                    (detail) => detail.company_id === company.company_id,
                  )
                  ?.claims.filter((claim) => claim.category === category)
              return (
                <li key={category}>
                  {categoryLabels[category]} ·{' '}
                  {rows.some((row) => row.category === category)
                    ? `일치한 우선순위 · 확인된 복지 claim ${company.category_summaries[category].confirmed_count}건`
                    : '판단 자료 부족 · 확인되지 않거나 평가에서 제외된 조건'}
                  {claims ? (
                    <ClaimApplicability claims={claims} />
                  ) : (
                    <small>적용 범위 근거를 불러오는 중입니다.</small>
                  )}
                </li>
              )
            })}
          </ul>
        </article>
      ))}
      {totalResults > 50 && (
        <p>조건 일치 결과 상위 50개를 표시합니다. 필터로 범위를 좁혀 주세요.</p>
      )}
      {!results.length && <p>검색 결과가 없습니다</p>}
    </div>
  )
}
