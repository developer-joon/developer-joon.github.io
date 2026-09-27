import type { CommunityTag } from '../types/community'

interface TagFilterProps {
  tags: CommunityTag[]
  selected: string | null
  onChange: (tagId: string | null) => void
}

export function TagFilter({ tags, selected, onChange }: TagFilterProps) {
  return (
    <div className="tag-filter" aria-label="태그 필터">
      <button className={selected === null ? 'active' : ''} type="button" onClick={() => onChange(null)}>전체</button>
      {tags.map((tag) => (
        <button className={selected === tag.id ? 'active' : ''} type="button" key={tag.id} onClick={() => onChange(tag.id)}>{tag.label}</button>
      ))}
    </div>
  )
}
