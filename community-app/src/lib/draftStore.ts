import { isStrictUuid } from './validation'

export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export interface DraftAttachment {
  attachmentId: string
  idempotencyKey: string
  fileName: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  byteSize: number
  width: number
  height: number
}
export interface DraftSubmission {
  submissionId: string
  title: string
  bodyMarkdown: string
  tagIds: string[]
  attachmentIds: string[]
  expectedAttachmentTotal: number
}
export interface UploadWorkflow {
  ownerId: string
  phase: 'uploaded' | 'post-created' | 'attaching' | 'attached'
  attachments: DraftAttachment[]
  createdPostId: string | null
  submission: DraftSubmission | null
}
export interface DraftBase { version: 2; title: string; bodyMarkdown: string; tagIds: string[]; updatedAt: string; uploadWorkflow: UploadWorkflow | null }
export interface WriteDraft extends DraftBase { kind: 'write'; idempotencyKey: string }
export interface EditDraft extends DraftBase { kind: 'edit'; postId: string }
export type PostDraft = WriteDraft | EditDraft
export type DraftKind = 'write' | 'edit'
export type DraftSnapshot = { ok: true; raw: string | null } | { ok: false }

const prefix = 'breadlab:community:draft:v1'
const maxStoredLength = 210_000
const timestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/
const maxClockSkewMs = 5 * 60 * 1000


function isLeapYear(year: number) { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) }
function daysInMonth(year: number, month: number) { if (month === 2) return isLeapYear(year) ? 29 : 28; return [4, 6, 9, 11].includes(month) ? 30 : 31 }
function isStrictTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = timestampPattern.exec(value); if (!match) return false
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = match.slice(1).map(Number)
  const valid = year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
    && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59
    && (Number.isNaN(offsetHour) || (offsetHour <= 23 && offsetMinute <= 59))
  return valid && Date.parse(value) <= Date.now() + maxClockSkewMs
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort(); const keys = [...expected].sort()
  return actual.length === keys.length && actual.every((key, index) => key === keys[index])
}

