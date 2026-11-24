import { describe, expect, it, vi } from 'vitest'
import { adminBenefitClaimActionFingerprint, createAdminBenefitClaimRepository } from './adminBenefitClaimRepository'
import type { BenefitClaimSessionContext } from './benefitClaimRepository'

const actor='10000000-0000-4000-8000-000000000001',claimId='30000000-0000-4000-8000-000000000001',created='2026-11-23T01:00:00.000000Z'
const row={claim_id:claimId,company_id:'KR-BIZ-1234567890',company_name:'안전 기업',category_id:'health',title:'건강검진',status:'submitted',revision:1,confirm_count:3,dispute_count:0,community_publication_active:false,official_publication_active:false,created_at:created,updated_at:created}
const ok=(data:unknown)=>({data,error:null,count:null,status:200,statusText:'OK'})
function context(fingerprint='one',rpc:BenefitClaimSessionContext['rpc']=vi.fn(async()=>ok({items:[row],has_more:false,next_cursor:null}))):BenefitClaimSessionContext{return{actorId:actor,sessionFingerprint:fingerprint,rpc}}

describe('adminBenefitClaimRepository',()=>{
  it('binds exact filters and bounded audit pagination',async()=>{
    const rpc=vi.fn(async(_name:string)=>ok({items:_name.includes('audit')?[]:[row],has_more:false,next_cursor:null}))
    const repository=createAdminBenefitClaimRepository({getSessionContext:async()=>context('one',rpc)})
    await expect(repository.listQueue({status:'submitted',limit:50})).resolves.toMatchObject({ok:true,data:{items:[{confirmCount:3}]}})
    expect(rpc).toHaveBeenNthCalledWith(1,'list_benefit_claim_moderation_queue_v1',{p_status:'submitted',p_limit:50,p_cursor_created_at:null,p_cursor_id:null},undefined)
    await repository.listAudit({claimId,limit:50})
    expect(rpc).toHaveBeenNthCalledWith(2,'list_benefit_claim_audit_v1',{p_claim_id:claimId,p_limit:50,p_cursor_created_at:null,p_cursor_kind:null,p_cursor_id:null},undefined)
  })

  it('fails before reading caller input without auth and rejects stale fulfilled responses',async()=>{
    let touched=false
    const input=Object.defineProperty({},'status',{enumerable:true,get(){touched=true;return'submitted'}}) as never
    await createAdminBenefitClaimRepository({getSessionContext:async()=>null}).listQueue(input)
    expect(touched).toBe(false)
    let fingerprint='one'
    const repository=createAdminBenefitClaimRepository({getSessionContext:async()=>context(fingerprint,vi.fn(async()=>{fingerprint='two';return ok({items:[row],has_more:false,next_cursor:null})}))})
    await expect(repository.listQueue({status:'submitted',limit:50})).resolves.toMatchObject({ok:false,error:{code:'stale_session'}})
  })

  it('rejects a null-error non-success transport envelope',async()=>{
    const rpc=vi.fn(async()=>({data:{items:[row],has_more:false,next_cursor:null},error:null,count:null,status:500,statusText:'Server Error'}))
    await expect(createAdminBenefitClaimRepository({getSessionContext:async()=>context('one',rpc)}).listQueue({status:'submitted',limit:50})).resolves.toMatchObject({ok:false,error:{code:'invalid_response'}})
  })

  it('loads exact detail through the strict queue-item projection and rejects extra private fields',async()=>{
    const rpc=vi.fn(async()=>ok(row))
    const repository=createAdminBenefitClaimRepository({getSessionContext:async()=>context('one',rpc)})
    await expect(repository.getDetail({claimId})).resolves.toMatchObject({ok:true,data:{claimId,status:'submitted',revision:1}})
    expect(rpc).toHaveBeenCalledWith('get_benefit_claim_moderation_detail_v1',{p_claim_id:claimId},undefined)
    rpc.mockResolvedValueOnce(ok({...row,submitter_id:actor}))
    await expect(repository.getDetail({claimId})).resolves.toMatchObject({ok:false,error:{code:'invalid_response'}})
    rpc.mockResolvedValueOnce(ok({...row,revision:'2'}))
    await expect(repository.getDetail({claimId})).resolves.toMatchObject({ok:false,error:{code:'invalid_response'}})
  })

  it('preserves all three session boundaries for exact detail',async()=>{
    let fingerprint='one'
    const rpc=vi.fn(async()=>{fingerprint='two';return ok(row)})
    const repository=createAdminBenefitClaimRepository({getSessionContext:async()=>context(fingerprint,rpc)})
    await expect(repository.getDetail({claimId})).resolves.toMatchObject({ok:false,error:{code:'stale_session'}})
  })

  it('requires official evidence and fingerprints canonical CAS payloads',()=>{
    const base={claimId,clientKey:'40000000-0000-4000-8000-000000000001',expectedStatus:'submitted' as const,expectedRevision:1,title:'건강검진',description:'연 1회',eligibilityText:null,conditionText:null,evidenceType:'official_website' as const,evidenceSourceUrl:'https://example.com/policy',evidenceObservedOn:'2026-11-20',verificationNote:'  공식 정책 확인  '}
    expect(adminBenefitClaimActionFingerprint({kind:'official_verify',payload:base})).toBe(adminBenefitClaimActionFingerprint({kind:'official_verify',payload:{...base,verificationNote:'공식 정책 확인'}}))
    expect(adminBenefitClaimActionFingerprint({kind:'official_verify',payload:{...base,evidenceSourceUrl:''}})).toBeNull()
    expect(adminBenefitClaimActionFingerprint({kind:'moderate',payload:{claimId,clientKey:base.clientKey,expectedStatus:'submitted',expectedRevision:1,action:'hide',targetClaimId:null,reason:'정책 위반',evidenceType:null,evidenceObservedOn:null,evidenceSourceUrl:null}})).not.toBeNull()
  })
})
