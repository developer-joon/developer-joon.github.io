export function DraftNotice({ restored, saved }: { restored?: boolean; saved?: boolean }) {
  if (!restored && !saved) return null
  return <p className="draft-notice" role="status">{restored ? '저장된 초안을 복원했습니다.' : '이 기기에 초안을 저장했습니다.'}</p>
}
