/// <reference types="node" />

import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
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

  it('traces correction request routes through dynamic imports and two re-export hops', () => {
    withFixture({
      'community-app/src/App.tsx': [
        "import { lazy } from 'react'",
        "const RoutedPage = lazy(() => import('./pages/EntryPage').then(module => ({ default: module.EntryPage })))",
        "export function App({ pathname }: { pathname: string }) {",
        "  if (pathname === '/community/benefits/correction/requests') return <RoutedPage />",
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
