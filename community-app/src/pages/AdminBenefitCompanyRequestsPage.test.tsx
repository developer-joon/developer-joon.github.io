import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../auth/AuthProvider'
import type { CommunityRepository } from '../data/communityRepository'
import type { AdminBenefitCompanyRequestRepository } from '../data/adminBenefitCompanyRequestRepository'
import { AdminBenefitCompanyRequestsPage } from './AdminBenefitCompanyRequestsPage'

const actorA='10000000-0000-4000-8000-000000000001',actorB='10000000-0000-4000-8000-000000000002',requestId='20000000-0000-4000-8000-000000000001',created='2026-11-23T01:00:00.000000Z'
const item={requestId,proposedName:'안전 기업',region:'서울',industry:'소프트웨어',website:'https://example.com',verificationStatus:'pending' as const,status:'pending_review' as const,revision:1,resolvedCompanyId:null,createdAt:created,updatedAt:created,verificationMethod:'manual' as const,externalVerifiedAt:null}
const sessionA={access_token:'a'} as never,sessionB={access_token:'b'} as never
function auth(actor=actorA,session=sessionA,generation=1):AuthContextValue{return{generation,loading:false,pending:false,error:null,user:{id:actor} as never,session,signIn:vi.fn(),signOut:vi.fn(),invalidateStaleSession:vi.fn()}}
function authorization(value=true){return{isAdmin:vi.fn().mockResolvedValue({ok:true,data:value})} as unknown as CommunityRepository}
function repository(overrides:Partial<AdminBenefitCompanyRequestRepository>={}):AdminBenefitCompanyRequestRepository{return{listQueue:vi.fn().mockResolvedValue({ok:true,data:{items:[item],hasMore:false,nextCursor:null}}),review:vi.fn().mockResolvedValue({ok:true,data:{...item,status:'rejected',verificationStatus:'rejected',revision:2}}),...overrides}}
function page(repo=repository(),value=auth()){return render(<AuthContext.Provider value={value}><AdminBenefitCompanyRequestsPage authorizationRepository={authorization()} repository={repo} currentPath="/community/admin/benefit-company-requests/" /></AuthContext.Provider>)}

describe('AdminBenefitCompanyRequestsPage',()=>{
  it('gates the exact pending queue and never renders private verification inputs',async()=>{
    const repo=repository();page(repo)
    expect(await screen.findByRole('heading',{name:'기업 추가 요청 검토 데스크'})).toBeInTheDocument()
    await waitFor(()=>expect(repo.listQueue).toHaveBeenCalledWith({status:'pending_review',limit:50},expect.any(AbortSignal)))
    expect(screen.queryByText(/123-45|대표자|개업일/)).not.toBeInTheDocument()
  })

  it('synchronously gates stale A data across A→B→A and ignores the late response',async()=>{
    let finish!:(value:never)=>void
    const listQueue=vi.fn().mockReturnValueOnce(new Promise(resolve=>{finish=resolve})).mockResolvedValue({ok:true,data:{items:[],hasMore:false,nextCursor:null}})
    const repo=repository({listQueue}),view=page(repo,auth(actorA,sessionA))
    await waitFor(()=>expect(listQueue).toHaveBeenCalledTimes(1))
    view.rerender(<AuthContext.Provider value={auth(actorB,sessionB)}><AdminBenefitCompanyRequestsPage authorizationRepository={authorization()} repository={repo} currentPath="/community/admin/benefit-company-requests/" /></AuthContext.Provider>)
    view.rerender(<AuthContext.Provider value={auth(actorA,sessionA)}><AdminBenefitCompanyRequestsPage authorizationRepository={authorization()} repository={repo} currentPath="/community/admin/benefit-company-requests/" /></AuthContext.Provider>)
    expect(screen.queryByText('안전 기업')).not.toBeInTheDocument()
    await act(async()=>finish({ok:true,data:{items:[item],hasMore:false,nextCursor:null}} as never))
    expect(screen.queryByText('안전 기업')).not.toBeInTheDocument()
  })

  it('single-flights duplicate review, reuses unchanged retry key, and refreshes a CAS conflict',async()=>{
    let finish!:(value:never)=>void
    const review=vi.fn().mockReturnValueOnce(new Promise(resolve=>{finish=resolve})).mockResolvedValueOnce({ok:false,error:{code:'network',message:'잠시 후 다시 시도해 주세요.'}}).mockResolvedValueOnce({ok:false,error:{code:'conflict',message:'상태가 변경되었습니다.'}})
    const listQueue=vi.fn().mockResolvedValue({ok:true,data:{items:[item],hasMore:false,nextCursor:null}}),repo=repository({review,listQueue});page(repo)
    fireEvent.click(await screen.findByRole('button',{name:/안전 기업 선택/}));fireEvent.change(screen.getByLabelText('검토 사유'),{target:{value:'중복 요청'}})
    const reject=screen.getByRole('button',{name:'요청 반려'});fireEvent.click(reject);fireEvent.click(reject)
    expect(review).toHaveBeenCalledTimes(1);await act(async()=>finish({ok:false,error:{code:'network',message:'잠시 후 다시 시도해 주세요.'}} as never))
    fireEvent.click(reject);await waitFor(()=>expect(review).toHaveBeenCalledTimes(2));expect(review.mock.calls[1][0].clientKey).toBe(review.mock.calls[0][0].clientKey)
    fireEvent.click(reject);await waitFor(()=>expect(listQueue).toHaveBeenCalledTimes(2))
  })

  it('uses the exact NTS time and synchronously gates a generation change',async()=>{
    const external='2026-11-22T02:00:00.000000Z',updated='2026-11-23T03:00:00.000000Z'
    const nts={...item,verificationMethod:'nts_full' as const,verificationStatus:'matched' as const,status:'approved' as const,revision:2,resolvedCompanyId:'KR-BIZ-1234567890',externalVerifiedAt:external,updatedAt:updated}
    const repo=repository({listQueue:vi.fn().mockResolvedValue({ok:true,data:{items:[nts],hasMore:false,nextCursor:null}})}),view=page(repo,auth(actorA,sessionA,1))
    fireEvent.click(await screen.findByRole('button',{name:/안전 기업 선택/}));expect(screen.getByText(new Date(external).toLocaleString('ko-KR'),{exact:false})).toBeInTheDocument();expect(screen.queryByText(new Date(updated).toLocaleString('ko-KR'),{exact:false})).not.toBeInTheDocument()
    view.rerender(<AuthContext.Provider value={auth(actorA,sessionA,2)}><AdminBenefitCompanyRequestsPage authorizationRepository={authorization()} repository={repo} currentPath="/community/admin/benefit-company-requests/" /></AuthContext.Provider>);expect(screen.queryByText('안전 기업')).not.toBeInTheDocument()
  })
})
