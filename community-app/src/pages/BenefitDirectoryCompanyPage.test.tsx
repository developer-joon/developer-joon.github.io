import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BenefitsApp } from '../BenefitsApp'
import type { BenefitDirectoryRepository } from '../data/benefitDirectoryRepository'
import type { BenefitCompanyDetail, Result } from '../types/benefitDirectory'
import { BenefitDirectoryCompanyPage } from './BenefitDirectoryCompanyPage'

const CRN_A = 'KR-CRN-1101111111111'
const CRN_B = 'KR-CRN-2202222222222'
const BIZ = 'KR-BIZ-1234567890'
const publication = (overrides: Partial<BenefitCompanyDetail['publications'][number]> = {}): BenefitCompanyDetail['publications'][number] => ({
  publicationId: '123e4567-e89b-42d3-a456-426614174000',
  categoryId: 'leave',
  title: '재충전 휴가',
  description: '연차 외 휴가를 지원합니다.',
  eligibilityText: '정규직 구성원',
  conditionText: '입사 1년 후',
  trustLabel: '공식 확인',
  revision: 9,
  ...overrides,
})
const detail = (id = CRN_A, publications: BenefitCompanyDetail['publications'] = [publication()]): BenefitCompanyDetail => ({
  company: {
    companyId: id,
    displayName: id === CRN_B ? '나 기업' : '가 기업',
    identityLabel: '법인',
    industry: '소프트웨어',
    sizeLabel: '중견기업',
    region: '서울',
    summary: '공개 기업 소개입니다.',
  },
  publications,
})
const ok = (value: BenefitCompanyDetail): Result<BenefitCompanyDetail> => ({ ok: true, data: value })
const failure = (code: 'network' | 'invalid_response' | 'not_found', message = 'raw internal message'): Result<BenefitCompanyDetail> => ({ ok: false, error: { code, message } })
function repository(load: BenefitDirectoryRepository['detail']): BenefitDirectoryRepository {
  return { search: vi.fn(), detail: load }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(next => { resolve = next })
  return { promise, resolve }
}

afterEach(() => vi.restoreAllMocks())

