#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstatSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import {
  buildReleasePlan,
  parseReleaseOptions,
  projectFingerprint,
  runReleaseGate,
  validateEvidence,
} from './release-gate.mjs'

const ENGINE = '^24.15.0'
const DEVELOPMENT_REF = 'abcdefghijklmnopqrst'
const PRODUCTION_REF = 'zyxwvutsrqponmlkjihg'
const DEVELOPMENT_URL = `https://${DEVELOPMENT_REF}.supabase.co`
const PRODUCTION_URL = `https://${PRODUCTION_REF}.supabase.co`
const LOCAL_STEP_NAMES = [
  'repository-preflight',
  'start-local-supabase',
  'reset-local-database',
  'test-storage-upgrade',
  'test-public-listing-upgrade',
  'test-community-snapshot-upgrade',
  'test-public-attachment-integration',
  'test-database',
  'lint-database',
  'test-node-scripts',
  'build-site-a',
  'build-site-b',
  'verify-site-a',
  'verify-site-b',
  'verify-site-reproducibility',
  'local-e2e',
]

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'release-gate-test-'))
  const repoRoot = path.join(root, 'repo')
  const evidenceRoot = path.join(root, 'evidence')
  mkdirSync(repoRoot)
  mkdirSync(evidenceRoot)
  const readinessEvidence = {
    local: path.join(evidenceRoot, 'local-e2e.json'),
    development: path.join(evidenceRoot, 'development-cloud-integration.json'),
    backup: path.join(evidenceRoot, 'production-backup.json'),
  }
  for (const evidencePath of Object.values(readinessEvidence)) writeFileSync(evidencePath, '{}\n')
  const context = {
    repoRoot,
    nodeVersion: '24.15.0',
    packageJson: { engines: { node: ENGINE } },
    lstatSync,
    realpathSync,
  }
  return {
    root,
    repoRoot,
    evidence: path.join(evidenceRoot, 'release.json'),
    readinessEvidence,
    context,
    close: () => rmSync(root, { recursive: true, force: true }),
  }
}

function parse(argv = [], env = {}, updateContext = {}) {
  const state = fixture()
  try {
    const resolvedEnv = Object.fromEntries(Object.entries(env).map(([name, value]) => [
      name,
      value === '$LOCAL_EVIDENCE'
        ? state.readinessEvidence.local
        : value === '$DEVELOPMENT_EVIDENCE'
          ? state.readinessEvidence.development
          : value === '$BACKUP_EVIDENCE'
            ? state.readinessEvidence.backup
            : value,
    ]))
    return parseReleaseOptions(
      argv.length === 0 ? ['--evidence', state.evidence] : argv.map((value) => value === '$EVIDENCE' ? state.evidence : value),
      resolvedEnv,
      { ...state.context, ...updateContext },
    )
  } finally {
    state.close()
  }
}

function productionEnv(overrides = {}) {
  return {
    DEVELOPMENT_PROJECT_FINGERPRINT: projectFingerprint(DEVELOPMENT_URL),
    PRODUCTION_PROJECT_FINGERPRINT: projectFingerprint(PRODUCTION_URL),
    LOCAL_E2E_EVIDENCE_PATH: '$LOCAL_EVIDENCE',
    DEVELOPMENT_CLOUD_INTEGRATION_EVIDENCE_PATH: '$DEVELOPMENT_EVIDENCE',
    PRODUCTION_BACKUP_EVIDENCE_PATH: '$BACKUP_EVIDENCE',
    ALLOW_PRODUCTION_READINESS: '1',
    ...overrides,
  }
}

test('defaults to local mode and builds the exact ordered local plan', () => {
  const options = parse()
  assert.equal(options.mode, 'local')
  assert.deepEqual(buildReleasePlan(options).steps.map(({ name }) => name), LOCAL_STEP_NAMES)
})

test('development plan runs the exhaustive local core before hosted probes and its Task 16 sentinel', () => {
  const options = parse(
    ['--mode', 'development', '--evidence', '$EVIDENCE'],
    { DEVELOPMENT_SUPABASE_URL: DEVELOPMENT_URL, ALLOW_DEVELOPMENT_CLOUD_READS: '1' },
  )
  const names = buildReleasePlan(options).steps.map(({ name }) => name)
  assert.deepEqual(names, [
    ...LOCAL_STEP_NAMES.slice(0, -1),
    'development-read-only-health',
    'development-integration',
  ])
  assert.equal(names.includes('local-e2e'), false)
  assert.ok(names.indexOf('development-read-only-health') > names.indexOf('verify-site-reproducibility'))
})

test('accepts only the three release modes', () => {
  for (const mode of ['local', 'development', 'production-readiness']) {
    const env = mode === 'development'
      ? { DEVELOPMENT_SUPABASE_URL: DEVELOPMENT_URL, ALLOW_DEVELOPMENT_CLOUD_READS: '1' }
      : mode === 'production-readiness'
        ? productionEnv()
        : {}
    assert.equal(parse(['--mode', mode, '--evidence', '$EVIDENCE'], env).mode, mode)
  }
  assert.throws(() => parse(['--mode', 'production', '--evidence', '$EVIDENCE']), /unsupported release mode/i)
  assert.throws(() => parse(['--mode', '', '--evidence', '$EVIDENCE']), /unsupported release mode/i)
})

test('requires the exact Node version derived from the package engine', () => {
  assert.equal(parse([], {}, { nodeVersion: '24.15.0' }).requiredNodeVersion, '24.15.0')
  for (const nodeVersion of ['23.15.0', '24.14.9', '24.15.1', '24.16.0']) {
    assert.throws(() => parse([], {}, { nodeVersion }), /requires Node 24\.15\.0 exactly/i)
  }
  assert.throws(
    () => parse([], {}, { packageJson: { engines: { node: '>=24' } } }),
    /exact pinned Node engine/i,
  )
})

test('rejects privileged Supabase credential variables and secret-key patterns without echoing values', () => {
  for (const name of [
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SERVICE_KEY',
    'SUPABASE_DB_PASSWORD',
    'SUPABASE_ACCESS_TOKEN',
    'MY_SUPABASE_SECRET_KEY',
  ]) {
    const secret = 'sb_secret_do-not-print-this'
    assert.throws(
      () => parse([], { [name]: secret }),
      (error) => /privileged Supabase credential/i.test(error.message) && !error.message.includes(secret),
    )
  }
  assert.throws(
    () => parse([], { UNRELATED_INPUT: 'sb_secret_do-not-print-this' }),
    /secret Supabase key/i,
  )
})

test('requires evidence to resolve outside the repository and rejects symlinks', () => {
  const state = fixture()
  try {
    assert.throws(
      () => parseReleaseOptions(['--evidence', path.join(state.repoRoot, 'release.json')], {}, state.context),
      /outside the repository/i,
    )
    const target = path.join(path.dirname(state.evidence), 'target.json')
    symlinkSync(target, state.evidence)
    assert.throws(
      () => parseReleaseOptions(['--evidence', state.evidence], {}, state.context),
      /must not be a symlink/i,
    )
  } finally {
    state.close()
  }
})

