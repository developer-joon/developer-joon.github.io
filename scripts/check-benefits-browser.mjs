#!/usr/bin/env node
// Ephemeral browser proof for the current published Benefit Atlas artifact.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createCdpClient, sourceAnchorsAreSafe, waitForWebSocketOpen } from './browser-smoke-cdp.mjs'
import { cleanupBrowserSmoke } from './browser-smoke-cleanup.mjs'

const root = path.resolve(process.argv[2] ?? 'community-app/dist')
const chrome = process.env.BENEFITS_CHROMIUM
if (!chrome) throw Error('Set BENEFITS_CHROMIUM to a local Chromium executable')
await assert.rejects(access(path.join(root, 'benefits/rankings/index.html')))
const WebSocketClient = globalThis.WebSocket ?? createRequire(import.meta.url)('ws').WebSocket
const profile = await mkdtemp(path.join(tmpdir(), 'benefits-browser-'))
const server = createServer(async (request, response) => {
  try {
    let name = new URL(request.url, 'http://localhost').pathname
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

  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
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
  assert.match(companyId, /^(KR-CRN|US-CIK)-/)

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

  await call('Page.navigate', { url: `${origin}/community/benefits/methodology/` })
  await wait(`document.querySelector('.benefits-evidence h2')`)
  await assertNoAlert()
  assert.match(await evaluate(`document.querySelector('.benefits-evidence h2').innerText`), /조사|방법|기준/)

  cdp.assertHealthy()
  assert.equal(errors.length, 0)
  console.log('Benefits browser smoke passed: published explorer, fit, concrete company benefits, methodology, and safe sources.')
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
