import { describe, expect, it } from 'vitest'
import { validateCommentBody } from './commentValidation'

describe('validateCommentBody', () => {
  it.each([
    ['   ', false],
    ['a', true],
    ['a'.repeat(5000), true],
    ['a'.repeat(5001), false],
  ])('validates trimmed 1..5000 characters', (body, valid) => {
    expect(validateCommentBody(body).valid).toBe(valid)
  })
})
