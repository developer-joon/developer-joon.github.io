import type { CommunityTag } from '../types/community'

interface TagSelectorProps {
  tags: CommunityTag[]
  selected: string[]
  onChange(ids: string[]): void
  error?: string
  unavailableLabels?: string[]
  disabled?: boolean
}

export function TagSelector({ tags, selected, onChange, error, unavailableLabels = [], disabled = false }: TagSelectorProps) {
  const activeIds = new Set(tags.map(tag => tag.id))
  const unavailableIds = selected.filter(id => !activeIds.has(id))
  function toggle(id: string, checked: boolean) {
    onChange(checked ? [...selected, id] : selected.filter(value => value !== id))
  }
  return (
    <fieldset className="tag-selector" aria-describedby="tag-help tag-error unavailable-tags">
      <legend>태그</legend>
      <p id="tag-help" className="editor-hint">1개 이상 3개 이하로 선택해 주세요. <strong>{selected.filter(id => activeIds.has(id)).length} / 3개 선택</strong></p>
      <div className="tag-options">
        {tags.map(tag => {
          const checked = selected.includes(tag.id)
          return <label key={tag.id}><input type="checkbox" checked={checked} disabled={disabled || (!checked && selected.filter(id => activeIds.has(id)).length >= 3)} onChange={event => toggle(tag.id, event.currentTarget.checked)} /> <span>{tag.label}</span></label>
        })}
      </div>
      {unavailableIds.length > 0 && <div id="unavailable-tags" className="unavailable-tags" role="alert">현재 사용할 수 없는 태그: {unavailableLabels.join(', ') || unavailableIds.join(', ')}. 활성 태그로 교체해 주세요.<button type="button" disabled={disabled} onClick={() => onChange(selected.filter(id => activeIds.has(id)))}>사용할 수 없는 태그 해제</button></div>}
      {error && <p id="tag-error" className="field-error">{error}</p>}
    </fieldset>
  )
}
