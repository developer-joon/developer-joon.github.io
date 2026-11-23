import { describe, expect, it, vi } from 'vitest'
import { createBenefitClaimRepository } from './benefitClaimRepository'
import { createBenefitCompanyRequestRepository } from './benefitCompanyRequestRepository'

const id = 'a1000000-0000-4000-8000-000000000001'
const key = 'b1000000-0000-4000-8000-000000000001'
const claimCalls = [
  ['createClaim', { clientKey:key, companyId:'KR-BIZ-1234567890', categoryId:'health', title:'제목', description:'내용', eligibilityText:null, conditionText:null, observedOn:'2020-01-01', sourceUrl:null }],
  ['withdrawClaim', { claimId:id, clientKey:key, expectedStatus:'submitted', expectedRevision:1 }],
  ['listMyClaims', { limit:1 }], ['setReaction', { claimId:id, clientKey:key, reaction:null }],
  ['listModerationQueue', { status:'active', limit:1 }], ['listAudit', { claimId:id, limit:1 }],
  ['moderateClaim', { claimId:id, clientKey:key, expectedStatus:'submitted', expectedRevision:1, action:'hide', targetClaimId:null, reason:'사유', evidenceType:null, evidenceObservedOn:null, evidenceSourceUrl:null }],
  ['officiallyVerifyClaim', { claimId:id, clientKey:key, expectedStatus:'submitted', expectedRevision:1, title:'제목', description:'내용', eligibilityText:null, conditionText:null, evidenceType:'official_website', evidenceSourceUrl:'https://example.com', evidenceObservedOn:'2020-01-01', verificationNote:'확인' }],
] as const
const companyCalls = [
  ['createManual', {clientKey:key, proposedName:'기업', region:null, industry:null, website:null}],
  ['listMine',{limit:1}], ['listQueue',{status:'all',limit:1}],
  ['review',{requestId:id, expectedStatus:'pending_review', expectedRevision:1, action:'reject', reason:'사유', destinationCompanyId:null}],
] as const

describe('authenticated response boundaries', () => {
  it.each(claimCalls)('%s discards response when an envelope getter changes session', async (method, input) => {
    let fingerprint = 'a'
    const rpc = vi.fn(async () => ({ get data() { fingerprint = 'b'; return {} }, error:null, count:null, status:200, statusText:'OK' }))
    const repo = createBenefitClaimRepository({getSessionContext:async () => ({actorId:id,sessionFingerprint:fingerprint,rpc})})
    const call = repo[method] as (value: never) => Promise<unknown>
    await expect(call(input as never)).resolves.toMatchObject({ok:false,error:{code:'stale_session'}})
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it.each(companyCalls)('%s discards response when an envelope getter changes session', async (method, input) => {
    let fingerprint = 'a'
    const rpc = vi.fn(async () => ({ get data() { fingerprint = 'b'; return {} }, error:null, count:null, status:200, statusText:'OK' }))
    const repo = createBenefitCompanyRequestRepository({getSessionContext:async () => ({actorId:id,sessionFingerprint:fingerprint,rpc,invokeFunction:vi.fn()})})
    const call = repo[method] as (value: never) => Promise<unknown>
    await expect(call(input as never)).resolves.toMatchObject({ok:false,error:{code:'stale_session'}})
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it.each(claimCalls)('%s prefers an account change observed after RPC rejection', async (method,input)=>{
    let actorId=id
    const rpc=vi.fn(async()=>{actorId='a1000000-0000-4000-8000-000000000002';throw new TypeError('Failed to fetch')})
    const repo=createBenefitClaimRepository({getSessionContext:async()=>({actorId,sessionFingerprint:`session-${actorId}`,rpc})})
    const call=repo[method] as (value:never)=>Promise<unknown>
    await expect(call(input as never)).resolves.toMatchObject({ok:false,error:{code:'stale_session'}})
  })
  it.each(companyCalls)('%s prefers logout observed after RPC rejection',async(method,input)=>{
    let loggedIn=true
    const rpc=vi.fn(async()=>{loggedIn=false;throw new TypeError('Failed to fetch')})
    const repo=createBenefitCompanyRequestRepository({getSessionContext:async()=>loggedIn?{actorId:id,sessionFingerprint:'session-a',rpc,invokeFunction:vi.fn()}:null})
    const call=repo[method] as (value:never)=>Promise<unknown>
    await expect(call(input as never)).resolves.toMatchObject({ok:false,error:{code:'stale_session'}})
  })
  it('prefers a token change observed after Edge rejection',async()=>{
    let fingerprint='session-a'
    const invokeFunction=vi.fn(async()=>{fingerprint='session-b';throw new TypeError('Failed to fetch')})
    const repo=createBenefitCompanyRequestRepository({getSessionContext:async()=>({actorId:id,sessionFingerprint:fingerprint,rpc:vi.fn(),invokeFunction})})
    await expect(repo.verifyWithNts({clientKey:key,businessName:'테스트 기업',businessNumber:'123-45-67890',openingDate:'20260131',representativeName:'홍길동',region:null,industry:null,website:null})).resolves.toMatchObject({ok:false,error:{code:'stale_session'}})
  })
})
