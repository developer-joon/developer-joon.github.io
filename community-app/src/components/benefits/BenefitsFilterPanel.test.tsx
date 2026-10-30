import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { BenefitsFilterPanel } from './BenefitsFilterPanel'
import {
  parseQuery,
  serializeQuery,
  type QueryState,
} from '../../lib/benefitsQueryState'
import { index } from '../../test/benefitsFixture'

it('keeps an in-progress space so multiword company names can be entered', () => {
  function Harness() {
    const [state, setState] = useState(() => parseQuery('', []))
    const update = (patch: Partial<QueryState>) =>
      setState(parseQuery(serializeQuery({ ...state, ...patch }), []))
    return (
      <BenefitsFilterPanel
        state={state}
        update={update}
        companies={index.companies}
      />
    )
  }
  render(<Harness />)
  const search = screen.getByRole('searchbox', { name: '기업 검색' })
  fireEvent.change(search, { target: { value: '예시 ' } })
  expect(search).toHaveValue('예시 ')
  fireEvent.change(search, { target: { value: '예시 별빛기업' } })
  expect(search).toHaveValue('예시 별빛기업')
})
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
