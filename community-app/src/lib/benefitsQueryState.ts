import { categories, statuses, type Category } from '../types/benefits'
export const presets = ['parenting','growth','housing','health','remote','custom'] as const
export const presetLabels = ['육아 중','커리어 성장','주거·이동','건강 관리','원격·유연근무','직접 설정']
export type QueryState = { scope: 'all'|'domestic'|'international'; q: string; categories: Category[]; statuses: string[]; compare: string[]; page: number; preset: typeof presets[number]; weights: Partial<Record<Category,number>>; industry: string; country: string; scale: string; notice: boolean }
export function parseQuery(raw: string, ids: string[]): QueryState {
 const defaults: QueryState = {scope:'all',q:'',categories:[],statuses:[],compare:[],page:1,preset:'parenting',weights:{},industry:'',country:'',scale:'',notice:false}
 if(raw.length>8000) return {...defaults,notice:true}
 const p=new URLSearchParams(raw); let notice=false
 const list=<T extends string>(key:string,allowed:readonly T[],max=allowed.length):T[]=>{const input=p.get(key)?.split(',').filter(Boolean)??[];const out=[...new Set(input.filter((v):v is T=>allowed.includes(v as T)))].slice(0,max);if(out.length!==input.length)notice=true;return out}
 const scope=p.get('scope')??'all'; const preset=p.get('preset')??'parenting';const q=(p.get('q')??'').trim().slice(0,100)
 const weights:Partial<Record<Category,number>>={}
 for(const pair of p.get('weights')?.split(',')??[]){const [key,value]=pair.split(':');const n=Number(value);if(categories.includes(key as Category)&&/^\d$/.test(value)&&n<=5)weights[key as Category]=n;else notice=true}
 const page=Number(p.get('page')??1)
 const state:QueryState={...defaults,scope:['all','domestic','international'].includes(scope)?scope as QueryState['scope']:'all',preset:presets.includes(preset as QueryState['preset'])?preset as QueryState['preset']:'parenting',q,categories:list('categories',categories),statuses:list('statuses',statuses),compare:list('compare',ids,4),page:Number.isSafeInteger(page)&&page>0?Math.min(page,10000):1,weights,industry:(p.get('industry')??'').slice(0,100),country:(p.get('country')??'').slice(0,100),scale:(p.get('scale')??'').slice(0,100),notice}
 state.notice=notice||q!==(p.get('q')??'')||state.scope!==scope||state.preset!==preset||state.page!==page
 return state
}
export function serializeQuery(s: QueryState) {
 const p=new URLSearchParams();if(s.scope!=='all')p.set('scope',s.scope);if(s.q)p.set('q',s.q)
 for(const key of ['categories','statuses','compare'] as const)if(s[key].length)p.set(key,s[key].join(','))
 if(s.page>1)p.set('page',String(s.page));p.set('preset',s.preset)
 const weights=categories.filter(c=>s.weights[c]!==undefined).map(c=>`${c}:${s.weights[c]}`).join(',');if(weights)p.set('weights',weights)
 for(const k of ['industry','country','scale'] as const)if(s[k])p.set(k,s[k])
 return '?'+p.toString()
}
export function presetWeights(preset: QueryState['preset']): Partial<Record<Category,number>> {
 return {parenting:{family:5,leave:3,health:2},growth:{growth:5,leave:2},housing:{housing:5,commute:4},health:{health:5,leave:3},remote:{remote:5,commute:2},custom:{}}[preset]
}
