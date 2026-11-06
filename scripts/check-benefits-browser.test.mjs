import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('browser cleanup waits for Chromium exit before removing its profile', async () => {
  const { cleanupBrowserSmoke } = await import('./browser-smoke-cleanup.mjs')
  class Browser extends EventEmitter {
    exitCode = null
    signalCode = null
    kill(signal) {
      setTimeout(() => {
        this.signalCode = signal
        this.emit('close', null, signal)
      }, 10)
      return true
    }
  }
  const browser = new Browser()
  let serverClosed = false
  let socketClosed = false
  let profileRemoved = false
  const server = {
    close(callback) {
      serverClosed = true
      callback()
    },
  }

  await cleanupBrowserSmoke({
    socket: { close: () => { socketClosed = true } },
    browser,
    server,
    profile: '/ephemeral/profile',
    removeProfile: async () => {
      assert.notEqual(browser.signalCode, null)
      profileRemoved = true
    },
  })

  assert.equal(socketClosed, true)
  assert.equal(serverClosed, true)
  assert.equal(profileRemoved, true)
})

test('browser cleanup bounds TERM and KILL and removes listeners before profile cleanup', async () => {
  const { cleanupBrowserSmoke } = await import('./browser-smoke-cleanup.mjs')
  class Browser extends EventEmitter {
    exitCode = null
    signalCode = null
    signals = []
    kill(signal) {
      this.signals.push(signal)
      return true
    }
  }
  const browser = new Browser()
  let profileRemoved = false

  await assert.rejects(
    cleanupBrowserSmoke({
      browser,
      server: { close: (callback) => callback() },
      profile: '/ephemeral/profile',
      removeProfile: async () => { profileRemoved = true },
      browserTermTimeoutMs: 5,
      browserKillTimeoutMs: 5,
    }),
    (error) => {
      assert.equal(error.name, 'AggregateError')
      assert.match(error.message, /browser KILL/i)
      return true
    },
  )

  assert.deepEqual(browser.signals, ['SIGTERM', 'SIGKILL'])
  assert.equal(profileRemoved, true)
  assert.equal(browser.listenerCount('close'), 0)
  assert.equal(browser.listenerCount('error'), 0)
})

test('cleanup attempts browser and profile after server close fails', async () => {
  const { cleanupBrowserSmoke } = await import('./browser-smoke-cleanup.mjs')
  class Browser extends EventEmitter {
    exitCode = null
    signalCode = null
    kill(signal) {
      this.signalCode = signal
      queueMicrotask(() => this.emit('close', null, signal))
      return true
    }
  }
  const browser = new Browser()
  let profileRemoved = false

  await assert.rejects(
    cleanupBrowserSmoke({
      browser,
      server: { close: (callback) => callback(Error('server exploded')) },
      profile: '/ephemeral/profile',
      removeProfile: async () => { profileRemoved = true },
      serverCloseTimeoutMs: 5,
    }),
    (error) => {
      assert.equal(error.name, 'AggregateError')
      assert.match(error.errors[0].message, /server: server exploded/)
      return true
    },
  )

  assert.equal(browser.signalCode, 'SIGTERM')
  assert.equal(profileRemoved, true)
})

test('cleanup aggregates stage failures in socket-server-browser-profile order', async () => {
  const { cleanupBrowserSmoke } = await import('./browser-smoke-cleanup.mjs')
  class Browser extends EventEmitter {
    exitCode = 0
    signalCode = null
  }

  await assert.rejects(
    cleanupBrowserSmoke({
      socket: { close: () => { throw Error('socket exploded') } },
      browser: new Browser(),
      server: { close: (callback) => callback(Error('server exploded')) },
      profile: '/ephemeral/profile',
      removeProfile: async () => { throw Error('profile exploded') },
    }),
    (error) => {
      assert.deepEqual(error.errors.map((item) => item.message), [
        'socket: socket exploded',
        'server: server exploded',
        'profile: profile exploded',
      ])
      return true
    },
  )
})

test('CDP client rejects pending commands on disconnect and clears lifecycle state', async () => {
  const { createCdpClient } = await import('./browser-smoke-cdp.mjs')
  const socket = new EventEmitter()
  socket.send = () => {}
  const client = createCdpClient(socket, { commandTimeoutMs: 50 })
  const pending = [client.send('Page.enable'), client.send('Runtime.enable')]
  socket.emit('close')
  const results = await Promise.allSettled(pending)
  assert.equal(results.every((result) => result.status === 'rejected' && /CDP socket closed/.test(result.reason.message)), true)
  await assert.rejects(client.send('Runtime.enable'), /CDP socket closed/)
  client.dispose()
  assert.equal(socket.listenerCount('message'), 0)
  assert.equal(socket.listenerCount('close'), 0)
  assert.equal(socket.listenerCount('error'), 0)
})

test('CDP client rejects commands when a connected socket errors', async () => {
  const { createCdpClient } = await import('./browser-smoke-cdp.mjs')
  const socket = new EventEmitter()
  socket.send = () => {}
  const client = createCdpClient(socket, { commandTimeoutMs: 50 })
  const pending = client.send('Page.enable')
  socket.emit('error', Error('connection reset'))
  await assert.rejects(pending, /connection reset/)
  client.dispose()
})

test('CDP client accepts WebSocket message data exposed by a prototype getter', async () => {
  const { createCdpClient } = await import('./browser-smoke-cdp.mjs')
  const socket = new EventEmitter()
  let sent
  socket.send = (payload) => { sent = JSON.parse(payload) }
  const client = createCdpClient(socket, { commandTimeoutMs: 50 })
  const pending = client.send('Page.enable')
  const event = Object.create({ data: JSON.stringify({ id: sent.id, result: { enabled: true } }) })
  socket.emit('message', event)
  assert.deepEqual(await pending, { enabled: true })
  client.dispose()
})

