import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { benefitsClient } from '../data/benefitsArtifactClient'
import type { Manifest } from '../types/benefits'
import { BenefitsMethodologyPage } from './BenefitsMethodologyPage'

afterEach(() => {
  vi.restoreAllMocks()
})

it('places query-preserving legacy analysis links outside the primary navigation', async () => {
  const manifest = {
    data_version: 'test-v1',
    company_count: 1,
    generated_at: '2026-11-22T00:00:00Z',
  } as unknown as Manifest
  vi.spyOn(benefitsClient, 'loadManifest').mockResolvedValue(manifest)
  vi.spyOn(benefitsClient, 'loadMethodology').mockResolvedValue({
    schema_version: 1,
    artifact_kind: 'company_benefits_methodology',
    data_version: 'test-v1',
    taxonomy_version: 'benefit-taxonomy-v1',
    title: '조사 방법',
    paragraphs: ['공개 근거를 확인합니다.'],
  })

  render(<BenefitsMethodologyPage search="?q=예시&categories=leave" />)

  await waitFor(() => expect(screen.getByRole('heading', { name: '조사 방법' })).toBeVisible())
  const primaryNavigation = screen.getByRole('navigation', { name: '복지 탐색 화면' })
  expect(within(primaryNavigation).getAllByRole('link')).toHaveLength(2)
  expect(within(primaryNavigation).queryByRole('link', { name: '복지 현황' })).not.toBeInTheDocument()
  expect(within(primaryNavigation).queryByRole('link', { name: '조건 탐색' })).not.toBeInTheDocument()

  const legacySection = screen.getByRole('region', { name: '기존 분석 자료' })
  expect(legacySection).not.toBe(primaryNavigation)
  expect(within(legacySection).getByRole('link', { name: '복지 현황' })).toHaveAttribute(
    'href',
    '/community/benefits/?q=%EC%98%88%EC%8B%9C&categories=leave&preset=parenting',
  )
  expect(within(legacySection).getByRole('link', { name: '조건 탐색' })).toHaveAttribute(
    'href',
    '/community/benefits/fit/?q=%EC%98%88%EC%8B%9C&categories=leave&preset=parenting',
  )
})
