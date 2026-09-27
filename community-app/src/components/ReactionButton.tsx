export function ReactionButton({ count }: { count: number }) {
  return (
    <button className="reaction-count" type="button" disabled aria-label={`반응 ${count}개, 읽기 전용`} title="반응 기능은 준비 중입니다">
      <span aria-hidden="true">＋</span> 반응 {count}
    </button>
  )
}
