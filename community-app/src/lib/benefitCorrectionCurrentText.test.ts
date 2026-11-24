import { describe, expect, it } from 'vitest'
import type { BenefitDirectoryPublication } from '../types/benefitDirectory'
import { BENEFIT_CORRECTION_CURRENT_TEXT_MAX_LENGTH } from '../types/benefitCorrections'
import { renderBenefitCorrectionPublications } from './benefitCorrectionCurrentText'

function publication(overrides: Partial<BenefitDirectoryPublication> = {}): BenefitDirectoryPublication {
  return {
    publicationId: '123e4567-e89b-42d3-a456-426614174010',
    categoryId: 'health',
    title: '건강 검진',
    description: '정기 검진을 지원합니다.',
    eligibilityText: null,
    conditionText: null,
    trustLabel: '공식 확인',
    revision: 1,
    ...overrides,
  }
}

describe('canonical benefit correction publication context', () => {
  it('bounds one oversized publication with a deterministic truncation marker while retaining title and trust', () => {
    const rendered = renderBenefitCorrectionPublications([
      publication({ description: '가'.repeat(6_000) }),
      publication({ categoryId: 'leave', title: '다른 분야', description: '포함되면 안 됨' }),
    ], 'health')

    expect(rendered).not.toBeNull()
    expect(Array.from(rendered!)).toHaveLength(BENEFIT_CORRECTION_CURRENT_TEXT_MAX_LENGTH)
    expect(rendered).toMatch(/^건강 검진 — /)
    expect(rendered).toContain('[내용 잘림]')
    expect(rendered).toMatch(/ · 공식 확인$/)
    expect(rendered).not.toContain('123e4567')
    expect(rendered).not.toContain('다른 분야')
  })

  it('keeps server order across the limit and marks both truncation and later omissions', () => {
    const rendered = renderBenefitCorrectionPublications([
      publication({ title: '첫 번째', description: '가'.repeat(3_000), trustLabel: '공식 확인' }),
      publication({ publicationId: '123e4567-e89b-42d3-a456-426614174011', title: '두 번째', description: '나'.repeat(3_000), trustLabel: '사용자 제보' }),
      publication({ publicationId: '123e4567-e89b-42d3-a456-426614174012', title: '세 번째', description: '다'.repeat(20), trustLabel: '공식 확인' }),
    ], 'health')

    expect(Array.from(rendered!)).toHaveLength(BENEFIT_CORRECTION_CURRENT_TEXT_MAX_LENGTH)
    expect(rendered).toMatch(/^첫 번째 — /)
    expect(rendered!.indexOf('두 번째')).toBeGreaterThan(rendered!.indexOf('첫 번째'))
    expect(rendered).toContain('[내용 잘림 · 이후 1건 생략]')
    expect(rendered).toMatch(/ · 사용자 제보$/)
    expect(rendered).not.toContain('세 번째')
  })

  it('counts supplementary Unicode as code points at the truncation boundary', () => {
    const rendered = renderBenefitCorrectionPublications([
      publication({ title: '이모지', description: '😀'.repeat(6_000), trustLabel: '공식 확인' }),
    ], 'health')

    expect(Array.from(rendered!)).toHaveLength(BENEFIT_CORRECTION_CURRENT_TEXT_MAX_LENGTH)
    expect(rendered).toContain('😀')
    expect(rendered).toContain('[내용 잘림]')
    expect(rendered).not.toContain('\uFFFD')
  })
})
