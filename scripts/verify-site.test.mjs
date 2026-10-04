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
const snapshotId = '11111111-1111-4111-8111-111111111111'
const snapshotPath = `community/content/${snapshotId}/index.html`
const snapshotUrl = `https://www.breadlab.ai/community/content/${snapshotId}/`
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
    ['index.html', '<title>Ria & Seoa PaPa – 0 → 1</title>', 'https://www.breadlab.ai/', '<a class="menu__list__item__link js-no-ajax" href="/community/">Community</a>'],
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
  await put(root, snapshotPath, `<title>Published snapshot example | Breadlab 커뮤니티</title><link rel="canonical" href="${snapshotUrl}"><meta property="og:type" content="article"><meta property="og:url" content="${snapshotUrl}"><script type="application/ld+json">{"@type":"BlogPosting"}</script>`)
  await put(root, 'privacy.html', '<title>개인정보처리방침 – Ria & Seoa PaPa</title><link rel="canonical" href="https://www.breadlab.ai/privacy">giscus 댓글은 GitHub 계정으로 인증됩니다. 커뮤니티 Google OAuth 로그인은 Supabase Auth를 사용합니다. 안정적인 provider subject는 인증 계층에서만 사용하고 공개 프로필에는 개인정보가 아닌 결정적 로그인 이름, 최대 120자의 Google 표시 이름, 최대 2,048자의 HTTPS 프로필 이미지 URL, 사용자 ID와 로그인 세션 정보를 처리합니다. 이메일과 provider access token 또는 refresh token은 공개 프로필에 저장하지 않습니다. 처리 완료 후 최대 3년')
  await put(root, 'CNAME', 'www.breadlab.ai\n')
  await put(root, 'robots.txt', 'User-agent: *\nAllow: /\nSitemap: https://www.breadlab.ai/sitemap.xml\n')
  await put(root, 'sitemap.xml', [
    'https://www.breadlab.ai/',
    'https://www.breadlab.ai/blog/',
    'https://www.breadlab.ai/lab/',
    'https://www.breadlab.ai/blog/ceph-cluster-install-with-helm',
    'https://www.breadlab.ai/privacy',
    snapshotUrl,
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

test('rejects a generated homepage Community link without the AJAX opt-out class', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<title>Ria & Seoa PaPa – 0 → 1</title><link rel="canonical" href="https://www.breadlab.ai/"><a class="menu__list__item__link" href="/community/">Community</a>')
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted a Community link handled by the Jekyll AJAX loader')
    assert.match(result.stderr, /Community navigation link.*js-no-ajax/)
  })
})

test('rejects a non-breaking space between Community navigation classes', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<title>Ria & Seoa PaPa – 0 → 1</title><link rel="canonical" href="https://www.breadlab.ai/"><a class="menu__list__item__link\u00a0js-no-ajax" href="/community/">Community</a>')
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly treated non-ASCII whitespace as an HTML class separator')
    assert.match(result.stderr, /Community navigation link.*js-no-ajax/)
  })
})

test('rejects prefixed data attributes masquerading as href and class', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<title>Ria & Seoa PaPa – 0 → 1</title><link rel="canonical" href="https://www.breadlab.ai/"><a data-href="/community/" data-class="js-no-ajax">Community</a>')
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly treated data-href and data-class as navigation attributes')
    assert.match(result.stderr, /Community navigation link.*js-no-ajax/)
  })
})

test('rejects a Community AJAX opt-out that exists only in commented markup', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<title>Ria & Seoa PaPa – 0 → 1</title><link rel="canonical" href="https://www.breadlab.ai/"><!-- <a href="/community/" class="js-no-ajax">Community</a> --><a href="/community/">Community</a>')
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted a commented-out AJAX opt-out')
    assert.match(result.stderr, /Community navigation link.*js-no-ajax/)
  })
})

test('rejects a Community AJAX opt-out that exists only in a plain-text script', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<title>Ria & Seoa PaPa – 0 → 1</title><link rel="canonical" href="https://www.breadlab.ai/"><script type="text/plain"><a href="/community/" class="js-no-ajax">Community</a></script><a href="/community/">Community</a>')
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted an AJAX opt-out inside a plain-text script')
    assert.match(result.stderr, /Community navigation link.*js-no-ajax/)
  })
})

test('rejects a Community AJAX opt-out that exists only in a template', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<title>Ria & Seoa PaPa – 0 → 1</title><link rel="canonical" href="https://www.breadlab.ai/"><template><a href="/community/" class="js-no-ajax">Community</a></template><a href="/community/">Community</a>')
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted an AJAX opt-out inside a template')
    assert.match(result.stderr, /Community navigation link.*js-no-ajax/)
  })
})

