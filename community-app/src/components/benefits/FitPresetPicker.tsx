import { categories, categoryLabels } from '../../types/benefits'
import { presets, presetLabels, type QueryState } from '../../lib/benefitsQueryState'
export function FitPresetPicker({state,update}:{state:QueryState;update:(p:Partial<QueryState>)=>void}) {
 return <><label>생활 우선순위<select value={state.preset} onChange={e=>update({preset:e.target.value as QueryState['preset'],page:1})}>{presets.map((p,i)=><option key={p} value={p}>{presetLabels[i]}</option>)}</select></label>{state.preset==='custom'&&<fieldset><legend>분야별 중요도 · 0~5</legend>{categories.map(c=><label key={c}>{categoryLabels[c]} 중요도<input type="range" min="0" max="5" step="1" value={state.weights[c]??0} onChange={e=>update({weights:{...state.weights,[c]:Number(e.target.value)},page:1})}/><output>{state.weights[c]??0}</output></label>)}</fieldset>}</>
}
