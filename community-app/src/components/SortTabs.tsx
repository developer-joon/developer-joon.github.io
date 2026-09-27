import type { PostSort } from '../types/community'

const options: Array<{ value: PostSort; label: string }> = [
  { value: 'newest', label: '최신순' },
  { value: 'popular', label: '인기순' },
  { value: 'comments', label: '댓글순' },
]

export function SortTabs({ value, onChange }: { value: PostSort; onChange: (sort: PostSort) => void }) {
  return (
    <div className="sort-tabs" aria-label="게시글 정렬">
      {options.map((option) => (
        <button type="button" aria-pressed={value === option.value} key={option.value} onClick={() => onChange(option.value)}>{option.label}</button>
      ))}
    </div>
  )
}
