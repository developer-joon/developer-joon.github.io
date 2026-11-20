import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { domesticSearchIndexClient } from '../data/domesticSearchIndexClient'
import { benefitsClient } from '../data/benefitsArtifactClient'
import { BenefitsDirectoryPage } from './BenefitsDirectoryPage'
import { benefitsRoute } from '../benefitsRoutes'
import { DirectoryResults, mergeDomesticEntries } from './BenefitsDirectoryPage'
import type { DomesticEntry } from '../data/domesticDirectoryClient'

const entries: DomesticEntry[] = [
  { id: 'KR-BIZ-1234567890', name: '가상채용기업', source_type: 'dated_recruitment_observation', observation_date: '2019-08-12', size_class: 'unclassified', employee_count: 7 },
  { id: 'KR-CRN-1234567890123', name: '가상복지기업', source_type: 'base_legal_identity', size_class: 'sme_unspecified', size_evidence: { id: 'KR-CRN-1234567890123', size_class: 'sme_unspecified', as_of: '2025-12-31', expires_on: '2027-01-01', source: 'sme' } },
]
const research = new Map([['KR-CRN-1234567890123', 3]])
describe('Korean domestic search', () => {
  it('loads only the snapshot and replaces URL on typing while pushState remains for explicit filters', async () => {
    const load = vi.spyOn(domesticSearchIndexClient, 'load').mockResolvedValue({ entries, research, edition: '2026-03-06', totals: { records: 2, new_records: 1, base_aliases: 0, ftc_only: 0, research_companies: 1, research_leads: 3 }, approved: 0 })
    const atlas = vi.spyOn(benefitsClient, 'loadAtlas')
    const push = vi.spyOn(window.history, 'pushState')
    const replace = vi.spyOn(window.history, 'replaceState')
    const view = render(<BenefitsDirectoryPage search="" />)
    try {
      await waitFor(() => expect(screen.getByRole('searchbox', { name: '기업명 검색' })).toBeInTheDocument())
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: '가' } })
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: '가상' } })
      expect(push).not.toHaveBeenCalled()
      expect(replace).toHaveBeenCalledTimes(2)
      expect(window.location.search).toContain('q=')
      fireEvent.change(screen.getByRole('combobox', { name: '기업 규모 근거' }), { target: { value: 'sme' } })
      expect(push).toHaveBeenCalledTimes(1)
      window.history.replaceState({}, '', '/community/benefits/directory/?q=%EA%B0%80%EC%83%81%EC%B1%84%EC%9A%A9')
      fireEvent.popState(window)
      await waitFor(() => expect(screen.getByRole('searchbox')).toHaveValue('가상채용'))
      expect(load).toHaveBeenCalledTimes(1)
      expect(atlas).not.toHaveBeenCalled()
    } finally { view.unmount(); load.mockRestore(); atlas.mockRestore(); push.mockRestore(); replace.mockRestore(); window.history.replaceState({}, '', '/') }
  })
  it('uses the canonical base name and adds missing base identities exactly once', () => {
    const merged = mergeDomesticEntries([entries[0], { ...entries[1], name: '채용 관측상의 다른 명칭', source_type: 'dated_recruitment_observation' }], [{ id: entries[1].id, name: '가상복지기업' }, { id: 'KR-CRN-9999999999999', name: '기본 명부 기업' }], new Map())
    expect(merged.map(x => x.name)).toEqual(['가상채용기업', '가상복지기업', '기본 명부 기업'])
    expect(new Set(merged.map(x => x.id)).size).toBe(3)
  })
  it('recognizes the dedicated route and keeps existing routes', () => {
    expect(benefitsRoute('/community/benefits/directory/')).toBe('directory')
    expect(benefitsRoute('/community/benefits/')).toBe('heatmap')
  })
  it('puts action status before provenance, never claims missing welfare', () => {
    render(<DirectoryResults entries={entries} research={research} edition="2026-03-06" state={{ q: '', size: 'all', benefits: false, page: 1 }} update={() => {}} />)
    expect(screen.getByText('조사 중 3건')).toBeInTheDocument()
    expect(screen.getByText('공개 복지 정보 미확인')).toBeInTheDocument()
    expect(screen.getByText(/2019-08-12/)).toBeInTheDocument()
    expect(screen.getByText(/중소기업\(세부 규모 미확인\)/)).toBeInTheDocument()
    expect(screen.queryByText('복지 없음')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /가상복지기업/ })).toHaveAttribute('href', expect.stringContaining('/community/benefits/company/'))
    expect(screen.queryByRole('link', { name: /가상채용기업/ })).not.toBeInTheDocument()
  })
  it('filters by Korean name, SME membership and observed research only', () => {
    let state = { q: '가상복지', size: 'sme' as const, benefits: true, page: 1 }
    const view = render(<DirectoryResults entries={entries} research={research} edition="2026-03-06" state={state} update={() => {}} />)
    expect(screen.getAllByRole('article')).toHaveLength(1)
    state = { ...state, q: '가상채용' }
    view.rerender(<DirectoryResults entries={entries} research={research} edition="2026-03-06" state={state} update={() => {}} />)
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('복지가 없다는 뜻이 아닙니다')
  })
  it('offers keyboard-usable search and size controls', () => {
    const updates: unknown[] = []
    render(<DirectoryResults entries={entries} research={research} edition="2026-03-06" state={{ q: '', size: 'all', benefits: false, page: 1 }} update={v => updates.push(v)} />)
    fireEvent.change(screen.getByRole('searchbox', { name: '기업명 검색' }), { target: { value: '복지' } })
    fireEvent.change(screen.getByRole('combobox', { name: '기업 규모 근거' }), { target: { value: 'small' } })
    expect(updates).toEqual([{ q: '복지', page: 1 }, { size: 'small', page: 1 }])
  })
})
