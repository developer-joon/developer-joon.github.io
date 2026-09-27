import { isStrictUuid } from './validation'

export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export interface DraftBase { version: 1; title: string; bodyMarkdown: string; tagIds: string[]; updatedAt: string }
export interface WriteDraft extends DraftBase { kind: 'write'; idempotencyKey: string }
export interface EditDraft extends DraftBase { kind: 'edit'; postId: string }
export type PostDraft = WriteDraft | EditDraft
export type DraftKind = 'write' | 'edit'
export type DraftSnapshot = { ok: true; raw: string | null } | { ok: false }

const prefix = 'breadlab:community:draft:v1'
const maxStoredLength = 210_000
const timestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/
const maxClockSkewMs = 5 * 60 * 1000

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function daysInMonth(year: number, month: number) {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function isStrictTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = timestampPattern.exec(value)
  if (!match) return false
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = match.slice(1).map(Number)
  const valid = year >= 1 && month >= 1 && month <= 12
    && day >= 1 && day <= daysInMonth(year, month)
    && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59
    && (Number.isNaN(offsetHour) || (offsetHour <= 23 && offsetMinute <= 59))
  return valid && Date.parse(value) <= Date.now() + maxClockSkewMs
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort()
  const keys = [...expected].sort()
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
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function createWriteDraft(uuid = randomUuid, now = () => new Date().toISOString()): WriteDraft {
  return { version: 1, kind: 'write', title: '', bodyMarkdown: '', tagIds: [], updatedAt: now(), idempotencyKey: uuid() }
}

export function createEditDraft(postId: string, title: string, bodyMarkdown: string, tagIds: string[], updatedAt = new Date().toISOString()): EditDraft {
  if (!isStrictUuid(postId)) throw new Error('invalid post id')
  return { version: 1, kind: 'edit', postId: postId.toLowerCase(), title, bodyMarkdown, tagIds: [...tagIds], updatedAt }
}

function validCommon(value: Record<string, unknown>) {
  return value.version === 1 && typeof value.title === 'string' && value.title.length <= 120
    && typeof value.bodyMarkdown === 'string' && value.bodyMarkdown.length <= 50_000
    && Array.isArray(value.tagIds) && value.tagIds.length <= 3 && value.tagIds.every(isStrictUuid)
    && new Set(value.tagIds.map(tagId => tagId.toLowerCase())).size === value.tagIds.length
    && isStrictTimestamp(value.updatedAt)
}

function parseDraft(raw: string, kind: DraftKind, postId?: string): PostDraft | null {
  if (raw.length > maxStoredLength) return null
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!validCommon(record) || record.kind !== kind) return null
  if (kind === 'write') {
    if (!hasExactKeys(record, ['version', 'kind', 'title', 'bodyMarkdown', 'tagIds', 'updatedAt', 'idempotencyKey']) || !isStrictUuid(record.idempotencyKey)) return null
    return { version: 1, kind: 'write', title: record.title as string, bodyMarkdown: record.bodyMarkdown as string, tagIds: (record.tagIds as string[]).map(id => id.toLowerCase()), updatedAt: record.updatedAt as string, idempotencyKey: record.idempotencyKey.toLowerCase() }
  }
  if (!hasExactKeys(record, ['version', 'kind', 'postId', 'title', 'bodyMarkdown', 'tagIds', 'updatedAt']) || !isStrictUuid(postId) || record.postId !== postId.toLowerCase()) return null
  return { version: 1, kind: 'edit', postId: record.postId, title: record.title as string, bodyMarkdown: record.bodyMarkdown as string, tagIds: (record.tagIds as string[]).map(id => id.toLowerCase()), updatedAt: record.updatedAt as string }
}

export function loadDraft(storage: DraftStorage, kind: 'write'): WriteDraft | null
export function loadDraft(storage: DraftStorage, kind: 'edit', postId: string): EditDraft | null
export function loadDraft(storage: DraftStorage, kind: DraftKind, postId?: string): PostDraft | null {
  try {
    const raw = storage.getItem(kind === 'write' ? draftKey('write') : draftKey('edit', postId!))
    return raw === null ? null : parseDraft(raw, kind, postId)
  } catch { return null }
}

export function readDraftSnapshot(storage: DraftStorage, kind: 'write'): DraftSnapshot
export function readDraftSnapshot(storage: DraftStorage, kind: 'edit', postId: string): DraftSnapshot
export function readDraftSnapshot(storage: DraftStorage, kind: DraftKind, postId?: string): DraftSnapshot {
  try {
    return { ok: true, raw: storage.getItem(kind === 'write' ? draftKey('write') : draftKey('edit', postId!)) }
  } catch {
    return { ok: false }
  }
}

export function saveDraft(storage: DraftStorage, draft: PostDraft): boolean {
  try {
    storage.setItem(draft.kind === 'write' ? draftKey('write') : draftKey('edit', draft.postId), JSON.stringify(draft))
    return true
  } catch { return false }
}

export function clearDraft(storage: DraftStorage, kind: 'write'): void
export function clearDraft(storage: DraftStorage, kind: 'edit', postId: string): void
export function clearDraft(storage: DraftStorage, kind: DraftKind, postId?: string): void {
  try { storage.removeItem(kind === 'write' ? draftKey('write') : draftKey('edit', postId!)) } catch { /* unavailable storage is non-fatal */ }
}
