#!/usr/bin/env node
// Ephemeral browser proof for the current fail-closed prepublication build.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

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
    name = name.slice('/community/'.length); if (!name || name.endsWith('/')) name += 'index.html'
    const filename = path.resolve(root, name); if (!filename.startsWith(`${root}${path.sep}`)) throw Error('unsafe path')
    const body = await readFile(filename)
    response.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[path.extname(filename)] ?? 'application/octet-stream'); response.end(body)
  } catch { response.writeHead(404).end() }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = spawn(chrome, ['--headless','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-extensions','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let socket
try {
  let port
  for (let attempt = 0; attempt < 100; attempt++) { try { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch { await sleep(100) } }
  if (!port) throw Error('Chromium did not start')
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); socket = new WebSocketClient(webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let sequence = 0; const pending = new Map(); const requests = []; const errors = []
  socket.onmessage = (event) => { const message = JSON.parse(event.data); if (message.id) { const callbacks = pending.get(message.id); pending.delete(message.id); message.error ? callbacks.reject(Error(message.error.message)) : callbacks.resolve(message.result) } else if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url); else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text) }
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, sessionId })) })
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }); const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }); const call = (method, params) => send(method, params, sessionId)
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable')
  const evaluate = async (expression) => (await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value
  const wait = async (expression) => { for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(`Boolean(${expression})`).catch(() => false)) return; await sleep(100) } throw Error(`Timed out: ${expression}; body=${await evaluate('document.body.innerText')}; errors=${errors}`) }
  for (const route of ['', 'fit/', 'company/', 'methodology/']) {
    requests.length = 0; await call('Page.navigate', { url: `${origin}/community/benefits/${route}` }); await wait(`document.querySelector('[role="alert"]')`)
    const text = await evaluate(`document.querySelector('[role="alert"]').innerText`)
    assert.match(text, /사용할 수 없습니다|확인할 수 없습니다/)
    assert.ok(requests.some((url) => url.endsWith('/community/data/company-benefits/manifest.json')))
    assert.equal(await evaluate(`document.querySelectorAll('[data-company-id]').length`), 0)
  }
  assert.equal(errors.length, 0)
  console.log('Benefits browser fail-closed smoke passed: four supported routes, absent manifest, zero company rows, no ranking shell.')
} finally {
  try { socket?.close() } catch {}
  browser.kill('SIGTERM'); server.close(); await rm(profile, { recursive: true, force: true })
}
