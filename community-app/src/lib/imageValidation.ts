export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_IMAGES_PER_POST = 5
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export type ImageValidationErrorCode = 'empty' | 'too_large' | 'unsupported_type' | 'too_many'
export interface ImageValidationError { code: ImageValidationErrorCode; message: string }
export type ImageValidationResult = { ok: true } | { ok: false; error: ImageValidationError }

const errors: Record<ImageValidationErrorCode, string> = {
  empty: '빈 파일은 업로드할 수 없습니다.',
  too_large: '이미지는 5 MiB 이하여야 합니다.',
  unsupported_type: 'JPEG, PNG, WebP 이미지만 업로드할 수 있습니다.',
  too_many: '이미지는 게시글당 최대 5개까지 업로드할 수 있습니다.',
}

function failure(code: ImageValidationErrorCode): ImageValidationResult {
  return { ok: false, error: { code, message: errors[code] } }
}

export function validateImageFile(file: Pick<File, 'size' | 'type'>): ImageValidationResult {
  if (file.size < 1) return failure('empty')
  if (file.size > MAX_IMAGE_BYTES) return failure('too_large')
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) return failure('unsupported_type')
  return { ok: true }
}

export function validateImageCount(currentCount: number, addedCount: number): ImageValidationResult {
  if (!Number.isSafeInteger(currentCount) || !Number.isSafeInteger(addedCount) || currentCount < 0 || addedCount < 0 || currentCount + addedCount > MAX_IMAGES_PER_POST) {
    return failure('too_many')
  }
  return { ok: true }
}
