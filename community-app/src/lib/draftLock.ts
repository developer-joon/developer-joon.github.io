export class DraftLockUnavailableError extends Error {
  constructor() {
    super('draft Web Lock unavailable')
    this.name = 'DraftLockUnavailableError'
  }
}

export async function withDraftLock<T>(name: string, operation: () => T | PromiseLike<T>): Promise<T> {
  let locks: LockManager | undefined
  try {
    locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  } catch {
    throw new DraftLockUnavailableError()
  }
  if (!locks || typeof locks.request !== 'function') throw new DraftLockUnavailableError()

  let acquired = false
  try {
    return await locks.request(name, { mode: 'exclusive' }, lock => {
      if (!lock) throw new DraftLockUnavailableError()
      acquired = true
      return operation()
    })
  } catch (error) {
    if (!acquired || error instanceof DraftLockUnavailableError) throw new DraftLockUnavailableError()
    throw error
  }
}
