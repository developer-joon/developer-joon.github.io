import { type FormEvent, useState } from 'react'

interface SearchBarProps {
  value: string
  onSubmit: (value: string) => void
}

export function SearchBar({ value, onSubmit }: SearchBarProps) {
  const [draft, setDraft] = useState(value)
  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit(draft.trim())
  }
  return (
    <form className="search-bar" role="search" onSubmit={submit}>
      <label className="sr-only" htmlFor="community-search">게시글 검색</label>
      <input id="community-search" type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="질문, 기술, 경험을 검색하세요" />
      <button type="submit">검색</button>
    </form>
  )
}