test('rejects existing evidence targets that are not regular files', () => {
  const state = fixture()
  try {
    mkdirSync(state.evidence)
    assert.throws(
      () => parseReleaseOptions(['--evidence', state.evidence], {}, state.context),
      /must be a regular file/i,
    )
    if (process.platform === 'linux') {
      assert.throws(
        () => parseReleaseOptions(['--evidence', '/dev/null'], {}, state.context),
        /must be a regular file/i,
      )
    }
  } finally {
    state.close()
  }
})

test('output preflight rejects a target whose parent is not writable when access checks are available', () => {
  const state = fixture()
  try {
    const parent = path.dirname(state.evidence)
    assert.throws(
      () => parseReleaseOptions(['--evidence', state.evidence], {}, {
        ...state.context,
        accessSync(candidate) {
          if (candidate === parent) throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
        },
      }),
      /evidence output parent.*writable/i,
    )
  } finally {
    state.close()
  }
})

test('development requires an exact hosted HTTPS URL and explicit cloud-read opt-in', () => {
  assert.throws(
    () => parse(['--mode', 'development', '--evidence', '$EVIDENCE']),
    /DEVELOPMENT_SUPABASE_URL/i,
  )
  assert.throws(
    () => parse(['--mode', 'development', '--evidence', '$EVIDENCE'], { DEVELOPMENT_SUPABASE_URL: DEVELOPMENT_URL }),
    /ALLOW_DEVELOPMENT_CLOUD_READS=1/i,
  )
  for (const url of [
    `http://${DEVELOPMENT_REF}.supabase.co`,
    'https://supabase.co',
    `https://${DEVELOPMENT_REF}.supabase.co/path`,
    `https://${DEVELOPMENT_REF}.supabase.co?query=1`,
    `https://${DEVELOPMENT_REF}.supabase.co:443`,
    'https://example.com',
  ]) {
    assert.throws(
      () => parse(
        ['--mode', 'development', '--evidence', '$EVIDENCE'],
        { DEVELOPMENT_SUPABASE_URL: url, ALLOW_DEVELOPMENT_CLOUD_READS: '1' },
      ),
      /https:\/\/<project-ref>\.supabase\.co/i,
    )
  }
  const options = parse(
    ['--mode', 'development', '--evidence', '$EVIDENCE'],
    { DEVELOPMENT_SUPABASE_URL: DEVELOPMENT_URL, ALLOW_DEVELOPMENT_CLOUD_READS: '1' },
  )
  assert.equal(options.projectFingerprint, projectFingerprint(DEVELOPMENT_URL))
  assert.equal('developmentUrl' in options, false, 'returned options must not retain a hosted URL')
})

test('development rejects a production project alias by URL or fingerprint', () => {
  const common = { DEVELOPMENT_SUPABASE_URL: DEVELOPMENT_URL, ALLOW_DEVELOPMENT_CLOUD_READS: '1' }
  assert.throws(
    () => parse(
      ['--mode', 'development', '--evidence', '$EVIDENCE'],
      { ...common, PRODUCTION_SUPABASE_URL: DEVELOPMENT_URL },
    ),
    /must differ from production/i,
  )
  assert.throws(
    () => parse(
      ['--mode', 'development', '--evidence', '$EVIDENCE'],
      { ...common, PRODUCTION_PROJECT_FINGERPRINT: projectFingerprint(DEVELOPMENT_URL) },
    ),
    /must differ from production/i,
  )
})

test('production readiness requires opt-in and distinct canonical project fingerprints', () => {
  const fingerprints = {
    DEVELOPMENT_PROJECT_FINGERPRINT: projectFingerprint(DEVELOPMENT_URL),
    PRODUCTION_PROJECT_FINGERPRINT: projectFingerprint(PRODUCTION_URL),
  }
  assert.throws(
    () => parse(['--mode', 'production-readiness', '--evidence', '$EVIDENCE'], fingerprints),
    /ALLOW_PRODUCTION_READINESS=1/i,
  )
  assert.throws(
    () => parse(
      ['--mode', 'production-readiness', '--evidence', '$EVIDENCE'],
      productionEnv({
        PRODUCTION_PROJECT_FINGERPRINT: fingerprints.DEVELOPMENT_PROJECT_FINGERPRINT,
      }),
    ),
    /must be distinct/i,
  )
  assert.throws(
    () => parse(
      ['--mode', 'production-readiness', '--evidence', '$EVIDENCE'],
      productionEnv({ DEVELOPMENT_PROJECT_FINGERPRINT: 'not-a-digest' }),
    ),
    /SHA-256 fingerprint/i,
  )
})

test('production readiness rejects URL and explicit fingerprint disagreements before identity comparison', () => {
  assert.throws(
    () => parse(
      ['--mode', 'production-readiness', '--evidence', '$EVIDENCE'],
      productionEnv({
        DEVELOPMENT_SUPABASE_URL: DEVELOPMENT_URL,
        DEVELOPMENT_PROJECT_FINGERPRINT: projectFingerprint(PRODUCTION_URL),
      }),
    ),
    /DEVELOPMENT_PROJECT_FINGERPRINT must match DEVELOPMENT_SUPABASE_URL/i,
  )
  assert.throws(
    () => parse(
      ['--mode', 'production-readiness', '--evidence', '$EVIDENCE'],
      productionEnv({
        DEVELOPMENT_SUPABASE_URL: DEVELOPMENT_URL,
        DEVELOPMENT_PROJECT_FINGERPRINT: projectFingerprint(DEVELOPMENT_URL),
        PRODUCTION_SUPABASE_URL: DEVELOPMENT_URL,
      }),
    ),
    /PRODUCTION_PROJECT_FINGERPRINT must match PRODUCTION_SUPABASE_URL/i,
  )
})

test('production readiness requires all three external evidence paths with actionable names', () => {
  for (const name of [
    'LOCAL_E2E_EVIDENCE_PATH',
    'DEVELOPMENT_CLOUD_INTEGRATION_EVIDENCE_PATH',
    'PRODUCTION_BACKUP_EVIDENCE_PATH',
  ]) {
    assert.throws(
      () => parse(
        ['--mode', 'production-readiness', '--evidence', '$EVIDENCE'],
        productionEnv({ [name]: undefined }),
      ),
      new RegExp(`missing production-readiness evidence.*${name}`, 'i'),
    )
  }
})

test('production readiness evidence inputs must be external regular non-symlink files', () => {
  const state = fixture()
  try {
    const base = {
      ...productionEnv(),
      LOCAL_E2E_EVIDENCE_PATH: state.readinessEvidence.local,
      DEVELOPMENT_CLOUD_INTEGRATION_EVIDENCE_PATH: state.readinessEvidence.development,
      PRODUCTION_BACKUP_EVIDENCE_PATH: state.readinessEvidence.backup,
    }
    const symlink = path.join(path.dirname(state.evidence), 'local-symlink.json')
    symlinkSync(state.readinessEvidence.local, symlink)
    for (const invalid of [
      symlink,
      state.repoRoot,
      path.join(state.repoRoot, 'inside.json'),
      path.join(path.dirname(state.evidence), 'missing.json'),
    ]) {
      if (invalid.endsWith('inside.json')) writeFileSync(invalid, '{}\n')
      assert.throws(
        () => parseReleaseOptions(
          ['--mode', 'production-readiness', '--evidence', state.evidence],
          { ...base, LOCAL_E2E_EVIDENCE_PATH: invalid },
          state.context,
        ),
        /LOCAL_E2E_EVIDENCE_PATH.*(?:regular file|symlink|outside|exist)/i,
      )
    }
  } finally {
    state.close()
  }
})

