import { fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { BenefitsExplorerPage } from './BenefitsExplorerPage'
import { manifest, index, rankings, method } from '../test/benefitsFixture'
import { benefitsClient } from '../data/benefitsArtifactClient'
vi.mock('../data/benefitsArtifactClient', () => ({ benefitsClient: {loadManifest:vi.fn(),loadCompanyIndex:vi.fn(),loadRankings:vi.fn(),loadMethodology:vi.fn()} }))
beforeEach(() => { window.history.replaceState({},'', '/community/benefits/');vi.mocked(benefitsClient.loadManifest).mockResolvedValue(manifest);vi.mocked(benefitsClient.loadCompanyIndex).mockResolvedValue(index);vi.mocked(benefitsClient.loadRankings).mockResolvedValue(rankings);vi.mocked(benefitsClient.loadMethodology).mockResolvedValue(method) })
describe('benefits heatmap workspace', () => {
 it('discloses fixture, keeps shell, real table and 50-row pagination', async () => {
  render(<BenefitsExplorerPage route="heatmap" search="" />)
  const table=await screen.findByRole('table',{name:'기업 복지 공개 상태'})
  expect(screen.getByText('예시 데이터')).toBeVisible();expect(screen.getByRole('banner')).toBeInTheDocument();expect(screen.getByRole('contentinfo')).toBeInTheDocument()
  expect(within(table).getAllByRole('row')).toHaveLength(51)
  expect(screen.getByRole('link',{name:'복지 히트맵'})).toHaveAttribute('aria-current','page')
  expect(screen.getByRole('link',{name:/예시 별빛기업 01.*휴가·근무시간.*확인됨/})).toHaveAttribute('href',expect.stringContaining('#leave'))
  fireEvent.click(screen.getByRole('button',{name:'다음 페이지'}));expect(within(table).getAllByRole('row')).toHaveLength(7)
 })
 it('filters scope, search and category/status in URL without refetch; empty reset',async()=>{
  render(<BenefitsExplorerPage route="heatmap" search="" />);await screen.findByRole('table')
  fireEvent.change(screen.getByLabelText('기업 검색'),{target:{value:'없는회사'}});expect(screen.getByText('검색 결과가 없습니다')).toBeVisible();expect(window.location.search).toContain('q=')
  fireEvent.click(screen.getByRole('button',{name:'필터 초기화'}));fireEvent.change(screen.getByLabelText('기업 범위'),{target:{value:'domestic'}})
  expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(29)
  fireEvent.click(screen.getByLabelText('분야 육아·가족'));fireEvent.click(screen.getByLabelText('상태 확인됨'))
  expect(screen.getByRole('link',{name:'분야별 순위'})).toHaveAttribute('href',expect.stringContaining('categories=family'))
 })
 it('limits comparison to four and exposes applicability in tray',async()=>{
  render(<BenefitsExplorerPage route="heatmap" search="" />);await screen.findByRole('table')
  const checks=screen.getAllByRole('checkbox',{name:/비교 예시/});checks.slice(0,4).forEach(c=>fireEvent.click(c));expect(checks[4]).toBeDisabled()
  expect(screen.getByRole('region',{name:'선택 기업 비교'})).toHaveTextContent('적용 범위')
 })
 it('has loading and fail closed retry with methodology link',async()=>{
  vi.mocked(benefitsClient.loadManifest).mockRejectedValueOnce(new Error('integrity'))
  render(<BenefitsExplorerPage route="heatmap" search="" />);expect(screen.getByRole('status')).toHaveTextContent('불러오고')
  expect(await screen.findByRole('alert')).toHaveTextContent('불러올 수 없습니다');expect(screen.queryByRole('table')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'다시 시도'}));await waitFor(()=>expect(screen.getByRole('table')).toBeVisible())
 })
})