test('rejects a Community AJAX opt-out after a plaintext start tag', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<title>Ria & Seoa PaPa – 0 → 1</title><link rel="canonical" href="https://www.breadlab.ai/"><plaintext><a href="/community/" class="js-no-ajax">Community</a>')
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly parsed markup after a plaintext start tag')
    assert.match(result.stderr, /Community navigation link.*js-no-ajax/)
  })
})

test('rejects a Community AJAX opt-out inside select content', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<title>Ria & Seoa PaPa – 0 → 1</title><link rel="canonical" href="https://www.breadlab.ai/"><select><a href="/community/" class="js-no-ajax">Community</a></select><a href="/community/">Community</a>')
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted an anchor from select content')
    assert.match(result.stderr, /Community navigation link.*js-no-ajax/)
  })
})

test('rejects a Community AJAX opt-out inside frameset noframes content', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<title>Ria & Seoa PaPa – 0 → 1</title><link rel="canonical" href="https://www.breadlab.ai/"><frameset><noframes><a href="/community/" class="js-no-ajax">Community</a></noframes></frameset><a href="/community/">Community</a>')
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted an anchor from frameset noframes content')
    assert.match(result.stderr, /Community navigation link.*js-no-ajax/)
  })
})

for (const [container, openingTag, closingTag] of [
  ['plain-text script', '<script type="text/plain"/>', '</script>'],
  ['template', '<template/>', ''],
]) {
  test(`treats a self-closing flag on a ${container} as ignored`, async () => {
    await withArtifact(async (root) => {
      await put(root, 'index.html', `<title>Ria & Seoa PaPa – 0 → 1</title><link rel="canonical" href="https://www.breadlab.ai/">${openingTag}<a href="/community/" class="js-no-ajax">Community</a>${closingTag}<a href="/community/">Community</a>`)
      const result = verify(root)
      assert.notEqual(result.status, 0, `verifier unexpectedly honored a self-closing flag on a ${container}`)
      assert.match(result.stderr, /Community navigation link.*js-no-ajax/)
    })
  })
}

test('accepts a marked Community navigation link after an unmarked matching link', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<title>Ria & Seoa PaPa – 0 → 1</title><link rel="canonical" href="https://www.breadlab.ai/"><a href="/community/">Community</a><nav><a href="/community/" class="menu__list__item__link js-no-ajax">Community</a></nav>')
    const result = verify(root)
    assert.equal(result.status, 0, result.stderr)
  })
})

test('accepts a marked Community link with a greater-than sign in a quoted attribute', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<title>Ria & Seoa PaPa – 0 → 1</title><link rel="canonical" href="https://www.breadlab.ai/"><a title="1 > 0" href="/community/" class="menu__list__item__link js-no-ajax">Community</a>')
    const result = verify(root)
    assert.equal(result.status, 0, result.stderr)
  })
})

test('accepts visible Community text inside nested markup with a quoted greater-than attribute', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<title>Ria & Seoa PaPa – 0 → 1</title><link rel="canonical" href="https://www.breadlab.ai/"><a href="/community/" class="menu__list__item__link js-no-ajax"><span title="1 > 0">Community</span></a>')
    const result = verify(root)
    assert.equal(result.status, 0, result.stderr)
  })
})

test('rejects obsolete GitHub community authentication wording while allowing GitHub giscus disclosure', async () => {
  await withArtifact(async (root) => {
    await put(root, 'privacy.html', '<title>개인정보처리방침 – Ria & Seoa PaPa</title><link rel="canonical" href="https://www.breadlab.ai/privacy">giscus 댓글은 GitHub 계정으로 인증됩니다. 커뮤니티 GitHub OAuth 로그인 시 GitHub 계정을 식별합니다. 처리 완료 후 최대 3년')
    const result = verify(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /obsolete GitHub community authentication disclosure/)
    assert.doesNotMatch(result.stderr, /giscus.*obsolete/i)
  })
})

test('rejects a privacy artifact missing the bounded Google profile and auth-layer data disclosure', async () => {
  await withArtifact(async (root) => {
    await put(root, 'privacy.html', '<title>개인정보처리방침 – Ria & Seoa PaPa</title><link rel="canonical" href="https://www.breadlab.ai/privacy">giscus 댓글은 GitHub 계정으로 인증됩니다. 커뮤니티 Google OAuth 로그인은 Supabase Auth를 사용합니다. 처리 완료 후 최대 3년')
    const result = verify(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /stable provider subject|deterministic non-PII login|bounded Google display name|bounded Google avatar URL|public-profile email and provider-token exclusion/)
  })
})

