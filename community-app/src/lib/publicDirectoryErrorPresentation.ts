import type { BenefitDirectoryError, BenefitDirectoryErrorCode } from '../types/benefitDirectory'

export const PUBLIC_DIRECTORY_PREPARING_MESSAGE = '기업 데이터를 준비하고 있습니다. 잠시 후 다시 확인해 주세요.'

export interface PublicDirectoryErrorPresentation {
  message: string
  canRetry: boolean
}

interface PublicDirectoryErrorPresentationOptions {
  messages?: Partial<Record<BenefitDirectoryErrorCode, string>>
  fallbackMessage?: string
  nonRetryableCodes?: readonly BenefitDirectoryErrorCode[]
}

export function presentPublicDirectoryError(
  error: BenefitDirectoryError,
  options: PublicDirectoryErrorPresentationOptions = {},
): PublicDirectoryErrorPresentation {
  const message = error.code === 'configuration'
    ? PUBLIC_DIRECTORY_PREPARING_MESSAGE
    : options.messages?.[error.code] ?? options.fallbackMessage ?? error.message

  return {
    message,
    canRetry: !options.nonRetryableCodes?.includes(error.code),
  }
}
