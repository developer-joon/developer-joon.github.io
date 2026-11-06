import { spawn } from 'node:child_process'

const PROFILE_REMOVER_SOURCE = `
  import { rm } from 'node:fs/promises'
  await rm(process.argv[1], { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
`

function stageError(stage, error) {
  const cause = error instanceof Error ? error : Error(String(error))
  return Error(`${stage}: ${cause.message}`, { cause })
}

async function closeServer(server, timeoutMs) {
  if (!server) return
  await new Promise((resolve, reject) => {
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => finish(Error(`close timed out after ${timeoutMs}ms`)), timeoutMs)
    try {
      server.close(finish)
    } catch (error) {
      finish(error)
    }
  })
}

function browserExited(browser) {
  return browser.exitCode !== null || browser.signalCode !== null
}

async function signalBrowserAndWait(browser, signal, timeoutMs) {
  if (browserExited(browser)) return true
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error, stopped) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      browser.removeListener('close', onClose)
      browser.removeListener('error', onError)
      if (error) reject(error)
      else resolve(stopped)
    }
    const onClose = () => finish(null, true)
    const onError = (error) => finish(error)
    browser.once('close', onClose)
    browser.once('error', onError)
    const timer = setTimeout(() => finish(null, false), timeoutMs)
    try {
      if (!browser.kill(signal)) finish(Error(`failed to send ${signal}`))
    } catch (error) {
      finish(error)
    }
  })
}

async function stopBrowser(browser, termTimeoutMs, killTimeoutMs) {
  if (!browser || browserExited(browser)) return
  if (await signalBrowserAndWait(browser, 'SIGTERM', termTimeoutMs)) return
  if (browserExited(browser)) return
  if (!await signalBrowserAndWait(browser, 'SIGKILL', killTimeoutMs)) {
    throw Error(`browser KILL timed out after ${killTimeoutMs}ms`)
  }
}

function spawnProfileRemover(profile) {
  return spawn(process.execPath, ['--input-type=module', '--eval', PROFILE_REMOVER_SOURCE, profile], { stdio: 'ignore' })
}

async function removeProfileInChild(profile, timeoutMs, spawnProfileRemoval) {
  const child = spawnProfileRemoval(profile)
  await new Promise((resolve, reject) => {
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.removeListener?.('error', onError)
      child.removeListener?.('close', onClose)
      if (error) reject(error)
      else resolve()
    }
    const onError = (error) => finish(error)
    const onClose = (code, signal) => {
      if (code === 0) finish()
      else finish(Error(`remover exited with code ${code ?? 'null'} signal ${signal ?? 'null'}`))
    }
    child.once('error', onError)
    child.once('close', onClose)
    const timer = setTimeout(() => {
      const swallowLateError = () => {}
      child.on?.('error', swallowLateError)
      child.once?.('close', () => child.removeListener?.('error', swallowLateError))
      let failure = Error(`remove timed out after ${timeoutMs}ms`)
      try {
        if (!child.kill('SIGKILL')) failure = Error('failed to send SIGKILL to profile remover', { cause: failure })
      } catch (error) {
        failure = Error(`failed to kill profile remover: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
      } finally {
        child.unref?.()
        finish(failure)
      }
    }, timeoutMs)
  })
}

export async function cleanupBrowserSmoke({
  socket,
  browser,
  server,
  profile,
  spawnProfileRemoval = spawnProfileRemover,
  serverCloseTimeoutMs = 5_000,
  browserExitTimeoutMs,
  browserTermTimeoutMs = browserExitTimeoutMs ?? 5_000,
  browserKillTimeoutMs = 5_000,
  profileRemoveTimeoutMs = 5_000,
}) {
  const errors = []
  const attempt = async (stage, action) => {
    try {
      await action()
    } catch (error) {
      errors.push(stageError(stage, error))
    }
  }

  await attempt('socket', async () => socket?.close())
  await attempt('server', async () => closeServer(server, serverCloseTimeoutMs))
  await attempt('browser', async () => stopBrowser(browser, browserTermTimeoutMs, browserKillTimeoutMs))
  await attempt('profile', async () => {
    if (profile) await removeProfileInChild(profile, profileRemoveTimeoutMs, spawnProfileRemoval)
  })

  if (errors.length > 0) {
    throw new AggregateError(errors, `Browser smoke cleanup failed: ${errors.map((error) => error.message).join('; ')}`)
  }
}

export async function runWithBrowserCleanup(run, cleanup) {
  let primaryError
  try {
    return await run()
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    try {
      await cleanup()
    } catch (cleanupError) {
      if (!primaryError) throw cleanupError
      primaryError.cleanupError = cleanupError
    }
  }
}
