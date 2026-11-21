import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BenefitDirectoryRepository } from '../data/benefitDirectoryRepository'
import type { BenefitDirectoryPage, BenefitDirectorySearchItem, Result } from '../types/benefitDirectory'
import { BenefitsDirectoryPage } from './BenefitsDirectoryPage'

const baseItem: BenefitDirectorySearchItem = {
  companyId: 'KR-CRN-1101111111111', displayName: '가나다 공식', identityLabel: '법인', industry: '소프트웨어',
  sizeLabel: '대기업', region: '서울', summary: '기업 설명', benefitCount: 2, officialCount: 1,
  communityCount: 1, categories: ['leave', 'health'],
}
const page = (items = [baseItem], overrides: Partial<BenefitDirectoryPage> = {}): BenefitDirectoryPage => ({
  items, hasMore: false, nextCursor: null, total: items.length, ...overrides,
})
const ok = (data: BenefitDirectoryPage): Result<BenefitDirectoryPage> => ({ ok: true, data })
const fail = (message = '검색 실패'): Result<BenefitDirectoryPage> => ({ ok: false, error: { code: 'network', message } })
function repository(search: BenefitDirectoryRepository['search']): BenefitDirectoryRepository {
  return { search, detail: vi.fn() }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  window.history.replaceState({}, '', '/')
})

