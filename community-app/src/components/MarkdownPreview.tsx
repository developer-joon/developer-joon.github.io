import { MarkdownContent } from './MarkdownContent'

export function MarkdownPreview({ markdown, allowedImageOrigin }: { markdown: string; allowedImageOrigin?: string }) {
  return <section className="editor-preview" aria-label="마크다운 미리보기"><MarkdownContent markdown={markdown} allowedImageOrigin={allowedImageOrigin} /></section>
}
