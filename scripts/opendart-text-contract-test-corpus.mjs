const controls = Object.freeze([
  ['tab', '\t'],
  ['carriage-return', '\r'],
  ['line-feed', '\n'],
  ['nul', '\u0000'],
  ['delete', '\u007f'],
  ['c1-padding-character', '\u0080'],
  ['c1-next-line', '\u0085'],
  ['c1-application-program-command', '\u009f'],
  ['line-separator', '\u2028'],
  ['paragraph-separator', '\u2029'],
])

const malformedSurrogates = Object.freeze([
  ['lone high surrogate', '\ud800'],
  ['lone low surrogate', '\udc00'],
  ['high surrogate followed by non-low', '\ud800A'],
  ['two high surrogates', '\ud800\ud801'],
])

export function corporationTextCases(field) {
  const optional = field === 'corp_eng_name'
  return [
    { name: 'ordinary internal spaces', value: 'Alpha  Beta 주식회사', accept: true },
    { name: 'ordinary Korean and Latin', value: '가나다 Alpha 주식회사', accept: true },
    { name: 'exact ASCII code-point boundary', value: 'A'.repeat(200), accept: true },
    { name: 'exact UTF-8 and code-point boundary', value: '😀'.repeat(200), accept: true },
    { name: 'literal replacement character remains a scalar', value: 'Alpha�Beta', accept: true },
    { name: 'whitespace only', value: '   ', accept: false },
    { name: 'leading space', value: ' Alpha', accept: false },
    { name: 'trailing space', value: 'Alpha ', accept: false },
    { name: 'overlong ASCII', value: 'A'.repeat(201), accept: false },
    { name: 'overlong Korean', value: '가'.repeat(201), accept: false },
    { name: 'overlong emoji', value: '😀'.repeat(201), accept: false },
    ...controls.map(([name, control]) => ({ name, value: `Alpha${control}Beta`, accept: false })),
    ...malformedSurrogates.map(([name, malformed]) => ({ name, value: `Alpha${malformed}Beta`, accept: false })),
    ...(optional ? [{ name: 'optional empty value', value: '', accept: true }] : []),
  ]
}

export function authorityTextCases() {
  return [
    { name: 'edition exact ASCII boundary', field: 'source_edition', value: 'E'.repeat(100), accept: true },
    { name: 'edition exact UTF-8 boundary', field: 'source_edition', value: '😀'.repeat(100), accept: true },
    { name: 'edition ordinary Korean and Latin', field: 'source_edition', value: '2026년 OpenDART edition', accept: true },
    { name: 'edition literal replacement character remains a scalar', field: 'source_edition', value: 'edition�value', accept: true },
    { name: 'edition overlong ASCII', field: 'source_edition', value: 'E'.repeat(101), accept: false },
    { name: 'edition overlong Korean', field: 'source_edition', value: '판'.repeat(101), accept: false },
    { name: 'edition overlong emoji', field: 'source_edition', value: '😀'.repeat(101), accept: false },
    { name: 'rights exact ASCII boundary', field: 'reuse_rights_note', value: 'R'.repeat(1000), accept: true },
    { name: 'rights exact UTF-8 boundary', field: 'reuse_rights_note', value: '😀'.repeat(1000), accept: true },
    { name: 'rights ordinary Korean and Latin', field: 'reuse_rights_note', value: 'OpenDART 출처 표시 필요', accept: true },
    { name: 'rights overlong ASCII', field: 'reuse_rights_note', value: 'R'.repeat(1001), accept: false },
    { name: 'rights overlong Korean', field: 'reuse_rights_note', value: '권'.repeat(1001), accept: false },
    { name: 'rights overlong emoji', field: 'reuse_rights_note', value: '😀'.repeat(1001), accept: false },
    { name: 'edition whitespace only', field: 'source_edition', value: '   ', accept: false },
    { name: 'official URL exact value', field: 'official_url', value: 'https://opendart.fss.or.kr/api/corpCode.xml', accept: true },
    { name: 'retrieval timestamp exact value', field: 'retrieved_at', value: '2026-11-23T00:00:00Z', accept: true },
    ...controls.flatMap(([name, control]) => [
      { name: `edition ${name}`, field: 'source_edition', value: `edition${control}value`, accept: false },
      { name: `rights ${name}`, field: 'reuse_rights_note', value: `rights${control}note`, accept: false },
      { name: `official URL ${name}`, field: 'official_url', value: `https://opendart.fss.or.kr/${control}api/corpCode.xml`, accept: false },
      { name: `retrieval timestamp ${name}`, field: 'retrieved_at', value: `2026-11-23T00:00:00Z${control}`, accept: false },
    ]),
    ...malformedSurrogates.flatMap(([name, malformed]) => [
      { name: `edition ${name}`, field: 'source_edition', value: `edition${malformed}value`, accept: false },
      { name: `rights ${name}`, field: 'reuse_rights_note', value: `rights${malformed}note`, accept: false },
      { name: `official URL ${name}`, field: 'official_url', value: `https://opendart.fss.or.kr/${malformed}api/corpCode.xml`, accept: false },
      { name: `retrieval timestamp ${name}`, field: 'retrieved_at', value: `2026-11-23T00:00:00Z${malformed}`, accept: false },
    ]),
  ]
}
