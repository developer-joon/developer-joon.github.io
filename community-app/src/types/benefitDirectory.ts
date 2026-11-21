export const BENEFIT_DIRECTORY_CATEGORIES = [
  'leave', 'family', 'health', 'growth', 'housing', 'commute', 'remote', 'retirement', 'meals', 'inclusion',
] as const
export type BenefitDirectoryCategory = (typeof BENEFIT_DIRECTORY_CATEGORIES)[number]

export const BENEFIT_DIRECTORY_SIZE_CLASSES = ['large', 'medium', 'small', 'large_affiliate', 'unclassified'] as const
export type BenefitDirectorySizeClass = (typeof BENEFIT_DIRECTORY_SIZE_CLASSES)[number]

export const BENEFIT_DIRECTORY_IDENTITY_LABELS = ['법인', '등록 사업자', '채용 관찰 사업자', '공시대상기업집단 소속 법인'] as const
export type BenefitDirectoryIdentityLabel = (typeof BENEFIT_DIRECTORY_IDENTITY_LABELS)[number]

export const BENEFIT_DIRECTORY_SIZE_LABELS = ['대기업', '중견기업', '중소기업', '대규모기업집단 소속', '분류 미확인'] as const
export type BenefitDirectorySizeLabel = (typeof BENEFIT_DIRECTORY_SIZE_LABELS)[number]

export const BENEFIT_DIRECTORY_TRUST_LABELS = ['공식 확인', '사용자 제보'] as const
export type BenefitDirectoryTrustLabel = (typeof BENEFIT_DIRECTORY_TRUST_LABELS)[number]

export interface BenefitDirectorySearchInput {
  query?: string | null
  categories?: BenefitDirectoryCategory[] | null
  industry?: string | null
  size?: BenefitDirectorySizeClass | null
  region?: string | null
  hasBenefitsOnly?: boolean
  pageSize: number
  /** Opaque server continuation. Clients must not parse or rewrite it. */
  cursor?: string | null
}

export interface BenefitDirectoryCompanySummary {
  companyId: string
  displayName: string
  identityLabel: BenefitDirectoryIdentityLabel
  industry: string | null
  sizeLabel: BenefitDirectorySizeLabel
  region: string | null
  summary: string | null
}

export interface BenefitDirectorySearchItem extends BenefitDirectoryCompanySummary {
  benefitCount: number
  officialCount: number
  communityCount: number
  categories: BenefitDirectoryCategory[]
}

export interface BenefitDirectoryPage {
  items: BenefitDirectorySearchItem[]
  hasMore: boolean
  nextCursor: string | null
  total: number
}

export interface BenefitDirectoryPublication {
  publicationId: string
  categoryId: BenefitDirectoryCategory
  title: string
  description: string
  eligibilityText: string | null
  conditionText: string | null
  trustLabel: BenefitDirectoryTrustLabel
  revision: number
}

export interface BenefitCompanyDetail {
  company: BenefitDirectoryCompanySummary
  publications: BenefitDirectoryPublication[]
}

export type BenefitDirectoryErrorCode =
  | 'invalid_argument'
  | 'aborted'
  | 'network'
  | 'timeout'
  | 'rate_limited'
  | 'unavailable'
  | 'configuration'
  | 'not_found'
  | 'invalid_response'
  | 'unknown'

export interface BenefitDirectoryError {
  code: BenefitDirectoryErrorCode
  message: string
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: BenefitDirectoryError }
