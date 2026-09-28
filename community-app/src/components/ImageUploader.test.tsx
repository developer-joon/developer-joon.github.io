import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UploadRepository, UploadedAttachment } from '../data/uploadRepository'
import { ImageUploader } from './ImageUploader'

const ids = [
  '56000000-0000-4000-8000-000000000070',
  '56000000-0000-4000-8000-000000000071',
  '56000000-0000-4000-8000-000000000072',
  '56000000-0000-4000-8000-000000000073',
  '56000000-0000-4000-8000-000000000074',
]
const actorId = '56000000-0000-4000-8000-000000000030'
const storageKeys = [
  '56000000-0000-4000-8000-000000000090',
  '56000000-0000-4000-8000-000000000091',
  '56000000-0000-4000-8000-000000000092',
  '56000000-0000-4000-8000-000000000093',
  '56000000-0000-4000-8000-000000000094',
]
function uploaded(index: number): UploadedAttachment {
  return { attachmentId: ids[index], storagePath: `${actorId}/${storageKeys[index]}`, mimeType: 'image/png', byteSize: 1, width: 1, height: 1, publicUrl: `https://example.test/functions/v1/public-attachment/${ids[index]}` }
}
function file(name: string, type = 'image/png') { return new File(['x'], name, { type }) }
function repository(upload = vi.fn().mockResolvedValue({ ok: true, data: uploaded(0) }), discard = vi.fn().mockResolvedValue({ ok: true, data: true })) {
  return { upload, discard, attach: vi.fn(), publicAttachmentUrl: (id: string) => `https://example.test/functions/v1/public-attachment/${id}` } as unknown as UploadRepository
}

beforeEach(() => {
  let uuid = 80
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => `56000000-0000-4000-8000-${String(uuid++).padStart(12, '0')}`) })
  URL.createObjectURL = vi.fn((value: Blob) => `blob:${(value as File).name}`)
  URL.revokeObjectURL = vi.fn()
})

