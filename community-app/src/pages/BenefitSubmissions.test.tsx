import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { User } from '@supabase/supabase-js'
import { Profiler } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../auth/AuthProvider'
import type { BenefitDirectoryRepository } from '../data/benefitDirectoryRepository'
import type { BenefitSubmissionRepository } from '../data/benefitSubmissionRepository'
import { benefitSubmissionDraftKey, createBenefitSubmissionDraft, markBenefitSubmissionLoginIntent, saveBenefitSubmissionDraft, type BenefitSubmissionLockAdapter } from '../lib/benefitSubmissionDraftStore'
import { BenefitSubmissionPage } from './BenefitSubmissionPage'
import { MyBenefitSubmissionsPage } from './MyBenefitSubmissionsPage'
import { accountLifecycle, visibleAccountState } from './accountStateLifecycle'

const actor='11111111-1111-4111-8111-111111111111'
const scope='a'.repeat(64) as never
const company={companyId:'KR-BIZ-1234567890',displayName:'테스트 기업',identityLabel:'사업자등록번호' as const,industry:null,sizeLabel:'정보 없음' as const,region:null,summary:null,benefitCount:0,officialCount:0,communityCount:0,categories:[]}
const companyB={...company,companyId:'KR-BIZ-9876543210',displayName:'새 선택 기업'}
function auth(id:string|null):AuthContextValue{return {loading:false,pending:false,session:id?{} as never:null,user:id?{id} as User:null,error:null,signIn:vi.fn(),signOut:vi.fn(),invalidateStaleSession:vi.fn(()=>true)}}
function storage(){const values=new Map<string,string>();return {values,getItem:vi.fn((key:string)=>values.get(key)??null),setItem:vi.fn((key:string,value:string)=>void values.set(key,value)),removeItem:vi.fn((key:string)=>void values.delete(key))}}
function locks():BenefitSubmissionLockAdapter{const tails=new Map<string,Promise<void>>();return {request:<T,>(name:string,callback:()=>Promise<T>|T)=>{const tail=tails.get(name)??Promise.resolve();const next=tail.then(callback,callback);tails.set(name,next.then(()=>undefined,()=>undefined));return next}}}
function directory():BenefitDirectoryRepository{return {search:vi.fn().mockResolvedValue({ok:true,data:{items:[company],hasMore:false,nextCursor:null,total:1}}),detail:vi.fn().mockResolvedValue({ok:true,data:{company,publications:[]}})} as never}
const item={id:'22222222-2222-4222-8222-222222222222',companyId:company.companyId,categoryId:'leave' as const,benefitText:'가족 돌봄 휴가',eligibilityText:null,conditionText:null,sourceUrl:null,status:'submitted' as const,adminResponse:null,publicationId:null,reviewedAt:null,createdAt:'2026-11-21T00:00:00Z',updatedAt:'2026-11-21T00:00:00Z'}
function submissions(overrides:Partial<BenefitSubmissionRepository>={}):BenefitSubmissionRepository{return {getCurrentAccountScope:vi.fn().mockResolvedValue({ok:true,data:scope}),createSubmission:vi.fn().mockResolvedValue({ok:true,data:item}),listMySubmissions:vi.fn().mockResolvedValue({ok:true,data:{items:[item],hasMore:false,nextCursor:null}}),...overrides}}
function wrap(ui:React.ReactNode,value:AuthContextValue){return render(<AuthContext.Provider value={value}>{ui}</AuthContext.Provider>)}
function reactHandler<T>(node:HTMLElement,name:string):T{const key=Object.keys(node).find(value=>value.startsWith('__reactProps$'));if(!key)throw new Error('React props unavailable');return (node as unknown as Record<string,Record<string,T>>)[key][name]}

