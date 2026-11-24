import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue } from '../auth/AuthProvider'
import type { BenefitClaimRepository } from '../data/benefitClaimRepository'
import type { BenefitDirectoryRepository } from '../data/benefitDirectoryRepository'
import { BenefitClaimReactionPage } from './BenefitClaimReactionPage'

const companyId = 'KR-BIZ-1234567890'
const claimId = 'b1000000-0000-4000-8000-000000000001'
const actorA = 'a1000000-0000-4000-8000-000000000001'
const actorB = 'a1000000-0000-4000-8000-000000000002'
const claim = { claimId, categoryId:'health', categoryName:'건강', title:'매년 건강 검진', description:'전 직원을 위한 검진', eligibilityText:null, conditionText:null, statusCode:'submitted', statusLabel:'제보됨', nickname:'제보자', submittedAt:'2026-11-23T00:00:00Z', observedOn:'2026-11-22', confirmCount:0, disputeCount:0, lastConfirmationAt:null }
const company = { companyId, displayName:'테스트 기업', identityLabel:'법인', industry:null, sizeLabel:'분류 미확인', region:null, summary:null }
const detailResult = () => ({ ok:true as const, data:{ company, publications:[], claims:[claim] } })
const state = (reaction:null|'confirm'|'dispute'=null,isSubmitter=false) => ({ ok:true as const, data:{ claimId, reaction, isSubmitter } })
const success = (reaction:null|'confirm'|'dispute', confirmCount=0, disputeCount=0) => ({ ok:true as const, data:{ claimId, reaction, status:disputeCount ? 'disputed' as const : confirmCount >= 3 ? 'community_confirmed' as const : 'submitted' as const, revision:2, confirmCount, disputeCount, activePublicationId:null, outcome:'set' as const } })
function auth(actor=actorA, token=`token-${actor}`, generation=0):AuthContextValue{return{generation,loading:false,pending:false,session:{access_token:token} as never,user:{id:actor} as never,error:null,signIn:vi.fn(),signOut:vi.fn(),invalidateStaleSession:vi.fn(()=>false)}}
function directory(detail=vi.fn(async()=>detailResult())){return{detail,search:vi.fn()} as unknown as BenefitDirectoryRepository}
function repository(overrides:Record<string,unknown>={}){return{getReaction:vi.fn(async()=>state()),setReaction:vi.fn(async({reaction}:{reaction:null|'confirm'|'dispute'})=>success(reaction,reaction==='confirm'?1:0,reaction==='dispute'?1:0)),...overrides} as unknown as BenefitClaimRepository}
function ui(value:AuthContextValue, repo:BenefitClaimRepository, dir=directory()){return <AuthContext.Provider value={value}><BenefitClaimReactionPage repository={repo} directoryRepository={dir} search={`?company=${companyId}&claim=${claimId}`}/></AuthContext.Provider>}

