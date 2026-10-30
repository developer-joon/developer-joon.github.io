import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(`${process.cwd()}/${path}`, 'utf8')

describe('public benefits entry boundary', () => {
  it('uses an auth-independent entry for every benefits shell', () => {
    for (const path of [
      'benefits/index.html',
      'benefits/rankings/index.html',
      'benefits/fit/index.html',
      'benefits/company/index.html',
      'benefits/methodology/index.html',
    ]) {
      expect(source(path)).toContain('/src/benefits-main.tsx')
      expect(source(path)).not.toContain('/src/main.tsx')
    }
  })

  it('keeps auth and CommunityActions outside the public application path', () => {
    expect(source('src/application.tsx')).not.toMatch(
      /^import .*AuthProvider.*from/m,
    )
    expect(source('src/components/benefits/BenefitsExplorerShell.tsx')).not.toContain(
      'CommunityActions',
    )
  })
})