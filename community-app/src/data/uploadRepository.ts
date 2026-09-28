import type { Database } from '../types/database'
import { parseEnv } from '../config/env'
import { getSupabaseClient } from '../lib/supabase'
import { MAX_IMAGE_BYTES } from '../lib/imageValidation'

export interface UploadedAttachment {
  attachmentId: string
  storagePath: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  byteSize: number
  width: number
  height: number
  publicUrl: string
}
export interface PendingAttachment { attachmentId: string; storagePath: string }
export type UploadErrorCode = 'network' | 'auth_required' | 'rejected' | 'invalid_response' | 'invalid_argument' | 'unknown'
export interface UploadError { code: UploadErrorCode; message: string }
export type UploadResult<T> = { ok: true; data: T } | { ok: false; error: UploadError }

interface WireResponse { data: unknown; error: unknown }
export interface UploadClient {
  invoke(name: 'validate-upload', options: { body: FormData; headers: Record<string, string> }): PromiseLike<WireResponse>
  rpc(name: 'attach_attachments' | 'fail_attachment_upload', args: Record<string, unknown>): PromiseLike<WireResponse>
  publicAttachmentOrigin: string
  publicAttachmentUrl(attachmentId: string): string
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
function isUuid(value: unknown): value is string { return typeof value === 'string' && uuidPattern.test(value) }
function isCanonicalStoragePath(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const segments = value.split('/')
  return segments.length === 2 && segments.every(segment => isUuid(segment) && segment === segment.toLowerCase())
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function exactKeys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value).sort()
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index])
}
function failure(code: UploadErrorCode, message: string): UploadResult<never> { return { ok: false, error: { code, message } } }

async function errorDetails(error: unknown): Promise<Record<string, unknown>> {
  if (!isRecord(error)) return {}
  const details: Record<string, unknown> = { ...error }
  const response = error.context ?? error.response
  if (typeof globalThis.Response !== 'undefined' && response instanceof globalThis.Response) {
    details.status = response.status
    try {
      const body: unknown = await response.clone().json()
      if (isRecord(body)) Object.assign(details, body)
    } catch { /* response bodies are not guaranteed to be JSON */ }
  }
  return details
}

async function mapError(error: unknown): Promise<UploadError> {
  if (error instanceof TypeError) return { code: 'network', message: '네트워크 연결을 확인해 주세요.' }
  const details = await errorDetails(error)
  const text = [details.code, details.message, details.error].filter(value => typeof value === 'string').join(' ')
  const status = details.status
  if (status === 401 || status === 403 || /jwt|auth|unauthorized/i.test(text)) return { code: 'auth_required', message: '로그인이 필요합니다.' }
  if (status === 400 || status === 413 || status === 415 || /mime|size|dimension|polyglot|signature|invalid/i.test(text)) {
    return { code: 'rejected', message: '서버가 이미지 안전 검사를 통과시키지 않았습니다. 다른 이미지를 선택해 주세요.' }
  }
  if (/failed to fetch|network/i.test(text)) return { code: 'network', message: '네트워크 연결을 확인해 주세요.' }
  return { code: 'unknown', message: '이미지 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
}

function parseUpload(data: unknown, file: File, actorId: string, idempotencyKey: string, publicAttachmentOrigin: string, publicAttachmentUrl: (id: string) => string): UploadedAttachment {
  const keys = ['attachmentId', 'storagePath', 'mimeType', 'byteSize', 'width', 'height']
  if (!isRecord(data) || !exactKeys(data, keys) || !isUuid(data.attachmentId)
    || data.storagePath !== `${actorId.toLowerCase()}/${idempotencyKey.toLowerCase()}`
    || data.mimeType !== file.type
    || !['image/jpeg', 'image/png', 'image/webp'].includes(String(data.mimeType))
    || data.byteSize !== file.size || !Number.isSafeInteger(data.byteSize) || (data.byteSize as number) < 1 || (data.byteSize as number) > MAX_IMAGE_BYTES
    || !Number.isSafeInteger(data.width) || (data.width as number) < 1 || (data.width as number) > 4096
    || !Number.isSafeInteger(data.height) || (data.height as number) < 1 || (data.height as number) > 4096
    || (data.width as number) * (data.height as number) > 12_000_000) throw new Error('invalid upload response')
  const attachmentId = data.attachmentId.toLowerCase()
  const publicUrl = publicAttachmentUrl(attachmentId)
  let parsedUrl: URL; let trustedOrigin: URL
  try { parsedUrl = new URL(publicUrl); trustedOrigin = new URL(publicAttachmentOrigin) } catch { throw new Error('invalid public attachment URL') }
  if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash
    || trustedOrigin.origin !== publicAttachmentOrigin || !['http:', 'https:'].includes(trustedOrigin.protocol)
    || parsedUrl.origin !== trustedOrigin.origin
    || parsedUrl.pathname !== `/functions/v1/public-attachment/${attachmentId}` || parsedUrl.toString() !== publicUrl) throw new Error('invalid public attachment URL')
  return {
    attachmentId,
    storagePath: data.storagePath,
    mimeType: data.mimeType as UploadedAttachment['mimeType'],
    byteSize: data.byteSize as number,
    width: data.width as number,
    height: data.height as number,
    publicUrl,
  }
}

