import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { benefitsClient, type BenefitAtlasData, type BenefitCompanyDetailView } from '../data/benefitsArtifactClient'
import { useBenefitsDetails } from './useBenefitsDetails'

const atlas = (name: string) => ({ manifest: { data_version: name }, companies: [] }) as unknown as BenefitAtlasData
const defaultAtlas = atlas('one')
const detail = (id: string) => ({ legacy: { company: { company_id: id } } }) as unknown as BenefitCompanyDetailView
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject })
  return { promise, resolve, reject }
}

function Harness({ currentAtlas = defaultAtlas, ids = ['company-1'] }: { currentAtlas?: BenefitAtlasData; ids?: string[] }) {
  const { data, error, retry } = useBenefitsDetails(currentAtlas, ids)
  return <><p role="status">{error ? 'error' : data ? `success:${data[0]?.legacy.company.company_id}` : 'loading'}</p><button onClick={retry}>retry</button></>
}

afterEach(() => vi.restoreAllMocks())

it('transitions through initial loading, error, retry loading, and success via the hook lifecycle', async () => {
  const first = deferred<BenefitCompanyDetailView[]>(); const second = deferred<BenefitCompanyDetailView[]>()
  vi.spyOn(benefitsClient, 'loadAtlasCompanyDetails').mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
  render(<Harness />)
  expect(screen.getByRole('status')).toHaveTextContent('loading')
  await act(async () => first.reject(new Error('failed')))
  expect(screen.getByRole('status')).toHaveTextContent('error')
  fireEvent.click(screen.getByRole('button', { name: 'retry' }))
  expect(screen.getByRole('status')).toHaveTextContent('loading')
  await act(async () => second.resolve([detail('company-1')]))
  expect(screen.getByRole('status')).toHaveTextContent('success:company-1')
})

it('ignores a stale response after companies and atlas change', async () => {
  const first = deferred<BenefitCompanyDetailView[]>(); const second = deferred<BenefitCompanyDetailView[]>()
  vi.spyOn(benefitsClient, 'loadAtlasCompanyDetails').mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
  const { rerender } = render(<Harness currentAtlas={atlas('one')} ids={['company-1']} />)
  rerender(<Harness currentAtlas={atlas('two')} ids={['company-2']} />)
  expect(screen.getByRole('status')).toHaveTextContent('loading')
  await act(async () => first.resolve([detail('company-1')]))
  expect(screen.getByRole('status')).toHaveTextContent('loading')
  await act(async () => second.resolve([detail('company-2')]))
  expect(screen.getByRole('status')).toHaveTextContent('success:company-2')
})

it('returns to loading synchronously when the atlas changes after success', async () => {
  const first = deferred<BenefitCompanyDetailView[]>(); const second = deferred<BenefitCompanyDetailView[]>()
  vi.spyOn(benefitsClient, 'loadAtlasCompanyDetails').mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
  const { rerender } = render(<Harness currentAtlas={atlas('one')} ids={['company-1']} />)
  await act(async () => first.resolve([detail('company-1')]))
  expect(screen.getByRole('status')).toHaveTextContent('success:company-1')
  rerender(<Harness currentAtlas={atlas('two')} ids={['company-1']} />)
  expect(screen.getByRole('status')).toHaveTextContent('loading')
  await act(async () => second.resolve([detail('company-1')]))
})

it('aborts the previous request when the hook starts a replacement request', async () => {
  const signals: AbortSignal[] = []
  vi.spyOn(benefitsClient, 'loadAtlasCompanyDetails').mockImplementation((_atlas, _ids, signal) => {
    signals.push(signal!)
    return new Promise<BenefitCompanyDetailView[]>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }))
  })
  const { rerender } = render(<Harness currentAtlas={atlas('one')} ids={['company-1']} />)
  await waitFor(() => expect(signals).toHaveLength(1))
  rerender(<Harness currentAtlas={atlas('two')} ids={['company-2']} />)
  await waitFor(() => expect(signals).toHaveLength(2))
  expect(signals[0].aborted).toBe(true)
  expect(signals[1].aborted).toBe(false)
})
