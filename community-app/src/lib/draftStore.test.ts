import { describe, expect, it, vi } from 'vitest'
import { clearDraft, createEditDraft, createWriteDraft, draftKey, isPersistableDraft, loadDraft, matchesDraftSnapshot, readDraftSnapshot, saveDraft } from './draftStore'

const postId = '56000000-0000-4000-8000-000000000010'
const tagId = '56000000-0000-4000-8000-000000000040'
const ownerId = '56000000-0000-4000-8000-000000000030'
const attachmentId = '56000000-0000-4000-8000-000000000070'
const uploadKey = '56000000-0000-4000-8000-000000000080'
const submissionId = '56000000-0000-4000-8000-000000000090'

interface FixtureAttachment extends Record<string, unknown> { attachmentId: string; idempotencyKey: string; fileName: string; mimeType: string; byteSize: number; width: number; height: number }
interface FixtureWorkflow extends Record<string, unknown> { ownerId: string; phase: string; attachments: FixtureAttachment[]; createdPostId: string | null; submission: unknown }
interface FixtureDraft extends Record<string, unknown> { title: string; bodyMarkdown: string; tagIds: string[]; uploadWorkflow: FixtureWorkflow }

function v2Draft(overrides: Record<string, unknown> = {}): FixtureDraft {
  const attachment: FixtureAttachment = { attachmentId, idempotencyKey: uploadKey, fileName: 'bread.png', mimeType: 'image/png', byteSize: 123, width: 20, height: 10 }
  return {
    version: 2, kind: 'write', title: '제목', bodyMarkdown: '본문', tagIds: [tagId], updatedAt: '2026-09-27T00:00:00.000Z',
    idempotencyKey: '56000000-0000-4000-8000-000000000099',
    uploadWorkflow: { ownerId, phase: 'uploaded', attachments: [attachment], createdPostId: null, submission: null },
    ...overrides,
  } as FixtureDraft
}

