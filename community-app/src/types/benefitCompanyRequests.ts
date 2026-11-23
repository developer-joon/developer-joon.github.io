export const BENEFIT_COMPANY_REQUEST_STATUSES=['pending_review','approved','rejected','merged'] as const
export type BenefitCompanyRequestStatus=typeof BENEFIT_COMPANY_REQUEST_STATUSES[number]
export const BENEFIT_COMPANY_VERIFICATION_STATUSES=['pending','matched','mismatched','unavailable','rejected'] as const
export type BenefitCompanyVerificationStatus=typeof BENEFIT_COMPANY_VERIFICATION_STATUSES[number]
export type BenefitCompanyVerificationMethod='manual'|'nts_full'
export type BenefitCompanyRequestErrorCode='invalid_argument'|'auth_required'|'forbidden'|'conflict'|'rate_limited'|'unavailable'|'network'|'aborted'|'stale_session'|'invalid_response'|'verification_rejected'|'verification_indeterminate'|'unknown'
export type BenefitCompanyRequestResult<T>={ok:true;data:T}|{ok:false;error:{code:BenefitCompanyRequestErrorCode;message:string}}
export interface BenefitCompanyRequestItem {requestId:string;proposedName:string;region:string|null;industry:string|null;website:string|null;verificationStatus:BenefitCompanyVerificationStatus;status:BenefitCompanyRequestStatus;revision:number;resolvedCompanyId:string|null;createdAt:string;updatedAt:string}
export interface BenefitCompanyRequestAdminItem extends BenefitCompanyRequestItem {verificationMethod:BenefitCompanyVerificationMethod}
export interface BenefitCompanyRequestPage<T> {items:T[];hasMore:boolean;nextCursor:string|null}
export interface BenefitCompanyRequestListInput {limit:number;cursor?:string|null}
export interface CreateManualBenefitCompanyRequestInput {clientKey:string;proposedName:string;region:string|null;industry:string|null;website:string|null}
export interface VerifyBenefitCompanyNtsInput {clientKey:string;businessName:string;businessNumber:string;openingDate:string;representativeName:string;region:string|null;industry:string|null;website:string|null}
export interface VerifyBenefitCompanyNtsResult {requestId:string;status:'approved'|'merged';verificationStatus:'matched';message:string}
export type BenefitCompanyRequestQueueFilter=BenefitCompanyRequestStatus|'all'
export interface BenefitCompanyRequestQueueInput {status:BenefitCompanyRequestQueueFilter;limit:number;cursor?:string|null}
export interface ReviewBenefitCompanyRequestInput {requestId:string;expectedStatus:'pending_review';expectedRevision:number;action:'approve'|'reject'|'merge';reason:string;destinationCompanyId:string|null}
