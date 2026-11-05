import { useId } from 'react'
import { categories, categoryLabels, safePublicSourceUrlSchema, specificBenefitRecords, type Category, type Detail } from '../../types/benefits'

const scopeText = (scope: { countries: string[]; legal_entities: string[]; roles: string[]; employment_types: string[] }) => `국가 ${scope.countries.join(', ') || '명시되지 않음'} · 법인 ${scope.legal_entities.join(', ') || '명시되지 않음'} · 직군 ${scope.roles.join(', ') || '명시되지 않음'} · 고용형태 ${scope.employment_types.join(', ') || '명시되지 않음'}`
const reliabilityText = { medium: '중간', low: '낮음' } as const
const currentnessText = { current: '현재 정보', historical: '과거 정보', unknown: '확인되지 않음' } as const
const scopeStatusText = { exact_entity: '해당 법인', bounded_entity: '제한된 법인 범위', group_only: '그룹 단위', unresolved: '미확인' } as const
const conflictText = { none: '없음', disclosed: '상충 정보 공개됨', contradictory: '모순됨' } as const
const officialOnlyNotice = '구체 혜택 확인 필요 — 공식 출처와 적용 범위는 확인됐지만, 공개 데이터에 혜택명과 지원 내용이 구조화되지 않았습니다.'

type EvidenceScope = { countries: string[]; legal_entities: string[]; roles: string[]; employment_types: string[] }
type LimitationProps = {
  reliability?: 'medium' | 'low'
  currentness?: 'current' | 'historical' | 'unknown'
  scopeStatus?: 'exact_entity' | 'bounded_entity' | 'group_only' | 'unresolved'
  scope?: EvidenceScope
  conflictStatus?: 'none' | 'disclosed' | 'contradictory'
}
type SpecificBenefitRecord = ReturnType<typeof specificBenefitRecords>[number]
type OfficialClaim = NonNullable<Detail['official_claims']>[number]
type CategoryOutcome = Detail['category_outcomes'][number]

const Limitations = ({ reliability, currentness, scopeStatus, scope, conflictStatus }: LimitationProps) => {
  if (!reliability || !currentness || !scopeStatus || !scope || !conflictStatus) return null
  return <dl className="benefits-evidence__limitations">
    <dt>신뢰도: </dt><dd>{reliabilityText[reliability]}</dd>
    <dt>현재성: </dt><dd>{currentnessText[currentness]}</dd>
    <dt>적용 범위 상태: </dt><dd>{scopeStatusText[scopeStatus]}</dd>
    <dt>적용 범위: </dt><dd>{scopeText(scope)}</dd>
    <dt>상충 상태: </dt><dd>{conflictText[conflictStatus]}</dd>
  </dl>
}

const safeSources = (detail: Detail) => new Map((detail.sources ?? []).flatMap((source) => {
  const { url: rawUrl, ...sourceFields } = source
  const url = safePublicSourceUrlSchema.safeParse(rawUrl)
  return url.success ? [[source.source_id, { ...sourceFields, url: url.data }] as const] : []
}))

type PreparedEvidence = {
  sources: ReturnType<typeof safeSources>
  officialByCategory: Map<Category, OfficialClaim[]>
  recordsByCategory: Map<Category, SpecificBenefitRecord[]>
  outcomesByCategory: Map<Category, CategoryOutcome>
}

function prepareEvidence(detail: Detail): PreparedEvidence {
  const sources = safeSources(detail)
  const officialByCategory = new Map(categories.map((category) => [category, [] as OfficialClaim[]]))
  const recordsByCategory = new Map(categories.map((category) => [category, [] as SpecificBenefitRecord[]]))
  const outcomesByCategory = new Map<Category, CategoryOutcome>()
  const sourceEligibility = new Map((detail.sources ?? []).flatMap((source) => 'publication_eligibility' in source ? [[source.source_id, source.publication_eligibility] as const] : []))
  const seenByCategory = new Map(categories.map((category) => [category, new Set<string>()]))

  for (const record of detail.references ?? []) {
    const sourceIsPublishable = ['eligible', 'reference_only'].includes(sourceEligibility.get(record.source_id) ?? '')
    if (!['eligible', 'reference_only'].includes(record.publication_eligibility) || !sourceIsPublishable) continue
    const category = record.category_id
    const seen = seenByCategory.get(category)
    if (!seen || seen.has(record.reference_id)) continue
    seen.add(record.reference_id)
    recordsByCategory.get(category)?.push(record)
  }
  for (const record of detail.community_reports ?? []) {
    if (record.publication_eligibility !== 'eligible' || sourceEligibility.get(record.source_id) !== 'eligible') continue
    const category = record.category_id
    const seen = seenByCategory.get(category)
    if (!seen || seen.has(record.community_report_id)) continue
    seen.add(record.community_report_id)
    recordsByCategory.get(category)?.push(record)
  }
  for (const record of detail.official_claims ?? []) officialByCategory.get(record.category_id)?.push(record)
  for (const outcome of detail.category_outcomes ?? []) outcomesByCategory.set(outcome.category_id, outcome)

  return { sources, officialByCategory, recordsByCategory, outcomesByCategory }
}

