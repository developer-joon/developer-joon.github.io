/// <reference types="node" />

import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

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
const parsedModuleExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs'])
const correctionRoutePaths = new Set([
  '/community/benefits/correction',
  '/community/benefits/correction/',
  '/community/benefits/correction/requests',
  '/community/benefits/correction/requests/',
])

function parseModule(file: string, source: string) {
  const extension = extname(file).toLowerCase()
  if (!parsedModuleExtensions.has(extension)) return undefined
  const scriptKind = extension === '.tsx'
    ? ts.ScriptKind.TSX
    : extension === '.jsx'
      ? ts.ScriptKind.JSX
      : extension === '.js' || extension === '.mjs'
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind)
}

function dynamicImportSpecifier(node: ts.Node) {
  if (!ts.isCallExpression(node)
    || node.expression.kind !== ts.SyntaxKind.ImportKeyword
    || node.arguments.length !== 1
    || !ts.isStringLiteralLike(node.arguments[0])) return undefined
  return node.arguments[0].text
}

function importSpecifiers(sourceFile: ts.SourceFile) {
  const specifiers = new Set<string>()
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      specifiers.add(node.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      specifiers.add(node.moduleSpecifier.text)
    } else {
      const dynamicSpecifier = dynamicImportSpecifier(node)
      if (dynamicSpecifier) specifiers.add(dynamicSpecifier)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return [...specifiers].sort(comparePaths)
}

function importedBindings(sourceFile: ts.SourceFile) {
  const bindings = new Map<string, string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)
      || !statement.importClause
      || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue
    const specifier = statement.moduleSpecifier.text
    const clause = statement.importClause
    if (clause.name) bindings.set(clause.name.text, specifier)
    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        bindings.set(clause.namedBindings.name.text, specifier)
      } else {
        for (const element of clause.namedBindings.elements) bindings.set(element.name.text, specifier)
      }
    }
  }

  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      let specifier: string | undefined
      const findDynamicImport = (candidate: ts.Node) => {
        specifier ??= dynamicImportSpecifier(candidate)
        if (!specifier) ts.forEachChild(candidate, findDynamicImport)
      }
      findDynamicImport(node.initializer)
      if (specifier) bindings.set(node.name.text, specifier)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return bindings
}

function correctionRouteComponents(sourceFile: ts.SourceFile) {
  const components = new Set<string>()
  const containsCorrectionPath = (node: ts.Node) => {
    let found = false
    const visit = (candidate: ts.Node) => {
      if (ts.isStringLiteralLike(candidate) && correctionRoutePaths.has(candidate.text)) found = true
      if (!found) ts.forEachChild(candidate, visit)
    }
    visit(node)
    return found
  }
  const collectComponents = (node: ts.Node) => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && ts.isIdentifier(node.tagName)) {
      components.add(node.tagName.text)
    }
    ts.forEachChild(node, collectComponents)
  }
  const visit = (node: ts.Node) => {
    if (ts.isIfStatement(node) && containsCorrectionPath(node.expression)) collectComponents(node.thenStatement)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return [...components].sort(comparePaths)
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
  const parsedModules = new Map<string, ts.SourceFile>()
  const parseFailures = new Set<string>()

  for (const [file, source] of sources) {
    const sourceFile = parseModule(file, source)
    if (!sourceFile) continue
    const parseDiagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics
    if (parseDiagnostics.length > 0) {
      parseFailures.add(file)
      if (/correction/i.test(file) || correctionContext.test(source)) {
        violations.push({ file, rule: 'unparseable correction source module' })
      }
    } else {
      parsedModules.set(file, sourceFile)
    }
  }

  for (const [file, sourceFile] of parsedModules) {
    const componentNames = correctionRouteComponents(sourceFile)
    if (componentNames.length > 0) {
      const bindings = importedBindings(sourceFile)
      const routeBindings = componentNames
        .map((component) => bindings.get(component))
        .filter((specifier): specifier is string => Boolean(specifier && localImport.test(specifier)))
      const specifiers = [...new Set(routeBindings)]
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
    if (parseFailures.has(file)) {
      if (!violations.some((violation) => violation.file === file && violation.rule === 'unparseable correction source module')) {
        violations.push({ file, rule: 'unparseable correction source module' })
      }
      continue
    }
    const sourceFile = parsedModules.get(file)
    if (!sourceFile) continue
    for (const specifier of importSpecifiers(sourceFile)) {
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
