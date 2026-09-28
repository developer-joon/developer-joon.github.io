import { describe, expect, it } from 'vitest'
import { extractExistingAttachmentIds } from './attachmentMarkdown'

const origin = 'https://project.supabase.co'
const first = '56000000-0000-4000-8000-000000000070'
const second = '56000000-0000-4000-8000-000000000071'

describe('extractExistingAttachmentIds', () => {
  it('extracts distinct canonical attachment IDs from trusted server image Markdown', () => {
    const markdown = [
      `![첫 이미지](${origin}/functions/v1/public-attachment/${first})`,
      `![중복](${origin}/functions/v1/public-attachment/${first})`,
      `![둘째](${origin}/functions/v1/public-attachment/${second})`,
    ].join('\n')

    expect(extractExistingAttachmentIds(markdown, origin)).toEqual([first, second])
  })

  it.each([
    [`![외부](https://evil.test/functions/v1/public-attachment/${first})`],
    [`![쿼리](${origin}/functions/v1/public-attachment/${first}?download=1)`],
    [`![프래그먼트](${origin}/functions/v1/public-attachment/${first}#x)`],
    [`[이미지 아닌 링크](${origin}/functions/v1/public-attachment/${first})`],
    [`그냥 URL: ${origin}/functions/v1/public-attachment/${first}`],
    [`![하위 경로](${origin}/prefix/functions/v1/public-attachment/${first})`],
    [`![잘못된 ID](${origin}/functions/v1/public-attachment/not-a-uuid)`],
  ])('rejects non-canonical or non-image candidates: %s', (markdown) => {
    expect(extractExistingAttachmentIds(markdown, origin)).toEqual([])
  })

  it('accepts only one to five IDs and returns an explicit failure when trusted content exceeds the product bound', () => {
    const markdown = Array.from({ length: 6 }, (_, index) => {
      const id = `56000000-0000-4000-8000-00000000007${index}`
      return `![이미지](${origin}/functions/v1/public-attachment/${id})`
    }).join('\n')

    expect(extractExistingAttachmentIds(markdown, origin)).toBeNull()
  })

  it.each(['not a URL', 'javascript:alert(1)', 'https://user:pass@project.supabase.co'])('returns an explicit failure for an invalid allowed origin: %s', (allowedOrigin) => {
    expect(extractExistingAttachmentIds(`![이미지](${origin}/functions/v1/public-attachment/${first})`, allowedOrigin)).toBeNull()
  })
})
