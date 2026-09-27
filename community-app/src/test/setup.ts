import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'

export function installTestLockManager() {
  type Task = { callback: (lock: Lock) => unknown; resolve: (value: unknown) => void; reject: (reason?: unknown) => void }
  const queues = new Map<string, Task[]>()
  const active = new Set<string>()
  const drain = (name: string) => {
    if (active.has(name)) return
    const task = queues.get(name)?.shift()
    if (!task) { queues.delete(name); return }
    active.add(name)
    let result: unknown
    try { result = task.callback({ name, mode: 'exclusive' } as Lock) } catch (error) {
      task.reject(error)
      active.delete(name)
      drain(name)
      return
    }
    if (!(result instanceof Promise) && !(typeof result === 'object' && result !== null && 'then' in result)) {
      task.resolve(result)
      active.delete(name)
      drain(name)
      return
    }
    void Promise.resolve(result).then(task.resolve, task.reject).finally(() => {
      active.delete(name)
      drain(name)
    })
  }
  const request = <T>(
    name: string,
    optionsOrCallback: LockOptions | ((lock: Lock) => T | PromiseLike<T>),
    maybeCallback?: (lock: Lock) => T | PromiseLike<T>,
  ) => {
    const options = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
    if (!callback || (options?.mode && options.mode !== 'exclusive')) return Promise.reject(new Error('unsupported test lock request'))
    return new Promise<T>((resolve, reject) => {
      const queue = queues.get(name) ?? []
      queue.push({ callback, resolve: resolve as (value: unknown) => void, reject })
      queues.set(name, queue)
      drain(name)
    })
  }
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } })
}

beforeEach(installTestLockManager)
afterEach(cleanup)
