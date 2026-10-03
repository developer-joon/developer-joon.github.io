#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdtemp, mkdir, readdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('pins a non-root unified Docker build toolchain', async () => {
  const dockerfile = await readFile(path.join(repoRoot, 'Dockerfile.build'), 'utf8')
  assert.match(dockerfile, /ARG SITE_BUILD_PLATFORM=linux\/amd64/)
  assert.match(dockerfile, /FROM --platform=\$\{SITE_BUILD_PLATFORM\} node:24\.15\.0-bookworm-slim@sha256:152aceace5c03e2597988763165ee33e3fd3633636db0fc983cd2e126b02cfde AS node-runtime/)
  assert.match(dockerfile, /FROM --platform=\$\{SITE_BUILD_PLATFORM\} ruby:3\.3\.10-bookworm@sha256:[a-f0-9]{64} AS build/)
  assert.match(dockerfile, /gem install bundler --version 2\.5\.22/)
  assert.match(dockerfile, /chown site-builder:site-builder \/work/)
  assert.match(dockerfile, /USER site-builder/)
  assert.match(dockerfile, /RUN test "\$\(id -u\)" != 0 && \.\/scripts\/build-site\.sh/)
})

test('aligns the workflow and package engine with the supported Docker toolchain pins', async () => {
  const workflow = await readFile(path.join(repoRoot, '.github/workflows/jekyll.yml'), 'utf8')
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'community-app/package.json'), 'utf8'))
  const packageLock = JSON.parse(await readFile(path.join(repoRoot, 'community-app/package-lock.json'), 'utf8'))

  assert.match(workflow, /node-version: ['"]24\.15\.0['"]/, 'workflow must use the exact Docker Node version')
  assert.match(workflow, /ruby-version: ['"]3\.3\.10['"]/, 'workflow must use the exact Docker Ruby version')
  assert.equal(packageJson.engines.node, '^24.15.0')
  assert.equal(packageLock.packages[''].engines.node, '^24.15.0')
})

test('excludes repository build definitions from the Jekyll artifact', async () => {
  const config = await readFile(path.join(repoRoot, '_config.yml'), 'utf8')
  const excludedEntries = config.split('\n').map((line) => line.trim())
  for (const excluded of ['Dockerfile.build', '.dockerignore', 'Gemfile', 'Gemfile.lock']) {
    assert.ok(excludedEntries.includes(`- ${excluded}`), `${excluded} is not excluded`)
  }
})

test('excludes local credentials and Supabase CLI state from the Docker build context', async () => {
  const dockerignore = (await readFile(path.join(repoRoot, '.dockerignore'), 'utf8'))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  for (const excluded of ['**/.env*', 'supabase/.temp', 'supabase/.branches']) {
    assert.ok(dockerignore.includes(excluded), `${excluded} is not excluded from the Docker build context`)
  }
  assert.ok(
    dockerignore.includes('/_site*'),
    'every root-level generated site export must be excluded from the Docker build context',
  )
})

test('build helper pins the output platform', async () => {
  const helper = await readFile(path.join(repoRoot, 'scripts/build-site-docker.sh'), 'utf8')
  assert.match(helper, /docker build --platform linux\/amd64 /)
})

test('site build time defaults to the current commit timestamp and validates overrides', () => {
  const resolver = path.join(repoRoot, 'scripts/resolve-site-build-time.sh')
  const commitTime = spawnSync('git', ['log', '-1', '--format=%cI'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).stdout.trim()

  const derived = spawnSync(resolver, [], { cwd: repoRoot, encoding: 'utf8', env: { ...process.env, SITE_BUILD_TIME: '' } })
  assert.equal(derived.status, 0, derived.stderr)
  assert.equal(derived.stdout.trim(), commitTime)

  const override = '2026-01-02T03:04:05+00:00'
  const explicit = spawnSync(resolver, [], { cwd: repoRoot, encoding: 'utf8', env: { ...process.env, SITE_BUILD_TIME: override } })
  assert.equal(explicit.status, 0, explicit.stderr)
  assert.equal(explicit.stdout.trim(), override)

  const invalid = spawnSync(resolver, [], { cwd: repoRoot, encoding: 'utf8', env: { ...process.env, SITE_BUILD_TIME: 'not-a-time' } })
  assert.notEqual(invalid.status, 0)
  assert.match(invalid.stderr, /SITE_BUILD_TIME must be an ISO 8601 timestamp/)
})

test('propagates one deterministic build timestamp through local, Docker, and CI builds', async () => {
  const [localBuild, dockerBuild, dockerfile, workflow] = await Promise.all([
    readFile(path.join(repoRoot, 'scripts/build-site.sh'), 'utf8'),
    readFile(path.join(repoRoot, 'scripts/build-site-docker.sh'), 'utf8'),
    readFile(path.join(repoRoot, 'Dockerfile.build'), 'utf8'),
    readFile(path.join(repoRoot, '.github/workflows/jekyll.yml'), 'utf8'),
  ])

  assert.match(localBuild, /resolve-site-build-time\.sh/)
  assert.match(localBuild, /printf 'time: "%s"\\n' "\$site_build_time" > "\$build_time_config"/)
  assert.match(localBuild, /bundle exec jekyll build --config _config\.yml,"\$build_time_config" --destination _site/)
  assert.match(dockerBuild, /--build-arg SITE_BUILD_TIME="\$site_build_time"/)
  assert.match(dockerfile, /ARG SITE_BUILD_TIME/)
  assert.match(dockerfile, /SITE_BUILD_TIME=\$SITE_BUILD_TIME/)
  assert.match(workflow, /SITE_BUILD_TIME=\$\(git log -1 --format=%cI\)/)
  assert.match(workflow, /run: \.\/scripts\/build-site\.sh/)
})

test('builds community snapshots from fixtures by default and requires live credentials explicitly', async () => {
  const build = await readFile(path.join(repoRoot, 'scripts/build-site.sh'), 'utf8')
  const snapshotTest = 'node --test scripts/community-snapshots.test.mjs'
  const viteBuild = 'npm --prefix community-app run build'
  const assembleCommunity = 'cp -a community-app/dist/. _site/community/'
  const generateSnapshots = 'node scripts/community-snapshots.mjs --output _site/community/content --sitemap _site/sitemap.xml'

  assert.ok(build.includes(snapshotTest), 'snapshot tests must be part of the site build')
  assert.ok(build.indexOf(snapshotTest) < build.indexOf(viteBuild), 'snapshot tests must run before the site build')
  assert.ok(build.indexOf(generateSnapshots) > build.indexOf(assembleCommunity), 'snapshots must be generated after Jekyll and Vite assembly')
  assert.match(build, /COMMUNITY_SNAPSHOT_MODE:-fixture/)
  assert.match(build, /node scripts\/community-snapshots\.mjs --output _site\/community\/content --sitemap _site\/sitemap\.xml --fixture scripts\/fixtures\/community-snapshots\.json/)
  assert.match(build, /SUPABASE_URL:\?SUPABASE_URL is required in live mode/)
  assert.match(build, /SUPABASE_PUBLISHABLE_KEY:\?SUPABASE_PUBLISHABLE_KEY is required in live mode/)
})

test('keeps Pages upload and deploy in the reusable Jekyll workflow with live snapshot credentials', async () => {
  const workflow = await readFile(path.join(repoRoot, '.github/workflows/jekyll.yml'), 'utf8')
  const workflowDirectory = path.join(repoRoot, '.github/workflows')
  const workflowFiles = await readdir(workflowDirectory)
  const allWorkflows = await Promise.all(workflowFiles
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .map((file) => readFile(path.join(workflowDirectory, file), 'utf8')))

  assert.match(workflow, /workflow_call:/)
  assert.match(workflow, /COMMUNITY_SNAPSHOT_MODE: live/)
  assert.match(workflow, /SUPABASE_URL: \$\{\{ vars\.SUPABASE_URL \}\}/)
  assert.match(workflow, /SUPABASE_PUBLISHABLE_KEY: \$\{\{ secrets\.SUPABASE_PUBLISHABLE_KEY \}\}/)
  assert.doesNotMatch(workflow, /SERVICE_ROLE/)
  assert.doesNotMatch(workflow, /contents: write/)
  assert.equal((workflow.match(/actions\/upload-pages-artifact@v3/g) ?? []).length, 1)
  assert.equal((workflow.match(/actions\/deploy-pages@v4/g) ?? []).length, 1)
  assert.equal(allWorkflows.filter((contents) => /upload-pages-artifact|deploy-pages/.test(contents)).length, 1)
})

test('hourly snapshot workflow calls the sole Pages deployment workflow', async () => {
  const caller = await readFile(path.join(repoRoot, '.github/workflows/community-snapshots.yml'), 'utf8')

  assert.match(caller, /cron: ['"]17 \* \* \* \*['"]/)
  assert.match(caller, /uses: \.\/\.github\/workflows\/jekyll\.yml/)
  assert.match(caller, /SUPABASE_PUBLISHABLE_KEY: \$\{\{ secrets\.SUPABASE_PUBLISHABLE_KEY \}\}/)
  assert.match(caller, /permissions:\s+contents: read\s+pages: write\s+id-token: write/)
  assert.doesNotMatch(caller, /upload-pages-artifact|deploy-pages/)
  assert.doesNotMatch(caller, /contents: write|SERVICE_ROLE/)
})

test('exposes one non-deploying release check without hosted-write package shortcuts', async () => {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'community-app/package.json'), 'utf8'))
  const scripts = packageJson.scripts ?? {}

  assert.equal(scripts['release:check'], 'node ../scripts/release-gate.mjs')
  assert.deepEqual(Object.keys(scripts).filter((name) => name.startsWith('release:')), ['release:check'])
  for (const [name, command] of Object.entries(scripts)) {
    assert.doesNotMatch(name, /deploy|production|canary/i, `unsafe package script name: ${name}`)
    assert.doesNotMatch(command, /\b(?:supabase\s+db\s+push|supabase\s+functions\s+deploy|community-production-canary|deploy-pages)\b/i, `hosted-write package shortcut: ${name}`)
  }
})

test('ordinary CI and build paths remain fixture-backed and never invoke release check', async () => {
  const workflowDirectory = path.join(repoRoot, '.github/workflows')
  const workflowFiles = (await readdir(workflowDirectory)).filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
  const workflows = await Promise.all(workflowFiles.map((file) => readFile(path.join(workflowDirectory, file), 'utf8')))
  const build = await readFile(path.join(repoRoot, 'scripts/build-site.sh'), 'utf8')

  assert.match(build, /COMMUNITY_SNAPSHOT_MODE:-fixture/)
  assert.doesNotMatch(build, /release:check|release-gate\.mjs/)
  for (const workflow of workflows) assert.doesNotMatch(workflow, /release:check|release-gate\.mjs/)
})

test('reproducibility verifier writes sorted manifests and rejects byte differences', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'site-repro-'))
  const first = path.join(root, 'first')
  const second = path.join(root, 'second')
  const evidence = path.join(root, 'evidence')
  await mkdir(path.join(first, 'nested'), { recursive: true })
  await mkdir(path.join(second, 'nested'), { recursive: true })
  await writeFile(path.join(first, 'z.txt'), 'same\n')
  await writeFile(path.join(first, 'nested/a.txt'), 'also same\n')
  await writeFile(path.join(second, 'z.txt'), 'same\n')
  await writeFile(path.join(second, 'nested/a.txt'), 'also same\n')

  const verifier = path.join(repoRoot, 'scripts/verify-site-reproducibility.sh')
  const identical = spawnSync(verifier, [first, second, evidence], { cwd: repoRoot, encoding: 'utf8' })
  assert.equal(identical.status, 0, identical.stderr)
  const firstManifest = await readFile(path.join(evidence, 'build-1.sha256'), 'utf8')
  const secondManifest = await readFile(path.join(evidence, 'build-2.sha256'), 'utf8')
  assert.equal(firstManifest, secondManifest)
  assert.deepEqual(firstManifest.trim().split('\n').map((line) => line.split('  ')[1]), ['./nested/a.txt', './z.txt'])

  await writeFile(path.join(second, 'z.txt'), 'different\n')
  const different = spawnSync(verifier, [first, second, evidence], { cwd: repoRoot, encoding: 'utf8' })
  assert.notEqual(different.status, 0)
  assert.match(different.stderr, /not byte-reproducible/)
})

test('tracks the locked Ruby dependency graph used by the container build', () => {
  const result = spawnSync('git', ['ls-files', '--error-unmatch', 'Gemfile.lock'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr || 'Gemfile.lock is not tracked')
})
