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
type View = { generation:number; phase:'loading'|'ready'|'error'; ready?:Ready; error?:string; notice?:string }

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

interface Props{repository?:BenefitClaimRepository;directoryRepository?:BenefitDirectoryRepository;search?:string}
export function BenefitClaimReactionPage({repository=getBenefitClaimRepository(),directoryRepository=getBenefitDirectoryRepository(),search=window.location.search}:Props){
 const auth=useAuth(),target=targetFrom(search),actorId=auth.user?.id??null,sessionIdentity=`${auth.session?.access_token??String(auth.session?.expires_at??'')}:${auth.generation??0}`
 const generation=useRef(0),identity=useRef<{actorId:string|null;sessionIdentity:string;target:Target|null;repository:BenefitClaimRepository;directoryRepository:BenefitDirectoryRepository}|null>(null)
 const operation=useRef<{generation:number;reaction:BenefitClaimReaction|null}|null>(null)
 const retryIntent=useRef<{reaction:BenefitClaimReaction|null;clientKey:string}|null>(null)
 const nextIdentity={actorId,sessionIdentity,target,repository,directoryRepository},previous=identity.current
 if(!previous||previous.actorId!==actorId||previous.sessionIdentity!==sessionIdentity||previous.target?.companyId!==target?.companyId||previous.target?.claimId!==target?.claimId||previous.repository!==repository||previous.directoryRepository!==directoryRepository){identity.current=nextIdentity;generation.current+=1;operation.current=null;retryIntent.current=null}
 const currentGeneration=generation.current
 const [view,setView]=useState<View>({generation:currentGeneration,phase:'loading'})
 const visible=view.generation===currentGeneration?view:{generation:currentGeneration,phase:'loading' as const}

 async function load(captured:number,controller?:AbortController){
   if(!target||!actorId)return
   setView({generation:captured,phase:'loading'})
   try{
     const publicResult=await directoryRepository.detail(target.companyId,controller?.signal)
     if(captured!==generation.current||controller?.signal.aborted)return
     if(!publicResult.ok||publicResult.data.company.companyId!==target.companyId){setView({generation:captured,phase:'error',error:genericError()});return}
     const claim=pageClaim(publicResult.data.claims.find(item=>item.claimId===target.claimId))
     if(!claim){setView({generation:captured,phase:'error',error:'요청한 복지 제보를 찾을 수 없습니다.'});return}
     const actorResult=await repository.getReaction({claimId:target.claimId},controller?.signal)
     if(captured!==generation.current||controller?.signal.aborted)return
     if(!actorResult.ok||actorResult.data.claimId!==target.claimId){setView({generation:captured,phase:'error',error:genericError()});return}
     setView({generation:captured,phase:'ready',ready:{company:publicResult.data.company,claim,actor:actorResult.data}})
   }catch{if(captured===generation.current&&!controller?.signal.aborted)setView({generation:captured,phase:'error',error:genericError()})}
 }

 useEffect(()=>{
   const captured=currentGeneration,controller=new AbortController()
   if(target&&actorId)void load(captured,controller)
   return()=>{controller.abort();if(generation.current===captured){generation.current+=1;operation.current=null;retryIntent.current=null}}
 // load intentionally binds to the identity values below.
 },[actorId,currentGeneration,directoryRepository,repository,sessionIdentity,target?.claimId,target?.companyId])

 async function react(reaction:BenefitClaimReaction|null){
   if(!target||!actorId||visible.phase!=='ready'||!visible.ready||operation.current||reaction==='confirm'&&visible.ready.actor.isSubmitter)return
   const captured=generation.current
   const intent=retryIntent.current?.reaction===reaction?retryIntent.current:{reaction,clientKey:crypto.randomUUID()}
   retryIntent.current=intent
   operation.current={generation:captured,reaction}
   setView(value=>value.generation===captured?{...value,error:undefined,notice:undefined}:value)
   const result=await repository.setReaction({claimId:target.claimId,reaction,clientKey:intent.clientKey})
   if(captured!==generation.current||operation.current?.generation!==captured||operation.current.reaction!==reaction)return
   operation.current=null
   if(!result.ok){
     if(result.error.code==='conflict'){
       const controller=new AbortController()
       await load(captured,controller)
       return
     }
     setView(value=>value.generation===captured?{...value,error:genericError()}:value)
     return
   }
   if(result.data.claimId!==target.claimId||result.data.reaction!==reaction)return setView(value=>value.generation===captured?{...value,error:genericError()}:value)
   retryIntent.current=null
   setView(value=>value.generation===captured&&value.phase==='ready'&&value.ready?{...value,ready:{...value.ready,claim:{...value.ready.claim,statusCode:result.data.status,statusLabel:result.data.status==='submitted'?'제보됨':result.data.status==='community_confirmed'?'커뮤니티 확인':'재확인 필요',confirmCount:result.data.confirmCount,disputeCount:result.data.disputeCount},actor:{...value.ready.actor,reaction:result.data.reaction}},notice:'반응이 반영되었습니다.'}:value)
 }

 if(auth.loading)return <Shell><h1>복지 제보 반응</h1><p role="status">로그인 상태를 확인하고 있습니다.</p></Shell>
 if(!target)return <Shell><h1>복지 제보 반응</h1><section className="benefit-service-alert" role="alert"><p>기업과 제보 식별자를 확인할 수 없습니다.</p></section></Shell>
 if(!actorId)return <Shell><h1>복지 제보 반응</h1><section className="benefit-service-gate"><p>확인 또는 이의 반응은 Google 로그인 후 남길 수 있습니다.</p><button type="button" disabled={auth.pending} onClick={()=>void auth.signIn(DEFAULT_AUTH_PROVIDER,`${reactionPath}?${new URLSearchParams({company:target.companyId,claim:target.claimId})}`)}>Google로 로그인하고 계속</button>{auth.error&&<p role="alert">로그인을 완료하지 못했습니다.</p>}</section></Shell>
 if(visible.phase==='loading')return <Shell><h1>복지 제보 반응</h1><p role="status">제보와 내 반응을 확인하고 있습니다.</p></Shell>
 if(visible.phase==='error'||!visible.ready)return <Shell><h1>복지 제보 반응</h1><section className="benefit-service-alert" role="alert"><p>{visible.error??genericError()}</p><button type="button" onClick={()=>void load(generation.current)}>다시 시도</button></section></Shell>
 const {company,claim,actor}=visible.ready,pending=operation.current?.generation===currentGeneration
 const actorLabel=actor.reaction==='confirm'?'나도 확인했어요':actor.reaction==='dispute'?'현재는 달라요':'아직 남기지 않음'
 return <Shell><a className="benefit-reaction-page__back" href={`/benefits/company/?id=${encodeURIComponent(company.companyId)}#claim-${claim.claimId}`}>기업 복지로 돌아가기</a><header className="benefit-service-heading"><p>{company.displayName} · 커뮤니티 제보</p><h1>{claim.title}</h1><p>{claim.description}</p></header><section className="benefit-reaction-page__snapshot" aria-label="현재 제보 상태"><p><strong>{claim.statusLabel}</strong></p><p>확인 {claim.confirmCount} · 이의 {claim.disputeCount}</p><p>내 반응: {actorLabel}</p></section>{actor.isSubmitter&&<section className="benefit-service-notice" id="self-confirm-help"><p>내가 제보한 내용은 직접 확인 반응을 남길 수 없습니다.</p><p>내용이 달라졌다면 이의를 남길 수 있지만, 내 제보 내역에서 제보 철회를 먼저 권장합니다.</p></section>}<div className="benefit-service-actions benefit-reaction-page__actions"><button type="button" disabled={pending||actor.isSubmitter} aria-describedby={actor.isSubmitter?'self-confirm-help':undefined} onClick={()=>void react('confirm')}>나도 확인했어요</button><button type="button" disabled={pending} onClick={()=>void react('dispute')}>현재는 달라요</button><button type="button" className="benefit-service-secondary" disabled={pending||actor.reaction===null} onClick={()=>void react(null)}>반응 취소</button></div>{visible.notice&&<p role="status">{visible.notice}</p>}{visible.error&&<p role="alert">{visible.error}</p>}</Shell>
}
