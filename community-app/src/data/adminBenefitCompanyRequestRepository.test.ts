import { describe, expect, it, vi } from 'vitest'
import { adminBenefitCompanyRequestActionFingerprint, createAdminBenefitCompanyRequestRepository } from './adminBenefitCompanyRequestRepository'
import type { BenefitCompanyRequestSessionContext } from './benefitCompanyRequestRepository'

const actor='10000000-0000-4000-8000-000000000001'
const requestId='20000000-0000-4000-8000-000000000001'
const created='2026-11-23T01:00:00.000000Z'
const row={request_id:requestId,proposed_name:'안전 기업',region:'서울',industry:'소프트웨어',website:'https://example.com',verification_status:'pending',status:'pending_review',revision:1,resolved_company_id:null,created_at:created,updated_at:created,verification_method:'manual',external_verified_at:null}
const ok=(data:unknown)=>({data,error:null,count:null,status:200,statusText:'OK'})
function context(fingerprint='one',rpc:BenefitCompanyRequestSessionContext['rpc']=vi.fn(async()=>ok({items:[row],has_more:false,next_cursor:null}))):BenefitCompanyRequestSessionContext{return{actorId:actor,sessionFingerprint:fingerprint,rpc,invokeFunction:vi.fn()}}

describe('adminBenefitCompanyRequestRepository',()=>{
  it('binds the exact bounded queue filter and rejects private projection keys',async()=>{
    const rpc=vi.fn(async()=>ok({items:[row],has_more:false,next_cursor:null}))
    const repository=createAdminBenefitCompanyRequestRepository({getSessionContext:async()=>context('one',rpc)})
    expect(await repository.listQueue({status:'pending_review',limit:50})).toMatchObject({ok:true,data:{items:[{proposedName:'안전 기업'}]}})
    expect(rpc).toHaveBeenCalledWith('list_benefit_company_request_queue_v2',{p_status:'pending_review',p_limit:50,p_cursor_created_at:null,p_cursor_id:null},undefined)
    rpc.mockResolvedValueOnce(ok({items:[{...row,business_number:'1234567890'}],has_more:false,next_cursor:null}))
    await expect(repository.listQueue({status:'pending_review',limit:50})).resolves.toMatchObject({ok:false,error:{code:'invalid_response'}})
  })

  it('sends the client key to review v2 and rejects malformed exact responses',async()=>{
    const key='40000000-0000-4000-8000-000000000001'
    const reviewed={...row,status:'rejected',verification_status:'rejected',revision:2}
    const rpc=vi.fn(async()=>ok(reviewed))
    const repository=createAdminBenefitCompanyRequestRepository({getSessionContext:async()=>context('one',rpc)})
    await expect(repository.review({requestId,clientKey:key,expectedStatus:'pending_review',expectedRevision:1,action:'reject',reason:'중복',destinationCompanyId:null})).resolves.toMatchObject({ok:true,data:{status:'rejected'}})
    expect(rpc).toHaveBeenCalledWith('review_benefit_company_request_v2',{p_client_key:key,p_request_id:requestId,p_expected_status:'pending_review',p_expected_revision:1,p_action:'reject',p_reason:'중복',p_destination_company_id:null},undefined)
    rpc.mockResolvedValueOnce(ok({...reviewed,business_number_digest:'secret'}))
    await expect(repository.review({requestId,clientKey:'40000000-0000-4000-8000-000000000002',expectedStatus:'pending_review',expectedRevision:1,action:'reject',reason:'중복',destinationCompanyId:null})).resolves.toMatchObject({ok:false,error:{code:'invalid_response'}})
  })

  it('enforces auth generation before input access and after fulfilled decode',async()=>{
    let fingerprint='one',touched=false
    const input=Object.defineProperty({},'status',{enumerable:true,get(){touched=true;return'pending_review'}}) as never
    const repository=createAdminBenefitCompanyRequestRepository({getSessionContext:async()=>null})
    await expect(repository.listQueue(input)).resolves.toMatchObject({ok:false,error:{code:'auth_required'}})
    expect(touched).toBe(false)
    const changing=createAdminBenefitCompanyRequestRepository({getSessionContext:async()=>context(fingerprint,vi.fn(async()=>{fingerprint='two';return ok({items:[row],has_more:false,next_cursor:null})}))})
    await expect(changing.listQueue({status:'pending_review',limit:50})).resolves.toMatchObject({ok:false,error:{code:'stale_session'}})
  })

  it('canonicalizes unchanged CAS intent and changes the fingerprint with action or destination',()=>{
    const base={requestId,expectedStatus:'pending_review' as const,expectedRevision:1,action:'reject' as const,reason:'  중복 요청  ',destinationCompanyId:null}
    expect(adminBenefitCompanyRequestActionFingerprint(base)).toBe(adminBenefitCompanyRequestActionFingerprint({...base,reason:'중복 요청'}))
    expect(adminBenefitCompanyRequestActionFingerprint(base)).not.toBe(adminBenefitCompanyRequestActionFingerprint({...base,action:'approve'}))
    expect(adminBenefitCompanyRequestActionFingerprint({...base,action:'merge',destinationCompanyId:'KR-BIZ-1234567890'})).not.toBeNull()
  })
})
