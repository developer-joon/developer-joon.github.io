import { describe, expect, it, vi } from 'vitest'
import { createAdminBenefitSubmissionRepository, type AdminBenefitSubmissionSessionContext } from './adminBenefitSubmissionRepository'

const actor = '10000000-0000-4000-8000-000000000001'
const id = '20000000-0000-4000-8000-000000000001'
const publicationId = '30000000-0000-4000-8000-000000000001'
const createdAt = '2026-11-21T00:00:00Z'
const submitted = { id, company_id:'KR-CRN-1234567890123', category_id:'leave', benefit_text:'유급 휴가 20일', eligibility_text:null, condition_text:null, source_url:null, status:'submitted', admin_response:null, publication_id:null, reviewed_at:null, created_at:createdAt, updated_at:createdAt }
const reviewing = { ...submitted, status:'reviewing', admin_response:'검토 시작', reviewed_at:'2026-11-21T01:00:00Z', updated_at:'2026-11-21T01:00:00Z' }

function setup(data: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data, error:null, status:200, statusText:'OK' })
  const context = ():AdminBenefitSubmissionSessionContext => ({ actorId:actor, sessionFingerprint:'session-a', rpc })
  return { repository:createAdminBenefitSubmissionRepository({ getSessionContext:context }), rpc }
}

describe('admin benefit submission repository', () => {
  it('uses only exact admin queue RPC keys and decodes source-less rows', async () => {
    const value=setup({items:[submitted],has_more:true,next_cursor:{created_at:createdAt,id}})
    await expect(value.repository.listQueue({status:'active',limit:1})).resolves.toMatchObject({ok:true,data:{items:[{id,sourceUrl:null}],hasMore:true}})
    expect(value.rpc).toHaveBeenCalledWith('list_benefit_submission_queue_v1',{p_status:'active',p_limit:1,p_cursor_created_at:null,p_cursor_id:null},undefined)
  })

  it('supports every exact status and opaque keyset cursor but rejects bounds and extra response keys', async () => {
    const value=setup({items:[],has_more:false,next_cursor:null})
    for (const status of ['active','all','submitted','reviewing','approved','rejected'] as const) await value.repository.listQueue({status,limit:100})
    expect(value.rpc).toHaveBeenCalledTimes(6)
    await expect(value.repository.listQueue({status:'active',limit:101})).resolves.toMatchObject({ok:false,error:{code:'invalid_argument'}})
    const malformed=setup({items:[{...submitted,submitter_id:actor}],has_more:false,next_cursor:null})
    await expect(malformed.repository.listQueue({status:'all',limit:10})).resolves.toMatchObject({ok:false,error:{code:'invalid_response'}})
  })

  it('preserves PostgreSQL microsecond ordering for queue pages', async () => {
    const later={...submitted,id:'20000000-0000-4000-8000-000000000001',created_at:'2026-11-21T00:00:00.000002Z',updated_at:'2026-11-21T00:00:00.000002Z'}
    const earlier={...submitted,id:'20000000-0000-4000-8000-000000000009',created_at:'2026-11-21T00:00:00.000001Z',updated_at:'2026-11-21T00:00:00.000001Z'}
    const value=setup({items:[later,earlier],has_more:false,next_cursor:null})
    await expect(value.repository.listQueue({status:'all',limit:2})).resolves.toMatchObject({ok:true,data:{items:[{id:later.id},{id:earlier.id}]}})
  })

  it('sends exact approval projection and requires community-reviewed publication success', async () => {
    const approved={...reviewing,status:'approved',admin_response:'승인',publication_id:publicationId,updated_at:'2026-11-21T02:00:00Z'}
    const value=setup(approved)
    await expect(value.repository.review({submissionId:id,expectedStatus:'reviewing',action:'approve',adminResponse:'승인',clientKey:'40000000-0000-4000-8000-000000000001',publicTitle:'휴가 20일',publicDescription:'유급 휴가 20일',publicEligibility:null,publicCondition:null,existingPublicationId:null})).resolves.toMatchObject({ok:true,data:{status:'approved',publicationId}})
    expect(value.rpc).toHaveBeenCalledWith('review_benefit_submission_v1',{p_submission_id:id,p_expected_status:'reviewing',p_action:'approve',p_admin_response:'승인',p_client_key:'40000000-0000-4000-8000-000000000001',p_public_title:'휴가 20일',p_public_description:'유급 휴가 20일',p_public_eligibility:null,p_public_condition:null,p_existing_publication_id:null},undefined)
  })

  it('rejects invalid transitions/projection bounds and maps CAS/idempotency errors', async () => {
    const value=setup(reviewing)
    await expect(value.repository.review({submissionId:id,expectedStatus:'submitted',action:'approve',adminResponse:'승인',clientKey:'40000000-0000-4000-8000-000000000001',publicTitle:'제목',publicDescription:'설명',publicEligibility:null,publicCondition:null,existingPublicationId:null} as never)).resolves.toMatchObject({ok:false,error:{code:'invalid_argument'}})
    expect(value.rpc).not.toHaveBeenCalled()
    const conflict=setup(null); conflict.rpc.mockResolvedValue({data:null,error:{code:'40001',message:'state changed'},status:409,statusText:'Conflict'})
    await expect(conflict.repository.review({submissionId:id,expectedStatus:'submitted',action:'start_review',adminResponse:'검토',clientKey:'40000000-0000-4000-8000-000000000001'})).resolves.toMatchObject({ok:false,error:{code:'conflict'}})
    const mismatch=setup(null); mismatch.rpc.mockResolvedValue({data:null,error:{code:'22023',message:'client key reused with different payload'},status:400,statusText:'Bad Request'})
    await expect(mismatch.repository.review({submissionId:id,expectedStatus:'submitted',action:'start_review',adminResponse:'검토',clientKey:'40000000-0000-4000-8000-000000000001'})).resolves.toMatchObject({ok:false,error:{code:'idempotency_mismatch'}})
  })

  it('rejects A-B-A preflight and aborts without RPC', async () => {
    const rpc=vi.fn(); const sequence=['a','b','a']
    const repository=createAdminBenefitSubmissionRepository({getSessionContext:()=>({actorId:actor,sessionFingerprint:sequence.shift() ?? 'a',rpc})})
    await expect(repository.listQueue({status:'active',limit:10})).resolves.toMatchObject({ok:false,error:{code:'stale_response'}})
    expect(rpc).not.toHaveBeenCalled()
    const controller=new AbortController();controller.abort()
    await expect(repository.listQueue({status:'active',limit:10},controller.signal)).resolves.toMatchObject({ok:false,error:{code:'aborted'}})
  })
})
