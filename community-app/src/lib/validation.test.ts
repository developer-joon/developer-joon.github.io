import { describe, expect, it } from 'vitest'
import { isStrictUuid, validatePostInput } from './validation'

const tag = '56000000-0000-4000-8000-000000000040'
const seededTag = 'a1000000-0000-0000-0000-000000000001'

describe('post validation', () => {
  it('accepts a seeded PostgreSQL UUID tag while trimming valid title and body', () => {
    expect(validatePostInput({ title: '  제목  ', bodyMarkdown: '  본문  ', tagIds: [seededTag] })).toEqual({
      ok: true,
      value: { title: '제목', bodyMarkdown: '본문', tagIds: [seededTag] },
    })
  })

  it.each([
    [{ title: '가', bodyMarkdown: '본문', tagIds: [tag] }, 'title', '제목은 2자 이상 120자 이하로 입력해 주세요.'],
    [{ title: '가'.repeat(121), bodyMarkdown: '본문', tagIds: [tag] }, 'title', '제목은 2자 이상 120자 이하로 입력해 주세요.'],
    [{ title: '제목', bodyMarkdown: ' ', tagIds: [tag] }, 'bodyMarkdown', '본문을 1자 이상 50,000자 이하로 입력해 주세요.'],
    [{ title: '제목', bodyMarkdown: '가'.repeat(50001), tagIds: [tag] }, 'bodyMarkdown', '본문을 1자 이상 50,000자 이하로 입력해 주세요.'],
    [{ title: '제목', bodyMarkdown: '본문', tagIds: [] }, 'tagIds', '태그를 1개 이상 3개 이하로 선택해 주세요.'],
    [{ title: '제목', bodyMarkdown: '본문', tagIds: [tag, tag] }, 'tagIds', '태그는 중복 없이 선택해 주세요.'],
    [{ title: '제목', bodyMarkdown: '본문', tagIds: ['not-a-uuid'] }, 'tagIds', '올바른 태그를 선택해 주세요.'],
  ] as const)('rejects invalid field %#', (input, field, message) => {
    const result = validatePostInput({ ...input, tagIds: [...input.tagIds] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[field]).toBe(message)
  })

  it('accepts only canonical UUID mutation results', () => {
    expect(isStrictUuid('56000000-0000-4000-8000-000000000010')).toBe(true)
    expect(isStrictUuid(seededTag)).toBe(false)
    expect(isStrictUuid('not-a-uuid')).toBe(false)
  })
})
