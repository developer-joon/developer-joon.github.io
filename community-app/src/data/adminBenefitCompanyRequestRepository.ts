import { parseEnv } from '../config/env'
import { getSupabaseClient } from '../lib/supabase'
import { createBenefitCompanyRequestRepository, createBenefitCompanyRequestSessionProvider, type BenefitCompanyRequestRepository, type BenefitCompanyRequestSessionProvider } from './benefitCompanyRequestRepository'
import type { BenefitCompanyRequestAdminItem, BenefitCompanyRequestPage, BenefitCompanyRequestQueueInput, BenefitCompanyRequestResult, ReviewBenefitCompanyRequestInput } from '../types/benefitCompanyRequests'

export type AdminBenefitCompanyRequestReviewInput = ReviewBenefitCompanyRequestInput
export interface AdminBenefitCompanyRequestRepository {
  listQueue(input:BenefitCompanyRequestQueueInput,signal?:AbortSignal):Promise<BenefitCompanyRequestResult<BenefitCompanyRequestPage<BenefitCompanyRequestAdminItem>>>
  getDetail(input:{requestId:string},signal?:AbortSignal):Promise<BenefitCompanyRequestResult<BenefitCompanyRequestAdminItem>>
  review(input:AdminBenefitCompanyRequestReviewInput,signal?:AbortSignal):Promise<BenefitCompanyRequestResult<BenefitCompanyRequestAdminItem>>
}
function record(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value)}
function canonical(input:Omit<AdminBenefitCompanyRequestReviewInput,'clientKey'>){
  if(!record(input)||typeof input.reason!=='string')return null
  const reason=input.reason.trim()
  if(!reason||Array.from(reason).length>1000)return null
  return {...input,reason}
}
export function adminBenefitCompanyRequestActionFingerprint(input:Omit<AdminBenefitCompanyRequestReviewInput,'clientKey'>){
  const value=canonical(input)
  if(!value)return null
  return JSON.stringify({requestId:value.requestId.toLowerCase(),expectedStatus:value.expectedStatus,expectedRevision:value.expectedRevision,action:value.action,reason:value.reason,destinationCompanyId:value.destinationCompanyId})
}
export function createAdminBenefitCompanyRequestRepository({getSessionContext}:{getSessionContext:BenefitCompanyRequestSessionProvider}):AdminBenefitCompanyRequestRepository{
  const base=createBenefitCompanyRequestRepository({getSessionContext})
  return {
    listQueue:(input,signal)=>base.listQueue(input,signal),
    getDetail:(input,signal)=>base.getDetail(input,signal),
    review:(input,signal)=>base.review(input,signal),
  }
}
let singleton:AdminBenefitCompanyRequestRepository|undefined
export function getAdminBenefitCompanyRequestRepository(){
  if(singleton)return singleton
  const supabase=getSupabaseClient(),config=parseEnv(import.meta.env)
  singleton=createAdminBenefitCompanyRequestRepository({getSessionContext:createBenefitCompanyRequestSessionProvider(supabase.auth,config)})
  return singleton
}
export type { BenefitCompanyRequestRepository }
