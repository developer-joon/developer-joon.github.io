import {
  categories,
  categoryLabels,
  type Company,
  type Detail,
} from '../../types/benefits'
import { ClaimApplicability } from './ClaimApplicability'

export function CompanyCompareTray({
  companies,
  details,
  error,
  retry,
  remove,
}: {
  companies: Company[]
  details?: Detail[]
  error: boolean
  retry: () => void
  remove: (id: string) => void
}) {
  if (!companies.length) return null
  return (
    <section className="benefits-compare" aria-label="선택 기업 비교">
      <h2>선택 기업 비교 · {companies.length}/4</h2>
      <p>
        검증된 claim의 국가·법인·직군·고용형태를 나란히 표시합니다. 자동으로
        승자를 정하지 않습니다.
      </p>
      {error ? (
        <p role="alert">
          적용 범위 무결성 오류 <button onClick={retry}>다시 시도</button>
        </p>
      ) : !details ? (
        <p role="status">비교 적용 범위를 불러오고 있습니다.</p>
      ) : null}
      <div className="benefits-table-scroll">
        <table>
          <caption>분야별 상태와 claim 적용 범위</caption>
          <thead>
            <tr>
              <th scope="col">분야</th>
              {companies.map((company) => (
                <th key={company.company_id} scope="col">
                  {company.display_name}
                  <button
                    aria-label={`${company.display_name} 비교 해제`}
                    onClick={() => remove(company.company_id)}
                  >
                    해제
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category}>
                <th scope="row">{categoryLabels[category]}</th>
                {companies.map((company) => (
                  <td key={company.company_id}>
                    {company.category_summaries[category].status}
                    {details && (
                      <ClaimApplicability
                        claims={
                          details
                            .find(
                              (detail) =>
                                detail.company_id === company.company_id,
                            )
                            ?.claims.filter(
                              (claim) => claim.category === category,
                            ) ?? []
                        }
                      />
                    )}
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