describe('BenefitClaimReactionPage',()=>{
  it('loads the anonymous public snapshot before actor state and disables self-confirm with an explanation',async()=>{
    const order:string[]=[]
    const repo=repository({getReaction:vi.fn(async()=>{order.push('actor');return state(null,true)})})
    const dir=directory(vi.fn(async()=>{order.push('public');return detailResult()}))
    render(ui(auth(),repo,dir))
    expect(await screen.findByRole('heading',{name:'매년 건강 검진'})).toBeInTheDocument()
    expect(order).toEqual(['public','actor'])
    expect(screen.getByRole('button',{name:'나도 확인했어요'})).toBeDisabled()
    expect(screen.getByText('내가 제보한 내용은 직접 확인 반응을 남길 수 없습니다.')).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'현재는 달라요'})).toBeEnabled()
    expect(screen.getByText(/제보 철회를 먼저 권장/)).toBeInTheDocument()
  })

  it('uses one synchronous flight and reuses the cryptographic key for an unchanged retry but not a changed intent',async()=>{
    let release!:(value:ReturnType<typeof success>)=>void
    const pending=new Promise<ReturnType<typeof success>>(resolve=>{release=resolve})
    const setReaction=vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce({ok:false,error:{code:'network',message:'raw secret'}}).mockResolvedValue(success('dispute',0,1))
    const repo=repository({setReaction})
    render(ui(auth(),repo))
    const confirm=await screen.findByRole('button',{name:'나도 확인했어요'})
    fireEvent.click(confirm);fireEvent.click(confirm)
    expect(setReaction).toHaveBeenCalledTimes(1)
    const firstKey=setReaction.mock.calls[0][0].clientKey
    expect(firstKey).toMatch(/^[0-9a-f-]{36}$/)
    await act(async()=>release(success('confirm',1,0)))
    await screen.findByText('반응이 반영되었습니다.')
    fireEvent.click(screen.getByRole('button',{name:'현재는 달라요'}))
    await screen.findByRole('alert')
    const changedKey=setReaction.mock.calls[1][0].clientKey
    fireEvent.click(screen.getByRole('button',{name:'현재는 달라요'}))
    await waitFor(()=>expect(setReaction).toHaveBeenCalledTimes(3))
    expect(setReaction.mock.calls[2][0].clientKey).toBe(changedKey)
    expect(changedKey).not.toBe(firstKey)
  })

  it('drops a stale A response across A to B to A auth generations',async()=>{
    let release!:(value:ReturnType<typeof state>)=>void
    const getReaction=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{release=resolve})).mockResolvedValue(state('dispute'))
    const repo=repository({getReaction})
    const dir=directory()
    const view=render(ui(auth(actorA,'same-a',1),repo,dir))
    await waitFor(()=>expect(getReaction).toHaveBeenCalledTimes(1))
    view.rerender(ui(auth(actorB,'token-b',2),repo,dir))
    expect(screen.queryByRole('heading',{name:'매년 건강 검진'})).not.toBeInTheDocument()
    view.rerender(ui(auth(actorA,'same-a',3),repo,dir))
    await waitFor(()=>expect(getReaction).toHaveBeenCalledTimes(2))
    await act(async()=>release(state('confirm')))
    expect(await screen.findByText('내 반응: 현재는 달라요')).toBeInTheDocument()
    expect(screen.queryByText('내 반응: 나도 확인했어요')).not.toBeInTheDocument()
  })

  it('refreshes public and actor state after conflict without resubmitting',async()=>{
    const detail=vi.fn().mockResolvedValueOnce(detailResult()).mockResolvedValueOnce({ok:true,data:{company,publications:[],claims:[{...claim,statusCode:'disputed',statusLabel:'재확인 필요',disputeCount:1}]}})
    const getReaction=vi.fn().mockResolvedValueOnce(state()).mockResolvedValueOnce(state('dispute'))
    const setReaction=vi.fn(async()=>({ok:false as const,error:{code:'conflict' as const,message:'raw rpc detail'}}))
    const repo=repository({getReaction,setReaction})
    render(ui(auth(),repo,directory(detail)))
    fireEvent.click(await screen.findByRole('button',{name:'나도 확인했어요'}))
    expect(await screen.findByText('내 반응: 현재는 달라요')).toBeInTheDocument()
    expect(screen.getByText('확인 0 · 이의 1')).toBeInTheDocument()
    expect(detail).toHaveBeenCalledTimes(2)
    expect(getReaction).toHaveBeenCalledTimes(2)
    expect(setReaction).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).not.toMatch(/raw|rpc/i)
  })

  it('returns to the canonical company claim anchor',async()=>{
    render(ui(auth(),repository()))
    const link=await screen.findByRole('link',{name:'기업 복지로 돌아가기'})
    expect(link).toHaveAttribute('href',`/benefits/company/?id=${companyId}#claim-${claimId}`)
  })
})
