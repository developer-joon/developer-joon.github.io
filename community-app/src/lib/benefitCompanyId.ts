export type BenefitCompanyIdKind = 'legacy_crn' | 'legacy_biz' | 'canonical'

export interface ParsedBenefitCompanyId {
  readonly value: string
  readonly kind: BenefitCompanyIdKind
}

const BENEFIT_COMPANY_ID = /^(?:KR-CRN-[0-9]{13}|KR-BIZ-[0-9]{10}|KR-CAN-[0-9a-f]{32})$/
const LEGACY_ARTIFACT_COMPANY_ID = /^US-CIK[0-9]{10}$/

export function parseBenefitCompanyId(value: unknown): ParsedBenefitCompanyId | null {
  if (typeof value !== 'string' || !BENEFIT_COMPANY_ID.test(value)) return null
  const kind: BenefitCompanyIdKind = value.startsWith('KR-CRN-')
    ? 'legacy_crn'
    : value.startsWith('KR-BIZ-')
      ? 'legacy_biz'
      : 'canonical'
  return { value, kind }
}

export function isBenefitCompanyId(value: unknown): value is string {
  return parseBenefitCompanyId(value) !== null
}

// The frozen v2 research artifact still contains US-CIK IDs. They are not
// canonical IDs in the dynamic benefit-company directory.
export function isLegacyBenefitArtifactCompanyId(value: unknown): value is string {
  return typeof value === 'string' && LEGACY_ARTIFACT_COMPANY_ID.test(value)
}
