#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { accessSync, constants, lstatSync, realpathSync, statSync } from 'node:fs'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MODES = new Set(['local', 'development', 'production-readiness'])
const SHA256 = /^[a-f0-9]{64}$/
const RUNNER_OUTPUT_LIMIT = 16 * 1024
const DATABASE_TEST_STEPS = new Set([
  'test-storage-upgrade',
  'test-public-listing-upgrade',
  'test-community-snapshot-upgrade',
  'test-public-attachment-integration',
  'test-database',
])
const HOSTED_LOCAL_ENV = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'DEVELOPMENT_SUPABASE_URL',
  'PRODUCTION_SUPABASE_URL',
  'DEVELOPMENT_PROJECT_FINGERPRINT',
  'PRODUCTION_PROJECT_FINGERPRINT',
]
const PRIVILEGED_ENV = new Set([
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_KEY',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_ACCESS_TOKEN',
])

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function canonicalProjectRef(value) {
  const match = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/i.exec(value ?? '')
  if (!match) throw new Error('Supabase project URL must be exactly https://<project-ref>.supabase.co')
  return match[1].toLowerCase()
}

export function projectFingerprint(url) {
  return createHash('sha256').update(canonicalProjectRef(url)).digest('hex')
}

function parseArgv(argv) {
  let mode = 'local'
  let evidencePath
  const seen = new Set()
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag !== '--mode' && flag !== '--evidence') throw new Error(`unsupported release option: ${flag}`)
    if (seen.has(flag)) throw new Error(`duplicate release option: ${flag}`)
    seen.add(flag)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`)
    index += 1
    if (flag === '--mode') mode = value
    else evidencePath = value
  }
  if (!MODES.has(mode)) throw new Error(`unsupported release mode: ${mode}`)
  if (!evidencePath) throw new Error('--evidence must select an output outside the repository')
  return { mode, evidencePath }
}

function requiredNodeVersion(packageJson) {
  const engine = packageJson?.engines?.node
  const match = /^\^(\d+\.\d+\.\d+)$/.exec(engine ?? '')
  if (!match) throw new Error('community-app/package.json must declare an exact pinned Node engine such as ^24.15.0')
  return match[1]
}

function rejectPrivilegedEnvironment(env) {
  for (const [name, value] of Object.entries(env)) {
    if (!value) continue
    if (PRIVILEGED_ENV.has(name) || (/SUPABASE/i.test(name) && /(?:SERVICE_ROLE|SECRET(?:_KEY)?)/i.test(name))) {
      throw new Error(`privileged Supabase credential environment variable is forbidden: ${name}`)
    }
    if (typeof value === 'string' && /(?:^|\W)sb_secret_[A-Za-z0-9_-]+/.test(value)) {
      throw new Error(`secret Supabase key is forbidden in environment variable: ${name}`)
    }
  }
}

function validateEvidencePath(evidencePath, context) {
  const { repoRoot, lstatSync, realpathSync } = context
  if (!path.isAbsolute(repoRoot)) throw new Error('context.repoRoot must be absolute')
  if (typeof lstatSync !== 'function' || typeof realpathSync !== 'function') {
    throw new Error('context must provide lstatSync and realpathSync')
  }

  const absoluteEvidence = path.resolve(evidencePath)
  let evidenceStat
  try {
    evidenceStat = lstatSync(absoluteEvidence)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  if (evidenceStat?.isSymbolicLink()) throw new Error('evidence output must not be a symlink')
  if (evidenceStat && !evidenceStat.isFile()) throw new Error('evidence output must be a regular file')

  const canonicalRepo = realpathSync(repoRoot)
  const parent = realpathSync(path.dirname(absoluteEvidence))
  const canonicalEvidence = evidenceStat ? realpathSync(absoluteEvidence) : path.join(parent, path.basename(absoluteEvidence))
  const relative = path.relative(canonicalRepo, canonicalEvidence)
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('evidence output must resolve outside the repository')
  }
  return canonicalEvidence
}

function validateInputEvidencePath(evidencePath, name, context) {
  if (!evidencePath) throw new Error(`missing production-readiness evidence: ${name} must point to an external evidence file`)
  const absoluteEvidence = path.resolve(evidencePath)
  let evidenceStat
  try {
    evidenceStat = context.lstatSync(absoluteEvidence)
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${name} evidence file must exist`)
    throw error
  }
  if (evidenceStat.isSymbolicLink()) throw new Error(`${name} evidence file must not be a symlink`)
  if (!evidenceStat.isFile()) throw new Error(`${name} evidence must be a regular file`)
  const canonicalRepo = context.realpathSync(context.repoRoot)
  const canonicalEvidence = context.realpathSync(absoluteEvidence)
  const relative = path.relative(canonicalRepo, canonicalEvidence)
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error(`${name} evidence must resolve outside the repository`)
  }
  return canonicalEvidence
}

