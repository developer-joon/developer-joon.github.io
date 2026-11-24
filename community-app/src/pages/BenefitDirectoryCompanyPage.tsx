import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AppFooter } from '../components/AppFooter'
import { AppHeader } from '../components/AppHeader'
import { getBenefitDirectoryRepository, type BenefitDirectoryRepository } from '../data/benefitDirectoryRepository'
import { benefitClaimHref, benefitClaimReactionHref } from '../benefitsRoutes'
import { isBenefitCompanyId } from '../lib/benefitCompanyId'
import { parseBenefitDirectoryQuery, serializeBenefitDirectoryQuery } from '../lib/benefitDirectoryQueryState'
import { presentPublicDirectoryError } from '../lib/publicDirectoryErrorPresentation'
import {
  type BenefitCompanyDetail,
  type BenefitDirectoryError,
  type BenefitDirectoryPublication,
  type BenefitDirectoryPublicClaim,
} from '../types/benefitDirectory'

const MAX_SEARCH_LENGTH = 10_000
const RETURN_KEYS = new Set(['q', 'categories', 'industry', 'size', 'hasBenefitsOnly', 'sort'])

interface ParsedCompanyQuery {
  id: string | null
  directoryQuery: string
}

function decodeQueryPart(value: string) {
  try { return decodeURIComponent(value.replace(/\+/g, ' ')) }
  catch { return null }
}

function parseCompanyQuery(search: string): ParsedCompanyQuery {
  if (search.length > MAX_SEARCH_LENGTH) return { id: null, directoryQuery: '' }
  const source = search.startsWith('?') ? search.slice(1) : search
  const entries: Array<{ key: string; rawKey: string; value: string; rawValue: string; separators: number }> = []
  if (source) for (const pair of source.split('&')) {
    const separator = pair.indexOf('=')
    const rawKey = separator < 0 ? pair : pair.slice(0, separator)
    const rawValue = separator < 0 ? '' : pair.slice(separator + 1)
    const key = decodeQueryPart(rawKey)
    const value = decodeQueryPart(rawValue)
    if (key === null || value === null || key.includes('\uFFFD') || value.includes('\uFFFD')) return { id: null, directoryQuery: '' }
    entries.push({ key, rawKey, value, rawValue, separators: pair.split('=').length - 1 })
  }
  const idLike = entries.filter(entry => entry.key.toLowerCase() === 'id')
  const ids = entries.filter(entry => entry.rawKey === 'id')
  if (idLike.length !== 1 || ids.length !== 1 || ids[0].separators !== 1 || ids[0].rawValue !== ids[0].value || !isBenefitCompanyId(ids[0].value)) return { id: null, directoryQuery: '' }

  const returnEntries = entries.filter(entry => entry.key !== 'id')
  if (returnEntries.length === 0) return { id: ids[0].value, directoryQuery: '' }
  if (returnEntries.some(entry => !RETURN_KEYS.has(entry.key))) return { id: ids[0].value, directoryQuery: '' }
  const names = returnEntries.map(entry => entry.key)
  if (new Set(names).size !== names.length) return { id: ids[0].value, directoryQuery: '' }
  const rawReturn = new URLSearchParams(returnEntries.map(entry => [entry.key, entry.value])).toString()
  const canonical = serializeBenefitDirectoryQuery(parseBenefitDirectoryQuery(`?${rawReturn}`))
  return { id: ids[0].value, directoryQuery: canonical.slice(1) === rawReturn ? canonical : '' }
}

const verificationCopy: Record<BenefitCompanyDetail['company']['identityLabel'], string> = {
  법인: '공개 명단에서 확인된 사업체입니다.',
  '등록 사업자': '사용자 검증을 거쳐 등록된 사업체입니다.',
  '채용 관찰 사업자': '공개 채용 명단에서 확인된 사업체입니다.',
  '공시대상기업집단 소속 법인': '공개 기업집단 명단에서 확인된 사업체입니다.',
}

function PageShell({ children }: { children: ReactNode }) {
  return <div className="community-page benefits-page">
    <AppHeader />
    <main className="benefit-company-page">{children}</main>
    <AppFooter />
  </div>
}

function backHref(directoryQuery: string) {
  return `/benefits/${directoryQuery}`
}

function formatDate(value: string) {
  const date = value.length === 10 ? new Date(`${value}T00:00:00+09:00`) : new Date(value)
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric' }).format(date)
}

