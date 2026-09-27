export interface PostInput {
  title: string
  bodyMarkdown: string
  tagIds: string[]
}

export type PostField = keyof PostInput
export type PostErrors = Partial<Record<PostField, string>>
export type ValidationResult = { ok: true; value: PostInput } | { ok: false; errors: PostErrors }

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isStrictUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value)
}

export function validatePostInput(input: PostInput): ValidationResult {
  const value = { title: input.title.trim(), bodyMarkdown: input.bodyMarkdown.trim(), tagIds: [...input.tagIds] }
  const errors: PostErrors = {}
  if (value.title.length < 2 || value.title.length > 120) errors.title = '제목은 2자 이상 120자 이하로 입력해 주세요.'
  if (value.bodyMarkdown.length < 1 || value.bodyMarkdown.length > 50_000) errors.bodyMarkdown = '본문을 1자 이상 50,000자 이하로 입력해 주세요.'
  if (value.tagIds.length < 1 || value.tagIds.length > 3) errors.tagIds = '태그를 1개 이상 3개 이하로 선택해 주세요.'
  else if (new Set(value.tagIds).size !== value.tagIds.length) errors.tagIds = '태그는 중복 없이 선택해 주세요.'
  else if (!value.tagIds.every(isStrictUuid)) errors.tagIds = '올바른 태그를 선택해 주세요.'
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value }
}
