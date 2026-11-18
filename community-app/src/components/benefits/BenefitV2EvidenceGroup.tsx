import { useId } from 'react'
import { categories, categoryLabels, safePublicSourceUrlSchema, verifiedBenefitPropositions, type Category, type Detail } from '../../types/benefits'

const scopeText = (scope: { countries: string[]; legal_entities: string[]; roles: string[]; employment_types: string[] }) => `국가 ${scope.countries.join(', ') || '명시되지 않음'} · 법인 ${scope.legal_entities.join(', ') || '명시되지 않음'} · 직군 ${scope.roles.join(', ') || '명시되지 않음'} · 고용형태 ${scope.employment_types.join(', ') || '명시되지 않음'}`
const reliabilityText = { medium: '중간', low: '낮음' } as const
const currentnessText = { current: '현재 정보', historical: '과거 정보', unknown: '확인되지 않음' } as const
const scopeStatusText = { exact_entity: '해당 법인', bounded_entity: '제한된 법인 범위', group_only: '그룹 단위', unresolved: '미확인' } as const
const conflictText = { none: '없음', disclosed: '상충 정보 공개됨', contradictory: '모순됨' } as const
const revalidationNotice = '재검증 중 — 구체 혜택 확인 필요. 아래 자료는 근거·조사 맥락이며 구체 혜택으로 집계하지 않습니다.'

type EvidenceScope = { countries: string[]; legal_entities: string[]; roles: string[]; employment_types: string[] }
type LimitationProps = {
  reliability?: 'medium' | 'low'
  currentness?: 'current' | 'historical' | 'unknown'
  scopeStatus?: 'exact_entity' | 'bounded_entity' | 'group_only' | 'unresolved'
  scope?: EvidenceScope
  conflictStatus?: 'none' | 'disclosed' | 'contradictory'
}
type EvidenceRecord = NonNullable<Detail['references']>[number] | NonNullable<Detail['community_reports']>[number]
type VerifiedBenefit = NonNullable<Detail['verified_benefits']>[number]
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

const VerifiedBenefitLimitations = ({ benefit }: { benefit: VerifiedBenefit }) => <dl className="benefits-evidence__limitations">
  <dt>현재성: </dt><dd>{currentnessText[benefit.currentness]}</dd>
  <dt>적용 범위: </dt><dd>{scopeText(benefit.scope)} · 가족 구성원 {benefit.scope.family_members.join(', ') || '명시되지 않음'} · 조건 {benefit.scope.conditions.join(', ') || '명시되지 않음'}</dd>
  <dt>현재성 확인일: </dt><dd><time dateTime={benefit.currentness_checked_at}>{new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(benefit.currentness_checked_at))}</time></dd>
  <dt>상충 상태: </dt><dd>{conflictText[benefit.conflict_status]}</dd>
</dl>

const safeSources = (detail: Detail) => new Map((detail.sources ?? []).flatMap((source) => {
  const { url: rawUrl, ...sourceFields } = source
  const url = safePublicSourceUrlSchema.safeParse(rawUrl)
  return url.success ? [[source.source_id, { ...sourceFields, url: url.data }] as const] : []
}))

type PreparedEvidence = {
  sources: ReturnType<typeof safeSources>
  officialByCategory: Map<Category, OfficialClaim[]>
  recordsByCategory: Map<Category, EvidenceRecord[]>
  benefitsByCategory: Map<Category, VerifiedBenefit[]>
  evidenceSourceIds: Map<string, string[]>
  outcomesByCategory: Map<Category, CategoryOutcome>
}

