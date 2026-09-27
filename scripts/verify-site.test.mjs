#!/usr/bin/env node

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const verifier = path.join(repoRoot, 'scripts/verify-site.mjs')
const shellTitles = new Map([
  ['community/index.html', '<title>Breadlab 커뮤니티</title>'],
  ['community/write/index.html', '<title>글쓰기 | Breadlab 커뮤니티</title>'],
  ['community/post/index.html', '<title>게시글 | Breadlab 커뮤니티</title>'],
  ['community/edit/index.html', '<title>글 수정 | Breadlab 커뮤니티</title>'],
  ['community/admin/reports/index.html', '<title>신고 관리 | Breadlab 커뮤니티</title>'],
  ['community/auth/callback/index.html', '<title>로그인 처리 | Breadlab 커뮤니티</title>'],
])

async function put(root, relativePath, content = '') {
  const destination = path.join(root, relativePath)
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(destination, content)
}

async function makeValidArtifact() {
  const root = await mkdtemp(path.join(tmpdir(), 'verify-site-test-'))
  const routes = [
    ['index.html', '<title>Ria & Seoa PaPa – 0 → 1</title>', 'https://www.breadlab.ai/', '<a href="/community/">Community</a>'],
    ['blog/index.html', '<title>Blog – Ria & Seoa PaPa</title>', 'https://www.breadlab.ai/blog/', ''],
    ['lab/index.html', '<title>0 → 1 – Ria & Seoa PaPa</title>', 'https://www.breadlab.ai/lab/', ''],
    ['blog/ceph-cluster-install-with-helm.html', '<title>[Kubernets] Ceph Cluster install with helm – Ria & Seoa PaPa</title>', 'https://www.breadlab.ai/blog/ceph-cluster-install-with-helm', ''],
    ['404.html', '<title>Page Not Found – Ria & Seoa PaPa</title>', 'https://www.breadlab.ai/404.html', ''],
  ]
  for (const [relativePath, title, canonical, body] of routes) {
    await put(root, relativePath, `${title}<link rel="canonical" href="${canonical}">${body}`)
  }
  for (const [relativePath, title] of shellTitles) {
    await put(root, relativePath, `${title}<script type="module" src="/community/assets/main-Ab12Cd34.js"></script>`)
  }
  await put(root, 'privacy.html', '<title>개인정보처리방침 – Ria & Seoa PaPa</title><link rel="canonical" href="https://www.breadlab.ai/privacy">GitHub OAuth 처리 완료 후 최대 3년')
  await put(root, 'CNAME', 'www.breadlab.ai\n')
  await put(root, 'robots.txt', 'User-agent: *\nAllow: /\nSitemap: https://www.breadlab.ai/sitemap.xml\n')
  await put(root, 'sitemap.xml', [
    'https://www.breadlab.ai/',
    'https://www.breadlab.ai/blog/',
    'https://www.breadlab.ai/lab/',
    'https://www.breadlab.ai/blog/ceph-cluster-install-with-helm',
    'https://www.breadlab.ai/privacy',
  ].map((location) => `<loc>${location}</loc>`).join('\n'))
  for (const relativePath of [
    'css/style.css',
    'js/personal-min.js',
    'images/favicon.ico',
    'images/generated.png',
    'fonts/generated.woff2',
    'notes/generated.txt',
    'community/assets/main-Ab12Cd34.js',
  ]) {
    await put(root, relativePath)
  }
  return root
}

function verify(root) {
  return spawnSync(process.execPath, [verifier, root], { encoding: 'utf8' })
}

async function withArtifact(run) {
  const root = await makeValidArtifact()
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('accepts a minimal valid generated artifact', async () => {
  await withArtifact(async (root) => {
    const result = verify(root)
    assert.equal(result.status, 0, result.stderr)
  })
})

test('rejects unhashed local JavaScript referenced by every community shell', async () => {
  await withArtifact(async (root) => {
    await put(root, 'community/assets/main.js')
    for (const [relativePath, title] of shellTitles) {
      await put(root, relativePath, `${title}<script type="module" src="/community/assets/main.js"></script>`)
    }
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted unhashed shell assets')
    assert.match(result.stderr, /content-hashed/)
  })
})

test('rejects an unhashed local stylesheet referenced by a community shell', async () => {
  await withArtifact(async (root) => {
    await put(root, 'community/assets/styles.css')
    const [relativePath, title] = shellTitles.entries().next().value
    await put(root, relativePath, `${title}<script type="module" src="/community/assets/main-Ab12Cd34.js"></script><link rel="stylesheet" href="/community/assets/styles.css">`)
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted an unhashed stylesheet')
    assert.match(result.stderr, /content-hashed/)
  })
})

for (const extension of ['js', 'css']) {
  test(`rejects an unreferenced unhashed .${extension} file in community/assets`, async () => {
    await withArtifact(async (root) => {
      await put(root, `community/assets/debug.${extension}`)
      const result = verify(root)
      assert.notEqual(result.status, 0, `verifier unexpectedly accepted unreferenced debug.${extension}`)
      assert.match(result.stderr, /content-hashed/)
    })
  })
}

test('rejects a hashed community asset reference when the file is missing', async () => {
  await withArtifact(async (root) => {
    const [relativePath, title] = shellTitles.entries().next().value
    await put(root, relativePath, `${title}<script type="module" src="/community/assets/missing-Xy12Za34.js"></script>`)
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted a missing hashed asset')
    assert.match(result.stderr, /missing community asset/)
  })
})

for (const extension of ['ts', 'tsx', 'jsx', 'vue', 'svelte', 'scss', 'sass', 'less', 'map']) {
  test(`rejects .${extension} source-only files anywhere in the artifact`, async () => {
    await withArtifact(async (root) => {
      await put(root, `community/assets/source.${extension}`, 'source material')
      const result = verify(root)
      assert.notEqual(result.status, 0, `verifier unexpectedly accepted leaked .${extension} source`)
      assert.match(result.stderr, /implementation\/private file leaked/)
    })
  })
}
