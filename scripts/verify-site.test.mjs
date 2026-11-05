#!/usr/bin/env node

import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, readFile, cp } from 'node:fs/promises'
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
    ['index.html', '<title>Ria & Seoa PaPa – 수익실험실</title>', 'https://www.breadlab.ai/', '<a class="menu__list__item__link js-no-ajax" href="/community/">Community</a>'],
    ['blog/index.html', '<title>Blog – Ria & Seoa PaPa</title>', 'https://www.breadlab.ai/blog/', ''],
    ['lab/index.html', '<title>수익실험실 – Ria & Seoa PaPa</title>', 'https://www.breadlab.ai/lab/', ''],
    ['blog/ceph-cluster-install-with-helm.html', '<title>[Kubernets] Ceph Cluster install with helm – Ria & Seoa PaPa</title>', 'https://www.breadlab.ai/blog/ceph-cluster-install-with-helm', ''],
    ['404.html', '<title>Page Not Found – Ria & Seoa PaPa</title>', 'https://www.breadlab.ai/404.html', ''],
  ]
  for (const [relativePath, title, canonical, body] of routes) {
    await put(root, relativePath, `<!doctype html><html><head>${title}<link rel="canonical" href="${canonical}"></head><body>${body}</body></html>`)
  }
  for (const [relativePath, title] of shellTitles) {
    await put(root, relativePath, `${title}<script type="module" src="/community/assets/main-Ab12Cd34.js"></script><img src="/community/assets/logo-Xy12Za34.png"><img srcset="/community/assets/logo-Xy12Za34.png 1x, https://cdn.example/logo.png 2x, data:image/png;base64,AA== 3x"><img src="https://cdn.example/logo.png"><img src="data:image/png;base64,AA==">`)
  }
  for (const [part,title] of [['','복지 현황'],['fit/','조건 탐색'],['company/','기업 근거 상세'],['methodology/','조사 기준·정정 이력']]) {
    await put(root, `community/benefits/${part}index.html`, `<title>${title} · Benefit Atlas</title><meta name="description" content="공개 근거"><link rel="canonical" href="https://www.breadlab.ai/community/benefits/${part}"><script type="module" src="/community/assets/main-Ab12Cd34.js"></script>`)
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
    await put(root, 'index.html', '<html><head><title>Ria & Seoa PaPa – 수익실험실</title><link rel="canonical" href="https://www.breadlab.ai/"></head><body><nav><a href="/community/" class="menu__list__item__link js-no-ajax">Community</a></nav><main><a href="/community/">Community</a></main></body></html>')
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
    await put(root, 'index.html', '<html><head><title>Ria & Seoa PaPa – 수익실험실</title><link rel="canonical" href="https://www.breadlab.ai/"></head><body><a title="1 > 0" href="/community/" class="menu__list__item__link js-no-ajax">Community</a></body></html>')
    const result = verify(root)
    assert.equal(result.status, 0, result.stderr)
  })
})

test('accepts visible Community text inside nested markup with a quoted greater-than attribute', async () => {
  await withArtifact(async (root) => {
    await put(root, 'index.html', '<html><head><title>Ria & Seoa PaPa – 수익실험실</title><link rel="canonical" href="https://www.breadlab.ai/"></head><body><a href="/community/" class="menu__list__item__link js-no-ajax"><span title="1 > 0">Community</span></a></body></html>')
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
    await put(root, `community/benefits/${part}index.html`, `<title>${title} · Benefit Atlas</title><meta name="description" content="예시 데이터"><link rel="canonical" href="https://www.breadlab.ai/community/benefits/${part}"><script type="module" src="/community/assets/main-Ab12Cd34.js"></script>`)
  }
  await cp(path.join(repoRoot, 'community-app/public/data/company-benefits'),path.join(root,'community/data/company-benefits'),{recursive:true})
  const copiedManifestPath = path.join(root, 'community/data/company-benefits/manifest.json')
  const copiedManifest = JSON.parse(await readFile(copiedManifestPath, 'utf8'))
  const copiedDescriptors = [copiedManifest.taxonomy, copiedManifest.sources, copiedManifest.methodology, ...copiedManifest.listing_chunks, ...Object.values(copiedManifest.company_shards)]
  for (const descriptor of copiedDescriptors) descriptor.url = descriptor.url.replace(/^\//, '')
  await writeFile(copiedManifestPath, JSON.stringify(copiedManifest))
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
