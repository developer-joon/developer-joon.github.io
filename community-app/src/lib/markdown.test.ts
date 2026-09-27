import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

const attachmentOrigin = 'https://abcdefghijklmnopqrst.supabase.co'

function documentFor(markdown: string) {
  const container = document.createElement('div')
  container.innerHTML = renderMarkdown(markdown, { allowedImageOrigin: attachmentOrigin })
  return container
}

describe('renderMarkdown', () => {
  it('does not interpret user raw HTML or inline handlers', () => {
    const output = documentFor('<section onclick="alert(1)">raw <strong>html</strong></section>')

    expect(output.querySelector('section')).toBeNull()
    expect(output.querySelector('[onclick]')).toBeNull()
    expect(output.textContent).toContain('raw')
  })

  it.each([
    '[bad](javascript:alert(1))',
    '[bad](JaVaScRiPt:alert(1))',
    '[bad](java&#x73;cript:alert(1))',
    '[bad](vbscript:msgbox(1))',
    '[bad](file:///etc/passwd)',
    '[bad](data:text/html;base64,PHNjcmlwdD4=)',
  ])('strips unsafe link URL from %s', (markdown) => {
    const output = documentFor(markdown)
    expect(output.querySelector('a')).toBeNull()
    expect(output.textContent).toContain('bad')
  })

  it('removes script, SVG, MathML, and embedded form fixtures', () => {
    const output = documentFor('<script>alert(1)</script><svg><a href="javascript:alert(1)">x</a></svg><math><mi>x</mi></math><iframe src="https://example.com"></iframe><form><input><button>x</button></form>')

    expect(output.querySelector('script,svg,math,iframe,form,input,button')).toBeNull()
  })

  it('keeps headings, emphasis, code, lists, quotes, and safe links', () => {
    const output = documentFor('# 제목\n\n**강조**와 `code`\n\n- 하나\n\n> 인용\n\n[문서](https://example.com/docs) [메일](mailto:test@example.com)')

    expect(output.querySelector('h1')?.textContent).toBe('제목')
    expect(output.querySelector('strong')?.textContent).toBe('강조')
    expect(output.querySelector('code')?.textContent).toBe('code')
    expect(output.querySelector('li')?.textContent).toBe('하나')
    expect(output.querySelector('blockquote')?.textContent).toContain('인용')
    expect(output.querySelector('a[href="https://example.com/docs"]')).not.toBeNull()
    expect(output.querySelector('a[href="mailto:test@example.com"]')).not.toBeNull()
  })

  it('allows only HTTPS public attachment images and gives them safe attributes', () => {
    const id = '56000000-0000-4000-8000-000000000001'
    const output = documentFor(`![설명](${attachmentOrigin}/functions/v1/public-attachment/${id})\n\n![위장](https://evil.example/functions/v1/public-attachment/${id})\n\n![외부](https://example.com/image.png)\n\n![데이터](data:image/png;base64,AAAA)`)
    const images = output.querySelectorAll('img')

    expect(images).toHaveLength(1)
    expect(images[0]).toHaveAttribute('alt', '설명')
    expect(images[0]).toHaveAttribute('loading', 'lazy')
    expect(images[0]).toHaveAttribute('referrerpolicy', 'no-referrer')
  })

  it('can disable images for comment Markdown', () => {
    const id = '56000000-0000-4000-8000-000000000001'
    const output = document.createElement('div')
    output.innerHTML = renderMarkdown(
      `![설명](https://abcdefghijklmnopqrst.supabase.co/functions/v1/public-attachment/${id})`,
      { allowImages: false, allowedImageOrigin: attachmentOrigin },
    )

    expect(output.querySelector('img')).toBeNull()
  })

  it('adds noopener and noreferrer to external target links without changing deterministic output', () => {
    const markdown = '[외부 문서](https://example.com)'
    const first = renderMarkdown(markdown, { allowedImageOrigin: attachmentOrigin })
    const second = renderMarkdown(markdown, { allowedImageOrigin: attachmentOrigin })
    const output = documentFor(markdown)

    expect(first).toBe(second)
    expect(output.querySelector('a')).toHaveAttribute('target', '_blank')
    expect(output.querySelector('a')).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
