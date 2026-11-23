export type BenefitCompanyIdKind = 'legacy_crn' | 'legacy_biz' | 'canonical'

export interface ParsedBenefitCompanyId {
  readonly value: string
  readonly kind: BenefitCompanyIdKind
}

const LEGACY_CRN_ID = /^KR-CRN-[0-9]{13}$/
const LEGACY_BIZ_ID = /^KR-BIZ-[0-9]{10}$/
const CANONICAL_ID = /^KR-CAN-[0-9a-f]{32}$/
const LEGACY_ARTIFACT_COMPANY_ID = /^US-CIK[0-9]{10}$/

export function isLegacyBenefitCrnId(value: unknown): value is string {
  return typeof value === 'string' && LEGACY_CRN_ID.test(value)
}

export function isLegacyBenefitBizId(value: unknown): value is string {
  return typeof value === 'string' && LEGACY_BIZ_ID.test(value)
}

export function isFrozenBenefitArtifactCompanyId(value: unknown): value is string {
  return isLegacyBenefitCrnId(value) || isLegacyBenefitArtifactCompanyId(value)
}

export function parseBenefitCompanyId(value: unknown): ParsedBenefitCompanyId | null {
  if (typeof value !== 'string') return null
  const kind: BenefitCompanyIdKind | null = isLegacyBenefitCrnId(value)
    ? 'legacy_crn'
    : isLegacyBenefitBizId(value)
      ? 'legacy_biz'
      : CANONICAL_ID.test(value)
        ? 'canonical'
        : null
  return kind ? { value, kind } : null
}

export function isBenefitCompanyId(value: unknown): value is string {
  return parseBenefitCompanyId(value) !== null
}

// The frozen v2 research artifact still contains US-CIK IDs. They are not
// canonical IDs in the dynamic benefit-company directory.
export function isLegacyBenefitArtifactCompanyId(value: unknown): value is string {
  return typeof value === 'string' && LEGACY_ARTIFACT_COMPANY_ID.test(value)
}