describe('BenefitDirectoryCompanyPage', () => {
  it.each([
    '',
    '?q=x',
    `?id=${CRN_A}&id=${CRN_B}`,
    `?id=${'A'.repeat(5000)}`,
    `?id=%20${CRN_A}`,
    `?id=${CRN_A}%20`,
    '?id=KR-CRN-123',
    '?id=kr-crn-1101111111111',
    '?id=%4BR-CRN-1101111111111',
    `?%69d=${BIZ}`,
    `?i%64=${BIZ}`,
    `?ID=${BIZ}`,
    `?id=${BIZ}&%69d=${BIZ}`,
    '?id=%ZZ',
  ])('rejects an invalid literal company link without an RPC: %s', search => {
    const load = vi.fn<BenefitDirectoryRepository['detail']>()
    render(<BenefitDirectoryCompanyPage search={search} repository={repository(load)} />)
    expect(screen.getByRole('alert')).toHaveTextContent('유효하지 않은 기업 상세 링크입니다.')
    expect(load).not.toHaveBeenCalled()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it.each([CRN_A, BIZ])('passes canonical server ID %s to detail unchanged', async id => {
    const load = vi.fn<BenefitDirectoryRepository['detail']>().mockResolvedValue(ok(detail(id, [])))
    render(<BenefitDirectoryCompanyPage search={`?id=${id}`} repository={repository(load)} />)
    await screen.findByRole('heading', { name: '가 기업' })
    expect(load).toHaveBeenCalledWith(id, expect.any(AbortSignal))
  })

  it('renders public company fields and publications in canonical category order without private metadata', async () => {
    const publications = [
      publication({ publicationId: '123e4567-e89b-42d3-a456-426614174001', categoryId: 'health', title: '건강 검진', description: '정기 검진을 지원합니다.', eligibilityText: null, conditionText: null, trustLabel: '사용자 제보' }),
      publication(),
      publication({ publicationId: '123e4567-e89b-42d3-a456-426614174002', title: '추가 휴가', description: '특별 휴가입니다.', eligibilityText: null, conditionText: '승인 후' }),
    ]
    const load = vi.fn<BenefitDirectoryRepository['detail']>().mockResolvedValue(ok(detail(CRN_A, publications)))
    const { container } = render(<BenefitDirectoryCompanyPage search={`?id=${CRN_A}&q=%EA%B0%80`} repository={repository(load)} />)

    expect(screen.getByRole('status')).toHaveTextContent('기업 복지 정보를 불러오고 있습니다.')
    expect(await screen.findByRole('heading', { name: '가 기업' })).toBeVisible()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByText('법인')).toBeVisible()
    expect(screen.getByText(/법인 등기 식별정보 기준/)).toBeVisible()
    expect(screen.getByText('소프트웨어 · 중견기업 · 서울')).toBeVisible()
    expect(screen.getByText('공개 기업 소개입니다.')).toBeVisible()

    const headings = screen.getAllByRole('heading', { level: 2 }).map(node => node.textContent)
    expect(headings).toEqual(['휴가·근무시간', '건강·보험'])
    const leave = screen.getByRole('region', { name: '휴가·근무시간' })
    expect(within(leave).getAllByRole('article').map(node => node.querySelector('h3')?.textContent)).toEqual(['재충전 휴가', '추가 휴가'])
    expect(within(leave).getByText('대상')).toBeVisible()
    expect(within(leave).getByText('정규직 구성원')).toBeVisible()
    expect(within(leave).getAllByText('조건')).toHaveLength(2)
    expect(within(leave).getByText('입사 1년 후')).toBeVisible()
    expect(screen.getAllByText('공식 확인')).toHaveLength(2)
    expect(screen.getByText('사용자 제보')).toBeVisible()
    expect(screen.getByRole('link', { name: '기업 검색으로 돌아가기' })).toHaveAttribute('href', '/benefits/?q=%EA%B0%80')

    const publicText = container.textContent ?? ''
    expect(publicText).not.toMatch(/revision|source|verified|review|submitter|reviewer|digest|provenance|확인일|검토일/i)
    expect(publicText).not.toContain('9')
  })

  it('binds the honest zero-publication CTA to the Task 7 submission route contract', async () => {
    const load = vi.fn<BenefitDirectoryRepository['detail']>().mockResolvedValue(ok(detail(CRN_A, [])))
    render(<BenefitDirectoryCompanyPage search={`?id=${CRN_A}`} repository={repository(load)} />)
    await screen.findByText('게시 가능한 공개 복지 근거 미확인')
    expect(screen.getByRole('status')).toHaveTextContent('게시 가능한 공개 복지 근거 미확인')
    expect(screen.getByText(/게시 여부만 나타내며 실제 제도 유무를 단정하지 않습니다/)).toBeVisible()
    expect(screen.queryByText(/복지 없음/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '새 혜택 제보' })).toHaveAttribute('href', `/community/benefits/submit/?companyId=${CRN_A}`)
    expect(screen.getByRole('link', { name: '기업 검색으로 돌아가기' })).toHaveAttribute('href', '/benefits/')
  })

  it('keeps exactly one H1 in loading and error states', async () => {
    const request = deferred<Result<BenefitCompanyDetail>>()
    render(<BenefitDirectoryCompanyPage search={`?id=${CRN_A}`} repository={repository(vi.fn(() => request.promise))} />)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    request.resolve(failure('network'))
    await act(async () => { await request.promise })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('alert')).toBeVisible()
  })

  it.each([
    ['not_found', '기업 정보를 찾을 수 없습니다.', false],
    ['invalid_response', '기업 정보를 표시할 수 없습니다.', true],
    ['network', '네트워크 연결을 확인한 뒤 다시 시도해 주세요.', true],
  ] as const)('keeps %s distinct and only retries recoverable failures', async (code, copy, canRetry) => {
    const load = vi.fn<BenefitDirectoryRepository['detail']>().mockResolvedValue(failure(code))
    render(<BenefitDirectoryCompanyPage search={`?id=${CRN_A}`} repository={repository(load)} />)
    expect(await screen.findByRole('alert')).toHaveTextContent(copy)
    expect(screen.queryByText('raw internal message')).not.toBeInTheDocument()
    expect(Boolean(screen.queryByRole('button', { name: '다시 시도' }))).toBe(canRetry)
  })

  it('hides loaded A at render time while B is pending', async () => {
    const b = deferred<Result<BenefitCompanyDetail>>()
    const load = vi.fn<BenefitDirectoryRepository['detail']>((id) => id === CRN_A ? Promise.resolve(ok(detail(CRN_A))) : b.promise)
    const repo = repository(load)
    const view = render(<BenefitDirectoryCompanyPage search={`?id=${CRN_A}`} repository={repo} />)
    expect(await screen.findByRole('heading', { name: '가 기업' })).toBeVisible()

    view.rerender(<BenefitDirectoryCompanyPage search={`?id=${CRN_B}`} repository={repo} />)
    expect(screen.queryByRole('heading', { name: '가 기업' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('불러오고 있습니다')
    await act(async () => b.resolve(ok(detail(CRN_B))))
    expect(await screen.findByRole('heading', { name: '나 기업' })).toBeVisible()
  })

  it('hides A synchronously for pending B, aborts A, and ignores late A', async () => {
    const a = deferred<Result<BenefitCompanyDetail>>()
    const b = deferred<Result<BenefitCompanyDetail>>()
    const signals = new Map<string, AbortSignal>()
    const load = vi.fn<BenefitDirectoryRepository['detail']>((id, signal) => {
      signals.set(id, signal!)
      return id === CRN_A ? a.promise : b.promise
    })
    const repo = repository(load)
    const view = render(<BenefitDirectoryCompanyPage search={`?id=${CRN_A}`} repository={repo} />)
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))

    view.rerender(<BenefitDirectoryCompanyPage search={`?id=${CRN_B}`} repository={repo} />)
    expect(screen.queryByRole('heading', { name: '가 기업' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('불러오고 있습니다')
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    expect(signals.get(CRN_A)?.aborted).toBe(true)
    await act(async () => a.resolve(ok(detail(CRN_A))))
    expect(screen.queryByRole('heading', { name: '가 기업' })).not.toBeInTheDocument()
    await act(async () => b.resolve(ok(detail(CRN_B))))
    expect(await screen.findByRole('heading', { name: '나 기업' })).toBeVisible()
  })

  it('keys visible state and retry to the current ID and repository identity', async () => {
    const a = deferred<Result<BenefitCompanyDetail>>()
    const b = deferred<Result<BenefitCompanyDetail>>()
    const bRetry = deferred<Result<BenefitCompanyDetail>>()
    const calls: Array<{ id: string; signal: AbortSignal }> = []
    const repo = repository(vi.fn((id, signal) => {
      calls.push({ id, signal: signal! })
      if (id === CRN_A) return a.promise
      return calls.filter(call => call.id === CRN_B).length === 1 ? b.promise : bRetry.promise
    }))
    const view = render(<BenefitDirectoryCompanyPage search={`?id=${CRN_A}`} repository={repo} />)
    await waitFor(() => expect(calls).toHaveLength(1))
    await act(async () => a.resolve(failure('network')))
    expect(await screen.findByRole('alert')).toHaveTextContent('네트워크')

    view.rerender(<BenefitDirectoryCompanyPage search={`?id=${CRN_B}`} repository={repo} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('불러오고 있습니다')
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[0].signal.aborted).toBe(true)
    await act(async () => b.resolve(failure('network')))
    fireEvent.click(await screen.findByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(calls).toHaveLength(3))
    expect(calls[2].id).toBe(CRN_B)
    await act(async () => bRetry.resolve(ok(detail(CRN_B))))
    expect(await screen.findByRole('heading', { name: '나 기업' })).toBeVisible()
  })

  it('aborts on repository replacement and unmount and stays StrictMode safe', async () => {
    const signals: AbortSignal[] = []
    const pending = deferred<Result<BenefitCompanyDetail>>()
    const first = repository(vi.fn((_id, signal) => { signals.push(signal!); return pending.promise }))
    const second = repository(vi.fn((_id, signal) => { signals.push(signal!); return Promise.resolve(ok(detail(CRN_A, []))) }))
    const view = render(<StrictMode><BenefitDirectoryCompanyPage search={`?id=${CRN_A}`} repository={first} /></StrictMode>)
    await waitFor(() => expect(signals.length).toBeGreaterThanOrEqual(2))
    view.rerender(<StrictMode><BenefitDirectoryCompanyPage search={`?id=${CRN_A}`} repository={second} /></StrictMode>)
    expect(screen.getByRole('status')).toHaveTextContent('불러오고 있습니다')
    await screen.findByRole('heading', { name: '가 기업' })
    expect(signals.slice(0, -1).every(signal => signal.aborted)).toBe(true)
    view.unmount()
    expect(signals.at(-1)?.aborted).toBe(true)
  })
})

describe('public route dispatch', () => {
  it('maps the canonical company route to the lazy dynamic page and preserves query', async () => {
    const load = vi.fn<BenefitDirectoryRepository['detail']>().mockResolvedValue(ok(detail(BIZ, [])))
    render(<BenefitsApp pathname="/benefits/company/" search={`?id=${BIZ}`} benefitDirectoryRepository={repository(load)} />)
    expect(await screen.findByRole('heading', { name: '가 기업' })).toBeVisible()
    expect(load).toHaveBeenCalledWith(BIZ, expect.any(AbortSignal))
  })
})
