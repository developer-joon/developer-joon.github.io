import { isStrictUuid } from './uuid'
import { isBenefitCompanyId } from './benefitCompanyId'
import { isBenefitSubmissionSourceUrl, isBenefitSubmissionTimestamp } from '../data/benefitSubmissionRepository'
import { BENEFIT_SUBMISSION_CATEGORIES, type BenefitSubmissionAccountScope, type BenefitSubmissionDraft } from '../types/benefitSubmissions'

const PREFIX='breadlab:benefit-submission:draft:v1'
const LOGIN_INTENT_KEY='breadlab:benefit-submission:login-intent:v2'
const LOCK_PREFIX='breadlab:benefit-submission:lock:v2'
const SCOPE=/^[0-9a-f]{64}$/
const MAX=40_000
const ENVELOPE_MAX=45_000
const keys=['version','accountScope','clientKey','companyId','companyName','categoryId','benefitText','eligibilityText','conditionText','sourceUrl','updatedAt'] as const
export type BenefitSubmissionDraftStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'>
export interface BenefitSubmissionLockAdapter { request<T>(name:string,callback:()=>Promise<T>|T):Promise<T> }
export type InvalidDraftKind='invalid'|'future_version'
export type DraftLoadResult={state:'missing'}|{state:'invalid';kind:InvalidDraftKind;snapshotId:string}|{state:'unreadable'}|{state:'unavailable'}|{state:'denied'}|{state:'present';draft:BenefitSubmissionDraft;snapshot:string}
export type DraftSaveResult={ok:true;snapshot:string}|{ok:false;reason:'invalid'|'unavailable'}
export type DraftClaimResult={state:'missing'}|{state:'invalid'}|{state:'unreadable'}|{state:'unavailable'}|{state:'denied'}|{state:'present';draft:BenefitSubmissionDraft;snapshot:string}
  |{state:'cleanup_failed';draft:BenefitSubmissionDraft;snapshot:string}
  |{state:'conflict';accountDraft:BenefitSubmissionDraft;accountSnapshot:string;preauthDraft:BenefitSubmissionDraft;preauthSnapshot:string}
  |{state:'account_invalid';kind:InvalidDraftKind;snapshotId:string}
export type ConditionalClearResult={state:'cleared'}|{state:'changed'}|{state:'invalid'}|{state:'unavailable'}
export type InvalidDraftResetResult={state:'reset';draft:BenefitSubmissionDraft;snapshot:string}|{state:'changed'}|{state:'unavailable'}
export type ClaimedDraftRestoreResult={state:'restored';draft:BenefitSubmissionDraft;snapshot:string}|{state:'cleanup_failed';draft:BenefitSubmissionDraft;snapshot:string}|{state:'conflict'}|{state:'missing'}|{state:'denied'}|{state:'unavailable'}
export type VerifiedMutationResult<T>={state:'mutation_not_dispatched';reason:'invalid'|'unavailable'|'changed'}|{state:'mutation_failed';error:unknown}|{state:'mutation_succeeded_cleared';value:T}|{state:'mutation_succeeded_cleanup_failed';value:T;snapshot:string}
export type MutationDispatchResult<T>={ok:true;value:T}|{ok:false;error:unknown}
type LoginIntentEnvelope={version:2;state:'pending';nonce:string;draft:string}|{version:2;state:'claimed';nonce:string;draft:string;actorScope:BenefitSubmissionAccountScope}
type LockResult<T>={ok:true;value:T}|{ok:false}

