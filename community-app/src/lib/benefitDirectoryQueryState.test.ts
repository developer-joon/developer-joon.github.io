import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BENEFIT_DIRECTORY_QUERY,
  parseBenefitDirectoryQuery,
  serializeBenefitDirectoryQuery,
} from './benefitDirectoryQueryState'

describe('benefit directory URL query state', () => {
  it('parses comma-separated and repeated plural categories in taxonomy order', () => {
    expect(parseBenefitDirectoryQuery('?categories=leave,health').categories).toEqual(['leave', 'health'])
    expect(parseBenefitDirectoryQuery('?categories=leave&categories=health').categories).toEqual(['leave', 'health'])
    expect(parseBenefitDirectoryQuery('?q=%EA%B0%80%EB%82%98&categories=health,leave&categories=health&industry=%EC%86%8C%ED%94%84%ED%8A%B8%EC%9B%A8%EC%96%B4&size=medium&hasBenefitsOnly=1&sort=name_asc')).toEqual({
      q: '가나', categories: ['leave', 'health'], industry: '소프트웨어', size: 'medium',
      hasBenefitsOnly: true, sort: 'name_asc',
    })
  })

  it('decodes encoded category tokens and drops duplicates, invalid values, and empty tokens', () => {
    expect(parseBenefitDirectoryQuery('?categories=%6Ceave%2C%2Cunknown&categories=health%2Cleave%2Chealth').categories).toEqual(['leave', 'health'])
  })

  it('falls back safely for malformed, unsupported, and over-bound values', () => {
    const oversized = '가'.repeat(201)
    expect(() => parseBenefitDirectoryQuery(`?q=%E0%A4%A&categories=%E0%A4%A&size=giant&hasBenefitsOnly=true&sort=popular&industry=${encodeURIComponent(oversized)}`)).not.toThrow()
    expect(parseBenefitDirectoryQuery(`?q=%E0%A4%A&categories=%E0%A4%A&size=giant&hasBenefitsOnly=true&sort=popular&industry=${encodeURIComponent(oversized)}`)).toEqual(DEFAULT_BENEFIT_DIRECTORY_QUERY)
  })

  it('serializes a deterministic canonical URL with defaults omitted and categories in server order', () => {
    expect(serializeBenefitDirectoryQuery({
      q: '  가나다  ', categories: ['health', 'leave', 'health'], industry: '  제조  ', size: 'small',
      hasBenefitsOnly: true, sort: 'name_asc',
    })).toBe('?q=%EA%B0%80%EB%82%98%EB%8B%A4&categories=leave%2Chealth&industry=%EC%A0%9C%EC%A1%B0&size=small&hasBenefitsOnly=1')
    expect(serializeBenefitDirectoryQuery(DEFAULT_BENEFIT_DIRECTORY_QUERY)).toBe('')
  })

  it('ignores the singular legacy category key and drops it when canonicalizing', () => {
    const parsed = parseBenefitDirectoryQuery('?category=leave')
    expect(parsed.categories).toEqual([])
    expect(serializeBenefitDirectoryQuery(parsed)).toBe('')
  })

  it('bounds query by server code-point and UTF-8 byte limits without splitting characters', () => {
    const parsed = parseBenefitDirectoryQuery(`?q=${encodeURIComponent('가'.repeat(200))}`)
    expect(Array.from(parsed.q)).toHaveLength(200)
    expect(new TextEncoder().encode(parsed.q)).toHaveLength(600)
    expect(parseBenefitDirectoryQuery(`?q=${encodeURIComponent('😀'.repeat(201))}`).q).toBe('')
  })

  it('trims editable text when parsing URL state', () => {
    expect(parseBenefitDirectoryQuery('?q=%20%20test%20%20&industry=%20%EC%A0%9C%EC%A1%B0%20')).toEqual({
      ...DEFAULT_BENEFIT_DIRECTORY_QUERY,
      q: 'test',
      industry: '제조',
    })
  })

  it('intentionally drops unknown parameters and never persists a cursor', () => {
    const parsed = parseBenefitDirectoryQuery('?q=test&utm_source=x&cursor=private')
    expect(serializeBenefitDirectoryQuery(parsed)).toBe('?q=test')
  })
})