export function createUploadRepository(client: UploadClient) {
  return {
    publicAttachmentUrl: client.publicAttachmentUrl,
    async upload(file: File, idempotencyKey: string, actorId: string): Promise<UploadResult<UploadedAttachment>> {
      if (!isUuid(idempotencyKey) || !isUuid(actorId)) return failure('invalid_argument', '업로드 요청 식별자가 올바르지 않습니다.')
      const body = new FormData(); body.append('file', file)
      let response: WireResponse
      try { response = await client.invoke('validate-upload', { body, headers: { 'x-idempotency-key': idempotencyKey } }) }
      catch (error) { return { ok: false, error: await mapError(error) } }
      if (response.error) return { ok: false, error: await mapError(response.error) }
      try { return { ok: true, data: parseUpload(response.data, file, actorId, idempotencyKey, client.publicAttachmentOrigin, client.publicAttachmentUrl) } }
      catch { return failure('invalid_response', '업로드 서버 응답을 확인할 수 없습니다. 다시 시도해 주세요.') }
    },
    async attach(postId: string, attachmentIds: string[], expectedTotal: number): Promise<UploadResult<number>> {
      if (!isUuid(postId) || attachmentIds.length < 1 || attachmentIds.length > 5 || new Set(attachmentIds.map(id => id.toLowerCase())).size !== attachmentIds.length || attachmentIds.some(id => !isUuid(id)) || !Number.isSafeInteger(expectedTotal) || expectedTotal < attachmentIds.length || expectedTotal > 5) return failure('invalid_argument', '첨부 파일 요청이 올바르지 않습니다.')
      let response: WireResponse
      try { response = await client.rpc('attach_attachments', { p_post_id: postId, p_attachment_ids: attachmentIds, p_expected_total: expectedTotal }) }
      catch (error) { return { ok: false, error: await mapError(error) } }
      if (response.error) return { ok: false, error: await mapError(response.error) }
      if (!Number.isSafeInteger(response.data) || response.data !== expectedTotal) return failure('invalid_response', '첨부 파일 연결 결과를 확인할 수 없습니다. 다시 시도해 주세요.')
      return { ok: true, data: response.data as number }
    },
    async discard(attachment: PendingAttachment): Promise<UploadResult<true>> {
      if (!isUuid(attachment.attachmentId) || !isCanonicalStoragePath(attachment.storagePath)) return failure('invalid_argument', '첨부 파일 정리 요청이 올바르지 않습니다.')
      let response: WireResponse
      try { response = await client.rpc('fail_attachment_upload', { p_attachment_id: attachment.attachmentId, p_storage_path: attachment.storagePath }) }
      catch (error) { return { ok: false, error: await mapError(error) } }
      if (response.error) return { ok: false, error: await mapError(response.error) }
      if (response.data !== true) return failure('invalid_response', '업로드 파일을 정리하지 못했습니다. 다시 시도해 주세요.')
      return { ok: true, data: true }
    },
  }
}
export type UploadRepository = ReturnType<typeof createUploadRepository>

function createBrowserUploadClient(): UploadClient {
  const client = getSupabaseClient()
  const { supabaseUrl } = parseEnv(import.meta.env)
  return {
    invoke: (name, options) => client.functions.invoke(name, options),
    rpc: (name, args) => client.rpc(name, args as Database['public']['Functions'][typeof name]['Args']),
    publicAttachmentOrigin: new URL(supabaseUrl).origin,
    publicAttachmentUrl: attachmentId => new URL(`/functions/v1/public-attachment/${attachmentId}`, supabaseUrl).toString(),
  }
}
let browserRepository: UploadRepository | undefined
export function getUploadRepository(): UploadRepository {
  browserRepository ??= createUploadRepository(createBrowserUploadClient())
  return browserRepository
}
