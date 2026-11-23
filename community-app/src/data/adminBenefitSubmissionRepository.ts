import { parseEnv } from '../config/env'
import { getSupabaseClient } from '../lib/supabase'
import { compareCanonicalUuids, isCanonicalUuid, parseCanonicalUuid, parseStrictUuid } from '../lib/uuid'
import { comparePostgresTimestamps } from '../lib/postgresTimestamp'
import { createBenefitSubmissionSessionProvider, decodeBenefitSubmissionItem, isBenefitSubmissionTimestamp, isStrictBenefitRpcEnvelope, type BenefitSubmissionRpcResponse, type BenefitSubmissionSessionContext, type BenefitSubmissionSessionProvider } from './benefitSubmissionRepository'
import { ADMIN_BENEFIT_SUBMISSION_FILTERS, type AdminBenefitSubmissionCursor, type AdminBenefitSubmissionListInput, type AdminBenefitSubmissionPage, type AdminBenefitSubmissionRepositoryError, type AdminBenefitSubmissionResult, type AdminBenefitSubmissionReviewInput } from '../types/adminBenefitSubmissions'
import type { BenefitSubmissionErrorCode, BenefitSubmissionItem } from '../types/benefitSubmissions'

export type AdminBenefitSubmissionSessionContext = BenefitSubmissionSessionContext
export interface AdminBenefitSubmissionRepository {
  listQueue(input: AdminBenefitSubmissionListInput, signal?: AbortSignal): Promise<AdminBenefitSubmissionResult<AdminBenefitSubmissionPage>>
  review(input: AdminBenefitSubmissionReviewInput, signal?: AbortSignal): Promise<AdminBenefitSubmissionResult<BenefitSubmissionItem>>
}
const statuses = ADMIN_BENEFIT_SUBMISSION_FILTERS as readonly string[]
function record(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value)}
function exact(value:Record<string,unknown>,keys:readonly string[]){const actual=Object.keys(value).sort(),expected=[...keys].sort();return actual.length===expected.length&&actual.every((key,index)=>key===expected[index])}
function dense(value:unknown[]){return value.every((_,index)=>Object.prototype.hasOwnProperty.call(value,index))}
function length(value:string){return Array.from(value).length}
function bounded(value:unknown,max:number):value is string{return typeof value==='string'&&length(value)>=1&&length(value)<=max&&value.trim()===value}
function nullable(value:unknown,max:number):value is string|null{return value===null||bounded(value,max)}
function canonicalCursor(value:AdminBenefitSubmissionCursor):AdminBenefitSubmissionCursor|null{const id=parseCanonicalUuid(value.id);return isBenefitSubmissionTimestamp(value.createdAt)&&id!==null?{createdAt:value.createdAt,id}:null}
function compare(left:AdminBenefitSubmissionCursor,right:AdminBenefitSubmissionCursor){const time=comparePostgresTimestamps(left.createdAt,right.createdAt);return time!==0?time:compareCanonicalUuids(left.id,right.id)}
function validList(input:AdminBenefitSubmissionListInput){return statuses.includes(input.status)&&Number.isSafeInteger(input.limit)&&input.limit>=1&&input.limit<=100}
function matchesFilter(status:unknown,filter:AdminBenefitSubmissionListInput['status']){return typeof status==='string'&&(filter==='all'?['submitted','reviewing','approved','rejected'].includes(status):filter==='active'?status==='submitted'||status==='reviewing':status===filter)}
function fail<T>(code:BenefitSubmissionErrorCode,message:string,sourceCode?:string):AdminBenefitSubmissionResult<T>{return {ok:false,error:{code,message,...(sourceCode?{sourceCode}:{})}}}
function sourceCode(error:unknown){if(!record(error)||typeof error.code!=='string')return undefined;if(error.code==='PGRST'&&typeof error.message==='string'){try{const parsed:unknown=JSON.parse(error.message);return record(parsed)&&typeof parsed.code==='string'?parsed.code:'PGRST'}catch{return 'PGRST'}}return error.code}
function mapError<T>(error:unknown,statusValue?:unknown):AdminBenefitSubmissionResult<T>{
  if(error instanceof DOMException&&error.name==='AbortError')return fail('aborted','요청이 취소되었습니다.')
  if(error instanceof TypeError)return fail('network','네트워크 요청에 실패했습니다.')
  const source=sourceCode(error),status=typeof statusValue==='number'?statusValue:record(error)&&typeof error.status==='number'?error.status:undefined,message=record(error)&&typeof error.message==='string'?error.message:''
  if(status===401||source==='PGRST303')return fail('auth_required','로그인이 만료되었습니다. 다시 로그인해 주세요.',source)
  if(status===403||source==='42501')return fail('forbidden','관리자 검토 권한이 없습니다.',source)
  if(status===429||source==='rate_limit_exceeded')return fail('rate_limited','요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',source)
  if(status===409||source==='40001')return fail('conflict','제보 상태가 변경되었습니다. 대기열을 새로고침한 뒤 다시 검토해 주세요.',source)
  if(source==='22023'&&/client key reused/i.test(message))return fail('idempotency_mismatch','같은 검토 키에 다른 결정이 연결되었습니다. 새로고침 후 다시 시도해 주세요.',source)
  if(status!==undefined&&status>=500)return fail('unavailable','서비스를 일시적으로 이용할 수 없습니다.',source)
  return fail('unknown','요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',source)
}
function decodePage(value:unknown,input:AdminBenefitSubmissionListInput):AdminBenefitSubmissionPage{
  if(!record(value)||!exact(value,['items','has_more','next_cursor'])||!Array.isArray(value.items)||!dense(value.items)||value.items.length>input.limit||typeof value.has_more!=='boolean'||(value.has_more&&(value.items.length!==input.limit||value.next_cursor===null))||(!value.has_more&&value.next_cursor!==null))throw new Error('invalid page')
  if(value.items.some(item=>!record(item)||!matchesFilter(item.status,input.status)))throw new Error('wrong queue filter')
  const items=value.items.map(decodeBenefitSubmissionItem)
  if(new Set(items.map(item=>item.id)).size!==items.length||items.some((item,index)=>index>0&&compare({createdAt:items[index-1].createdAt,id:items[index-1].id},{createdAt:item.createdAt,id:item.id})<=0))throw new Error('invalid page order')
  if(input.cursor&&items.some(item=>compare({createdAt:item.createdAt,id:item.id},input.cursor!)>=0))throw new Error('invalid cursor boundary')
  let nextCursor:AdminBenefitSubmissionCursor|null=null
  if(value.next_cursor!==null){if(!record(value.next_cursor)||!exact(value.next_cursor,['created_at','id'])||typeof value.next_cursor.created_at!=='string'||typeof value.next_cursor.id!=='string')throw new Error('invalid cursor');nextCursor=canonicalCursor({createdAt:value.next_cursor.created_at,id:value.next_cursor.id});if(!nextCursor)throw new Error('invalid cursor');const last=items.at(-1);if(!last||compare({createdAt:last.createdAt,id:last.id},nextCursor)!==0)throw new Error('cursor mismatch')}
  return {items,hasMore:value.has_more,nextCursor}
}
function canonicalAdminResponse(value:unknown){if(typeof value!=='string'||length(value)>2000||new TextEncoder().encode(value).length>8000)return null;const canonical=value.replace(/^ +| +$/g,'');return canonical===''?null:canonical}
function canonicalReview(input:AdminBenefitSubmissionReviewInput):AdminBenefitSubmissionReviewInput|null{
  const adminResponse=canonicalAdminResponse(input.adminResponse),submissionId=parseCanonicalUuid(input.submissionId),clientKey=parseStrictUuid(input.clientKey)
  if(submissionId===null||clientKey===null||adminResponse===null)return null
  if(input.expectedStatus==='submitted')return input.action==='start_review'?{...input,submissionId,clientKey,adminResponse}:null
  if(input.expectedStatus!=='reviewing'||input.action==='start_review')return null
  if(input.action!=='approve')return (!('publicTitle' in input)||input.publicTitle===undefined)?{...input,submissionId,clientKey,adminResponse}:null
  const existingPublicationId=input.existingPublicationId===null?null:parseCanonicalUuid(input.existingPublicationId)
  if(input.existingPublicationId!==null&&existingPublicationId===null)return null
  return bounded(input.publicTitle,200)&&bounded(input.publicDescription,5000)&&nullable(input.publicEligibility,2000)&&nullable(input.publicCondition,2000)?{...input,submissionId,clientKey,adminResponse,existingPublicationId}:null
}
export function adminBenefitSubmissionReviewFingerprint(input:AdminBenefitSubmissionReviewInput){const canonical=canonicalReview(input);if(!canonical)return null;const approval=canonical.action==='approve'?canonical:null;return JSON.stringify({submissionId:canonical.submissionId,expectedStatus:canonical.expectedStatus,action:canonical.action,adminResponse:canonical.adminResponse,publicTitle:approval?.publicTitle??null,publicDescription:approval?.publicDescription??null,publicEligibility:approval?.publicEligibility??null,publicCondition:approval?.publicCondition??null,existingPublicationId:approval?.existingPublicationId??null})}
function decodeReview(value:unknown,input:AdminBenefitSubmissionReviewInput){const item=decodeBenefitSubmissionItem(value);if(item.id!==input.submissionId||item.adminResponse!==input.adminResponse)throw new Error('wrong submission response');const expected=input.action==='start_review'||input.action==='additional_material_requested'?'reviewing':input.action==='approve'?'approved':'rejected';if(item.status!==expected||(input.action==='approve'?(item.publicationId===null):(item.publicationId!==null)))throw new Error('wrong transition');return item}
function validContext(value:unknown):value is BenefitSubmissionSessionContext{return record(value)&&isCanonicalUuid(value.actorId)&&typeof value.sessionFingerprint==='string'&&value.sessionFingerprint.length>0&&value.sessionFingerprint.length<=256&&typeof value.rpc==='function'}
function same(left:BenefitSubmissionSessionContext,right:BenefitSubmissionSessionContext){return left.actorId.toLowerCase()===right.actorId.toLowerCase()&&left.sessionFingerprint===right.sessionFingerprint}

