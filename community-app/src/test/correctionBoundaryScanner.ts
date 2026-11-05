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
  '/community/benefits/my-corrections',
  '/community/benefits/my-corrections/',
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
  const bindings = new Map<string, { specifier: string; namespace: boolean }>()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)
      || !statement.importClause
      || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue
    const specifier = statement.moduleSpecifier.text
    const clause = statement.importClause
    if (clause.name) bindings.set(clause.name.text, { specifier, namespace: false })
    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        bindings.set(clause.namedBindings.name.text, { specifier, namespace: true })
      } else {
        for (const element of clause.namedBindings.elements) {
          bindings.set(element.name.text, { specifier, namespace: false })
        }
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
      if (specifier) bindings.set(node.name.text, { specifier, namespace: false })
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return bindings
}

function correctionRouteComponents(sourceFile: ts.SourceFile) {
  const components = new Map<string, { binding: string; member?: string }>()
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
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      if (ts.isIdentifier(node.tagName)) {
        components.set(node.tagName.text, { binding: node.tagName.text })
      } else if (ts.isPropertyAccessExpression(node.tagName) && ts.isIdentifier(node.tagName.expression)) {
        const component = { binding: node.tagName.expression.text, member: node.tagName.name.text }
        components.set(`${component.binding}.${component.member}`, component)
      } else if (ts.isJsxNamespacedName(node.tagName)) {
        const component = { binding: node.tagName.namespace.text, member: node.tagName.name.text }
        components.set(`${component.binding}:${component.member}`, component)
      }
    }
    ts.forEachChild(node, collectComponents)
  }
  const visit = (node: ts.Node) => {
    if (ts.isIfStatement(node) && containsCorrectionPath(node.expression)) collectComponents(node.thenStatement)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return [...components.entries()].sort(([left], [right]) => comparePaths(left, right)).map(([, component]) => component)
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

function hasExportModifier(node: ts.Node) {
  return ts.canHaveModifiers(node)
    && Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
}

function directlyExports(sourceFile: ts.SourceFile, exportName: string) {
  for (const statement of sourceFile.statements) {
    if (exportName === 'default' && ts.isExportAssignment(statement)) return true
    if (!hasExportModifier(statement)) continue
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement))
      && statement.name?.text === exportName) return true
    if (ts.isVariableStatement(statement)
      && statement.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === exportName)) {
      return true
    }
  }
  return false
}

function resolveNamespaceExport(
  repositoryRoot: string,
  file: string,
  exportName: string,
  sourceFiles: ReadonlySet<string>,
  parsedModules: ReadonlyMap<string, ts.SourceFile>,
  visited = new Set<string>(),
): string[] {
  const key = `${file}\0${exportName}`
  if (visited.has(key)) return []
  visited.add(key)
  const sourceFile = parsedModules.get(file)
  if (!sourceFile) return []
  const resolved = new Set<string>()
  if (directlyExports(sourceFile, exportName)) resolved.add(file)

  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement)) continue
    if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (element.name.text !== exportName) continue
        if (!statement.moduleSpecifier || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
          if (directlyExports(sourceFile, element.propertyName?.text ?? element.name.text)) resolved.add(file)
          continue
        }
        const target = resolveLocalModule(repositoryRoot, file, statement.moduleSpecifier.text, sourceFiles)
        if (!target) continue
        for (const match of resolveNamespaceExport(
          repositoryRoot,
          target,
          element.propertyName?.text ?? element.name.text,
          sourceFiles,
          parsedModules,
          visited,
        )) resolved.add(match)
      }
    } else if (!statement.exportClause && statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      const target = resolveLocalModule(repositoryRoot, file, statement.moduleSpecifier.text, sourceFiles)
      if (!target) continue
      for (const match of resolveNamespaceExport(
        repositoryRoot,
        target,
        exportName,
        sourceFiles,
        parsedModules,
        visited,
      )) resolved.add(match)
    }
  }
  return [...resolved].sort(comparePaths)
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
    const components = correctionRouteComponents(sourceFile)
    if (components.length > 0) {
      const bindings = importedBindings(sourceFile)
      const routeBindings = components
        .map((component) => ({ component, imported: bindings.get(component.binding) }))
        .filter(({ imported }) => Boolean(imported && localImport.test(imported.specifier)))
      const candidates = new Set<string>()
      let unresolved = routeBindings.length === 0
      for (const { component, imported } of routeBindings) {
        const target = imported && resolveLocalModule(repositoryRoot, file, imported.specifier, sourceFiles)
        if (!target) {
          unresolved = true
        } else if (component.member) {
          const matches = imported.namespace
            ? resolveNamespaceExport(repositoryRoot, target, component.member, sourceFiles, parsedModules)
            : []
          if (matches.length === 0) unresolved = true
          for (const match of matches) candidates.add(match)
        } else {
          candidates.add(target)
        }
      }
      if (unresolved) {
        violations.push({ file, rule: 'unresolved correction route component' })
      }
      for (const candidate of candidates) roots.add(candidate)
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