test('production readiness plan is one internal validation step with no command', () => {
  const plan = buildReleasePlan(parse(
    ['--mode', 'production-readiness', '--evidence', '$EVIDENCE'],
    productionEnv(),
  ))
  assert.deepEqual(plan.steps, [{ name: 'validate-production-readiness-evidence', kind: 'internal' }])
})

test('project fingerprint hashes only the lowercase canonical Supabase project ref', () => {
  const expected = createHash('sha256').update(DEVELOPMENT_REF).digest('hex')
  assert.equal(projectFingerprint(DEVELOPMENT_URL), expected)
  assert.equal(projectFingerprint(`https://${DEVELOPMENT_REF.toUpperCase()}.supabase.co/`), expected)
  assert.doesNotMatch(projectFingerprint(DEVELOPMENT_URL), /supabase|https|\./)
  assert.throws(() => projectFingerprint('https://example.com'), /Supabase project URL/i)
})

test('local mode rejects hosted URLs and credentials rather than ignoring them', () => {
  for (const name of [
    'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY',
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_PUBLISHABLE_KEY',
    'DEVELOPMENT_SUPABASE_URL',
    'PRODUCTION_SUPABASE_URL',
    'DEVELOPMENT_PROJECT_FINGERPRINT',
    'PRODUCTION_PROJECT_FINGERPRINT',
  ]) {
    assert.throws(() => parse([], { [name]: 'configured' }), /local mode rejects hosted/i)
  }
})

