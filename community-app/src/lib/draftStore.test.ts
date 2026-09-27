import { describe, expect, it, vi } from 'vitest'
import { clearDraft, createWriteDraft, draftKey, loadDraft, saveDraft } from './draftStore'

const postId = '56000000-0000-4000-8000-000000000010'
const tagId = '56000000-0000-4000-8000-000000000040'

function memoryStorage(initial?: Record<string, string>) {
  const values = new Map(Object.entries(initial ?? {}))
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
    removeItem: vi.fn((key: string) => { values.delete(key) }),
    values,
  }
}

describe('versioned draft storage', () => {
  it('keeps a stable cryptographic idempotency key through save and restore', () => {
    const storage = memoryStorage()
    const draft = createWriteDraft(() => '56000000-0000-4000-8000-000000000099', () => '2026-09-27T00:00:00.000Z')
    draft.title = '제목'; draft.bodyMarkdown = '본문'; draft.tagIds = [tagId]
    expect(saveDraft(storage, draft)).toBe(true)
    expect(loadDraft(storage, 'write')).toEqual(draft)
  })

  it.each(['{broken', JSON.stringify({ version: 2 }), JSON.stringify({ version: 1, kind: 'write', title: 3 })])(
    'ignores malformed, wrong-version, or wrong-shape data', (stored) => {
      const storage = memoryStorage({ [draftKey('write')]: stored })
      expect(loadDraft(storage, 'write')).toBeNull()
    },
  )

  it('rejects calendar-invalid draft timestamps instead of normalizing them', () => {
    const invalid = JSON.stringify({
      version: 1, kind: 'write', title: '제목', bodyMarkdown: '본문', tagIds: [tagId],
      updatedAt: '2026-02-29T00:00:00.000Z', idempotencyKey: '56000000-0000-4000-8000-000000000099',
    })
    expect(loadDraft(memoryStorage({ [draftKey('write')]: invalid }), 'write')).toBeNull()
  })

  it.each([
    { version: 1, kind: 'write', title: '제목', bodyMarkdown: '본문', tagIds: [tagId], updatedAt: '2026-09-27T00:00:00.000Z', idempotencyKey: '56000000-0000-4000-8000-000000000099', extra: true },
    JSON.parse('{"version":1,"kind":"write","title":"제목","bodyMarkdown":"본문","tagIds":["56000000-0000-4000-8000-000000000040"],"updatedAt":"2026-09-27T00:00:00.000Z","idempotencyKey":"56000000-0000-4000-8000-000000000099","__proto__":{"polluted":true}}'),
    { version: 1, kind: 'write', title: '제목', bodyMarkdown: '본문', tagIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'], updatedAt: '2026-09-27T00:00:00.000Z', idempotencyKey: '56000000-0000-4000-8000-000000000099' },
    { version: 1, kind: 'write', title: '제목', bodyMarkdown: '본문', tagIds: [tagId], updatedAt: '9999-01-01T00:00:00.000Z', idempotencyKey: '56000000-0000-4000-8000-000000000099' },
  ])('rejects non-canonical or future draft data %#', (draft) => {
    expect(loadDraft(memoryStorage({ [draftKey('write')]: JSON.stringify(draft) }), 'write')).toBeNull()
  })

  it('fails safely when storage throws or quota is unavailable', () => {
    const storage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('quota') }, removeItem: () => { throw new Error('blocked') } }
    const draft = createWriteDraft(() => '56000000-0000-4000-8000-000000000099')
    expect(loadDraft(storage, 'write')).toBeNull()
    expect(saveDraft(storage, draft)).toBe(false)
    expect(() => clearDraft(storage, 'write')).not.toThrow()
  })

  it('uses a bounded validated UUID in edit keys', () => {
    expect(draftKey('edit', postId)).toContain(postId)
    expect(() => draftKey('edit', '../attacker')).toThrow()
  })
})
