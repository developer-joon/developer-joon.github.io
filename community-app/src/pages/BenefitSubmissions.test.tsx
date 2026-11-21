import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { User } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../auth/AuthProvider'
import type { BenefitDirectoryRepository } from '../data/benefitDirectoryRepository'
import type { BenefitSubmissionRepository } from '../data/benefitSubmissionRepository'
import type { BenefitSubmissionLockAdapter } from '../lib/benefitSubmissionDraftStore'
import { BenefitSubmissionPage } from './BenefitSubmissionPage'
import { MyBenefitSubmissionsPage } from './MyBenefitSubmissionsPage'

const actor='11111111-1111-4111-8111-111111111111'
const scope='a'.repeat(64) as never
const company={companyId:'KR-BIZ-1234567890',displayName:'테스트 기업',identityLabel:'사업자등록번호' as const,industry:null,sizeLabel:'정보 없음' as const,region:null,summary:null,benefitCount:0,officialCount:0,communityCount:0,categories:[]}
function auth(id:string|null):AuthContextValue{return {loading:false,pending:false,session:id?{} as never:null,user:id?{id} as User:null,error:null,signIn:vi.fn(),signOut:vi.fn(),invalidateStaleSession:vi.fn(()=>true)}}
function storage(){const values=new Map<string,string>();return {values,getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>void values.set(key,value),removeItem:(key:string)=>void values.delete(key)}}
function locks():BenefitSubmissionLockAdapter{const tails=new Map<string,Promise<void>>();return {request:<T,>(name:string,callback:()=>Promise<T>|T)=>{const tail=tails.get(name)??Promise.resolve();const next=tail.then(callback,callback);tails.set(name,next.then(()=>undefined,()=>undefined));return next}}}
function directory():BenefitDirectoryRepository{return {search:vi.fn().mockResolvedValue({ok:true,data:{items:[company],hasMore:false,nextCursor:null,total:1}}),detail:vi.fn().mockResolvedValue({ok:true,data:{company,publications:[]}})} as never}
const item={id:'22222222-2222-4222-8222-222222222222',companyId:company.companyId,categoryId:'leave' as const,benefitText:'가족 돌봄 휴가',eligibilityText:null,conditionText:null,sourceUrl:null,status:'submitted' as const,adminResponse:null,publicationId:null,reviewedAt:null,createdAt:'2026-11-21T00:00:00Z',updatedAt:'2026-11-21T00:00:00Z'}
function submissions(overrides:Partial<BenefitSubmissionRepository>={}):BenefitSubmissionRepository{return {getCurrentAccountScope:vi.fn().mockResolvedValue({ok:true,data:scope}),createSubmission:vi.fn().mockResolvedValue({ok:true,data:item}),listMySubmissions:vi.fn().mockResolvedValue({ok:true,data:{items:[item],hasMore:false,nextCursor:null}}),...overrides}}
function wrap(ui:React.ReactNode,value:AuthContextValue){return render(<AuthContext.Provider value={value}>{ui}</AuthContext.Provider>)}

