import { parseEnv } from '../config/env'
import { getSupabaseClient } from '../lib/supabase'
import { isCanonicalUuid, isStrictUuid } from '../lib/uuid'
import { BENEFIT_SUBMISSION_CATEGORIES, BENEFIT_SUBMISSION_STATUSES, type BenefitSubmissionAccountScope, type BenefitSubmissionCategory, type BenefitSubmissionCursor, type BenefitSubmissionErrorCode, type BenefitSubmissionItem, type BenefitSubmissionListInput, type BenefitSubmissionPage, type BenefitSubmissionResult, type CreateBenefitSubmissionInput } from '../types/benefitSubmissions'

export interface BenefitSubmissionRpcResponse { data: unknown; error: unknown; status: number; statusText: string }
export interface BenefitSubmissionSessionContext {
  readonly actorId: string
  readonly sessionFingerprint: string
  rpc(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<BenefitSubmissionRpcResponse>
}
export type BenefitSubmissionSessionProvider = () => BenefitSubmissionSessionContext | null | Promise<BenefitSubmissionSessionContext | null>
export interface BenefitSubmissionRepository {
  getCurrentAccountScope(signal?: AbortSignal): Promise<BenefitSubmissionResult<BenefitSubmissionAccountScope>>
  createSubmission(input: CreateBenefitSubmissionInput, signal?: AbortSignal): Promise<BenefitSubmissionResult<BenefitSubmissionItem>>
  listMySubmissions(input: BenefitSubmissionListInput, signal?: AbortSignal): Promise<BenefitSubmissionResult<BenefitSubmissionPage>>
}

const companyPattern = /^(?:KR-CRN-[0-9]{13}|KR-BIZ-[0-9]{10})$/
const timestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/
const ownerKeys = ['id','company_id','category_id','benefit_text','eligibility_text','condition_text','source_url','status','admin_response','publication_id','reviewed_at','created_at','updated_at'] as const
const SESSION_DOMAIN = 'breadlab:benefit-submission:session-fingerprint:v1'
const SCOPE_DOMAIN = 'breadlab:benefit-submission:account-scope:v1'
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function exact(value: Record<string, unknown>, keys: readonly string[]) { const a=Object.keys(value).sort(), b=[...keys].sort(); return a.length===b.length && a.every((key,index)=>key===b[index]) }
function dense(value: unknown[]) { return value.every((_, index) => Object.prototype.hasOwnProperty.call(value,index)) }
function length(value: string) { return Array.from(value).length }
function bounded(value: unknown, max: number): value is string { return typeof value === 'string' && length(value)>=1 && length(value)<=max && value.trim()===value }
function nullableBounded(value: unknown, max: number): value is string|null { return value===null || bounded(value,max) }
function category(value: unknown): value is BenefitSubmissionCategory { return typeof value === 'string' && (BENEFIT_SUBMISSION_CATEGORIES as readonly string[]).includes(value) }
function leap(year:number){ return year%4===0&&(year%100!==0||year%400===0) }
function days(year:number,month:number){ return month===2?(leap(year)?29:28):[4,6,9,11].includes(month)?30:31 }
export function isBenefitSubmissionTimestamp(value: unknown): value is string {
  if(typeof value!=='string') return false; const match=timestampPattern.exec(value); if(!match)return false
  const [year,month,day,hour,minute,second,offsetHour,offsetMinute]=match.slice(1).map(Number)
  return year>=1&&month>=1&&month<=12&&day>=1&&day<=days(year,month)&&hour<=23&&minute<=59&&second<=59&&(Number.isNaN(offsetHour)||(offsetHour<=23&&offsetMinute<=59))&&Number.isFinite(Date.parse(value))
}
export function isBenefitSubmissionSourceUrl(value: unknown): value is string {
  if(typeof value!=='string'||length(value)<9||length(value)>2048||value.trim()!==value||/\s/u.test(value)||Array.from(value).some(character=>{const code=character.charCodeAt(0);return code<=31||code===127})) return false
  const match=/^https:\/\/([^/?#]+)(?:[/?#].*)?$/.exec(value); if(!match)return false
  const authority=match[1]; if(authority.includes('@')||authority.includes('[')||authority.includes(']')||!/^[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/.test(authority))return false
  const [rawHost,rawPort='']=authority.split(':'); const host=rawHost.toLowerCase(); if(rawPort&&(Number(rawPort)<1||Number(rawPort)>65535))return false
  if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||host.endsWith('.test')||host.endsWith('.invalid')||/^[0-9.]+$/.test(host)||/^(?:[0-9]+|0x[0-9a-f]+)(?:\.(?:[0-9]+|0x[0-9a-f]+))*$/i.test(host))return false
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(host)
}
function order(...values:(string|null)[]){ const present=values.filter((v):v is string=>v!==null); return present.every((v,i)=>i===0||Date.parse(v)>=Date.parse(present[i-1])) }
export function decodeBenefitSubmissionItem(value: unknown): BenefitSubmissionItem {
  if(!record(value)||!exact(value,ownerKeys)||!isCanonicalUuid(value.id)||typeof value.company_id!=='string'||!companyPattern.test(value.company_id)||!category(value.category_id)||!bounded(value.benefit_text,5000)||!nullableBounded(value.eligibility_text,2000)||!nullableBounded(value.condition_text,2000)||(value.source_url!==null&&!isBenefitSubmissionSourceUrl(value.source_url))||typeof value.status!=='string'||!(BENEFIT_SUBMISSION_STATUSES as readonly string[]).includes(value.status)||!nullableBounded(value.admin_response,2000)||(value.publication_id!==null&&!isCanonicalUuid(value.publication_id))||(value.reviewed_at!==null&&!isBenefitSubmissionTimestamp(value.reviewed_at))||!isBenefitSubmissionTimestamp(value.created_at)||!isBenefitSubmissionTimestamp(value.updated_at)) throw new Error('invalid owner projection')
  const status=value.status as BenefitSubmissionItem['status']; const untouched=status==='submitted'; const approved=status==='approved'
  if((untouched&&(value.admin_response!==null||value.publication_id!==null||value.reviewed_at!==null))||(!untouched&&(value.admin_response===null||value.reviewed_at===null))||(approved!==(value.publication_id!==null))||!order(value.created_at,value.updated_at)||(value.reviewed_at!==null&&!order(value.created_at,value.reviewed_at,value.updated_at)))throw new Error('invalid owner state')
  return { id:value.id.toLowerCase(), companyId:value.company_id, categoryId:value.category_id, benefitText:value.benefit_text, eligibilityText:value.eligibility_text, conditionText:value.condition_text, sourceUrl:value.source_url as string|null, status, adminResponse:value.admin_response as string|null, publicationId:value.publication_id===null?null:(value.publication_id as string).toLowerCase(), reviewedAt:value.reviewed_at as string|null, createdAt:value.created_at, updatedAt:value.updated_at }
}
function cursor(value:unknown):BenefitSubmissionCursor { if(!record(value)||!exact(value,['created_at','id'])||!isBenefitSubmissionTimestamp(value.created_at)||!isCanonicalUuid(value.id))throw new Error('invalid cursor'); return {createdAt:value.created_at,id:value.id.toLowerCase()} }
function micros(value:string){ const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)!; return BigInt(Date.parse(`${match[1]}${match[3]}`))*1000n+BigInt((match[2]??'').padEnd(6,'0')||'0') }
function compare(a:BenefitSubmissionCursor,b:BenefitSubmissionCursor){ const delta=micros(a.createdAt)-micros(b.createdAt); return delta<0n?-1:delta>0n?1:a.id<b.id?-1:a.id>b.id?1:0 }
function decodePage(value:unknown,input:BenefitSubmissionListInput):BenefitSubmissionPage {
  if(!record(value)||!exact(value,['items','has_more','next_cursor'])||!Array.isArray(value.items)||!dense(value.items)||value.items.length>input.limit||typeof value.has_more!=='boolean'||(value.has_more&&value.next_cursor===null)||(!value.has_more&&value.next_cursor!==null))throw new Error('invalid page')
  const items=value.items.map(decodeBenefitSubmissionItem); if(new Set(items.map(item=>item.id)).size!==items.length||items.some((item,index)=>index>0&&compare({createdAt:items[index-1].createdAt,id:items[index-1].id},{createdAt:item.createdAt,id:item.id})<=0))throw new Error('invalid page order')
  const next=value.next_cursor===null?null:cursor(value.next_cursor); if(next&&(items.length===0||compare({createdAt:items.at(-1)!.createdAt,id:items.at(-1)!.id},next)!==0))throw new Error('invalid next cursor')
  return {items,hasMore:value.has_more,nextCursor:next}
}
function validCreate(input:CreateBenefitSubmissionInput){ return isStrictUuid(input.clientKey)&&companyPattern.test(input.companyId)&&category(input.categoryId)&&bounded(input.benefitText,5000)&&nullableBounded(input.eligibilityText,2000)&&nullableBounded(input.conditionText,2000)&&(input.sourceUrl===null||input.sourceUrl===''||isBenefitSubmissionSourceUrl(input.sourceUrl)) }
function validList(input:BenefitSubmissionListInput){ return Number.isSafeInteger(input.limit)&&input.limit>=1&&input.limit<=100&&(!input.cursor||(isBenefitSubmissionTimestamp(input.cursor.createdAt)&&isCanonicalUuid(input.cursor.id))) }
function fail<T>(code: BenefitSubmissionErrorCode, message:string, sourceCode?:string):BenefitSubmissionResult<T>{ return {ok:false,error:{code,message,...(sourceCode?{sourceCode}: {})}} }
function mapError<T>(error:unknown,statusValue?:unknown):BenefitSubmissionResult<T>{
  if(error instanceof DOMException&&error.name==='AbortError')return fail('aborted','요청이 취소되었습니다.'); if(error instanceof TypeError)return fail('network','네트워크 요청에 실패했습니다.')
  const source=record(error)&&typeof error.code==='string'?error.code:undefined; const status=typeof statusValue==='number'?statusValue:record(error)&&typeof error.status==='number'?error.status:undefined; const message=record(error)&&typeof error.message==='string'?error.message:''
  if(status===401||source==='PGRST303')return fail('auth_required','로그인이 만료되었습니다. 다시 로그인해 주세요.',source)
  if(status===403||source==='42501')return fail('forbidden','이 요청을 수행할 권한이 없습니다.',source)
  if(status===429||source==='PGRST429'||source==='rate_limit_exceeded')return fail('rate_limited','요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',source)
  if(source==='40001'||status===409)return fail('conflict','요청 상태가 변경되었습니다. 다시 시도해 주세요.',source)
  if(source==='22023'&&/client key reused/i.test(message))return fail('idempotency_mismatch','이 제출 초안이 변경되었습니다. 새 제출로 다시 시작해 주세요.',source)
  if(status!==undefined&&status>=500)return fail('unavailable','서비스를 일시적으로 이용할 수 없습니다.',source)
  return fail('unknown','요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',source)
}
async function sha256(material:string){ const digest=new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(material))); return [...digest].map(byte=>byte.toString(16).padStart(2,'0')).join('') }
export async function deriveBenefitSubmissionAccountScope(actorId:string):Promise<BenefitSubmissionAccountScope>{ if(!isCanonicalUuid(actorId))throw new Error('invalid actor'); return await sha256(`${SCOPE_DOMAIN}\0${actorId.toLowerCase()}`) as BenefitSubmissionAccountScope }
function validContext(value:unknown):value is BenefitSubmissionSessionContext{return record(value)&&isCanonicalUuid(value.actorId)&&typeof value.sessionFingerprint==='string'&&value.sessionFingerprint.length>0&&value.sessionFingerprint.length<=256&&typeof value.rpc==='function'}
function same(a:BenefitSubmissionSessionContext,b:BenefitSubmissionSessionContext){return a.actorId.toLowerCase()===b.actorId.toLowerCase()&&a.sessionFingerprint===b.sessionFingerprint}
export function createBenefitSubmissionRepository({getSessionContext}:{getSessionContext:BenefitSubmissionSessionProvider}):BenefitSubmissionRepository {
  async function capture(signal?:AbortSignal):Promise<BenefitSubmissionResult<BenefitSubmissionSessionContext>>{ if(signal?.aborted)return fail('aborted','요청이 취소되었습니다.'); try{const value=await getSessionContext(); if(signal?.aborted)return fail('aborted','요청이 취소되었습니다.'); return value===null?fail('auth_required','로그인이 필요합니다.'):validContext(value)?{ok:true,data:value}:fail('unknown','로그인 세션을 확인할 수 없습니다.')}catch(error){return signal?.aborted?fail('aborted','요청이 취소되었습니다.'):mapError(error)} }
  async function execute<T>(name:string,args:Record<string,unknown>,decode:(value:unknown)=>T,signal?:AbortSignal):Promise<BenefitSubmissionResult<T>>{ const initial=await capture(signal); if(!initial.ok)return initial; const preflight=await capture(signal); if(!preflight.ok)return preflight; if(!same(initial.data,preflight.data))return fail('stale_response','로그인 세션이 변경되어 요청을 중단했습니다.'); let response:BenefitSubmissionRpcResponse; try{response=await initial.data.rpc(name,args,signal)}catch(error){return signal?.aborted?fail('aborted','요청이 취소되었습니다.'):mapError(error)} if(signal?.aborted)return fail('aborted','요청이 취소되었습니다.'); const after=await capture(signal); if(!after.ok)return after; if(!same(initial.data,after.data))return fail('stale_response','로그인 세션이 변경되어 이전 응답을 폐기했습니다.'); if(!record(response)||!exact(response,['data','error','status','statusText'])||!Number.isInteger(response.status)||response.status<100||response.status>599||typeof response.statusText!=='string'||new TextEncoder().encode(response.statusText).length>800)return fail('invalid_response','서버 응답을 확인할 수 없습니다.'); if(response.error!==null)return mapError(response.error,response.status); if(typeof response.status==='number'&&(response.status<200||response.status>299||response.status===204))return fail('invalid_response','서버 응답을 확인할 수 없습니다.'); try{return {ok:true,data:decode(response.data)}}catch{return fail('invalid_response','서버 응답을 확인할 수 없습니다.')} }
  return { async getCurrentAccountScope(signal){ const result=await capture(signal); if(!result.ok)return result; try{return {ok:true,data:await deriveBenefitSubmissionAccountScope(result.data.actorId)}}catch{return fail('unknown','로그인 계정을 확인할 수 없습니다.')} }, createSubmission(input,signal){ if(!validCreate(input))return Promise.resolve(fail('invalid_argument','입력 내용을 확인해 주세요.')); return execute('create_benefit_submission_v1',{p_client_key:input.clientKey,p_company_id:input.companyId,p_category_id:input.categoryId,p_benefit_text:input.benefitText,p_eligibility_text:input.eligibilityText,p_condition_text:input.conditionText,p_source_url:input.sourceUrl||null},decodeBenefitSubmissionItem,signal) }, listMySubmissions(input,signal){ if(!validList(input))return Promise.resolve(fail('invalid_argument','입력 내용을 확인해 주세요.')); return execute('list_my_benefit_submissions_v1',{p_limit:input.limit,p_cursor_created_at:input.cursor?.createdAt??null,p_cursor_id:input.cursor?.id??null},value=>decodePage(value,input),signal) } }
}
type Auth={
  getSession():Promise<{data:{session:{user:{id:string};access_token:string}|null}}>
  onAuthStateChange?(callback:(event:string,session:unknown)=>void):{data:{subscription:{unsubscribe():void}}}
}
export function createBenefitSubmissionSessionProvider(auth:Auth,config:{supabaseUrl:string;supabasePublishableKey:string},fetcher:typeof fetch=globalThis.fetch):BenefitSubmissionSessionProvider{let generation=0;auth.onAuthStateChange?.(()=>{generation+=1});return async()=>{const session=(await auth.getSession()).data.session;if(!session||!isCanonicalUuid(session.user.id)||!session.access_token)return null;const token=session.access_token;return {actorId:session.user.id.toLowerCase(),sessionFingerprint:await sha256(`${SESSION_DOMAIN}\0${token}\0${generation}`),async rpc(name,args,signal){const response=await fetcher(`${config.supabaseUrl}/rest/v1/rpc/${encodeURIComponent(name)}`,{method:'POST',headers:{apikey:config.supabasePublishableKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal});let payload:unknown;try{payload=await response.json()}catch{payload=undefined}return response.ok?{data:payload,error:null,status:response.status,statusText:response.statusText}:{data:null,error:record(payload)?payload:{code:'INVALID_ERROR',message:'Invalid response'},status:response.status,statusText:response.statusText}}}}}
let singleton:BenefitSubmissionRepository|undefined
export function getBenefitSubmissionRepository(){if(singleton)return singleton;const supabase=getSupabaseClient(),config=parseEnv(import.meta.env);singleton=createBenefitSubmissionRepository({getSessionContext:createBenefitSubmissionSessionProvider(supabase.auth,config)});return singleton}
