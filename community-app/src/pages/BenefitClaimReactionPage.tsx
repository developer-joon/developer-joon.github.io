import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { DEFAULT_AUTH_PROVIDER } from '../auth/providers'
import { AppFooter } from '../components/AppFooter'
import { AppHeader } from '../components/AppHeader'
import { getBenefitClaimRepository, type BenefitClaimRepository } from '../data/benefitClaimRepository'
import { getBenefitDirectoryRepository, type BenefitDirectoryRepository } from '../data/benefitDirectoryRepository'
import { isBenefitCompanyId } from '../lib/benefitCompanyId'
import { isCanonicalUuid } from '../lib/uuid'
import type { BenefitClaimReaction, BenefitClaimReactionState } from '../types/benefitClaims'
import type { BenefitDirectoryCompanySummary, BenefitDirectoryPublicClaim } from '../types/benefitDirectory'

const reactionPath = '/community/benefits/claim-reaction/'
type Target = { companyId:string; claimId:string }
type PageClaim = Pick<BenefitDirectoryPublicClaim,'claimId'|'title'|'description'|'statusCode'|'statusLabel'|'confirmCount'|'disputeCount'>
type Ready = { company:BenefitDirectoryCompanySummary; claim:PageClaim; actor:BenefitClaimReactionState }
type Identity = { actorId:string; sessionIdentity:string; target:Target; repository:BenefitClaimRepository; directoryRepository:BenefitDirectoryRepository }
type View = { identity:Identity; phase:'loading'|'ready'|'error'; ready?:Ready; error?:string; notice?:string; mutating:boolean }
type Lifecycle = { identity:Identity; active:boolean; loads:Set<AbortController> }
type Operation = { lifecycle:Lifecycle; reaction:BenefitClaimReaction|null; controller:AbortController }

function targetFrom(search:string):Target|null {
  const params=new URLSearchParams(search),companies=params.getAll('company'),claims=params.getAll('claim')
  if(companies.length!==1||claims.length!==1||!isBenefitCompanyId(companies[0])||!isCanonicalUuid(claims[0]))return null
  return{companyId:companies[0],claimId:claims[0].toLowerCase()}
}
function Shell({children}:{children:React.ReactNode}){return <div className="community-page benefits-page"><AppHeader/><main className="benefit-service-form benefit-reaction-page">{children}</main><AppFooter/></div>}
function genericError(){return '반응 정보를 안전하게 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'}
function pageClaim(claim:BenefitDirectoryPublicClaim|undefined):PageClaim|null{
 if(!claim)return null
 return{claimId:claim.claimId,title:claim.title,description:claim.description,statusCode:claim.statusCode,statusLabel:claim.statusLabel,confirmCount:claim.confirmCount,disputeCount:claim.disputeCount}
}
function sameIdentity(a:Identity,b:Identity){return a.actorId===b.actorId&&a.sessionIdentity===b.sessionIdentity&&a.target.companyId===b.target.companyId&&a.target.claimId===b.target.claimId&&a.repository===b.repository&&a.directoryRepository===b.directoryRepository}

interface Props{repository?:BenefitClaimRepository;directoryRepository?:BenefitDirectoryRepository;search?:string}
export function BenefitClaimReactionPage({repository=getBenefitClaimRepository(),directoryRepository=getBenefitDirectoryRepository(),search=window.location.search}:Props){
 const auth=useAuth(),target=targetFrom(search),actorId=auth.user?.id??null,sessionIdentity=`${auth.session?.access_token??String(auth.session?.expires_at??'')}:${auth.generation??0}`

 if(auth.loading)return <Shell><h1>복지 제보 반응</h1><p role="status">로그인 상태를 확인하고 있습니다.</p></Shell>
 if(!target)return <Shell><h1>복지 제보 반응</h1><section className="benefit-service-alert" role="alert"><p>기업과 제보 식별자를 확인할 수 없습니다.</p></section></Shell>
 if(!actorId)return <Shell><h1>복지 제보 반응</h1><section className="benefit-service-gate"><p>확인 또는 이의 반응은 Google 로그인 후 남길 수 있습니다.</p><button type="button" disabled={auth.pending} onClick={()=>void auth.signIn(DEFAULT_AUTH_PROVIDER,`${reactionPath}?${new URLSearchParams({company:target.companyId,claim:target.claimId})}`)}>Google로 로그인하고 계속</button>{auth.error&&<p role="alert">로그인을 완료하지 못했습니다.</p>}</section></Shell>

 return <BenefitClaimReactionLifecycle identity={{actorId,sessionIdentity,target,repository,directoryRepository}}/>
}

