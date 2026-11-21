import type { BenefitSubmissionError, BenefitSubmissionItem, BenefitSubmissionResult, BenefitSubmissionStatus } from './benefitSubmissions'

export const ADMIN_BENEFIT_SUBMISSION_FILTERS = ['active', 'all', 'submitted', 'reviewing', 'approved', 'rejected'] as const
export type AdminBenefitSubmissionFilter = typeof ADMIN_BENEFIT_SUBMISSION_FILTERS[number]
export type AdminBenefitSubmissionItem = BenefitSubmissionItem
export interface AdminBenefitSubmissionCursor { createdAt: string; id: string }
export interface AdminBenefitSubmissionPage { items: AdminBenefitSubmissionItem[]; hasMore: boolean; nextCursor: AdminBenefitSubmissionCursor | null }
export interface AdminBenefitSubmissionListInput { status: AdminBenefitSubmissionFilter; limit: number; cursor?: AdminBenefitSubmissionCursor }
export type AdminBenefitSubmissionAction = 'start_review' | 'additional_material_requested' | 'approve' | 'reject'
export interface AdminBenefitSubmissionReviewBase {
  submissionId: string
  expectedStatus: Extract<BenefitSubmissionStatus, 'submitted' | 'reviewing'>
  action: AdminBenefitSubmissionAction
  adminResponse: string
  clientKey: string
}
export interface AdminBenefitSubmissionApprovalInput extends AdminBenefitSubmissionReviewBase {
  action: 'approve'
  expectedStatus: 'reviewing'
  publicTitle: string
  publicDescription: string
  publicEligibility: string | null
  publicCondition: string | null
  existingPublicationId: string | null
}
export interface AdminBenefitSubmissionNonApprovalInput extends AdminBenefitSubmissionReviewBase {
  action: 'start_review' | 'additional_material_requested' | 'reject'
  publicTitle?: never
  publicDescription?: never
  publicEligibility?: never
  publicCondition?: never
  existingPublicationId?: never
}
export type AdminBenefitSubmissionReviewInput = AdminBenefitSubmissionApprovalInput | AdminBenefitSubmissionNonApprovalInput
export interface AdminBenefitSubmissionReviewResult {
  item: AdminBenefitSubmissionItem
  action: AdminBenefitSubmissionAction
  trustTier: 'community_reviewed' | null
}
export type AdminBenefitSubmissionResult<T> = BenefitSubmissionResult<T>
export type AdminBenefitSubmissionRepositoryError = BenefitSubmissionError
