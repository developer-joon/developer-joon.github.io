import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AppFooter } from '../components/AppFooter'
import { AppHeader } from '../components/AppHeader'
import { getBenefitDirectoryRepository, type BenefitDirectoryRepository } from '../data/benefitDirectoryRepository'
import { benefitSubmissionHref } from '../benefitsRoutes'
import { parseBenefitDirectoryQuery, serializeBenefitDirectoryQuery } from '../lib/benefitDirectoryQueryState'
import { presentPublicDirectoryError } from '../lib/publicDirectoryErrorPresentation'
import {
  BENEFIT_DIRECTORY_CATEGORIES,
  BENEFIT_DIRECTORY_CATEGORY_LABELS,
  type BenefitCompanyDetail,
  type BenefitDirectoryCategory,
  type BenefitDirectoryError,
  type BenefitDirectoryErrorCode,
  type BenefitDirectoryPublication,
} from '../types/benefitDirectory'

const COMPANY_ID = /^(?:KR-CRN-[0-9]{13}|KR-BIZ-[0-9]{10})$/
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
  if (idLike.length !== 1 || ids.length !== 1 || ids[0].separators !== 1 || ids[0].rawValue !== ids[0].value || !COMPANY_ID.test(ids[0].value)) return { id: null, directoryQuery: '' }

  const returnEntries = entries.filter(entry => entry.key !== 'id')
  if (returnEntries.length === 0) return { id: ids[0].value, directoryQuery: '' }
  if (returnEntries.some(entry => !RETURN_KEYS.has(entry.key))) return { id: ids[0].value, directoryQuery: '' }
  const names = returnEntries.map(entry => entry.key)
  if (new Set(names).size !== names.length) return { id: ids[0].value, directoryQuery: '' }
  const rawReturn = new URLSearchParams(returnEntries.map(entry => [entry.key, entry.value])).toString()
  const canonical = serializeBenefitDirectoryQuery(parseBenefitDirectoryQuery(`?${rawReturn}`))
  return { id: ids[0].value, directoryQuery: canonical.slice(1) === rawReturn ? canonical : '' }
}

const identityExplanations: Record<BenefitCompanyDetail['company']['identityLabel'], string> = {
  법인: '법인 등기 식별정보 기준으로 구분된 기업입니다.',
  '등록 사업자': '사업자 등록 식별정보 기준으로 구분된 기업입니다.',
  '채용 관찰 사업자': '공개 채용 정보에서 확인되는 사업자 단위입니다.',
  '공시대상기업집단 소속 법인': '공시대상기업집단에 속한 법인 단위입니다.',
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

function groupPublications(publications: BenefitDirectoryPublication[]) {
  const groups = new Map<BenefitDirectoryCategory, BenefitDirectoryPublication[]>()
  for (const publication of publications) {
    const group = groups.get(publication.categoryId)
    if (group) group.push(publication)
    else groups.set(publication.categoryId, [publication])
  }
  return groups
}

const detailErrorMessages: Partial<Record<BenefitDirectoryErrorCode, string>> = {
  not_found: '기업 정보를 찾을 수 없습니다.',
  network: '네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
  invalid_response: '기업 정보를 표시할 수 없습니다.',
  timeout: '요청 시간이 초과되었습니다. 다시 시도해 주세요.',
  rate_limited: '요청이 많습니다. 잠시 후 다시 시도해 주세요.',
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
    const presentation = presentPublicDirectoryError(active.error, {
      messages: detailErrorMessages,
      fallbackMessage: '기업 복지 정보를 불러오지 못했습니다.',
      nonRetryableCodes: ['not_found', 'aborted'],
    })
    return <PageShell>
    <a className="benefit-company-page__back" href={backHref(parsed.directoryQuery)}>기업 검색으로 돌아가기</a>
    <h1>기업 복지 상세</h1>
    <div className="benefit-company-page__state benefit-company-page__state--error" role="alert">
      <p>{presentation.message}</p>
      {presentation.canRetry && <button type="button" onClick={() => setRetry(value => value + 1)}>다시 시도</button>}
    </div>
  </PageShell>
  }

  const { company, publications } = active.detail
  const facts = [company.industry, company.sizeLabel, company.region].filter((value): value is string => value !== null)
  const groups = groupPublications(publications)
  return <PageShell>
    <a className="benefit-company-page__back" href={backHref(parsed.directoryQuery)}>기업 검색으로 돌아가기</a>
    <header className="benefit-company-page__header">
      <p className="benefit-company-page__identity"><strong>{company.identityLabel}</strong> · {identityExplanations[company.identityLabel]}</p>
      <h1>{company.displayName}</h1>
      {facts.length > 0 && <p className="benefit-company-page__facts">{facts.join(' · ')}</p>}
      {company.summary && <p className="benefit-company-page__summary">{company.summary}</p>}
    </header>

    {publications.length === 0 ? <section className="benefit-company-page__empty" role="status" aria-labelledby="company-empty-heading">
      <h2 id="company-empty-heading">게시 가능한 공개 복지 근거 미확인</h2>
      <p>공개 근거가 아직 게시되지 않은 상태입니다. 게시 여부만 나타내며 실제 제도 유무를 단정하지 않습니다.</p>
      <a className="benefit-company-page__submit" href={benefitSubmissionHref(company.companyId)}>새 혜택 제보</a>
    </section> : <div className="benefit-company-page__groups">
      {BENEFIT_DIRECTORY_CATEGORIES.flatMap(category => {
        const items = groups.get(category)
        if (!items) return []
        const headingId = `benefit-category-${category}`
        return <section key={category} className="benefit-company-page__group" aria-labelledby={headingId}>
          <h2 id={headingId}>{BENEFIT_DIRECTORY_CATEGORY_LABELS[category]}</h2>
          <div className="benefit-company-page__cards">{items.map(item => <article key={item.publicationId} className="benefit-company-page__card">
            <h3>{item.title}</h3>
            <p>{item.description}</p>
            {(item.eligibilityText || item.conditionText) && <dl>
              {item.eligibilityText && <><dt>대상</dt><dd>{item.eligibilityText}</dd></>}
              {item.conditionText && <><dt>조건</dt><dd>{item.conditionText}</dd></>}
            </dl>}
            <p className="benefit-company-page__trust"><span aria-hidden="true">●</span> {item.trustLabel}</p>
          </article>)}</div>
        </section>
      })}
    </div>}
  </PageShell>
}
