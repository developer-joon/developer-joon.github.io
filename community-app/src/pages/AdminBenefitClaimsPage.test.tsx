import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../auth/AuthProvider'
import type { CommunityRepository } from '../data/communityRepository'
import type { AdminBenefitClaimRepository } from '../data/adminBenefitClaimRepository'
import { AdminBenefitClaimsPage } from './AdminBenefitClaimsPage'

const actor='10000000-0000-4000-8000-000000000001',claimId='30000000-0000-4000-8000-000000000001',created='2026-11-23T01:00:00.000000Z'
const item={claimId,companyId:'KR-BIZ-1234567890',companyName:'안전 기업',categoryId:'health' as const,title:'건강검진',status:'submitted' as const,revision:1,confirmCount:3,disputeCount:0,communityPublicationActive:false,officialPublicationActive:false,createdAt:created,updatedAt:created}
function auth():AuthContextValue{return{loading:false,pending:false,error:null,user:{id:actor} as never,session:{access_token:'a'} as never,signIn:vi.fn(),signOut:vi.fn(),invalidateStaleSession:vi.fn()}}
function authorization(){return{isAdmin:vi.fn().mockResolvedValue({ok:true,data:true})} as unknown as CommunityRepository}
function repository(overrides:Partial<AdminBenefitClaimRepository>={}):AdminBenefitClaimRepository{return{listQueue:vi.fn().mockResolvedValue({ok:true,data:{items:[item],hasMore:false,nextCursor:null}}),getDetail:vi.fn().mockResolvedValue({ok:true,data:item}),listAudit:vi.fn().mockResolvedValue({ok:true,data:{items:[],hasMore:false,nextCursor:null}}),moderateClaim:vi.fn().mockResolvedValue({ok:false,error:{code:'unknown',message:'실패'}}),officiallyVerifyClaim:vi.fn().mockResolvedValue({ok:true,data:{claimId,status:'submitted',revision:2,officialPublicationId:'50000000-0000-4000-8000-000000000001',outcome:'verify'}}),...overrides}}
function page(repo=repository()){return render(<AuthContext.Provider value={auth()}><AdminBenefitClaimsPage authorizationRepository={authorization()} repository={repo} currentPath="/community/admin/benefit-claims/" /></AuthContext.Provider>)}

