import type { Claim } from '../../types/benefits'
export function OfficialSourceList({ evidence }: { evidence: Claim['source_evidence'] }) {
  return <section aria-label="공식 출처">{evidence.map((item) => <article key={`${item.source_id}:${item.source_locator}`}><a href={item.source.url} target="_blank" rel="noopener noreferrer">{item.source.title}</a><dl><dt>문서 소유자</dt><dd>{item.source.owner}</dd><dt>근거 위치</dt><dd>{item.source_locator}</dd><dt>인용</dt><dd>{item.supporting_quote}</dd><dt>확인일</dt><dd>{item.source.checked_at.slice(0, 10)}</dd><dt>근거 등급</dt><dd>{item.source.evidence_eligibility}</dd></dl></article>)}</section>
}