function PublicationCard({ item, authority }: { item: BenefitDirectoryPublication; authority: 'official' | 'community' }) {
  return <article className={`benefit-company-page__card benefit-company-page__card--${authority}`}>
    <p className="benefit-company-page__authority">{authority === 'official' ? '공식 공개 자료' : '커뮤니티 검토 게시'}</p>
    <h3>{item.title}</h3>
    <p>{item.description}</p>
    {(item.eligibilityText || item.conditionText) && <dl>
      {item.eligibilityText && <><dt>대상</dt><dd>{item.eligibilityText}</dd></>}
      {item.conditionText && <><dt>조건</dt><dd>{item.conditionText}</dd></>}
    </dl>}
  </article>
}

function ClaimCard({ claim, companyId, history = false }: { claim: BenefitDirectoryPublicClaim; companyId: string; history?: boolean }) {
  return <article id={`claim-${claim.claimId}`} className={`benefit-company-page__card benefit-company-page__claim benefit-company-page__claim--${claim.statusCode}`}>
    <p className="benefit-company-page__authority">{history ? '커뮤니티 확인 이력' : claim.statusLabel}</p>
    <h3>{claim.title}</h3>
    <p>{claim.description}</p>
    {(claim.eligibilityText || claim.conditionText) && <dl>
      {claim.eligibilityText && <><dt>대상</dt><dd>{claim.eligibilityText}</dd></>}
      {claim.conditionText && <><dt>조건</dt><dd>{claim.conditionText}</dd></>}
    </dl>}
    <dl className="benefit-company-page__claim-facts">
      <dt>제보자</dt><dd>{claim.nickname || '탈퇴한 사용자'}</dd>
      <dt>최초 제보</dt><dd>{formatDate(claim.submittedAt)}</dd>
      <dt>마지막 확인</dt><dd>{claim.lastConfirmationAt ? formatDate(claim.lastConfirmationAt) : '아직 확인 없음'}</dd>
      <dt>반응</dt><dd>확인 {claim.confirmCount} · 이의 {claim.disputeCount}</dd>
      <dt>관찰일</dt><dd>{formatDate(claim.observedOn)}</dd>
    </dl>
    <p className="benefit-company-page__disclaimer">커뮤니티 제보이며 회사의 공식 발표가 아닙니다.</p>
    <a className="benefit-company-page__reaction" href={benefitClaimReactionHref(companyId, claim.claimId)}>확인 또는 이의 남기기</a>
  </article>
}

type LoadState =
  | { key: string; phase: 'loading' }
  | { key: string; phase: 'ready'; detail: BenefitCompanyDetail }
  | { key: string; phase: 'error'; error: BenefitDirectoryError }