function prepareEvidence(detail: Detail): PreparedEvidence {
  const sources = safeSources(detail)
  const officialByCategory = new Map(categories.map((category) => [category, [] as OfficialClaim[]]))
  const recordsByCategory = new Map(categories.map((category) => [category, [] as EvidenceRecord[]]))
  const benefitsByCategory = new Map(categories.map((category) => [category, [] as VerifiedBenefit[]]))
  const evidenceSourceIds = new Map<string, string[]>()
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
    evidenceSourceIds.set(record.reference_id, [record.source_id])
  }
  for (const record of detail.community_reports ?? []) {
    if (record.publication_eligibility !== 'eligible' || sourceEligibility.get(record.source_id) !== 'eligible') continue
    const category = record.category_id
    const seen = seenByCategory.get(category)
    if (!seen || seen.has(record.community_report_id)) continue
    seen.add(record.community_report_id)
    recordsByCategory.get(category)?.push(record)
    evidenceSourceIds.set(record.community_report_id, [record.source_id])
  }
  for (const record of detail.official_claims ?? []) {
    const category = record.category_id
    officialByCategory.get(category)?.push(record)
    evidenceSourceIds.set(record.claim_id, record.source_ids)
  }
  for (const category of categories) benefitsByCategory.set(category, verifiedBenefitPropositions(detail, category))
  for (const outcome of detail.category_outcomes ?? []) outcomesByCategory.set(outcome.category_id, outcome)

  return { sources, officialByCategory, recordsByCategory, benefitsByCategory, evidenceSourceIds, outcomesByCategory }
}

type BenefitV2EvidenceGroupProps = { category: Category; detail: Detail; prepared?: PreparedEvidence }

