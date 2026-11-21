import {
  BENEFIT_DIRECTORY_CATEGORIES,
  BENEFIT_DIRECTORY_SIZE_CLASSES,
  type BenefitDirectoryCategory,
  type BenefitDirectorySizeClass,
} from '../types/benefitDirectory'

export const BENEFIT_DIRECTORY_SORTS = ['name_asc'] as const
export type BenefitDirectorySort = (typeof BENEFIT_DIRECTORY_SORTS)[number]

export interface BenefitDirectoryQueryState {
  q: string
  categories: BenefitDirectoryCategory[]
  industry: string
  size: BenefitDirectorySizeClass | null
  hasBenefitsOnly: boolean
  /** The Task 4 RPC has one fixed, cursor-compatible ordering. */
  sort: BenefitDirectorySort
}

export const DEFAULT_BENEFIT_DIRECTORY_QUERY: BenefitDirectoryQueryState = {
  q: '', categories: [], industry: '', size: null, hasBenefitsOnly: false, sort: 'name_asc',
}

function codePointLength(value: string) { return Array.from(value).length }
function byteLength(value: string) { return new TextEncoder().encode(value).length }
function bounded(value: string, maxCharacters: number, maxBytes: number) {
  return codePointLength(value) <= maxCharacters && byteLength(value) <= maxBytes
}
function decodePart(value: string) {
  try { return decodeURIComponent(value.replace(/\+/g, ' ')) }
  catch { return null }
}

function safeEntries(search: string): Array<[string, string]> {
  if (search.length > 10_000) return []
  const source = search.startsWith('?') ? search.slice(1) : search
  if (!source) return []
  const entries: Array<[string, string]> = []
  for (const pair of source.split('&')) {
    const separator = pair.indexOf('=')
    const rawKey = separator < 0 ? pair : pair.slice(0, separator)
    const rawValue = separator < 0 ? '' : pair.slice(separator + 1)
    const key = decodePart(rawKey); const value = decodePart(rawValue)
    if (key === null || value === null) return []
    entries.push([key, value])
  }
  return entries
}

export function parseBenefitDirectoryQuery(search: string): BenefitDirectoryQueryState {
  const entries = safeEntries(search)
  const values = (key: string) => entries.filter(([name]) => name === key).map(([, value]) => value)
  const first = (key: string) => values(key)[0]
  const rawQuery = first('q') ?? ''
  const q = bounded(rawQuery, 200, 800) && !rawQuery.includes('\uFFFD') ? rawQuery : ''
  const rawIndustry = first('industry') ?? ''
  const industry = rawIndustry.trim() && bounded(rawIndustry.trim(), 100, 400) && !rawIndustry.includes('\uFFFD')
    ? rawIndustry.trim()
    : ''
  const selected = new Set(values('categories').flatMap(value => value.split(',')).filter(value => (BENEFIT_DIRECTORY_CATEGORIES as readonly string[]).includes(value)))
  const categories = BENEFIT_DIRECTORY_CATEGORIES.filter(category => selected.has(category))
  const rawSize = first('size')
  const size = rawSize && (BENEFIT_DIRECTORY_SIZE_CLASSES as readonly string[]).includes(rawSize)
    ? rawSize as BenefitDirectorySizeClass
    : null
  const rawSort = first('sort')
  const sort = rawSort && (BENEFIT_DIRECTORY_SORTS as readonly string[]).includes(rawSort)
    ? rawSort as BenefitDirectorySort
    : 'name_asc'
  return { q, categories, industry, size, hasBenefitsOnly: first('hasBenefitsOnly') === '1', sort }
}

export function canonicalizeBenefitDirectoryQuery(state: BenefitDirectoryQueryState): BenefitDirectoryQueryState {
  const q = state.q.trim()
  const industry = state.industry.trim()
  const selected = new Set(state.categories)
  return {
    q: bounded(q, 200, 800) ? q : '',
    categories: BENEFIT_DIRECTORY_CATEGORIES.filter(category => selected.has(category)),
    industry: bounded(industry, 100, 400) ? industry : '',
    size: state.size && BENEFIT_DIRECTORY_SIZE_CLASSES.includes(state.size) ? state.size : null,
    hasBenefitsOnly: state.hasBenefitsOnly,
    sort: BENEFIT_DIRECTORY_SORTS.includes(state.sort) ? state.sort : 'name_asc',
  }
}

export function serializeBenefitDirectoryQuery(state: BenefitDirectoryQueryState) {
  const value = canonicalizeBenefitDirectoryQuery(state)
  const params = new URLSearchParams()
  if (value.q) params.set('q', value.q)
  if (value.categories.length) params.set('categories', value.categories.join(','))
  if (value.industry) params.set('industry', value.industry)
  if (value.size) params.set('size', value.size)
  if (value.hasBenefitsOnly) params.set('hasBenefitsOnly', '1')
  if (value.sort !== 'name_asc') params.set('sort', value.sort)
  const query = params.toString()
  return query ? `?${query}` : ''
}
