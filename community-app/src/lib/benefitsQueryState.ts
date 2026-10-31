import { categories, outcomeFor, type Category, type CompanyListing } from '../types/benefits'

export const presets = ['parenting','growth','housing','health','remote','custom'] as const
export const presetLabels = ['육아 중','커리어 성장','주거·이동','건강 관리','원격·유연근무','직접 설정']
export type QueryState = {
  scope: 'all' | 'domestic' | 'international'
  q: string
  categories: Category[]
  statuses: ('confirmed'|'bounded'|'insufficient_evidence')[]
  compare: string[]
  page: number
  country: string
  employment_type: string
  role: string
  preferred_categories: Category[]
  preset: (typeof presets)[number]
  notice: boolean
}
const companyIdPattern = /^(?:KR-CRN-\d{13}|US-CIK\d{10})$/
const defaults: QueryState = { scope: 'all', q: '', categories: [], statuses: [], compare: [], page: 1, country: '', employment_type: '', role: '', preferred_categories: [], preset: 'parenting', notice: false }

export function parseQuery(raw: string, ids?: string[]): QueryState {
  if (raw.length > 8000) return { ...defaults, notice: true }
  const params = new URLSearchParams(raw)
  let notice = false
  const list = <T extends string>(key: string, allowed: readonly T[], max = allowed.length): T[] => {
    const input = params.get(key)?.split(',').filter(Boolean) ?? []
    const output = [...new Set(input.filter((value): value is T => allowed.includes(value as T)))].slice(0, max)
    if (output.length !== input.length) notice = true
    return output
  }
  const scopeRaw = params.get('scope') ?? 'all'
  const presetRaw = params.get('preset') ?? 'parenting'
  const pageRaw = Number(params.get('page') ?? 1)
  const candidates = ids ?? (params.get('compare')?.split(',').filter((id) => companyIdPattern.test(id)) ?? [])
  const qRaw = params.get('q') ?? ''
  const state: QueryState = {
    ...defaults,
    scope: ['all','domestic','international'].includes(scopeRaw) ? scopeRaw as QueryState['scope'] : 'all',
    q: qRaw.trim().slice(0, 100),
    categories: list('categories', categories),
    statuses: list('statuses', ['confirmed','bounded','insufficient_evidence'] as const),
    compare: list('compare', candidates, 4).filter((id) => companyIdPattern.test(id)),
    page: Number.isSafeInteger(pageRaw) && pageRaw > 0 ? Math.min(pageRaw, 10000) : 1,
    country: (params.get('country') ?? '').slice(0, 100),
    employment_type: (params.get('employment_type') ?? '').slice(0, 100),
    role: (params.get('role') ?? '').slice(0, 100),
    preferred_categories: list('preferred_categories', categories),
    preset: presets.includes(presetRaw as QueryState['preset']) ? presetRaw as QueryState['preset'] : 'parenting',
    notice: false,
  }
  state.notice = notice || state.scope !== scopeRaw || state.preset !== presetRaw || state.page !== pageRaw || state.q !== qRaw
  return state
}

export function serializeQuery(state: QueryState) {
  const params = new URLSearchParams()
  if (state.scope !== 'all') params.set('scope', state.scope)
  if (state.q) params.set('q', state.q)
  for (const key of ['categories','statuses','compare','preferred_categories'] as const) if (state[key].length) params.set(key, state[key].join(','))
  if (state.page > 1) params.set('page', String(state.page))
  for (const key of ['country','employment_type','role'] as const) if (state[key]) params.set(key, state[key])
  params.set('preset', state.preset)
  return `?${params.toString()}`
}

export function presetCategories(preset: QueryState['preset']): Category[] {
  return { parenting: ['family','leave','health'], growth: ['growth','leave'], housing: ['housing','commute'], health: ['health','leave'], remote: ['remote','commute'], custom: [] }[preset] as Category[]
}

export function filterBenefitsCompanies(companies: CompanyListing[], state: QueryState) {
  return companies.filter((company) =>
    (state.scope === 'all' || company.scope === state.scope) &&
    `${company.display_name} ${company.legal_name}`.toLocaleLowerCase().includes(state.q.toLocaleLowerCase()) &&
    (!state.country || company.registered_head_office_country === state.country || company.incorporation_country === state.country) &&
    (!state.statuses.length || (state.categories.length ? state.categories : categories).some((category) => {
      const outcome = outcomeFor(company, category)
      return state.statuses.includes(outcome.kind === 'evidenced' ? outcome.status : 'insufficient_evidence')
    })),
  )
}

export type ConditionGroup = 'matches_visible_scope'|'scope_mismatch'|'scope_unknown'|'insufficient_evidence'
export function conditionGroup(company: CompanyListing, state: QueryState): { group: ConditionGroup; reasons: string[] } {
  const wanted = state.preferred_categories.length ? state.preferred_categories : presetCategories(state.preset)
  const outcomes = wanted.map((category) => outcomeFor(company, category))
  if (!outcomes.length || outcomes.every((outcome) => outcome.kind === 'insufficient_evidence')) return { group: 'insufficient_evidence', reasons: wanted.map((category) => `${category}: 게시 가능한 근거 부족`) }
  const evidenced = outcomes.filter((outcome) => outcome.kind === 'evidenced')
  const mismatch = evidenced.some((outcome) => (state.country && outcome.scope.countries.length > 0 && !outcome.scope.countries.includes(state.country)) || (state.role && outcome.scope.roles.length > 0 && !outcome.scope.roles.includes(state.role)) || (state.employment_type && outcome.scope.employment_types.length > 0 && !outcome.scope.employment_types.includes(state.employment_type)))
  if (mismatch) return { group: 'scope_mismatch', reasons: ['선택한 국가·직군·고용형태가 공개 적용 범위와 다릅니다.'] }
  const unknown = evidenced.some((outcome) => (state.country && outcome.scope.countries.length === 0) || (state.role && outcome.scope.roles.length === 0) || (state.employment_type && outcome.scope.employment_types.length === 0))
  if (unknown) return { group: 'scope_unknown', reasons: ['공개 근거에 선택 조건의 적용 범위가 명시되지 않았습니다.'] }
  return { group: 'matches_visible_scope', reasons: ['선택 조건이 공개된 적용 범위에 포함됩니다.'] }
}