export function BenefitV2EvidenceGroup({ category, detail, prepared }: BenefitV2EvidenceGroupProps) {
  const evidence = prepared ?? prepareEvidence(detail)
  const groupId = useId()
  const sources = evidence.sources
  const official = evidence.officialByCategory.get(category) ?? []
  const records = evidence.recordsByCategory.get(category) ?? []
  const benefits = evidence.benefitsByCategory.get(category) ?? []
  const outcome = evidence.outcomesByCategory.get(category)
  const noPublicInfo = outcome && 'state' in outcome && outcome.state === 'no_public_info'
  const categoryHeadingId = `${groupId}-${category}-benefit-heading`

  return <section id={category} tabIndex={-1} className="benefits-v2-evidence" aria-labelledby={categoryHeadingId}>
    <h3 id={categoryHeadingId}>{categoryLabels[category]}</h3>
    {benefits.map((benefit, index) => {
      const headingId = `${groupId}-${category}-benefit-${index + 1}`
      const sourceIds = [...new Set(benefit.evidence_ids.flatMap((id) => evidence.evidenceSourceIds.get(id) ?? []))]
      return <article aria-labelledby={headingId} className="benefits-specific-card" key={benefit.benefit_id}>
        <p className="benefits-specific-card__tier">독립 검토 완료</p>
        <h4 id={headingId}>{benefit.title}<span className="sr-only"> — {categoryLabels[category]} {index + 1}번 구체 혜택</span></h4>
        <p>{benefit.description}</p>
        <dl className="benefits-specific-card__facts"><dt>분야</dt><dd>{categoryLabels[category]}</dd><dt>검토 상태</dt><dd>독립 검토 완료</dd></dl>
        <VerifiedBenefitLimitations benefit={benefit} />
        {sourceIds.length > 0 && <ul className="benefits-evidence__sources">{sourceIds.map((sourceId) => { const source = sources.get(sourceId); return source ? <li key={sourceId}><a href={source.url} target="_blank" rel="noopener noreferrer">출처: {source.title}</a></li> : null })}</ul>}
      </article>
    })}
    {!prepared && benefits.length === 0 && (official.length > 0 || records.length > 0) && <p className="benefits-official-only-notice">{revalidationNotice}</p>}
    {records.map((record, index) => {
      const isReference = 'reference_id' in record
      const recordId = isReference ? record.reference_id : record.community_report_id
      const tier = isReference ? '참고 조사 근거' : '커뮤니티 조사 맥락'
      const tierOrdinal = records.slice(0, index + 1).filter((item) => ('reference_id' in item) === isReference).length
      const source = sources.get(record.source_id)
      const headingId = `${groupId}-${category}-evidence-${index + 1}`
      return <article aria-labelledby={headingId} className={`benefits-evidence${isReference ? ' benefits-evidence--reference' : ' benefits-evidence--community'}`} key={recordId}>
        <p>{tier} · 구체 혜택으로 집계하지 않음</p>
        <h4 id={headingId}>{record.statement}<span className="sr-only"> — {categoryLabels[category]} {tier} {tierOrdinal}번</span></h4>
        {isReference && <blockquote>{record.supporting_quote}</blockquote>}
        <Limitations reliability={record.reliability} currentness={record.currentness} scopeStatus={isReference ? record.scope?.status : record.scope_status} scope={record.scope} conflictStatus={record.conflict_status} />
        {source && <p><a href={source.url} target="_blank" rel="noopener noreferrer">출처: {source.title}</a></p>}
      </article>
    })}
    {official.map((record) => <article aria-label={`${categoryLabels[category]} 공식 자료 조사 맥락`} className="benefits-evidence benefits-evidence--official" key={record.claim_id}>
      <h4>공식 자료 조사 맥락</h4>
      <p>공식 출처와 적용 범위 확인 기록입니다. 구체 혜택 카드로 집계하지 않습니다.</p>
      <dl><dt>분야</dt><dd>{categoryLabels[category]}</dd><dt>적용 범위</dt><dd>{scopeText(record.scope)}</dd><dt>출처</dt><dd><ul className="benefits-evidence__sources">{record.source_ids.map((sourceId) => { const source = sources.get(sourceId); return source ? <li key={sourceId}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></li> : null })}</ul></dd></dl>
    </article>)}
    {!official.length && !records.length && !benefits.length && <p>{outcome && 'state' in outcome && outcome.state === 'not_researched' ? '조사를 시작하지 않았습니다. 복지가 없다는 뜻이 아닙니다.' : noPublicInfo ? '이번 조사에서 게시 가능한 공개 정보를 확인하지 못했습니다. 복지가 없다는 뜻이 아닙니다.' : outcome && 'state' in outcome && outcome.state === 'research_incomplete' ? '현재까지 게시 가능한 공개 복지 자료를 확인하지 못했습니다. 조사 미완료이며 복지가 없다는 뜻이 아닙니다.' : outcome && 'state' in outcome && outcome.state === 'source_access_failed' ? '출처에 접근하지 못해 공개 복지 자료를 확인할 수 없습니다. 복지가 없다는 뜻이 아닙니다.' : outcome && 'state' in outcome && outcome.state === 'conflicting_evidence' ? '공개 근거가 상충하여 혜택을 확인하지 못했습니다. 복지가 없다는 뜻이 아닙니다.' : '이 분야에 게시 가능한 독립 검토 혜택이나 조사 근거가 없습니다.'}</p>}
  </section>
}

export function BenefitV2EvidenceSection({ detail }: { detail: Detail }) {
  const prepared = prepareEvidence(detail)
  const count = categories.reduce((total, category) => total + (prepared.benefitsByCategory.get(category)?.length ?? 0), 0)
  return <section className="benefits-specific-section" aria-labelledby="confirmed-specific-benefits">
    <h2 id="confirmed-specific-benefits">확인된 복지 혜택 ({count}건)</h2>
    <p className="benefits-specific-section__intro">독립 검토를 완료한 구체 혜택만 집계합니다. 참고 자료와 커뮤니티 보고는 조사 맥락으로만 표시합니다.</p>
    {count === 0 && <p className="benefits-official-only-notice">재검증 중 — 구체 혜택 확인 필요</p>}
    {categories.map((category) => <BenefitV2EvidenceGroup key={category} category={category} detail={detail} prepared={prepared} />)}
  </section>
}