function parseFingerprint(value, name) {
  if (!SHA256.test(value ?? '')) throw new Error(`${name} must be a lowercase SHA-256 fingerprint`)
  return value
}

function fingerprintInput(env, prefix) {
  const fingerprintName = `${prefix}_PROJECT_FINGERPRINT`
  const urlName = `${prefix}_SUPABASE_URL`
  const explicitFingerprint = env[fingerprintName]
    ? parseFingerprint(env[fingerprintName], fingerprintName)
    : undefined
  const urlFingerprint = env[urlName] ? projectFingerprint(env[urlName]) : undefined
  if (explicitFingerprint && urlFingerprint && explicitFingerprint !== urlFingerprint) {
    throw new Error(`${fingerprintName} must match ${urlName}`)
  }
  if (explicitFingerprint) return explicitFingerprint
  if (urlFingerprint) return urlFingerprint
  throw new Error(`${fingerprintName} is required`)
}

export function parseReleaseOptions(argv, env, context) {
  const { mode, evidencePath } = parseArgv(argv)
  rejectPrivilegedEnvironment(env)

  const required = requiredNodeVersion(context.packageJson)
  if (context.nodeVersion !== required) throw new Error(`release gate requires Node ${required} exactly; received ${context.nodeVersion}`)
  const evidence = validateEvidencePath(evidencePath, context)

  const options = { mode, evidencePath: evidence, requiredNodeVersion: required }
  if (mode === 'local') {
    const configured = HOSTED_LOCAL_ENV.find((name) => env[name])
    if (configured) throw new Error(`local mode rejects hosted Supabase configuration: ${configured}`)
  }

  if (mode === 'development') {
    if (!env.DEVELOPMENT_SUPABASE_URL) throw new Error('DEVELOPMENT_SUPABASE_URL is required in development mode')
    if (env.ALLOW_DEVELOPMENT_CLOUD_READS !== '1') throw new Error('development mode requires ALLOW_DEVELOPMENT_CLOUD_READS=1')
    const developmentFingerprint = projectFingerprint(env.DEVELOPMENT_SUPABASE_URL)
    const productionFingerprints = []
    if (env.PRODUCTION_SUPABASE_URL) productionFingerprints.push(projectFingerprint(env.PRODUCTION_SUPABASE_URL))
    if (env.PRODUCTION_PROJECT_FINGERPRINT) {
      productionFingerprints.push(parseFingerprint(env.PRODUCTION_PROJECT_FINGERPRINT, 'PRODUCTION_PROJECT_FINGERPRINT'))
    }
    if (productionFingerprints.includes(developmentFingerprint)) {
      throw new Error('development Supabase project must differ from production')
    }
    options.projectFingerprint = developmentFingerprint
  }

  if (mode === 'production-readiness') {
    if (env.ALLOW_PRODUCTION_READINESS !== '1') throw new Error('production readiness requires ALLOW_PRODUCTION_READINESS=1')
    const developmentFingerprint = fingerprintInput(env, 'DEVELOPMENT')
    const productionFingerprint = fingerprintInput(env, 'PRODUCTION')
    if (developmentFingerprint === productionFingerprint) {
      throw new Error('development and production project fingerprints must be distinct')
    }
    options.developmentProjectFingerprint = developmentFingerprint
    options.productionProjectFingerprint = productionFingerprint
    options.localE2eEvidencePath = validateInputEvidencePath(env.LOCAL_E2E_EVIDENCE_PATH, 'LOCAL_E2E_EVIDENCE_PATH', context)
    options.developmentCloudIntegrationEvidencePath = validateInputEvidencePath(
      env.DEVELOPMENT_CLOUD_INTEGRATION_EVIDENCE_PATH,
      'DEVELOPMENT_CLOUD_INTEGRATION_EVIDENCE_PATH',
      context,
    )
    options.productionBackupEvidencePath = validateInputEvidencePath(
      env.PRODUCTION_BACKUP_EVIDENCE_PATH,
      'PRODUCTION_BACKUP_EVIDENCE_PATH',
      context,
    )
  }

  return deepFreeze(options)
}