function record(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value)}
function exact(value:Record<string,unknown>,expected:readonly string[]){const a=Object.keys(value).sort(),b=[...expected].sort();return a.length===b.length&&a.every((key,index)=>key===b[index])}
function length(value:string){return Array.from(value).length}
function text(value:unknown,max:number):value is string{return typeof value==='string'&&length(value)<=max}
function scope(value:unknown):value is BenefitSubmissionAccountScope|'preauth'{return value==='preauth'||(typeof value==='string'&&SCOPE.test(value))}
function randomUuid(){const cryptoObject=globalThis.crypto;if(typeof cryptoObject?.randomUUID==='function')return cryptoObject.randomUUID();if(!cryptoObject?.getRandomValues)throw new Error('secure randomness unavailable');const bytes=cryptoObject.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`}
function parse(expected:BenefitSubmissionAccountScope|'preauth',value:unknown):BenefitSubmissionDraft|null{
  if(!scope(expected)||!record(value)||!exact(value,keys)||value.version!==1||value.accountScope!==expected||!isStrictUuid(value.clientKey)||typeof value.companyId!=='string'||(value.companyId!==''&&!isBenefitCompanyId(value.companyId))||!text(value.companyName,200)||typeof value.categoryId!=='string'||(value.categoryId!==''&&!(BENEFIT_SUBMISSION_CATEGORIES as readonly string[]).includes(value.categoryId))||!text(value.benefitText,5000)||!text(value.eligibilityText,2000)||!text(value.conditionText,2000)||typeof value.sourceUrl!=='string'||(value.sourceUrl!==''&&!isBenefitSubmissionSourceUrl(value.sourceUrl))||!isBenefitSubmissionTimestamp(value.updatedAt)||Date.parse(value.updatedAt)>Date.now()+300_000)return null
  return {version:1,accountScope:expected,clientKey:value.clientKey.toLowerCase(),companyId:value.companyId,companyName:value.companyName,categoryId:value.categoryId as BenefitSubmissionDraft['categoryId'],benefitText:value.benefitText,eligibilityText:value.eligibilityText,conditionText:value.conditionText,sourceUrl:value.sourceUrl,updatedAt:value.updatedAt}
}
function serialize(expected:BenefitSubmissionAccountScope|'preauth',draft:BenefitSubmissionDraft){const parsed=parse(expected,draft);return parsed?JSON.stringify(parsed):null}
function parseRaw(expected:BenefitSubmissionAccountScope|'preauth',raw:string):BenefitSubmissionDraft|null{if(raw.length>MAX)return null;try{return parse(expected,JSON.parse(raw))}catch{return null}}
function accountLock(value:BenefitSubmissionAccountScope|'preauth'){return `${LOCK_PREFIX}:account:${value}`}
function intentLock(){return `${LOCK_PREFIX}:intent`}
async function locked<T>(adapter:BenefitSubmissionLockAdapter|undefined,name:string,callback:()=>Promise<T>|T):Promise<LockResult<T>>{
  if(!adapter)return {ok:false}
  let callbackStarted=false
  try{return {ok:true,value:await adapter.request(name,()=>{callbackStarted=true;return callback()})}}
  catch(error){if(callbackStarted)throw error;return {ok:false}}
}
async function snapshotIdentity(accountScope:BenefitSubmissionAccountScope|'preauth',raw:string){
  const subtle=globalThis.crypto?.subtle
  if(!subtle)throw new Error('cryptographic digest unavailable')
  const digest=await subtle.digest('SHA-256',new TextEncoder().encode(`${accountScope}\0${raw}`))
  return [...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('')
}
function invalidKind(raw:string):InvalidDraftKind{try{const value:unknown=JSON.parse(raw);return record(value)&&typeof value.version==='number'&&value.version>1?'future_version':'invalid'}catch{return 'invalid'}}
async function loadUnlocked(accountScope:BenefitSubmissionAccountScope|'preauth',storage:BenefitSubmissionDraftStorage):Promise<DraftLoadResult>{let raw:string|null;try{raw=storage.getItem(benefitSubmissionDraftKey(accountScope))}catch{return {state:'unreadable'}}if(raw===null)return {state:'missing'};const draft=parseRaw(accountScope,raw);if(draft)return {state:'present',draft,snapshot:raw};try{return {state:'invalid',kind:invalidKind(raw),snapshotId:await snapshotIdentity(accountScope,raw)}}catch{return {state:'unavailable'}}}
function saveRawUnlocked(accountScope:BenefitSubmissionAccountScope|'preauth',raw:string,storage:BenefitSubmissionDraftStorage):DraftSaveResult{if(!parseRaw(accountScope,raw))return {ok:false,reason:'invalid'};try{const key=benefitSubmissionDraftKey(accountScope);storage.setItem(key,raw);if(storage.getItem(key)!==raw)return {ok:false,reason:'unavailable'};return {ok:true,snapshot:raw}}catch{return {ok:false,reason:'unavailable'}}}
function parseEnvelope(raw:string|null):LoginIntentEnvelope|null{if(raw===null||raw.length>ENVELOPE_MAX)return null;try{const value:unknown=JSON.parse(raw);if(!record(value)||value.version!==2||!isStrictUuid(value.nonce)||typeof value.draft!=='string'||!parseRaw('preauth',value.draft))return null;if(value.state==='pending'&&exact(value,['version','state','nonce','draft']))return value as LoginIntentEnvelope;if(value.state==='claimed'&&exact(value,['version','state','nonce','draft','actorScope'])&&scope(value.actorScope)&&value.actorScope!=='preauth')return value as LoginIntentEnvelope;return null}catch{return null}}
function writeEnvelope(storage:BenefitSubmissionDraftStorage,envelope:LoginIntentEnvelope){const raw=JSON.stringify(envelope);if(raw.length>ENVELOPE_MAX)return false;try{storage.setItem(LOGIN_INTENT_KEY,raw);return storage.getItem(LOGIN_INTENT_KEY)===raw}catch{return false}}
function removeExact(storage:BenefitSubmissionDraftStorage,key:string,expected:string):'removed'|'changed'|'unavailable'{try{if(storage.getItem(key)!==expected)return 'changed';storage.removeItem(key);return storage.getItem(key)===null?'removed':'unavailable'}catch{return 'unavailable'}}

export function createBrowserBenefitSubmissionLockAdapter():BenefitSubmissionLockAdapter|undefined{
  const locks=(globalThis.navigator as Navigator&{locks?:{request<T>(name:string,options:{mode:'exclusive'},callback:()=>Promise<T>|T):Promise<T>}}|undefined)?.locks
  if(!locks||typeof locks.request!=='function')return undefined
  return {request:(name,callback)=>locks.request(name,{mode:'exclusive'},callback)}
}
export function benefitSubmissionDraftKey(value:BenefitSubmissionAccountScope|'preauth'){if(!scope(value))throw new Error('invalid account scope');return `${PREFIX}:${value}`}
export function createBenefitSubmissionDraft(accountScope:BenefitSubmissionAccountScope|'preauth',uuid:()=>string=randomUuid,now:()=>string=()=>new Date().toISOString()):BenefitSubmissionDraft{const value={version:1 as const,accountScope,clientKey:uuid(),companyId:'',companyName:'',categoryId:'' as const,benefitText:'',eligibilityText:'',conditionText:'',sourceUrl:'',updatedAt:now()};const parsed=parse(accountScope,value);if(!parsed)throw new Error('invalid draft identity');return parsed}
export async function loadBenefitSubmissionDraft(accountScope:BenefitSubmissionAccountScope|'preauth',storage?:BenefitSubmissionDraftStorage,adapter?:BenefitSubmissionLockAdapter):Promise<DraftLoadResult>{if(!storage)return {state:'unreadable'};const result=await locked(adapter,accountLock(accountScope),()=>loadUnlocked(accountScope,storage));return result.ok?result.value:{state:'unavailable'}}
export async function saveBenefitSubmissionDraft(accountScope:BenefitSubmissionAccountScope|'preauth',draft:BenefitSubmissionDraft,storage?:BenefitSubmissionDraftStorage,adapter?:BenefitSubmissionLockAdapter):Promise<DraftSaveResult>{if(!storage||!adapter)return {ok:false,reason:'unavailable'};const raw=serialize(accountScope,draft);if(raw===null||raw.length>MAX)return {ok:false,reason:'invalid'};const result=await locked(adapter,accountLock(accountScope),()=>saveRawUnlocked(accountScope,raw,storage));return result.ok?result.value:{ok:false,reason:'unavailable'}}
export async function clearBenefitSubmissionDraftIfSnapshot(accountScope:BenefitSubmissionAccountScope|'preauth',snapshot:string,storage?:BenefitSubmissionDraftStorage,adapter?:BenefitSubmissionLockAdapter):Promise<ConditionalClearResult>{
  if(!storage||!adapter)return {state:'unavailable'}
  if(typeof snapshot!=='string'||snapshot.length>MAX||!parseRaw(accountScope,snapshot))return {state:'invalid'}
  const result=await locked(adapter,accountLock(accountScope),()=>{const removed=removeExact(storage,benefitSubmissionDraftKey(accountScope),snapshot);return removed==='removed'?{state:'cleared' as const}:removed==='changed'?{state:'changed' as const}:{state:'unavailable' as const}})
  return result.ok?result.value:{state:'unavailable'}
}
export async function markBenefitSubmissionLoginIntent(preauthSnapshot:string,sessionStorage?:BenefitSubmissionDraftStorage,adapter?:BenefitSubmissionLockAdapter,uuid:()=>string=randomUuid):Promise<{ok:true;nonce:string}|{ok:false;reason:'invalid'|'unavailable'}>{
  if(!sessionStorage||!adapter)return {ok:false,reason:'unavailable'}
  const result=await locked(adapter,intentLock(),():{ok:true;nonce:string}|{ok:false;reason:'invalid'|'unavailable'}=>{
    let raw:string|null
    try{raw=sessionStorage.getItem(LOGIN_INTENT_KEY)}catch{return {ok:false,reason:'unavailable'}}
    if(raw!==null){
      const existing=parseEnvelope(raw)
      if(!existing)return {ok:false,reason:'invalid'}
      if(existing.state==='claimed')return {ok:true,nonce:existing.nonce}
      if(typeof preauthSnapshot!=='string'||!parseRaw('preauth',preauthSnapshot))return {ok:false,reason:'invalid'}
      if(existing.draft===preauthSnapshot)return {ok:true,nonce:existing.nonce}
      const updated:LoginIntentEnvelope={...existing,draft:preauthSnapshot}
      return writeEnvelope(sessionStorage,updated)?{ok:true,nonce:updated.nonce}:{ok:false,reason:'unavailable'}
    }
    if(typeof preauthSnapshot!=='string'||!parseRaw('preauth',preauthSnapshot))return {ok:false,reason:'invalid'}
    let nonce:string
    try{nonce=uuid()}catch{return {ok:false,reason:'unavailable'}}
    if(!isStrictUuid(nonce))return {ok:false,reason:'invalid'}
    const envelope:LoginIntentEnvelope={version:2,state:'pending',nonce:nonce.toLowerCase(),draft:preauthSnapshot}
    return writeEnvelope(sessionStorage,envelope)?{ok:true,nonce:envelope.nonce}:{ok:false,reason:'unavailable'}
  })
  return result.ok?result.value:{ok:false,reason:'unavailable'}
}

export async function resetInvalidBenefitSubmissionDraft(accountScope:BenefitSubmissionAccountScope|'preauth',expectedSnapshotId:string,storage?:BenefitSubmissionDraftStorage,adapter?:BenefitSubmissionLockAdapter,uuid:()=>string=randomUuid,now:()=>string=()=>new Date().toISOString()):Promise<InvalidDraftResetResult>{
  if(!storage||!adapter||!scope(accountScope)||!/^[0-9a-f]{64}$/.test(expectedSnapshotId))return {state:'unavailable'}
  const result=await locked(adapter,accountLock(accountScope),async():Promise<InvalidDraftResetResult>=>{
    const key=benefitSubmissionDraftKey(accountScope)
    let raw:string|null
    try{raw=storage.getItem(key)}catch{return {state:'unavailable'}}
    if(raw===null||parseRaw(accountScope,raw))return {state:'changed'}
    let currentId:string
    try{currentId=await snapshotIdentity(accountScope,raw)}catch{return {state:'unavailable'}}
    if(currentId!==expectedSnapshotId)return {state:'changed'}
    let fresh:BenefitSubmissionDraft,freshRaw:string|null
    try{fresh=createBenefitSubmissionDraft(accountScope,uuid,now);freshRaw=serialize(accountScope,fresh)}catch{return {state:'unavailable'}}
    if(!freshRaw)return {state:'unavailable'}
    try{storage.setItem(key,freshRaw)}catch{/* classify the bytes that survived below */}
    let current:string|null
    try{current=storage.getItem(key)}catch{return {state:'unavailable'}}
    if(current===freshRaw)return {state:'reset',draft:fresh,snapshot:freshRaw}
    return current===raw||current===null?{state:'unavailable'}:{state:'changed'}
  })
  return result.ok?result.value:{state:'unavailable'}
}
export async function claimPreAuthBenefitSubmissionDraft(accountScope:BenefitSubmissionAccountScope,nonce:string,storage?:BenefitSubmissionDraftStorage,sessionStorage?:BenefitSubmissionDraftStorage,adapter?:BenefitSubmissionLockAdapter,now:()=>string=()=>new Date().toISOString()):Promise<DraftClaimResult>{
  if(!storage||!sessionStorage||!adapter)return {state:'unavailable'}
  if(!scope(accountScope)||accountScope==='preauth'||!isStrictUuid(nonce))return {state:'missing'}
  const intent=await locked(adapter,intentLock(),async():Promise<DraftClaimResult>=>{
    let envelopeRaw:string|null
    try{envelopeRaw=sessionStorage.getItem(LOGIN_INTENT_KEY)}catch{return {state:'unreadable'}}
    const envelope=parseEnvelope(envelopeRaw)
    if(!envelope||envelope.nonce!==nonce.toLowerCase())return {state:'missing'}
    if(envelope.state==='claimed'&&envelope.actorScope!==accountScope)return {state:'denied'}
    const claimed:LoginIntentEnvelope=envelope.state==='pending'?{...envelope,state:'claimed',actorScope:accountScope}:envelope
    const claimedRaw=JSON.stringify(claimed)
    if(envelope.state==='pending'&&!writeEnvelope(sessionStorage,claimed))return {state:'unreadable'}
    const source=parseRaw('preauth',claimed.draft)
    if(!source)return {state:'invalid'}
    const transferred=parse(accountScope,{...source,accountScope,updatedAt:now()})
    if(!transferred)return {state:'invalid'}
    const transferredRaw=JSON.stringify(transferred)
    const classified=await locked(adapter,accountLock(accountScope),async():Promise<DraftClaimResult>=>{
      let current:string|null
      try{current=storage.getItem(benefitSubmissionDraftKey(accountScope))}catch{return {state:'unreadable'}}
      if(current===null){const saved=saveRawUnlocked(accountScope,transferredRaw,storage);return saved.ok?{state:'present',draft:transferred,snapshot:saved.snapshot}:{state:'unreadable'}}
      const accountDraft=parseRaw(accountScope,current)
      if(!accountDraft){try{return {state:'account_invalid',kind:invalidKind(current),snapshotId:await snapshotIdentity(accountScope,current)}}catch{return {state:'unavailable'}}}
      if(accountDraft.clientKey!==source.clientKey)return {state:'conflict',accountDraft,accountSnapshot:current,preauthDraft:source,preauthSnapshot:claimed.draft}
      return {state:'present',draft:accountDraft,snapshot:current}
    })
    if(!classified.ok)return {state:'unavailable'}
    if(classified.value.state!=='present')return classified.value
    const preauthCleanup=await locked(adapter,accountLock('preauth'),()=>{
      let current:string|null
      try{current=storage.getItem(benefitSubmissionDraftKey('preauth'))}catch{return false}
      if(current!==claimed.draft)return true
      return removeExact(storage,benefitSubmissionDraftKey('preauth'),claimed.draft)==='removed'
    })
    if(!preauthCleanup.ok||!preauthCleanup.value)return {state:'cleanup_failed',draft:classified.value.draft,snapshot:classified.value.snapshot}
    if(removeExact(sessionStorage,LOGIN_INTENT_KEY,claimedRaw)!=='removed')return {state:'cleanup_failed',draft:classified.value.draft,snapshot:classified.value.snapshot}
    return classified.value
  })
  return intent.ok?intent.value:{state:'unavailable'}
}
export async function restoreClaimedPreAuthBenefitSubmissionDraft(accountScope:BenefitSubmissionAccountScope,nonce:string,expectedSnapshotId:string,storage?:BenefitSubmissionDraftStorage,sessionStorage?:BenefitSubmissionDraftStorage,adapter?:BenefitSubmissionLockAdapter):Promise<ClaimedDraftRestoreResult>{
  if(!storage||!sessionStorage||!adapter||!scope(accountScope)||accountScope==='preauth'||!isStrictUuid(nonce)||!/^[0-9a-f]{64}$/.test(expectedSnapshotId))return {state:'unavailable'}
  const result=await locked(adapter,intentLock(),async():Promise<ClaimedDraftRestoreResult>=>{
    let envelopeRaw:string|null
    try{envelopeRaw=sessionStorage.getItem(LOGIN_INTENT_KEY)}catch{return {state:'unavailable'}}
    const envelope=parseEnvelope(envelopeRaw)
    if(!envelope||envelope.nonce!==nonce.toLowerCase())return {state:'missing'}
    if(envelope.state!=='claimed'||envelope.actorScope!==accountScope)return {state:'denied'}
    const source=parseRaw('preauth',envelope.draft)
    if(!source)return {state:'unavailable'}
    const restored=parse(accountScope,{...source,accountScope})
    if(!restored)return {state:'unavailable'}
    const restoredRaw=JSON.stringify(restored),key=benefitSubmissionDraftKey(accountScope)
    const account=await locked(adapter,accountLock(accountScope),async():Promise<'restored'|'conflict'|'unavailable'>=>{
      let current:string|null
      try{current=storage.getItem(key)}catch{return 'unavailable'}
      if(current===restoredRaw)return 'restored'
      if(current===null||parseRaw(accountScope,current))return 'conflict'
      let currentId:string
      try{currentId=await snapshotIdentity(accountScope,current)}catch{return 'unavailable'}
      if(currentId!==expectedSnapshotId)return 'conflict'
      try{storage.setItem(key,restoredRaw)}catch{/* inspect without rollback */}
      try{current=storage.getItem(key)}catch{return 'unavailable'}
      if(current===restoredRaw)return 'restored'
      return current===null||currentId===await snapshotIdentity(accountScope,current).catch(()=> '')?'unavailable':'conflict'
    })
    if(!account.ok||account.value==='unavailable')return {state:'unavailable'}
    if(account.value==='conflict')return {state:'conflict'}
    if(removeExact(sessionStorage,LOGIN_INTENT_KEY,envelopeRaw!)!=='removed')return {state:'cleanup_failed',draft:restored,snapshot:restoredRaw}
    return {state:'restored',draft:restored,snapshot:restoredRaw}
  })
  return result.ok?result.value:{state:'unavailable'}
}
export async function discardClaimedPreAuthBenefitSubmissionIntent(accountScope:BenefitSubmissionAccountScope,nonce:string,sessionStorage?:BenefitSubmissionDraftStorage,adapter?:BenefitSubmissionLockAdapter):Promise<{state:'discarded'}|{state:'missing'}|{state:'denied'}|{state:'unavailable'}>{
  if(!sessionStorage||!adapter||!scope(accountScope)||accountScope==='preauth'||!isStrictUuid(nonce))return {state:'unavailable'}
  const result=await locked(adapter,intentLock(),()=>{
    let raw:string|null
    try{raw=sessionStorage.getItem(LOGIN_INTENT_KEY)}catch{return {state:'unavailable' as const}}
    const envelope=parseEnvelope(raw)
    if(!envelope||envelope.nonce!==nonce.toLowerCase())return {state:'missing' as const}
    if(envelope.state!=='claimed'||envelope.actorScope!==accountScope)return {state:'denied' as const}
    return removeExact(sessionStorage,LOGIN_INTENT_KEY,raw!)==='removed'?{state:'discarded' as const}:{state:'unavailable' as const}
  })
  return result.ok?result.value:{state:'unavailable'}
}
export async function discardClaimedPreAuthBenefitSubmissionDraft(accountScope:BenefitSubmissionAccountScope,nonce:string,storage?:BenefitSubmissionDraftStorage,sessionStorage?:BenefitSubmissionDraftStorage,adapter?:BenefitSubmissionLockAdapter):Promise<{state:'discarded'}|{state:'missing'}|{state:'denied'}|{state:'unavailable'}>{
  if(!storage||!sessionStorage||!adapter||!scope(accountScope)||accountScope==='preauth'||!isStrictUuid(nonce))return {state:'unavailable'}
  const result=await locked(adapter,intentLock(),async()=>{
    let raw:string|null
    try{raw=sessionStorage.getItem(LOGIN_INTENT_KEY)}catch{return {state:'unavailable' as const}}
    const envelope=parseEnvelope(raw)
    if(!envelope||envelope.nonce!==nonce.toLowerCase())return {state:'missing' as const}
    if(envelope.state!=='claimed'||envelope.actorScope!==accountScope)return {state:'denied' as const}
    const preauth=await locked(adapter,accountLock('preauth'),()=>{let current:string|null;try{current=storage.getItem(benefitSubmissionDraftKey('preauth'))}catch{return false}if(current!==envelope.draft)return true;return removeExact(storage,benefitSubmissionDraftKey('preauth'),envelope.draft)==='removed'})
    if(!preauth.ok||!preauth.value)return {state:'unavailable' as const}
    return removeExact(sessionStorage,LOGIN_INTENT_KEY,raw!)==='removed'?{state:'discarded' as const}:{state:'unavailable' as const}
  })
  return result.ok?result.value:{state:'unavailable'}
}
export async function withVerifiedBenefitSubmissionDraft<T>(accountScope:BenefitSubmissionAccountScope,expectedSnapshot:string,mutation:()=>Promise<MutationDispatchResult<T>>,storage?:BenefitSubmissionDraftStorage,adapter?:BenefitSubmissionLockAdapter):Promise<VerifiedMutationResult<T>>{
  if(!storage||!adapter)return {state:'mutation_not_dispatched',reason:'unavailable'}
  if(typeof expectedSnapshot!=='string'||!parseRaw(accountScope,expectedSnapshot))return {state:'mutation_not_dispatched',reason:'invalid'}
  const result=await locked(adapter,accountLock(accountScope),async():Promise<VerifiedMutationResult<T>>=>{
    let current:string|null
    try{current=storage.getItem(benefitSubmissionDraftKey(accountScope))}catch{return {state:'mutation_not_dispatched',reason:'unavailable'}}
    if(current!==expectedSnapshot)return {state:'mutation_not_dispatched',reason:'changed'}
    const dispatched=await mutation()
    if(!dispatched.ok)return {state:'mutation_failed',error:dispatched.error}
    const value=dispatched.value
    const cleared=removeExact(storage,benefitSubmissionDraftKey(accountScope),expectedSnapshot)==='removed'
    return cleared?{state:'mutation_succeeded_cleared',value}:{state:'mutation_succeeded_cleanup_failed',value,snapshot:expectedSnapshot}
  })
  return result.ok?result.value:{state:'mutation_not_dispatched',reason:'unavailable'}
}
export function canonicalBenefitSubmissionDraft(draft:BenefitSubmissionDraft){const parsed=parse(draft.accountScope,draft);if(!parsed)return null;return {clientKey:parsed.clientKey,companyId:parsed.companyId,categoryId:parsed.categoryId,benefitText:parsed.benefitText.trim(),eligibilityText:parsed.eligibilityText.trim()||null,conditionText:parsed.conditionText.trim()||null,sourceUrl:parsed.sourceUrl.trim()||null}}
