import { describe, expect, it, vi } from 'vitest'
import { adminBenefitSubmissionReviewFingerprint, createAdminBenefitSubmissionRepository, type AdminBenefitSubmissionSessionContext } from './adminBenefitSubmissionRepository'

const actor = '10000000-0000-4000-8000-000000000001'
const id = '20000000-0000-4000-8000-000000000001'
const publicationId = '30000000-0000-4000-8000-000000000001'
const createdAt = '2026-11-21T00:00:00Z'
const submitted = { id, company_id:'KR-CRN-1234567890123', category_id:'leave', benefit_text:'유급 휴가 20일', eligibility_text:null, condition_text:null, source_url:null, status:'submitted', admin_response:null, publication_id:null, reviewed_at:null, created_at:createdAt, updated_at:createdAt }
const reviewing = { ...submitted, status:'reviewing', admin_response:'검토 시작', reviewed_at:'2026-11-21T01:00:00Z', updated_at:'2026-11-21T01:00:00Z' }
const rejected = { ...reviewing, status:'rejected', admin_response:'반려', updated_at:'2026-11-21T02:00:00Z' }
const approved = { ...reviewing, status:'approved', admin_response:'승인', publication_id:publicationId, updated_at:'2026-11-21T02:00:00Z' }

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

  it.each([
    ['submitted', reviewing],
    ['reviewing', submitted],
    ['approved', rejected],
    ['rejected', approved],
  ] as const)('rejects a %s queue response containing a different status', async (status, row) => {
    const value=setup({items:[row],has_more:false,next_cursor:null})
    await expect(value.repository.listQueue({status,limit:2})).resolves.toMatchObject({ok:false,error:{code:'invalid_response'}})
  })

  it('rejects mixed exact-filter pages and terminal rows in the active queue', async () => {
    const mixed=setup({items:[submitted,reviewing],has_more:false,next_cursor:null})
    await expect(mixed.repository.listQueue({status:'submitted',limit:2})).resolves.toMatchObject({ok:false,error:{code:'invalid_response'}})
    const active=setup({items:[approved],has_more:false,next_cursor:null})
    await expect(active.repository.listQueue({status:'active',limit:2})).resolves.toMatchObject({ok:false,error:{code:'invalid_response'}})
  })

  it('accepts every canonical status for the all filter', async () => {
    for (const row of [submitted,reviewing,approved,rejected]) {
      const value=setup({items:[row],has_more:false,next_cursor:null})
      await expect(value.repository.listQueue({status:'all',limit:1})).resolves.toMatchObject({ok:true,data:{items:[{status:row.status}]}})
    }
  })

  it('preserves PostgreSQL microsecond ordering for queue pages', async () => {
    const later={...submitted,id:'20000000-0000-4000-8000-000000000001',created_at:'2026-11-21T00:00:00.000002Z',updated_at:'2026-11-21T00:00:00.000002Z'}
    const earlier={...submitted,id:'20000000-0000-4000-8000-000000000009',created_at:'2026-11-21T00:00:00.000001Z',updated_at:'2026-11-21T00:00:00.000001Z'}
    const value=setup({items:[later,earlier],has_more:false,next_cursor:null})
    await expect(value.repository.listQueue({status:'all',limit:2})).resolves.toMatchObject({ok:true,data:{items:[{id:later.id},{id:earlier.id}]}})
  })

  it('compares timezone-equivalent instants by submission id and preserves cursor literals',async()=>{
    const high={...submitted,id:'20000000-0000-4000-8000-000000000009',created_at:'2026-11-21T09:00:00.000001+09:00',updated_at:'2026-11-21T09:00:00.000001+09:00'}
    const low={...submitted,id:'20000000-0000-4000-8000-000000000001',created_at:'2026-11-21T00:00:00.000001Z',updated_at:'2026-11-21T00:00:00.000001Z'}
    const value=setup({items:[high,low],has_more:true,next_cursor:{created_at:low.created_at,id:low.id}})
    await expect(value.repository.listQueue({status:'all',limit:2})).resolves.toMatchObject({ok:true,data:{items:[{id:high.id},{id:low.id}]}})
    expect(value.rpc).toHaveBeenCalledWith('list_benefit_submission_queue_v1',expect.objectContaining({p_cursor_created_at:null}),undefined)
    const cursorValue=setup({items:[],has_more:false,next_cursor:null})
    await cursorValue.repository.listQueue({status:'all',limit:2,cursor:{createdAt:high.created_at,id:high.id}})
    expect(cursorValue.rpc).toHaveBeenCalledWith('list_benefit_submission_queue_v1',expect.objectContaining({p_cursor_created_at:high.created_at}),undefined)
  })

  it('canonicalizes an uppercase request cursor and rejects the same lowercase boundary row', async () => {
    const boundaryId='a0000000-0000-4000-8000-000000000001'
    const value=setup({items:[{...submitted,id:boundaryId}],has_more:false,next_cursor:null})
    await expect(value.repository.listQueue({status:'all',limit:2,cursor:{createdAt,id:boundaryId.toUpperCase()}})).resolves.toMatchObject({ok:false,error:{code:'invalid_response'}})
    expect(value.rpc).toHaveBeenCalledWith('list_benefit_submission_queue_v1',expect.objectContaining({p_cursor_created_at:createdAt,p_cursor_id:boundaryId}),undefined)
  })

  it.each([
    ['a0000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001'],
    ['2000000a-0000-4000-8000-000000000001','20000009-0000-4000-8000-000000000001'],
  ])('uses deterministic UUID hex ordering for %s above %s',async(highId,lowId)=>{
    const value=setup({items:[{...submitted,id:highId.toUpperCase()},{...submitted,id:lowId}],has_more:false,next_cursor:null})
    await expect(value.repository.listQueue({status:'all',limit:2})).resolves.toMatchObject({ok:true,data:{items:[{id:highId},{id:lowId}]}})
  })

  it('canonicalizes submission, publication, and client UUIDs for equality and RPC arguments', async () => {
    const clientKey='a0000000-0000-4000-8000-000000000001'
    const value=setup(approved)
    const input={submissionId:id.toUpperCase(),expectedStatus:'reviewing' as const,action:'approve' as const,adminResponse:'승인',clientKey:clientKey.toUpperCase(),publicTitle:'휴가 20일',publicDescription:'유급 휴가 20일',publicEligibility:null,publicCondition:null,existingPublicationId:publicationId.toUpperCase()}
    await expect(value.repository.review(input)).resolves.toMatchObject({ok:true,data:{id,publicationId}})
    expect(value.rpc).toHaveBeenCalledWith('review_benefit_submission_v1',expect.objectContaining({p_submission_id:id,p_client_key:clientKey,p_existing_publication_id:publicationId}),undefined)
    expect(adminBenefitSubmissionReviewFingerprint(input)).toBe(adminBenefitSubmissionReviewFingerprint({...input,submissionId:id,clientKey,existingPublicationId:publicationId}))
  })

  it.each(['not-a-uuid','20000000-0000-4000-8000-00000000000','20000000_0000-4000-8000-000000000001'])('continues to reject malformed cursor UUID %s',async malformedId=>{
    const value=setup({items:[],has_more:false,next_cursor:null})
    await expect(value.repository.listQueue({status:'all',limit:2,cursor:{createdAt,id:malformedId}})).resolves.toMatchObject({ok:false,error:{code:'invalid_argument'}})
    expect(value.rpc).not.toHaveBeenCalled()
  })

  it.each(['2026-02-29T00:00:00Z','2024-01-01T00:00:00+24:00','2024-01-01T00:00:00.0000001Z'])('rejects invalid PostgreSQL timestamp %s',async created_at=>{
    const value=setup({items:[{...submitted,created_at,updated_at:created_at}],has_more:false,next_cursor:null})
    await expect(value.repository.listQueue({status:'all',limit:2})).resolves.toMatchObject({ok:false,error:{code:'invalid_response'}})
  })

  it('rejects chronology reversed by one microsecond',async()=>{
    const value=setup({items:[{...reviewing,created_at:'2026-11-21T00:00:00.000002Z',reviewed_at:'2026-11-21T00:00:00.000003Z',updated_at:'2026-11-21T00:00:00.000001Z'}],has_more:false,next_cursor:null})
    await expect(value.repository.listQueue({status:'all',limit:2})).resolves.toMatchObject({ok:false,error:{code:'invalid_response'}})
  })

  it('sends exact approval projection and requires community-reviewed publication success', async () => {
    const value=setup(approved)
    await expect(value.repository.review({submissionId:id,expectedStatus:'reviewing',action:'approve',adminResponse:'승인',clientKey:'40000000-0000-4000-8000-000000000001',publicTitle:'휴가 20일',publicDescription:'유급 휴가 20일',publicEligibility:null,publicCondition:null,existingPublicationId:null})).resolves.toMatchObject({ok:true,data:{status:'approved',publicationId}})
    expect(value.rpc).toHaveBeenCalledWith('review_benefit_submission_v1',{p_submission_id:id,p_expected_status:'reviewing',p_action:'approve',p_admin_response:'승인',p_client_key:'40000000-0000-4000-8000-000000000001',p_public_title:'휴가 20일',p_public_description:'유급 휴가 20일',p_public_eligibility:null,p_public_condition:null,p_existing_publication_id:null},undefined)
  })

  it.each([
    ['start_review', 'submitted', reviewing, '검토 시작'],
    ['approve', 'reviewing', approved, '승인'],
    ['reject', 'reviewing', rejected, '반려'],
  ] as const)('binds %s success to the canonical requested admin response', async (action, expectedStatus, row, adminResponse) => {
    const value=setup(row)
    const base={submissionId:id,expectedStatus,action,adminResponse,clientKey:'40000000-0000-4000-8000-000000000001'} as const
    const input=action==='approve'?{...base,action,expectedStatus:'reviewing' as const,publicTitle:'휴가 20일',publicDescription:'유급 휴가 20일',publicEligibility:null,publicCondition:null,existingPublicationId:null}:base
    await expect(value.repository.review(input as never)).resolves.toMatchObject({ok:true,data:{adminResponse}})
    const mismatch=setup({...row,admin_response:`${adminResponse} 아님`})
    await expect(mismatch.repository.review(input as never)).resolves.toMatchObject({ok:false,error:{code:'invalid_response'}})
  })

  it('normalizes admin response with SQL btrim semantics for RPC and response binding', async () => {
    const value=setup(reviewing)
    await expect(value.repository.review({submissionId:id,expectedStatus:'submitted',action:'start_review',adminResponse:'  검토 시작  ',clientKey:'40000000-0000-4000-8000-000000000001'})).resolves.toMatchObject({ok:true,data:{adminResponse:'검토 시작'}})
    expect(value.rpc).toHaveBeenCalledWith('review_benefit_submission_v1',expect.objectContaining({p_admin_response:'검토 시작'}),undefined)
    const empty=setup({...reviewing,admin_response:''})
    await expect(empty.repository.review({submissionId:id,expectedStatus:'submitted',action:'start_review',adminResponse:'검토 시작',clientKey:'40000000-0000-4000-8000-000000000001'})).resolves.toMatchObject({ok:false,error:{code:'invalid_response'}})
  })

  it('fingerprints the canonical admin response and every server-bound action field', () => {
    const base={submissionId:id,expectedStatus:'reviewing' as const,action:'approve' as const,adminResponse:' 승인 ',clientKey:'40000000-0000-4000-8000-000000000001',publicTitle:'휴가 20일',publicDescription:'유급 휴가 20일',publicEligibility:null,publicCondition:null,existingPublicationId:null}
    expect(adminBenefitSubmissionReviewFingerprint(base)).toBe(adminBenefitSubmissionReviewFingerprint({...base,adminResponse:'승인',clientKey:'40000000-0000-4000-8000-000000000002'}))
    for (const changed of [
      {...base,submissionId:'20000000-0000-4000-8000-000000000002'},
      {...base,action:'reject' as const,publicTitle:undefined,publicDescription:undefined,publicEligibility:undefined,publicCondition:undefined,existingPublicationId:undefined},
      {...base,adminResponse:'다른 응답'},
      {...base,publicTitle:'다른 제목'},
      {...base,publicDescription:'다른 설명'},
      {...base,publicEligibility:'정규직'},
      {...base,publicCondition:'재직 중'},
      {...base,existingPublicationId:publicationId},
    ]) expect(adminBenefitSubmissionReviewFingerprint(changed as never)).not.toBe(adminBenefitSubmissionReviewFingerprint(base))
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
