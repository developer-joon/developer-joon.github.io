#!/usr/bin/env node

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, readFile, cp, symlink } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { assertNoBenefitsFixtureLeaks } from './verify-benefits-artifacts.mjs'


const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const verifier = path.join(repoRoot, 'scripts/verify-site.mjs')
const snapshotId = '11111111-1111-4111-8111-111111111111'
const snapshotPath = `community/content/${snapshotId}/index.html`
const snapshotUrl = `https://www.breadlab.ai/community/content/${snapshotId}/`

test('recursive benefits release assertion rejects nested fixture, ranking, and evaluation leaks', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'benefits-leak-test-'))
  try {
    await put(root, 'community/data/company-benefits/v2/nested/leak.json', '{"fitScore":1}')
    await assert.rejects(assertNoBenefitsFixtureLeaks(root), /forbidden benefits key/)
    await rm(path.join(root, 'community/data/company-benefits/v2/nested/leak.json'))
    await put(root, 'community/data/company-benefits/v2/nested/leak.js', 'const source = "fixture-v1"')
    await assert.rejects(assertNoBenefitsFixtureLeaks(root), /forbidden benefits release content/)
    await rm(path.join(root, 'community/data/company-benefits/v2/nested/leak.js'))
    await put(root, 'community/data/company-benefits/v2/nested/rankings.json', '{}')
    await assert.rejects(assertNoBenefitsFixtureLeaks(root), /forbidden benefits release content/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('benefits release assertion ignores unrelated fixtures under an ancestor named company-benefits', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'company-benefits-artifact-'))
  try {
    await put(root, 'community/data/company-benefits/v2/clean.json', '{}')
    await put(root, snapshotPath, '{"fixture":"fixture-v1","rankings_url":"/community/benefits/rankings/"}')
    await assert.doesNotReject(assertNoBenefitsFixtureLeaks(root))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})


const shellTitles = new Map([
  ['community/index.html', '<title>Community · Ria &amp; Seoa PaPa</title>'],
  ['community/write/index.html', '<title>글쓰기 · Ria &amp; Seoa PaPa</title>'],
  ['community/post/index.html', '<title>게시글 · Ria &amp; Seoa PaPa</title>'],
  ['community/edit/index.html', '<title>글 수정 · Ria &amp; Seoa PaPa</title>'],
  ['community/admin/reports/index.html', '<title>신고 관리 · Ria &amp; Seoa PaPa</title>'],
  ['community/auth/callback/index.html', '<title>로그인 처리 · Ria &amp; Seoa PaPa</title>'],
  ['community/benefits/correction/index.html', '<title>복지 정보 수정 요청 · Ria &amp; Seoa PaPa</title>'],
  ['community/benefits/my-corrections/index.html', '<title>내 복지 수정 요청 · Ria &amp; Seoa PaPa</title>'],
])

async function put(root, relativePath, content = '') {
  const destination = path.join(root, relativePath)
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(destination, content)
}

async function makeValidArtifact() {
  const root = await mkdtemp(path.join(tmpdir(), 'verify-site-test-'))
  const routes = [
    ['index.html', '<title>Ria & Seoa PaPa – 수익실험실</title>', 'https://www.breadlab.ai/', '<ul class="menu__list"><li><a class="menu__list__item__link js-no-ajax" href="/community/">Community</a></li><li><a class="menu__list__item__link js-no-ajax" href="/benefits/">Benefits</a></li></ul>'],
    ['blog/index.html', '<title>Blog – Ria & Seoa PaPa</title>', 'https://www.breadlab.ai/blog/', ''],
    ['lab/index.html', '<title>수익실험실 – Ria & Seoa PaPa</title>', 'https://www.breadlab.ai/lab/', ''],
    ['blog/ceph-cluster-install-with-helm.html', '<title>[Kubernets] Ceph Cluster install with helm – Ria & Seoa PaPa</title>', 'https://www.breadlab.ai/blog/ceph-cluster-install-with-helm', ''],
    ['404.html', '<title>Page Not Found – Ria & Seoa PaPa</title>', 'https://www.breadlab.ai/404.html', ''],
  ]
  for (const [relativePath, title, canonical, body] of routes) {
    await put(root, relativePath, `<!doctype html><html><head>${title}<link rel="canonical" href="${canonical}"></head><body>${body}</body></html>`)
  }
  for (const [relativePath, title] of shellTitles) {
    await put(root, relativePath, `${title}<script type="module" src="/community/assets/benefits-main-Ab12Cd34.js"></script><img src="/community/assets/logo-Xy12Za34.png"><img srcset="/community/assets/logo-Xy12Za34.png 1x, https://cdn.example/logo.png 2x, data:image/png;base64,AA== 3x"><img src="https://cdn.example/logo.png"><img src="data:image/png;base64,AA==">`)
  }
  for (const [part,title] of [['','복지 현황'],['fit/','조건 탐색'],['company/','기업 근거 상세'],['methodology/','조사 기준·정정 이력']]) {
    await put(root, `community/benefits/${part}index.html`, `<title>${title} · Benefit Atlas</title><meta name="description" content="공개 근거"><link rel="canonical" href="https://www.breadlab.ai/community/benefits/${part}"><script type="module" src="/community/assets/benefits-main-Ab12Cd34.js"></script>`)
  }
  await put(root, 'community/benefits/directory/index.html', '<!doctype html><html lang="ko"><head><title>국내 기업 검색 · Benefit Atlas</title><meta name="description" content="공개 근거"><link rel="canonical" href="https://www.breadlab.ai/community/benefits/directory/"><script type="module" src="/community/assets/benefits-main-Ab12Cd34.js"></script></head><body><div id="app"></div></body></html>')
  await put(root, 'benefits/index.html', '<!doctype html><html lang="ko"><head><title>기업 복지 검색 · Breadlab</title><link rel="canonical" href="https://breadlab.ai/benefits/"><script type="module" crossorigin src="/community/assets/benefits-main-Ab12Cd34.js"></script></head><body><div id="app"></div></body></html>')
  await put(root, 'benefits/company/index.html', '<!doctype html><html lang="ko"><head><title>기업 복지 상세 · Breadlab</title><link rel="canonical" href="https://breadlab.ai/benefits/company/"><script type="module" crossorigin src="/community/assets/benefits-main-Ab12Cd34.js"></script></head><body><div id="app"></div></body></html>')
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
    'https://breadlab.ai/benefits/',
    'https://breadlab.ai/benefits/company/',
    snapshotUrl,
  ].map((location) => `<loc>${location}</loc>`).join('\n'))
  for (const relativePath of [
    'css/style.css',
    'js/personal-min.js',
    'images/favicon.ico',
    'images/generated.png',
    'fonts/generated.woff2',
    'notes/generated.txt',
    'community/assets/benefits-main-Ab12Cd34.js',
    'community/assets/benefits-Xk34Lm90.js',
    'community/assets/jsx-runtime-Xy12Za34.js',
    'community/assets/react-Zy98Xw76.js',
    'community/assets/main-Qw12Er34.js',
    'community/assets/logo-Xy12Za34.png',
  ]) {
    await put(root, relativePath)
  }
  await put(root, 'community/.vite/manifest.json', JSON.stringify({
    '_benefits-main-Ab12Cd34.js': {
      file: 'assets/benefits-main-Ab12Cd34.js',
      name: 'benefits-main',
      imports: ['_jsx-runtime-Xy12Za34.js', '_benefits-Xk34Lm90.js', '_react-Zy98Xw76.js'],
    },
    '_jsx-runtime-Xy12Za34.js': { file: 'assets/jsx-runtime-Xy12Za34.js', name: 'jsx-runtime' },
    '_benefits-Xk34Lm90.js': {
      file: 'assets/benefits-Xk34Lm90.js',
      name: 'benefits',
      imports: ['_jsx-runtime-Xy12Za34.js', '_react-Zy98Xw76.js'],
      dynamicImports: [
        'src/pages/BenefitsMethodologyPage.tsx',
        'src/pages/BenefitsExplorerPage.tsx',
        'src/pages/BenefitsDirectoryPage.tsx',
        'src/pages/BenefitDirectoryCompanyPage.tsx',
      ],
    },
    '_react-Zy98Xw76.js': {
      file: 'assets/react-Zy98Xw76.js',
      name: 'react',
      imports: ['_jsx-runtime-Xy12Za34.js'],
    },
    'index.html': {
      file: 'assets/main-Qw12Er34.js',
      name: 'home',
      src: 'index.html',
      isEntry: true,
      imports: ['_react-Zy98Xw76.js'],
    },
  }))
  return root
}

