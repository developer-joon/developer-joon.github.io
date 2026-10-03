#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstatSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
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
    context,
    close: () => rmSync(root, { recursive: true, force: true }),
  }
}

function parse(argv = [], env = {}, updateContext = {}) {
  const state = fixture()
  try {
    return parseReleaseOptions(
      argv.length === 0 ? ['--evidence', state.evidence] : argv.map((value) => value === '$EVIDENCE' ? state.evidence : value),
      env,
      { ...state.context, ...updateContext },
    )
  } finally {
    state.close()
  }
}

test('defaults to local mode and builds the exact ordered local plan', () => {
  const options = parse()
  assert.equal(options.mode, 'local')
  assert.deepEqual(buildReleasePlan(options).steps.map(({ name }) => name), LOCAL_STEP_NAMES)
})

test('accepts only the three release modes', () => {
  for (const mode of ['local', 'development', 'production-readiness']) {
    const env = mode === 'development'
      ? { DEVELOPMENT_SUPABASE_URL: DEVELOPMENT_URL, ALLOW_DEVELOPMENT_CLOUD_READS: '1' }
      : mode === 'production-readiness'
        ? {
            DEVELOPMENT_PROJECT_FINGERPRINT: projectFingerprint(DEVELOPMENT_URL),
            PRODUCTION_PROJECT_FINGERPRINT: projectFingerprint(PRODUCTION_URL),
            ALLOW_PRODUCTION_READINESS: '1',
          }
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
      {
        ...fingerprints,
        PRODUCTION_PROJECT_FINGERPRINT: fingerprints.DEVELOPMENT_PROJECT_FINGERPRINT,
        ALLOW_PRODUCTION_READINESS: '1',
      },
    ),
    /must be distinct/i,
  )
  assert.throws(
    () => parse(
      ['--mode', 'production-readiness', '--evidence', '$EVIDENCE'],
      { ...fingerprints, DEVELOPMENT_PROJECT_FINGERPRINT: 'not-a-digest', ALLOW_PRODUCTION_READINESS: '1' },
    ),
    /SHA-256 fingerprint/i,
  )
})

test('production readiness rejects URL and explicit fingerprint disagreements before identity comparison', () => {
  const optIn = { ALLOW_PRODUCTION_READINESS: '1' }
  assert.throws(
    () => parse(
      ['--mode', 'production-readiness', '--evidence', '$EVIDENCE'],
      {
        ...optIn,
        DEVELOPMENT_SUPABASE_URL: DEVELOPMENT_URL,
        DEVELOPMENT_PROJECT_FINGERPRINT: projectFingerprint(PRODUCTION_URL),
        PRODUCTION_PROJECT_FINGERPRINT: projectFingerprint(PRODUCTION_URL),
      },
    ),
    /DEVELOPMENT_PROJECT_FINGERPRINT must match DEVELOPMENT_SUPABASE_URL/i,
  )
  assert.throws(
    () => parse(
      ['--mode', 'production-readiness', '--evidence', '$EVIDENCE'],
      {
        ...optIn,
        DEVELOPMENT_SUPABASE_URL: DEVELOPMENT_URL,
        DEVELOPMENT_PROJECT_FINGERPRINT: projectFingerprint(DEVELOPMENT_URL),
        PRODUCTION_SUPABASE_URL: DEVELOPMENT_URL,
        PRODUCTION_PROJECT_FINGERPRINT: projectFingerprint(PRODUCTION_URL),
      },
    ),
    /PRODUCTION_PROJECT_FINGERPRINT must match PRODUCTION_SUPABASE_URL/i,
  )
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
    'production-readiness': {
      DEVELOPMENT_PROJECT_FINGERPRINT: projectFingerprint(DEVELOPMENT_URL),
      PRODUCTION_PROJECT_FINGERPRINT: projectFingerprint(PRODUCTION_URL),
      ALLOW_PRODUCTION_READINESS: '1',
    },
  }
  for (const [mode, env] of Object.entries(modeEnvironments)) {
    const plan = buildReleasePlan(parse(['--mode', mode, '--evidence', '$EVIDENCE'], env))
    assert.ok(Object.isFrozen(plan))
    assert.ok(Object.isFrozen(plan.steps))
    for (const step of plan.steps) {
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
    schemaVersion: 1,
    revision: '7212072813f97d8c21266f5ec72a2b2bb6754967',
    mode: 'local',
    status: 'passed',
    startedAt: '2026-10-03T00:00:00.000Z',
    finishedAt: '2026-10-03T00:00:01.000Z',
    durationMs: 1000,
    projectFingerprint: null,
    artifactManifests: ['build-1.sha256', 'build-2.sha256'],
    steps: [{ name: 'check', status: 'passed', startedAt: '2026-10-03T00:00:00.000Z', finishedAt: '2026-10-03T00:00:01.000Z', durationMs: 1000 }],
    failure: null,
  }
  assert.deepEqual(validateEvidence(valid), valid)
  for (const invalid of [
    { ...valid, unknown: true },
    Object.fromEntries(Object.entries(valid).filter(([key]) => key !== 'revision')),
    { ...valid, steps: [{ ...valid.steps[0], stdout: 'forbidden' }] },
    { ...valid, status: 'failed', failure: null },
  ]) assert.throws(() => validateEvidence(invalid), /evidence/i)
})

test('evidence has revision, mode, UTC timing, step durations, manifests, and project fingerprint only', async () => {
  const state = executionFixture('development')
  try {
    state.dependencies.plan = compactPlan('development', state.evidence, ['check'])
    await runReleaseGate(state.options, state.dependencies)
    const evidence = state.evidence()
    assert.deepEqual(Object.keys(evidence).sort(), [
      'artifactManifests', 'durationMs', 'failure', 'finishedAt', 'mode', 'projectFingerprint',
      'revision', 'schemaVersion', 'startedAt', 'status', 'steps',
    ])
    assert.equal(evidence.revision, state.dependencies.revision)
    assert.equal(evidence.mode, 'development')
    assert.equal(evidence.projectFingerprint, state.options.projectFingerprint)
    assert.ok(evidence.startedAt.endsWith('Z') && evidence.finishedAt.endsWith('Z'))
    assert.ok(evidence.steps.every((step) => Number.isInteger(step.durationMs)))
    assert.deepEqual(evidence.artifactManifests, ['build-1.sha256', 'build-2.sha256'])
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