describe('account-scoped render visibility',()=>{
  it('hides an A snapshot on B first render and keeps it hidden when A returns until fresh hydration',()=>{
    const sessionA={},sessionB={}
    const lifecycleA=accountLifecycle(undefined,actor,sessionA)
    const snapshot={lifecycle:lifecycleA,value:{privateText:'A private draft'}}
    const lifecycleB=accountLifecycle(lifecycleA,'33333333-3333-4333-8333-333333333333',sessionB)
    expect(visibleAccountState(snapshot,lifecycleB)).toBeNull()
    const returnedA=accountLifecycle(lifecycleB,actor,sessionA)
    expect(returnedA).not.toBe(lifecycleA)
    expect(visibleAccountState(snapshot,returnedA)).toBeNull()
    expect(visibleAccountState({lifecycle:returnedA,value:{privateText:'fresh A draft'}},returnedA)).toEqual({privateText:'fresh A draft'})
  })

  it('keeps signed-out drafts in an explicit anonymous lifecycle',()=>{
    const anonymous=accountLifecycle(undefined,null,null)
    const snapshot={lifecycle:anonymous,value:'preauth only'}
    expect(visibleAccountState(snapshot,anonymous)).toBe('preauth only')
    expect(visibleAccountState(snapshot,accountLifecycle(anonymous,actor,{}))).toBeNull()
  })
})