function verify(root) {
  return spawnSync(process.execPath, [verifier, root], { encoding: 'utf8' })
}

async function mutateManifest(root, mutate) {
  const manifestPath = path.join(root, 'community/.vite/manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  await mutate(manifest, root)
  await writeFile(manifestPath, JSON.stringify(manifest))
}

async function withArtifact(run) {
  const root = await makeValidArtifact()
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('site verification accepts the real research sibling and rejects its removal', async () => {
  await withArtifact(async (root) => {
    const release = path.join(root, 'community/data/company-benefits')
    await cp(path.join(repoRoot, 'community-app/public/data/company-benefits'), release, { recursive: true })
    const accepted = verify(root)
    assert.equal(accepted.status, 0, accepted.stderr)
    assert.match(accepted.stdout, /size artifacts: 402 labels.*3143 FTC-only/)
    const sizeRecords = path.join(release, 'domestic-size-evidence-v1/records.json')
    const originalSizeRecords = await readFile(sizeRecords)
    await rm(sizeRecords)
    const missingSize = verify(root)
    assert.notEqual(missingSize.status, 0)
    assert.match(missingSize.stderr, /size artifacts/i)
    await writeFile(sizeRecords, originalSizeRecords)
    const index = path.join(release, 'domestic-search-index-v1/index.json')
    const originalIndex = await readFile(index)
    const cut = JSON.parse(originalIndex.toString('utf8'))
    cut.entries.pop(); cut.totals.records--
    await writeFile(index, JSON.stringify(cut))
    const missingSearchRow = verify(root)
    assert.notEqual(missingSearchRow.status, 0)
    assert.match(missingSearchRow.stderr, /search index artifacts/i)
    await writeFile(index, originalIndex)
    await rm(path.join(release, 'domestic-directory-v1/shards/0000.json'))
    const missingDirectoryShard = verify(root)
    assert.notEqual(missingDirectoryShard.status, 0)
    assert.match(missingDirectoryShard.stderr, /directory artifacts/i)
    await cp(path.join(repoRoot, 'community-app/public/data/company-benefits/domestic-directory-v1/shards/0000.json'), path.join(release, 'domestic-directory-v1/shards/0000.json'))
    await rm(path.join(release, 'research-leads-v1/leads.json'))
    const rejected = verify(root)
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stderr, /research artifacts.*inventory/i)
  })
})

test('accepts a minimal valid generated artifact', async () => {
  await withArtifact(async (root) => {
    const result = verify(root)
    assert.equal(result.status, 0, result.stderr)
  })
})

test('rejects a FIFO artifact without opening or hanging on it', { skip: process.platform === 'win32' }, async () => {
  await withArtifact(async (root) => {
    const fifo = path.join(root, 'CNAME')
    await rm(fifo)
    const created = spawnSync('mkfifo', [fifo], { encoding: 'utf8' })
    assert.equal(created.status, 0, created.stderr)
    const result = spawnSync(process.execPath, [verifier, root], { encoding: 'utf8', timeout: 5_000 })
    assert.notEqual(result.error?.code, 'ETIMEDOUT', 'verifier opened and blocked on the FIFO')
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /CNAME.*(?:FIFO|named pipe|nonregular)/i)
  })
})

test('rejects a Unix socket artifact without opening it', { skip: process.platform === 'win32' }, async () => {
  await withArtifact(async (root) => {
    const socketPath = path.join(root, 'generated.sock')
    const server = createServer()
    await new Promise((resolve, reject) => server.listen(socketPath, resolve).once('error', reject))
    try {
      const result = verify(root)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /generated\.sock.*socket/i)
    } finally {
      await new Promise(resolve => server.close(resolve))
    }
  })
})

test('rejects a symbolic-link artifact while accepting ordinary files and directories', async () => {
  await withArtifact(async (root) => {
    await put(root, 'ordinary/directory/file.txt', 'ordinary')
    assert.equal(verify(root).status, 0)
    await symlink('ordinary/directory/file.txt', path.join(root, 'linked-artifact'))
    const result = verify(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /symbolic link.*linked-artifact/)
  })
})

test('rejects a missing canonical benefits route', async () => {
  await withArtifact(async (root) => {
    await rm(path.join(root, 'benefits/index.html'))
    const result = verify(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /missing required artifact: benefits\/index\.html/)
  })
})

test('rejects stale canonical metadata even when expected values appear outside head', async () => {
  await withArtifact(async (root) => {
    await put(root, 'benefits/index.html', '<!doctype html><html><head><title>stale</title><link rel="canonical" href="https://breadlab.ai/stale/"></head><body><!-- <title>기업 복지 검색 · Breadlab</title> --><link rel="canonical" href="https://breadlab.ai/benefits/"><script type="module" src="/community/assets/benefits-main-Ab12Cd34.js"></script></body></html>')
    const result = verify(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /benefits\/index\.html has unexpected document title|missing canonical URL/)
  })
})

test('rejects duplicate canonical title and link in the actual head', async () => {
  await withArtifact(async (root) => {
    const route = path.join(root, 'benefits/index.html')
    const html = await readFile(route, 'utf8')
    await writeFile(route, html.replace('</head>', '<title>기업 복지 검색 · Breadlab</title><link rel="canonical" href="https://breadlab.ai/benefits/"></head>'))
    const result = verify(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /exactly one document title|canonical URL/)
  })
})

test('rejects an unmarked real benefits nav link despite a marked body decoy', async () => {
  await withArtifact(async (root) => {
    const home = path.join(root, 'index.html')
    const html = await readFile(home, 'utf8')
    await writeFile(home, html.replace('menu__list__item__link js-no-ajax" href="/benefits/"', 'menu__list__item__link" href="/benefits/"').replace('</body>', '<main><a class="js-no-ajax" href="/benefits/">Benefits</a></main></body>'))
    const result = verify(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Benefits navigation link.*js-no-ajax/)
  })
})

test('rejects a duplicate community benefits-root tree', async () => {
  await withArtifact(async (root) => {
    await put(root, 'community/benefits-root/index.html', 'duplicate')
    const result = verify(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /community\/benefits-root.*must be absent/)
  })
})

for (const [kind, createDuplicate, expected] of [
  ['empty directory', (root) => mkdir(path.join(root, 'community/benefits-root'), { recursive: true }), /community\/benefits-root duplicate path must be absent/],
  ['regular file', (root) => put(root, 'community/benefits-root', 'duplicate'), /community\/benefits-root duplicate path must be absent/],
  ['symbolic link', async (root) => symlink('../assets', path.join(root, 'community/benefits-root')), /symbolic link.*community\/benefits-root/],
]) {
  test(`rejects a duplicate community benefits-root ${kind}`, async () => {
    await withArtifact(async (root) => {
      await createDuplicate(root)
      const result = verify(root)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, expected)
    })
  })
}

