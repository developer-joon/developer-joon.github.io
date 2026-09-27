import { useMemo } from 'react'
import { renderMarkdown } from '../lib/markdown'

interface MarkdownContentProps {
  markdown: string
  className?: string
  allowImages?: boolean
  allowedImageOrigin?: string
}

export function MarkdownContent({ markdown, className = '', allowImages = true, allowedImageOrigin }: MarkdownContentProps) {
  const html = useMemo(
    () => renderMarkdown(markdown, { allowImages, allowedImageOrigin }),
    [allowImages, allowedImageOrigin, markdown],
  )
  return <div className={`markdown-content ${className}`.trim()} dangerouslySetInnerHTML={{ __html: html }} />
}