test('CDP client converts malformed and orphan responses into orderly failures', async () => {
  const { createCdpClient } = await import('./browser-smoke-cdp.mjs')
  for (const payload of ['not json', JSON.stringify({ id: 999, result: {} })]) {
    const socket = new EventEmitter()
    socket.send = () => {}
    const client = createCdpClient(socket, { commandTimeoutMs: 50 })
    const pending = client.send('Page.enable')
    socket.emit('message', { data: payload })
    await assert.rejects(pending, /malformed CDP message|no pending callback/)
    assert.throws(() => client.assertHealthy(), /malformed CDP message|no pending callback/)
    client.dispose()
  }
})

test('CDP client times out commands and ignores their late responses', async () => {
  const { createCdpClient } = await import('./browser-smoke-cdp.mjs')
  const socket = new EventEmitter()
  let sent
  socket.send = (payload) => { sent = JSON.parse(payload) }
  const client = createCdpClient(socket, { commandTimeoutMs: 5 })
  await assert.rejects(client.send('Page.enable'), /timed out.*Page\.enable/i)
  socket.emit('message', { data: JSON.stringify({ id: sent.id, result: {} }) })
  assert.doesNotThrow(() => client.assertHealthy())
  client.dispose()
})

test('source safety rejects empty and unsafe anchor collections', async () => {
  const { sourceAnchorsAreSafe } = await import('./browser-smoke-cdp.mjs')
  const safe = {
    protocol: 'https:',
    username: '',
    password: '',
    target: '_blank',
    rel: 'noreferrer noopener',
  }
  assert.equal(sourceAnchorsAreSafe([]), false)
  assert.equal(sourceAnchorsAreSafe([safe]), true)
  for (const unsafe of [
    { ...safe, protocol: 'http:' },
    { ...safe, username: 'user' },
    { ...safe, target: '_self' },
    { ...safe, rel: 'noopener' },
    { ...safe, rel: 'noreferrer' },
  ]) {
    assert.equal(sourceAnchorsAreSafe([unsafe]), false)
  }
})

test('primary smoke failure remains primary when cleanup also fails', async () => {
  const { runWithBrowserCleanup } = await import('./browser-smoke-cleanup.mjs')
  const primary = Error('smoke exploded')
  const cleanup = Error('cleanup exploded')
  await assert.rejects(
    runWithBrowserCleanup(async () => { throw primary }, async () => { throw cleanup }),
    (error) => {
      assert.equal(error, primary)
      assert.equal(error.cleanupError, cleanup)
      return true
    },
  )
})

test('cleanup failure is thrown when smoke itself succeeds', async () => {
  const { runWithBrowserCleanup } = await import('./browser-smoke-cleanup.mjs')
  const cleanup = Error('cleanup exploded')
  await assert.rejects(
    runWithBrowserCleanup(async () => 'ok', async () => { throw cleanup }),
    (error) => error === cleanup,
  )
})

test('browser smoke verifies the published Atlas and concrete benefit states', async () => {
  const source = await readFile(path.join(root, 'scripts/check-benefits-browser.mjs'), 'utf8')
  assert.match(source, /manifest\.json/)
  assert.match(source, /querySelectorAll\('tr\[data-company-id\]'\)\.length > 0/)
  assert.match(source, /혜택 내용 확인/)
  assert.match(source, /구체 혜택 확인 필요/)
  assert.match(source, /benefits-specific-card/)
  assert.match(source, /benefits-evidence h2/)
  assert.match(source, /benefits\/rankings\/index\.html/)
  assert.match(source, /primaryError/)
  assert.match(source, /row\.innerText\.includes\('혜택 내용 확인'\)/)
  assert.match(source, /\^\(KR-CRN\|US-CIK\)-/)
  assert.doesNotMatch(source, /US-EIN/)
  assert.match(source, /sourceAnchorsAreSafe\.toString\(\)/)
  assert.doesNotMatch(source, /absent manifest|zero company rows|fixture-v1|rankings_url|fitScore|rankOrder/)
})

test('built Atlas source contract consumes approved-v2 lineage and tiered evidence', async () => {
  const client = await readFile(path.join(root, 'community-app/src/data/benefitsArtifactClient.ts'), 'utf8')
  const explorer = await readFile(path.join(root, 'community-app/src/components/benefits/BenefitsExplorerShell.tsx'), 'utf8')
  const detail = await readFile(path.join(root, 'community-app/src/components/benefits/BenefitV2EvidenceGroup.tsx'), 'utf8')
  const company = await readFile(path.join(root, 'community-app/src/pages/BenefitsCompanyPage.tsx'), 'utf8')
  assert.match(client, /loadApprovedV2Projection/)
  assert.match(client, /runBounded/)
  assert.match(client, /approved projection canonical company join mismatch/)
  assert.match(client, /assertCompanyDetailEvidence/)
  assert.match(client, /loadAtlasCompanyDetails/)
  assert.match(explorer, /승인 v2 조사 · 전체/)
  assert.match(company, /BenefitV2EvidenceSection/)
  assert.match(company, /기존 공개 기록/)
  assert.match(detail, /확인된 복지 혜택/)
  assert.match(detail, /record\.statement/)
  assert.match(detail, /record\.supporting_quote/)
  assert.match(detail, /커뮤니티 보고/)
  assert.match(detail, /target="_blank" rel="noopener noreferrer"/)
})
