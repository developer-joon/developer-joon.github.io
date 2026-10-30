import type { Claim } from '../../types/benefits'
export function OfficialSourceList({ source }: { source: Claim['source'] }) {
  return (
    <section aria-label="공식 출처">
      <a href={source.url} target="_blank" rel="noopener noreferrer">
        {source.title}
      </a>
      <dl>
        <dt>문서 소유자</dt>
        <dd>{source.owner}</dd>
        <dt>게시일 · 확인일</dt>
        <dd>
          {source.published_at} · {source.verified_at}
        </dd>
        <dt>근거 위치·인용</dt>
        <dd>{source.location}</dd>
        <dt>근거 등급</dt>
        <dd>등급 {source.grade}</dd>
      </dl>
    </section>
  )
}
