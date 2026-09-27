import { describe, expect, it, vi } from 'vitest'
import { installTestLockManager } from '../test/setup'
import { DraftLockUnavailableError, withDraftLock } from './draftLock'

describe('draft Web Locks', () => {
  it('excludes same-name operations until the current operation settles', async () => {
    let release!: () => void
    const order: string[] = []
    const first = withDraftLock('draft-a', async () => {
      order.push('first:start')
      await new Promise<void>(resolve => { release = resolve })
      order.push('first:end')
    })
    const second = withDraftLock('draft-a', async () => { order.push('second') })

    await Promise.resolve()
    expect(order).toEqual(['first:start'])
    release()
    await Promise.all([first, second])
    expect(order).toEqual(['first:start', 'first:end', 'second'])
  })

  it('fails closed when Web Locks are unavailable', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
    const operation = vi.fn()

    await expect(withDraftLock('draft-a', operation)).rejects.toBeInstanceOf(DraftLockUnavailableError)
    expect(operation).not.toHaveBeenCalled()
    installTestLockManager()
  })

  it('fails closed when the lock manager throws before acquisition', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: vi.fn().mockRejectedValue(new Error('blocked')) } })
    const operation = vi.fn()

    await expect(withDraftLock('draft-a', operation)).rejects.toBeInstanceOf(DraftLockUnavailableError)
    expect(operation).not.toHaveBeenCalled()
    installTestLockManager()
  })
})
