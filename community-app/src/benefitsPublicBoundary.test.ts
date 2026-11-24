import { existsSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalBenefitsEntryOnly } from '../vite.config'

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
  it('emits only the manifest-authoritative entry script in canonical production shells', async () => {
    const html = '<head><script type="module" crossorigin src="/community/assets/react-Ab12Cd34.js"></script><script type="module" crossorigin src="/community/assets/benefits-main-Xy12Za34.js"></script></head>'
    const transformed = await canonicalBenefitsEntryOnly.transformIndexHtml.handler.call({} as never, html, {
      path: '/benefits-root/index.html',
      filename: `${process.cwd()}/benefits-root/index.html`,
      bundle: {},
      chunk: {} as never,
      server: undefined,
      originalUrl: undefined,
    })
    expect(transformed).toContain('/community/assets/benefits-main-Xy12Za34.js')
    expect(transformed).not.toContain('/community/assets/react-Ab12Cd34.js')
    expect(transformed.match(/<script\b/g)).toHaveLength(1)
  })

  it('builds only the supported public shells', () => {
    for (const path of [
      'benefits-root/index.html',
      'benefits-root/company/index.html',
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
    const vite = source('vite.config.ts')
    expect(vite).toContain("benefitsRoot: page('./benefits-root/index.html')")
    expect(vite).toContain("benefitsRootCompany: page('./benefits-root/company/index.html')")
  })

  it('gives canonical shells exact production metadata and public entry only', () => {
    for (const [path, title, canonical] of [
      ['benefits-root/index.html', '기업 복지 검색 · Breadlab', 'https://breadlab.ai/benefits/'],
      ['benefits-root/company/index.html', '기업 복지 상세 · Breadlab', 'https://breadlab.ai/benefits/company/'],
    ]) {
      const html = source(path)
      expect(html.match(/<title>/g)).toHaveLength(1)
      expect(html).toContain(`<title>${title}</title>`)
      expect(html.match(/rel="canonical"/g)).toHaveLength(1)
      expect(html).toContain(`<link rel="canonical" href="${canonical}" />`)
      expect(html).toContain('<link rel="shortcut icon" href="/images/favicon.ico" />')
      expect(html).toContain('/src/benefits-main.tsx')
      expect(html).not.toContain('/src/main.tsx')
      expect(html).not.toMatch(/supabase|AuthProvider|admin|submission/i)
    }
  })

  it('keeps the public shell dependency graph free of the directory repository', () => {
    const entry = source('src/benefits-main.tsx')
    const shell = source('src/BenefitsApp.tsx')
    const app = source('src/App.tsx')
    const directoryPage = source('src/pages/BenefitsDirectoryPage.tsx')
    const companyPage = source('src/pages/BenefitDirectoryCompanyPage.tsx')
    const repository = source('src/data/benefitDirectoryRepository.ts')
    const graph = initialSourceGraph('src/benefits-main.tsx')

    expect(entry).not.toContain('AuthProvider')
    expect(shell).not.toMatch(/import\s+\{[^}]*getBenefitDirectoryRepository[^}]*\}\s+from/)
    expect(shell).not.toContain('getBenefitDirectoryRepository()')
    expect(app).not.toMatch(/import\s+\{[^}]*getBenefitDirectoryRepository[^}]*\}\s+from/)
    expect(app).not.toContain('getBenefitDirectoryRepository()')
    expect(shell).toContain("lazy(() => import('./pages/BenefitsDirectoryPage')")
    expect(shell).toContain("lazy(() => import('./pages/BenefitDirectoryCompanyPage')")
    expect(directoryPage).toContain('repository = getBenefitDirectoryRepository()')
    expect(companyPage).toContain('repository = getBenefitDirectoryRepository()')
    expect(repository).toContain("client.rpc('get_benefit_company_v2'")
    expect(repository).toContain('getAnonymousSupabaseClient()')
    expect(repository).not.toMatch(/getSupabaseClient|AuthProvider|benefitClaimRepository|benefitSubmissionRepository/)
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