type BenefitV2EvidenceGroupProps = { category: Category; detail: Detail; prepared?: PreparedEvidence }

export function BenefitV2EvidenceGroup({ category, detail, prepared }: BenefitV2EvidenceGroupProps) {
  const evidence = prepared ?? prepareEvidence(detail)
  const groupId = useId()
  const sources = evidence.sources
  const official = evidence.officialByCategory.get(category) ?? []
  const records = evidence.recordsByCategory.get(category) ?? []
  const outcome = evidence.outcomesByCategory.get(category)
  const noPublicInfo = outcome && 'state' in outcome && outcome.state === 'no_public_info'
  const categoryHeadingId = `${groupId}-${category}-benefit-heading`

  return <section id={category} tabIndex={-1} className="benefits-v2-evidence" aria-labelledby={categoryHeadingId}>
    <h3 id={categoryHeadingId}>{categoryLabels[category]}</h3>
    {records.map((record, index) => {
      const isReference = 'reference_id' in record
      const recordId = isReference ? record.reference_id : record.community_report_id
      const tier = isReference ? '참고 자료' : '커뮤니티 보고'
      const tierOrdinal = records.slice(0, index + 1).filter((item) => ('reference_id' in item) === isReference).length
      const source = sources.get(record.source_id)
      const headingId = `${groupId}-${category}-benefit-${index + 1}`
      return <article aria-labelledby={headingId} className={`benefits-specific-card${isReference ? '' : ' benefits-specific-card--community'}`} key={recordId}>
        <p className="benefits-specific-card__tier">{tier}</p>
        <h4 id={headingId}>{record.statement}<span className="sr-only"> — {categoryLabels[category]} {tier} {tierOrdinal}번 구체 혜택</span></h4>
        <dl className="benefits-specific-card__facts"><dt>분야</dt><dd>{categoryLabels[category]}</dd><dt>근거 계층</dt><dd>{tier}</dd></dl>
        {isReference && <blockquote>{record.supporting_quote}</blockquote>}
        <Limitations reliability={record.reliability} currentness={record.currentness} scopeStatus={isReference ? record.scope?.status : record.scope_status} scope={record.scope} conflictStatus={record.conflict_status} />
        {source && <p className="benefits-specific-card__source"><a href={source.url} target="_blank" rel="noopener noreferrer">출처: {source.title}</a></p>}
      </article>
    })}
    {official.length > 0 && records.length === 0 && <p className="benefits-official-only-notice">{officialOnlyNotice}</p>}
    {official.map((record) => <article aria-label={`${categoryLabels[category]} 공식 검증 맥락`} className="benefits-evidence benefits-evidence--official" key={record.claim_id}>
      <h4>공식 검증 맥락</h4>
      <p>공식 출처와 적용 범위 확인 기록입니다. 구체 혜택 카드로 집계하지 않습니다.</p>
      <dl><dt>분야</dt><dd>{categoryLabels[category]}</dd><dt>적용 범위</dt><dd>{scopeText(record.scope)}</dd><dt>출처</dt><dd><ul className="benefits-evidence__sources">{record.source_ids.map((sourceId) => { const source = sources.get(sourceId); return source ? <li key={sourceId}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></li> : null })}</ul></dd></dl>
    </article>)}
    {!official.length && !records.length && <p>{noPublicInfo ? '이번 조사에서 게시 가능한 공개 정보를 확인하지 못했습니다. 복지가 없다는 뜻이 아닙니다.' : '이 분야에 게시 가능한 승인 v2 근거가 없습니다.'}</p>}
  </section>
}

export function BenefitV2EvidenceSection({ detail }: { detail: Detail }) {
  const prepared = prepareEvidence(detail)
  const count = categories.reduce((total, category) => total + (prepared.recordsByCategory.get(category)?.length ?? 0), 0)
  return <section className="benefits-specific-section" aria-labelledby="confirmed-specific-benefits">
    <h2 id="confirmed-specific-benefits">확인된 복지 혜택 ({count}건)</h2>
    <p className="benefits-specific-section__intro">공개 근거에 혜택 내용이 문장으로 명시된 기록입니다. 분야는 탐색을 돕는 보조 정보이며, 아래 문장을 원문 그대로 확인하세요.</p>
    {categories.map((category) => <BenefitV2EvidenceGroup key={category} category={category} detail={detail} prepared={prepared} />)}
  </section>
}
