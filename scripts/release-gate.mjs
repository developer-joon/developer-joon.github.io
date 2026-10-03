#!/usr/bin/env node

import { createHash } from 'node:crypto'
import path from 'node:path'

const MODES = new Set(['local', 'development', 'production-readiness'])
const SHA256 = /^[a-f0-9]{64}$/
const HOSTED_LOCAL_ENV = [
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
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

  const canonicalRepo = realpathSync(repoRoot)
  const parent = realpathSync(path.dirname(absoluteEvidence))
  const canonicalEvidence = evidenceStat ? realpathSync(absoluteEvidence) : path.join(parent, path.basename(absoluteEvidence))
  const relative = path.relative(canonicalRepo, canonicalEvidence)
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('evidence output must resolve outside the repository')
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
  if (env[fingerprintName]) return parseFingerprint(env[fingerprintName], fingerprintName)
  if (env[urlName]) return projectFingerprint(env[urlName])
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
  }

  return deepFreeze(options)
}

function step(name, command, args, environment = {}) {
  return { name, command, args, environment }
}

function localSteps() {
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
    step('local-e2e', 'node', ['scripts/community-e2e-sentinel.mjs']),
  ]
}

export function buildReleasePlan(options) {
  let steps
  if (options.mode === 'local') {
    steps = localSteps()
  } else if (options.mode === 'development') {
    steps = [
      ...localSteps(),
      step('development-read-only-health', 'node', ['scripts/development-readonly-probe.mjs']),
      step('development-integration', 'node', ['scripts/development-integration-sentinel.mjs']),
    ]
  } else if (options.mode === 'production-readiness') {
    steps = [step('validate-production-readiness-evidence', 'node', ['scripts/production-readiness-sentinel.mjs'])]
  } else {
    throw new Error(`unsupported release mode: ${options.mode}`)
  }
  return deepFreeze({ mode: options.mode, evidencePath: options.evidencePath, steps })
}

export async function runReleaseGate(_options, _dependencies) {
  throw new Error('Task 2 release-gate execution is not implemented')
}
