#!/usr/bin/env node
// Ephemeral browser proof for the current published Benefit Atlas artifact.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createCdpClient, fetchJsonWithTimeout, isCanonicalCompanyId, sourceAnchorsAreSafe, waitForWebSocketOpen } from './browser-smoke-cdp.mjs'
import { cleanupBrowserSmoke } from './browser-smoke-cleanup.mjs'
import { assertClaimFixture } from './check-benefits-browser-assertions.mjs'

const root = path.resolve(process.argv[2] ?? 'community-app/dist')
const chrome = process.env.BENEFITS_CHROMIUM
const claimFixture = process.env.BENEFITS_BROWSER_CLAIM_FIXTURE
  ? JSON.parse(process.env.BENEFITS_BROWSER_CLAIM_FIXTURE)
  : null
if (!chrome) throw Error('Set BENEFITS_CHROMIUM to a local Chromium executable')
await assert.rejects(access(path.join(root, 'benefits/rankings/index.html')))
const WebSocketClient = globalThis.WebSocket ?? createRequire(import.meta.url)('ws').WebSocket
const profile = await mkdtemp(path.join(tmpdir(), 'benefits-browser-'))
const server = createServer(async (request, response) => {
  try {
    let name = new URL(request.url, 'http://localhost').pathname
    if (name === '/benefits/' || name === '/benefits/index.html') name = '/community/benefits-root/index.html'
    if (name === '/benefits/company/' || name === '/benefits/company/index.html') name = '/community/benefits-root/company/index.html'
    if (!name.startsWith('/community/')) return response.writeHead(404).end()
    name = name.slice('/community/'.length)
    if (!name || name.endsWith('/')) name += 'index.html'
    const filename = path.resolve(root, name)
    if (!filename.startsWith(`${root}${path.sep}`)) throw Error('unsafe path')
    const body = await readFile(filename)
    response.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[path.extname(filename)] ?? 'application/octet-stream')
    response.end(body)
  } catch {
    response.writeHead(404).end()
  }
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let browser
let socket
let cdp
let primaryError
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  browser = spawn(chrome, ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking', '--disable-extensions', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })

  let port
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]
      break
    } catch {
      await sleep(100)
    }
  }
  if (!port) throw Error('Chromium did not start')

  const { webSocketDebuggerUrl } = await fetchJsonWithTimeout(`http://127.0.0.1:${port}/json/version`)
  socket = new WebSocketClient(webSocketDebuggerUrl)
  await waitForWebSocketOpen(socket)

  const requests = []
  const errors = []
  cdp = createCdpClient(socket, {
    commandTimeoutMs: 5_000,
    onEvent(message) {
      if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url)
      else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text)
    },
  })
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  const call = (method, params) => cdp.send(method, params, sessionId)
  await call('Page.enable')
  await call('Runtime.enable')
  await call('Network.enable')

  const evaluate = async (expression) => (await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value
  const wait = async (expression) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(`Boolean(${expression})`).catch(() => false)) return
      cdp.assertHealthy()
      await sleep(100)
    }
    throw Error(`Timed out: ${expression}; body=${await evaluate('document.body.innerText')}; errors=${errors}`)
  }
  const bodyText = () => evaluate('document.body.innerText')
  const assertNoAlert = async () => assert.equal(await evaluate(`document.querySelector('[role="alert"]') === null`), true)

  await call('Page.navigate', { url: `${origin}/community/benefits/` })
  await wait(`document.querySelectorAll('tr[data-company-id]').length > 0`)
  await wait(`Array.from(document.querySelectorAll('tr[data-company-id]')).some((row) => row.innerText.includes('혜택 내용 확인'))`)
  await assertNoAlert()
  const explorerText = await bodyText()
  assert.match(explorerText, /혜택 내용 확인/)
  assert.match(explorerText, /구체 혜택 확인 필요/)
  assert.ok(requests.some((url) => url.endsWith('/community/data/company-benefits/manifest.json')))
  const companyId = await evaluate(`Array.from(document.querySelectorAll('tr[data-company-id]')).find((row) => row.innerText.includes('혜택 내용 확인'))?.dataset.companyId`)
  assert.equal(isCanonicalCompanyId(companyId), true)

  await call('Page.navigate', { url: `${origin}/community/benefits/fit/?preset=custom&preferred_categories=leave&evidence=all` })
  await wait(`document.querySelectorAll('article[data-company-id]').length > 0`)
  await assertNoAlert()
  assert.match(await bodyText(), /조건 탐색/)

  await call('Page.navigate', { url: `${origin}/community/benefits/company/?id=${encodeURIComponent(companyId)}` })
  await wait(`document.querySelectorAll('.benefits-specific-card').length > 0`)
  await assertNoAlert()
  const companyText = await bodyText()
  assert.match(companyText, /확인된 복지 혜택/)
  assert.equal(await evaluate(`(${sourceAnchorsAreSafe.toString()})(Array.from(document.querySelectorAll('.benefits-specific-card a[href]')))`), true)

  await call('Page.navigate', { url: `${origin}/benefits/` })
  await wait(`document.querySelector('.domestic-directory__record')`)
  await assertNoAlert()
  const directoryText = await bodyText()
  assert.match(directoryText, /공개 명단과 사용자 검증으로 등록된 국내 사업체를 검색합니다/)
  assert.match(directoryText, /국내 전체 사업체 명부는 아닙니다/)
  assert.match(directoryText, /공개 확인 혜택|공개 확인된 복지 정보 없음/)
  assert.doesNotMatch(directoryText, /source_url|reviewer_id|submitter_id|service_role/i)
  if (claimFixture) await wait(`Array.from(document.querySelectorAll('.domestic-directory__record')).some((row) => row.dataset.companyId === ${JSON.stringify(claimFixture.companyId)})`)
  const directoryFixture = await evaluate(`(() => {
    const row = ${claimFixture ? `Array.from(document.querySelectorAll('.domestic-directory__record')).find((item) => item.dataset.companyId === ${JSON.stringify(claimFixture.companyId)})` : `document.querySelector('.domestic-directory__record')`}
    return row ? {
      officialCount: Number(row.dataset.officialCount),
      communityCount: Number(row.dataset.communityCount),
      categories: row.dataset.categories ? row.dataset.categories.split(',') : [],
    } : null
  })()`)
  const dynamicCompanyHref = await evaluate(`(() => {
    const row = ${claimFixture ? `Array.from(document.querySelectorAll('.domestic-directory__record')).find((item) => item.dataset.companyId === ${JSON.stringify(claimFixture.companyId)})` : `document.querySelector('.domestic-directory__record')`}
    return row?.querySelector('h3 a')?.href
  })()`)
  assert.match(dynamicCompanyHref, /\/benefits\/company\/\?id=/)

  await call('Page.navigate', { url: dynamicCompanyHref })
  await wait(`document.querySelectorAll('.benefit-company-page__group h2').length === 4`)
  await assertNoAlert()
  const dynamicCompanyText = await bodyText()
  for (const label of ['공식 확인 혜택', '커뮤니티 확인 혜택', '제보된 혜택', '재확인 필요']) assert.match(dynamicCompanyText, new RegExp(label))
  assert.doesNotMatch(dynamicCompanyText, /source_url|reviewer_id|submitter_id|service_role/i)
  assert.equal(await evaluate(`document.querySelector('.benefit-company-page__submit')?.getAttribute('href')?.startsWith('/community/benefits/claim/?company=')`), true)
  let coverage = 'generic'
  if (claimFixture) {
    const cards = await evaluate(`Array.from(document.querySelectorAll('.benefit-company-page__card')).map((card) => ({
      kind: card.dataset.benefitKind,
      category: card.dataset.category,
      id: card.id,
      metadata: Boolean(card.querySelector('.benefit-company-page__claim-facts')),
      reactionHref: card.querySelector('a[href*="/community/benefits/claim-reaction/"]')?.getAttribute('href') ?? null,
    }))`)
    coverage = assertClaimFixture({ rpc: directoryFixture, cards, expected: claimFixture }).coverage
  }

  await call('Page.navigate', { url: `${origin}/community/benefits/methodology/` })
  await wait(`document.querySelector('.benefits-evidence h2')`)
  await assertNoAlert()
  assert.match(await evaluate(`document.querySelector('.benefits-evidence h2').innerText`), /조사|방법|기준/)

  cdp.assertHealthy()
  assert.equal(errors.length, 0)
  console.log(`Benefits browser smoke passed (coverage=${coverage}): published explorer, fit, company detail, methodology, and safe sources.${coverage === 'generic' ? ' Claim-card behavior was not fixture-verified.' : ''}`)
} catch (error) {
  primaryError = error instanceof Error ? error : Error(String(error), { cause: error })
  throw primaryError
} finally {
  cdp?.dispose()
  try {
    await cleanupBrowserSmoke({ socket, browser, server, profile })
  } catch (cleanupError) {
    if (!primaryError) throw cleanupError
    try {
      primaryError.cleanupError = cleanupError
    } catch {
      console.error('Browser smoke cleanup also failed:', cleanupError)
    }
  }
}