test('plans use recursively frozen fixed argv arrays and contain no deploying or write-capable command', () => {
  const modeEnvironments = {
    local: {},
    development: { DEVELOPMENT_SUPABASE_URL: DEVELOPMENT_URL, ALLOW_DEVELOPMENT_CLOUD_READS: '1' },
    'production-readiness': productionEnv(),
  }
  for (const [mode, env] of Object.entries(modeEnvironments)) {
    const plan = buildReleasePlan(parse(['--mode', mode, '--evidence', '$EVIDENCE'], env))
    assert.ok(Object.isFrozen(plan))
    assert.ok(Object.isFrozen(plan.steps))
    for (const step of plan.steps) {
      if (step.kind === 'internal') {
        assert.deepEqual(Object.keys(step).sort(), ['kind', 'name'])
        assert.equal(step.name, 'validate-production-readiness-evidence')
        assert.equal('command' in step, false)
        assert.equal('args' in step, false)
        assert.equal('environment' in step, false)
        assert.ok(Object.isFrozen(step))
        continue
      }
      assert.deepEqual(Object.keys(step).sort(), ['args', 'command', 'environment', 'name'])
      assert.equal(typeof step.command, 'string')
      assert.ok(Array.isArray(step.args))
      assert.equal(step.args.every((arg) => typeof arg === 'string'), true)
      assert.ok(Object.isFrozen(step))
      assert.ok(Object.isFrozen(step.args))
      assert.ok(Object.isFrozen(step.environment))
      const rendered = [step.command, ...step.args].join(' ')
      assert.doesNotMatch(rendered, /supabase db push|supabase functions deploy|git push|gh workflow run/i)
      assert.doesNotMatch(rendered, /(?:^|\s)(?:POST|PUT|PATCH|DELETE)(?:\s|$)/i)
      assert.doesNotMatch(rendered, /[;&|`$<>]/, 'plan must not contain shell interpolation syntax')
    }
    assert.throws(() => plan.steps.push({}), TypeError)
  }
})

function executionFixture(mode = 'local') {
  const state = fixture()
  const writes = new Map()
  const renames = []
  let milliseconds = 0
  const dependencies = {
    revision: '7212072813f97d8c21266f5ec72a2b2bb6754967',
    clock: () => new Date(Date.UTC(2026, 9, 3, 0, 0, 0, milliseconds++)),
    runner: async () => ({ code: 0, stdout: '', stderr: '' }),
    filesystem: {
      writeFile: async (file, contents) => writes.set(file, contents),
      rename: async (from, to) => {
        renames.push([from, to])
        writes.set(to, writes.get(from))
        writes.delete(from)
      },
      rm: async () => {},
    },
  }
  const options = {
    mode,
    evidencePath: state.evidence,
    ...(mode === 'development' ? { projectFingerprint: projectFingerprint(DEVELOPMENT_URL) } : {}),
    ...(mode === 'production-readiness'
      ? {
          developmentProjectFingerprint: projectFingerprint(DEVELOPMENT_URL),
          productionProjectFingerprint: projectFingerprint(PRODUCTION_URL),
          localE2eEvidencePath: state.readinessEvidence.local,
          developmentCloudIntegrationEvidencePath: state.readinessEvidence.development,
          productionBackupEvidencePath: state.readinessEvidence.backup,
        }
      : {}),
  }
  return {
    ...state,
    options,
    dependencies,
    writes,
    renames,
    evidence: () => JSON.parse(writes.get(state.evidence)),
  }
}

function compactPlan(mode, evidencePath, names) {
  return {
    mode,
    evidencePath,
    steps: names.map((name) => ({ name, command: 'node', args: [`${name}.mjs`], environment: {} })),
  }
}

function readinessInputs(state, overrides = {}) {
  const common = {
    schemaVersion: 1,
    status: 'passed',
    revision: state.dependencies.revision,
    finishedAt: '2026-10-02T12:00:00.000Z',
  }
  return {
    [state.readinessEvidence.local]: {
      ...common,
      type: 'local-e2e',
      mode: 'local',
      ...overrides.local,
    },
    [state.readinessEvidence.development]: {
      ...common,
      type: 'development-cloud-integration',
      mode: 'development',
      projectFingerprint: state.options.developmentProjectFingerprint,
      ...overrides.development,
    },
    [state.readinessEvidence.backup]: {
      ...common,
      type: 'production-backup',
      mode: 'production-readiness',
      projectFingerprint: state.options.productionProjectFingerprint,
      backupChecksum: 'b'.repeat(64),
      ...overrides.backup,
    },
  }
}

test('production readiness validates external evidence offline without runner or fetch', async () => {
  const state = executionFixture('production-readiness')
  try {
    const inputs = readinessInputs(state)
    const reads = []
    state.dependencies.filesystem.readFile = async (file) => {
      reads.push(file)
      return JSON.stringify(inputs[file])
    }
    state.dependencies.runner = async () => { throw new Error('runner must not be called') }
    state.dependencies.fetch = async () => { throw new Error('fetch must not be called') }

    const evidence = await runReleaseGate(state.options, state.dependencies)

    assert.equal(evidence.status, 'passed')
    assert.equal(evidence.developmentProjectFingerprint, state.options.developmentProjectFingerprint)
    assert.equal(evidence.productionProjectFingerprint, state.options.productionProjectFingerprint)
    assert.deepEqual(evidence.readinessEvidence, {
      localE2e: {
        revision: state.dependencies.revision,
        finishedAt: '2026-10-02T12:00:00.000Z',
      },
      developmentIntegration: {
        revision: state.dependencies.revision,
        finishedAt: '2026-10-02T12:00:00.000Z',
        projectFingerprint: state.options.developmentProjectFingerprint,
      },
      productionBackup: {
        revision: state.dependencies.revision,
        finishedAt: '2026-10-02T12:00:00.000Z',
        projectFingerprint: state.options.productionProjectFingerprint,
        backupChecksum: 'b'.repeat(64),
      },
    })
    assert.deepEqual(evidence.steps.map(({ name }) => name), ['validate-production-readiness-evidence'])
    assert.deepEqual(reads, [
      state.readinessEvidence.local,
      state.readinessEvidence.development,
      state.readinessEvidence.backup,
    ])
    const serialized = JSON.stringify(evidence)
    assert.equal(serialized.includes('local-e2e'), false)
    assert.equal(serialized.includes('development-cloud-integration'), false)
    assert.equal(serialized.includes('production-backup'), false)
  } finally {
    state.close()
  }
})

test('production readiness rejects malformed, failed, stale, future, revision-mismatched, and misbound evidence', async () => {
  const cases = [
    ['exact schema', { local: { extra: 'input-private-value' } }, /exact keys/i],
    ['schema version', { local: { schemaVersion: 2 } }, /schemaVersion.*1/i],
    ['type', { local: { type: 'other' } }, /type/i],
    ['mode', { local: { mode: 'development' } }, /mode.*local/i],
    ['successful status', { local: { status: 'failed' } }, /status.*passed/i],
    ['UTC finishedAt', { local: { finishedAt: '2026-10-02 12:00:00' } }, /UTC.*finishedAt|finishedAt.*UTC/i],
    ['calendar-valid finishedAt', { local: { finishedAt: '2026-02-30T12:00:00.000Z' } }, /UTC.*finishedAt|finishedAt.*UTC/i],
    ['freshness', { local: { finishedAt: '2026-10-01T23:59:59.000Z' } }, /24 hours/i],
    ['future finishedAt', { local: { finishedAt: '2026-10-03T00:00:01.000Z' } }, /future/i],
    ['revision', { local: { revision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } }, /revision.*current/i],
    ['development fingerprint', { development: { projectFingerprint: projectFingerprint(PRODUCTION_URL) } }, /development.*fingerprint/i],
    ['production fingerprint', { backup: { projectFingerprint: projectFingerprint(DEVELOPMENT_URL) } }, /production.*fingerprint/i],
    ['production backup checksum', { backup: { backupChecksum: 'not-a-checksum' } }, /backup.*checksum.*SHA-256/i],
  ]
  for (const [label, overrides, expected] of cases) {
    const state = executionFixture('production-readiness')
    try {
      const inputs = readinessInputs(state, overrides)
      state.dependencies.clock = () => new Date('2026-10-03T00:00:00.000Z')
      state.dependencies.filesystem.readFile = async (file) => JSON.stringify(inputs[file])
      state.dependencies.runner = async () => { throw new Error('runner must not be called') }
      state.dependencies.fetch = async () => { throw new Error('fetch must not be called') }
      await assert.rejects(runReleaseGate(state.options, state.dependencies), expected, label)
      assert.equal(state.evidence().status, 'failed', label)
      assert.equal(state.evidence().failure.step, 'validate-production-readiness-evidence', label)
      assert.equal(state.evidence().failure.kind, 'evidence', label)
      assert.equal(JSON.stringify(state.evidence()).includes('input-private-value'), false, label)
    } finally {
      state.close()
    }
  }
})

test('production readiness rejects a missing backup checksum', async () => {
  const state = executionFixture('production-readiness')
  try {
    const inputs = readinessInputs(state)
    delete inputs[state.readinessEvidence.backup].backupChecksum
    state.dependencies.clock = () => new Date('2026-10-03T00:00:00.000Z')
    state.dependencies.filesystem.readFile = async (file) => JSON.stringify(inputs[file])
    await assert.rejects(runReleaseGate(state.options, state.dependencies), /production backup.*exact keys|backup.*checksum/i)
    assert.equal(state.evidence().status, 'failed')
    assert.equal(state.evidence().readinessEvidence, null)
  } finally {
    state.close()
  }
})

test('production readiness publishes actionable failed evidence for unreadable or invalid JSON inputs', async () => {
  for (const scenario of ['unreadable', 'invalid-json']) {
    const state = executionFixture('production-readiness')
    try {
      const inputs = readinessInputs(state)
      state.dependencies.clock = () => new Date('2026-10-03T00:00:00.000Z')
      state.dependencies.filesystem.readFile = async (file) => {
        if (file === state.readinessEvidence.local) {
          if (scenario === 'unreadable') throw new Error('input-private-read-error')
          return '{ input-private-invalid-json'
        }
        return JSON.stringify(inputs[file])
      }
      await assert.rejects(
        runReleaseGate(state.options, state.dependencies),
        scenario === 'unreadable' ? /local E2E.*approved path/i : /local E2E.*valid JSON/i,
      )
      const evidence = state.evidence()
      assert.equal(evidence.status, 'failed')
      assert.equal(evidence.failure.kind, 'evidence')
      assert.equal(JSON.stringify(evidence).includes('input-private'), false)
    } finally {
      state.close()
    }
  }
})

test('executes steps serially in exact order', async () => {
  const state = executionFixture()
  try {
    const events = []
    let active = 0
    state.dependencies.plan = compactPlan('local', state.evidence, ['first', 'second', 'third'])
    state.dependencies.runner = async ({ name }) => {
      assert.equal(active, 0, 'a later step started before the prior step completed')
      active += 1
      events.push(`start:${name}`)
      await Promise.resolve()
      events.push(`finish:${name}`)
      active -= 1
      return { code: 0 }
    }
    await runReleaseGate(state.options, state.dependencies)
    assert.deepEqual(events, [
      'start:first', 'finish:first',
      'start:second', 'finish:second',
      'start:third', 'finish:third',
      'start:cleanup-local-supabase', 'finish:cleanup-local-supabase',
    ])
  } finally {
    state.close()
  }
})

test('repository preflight rejects dirty state and performs executable discovery before later checks', async () => {
  for (const dirty of [false, true]) {
    const state = executionFixture()
    try {
      const calls = []
      state.dependencies.plan = {
        ...compactPlan('local', state.options.evidencePath, ['repository-preflight', 'later']),
        steps: [
          { name: 'repository-preflight', command: 'git', args: ['status', '--porcelain'], environment: {} },
          { name: 'later', command: 'node', args: ['later.mjs'], environment: {} },
        ],
      }
      state.dependencies.runner = async ({ name }) => {
        calls.push(name)
        return { code: 0, stdout: name === 'repository-preflight' && dirty ? ' M tracked-file\n' : '' }
      }
      state.dependencies.executablePreflight = async () => calls.push('executable-preflight')
      if (dirty) await assert.rejects(runReleaseGate(state.options, state.dependencies), /clean Git working tree/i)
      else await runReleaseGate(state.options, state.dependencies)
      assert.deepEqual(
        calls,
        dirty
          ? ['repository-preflight', 'cleanup-local-supabase']
          : ['repository-preflight', 'executable-preflight', 'later', 'cleanup-local-supabase'],
      )
    } finally {
      state.close()
    }
  }
})

test('default executable preflight rejects a missing plan command before later checks', async () => {
  const state = executionFixture()
  try {
    const calls = []
    state.dependencies.repoRoot = state.repoRoot
    state.dependencies.plan = {
      ...compactPlan('local', state.options.evidencePath, ['repository-preflight', 'later']),
      steps: [
        { name: 'repository-preflight', command: 'git', args: ['status', '--porcelain'], environment: {} },
        { name: 'later', command: './scripts/does-not-exist', args: [], environment: {} },
      ],
    }
    state.dependencies.runner = async ({ name }) => {
      calls.push(name)
      return { code: 0, stdout: '' }
    }
    await assert.rejects(runReleaseGate(state.options, state.dependencies), /required release executable.*does-not-exist/i)
    assert.deepEqual(calls, ['repository-preflight', 'cleanup-local-supabase'])
    assert.equal(state.evidence().failure.step, 'repository-preflight')
    assert.equal(state.evidence().failure.kind, 'preflight')
  } finally {
    state.close()
  }
})

test('first command failure prevents later checks and preserves the original failure through cleanup', async () => {
  const state = executionFixture()
  try {
    const calls = []
    state.dependencies.plan = compactPlan('local', state.evidence, ['first', 'broken', 'never'])
    state.dependencies.runner = async ({ name }) => {
      calls.push(name)
      if (name === 'broken') return { code: 7, stderr: 'sensitive diagnostic' }
      if (name === 'cleanup-local-supabase') return { code: 9, stderr: 'cleanup diagnostic' }
      return { code: 0 }
    }
    await assert.rejects(runReleaseGate(state.options, state.dependencies), /broken.*exit code 7/i)
    assert.deepEqual(calls, ['first', 'broken', 'cleanup-local-supabase'])
    assert.equal(state.evidence().status, 'failed')
    assert.equal(state.evidence().failure.step, 'broken')
  } finally {
    state.close()
  }
})

test('cleanup runs after success, command failure, sentinel failure, and signal abort', async () => {
  for (const scenario of ['success', 'command', 'sentinel', 'signal']) {
    const state = executionFixture()
    try {
      const calls = []
      const controller = new AbortController()
      state.dependencies.signal = controller.signal
      state.dependencies.plan = compactPlan('local', state.evidence, ['check', 'local-e2e'])
      state.dependencies.runner = async ({ name }) => {
        calls.push(name)
        if (scenario === 'command' && name === 'check') return { code: 2 }
        if (scenario === 'sentinel' && name === 'local-e2e') return { code: 1 }
        if (scenario === 'signal' && name === 'check') controller.abort('SIGTERM')
        return { code: 0 }
      }
      if (scenario === 'success') await runReleaseGate(state.options, state.dependencies)
      else await assert.rejects(runReleaseGate(state.options, state.dependencies))
      assert.equal(calls.at(-1), 'cleanup-local-supabase', scenario)
    } finally {
      state.close()
    }
  }
})

test('CLI signal handlers abort through cleanup, preserve the first signal, and remove listeners', async () => {
  const releaseGate = await import('./release-gate.mjs')
  assert.equal(typeof releaseGate.runReleaseGateWithSignals, 'function')

  for (const firstSignal of ['SIGINT', 'SIGTERM']) {
    const state = executionFixture()
    try {
      const handlers = new Map()
      const removed = []
      const signalTarget = {
        on(signal, handler) {
          assert.equal(handlers.has(signal), false)
          handlers.set(signal, handler)
        },
        removeListener(signal, handler) {
          assert.equal(handlers.get(signal), handler)
          removed.push(signal)
          handlers.delete(signal)
        },
      }
      const calls = []
      state.dependencies.plan = compactPlan('local', state.evidence, ['check', 'never'])
      state.dependencies.runner = async ({ name }) => {
        calls.push(name)
        if (name === 'check') {
          handlers.get(firstSignal)()
          handlers.get(firstSignal === 'SIGINT' ? 'SIGTERM' : 'SIGINT')()
        }
        if (name === 'cleanup-local-supabase') return { code: 9 }
        return { code: 0 }
      }

      await assert.rejects(
        releaseGate.runReleaseGateWithSignals(state.options, state.dependencies, signalTarget),
        new RegExp(`aborted by ${firstSignal}.*cleanup`, 'i'),
      )
      assert.deepEqual(calls, ['check', 'cleanup-local-supabase'])
      assert.deepEqual(removed.sort(), ['SIGINT', 'SIGTERM'])
      assert.equal(handlers.size, 0)
      assert.equal(state.evidence().failure.kind, 'signal')
      assert.match(state.evidence().failure.message, new RegExp(firstSignal))
    } finally {
      state.close()
    }
  }
})

test('cleanup failure changes success to failure without hiding an original failure', async () => {
  for (const failMain of [false, true]) {
    const state = executionFixture()
    try {
      state.dependencies.plan = compactPlan('local', state.evidence, ['check'])
      state.dependencies.runner = async ({ name }) => ({
        code: name === 'cleanup-local-supabase' ? 8 : failMain ? 3 : 0,
      })
      await assert.rejects(
        runReleaseGate(state.options, state.dependencies),
        failMain ? /check.*exit code 3.*cleanup.*exit code 8/is : /cleanup.*exit code 8/i,
      )
      assert.equal(state.evidence().failure.step, failMain ? 'check' : 'cleanup-local-supabase')
    } finally {
      state.close()
    }
  }
})

test('cleanup targets only this repository local Supabase project', async () => {
  const state = executionFixture()
  try {
    const calls = []
    state.dependencies.plan = compactPlan('local', state.evidence, [])
    state.dependencies.runner = async (step) => {
      calls.push(step)
      return { code: 0 }
    }
    await runReleaseGate(state.options, state.dependencies)
    const cleanup = calls.at(-1)
    assert.deepEqual(cleanup, {
      name: 'cleanup-local-supabase',
      command: 'npm',
      args: ['--prefix', 'community-app', 'run', 'db:stop', '--', '--project-id', 'developer-joon-community-design'],
      environment: {},
    })
    assert.doesNotMatch(cleanup.args.join(' '), /--all/)
  } finally {
    state.close()
  }
})

test('local and development modes reach their intentional Task 16 sentinels', async () => {
  for (const [mode, sentinel] of [
    ['local', 'scripts/community-e2e-sentinel.mjs'],
    ['development', 'scripts/development-integration-sentinel.mjs'],
  ]) {
    const state = executionFixture(mode)
    try {
      const names = mode === 'local' ? ['before', 'local-e2e'] : ['before', 'development-read-only-health', 'development-integration']
      state.dependencies.plan = compactPlan(mode, state.evidence, names)
      state.dependencies.plan.steps.at(-1).args[0] = sentinel
      state.dependencies.developmentUrl = DEVELOPMENT_URL
      state.dependencies.fetch = async () => ({ ok: true, status: 200, text: async () => '' })
      state.dependencies.runner = async (step) => ({ code: step.args[0] === sentinel ? 1 : 0 })
      await assert.rejects(runReleaseGate(state.options, state.dependencies), new RegExp(path.basename(sentinel)))
      assert.equal(state.evidence().failure.step, names.at(-1))
    } finally {
      state.close()
    }
  }
})

test('development uses explicit read-only probes and never falls back to another URL', async () => {
  const state = executionFixture('development')
  try {
    const requests = []
    state.dependencies.plan = compactPlan('development', state.evidence, ['development-read-only-health', 'development-integration'])
    state.dependencies.plan.steps.at(-1).args[0] = 'scripts/development-integration-sentinel.mjs'
    state.dependencies.developmentUrl = DEVELOPMENT_URL
    state.dependencies.fetch = async (url, init) => {
      requests.push({ url, init })
      return { ok: true, status: 200, text: async () => '' }
    }
    state.dependencies.runner = async ({ name }) => ({ code: name === 'development-integration' ? 1 : 0 })
    await assert.rejects(runReleaseGate(state.options, state.dependencies), /development-integration-sentinel\.mjs/i)
    assert.ok(requests.length >= 2)
    for (const request of requests) {
      assert.match(request.url, new RegExp(`^${DEVELOPMENT_URL.replaceAll('.', '\\.')}`))
      assert.ok(['GET', 'HEAD'].includes(request.init.method) || (
        request.init.method === 'POST' && /\/rest\/v1\/rpc\//.test(request.url) && request.init.headers?.apikey
      ))
    }
  } finally {
    state.close()
  }
})

test('development 5xx, timeout, and paused-project responses fail with resume guidance and no fallback', async () => {
  for (const response of [
    async () => ({ ok: false, status: 503, text: async () => '' }),
    async () => { throw Object.assign(new Error('timed out'), { name: 'AbortError' }) },
    async () => ({ ok: false, status: 404, text: async () => 'Project is paused' }),
  ]) {
    const state = executionFixture('development')
    try {
      const urls = []
      state.dependencies.plan = compactPlan('development', state.evidence, ['development-read-only-health', 'development-integration'])
      state.dependencies.developmentUrl = DEVELOPMENT_URL
      state.dependencies.fetch = async (...args) => {
        urls.push(args[0])
        return response(...args)
      }
      await assert.rejects(runReleaseGate(state.options, state.dependencies), /resume.*development.*project/i)
      assert.ok(urls.every((url) => url.startsWith(DEVELOPMENT_URL)))
      assert.ok(urls.every((url) => !url.includes(PRODUCTION_REF)))
    } finally {
      state.close()
    }
  }
})

test('evidence schema rejects missing, unknown, and malformed keys', () => {
  const valid = {
    schemaVersion: 2,
    revision: '7212072813f97d8c21266f5ec72a2b2bb6754967',
    mode: 'local',
    status: 'passed',
    startedAt: '2026-10-03T00:00:00.000Z',
    finishedAt: '2026-10-03T00:00:01.000Z',
    durationMs: 1000,
    developmentProjectFingerprint: null,
    productionProjectFingerprint: null,
    artifactManifest: { sha256: 'a'.repeat(64), fileCount: 2 },
    databaseTests: { steps: [{ name: 'test-database', count: 7 }], total: 7 },
    readinessEvidence: null,
    steps: [{ name: 'check', status: 'passed', startedAt: '2026-10-03T00:00:00.000Z', finishedAt: '2026-10-03T00:00:01.000Z', durationMs: 1000 }],
    failure: null,
  }
  assert.deepEqual(validateEvidence(valid), valid)
  for (const invalid of [
    { ...valid, unknown: true },
    Object.fromEntries(Object.entries(valid).filter(([key]) => key !== 'revision')),
    { ...valid, steps: [{ ...valid.steps[0], stdout: 'forbidden' }] },
    { ...valid, artifactManifest: { ...valid.artifactManifest, path: '/tmp/private' } },
    { ...valid, artifactManifest: { sha256: 'bad', fileCount: 0 } },
    { ...valid, databaseTests: { steps: [{ name: 'test-database', count: Number.MAX_SAFE_INTEGER + 1 }], total: 0 } },
    { ...valid, databaseTests: { steps: [{ name: 'test-database', count: 7 }], total: 8 } },
    { ...valid, status: 'failed', failure: null },
  ]) assert.throws(() => validateEvidence(invalid), /evidence/i)
})

test('evidence has revision, mode, UTC timing, step durations, artifact and database metadata, and project fingerprint only', async () => {
  const state = executionFixture('development')
  try {
    state.dependencies.plan = compactPlan('development', state.evidence, ['check'])
    await runReleaseGate(state.options, state.dependencies)
    const evidence = state.evidence()
    assert.deepEqual(Object.keys(evidence).sort(), [
      'artifactManifest', 'databaseTests', 'developmentProjectFingerprint', 'durationMs', 'failure', 'finishedAt', 'mode',
      'productionProjectFingerprint', 'readinessEvidence', 'revision', 'schemaVersion', 'startedAt', 'status', 'steps',
    ])
    assert.equal(evidence.revision, state.dependencies.revision)
    assert.equal(evidence.mode, 'development')
    assert.equal(evidence.developmentProjectFingerprint, state.options.projectFingerprint)
    assert.equal(evidence.productionProjectFingerprint, null)
    assert.ok(evidence.startedAt.endsWith('Z') && evidence.finishedAt.endsWith('Z'))
    assert.ok(evidence.steps.every((step) => Number.isInteger(step.durationMs)))
    assert.equal(evidence.artifactManifest, null)
    assert.equal(evidence.databaseTests, null)
    assert.equal(evidence.readinessEvidence, null)
  } finally {
    state.close()
  }
})

test('evidence excludes diagnostics, URLs, bodies, credentials, Markdown, and user data', async () => {
  const state = executionFixture('development')
  try {
    const forbidden = [
      DEVELOPMENT_URL,
      'stdout-private-user@example.com',
      'stderr-private-user@example.com',
      'eyJhbGciOiJIUzI1NiJ9.payload.signature',
      'sb_publishable_do-not-store',
      '# markdown heading',
    ]
    state.dependencies.plan = compactPlan('development', state.evidence, ['broken'])
    state.dependencies.runner = async ({ name }) => name === 'broken'
      ? { code: 1, stdout: forbidden.join(' '), stderr: forbidden.join(' ') }
      : { code: 0 }
    await assert.rejects(runReleaseGate(state.options, state.dependencies))
    const serialized = JSON.stringify(state.evidence())
    for (const value of forbidden) assert.equal(serialized.includes(value), false, value)
    assert.doesNotMatch(serialized, /stdout|stderr|environment|request|response|body|jwt|key/i)
  } finally {
    state.close()
  }
})

test('evidence is written to a temporary sibling and atomically renamed', async () => {
  const state = executionFixture()
  try {
    state.dependencies.plan = compactPlan('local', state.evidence, [])
    await runReleaseGate(state.options, state.dependencies)
    assert.equal(state.renames.length, 1)
    const [temporary, target] = state.renames[0]
    assert.equal(path.dirname(temporary), path.dirname(target))
    assert.equal(target, state.options.evidencePath)
    assert.notEqual(temporary, target)
    assert.match(path.basename(temporary), /^\.release\.json\..+\.tmp$/)
  } finally {
    state.close()
  }
})

test('failure evidence is unambiguously not successful release proof', async () => {
  const state = executionFixture()
  try {
    state.dependencies.plan = compactPlan('local', state.evidence, ['broken'])
    state.dependencies.runner = async ({ name }) => ({ code: name === 'broken' ? 1 : 0 })
    await assert.rejects(runReleaseGate(state.options, state.dependencies))
    const evidence = state.evidence()
    assert.equal(evidence.status, 'failed')
    assert.deepEqual(Object.keys(evidence.failure).sort(), ['kind', 'message', 'step'])
    assert.equal(evidence.steps.some((step) => step.status === 'failed'), true)
    assert.equal(evidence.failure.step, 'broken')
    assert.equal('releaseProof' in evidence, false)
  } finally {
    state.close()
  }
})

test('Task 16 sentinels are actionable and exit non-zero', () => {
  for (const file of ['community-e2e-sentinel.mjs', 'development-integration-sentinel.mjs']) {
    const result = spawnSync(process.execPath, [path.join(import.meta.dirname, file)], { encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(`${result.stdout}${result.stderr}`, /Task 16/i)
    assert.match(`${result.stdout}${result.stderr}`, /replace.*sentinel|implement/i)
  }
})

test('option parsing is pure with respect to argv, env, and context inputs', () => {
  const state = fixture()
  try {
    const argv = ['--evidence', state.evidence]
    const env = {}
    const context = { ...state.context }
    const snapshots = [structuredClone(argv), structuredClone(env), { ...context }]
    parseReleaseOptions(argv, env, context)
    assert.deepEqual(argv, snapshots[0])
    assert.deepEqual(env, snapshots[1])
    assert.deepEqual(context, snapshots[2])
  } finally {
    state.close()
  }
})

test('binds passed reproducibility evidence to identical manifest bytes and exact file count', async () => {
  const state = executionFixture()
  try {
    const manifest = 'aaa  ./index.html\nbbb  ./assets/app.js\n'
    const manifestPaths = [
      '/tmp/breadlab-community-release-manifests/build-1.sha256',
      '/tmp/breadlab-community-release-manifests/build-2.sha256',
    ]
    const reads = []
    state.dependencies.plan = compactPlan('local', state.evidence, ['test-database', 'verify-site-reproducibility'])
    state.dependencies.runner = async ({ name }) => ({
      code: 0,
      stdout: name === 'test-database' ? 'runner detail\nTests=7\nprivate-user@example.com\n' : '',
    })
    state.dependencies.filesystem.readFile = async (file) => {
      reads.push(file)
      if (manifestPaths.includes(file)) return Buffer.from(manifest)
      throw new Error('unexpected read')
    }
    const evidence = await runReleaseGate(state.options, state.dependencies)
    assert.deepEqual(reads, manifestPaths)
    assert.deepEqual(evidence.artifactManifest, {
      sha256: createHash('sha256').update(Buffer.from(manifest)).digest('hex'),
      fileCount: 2,
    })
    assert.deepEqual(evidence.databaseTests, {
      steps: [{ name: 'test-database', count: 7 }],
      total: 7,
    })
    const serialized = JSON.stringify(evidence)
    assert.equal(serialized.includes('build-1.sha256'), false)
    assert.equal(serialized.includes('index.html'), false)
    assert.equal(serialized.includes('private-user@example.com'), false)
  } finally {
    state.close()
  }
})

test('fails closed when passed reproducibility manifests are missing, mismatched, or empty', async () => {
  for (const scenario of ['missing', 'mismatched', 'empty']) {
    const state = executionFixture()
    try {
      state.dependencies.plan = compactPlan('local', state.evidence, ['verify-site-reproducibility'])
      state.dependencies.filesystem.readFile = async (file) => {
        if (scenario === 'missing' && file.endsWith('build-2.sha256')) throw new Error('missing private path')
        if (scenario === 'empty') return Buffer.from('')
        return Buffer.from(file.endsWith('build-1.sha256') ? 'aaa  ./one\n' : 'bbb  ./two\n')
      }
      await assert.rejects(runReleaseGate(state.options, state.dependencies), /manifest/i, scenario)
      assert.equal(state.evidence().status, 'failed', scenario)
      assert.equal(state.evidence().artifactManifest, null, scenario)
    } finally {
      state.close()
    }
  }
})

test('database helpers may omit summaries, stderr summaries are counted, and the real plan continues past storage upgrade', async () => {
  const state = executionFixture()
  try {
    const calls = []
    const rawDetail = 'private-storage-upgrade-detail@example.com'
    state.dependencies.plan = compactPlan('local', state.evidence, [
      'test-storage-upgrade',
      'test-public-listing-upgrade',
      'test-database',
      'after-database',
    ])
    state.dependencies.runner = async ({ name }) => {
      calls.push(name)
      if (name === 'test-storage-upgrade') return { code: 0, stdout: `ok - upgraded\n${rawDetail}\n`, stderr: '' }
      if (name === 'test-public-listing-upgrade') return { code: 0, stdout: '', stderr: 'ok 1\nTests=3\n' }
      if (name === 'test-database') return { code: 0, stdout: '', stderr: '1..7\nTests=7\n' }
      return { code: 0, stdout: '', stderr: '' }
    }

    const evidence = await runReleaseGate(state.options, state.dependencies)

    assert.deepEqual(calls, [
      'test-storage-upgrade',
      'test-public-listing-upgrade',
      'test-database',
      'after-database',
      'cleanup-local-supabase',
    ])
    assert.deepEqual(evidence.databaseTests, {
      steps: [
        { name: 'test-public-listing-upgrade', count: 3 },
        { name: 'test-database', count: 7 },
      ],
      total: 10,
    })
    assert.equal(JSON.stringify(evidence).includes(rawDetail), false)
  } finally {
    state.close()
  }
})

test('database helper summaries fail closed when explicitly malformed or unsafe', async () => {
  for (const [summary, expected] of [
    ['Tests=1.5\n', /Tests=/i],
    [`Tests=${Number.MAX_SAFE_INTEGER + 1}\n`, /safe integer/i],
  ]) {
    const state = executionFixture()
    try {
      state.dependencies.plan = compactPlan('local', state.evidence, ['test-storage-upgrade', 'never'])
      state.dependencies.runner = async ({ name }) => ({
        code: 0,
        stdout: name === 'test-storage-upgrade' ? summary : '',
        stderr: '',
      })
      await assert.rejects(runReleaseGate(state.options, state.dependencies), expected)
      assert.equal(state.evidence().databaseTests, null)
      assert.deepEqual(state.evidence().steps.map(({ name }) => name), ['test-storage-upgrade', 'cleanup-local-supabase'])
    } finally {
      state.close()
    }
  }
})

test('database test counts are null before tests and malformed or unsafe summaries fail closed', async () => {
  for (const [stdout, expected] of [
    ['', /Tests=/i],
    ['Tests=1.5\n', /Tests=/i],
    [`Tests=${Number.MAX_SAFE_INTEGER + 1}\n`, /safe integer/i],
  ]) {
    const state = executionFixture()
    try {
      state.dependencies.plan = compactPlan('local', state.evidence, ['before', 'test-database'])
      state.dependencies.runner = async ({ name }) => ({ code: 0, stdout: name === 'test-database' ? stdout : '' })
      await assert.rejects(runReleaseGate(state.options, state.dependencies), expected)
      assert.equal(state.evidence().databaseTests, null)
    } finally {
      state.close()
    }
  }
  const state = executionFixture()
  try {
    state.dependencies.plan = compactPlan('local', state.evidence, ['broken', 'test-database'])
    state.dependencies.runner = async ({ name }) => ({ code: name === 'broken' ? 1 : 0, stdout: 'Tests=99\n' })
    await assert.rejects(runReleaseGate(state.options, state.dependencies))
    assert.equal(state.evidence().databaseTests, null)
  } finally {
    state.close()
  }
})

test('development body timeout uses resume guidance without fallback or body persistence', async () => {
  const state = executionFixture('development')
  try {
    const bodySecret = 'body-private-user@example.com'
    const urls = []
    const controller = new AbortController()
    state.dependencies.plan = compactPlan('development', state.evidence, ['development-read-only-health'])
    state.dependencies.developmentUrl = DEVELOPMENT_URL
    state.dependencies.probeSignal = () => controller.signal
    state.dependencies.fetch = async (url) => {
      urls.push(url)
      return {
        ok: true,
        status: 200,
        text: async () => {
          queueMicrotask(() => controller.abort(new Error(bodySecret)))
          return new Promise(() => {})
        },
      }
    }
    await assert.rejects(runReleaseGate(state.options, state.dependencies), /resume.*development.*project/i)
    assert.deepEqual(urls, [`${DEVELOPMENT_URL}/auth/v1/health`])
    assert.equal(JSON.stringify(state.evidence()).includes(bodySecret), false)
  } finally {
    state.close()
  }
})

test('tombstones stale success before removal and runs no steps when removal fails', async () => {
  const state = executionFixture()
  try {
    const calls = []
    const staleSuccess = JSON.stringify({ status: 'passed', stale: true })
    state.writes.set(state.options.evidencePath, staleSuccess)
    state.dependencies.plan = compactPlan('local', state.options.evidencePath, ['never'])
    state.dependencies.filesystem.rm = async (file) => {
      if (file === state.options.evidencePath) throw new Error('cannot invalidate output')
    }
    state.dependencies.runner = async ({ name }) => {
      calls.push(name)
      return { code: 0 }
    }
    await assert.rejects(runReleaseGate(state.options, state.dependencies), /invalidate.*evidence/i)
    assert.deepEqual(calls, [])
    const remaining = state.writes.get(state.options.evidencePath)
    assert.notEqual(remaining, staleSuccess)
    assert.equal(/"status"\s*:\s*"passed"/.test(remaining), false)
    assert.throws(() => validateEvidence(JSON.parse(remaining)), /evidence/i)
  } finally {
    state.close()
  }
})

test('runs no steps or removal when stale evidence cannot be tombstoned', async () => {
  const state = executionFixture()
  try {
    const calls = []
    const removals = []
    const staleSuccess = JSON.stringify({ status: 'passed', stale: true })
    state.writes.set(state.options.evidencePath, staleSuccess)
    state.dependencies.plan = compactPlan('local', state.options.evidencePath, ['never'])
    state.dependencies.filesystem.writeFile = async (file) => {
      if (file === state.options.evidencePath) throw new Error('target is not writable')
      throw new Error('unexpected publication write')
    }
    state.dependencies.filesystem.rm = async (file) => removals.push(file)
    state.dependencies.runner = async ({ name }) => {
      calls.push(name)
      return { code: 0 }
    }

    await assert.rejects(runReleaseGate(state.options, state.dependencies), /invalidate.*write.*evidence/i)

    assert.deepEqual(calls, [])
    assert.deepEqual(removals, [])
    assert.equal(state.writes.get(state.options.evidencePath), staleSuccess)
  } finally {
    state.close()
  }
})

test('publication write or rename failure cannot leave pre-existing success evidence visible', async () => {
  for (const scenario of ['write', 'rename']) {
    const state = executionFixture()
    try {
      state.writes.set(state.options.evidencePath, JSON.stringify({ status: 'passed', stale: true }))
      state.dependencies.plan = compactPlan('local', state.options.evidencePath, [])
      const baseWrite = state.dependencies.filesystem.writeFile
      state.dependencies.filesystem.rm = async (file) => state.writes.delete(file)
      state.dependencies.filesystem.writeFile = async (file, contents) => {
        if (scenario === 'write' && file !== state.options.evidencePath) throw new Error('publication write failed')
        return baseWrite(file, contents)
      }
      state.dependencies.filesystem.rename = async () => { throw new Error('publication rename failed') }
      await assert.rejects(runReleaseGate(state.options, state.dependencies), new RegExp(`publication ${scenario} failed`))
      assert.equal(state.writes.has(state.options.evidencePath), false, scenario)
      assert.equal([...state.writes.values()].some((contents) => /"status"\s*:\s*"passed"/.test(contents)), false, scenario)
    } finally {
      state.close()
    }
  }
})

test('production readiness never invalidates an input evidence path selected as output', async () => {
  const state = executionFixture('production-readiness')
  try {
    const removals = []
    state.options.evidencePath = state.options.localE2eEvidencePath
    state.dependencies.filesystem.rm = async (file) => removals.push(file)
    await assert.rejects(runReleaseGate(state.options, state.dependencies), /output evidence.*differ.*input evidence/i)
    assert.deepEqual(removals, [])
  } finally {
    state.close()
  }
})

test('default runner suppresses raw child stdout and stderr from terminal and evidence', () => {
  const childOutput = [
    'sb_secret_do-not-print',
    'eyJhbGciOiJIUzI1NiJ9.payload.signature',
    'https://abcdefghijklmnopqrst.supabase.co',
    'private-user@example.com',
  ].join(' ')
  const program = `
    import { EventEmitter } from 'node:events'
    import { runReleaseGate } from './scripts/release-gate.mjs'
    const writes = new Map()
    const evidencePath = '/tmp/release-gate-secret-output-test.json'
    const fakeSpawn = () => {
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = () => true
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from(${JSON.stringify(childOutput)}))
        child.stderr.emit('data', Buffer.from(${JSON.stringify(childOutput)}))
        child.emit('close', 0, null)
      })
      return child
    }
    const evidence = await runReleaseGate(
      { mode: 'local', evidencePath },
      {
        revision: '7212072813f97d8c21266f5ec72a2b2bb6754967',
        plan: {
          mode: 'local',
          evidencePath,
          steps: [{ name: 'check', command: 'node', args: ['check.mjs'], environment: {} }],
        },
        spawn: fakeSpawn,
        filesystem: {
          writeFile: async (file, contents) => writes.set(file, contents),
          rename: async (from, to) => { writes.set(to, writes.get(from)); writes.delete(from) },
          rm: async (file) => writes.delete(file),
        },
      },
    )
    console.log(JSON.stringify(evidence))
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', program], {
    cwd: path.resolve(import.meta.dirname, '..'),
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  const evidence = JSON.parse(result.stdout)
  for (const secret of childOutput.split(' ')) {
    assert.equal(result.stdout.includes(secret), false, secret)
    assert.equal(result.stderr.includes(secret), false, secret)
    assert.equal(JSON.stringify(evidence).includes(secret), false, secret)
  }
})