describe('dynamic benefit directory search', () => {
  it('debounces typing into replaceState and sends the exact RPC input while discrete filters push immediately', async () => {
    vi.useFakeTimers()
    const search = vi.fn(async () => ok(page()))
    const replace = vi.spyOn(window.history, 'replaceState')
    const push = vi.spyOn(window.history, 'pushState')
    window.history.replaceState({}, '', '/community/benefits/directory/#results')
    render(<BenefitsDirectoryPage search="" repository={repository(search)} debounceMs={300} />)
    await act(async () => { await Promise.resolve() })
    expect(search).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByRole('searchbox', { name: '기업명 검색' }), { target: { value: '가' } })
    fireEvent.change(screen.getByRole('searchbox', { name: '기업명 검색' }), { target: { value: '가나' } })
    expect(search).toHaveBeenCalledTimes(1)
    expect(replace).not.toHaveBeenCalledWith({}, '', expect.stringContaining('q='))
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(replace).toHaveBeenLastCalledWith({}, '', '/community/benefits/directory/?q=%EA%B0%80%EB%82%98#results')
    expect(search).toHaveBeenLastCalledWith({ query: '가나', categories: null, industry: null, size: null, region: null, hasBenefitsOnly: false, pageSize: 50, cursor: null }, expect.any(AbortSignal))

    fireEvent.click(screen.getByRole('checkbox', { name: '건강' }))
    expect(push).toHaveBeenLastCalledWith({}, '', '/community/benefits/directory/?q=%EA%B0%80%EB%82%98&categories=health#results')
    fireEvent.click(screen.getByRole('checkbox', { name: '휴가' }))
    expect(push).toHaveBeenLastCalledWith({}, '', '/community/benefits/directory/?q=%EA%B0%80%EB%82%98&categories=leave%2Chealth#results')
    expect(push.mock.calls.flatMap(call => call).join(' ')).not.toContain('category=')

    fireEvent.click(screen.getByRole('checkbox', { name: '복지 정보 있는 기업만' }))
    expect(push).toHaveBeenLastCalledWith({}, '', '/community/benefits/directory/?q=%EA%B0%80%EB%82%98&categories=leave%2Chealth&hasBenefitsOnly=1#results')
    await act(async () => { await Promise.resolve() })
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ query: '가나', categories: ['leave', 'health'], hasBenefitsOnly: true, cursor: null }), expect.any(AbortSignal))
  })

  it('restores controls on popstate, performs one request, and does not write history again', async () => {
    const search = vi.fn(async () => ok(page()))
    const replace = vi.spyOn(window.history, 'replaceState')
    const push = vi.spyOn(window.history, 'pushState')
    render(<BenefitsDirectoryPage search="?q=처음" repository={repository(search)} />)
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
    replace.mockClear(); push.mockClear()
    window.history.replaceState({}, '', '/community/benefits/directory/?q=%EB%92%A4%EB%A1%9C&categories=health%2Cleave&size=small')
    replace.mockClear()
    fireEvent.popState(window)
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('searchbox')).toHaveValue('뒤로')
    expect(screen.getByRole('checkbox', { name: '휴가' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '건강' })).toBeChecked()
    expect(screen.getByRole('combobox', { name: '기업 규모' })).toHaveValue('small')
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ query: '뒤로', categories: ['leave', 'health'], size: 'small', cursor: null }), expect.any(AbortSignal))
    expect(replace).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('aborts superseded searches and ignores late success or error from the old generation', async () => {
    const a = deferred<Result<BenefitDirectoryPage>>()
    const b = deferred<Result<BenefitDirectoryPage>>()
    const signals: AbortSignal[] = []
    const search = vi.fn<BenefitDirectoryRepository['search']>((_input, signal) => { signals.push(signal!); return signals.length === 1 ? a.promise : b.promise })
    const view = render(<BenefitsDirectoryPage search="?q=A" repository={repository(search)} debounceMs={0} />)
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'B' } })
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2))
    expect(signals[0].aborted).toBe(true)
    b.resolve(ok(page([{ ...baseItem, displayName: 'B 기업' }]))); await act(async () => { await b.promise })
    expect(await screen.findByText('B 기업')).toBeInTheDocument()
    a.resolve(fail('늦은 A 오류')); await act(async () => { await a.promise })
    expect(screen.getByText('B 기업')).toBeInTheDocument()
    expect(screen.queryByText('늦은 A 오류')).not.toBeInTheDocument()
    view.unmount()
    expect(signals[1].aborted).toBe(true)
  })

  it('keeps the prior successful cards during refresh and failure, then retries the new query', async () => {
    const b = deferred<Result<BenefitDirectoryPage>>()
    const retry = deferred<Result<BenefitDirectoryPage>>()
    const search = vi.fn()
      .mockResolvedValueOnce(ok(page([baseItem], { total: 7 })))
      .mockImplementationOnce(() => b.promise)
      .mockImplementationOnce(() => retry.promise)
    render(<BenefitsDirectoryPage search="?q=A" repository={repository(search)} debounceMs={0} />)
    expect(await screen.findByText('가나다 공식')).toBeInTheDocument()
    expect(screen.getByText((_, element) => element?.classList.contains('domestic-directory__count') ?? false)).toHaveTextContent('검색 결과 7개 기업')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'B' } })
    expect(await screen.findByText('새 조건으로 검색하고 있습니다. 이전 결과를 잠시 표시합니다.')).toBeInTheDocument()
    expect(screen.getByText('가나다 공식')).toBeInTheDocument()
    expect(screen.queryByText(/B 검색 결과 7개/)).not.toBeInTheDocument()
    b.resolve(fail('B 검색 실패')); await act(async () => { await b.promise })
    expect(await screen.findByRole('alert')).toHaveTextContent('B 검색 실패')
    expect(screen.getByText('가나다 공식')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: '다시 시도' }))
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'B' }), expect.any(AbortSignal))
    retry.resolve(ok(page([{ ...baseItem, displayName: 'B 성공' }]))); await act(async () => { await retry.promise })
    expect(await screen.findByText('B 성공')).toBeInTheDocument()
  })

  it('distinguishes first failure and honest empty state', async () => {
    const search = vi.fn().mockResolvedValueOnce(fail()).mockResolvedValueOnce(ok(page([])))
    render(<BenefitsDirectoryPage search="" repository={repository(search)} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('검색 실패')
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText('조건에 맞는 기업을 찾지 못했습니다')).toBeInTheDocument()
    expect(screen.queryByText(/복지 없음/)).not.toBeInTheDocument()
  })

  it('appends cursor pages, deduplicates company IDs, and preserves cards when next page fails', async () => {
    const second = { ...baseItem, companyId: 'KR-BIZ-1234567890', displayName: '두번째 기업' }
    const signals: AbortSignal[] = []
    const search = vi.fn<BenefitDirectoryRepository['search']>(async (input, signal) => {
      signals.push(signal!)
      if (input.cursor === null) return ok(page([baseItem], { total: 2, hasMore: true, nextCursor: 'opaque' }))
      return signals.length === 2 ? fail('다음 페이지 실패') : ok(page([baseItem, second], { total: 2 }))
    })
    const view = render(<BenefitsDirectoryPage search="" repository={repository(search)} />)
    expect(await screen.findByText('가나다 공식')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '더 불러오기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('다음 페이지 실패')
    expect(screen.getByText('가나다 공식')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByText('두번째 기업')).toBeInTheDocument()
    expect(screen.getAllByRole('article')).toHaveLength(2)
    expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'opaque' }), expect.any(AbortSignal))
    view.unmount()
    expect(signals.at(-1)?.aborted).toBe(true)
  })

  it('renders only public summary fields, exact zero-evidence wording, and the existing detail-link contract', async () => {
    const zero = { ...baseItem, benefitCount: 0, officialCount: 0, communityCount: 0, categories: [], summary: null }
    render(<BenefitsDirectoryPage search="" repository={repository(vi.fn(async () => ok(page([zero]))))} />)
    const card = await screen.findByRole('article')
    expect(card).toHaveTextContent('게시 가능한 공개 복지 근거 미확인')
    expect(card).toHaveTextContent('법인')
    expect(card).toHaveTextContent('소프트웨어 · 대기업 · 서울')
    expect(screen.getByRole('link', { name: /가나다 공식/ })).toHaveAttribute('href', '/community/benefits/company/?id=KR-CRN-1101111111111')
    expect(card.textContent).not.toMatch(/source|verified|review|submitter|provenance|검토일|확인일/i)
  })
})
