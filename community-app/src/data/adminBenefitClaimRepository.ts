import { parseEnv } from '../config/env'
import { getSupabaseClient } from '../lib/supabase'
import { isStrictBenefitClaimSourceUrl, validCalendarDate } from '../lib/benefitDraftSupport'
import { isCanonicalUuid, isStrictUuid } from '../lib/uuid'
import { createBenefitClaimRepository, type BenefitClaimRepository, type BenefitClaimSessionProvider } from './benefitClaimRepository'
import { createBenefitSubmissionSessionProvider } from './benefitSubmissionRepository'
import type { BenefitClaimAuditInput, BenefitClaimAuditItem, BenefitClaimModerateInput, BenefitClaimModerationResult, BenefitClaimOfficialVerifyInput, BenefitClaimOfficialVerifyResult, BenefitClaimPage, BenefitClaimQueueInput, BenefitClaimQueueItem, BenefitClaimResult } from '../types/benefitClaims'

export interface AdminBenefitClaimRepository {
 listQueue(input:BenefitClaimQueueInput,signal?:AbortSignal):Promise<BenefitClaimResult<BenefitClaimPage<BenefitClaimQueueItem>>>
 listAudit(input:BenefitClaimAuditInput,signal?:AbortSignal):Promise<BenefitClaimResult<BenefitClaimPage<BenefitClaimAuditItem>>>
 moderateClaim(input:BenefitClaimModerateInput,signal?:AbortSignal):Promise<BenefitClaimResult<BenefitClaimModerationResult>>
 officiallyVerifyClaim(input:BenefitClaimOfficialVerifyInput,signal?:AbortSignal):Promise<BenefitClaimResult<BenefitClaimOfficialVerifyResult>>
}
type Intent={kind:'moderate';payload:BenefitClaimModerateInput}|{kind:'official_verify';payload:BenefitClaimOfficialVerifyInput}
function trim(value:unknown,max:number){if(typeof value!=='string')return null;const result=value.trim();return result&&Array.from(result).length<=max?result:null}
export function adminBenefitClaimActionFingerprint(intent:Intent){
 const common=intent?.payload
 if(!common||!isCanonicalUuid(common.claimId)||!isStrictUuid(common.clientKey)||!Number.isSafeInteger(common.expectedRevision)||common.expectedRevision<1)return null
 if(intent.kind==='moderate'){
  const p=intent.payload
  const reason=trim(p.reason,1000)
  if(!reason||!['hide','restore','withdraw','merge','withdraw_official'].includes(p.action))return null
  if(p.action==='merge'&&(!isCanonicalUuid(p.targetClaimId)||p.targetClaimId===p.claimId))return null
  if(p.action!=='merge'&&p.targetClaimId!==null)return null
  if(p.action==='withdraw_official'&&(!p.evidenceType||!p.evidenceObservedOn||!p.evidenceSourceUrl))return null
  return JSON.stringify({kind:intent.kind,claimId:p.claimId.toLowerCase(),expectedStatus:p.expectedStatus,expectedRevision:p.expectedRevision,action:p.action,targetClaimId:p.targetClaimId,reason,evidenceType:p.evidenceType,evidenceObservedOn:p.evidenceObservedOn,evidenceSourceUrl:p.evidenceSourceUrl})
 }
 const p=intent.payload
 const title=trim(p.title,200),description=trim(p.description,1000),note=trim(p.verificationNote,1000)
 if(!title||!description||!note||!p.evidenceType||!validCalendarDate(p.evidenceObservedOn,new Date().toISOString().slice(0,10),false)||!isStrictBenefitClaimSourceUrl(p.evidenceSourceUrl))return null
 return JSON.stringify({kind:intent.kind,claimId:p.claimId.toLowerCase(),expectedStatus:p.expectedStatus,expectedRevision:p.expectedRevision,title,description,eligibilityText:p.eligibilityText?.trim()||null,conditionText:p.conditionText?.trim()||null,evidenceType:p.evidenceType,evidenceSourceUrl:p.evidenceSourceUrl,evidenceObservedOn:p.evidenceObservedOn,verificationNote:note})
}
export function createAdminBenefitClaimRepository({getSessionContext,now=()=>new Date()}:{getSessionContext:BenefitClaimSessionProvider;now?:()=>Date}):AdminBenefitClaimRepository{
 const base=createBenefitClaimRepository({getSessionContext,now})
 return {listQueue:(input,signal)=>base.listModerationQueue(input,signal),listAudit:(input,signal)=>base.listAudit(input,signal),moderateClaim:(input,signal)=>base.moderateClaim(input,signal),officiallyVerifyClaim:(input,signal)=>base.officiallyVerifyClaim(input,signal)}
}
let singleton:AdminBenefitClaimRepository|undefined
export function getAdminBenefitClaimRepository(){if(singleton)return singleton;const supabase=getSupabaseClient(),config=parseEnv(import.meta.env);singleton=createAdminBenefitClaimRepository({getSessionContext:createBenefitSubmissionSessionProvider(supabase.auth,config)});return singleton}
export type { BenefitClaimRepository }
