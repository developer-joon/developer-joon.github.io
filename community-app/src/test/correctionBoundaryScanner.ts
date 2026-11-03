/// <reference types="node" />

import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import type { Dirent } from 'node:fs'
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
  applySourceExclusions: boolean
}

const comparePaths = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0

const scanRoots: readonly ScanRoot[] = [
  {
    path: '.github/ISSUE_TEMPLATE',
    extensions: null,
    applySourceExclusions: false,
  },
  {
    path: 'community-app/src',
    extensions: new Set(['.css', '.html', '.js', '.jsx', '.json', '.md', '.mjs', '.scss', '.ts', '.tsx']),
    applySourceExclusions: true,
  },
  {
    path: 'community-app/benefits',
    extensions: new Set(['.html']),
    applySourceExclusions: false,
  },
]

const excludedSourceDirectories = new Set([
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

const issueCreationUrl = forbiddenContent[0]
const correctionContext = /\bcorrection\b|benefit[_\s-]*correction|correction[_\s-]*benefit|\/community\/benefits\/(?:my-)?correction|benefit_correction|BenefitCorrection|정보\s*수정|수정\s*요청|정정/i

function repositoryPath(repositoryRoot: string, absolutePath: string) {
  return relative(repositoryRoot, absolutePath).split(sep).join('/')
}

function shouldExclude(path: string, name: string) {
  const segments = path.split(sep)
  return segments.some((segment) => excludedSourceDirectories.has(segment))
    || segments.includes('test')
    || excludedSourceFiles.test(name)
}

function collectFiles(repositoryRoot: string, scanRoot: ScanRoot) {
  const root = resolve(repositoryRoot, scanRoot.path)
  const files: string[] = []
  const violations: CorrectionBoundaryViolation[] = []
  let rootStats
  try {
    rootStats = lstatSync(root)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { files, violations }
    violations.push({ file: scanRoot.path, rule: 'unreadable correction scan path' })
    return { files, violations }
  }
  const visit = (directory: string) => {
    let entries: Dirent[]
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      violations.push({ file: repositoryPath(repositoryRoot, directory), rule: 'unreadable correction scan path' })
      return
    }

    for (const entry of entries.sort((left, right) => comparePaths(left.name, right.name))) {
      const path = resolve(directory, entry.name)
      if (entry.isSymbolicLink()) {
        violations.push({ file: repositoryPath(repositoryRoot, path), rule: 'symlink in correction scan root' })
        continue
      }
      if (entry.isDirectory()) {
        if (!scanRoot.applySourceExclusions
          || (!excludedSourceDirectories.has(entry.name) && entry.name !== 'test')) visit(path)
        continue
      }
      if (!entry.isFile() || (scanRoot.extensions && !scanRoot.extensions.has(extname(entry.name).toLowerCase()))) continue
      if (!scanRoot.applySourceExclusions || !shouldExclude(relative(root, path), entry.name)) {
        files.push(repositoryPath(repositoryRoot, path))
      }
    }
  }

  if (rootStats.isSymbolicLink()) {
    violations.push({ file: scanRoot.path, rule: 'symlink in correction scan root' })
  } else {
    visit(root)
  }
  return { files, violations }
}

export function scanCorrectionBoundary(repositoryRoot: string): CorrectionBoundaryScan {
  const collected = scanRoots.map((scanRoot) => collectFiles(repositoryRoot, scanRoot))
  const scannedFiles = collected
    .flatMap(({ files }) => files)
    .sort(comparePaths)
  const violations = collected.flatMap((result) => result.violations)

  for (const file of scannedFiles) {
    if (/^\.github\/ISSUE_TEMPLATE\/.*company[-_]benefits[-_]correction/i.test(file)) {
      violations.push({ file, rule: 'obsolete correction issue template filename' })
    }

    const absolutePath = resolve(repositoryRoot, file)
    let content: Buffer
    try {
      content = readFileSync(absolutePath)
    } catch {
      violations.push({ file, rule: 'unreadable configured text file' })
      continue
    }
    if (content.includes(0)) {
      violations.push({ file, rule: 'NUL byte in configured text file' })
      continue
    }
    const source = content.toString('utf8')

    const isCorrectionContext = file.startsWith('.github/ISSUE_TEMPLATE/')
      || file.startsWith('community-app/benefits/')
      || /correction/i.test(file)
      || correctionContext.test(source)
    const applicableRules = isCorrectionContext
      ? forbiddenContent
      : forbiddenContent.filter((rule) => rule !== issueCreationUrl)
    for (const forbidden of applicableRules) {
      if (forbidden.pattern.test(source)) violations.push({ file, rule: forbidden.rule })
    }
  }

  violations.sort((left, right) => comparePaths(left.file, right.file) || comparePaths(left.rule, right.rule))
  return { scannedFiles, violations }
}
