import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(`${process.cwd()}/${path}`, 'utf8')

describe('public benefits entry boundary', () => {
  it('builds only the supported public shells', () => {
    for (const path of [
      'benefits/index.html',
      'benefits/fit/index.html',
      'benefits/company/index.html',
      'benefits/methodology/index.html',
    ]) expect(source(path)).toContain('/src/benefits-main.tsx')
    expect(existsSync(`${process.cwd()}/benefits/rankings/index.html`)).toBe(false)
  })

  it('has no production fixture artifact tree or fixture manifest', () => {
    expect(existsSync(`${process.cwd()}/public/data/company-benefits/fixture-v1`)).toBe(false)
    expect(existsSync(`${process.cwd()}/public/data/company-benefits/manifest.json`)).toBe(false)
  })
})
