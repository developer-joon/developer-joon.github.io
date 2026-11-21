import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(`${process.cwd()}/${path}`, 'utf8')

function initialSourceGraph(entry: string) {
  const root = process.cwd()
  const pending = [resolve(root, entry)]
  const visited = new Set<string>()
  const external = new Set<string>()
  while (pending.length > 0) {
    const file = pending.pop()!
    if (visited.has(file)) continue
    visited.add(file)
    const contents = readFileSync(file, 'utf8')
    for (const match of contents.matchAll(/^\s*import\s+(?!type\b)(?:[^'";]+\s+from\s+)?['"]([^'"]+)['"]/gm)) {
      const specifier = match[1]
      if (!specifier.startsWith('.')) {
        external.add(specifier)
        continue
      }
      const candidate = resolve(dirname(file), specifier)
      const dependency = [candidate, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}.css`, resolve(candidate, 'index.ts'), resolve(candidate, 'index.tsx')]
        .find(path => existsSync(path))
      if (dependency) pending.push(dependency)
    }
  }
  return {
    files: [...visited].map(path => relative(root, path)),
    external: [...external],
  }
}

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

  it('keeps the public shell dependency graph free of the directory repository', () => {
    const entry = source('src/benefits-main.tsx')
    const shell = source('src/BenefitsApp.tsx')
    const app = source('src/App.tsx')
    const directoryPage = source('src/pages/BenefitsDirectoryPage.tsx')
    const graph = initialSourceGraph('src/benefits-main.tsx')

    expect(entry).not.toContain('AuthProvider')
    expect(shell).not.toMatch(/import\s+\{[^}]*getBenefitDirectoryRepository[^}]*\}\s+from/)
    expect(shell).not.toContain('getBenefitDirectoryRepository()')
    expect(app).not.toMatch(/import\s+\{[^}]*getBenefitDirectoryRepository[^}]*\}\s+from/)
    expect(app).not.toContain('getBenefitDirectoryRepository()')
    expect(shell).toContain("lazy(() => import('./pages/BenefitsDirectoryPage')")
    expect(directoryPage).toContain('repository = getBenefitDirectoryRepository()')
    expect(graph.files).not.toContain('src/pages/BenefitsDirectoryPage.tsx')
    expect(graph.files.some(path => /benefitDirectoryRepository|schemas|uuid/i.test(path))).toBe(false)
    expect(graph.external.some(specifier => /supabase|uuid/i.test(specifier))).toBe(false)
  })

  it('has no fixture tree and exposes the production non-fixture manifest', () => {
    expect(existsSync(`${process.cwd()}/public/data/company-benefits/fixture-v1`)).toBe(false)
    const manifest = JSON.parse(source('public/data/company-benefits/manifest.json'))
    expect(manifest.fixture).toBe(false)
    expect(manifest.data_version).toBe('company-benefits-2026-10-31-v1')
    expect(manifest.company_count).toBe(2000)
  })
})
