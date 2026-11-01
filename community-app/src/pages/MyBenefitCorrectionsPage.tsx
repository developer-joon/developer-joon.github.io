import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { DEFAULT_AUTH_PROVIDER } from '../auth/providers'
import { AppFooter } from '../components/AppFooter'
import { AppHeader } from '../components/AppHeader'
import { getBenefitCorrectionRepository, type BenefitCorrectionRepository } from '../data/benefitCorrectionRepository'
import { categoryLabels } from '../types/benefits'
import type { BenefitCorrectionError, BenefitCorrectionItem } from '../types/benefitCorrections'

const statusLabels = { submitted: '접수됨', reviewing: '검토 중', approved: '승인됨', rejected: '반려됨', applied: '반영 완료' } as const
const listPath = '/community/benefits/my-corrections/'

function date(value: string) { return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) }

export function MyBenefitCorrectionsPage({ repository = getBenefitCorrectionRepository(), currentPath = `${window.location.pathname}${window.location.search}` }: { repository?: BenefitCorrectionRepository; currentPath?: string }) {
  const auth = useAuth()
  const [items, setItems] = useState<BenefitCorrectionItem[] | null>(null)
  const [error, setError] = useState<BenefitCorrectionError | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!auth.user) { setItems(null); return }
    const controller = new AbortController(); setError(null); setItems(null)
    void repository.listMyRequests({ limit: 50 }, controller.signal).then(result => {
      if (controller.signal.aborted) return
      if (!result.ok) setError(result.error)
      else setItems(result.data.items)
    })
    return () => controller.abort()
  }, [auth.user?.id, attempt, repository])

  if (auth.loading) return <Shell><p role="status">로그인 상태를 확인하고 있습니다.</p></Shell>
  const loginReturnPath = currentPath === listPath ? currentPath : listPath
  if (!auth.user) return <Shell><section><h1>내 수정 요청</h1><p>본인이 제출한 요청만 확인할 수 있습니다.</p><button type="button" onClick={() => void auth.signIn(DEFAULT_AUTH_PROVIDER, loginReturnPath)}>Google로 로그인</button></section></Shell>
  return <Shell><section className="benefit-corrections-list"><h1>내 수정 요청</h1>{error ? <div role="alert"><p>{error.message}</p>{error.code === 'auth_required' ? <button type="button" onClick={() => void auth.signIn(DEFAULT_AUTH_PROVIDER, loginReturnPath)}>다시 로그인</button> : <button type="button" onClick={() => setAttempt(value => value + 1)}>다시 시도</button>}</div> : items === null ? <p role="status">요청 내역을 불러오고 있습니다.</p> : items.length === 0 ? <p>아직 제출한 수정 요청이 없습니다.</p> : items.map(item => <article key={item.id} className="benefit-correction-card"><header><strong>{item.companyId}</strong><span>{statusLabels[item.status]}</span></header><dl><dt>분야</dt><dd>{categoryLabels[item.categoryId]}</dd><dt>제안</dt><dd>{item.proposedText}</dd><dt>제출</dt><dd>{date(item.createdAt)}</dd><dt>최근 변경</dt><dd>{date(item.updatedAt)}</dd>{item.adminResponse && <><dt>관리자 답변</dt><dd>{item.adminResponse}</dd></>}{item.appliedDataVersion && <><dt>반영 데이터 버전</dt><dd><code>{item.appliedDataVersion}</code></dd></>}</dl></article>)}</section></Shell>
}
function Shell({ children }: { children: React.ReactNode }) { return <div className="community-page benefits-page"><AppHeader /><main className="benefits-workspace benefit-correction-workspace">{children}</main><AppFooter /></div> }