function step(name, command, args, environment = {}) {
  return { name, command, args, environment }
}

function localCoreSteps() {
  const siteA = '/tmp/breadlab-community-release-site-a'
  const siteB = '/tmp/breadlab-community-release-site-b'
  const manifest = '/tmp/breadlab-community-release-manifests'
  return [
    step('repository-preflight', 'git', ['status', '--porcelain']),
    step('start-local-supabase', 'npm', ['--prefix', 'community-app', 'run', 'db:start']),
    step('reset-local-database', 'npm', ['--prefix', 'community-app', 'run', 'db:reset']),
    step('test-storage-upgrade', 'npm', ['--prefix', 'community-app', 'run', 'db:test:storage-upgrade']),
    step('test-public-listing-upgrade', 'npm', ['--prefix', 'community-app', 'run', 'db:test:public-listing-upgrade']),
    step('test-community-snapshot-upgrade', 'npm', ['--prefix', 'community-app', 'run', 'db:test:community-snapshot-upgrade']),
    step('test-public-attachment-integration', 'npm', ['--prefix', 'community-app', 'run', 'db:test:public-attachment-integration']),
    step('test-database', 'npm', ['--prefix', 'community-app', 'run', 'db:test']),
    step('lint-database', 'npm', ['--prefix', 'community-app', 'run', 'db:lint']),
    step('test-node-scripts', 'node', ['--test', 'scripts/build-definition.test.mjs', 'scripts/community-snapshots.test.mjs', 'scripts/verify-site.test.mjs']),
    step('build-site-a', './scripts/build-site-docker.sh', [siteA]),
    step('build-site-b', './scripts/build-site-docker.sh', [siteB]),
    step('verify-site-a', 'node', ['scripts/verify-site.mjs', siteA]),
    step('verify-site-b', 'node', ['scripts/verify-site.mjs', siteB]),
    step('verify-site-reproducibility', './scripts/verify-site-reproducibility.sh', [siteA, siteB, manifest]),
  ]
}

export function buildReleasePlan(options) {
  let steps
  if (options.mode === 'local') {
    steps = [...localCoreSteps(), step('local-e2e', 'node', ['scripts/community-e2e-sentinel.mjs'])]
  } else if (options.mode === 'development') {
    steps = [
      ...localCoreSteps(),
      step('development-read-only-health', 'node', ['scripts/development-readonly-probe.mjs']),
      step('development-integration', 'node', ['scripts/development-integration-sentinel.mjs']),
    ]
  } else if (options.mode === 'production-readiness') {
    steps = [{ name: 'validate-production-readiness-evidence', kind: 'internal' }]
  } else {
    throw new Error(`unsupported release mode: ${options.mode}`)
  }
  return deepFreeze({ mode: options.mode, evidencePath: options.evidencePath, steps })
}

