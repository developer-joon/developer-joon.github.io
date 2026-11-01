import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { DEFAULT_AUTH_PROVIDER } from '../auth/providers'
import { AppFooter } from '../components/AppFooter'
import { AppHeader } from '../components/AppHeader'
import { benefitsClient } from '../data/benefitsArtifactClient'
import { getBenefitCorrectionRepository, type BenefitCorrectionRepository } from '../data/benefitCorrectionRepository'
import { createBenefitCorrectionDraft, loadBenefitCorrectionDraft, saveBenefitCorrectionDraft, submitBenefitCorrectionDraft, type BenefitCorrectionDraftStorage } from '../lib/benefitCorrectionDraftStore'
import { BENEFIT_CATEGORIES, type BenefitCorrectionDraft } from '../types/benefitCorrections'
import { categoryLabels, type CompanyListing } from '../types/benefits'

interface Props {
  repository?: BenefitCorrectionRepository
  storage?: BenefitCorrectionDraftStorage
  search?: string
  currentPath?: string
}

const canonicalCompany = /^(?:KR-CRN-[0-9]{13}|US-CIK[0-9]{10})$/
const correctionBasePath = '/community/benefits/correction/'

function singleParam(params: URLSearchParams, name: string) {
  const values = params.getAll(name)
  return values.length === 1 ? values[0] : null
}
function displayedValue(company: CompanyListing, category: BenefitCorrectionDraft['categoryId']) {
  if (!category) return ''
  const outcome = company.category_outcomes.find(value => value.category_id === category)
  return outcome?.kind === 'evidenced' ? (outcome.status === 'confirmed' ? '공식 확인' : '범위 제한 확인') : '근거 부족'
}
function safeCorrectionPath(path: string) {
  try {
    const parsed = new URL(path, 'https://return-path.invalid')
    if (`${parsed.origin}` !== 'https://return-path.invalid' || parsed.pathname.replace(/\/+$/, '/') !== correctionBasePath) return correctionBasePath
    const query = new URLSearchParams()
    const company = singleParam(parsed.searchParams, 'company')
    const category = singleParam(parsed.searchParams, 'category')
    if (company && canonicalCompany.test(company)) query.set('company', company)
    if (category && (BENEFIT_CATEGORIES as readonly string[]).includes(category)) query.set('category', category)
    const serialized = query.toString()
    return `${correctionBasePath}${serialized ? `?${serialized}` : ''}`
  } catch { return correctionBasePath }
}

function resolveDraftStorage(storage?: BenefitCorrectionDraftStorage): BenefitCorrectionDraftStorage | undefined {
  if (storage) return storage
  try { return typeof window === 'undefined' ? undefined : window.localStorage } catch { return undefined }
}

