export const COMMENT_MAX_LENGTH = 5000

export type CommentValidation = { valid: true; body: string } | { valid: false; message: string }

export function validateCommentBody(value: string): CommentValidation {
  const body = value.trim()
  if (body.length < 1) return { valid: false, message: '댓글은 공백을 제외하고 1자 이상 입력해 주세요.' }
  if (body.length > COMMENT_MAX_LENGTH) return { valid: false, message: '댓글은 5000자 이하로 입력해 주세요.' }
  return { valid: true, body }
}
