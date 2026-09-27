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
    await put(root, relativePath, `${title}<script type="module" src="/community/assets/main-Ab12Cd34.js"></script><img src="/community/assets/logo-Xy12Za34.png"><img srcset="/community/assets/logo-Xy12Za34.png 1x, https://cdn.example/logo.png 2x, data:image/png;base64,AA== 3x"><img src="https://cdn.example/logo.png"><img src="data:image/png;base64,AA==">`)
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
    'community/assets/logo-Xy12Za34.png',
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

for (const leakedConfig of ['_config.yml', 'vite.config.js']) {
  test(`rejects leaked build configuration ${leakedConfig}`, async () => {
    await withArtifact(async (root) => {
      await put(root, leakedConfig, 'build configuration')
      const result = verify(root)
      assert.notEqual(result.status, 0, `verifier unexpectedly accepted ${leakedConfig}`)
      assert.match(result.stderr, /implementation\/private file leaked/)
    })
  })
}

test('accepts generated website files whose names merely contain config', async () => {
  await withArtifact(async (root) => {
    await put(root, 'community/assets/configurator-Ab12Cd34.js', 'generated website code')
    await put(root, 'downloads/site-config.json', '{"theme":"dark"}')
    const result = verify(root)
    assert.equal(result.status, 0, result.stderr)
  })
})

test('rejects a secret in a regular file larger than 2 MB', async () => {
  await withArtifact(async (root) => {
    const secret = 'sb_secret_leaked_from_large_file'
    const content = Buffer.concat([
      Buffer.alloc(2_000_001 - Buffer.byteLength(secret), 0x61),
      Buffer.from(secret),
    ])
    content[content.length - Buffer.byteLength(secret) - 1] = 0x0a
    await put(root, 'large-generated.txt', content)
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly skipped a secret in a file larger than 2 MB')
    assert.match(result.stderr, /possible secret leaked/)
  })
})

test('rejects a secret split across streaming scan chunks', async () => {
  await withArtifact(async (root) => {
    const chunkSize = 64 * 1024
    const prefix = 'sb_secret_'
    const suffix = 'cross_chunk_value'
    const content = Buffer.concat([
      Buffer.alloc(chunkSize - prefix.length + 3, 0x61),
      Buffer.from(prefix),
      Buffer.from(suffix),
      Buffer.alloc(2_000_001 - chunkSize - 3 - suffix.length, 0x61),
    ])
    content[0] = 0x00
    content[chunkSize - prefix.length + 2] = 0x0a
    await put(root, 'cross-chunk-generated.bin', content)
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly missed a secret spanning scan chunks')
    assert.match(result.stderr, /possible secret leaked/)
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

test('rejects an existing unhashed image referenced by every community shell', async () => {
  await withArtifact(async (root) => {
    await put(root, 'community/assets/logo.png')
    for (const [relativePath, title] of shellTitles) {
      await put(root, relativePath, `${title}<script type="module" src="/community/assets/main-Ab12Cd34.js"></script><img src="/community/assets/logo.png">`)
    }
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted an unhashed non-JS/CSS shell asset')
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

test('rejects a hashed non-JS/CSS community asset reference when the file is missing', async () => {
  await withArtifact(async (root) => {
    const [relativePath, title] = shellTitles.entries().next().value
    await put(root, relativePath, `${title}<script type="module" src="/community/assets/main-Ab12Cd34.js"></script><img src="/community/assets/missing-Xy12Za34.png">`)
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted a missing hashed asset')
    assert.match(result.stderr, /missing community asset/)
  })
})

test('rejects an unhashed local asset referenced through srcset', async () => {
  await withArtifact(async (root) => {
    await put(root, 'community/assets/logo.png')
    const [relativePath, title] = shellTitles.entries().next().value
    await put(root, relativePath, `${title}<script type="module" src="/community/assets/main-Ab12Cd34.js"></script><img srcset="https://cdn.example/logo.png 1x, /community/assets/logo.png 2x, data:image/png;base64,AA== 3x">`)
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted an unhashed srcset asset')
    assert.match(result.stderr, /content-hashed/)
  })
})

test('rejects a missing hashed local asset referenced through srcset', async () => {
  await withArtifact(async (root) => {
    const [relativePath, title] = shellTitles.entries().next().value
    await put(root, relativePath, `${title}<script type="module" src="/community/assets/main-Ab12Cd34.js"></script><source srcset="/community/assets/missing-Xy12Za34.webp 640w, https://cdn.example/image.webp 1280w">`)
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted a missing srcset asset')
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
