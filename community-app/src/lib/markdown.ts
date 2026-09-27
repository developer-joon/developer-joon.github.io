import DOMPurify from 'dompurify'
import { Marked, Renderer } from 'marked'

const allowedTags = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'blockquote',
  'strong', 'em', 'del', 'code', 'pre', 'a', 'img', 'br', 'hr',
]
const publicAttachmentPath = /^\/functions\/v1\/public-attachment\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface MarkdownOptions {
  allowImages?: boolean
  allowedImageOrigin?: string
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

const renderer = new Renderer()
renderer.html = ({ text }) => escapeHtml(text)
const parser = new Marked({ async: false, gfm: true, breaks: false, renderer })

function unwrap(element: Element) {
  element.replaceWith(...Array.from(element.childNodes))
}

function parseAbsoluteUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function safeLink(value: string) {
  const normalized = Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint > 0x20 && codePoint !== 0x7f
    })
    .join('')
  try {
    const protocol = new URL(normalized).protocol.toLowerCase()
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:'
  } catch {
    return false
  }
}

export function renderMarkdown(markdown: string, options: MarkdownOptions = {}): string {
  const { allowImages = true, allowedImageOrigin } = options
  const generated = parser.parse(markdown) as string
  const sanitized = DOMPurify.sanitize(generated, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: ['href', 'title', 'src', 'alt'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'svg', 'math'],
    FORBID_ATTR: ['style'],
  })
  const template = document.createElement('template')
  template.innerHTML = sanitized

  for (const link of template.content.querySelectorAll('a')) {
    const href = link.getAttribute('href') ?? ''
    if (!safeLink(href)) {
      unwrap(link)
      continue
    }
    if (/^https?:/i.test(href)) {
      link.setAttribute('target', '_blank')
      link.setAttribute('rel', 'noopener noreferrer')
    } else {
      link.removeAttribute('target')
      link.removeAttribute('rel')
    }
  }

  for (const image of template.content.querySelectorAll('img')) {
    const src = image.getAttribute('src') ?? ''
    const imageUrl = parseAbsoluteUrl(src)
    if (!allowImages || !allowedImageOrigin || imageUrl?.origin !== allowedImageOrigin
      || imageUrl.username !== '' || imageUrl.password !== ''
      || !publicAttachmentPath.test(imageUrl.pathname)) {
      image.remove()
      continue
    }
    image.setAttribute('loading', 'lazy')
    image.setAttribute('referrerpolicy', 'no-referrer')
  }

  return template.innerHTML
}
