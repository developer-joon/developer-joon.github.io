import type { BenefitDirectoryError, BenefitDirectoryErrorCode } from '../types/benefitDirectory'

export const PUBLIC_DIRECTORY_PREPARING_MESSAGE = '기업 데이터를 준비하고 있습니다. 잠시 후 다시 확인해 주세요.'

export interface PublicDirectoryErrorPresentation {
  message: string
  canRetry: boolean
}

export type PublicDirectoryErrorContext = 'search' | 'detail'

const PUBLIC_DIRECTORY_ERROR_MESSAGES: Record<PublicDirectoryErrorContext, Record<BenefitDirectoryErrorCode, string>> = {
  search: {
    invalid_argument: '검색 조건을 확인한 뒤 다시 시도해 주세요.',
    aborted: '요청이 취소되었습니다.',
    network: '네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
    timeout: '요청 시간이 초과되었습니다. 다시 시도해 주세요.',
    rate_limited: '요청이 많습니다. 잠시 후 다시 시도해 주세요.',
    unavailable: '기업 검색 서비스를 일시적으로 이용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    configuration: PUBLIC_DIRECTORY_PREPARING_MESSAGE,
    not_found: '기업 검색 결과를 찾을 수 없습니다.',
    invalid_response: '기업 검색 결과를 표시할 수 없습니다.',
    unknown: '기업 검색을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  },
  detail: {
    invalid_argument: '기업 정보를 불러올 수 없습니다.',
    aborted: '요청이 취소되었습니다.',
    network: '네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
    timeout: '요청 시간이 초과되었습니다. 다시 시도해 주세요.',
    rate_limited: '요청이 많습니다. 잠시 후 다시 시도해 주세요.',
    unavailable: '기업 정보를 일시적으로 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.',
    configuration: PUBLIC_DIRECTORY_PREPARING_MESSAGE,
    not_found: '기업 정보를 찾을 수 없습니다.',
    invalid_response: '기업 정보를 표시할 수 없습니다.',
    unknown: '기업 복지 정보를 불러오지 못했습니다.',
  },
}

export function presentPublicDirectoryError(
  error: BenefitDirectoryError,
  context: PublicDirectoryErrorContext,
): PublicDirectoryErrorPresentation {
  return {
    message: PUBLIC_DIRECTORY_ERROR_MESSAGES[context][error.code],
    canRetry: error.code !== 'aborted' && !(context === 'detail' && error.code === 'not_found'),
  }
}