const canonicalEntryMutations = [
  ['hashed image as script source', (html) => html.replace('/community/assets/benefits-main-Ab12Cd34.js', '/community/assets/logo-Xy12Za34.png')],
  ['missing script', (html) => html.replace(/<script type="module" crossorigin src="\/community\/assets\/benefits-main-Ab12Cd34\.js"><\/script>/, '')],
  ['inline-only module script', (html) => html.replace(' crossorigin src="/community/assets/benefits-main-Ab12Cd34.js"', '')],
  ['wrong script type', (html) => html.replace('type="module"', 'type="text/javascript"')],
  ['unhashed script source', (html) => html.replace('/community/assets/benefits-main-Ab12Cd34.js', '/community/assets/main.js')],
  ['non-assets script source', (html) => html.replace('/community/assets/benefits-main-Ab12Cd34.js', '/community/benefits-main-Ab12Cd34.js')],
  ['query-bearing script source', (html) => html.replace('/community/assets/benefits-main-Ab12Cd34.js', '/community/assets/benefits-main-Ab12Cd34.js?v=1')],
  ['fragment-bearing script source', (html) => html.replace('/community/assets/benefits-main-Ab12Cd34.js', '/community/assets/benefits-main-Ab12Cd34.js#entry')],
  ['credential-bearing script source', (html) => html.replace('/community/assets/benefits-main-Ab12Cd34.js', 'https://user@example.test/community/assets/benefits-main-Ab12Cd34.js')],
  ['duplicate module script', (html) => html.replace('</head>', '<script type="module" src="/community/assets/benefits-main-Ab12Cd34.js"></script></head>')],
  ['modulepreload only', (html) => html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/, '<link rel="modulepreload" href="$1">')],
  ['comment decoy', (html) => html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/, '<!-- <script type="module" src="$1"></script> -->')],
  ['template decoy', (html) => html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/, '<template><script type="module" src="$1"></script></template>')],
  ['body text decoy', (html) => html
    .replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/, '')
    .replace('<div id="app"></div>', '<div id="app"></div><p>&lt;script type="module" src="/community/assets/benefits-main-Ab12Cd34.js"&gt;&lt;/script&gt;</p>')],
]

for (const [description, mutate] of canonicalEntryMutations) {
  test(`rejects canonical benefits ${description}`, async () => {
    await withArtifact(async (root) => {
      const route = path.join(root, 'benefits/index.html')
      await writeFile(route, mutate(await readFile(route, 'utf8')))
      const result = verify(root)
      assert.notEqual(result.status, 0, `verifier unexpectedly accepted ${description}`)
      assert.match(result.stderr, /benefits\/index\.html must contain exactly one executable external Vite module entry/)
    })
  })
}

test('rejects a canonical entry whose JavaScript file is missing', async () => {
  await withArtifact(async (root) => {
    await rm(path.join(root, 'community/assets/benefits-main-Ab12Cd34.js'))
    const result = verify(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /canonical benefits entry is not a regular non-symlink file/)
  })
})

test('rejects a canonical entry whose JavaScript path is a symlink', async () => {
  await withArtifact(async (root) => {
    const entry = path.join(root, 'community/assets/benefits-main-Ab12Cd34.js')
    await rm(entry)
    await symlink('logo-Xy12Za34.png', entry)
    const result = verify(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /symbolic link.*community\/assets\/benefits-main-Ab12Cd34\.js/)
  })
})

test('rejects different executable entries for the two canonical benefits shells', async () => {
  await withArtifact(async (root) => {
    await put(root, 'community/assets/benefits-main-Zy98Xw76.js')
    const route = path.join(root, 'benefits/company/index.html')
    await writeFile(route, (await readFile(route, 'utf8')).replace('benefits-main-Ab12Cd34.js', 'benefits-main-Zy98Xw76.js'))
    const result = verify(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /canonical benefits shells must use the same public entry asset/)
  })
})

test('accepts the production-shaped Vite manifest benefits-main binding', async () => {
  await withArtifact(async (root) => {
    const accepted = verify(root)
    assert.equal(accepted.status, 0, accepted.stderr)
  })
})

test('rejects an extra public-looking module in the eager closure', async () => {
  await withArtifact(async (root) => {
    await put(root, 'community/assets/public-shell-Ab12Cd34.js')
    await mutateManifest(root, (manifest) => {
      manifest['_benefits-main-Ab12Cd34.js'].imports.push('_public-shell-Ab12Cd34.js')
      manifest['_public-shell-Ab12Cd34.js'] = { file: 'assets/public-shell-Ab12Cd34.js', name: 'public-shell' }
    })
    const result = verify(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /canonical eager closure|allowed eager role/i)
  })
})

test('accepts the exact canonical eager role graph with arbitrary hashes and manifest key order', async () => {
  await withArtifact(async (root) => {
    for (const file of ['benefits-main-Q1w2E3r4T5.js', 'benefits-Aa_bb-99.js', 'react-Z9y8X7w6.js', 'jsx-runtime-Mn45_Pq8.js']) {
      await put(root, `community/assets/${file}`)
    }
    await mutateManifest(root, (manifest) => {
      const unrelated = manifest['index.html']
      for (const key of Object.keys(manifest)) delete manifest[key]
      Object.assign(manifest, {
        '_react-Z9y8X7w6.js': {
          file: 'assets/react-Z9y8X7w6.js',
          name: 'react',
          imports: ['_jsx-runtime-Mn45_Pq8.js'],
        },
        'index.html': unrelated,
        '_jsx-runtime-Mn45_Pq8.js': { file: 'assets/jsx-runtime-Mn45_Pq8.js', name: 'jsx-runtime' },
        '_benefits-Aa_bb-99.js': {
          file: 'assets/benefits-Aa_bb-99.js',
          name: 'benefits',
          imports: ['_react-Z9y8X7w6.js', '_jsx-runtime-Mn45_Pq8.js'],
          dynamicImports: ['src/pages/BenefitsExplorerPage.tsx'],
        },
        '_benefits-main-Q1w2E3r4T5.js': {
          file: 'assets/benefits-main-Q1w2E3r4T5.js',
          name: 'benefits-main',
          imports: ['_react-Z9y8X7w6.js', '_benefits-Aa_bb-99.js', '_jsx-runtime-Mn45_Pq8.js'],
        },
      })
    })
    for (const relativePath of ['benefits/index.html', 'benefits/company/index.html']) {
      const route = path.join(root, relativePath)
      await writeFile(route, (await readFile(route, 'utf8')).replaceAll('benefits-main-Ab12Cd34.js', 'benefits-main-Q1w2E3r4T5.js'))
    }
    const result = verify(root)
    assert.equal(result.status, 0, result.stderr)
  })
})

test('does not traverse valid dynamic imports as eager dependencies', async () => {
  await withArtifact(async (root) => {
    await mutateManifest(root, (manifest) => {
      manifest['_benefits-main-Ab12Cd34.js'].dynamicImports = ['missing-private-dynamic-record']
    })
    const result = verify(root)
    assert.equal(result.status, 0, result.stderr)
  })
})

