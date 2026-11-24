import type { BenefitClaimErrorCode } from '../types/benefitClaims'
import type { BenefitCompanyRequestErrorCode } from '../types/benefitCompanyRequests'

type AdminErrorCode = BenefitClaimErrorCode | BenefitCompanyRequestErrorCode

export function presentAdminError(code:AdminErrorCode,context:'gate'|'queue'|'audit'|'mutation'):{message:string;retryable:boolean}{
  switch(code){
    case 'auth_required': case 'stale_session': return {message:'로그인 세션이 변경되었습니다. 다시 로그인해 주세요.',retryable:false}
    case 'forbidden': return {message:'이 관리자 작업을 수행할 권한이 없습니다.',retryable:false}
    case 'conflict': return {message:'최신 상태를 다시 불러왔습니다. 내용을 확인한 뒤 새 조치를 선택해 주세요.',retryable:true}
    case 'rate_limited': return {message:'요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',retryable:true}
    case 'invalid_argument': return {message:'입력 내용을 확인해 주세요.',retryable:false}
    case 'aborted': return {message:'요청이 취소되었습니다.',retryable:true}
    case 'network': return {message:'네트워크 연결을 확인한 뒤 다시 시도해 주세요.',retryable:true}
    case 'unavailable': return {message:'관리자 서비스를 일시적으로 이용할 수 없습니다.',retryable:true}
    case 'invalid_response': return {message:'안전하게 확인할 수 없는 응답을 받았습니다.',retryable:true}
    case 'verification_rejected': return {message:'외부 확인 결과를 승인할 수 없습니다.',retryable:false}
    case 'verification_indeterminate': return {message:'외부 확인 결과가 확정되지 않았습니다. 같은 요청으로 다시 시도해 주세요.',retryable:true}
    case 'unknown': return {message:context==='gate'?'관리자 권한을 확인하지 못했습니다.':'관리자 요청을 처리하지 못했습니다.',retryable:true}
    default: return assertNever(code)
  }
}
function assertNever(value:never):never{throw new Error(`unmapped admin error: ${String(value)}`)}