export function BenefitDirectoryCompanyPage({
  search,
  repository = getBenefitDirectoryRepository(),
}: {
  search: string
  repository?: BenefitDirectoryRepository
}) {
  const parsed = parseCompanyQuery(search)
  const [state, setState] = useState<LoadState>()
  const [retry, setRetry] = useState(0)
  const generation = useRef(0)
  const controller = useRef<AbortController | undefined>(undefined)
  const focusedClaim = useRef<string | undefined>(undefined)
  const source = useRef({ repository, id: 0 })
  if (source.current.repository !== repository) source.current = { repository, id: source.current.id + 1 }
  const sourceId = source.current.id
  const key = parsed.id ? `${sourceId}:${parsed.id}` : `${sourceId}:invalid`
  const active = state?.key === key ? state : undefined

  useEffect(() => {
    if (!parsed.id) {
      controller.current?.abort()
      generation.current += 1
      return
    }
    const currentGeneration = generation.current + 1
    generation.current = currentGeneration
    const currentSourceId = sourceId
    const currentId = parsed.id
    controller.current?.abort()
    const requestController = new AbortController()
    controller.current = requestController
    setState({ key, phase: 'loading' })
    void repository.detail(currentId, requestController.signal).then(result => {
      if (requestController.signal.aborted || generation.current !== currentGeneration || source.current.id !== currentSourceId) return
      if (!result.ok) {
        if (result.error.code !== 'aborted') setState({ key, phase: 'error', error: result.error })
        return
      }
      setState({ key, phase: 'ready', detail: result.data })
    }).catch(() => {
      if (!requestController.signal.aborted && generation.current === currentGeneration && source.current.id === currentSourceId) {
        setState({ key, phase: 'error', error: { code: 'network', message: '네트워크 연결을 확인한 뒤 다시 시도해 주세요.' } })
      }
    })
    return () => requestController.abort()
  }, [key, parsed.id, repository, retry, sourceId])

  useEffect(() => () => {
    generation.current += 1
    controller.current?.abort()
  }, [])

  const readyDetail = active?.phase === 'ready' ? active.detail : undefined
  useEffect(() => {
    if (!readyDetail || !window.location.hash.startsWith('#claim-')) return
    const claimId = window.location.hash.slice('#claim-'.length)
    const focusKey = `${key}:${claimId}`
    if (focusedClaim.current === focusKey || !readyDetail.claims.some(claim => claim.claimId === claimId)) return
    const card = document.getElementById(`claim-${claimId}`)
    if (!card) return
    card.tabIndex = -1
    card.focus({ preventScroll: false })
    focusedClaim.current = focusKey
  }, [key, readyDetail])

  if (!parsed.id) return <PageShell>
    <a className="benefit-company-page__back" href="/benefits/">기업 검색으로 돌아가기</a>
    <h1>기업 복지 상세</h1>
    <div className="benefit-company-page__state" role="alert">유효하지 않은 기업 상세 링크입니다.</div>
  </PageShell>

  if (!active || active.phase === 'loading') return <PageShell>
    <a className="benefit-company-page__back" href={backHref(parsed.directoryQuery)}>기업 검색으로 돌아가기</a>
    <h1>기업 복지 상세</h1>
    <p className="benefit-company-page__state" role="status">기업 복지 정보를 불러오고 있습니다.</p>
  </PageShell>

  if (active.phase === 'error') {
    const presentation = presentPublicDirectoryError(active.error, 'detail')
    return <PageShell>
    <a className="benefit-company-page__back" href={backHref(parsed.directoryQuery)}>기업 검색으로 돌아가기</a>
    <h1>기업 복지 상세</h1>
    <div className="benefit-company-page__state benefit-company-page__state--error" role="alert">
      <p>{presentation.message}</p>
      {presentation.canRetry && <button type="button" onClick={() => setRetry(value => value + 1)}>다시 시도</button>}
    </div>
  </PageShell>
  }

  const { company, publications, claims } = active.detail
  const facts = [company.industry, company.sizeLabel, company.region].filter((value): value is string => value !== null)
  const official = publications.filter(item => item.trustLabel === '공식 확인')
  const community = publications.filter(item => item.trustLabel === '사용자 제보')
  const confirmed = claims.filter(item => item.statusCode === 'community_confirmed')
  const submitted = claims.filter(item => item.statusCode === 'submitted')
  const disputed = claims.filter(item => item.statusCode === 'disputed')
  return <PageShell>
    <a className="benefit-company-page__back" href={backHref(parsed.directoryQuery)}>기업 검색으로 돌아가기</a>
    <header className="benefit-company-page__header">
      <p className="benefit-company-page__verification">확인 상태 · {verificationCopy[company.identityLabel]}</p>
      <h1>{company.displayName}</h1>
      {facts.length > 0 && <p className="benefit-company-page__facts">{facts.join(' · ')}</p>}
      <a className="benefit-company-page__submit" href={benefitClaimHref(company.companyId)}>이 기업의 혜택 제보</a>
    </header>
    <div className="benefit-company-page__groups">
      <section className="benefit-company-page__group benefit-company-page__group--official" aria-labelledby="official-benefits-heading">
        <h2 id="official-benefits-heading">공식 확인 혜택</h2>
        {official.length === 0 ? <p className="benefit-company-page__group-empty">게시된 공식 확인 혜택이 아직 없습니다.</p> : <div className="benefit-company-page__cards">{official.map(item => <PublicationCard key={item.publicationId} item={item} authority="official" />)}</div>}
      </section>
      <section className="benefit-company-page__group benefit-company-page__group--community" aria-labelledby="community-benefits-heading">
        <h2 id="community-benefits-heading">커뮤니티 확인 혜택</h2>
        {community.length === 0 && confirmed.length === 0 ? <p className="benefit-company-page__group-empty">게시된 커뮤니티 확인 혜택이나 확인 이력이 아직 없습니다.</p> : <div className="benefit-company-page__cards">
          {community.map(item => <PublicationCard key={item.publicationId} item={item} authority="community" />)}
          {confirmed.map(item => <ClaimCard key={item.claimId} claim={item} companyId={company.companyId} history />)}
        </div>}
      </section>
      <section className="benefit-company-page__group" aria-labelledby="submitted-claims-heading">
        <h2 id="submitted-claims-heading">제보된 혜택</h2>
        {submitted.length === 0 ? <p className="benefit-company-page__group-empty">검토 중인 공개 제보가 없습니다.</p> : <div className="benefit-company-page__cards">{submitted.map(item => <ClaimCard key={item.claimId} claim={item} companyId={company.companyId} />)}</div>}
      </section>
      <section className="benefit-company-page__group benefit-company-page__group--disputed" aria-labelledby="disputed-claims-heading">
        <h2 id="disputed-claims-heading">재확인 필요</h2>
        {disputed.length === 0 ? <p className="benefit-company-page__group-empty">재확인이 필요한 공개 제보가 없습니다.</p> : <div className="benefit-company-page__cards">{disputed.map(item => <ClaimCard key={item.claimId} claim={item} companyId={company.companyId} />)}</div>}
      </section>
    </div>
  </PageShell>
}