for (const [description, mutate, expected] of [
  ['missing eager import key', (manifest) => { manifest['_benefits-main-Ab12Cd34.js'].imports = ['missing'] }, /missing eager import record/i],
  ['nonobject eager import record', (manifest) => { manifest['_benefits-main-Ab12Cd34.js'].imports = ['bad']; manifest.bad = null }, /eager import record.*object/i],
  ['eager import record without file', (manifest) => { manifest['_benefits-main-Ab12Cd34.js'].imports = ['bad']; manifest.bad = { name: 'public-shell' } }, /eager import record.*file/i],
  ['unsafe traversing eager import file', (manifest) => { manifest['_benefits-main-Ab12Cd34.js'].imports = ['bad']; manifest.bad = { file: 'assets/../bad-Ab12Cd34.js', name: 'public-shell' } }, /unsafe eager import file/i],
  ['absolute eager import file', (manifest) => { manifest['_benefits-main-Ab12Cd34.js'].imports = ['bad']; manifest.bad = { file: '/assets/bad-Ab12Cd34.js', name: 'public-shell' } }, /unsafe eager import file/i],
  ['backslash eager import file', (manifest) => { manifest['_benefits-main-Ab12Cd34.js'].imports = ['bad']; manifest.bad = { file: 'assets\\bad-Ab12Cd34.js', name: 'public-shell' } }, /unsafe eager import file/i],
  ['query-bearing eager import file', (manifest) => { manifest['_benefits-main-Ab12Cd34.js'].imports = ['bad']; manifest.bad = { file: 'assets/bad-Ab12Cd34.js?v=1', name: 'public-shell' } }, /unsafe eager import file/i],
  ['duplicate eager imports', (manifest) => { manifest['_benefits-main-Ab12Cd34.js'].imports = ['_react-Zy98Xw76.js', '_react-Zy98Xw76.js'] }, /duplicate eager import/i],
  ['eager import cycle', (manifest) => { manifest['_react-Zy98Xw76.js'].imports = ['_benefits-main-Ab12Cd34.js'] }, /eager import cycle/i],
  ['oversized eager imports', (manifest) => { manifest['_benefits-main-Ab12Cd34.js'].imports = Array.from({ length: 257 }, (_, index) => `missing-${index}`) }, /imports.*bounded|too many imports/i],
  ['oversized dynamic imports', (manifest) => { manifest['_benefits-main-Ab12Cd34.js'].dynamicImports = Array.from({ length: 257 }, (_, index) => `dynamic-${index}`) }, /dynamicImports.*bounded|too many dynamic imports/i],
  ['oversized manifest key', (manifest) => { manifest['x'.repeat(1025)] = { file: 'assets/unused-Ab12Cd34.js' } }, /manifest key.*bounded/i],
  ['session store with auth source', (manifest) => { manifest['_react-Zy98Xw76.js'].name = 'sessionStore'; manifest['_react-Zy98Xw76.js'].src = 'src/auth/session.ts' }, /forbidden field.*src|allowed eager role/i],
  ['allowed benefits name with auth source', (manifest) => { manifest['_benefits-Xk34Lm90.js'].src = 'src/auth/provider.ts' }, /forbidden field.*src|allowed eager role/i],
  ['name/key role mismatch', (manifest) => { manifest['_react-Zy98Xw76.js'].name = 'jsx-runtime' }, /allowed eager role|role descriptor/i],
  ['file/key role mismatch', (manifest) => { manifest['_react-Zy98Xw76.js'].file = 'assets/jsx-runtime-Zy98Xw76.js' }, /allowed eager role|role descriptor/i],
  ['duplicate react role with a different key and file', async (manifest, root) => {
    await put(root, 'community/assets/react-Qq12Ww34.js')
    manifest['_benefits-main-Ab12Cd34.js'].imports.push('_react-Qq12Ww34.js')
    manifest['_react-Qq12Ww34.js'] = { file: 'assets/react-Qq12Ww34.js', name: 'react', imports: ['_jsx-runtime-Xy12Za34.js'] }
  }, /duplicate eager role|canonical eager closure/i],
  ['missing required benefits role', (manifest) => {
    manifest['_benefits-main-Ab12Cd34.js'].imports = ['_jsx-runtime-Xy12Za34.js', '_react-Zy98Xw76.js']
  }, /canonical eager closure|missing.*benefits/i],
  ['missing required react direct edge from benefits', (manifest) => {
    manifest['_benefits-Xk34Lm90.js'].imports = ['_jsx-runtime-Xy12Za34.js']
  }, /direct imports|role graph/i],
  ['extra benefits-to-entry direct edge', (manifest) => {
    manifest['_benefits-Xk34Lm90.js'].imports.push('_benefits-main-Ab12Cd34.js')
  }, /eager import cycle|direct imports|role graph/i],
]) {
  test(`rejects ${description} in the eager benefits manifest graph`, async () => {
    await withArtifact(async (root) => {
      await mutateManifest(root, mutate)
      const result = verify(root)
      assert.notEqual(result.status, 0, `verifier unexpectedly accepted ${description}`)
      assert.match(result.stderr, expected)
    })
  })
}

for (const [description, setup, expected] of [
  ['missing eager JavaScript', async (root) => rm(path.join(root, 'community/assets/react-Zy98Xw76.js')), /eager import file.*regular non-symlink/i],
  ['symlink eager JavaScript', async (root) => {
    const imported = path.join(root, 'community/assets/react-Zy98Xw76.js')
    await rm(imported)
    await symlink('logo-Xy12Za34.png', imported)
  }, /symbolic link.*community\/assets\/react-Zy98Xw76\.js/i],
]) {
  test(`rejects ${description}`, async () => {
    await withArtifact(async (root) => {
      await setup(root)
      const result = verify(root)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, expected)
    })
  })
}

test('rejects canonical benefits shells when the assembled Vite manifest is missing', async () => {
  await withArtifact(async (root) => {
    await rm(path.join(root, 'community/.vite/manifest.json'))
    const result = verify(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /assembled Vite manifest is required/)
  })
})

test('rejects an empty or malformed assembled Vite manifest', async () => {
  for (const contents of ['', '{']) {
    await withArtifact(async (root) => {
      await put(root, 'community/.vite/manifest.json', contents)
      const result = verify(root)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /manifest\.json.*(?:bounded|empty|valid JSON)/)
    })
  }
})

test('rejects duplicate keys in the assembled Vite manifest', async () => {
  await withArtifact(async (root) => {
    const record = '{"file":"assets/benefits-main-Ab12Cd34.js","name":"benefits-main"}'
    await put(root, 'community/.vite/manifest.json', `{"entry":${record},"entry":${record}}`)
    const result = verify(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /duplicate JSON key/)
  })
})

test('rejects an oversized assembled Vite manifest', async () => {
  await withArtifact(async (root) => {
    await put(root, 'community/.vite/manifest.json', ' '.repeat(1024 * 1024 + 1))
    const result = verify(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /bounded regular non-symlink file/)
  })
})

for (const [kind, replaceManifest] of [
  ['directory', async (manifestPath) => { await rm(manifestPath); await mkdir(manifestPath) }],
  ['symbolic link', async (manifestPath) => {
    const target = path.join(path.dirname(manifestPath), 'linked-manifest.json')
    await writeFile(target, '{}')
    await rm(manifestPath)
    await symlink('linked-manifest.json', manifestPath)
  }],
]) {
  test(`rejects an assembled Vite manifest ${kind}`, async () => {
    await withArtifact(async (root) => {
      await replaceManifest(path.join(root, 'community/.vite/manifest.json'))
      const result = verify(root)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /manifest\.json.*(?:bounded regular non-symlink|symbolic link)/)
    })
  })
}

for (const [description, mutate] of [
  ['missing benefits-main record', (manifest) => { delete manifest['_benefits-main-Ab12Cd34.js'] }],
  ['duplicate benefits-main record', (manifest) => { manifest.other = { ...manifest['_benefits-main-Ab12Cd34.js'] } }],
  ['mismatched benefits-main file', (manifest) => { manifest['_benefits-main-Ab12Cd34.js'].file = 'assets/benefits-main-Qq11Ww22.js' }],
  ['unsafe traversing benefits-main file', (manifest) => { manifest['_benefits-main-Ab12Cd34.js'].file = 'assets/../benefits-main-Ab12Cd34.js' }],
  ['query-bearing benefits-main file', (manifest) => { manifest['_benefits-main-Ab12Cd34.js'].file += '?v=1' }],
  ['fragment-bearing benefits-main file', (manifest) => { manifest['_benefits-main-Ab12Cd34.js'].file += '#entry' }],
  ['backslash-bearing benefits-main file', (manifest) => { manifest['_benefits-main-Ab12Cd34.js'].file = 'assets\\benefits-main-Ab12Cd34.js' }],
  ['credential-bearing benefits-main file', (manifest) => { manifest['_benefits-main-Ab12Cd34.js'].file = 'https://user@example.test/assets/benefits-main-Ab12Cd34.js' }],
  ['non-string benefits-main file', (manifest) => { manifest['_benefits-main-Ab12Cd34.js'].file = 1 }],
  ['non-string benefits-main name', (manifest) => { manifest['_benefits-main-Ab12Cd34.js'].name = ['benefits-main'] }],
  ['invalid benefits-main imports type', (manifest) => { manifest['_benefits-main-Ab12Cd34.js'].imports = '_react-Zy98Xw76.js' }],
]) {
  test(`rejects ${description} in the assembled Vite manifest`, async () => {
    await withArtifact(async (root) => {
      const manifestPath = path.join(root, 'community/.vite/manifest.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      mutate(manifest)
      await writeFile(manifestPath, JSON.stringify(manifest))
      const result = verify(root)
      assert.notEqual(result.status, 0, `verifier unexpectedly accepted ${description}`)
      assert.match(result.stderr, /manifest\.json.*benefits-main/)
    })
  })
}

test('rejects a missing domestic search route from an otherwise valid site', async () => {
  await withArtifact(async (root) => {
    await rm(path.join(root, 'community/benefits/directory/index.html'))
    const result = verify(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /missing required artifact: community\/benefits\/directory\/index\.html/)
  })
})

test('rejects a domestic directory canonical that appears only in a comment', async () => {
  await withArtifact(async (root) => {
    const route = path.join(root, 'community/benefits/directory/index.html')
    const expected = '<link rel="canonical" href="https://www.breadlab.ai/community/benefits/directory/">'
    const html = await readFile(route, 'utf8')
    await writeFile(route, html.replace(expected, `<link rel="canonical" href="https://www.breadlab.ai/stale/">\n<!-- ${expected} -->`))
    const result = verify(root)
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /community\/benefits\/directory\/index\.html is missing canonical URL/)
  })
})