export function createAdminBenefitSubmissionRepository({getSessionContext}:{getSessionContext:BenefitSubmissionSessionProvider}):AdminBenefitSubmissionRepository{
  async function capture(signal?:AbortSignal):Promise<AdminBenefitSubmissionResult<BenefitSubmissionSessionContext>>{if(signal?.aborted)return fail('aborted','요청이 취소되었습니다.');try{const value=await getSessionContext();if(signal?.aborted)return fail('aborted','요청이 취소되었습니다.');return value===null?fail('auth_required','로그인이 필요합니다.'):validContext(value)?{ok:true,data:value}:fail('unknown','로그인 세션을 확인할 수 없습니다.')}catch(error){return signal?.aborted?fail('aborted','요청이 취소되었습니다.'):mapError(error)}}
  async function execute<T>(name:string,args:Record<string,unknown>,decode:(value:unknown)=>T,signal?:AbortSignal):Promise<AdminBenefitSubmissionResult<T>>{const initial=await capture(signal);if(!initial.ok)return initial;const before=await capture(signal);if(!before.ok)return before;if(!same(initial.data,before.data))return fail('stale_response','로그인 세션이 변경되어 요청을 중단했습니다.');let response:BenefitSubmissionRpcResponse;try{response=await initial.data.rpc(name,args,signal)}catch(error){return signal?.aborted?fail('aborted','요청이 취소되었습니다.'):mapError(error)}if(signal?.aborted)return fail('aborted','요청이 취소되었습니다.');const after=await capture(signal);if(!after.ok)return after;if(!same(initial.data,after.data))return fail('stale_response','로그인 세션이 변경되어 이전 응답을 폐기했습니다.');if(!isStrictBenefitRpcEnvelope(response))return fail('invalid_response','서버 응답을 확인할 수 없습니다.');if(response.error!==null)return mapError(response.error,response.status);try{return {ok:true,data:decode(response.data)}}catch{return fail('invalid_response','서버 응답을 확인할 수 없습니다.')}}
  return {listQueue(input,signal){const cursor=input.cursor===undefined?undefined:canonicalCursor(input.cursor);if(!validList(input)||(input.cursor!==undefined&&cursor===null))return Promise.resolve(fail('invalid_argument','대기열 조건을 확인해 주세요.'));const canonical={...input,...(cursor?{cursor}:{})};return execute('list_benefit_submission_queue_v1',{p_status:canonical.status,p_limit:canonical.limit,p_cursor_created_at:cursor?.createdAt??null,p_cursor_id:cursor?.id??null},value=>decodePage(value,canonical),signal)},review(input,signal){const canonical=canonicalReview(input);if(!canonical)return Promise.resolve(fail('invalid_argument','검토 입력을 확인해 주세요.'));const approval=canonical.action==='approve'?canonical:null;return execute('review_benefit_submission_v1',{p_submission_id:canonical.submissionId,p_expected_status:canonical.expectedStatus,p_action:canonical.action,p_admin_response:canonical.adminResponse,p_client_key:canonical.clientKey,p_public_title:approval?.publicTitle??null,p_public_description:approval?.publicDescription??null,p_public_eligibility:approval?.publicEligibility??null,p_public_condition:approval?.publicCondition??null,p_existing_publication_id:approval?.existingPublicationId??null},value=>decodeReview(value,canonical),signal)}}
}
let singleton:AdminBenefitSubmissionRepository|undefined
export function getAdminBenefitSubmissionRepository(){if(singleton)return singleton;const supabase=getSupabaseClient(),config=parseEnv(import.meta.env);singleton=createAdminBenefitSubmissionRepository({getSessionContext:createBenefitSubmissionSessionProvider(supabase.auth,config)});return singleton}
export type { AdminBenefitSubmissionRepositoryError }
