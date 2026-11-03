/// <reference types="node" />

import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { dirname, extname, relative, resolve, sep } from 'node:path'

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

const sourcePrefix = 'community-app/src/'
const moduleExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.css', '.scss'] as const
const localImport = /^(?:\.{1,2}\/|@\/)/

function importSpecifiers(source: string) {
  const specifiers = new Set<string>()
  const staticImport = /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]{0,2000}?\s+from\s*)?['"]([^'"]+)['"]/g
  const dynamicImport = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const pattern of [staticImport, dynamicImport]) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1])
  }
  return [...specifiers].sort(comparePaths)
}

function importedBindings(source: string) {
  const bindings = new Map<string, string>()
  const staticImport = /\bimport\s+(?:type\s+)?([^'";]{1,2000}?)\s+from\s+['"]([^'"]+)['"]/g
  for (const match of source.matchAll(staticImport)) {
    const clause = match[1].trim()
    const specifier = match[2]
    const defaultBinding = clause.match(/^([A-Za-z_$][\w$]*)\s*(?:,|$)/)?.[1]
    if (defaultBinding) bindings.set(defaultBinding, specifier)
    const namespaceBinding = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/)?.[1]
    if (namespaceBinding) bindings.set(namespaceBinding, specifier)
    const namedBindings = clause.match(/\{([^}]*)\}/)?.[1]
    if (namedBindings) {
      for (const entry of namedBindings.split(',')) {
        const names = entry.trim().replace(/^type\s+/, '').split(/\s+as\s+/)
        const localName = names.at(-1)?.trim()
        if (localName && /^[A-Za-z_$][\w$]*$/.test(localName)) bindings.set(localName, specifier)
      }
    }
  }

  const lazyImport = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*lazy\s*\([\s\S]{0,800}?\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const match of source.matchAll(lazyImport)) bindings.set(match[1], match[2])
  return bindings
}

function resolveLocalModule(repositoryRoot: string, importer: string, specifier: string, sourceFiles: ReadonlySet<string>) {
  if (!localImport.test(specifier)) return null
  const absoluteBase = specifier.startsWith('@/')
    ? resolve(repositoryRoot, sourcePrefix, specifier.slice(2))
    : resolve(repositoryRoot, dirname(importer), specifier)
  const base = repositoryPath(repositoryRoot, absoluteBase)
  if (!base.startsWith(sourcePrefix)) return undefined
  const candidates = extname(base)
    ? [base]
    : [base, ...moduleExtensions.map((extension) => `${base}${extension}`), ...moduleExtensions.map((extension) => `${base}/index${extension}`)]
  return candidates.find((candidate) => sourceFiles.has(candidate))
}

function correctionModuleClosure(
  repositoryRoot: string,
  sources: ReadonlyMap<string, string>,
  violations: CorrectionBoundaryViolation[],
) {
  const sourceFiles = new Set(sources.keys())
  const roots = new Set([...sourceFiles].filter((file) => /correction/i.test(file)))

  for (const [file, source] of sources) {
    const bindings = importedBindings(source)
    const routePattern = /\bif\s*\([^\n)]*(['"])\/community\/benefits\/correction(?:\/requests)?\/?\1[^\n)]*\)/g
    for (const route of source.matchAll(routePattern)) {
      const routeStart = (route.index ?? 0) + route[0].length
      const remaining = source.slice(routeStart)
      const nextRoute = remaining.search(/\n\s*if\s*\(/)
      const routeBlock = remaining.slice(0, nextRoute === -1 ? 2000 : Math.min(nextRoute, 2000))
      const componentNames = [...routeBlock.matchAll(/<([A-Z][\w$]*)\b/g)].map((match) => match[1])
      const specifiers = componentNames
        .map((component) => bindings.get(component))
        .filter((specifier): specifier is string => Boolean(specifier && localImport.test(specifier)))
      const candidates = specifiers.map((specifier) => resolveLocalModule(repositoryRoot, file, specifier, sourceFiles))
      if (specifiers.length === 0 || candidates.some((target) => !target)) {
        violations.push({ file, rule: 'unresolved correction route component' })
      }
      for (const candidate of candidates) if (candidate) roots.add(candidate)
    }
  }

  const closure = new Set<string>()
  const queue = [...roots].sort(comparePaths)
  while (queue.length > 0) {
    const file = queue.shift()!
    if (closure.has(file)) continue
    closure.add(file)
    for (const specifier of importSpecifiers(sources.get(file) ?? '')) {
      if (!localImport.test(specifier)) continue
      const target = resolveLocalModule(repositoryRoot, file, specifier, sourceFiles)
      if (!target) {
        violations.push({ file, rule: 'unresolved local import in correction module graph' })
      } else if (!closure.has(target)) {
        queue.push(target)
        queue.sort(comparePaths)
      }
    }
  }
  return closure
}

export function scanCorrectionBoundary(repositoryRoot: string): CorrectionBoundaryScan {
  const collected = scanRoots.map((scanRoot) => collectFiles(repositoryRoot, scanRoot))
  const scannedFiles = collected
    .flatMap(({ files }) => files)
    .sort(comparePaths)
  const violations = collected.flatMap((result) => result.violations)
  const sources = new Map<string, string>()

  for (const file of scannedFiles) {
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
    sources.set(file, content.toString('utf8'))
  }
  const correctionModules = correctionModuleClosure(repositoryRoot, sources, violations)

  for (const file of scannedFiles) {
    if (/^\.github\/ISSUE_TEMPLATE\/.*company[-_]benefits[-_]correction/i.test(file)) {
      violations.push({ file, rule: 'obsolete correction issue template filename' })
    }

    const source = sources.get(file)
    if (source === undefined) continue

    const isCorrectionContext = file.startsWith('.github/ISSUE_TEMPLATE/')
      || file.startsWith('community-app/benefits/')
      || correctionModules.has(file)
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
