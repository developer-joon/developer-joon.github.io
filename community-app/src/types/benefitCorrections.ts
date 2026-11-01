export const BENEFIT_CATEGORIES = ['leave', 'family', 'health', 'growth', 'housing', 'commute', 'remote', 'retirement', 'meals', 'inclusion'] as const
export const BENEFIT_CORRECTION_STATUSES = ['submitted', 'reviewing', 'approved', 'rejected', 'applied'] as const
export const BENEFIT_CORRECTION_QUEUE_FILTERS = ['active', ...BENEFIT_CORRECTION_STATUSES, 'all'] as const
export const BENEFIT_CORRECTION_REVIEW_ACTIONS = ['start_review', 'request_additional_material', 'approve', 'reject'] as const

export type BenefitCategory = typeof BENEFIT_CATEGORIES[number]
export type BenefitCorrectionStatus = typeof BENEFIT_CORRECTION_STATUSES[number]
export type BenefitCorrectionQueueFilter = typeof BENEFIT_CORRECTION_QUEUE_FILTERS[number]
export type BenefitCorrectionReviewAction = typeof BENEFIT_CORRECTION_REVIEW_ACTIONS[number]

export interface BenefitCorrectionItem {
  id: string
  companyId: string
  categoryId: BenefitCategory
  currentText: string
  proposedText: string
  scopeText: string
  sourceUrl: string
  observedDataVersion: string
  status: BenefitCorrectionStatus
  adminResponse: string | null
  appliedDataVersion: string | null
  appliedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AdminBenefitCorrectionItem extends BenefitCorrectionItem {
  reviewedAt: string | null
}

export interface BenefitCorrectionCursor { createdAt: string; id: string }
export interface BenefitCorrectionPage<T> { items: T[]; hasMore: boolean; nextCursor: BenefitCorrectionCursor | null }

export interface CreateBenefitCorrectionInput {
  clientKey: string
  companyId: string
  categoryId: BenefitCategory
  currentText: string
  proposedText: string
  scopeText: string
  sourceUrl: string
  observedDataVersion: string
}

export interface BenefitCorrectionListInput { limit: number; cursor?: BenefitCorrectionCursor }
export interface BenefitCorrectionQueueInput extends BenefitCorrectionListInput { status: BenefitCorrectionQueueFilter }
export interface ReviewBenefitCorrectionInput {
  requestId: string
  expectedStatus: 'submitted' | 'reviewing'
  action: BenefitCorrectionReviewAction
  adminResponse: string
  clientKey: string
}

export type BenefitCorrectionErrorCode = 'invalid_argument' | 'invalid_response' | 'stale_response' | 'aborted' | 'auth_required' | 'forbidden' | 'conflict' | 'rate_limited' | 'network' | 'unknown'
export interface BenefitCorrectionError { code: BenefitCorrectionErrorCode; message: string; sourceCode?: string }
export type BenefitCorrectionResult<T> = { ok: true; data: T } | { ok: false; error: BenefitCorrectionError }

export interface BenefitCorrectionDraft {
  version: 1
  draftId: string
  submissionScopeId: string
  companyId: string
  categoryId: BenefitCategory | ''
  currentText: string
  proposedText: string
  scopeText: string
  sourceUrl: string
  observedDataVersion: string
  updatedAt: string
}
