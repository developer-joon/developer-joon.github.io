import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReactionButton } from './ReactionButton'

describe('ReactionButton', () => {
  it('is controlled and exposes pressed, pending and accessible count state', () => {
    const onToggle = vi.fn()
    render(<ReactionButton count={3} pressed pending={false} onToggle={onToggle} />)
    const button = screen.getByRole('button', { name: '반응 취소, 현재 3개' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toHaveAttribute('aria-busy', 'false')
    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('guards rapid double clicks while its async handler is in flight', () => {
    const onToggle = vi.fn()
    render(<ReactionButton count={2} pressed={false} pending onToggle={onToggle} />)
    const button = screen.getByRole('button', { name: '반응 남기기, 현재 2개' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onToggle).not.toHaveBeenCalled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('labels read-only state and disables interaction', () => {
    render(<ReactionButton count={1} pressed={false} readOnly onToggle={vi.fn()} />)
    expect(screen.getByRole('button', { name: '반응 1개, 읽기 전용' })).toBeDisabled()
  })
})