function submittedWorkflow(phase: 'post-created' | 'attaching' | 'attached' = 'post-created') {
  const draft = v2Draft()
  return {
    ...(draft.uploadWorkflow as Record<string, unknown>), phase, createdPostId: postId,
    submission: { submissionId, title: draft.title, bodyMarkdown: draft.bodyMarkdown, tagIds: draft.tagIds, attachmentIds: [attachmentId], expectedAttachmentTotal: 1 },
  }
}

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
  it('validates drafts with the same strict envelope used when loading', () => {
    const valid = createWriteDraft(() => '56000000-0000-4000-8000-000000000099', () => '2026-09-27T01:00:00.000Z')
    expect(isPersistableDraft(valid)).toBe(true)
    expect(isPersistableDraft({ ...valid, title: '가'.repeat(121) })).toBe(false)
    expect(isPersistableDraft({ ...valid, bodyMarkdown: '가'.repeat(50_001) })).toBe(false)
  })

  it('keeps a stable cryptographic idempotency key through save and restore', () => {
    const storage = memoryStorage()
    const draft = createWriteDraft(() => '56000000-0000-4000-8000-000000000099', () => '2026-09-27T00:00:00.000Z')
    draft.title = '제목'; draft.bodyMarkdown = '본문'; draft.tagIds = [tagId]
    expect(saveDraft(storage, draft)).toBe(true)
    expect(loadDraft(storage, 'write')).toEqual(draft)
  })

  it.each([
    ['extra key', () => ({ ...v2Draft(), extra: true })],
    ['storage path', () => { const value = v2Draft(); value.uploadWorkflow.attachments[0] = { ...value.uploadWorkflow.attachments[0], storagePath: `${ownerId}/${uploadKey}` }; return value }],
    ['public URL', () => { const value = v2Draft(); value.uploadWorkflow.attachments[0] = { ...value.uploadWorkflow.attachments[0], publicUrl: 'https://evil.test/image' }; return value }],
  ])('rejects invalid drafts before writing storage: %s', (_label, build) => {
    const storage = memoryStorage()
    expect(saveDraft(storage, build() as never)).toBe(false)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('stores the canonical parsed representation of a valid draft', () => {
    const storage = memoryStorage()
    const draft = v2Draft()
    draft.tagIds = [tagId.toUpperCase()]
    draft.uploadWorkflow.ownerId = ownerId.toUpperCase()
    expect(saveDraft(storage, draft as never)).toBe(true)
    const stored = JSON.parse(storage.setItem.mock.calls[0][1])
    expect(stored.tagIds).toEqual([tagId])
    expect(stored.uploadWorkflow.ownerId).toBe(ownerId)
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

  it('distinguishes missing, present, and unreadable raw storage snapshots', () => {
    const storage = memoryStorage()
    expect(readDraftSnapshot(storage, 'write')).toEqual({ ok: true, raw: null })
    storage.setItem(draftKey('write'), '{broken')
    expect(readDraftSnapshot(storage, 'write')).toEqual({ ok: true, raw: '{broken' })
    expect(readDraftSnapshot({ ...storage, getItem: () => { throw new Error('blocked') } }, 'write')).toEqual({ ok: false })
  })

  it('only matches a readable non-null byte-exact submitted draft snapshot', () => {
    const draft = createWriteDraft(() => '56000000-0000-4000-8000-000000000099', () => '2026-09-27T00:00:00.000Z')
    const storage = memoryStorage()
    expect(saveDraft(storage, draft)).toBe(true)
    const raw = storage.values.get(draftKey('write'))!
    expect(matchesDraftSnapshot({ ok: true, raw }, draft)).toBe(true)
    expect(matchesDraftSnapshot({ ok: true, raw: null }, draft)).toBe(false)
    expect(matchesDraftSnapshot({ ok: true, raw: `${raw} ` }, draft)).toBe(false)
    expect(matchesDraftSnapshot({ ok: false }, draft)).toBe(false)
  })

  it('matches immediate saved snapshots for write and edit drafts', () => {
    const storage = memoryStorage()
    const write = createWriteDraft(() => '56000000-0000-4000-8000-000000000099', () => '2026-09-27T00:00:00.000Z')
    const edit = createEditDraft(postId, '제목', '본문', [tagId], '2026-09-27T00:00:00.000Z')
    expect(saveDraft(storage, write)).toBe(true)
    expect(saveDraft(storage, edit)).toBe(true)
    expect(matchesDraftSnapshot(readDraftSnapshot(storage, 'write'), write)).toBe(true)
    expect(matchesDraftSnapshot(readDraftSnapshot(storage, 'edit', postId), edit)).toBe(true)
  })

  it('serializes equivalent valid drafts to the same canonical property order', () => {
    const first = memoryStorage(); const second = memoryStorage()
    const draft = createWriteDraft(() => '56000000-0000-4000-8000-000000000099', () => '2026-09-27T00:00:00.000Z')
    const reordered = { uploadWorkflow: draft.uploadWorkflow, idempotencyKey: draft.idempotencyKey, updatedAt: draft.updatedAt, tagIds: draft.tagIds, bodyMarkdown: draft.bodyMarkdown, title: draft.title, kind: draft.kind, version: draft.version }
    expect(saveDraft(first, draft)).toBe(true)
    expect(saveDraft(second, reordered)).toBe(true)
    expect(first.values.get(draftKey('write'))).toBe(second.values.get(draftKey('write')))
  })

  it('uses a bounded validated UUID in edit keys', () => {
    expect(draftKey('edit', postId)).toContain(postId)
    expect(() => draftKey('edit', '../attacker')).toThrow()
  })

  it('loads the strict v2 workflow without persisting a storage path or public URL', () => {
    const draft = v2Draft()
    const loaded = loadDraft(memoryStorage({ [draftKey('write')]: JSON.stringify(draft) }), 'write')
    expect(loaded).toEqual(draft)
    expect(JSON.stringify(loaded)).not.toContain('storagePath')
    expect(JSON.stringify(loaded)).not.toContain('publicUrl')
  })

  it.each([
    ['draft extra key', () => ({ ...v2Draft(), extra: true })],
    ['workflow extra key', () => { const value = v2Draft(); value.uploadWorkflow = { ...value.uploadWorkflow, extra: true }; return value }],
    ['attachment extra key', () => { const value = v2Draft(); value.uploadWorkflow.attachments = [{ ...value.uploadWorkflow.attachments[0], extra: true }]; return value }],
    ['submission extra key', () => { const value = v2Draft({ uploadWorkflow: submittedWorkflow() }); (value.uploadWorkflow as Record<string, unknown>).submission = { ...((value.uploadWorkflow as Record<string, unknown>).submission as object), extra: true }; return value }],
  ])('rejects non-exact v2 keys: %s', (_label, build) => {
    expect(loadDraft(memoryStorage({ [draftKey('write')]: JSON.stringify(build()) }), 'write')).toBeNull()
  })

  it.each([
    ['too many attachments', () => { const value = v2Draft(); value.uploadWorkflow.attachments = Array.from({ length: 6 }, (_, index) => ({ ...value.uploadWorkflow.attachments[0], attachmentId: `56000000-0000-4000-8000-00000000007${index}`, idempotencyKey: `56000000-0000-4000-8000-00000000008${index}` })); return value }],
    ['duplicate attachment ID', () => { const value = v2Draft(); value.uploadWorkflow.attachments.push({ ...value.uploadWorkflow.attachments[0], idempotencyKey: '56000000-0000-4000-8000-000000000081' }); return value }],
    ['duplicate upload key', () => { const value = v2Draft(); value.uploadWorkflow.attachments.push({ ...value.uploadWorkflow.attachments[0], attachmentId: '56000000-0000-4000-8000-000000000071' }); return value }],
    ['oversized bytes', () => { const value = v2Draft(); value.uploadWorkflow.attachments[0].byteSize = 5 * 1024 * 1024 + 1; return value }],
    ['oversized dimensions', () => { const value = v2Draft(); value.uploadWorkflow.attachments[0].width = 4097; return value }],
    ['oversized pixels', () => { const value = v2Draft(); value.uploadWorkflow.attachments[0].width = 4000; value.uploadWorkflow.attachments[0].height = 4000; return value }],
    ['empty file name', () => { const value = v2Draft(); value.uploadWorkflow.attachments[0].fileName = ''; return value }],
  ])('rejects invalid attachment bounds or duplicates: %s', (_label, build) => {
    expect(loadDraft(memoryStorage({ [draftKey('write')]: JSON.stringify(build()) }), 'write')).toBeNull()
  })

  it.each([
    ['uploaded with post id', () => { const value = v2Draft(); value.uploadWorkflow.createdPostId = postId; return value }],
    ['post-created without submission', () => v2Draft({ uploadWorkflow: { ...v2Draft().uploadWorkflow, phase: 'post-created', createdPostId: postId } })],
    ['post-created without post id', () => v2Draft({ uploadWorkflow: { ...submittedWorkflow(), createdPostId: null } })],
    ['submitted title mismatch', () => { const workflow = submittedWorkflow(); (workflow.submission as Record<string, unknown>).title = '다름'; return v2Draft({ uploadWorkflow: workflow }) }],
    ['submitted body mismatch', () => { const workflow = submittedWorkflow(); (workflow.submission as Record<string, unknown>).bodyMarkdown = '다름'; return v2Draft({ uploadWorkflow: workflow }) }],
    ['submitted tags mismatch', () => { const workflow = submittedWorkflow(); (workflow.submission as Record<string, unknown>).tagIds = []; return v2Draft({ uploadWorkflow: workflow }) }],
    ['submitted IDs mismatch', () => { const workflow = submittedWorkflow(); (workflow.submission as Record<string, unknown>).attachmentIds = ['56000000-0000-4000-8000-000000000071']; return v2Draft({ uploadWorkflow: workflow }) }],
  ])('rejects inconsistent workflow phases and submitted snapshots: %s', (_label, build) => {
    expect(loadDraft(memoryStorage({ [draftKey('write')]: JSON.stringify(build()) }), 'write')).toBeNull()
  })

  it('accepts every durable post-create phase with the exact submitted snapshot', () => {
    for (const phase of ['post-created', 'attaching', 'attached'] as const) {
      const draft = v2Draft({ uploadWorkflow: submittedWorkflow(phase) })
      expect(loadDraft(memoryStorage({ [draftKey('write')]: JSON.stringify(draft) }), 'write')).toEqual(draft)
    }
  })

  it('accepts an uploaded phase submitted checkpoint before create while requiring no post id', () => {
    const workflow = { ...submittedWorkflow(), phase: 'uploaded', createdPostId: null }
    const draft = v2Draft({ uploadWorkflow: workflow })
    expect(loadDraft(memoryStorage({ [draftKey('write')]: JSON.stringify(draft) }), 'write')).toEqual(draft)
  })

  it('rejects an uploaded phase when its non-null submission is malformed', () => {
    const workflow = { ...submittedWorkflow(), phase: 'uploaded', createdPostId: null }
    ;(workflow.submission as Record<string, unknown>).extra = true
    const draft = v2Draft({ uploadWorkflow: workflow })
    expect(loadDraft(memoryStorage({ [draftKey('write')]: JSON.stringify(draft) }), 'write')).toBeNull()
  })

  it('never accepts legacy persisted URLs or paths, including evil origins, userinfo, queries, and fragments', () => {
    for (const publicUrl of [
      `https://evil.test/functions/v1/public-attachment/${attachmentId}`,
      `https://user@example.com/functions/v1/public-attachment/${attachmentId}`,
      `https://example.com/functions/v1/public-attachment/${attachmentId}?next=evil`,
      `https://example.com/functions/v1/public-attachment/${attachmentId}#evil`,
    ]) {
      const value = v2Draft()
      value.uploadWorkflow.attachments = [{ ...value.uploadWorkflow.attachments[0], storagePath: `${ownerId}/${uploadKey}`, publicUrl }]
      expect(loadDraft(memoryStorage({ [draftKey('write')]: JSON.stringify(value) }), 'write')).toBeNull()
    }
  })

  it('reconstructs valid v1 drafts as strict v2 while preserving all user content and identifiers', () => {
    const legacy = { version: 1, kind: 'write', title: ' 보존 제목 ', bodyMarkdown: '본문\n그대로', tagIds: [tagId], updatedAt: '2026-09-27T00:00:00.000Z', idempotencyKey: '56000000-0000-4000-8000-000000000099' }
    expect(loadDraft(memoryStorage({ [draftKey('write')]: JSON.stringify(legacy) }), 'write')).toEqual({ ...legacy, version: 2, uploadWorkflow: null })
  })
})
