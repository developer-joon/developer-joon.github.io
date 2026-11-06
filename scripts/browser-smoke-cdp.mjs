function asError(value, fallback) {
  if (value instanceof Error) return value
  if (value?.error instanceof Error) return value.error
  if (typeof value?.message === 'string') return Error(value.message)
  return Error(fallback)
}

export function sourceAnchorsAreSafe(anchors) {
  return anchors.length > 0 && anchors.every((link) => {
    const rel = new Set(link.rel.split(/\s+/).filter(Boolean))
    return link.protocol === 'https:' && !link.username && !link.password && link.target === '_blank' && rel.has('noopener') && rel.has('noreferrer')
  })
}

export function isCanonicalCompanyId(value) {
  return typeof value === 'string' && /^(?:KR-CRN-\d{13}|US-CIK\d{10})$/.test(value)
}

export async function fetchJsonWithTimeout(url, {
  timeoutMs = 5_000,
  fetchImpl = globalThis.fetch,
} = {}) {
  const controller = new AbortController()
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(Error(`fetch timed out after ${timeoutMs}ms: ${url}`))
    }, timeoutMs)
  })
  try {
    const response = await Promise.race([fetchImpl(url, { signal: controller.signal }), timeout])
    if (!response.ok) throw Error(`fetch failed with HTTP ${response.status}: ${url}`)
    return await Promise.race([response.json(), timeout])
  } finally {
    clearTimeout(timer)
  }
}

function listen(target, type, handler) {
  if (typeof target.addEventListener === 'function') {
    target.addEventListener(type, handler)
    return () => target.removeEventListener(type, handler)
  }
  if (typeof target.on === 'function') {
    target.on(type, handler)
    return () => target.removeListener(type, handler)
  }
  const property = `on${type}`
  const previous = target[property]
  target[property] = handler
  return () => {
    if (target[property] === handler) target[property] = previous ?? null
  }
}

export function waitForWebSocketOpen(socket, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let settled = false
    const removers = []
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      for (const remove of removers) remove()
      if (error) reject(error)
      else resolve()
    }
    removers.push(listen(socket, 'open', () => finish()))
    removers.push(listen(socket, 'error', (event) => finish(asError(event, 'CDP socket failed before opening'))))
    removers.push(listen(socket, 'close', () => finish(Error('CDP socket closed before opening'))))
    const timer = setTimeout(() => finish(Error(`CDP socket open timed out after ${timeoutMs}ms`)), timeoutMs)
  })
}

export function createCdpClient(socket, { commandTimeoutMs = 5_000, onEvent = () => {} } = {}) {
  let sequence = 0
  let failure
  const pending = new Map()
  const expired = new Set()
  const removers = []

  const rejectPending = (error) => {
    if (!failure) failure = error
    for (const callbacks of pending.values()) {
      clearTimeout(callbacks.timer)
      callbacks.reject(failure)
    }
    pending.clear()
  }

  const onMessage = (event) => {
    let message
    try {
      const data = event != null && 'data' in Object(event) ? event.data : event
      message = JSON.parse(typeof data === 'string' ? data : data.toString())
    } catch (error) {
      rejectPending(Error(`malformed CDP message: ${error.message}`, { cause: error }))
      return
    }

    if (Object.hasOwn(message, 'id')) {
      const callbacks = pending.get(message.id)
      if (!callbacks) {
        if (expired.delete(message.id)) return
        rejectPending(Error(`CDP response ${message.id} has no pending callback`))
        return
      }
      pending.delete(message.id)
      clearTimeout(callbacks.timer)
      if (message.error) callbacks.reject(Error(message.error.message ?? JSON.stringify(message.error)))
      else callbacks.resolve(message.result)
      return
    }

    try {
      onEvent(message)
    } catch (error) {
      rejectPending(asError(error, 'CDP event handler failed'))
    }
  }

  removers.push(listen(socket, 'message', onMessage))
  removers.push(listen(socket, 'close', () => rejectPending(Error('CDP socket closed'))))
  removers.push(listen(socket, 'error', (event) => rejectPending(asError(event, 'CDP socket error'))))

  const send = (method, params = {}, sessionId) => {
    if (failure) return Promise.reject(failure)
    return new Promise((resolve, reject) => {
      const id = ++sequence
      const timer = setTimeout(() => {
        if (!pending.delete(id)) return
        expired.add(id)
        reject(Error(`CDP command timed out after ${commandTimeoutMs}ms: ${method}`))
      }, commandTimeoutMs)
      pending.set(id, { resolve, reject, timer })
      try {
        socket.send(JSON.stringify({ id, method, params, sessionId }))
      } catch (error) {
        clearTimeout(timer)
        pending.delete(id)
        reject(error)
      }
    })
  }

  return {
    send,
    assertHealthy() {
      if (failure) throw failure
    },
    dispose() {
      for (const remove of removers.splice(0)) remove()
      expired.clear()
      if (pending.size > 0) rejectPending(Error('CDP client disposed'))
    },
  }
}
