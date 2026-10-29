import { rankOrder } from '../../lib/benefitsScoring'
import type { Company, Ranking } from '../../types/benefits'
export function CategoryRankingList({
  rows,
  companies,
  link,
}: {
  rows: Ranking[]
  companies: Company[]
  link: (id: string) => string
}) {
  const name = (id: string) =>
    companies.find((c) => c.company_id === id)!.display_name
  return (
    <>
      <section aria-label="분야별 평가 결과">
        <h3>분야별 평가 결과</h3>
        <ol>
          {rows
            .filter((r) => r.eligible)
            .sort(rankOrder)
            .map((r) => (
              <li className="benefits-result" key={r.company_id}>
                <a href={link(r.company_id)}>{name(r.company_id)}</a>{' '}
                <strong>{r.score} / 100</strong>
                <dl className="benefits-score-parts">
                  <div>
                    <dt>세부 유형 범위</dt>
                    <dd>{r.components.breadth}/35</dd>
                  </div>
                  <div>
                    <dt>적용 대상의 폭</dt>
                    <dd>{r.components.applicability}/30</dd>
                  </div>
                  <div>
                    <dt>구체성</dt>
                    <dd>{r.components.specificity}/20</dd>
                  </div>
                  <div>
                    <dt>공식성·최신성</dt>
                    <dd>{r.components.freshness}/15</dd>
                  </div>
                </dl>
              </li>
            ))}
        </ol>
        {!rows.some((r) => r.eligible) && (
          <p>현재 필터에서 평가 가능한 기업이 없습니다.</p>
        )}
      </section>
      <section aria-label="평가 근거 부족">
        <h3>평가 근거 부족</h3>
        <p>
          복지가 나쁘다는 의미가 아닙니다. 낮은 점수 대신 평가에서 분리합니다.
        </p>
        <ul>
          {rows
            .filter((r) => !r.eligible)
            .map((r) => (
              <li key={r.company_id}>
                <a href={link(r.company_id)}>{name(r.company_id)}</a> ·{' '}
                {r.reason}
              </li>
            ))}
        </ul>
      </section>
    </>
  )
}