describe('BenefitSubmissionPage',()=>{
  it('keeps the form editable while signed out and saves before starting OAuth with full safe return path',async()=>{
    const local=storage(),session=storage(),value=auth(null)
    wrap(<BenefitSubmissionPage repository={submissions()} directoryRepository={directory()} storage={local} sessionStorage={session} lockAdapter={locks()} currentPath="/community/benefits/submit/?companyId=KR-BIZ-1234567890#form" search="?companyId=KR-BIZ-1234567890" />,value)
    await screen.findByLabelText('복지 내용')
    fireEvent.change(screen.getByLabelText('복지 내용'),{target:{value:'식대 지원'}})
    fireEvent.click(screen.getByRole('button',{name:/Google로 로그인/}))
    await waitFor(()=>expect(value.signIn).toHaveBeenCalledWith('google',expect.stringMatching(/^\/community\/benefits\/submit\/\?companyId=KR-BIZ-1234567890&intent=[0-9a-f-]+#form$/)))
    expect([...local.values.values()].some(raw=>raw.includes('식대 지원'))).toBe(true)
  })

  it('searches companies without a static option list and submits optional source as null once',async()=>{
    const local=storage(),repo=submissions(),companies=directory()
    wrap(<BenefitSubmissionPage repository={repo} directoryRepository={companies} storage={local} sessionStorage={storage()} lockAdapter={locks()} search="" />,auth(actor))
    await screen.findByLabelText('기업 검색')
    fireEvent.change(screen.getByLabelText('기업 검색'),{target:{value:'테스트'}})
    await waitFor(()=>expect(companies.search).toHaveBeenCalled())
    fireEvent.click(await screen.findByRole('button',{name:/테스트 기업/}))
    fireEvent.change(screen.getByLabelText('복지 분야'),{target:{value:'leave'}})
    fireEvent.change(screen.getByLabelText('복지 내용'),{target:{value:'가족 돌봄 휴가'}})
    const form=screen.getByRole('button',{name:'복지 제보 제출'}).closest('form')!
    fireEvent.submit(form);fireEvent.submit(form)
    await waitFor(()=>expect(repo.createSubmission).toHaveBeenCalledTimes(1))
    expect(repo.createSubmission).toHaveBeenCalledWith(expect.objectContaining({companyId:company.companyId,sourceUrl:null}),expect.any(AbortSignal))
    expect(await screen.findByRole('status')).toHaveTextContent('제보가 접수되었습니다')
  })

  it('does not overwrite a nonempty restored company with companyId prefill',async()=>{
    const local=storage(),first=submissions(),view=wrap(<BenefitSubmissionPage repository={first} directoryRepository={directory()} storage={local} sessionStorage={storage()} lockAdapter={locks()} search="" />,auth(actor))
    await screen.findByLabelText('기업 검색');fireEvent.change(screen.getByLabelText('기업 검색'),{target:{value:'테스트'}});fireEvent.click(await screen.findByRole('button',{name:/테스트 기업/}))
    view.unmount()
    wrap(<BenefitSubmissionPage repository={submissions()} directoryRepository={directory()} storage={local} sessionStorage={storage()} lockAdapter={locks()} search="?companyId=KR-BIZ-9999999999" />,auth(actor))
    const selected=await screen.findByText('테스트 기업');expect(selected.closest('p')).toHaveTextContent(company.companyId)
  })

  it('does not dispatch OAuth when the intent envelope cannot be read back',async()=>{
    const local=storage(),session=storage(),value=auth(null);session.setItem=vi.fn() as never
    wrap(<BenefitSubmissionPage repository={submissions()} directoryRepository={directory()} storage={local} sessionStorage={session} lockAdapter={locks()} />,value)
    fireEvent.click(await screen.findByRole('button',{name:/Google로 로그인/}))
    await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('로그인 정보를 저장하지 못했습니다'))
    expect(value.signIn).not.toHaveBeenCalled()
  })

  it('treats a route prefill as search text and disables submit until exact detail authority succeeds',async()=>{
    let resolve!:(value:unknown)=>void;const pending=new Promise(value=>{resolve=value}),companies=directory();companies.detail=vi.fn().mockReturnValue(pending) as never
    wrap(<BenefitSubmissionPage repository={submissions()} directoryRepository={companies} storage={storage()} sessionStorage={storage()} lockAdapter={locks()} search={`?companyId=${company.companyId}`} />,auth(actor))
    expect(await screen.findByLabelText('기업 검색')).toHaveValue(company.companyId)
    expect(screen.queryByText(/선택된 기업:/)).not.toBeInTheDocument()
    expect(screen.getByRole('button',{name:'복지 제보 제출'})).toBeDisabled()
    resolve({ok:true,data:{company,publications:[]}})
    expect(await screen.findByText('테스트 기업')).toBeVisible()
  })

  it('keeps a forged restored company unresolved when exact detail fails',async()=>{
    const local=storage(),draftRaw=JSON.stringify({version:1,accountScope:scope,clientKey:'11111111-1111-4111-8111-111111111111',companyId:company.companyId,companyName:'위조 이름',categoryId:'leave',benefitText:'복지',eligibilityText:'',conditionText:'',sourceUrl:'',updatedAt:new Date().toISOString()})
    local.values.set(`breadlab:benefit-submission:draft:v1:${scope}`,draftRaw)
    const companies=directory();companies.detail=vi.fn().mockResolvedValue({ok:false,error:{code:'not_found',message:'기업 정보를 찾을 수 없습니다.'}}) as never
    wrap(<BenefitSubmissionPage repository={submissions()} directoryRepository={companies} storage={local} sessionStorage={storage()} lockAdapter={locks()} />,auth(actor))
    expect(await screen.findByText(/기업 정보를 찾을 수 없습니다/)).toBeVisible()
    expect(screen.queryByText(/선택된 기업:/)).not.toBeInTheDocument()
    expect(screen.getByRole('button',{name:'복지 제보 제출'})).toBeDisabled()
  })

  it('ignores late company validation from the previous actor lifecycle',async()=>{
    let resolveA!:(value:unknown)=>void;const lateA=new Promise(value=>{resolveA=value}),companies=directory();(companies.detail as ReturnType<typeof vi.fn>).mockReset().mockReturnValueOnce(lateA).mockResolvedValue({ok:true,data:{company,publications:[]}})
    const first=auth(actor),second=auth('33333333-3333-4333-8333-333333333333'),view=wrap(<BenefitSubmissionPage repository={submissions()} directoryRepository={companies} storage={storage()} sessionStorage={storage()} lockAdapter={locks()} search={`?companyId=${company.companyId}`} />,first)
    await screen.findByLabelText('기업 검색');view.rerender(<AuthContext.Provider value={second}><BenefitSubmissionPage repository={submissions()} directoryRepository={companies} storage={storage()} sessionStorage={storage()} lockAdapter={locks()} search={`?companyId=${company.companyId}`} /></AuthContext.Provider>)
    expect(await screen.findByText('테스트 기업')).toBeVisible();resolveA({ok:true,data:{company:{...company,displayName:'이전 계정 기업'},publications:[]}});await Promise.resolve();expect(screen.queryByText('이전 계정 기업')).not.toBeInTheDocument()
  })
})

describe('MyBenefitSubmissionsPage',()=>{
  it('shows a safe login CTA while signed out',()=>{const value=auth(null);wrap(<MyBenefitSubmissionsPage repository={submissions()} currentPath="/community/benefits/my-submissions/?from=nav#top" />,value);fireEvent.click(screen.getByRole('button',{name:/Google로 로그인/}));expect(value.signIn).toHaveBeenCalledWith('google','/community/benefits/my-submissions/?from=nav#top')})
  it('paginates, deduplicates, and preserves first-page items when next page fails',async()=>{
    const list=vi.fn().mockResolvedValueOnce({ok:true,data:{items:[item],hasMore:true,nextCursor:JSON.stringify({created_at:item.createdAt,id:item.id})}}).mockResolvedValueOnce({ok:false,error:{code:'network',message:'네트워크 요청에 실패했습니다.'}})
    wrap(<MyBenefitSubmissionsPage repository={submissions({listMySubmissions:list})} />,auth(actor))
    expect(await screen.findByText('가족 돌봄 휴가')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'더 보기'}));expect(await screen.findByRole('alert')).toHaveTextContent('네트워크');expect(screen.getByText('가족 돌봄 휴가')).toBeVisible()
  })
  it('hides old account data synchronously on actor change and ignores late completion',async()=>{
    let resolve!:(value:unknown)=>void;const late=new Promise(value=>{resolve=value});const repo=submissions({listMySubmissions:vi.fn().mockReturnValue(late) as never});const first=auth(actor),second=auth('33333333-3333-4333-8333-333333333333')
    const view=wrap(<MyBenefitSubmissionsPage repository={repo} />,first);view.rerender(<AuthContext.Provider value={second}><MyBenefitSubmissionsPage repository={repo} /></AuthContext.Provider>);expect(screen.queryByText('가족 돌봄 휴가')).not.toBeInTheDocument();resolve({ok:true,data:{items:[item],hasMore:false,nextCursor:null}});await Promise.resolve();expect(screen.queryByText('가족 돌봄 휴가')).not.toBeInTheDocument()
  })
})
