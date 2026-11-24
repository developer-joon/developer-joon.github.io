import { parseEnv } from '../config/env'
import { getSupabaseClient } from '../lib/supabase'
import { isStrictUuid } from '../lib/uuid'
import { createBenefitCompanyRequestRepository, createBenefitCompanyRequestSessionProvider, type BenefitCompanyRequestRepository, type BenefitCompanyRequestSessionProvider } from './benefitCompanyRequestRepository'
import type { BenefitCompanyRequestAdminItem, BenefitCompanyRequestPage, BenefitCompanyRequestQueueInput, BenefitCompanyRequestResult, ReviewBenefitCompanyRequestInput } from '../types/benefitCompanyRequests'

export type AdminBenefitCompanyRequestReviewInput = ReviewBenefitCompanyRequestInput
export interface AdminBenefitCompanyRequestRepository {
  listQueue(input:BenefitCompanyRequestQueueInput,signal?:AbortSignal):Promise<BenefitCompanyRequestResult<BenefitCompanyRequestPage<BenefitCompanyRequestAdminItem>>>
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
    async review(input,signal){
      let context
      try{context=await getSessionContext()}catch{return{ok:false,error:{code:'unknown',message:'로그인 세션을 확인할 수 없습니다.'}}}
      if(!context)return{ok:false,error:{code:'auth_required',message:'로그인이 필요합니다.'}}
      if(signal?.aborted)return{ok:false,error:{code:'aborted',message:'요청이 취소되었습니다.'}}
      if(!record(input)||!isStrictUuid(input.clientKey))return{ok:false,error:{code:'invalid_argument',message:'검토 입력을 확인해 주세요.'}}
      const value=canonical({requestId:input.requestId,expectedStatus:input.expectedStatus,expectedRevision:input.expectedRevision,action:input.action,reason:input.reason,destinationCompanyId:input.destinationCompanyId})
      if(!value)return{ok:false,error:{code:'invalid_argument',message:'검토 입력을 확인해 주세요.'}}
      return base.review({...value,clientKey:input.clientKey},signal)
    },
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
