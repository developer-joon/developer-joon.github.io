import { type FormEvent, useEffect, useState } from 'react'
import { maxCommunitySearchLength, normalizeCommunitySearch } from '../lib/queryState'

interface SearchBarProps {
  value: string
  onSubmit: (value: string) => void
}

export function SearchBar({ value, onSubmit }: SearchBarProps) {
  const [draft, setDraft] = useState(() => value.slice(0, maxCommunitySearchLength))

  useEffect(() => setDraft(value.slice(0, maxCommunitySearchLength)), [value])

  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit(normalizeCommunitySearch(draft))
  }
  return (
    <form className="search-bar" role="search" onSubmit={submit}>
      <label className="sr-only" htmlFor="community-search">게시글 검색</label>
      <input
        id="community-search"
        type="search"
        maxLength={maxCommunitySearchLength}
        value={draft}
        onChange={(event) => setDraft(event.target.value.slice(0, maxCommunitySearchLength))}
        placeholder="질문, 기술, 경험을 검색하세요"
      />
      <button type="submit">검색</button>
    </form>
  )
}
