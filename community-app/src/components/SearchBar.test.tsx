import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SearchBar } from './SearchBar'

describe('SearchBar', () => {
  it('bounds values supplied by parent state to 200 characters', () => {
    const { rerender } = render(<SearchBar value={'a'.repeat(201)} onSubmit={vi.fn()} />)

    expect(screen.getByRole('searchbox', { name: '게시글 검색' })).toHaveValue('a'.repeat(200))

    rerender(<SearchBar value={'b'.repeat(201)} onSubmit={vi.fn()} />)
    expect(screen.getByRole('searchbox', { name: '게시글 검색' })).toHaveValue('b'.repeat(200))
  })
})