for (const [field, oldValue, expected] of [
  ['title', '국내 기업 검색 · Benefit Atlas', /community\/benefits\/directory\/index\.html has unexpected document title/],
  ['canonical', 'https://www.breadlab.ai/community/benefits/directory/', /community\/benefits\/directory\/index\.html is missing canonical URL/],
]) {
  test(`rejects a wrong domestic search ${field}`, async () => {
    await withArtifact(async (root) => {
      const route = path.join(root, 'community/benefits/directory/index.html')
      await writeFile(route, (await readFile(route, 'utf8')).replace(oldValue, 'stale'))
      const result = verify(root)
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, expected)
    })
  })
}

for (const [relativePath, staleTitle] of [
  ['index.html', '<title>Ria & Seoa PaPa – 0 → 1</title>'],
  ['lab/index.html', '<title>0 → 1 – Ria & Seoa PaPa</title>'],
]) {
  test(`rejects the stale 0 → 1 title for ${relativePath}`, async () => {
    await withArtifact(async (root) => {
      const artifactPath = path.join(root, relativePath)
      const html = await readFile(artifactPath, 'utf8')
      await writeFile(artifactPath, html.replace(/<title>[^<]+<\/title>/, staleTitle))
      const result = verify(root)
      assert.notEqual(result.status, 0, `verifier unexpectedly accepted the stale title for ${relativePath}`)
      assert.match(result.stderr, new RegExp(`${relativePath.replaceAll('/', '\\/')} has unexpected document title`))
    })
  })
}

const routeTitleDecoys = [
  ['index.html', 'Ria & Seoa PaPa – 수익실험실', 'Ria & Seoa PaPa – 0 → 1'],
  ['lab/index.html', '수익실험실 – Ria & Seoa PaPa', '0 → 1 – Ria & Seoa PaPa'],
]
const titleDecoyMarkup = [
  ['comment', (html, expectedTitle) => html.replace('</head>', `<!-- <title>${expectedTitle}</title> --></head>`)],
  ...['frameset', 'select', 'template'].map((container) => [
    container,
    (html, expectedTitle) => html.replace('</head>', `<${container}><title>${expectedTitle}</title></${container}></head>`),
  ]),
  ...['iframe', 'noembed', 'noframes', 'noscript', 'script', 'style', 'textarea', 'xmp'].map((container) => [
    container,
    (html, expectedTitle) => html.replace('</head>', `<${container}><title>${expectedTitle}</title></${container}></head>`),
  ]),
]

for (const [relativePath, expectedTitle, staleTitle] of routeTitleDecoys) {
  for (const [location, addDecoy] of titleDecoyMarkup) {
    test(`rejects the expected ${relativePath} title when it appears only in a ${location} decoy`, async () => {
      await withArtifact(async (root) => {
        const artifactPath = path.join(root, relativePath)
        const html = await readFile(artifactPath, 'utf8')
        const staleHtml = addDecoy(
          html.replace(`<title>${expectedTitle}</title>`, `<title>${staleTitle}</title>`),
          expectedTitle,
        )
        await writeFile(artifactPath, staleHtml)

        const result = verify(root)
        assert.notEqual(result.status, 0, `verifier unexpectedly accepted a ${location} title decoy for ${relativePath}`)
        assert.match(result.stderr, new RegExp(`${relativePath.replaceAll('/', '\\/')} has unexpected document title`))
      })
    })
  }
}

test('rejects duplicate effective document titles', async () => {
  await withArtifact(async (root) => {
    const artifactPath = path.join(root, 'index.html')
    const html = await readFile(artifactPath, 'utf8')
    await writeFile(
      artifactPath,
      html.replace('</head>', '<title>Ria & Seoa PaPa – 수익실험실</title></head>'),
    )

    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted duplicate document titles')
    assert.match(result.stderr, /index\.html must contain exactly one document title/)
  })
})

test('rejects a stale implied-head title before an explicit head containing the expected title', async () => {
  await withArtifact(async (root) => {
    const artifactPath = path.join(root, 'index.html')
    const html = await readFile(artifactPath, 'utf8')
    await writeFile(
      artifactPath,
      html.replace('<head>', '<title>Ria & Seoa PaPa – 0 → 1</title><head>'),
    )

    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly ignored a stale implied-head title')
    assert.match(result.stderr, /index\.html document title tags must appear only inside the explicit document head/)
  })
})

test('rejects a sole expected title before the explicit head', async () => {
  await withArtifact(async (root) => {
    const artifactPath = path.join(root, 'index.html')
    const html = await readFile(artifactPath, 'utf8')
    await writeFile(
      artifactPath,
      html.replace('<head><title>Ria & Seoa PaPa – 수익실험실</title>', '<title>Ria & Seoa PaPa – 수익실험실</title><head>'),
    )

    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted a title outside the explicit head')
    assert.match(result.stderr, /index\.html.*document head|index\.html.*title.*head/)
  })
})

test('rejects a duplicate title after an explicit head end but before body starts', async () => {
  await withArtifact(async (root) => {
    const artifactPath = path.join(root, 'index.html')
    const html = await readFile(artifactPath, 'utf8')
    await writeFile(
      artifactPath,
      html.replace('</head><body>', '</head><title>Ria & Seoa PaPa – 0 → 1</title><body>'),
    )

    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted a post-head pre-body duplicate title')
    assert.match(result.stderr, /index\.html document title tags must appear only inside the explicit document head/)
  })
})

test('rejects a sole expected title after the explicit head end but before body starts', async () => {
  await withArtifact(async (root) => {
    const artifactPath = path.join(root, 'index.html')
    const html = await readFile(artifactPath, 'utf8')
    await writeFile(
      artifactPath,
      html.replace('<title>Ria & Seoa PaPa – 수익실험실</title>', '')
        .replace('</head><body>', '</head><title>Ria & Seoa PaPa – 수익실험실</title><body>'),
    )

    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted a post-head title')
    assert.match(result.stderr, /index\.html.*document head|index\.html.*title.*head/)
  })
})

for (const [label, mutate] of [
  ['before head', (html) => html.replace('<head>', '<title>Ria & Seoa PaPa – 0 → 1</title><head>')],
  ['after head before body', (html) => html.replace('</head><body>', '</head><title>Ria & Seoa PaPa – 0 → 1</title><body>')],
  ['inside body', (html) => html.replace('</body>', '<title>Ria & Seoa PaPa – 0 → 1</title></body>')],
  ['after body', (html) => html.replace('</html>', '<title>Ria & Seoa PaPa – 0 → 1</title></html>')],
]) {
  test(`rejects a real title ${label} despite a correct explicit-head title`, async () => {
    await withArtifact(async (root) => {
      const artifactPath = path.join(root, 'index.html')
      await writeFile(artifactPath, mutate(await readFile(artifactPath, 'utf8')))

      const result = verify(root)
      assert.notEqual(result.status, 0, `verifier unexpectedly accepted a title ${label}`)
      assert.match(result.stderr, /index\.html.*title.*head|index\.html.*exactly one document title/)
    })
  })
}