describe('BenefitSubmissionPage',()=>{
  it('does not expose A draft, company, or messages in B render commits before B hydration',async()=>{
    const scopeB='b'.repeat(64) as never,local=storage(),lock=locks(),sessionA={},sessionB={}
    const privateDraft={...createBenefitSubmissionDraft(scope),companyId:company.companyId,companyName:company.displayName,categoryId:'leave' as const,benefitText:'A private benefit'}
    const saved=await saveBenefitSubmissionDraft(scope,privateDraft,local,lock);if(!saved.ok)throw new Error('save')
    let resolveB!:(value:unknown)=>void;const pendingB=new Promise(value=>{resolveB=value})
    const repo=submissions();(repo.getCurrentAccountScope as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ok:true,data:scope}).mockReturnValueOnce(pendingB)
    const first={...auth(actor),session:sessionA as never},second={...auth('33333333-3333-4333-8333-333333333333'),session:sessionB as never}
    const commits:string[]=[];let switching=false,host:HTMLElement|null=null
    const profile=(value:AuthContextValue)=><AuthContext.Provider value={value}><Profiler id="submission" onRender={()=>{if(switching)commits.push(host?.textContent??'')}}><BenefitSubmissionPage repository={repo} directoryRepository={directory()} storage={local} sessionStorage={storage()} lockAdapter={lock} /></Profiler></AuthContext.Provider>
    const view=render(profile(first));host=view.container
    expect(await screen.findByLabelText('복지 내용')).toHaveValue('A private benefit');expect(screen.getByText(company.displayName)).toBeVisible()
    switching=true;view.rerender(profile(second))
    expect(commits.length).toBeGreaterThan(0)
    expect(commits.every(text=>!text.includes('A private benefit')&&!text.includes(company.displayName))).toBe(true)
    resolveB({ok:true,data:scopeB})
  })

  it('rejects an A submit handler invoked after the render switches to B',async()=>{
    let resolveB!:(value:unknown)=>void;const pendingB=new Promise(value=>{resolveB=value}),repo=submissions(),local=storage(),sessionA={},sessionB={}
    ;(repo.getCurrentAccountScope as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ok:true,data:scope}).mockReturnValueOnce(pendingB)
    const first={...auth(actor),session:sessionA as never},second={...auth('33333333-3333-4333-8333-333333333333'),session:sessionB as never}
    const view=wrap(<BenefitSubmissionPage repository={repo} directoryRepository={directory()} storage={local} sessionStorage={storage()} lockAdapter={locks()} />,first)
    fireEvent.change(await screen.findByLabelText('기업 검색'),{target:{value:'테스트'}});fireEvent.click(await screen.findByRole('button',{name:/테스트 기업/}));fireEvent.change(screen.getByLabelText('복지 분야'),{target:{value:'leave'}});fireEvent.change(screen.getByLabelText('복지 내용'),{target:{value:'A private benefit'}})
    await waitFor(()=>expect(screen.getByRole('button',{name:'복지 제보 제출'})).toBeEnabled())
    const staleSubmit=reactHandler<(event:{preventDefault():void})=>Promise<void>>(screen.getByRole('button',{name:'복지 제보 제출'}).closest('form')!,'onSubmit')
    view.rerender(<AuthContext.Provider value={second}><BenefitSubmissionPage repository={repo} directoryRepository={directory()} storage={local} sessionStorage={storage()} lockAdapter={locks()} /></AuthContext.Provider>)
    await staleSubmit({preventDefault:vi.fn()})
    expect(repo.createSubmission).not.toHaveBeenCalled();resolveB({ok:true,data:'b'.repeat(64)})
  })

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

  it.each(['resolve','reject'] as const)('keeps manual company B when initial detail A later %s',async outcome=>{
    let resolveA!:(value:unknown)=>void,rejectA!:(reason?:unknown)=>void
    const lateA=new Promise((resolve,reject)=>{resolveA=resolve;rejectA=reject}),companies=directory()
    ;(companies.detail as ReturnType<typeof vi.fn>).mockReset().mockReturnValueOnce(lateA)
    ;(companies.search as ReturnType<typeof vi.fn>).mockResolvedValue({ok:true,data:{items:[companyB],hasMore:false,nextCursor:null,total:1}})
    const repo=submissions({createSubmission:vi.fn().mockResolvedValue({ok:true,data:{...item,companyId:companyB.companyId}})})
    wrap(<BenefitSubmissionPage repository={repo} directoryRepository={companies} storage={storage()} sessionStorage={storage()} lockAdapter={locks()} search={`?companyId=${company.companyId}`} />,auth(actor))
    const input=await screen.findByLabelText('기업 검색');fireEvent.change(input,{target:{value:'새 선택'}})
    fireEvent.click(await screen.findByRole('button',{name:/새 선택 기업/}))
    if(outcome==='resolve')resolveA({ok:true,data:{company,publications:[]}});else rejectA(new Error('late A'))
    await Promise.resolve();expect(screen.getByText('새 선택 기업')).toBeVisible();expect(screen.queryByText(/^테스트 기업$/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('복지 분야'),{target:{value:'leave'}});fireEvent.change(screen.getByLabelText('복지 내용'),{target:{value:'B 복지'}})
    await waitFor(()=>expect(screen.getByRole('button',{name:'복지 제보 제출'})).toBeEnabled())
    fireEvent.click(screen.getByRole('button',{name:'복지 제보 제출'}));await waitFor(()=>expect(repo.createSubmission).toHaveBeenCalledWith(expect.objectContaining({companyId:companyB.companyId}),expect.any(AbortSignal)))
  })

  it.each([
    ['malformed','{"version":1'],
    ['extra key',JSON.stringify({...createBenefitSubmissionDraft(scope),extra:'preserve'})],
    ['future version',JSON.stringify({...createBenefitSubmissionDraft(scope),version:2})],
  ])('blocks the form and preserves exact %s draft bytes until explicit recovery',async(_label,raw)=>{
    const local=storage(),key=benefitSubmissionDraftKey(scope);local.values.set(key,raw);local.setItem.mockClear();local.removeItem.mockClear()
    wrap(<BenefitSubmissionPage repository={submissions()} directoryRepository={directory()} storage={local} sessionStorage={storage()} lockAdapter={locks()} />,auth(actor))
    expect(await screen.findByRole('alert')).toHaveTextContent('읽을 수 없습니다')
    expect(screen.getByRole('button',{name:'저장된 초안 초기화'})).toBeVisible()
    expect(screen.getByRole('button',{name:'다시 불러오기'})).toBeVisible()
    expect(screen.queryByLabelText('복지 내용')).not.toBeInTheDocument()
    expect(local.getItem(key)).toBe(raw);expect(local.setItem).not.toHaveBeenCalled();expect(local.removeItem).not.toHaveBeenCalled()
  })

  it('resets the exact blocked draft only after the destructive action',async()=>{
    const local=storage(),key=benefitSubmissionDraftKey(scope);local.values.set(key,'{bad json');local.setItem.mockClear();local.removeItem.mockClear()
    wrap(<BenefitSubmissionPage repository={submissions()} directoryRepository={directory()} storage={local} sessionStorage={storage()} lockAdapter={locks()} />,auth(actor))
    fireEvent.click(await screen.findByRole('button',{name:'저장된 초안 초기화'}))
    expect(await screen.findByLabelText('복지 내용')).toHaveValue('')
    expect(local.removeItem).not.toHaveBeenCalled()
    const fresh=local.getItem(key);expect(fresh).not.toBeNull();expect(JSON.parse(fresh!).accountScope).toBe(scope)
  })

  it('preserves a replacement that arrives before blocked-draft reset and asks for reload',async()=>{
    const local=storage(),key=benefitSubmissionDraftKey(scope);local.values.set(key,'{old invalid')
    wrap(<BenefitSubmissionPage repository={submissions()} directoryRepository={directory()} storage={local} sessionStorage={storage()} lockAdapter={locks()} />,auth(actor))
    await screen.findByRole('button',{name:'저장된 초안 초기화'});local.values.set(key,'{new invalid')
    fireEvent.click(screen.getByRole('button',{name:'저장된 초안 초기화'}))
    await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('변경되었습니다. 다시 불러와'))
    expect(local.getItem(key)).toBe('{new invalid')
  })

  it.each(['throw','noop'] as const)('keeps recovery blocked when reset overwrite is a %s',async failure=>{
    const local=storage(),key=benefitSubmissionDraftKey(scope);local.values.set(key,'{blocked')
    local.setItem=failure==='throw'?vi.fn(()=>{throw new Error('blocked')}):vi.fn()
    wrap(<BenefitSubmissionPage repository={submissions()} directoryRepository={directory()} storage={local} sessionStorage={storage()} lockAdapter={locks()} />,auth(actor))
    fireEvent.click(await screen.findByRole('button',{name:'저장된 초안 초기화'}))
    await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('초안을 초기화하지 못했습니다'))
    expect(screen.queryByLabelText('복지 내용')).not.toBeInTheDocument();expect(local.getItem(key)).toBe('{blocked')
  })

  it('does not show or reset account A invalid bytes after switching to account B',async()=>{
    const scopeB='b'.repeat(64) as never,local=storage(),keyA=benefitSubmissionDraftKey(scope),rawA='{account A only'
    local.values.set(keyA,rawA)
    const repo=submissions();(repo.getCurrentAccountScope as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ok:true,data:scope}).mockResolvedValue({ok:true,data:scopeB})
    const view=wrap(<BenefitSubmissionPage repository={repo} directoryRepository={directory()} storage={local} sessionStorage={storage()} lockAdapter={locks()} />,auth(actor))
    await screen.findByRole('button',{name:'저장된 초안 초기화'})
    view.rerender(<AuthContext.Provider value={auth('33333333-3333-4333-8333-333333333333')}><BenefitSubmissionPage repository={repo} directoryRepository={directory()} storage={local} sessionStorage={storage()} lockAdapter={locks()} /></AuthContext.Provider>)
    expect(await screen.findByLabelText('복지 내용')).toBeVisible()
    expect(screen.queryByRole('button',{name:'저장된 초안 초기화'})).not.toBeInTheDocument();expect(local.getItem(keyA)).toBe(rawA)
  })

  it('shows same-account guidance without mounting a draft when another actor follows a claimed intent',async()=>{
    const local=storage(),session=storage(),lock=locks(),preauth=createBenefitSubmissionDraft('preauth')
    const saved=await saveBenefitSubmissionDraft('preauth',{...preauth,benefitText:'A 전용 초안'},local,lock);if(!saved.ok)throw new Error('save')
    const marked=await markBenefitSubmissionLoginIntent(saved.snapshot,session,lock,()=> '44444444-4444-4444-8444-444444444444');if(!marked.ok)throw new Error('mark')
    local.setItem=vi.fn((key:string,value:string)=>{if(key===benefitSubmissionDraftKey(scope))throw new Error('blocked');local.values.set(key,value)})
    await import('../lib/benefitSubmissionDraftStore').then(({claimPreAuthBenefitSubmissionDraft})=>claimPreAuthBenefitSubmissionDraft(scope,marked.nonce,local,session,lock))
    wrap(<BenefitSubmissionPage repository={submissions({getCurrentAccountScope:vi.fn().mockResolvedValue({ok:true,data:'b'.repeat(64)})})} directoryRepository={directory()} storage={local} sessionStorage={session} lockAdapter={lock} search={`?intent=${marked.nonce}`} />,auth('33333333-3333-4333-8333-333333333333'))
    expect(await screen.findByRole('alert')).toHaveTextContent('같은 계정으로 로그인')
    expect(screen.queryByLabelText('복지 내용')).not.toBeInTheDocument();expect(local.getItem(benefitSubmissionDraftKey('preauth'))).toBe(saved.snapshot)
  })

  it('offers both claimed-intent recovery actions and restores the login-time draft only after approval',async()=>{
    const local=storage(),session=storage(),lock=locks(),key=benefitSubmissionDraftKey(scope),raw='{invalid account';local.values.set(key,raw)
    const preauth=createBenefitSubmissionDraft('preauth',()=> '22222222-2222-4222-8222-222222222222',()=> '2026-11-21T00:00:00.000Z')
    const saved=await saveBenefitSubmissionDraft('preauth',{...preauth,benefitText:'복구할 로그인 전 초안'},local,lock);if(!saved.ok)throw new Error('save')
    const marked=await markBenefitSubmissionLoginIntent(saved.snapshot,session,lock,()=> '44444444-4444-4444-8444-444444444444');if(!marked.ok)throw new Error('mark')
    wrap(<BenefitSubmissionPage repository={submissions()} directoryRepository={directory()} storage={local} sessionStorage={session} lockAdapter={lock} search={`?intent=${marked.nonce}`} />,auth(actor))
    expect(await screen.findByRole('heading',{name:'로그인 초안 복구 선택'})).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('계정에 저장된 초안을 읽을 수 없습니다')
    expect(screen.getByRole('button',{name:'로그인 전 초안으로 복구'})).toBeVisible()
    expect(screen.getByRole('button',{name:'로그인 전 초안 버리기'})).toBeVisible()
    expect(screen.queryByLabelText('복지 내용')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'로그인 전 초안으로 복구'}))
    expect(await screen.findByLabelText('복지 내용')).toHaveValue('복구할 로그인 전 초안')
    const restored=JSON.parse(local.getItem(key)!);expect(restored).toMatchObject({accountScope:scope,clientKey:preauth.clientKey,updatedAt:preauth.updatedAt})
  })

  it('discards only the claimed envelope then exposes normal invalid-draft recovery',async()=>{
    const local=storage(),session=storage(),lock=locks(),key=benefitSubmissionDraftKey(scope),raw='{invalid account';local.values.set(key,raw)
    const saved=await saveBenefitSubmissionDraft('preauth',createBenefitSubmissionDraft('preauth'),local,lock);if(!saved.ok)throw new Error('save')
    const marked=await markBenefitSubmissionLoginIntent(saved.snapshot,session,lock,()=> '44444444-4444-4444-8444-444444444444');if(!marked.ok)throw new Error('mark')
    wrap(<BenefitSubmissionPage repository={submissions()} directoryRepository={directory()} storage={local} sessionStorage={session} lockAdapter={lock} search={`?intent=${marked.nonce}`} />,auth(actor))
    fireEvent.click(await screen.findByRole('button',{name:'로그인 전 초안 버리기'}))
    expect(await screen.findByRole('heading',{name:'저장된 초안 복구 필요'})).toBeVisible()
    expect(local.getItem(key)).toBe(raw)
    fireEvent.click(screen.getByRole('button',{name:'저장된 초안 초기화'}))
    expect(await screen.findByLabelText('복지 내용')).toHaveValue('')
  })

  it('keeps claimed recovery retryable when envelope cleanup is a no-op',async()=>{
    const local=storage(),session=storage(),lock=locks(),key=benefitSubmissionDraftKey(scope);local.values.set(key,'{invalid account')
    const saved=await saveBenefitSubmissionDraft('preauth',{...createBenefitSubmissionDraft('preauth'),benefitText:'재시도 초안'},local,lock);if(!saved.ok)throw new Error('save')
    const marked=await markBenefitSubmissionLoginIntent(saved.snapshot,session,lock,()=> '44444444-4444-4444-8444-444444444444');if(!marked.ok)throw new Error('mark')
    const remove=session.removeItem;session.removeItem=vi.fn()
    wrap(<BenefitSubmissionPage repository={submissions()} directoryRepository={directory()} storage={local} sessionStorage={session} lockAdapter={lock} search={`?intent=${marked.nonce}`} />,auth(actor))
    fireEvent.click(await screen.findByRole('button',{name:'로그인 전 초안으로 복구'}))
    await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('정리를 완료하지 못했습니다'))
    expect(screen.getByRole('button',{name:'로그인 전 초안으로 복구'})).toBeEnabled()
    session.removeItem=remove;fireEvent.click(screen.getByRole('button',{name:'로그인 전 초안으로 복구'}))
    expect(await screen.findByLabelText('복지 내용')).toHaveValue('재시도 초안')
  })

  it('ignores late claimed-recovery UI completion after an account switch',async()=>{
    const scopeB='b'.repeat(64) as never,local=storage(),session=storage(),base=locks(),key=benefitSubmissionDraftKey(scope);local.values.set(key,'{invalid account')
    const saved=await saveBenefitSubmissionDraft('preauth',{...createBenefitSubmissionDraft('preauth'),benefitText:'A 전용 복구'},local,base);if(!saved.ok)throw new Error('save')
    const marked=await markBenefitSubmissionLoginIntent(saved.snapshot,session,base,()=> '44444444-4444-4444-8444-444444444444');if(!marked.ok)throw new Error('mark')
    let release!:()=>void,accountRequests=0;const gate=new Promise<void>(resolve=>{release=resolve})
    const lock:BenefitSubmissionLockAdapter={request:<T,>(name:string,callback:()=>Promise<T>|T)=>base.request(name,async()=>{if(name.endsWith(`:account:${scope}`)&&++accountRequests===2)await gate;return callback()})}
    const repo=submissions();(repo.getCurrentAccountScope as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ok:true,data:scope}).mockResolvedValue({ok:true,data:scopeB})
    const view=wrap(<BenefitSubmissionPage repository={repo} directoryRepository={directory()} storage={local} sessionStorage={session} lockAdapter={lock} search={`?intent=${marked.nonce}`} />,auth(actor))
    fireEvent.click(await screen.findByRole('button',{name:'로그인 전 초안으로 복구'}))
    view.rerender(<AuthContext.Provider value={auth('33333333-3333-4333-8333-333333333333')}><BenefitSubmissionPage repository={repo} directoryRepository={directory()} storage={local} sessionStorage={session} lockAdapter={lock} search={`?intent=${marked.nonce}`} /></AuthContext.Provider>)
    release()
    expect(await screen.findByLabelText('복지 내용')).not.toHaveValue('A 전용 복구')
  })

  it('shows partial success and retries only conditional local cleanup',async()=>{
    const local=storage(),repo=submissions();let blockRemove=false
    const remove=local.removeItem;local.removeItem=vi.fn((key:string)=>{if(!blockRemove)remove(key)})
    wrap(<BenefitSubmissionPage repository={repo} directoryRepository={directory()} storage={local} sessionStorage={storage()} lockAdapter={locks()} />,auth(actor))
    const input=await screen.findByLabelText('기업 검색');fireEvent.change(input,{target:{value:'테스트'}});fireEvent.click(await screen.findByRole('button',{name:/테스트 기업/}))
    fireEvent.change(screen.getByLabelText('복지 분야'),{target:{value:'leave'}});fireEvent.change(screen.getByLabelText('복지 내용'),{target:{value:'가족 돌봄 휴가'}})
    await waitFor(()=>expect(screen.getByRole('button',{name:'복지 제보 제출'})).toBeEnabled());blockRemove=true;fireEvent.click(screen.getByRole('button',{name:'복지 제보 제출'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('서버에는 접수되었지만 로컬 저장 초안이 남아 있습니다')
    expect(screen.queryByText('제보가 접수되었습니다. 내 제보에서')).not.toBeInTheDocument();expect(repo.createSubmission).toHaveBeenCalledTimes(1)
    blockRemove=false;fireEvent.click(screen.getByRole('button',{name:'로컬 초안 정리 다시 시도'}))
    expect(await screen.findByText('제보가 접수되었습니다. 내 제보에서 검토 상태를 확인할 수 있습니다.')).toBeVisible();expect(repo.createSubmission).toHaveBeenCalledTimes(1)
  })

  it('preserves a newer local draft during partial-success cleanup retry',async()=>{
    const local=storage(),repo=submissions();let blockRemove=false
    const remove=local.removeItem;local.removeItem=vi.fn((key:string)=>{if(!blockRemove)remove(key)})
    wrap(<BenefitSubmissionPage repository={repo} directoryRepository={directory()} storage={local} sessionStorage={storage()} lockAdapter={locks()} />,auth(actor))
    fireEvent.change(await screen.findByLabelText('기업 검색'),{target:{value:'테스트'}});fireEvent.click(await screen.findByRole('button',{name:/테스트 기업/}));fireEvent.change(screen.getByLabelText('복지 분야'),{target:{value:'leave'}});fireEvent.change(screen.getByLabelText('복지 내용'),{target:{value:'가족 돌봄 휴가'}})
    await waitFor(()=>expect(screen.getByRole('button',{name:'복지 제보 제출'})).toBeEnabled());blockRemove=true;fireEvent.click(screen.getByRole('button',{name:'복지 제보 제출'}));await screen.findByRole('alert')
    const key=benefitSubmissionDraftKey(scope),current=local.getItem(key);if(!current)throw new Error('draft missing');const newer={...JSON.parse(current),benefitText:'더 새로운 로컬 편집',updatedAt:new Date().toISOString()};local.setItem(key,JSON.stringify(newer));blockRemove=false
    fireEvent.click(screen.getByRole('button',{name:'로컬 초안 정리 다시 시도'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('더 새로운 로컬 초안을 발견해 삭제하지 않았습니다'));expect(local.getItem(key)).toContain('더 새로운 로컬 편집');expect(repo.createSubmission).toHaveBeenCalledTimes(1)
  })

  it('renders repository failures exactly rather than as draft storage errors',async()=>{
    const repo=submissions({createSubmission:vi.fn().mockResolvedValue({ok:false,error:{code:'auth_required',message:'다시 로그인해 주세요.'}})})
    wrap(<BenefitSubmissionPage repository={repo} directoryRepository={directory()} storage={storage()} sessionStorage={storage()} lockAdapter={locks()} />,auth(actor))
    fireEvent.change(await screen.findByLabelText('기업 검색'),{target:{value:'테스트'}});fireEvent.click(await screen.findByRole('button',{name:/테스트 기업/}));fireEvent.change(screen.getByLabelText('복지 분야'),{target:{value:'leave'}});fireEvent.change(screen.getByLabelText('복지 내용'),{target:{value:'복지'}})
    await waitFor(()=>expect(screen.getByRole('button',{name:'복지 제보 제출'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'복지 제보 제출'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('다시 로그인해 주세요.');expect(screen.getByRole('alert')).not.toHaveTextContent('저장된 초안')
  })

  it('offers an explicit discard action when OAuth intent conflicts with an account draft',async()=>{
    const local=storage(),session=storage(),lock=locks(),account=createBenefitSubmissionDraft(scope),preauth=createBenefitSubmissionDraft('preauth')
    const accountSaved=await saveBenefitSubmissionDraft(scope,{...account,benefitText:'계정 초안'},local,lock);if(!accountSaved.ok)throw new Error('save')
    const preauthSaved=await saveBenefitSubmissionDraft('preauth',{...preauth,benefitText:'로그인 초안'},local,lock);if(!preauthSaved.ok)throw new Error('save')
    const marked=await markBenefitSubmissionLoginIntent(preauthSaved.snapshot,session,lock,()=> '44444444-4444-4444-8444-444444444444');if(!marked.ok)throw new Error('mark')
    wrap(<BenefitSubmissionPage repository={submissions()} directoryRepository={directory()} storage={local} sessionStorage={session} lockAdapter={lock} search={`?intent=${marked.nonce}`} />,auth(actor))
    expect(await screen.findByRole('alert')).toHaveTextContent('두 개의 초안')
    fireEvent.click(screen.getByRole('button',{name:'로그인 전 초안 버리기'}))
    expect(await screen.findByLabelText('복지 내용')).toHaveValue('계정 초안');expect(local.getItem(benefitSubmissionDraftKey(scope))).toBe(accountSaved.snapshot)
  })
})

describe('MyBenefitSubmissionsPage',()=>{
  it('shows a safe login CTA while signed out',()=>{const value=auth(null);wrap(<MyBenefitSubmissionsPage repository={submissions()} currentPath="/community/benefits/my-submissions/?from=nav#top" />,value);fireEvent.click(screen.getByRole('button',{name:/Google로 로그인/}));expect(value.signIn).toHaveBeenCalledWith('google','/community/benefits/my-submissions/?from=nav#top')})
  it('paginates, deduplicates, and preserves first-page items when next page fails',async()=>{
    const list=vi.fn().mockResolvedValueOnce({ok:true,data:{items:[item],hasMore:true,nextCursor:JSON.stringify({created_at:item.createdAt,id:item.id})}}).mockResolvedValueOnce({ok:false,error:{code:'network',message:'네트워크 요청에 실패했습니다.'}})
    wrap(<MyBenefitSubmissionsPage repository={submissions({listMySubmissions:list})} />,auth(actor))
    expect(await screen.findByText('가족 돌봄 휴가')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'더 보기'}));expect(await screen.findByRole('alert')).toHaveTextContent('네트워크');expect(screen.getByText('가족 돌봄 휴가')).toBeVisible()
  })
  it('hides old account data in every B render commit and ignores late completion',async()=>{
    let resolveB!:(value:unknown)=>void;const pendingB=new Promise(value=>{resolveB=value});const list=vi.fn().mockResolvedValueOnce({ok:true,data:{items:[item],hasMore:false,nextCursor:null}}).mockReturnValueOnce(pendingB)
    const repo=submissions({listMySubmissions:list}),first=auth(actor),second=auth('33333333-3333-4333-8333-333333333333'),commits:string[]=[];let switching=false,host:HTMLElement|null=null
    const profile=(value:AuthContextValue)=><AuthContext.Provider value={value}><Profiler id="owner-list" onRender={()=>{if(switching)commits.push(host?.textContent??'')}}><MyBenefitSubmissionsPage repository={repo} /></Profiler></AuthContext.Provider>
    const view=render(profile(first));host=view.container;expect(await screen.findByText('가족 돌봄 휴가')).toBeVisible()
    switching=true;view.rerender(profile(second));expect(commits.length).toBeGreaterThan(0);expect(commits.every(text=>!text.includes('가족 돌봄 휴가'))).toBe(true)
    resolveB({ok:true,data:{items:[{...item,benefitText:'B benefit'}],hasMore:false,nextCursor:null}});expect(await screen.findByText('B benefit')).toBeVisible();expect(screen.queryByText('가족 돌봄 휴가')).not.toBeInTheDocument()
  })
  it('rejects an A append handler invoked after the render switches to B',async()=>{
    let resolveB!:(value:unknown)=>void;const pendingB=new Promise(value=>{resolveB=value}),cursor=JSON.stringify({created_at:item.createdAt,id:item.id}),list=vi.fn().mockResolvedValueOnce({ok:true,data:{items:[item],hasMore:true,nextCursor:cursor}}).mockReturnValueOnce(pendingB),repo=submissions({listMySubmissions:list})
    const first=auth(actor),second=auth('33333333-3333-4333-8333-333333333333'),view=wrap(<MyBenefitSubmissionsPage repository={repo} />,first)
    const staleMore=reactHandler<()=>void>(await screen.findByRole('button',{name:'더 보기'}),'onClick')
    view.rerender(<AuthContext.Provider value={second}><MyBenefitSubmissionsPage repository={repo} /></AuthContext.Provider>);staleMore()
    expect(list).toHaveBeenCalledTimes(2);resolveB({ok:true,data:{items:[],hasMore:false,nextCursor:null}})
  })
})
