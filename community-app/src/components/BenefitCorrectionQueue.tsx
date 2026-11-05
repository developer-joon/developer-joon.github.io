import type { AdminBenefitCorrectionItem, BenefitCorrectionQueueFilter } from '../types/benefitCorrections'

interface Props {
  items: AdminBenefitCorrectionItem[]
  selectedId: string | null
  filter: BenefitCorrectionQueueFilter
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasMore: boolean
  announcement: string
  onSelect(id: string): void
  onFilterChange(filter: BenefitCorrectionQueueFilter): void
  onRetry(): void
  onLoadMore(): void
}

const filters: Array<[BenefitCorrectionQueueFilter, string]> = [
  ['active', '처리 중'], ['submitted', '접수'], ['reviewing', '검토 중'], ['approved', '승인'], ['rejected', '반려'], ['applied', '적용 완료'], ['all', '전체'],
]
const categoryLabels = { leave: '휴가', family: '가족', health: '건강', growth: '성장', housing: '주거', commute: '통근', remote: '원격 근무', retirement: '퇴직', meals: '식사', inclusion: '포용' }
const statusLabels = { submitted: '접수', reviewing: '검토 중', approved: '승인', rejected: '반려', applied: '적용 완료' }

export function BenefitCorrectionQueue({ items, selectedId, filter, loading, loadingMore, error, hasMore, announcement, onSelect, onFilterChange, onRetry, onLoadMore }: Props) {
  return <section className="report-queue correction-queue" aria-labelledby="correction-queue-title">
    <div className="admin-section-heading">
      <div><p>CORRECTION QUEUE</p><h2 id="correction-queue-title">복지 정정 대기열</h2></div>
      <span>{items.length}건 표시</span>
    </div>
    <div className="report-filters" aria-label="복지 정정 상태 필터">
      {filters.map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => onFilterChange(value)}>{label}</button>)}
    </div>
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    {loading ? <p className="admin-state" role="status">정정 요청을 불러오는 중입니다.</p> : error ? <div className="admin-state admin-error" role="alert"><p>{error}</p><button type="button" onClick={onRetry}>다시 시도</button></div>
      : items.length === 0 ? <p className="admin-state">조건에 맞는 정정 요청이 없습니다.</p>
        : <ol className="report-list">{items.map(item => <li key={item.id} className={selectedId === item.id ? 'is-selected' : ''}>
          <button type="button" className="report-row correction-row" aria-pressed={selectedId === item.id} aria-label={`복지 정정 ${item.companyId} ${categoryLabels[item.categoryId]} 선택`} onClick={() => onSelect(item.id)}>
            <span className="report-row-top"><strong>{categoryLabels[item.categoryId]}</strong><span>{statusLabels[item.status]}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('ko-KR')}</time></span>
            <span className="correction-company">{item.companyId}</span>
            <span className="correction-proposal">{item.proposedText}</span>
            <span className="correction-scope">{item.scopeText}</span>
          </button>
        </li>)}</ol>}
    {hasMore && !loading && <div className="admin-load-more"><button type="button" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? '불러오는 중' : '정정 요청 더 불러오기'}</button></div>}
  </section>
}
