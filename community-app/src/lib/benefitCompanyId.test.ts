import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isBenefitCompanyId, parseBenefitCompanyId } from './benefitCompanyId'

const validIds = [
  ['KR-CRN-1101112948086', 'legacy_crn'],
  ['KR-BIZ-1234567890', 'legacy_biz'],
  [`KR-CAN-${'0123456789abcdef'.repeat(2)}`, 'canonical'],
] as const

describe('canonical benefit company IDs', () => {
  it.each(validIds)('parses %s without rewriting it', (value, kind) => {
    expect(parseBenefitCompanyId(value)).toEqual({ value, kind })
    expect(isBenefitCompanyId(value)).toBe(true)
  })

  it('decodes all 40,053 pinned seed IDs without rewriting them', () => {
    const rows = readFileSync(resolve(process.cwd(), '../supabase/fixtures/benefit-directory/companies.ndjson'), 'utf8')
      .trimEnd().split('\n').map(line => JSON.parse(line) as { company_id: string })
    expect(rows).toHaveLength(40_053)
    expect(rows.every(row => parseBenefitCompanyId(row.company_id)?.value === row.company_id)).toBe(true)
  })

  it.each([
    '',
    ' KR-BIZ-1234567890',
    'KR-BIZ-1234567890 ',
    'kr-biz-1234567890',
    'KR-BIZ-123456789',
    'KR-CRN-11011129480860',
    `KR-CAN-${'A'.repeat(32)}`,
    `KR-CAN-${'a'.repeat(31)}`,
    `KR-CAN-${'a'.repeat(33)}`,
    `KR-CAN-${'g'.repeat(32)}`,
    'US-CIK0001411342',
  ])('rejects malformed, case-variant, or padded input %j', value => {
    expect(parseBenefitCompanyId(value)).toBeNull()
    expect(isBenefitCompanyId(value)).toBe(false)
  })

  it('rejects non-string values without coercion', () => {
    expect(parseBenefitCompanyId(null)).toBeNull()
    expect(parseBenefitCompanyId(1234567890)).toBeNull()
  })
})