test('rejects a missing required community snapshot', async () => {
  await withArtifact(async (root) => {
    await rm(path.join(root, snapshotPath))
    const result = verify(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /missing required artifact/)
  })
})

test('rejects a community snapshot without canonical, OpenGraph, and JSON-LD metadata', async () => {
  await withArtifact(async (root) => {
    await put(root, snapshotPath, '<title>Published snapshot example | Breadlab 커뮤니티</title>')
    const result = verify(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /snapshot canonical|snapshot OpenGraph|snapshot JSON-LD/)
  })
})

for (const leakedConfig of [
  'Dockerfile',
  'Dockerfile.build',
  'Dockerfile.release',
  'Dockerfile-dev',
  '.dockerignore',
  'docker-compose.yml',
  'compose.yaml',
  '_config.yml',
  '_config.production.yml',
  'vite.config.js',
  'next.config.mjs',
  '.ruby-version',
  'Rakefile',
]) {
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

for (const leakedSource of [
  '.git/config',
  '.idea/workspace.xml',
  '_data/navigation.yml',
  '_drafts/private.md',
  '_includes/header.html',
  '_layouts/default.html',
  '_plugins/private.rb',
  '_posts/2026-09-27-private.md',
  '_pages/private.md',
  '_projects/private.md',
  '_sass/private.scss',
  '.github/workflows/deploy.yml',
]) {
  test(`rejects leaked build source ${leakedSource}`, async () => {
    await withArtifact(async (root) => {
      await put(root, leakedSource, 'build source')
      const result = verify(root)
      assert.notEqual(result.status, 0, `verifier unexpectedly accepted ${leakedSource}`)
      assert.match(result.stderr, /implementation\/private path leaked/)
    })
  })
}

test('allows only the explicitly supported generated dotfile', async () => {
  await withArtifact(async (root) => {
    await put(root, '.nojekyll')
    const result = verify(root)
    assert.equal(result.status, 0, result.stderr)
  })
})

test('rejects an unapproved generated dotfile', async () => {
  await withArtifact(async (root) => {
    await put(root, '.unexpected-metadata', 'source metadata')
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted an unapproved dotfile')
    assert.match(result.stderr, /implementation\/private file leaked/)
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

for (const encoding of ['utf16le', 'utf16be']) {
  test(`rejects a ${encoding.toUpperCase()} secret in a large file across scan chunks`, async () => {
    await withArtifact(async (root) => {
      const chunkSize = 64 * 1024
      const secret = 'sb_secret_utf16_cross_chunk_value'
      const encodedSecret = Buffer.from(secret, 'utf16le')
      if (encoding === 'utf16be') encodedSecret.swap16()
      const content = Buffer.concat([
        Buffer.alloc(chunkSize - 10, 0x20),
        encodedSecret,
        Buffer.alloc(2_000_001 - chunkSize - encodedSecret.length + 10, 0x20),
      ])
      await put(root, `${encoding}-large-generated.bin`, content)
      const result = verify(root)
      assert.notEqual(result.status, 0, `verifier unexpectedly missed a ${encoding} secret`)
      assert.match(result.stderr, /possible secret leaked/)
    })
  })
}

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

test('rejects an unquoted unhashed asset reference in any generated HTML file', async () => {
  await withArtifact(async (root) => {
    await put(root, 'community/assets/extra.png')
    await put(root, 'nested/generated.html', '<img src=/community/assets/extra.png>')
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly ignored an unquoted asset outside the six shells')
    assert.match(result.stderr, /content-hashed/)
  })
})

test('rejects a missing unquoted hashed href in any generated HTML file', async () => {
  await withArtifact(async (root) => {
    await put(root, 'nested/generated.html', '<link href=/community/assets/missing-Ab12Cd34.css>')
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly ignored an unquoted missing asset outside the six shells')
    assert.match(result.stderr, /missing community asset/)
  })
})

test('rejects comma-adjacent unhashed srcset URLs in any generated HTML file', async () => {
  await withArtifact(async (root) => {
    await put(root, 'community/assets/extra.png')
    await put(root, 'nested/generated.html', '<img srcset="/community/assets/logo-Xy12Za34.png,/community/assets/extra.png">')
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly ignored a comma-adjacent srcset URL')
    assert.match(result.stderr, /content-hashed/)
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
