import { once } from 'node:events'
import { rm } from 'node:fs/promises'

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

async function stopBrowser(browser, timeoutMs) {
  if (browser.exitCode !== null || browser.signalCode !== null) return

  const closed = once(browser, 'close')
  browser.kill('SIGTERM')
  let timeout
  const stopped = await Promise.race([
    closed.then(() => true),
    new Promise((resolve) => {
      timeout = setTimeout(() => resolve(false), timeoutMs)
    }),
  ])
  clearTimeout(timeout)
  if (stopped) return

  if (browser.exitCode === null && browser.signalCode === null) {
    const killed = once(browser, 'close')
    browser.kill('SIGKILL')
    await killed
  }
}

export async function cleanupBrowserSmoke({
  socket,
  browser,
  server,
  profile,
  removeProfile = (target) => rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }),
  browserExitTimeoutMs = 5_000,
}) {
  try { socket?.close() } catch {}
  await closeServer(server)
  await stopBrowser(browser, browserExitTimeoutMs)
  await removeProfile(profile)
}
