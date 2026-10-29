import { categories, categoryLabels, type Company } from '../../types/benefits'
export function CompanyCompareTray({
  companies,
  remove,
}: {
  companies: Company[]
  remove: (id: string) => void
}) {
  if (!companies.length) return null
  return (
    <section className="benefits-compare" aria-label="선택 기업 비교">
      <h2>선택 기업 비교 · {companies.length}/4</h2>
      <p>
        적용 범위는 기업 상세의 국가·법인·직군 조건을 확인하세요. 자동으로
        승자를 정하지 않습니다.
      </p>
      <div className="benefits-table-scroll">
        <table>
          <caption>분야별 상태와 적용 범위</caption>
          <thead>
            <tr>
              <th scope="col">분야</th>
              {companies.map((c) => (
                <th key={c.company_id} scope="col">
                  {c.display_name}
                  <small>
                    {c.headquarters_country} · {c.legal_name}
                  </small>
                  <button
                    aria-label={`${c.display_name} 비교 해제`}
                    onClick={() => remove(c.company_id)}
                  >
                    해제
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((k) => (
              <tr key={k}>
                <th scope="row">{categoryLabels[k]}</th>
                {companies.map((c) => (
                  <td key={c.company_id}>
                    {c.category_summaries[k].status}
                    <small>
                      {c.category_summaries[k].limited
                        ? '일부 대상 · 상세 확인'
                        : '적용 대상 상세 확인'}
                    </small>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