for (const [label, mutate] of [
  ['missing head', (html) => html.replace('<head>', '').replace('</head>', '')],
  ['unclosed head', (html) => html.replace('</head>', '')],
  ['duplicate head', (html) => html.replace('<head>', '<head><head>')],
  ['duplicate head end', (html) => html.replace('</head>', '</head></head>')],
  ['missing title', (html) => html.replace('<title>Ria & Seoa PaPa – 수익실험실</title>', '')],
]) {
  test(`rejects a generated route with ${label}`, async () => {
    await withArtifact(async (root) => {
      const artifactPath = path.join(root, 'index.html')
      await writeFile(artifactPath, mutate(await readFile(artifactPath, 'utf8')))

      const result = verify(root)
      assert.notEqual(result.status, 0, `verifier unexpectedly accepted ${label}`)
      assert.match(result.stderr, /index\.html.*document head|index\.html.*document title/)
    })
  })
}

for (const [label, mutate] of [
  ['missing html', (html) => html.replace('<html>', '').replace('</html>', '')],
  ['unclosed html', (html) => html.replace('</html>', '')],
  ['duplicate html', (html) => html.replace('<html>', '<html><html>').replace('</html>', '</html></html>')],
  ['head before html', (html) => html.replace('<html><head>', '<head>').replace('</head><body>', '</head><html><body>')],
  ['head after html', (html) => html.replace('<html><head>', '<html>').replace('</head><body>', '<body>').replace('</body></html>', '</body></html><head></head>')],
  ['head inside body', (html) => html.replace('<head>', '').replace('</head><body>', '<body><head></head>')],
  ['head after body', (html) => html.replace('<head>', '').replace('</head><body>', '<body>').replace('</body>', '</body><head></head>')],
  ['body before head closes', (html) => html.replace('</head><body>', '<body></head>')],
]) {
  test(`rejects a generated route with ${label} document structure`, async () => {
    await withArtifact(async (root) => {
      const artifactPath = path.join(root, 'index.html')
      await writeFile(artifactPath, mutate(await readFile(artifactPath, 'utf8')))

      const result = verify(root)
      assert.notEqual(result.status, 0, `verifier unexpectedly accepted ${label} document structure`)
      assert.match(result.stderr, /index\.html.*explicit.*document (?:html|head)/)
    })
  })
}

test('allows doctype, comments, and whitespace before the explicit document head', async () => {
  await withArtifact(async (root) => {
    const artifactPath = path.join(root, 'index.html')
    const html = await readFile(artifactPath, 'utf8')
    await writeFile(
      artifactPath,
      html.replace('<html><head>', '<html>\n  <!-- generated metadata -->\n  <head>'),
    )

    const result = verify(root)
    assert.equal(result.status, 0, result.stderr)
  })
})

for (const element of ['div', 'p', 'span', 'script']) {
  test(`rejects a ${element} element before the explicit document head`, async () => {
    await withArtifact(async (root) => {
      const artifactPath = path.join(root, 'index.html')
      const html = await readFile(artifactPath, 'utf8')
      await writeFile(
        artifactPath,
        html.replace('<head>', `<${element}></${element}><head>`),
      )

      const result = verify(root)
      assert.notEqual(result.status, 0, `verifier unexpectedly accepted a ${element} element before the document head`)
      assert.match(result.stderr, /index\.html.*explicit.*document head/)
    })
  })
}

test('rejects an end element before the explicit document head', async () => {
  await withArtifact(async (root) => {
    const artifactPath = path.join(root, 'index.html')
    const html = await readFile(artifactPath, 'utf8')
    await writeFile(artifactPath, html.replace('<head>', '</div><head>'))

    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted an end element before the document head')
    assert.match(result.stderr, /index\.html.*explicit.*document head/)
  })
})

test('allows a BOM, ASCII whitespace, comments, and one doctype around the explicit document html', async () => {
  await withArtifact(async (root) => {
    const artifactPath = path.join(root, 'index.html')
    const html = await readFile(artifactPath, 'utf8')
    await writeFile(
      artifactPath,
      `\uFEFF \n<!-- before -->\n${html}\n<!-- after -->\t`,
    )

    const result = verify(root)
    assert.equal(result.status, 0, result.stderr)
  })
})

for (const [label, mutate] of [
  ['a start element before html', (html) => html.replace('<html>', '<div><html>')],
  ['an end element before html', (html) => html.replace('<html>', '</div><html>')],
  ['a script element before html', (html) => html.replace('<html>', '<script>const decoy = true</script><html>')],
  ['a start element after html', (html) => html.replace('</html>', '</html><div>')],
  ['an end element after html', (html) => html.replace('</html>', '</html></div>')],
]) {
  test(`rejects ${label}`, async () => {
    await withArtifact(async (root) => {
      const artifactPath = path.join(root, 'index.html')
      await writeFile(artifactPath, mutate(await readFile(artifactPath, 'utf8')))

      const result = verify(root)
      assert.notEqual(result.status, 0, `verifier unexpectedly accepted ${label}`)
      assert.match(result.stderr, /index\.html.*explicit.*document html/)
    })
  })
}

for (const [tokenLabel, token] of [
  ['whitespace-prefixed end tag', '< /div>'],
  ['whitespace-prefixed start tag', '< div>'],
  ['whitespace-only token', '< >'],
  ['whitespace-after-slash end tag', '</ div>'],
  ['invalid hash opener', '<#invalid>'],
  ['lone angle bracket', '<'],
]) {
  for (const [location, mutate] of [
    ['inside head', (html) => html.replace('<title>', `${token}<title>`)],
    ['inside body', (html) => html.replace('</body>', `${token}</body>`)],
    ['outside html', (html) => html.replace('</html>', `</html>${token}`)],
  ]) {
    test(`rejects a ${tokenLabel} ${location}`, async () => {
      await withArtifact(async (root) => {
        const artifactPath = path.join(root, 'index.html')
        await writeFile(artifactPath, mutate(await readFile(artifactPath, 'utf8')))

        const result = verify(root)
        assert.notEqual(result.status, 0, `verifier unexpectedly accepted a ${tokenLabel} ${location}`)
        assert.match(result.stderr, /index\.html.*explicit.*document html/)
      })
    })
  }
}

test('accepts escaped comparison operators in generated body text', async () => {
  await withArtifact(async (root) => {
    const artifactPath = path.join(root, 'index.html')
    const html = await readFile(artifactPath, 'utf8')
    await writeFile(artifactPath, html.replace('</body>', '<p>1 &lt; 2 and 3 &gt; 2</p></body>'))

    const result = verify(root)
    assert.equal(result.status, 0, result.stderr)
  })
})

for (const [tokenLabel, token] of [
  ['malformed start tag', '<div a=>'],
  ['malformed end tag', '</div class=x>'],
  ['malformed declaration', '<!not-doctype>'],
]) {
  for (const [location, mutate] of [
    ['before html', (html) => html.replace('<html>', `${token}<html>`)],
    ['after html', (html) => html.replace('</html>', `</html>${token}`)],
  ]) {
    test(`rejects a ${tokenLabel} ${location}`, async () => {
      await withArtifact(async (root) => {
        const artifactPath = path.join(root, 'index.html')
        await writeFile(artifactPath, mutate(await readFile(artifactPath, 'utf8')))

        const result = verify(root)
        assert.notEqual(result.status, 0, `verifier unexpectedly accepted a ${tokenLabel} ${location}`)
        assert.match(result.stderr, /index\.html.*explicit.*document html/)
      })
    })
  }
}