const EVIDENCE_KEYS = [
  'schemaVersion',
  'revision',
  'mode',
  'status',
  'startedAt',
  'finishedAt',
  'durationMs',
  'developmentProjectFingerprint',
  'productionProjectFingerprint',
  'artifactManifest',
  'databaseTests',
  'steps',
  'failure',
].sort()
const STEP_EVIDENCE_KEYS = ['name', 'status', 'startedAt', 'finishedAt', 'durationMs'].sort()
const FAILURE_EVIDENCE_KEYS = ['step', 'kind', 'message'].sort()
const ARTIFACT_MANIFEST_KEYS = ['sha256', 'fileCount'].sort()
const DATABASE_TESTS_KEYS = ['steps', 'total'].sort()
const DATABASE_TEST_KEYS = ['name', 'count'].sort()
const READINESS_COMMON_KEYS = ['schemaVersion', 'type', 'mode', 'status', 'revision', 'timestamp']
const LOCAL_READINESS_KEYS = [...READINESS_COMMON_KEYS].sort()
const HOSTED_READINESS_KEYS = [...READINESS_COMMON_KEYS, 'projectFingerprint'].sort()
const REVISION = /^[a-f0-9]{40}$/
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const READINESS_MAX_AGE_MS = 24 * 60 * 60 * 1000
const PROJECT_ID = 'developer-joon-community-design'
const ARTIFACT_PATHS = [
  '/tmp/breadlab-community-release-site-a',
  '/tmp/breadlab-community-release-site-b',
  '/tmp/breadlab-community-release-manifests',
]

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} evidence must be an object`)
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected)) {
    throw new Error(`${label} evidence must contain exact keys`)
  }
}

function validTime(value) {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) return false
  const milliseconds = Date.parse(value)
  return !Number.isNaN(milliseconds) && new Date(milliseconds).toISOString() === value
}

export function validateEvidence(evidence) {
  exactKeys(evidence, EVIDENCE_KEYS, 'release')
  if (evidence.schemaVersion !== 2) throw new Error('release evidence schemaVersion must be 2')
  if (!REVISION.test(evidence.revision)) throw new Error('release evidence revision must be a full lowercase Git revision')
  if (!MODES.has(evidence.mode)) throw new Error('release evidence mode is invalid')
  if (!['passed', 'failed'].includes(evidence.status)) throw new Error('release evidence status is invalid')
  if (!validTime(evidence.startedAt) || !validTime(evidence.finishedAt)) throw new Error('release evidence timestamps must be UTC ISO timestamps')
  if (!Number.isInteger(evidence.durationMs) || evidence.durationMs < 0) throw new Error('release evidence durationMs is invalid')
  if (evidence.developmentProjectFingerprint !== null && !SHA256.test(evidence.developmentProjectFingerprint)) {
    throw new Error('release evidence developmentProjectFingerprint is invalid')
  }
  if (evidence.productionProjectFingerprint !== null && !SHA256.test(evidence.productionProjectFingerprint)) {
    throw new Error('release evidence productionProjectFingerprint is invalid')
  }
  if (evidence.mode === 'local' && (evidence.developmentProjectFingerprint !== null || evidence.productionProjectFingerprint !== null)) {
    throw new Error('local release evidence must not contain hosted project fingerprints')
  }
  if (evidence.mode === 'development' && (evidence.developmentProjectFingerprint === null || evidence.productionProjectFingerprint !== null)) {
    throw new Error('development release evidence must contain only the development project fingerprint')
  }
  if (evidence.mode === 'production-readiness' && (
    evidence.developmentProjectFingerprint === null
    || evidence.productionProjectFingerprint === null
    || evidence.developmentProjectFingerprint === evidence.productionProjectFingerprint
  )) {
    throw new Error('production-readiness release evidence must contain distinct development and production project fingerprints')
  }
  if (evidence.artifactManifest !== null) {
    exactKeys(evidence.artifactManifest, ARTIFACT_MANIFEST_KEYS, 'artifact manifest')
    if (!SHA256.test(evidence.artifactManifest.sha256)
      || !Number.isSafeInteger(evidence.artifactManifest.fileCount)
      || evidence.artifactManifest.fileCount < 1) {
      throw new Error('release evidence artifactManifest is invalid')
    }
  }
  if (evidence.databaseTests !== null) {
    exactKeys(evidence.databaseTests, DATABASE_TESTS_KEYS, 'database tests')
    if (!Array.isArray(evidence.databaseTests.steps) || evidence.databaseTests.steps.length === 0) {
      throw new Error('release evidence databaseTests steps are invalid')
    }
    let total = 0
    for (const item of evidence.databaseTests.steps) {
      exactKeys(item, DATABASE_TEST_KEYS, 'database test')
      if (!DATABASE_TEST_STEPS.has(item.name) || !Number.isSafeInteger(item.count) || item.count < 0) {
        throw new Error('release evidence database test count is invalid')
      }
      total += item.count
      if (!Number.isSafeInteger(total)) throw new Error('release evidence database test total is invalid')
    }
    if (evidence.databaseTests.total !== total) throw new Error('release evidence databaseTests total is invalid')
  }
  if (!Array.isArray(evidence.steps)) throw new Error('release evidence steps must be an array')
  for (const item of evidence.steps) {
    exactKeys(item, STEP_EVIDENCE_KEYS, 'step')
    if (typeof item.name !== 'string' || !['passed', 'failed'].includes(item.status)) throw new Error('step evidence status is invalid')
    if (!validTime(item.startedAt) || !validTime(item.finishedAt)) throw new Error('step evidence timestamps are invalid')
    if (!Number.isInteger(item.durationMs) || item.durationMs < 0) throw new Error('step evidence durationMs is invalid')
  }
  if (evidence.status === 'passed' && evidence.failure !== null) throw new Error('passed release evidence must not contain failure evidence')
  if (evidence.status === 'failed') {
    exactKeys(evidence.failure, FAILURE_EVIDENCE_KEYS, 'failure')
    if (![evidence.failure.step, evidence.failure.kind, evidence.failure.message].every((value) => typeof value === 'string' && value.length > 0)) {
      throw new Error('failure evidence values are invalid')
    }
  }
  return evidence
}

class ReleaseFailure extends Error {
  constructor(stepName, kind, message) {
    super(message)
    this.stepName = stepName
    this.kind = kind
  }
}

function timestamp(clock) {
  const value = clock()
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) throw new Error('clock must return a valid Date')
  return value
}

function validateReadinessInput(evidence, expected, revision, now) {
  exactKeys(evidence, expected.projectFingerprint === undefined ? LOCAL_READINESS_KEYS : HOSTED_READINESS_KEYS, expected.label)
  if (evidence.schemaVersion !== 1) throw new Error(`${expected.label} evidence schemaVersion must be 1`)
  if (evidence.type !== expected.type) throw new Error(`${expected.label} evidence type must be ${expected.type}`)
  if (evidence.mode !== expected.mode) throw new Error(`${expected.label} evidence mode must be ${expected.mode}`)
  if (evidence.status !== 'passed') throw new Error(`${expected.label} evidence status must be passed`)
  if (!REVISION.test(evidence.revision) || evidence.revision !== revision) {
    throw new Error(`${expected.label} evidence revision must match the current full revision`)
  }
  if (!validTime(evidence.timestamp)) throw new Error(`${expected.label} evidence timestamp must be a UTC timestamp`)
  const evidenceTime = Date.parse(evidence.timestamp)
  if (evidenceTime > now.valueOf()) throw new Error(`${expected.label} evidence timestamp must not be in the future`)
  if (now.valueOf() - evidenceTime > READINESS_MAX_AGE_MS) {
    throw new Error(`${expected.label} evidence must be no more than 24 hours old`)
  }
  if (expected.projectFingerprint !== undefined && evidence.projectFingerprint !== expected.projectFingerprint) {
    throw new Error(`${expected.label} evidence ${expected.identity} fingerprint does not match the approved fingerprint`)
  }
}

async function validateProductionReadinessEvidence(options, filesystem, revision, now) {
  if (typeof filesystem.readFile !== 'function') {
    throw new ReleaseFailure('validate-production-readiness-evidence', 'evidence', 'production-readiness filesystem must provide readFile')
  }
  const inputs = [
    {
      path: options.localE2eEvidencePath,
      label: 'local E2E',
      type: 'local-e2e',
      mode: 'local',
    },
    {
      path: options.developmentCloudIntegrationEvidencePath,
      label: 'development cloud integration',
      type: 'development-cloud-integration',
      mode: 'development',
      identity: 'development',
      projectFingerprint: options.developmentProjectFingerprint,
    },
    {
      path: options.productionBackupEvidencePath,
      label: 'production backup',
      type: 'production-backup',
      mode: 'production-readiness',
      identity: 'production',
      projectFingerprint: options.productionProjectFingerprint,
    },
  ]

  for (const expected of inputs) {
    let contents
    try {
      contents = await filesystem.readFile(expected.path, 'utf8')
    } catch {
      throw new ReleaseFailure(
        'validate-production-readiness-evidence',
        'evidence',
        `${expected.label} evidence could not be read from its approved path`,
      )
    }
    let evidence
    try {
      evidence = JSON.parse(contents)
    } catch {
      throw new ReleaseFailure('validate-production-readiness-evidence', 'evidence', `${expected.label} evidence must be valid JSON`)
    }
    try {
      validateReadinessInput(evidence, expected, revision, now)
    } catch (error) {
      throw new ReleaseFailure('validate-production-readiness-evidence', 'evidence', error.message)
    }
  }
  return { code: 0 }
}

function safeFailure(step, result) {
  const sentinel = step.args.find((value) => /sentinel\.mjs$/.test(value))
  const subject = sentinel ?? step.name
  const exit = Number.isInteger(result?.code) ? `exit code ${result.code}` : `signal ${result?.signal ?? 'unknown'}`
  return new ReleaseFailure(step.name, sentinel ? 'sentinel' : 'command', `${subject} failed with ${exit}`)
}

function cleanupStep() {
  return {
    name: 'cleanup-local-supabase',
    command: 'npm',
    args: ['--prefix', 'community-app', 'run', 'db:stop', '--', '--project-id', PROJECT_ID],
    environment: {},
  }
}

function defaultExecutablePreflight(plan, repoRoot, env = process.env) {
  const executablePaths = env.PATH?.split(path.delimiter).filter(Boolean) ?? []
  const isExecutableFile = (candidate) => {
    try {
      if (!statSync(candidate).isFile()) return false
      accessSync(candidate, constants.X_OK)
      return true
    } catch {
      return false
    }
  }

  for (const command of new Set(plan.steps.map((releaseStep) => releaseStep.command))) {
    const candidates = command.includes(path.sep)
      ? [path.isAbsolute(command) ? command : path.resolve(repoRoot, command)]
      : executablePaths.map((directory) => path.join(directory, command))
    if (!candidates.some(isExecutableFile)) {
      throw new ReleaseFailure(
        'repository-preflight',
        'preflight',
        `required release executable is unavailable: ${command}`,
      )
    }
  }
}

async function runHostedProbes(options, dependencies) {
  const developmentUrl = dependencies.developmentUrl
  if (projectFingerprint(developmentUrl) !== options.projectFingerprint) {
    throw new ReleaseFailure('development-read-only-health', 'configuration', 'development project identity does not match the approved fingerprint')
  }
  const fetchImplementation = dependencies.fetch
  if (typeof fetchImplementation !== 'function') throw new Error('development mode requires an injected fetch implementation')
  const probes = [
    ['/auth/v1/health', 'GET'],
    ['/auth/v1/settings', 'GET'],
  ]
  for (const [pathname, method] of probes) {
    let response
    const signal = AbortSignal.timeout(10_000)
    try {
      response = await fetchImplementation(`${developmentUrl}${pathname}`, {
        method,
        redirect: 'error',
        signal,
      })
    } catch {
      throw new ReleaseFailure(
        'development-read-only-health',
        'hosted-probe',
        'resume the development Supabase project and retry the read-only probe',
      )
    }
    let body
    try {
      body = await new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason ?? new Error('hosted probe body timed out'))
        signal.addEventListener('abort', abort, { once: true })
        Promise.resolve()
          .then(() => response.text())
          .then(resolve, reject)
          .finally(() => signal.removeEventListener('abort', abort))
      })
    } catch {
      throw new ReleaseFailure(
        'development-read-only-health',
        'hosted-probe',
        'resume the development Supabase project and retry the read-only probe',
      )
    }
    if (response.status >= 500 || /project\s+(?:is\s+)?(?:paused|inactive)|(?:paused|inactive)\s+project/i.test(body)) {
      throw new ReleaseFailure(
        'development-read-only-health',
        'hosted-probe',
        'resume the development Supabase project and retry the read-only probe',
      )
    }
    if (!response.ok) {
      throw new ReleaseFailure('development-read-only-health', 'hosted-probe', `development read-only probe failed with HTTP ${response.status}`)
    }
  }
  return { code: 0 }
}

function defaultRunner(repoRoot, signal, spawnImplementation = spawn) {
  return (releaseStep) => new Promise((resolve, reject) => {
    const child = spawnImplementation(releaseStep.command, releaseStep.args, {
      cwd: repoRoot,
      env: { ...process.env, ...releaseStep.environment },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const append = (current, chunk) => `${current}${chunk}`.slice(-RUNNER_OUTPUT_LIMIT)
    child.stdout.on('data', (chunk) => {
      stdout = append(stdout, chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr = append(stderr, chunk)
    })
    const abort = () => child.kill('SIGTERM')
    signal?.addEventListener('abort', abort, { once: true })
    child.once('error', reject)
    child.once('close', (code, childSignal) => {
      signal?.removeEventListener('abort', abort)
      resolve({ code, signal: childSignal, stdout, stderr })
    })
  })
}

async function publishEvidence(evidencePath, evidence, filesystem) {
  validateEvidence(evidence)
  const temporary = path.join(path.dirname(evidencePath), `.${path.basename(evidencePath)}.${randomUUID()}.tmp`)
  await filesystem.writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
  try {
    await filesystem.rename(temporary, evidencePath)
  } catch (error) {
    await filesystem.rm?.(temporary, { force: true })
    throw error
  }
}

export async function runReleaseGate(options, dependencies = {}) {
  const plan = dependencies.plan ?? buildReleasePlan(options)
  const clock = dependencies.clock ?? (() => new Date())
  const filesystem = dependencies.filesystem ?? { readFile, writeFile, rename, rm }
  const repoRoot = dependencies.repoRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const runner = dependencies.runner ?? defaultRunner(repoRoot, dependencies.signal, dependencies.spawn)
  const executablePreflight = dependencies.executablePreflight ?? (() => defaultExecutablePreflight(plan, repoRoot))
  const revision = dependencies.revision
  if (!REVISION.test(revision ?? '')) throw new Error('runReleaseGate requires a full lowercase Git revision')

  const inputEvidencePaths = [
    options.localE2eEvidencePath,
    options.developmentCloudIntegrationEvidencePath,
    options.productionBackupEvidencePath,
  ].filter(Boolean)
  if (inputEvidencePaths.includes(options.evidencePath)) {
    throw new Error('selected output evidence must differ from production-readiness input evidence paths')
  }
  try {
    await filesystem.rm(options.evidencePath, { force: true })
  } catch {
    throw new ReleaseFailure('invalidate-release-evidence', 'evidence', 'could not invalidate existing release evidence')
  }

  const started = timestamp(clock)
  const steps = []
  let artifactManifest = null
  const databaseTestSteps = []
  let primaryFailure
  let cleanupFailure

  const execute = async (releaseStep, { ignoreAbort = false } = {}) => {
    const stepStarted = timestamp(clock)
    let result
    let failure
    try {
      if (!ignoreAbort && dependencies.signal?.aborted) {
        throw new ReleaseFailure(releaseStep.name, 'signal', `release gate aborted by ${dependencies.signal.reason ?? 'signal'}`)
      }
      if (releaseStep.kind === 'internal') {
        if (releaseStep.name !== 'validate-production-readiness-evidence') {
          throw new ReleaseFailure(releaseStep.name, 'configuration', `unsupported internal release step: ${releaseStep.name}`)
        }
        result = await validateProductionReadinessEvidence(options, filesystem, revision, stepStarted)
      } else {
        result = releaseStep.name === 'development-read-only-health'
          ? await runHostedProbes(options, dependencies)
          : await runner(releaseStep)
      }
      if (!ignoreAbort && dependencies.signal?.aborted) {
        throw new ReleaseFailure(releaseStep.name, 'signal', `release gate aborted by ${dependencies.signal.reason ?? 'signal'}`)
      }
      if (result?.code !== 0) throw safeFailure(releaseStep, result)
      if (releaseStep.name === 'repository-preflight' && result.stdout?.trim()) {
        throw new ReleaseFailure(releaseStep.name, 'preflight', 'repository-preflight requires a clean Git working tree')
      }
      if (releaseStep.name === 'repository-preflight') await executablePreflight(plan, repoRoot)
      if (DATABASE_TEST_STEPS.has(releaseStep.name)) {
        const stdout = String(result.stdout ?? '').slice(-RUNNER_OUTPUT_LIMIT)
        const summaries = [...stdout.matchAll(/^\s*Tests=(\d+)\s*$/gm)]
        if (summaries.length !== 1) {
          throw new ReleaseFailure(releaseStep.name, 'evidence', `${releaseStep.name} must emit exactly one Tests=<integer> summary`)
        }
        const count = Number(summaries[0][1])
        if (!Number.isSafeInteger(count)) {
          throw new ReleaseFailure(releaseStep.name, 'evidence', `${releaseStep.name} Tests count must be a safe integer`)
        }
        databaseTestSteps.push({ name: releaseStep.name, count })
      }
      if (releaseStep.name === 'verify-site-reproducibility') {
        const manifestPaths = [
          '/tmp/breadlab-community-release-manifests/build-1.sha256',
          '/tmp/breadlab-community-release-manifests/build-2.sha256',
        ]
        let first
        let second
        try {
          [first, second] = await Promise.all(manifestPaths.map((manifestPath) => filesystem.readFile(manifestPath)))
        } catch {
          throw new ReleaseFailure(releaseStep.name, 'evidence', 'reproducibility manifests could not be read')
        }
        const firstBytes = Buffer.from(first)
        const secondBytes = Buffer.from(second)
        if (!firstBytes.equals(secondBytes)) {
          throw new ReleaseFailure(releaseStep.name, 'evidence', 'reproducibility manifests do not match')
        }
        const lines = firstBytes.toString('utf8').split('\n')
        if (lines.at(-1) === '') lines.pop()
        if (lines.length === 0 || lines.some((line) => line.length === 0)) {
          throw new ReleaseFailure(releaseStep.name, 'evidence', 'reproducibility manifest must contain at least one file')
        }
        artifactManifest = {
          sha256: createHash('sha256').update(firstBytes).digest('hex'),
          fileCount: lines.length,
        }
      }
      if (!ignoreAbort && dependencies.signal?.aborted) {
        throw new ReleaseFailure(releaseStep.name, 'signal', `release gate aborted by ${dependencies.signal.reason ?? 'signal'}`)
      }
    } catch (error) {
      failure = error instanceof ReleaseFailure
        ? error
        : new ReleaseFailure(releaseStep.name, 'command', `${releaseStep.name} could not be executed`)
    }
    const stepFinished = timestamp(clock)
    steps.push({
      name: releaseStep.name,
      status: failure ? 'failed' : 'passed',
      startedAt: stepStarted.toISOString(),
      finishedAt: stepFinished.toISOString(),
      durationMs: Math.max(0, stepFinished.valueOf() - stepStarted.valueOf()),
    })
    if (failure) throw failure
  }

  try {
    for (const releaseStep of plan.steps) await execute(releaseStep)
  } catch (error) {
    primaryFailure = error
  } finally {
    if (options.mode === 'local' || options.mode === 'development') {
      try {
        await execute(cleanupStep(), { ignoreAbort: true })
      } catch (error) {
        cleanupFailure = error
      }
      for (const artifactPath of ARTIFACT_PATHS) {
        try {
          await filesystem.rm?.(artifactPath, { recursive: true, force: true })
        } catch (error) {
          cleanupFailure ??= new ReleaseFailure('cleanup-release-artifacts', 'cleanup', 'cleanup-release-artifacts could not be completed')
        }
      }
    }
  }

  const failure = primaryFailure ?? cleanupFailure
  const finished = timestamp(clock)
  const evidence = {
    schemaVersion: 2,
    revision,
    mode: options.mode,
    status: failure ? 'failed' : 'passed',
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: Math.max(0, finished.valueOf() - started.valueOf()),
    developmentProjectFingerprint: options.developmentProjectFingerprint ?? options.projectFingerprint ?? null,
    productionProjectFingerprint: options.productionProjectFingerprint ?? null,
    artifactManifest,
    databaseTests: databaseTestSteps.length > 0
      ? {
          steps: databaseTestSteps,
          total: databaseTestSteps.reduce((total, item) => total + item.count, 0),
        }
      : null,
    steps,
    failure: failure ? { step: failure.stepName, kind: failure.kind, message: failure.message } : null,
  }
  await publishEvidence(options.evidencePath, evidence, filesystem)

  if (failure) {
    if (primaryFailure && cleanupFailure) {
      throw new Error(`${primaryFailure.message}; cleanup also failed: ${cleanupFailure.message}`, { cause: primaryFailure })
    }
    throw failure
  }
  return evidence
}

export async function runReleaseGateWithSignals(options, dependencies = {}, signalTarget = process) {
  const controller = new AbortController()
  const handlers = new Map()
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => {
      if (!controller.signal.aborted) controller.abort(signal)
    }
    handlers.set(signal, handler)
    signalTarget.on(signal, handler)
  }
  try {
    return await runReleaseGate(options, { ...dependencies, signal: controller.signal })
  } finally {
    for (const [signal, handler] of handlers) signalTarget.removeListener(signal, handler)
  }
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'community-app/package.json'), 'utf8'))
  const options = parseReleaseOptions(process.argv.slice(2), process.env, {
    repoRoot,
    nodeVersion: process.versions.node,
    packageJson,
    lstatSync,
    realpathSync,
  })
  const revisionResult = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', shell: false })
  if (revisionResult.status !== 0) throw new Error('unable to determine release Git revision')
  await runReleaseGateWithSignals(options, {
    repoRoot,
    revision: revisionResult.stdout.trim(),
    developmentUrl: process.env.DEVELOPMENT_SUPABASE_URL,
    fetch: globalThis.fetch,
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
