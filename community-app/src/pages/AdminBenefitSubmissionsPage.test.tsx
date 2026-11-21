import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../auth/AuthProvider'
import type { CommunityRepository } from '../data/communityRepository'
import type { AdminBenefitSubmissionRepository } from '../data/adminBenefitSubmissionRepository'
import type { AdminBenefitSubmissionItem } from '../types/adminBenefitSubmissions'
import { AdminBenefitSubmissionsPage } from './AdminBenefitSubmissionsPage'

const actorA='10000000-0000-4000-8000-000000000001'
const actorB='10000000-0000-4000-8000-000000000002'
const submitted:AdminBenefitSubmissionItem={id:'20000000-0000-4000-8000-000000000001',companyId:'KR-CRN-1234567890123',categoryId:'leave',benefitText:'유급 휴가 20일',eligibilityText:'정규직',conditionText:null,sourceUrl:null,status:'submitted',adminResponse:null,publicationId:null,reviewedAt:null,createdAt:'2026-11-21T00:00:00Z',updatedAt:'2026-11-21T00:00:00Z'}
const reviewing:AdminBenefitSubmissionItem={...submitted,status:'reviewing',adminResponse:'검토 시작',reviewedAt:'2026-11-21T01:00:00Z',updatedAt:'2026-11-21T01:00:00Z'}
const signedOut={loading:false,pending:false,session:null,user:null,error:null,signIn:vi.fn(),signOut:vi.fn(),invalidateStaleSession:vi.fn(()=>false)} satisfies AuthContextValue
const auth=(id=actorA,session={} as never)=>({...signedOut,session,user:{id} as never})
function authorization(result=true){return {isAdmin:vi.fn().mockResolvedValue({ok:true,data:result})} as unknown as CommunityRepository}
function repository(overrides:Partial<AdminBenefitSubmissionRepository>={}):AdminBenefitSubmissionRepository{return {listQueue:vi.fn().mockResolvedValue({ok:true,data:{items:[submitted],hasMore:false,nextCursor:null}}),review:vi.fn(),...overrides}}
function page(repo=repository(),gate=authorization(),value:AuthContextValue=auth()){return render(<AuthContext.Provider value={value}><AdminBenefitSubmissionsPage authorizationRepository={gate} repository={repo} currentPath="/community/admin/benefit-submissions/?status=active#queue" /></AuthContext.Provider>)}

