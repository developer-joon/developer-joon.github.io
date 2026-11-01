import { categories, categoryLabels } from '../../types/benefits'
import { presets, presetLabels, type QueryState } from '../../lib/benefitsQueryState'

export function FitPresetPicker({ state, update }: { state: QueryState; update: (patch: Partial<QueryState>) => void }) {
  return <div className="benefits-fit-conditions">
    <label>조건 묶음<select value={state.preset} onChange={(event) => update({ preset: event.target.value as QueryState['preset'], page: 1 })}>{presets.map((preset, index) => <option key={preset} value={preset}>{presetLabels[index]}</option>)}</select></label>
    <label>국가<input value={state.country} onChange={(event) => update({ country: event.target.value, page: 1 })} placeholder="예: KR" /></label>
    <label>고용형태<input value={state.employment_type} onChange={(event) => update({ employment_type: event.target.value, page: 1 })} /></label>
    <label>직군<input value={state.role} onChange={(event) => update({ role: event.target.value, page: 1 })} /></label>
    {state.preset === 'custom' && <fieldset><legend>선호 분야</legend>{categories.map((category) => <label key={category}><input type="checkbox" checked={state.preferred_categories.includes(category)} onChange={(event) => update({ preferred_categories: event.target.checked ? [...state.preferred_categories, category] : state.preferred_categories.filter((value) => value !== category), page: 1 })} />{categoryLabels[category]}</label>)}</fieldset>}
  </div>
}