for (const [tokenLabel, token] of [
  ['malformed start tag', '<div a=>'],
  ['malformed end tag', '</div class=x>'],
  ['malformed declaration', '<!not-doctype>'],
]) {
  for (const [location, mutate] of [
    ['before head', (html) => html.replace('<head>', `${token}<head>`)],
    ['before title', (html) => html.replace('<title>', `${token}<title>`)],
    ['before body', (html) => html.replace('<body>', `${token}<body>`)],
  ]) {
    test(`rejects a ${tokenLabel} ${location} inside the document`, async () => {
      await withArtifact(async (root) => {
        const artifactPath = path.join(root, 'index.html')
        await writeFile(artifactPath, mutate(await readFile(artifactPath, 'utf8')))

        const result = verify(root)
        assert.notEqual(result.status, 0, `verifier unexpectedly accepted a ${tokenLabel} ${location}`)
        assert.match(result.stderr, /index\.html.*explicit.*document (?:html|head)/)
      })
    })
  }
}

for (const [label, mutate] of [
  ['a second doctype before html', (html) => html.replace('<html>', '<!doctype html><html>')],
  ['a doctype after html', (html) => html.replace('</html>', '</html><!doctype html>')],
]) {
  test(`rejects ${label}`, async () => {
    await withArtifact(async (root) => {
      const artifactPath = path.join(root, 'index.html')
      await writeFile(artifactPath, mutate(await readFile(artifactPath, 'utf8')))

      const result = verify(root)
      assert.notEqual(result.status, 0, `verifier unexpectedly accepted ${label}`)
      assert.match(result.stderr, /index\.html.*explicit.*document html/)
    })
  })
}

test('rejects non-whitespace text before the explicit document html', async () => {
  await withArtifact(async (root) => {
    const artifactPath = path.join(root, 'index.html')
    const html = await readFile(artifactPath, 'utf8')
    await writeFile(artifactPath, html.replace('<!doctype html><html>', '<!doctype html>body text<html>'))

    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted text before the document html')
    assert.match(result.stderr, /index\.html.*explicit.*document html/)
  })
})

test('rejects body-starting text before the explicit document head', async () => {
  await withArtifact(async (root) => {
    const artifactPath = path.join(root, 'index.html')
    const html = await readFile(artifactPath, 'utf8')
    await writeFile(artifactPath, html.replace('<html><head>', '<html>body text<head>'))

    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted a head after body-starting text')
    assert.match(result.stderr, /index\.html.*explicit.*document head/)
  })
})

test('rejects body-starting text after a closed head before a second head decoy', async () => {
  await withArtifact(async (root) => {
    const artifactPath = path.join(root, 'index.html')
    const html = await readFile(artifactPath, 'utf8')
    await writeFile(
      artifactPath,
      html.replace(
        '</head><body>',
        '</head>body text<head><title>Ria & Seoa PaPa – 수익실험실</title></head><body>',
      ),
    )

    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted a second head after body-starting text')
    assert.match(result.stderr, /index\.html.*explicit.*document head/)
  })
})

test('rejects non-whitespace body-starting text followed by an expected title decoy', async () => {
  await withArtifact(async (root) => {
    const artifactPath = path.join(root, 'index.html')
    const html = await readFile(artifactPath, 'utf8')
    await writeFile(
      artifactPath,
      html.replace('<title>Ria & Seoa PaPa – 수익실험실</title>', '')
        .replace('</head><body>', '</head>body text<title>Ria & Seoa PaPa – 수익실험실</title><body>'),
    )

    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted a title after body-starting text')
    assert.match(result.stderr, /index\.html.*title.*head|index\.html.*document title/)
  })
})

test('allows semantic 0 → 1 body text with the correct explicit-head title', async () => {
  await withArtifact(async (root) => {
    const artifactPath = path.join(root, 'index.html')
    const html = await readFile(artifactPath, 'utf8')
    await writeFile(artifactPath, html.replace('<body>', '<body><p>0 → 1</p>'))

    const result = verify(root)
    assert.equal(result.status, 0, result.stderr)
  })
})

test('rejects a document title without a proper closing tag', async () => {
  await withArtifact(async (root) => {
    const artifactPath = path.join(root, 'index.html')
    const html = await readFile(artifactPath, 'utf8')
    await writeFile(artifactPath, html.replace('</title>', ''))

    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted an unclosed document title')
    assert.match(result.stderr, /index\.html document title must have a proper closing tag/)
  })
})

test('rejects a malformed document title closing tag', async () => {
  await withArtifact(async (root) => {
    const artifactPath = path.join(root, 'index.html')
    const html = await readFile(artifactPath, 'utf8')
    await writeFile(artifactPath, html.replace('</title>', '</title hidden>'))

    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted a malformed document title closing tag')
    assert.match(result.stderr, /index\.html document title must have a proper closing tag/)
  })
})

test('rejects an unterminated tag-like token after the document html', async () => {
  await withArtifact(async (root) => {
    const artifactPath = path.join(root, 'index.html')
    const html = await readFile(artifactPath, 'utf8')
    await writeFile(artifactPath, `${html}<div`)

    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted an unterminated tag-like token')
    assert.match(result.stderr, /index\.html.*explicit.*document html/)
  })
})

test('rejects an unterminated comment after the document html', async () => {
  await withArtifact(async (root) => {
    const artifactPath = path.join(root, 'index.html')
    const html = await readFile(artifactPath, 'utf8')
    await writeFile(artifactPath, `${html}<!-- malformed`)

    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted an unterminated comment')
    assert.match(result.stderr, /index\.html.*explicit.*document html/)
  })
})

test('rejects a generated homepage Community link without the AJAX opt-out class', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<title>Ria & Seoa PaPa – 수익실험실</title><link rel="canonical" href="https://www.breadlab.ai/"><a class="menu__list__item__link" href="/community/">Community</a>')
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted a Community link handled by the Jekyll AJAX loader')
    assert.match(result.stderr, /Community navigation link.*js-no-ajax/)
  })
})

test('rejects a non-breaking space between Community navigation classes', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<title>Ria & Seoa PaPa – 수익실험실</title><link rel="canonical" href="https://www.breadlab.ai/"><a class="menu__list__item__link\u00a0js-no-ajax" href="/community/">Community</a>')
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly treated non-ASCII whitespace as an HTML class separator')
    assert.match(result.stderr, /Community navigation link.*js-no-ajax/)
  })
})

test('rejects prefixed data attributes masquerading as href and class', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<title>Ria & Seoa PaPa – 수익실험실</title><link rel="canonical" href="https://www.breadlab.ai/"><a data-href="/community/" data-class="js-no-ajax">Community</a>')
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly treated data-href and data-class as navigation attributes')
    assert.match(result.stderr, /Community navigation link.*js-no-ajax/)
  })
})

test('rejects a Community AJAX opt-out that exists only in commented markup', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<title>Ria & Seoa PaPa – 수익실험실</title><link rel="canonical" href="https://www.breadlab.ai/"><!-- <a href="/community/" class="js-no-ajax">Community</a> --><a href="/community/">Community</a>')
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted a commented-out AJAX opt-out')
    assert.match(result.stderr, /Community navigation link.*js-no-ajax/)
  })
})

test('rejects a Community AJAX opt-out that exists only in a plain-text script', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<title>Ria & Seoa PaPa – 수익실험실</title><link rel="canonical" href="https://www.breadlab.ai/"><script type="text/plain"><a href="/community/" class="js-no-ajax">Community</a></script><a href="/community/">Community</a>')
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted an AJAX opt-out inside a plain-text script')
    assert.match(result.stderr, /Community navigation link.*js-no-ajax/)
  })
})

test('rejects a Community AJAX opt-out that exists only in a template', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<title>Ria & Seoa PaPa – 수익실험실</title><link rel="canonical" href="https://www.breadlab.ai/"><template><a href="/community/" class="js-no-ajax">Community</a></template><a href="/community/">Community</a>')
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted an AJAX opt-out inside a template')
    assert.match(result.stderr, /Community navigation link.*js-no-ajax/)
  })
})

test('rejects a Community AJAX opt-out after a plaintext start tag', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<title>Ria & Seoa PaPa – 수익실험실</title><link rel="canonical" href="https://www.breadlab.ai/"><plaintext><a href="/community/" class="js-no-ajax">Community</a>')
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly parsed markup after a plaintext start tag')
    assert.match(result.stderr, /Community navigation link.*js-no-ajax/)
  })
})

