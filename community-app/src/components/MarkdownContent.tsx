import { useMemo } from 'react'
import { renderMarkdown } from '../lib/markdown'

interface MarkdownContentProps {
  markdown: string
  className?: string
  allowImages?: boolean
}

export function MarkdownContent({ markdown, className = '', allowImages = true }: MarkdownContentProps) {
  const html = useMemo(() => renderMarkdown(markdown, allowImages), [allowImages, markdown])
  return <div className={`markdown-content ${className}`.trim()} dangerouslySetInnerHTML={{ __html: html }} />
}
