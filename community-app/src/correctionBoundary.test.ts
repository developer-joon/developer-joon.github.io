/// <reference types="node" />

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { scanCorrectionBoundary } from './test/correctionBoundaryScanner'

function withFixture(files: Record<string, string | Buffer>, assertion: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'correction-boundary-'))
  try {
    for (const [file, content] of Object.entries(files)) {
      const destination = resolve(root, file)
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, content)
    }
    assertion(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const repositoryRoot = resolve(process.cwd(), '..')

function stringSetInitializer(source: string, variableName: string) {
  const sourceFile = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)
        || declaration.name.text !== variableName
        || !declaration.initializer
        || !ts.isNewExpression(declaration.initializer)
        || declaration.initializer.arguments?.length !== 1
        || !ts.isArrayLiteralExpression(declaration.initializer.arguments[0])) continue
      return declaration.initializer.arguments[0].elements
        .filter(ts.isStringLiteralLike)
        .map((literal) => literal.text)
    }
  }
  throw new Error(`Missing string Set initializer: ${variableName}`)
}

function correctionRouteLiterals(source: string) {
  const sourceFile = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const routes = new Set<string>()
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node) && /^\/community\/benefits\/[^/]*correction/.test(node.text)) {
      routes.add(node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return [...routes].sort()
}

describe('Benefit Atlas correction workflow boundary', () => {
  it('finds a prohibited live issue template even when its filename looks like a test', () => {
    withFixture({
      '.github/ISSUE_TEMPLATE/company-benefits-correction.test.yml': 'name: Benefit correction\nbody: Open a GitHub issue\n',
    }, (root) => {
      const result = scanCorrectionBoundary(root)

      expect(result.scannedFiles).toContain('.github/ISSUE_TEMPLATE/company-benefits-correction.test.yml')
      expect(result.violations).toEqual(expect.arrayContaining([
        expect.objectContaining({ file: '.github/ISSUE_TEMPLATE/company-benefits-correction.test.yml' }),
      ]))
    })
  })

  it('scans snapshot-like issue-template paths and test-like static benefit paths', () => {
    withFixture({
      '.github/ISSUE_TEMPLATE/__snapshots__/benefit-correction.spec.yml': 'body: Submit this correction with the GitHub issue template.\n',
      '.github/ISSUE_TEMPLATE/feedback.yml': 'body: Continue at https://github.com/example/project/issues/new?template=feedback.yml\n',
      'community-app/benefits/test/correction.test.html': '<a href="/issues/new">Correct this benefit</a>\n',
    }, (root) => {
      const result = scanCorrectionBoundary(root)

      expect(result.scannedFiles).toEqual([
        '.github/ISSUE_TEMPLATE/__snapshots__/benefit-correction.spec.yml',
        '.github/ISSUE_TEMPLATE/feedback.yml',
        'community-app/benefits/test/correction.test.html',
      ])
      expect(result.violations).toEqual(expect.arrayContaining([
        {
          file: '.github/ISSUE_TEMPLATE/__snapshots__/benefit-correction.spec.yml',
          rule: 'GitHub correction issue/template wording',
        },
        {
          file: '.github/ISSUE_TEMPLATE/feedback.yml',
          rule: 'GitHub issue creation URL',
        },
        {
          file: 'community-app/benefits/test/correction.test.html',
          rule: 'GitHub issue creation URL',
        },
      ]))
    })
  })

  it('recursively finds issue creation URLs in correction source files', () => {
    withFixture({
      'community-app/src/pages/MyBenefitCorrectionsPage.tsx': 'export const correctionLink = "/issues/new?template=benefit.yml"\n',
    }, (root) => {
      const result = scanCorrectionBoundary(root)

      expect(result.scannedFiles).toContain('community-app/src/pages/MyBenefitCorrectionsPage.tsx')
      expect(result.violations).toContainEqual({
        file: 'community-app/src/pages/MyBenefitCorrectionsPage.tsx',
        rule: 'GitHub issue creation URL',
      })
    })
  })

  it('fails closed when configured text contains a leading NUL byte', () => {
    withFixture({
      'community-app/benefits/correction/index.html': Buffer.from('\0<a href="/issues/new">Correct this benefit</a>\n'),
    }, (root) => {
      expect(scanCorrectionBoundary(root).violations).toContainEqual({
        file: 'community-app/benefits/correction/index.html',
        rule: 'NUL byte in configured text file',
      })
    })
  })

  it('rejects symlinks under every live correction scan root', () => {
    const root = mkdtempSync(join(tmpdir(), 'correction-boundary-'))
    try {
      const target = resolve(root, 'target.txt')
      writeFileSync(target, '<a href="/issues/new">Correct this benefit</a>\n')
      const links = [
        '.github/ISSUE_TEMPLATE/benefit-correction.yml',
        'community-app/benefits/correction/index.html',
        'community-app/src/pages/BenefitCorrectionPage.tsx',
      ]
      for (const link of links) {
        const destination = resolve(root, link)
        mkdirSync(dirname(destination), { recursive: true })
        symlinkSync(target, destination)
      }

      const result = scanCorrectionBoundary(root)

      expect(result.violations.filter(({ rule }) => rule === 'symlink in correction scan root')).toEqual(
        links.map((file) => ({ file, rule: 'symlink in correction scan root' })),
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('allows an unrelated bug report page to create GitHub issues', () => {
    withFixture({
      'community-app/src/pages/BugReportPage.tsx': 'export const reportUrl = "https://github.com/example/project/issues/new?template=bug.yml"\n',
    }, (root) => {
      expect(scanCorrectionBoundary(root).violations).toEqual([])
    })
  })

  it('rejects issue creation after a correction page is renamed', () => {
    withFixture({
      'community-app/src/pages/FeedbackPage.tsx': [
        'export const returnTo = "/community/benefits/correction/"',
        'export const submitUrl = "https://github.com/example/project/issues/new?template=feedback.yml"',
      ].join('\n'),
    }, (root) => {
      expect(scanCorrectionBoundary(root).violations).toContainEqual({
        file: 'community-app/src/pages/FeedbackPage.tsx',
        rule: 'GitHub issue creation URL',
      })
    })
  })

  it('traces the renamed correction route component without classifying unrelated app imports', () => {
    withFixture({
      'community-app/src/App.tsx': [
        "import { EntryPage as RoutedPage } from './pages/EntryPage'",
        "import { BugReportPage } from './pages/BugReportPage'",
        "export function App({ pathname }: { pathname: string }) {",
        "  if (pathname === '/community/benefits/correction') return <RoutedPage />",
        "  if (pathname === '/community/bug-report') return <BugReportPage />",
        '  return null',
        '}',
      ].join('\n'),
      'community-app/src/pages/EntryPage.tsx': [
        "import { NeutralAction } from '../components/NeutralAction'",
        'export function EntryPage() { return <NeutralAction /> }',
      ].join('\n'),
      'community-app/src/components/NeutralAction.tsx': 'export const NeutralAction = () => <a href="https://github.com/example/project/issues/new">Send feedback</a>\n',
      'community-app/src/pages/BugReportPage.tsx': 'export const BugReportPage = () => <a href="https://github.com/example/project/issues/new?template=bug.yml">Report bug</a>\n',
    }, (root) => {
      const violations = scanCorrectionBoundary(root).violations

      expect(violations).toContainEqual({
        file: 'community-app/src/components/NeutralAction.tsx',
        rule: 'GitHub issue creation URL',
      })
      expect(violations).not.toContainEqual(expect.objectContaining({
        file: 'community-app/src/pages/BugReportPage.tsx',
      }))
    })
  })

  it('traces an exact multiline correction route through an alias, directory index, and two re-export hops', () => {
    withFixture({
      'community-app/src/App.tsx': [
        "import { EntryPage as RoutedPage } from '@/routes/entry'",
        "export function App({ pathname }: { pathname: string }) {",
        '  if (',
        "   pathname === '/community/benefits/correction'",
        '  ) { return <RoutedPage /> }',
        '  return null',
        '}',
      ].join('\n'),
      'community-app/src/routes/entry/index.ts': "export { RoutedPage as EntryPage } from './firstHop'\n",
      'community-app/src/routes/entry/firstHop.ts': "export { NeutralPanel as RoutedPage } from './secondHop'\n",
      'community-app/src/routes/entry/secondHop.tsx': 'export const NeutralPanel = () => <a href="/issues/new">Continue</a>\n',
    }, (root) => {
      expect(scanCorrectionBoundary(root).violations).toContainEqual({
        file: 'community-app/src/routes/entry/secondHop.tsx',
        rule: 'GitHub issue creation URL',
      })
    })
  })

  it('traces a namespace JSX correction route through a directory index and namespace re-export', () => {
    withFixture({
      'community-app/src/App.tsx': [
        "import * as Pages from '@/routes/entry'",
        "export function App({ pathname }: { pathname: string }) {",
        "  if (pathname === '/community/benefits/correction') return <Pages.EntryPage />",
        '  return null',
        '}',
      ].join('\n'),
      'community-app/src/routes/entry/index.ts': "export * from './EntryPage'\n",
      'community-app/src/routes/entry/EntryPage.tsx': [
        "import { NeutralAction } from '../components/NeutralAction'",
        'export function EntryPage() { return <NeutralAction /> }',
      ].join('\n'),
      'community-app/src/routes/components/NeutralAction.tsx': 'export const NeutralAction = () => <a href="/issues/new">Continue</a>\n',
    }, (root) => {
      expect(scanCorrectionBoundary(root).violations).toContainEqual({
        file: 'community-app/src/routes/components/NeutralAction.tsx',
        rule: 'GitHub issue creation URL',
      })
    })
  })

  it('maps the exact my-corrections route to a neutrally named rendered component only', () => {
    withFixture({
      'community-app/src/App.tsx': [
        "import { RequestsPage as RoutedPage } from './pages/RequestsPage'",
        "import { BugReportPage } from './pages/BugReportPage'",
        "export function App({ pathname }: { pathname: string }) {",
        '  if (',
        "   pathname === '/community/benefits/my-corrections'",
        '  ) { return <RoutedPage /> }',
        "  if (pathname === '/community/bug-report') return <BugReportPage />",
        '  return null',
        '}',
      ].join('\n'),
      'community-app/src/pages/RequestsPage.tsx': 'export const RequestsPage = () => <a href="/issues/new">Continue</a>\n',
      'community-app/src/pages/BugReportPage.tsx': 'export const BugReportPage = () => <a href="/issues/new">Report bug</a>\n',
    }, (root) => {
      const violations = scanCorrectionBoundary(root).violations
      expect(violations).toContainEqual({
        file: 'community-app/src/pages/RequestsPage.tsx',
        rule: 'GitHub issue creation URL',
      })
      expect(violations).not.toContainEqual(expect.objectContaining({
        file: 'community-app/src/pages/BugReportPage.tsx',
      }))
    })
  })

  it('keeps protected correction routes aligned with the actual App route literals', () => {
    const appSource = readFileSync(resolve(repositoryRoot, 'community-app/src/App.tsx'), 'utf8')
    const scannerSource = readFileSync(resolve(repositoryRoot, 'community-app/src/test/correctionBoundaryScanner.ts'), 'utf8')
    const appRoutes = correctionRouteLiterals(appSource)
    const protectedRoutes = stringSetInitializer(scannerSource, 'correctionRoutePaths').sort()

    expect(protectedRoutes).toEqual(appRoutes.flatMap((route) => [route, `${route}/`]).sort())
  })

  it('ignores import-shaped comments and strings while following real module literals', () => {
    withFixture({
      'community-app/src/pages/BenefitCorrectionPage.tsx': [
        "// import './MissingComment'",
        "const example = \"export { Example } from './MissingString'\"",
        "import './StaticDependency'",
        "export { ReExported } from './ReExportDependency'",
        "void import('./DynamicDependency')",
        'export const BenefitCorrectionPage = () => example',
      ].join('\n'),
      'community-app/src/pages/StaticDependency.ts': 'export const url = "/issues/new?source=static"\n',
      'community-app/src/pages/ReExportDependency.ts': 'export const url = "/issues/new?source=re-export"\n',
      'community-app/src/pages/DynamicDependency.ts': 'export const url = "/issues/new?source=dynamic"\n',
    }, (root) => {
      const violations = scanCorrectionBoundary(root).violations
      for (const file of [
        'community-app/src/pages/StaticDependency.ts',
        'community-app/src/pages/ReExportDependency.ts',
        'community-app/src/pages/DynamicDependency.ts',
      ]) {
        expect(violations).toContainEqual({ file, rule: 'GitHub issue creation URL' })
      }
      expect(violations).not.toContainEqual(expect.objectContaining({
        rule: 'unresolved local import in correction module graph',
      }))
    })
  })

  it('traces my-corrections routes through dynamic imports and two re-export hops', () => {
    withFixture({
      'community-app/src/App.tsx': [
        "import { lazy } from 'react'",
        "const RoutedPage = lazy(() => import('./pages/EntryPage').then(module => ({ default: module.EntryPage })))",
        "export function App({ pathname }: { pathname: string }) {",
        "  if (pathname === '/community/benefits/my-corrections') return <RoutedPage />",
        '  return null',
        '}',
      ].join('\n'),
      'community-app/src/pages/EntryPage.tsx': "export { RoutedPanel as EntryPage } from '../features/entry'\n",
      'community-app/src/features/entry/index.ts': "export { NeutralPanel as RoutedPanel } from './NeutralPanel'\n",
      'community-app/src/features/entry/NeutralPanel.tsx': 'export const NeutralPanel = () => <a href="/issues/new">Continue</a>\n',
    }, (root) => {
      expect(scanCorrectionBoundary(root).violations).toContainEqual({
        file: 'community-app/src/features/entry/NeutralPanel.tsx',
        rule: 'GitHub issue creation URL',
      })
    })
  })

  it('fails closed deterministically when a correction source module cannot be parsed', () => {
    withFixture({
      'community-app/src/pages/BenefitCorrectionPage.tsx': [
        "import { Panel } from './Panel'",
        'export const BenefitCorrectionPage = () => <Panel>',
      ].join('\n'),
      'community-app/src/pages/Panel.tsx': 'export const Panel = () => null\n',
    }, (root) => {
      expect(scanCorrectionBoundary(root).violations).toContainEqual({
        file: 'community-app/src/pages/BenefitCorrectionPage.tsx',
        rule: 'unparseable correction source module',
      })
    })
  })

  it('fails closed when a local import in the correction closure cannot be resolved', () => {
    withFixture({
      'community-app/src/App.tsx': [
        "import { EntryPage } from './pages/EntryPage'",
        "export function App({ pathname }: { pathname: string }) {",
        "  if (pathname === '/community/benefits/correction') return <EntryPage />",
        '  return null',
        '}',
      ].join('\n'),
      'community-app/src/pages/EntryPage.tsx': [
        "import { MissingPanel } from '../components/MissingPanel'",
        "import { useState } from 'react'",
        'export function EntryPage() { useState(false); return <MissingPanel /> }',
      ].join('\n'),
    }, (root) => {
      expect(scanCorrectionBoundary(root).violations).toContainEqual({
        file: 'community-app/src/pages/EntryPage.tsx',
        rule: 'unresolved local import in correction module graph',
      })
    })
  })

  it('terminates cycles while tracing the correction module graph', () => {
    withFixture({
      'community-app/src/pages/BenefitCorrectionPage.tsx': "import './CycleA'\n",
      'community-app/src/pages/CycleA.ts': "import './CycleB'\n",
      'community-app/src/pages/CycleB.ts': [
        "import './CycleA'",
        'export const url = "/issues/new?source=cycle"',
      ].join('\n'),
    }, (root) => {
      expect(scanCorrectionBoundary(root).violations).toContainEqual({
        file: 'community-app/src/pages/CycleB.ts',
        rule: 'GitHub issue creation URL',
      })
    })
  })

  it('does not resolve a correction import outside the source root', () => {
    withFixture({
      'community-app/src/pages/BenefitCorrectionPage.tsx': "import '../../../outside'\n",
      'outside.ts': 'export const url = "/issues/new?source=outside"\n',
    }, (root) => {
      const result = scanCorrectionBoundary(root)
      expect(result.violations).toContainEqual({
        file: 'community-app/src/pages/BenefitCorrectionPage.tsx',
        rule: 'unresolved local import in correction module graph',
      })
      expect(result.scannedFiles).not.toContain('outside.ts')
    })
  })

  it('fails closed when a correction route component cannot be resolved', () => {
    withFixture({
      'community-app/src/App.tsx': [
        "export function App({ pathname }: { pathname: string }) {",
        "  if (pathname === '/community/benefits/correction') return <MissingPage />",
        '  return null',
        '}',
      ].join('\n'),
    }, (root) => {
      expect(scanCorrectionBoundary(root).violations).toContainEqual({
        file: 'community-app/src/App.tsx',
        rule: 'unresolved correction route component',
      })
    })
  })

  it('fails closed when a namespace JSX correction route member is not exported', () => {
    withFixture({
      'community-app/src/App.tsx': [
        "import * as Pages from './pages'",
        "export function App({ pathname }: { pathname: string }) {",
        "  if (pathname === '/community/benefits/my-corrections') return <Pages.MissingPage />",
        '  return null',
        '}',
      ].join('\n'),
      'community-app/src/pages/index.ts': "export { ExistingPage } from './ExistingPage'\n",
      'community-app/src/pages/ExistingPage.tsx': 'export const ExistingPage = () => null\n',
    }, (root) => {
      expect(scanCorrectionBoundary(root).violations).toContainEqual({
        file: 'community-app/src/App.tsx',
        rule: 'unresolved correction route component',
      })
    })
  })

  it.each([
    ['full GitHub issue URL', 'export const correction = "https://github.com/example/project/issues/new?template=benefit.yml"', 'GitHub issue creation URL'],
    ['correction issue wording', 'export const help = "Submit this correction with the GitHub issue template."', 'GitHub correction issue/template wording'],
    ['obsolete template identifier', 'export const template = "company_benefits_correction"', 'obsolete company benefits correction template identifier'],
  ])('rejects %s in recursively discovered source', (_label, source, rule) => {
    withFixture({
      'community-app/src/data/benefitCorrectionRepository.ts': `${source}\n`,
    }, (root) => {
      expect(scanCorrectionBoundary(root).violations).toContainEqual({
        file: 'community-app/src/data/benefitCorrectionRepository.ts',
        rule,
      })
    })
  })

  it('allows unrelated GitHub links and excludes source tests, dependencies, and generated output', () => {
    withFixture({
      'community-app/src/pages/About.tsx': 'export const source = "https://github.com/example/project"\n',
      'community-app/src/pages/About.test.tsx': 'const forbiddenExample = "/issues/new"\n',
      'community-app/src/generated/Legacy.ts': 'export const correction = "/issues/new"\n',
      'community-app/src/node_modules/package/index.js': 'export const correction = "/issues/new"\n',
      'community-app/coverage/report.html': '<a href="/issues/new">generated report</a>',
      'community-app/dist/index.html': '<a href="/issues/new">generated bundle</a>',
    }, (root) => {
      const result = scanCorrectionBoundary(root)

      expect(result.scannedFiles).toEqual([
        'community-app/src/pages/About.tsx',
      ])
      expect(result.violations).toEqual([])
    })
  })

  it('scans the repository correction surface deterministically and finds no legacy GitHub workflow', () => {
    const obsoleteTemplate = resolve(repositoryRoot, '.github/ISSUE_TEMPLATE/company-benefits-correction.yml')
    const result = scanCorrectionBoundary(repositoryRoot)

    expect(existsSync(obsoleteTemplate)).toBe(false)
    expect(result.scannedFiles).toEqual([...result.scannedFiles].sort())
    expect(result.scannedFiles).toEqual(expect.arrayContaining([
      'community-app/benefits/correction/index.html',
      'community-app/benefits/my-corrections/index.html',
      'community-app/src/data/benefitCorrectionRepository.ts',
      'community-app/src/lib/benefitCorrectionDraftStore.ts',
      'community-app/src/pages/BenefitCorrectionPage.tsx',
      'community-app/src/pages/MyBenefitCorrectionsPage.tsx',
      'community-app/src/types/benefitCorrections.ts',
    ]))
    const scannedSourceFiles = result.scannedFiles.filter((file) => file.startsWith('community-app/src/'))
    expect(scannedSourceFiles.some((file) => /(?:^|\/)(?:node_modules|dist|coverage|generated|__snapshots__)(?:\/|$)/.test(file))).toBe(false)
    expect(scannedSourceFiles.some((file) => /\.(?:spec|test)\.[^.]+$/i.test(file))).toBe(false)
    expect(result.violations).toEqual([])
  })
})