test('rejects a Community AJAX opt-out inside select content', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<title>Ria & Seoa PaPa – 수익실험실</title><link rel="canonical" href="https://www.breadlab.ai/"><select><a href="/community/" class="js-no-ajax">Community</a></select><a href="/community/">Community</a>')
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted an anchor from select content')
    assert.match(result.stderr, /Community navigation link.*js-no-ajax/)
  })
})

test('rejects a Community AJAX opt-out inside frameset noframes content', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<title>Ria & Seoa PaPa – 수익실험실</title><link rel="canonical" href="https://www.breadlab.ai/"><frameset><noframes><a href="/community/" class="js-no-ajax">Community</a></noframes></frameset><a href="/community/">Community</a>')
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
      await put(root, 'index.html', `<title>Ria & Seoa PaPa – 수익실험실</title><link rel="canonical" href="https://www.breadlab.ai/">${openingTag}<a href="/community/" class="js-no-ajax">Community</a>${closingTag}<a href="/community/">Community</a>`)
      const result = verify(root)
      assert.notEqual(result.status, 0, `verifier unexpectedly honored a self-closing flag on a ${container}`)
      assert.match(result.stderr, /Community navigation link.*js-no-ajax/)
    })
  })
}

test('rejects an unmarked Community menu link despite a marked body-link decoy', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<title>Ria & Seoa PaPa – 수익실험실</title><link rel="canonical" href="https://www.breadlab.ai/"><nav><a href="/community/" class="menu__list__item__link">Community</a></nav><main><a href="/community/" class="js-no-ajax">Community</a></main>')
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted a marked body-link decoy for an unmarked menu link')
    assert.match(result.stderr, /Community navigation link.*js-no-ajax/)
  })
})

test('accepts a marked Community menu link without imposing the opt-out on a body link', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<html><head><title>Ria & Seoa PaPa – 수익실험실</title><link rel="canonical" href="https://www.breadlab.ai/"></head><body><nav><a href="/community/" class="menu__list__item__link js-no-ajax">Community</a><ul class="menu__list"><li><a href="/benefits/" class="menu__list__item__link js-no-ajax">Benefits</a></li></ul></nav><main><a href="/community/">Community</a></main></body></html>')
    const result = verify(root)
    assert.equal(result.status, 0, result.stderr)
  })
})

test('rejects duplicate Community menu links when any lacks the AJAX opt-out', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<title>Ria & Seoa PaPa – 수익실험실</title><link rel="canonical" href="https://www.breadlab.ai/"><nav><a href="/community/" class="menu__list__item__link js-no-ajax">Community</a><a href="/community/" class="menu__list__item__link">Community</a></nav>')
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted an unmarked duplicate menu link')
    assert.match(result.stderr, /Community navigation link.*js-no-ajax/)
  })
})

test('rejects a marked Community body link when no actual menu link exists', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<title>Ria & Seoa PaPa – 수익실험실</title><link rel="canonical" href="https://www.breadlab.ai/"><main><a href="/community/" class="js-no-ajax">Community</a></main>')
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted a body link in place of the Community menu link')
    assert.match(result.stderr, /Community navigation link.*js-no-ajax/)
  })
})

test('accepts a marked Community link with a greater-than sign in a quoted attribute', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<html><head><title>Ria & Seoa PaPa – 수익실험실</title><link rel="canonical" href="https://www.breadlab.ai/"></head><body><a title="1 > 0" href="/community/" class="menu__list__item__link js-no-ajax">Community</a><ul class="menu__list"><li><a href="/benefits/" class="menu__list__item__link js-no-ajax">Benefits</a></li></ul></body></html>')
    const result = verify(root)
    assert.equal(result.status, 0, result.stderr)
  })
})

test('accepts visible Community text inside nested markup with a quoted greater-than attribute', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<html><head><title>Ria & Seoa PaPa – 수익실험실</title><link rel="canonical" href="https://www.breadlab.ai/"></head><body><a href="/community/" class="menu__list__item__link js-no-ajax"><span title="1 > 0">Community</span></a><ul class="menu__list"><li><a href="/benefits/" class="menu__list__item__link js-no-ajax">Benefits</a></li></ul></body></html>')
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
    for (const [part,title] of [['','복지 히트맵'],['rankings/','분야별 순위'],['fit/','내게 맞는 복지'],['company/','기업 근거 상세']]) {
    await put(root, `community/benefits/${part}index.html`, `<title>${title} · Benefit Atlas</title><meta name="description" content="예시 데이터"><link rel="canonical" href="https://www.breadlab.ai/community/benefits/${part}"><script type="module" src="/community/assets/benefits-main-Ab12Cd34.js"></script>`)
  }
  await cp(path.join(repoRoot, 'community-app/public/data/company-benefits'),path.join(root,'community/data/company-benefits'),{recursive:true})
  await put(root,'community/benefits/methodology/index.html','<h1>조사 기준·정정 이력</h1><p>예시 데이터</p>')
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
    await put(root, relativePath, `${title}<script type="module" src="/community/assets/benefits-main-Ab12Cd34.js"></script><link rel="stylesheet" href="/community/assets/styles.css">`)
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted an unhashed stylesheet')
    assert.match(result.stderr, /content-hashed/)
  })
})

test('rejects an existing unhashed image referenced by every community shell', async () => {
  await withArtifact(async (root) => {
    await put(root, 'community/assets/logo.png')
    for (const [relativePath, title] of shellTitles) {
      await put(root, relativePath, `${title}<script type="module" src="/community/assets/benefits-main-Ab12Cd34.js"></script><img src="/community/assets/logo.png">`)
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
    await put(root, relativePath, `${title}<script type="module" src="/community/assets/benefits-main-Ab12Cd34.js"></script><img src="/community/assets/missing-Xy12Za34.png">`)
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted a missing hashed asset')
    assert.match(result.stderr, /missing community asset/)
  })
})

test('rejects an unhashed local asset referenced through srcset', async () => {
  await withArtifact(async (root) => {
    await put(root, 'community/assets/logo.png')
    const [relativePath, title] = shellTitles.entries().next().value
    await put(root, relativePath, `${title}<script type="module" src="/community/assets/benefits-main-Ab12Cd34.js"></script><img srcset="https://cdn.example/logo.png 1x, /community/assets/logo.png 2x, data:image/png;base64,AA== 3x">`)
    const result = verify(root)
    assert.notEqual(result.status, 0, 'verifier unexpectedly accepted an unhashed srcset asset')
    assert.match(result.stderr, /content-hashed/)
  })
})

test('rejects a missing hashed local asset referenced through srcset', async () => {
  await withArtifact(async (root) => {
    const [relativePath, title] = shellTitles.entries().next().value
    await put(root, relativePath, `${title}<script type="module" src="/community/assets/benefits-main-Ab12Cd34.js"></script><source srcset="/community/assets/missing-Xy12Za34.webp 640w, https://cdn.example/image.webp 1280w">`)
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

for (const relative of ['benefits/index.html','benefits/fit/index.html','benefits/company/index.html']) {
 test(`rejects missing benefits artifact ${relative}`,async()=>withArtifact(async root=>{
  await rm(path.join(root,'community',relative));const result=verify(root);assert.notEqual(result.status,0);assert.match(result.stderr,/benefits|company-benefits/)
 }))
}
test('rejects benefits canonical and metadata mismatch',async()=>withArtifact(async root=>{
 await put(root,'community/benefits/fit/index.html','<title>wrong</title>');const result=verify(root);assert.notEqual(result.status,0);assert.match(result.stderr,/benefits\/fit/)
}))
test('rejects methodology metadata mismatch',async()=>withArtifact(async root=>{
 await put(root,'community/benefits/methodology/index.html','<h1>조사 기준·정정 이력</h1>');const result=verify(root);assert.notEqual(result.status,0);assert.match(result.stderr,/benefits\/methodology/)
}))
