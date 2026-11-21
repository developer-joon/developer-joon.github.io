import { isStrictUuid } from './uuid'
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
export type DraftLoadResult={state:'missing'}|{state:'invalid'}|{state:'unreadable'}|{state:'unavailable'}|{state:'denied'}|{state:'present';draft:BenefitSubmissionDraft;snapshot:string}
export type DraftSaveResult={ok:true;snapshot:string}|{ok:false;reason:'invalid'|'unavailable'}
type LoginIntentEnvelope={version:2;state:'pending';nonce:string;draft:string}|{version:2;state:'claimed';nonce:string;draft:string;actorScope:BenefitSubmissionAccountScope}

function record(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value)}
function exact(value:Record<string,unknown>,expected:readonly string[]){const a=Object.keys(value).sort(),b=[...expected].sort();return a.length===b.length&&a.every((key,index)=>key===b[index])}
function length(value:string){return Array.from(value).length}
function text(value:unknown,max:number):value is string{return typeof value==='string'&&length(value)<=max}
function scope(value:unknown):value is BenefitSubmissionAccountScope|'preauth'{return value==='preauth'||(typeof value==='string'&&SCOPE.test(value))}
function randomUuid(){const cryptoObject=globalThis.crypto;if(typeof cryptoObject?.randomUUID==='function')return cryptoObject.randomUUID();if(!cryptoObject?.getRandomValues)throw new Error('secure randomness unavailable');const bytes=cryptoObject.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`}
function parse(expected:BenefitSubmissionAccountScope|'preauth',value:unknown):BenefitSubmissionDraft|null{
  if(!scope(expected)||!record(value)||!exact(value,keys)||value.version!==1||value.accountScope!==expected||!isStrictUuid(value.clientKey)||typeof value.companyId!=='string'||(value.companyId!==''&&!/^(?:KR-CRN-[0-9]{13}|KR-BIZ-[0-9]{10})$/.test(value.companyId))||!text(value.companyName,200)||typeof value.categoryId!=='string'||(value.categoryId!==''&&!(BENEFIT_SUBMISSION_CATEGORIES as readonly string[]).includes(value.categoryId))||!text(value.benefitText,5000)||!text(value.eligibilityText,2000)||!text(value.conditionText,2000)||typeof value.sourceUrl!=='string'||(value.sourceUrl!==''&&!isBenefitSubmissionSourceUrl(value.sourceUrl))||!isBenefitSubmissionTimestamp(value.updatedAt)||Date.parse(value.updatedAt)>Date.now()+300_000)return null
  return {version:1,accountScope:expected,clientKey:value.clientKey.toLowerCase(),companyId:value.companyId,companyName:value.companyName,categoryId:value.categoryId as BenefitSubmissionDraft['categoryId'],benefitText:value.benefitText,eligibilityText:value.eligibilityText,conditionText:value.conditionText,sourceUrl:value.sourceUrl,updatedAt:value.updatedAt}
}
function serialize(expected:BenefitSubmissionAccountScope|'preauth',draft:BenefitSubmissionDraft){const parsed=parse(expected,draft);return parsed?JSON.stringify(parsed):null}
function parseRaw(expected:BenefitSubmissionAccountScope|'preauth',raw:string):BenefitSubmissionDraft|null{if(raw.length>MAX)return null;try{return parse(expected,JSON.parse(raw))}catch{return null}}
function accountLock(value:BenefitSubmissionAccountScope|'preauth'){return `${LOCK_PREFIX}:account:${value}`}
function intentLock(){return `${LOCK_PREFIX}:intent`}
async function locked<T>(adapter:BenefitSubmissionLockAdapter|undefined,name:string,callback:()=>Promise<T>|T):Promise<{ok:true;value:T}|{ok:false}>{if(!adapter)return {ok:false};try{return {ok:true,value:await adapter.request(name,callback)}}catch{return {ok:false}}}
function loadUnlocked(accountScope:BenefitSubmissionAccountScope|'preauth',storage:BenefitSubmissionDraftStorage):DraftLoadResult{let raw:string|null;try{raw=storage.getItem(benefitSubmissionDraftKey(accountScope))}catch{return {state:'unreadable'}}if(raw===null)return {state:'missing'};const draft=parseRaw(accountScope,raw);return draft?{state:'present',draft,snapshot:raw}:{state:'invalid'}}
function saveRawUnlocked(accountScope:BenefitSubmissionAccountScope|'preauth',raw:string,storage:BenefitSubmissionDraftStorage):DraftSaveResult{if(!parseRaw(accountScope,raw))return {ok:false,reason:'invalid'};try{const key=benefitSubmissionDraftKey(accountScope);storage.setItem(key,raw);if(storage.getItem(key)!==raw)return {ok:false,reason:'unavailable'};return {ok:true,snapshot:raw}}catch{return {ok:false,reason:'unavailable'}}}
function parseEnvelope(raw:string|null):LoginIntentEnvelope|null{if(raw===null||raw.length>ENVELOPE_MAX)return null;try{const value:unknown=JSON.parse(raw);if(!record(value)||value.version!==2||!isStrictUuid(value.nonce)||typeof value.draft!=='string'||!parseRaw('preauth',value.draft))return null;if(value.state==='pending'&&exact(value,['version','state','nonce','draft']))return value as LoginIntentEnvelope;if(value.state==='claimed'&&exact(value,['version','state','nonce','draft','actorScope'])&&scope(value.actorScope)&&value.actorScope!=='preauth')return value as LoginIntentEnvelope;return null}catch{return null}}
function writeEnvelope(storage:BenefitSubmissionDraftStorage,envelope:LoginIntentEnvelope){const raw=JSON.stringify(envelope);if(raw.length>ENVELOPE_MAX)return false;try{storage.setItem(LOGIN_INTENT_KEY,raw);return storage.getItem(LOGIN_INTENT_KEY)===raw}catch{return false}}

export function createBrowserBenefitSubmissionLockAdapter():BenefitSubmissionLockAdapter|undefined{
  const locks=(globalThis.navigator as Navigator&{locks?:{request<T>(name:string,options:{mode:'exclusive'},callback:()=>Promise<T>|T):Promise<T>}}|undefined)?.locks
  if(!locks||typeof locks.request!=='function')return undefined
  return {request:(name,callback)=>locks.request(name,{mode:'exclusive'},callback)}
}
export function benefitSubmissionDraftKey(value:BenefitSubmissionAccountScope|'preauth'){if(!scope(value))throw new Error('invalid account scope');return `${PREFIX}:${value}`}
export function createBenefitSubmissionDraft(accountScope:BenefitSubmissionAccountScope|'preauth',uuid:()=>string=randomUuid,now:()=>string=()=>new Date().toISOString()):BenefitSubmissionDraft{const value={version:1 as const,accountScope,clientKey:uuid(),companyId:'',companyName:'',categoryId:'' as const,benefitText:'',eligibilityText:'',conditionText:'',sourceUrl:'',updatedAt:now()};const parsed=parse(accountScope,value);if(!parsed)throw new Error('invalid draft identity');return parsed}
export async function loadBenefitSubmissionDraft(accountScope:BenefitSubmissionAccountScope|'preauth',storage?:BenefitSubmissionDraftStorage,adapter?:BenefitSubmissionLockAdapter):Promise<DraftLoadResult>{if(!storage)return {state:'unreadable'};const result=await locked(adapter,accountLock(accountScope),()=>loadUnlocked(accountScope,storage));return result.ok?result.value:{state:'unavailable'}}
export async function saveBenefitSubmissionDraft(accountScope:BenefitSubmissionAccountScope|'preauth',draft:BenefitSubmissionDraft,storage?:BenefitSubmissionDraftStorage,adapter?:BenefitSubmissionLockAdapter):Promise<DraftSaveResult>{if(!storage||!adapter)return {ok:false,reason:'unavailable'};const raw=serialize(accountScope,draft);if(raw===null||raw.length>MAX)return {ok:false,reason:'invalid'};const result=await locked(adapter,accountLock(accountScope),()=>saveRawUnlocked(accountScope,raw,storage));return result.ok?result.value:{ok:false,reason:'unavailable'}}
export async function clearBenefitSubmissionDraftIfSnapshot(accountScope:BenefitSubmissionAccountScope|'preauth',snapshot:string,storage?:BenefitSubmissionDraftStorage,adapter?:BenefitSubmissionLockAdapter){if(!storage||!adapter||typeof snapshot!=='string'||snapshot.length>MAX)return false;const result=await locked(adapter,accountLock(accountScope),()=>{try{const key=benefitSubmissionDraftKey(accountScope);if(storage.getItem(key)!==snapshot)return false;storage.removeItem(key);return storage.getItem(key)===null}catch{return false}});return result.ok&&result.value}
export async function markBenefitSubmissionLoginIntent(preauthSnapshot:string,sessionStorage?:BenefitSubmissionDraftStorage,adapter?:BenefitSubmissionLockAdapter,uuid:()=>string=randomUuid):Promise<{ok:true;nonce:string}|{ok:false;reason:'invalid'|'unavailable'}>{if(!sessionStorage||!adapter||typeof preauthSnapshot!=='string'||!parseRaw('preauth',preauthSnapshot))return {ok:false,reason:parseRaw('preauth',preauthSnapshot)?'unavailable':'invalid'};let nonce:string;try{nonce=uuid()}catch{return {ok:false,reason:'unavailable'}}if(!isStrictUuid(nonce))return {ok:false,reason:'invalid'};const envelope:LoginIntentEnvelope={version:2,state:'pending',nonce:nonce.toLowerCase(),draft:preauthSnapshot};const result=await locked(adapter,intentLock(),()=>writeEnvelope(sessionStorage,envelope));return result.ok&&result.value?{ok:true,nonce:envelope.nonce}:{ok:false,reason:'unavailable'}}
export async function claimPreAuthBenefitSubmissionDraft(accountScope:BenefitSubmissionAccountScope,nonce:string,storage?:BenefitSubmissionDraftStorage,sessionStorage?:BenefitSubmissionDraftStorage,adapter?:BenefitSubmissionLockAdapter,now:()=>string=()=>new Date().toISOString()):Promise<DraftLoadResult>{
  if(!storage||!sessionStorage||!adapter)return {state:'unavailable'};if(!scope(accountScope)||accountScope==='preauth'||!isStrictUuid(nonce))return {state:'missing'}
  const intent=await locked(adapter,intentLock(),async()=>{
    let raw:string|null;try{raw=sessionStorage.getItem(LOGIN_INTENT_KEY)}catch{return {state:'unreadable'} as DraftLoadResult}
    const envelope=parseEnvelope(raw);if(!envelope||envelope.nonce!==nonce.toLowerCase())return {state:'missing'} as DraftLoadResult
    if(envelope.state==='claimed'&&envelope.actorScope!==accountScope)return {state:'denied'} as DraftLoadResult
    const claimed:LoginIntentEnvelope=envelope.state==='pending'?{...envelope,state:'claimed',actorScope:accountScope}:envelope
    if(envelope.state==='pending'&&!writeEnvelope(sessionStorage,claimed))return {state:'unreadable'} as DraftLoadResult
    const source=parseRaw('preauth',claimed.draft);if(!source)return {state:'invalid'} as DraftLoadResult
    const draft=parse(accountScope,{...source,accountScope,updatedAt:now()});if(!draft)return {state:'invalid'} as DraftLoadResult
    const accountRaw=JSON.stringify(draft)
    const saved=await locked(adapter,accountLock(accountScope),()=>saveRawUnlocked(accountScope,accountRaw,storage));if(!saved.ok||!saved.value.ok)return {state:'unreadable'} as DraftLoadResult
    await locked(adapter,accountLock('preauth'),()=>{try{const preauthKey=benefitSubmissionDraftKey('preauth');if(storage.getItem(preauthKey)===claimed.draft){storage.removeItem(preauthKey);storage.getItem(preauthKey)}}catch{/* retained claimed envelope permits resume */}})
    try{if(sessionStorage.getItem(LOGIN_INTENT_KEY)===JSON.stringify(claimed)){sessionStorage.removeItem(LOGIN_INTENT_KEY);sessionStorage.getItem(LOGIN_INTENT_KEY)}}catch{/* cleanup is best effort after verified account write */}
    return {state:'present',draft,snapshot:accountRaw} as DraftLoadResult
  })
  return intent.ok?intent.value:{state:'unavailable'}
}
export async function withVerifiedBenefitSubmissionDraft<T>(accountScope:BenefitSubmissionAccountScope,expectedSnapshot:string,mutation:()=>Promise<T>,storage?:BenefitSubmissionDraftStorage,adapter?:BenefitSubmissionLockAdapter):Promise<{ok:true;value:T;cleared:boolean}|{ok:false;reason:'invalid'|'unavailable'|'changed'}>{
  if(!storage||!adapter)return {ok:false,reason:'unavailable'};if(typeof expectedSnapshot!=='string'||!parseRaw(accountScope,expectedSnapshot))return {ok:false,reason:'invalid'}
  const result=await locked(adapter,accountLock(accountScope),async()=>{let current:string|null;try{current=storage.getItem(benefitSubmissionDraftKey(accountScope))}catch{return {ok:false,reason:'unavailable'} as const}if(current!==expectedSnapshot)return {ok:false,reason:'changed'} as const;const value=await mutation();const cleared=(()=>{try{storage.removeItem(benefitSubmissionDraftKey(accountScope));return storage.getItem(benefitSubmissionDraftKey(accountScope))===null}catch{return false}})();return {ok:true,value,cleared} as const})
  return result.ok?result.value:{ok:false,reason:'unavailable'}
}
export function canonicalBenefitSubmissionDraft(draft:BenefitSubmissionDraft){const parsed=parse(draft.accountScope,draft);if(!parsed)return null;return {clientKey:parsed.clientKey,companyId:parsed.companyId,categoryId:parsed.categoryId,benefitText:parsed.benefitText.trim(),eligibilityText:parsed.eligibilityText.trim()||null,conditionText:parsed.conditionText.trim()||null,sourceUrl:parsed.sourceUrl.trim()||null}}
