import { expect, it } from 'vitest'
import { index } from '../test/benefitsFixture'
import { indexSchema } from '../types/benefits'
import { filterBenefitsCompanies, parseQuery } from './benefitsQueryState'
const companies = Array.from({ length: 2000 }, (_, i) => ({
  ...index.companies[i % 56],
  company_id: `example-${String(i + 1).padStart(3, '0')}`,
  display_name: `가상 검증기업 ${i + 1}`,
}))
it('supports 2000 strictly validated fictional index records', () => {
  expect(
    indexSchema.safeParse({ data_version: 'fixture-v1', companies }).success,
  ).toBe(true)
})
it('measures in-memory search and filters at the release capacity', () => {
  const state = parseQuery(
    '?q=가상 검증기업 1999',
    companies.map((c) => c.company_id),
  )
  const start = performance.now()
  const result = filterBenefitsCompanies(companies, state)
  const elapsed = performance.now() - start
  expect(result.map((c) => c.company_id)).toEqual(['example-1999'])
  console.info(
    `Benefits 2000-company search/filter: ${elapsed.toFixed(2)} ms; ${result.length} matching record.`,
  )
})
