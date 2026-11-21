export const BENEFIT_SUBMISSION_CATEGORIES = ['leave', 'family', 'health', 'growth', 'housing', 'commute', 'remote', 'retirement', 'meals', 'inclusion'] as const
export const BENEFIT_SUBMISSION_STATUSES = ['submitted', 'reviewing', 'approved', 'rejected'] as const
export type BenefitSubmissionCategory = typeof BENEFIT_SUBMISSION_CATEGORIES[number]
export type BenefitSubmissionStatus = typeof BENEFIT_SUBMISSION_STATUSES[number]

export interface BenefitSubmissionItem {
  id: string
  companyId: string
  categoryId: BenefitSubmissionCategory
  benefitText: string
  eligibilityText: string | null
  conditionText: string | null
  sourceUrl: string | null
  status: BenefitSubmissionStatus
  adminResponse: string | null
  publicationId: string | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}
export interface BenefitSubmissionCursor { createdAt: string; id: string }
export interface BenefitSubmissionPage { items: BenefitSubmissionItem[]; hasMore: boolean; nextCursor: BenefitSubmissionCursor | null }
export interface CreateBenefitSubmissionInput {
  clientKey: string
  companyId: string
  categoryId: BenefitSubmissionCategory
  benefitText: string
  eligibilityText: string | null
  conditionText: string | null
  sourceUrl: string | null
}
export interface BenefitSubmissionListInput { limit: number; cursor?: BenefitSubmissionCursor }
export type BenefitSubmissionErrorCode = 'invalid_argument' | 'invalid_response' | 'stale_response' | 'aborted' | 'auth_required' | 'forbidden' | 'conflict' | 'rate_limited' | 'idempotency_mismatch' | 'network' | 'unavailable' | 'unknown'
export interface BenefitSubmissionError { code: BenefitSubmissionErrorCode; message: string; sourceCode?: string }
export type BenefitSubmissionResult<T> = { ok: true; data: T } | { ok: false; error: BenefitSubmissionError }
export type BenefitSubmissionAccountScope = string & { readonly __benefitSubmissionAccountScope: unique symbol }
export interface BenefitSubmissionDraft {
  version: 1
  accountScope: BenefitSubmissionAccountScope | 'preauth'
  clientKey: string
  companyId: string
  companyName: string
  categoryId: BenefitSubmissionCategory | ''
  benefitText: string
  eligibilityText: string
  conditionText: string
  sourceUrl: string
  updatedAt: string
}