describe('ImageUploader', () => {
  it('opens the file picker when the dropzone surface is clicked', () => {
    render(<ImageUploader repository={repository()} actorId={actorId} bodyLength={0} onInsert={vi.fn()} onStateChange={vi.fn()} />)
    const input = screen.getByLabelText('이미지 파일 선택') as HTMLInputElement
    const click = vi.spyOn(input, 'click')

    fireEvent.click(screen.getByRole('button', { name: '이미지를 끌어다 놓거나 선택하기' }))

    expect(click).toHaveBeenCalledOnce()
  })

  it('keeps upload concurrency at two', async () => {
    const pending: Array<(value: unknown) => void> = []
    let active = 0
    let peak = 0
    let index = 0
    const upload = vi.fn(() => {
      const current = index++
      active += 1
      peak = Math.max(peak, active)
      return new Promise(resolve => pending.push(value => { active -= 1; resolve(value) }))
        .then(() => ({ ok: true as const, data: uploaded(current) }))
    })
    render(<ImageUploader repository={repository(upload)} actorId={actorId} bodyLength={0} onInsert={vi.fn()} onStateChange={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('이미지 파일 선택'), { target: { files: [file('1.png'), file('2.png'), file('3.png'), file('4.png')] } })
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2))
    expect(peak).toBe(2)
    pending[0]({ ok: true })
    pending[1]({ ok: true })
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(4))
    expect(peak).toBe(2)
    pending[2]({ ok: true })
    pending[3]({ ok: true })
    await waitFor(() => expect(screen.getAllByText('업로드 완료')).toHaveLength(4))
  })

  it('filters invalid files before applying the remaining-slot count', async () => {
    const upload = vi.fn().mockResolvedValue({ ok: true, data: uploaded(0) })
    render(<ImageUploader repository={repository(upload)} actorId={actorId} bodyLength={0} existingCount={4} onInsert={vi.fn()} onStateChange={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('이미지 파일 선택'), { target: { files: [file('invalid.txt', 'text/plain'), file('valid.png')] } })

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1))
    expect(screen.getByText('valid.png')).toBeInTheDocument()
  })

  it('accepts picker and drop input and rejects additions beyond five', async () => {
    const repo = repository(vi.fn().mockResolvedValue({ ok: true, data: uploaded(0) }))
    render(<ImageUploader repository={repo} actorId="56000000-0000-4000-8000-000000000030" bodyLength={0} onInsert={vi.fn()} onStateChange={vi.fn()} />)
    const input = screen.getByLabelText('이미지 파일 선택')
    fireEvent.change(input, { target: { files: [file('one.png')] } })
    fireEvent.drop(screen.getByRole('button', { name: '이미지를 끌어다 놓거나 선택하기' }), { dataTransfer: { files: [file('two.png'), file('three.png'), file('four.png'), file('five.png')] } })
    await waitFor(() => expect(repo.upload).toHaveBeenCalledTimes(5))
    fireEvent.change(input, { target: { files: [file('six.png')] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('최대 5개')
  })

  it('keeps successful items through partial failure and retries only failure with the same key', async () => {
    const upload = vi.fn()
      .mockResolvedValueOnce({ ok: true, data: uploaded(0) })
      .mockResolvedValueOnce({ ok: false, error: { code: 'network', message: '네트워크 연결을 확인해 주세요.' } })
      .mockResolvedValueOnce({ ok: true, data: uploaded(1) })
    const onStateChange = vi.fn()
    render(<ImageUploader repository={repository(upload)} actorId="56000000-0000-4000-8000-000000000030" bodyLength={0} onInsert={vi.fn()} onStateChange={onStateChange} />)
    fireEvent.change(screen.getByLabelText('이미지 파일 선택'), { target: { files: [file('ok.png'), file('retry.png')] } })
    expect(await screen.findByText('네트워크 연결을 확인해 주세요.')).toBeInTheDocument()
    expect(screen.getByText('업로드 완료')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('업로드 완료')
    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
      blocked: true,
      attachments: [{ ...uploaded(0), idempotencyKey: upload.mock.calls[0][1], fileName: 'ok.png' }],
    }))

    fireEvent.click(screen.getByRole('button', { name: 'retry.png 다시 시도' }))
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(3))
    expect(upload.mock.calls[1][1]).toBe(upload.mock.calls[2][1])
    await waitFor(() => expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({
      blocked: false,
      attachments: [
        { ...uploaded(0), idempotencyKey: upload.mock.calls[0][1], fileName: 'ok.png' },
        { ...uploaded(1), idempotencyKey: upload.mock.calls[2][1], fileName: 'retry.png' },
      ],
    })))
  })

  it('reports uploading as a submit blocker and exposes an accessible status', async () => {
    let resolve!: (value: unknown) => void
    const upload = vi.fn(() => new Promise(done => { resolve = done }))
    const state = vi.fn()
    render(<ImageUploader repository={repository(upload)} actorId="56000000-0000-4000-8000-000000000030" bodyLength={0} onInsert={vi.fn()} onStateChange={state} />)
    fireEvent.change(screen.getByLabelText('이미지 파일 선택'), { target: { files: [file('slow.png')] } })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('slow.png 업로드 중'))
    expect(state).toHaveBeenLastCalledWith({ blocked: true, attachments: [] })
    resolve({ ok: true, data: uploaded(0) })
    await waitFor(() => expect(screen.getByText('업로드 완료')).toBeInTheDocument())
  })

  it('accepts upload success after StrictMode setup-cleanup-setup', async () => {
    const state = vi.fn()
    render(<StrictMode><ImageUploader repository={repository()} actorId={actorId} bodyLength={0} onInsert={vi.fn()} onStateChange={state} /></StrictMode>)
    fireEvent.change(screen.getByLabelText('이미지 파일 선택'), { target: { files: [file('strict.png')] } })
    await waitFor(() => expect(screen.getByText('업로드 완료')).toBeInTheDocument())
    expect(state).toHaveBeenLastCalledWith(expect.objectContaining({ blocked: false, attachments: [expect.objectContaining({ attachmentId: ids[0] })] }))
  })

  it('inserts canonical Markdown but refuses to exceed 50,000 body characters', async () => {
    const insert = vi.fn()
    const repo = repository()
    const view = render(<ImageUploader repository={repo} actorId="56000000-0000-4000-8000-000000000030" bodyLength={10} onInsert={insert} onStateChange={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('이미지 파일 선택'), { target: { files: [file('bread.png')] } })
    fireEvent.click(await screen.findByRole('button', { name: 'bread.png 본문에 삽입' }))
    expect(insert).toHaveBeenCalledWith(`![업로드한 이미지](https://example.test/functions/v1/public-attachment/${ids[0]})`)

    view.rerender(<ImageUploader repository={repo} actorId="56000000-0000-4000-8000-000000000030" bodyLength={50_000} onInsert={insert} onStateChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'bread.png 본문에 삽입' }))
    expect(screen.getByRole('alert')).toHaveTextContent('50,000자')
    expect(insert).toHaveBeenCalledTimes(1)
  })

  it('revokes previews on remove and unmount, and surfaces retryable cleanup failure', async () => {
    const discard = vi.fn().mockResolvedValueOnce({ ok: false, error: { code: 'network', message: '정리 실패' } }).mockResolvedValueOnce({ ok: true, data: true })
    const view = render(<ImageUploader repository={repository(undefined, discard)} actorId="56000000-0000-4000-8000-000000000030" bodyLength={0} onInsert={vi.fn()} onStateChange={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('이미지 파일 선택'), { target: { files: [file('remove.png')] } })
    fireEvent.click(await screen.findByRole('button', { name: 'remove.png 제거' }))
    expect(await screen.findByText('정리 실패')).toBeInTheDocument()
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'remove.png 정리 다시 시도' }))
    await waitFor(() => expect(screen.queryByText('remove.png')).not.toBeInTheDocument())
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:remove.png')

    fireEvent.change(screen.getByLabelText('이미지 파일 선택'), { target: { files: [file('unmount.png')] } })
    await screen.findByText('업로드 완료')
    view.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:unmount.png')
  })

  it('enters cleaning before discard and prevents duplicate remove or retry requests', async () => {
    let finishFirst!: (value: unknown) => void
    let finishRetry!: (value: unknown) => void
    const discard = vi.fn()
      .mockImplementationOnce(() => new Promise(done => { finishFirst = done }))
      .mockImplementationOnce(() => new Promise(done => { finishRetry = done }))
    const state = vi.fn()
    render(<ImageUploader repository={repository(undefined, discard)} actorId={actorId} bodyLength={0} onInsert={vi.fn()} onStateChange={state} />)
    fireEvent.change(screen.getByLabelText('이미지 파일 선택'), { target: { files: [file('clean.png')] } })
    const remove = await screen.findByRole('button', { name: 'clean.png 제거' })

    fireEvent.click(remove)
    fireEvent.click(remove)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('clean.png 정리 중'))
    expect(state).toHaveBeenLastCalledWith({ blocked: true, attachments: [expect.objectContaining({ attachmentId: ids[0] })] })
    expect(discard).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'clean.png 본문에 삽입' })).not.toBeInTheDocument()

    finishFirst({ ok: false, error: { code: 'network', message: '정리 실패' } })
    const retry = await screen.findByRole('button', { name: 'clean.png 정리 다시 시도' })
    fireEvent.click(retry)
    fireEvent.click(retry)
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('clean.png 정리 중'))
    expect(discard).toHaveBeenCalledTimes(2)
    finishRetry({ ok: true, data: true })
    await waitFor(() => expect(screen.queryByText('clean.png')).not.toBeInTheDocument())
  })

  it('removes and discards existing uploaded items when the actor changes', async () => {
    const discard = vi.fn().mockResolvedValue({ ok: true, data: true })
    const state = vi.fn()
    const initial = [{ attachmentId: ids[0], idempotencyKey: storageKeys[0], fileName: 'existing.png', mimeType: 'image/png' as const, byteSize: 1, width: 1, height: 1 }]
    const view = render(<ImageUploader repository={repository(undefined, discard)} actorId={actorId} bodyLength={0} onInsert={vi.fn()} onStateChange={state} initialAttachments={initial} />)
    await waitFor(() => expect(state).toHaveBeenLastCalledWith(expect.objectContaining({ attachments: [expect.objectContaining({ attachmentId: ids[0] })] })))
    expect(screen.getByText('existing.png').closest('li')).toHaveClass('without-preview')

    const nextActor = '56000000-0000-4000-8000-000000000031'
    view.rerender(<ImageUploader repository={repository(undefined, discard)} actorId={nextActor} bodyLength={0} onInsert={vi.fn()} onStateChange={state} initialAttachments={initial} />)
    await waitFor(() => expect(screen.queryByText('existing.png')).not.toBeInTheDocument())
    expect(state).toHaveBeenLastCalledWith({ blocked: false, attachments: [] })
    expect(discard).toHaveBeenCalledExactlyOnceWith({ attachmentId: ids[0], storagePath: `${actorId}/${storageKeys[0]}` })
  })

  it('discards a stale successful upload after actor change without reporting it', async () => {
    let finishUpload!: (value: unknown) => void
    const upload = vi.fn((fileValue: File, keyValue: string, actorValue: string) => {
      void fileValue; void keyValue; void actorValue
      return new Promise(done => { finishUpload = done })
    })
    const discard = vi.fn().mockResolvedValue({ ok: true, data: true })
    const state = vi.fn()
    const repo = repository(upload, discard)
    const view = render(<ImageUploader repository={repo} actorId={actorId} bodyLength={0} onInsert={vi.fn()} onStateChange={state} />)
    fireEvent.change(screen.getByLabelText('이미지 파일 선택'), { target: { files: [file('stale.png')] } })
    await waitFor(() => expect(upload).toHaveBeenCalledOnce())
    const uploadKey = upload.mock.calls[0][1]

    view.rerender(<ImageUploader repository={repo} actorId="56000000-0000-4000-8000-000000000031" bodyLength={0} onInsert={vi.fn()} onStateChange={state} />)
    await waitFor(() => expect(screen.queryByText('stale.png')).not.toBeInTheDocument())
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1)
    finishUpload({ ok: true, data: uploaded(0) })
    await waitFor(() => expect(discard).toHaveBeenCalledExactlyOnceWith({ attachmentId: ids[0], storagePath: `${actorId}/${uploadKey}` }))
    expect(state.mock.calls.slice(-1)[0][0]).toEqual({ blocked: false, attachments: [] })
  })

  it('discards an ABA stale upload after the actor changes away and back', async () => {
    let finishUpload!: (value: unknown) => void
    const upload = vi.fn((fileValue: File, keyValue: string, actorValue: string) => {
      void fileValue; void keyValue; void actorValue
      return new Promise(done => { finishUpload = done })
    })
    const discard = vi.fn().mockResolvedValue({ ok: true, data: true })
    const repo = repository(upload, discard)
    const view = render(<ImageUploader repository={repo} actorId={actorId} bodyLength={0} onInsert={vi.fn()} onStateChange={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('이미지 파일 선택'), { target: { files: [file('aba.png')] } })
    await waitFor(() => expect(upload).toHaveBeenCalledOnce())
    const uploadKey = upload.mock.calls[0][1]

    view.rerender(<ImageUploader repository={repo} actorId="56000000-0000-4000-8000-000000000031" bodyLength={0} onInsert={vi.fn()} onStateChange={vi.fn()} />)
    view.rerender(<ImageUploader repository={repo} actorId={actorId} bodyLength={0} onInsert={vi.fn()} onStateChange={vi.fn()} />)
    finishUpload({ ok: true, data: uploaded(0) })

    await waitFor(() => expect(discard).toHaveBeenCalledWith({ attachmentId: ids[0], storagePath: `${actorId}/${uploadKey}` }))
    expect(screen.queryByText('aba.png')).not.toBeInTheDocument()
  })

  it('discards a stale successful upload after repository replacement', async () => {
    const finishUploads: Array<(value: unknown) => void> = []
    const upload = vi.fn((fileValue: File, keyValue: string, actorValue: string) => {
      void fileValue; void keyValue; void actorValue
      return new Promise(done => { finishUploads.push(done) })
    })
    const oldDiscard = vi.fn().mockResolvedValue({ ok: true, data: true })
    const state = vi.fn()
    const oldRepository = repository(upload, oldDiscard)
    const newUpload = vi.fn().mockResolvedValue({ ok: true, data: uploaded(1) })
    const newRepository = repository(newUpload)
    const view = render(<ImageUploader repository={oldRepository} actorId={actorId} bodyLength={0} onInsert={vi.fn()} onStateChange={state} />)
    fireEvent.change(screen.getByLabelText('이미지 파일 선택'), { target: { files: [file('stale-one.png'), file('stale-two.png')] } })
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2))
    const uploadKeys = upload.mock.calls.map(call => call[1])

    view.rerender(<ImageUploader repository={newRepository} actorId={actorId} bodyLength={0} onInsert={vi.fn()} onStateChange={state} />)
    await waitFor(() => expect(screen.queryByText('stale-one.png')).not.toBeInTheDocument())
    fireEvent.change(screen.getByLabelText('이미지 파일 선택'), { target: { files: [file('new-repository.png')] } })
    await waitFor(() => expect(newUpload).toHaveBeenCalledOnce())
    finishUploads[0]({ ok: true, data: uploaded(0) })
    finishUploads[1]({ ok: true, data: uploaded(2) })

    await waitFor(() => expect(oldDiscard).toHaveBeenCalledTimes(2))
    expect(oldDiscard).toHaveBeenCalledWith({ attachmentId: ids[0], storagePath: `${actorId}/${uploadKeys[0]}` })
    expect(oldDiscard).toHaveBeenCalledWith({ attachmentId: ids[2], storagePath: `${actorId}/${uploadKeys[1]}` })
    expect(state.mock.calls.slice(-1)[0][0]).toEqual({ blocked: false, attachments: [expect.objectContaining({ attachmentId: ids[1] })] })
  })
})
