import type { ExplorerViewProps } from './BenefitsExplorerPage'
import { FitPresetPicker } from '../components/benefits/FitPresetPicker'
import { FitResultList } from '../components/benefits/FitResultList'

export function BenefitsFitPage({ state, update, companies, link }: ExplorerViewProps) {
  return <><h2>조건 탐색</h2><p>조건은 URL과 현재 브라우저 메모리에만 존재하며 계정, 분석 도구 또는 브라우저 저장소에 기록하지 않습니다.</p><p>기업은 점수화하지 않습니다. 공개된 적용 범위와 선택 조건의 관계를 이유와 함께 구분합니다.</p><FitPresetPicker state={state} update={update} /><FitResultList companies={companies} state={state} link={link} /></>
}
