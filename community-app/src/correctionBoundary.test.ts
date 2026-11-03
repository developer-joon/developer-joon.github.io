/// <reference types="node" />

import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
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
  it('finds a prohibited legacy issue template outside the former hand-picked files', () => {
    withFixture({
      '.github/ISSUE_TEMPLATE/company-benefits-correction.yml': 'name: Benefit correction\nbody: Open a GitHub issue\n',
      'community-app/src/pages/MyBenefitCorrectionsPage.tsx': 'export const page = "internal"\n',
    }, (root) => {
      const result = scanCorrectionBoundary(root)

      expect(result.violations).toEqual(expect.arrayContaining([
        expect.objectContaining({ file: '.github/ISSUE_TEMPLATE/company-benefits-correction.yml' }),
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

  it('allows unrelated GitHub links and excludes tests, dependencies, generated output, and binary files', () => {
    withFixture({
      'community-app/src/pages/About.tsx': 'export const source = "https://github.com/example/project"\n',
      'community-app/src/pages/About.test.tsx': 'const forbiddenExample = "/issues/new"\n',
      'community-app/src/generated/Legacy.ts': 'export const correction = "/issues/new"\n',
      'community-app/src/node_modules/package/index.js': 'export const correction = "/issues/new"\n',
      'community-app/src/pages/binary.ts': Buffer.from([0, 1, 2, 3]),
      'community-app/coverage/report.html': '<a href="/issues/new">generated report</a>',
      'community-app/dist/index.html': '<a href="/issues/new">generated bundle</a>',
    }, (root) => {
      const result = scanCorrectionBoundary(root)

      expect(result.scannedFiles).toEqual([
        'community-app/src/pages/About.tsx',
        'community-app/src/pages/binary.ts',
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
    expect(result.scannedFiles.some((file) => /(?:^|\/)(?:node_modules|dist|coverage|generated|__snapshots__)(?:\/|$)/.test(file))).toBe(false)
    expect(result.scannedFiles.some((file) => /\.(?:spec|test)\.[^.]+$/i.test(file))).toBe(false)
    expect(result.violations).toEqual([])
  })
})