export function draftKey(kind: 'write'): string
export function draftKey(kind: 'edit', postId: string): string
export function draftKey(kind: DraftKind, postId?: string) {
  if (kind === 'write') return `${prefix}:write`
  if (!isStrictUuid(postId)) throw new Error('invalid post id')
  return `${prefix}:edit:${postId.toLowerCase()}`
}
function randomUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
export function createWriteDraft(uuid = randomUuid, now = () => new Date().toISOString()): WriteDraft {
  return { version: 2, kind: 'write', title: '', bodyMarkdown: '', tagIds: [], updatedAt: now(), idempotencyKey: uuid(), uploadWorkflow: null }
}
export function createEditDraft(postId: string, title: string, bodyMarkdown: string, tagIds: string[], updatedAt = new Date().toISOString()): EditDraft {
  if (!isStrictUuid(postId)) throw new Error('invalid post id')
  return { version: 2, kind: 'edit', postId: postId.toLowerCase(), title, bodyMarkdown, tagIds: [...tagIds], updatedAt, uploadWorkflow: null }
}
function validFields(title: unknown, body: unknown, tags: unknown, updatedAt: unknown) {
  return typeof title === 'string' && title.length <= 120 && typeof body === 'string' && body.length <= 50_000
    && Array.isArray(tags) && tags.length <= 3 && tags.every(isStrictUuid)
    && new Set(tags.map(id => String(id).toLowerCase())).size === tags.length && isStrictTimestamp(updatedAt)
}
function parseAttachment(value: unknown): DraftAttachment | null {
  if (!isRecord(value) || !hasExactKeys(value, ['attachmentId', 'idempotencyKey', 'fileName', 'mimeType', 'byteSize', 'width', 'height'])
    || !isStrictUuid(value.attachmentId) || !isStrictUuid(value.idempotencyKey)
    || typeof value.fileName !== 'string' || value.fileName.length < 1 || value.fileName.length > 255
    || !['image/jpeg', 'image/png', 'image/webp'].includes(String(value.mimeType)) || !Number.isSafeInteger(value.byteSize) || Number(value.byteSize) < 1 || Number(value.byteSize) > 5 * 1024 * 1024
    || !Number.isSafeInteger(value.width) || Number(value.width) < 1 || Number(value.width) > 4096 || !Number.isSafeInteger(value.height) || Number(value.height) < 1 || Number(value.height) > 4096
    || Number(value.width) * Number(value.height) > 12_000_000) return null
  return { attachmentId: String(value.attachmentId).toLowerCase(), idempotencyKey: String(value.idempotencyKey).toLowerCase(), fileName: value.fileName, mimeType: value.mimeType as DraftAttachment['mimeType'], byteSize: Number(value.byteSize), width: Number(value.width), height: Number(value.height) }
}
function parseSubmission(value: unknown, attachments: DraftAttachment[]): DraftSubmission | null {
  if (!isRecord(value) || !hasExactKeys(value, ['submissionId', 'title', 'bodyMarkdown', 'tagIds', 'attachmentIds', 'expectedAttachmentTotal']) || !isStrictUuid(value.submissionId)
    || !validFields(value.title, value.bodyMarkdown, value.tagIds, new Date(0).toISOString()) || !Array.isArray(value.attachmentIds) || value.attachmentIds.some(id => !isStrictUuid(id))
    || !Number.isSafeInteger(value.expectedAttachmentTotal)) return null
  const attachmentIds = (value.attachmentIds as string[]).map(id => id.toLowerCase())
  const expectedAttachmentTotal = Number(value.expectedAttachmentTotal)
  if (new Set(attachmentIds).size !== attachmentIds.length || attachmentIds.join() !== attachments.map(item => item.attachmentId).join()
    || expectedAttachmentTotal < attachmentIds.length || expectedAttachmentTotal > 5) return null
  return { submissionId: value.submissionId.toLowerCase(), title: value.title as string, bodyMarkdown: value.bodyMarkdown as string, tagIds: (value.tagIds as string[]).map(id => id.toLowerCase()), attachmentIds, expectedAttachmentTotal }
}
function parseWorkflow(value: unknown, draft: { title: string; bodyMarkdown: string; tagIds: string[] }): UploadWorkflow | null | false {
  if (value === null) return null
  if (!isRecord(value) || !hasExactKeys(value, ['ownerId', 'phase', 'attachments', 'createdPostId', 'submission']) || !isStrictUuid(value.ownerId)
    || !['uploaded', 'post-created', 'attaching', 'attached'].includes(String(value.phase)) || !Array.isArray(value.attachments) || value.attachments.length < 1 || value.attachments.length > 5) return false
  const ownerId = value.ownerId.toLowerCase(); const attachments: DraftAttachment[] = []
  for (const candidate of value.attachments) { const parsed = parseAttachment(candidate); if (!parsed) return false; attachments.push(parsed) }
  if (new Set(attachments.map(item => item.attachmentId)).size !== attachments.length || new Set(attachments.map(item => item.idempotencyKey)).size !== attachments.length) return false
  const submission = value.submission === null ? null : parseSubmission(value.submission, attachments)
  if (value.submission !== null && !submission) return false
  const phase = value.phase as UploadWorkflow['phase']
  if (phase !== 'uploaded' && !submission) return false
  if (submission && (submission.title !== draft.title || submission.bodyMarkdown !== draft.bodyMarkdown || submission.tagIds.join() !== draft.tagIds.join())) return false
  const createdPostId = value.createdPostId === null ? null : isStrictUuid(value.createdPostId) ? value.createdPostId.toLowerCase() : false
  if (createdPostId === false || (phase === 'uploaded' && createdPostId !== null) || (phase !== 'uploaded' && createdPostId === null)) return false
  return { ownerId, phase, attachments, createdPostId, submission }
}
function parseDraft(raw: string, kind: DraftKind, postId?: string): PostDraft | null {
  if (raw.length > maxStoredLength) return null
  let value: unknown; try { value = JSON.parse(raw) } catch { return null }
  if (!isRecord(value) || value.kind !== kind) return null
  const legacy = value.version === 1
  const commonLegacy = ['version', 'kind', 'title', 'bodyMarkdown', 'tagIds', 'updatedAt']
  const keys = kind === 'write' ? [...commonLegacy, 'idempotencyKey'] : [...commonLegacy, 'postId']
  if (legacy) {
    if (!hasExactKeys(value, keys) || !validFields(value.title, value.bodyMarkdown, value.tagIds, value.updatedAt)) return null
  } else if (value.version !== 2 || !hasExactKeys(value, [...keys, 'uploadWorkflow']) || !validFields(value.title, value.bodyMarkdown, value.tagIds, value.updatedAt)) return null
  const base = { version: 2 as const, title: value.title as string, bodyMarkdown: value.bodyMarkdown as string, tagIds: (value.tagIds as string[]).map(id => id.toLowerCase()), updatedAt: value.updatedAt as string }
  const workflow = legacy ? null : parseWorkflow(value.uploadWorkflow, base)
  if (workflow === false) return null
  if (kind === 'write') {
    if (!isStrictUuid(value.idempotencyKey)) return null
    return { ...base, kind: 'write', idempotencyKey: value.idempotencyKey.toLowerCase(), uploadWorkflow: workflow }
  }
  if (!isStrictUuid(postId) || value.postId !== postId.toLowerCase()) return null
  return { ...base, kind: 'edit', postId: value.postId as string, uploadWorkflow: workflow }
}
export function serializeDraft(draft: PostDraft): string | null {
  try {
    const canonical = parseDraft(JSON.stringify(draft), draft.kind, draft.kind === 'edit' ? draft.postId : undefined)
    return canonical ? JSON.stringify(canonical) : null
  } catch { return null }
}
export function isPersistableDraft(draft: PostDraft): boolean { return serializeDraft(draft) !== null }
export function loadDraft(storage: DraftStorage, kind: 'write'): WriteDraft | null
export function loadDraft(storage: DraftStorage, kind: 'edit', postId: string): EditDraft | null
export function loadDraft(storage: DraftStorage, kind: DraftKind, postId?: string): PostDraft | null {
  try { const raw = storage.getItem(kind === 'write' ? draftKey('write') : draftKey('edit', postId!)); return raw === null ? null : parseDraft(raw, kind, postId) } catch { return null }
}
export function readDraftSnapshot(storage: DraftStorage, kind: 'write'): DraftSnapshot
export function readDraftSnapshot(storage: DraftStorage, kind: 'edit', postId: string): DraftSnapshot
export function readDraftSnapshot(storage: DraftStorage, kind: DraftKind, postId?: string): DraftSnapshot {
  try { return { ok: true, raw: storage.getItem(kind === 'write' ? draftKey('write') : draftKey('edit', postId!)) } } catch { return { ok: false } }
}
export function matchesDraftSnapshot(snapshot: DraftSnapshot, draft: PostDraft): boolean {
  const expected = serializeDraft(draft)
  return snapshot.ok && snapshot.raw !== null && expected !== null && snapshot.raw === expected
}
export function saveDraft(storage: DraftStorage, draft: PostDraft): boolean {
  try {
    const canonical = serializeDraft(draft)
    if (canonical === null) return false
    storage.setItem(draft.kind === 'write' ? draftKey('write') : draftKey('edit', draft.postId), canonical)
    return true
  } catch { return false }
}
export function clearDraft(storage: DraftStorage, kind: 'write'): void
export function clearDraft(storage: DraftStorage, kind: 'edit', postId: string): void
export function clearDraft(storage: DraftStorage, kind: DraftKind, postId?: string): void {
  try { storage.removeItem(kind === 'write' ? draftKey('write') : draftKey('edit', postId!)) } catch { /* unavailable storage is non-fatal */ }
}
