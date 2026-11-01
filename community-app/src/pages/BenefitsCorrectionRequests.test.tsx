import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { benefitsClient } from '../data/benefitsArtifactClient'
import { parseQuery } from '../lib/benefitsQueryState'
import { categories, type CategoryOutcome, type CompanyListing, type Detail, type Manifest } from '../types/benefits'
import { BenefitsCompanyPage } from './BenefitsCompanyPage'
import { BenefitsMethodologyPage } from './BenefitsMethodologyPage'

const notice = '이번 조사에서 게시 가능한 공식 복지 근거를 확보하지 못했습니다. 복지가 없다는 뜻이 아닙니다.'
const insufficient = (category_id: (typeof categories)[number]): CategoryOutcome => ({ kind: 'insufficient_evidence', category_id, reason_code: 'not_researched', nonabsence_notice: notice, searched_source_ids: [], searched_at: null })
const company: CompanyListing = { company_id: 'KR-CRN-1101112948086', population_sequence: 1, legal_name: '테스트 주식회사', display_name: '테스트 기업', scope: 'domestic', jurisdiction: 'KR', incorporation_country: 'KR', registered_head_office_country: 'KR', selected_reporting_legal_entity: '테스트 주식회사', sector: 'non_financial', category_outcomes: categories.map(insufficient) }
const manifest = { data_version: 'company-benefits-test-v1', company_count: 2000, generated_at: '2026-10-31T00:00:00Z' } as Manifest
const detail: Detail = {
  schema_version: 1,
  artifact_kind: 'company_detail',
  data_version: manifest.data_version,
  taxonomy_version: 'benefit-taxonomy-v1',
  company: {
    company_id: company.company_id,
    population_sequence: company.population_sequence,
    legal_name: company.legal_name,
    scope: company.scope,
    jurisdiction: company.jurisdiction,
    registry_id: company.company_id,
    selected_reporting_legal_entity: company.selected_reporting_legal_entity,
    incorporation_country: company.incorporation_country,
    registered_head_office_country: company.registered_head_office_country,
    financial_consolidation_parent: { kind: 'unknown', reason: 'test fixture' },
    ultimate_parent: { kind: 'unknown', reason: 'test fixture' },
    benefit_policy_owner: { kind: 'unknown', reason: 'test fixture' },
    sector: company.sector,
    employment_evidence_scope: 'test fixture',
    employment_boundary_note: 'test fixture',
  },
  category_outcomes: company.category_outcomes,
  claims: [],
}

it('offers a company-specific public correction request', async () => {
  vi.spyOn(benefitsClient, 'loadCompanyDetail').mockResolvedValue(detail)
  render(<BenefitsCompanyPage id={company.company_id} manifest={manifest} listings={[company]} state={parseQuery('')} update={vi.fn()} companies={[company]} link={() => '#'} />)

  const link = await screen.findByRole('link', { name: '정보 수정 요청' })
  const url = new URL(link.getAttribute('href')!)
  expect(`${url.origin}${url.pathname}`).toBe('https://github.com/developer-joon/developer-joon.github.io/issues/new')
  expect(url.searchParams.get('template')).toBe('company-benefits-correction.yml')
  expect(url.searchParams.get('title')).toContain(company.display_name)
  expect(url.searchParams.get('title')).toContain(company.company_id)
})

it('offers a generic correction request from the methodology page', async () => {
  vi.spyOn(benefitsClient, 'loadManifest').mockResolvedValue(manifest)
  vi.spyOn(benefitsClient, 'loadMethodology').mockResolvedValue({ schema_version: 1, artifact_kind: 'company_benefits_methodology', data_version: manifest.data_version, taxonomy_version: 'benefit-taxonomy-v1', title: '조사 방법', paragraphs: ['공식 공개자료만 검토합니다.'] })
  render(<BenefitsMethodologyPage search="" />)

  const link = await screen.findByRole('link', { name: '정보 수정 요청' })
  expect(link).toHaveAttribute('href', expect.stringContaining('template=company-benefits-correction.yml'))
})