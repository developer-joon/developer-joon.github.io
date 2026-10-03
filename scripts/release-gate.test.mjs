#!/usr/bin/env node

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstatSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildReleasePlan,
  parseReleaseOptions,
  projectFingerprint,
  runReleaseGate,
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

test('runReleaseGate fails closed until Task 2 implements execution', async () => {
  const options = parse()
  await assert.rejects(
    runReleaseGate(options, {}),
    /Task 2.*not implemented/i,
  )
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
