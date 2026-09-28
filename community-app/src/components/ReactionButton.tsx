import { useRef } from 'react'

interface ReactionButtonProps {
  count: number
  pressed?: boolean
  pending?: boolean
  disabled?: boolean
  readOnly?: boolean
  loginRequired?: boolean
  onToggle?: () => void
}

export function ReactionButton({ count, pressed = false, pending = false, disabled = false, readOnly = false, loginRequired = false, onToggle }: ReactionButtonProps) {
  const invoking = useRef(false)
  const unavailable = pending || disabled || readOnly
  const action = pressed ? '반응 취소' : '반응 남기기'
  const label = readOnly ? `반응 ${count}개, 읽기 전용` : `${loginRequired ? '로그인하고 ' : ''}${action}, 현재 ${count}개`
  function toggle() {
    if (unavailable || invoking.current) return
    invoking.current = true
    try { onToggle?.() } finally { queueMicrotask(() => { invoking.current = false }) }
  }
  return (
    <button className={`reaction-count${pressed ? ' is-pressed' : ''}`} type="button" disabled={unavailable}
      aria-label={label} aria-pressed={readOnly ? undefined : pressed} aria-busy={pending} onClick={toggle}>
      <span aria-hidden="true">{pressed ? '♥' : '♡'}</span> 반응 {count}
    </button>
  )
}
