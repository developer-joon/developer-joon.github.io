/// <reference types="node" />

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { extname, relative, resolve, sep } from 'node:path'

export type CorrectionBoundaryViolation = {
  file: string
  rule: string
}

export type CorrectionBoundaryScan = {
  scannedFiles: string[]
  violations: CorrectionBoundaryViolation[]
}

type ScanRoot = {
  path: string
  extensions: ReadonlySet<string> | null
}

const comparePaths = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0

const scanRoots: readonly ScanRoot[] = [
  {
    path: '.github/ISSUE_TEMPLATE',
    extensions: null,
  },
  {
    path: 'community-app/src',
    extensions: new Set(['.css', '.html', '.js', '.jsx', '.json', '.md', '.mjs', '.scss', '.ts', '.tsx']),
  },
  {
    path: 'community-app/benefits',
    extensions: new Set(['.html']),
  },
]

const excludedDirectories = new Set([
  '__snapshots__',
  'coverage',
  'dist',
  'generated',
  'node_modules',
])

const excludedSourceFiles = /(?:^|\.)+(?:spec|test)\.[^.]+$/i

const forbiddenContent: readonly { rule: string; pattern: RegExp }[] = [
  {
    rule: 'GitHub issue creation URL',
    pattern: /\bgithub\.com\/[^\s"'`<>]+\/issues\/new\b|(?:^|[\s"'`(=])\/issues\/new\b/im,
  },
  {
    rule: 'GitHub correction issue/template wording',
    pattern: /(?:correction|benefit\s+correction|정보\s*수정|수정\s*요청|정정)[^\n]{0,120}(?:github|깃허브)[^\n]{0,80}(?:issue|template|이슈|템플릿)|(?:github|깃허브)[^\n]{0,80}(?:issue|template|이슈|템플릿)[^\n]{0,120}(?:correction|benefit\s+correction|정보\s*수정|수정\s*요청|정정)/i,
  },
  {
    rule: 'obsolete company benefits correction template identifier',
    pattern: /company[-_]benefits[-_]correction(?:\.ya?ml)?/i,
  },
]

function repositoryPath(repositoryRoot: string, absolutePath: string) {
  return relative(repositoryRoot, absolutePath).split(sep).join('/')
}

function shouldExclude(path: string, name: string) {
  const segments = path.split(sep)
  return segments.some((segment) => excludedDirectories.has(segment))
    || segments.includes('test')
    || excludedSourceFiles.test(name)
}

function collectFiles(repositoryRoot: string, scanRoot: ScanRoot) {
  const root = resolve(repositoryRoot, scanRoot.path)
  if (!existsSync(root)) return []

  const files: string[] = []
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => comparePaths(left.name, right.name))) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name) && entry.name !== 'test') visit(path)
        continue
      }
      if (!entry.isFile() || (scanRoot.extensions && !scanRoot.extensions.has(extname(entry.name).toLowerCase()))) continue
      if (!shouldExclude(relative(root, path), entry.name)) files.push(repositoryPath(repositoryRoot, path))
    }
  }

  visit(root)
  return files
}

export function scanCorrectionBoundary(repositoryRoot: string): CorrectionBoundaryScan {
  const scannedFiles = scanRoots
    .flatMap((scanRoot) => collectFiles(repositoryRoot, scanRoot))
    .sort(comparePaths)
  const violations: CorrectionBoundaryViolation[] = []

  for (const file of scannedFiles) {
    if (/^\.github\/ISSUE_TEMPLATE\/.*company[-_]benefits[-_]correction/i.test(file)) {
      violations.push({ file, rule: 'obsolete correction issue template filename' })
    }

    const absolutePath = resolve(repositoryRoot, file)
    const content = readFileSync(absolutePath)
    if (content.includes(0)) continue
    const source = content.toString('utf8')

    for (const forbidden of forbiddenContent) {
      if (forbidden.pattern.test(source)) violations.push({ file, rule: forbidden.rule })
    }
  }

  return { scannedFiles, violations }
}
