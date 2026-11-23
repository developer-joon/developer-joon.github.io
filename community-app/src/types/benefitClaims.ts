import type { BenefitDirectoryCategory } from './benefitDirectory'

export const BENEFIT_CLAIM_STATUSES = ['submitted','community_confirmed','disputed','hidden','withdrawn','merged'] as const
export type BenefitClaimStatus = typeof BENEFIT_CLAIM_STATUSES[number]
export type ActiveBenefitClaimStatus = Extract<BenefitClaimStatus,'submitted'|'community_confirmed'|'disputed'>
export type BenefitClaimReaction = 'confirm'|'dispute'
export type BenefitClaimErrorCode = 'invalid_argument'|'auth_required'|'forbidden'|'conflict'|'rate_limited'|'unavailable'|'network'|'aborted'|'stale_session'|'invalid_response'|'unknown'
export type BenefitClaimResult<T> = {ok:true;data:T}|{ok:false;error:{code:BenefitClaimErrorCode;message:string}}
export interface BenefitClaimCreateInput {clientKey:string;companyId:string;categoryId:BenefitDirectoryCategory;title:string;description:string;eligibilityText:string|null;conditionText:string|null;observedOn:string;sourceUrl:string|null}
export interface BenefitClaimCreateResult {claimId:string;outcome:'created'|'duplicate'}
export interface BenefitClaimOwnerItem {claimId:string;companyId:string;companyName:string;categoryId:BenefitDirectoryCategory;title:string;description:string;eligibilityText:string|null;conditionText:string|null;observedOn:string;status:BenefitClaimStatus;revision:number;createdAt:string;updatedAt:string;withdrawnAt:string|null}
export interface BenefitClaimPage<T> {items:T[];hasMore:boolean;nextCursor:string|null}
export interface BenefitClaimListInput {limit:number;cursor?:string|null}
export interface BenefitClaimWithdrawInput {claimId:string;clientKey:string;expectedStatus:ActiveBenefitClaimStatus;expectedRevision:number}
export interface BenefitClaimWithdrawResult {claimId:string;status:'withdrawn';revision:number;outcome:'withdrawn'}
export interface BenefitClaimReactionInput {claimId:string;clientKey:string;reaction:BenefitClaimReaction|null}
export interface BenefitClaimReactionResult {claimId:string;reaction:BenefitClaimReaction|null;status:ActiveBenefitClaimStatus;revision:number;confirmCount:number;disputeCount:number;activePublicationId:string|null;outcome:'set'|'changed'|'cleared'|'unchanged'}
export type BenefitClaimQueueFilter='active'|BenefitClaimStatus|'all'
export interface BenefitClaimQueueItem {claimId:string;companyId:string;companyName:string;categoryId:BenefitDirectoryCategory;title:string;status:BenefitClaimStatus;revision:number;confirmCount:number;disputeCount:number;communityPublicationActive:boolean;officialPublicationActive:boolean;createdAt:string;updatedAt:string}
export interface BenefitClaimQueueInput {status:BenefitClaimQueueFilter;limit:number;cursor?:string|null}
export type BenefitClaimAuditKind='claim_event'|'official_review'|'merge'
export type BenefitClaimEvidenceType='official_website'|'company_policy'|'regulatory_filing'|'employment_document'|'other_official'
export interface BenefitClaimAuditItem {eventId:string;eventKind:BenefitClaimAuditKind;action:string;fromStatus:BenefitClaimStatus|null;toStatus:BenefitClaimStatus|null;evidenceType:BenefitClaimEvidenceType|null;evidenceObservedOn:string|null;relatedClaimId:string|null;publicationId:string|null;createdAt:string}
export interface BenefitClaimAuditInput {claimId:string;limit:number;cursor?:string|null}
export type BenefitClaimModerationAction='hide'|'restore'|'withdraw'|'merge'|'withdraw_official'
export interface BenefitClaimModerateInput {claimId:string;clientKey:string;expectedStatus:BenefitClaimStatus;expectedRevision:number;action:BenefitClaimModerationAction;targetClaimId:string|null;reason:string;evidenceType:BenefitClaimEvidenceType|null;evidenceObservedOn:string|null;evidenceSourceUrl:string|null}
export interface BenefitClaimModerationResult {claimId:string;status:BenefitClaimStatus;revision:number;communityPublicationId:string|null;officialPublicationId:string|null;outcome:BenefitClaimModerationAction;targetClaimId:string|null}
export interface BenefitClaimOfficialVerifyInput {claimId:string;clientKey:string;expectedStatus:ActiveBenefitClaimStatus;expectedRevision:number;title:string;description:string;eligibilityText:string|null;conditionText:string|null;evidenceType:BenefitClaimEvidenceType;evidenceSourceUrl:string;evidenceObservedOn:string;verificationNote:string}
export interface BenefitClaimOfficialVerifyResult {claimId:string;status:ActiveBenefitClaimStatus;revision:number;officialPublicationId:string;outcome:'verify'|'reverify'}
