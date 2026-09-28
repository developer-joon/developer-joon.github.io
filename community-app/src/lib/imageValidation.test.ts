import { describe, expect, it } from 'vitest'
import { MAX_IMAGE_BYTES, validateImageCount, validateImageFile } from './imageValidation'

function file(size: number, type: string) {
  return new File([new Uint8Array(size)], 'image.bin', { type })
}

describe('imageValidation', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s at the size boundaries', (type) => {
    expect(validateImageFile(file(1, type))).toEqual({ ok: true })
    expect(validateImageFile(file(MAX_IMAGE_BYTES, type))).toEqual({ ok: true })
  })

  it('rejects empty, oversized, and unsupported files with stable typed errors', () => {
    expect(validateImageFile(file(0, 'image/png'))).toMatchObject({ ok: false, error: { code: 'empty' } })
    expect(validateImageFile(file(MAX_IMAGE_BYTES + 1, 'image/png'))).toMatchObject({ ok: false, error: { code: 'too_large' } })
    expect(validateImageFile(file(4, 'image/gif'))).toMatchObject({ ok: false, error: { code: 'unsupported_type' } })
  })

  it('enforces a maximum of five image intents', () => {
    expect(validateImageCount(4, 1)).toEqual({ ok: true })
    expect(validateImageCount(5, 1)).toMatchObject({ ok: false, error: { code: 'too_many' } })
    expect(validateImageCount(2, 4)).toMatchObject({ ok: false, error: { code: 'too_many' } })
  })
})