export function BenefitCorrectionPage({ repository = getBenefitCorrectionRepository(), storage, search = window.location.search, currentPath = `${window.location.pathname}${window.location.search}` }: Props) {
  const auth = useAuth()
  const [draft, setDraft] = useState<BenefitCorrectionDraft | null>(null)
  const [companies, setCompanies] = useState<CompanyListing[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const lifecycle = useRef(0)
  const submitController = useRef<AbortController | null>(null)
  const params = useMemo(() => new URLSearchParams(search), [search])
  const draftStorage = useMemo(() => resolveDraftStorage(storage), [storage])

  useEffect(() => {
    submitController.current?.abort()
    submitController.current = null
    setDraft(null)
    setCompanies(null)
    setSubmitted(false)
    setSubmitError(null)
    setPending(false)
    setLoadError(null)
    if (!auth.user) return
    const generation = ++lifecycle.current
    const controller = new AbortController()
    void Promise.all([repository.getCurrentAccountScope(controller.signal), benefitsClient.loadManifest(controller.signal).then(async manifest => ({ manifest, companies: await benefitsClient.loadListingChunks(manifest, controller.signal) }))])
      .then(([scopeResult, artifacts]) => {
        if (generation !== lifecycle.current || controller.signal.aborted) return
        if (!scopeResult.ok) { setLoadError(scopeResult.error.message); return }
        const accountScope = scopeResult.data
        const saved = loadBenefitCorrectionDraft(accountScope, draftStorage)
        const companyParam = singleParam(params, 'company')
        const categoryParam = singleParam(params, 'category')
        const company = companyParam && canonicalCompany.test(companyParam) ? artifacts.companies.find(value => value.company_id === companyParam) : undefined
        const category = categoryParam && (BENEFIT_CATEGORIES as readonly string[]).includes(categoryParam) ? categoryParam as BenefitCorrectionDraft['categoryId'] : ''
        const base = saved ?? createBenefitCorrectionDraft(accountScope)
        const companyId = base.companyId || company?.company_id || ''
        const categoryId = base.categoryId || category
        const selectedCompany = artifacts.companies.find(value => value.company_id === companyId)
        const next: BenefitCorrectionDraft = {
          ...base,
          companyId,
          categoryId,
          currentText: base.currentText || (selectedCompany ? displayedValue(selectedCompany, categoryId) : ''),
          observedDataVersion: base.observedDataVersion || artifacts.manifest.data_version,
        }
        saveBenefitCorrectionDraft(accountScope, next, draftStorage)
        setCompanies(artifacts.companies)
        setDraft(next)
      })
      .catch(error => { if (generation === lifecycle.current && !controller.signal.aborted) setLoadError(error instanceof Error ? '기업 복지 기준 정보를 불러오지 못했습니다.' : '요청 화면을 준비하지 못했습니다.') })
    return () => {
      controller.abort()
      submitController.current?.abort()
      submitController.current = null
      lifecycle.current += 1
    }
  }, [auth.user?.id, draftStorage, params, repository])

  function update(patch: Partial<BenefitCorrectionDraft>) {
    if (!draft) return
    let next = { ...draft, ...patch, updatedAt: new Date().toISOString() }
    if (patch.companyId !== undefined || patch.categoryId !== undefined) {
      const company = companies?.find(value => value.company_id === next.companyId)
      next = { ...next, currentText: company ? displayedValue(company, next.categoryId) : '' }
    }
    saveBenefitCorrectionDraft(next.accountScope, next, draftStorage)
    setDraft(next)
    setSubmitError(null)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!draft || pending) return
    submitController.current?.abort()
    const controller = new AbortController()
    submitController.current = controller
    setPending(true); setSubmitError(null)
    const generation = lifecycle.current
    let result
    try {
      result = await submitBenefitCorrectionDraft(draft, repository, draftStorage, controller.signal)
    } catch {
      if (generation === lifecycle.current && !controller.signal.aborted && submitController.current === controller) {
        submitController.current = null
        setPending(false)
        setSubmitError('요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
      }
      return
    }
    if (generation !== lifecycle.current || controller.signal.aborted || submitController.current !== controller) return
    submitController.current = null
    setPending(false)
    if (!result.ok) { setSubmitError(result.error.message); return }
    setSubmitted(true)
  }

  if (auth.loading) return <CorrectionShell><p role="status">로그인 상태를 확인하고 있습니다.</p></CorrectionShell>
  if (!auth.user) return <CorrectionShell><section className="benefit-correction-gate"><h1>복지 정보 수정 요청</h1><p>요청을 안전하게 저장하고 처리 상태를 확인하려면 로그인이 필요합니다.</p><button type="button" onClick={() => void auth.signIn(DEFAULT_AUTH_PROVIDER, safeCorrectionPath(currentPath))} disabled={auth.pending}>Google로 로그인하고 요청하기</button>{auth.error && <p role="alert">{auth.error}</p>}</section></CorrectionShell>
  if (loadError) return <CorrectionShell><section role="alert"><h1>요청 화면을 열 수 없습니다</h1><p>{loadError}</p><button type="button" onClick={() => window.location.reload()}>다시 시도</button></section></CorrectionShell>
  if (!draft || !companies) return <CorrectionShell><p role="status">수정 요청 화면을 준비하고 있습니다.</p></CorrectionShell>
  if (submitted) return <CorrectionShell><section><h1>요청 접수 완료</h1><p role="status">수정 요청이 접수되었습니다. 내 수정 요청에서 처리 상태를 확인할 수 있습니다.</p><a className="benefits-correction-link" href="/community/benefits/my-corrections/">내 수정 요청 보기</a></section></CorrectionShell>

  return <CorrectionShell><section className="benefit-correction-panel"><h1>복지 정보 수정 요청</h1><p>공개 HTTPS 자료만 입력해 주세요. 개인정보, 비공개·로그인 필요·유료 자료는 제출하지 마세요.</p><form onSubmit={submit} className="benefit-correction-form">
    <label>기업<select value={draft.companyId} onChange={event => update({ companyId: event.target.value })} required><option value="">기업 선택</option>{companies.map(company => <option key={company.company_id} value={company.company_id}>{company.display_name} ({company.company_id})</option>)}</select></label>
    <label>복지 분야<select value={draft.categoryId} onChange={event => update({ categoryId: event.target.value as BenefitCorrectionDraft['categoryId'] })} required><option value="">분야 선택</option>{BENEFIT_CATEGORIES.map(category => <option key={category} value={category}>{categoryLabels[category]}</option>)}</select></label>
    <label>현재 표시 내용<input value={draft.currentText} readOnly /></label>
    <label>제안 내용<textarea value={draft.proposedText} maxLength={5000} onChange={event => update({ proposedText: event.target.value })} required /></label>
    <label>적용 범위<textarea value={draft.scopeText} maxLength={2000} onChange={event => update({ scopeText: event.target.value })} required /></label>
    <label>공개 HTTPS 근거 URL<input type="url" value={draft.sourceUrl} maxLength={2048} onChange={event => update({ sourceUrl: event.target.value })} required /></label>
    <p>관찰한 데이터 버전: <code>{draft.observedDataVersion}</code></p>
    {submitError && <p role="alert">{submitError}</p>}
    {submitError === '로그인이 필요합니다.' && <button type="button" onClick={() => void auth.signIn(DEFAULT_AUTH_PROVIDER, safeCorrectionPath(currentPath))}>다시 로그인</button>}
    <button type="submit" disabled={pending}>{pending ? '제출 중…' : '수정 요청 제출'}</button>
  </form></section></CorrectionShell>
}

function CorrectionShell({ children }: { children: React.ReactNode }) {
  return <div className="community-page benefits-page"><AppHeader /><main className="benefits-workspace benefit-correction-workspace">{children}</main><AppFooter /></div>
}
