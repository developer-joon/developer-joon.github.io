#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('pins a non-root unified Docker build toolchain', async () => {
  const dockerfile = await readFile(path.join(repoRoot, 'Dockerfile.build'), 'utf8')
  assert.match(dockerfile, /ARG SITE_BUILD_PLATFORM=linux\/amd64/)
  assert.match(dockerfile, /FROM --platform=\$\{SITE_BUILD_PLATFORM\} node:24\.11\.1-bookworm-slim@sha256:[a-f0-9]{64} AS node-runtime/)
  assert.match(dockerfile, /FROM --platform=\$\{SITE_BUILD_PLATFORM\} ruby:3\.3\.10-bookworm@sha256:[a-f0-9]{64} AS build/)
  assert.match(dockerfile, /gem install bundler --version 2\.5\.22/)
  assert.match(dockerfile, /chown site-builder:site-builder \/work/)
  assert.match(dockerfile, /USER site-builder/)
  assert.match(dockerfile, /RUN test "\$\(id -u\)" != 0 && \.\/scripts\/build-site\.sh/)
})

test('build helper pins the output platform', async () => {
  const helper = await readFile(path.join(repoRoot, 'scripts/build-site-docker.sh'), 'utf8')
  assert.match(helper, /docker build --platform linux\/amd64 /)
})

test('tracks the locked Ruby dependency graph used by the container build', () => {
  const result = spawnSync('git', ['ls-files', '--error-unmatch', 'Gemfile.lock'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr || 'Gemfile.lock is not tracked')
})