describe('AdminBenefitClaimsPage',()=>{
  it('uses exact claim filters, treats counts as context, and loads bounded audit',async()=>{
    const repo=repository();page(repo)
    expect(await screen.findByRole('heading',{name:'복지 claim 검토 데스크'})).toBeInTheDocument();expect(repo.listQueue).toHaveBeenCalledWith({status:'submitted',limit:50},expect.any(AbortSignal))
    fireEvent.click(await screen.findByRole('button',{name:/건강검진 선택/}));await waitFor(()=>expect(repo.listAudit).toHaveBeenCalledWith({claimId,limit:50},expect.any(AbortSignal)))
    expect(screen.getAllByText(/확인 3 · 이의 0/)).toHaveLength(2);expect(screen.getByText(/확인 수는 공식 확인의 근거가 아닙니다/)).toBeInTheDocument()
    const buttons=screen.getByRole('group',{name:'claim 상태 필터'}).querySelectorAll('button');expect([...buttons].map(button=>button.textContent)).toEqual(['제출','커뮤니티 확인','이의 있음','숨김','철회'])
  })

  it('requires every official evidence field before invoking verification',async()=>{
    const officiallyVerifyClaim=vi.fn().mockResolvedValue({ok:true,data:{claimId,status:'submitted',revision:2,officialPublicationId:'50000000-0000-4000-8000-000000000001',outcome:'verify'}}),repo=repository({officiallyVerifyClaim});page(repo);fireEvent.click(await screen.findByRole('button',{name:/건강검진 선택/}))
    fireEvent.click(screen.getByRole('button',{name:'공식 근거로 확인'}));expect(officiallyVerifyClaim).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('공식 근거')
    fireEvent.change(screen.getByLabelText('공식 제목'),{target:{value:'건강검진'}});fireEvent.change(screen.getByLabelText('공식 설명'),{target:{value:'연 1회 검진'}});fireEvent.change(screen.getByLabelText('근거 URL'),{target:{value:'https://example.com/policy'}});fireEvent.change(screen.getByLabelText('근거 확인일'),{target:{value:'2026-11-20'}});fireEvent.change(screen.getByLabelText('검증 메모'),{target:{value:'공식 정책 페이지 확인'}})
    fireEvent.click(screen.getByRole('button',{name:'공식 근거로 확인'}));await waitFor(()=>expect(officiallyVerifyClaim).toHaveBeenCalledTimes(1))
  })

  it('single-flights unchanged moderation and converges out-of-filter detail plus audit on CAS conflict',async()=>{
    let finish!:(value:never)=>void
    const hidden={...item,status:'hidden' as const,revision:2,updatedAt:'2026-11-23T02:00:00.000000Z'},event={eventId:'60000000-0000-4000-8000-000000000001',eventKind:'claim_event' as const,action:'hidden',fromStatus:'submitted' as const,toStatus:'hidden' as const,evidenceType:null,evidenceObservedOn:null,relatedClaimId:null,publicationId:null,createdAt:'2026-11-23T02:00:00.000000Z'}
    const moderateClaim=vi.fn().mockReturnValue(new Promise(resolve=>{finish=resolve})),listQueue=vi.fn().mockResolvedValueOnce({ok:true,data:{items:[item],hasMore:false,nextCursor:null}}).mockResolvedValueOnce({ok:true,data:{items:[],hasMore:false,nextCursor:null}}),getDetail=vi.fn().mockResolvedValue({ok:true,data:hidden}),listAudit=vi.fn().mockResolvedValueOnce({ok:true,data:{items:[],hasMore:false,nextCursor:null}}).mockResolvedValueOnce({ok:true,data:{items:[event],hasMore:false,nextCursor:null}})
    const repo=repository({moderateClaim,listQueue,getDetail,listAudit});page(repo);fireEvent.click(await screen.findByRole('button',{name:/건강검진 선택/}));fireEvent.change(screen.getByLabelText('조치 사유'),{target:{value:'정책 위반'}})
    const hide=screen.getByRole('button',{name:'claim 숨김'});fireEvent.click(hide);fireEvent.click(hide);expect(moderateClaim).toHaveBeenCalledTimes(1)
    await act(async()=>finish({ok:false,error:{code:'conflict',message:'상태가 변경되었습니다.'}} as never));await waitFor(()=>expect(listQueue).toHaveBeenCalledTimes(2));await waitFor(()=>expect(getDetail).toHaveBeenCalledWith({claimId},expect.any(AbortSignal)));await waitFor(()=>expect(listAudit).toHaveBeenCalledTimes(2))
    expect(screen.getByText(/hidden · rev 2/)).toBeInTheDocument();expect(screen.getByText(/현재 필터 밖/)).toBeInTheDocument();expect(screen.getByText(/hidden/,{selector:'li *'})).toBeInTheDocument();expect(screen.getByRole('group',{name:'claim 상태 필터'}).querySelector('button[aria-pressed="true"]')).toHaveTextContent('제출');expect(moderateClaim).toHaveBeenCalledTimes(1)
  })

  it.each(['moderate','official'] as const)('reuses the unchanged %s key after network failure, rotates it after payload change, and single-flights',async kind=>{
    let finish!:(value:never)=>void
    const mutation=vi.fn().mockReturnValueOnce(new Promise(resolve=>{finish=resolve})).mockResolvedValue({ok:false,error:{code:'network',message:'실패'}})
    const repo=kind==='moderate'?repository({moderateClaim:mutation}):repository({officiallyVerifyClaim:mutation});page(repo);fireEvent.click(await screen.findByRole('button',{name:/건강검진 선택/}))
    const button=kind==='moderate'?screen.getByRole('button',{name:'claim 숨김'}):screen.getByRole('button',{name:'공식 근거로 확인'})
    if(kind==='moderate')fireEvent.change(screen.getByLabelText('조치 사유'),{target:{value:'정책 위반'}})
    else{fireEvent.change(screen.getByLabelText('공식 제목'),{target:{value:'건강검진'}});fireEvent.change(screen.getByLabelText('공식 설명'),{target:{value:'연 1회'}});fireEvent.change(screen.getByLabelText('근거 URL'),{target:{value:'https://example.com/policy'}});fireEvent.change(screen.getByLabelText('근거 확인일'),{target:{value:'2026-11-20'}});fireEvent.change(screen.getByLabelText('검증 메모'),{target:{value:'공식 확인'}})}
    fireEvent.click(button);fireEvent.click(button);expect(mutation).toHaveBeenCalledTimes(1);const first=mutation.mock.calls[0][0].clientKey;await act(async()=>finish({ok:false,error:{code:'network',message:'실패'}} as never));fireEvent.click(button);await waitFor(()=>expect(mutation).toHaveBeenCalledTimes(2));expect(mutation.mock.calls[1][0].clientKey).toBe(first)
    fireEvent.change(kind==='moderate'?screen.getByLabelText('조치 사유'):screen.getByLabelText('공식 설명'),{target:{value:'변경된 payload'}});fireEvent.click(button);await waitFor(()=>expect(mutation).toHaveBeenCalledTimes(3));expect(mutation.mock.calls[2][0].clientKey).not.toBe(first)
  })
})
