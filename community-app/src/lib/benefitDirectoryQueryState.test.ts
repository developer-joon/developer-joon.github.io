import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BENEFIT_DIRECTORY_QUERY,
  parseBenefitDirectoryQuery,
  serializeBenefitDirectoryQuery,
} from './benefitDirectoryQueryState'

describe('benefit directory URL query state', () => {
  it('parses repeated encoded categories and every supported filter', () => {
    expect(parseBenefitDirectoryQuery('?q=%EA%B0%80%EB%82%98&category=health&category=leave&category=health&industry=%EC%86%8C%ED%94%84%ED%8A%B8%EC%9B%A8%EC%96%B4&size=medium&hasBenefitsOnly=1&sort=name_asc')).toEqual({
      q: '가나', categories: ['leave', 'health'], industry: '소프트웨어', size: 'medium',
      hasBenefitsOnly: true, sort: 'name_asc',
    })
  })

  it('falls back safely for malformed, unsupported, and over-bound values', () => {
    const oversized = '가'.repeat(201)
    expect(() => parseBenefitDirectoryQuery(`?q=%E0%A4%A&category=unknown&size=giant&hasBenefitsOnly=true&sort=popular&industry=${encodeURIComponent(oversized)}`)).not.toThrow()
    expect(parseBenefitDirectoryQuery(`?q=%E0%A4%A&category=unknown&size=giant&hasBenefitsOnly=true&sort=popular&industry=${encodeURIComponent(oversized)}`)).toEqual(DEFAULT_BENEFIT_DIRECTORY_QUERY)
  })

  it('serializes a deterministic canonical URL with defaults omitted and categories in server order', () => {
    expect(serializeBenefitDirectoryQuery({
      q: '  가나다  ', categories: ['health', 'leave', 'health'], industry: '  제조  ', size: 'small',
      hasBenefitsOnly: true, sort: 'name_asc',
    })).toBe('?q=%EA%B0%80%EB%82%98%EB%8B%A4&category=leave&category=health&industry=%EC%A0%9C%EC%A1%B0&size=small&hasBenefitsOnly=1')
    expect(serializeBenefitDirectoryQuery(DEFAULT_BENEFIT_DIRECTORY_QUERY)).toBe('')
  })

  it('bounds query by server code-point and UTF-8 byte limits without splitting characters', () => {
    const parsed = parseBenefitDirectoryQuery(`?q=${encodeURIComponent('가'.repeat(200))}`)
    expect(Array.from(parsed.q)).toHaveLength(200)
    expect(new TextEncoder().encode(parsed.q)).toHaveLength(600)
    expect(parseBenefitDirectoryQuery(`?q=${encodeURIComponent('😀'.repeat(201))}`).q).toBe('')
  })

  it('intentionally drops unknown parameters and never persists a cursor', () => {
    const parsed = parseBenefitDirectoryQuery('?q=test&utm_source=x&cursor=private')
    expect(serializeBenefitDirectoryQuery(parsed)).toBe('?q=test')
  })
})
