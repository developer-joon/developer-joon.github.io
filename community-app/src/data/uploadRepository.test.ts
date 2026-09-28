import { describe, expect, it, vi } from 'vitest'
import { createUploadRepository } from './uploadRepository'

const attachmentId = '56000000-0000-4000-8000-000000000070'
const key = '56000000-0000-4000-8000-000000000071'
const actorId = '56000000-0000-4000-8000-000000000030'
const payload = { attachmentId, storagePath: `${actorId}/${key}`, mimeType: 'image/webp', byteSize: 4, width: 2, height: 2 }

function client(overrides: Record<string, unknown> = {}) {
  return {
    invoke: vi.fn().mockResolvedValue({ data: payload, error: null }),
    rpc: vi.fn().mockResolvedValue({ data: 1, error: null }),
    publicAttachmentOrigin: 'https://example.test',
    publicAttachmentUrl: (id: string) => `https://example.test/functions/v1/public-attachment/${id}`,
    ...overrides,
  }
}

describe('uploadRepository', () => {
  it('sends FormData and a stable idempotency header without multipart transport headers', async () => {
    const api = client()
    const repository = createUploadRepository(api)
    const file = new File(['webp'], 'bread.webp', { type: 'image/webp' })

    const result = await repository.upload(file, key, actorId)

    expect(result).toEqual({ ok: true, data: { ...payload, publicUrl: `https://example.test/functions/v1/public-attachment/${attachmentId}` } })
    expect(api.invoke).toHaveBeenCalledWith('validate-upload', expect.objectContaining({ headers: { 'x-idempotency-key': key } }))
    const options = api.invoke.mock.calls[0][1]
    expect(options.body).toBeInstanceOf(FormData)
    expect(options.body.get('file')).toBe(file)
    expect(options.headers).not.toHaveProperty('Content-Type')
    expect(options.headers).not.toHaveProperty('Content-Length')
  })

  it.each([
    [{ ...payload, extra: true }],
    [{ ...payload, attachmentId: 'bad' }],
    [{ ...payload, byteSize: -1 }],
    [{ ...payload, width: 0 }],
  ])('rejects malformed or non-exact upload response %#', async (data) => {
    const repository = createUploadRepository(client({ invoke: vi.fn().mockResolvedValue({ data, error: null }) }))
    await expect(repository.upload(new File(['webp'], 'x.webp', { type: 'image/webp' }), key, actorId)).resolves.toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it('maps function and network errors to stable Korean UI errors', async () => {
    const functionRepo = createUploadRepository(client({ invoke: vi.fn().mockResolvedValue({ data: null, error: { code: '413', message: 'too large' } }) }))
    const networkRepo = createUploadRepository(client({ invoke: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) }))
    await expect(functionRepo.upload(new File(['x'], 'x.png', { type: 'image/png' }), key, actorId)).resolves.toMatchObject({ ok: false, error: { message: expect.any(String) } })
    await expect(networkRepo.upload(new File(['x'], 'x.png', { type: 'image/png' }), key, actorId)).resolves.toMatchObject({ ok: false, error: { code: 'network', message: '네트워크 연결을 확인해 주세요.' } })
  })

  it('strictly validates attach count and discard boolean results', async () => {
    const attachApi = client({ rpc: vi.fn().mockResolvedValueOnce({ data: 1, error: null }).mockResolvedValueOnce({ data: 0, error: null }) })
    const repository = createUploadRepository(attachApi)
    await expect(repository.attach('56000000-0000-4000-8000-000000000010', [attachmentId], 1)).resolves.toEqual({ ok: true, data: 1 })
    expect(attachApi.rpc).toHaveBeenCalledWith('attach_attachments', { p_post_id: '56000000-0000-4000-8000-000000000010', p_attachment_ids: [attachmentId], p_expected_total: 1 })
    await expect(repository.attach('56000000-0000-4000-8000-000000000010', [attachmentId], 1)).resolves.toMatchObject({ ok: false, error: { code: 'invalid_response' } })

    const discardRepo = createUploadRepository(client({ rpc: vi.fn().mockResolvedValue({ data: false, error: null }) }))
    await expect(discardRepo.discard({ attachmentId, storagePath: payload.storagePath })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it('rejects invalid UUID arguments before dispatch', async () => {
    const api = client()
    const repository = createUploadRepository(api)
    await expect(repository.attach('bad', [attachmentId], 1)).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    await expect(repository.discard({ attachmentId: 'bad', storagePath: payload.storagePath })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(api.rpc).not.toHaveBeenCalled()
  })

  it.each([
    `A6000000-0000-4000-8000-000000000030/${key}`,
    `${actorId}/A6000000-0000-4000-8000-000000000071`,
    `${actorId}/${key}/extra`,
    `${actorId}/../${key}`,
    `/${actorId}/${key}`,
    { owner: actorId, key },
  ])('rejects a non-canonical discard storage path before dispatch: %#', async (storagePath) => {
    const api = client()
    const repository = createUploadRepository(api)
    await expect(repository.discard({ attachmentId, storagePath } as never)).resolves.toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(api.rpc).not.toHaveBeenCalled()
  })

  it.each([
    'https://evil.test',
    'https://example.test:444',
  ])('rejects a public attachment URL outside the trusted exact origin: %s', async (origin) => {
    const repository = createUploadRepository(client({ publicAttachmentUrl: (id: string) => `${origin}/functions/v1/public-attachment/${id}` }))
    await expect(repository.upload(new File(['webp'], 'x.webp', { type: 'image/webp' }), key, actorId)).resolves.toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })

  it('supports an explicitly trusted localhost HTTP origin', async () => {
    const repository = createUploadRepository(client({
      publicAttachmentOrigin: 'http://localhost:54321',
      publicAttachmentUrl: (id: string) => `http://localhost:54321/functions/v1/public-attachment/${id}`,
    }))
    await expect(repository.upload(new File(['webp'], 'x.webp', { type: 'image/webp' }), key, actorId)).resolves.toMatchObject({ ok: true })
  })

  it.each([
    [{ ...payload, storagePath: `other/${key}` }, new File(['webp'], 'x.webp', { type: 'image/webp' })],
    [{ ...payload, byteSize: 3 }, new File(['webp'], 'x.webp', { type: 'image/webp' })],
    [{ ...payload, mimeType: 'image/png' }, new File(['webp'], 'x.webp', { type: 'image/webp' })],
    [{ ...payload, width: 4097 }, new File(['webp'], 'x.webp', { type: 'image/webp' })],
    [{ ...payload, width: 4000, height: 4000 }, new File(['webp'], 'x.webp', { type: 'image/webp' })],
  ])('binds upload response metadata to actor, intent, and file %#', async (data, image) => {
    const repository = createUploadRepository(client({ invoke: vi.fn().mockResolvedValue({ data, error: null }) }))
    await expect(repository.upload(image, key, actorId)).resolves.toMatchObject({ ok: false, error: { code: 'invalid_response' } })
  })
})
