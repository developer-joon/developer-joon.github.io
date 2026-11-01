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
    for (const path of [
      'benefits/correction/index.html',
      'benefits/my-corrections/index.html',
    ]) {
      expect(source(path)).toContain('/src/main.tsx')
      expect(source(path)).not.toContain('/src/benefits-main.tsx')
    }
    expect(existsSync(`${process.cwd()}/benefits/rankings/index.html`)).toBe(false)
  })

  it('has no fixture tree and exposes the production non-fixture manifest', () => {
    expect(existsSync(`${process.cwd()}/public/data/company-benefits/fixture-v1`)).toBe(false)
    const manifest = JSON.parse(source('public/data/company-benefits/manifest.json'))
    expect(manifest.fixture).toBe(false)
    expect(manifest.data_version).toBe('company-benefits-2026-10-31-v1')
    expect(manifest.company_count).toBe(2000)
  })
})