describe('AdminBenefitSubmissionsPage',()=>{
  it('preserves canonical login return path and distinctly denies authenticated non-admins',async()=>{
    const signIn=vi.fn();const view=page(repository(),authorization(),{...signedOut,signIn})
    fireEvent.click(screen.getByRole('button',{name:'Google로 관리자 로그인'}))
    expect(signIn).toHaveBeenCalledWith('google','/community/admin/benefit-submissions/')
    view.unmount();page(repository(),authorization(false),auth())
    expect(await screen.findByRole('heading',{name:'접근 권한이 없습니다'})).toBeInTheDocument()
  })

  it('loads active queue, filters server-side, paginates with dedupe, and shows source absence honestly',async()=>{
    const second={...submitted,id:'20000000-0000-4000-8000-000000000002',createdAt:'2026-11-20T00:00:00Z'}
    const listQueue=vi.fn().mockResolvedValueOnce({ok:true,data:{items:[submitted],hasMore:true,nextCursor:{createdAt:submitted.createdAt,id:submitted.id}}}).mockResolvedValueOnce({ok:true,data:{items:[submitted,second],hasMore:false,nextCursor:null}}).mockResolvedValueOnce({ok:true,data:{items:[],hasMore:false,nextCursor:null}})
    page(repository({listQueue}))
    fireEvent.click(await screen.findByRole('button',{name:/복지 제보.*선택/}))
    expect(screen.getByText('출처 URL 없음 — 검수 가능')).toBeInTheDocument()
    const more=screen.getByRole('button',{name:'제보 더 불러오기'});fireEvent.click(more);fireEvent.click(more)
    await waitFor(()=>expect(screen.getAllByRole('button',{name:/복지 제보.*선택/})).toHaveLength(2))
    fireEvent.click(screen.getByRole('button',{name:'승인'}))
    await waitFor(()=>expect(listQueue).toHaveBeenLastCalledWith({status:'approved',limit:50},expect.any(AbortSignal)))
  })

  it('starts review once, then approves with one stable retry key and community publication copy',async()=>{
    let finish!: (value:unknown)=>void
    const review=vi.fn().mockReturnValueOnce(new Promise(resolve=>{finish=resolve})).mockResolvedValueOnce({ok:false,error:{code:'network',message:'네트워크 요청에 실패했습니다.'}}).mockResolvedValueOnce({ok:true,data:{...reviewing,status:'approved',adminResponse:'승인합니다',publicationId:'30000000-0000-4000-8000-000000000001',updatedAt:'2026-11-21T02:00:00Z'}})
    const repo=repository({review});page(repo)
    fireEvent.click(await screen.findByRole('button',{name:/복지 제보.*선택/}))
    fireEvent.change(screen.getByLabelText('관리자 응답'),{target:{value:'검토 시작'}})
    const start=screen.getByRole('button',{name:'검토 시작'});fireEvent.click(start);fireEvent.click(start)
    expect(review).toHaveBeenCalledTimes(1);finish({ok:true,data:reviewing})
    expect(await screen.findByRole('button',{name:'제보 승인'})).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('공개 제목'),{target:{value:'휴가 20일'}})
    fireEvent.change(screen.getByLabelText('공개 설명'),{target:{value:'유급 휴가 20일'}})
    fireEvent.change(screen.getByLabelText('관리자 응답'),{target:{value:'승인합니다'}})
    fireEvent.click(screen.getByRole('button',{name:'제보 승인'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('네트워크')
    const firstKey=(review.mock.calls[1][0] as {clientKey:string}).clientKey
    fireEvent.click(screen.getByRole('button',{name:'제보 승인'}))
    expect((review.mock.calls[2][0] as {clientKey:string}).clientKey).toBe(firstKey)
    const success=await screen.findByText(/공개 신뢰 계층 사용자 제보/)
    expect(success).toHaveAttribute('role','status')
    expect(success).toHaveTextContent('게시물이 생성')
    expect(JSON.stringify(review.mock.calls[2][0])).not.toContain('official_verified')
  })

  it('rejects, refreshes on CAS conflict, and preserves safe form input',async()=>{
    const listQueue=vi.fn().mockResolvedValue({ok:true,data:{items:[reviewing],hasMore:false,nextCursor:null}})
    const review=vi.fn().mockResolvedValue({ok:false,error:{code:'conflict',message:'제보 상태가 변경되었습니다. 대기열을 새로고침한 뒤 다시 검토해 주세요.'}})
    page(repository({listQueue,review}));fireEvent.click(await screen.findByRole('button',{name:/복지 제보.*선택/}))
    fireEvent.change(screen.getByLabelText('관리자 응답'),{target:{value:'근거 부족'}});fireEvent.click(screen.getByRole('button',{name:'제보 반려'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('새로고침')
    await waitFor(()=>expect(listQueue).toHaveBeenCalledTimes(2))
  })

  it('render-gates A data immediately across A-B-A and ignores stale completions',async()=>{
    let finishA!:(value:unknown)=>void
    const listQueue=vi.fn().mockReturnValueOnce(new Promise(resolve=>{finishA=resolve})).mockResolvedValue({ok:true,data:{items:[],hasMore:false,nextCursor:null}})
    const repo=repository({listQueue}),gate=authorization();const view=page(repo,gate,auth(actorA))
    await waitFor(()=>expect(listQueue).toHaveBeenCalledTimes(1))
    view.rerender(<AuthContext.Provider value={auth(actorB)}><AdminBenefitSubmissionsPage authorizationRepository={gate} repository={repo} currentPath="/community/admin/benefit-submissions/" /></AuthContext.Provider>)
    expect(screen.queryByText('유급 휴가 20일')).not.toBeInTheDocument()
    view.rerender(<AuthContext.Provider value={auth(actorA)}><AdminBenefitSubmissionsPage authorizationRepository={gate} repository={repo} currentPath="/community/admin/benefit-submissions/" /></AuthContext.Provider>)
    await act(async()=>finishA({ok:true,data:{items:[submitted],hasMore:false,nextCursor:null}}))
    expect(screen.queryByText('유급 휴가 20일')).not.toBeInTheDocument()
  })

  it('rechecks a same-actor replacement session and hides loaded private data when the role was revoked',async()=>{
    const firstSession={access_token:'first'} as never,secondSession={access_token:'second'} as never
    const gate={isAdmin:vi.fn().mockResolvedValueOnce({ok:true,data:true}).mockResolvedValueOnce({ok:true,data:false})} as unknown as CommunityRepository
    const repo=repository();const view=page(repo,gate,auth(actorA,firstSession))
    expect(await screen.findByText('유급 휴가 20일')).toBeInTheDocument()
    view.rerender(<AuthContext.Provider value={auth(actorA,secondSession)}><AdminBenefitSubmissionsPage authorizationRepository={gate} repository={repo} currentPath="/community/admin/benefit-submissions/?status=active#queue" /></AuthContext.Provider>)
    expect(await screen.findByRole('heading',{name:'접근 권한이 없습니다'})).toBeInTheDocument()
    expect(screen.queryByText('유급 휴가 20일')).not.toBeInTheDocument()
    expect(gate.isAdmin).toHaveBeenCalledTimes(2)
  })

  it('fails closed with distinct signed-out guidance when a loaded queue reports auth_required',async()=>{
    const session={access_token:'expired'} as never,invalidateStaleSession=vi.fn(()=>true)
    const listQueue=vi.fn().mockResolvedValueOnce({ok:true,data:{items:[submitted],hasMore:false,nextCursor:null}}).mockResolvedValueOnce({ok:false,error:{code:'auth_required',message:'로그인이 만료되었습니다.'}})
    page(repository({listQueue}),authorization(),{...auth(actorA,session),invalidateStaleSession})
    expect(await screen.findByText('유급 휴가 20일')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'승인'}))
    expect(await screen.findByRole('heading',{name:'관리자 로그인이 필요합니다'})).toBeInTheDocument()
    expect(screen.queryByText('유급 휴가 20일')).not.toBeInTheDocument()
    expect(invalidateStaleSession).toHaveBeenCalledWith(session)
  })

  it('fails closed on review revocation and ignores its late pre-revocation success',async()=>{
    let finishReview!:(value:unknown)=>void
    const review=vi.fn().mockReturnValue(new Promise(resolve=>{finishReview=resolve}))
    const listQueue=vi.fn().mockResolvedValueOnce({ok:true,data:{items:[reviewing],hasMore:false,nextCursor:null}}).mockResolvedValueOnce({ok:false,error:{code:'forbidden',message:'관리자 검토 권한이 없습니다.'}})
    page(repository({listQueue,review}))
    fireEvent.click(await screen.findByRole('button',{name:/복지 제보.*선택/}))
    fireEvent.change(screen.getByLabelText('관리자 응답'),{target:{value:'반려'}})
    fireEvent.click(screen.getByRole('button',{name:'제보 반려'}))
    fireEvent.click(screen.getByRole('button',{name:'승인'}))
    expect(await screen.findByRole('heading',{name:'접근 권한이 없습니다'})).toBeInTheDocument()
    await act(async()=>finishReview({ok:true,data:{...reviewing,status:'rejected',updatedAt:'2026-11-21T02:00:00Z'}}))
    expect(screen.queryByText('유급 휴가 20일')).not.toBeInTheDocument()
    expect(screen.queryByText('복지 제보를 반려했습니다.')).not.toBeInTheDocument()
  })

  it('fails closed when the review repository itself reports forbidden',async()=>{
    const review=vi.fn().mockResolvedValue({ok:false,error:{code:'forbidden',message:'관리자 검토 권한이 없습니다.'}})
    const listQueue=vi.fn().mockResolvedValue({ok:true,data:{items:[reviewing],hasMore:false,nextCursor:null}})
    page(repository({listQueue,review}))
    fireEvent.click(await screen.findByRole('button',{name:/복지 제보.*선택/}))
    fireEvent.change(screen.getByLabelText('관리자 응답'),{target:{value:'반려'}})
    fireEvent.click(screen.getByRole('button',{name:'제보 반려'}))
    expect(await screen.findByRole('heading',{name:'접근 권한이 없습니다'})).toBeInTheDocument()
    expect(screen.queryByText('유급 휴가 20일')).not.toBeInTheDocument()
  })

  it('retires delayed A review on selection change without mutating A or blocking B',async()=>{
    const second={...reviewing,id:'20000000-0000-4000-8000-000000000002',companyId:'KR-BIZ-1234567890',benefitText:'재택 근무 지원'}
    let finishA!:(value:unknown)=>void,finishB!:(value:unknown)=>void
    const review=vi.fn().mockReturnValueOnce(new Promise(resolve=>{finishA=resolve})).mockReturnValueOnce(new Promise(resolve=>{finishB=resolve}))
    const listQueue=vi.fn().mockResolvedValue({ok:true,data:{items:[reviewing,second],hasMore:false,nextCursor:null}})
    page(repository({listQueue,review}))
    const rows=await screen.findAllByRole('button',{name:/복지 제보.*선택/})
    fireEvent.click(rows[0]);fireEvent.change(screen.getByLabelText('관리자 응답'),{target:{value:'A 반려'}});fireEvent.click(screen.getByRole('button',{name:'제보 반려'}))
    fireEvent.click(rows[1]);fireEvent.change(screen.getByLabelText('관리자 응답'),{target:{value:'B 반려'}});fireEvent.click(screen.getByRole('button',{name:'제보 반려'}))
    expect(review).toHaveBeenCalledTimes(2)
    await act(async()=>finishA({ok:true,data:{...reviewing,status:'rejected',adminResponse:'A 반려',updatedAt:'2026-11-21T02:00:00Z'}}))
    expect(screen.getAllByRole('button',{name:/복지 제보.*선택/})).toHaveLength(2)
    expect(screen.getByRole('button',{name:'제보 반려'})).toBeDisabled()
    await act(async()=>finishB({ok:true,data:{...second,status:'rejected',adminResponse:'B 반려',updatedAt:'2026-11-21T02:00:00Z'}}))
  })
})
