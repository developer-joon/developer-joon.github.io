import { isCanonicalUuid, isStrictUuid } from './uuid'

export interface DraftLock {
  runExclusive<T>(lockName:string, fn:()=>T|Promise<T>):Promise<T>
}

type WebLockManager = { request<T>(name:string, options:{mode:'exclusive'}, callback:()=>T|Promise<T>):Promise<T> }

/** Production adapter. It deliberately has no fallback: localStorage is not an atomic lock. */
export function createWebDraftLock():DraftLock {
  return { async runExclusive<T>(lockName:string,fn:()=>T|Promise<T>):Promise<T>{
    const locks=(globalThis.navigator as Navigator|undefined)?.locks as WebLockManager|undefined
    if(!locks||typeof locks.request!=='function')throw new Error('locking_unavailable')
    return locks.request(lockName,{mode:'exclusive'},fn)
  }}
}

export function canonicalActor(value:unknown):string|null{return isCanonicalUuid(value)?value.toLowerCase():null}
export function generatedUuid(value:unknown):string|null{return isStrictUuid(value)?value.toLowerCase():null}
export function isPlainRecord(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype}
export function hasExactKeys(value:Record<string,unknown>,keys:readonly string[]):boolean{const actual=Object.keys(value).sort(),expected=[...keys].sort();return actual.length===expected.length&&actual.every((key,index)=>key===expected[index])}
export function boundedText(value:unknown,max:number,{empty=true,trimmed=false,controls=false}:{empty?:boolean;trimmed?:boolean;controls?:boolean}={}):value is string{return typeof value==='string'&&(empty||value.length>0)&&Array.from(value).length<=max&&new TextEncoder().encode(value).length<=max*4&&!/[\uD800-\uDFFF]/u.test(value)&&(!trimmed||value.trim()===value)&&(!controls||![...value].some(char=>{const code=char.charCodeAt(0);return code<=31||code===127}))}
export function validCalendarDate(value:unknown,today:string,empty=true):value is string{if(value===''&&empty)return true;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value>today)return false;const [year,month,day]=value.split('-').map(Number),date=new Date(Date.UTC(year,month-1,day));return year>=2000&&date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day}
export function validExactUtcTimestamp(value:unknown,now:Date):value is string{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))return false;const millis=Date.parse(value);if(!Number.isFinite(millis)||millis>now.getTime())return false;try{return new Date(millis).toISOString()===value}catch{return false}}

const sensitiveTokens=['token','key','secret','password','passwd','signature','signed','sig','credential','auth','authorization','accesstoken','refreshtoken','idtoken','apikey','clientsecret','secretkey','accesskey','privatekey','signingkey']
function safeQuery(url:string):boolean{const queryStart=url.indexOf('?');if(queryStart<0)return true;const query=url.slice(queryStart+1).split('#',1)[0];if(!query||query.includes(';'))return false;return query.split('&').every(pair=>{const equal=pair.indexOf('='),rawKey=equal<0?pair:pair.slice(0,equal),rawValue=equal<0?'':pair.slice(equal+1);if(!/^[A-Za-z0-9._~%-]+$/.test(rawKey)||/%(?![0-9a-f]{2})/i.test(rawKey+rawValue)||/%(?:[01][0-9a-f]|7f|23)/i.test(rawKey+rawValue))return false;let key:string;try{key=decodeURIComponent(rawKey)}catch{return false}if(/[()[\]{}]/.test(key))return false;const normalized=key.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,'');return !sensitiveTokens.some(token=>normalized===token||normalized.endsWith(token))})}
function publicHttps(value:unknown):value is string{if(!boundedText(value,2048,{empty:false,trimmed:true})||/\s|[\u0080-\u009f]/u.test(value)||!safeQuery(value))return false;try{const url=new URL(value);const host=url.hostname.toLowerCase();if(url.protocol!=='https:'||url.username||url.password||url.hash||!host.includes('.')||['localhost','local','internal','test','invalid'].some(s=>host===s||host.endsWith('.'+s)))return false;if(/^\[.*\]$/.test(host)||/^[0-9.]+$/.test(host))return false;return true}catch{return false}}
export function isBenefitDraftSourceUrl(value:unknown):value is string{return publicHttps(value)&&new TextEncoder().encode(value).length<=8192}
export function isBenefitDraftCompanyWebsite(value:unknown):value is string{return publicHttps(value)&&new TextEncoder().encode(value).length<=8192}

const forbiddenKeyTokens=['businessnumber','businessregistrationnumber','registrationnumber','openingdate','representativename','servicekey','servicetoken','authtoken','authorization','accesstoken','refreshtoken','clientsecret','secretkey','apikey','password','passwd','secret','사업자번호','사업자등록번호','등록번호','개업일','개업일자','대표자','대표자명','서비스키','인증토큰','비밀번호','암호','비밀']
export function hasSensitiveKey(value:unknown,seen=new Set<object>()):boolean{if(typeof value!=='object'||value===null)return false;if(seen.has(value))return true;seen.add(value);if(Array.isArray(value)){for(let index=0;index<value.length;index+=1)if(!Object.prototype.hasOwnProperty.call(value,index)||hasSensitiveKey(value[index],seen))return true;return false}if(!isPlainRecord(value))return true;for(const key of Object.keys(value)){const normalized=key.normalize('NFKC').toLowerCase().replace(/[\s_.{}()-]+/g,'').replaceAll('[','').replaceAll(']','').replace(/[^a-z0-9가-힣]/g,'');if(forbiddenKeyTokens.some(token=>normalized===token||normalized.endsWith(token))||hasSensitiveKey(value[key],seen))return true}return false}
