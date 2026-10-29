import { render, screen, fireEvent } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { BenefitsFilterPanel } from './BenefitsFilterPanel'
import { parseQuery } from '../../lib/benefitsQueryState'
import { index } from '../../test/benefitsFixture'
it('provides a mobile filter drawer with close and Escape focus restoration', () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
  render(
    <BenefitsFilterPanel
      state={parseQuery('', [])}
      update={vi.fn()}
      companies={index.companies}
    />,
  )
  const trigger = screen.getByRole('button', { name: '필터 열기' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(trigger)
  const dialog = screen.getByRole('dialog', { name: '검색·필터' })
  expect(dialog).toBeVisible()
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  vi.unstubAllGlobals()
})