function BenefitClaimReactionLifecycle({identity}:{identity:Identity}){
 const activeLifecycle=useRef<Lifecycle|null>(null)
 const operation=useRef<Operation|null>(null)
 const retryIntent=useRef<{reaction:BenefitClaimReaction|null;clientKey:string}|null>(null)
 const [view,setView]=useState<View>({identity,phase:'loading',mutating:false})
 const visible=sameIdentity(view.identity,identity)?view:{identity,phase:'loading' as const,mutating:false}

 function current(lifecycle:Lifecycle){return lifecycle.active&&activeLifecycle.current===lifecycle}
 function abortLoads(lifecycle:Lifecycle){for(const controller of lifecycle.loads)controller.abort();lifecycle.loads.clear()}
 async function load(lifecycle:Lifecycle){
   if(!current(lifecycle))return
   abortLoads(lifecycle)
   const controller=new AbortController(),source=lifecycle.identity
   lifecycle.loads.add(controller)
   setView({identity:source,phase:'loading',mutating:false})
   try{
     const publicResult=await source.directoryRepository.detail(source.target.companyId,controller.signal)
     if(!current(lifecycle)||controller.signal.aborted)return
     if(!publicResult.ok||publicResult.data.company.companyId!==source.target.companyId){setView({identity:source,phase:'error',error:genericError(),mutating:false});return}
     const claim=pageClaim(publicResult.data.claims.find(item=>item.claimId===source.target.claimId))
     if(!claim){setView({identity:source,phase:'error',error:'요청한 복지 제보를 찾을 수 없습니다.',mutating:false});return}
     const actorResult=await source.repository.getReaction({claimId:source.target.claimId},controller.signal)
     if(!current(lifecycle)||controller.signal.aborted)return
     if(!actorResult.ok||actorResult.data.claimId!==source.target.claimId){setView({identity:source,phase:'error',error:genericError(),mutating:false});return}
     setView({identity:source,phase:'ready',ready:{company:publicResult.data.company,claim,actor:actorResult.data},mutating:false})
   }catch{if(current(lifecycle)&&!controller.signal.aborted)setView({identity:source,phase:'error',error:genericError(),mutating:false})}
   finally{lifecycle.loads.delete(controller)}
 }

 useEffect(()=>{
   const lifecycle:Lifecycle={identity,active:true,loads:new Set()}
   activeLifecycle.current=lifecycle
   operation.current=null
   retryIntent.current=null
   void load(lifecycle)
   return()=>{
     lifecycle.active=false
     abortLoads(lifecycle)
     if(operation.current?.lifecycle===lifecycle){operation.current.controller.abort();operation.current=null}
     if(activeLifecycle.current===lifecycle){activeLifecycle.current=null;retryIntent.current=null}
   }
 // The effect intentionally commits and owns this exact identity lifecycle.
 },[identity.actorId,identity.sessionIdentity,identity.target.companyId,identity.target.claimId,identity.repository,identity.directoryRepository])

 async function react(reaction:BenefitClaimReaction|null){
   const lifecycle=activeLifecycle.current
   if(!lifecycle||!current(lifecycle)||!sameIdentity(lifecycle.identity,identity)||visible.phase!=='ready'||!visible.ready||operation.current||reaction==='confirm'&&visible.ready.actor.isSubmitter)return
   const intent=retryIntent.current?.reaction===reaction?retryIntent.current:{reaction,clientKey:crypto.randomUUID()}
   const controller=new AbortController(),token:Operation={lifecycle,reaction,controller}
   retryIntent.current=intent
   operation.current=token
   setView(value=>sameIdentity(value.identity,lifecycle.identity)?{...value,error:undefined,notice:undefined,mutating:true}:value)
   let result:Awaited<ReturnType<BenefitClaimRepository['setReaction']>>
   try{result=await lifecycle.identity.repository.setReaction({claimId:lifecycle.identity.target.claimId,reaction,clientKey:intent.clientKey},controller.signal)}
   catch{result={ok:false,error:{code:'unknown',message:genericError()}}}
   if(!current(lifecycle)||operation.current!==token||controller.signal.aborted)return
   operation.current=null
   if(!result.ok){
     if(result.error.code==='conflict'){await load(lifecycle);return}
     setView(value=>sameIdentity(value.identity,lifecycle.identity)?{...value,error:genericError(),mutating:false}:value)
     return
   }
   if(result.data.claimId!==lifecycle.identity.target.claimId||result.data.reaction!==reaction){setView(value=>sameIdentity(value.identity,lifecycle.identity)?{...value,error:genericError(),mutating:false}:value);return}
   retryIntent.current=null
   setView(value=>sameIdentity(value.identity,lifecycle.identity)&&value.phase==='ready'&&value.ready?{...value,mutating:false,ready:{...value.ready,claim:{...value.ready.claim,statusCode:result.data.status,statusLabel:result.data.status==='submitted'?'제보됨':result.data.status==='community_confirmed'?'커뮤니티 확인':'재확인 필요',confirmCount:result.data.confirmCount,disputeCount:result.data.disputeCount},actor:{...value.ready.actor,reaction:result.data.reaction}},notice:'반응이 반영되었습니다.'}:value)
 }

 if(visible.phase==='loading')return <Shell><h1>복지 제보 반응</h1><p role="status">제보와 내 반응을 확인하고 있습니다.</p></Shell>
 if(visible.phase==='error'||!visible.ready)return <Shell><h1>복지 제보 반응</h1><section className="benefit-service-alert" role="alert"><p>{visible.error??genericError()}</p><button type="button" onClick={()=>{const lifecycle=activeLifecycle.current;if(lifecycle&&sameIdentity(lifecycle.identity,identity))void load(lifecycle)}}>다시 시도</button></section></Shell>
 const {company,claim,actor}=visible.ready,pending=visible.mutating
 const actorLabel=actor.reaction==='confirm'?'나도 확인했어요':actor.reaction==='dispute'?'현재는 달라요':'아직 남기지 않음'
 return <Shell><a className="benefit-reaction-page__back" href={`/benefits/company/?id=${encodeURIComponent(company.companyId)}#claim-${claim.claimId}`}>기업 복지로 돌아가기</a><header className="benefit-service-heading"><p>{company.displayName} · 커뮤니티 제보</p><h1>{claim.title}</h1><p>{claim.description}</p></header><section className="benefit-reaction-page__snapshot" aria-label="현재 제보 상태"><p><strong>{claim.statusLabel}</strong></p><p>확인 {claim.confirmCount} · 이의 {claim.disputeCount}</p><p>내 반응: {actorLabel}</p></section>{actor.isSubmitter&&<section className="benefit-service-notice" id="self-confirm-help"><p>내가 제보한 내용은 직접 확인 반응을 남길 수 없습니다.</p><p>내용이 달라졌다면 이의를 남길 수 있지만, 내 제보 내역에서 제보 철회를 먼저 권장합니다.</p></section>}<div className="benefit-service-actions benefit-reaction-page__actions" aria-busy={pending}><button type="button" disabled={pending||actor.isSubmitter} aria-describedby={actor.isSubmitter?'self-confirm-help':undefined} onClick={()=>void react('confirm')}>나도 확인했어요</button><button type="button" disabled={pending} onClick={()=>void react('dispute')}>현재는 달라요</button><button type="button" className="benefit-service-secondary" disabled={pending||actor.reaction===null} onClick={()=>void react(null)}>반응 취소</button></div>{(pending||visible.notice)&&<p role="status" aria-live="polite">{pending?'반응을 반영하고 있습니다.':visible.notice}</p>}{visible.error&&<p role="alert">{visible.error}</p>}</Shell>
}
