import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppFooter } from './AppFooter'

describe('AppFooter', () => {
  it('renders the exact current-year copyright, tagline, and privacy link contract', () => {
    render(<AppFooter />)

    const footer = screen.getByRole('contentinfo')
    expect(footer).toHaveTextContent('Build things. Ship fast. Learn always.')
    expect(footer).toHaveTextContent(`© ${new Date().getFullYear()} Ria & Seoa PaPa`)
    expect(screen.getByRole('link', { name: '개인정보처리방침' })).toHaveAttribute('href', '/privacy')
  })
})
