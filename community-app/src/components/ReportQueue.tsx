import type { AdminReportItem, ReportStatusFilter } from '../types/community'

interface Props {
  items: AdminReportItem[]
  selectedId: string | null
  filter: ReportStatusFilter
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasMore: boolean
  announcement: string
  onSelect(id: string): void
  onFilterChange(filter: ReportStatusFilter): void
  onRetry(): void
  onLoadMore(): void
}

const filters: Array<[ReportStatusFilter, string]> = [
  ['active', '처리 중'], ['open', '접수'], ['reviewing', '검토 중'], ['resolved', '해결'], ['dismissed', '기각'], ['all', '전체'],
]
const reasonLabels = { spam: '스팸', harassment: '괴롭힘', harmful: '유해 콘텐츠', other: '기타' }
const statusLabels = { open: '접수', reviewing: '검토 중', resolved: '해결', dismissed: '기각' }

function reporterLabel(item: AdminReportItem) {
  return item.reporter.displayName ? `${item.reporter.displayName} · @${item.reporter.login}` : `@${item.reporter.login}`
}

export function ReportQueue({ items, selectedId, filter, loading, loadingMore, error, hasMore, announcement, onSelect, onFilterChange, onRetry, onLoadMore }: Props) {
  return (
    <section className="report-queue" aria-labelledby="report-queue-title">
      <div className="admin-section-heading">
        <div><p>REPORT QUEUE</p><h2 id="report-queue-title">신고 대기열</h2></div>
        <span>{items.length}건 표시</span>
      </div>
      <div className="report-filters" aria-label="신고 상태 필터">
        {filters.map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => onFilterChange(value)}>{label}</button>)}
      </div>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      {loading ? <p className="admin-state" role="status">신고 목록을 불러오는 중입니다.</p> : error ? (
        <div className="admin-state admin-error" role="alert"><p>{error}</p><button type="button" onClick={onRetry}>다시 시도</button></div>
      ) : items.length === 0 ? <p className="admin-state">조건에 맞는 신고가 없습니다.</p> : (
        <ol className="report-list">
          {items.map(item => {
            const targetLabel = item.target.available ? item.target.title || item.target.excerpt || `${item.target.type} ${item.target.id}` : '삭제된 원문'
            return <li key={item.id} className={selectedId === item.id ? 'is-selected' : ''}>
              <button type="button" className="report-row" aria-pressed={selectedId === item.id} aria-label={`신고 ${targetLabel} 선택`} onClick={() => onSelect(item.id)}>
                <span className="report-row-top"><strong>{reasonLabels[item.reasonCode]}</strong><span>{statusLabels[item.status]}</span><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('ko-KR')}</time></span>
                <span className="report-reporter">신고자 {reporterLabel(item)}</span>
                {item.detail && <span className="report-detail">{item.detail}</span>}
                {item.target.available ? <span className="report-target"><b>{item.target.type === 'post' ? '게시글' : '댓글'}</b><strong>{item.target.title}</strong><span>{item.target.excerpt}</span></span> : <span className="report-target-missing">삭제되어 원문을 확인할 수 없음</span>}
              </button>
            </li>
          })}
        </ol>
      )}
      {hasMore && !loading && <div className="admin-load-more"><button type="button" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? '불러오는 중' : '신고 더 불러오기'}</button></div>}
    </section>
  )
}
