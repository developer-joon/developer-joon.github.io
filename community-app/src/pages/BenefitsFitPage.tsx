import { useMemo } from 'react'
import type { ExplorerViewProps } from './BenefitsExplorerPage'
import { useBenefitsRankings } from '../lib/useBenefitsRankings'
import { presetWeights } from '../lib/benefitsQueryState'
import { FitPresetPicker } from '../components/benefits/FitPresetPicker'
import {
  buildFitResults,
  FitResultList,
} from '../components/benefits/FitResultList'
import { useBenefitsDetails } from '../lib/useBenefitsDetails'
export function BenefitsFitPage({
  manifest,
  index,
  state,
  update,
  companies,
  link,
}: ExplorerViewProps) {
  const { data, error, retry } = useBenefitsRankings(manifest, index)
  const weights =
    state.preset === 'custom' ? state.weights : presetWeights(state.preset)
  const candidates = useMemo(
    () => (data ? buildFitResults(companies, data, weights).slice(0, 50) : []),
    [companies, data, weights],
  )
  const applicability = useBenefitsDetails(
    manifest,
    index,
    candidates.map(({ company }) => company.company_id),
  )
  return (
    <>
      <h2>조건 일치 기업</h2>
      <p>
        우선순위는 URL과 현재 브라우저 메모리에만 존재합니다. 계정이나 서버에
        저장하지 않습니다.
      </p>
      <p>
        확인 불가는 감점하지 않고 계산 대상에서 제외합니다. 비교 가능한 분야가
        절반 미만이면 자료 부족을 표시합니다.
      </p>
      <FitPresetPicker state={state} update={update} />
      {error ? (
        <div role="alert">
          순위 무결성 오류 · 일치도 계산을 중단했습니다.
          <button onClick={retry}>순위 다시 시도</button>
        </div>
      ) : !data ? (
        <p role="status">근거를 불러오고 있습니다.</p>
      ) : (
        <>
          {applicability.error && (
            <div role="alert">
              적용 범위 근거를 표시할 수 없습니다.
              <button onClick={applicability.retry}>적용 범위 다시 시도</button>
            </div>
          )}
          <FitResultList
            results={candidates}
            details={applicability.data}
            weights={weights}
            link={link}
            totalResults={companies.length}
          />
        </>
      )}
    </>
  )
}
